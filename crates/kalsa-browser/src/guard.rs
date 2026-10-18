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

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Duration;

use playwright_rs::protocol::BrowserContext;
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

/// The one route every request meets. A request we refuse is aborted before it
/// reaches the network, so the browser never asks and nothing leaves.
pub async fn install(context: &BrowserContext, landings: &Landings) -> Result<(), playwright_rs::Error> {
    landing::watch(context, landings).await?;
    context
        .route("**/*", |route| async move {
            let request = route.request();
            match decide(request.url()).await {
                Verdict::Refused(_) => route.abort(Some("blockedbyclient")).await,
                Verdict::Allow => match crate::hold::verdict(request.method()) {
                    crate::hold::Verdict::Allow => route.continue_(None).await,
                    crate::hold::Verdict::Refused => route.abort(Some("blockedbyclient")).await,
                },
            }
        })
        .await
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
