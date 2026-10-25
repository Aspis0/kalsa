//! Where the browser's own connection actually ended up (one responsibility:
//! what the page is really being served from, and whether that is somewhere we
//! would never have opened).
//!
//! This is the half of the address check that no amount of looking at the URL can
//! do. `guard::decide` reads a name, resolves it, and answers — but Chrome
//! resolves it again for itself, and between the two a name that answered us with
//! a public address can answer Chrome with one on this computer's network.
//! Playwright hands us what that second resolution actually was:
//! `ResponseObject::server_addr` is Chromium's own report of the peer it
//! connected to (`playwright-rs` `src/protocol/response.rs:202`, `RemoteAddr` at
//! `:40`), and it is the only place the real address exists.
//!
//! **Only the main document's own responses are recorded**, and the answer to
//! "is this the document, or one of its hundred subresources" has to be found on
//! the *request*, because `ResponseObject` names no frame at all — the whole of
//! its public surface is `status`, `url`, `body`, `server_addr`, `sizes`,
//! `headers` (`response.rs:114-281`). So the request is the entry point:
//! `Request::is_navigation_request` is `resourceType == "document"`
//! (`request.rs:283`), and a document request belonging to the main frame is one
//! whose `Frame::parent_frame` is `None` — the API says so in as many words
//! (*"or `None` if this is the top-level (main) frame"*, `frame.rs:186-187`). An
//! iframe's document passes the first test and fails the second; a stylesheet
//! fails the first.
//!
//! **The response is then asked of the request that wanted it.** `ResponseObject`
//! carries no back-pointer to its request — in 0.20.1 there is no `request()`
//! on it at all — so a response event can only be matched to a mark by address,
//! and matching on an address is a guess: the same address visited twice has two
//! requests, and a late answer to the first would answer for the second. The
//! pairing is instead made by the driver, for the one request that is being
//! waited on: `Request::response()` is an RPC whose reply is that request's own
//! response and is `None` when the request failed (`request.rs:137`, *"Sends a
//! `response` RPC call to the Playwright server"*, the reply carrying the
//! response guid the server resolved for this request). So each navigation opens
//! its own wait and files what that wait returns — no address is ever matched to
//! a response by guessing, and the mark it carries is what says a later visit to
//! the same address has taken the answer's place.
//!
//! **Keyed by the address without its fragment**, because `#` is never sent to a
//! server: two URLs differing only in `#` are one request, and answering under
//! the fragment the page happens to carry would be answering about an address no
//! response was ever filed under.
//!
//! A same-document URL change keeps the verified response that served it.
//! The browser's frame event moves that record within the document's origin.
//!
//! **The latest answer stands.** A redirect makes a response per hop and each hop
//! has its own URL, so the answer for the address now showing is the last one for
//! *that* address — not the first, which is what the previous version took, and
//! which let a page through on a name whose own answer had already been seen to
//! be private.
//!
//! **Bounded by distinct navigations, and the page on screen is never evicted.**
//! A subresource flood cannot grow the store at all now that subresources are not
//! recorded; what is left is a page that navigates a lot, and the entry for the
//! address being read is the one that must survive it.

use std::collections::BTreeMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use playwright_rs::protocol::{page, BrowserContext, Request};
use playwright_rs::server::channel_owner::ChannelOwner;
use tokio::sync::Mutex;

use crate::guard::{decide, is_our_own, Refusal, Verdict};

/// How many answered addresses are kept, and how many navigations may be waiting
/// for theirs. Only whole-page navigations reach either, so these are both a long
/// walk through history and not a page's worth of assets.
const LANDING_RECORDS: usize = 64;

/// How long a read waits for the record of the address it is about to show. The
/// response carrying it is emitted before the page settles, so this is the gap
/// between two events rather than a timeout anyone waits on; a record that has
/// not arrived by then is not coming.
const SETTLE: Duration = Duration::from_secs(1);

/// How often to look for it while waiting.
const POLL: Duration = Duration::from_millis(20);

/// One answered address: the URL it answered for without its fragment, and the
/// address it answered from — `None` where the response named no peer.
type Answers = Vec<(String, Option<IpAddr>)>;

/// What one frame is showing: the address its answer is filed under, and the
/// navigation that brought it here.
#[derive(Clone, Default)]
struct Frame {
    /// The address the document's answer is filed under — the document's own
    /// address, which the page may rename for itself.
    filed: Option<String>,
    /// The navigation that brought the document on screen here.
    mark: u64,
    /// The newest navigation begun in this frame. A newer one means the
    /// document on screen is not the one the answer is for.
    latest: u64,
}

/// The answers, the navigations still waiting for theirs, and the one address a
/// read is asking about.
#[derive(Clone)]
struct Store {
    answers: Answers,
    /// The newest navigation begun for an address, and the number it was given.
    /// A response is filed only under the mark that asked for it: the same
    /// address visited twice has two marks, and an answer to the first visit
    /// arriving late is filed under neither, because the second visit's mark is
    /// the one standing there. A response for an address with no mark is not
    /// filed at all — it is a subresource's, or a page we never asked for.
    pending: BTreeMap<String, u64>,
    /// How many main-frame navigations the browser has begun. A read takes it
    /// before it judges an address and again after it takes text, because a page
    /// that goes somewhere and comes back — a reload, a form posted at itself —
    /// leaves the address it is on exactly as it was.
    navigations: u64,
    /// Set by a read before it waits, so a navigation arriving mid-wait cannot
    /// push out the record that read depends on.
    shown: Option<String>,
    /// What each frame is showing, so a page that renames its own document
    /// moves the answer with it.
    frames: BTreeMap<String, Frame>,
    settle: Duration,
}

impl Default for Store {
    fn default() -> Self {
        Self {
            answers: Answers::new(),
            pending: BTreeMap::new(),
            navigations: 0,
            shown: None,
            frames: BTreeMap::new(),
            settle: SETTLE,
        }
    }
}

#[derive(Clone, Default)]
pub struct Landings(Arc<Mutex<Store>>);

impl Landings {
    pub fn new() -> Self {
        Self::default()
    }

    /// What, if anything, we refuse about the page showing `url`.
    ///
    /// The same decision the route made — scheme, literal address, resolved name
    /// — because a landing is a request that has already been made, and the rules
    /// that stop one from being made are the rules that decide whether its answer
    /// may be read.
    ///
    /// Then the address the browser really reached, and **nothing is returned
    /// without one**. A page whose own response was never recorded, or whose peer
    /// Chromium would not name, is refused: an address we cannot see is an
    /// address we cannot rule out, and reading it is the hole this module exists
    /// to close. Failing towards a refusal costs a second and a re-read; failing
    /// open costs a page served from this computer's own network.
    pub async fn refused(&self, url: &str) -> Option<Refusal> {
        if let Verdict::Refused(refusal) = decide(url).await {
            return Some(refusal);
        }
        // Only a page we asked for can have an answer. Anything else has no
        // record by construction, and waiting a second for something that was
        // never coming would make every read of `about:blank` a second slow.
        let key = key_of(url)?;
        let settle = {
            let mut store = self.0.lock().await;
            store.shown = Some(key.clone());
            store.settle
        };
        let deadline = Instant::now() + settle;
        loop {
            // `Some(server)` is a record; `None` is not one yet. A record that
            // named no peer is refused as firmly as one that never arrived.
            let found = self.0.lock().await.answers.iter().find(|(seen, _)| seen == &key).map(|(_, server)| *server);
            if let Some(server) = found {
                return match server {
                    Some(server) => is_our_own(&server).then_some(Refusal::Address),
                    None => Some(Refusal::Unseen),
                };
            }
            if Instant::now() >= deadline {
                return Some(Refusal::Unseen);
            }
            tokio::time::sleep(POLL).await;
        }
    }

    /// How many main-frame navigations have been begun so far.
    ///
    /// A read takes this before it judges an address and again after it has
    /// taken the text, because comparing addresses alone cannot see a page that
    /// navigated and came back: a reload and a form posted at itself leave the
    /// address exactly as it was, and the text belongs to a document no check
    /// has been made on. A navigation anywhere in the browser moves it, so a
    /// second page loading is enough — the cost of that is a read that starts
    /// over, never one that returns text from a page it did not judge.
    pub async fn navigations(&self) -> u64 {
        self.0.lock().await.navigations
    }

    /// Remembers a navigation the browser is beginning as the main document,
    /// gives it its number, and drops any answer filed for that address.
    ///
    /// **And any answer already filed under that address is dropped.** The same
    /// URL is not the same place twice: a name that answered Chrome from the
    /// open internet a minute ago can answer it from this computer's own
    /// network now, and the first answer is no evidence about the second. So
    /// the moment a new navigation starts, the old one stops counting, and a
    /// read that arrives before the new response is filed finds nothing and is
    /// refused — which is the right way round. Keeping the old answer would be
    /// the fail-open, and it would look like a working guard.
    async fn mark(&self, request: &Request) -> Option<(u64, String)> {
        if !is_main_frame_navigation(request) {
            return None;
        }
        let frame = request.frame()?.guid().to_string();
        let mut store = self.0.lock().await;
        store.navigations += 1;
        let mark = store.navigations;
        store.frames.entry(frame.clone()).or_default().latest = mark;
        if let Some(key) = key_of(request.url()) {
            forget(&mut store, &key);
            // A navigation that never answers leaves a mark behind, so the map
            // is bounded too. Forgetting one costs a refused read, never a false
            // one: the response it was waiting for has nowhere to be filed.
            if store.pending.len() >= LANDING_RECORDS && !store.pending.contains_key(&key) {
                let oldest = store.pending.keys().next().cloned();
                if let Some(oldest) = oldest {
                    store.pending.remove(&oldest);
                }
            }
            store.pending.insert(key, mark);
        }
        Some((mark, frame))
    }

    /// Files the answer to one navigation, under the mark that asked for it.
    ///
    /// A mark that has been superseded — a later visit to the same address — is
    /// not this one, and its answer is dropped rather than filed: it belongs to
    /// a document that is no longer the one on screen, and the address is not
    /// what says so.
    async fn file(&self, mark: u64, frame: &str, response: &page::Response) {
        let Some(key) = key_of(response.url()) else {
            return;
        };
        let Ok(address) = response.server_addr().await else {
            return;
        };
        let peer = address.and_then(|remote| peer_of(&remote.ip_address));
        self.file_under(mark, frame, key, peer).await;
    }

    /// The one place an answer is filed: under the mark that asked for it, or
    /// not at all. The check is here rather than in `file` so it lands **after**
    /// the round trip for the peer address — a navigation that began while we
    /// were reading it has to be able to say no.
    async fn file_under(&self, mark: u64, frame: &str, key: String, peer: Option<IpAddr>) {
        let mut store = self.0.lock().await;
        if store.pending.get(&key) != Some(&mark) {
            return;
        }
        store.pending.remove(&key);
        note(&mut store, &key, peer);
        let state = store.frames.entry(frame.to_owned()).or_default();
        // Only the current document's answer may follow a same-document URL change.
        if state.latest == mark {
            state.filed = Some(key);
            state.mark = mark;
        }
    }

    /// A same-document URL change must keep its verified response rather than
    /// require a network response for a URL the page assigned to itself.
    async fn renamed(&self, frame: &str, url: &str) {
        let Some(key) = key_of(url) else {
            return;
        };
        let mut store = self.0.lock().await;
        let Some(state) = store.frames.get(frame) else {
            return;
        };
        // A newer navigation began in this frame: the document on screen is
        // not the one we have an answer for.
        if state.mark != state.latest {
            return;
        }
        let Some(filed) = state.filed.clone() else {
            return;
        };
        if filed == key {
            return;
        }
        if origin_of(&filed) != origin_of(&key) {
            return;
        }
        let Some(index) = store.answers.iter().position(|(seen, _)| *seen == filed) else {
            return;
        };
        let (_, peer) = store.answers.remove(index);
        note(&mut store, &key, peer);
        if let Some(state) = store.frames.get_mut(frame) {
            state.filed = Some(key);
        }
    }

    /// A record already holding these answers, so the check that reads it can be
    /// proved without a server that answers from a stranger's address.
    #[cfg(test)]
    pub async fn holding(records: Vec<(&str, &str)>) -> Self {
        let landings = Self::new();
        let mut store = landings.0.lock().await;
        for (url, address) in records {
            note(&mut store, &key_of(url).expect("a record is filed under a web address"), address.parse().ok());
        }
        drop(store);
        landings
    }

    /// How long a read waits. The tests are about what is refused, not about
    /// spending a second proving it.
    #[cfg(test)]
    pub async fn waiting(&self, settle: Duration) {
        self.0.lock().await.settle = settle;
    }

    /// Begins a main-frame navigation to `url`, as `mark` does for a real
    /// request, and answers with the number it was given. A `Request` cannot be
    /// built in a test, so what is testable is entered here: the answer a
    /// navigation drops, and the answer a later one supersedes.
    #[cfg(test)]
    pub async fn navigating(&self, frame: &str, url: &str) -> u64 {
        let mut store = self.0.lock().await;
        store.navigations += 1;
        let mark = store.navigations;
        let key = key_of(url).expect("a navigation is to a web address");
        forget(&mut store, &key);
        store.pending.insert(key, mark);
        store.frames.entry(frame.to_owned()).or_default().latest = mark;
        mark
    }

    /// Answers one navigation, as `file` does for a real response, and refuses
    /// the answer of anything else.
    #[cfg(test)]
    pub async fn answering(&self, mark: u64, frame: &str, url: &str, address: &str) {
        let key = key_of(url).expect("an answer is to a web address");
        self.file_under(mark, frame, key, address.parse().ok()).await;
    }
}

/// Drops any answer filed under `key`, because a new navigation to that address
/// has started and the old one is about something else.
fn forget(store: &mut Store, key: &str) {
    store.answers.retain(|(seen, _)| seen != key);
}

/// The peer a response named, as an address the rules can be applied to.
///
/// Chromium writes an IPv6 peer in an authority's brackets — measured on the
/// browser this runs on, `demo.playwright.dev` answers as
/// `[2606:50c0:8003::153]` — and an IPv4 one bare (`93.184.216.34`). Brackets are
/// not part of the address, so a string read as an address with them still in it
/// is not an address at all: every page on an IPv6-only host was filed as having
/// named no peer, and so was refused for ever as `Unseen`.
///
/// Only the brackets come off. A name that is not an address stays unreadable,
/// which is what this module refuses on — taking a guess at one would be the
/// fail-open the whole store exists to prevent.
fn peer_of(named: &str) -> Option<IpAddr> {
    let bare = named.strip_prefix('[').and_then(|rest| rest.strip_suffix(']')).unwrap_or(named);
    bare.trim().parse().ok()
}

/// Whether this request is the main document's and nothing else's: a document,
/// in the frame with no parent.
fn is_main_frame_navigation(request: &Request) -> bool {
    request.is_navigation_request() && request.frame().is_some_and(|frame| frame.parent_frame().is_none())
}

/// Files `key` under the address it was served from, the latest answer standing.
///
/// One record per address, so a repeated answer overwrites rather than growing
/// the store — which is what makes the store bound by *distinct* navigations
/// rather than by responses. At the bound it gives up the oldest entry that is
/// not the address a read is asking about.
fn note(store: &mut Store, key: &str, server: Option<IpAddr>) {
    match store.answers.iter_mut().find(|(seen, _)| seen == key) {
        Some(entry) => entry.1 = server,
        None => {
            if store.answers.len() >= LANDING_RECORDS {
                let shown = store.shown.as_deref();
                if let Some(index) = store.answers.iter().position(|(seen, _)| Some(seen.as_str()) != shown) {
                    store.answers.remove(index);
                }
            }
            store.answers.push((key.to_owned(), server));
        }
    }
}

/// The address an answer is filed under: http(s) only, fragment dropped, scheme
/// left exactly as it was written.
///
/// Public because a read has to compare addresses the way the records are keyed:
/// `#` is never sent to a server, so a page jumping to an anchor is the same
/// document and the same answer, and a read that called that a navigation would
/// refuse a page that never went anywhere.
///
/// `None` for anything else, because there is nothing to look up — a page we
/// never asked for, or a scheme we would have refused before making a request.
pub fn key_of(url: &str) -> Option<String> {
    let (scheme, rest) = url
        .strip_prefix("http://")
        .map(|rest| ("http://", rest))
        .or_else(|| url.strip_prefix("https://").map(|rest| ("https://", rest)))?;
    let without_fragment = rest.split('#').next().unwrap_or_default();
    // A host is the point of the address: `https://` and `https://#anchor` name
    // nothing, and nothing answered them.
    if without_fragment.split('/').next().unwrap_or_default().is_empty() {
        return None;
    }
    Some(format!("{scheme}{without_fragment}"))
}

/// A document may rename its URL within its origin; its verified response
/// cannot authorize a URL on another origin.
fn origin_of(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    let authority = rest.split(['/', '?']).next().unwrap_or_default();
    if authority.is_empty() {
        return None;
    }
    Some(format!("{scheme}://{authority}"))
}

/// Files the main document's own responses, so a read can ask where the page it
/// is about to show was actually served from. Installed beside the route and
/// before it: a response for a request that is then refused never arrives, which
/// is the right way round.
///
/// The wait is **on its own task**. A handler here is awaited inline by the
/// event dispatcher (`event_registry.rs:98-104`), and a wait that sits inside
/// one is a wait that other handlers and waiters are queued behind; the write
/// side of the connection is a lock held only for the send itself
/// (`connection.rs:464-474`), so the rest of the browser carries on regardless.
pub async fn watch(context: &BrowserContext, landings: &Landings) -> Result<(), playwright_rs::Error> {
    let marked = landings.clone();
    context
        .on_request(move |request| {
            let marked = marked.clone();
            async move {
                let Some((mark, frame)) = marked.mark(&request).await else {
                    return Ok(());
                };
                let filed = marked.clone();
                let waiting = request.clone();
                tokio::spawn(async move {
                    // The driver answers for this request alone, or says the
                    // request failed and there is nothing to file.
                    if let Ok(Some(response)) = waiting.response().await {
                        filed.file(mark, &frame, &response).await;
                    }
                });
                Ok(())
            }
        })
        .await?;

    let renamed = landings.clone();
    context
        .on_frame_navigated(move |frame| {
            let renamed = renamed.clone();
            async move {
                // Only the main document: an iframe that renames itself is not
                // the page a read is about.
                if frame.parent_frame().is_some() {
                    return Ok(());
                }
                renamed.renamed(&frame.guid().to_string(), &frame.url()).await;
                Ok(())
            }
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::{key_of, note, peer_of, Landings, Store, LANDING_RECORDS};
    use crate::guard::Refusal;
    use std::net::{IpAddr, Ipv6Addr};
    use std::time::Duration;

    /// A literal public address, so the lexical rules pass with no resolver and
    /// no network: whatever `refused` answers here came from the record.
    const PUBLIC: &str = "http://93.184.216.34/page";

    /// The frame the tests speak for. The browser names frames by their own
    /// guid.
    const FRAME: &str = "frame";

    /// Different request and displayed URLs exercise same-document navigation.
    const SERVED: &str = "https://example.com/s/ref=nb_sb_noss?field-keywords=computer";
    const SHOWN: &str = "https://example.com/s?k=computer";

    fn private() -> Option<IpAddr> {
        "192.168.1.20".parse().ok()
    }

    fn public() -> Option<IpAddr> {
        "93.184.216.34".parse().ok()
    }

    /// A read waits a second for a record that is never going to come; a test
    /// about the refusal itself does not need to.
    async fn quick(landings: &Landings) {
        landings.waiting(Duration::from_millis(1)).await;
    }

    /// The rebinding case, isolated. This address passes every check made before
    /// the request — it is a public address in a public scheme with nothing in it
    /// — and the browser's own connection to it landed on this computer's
    /// network. That is the whole of DNS rebinding as far as we can see it, and
    /// the record is the only place it is visible.
    #[tokio::test]
    async fn an_address_that_reached_our_own_network_is_refused_after_the_fact() {
        let landings = Landings::holding(vec![(PUBLIC, "192.168.1.20")]).await;
        quick(&landings).await;
        assert_eq!(landings.refused(PUBLIC).await, Some(Refusal::Address));
    }

    #[tokio::test]
    async fn a_page_served_from_a_public_address_is_not_refused() {
        let landings = Landings::holding(vec![(PUBLIC, "93.184.216.34")]).await;
        quick(&landings).await;
        assert_eq!(landings.refused(PUBLIC).await, None);
    }

    /// A page whose own response was never seen has nothing to judge it by, and
    /// reading it anyway is the fail-open this module used to have.
    #[tokio::test]
    async fn a_page_with_no_record_of_its_own_is_refused_rather_than_read() {
        let landings = Landings::new();
        quick(&landings).await;
        assert_eq!(landings.refused(PUBLIC).await, Some(Refusal::Unseen));
        // Another page's answer says nothing about this one.
        let mut store = landings.0.lock().await;
        note(&mut store, "http://198.51.100.7/other", private());
        drop(store);
        assert_eq!(landings.refused(PUBLIC).await, Some(Refusal::Unseen));
    }

    /// A response that named no peer is refused as firmly as one that never
    /// arrived: there is an address here we cannot read.
    #[tokio::test]
    async fn a_response_that_named_no_address_is_refused() {
        let landings = Landings::holding(vec![(PUBLIC, "")]).await;
        quick(&landings).await;
        assert_eq!(landings.refused(PUBLIC).await, Some(Refusal::Unseen));
    }

    /// The record belongs to the address it was filed under.
    #[tokio::test]
    async fn an_address_recorded_for_another_page_is_not_this_pages_to_answer_for() {
        let landings = Landings::holding(vec![("http://198.51.100.7/other", "127.0.0.1")]).await;
        quick(&landings).await;
        assert_eq!(landings.refused(PUBLIC).await, Some(Refusal::Unseen));
    }

    /// **The latest answer stands.** A redirect answers one address more than
    /// once, and the one the page is reading is the last of them. The previous
    /// version kept the first, so a name that first answered from this
    /// computer's network and then from the open one was read.
    #[tokio::test]
    async fn the_last_answer_for_an_address_is_the_one_that_stands() {
        for (first, second, expected) in [
            (private(), public(), None),
            (public(), private(), Some(Refusal::Address)),
        ] {
            let landings = Landings::new();
            let key = key_of(PUBLIC).expect("a key");
            let mut store = landings.0.lock().await;
            note(&mut store, &key, first);
            note(&mut store, &key, second);
            drop(store);
            quick(&landings).await;
            assert_eq!(landings.refused(PUBLIC).await, expected, "{first:?} then {second:?}");
        }
    }

    /// **A new navigation to an address drops the answer filed for it.** The
    /// same URL is not the same place twice: a name that answered from the open
    /// internet a minute ago can answer from this computer's network now, and
    /// the old answer is no evidence about the second visit. Keeping it would
    /// be a fail-open that looked exactly like a working guard — the page's own
    /// address was checked, just not this time round.
    #[tokio::test]
    async fn a_second_visit_to_the_same_address_does_not_borrow_the_first_answers() {
        let landings = Landings::holding(vec![(PUBLIC, "93.184.216.34")]).await;
        quick(&landings).await;
        assert_eq!(landings.refused(PUBLIC).await, None, "the first visit answers");

        // The name now answers from this computer's own network, and the
        // navigation starts before the response is filed.
        let second = landings.navigating(FRAME, PUBLIC).await;
        assert_eq!(
            landings.refused(PUBLIC).await,
            Some(Refusal::Unseen),
            "the first visit's answer stood in for the second"
        );

        // And the new answer is what counts once it arrives.
        landings.answering(second, FRAME, PUBLIC, "192.168.1.20").await;
        assert_eq!(landings.refused(PUBLIC).await, Some(Refusal::Address));
    }

    /// **A late answer to an earlier visit is not the answer to this one.** The
    /// address is the same both times, so nothing about the address says which
    /// document a response belongs to — the driver pairs each response with the
    /// one request that asked for it (`Request::response`, `request.rs:137`),
    /// and the mark it answers is the one standing under that address. Here the
    /// first visit's answer turns up after the second visit has begun: it is
    /// dropped, and the read is refused rather than answered by the wrong
    /// document.
    #[tokio::test]
    async fn a_late_answer_to_an_earlier_visit_cannot_answer_for_the_visit_on_screen() {
        let landings = Landings::new();
        quick(&landings).await;
        let first = landings.navigating(FRAME, PUBLIC).await;
        let second = landings.navigating(FRAME, PUBLIC).await;
        landings.answering(first, FRAME, PUBLIC, "93.184.216.34").await;
        assert_eq!(
            landings.refused(PUBLIC).await,
            Some(Refusal::Unseen),
            "the first visit's answer was filed for the second"
        );
        landings.answering(second, FRAME, PUBLIC, "93.184.216.34").await;
        assert_eq!(landings.refused(PUBLIC).await, None, "the second visit's own answer is the one that counts");
    }

    /// An answer to something we never asked for is a subresource's, or a page
    /// that was never opened. There is no mark for it, so there is nowhere it
    /// may be filed.
    #[tokio::test]
    async fn an_answer_to_something_we_never_asked_for_is_not_filed() {
        let landings = Landings::new();
        quick(&landings).await;
        landings.answering(1, FRAME, PUBLIC, "93.184.216.34").await;
        assert_eq!(landings.refused(PUBLIC).await, Some(Refusal::Unseen));
    }

    /// A verified response remains valid when its document changes the shown URL.
    #[tokio::test]
    async fn a_page_that_renamed_itself_is_answered_by_the_answer_that_served_it() {
        let landings = Landings::new();
        let mark = landings.navigating(FRAME, SERVED).await;
        landings.answering(mark, FRAME, SERVED, "93.184.216.34").await;
        landings.renamed(FRAME, SHOWN).await;
        quick(&landings).await;
        assert_eq!(landings.refused(SHOWN).await, None);
    }

    /// A different URL needs the browser's same-document report to inherit a response.
    #[tokio::test]
    async fn a_page_that_renamed_itself_without_the_browser_saying_so_is_still_refused() {
        let landings = Landings::new();
        let mark = landings.navigating(FRAME, SERVED).await;
        landings.answering(mark, FRAME, SERVED, "93.184.216.34").await;
        quick(&landings).await;
        assert_eq!(landings.refused(SHOWN).await, Some(Refusal::Unseen));
    }

    /// An origin change cannot inherit the document's verified response.
    #[tokio::test]
    async fn a_rename_to_another_origin_does_not_move_the_answer() {
        let landings = Landings::new();
        let mark = landings.navigating(FRAME, SERVED).await;
        landings.answering(mark, FRAME, SERVED, "93.184.216.34").await;
        landings.renamed(FRAME, "https://198.51.100.7/s?k=computer").await;
        quick(&landings).await;
        assert_eq!(landings.refused("https://198.51.100.7/s?k=computer").await, Some(Refusal::Unseen));
    }

    /// A frame event cannot rename another frame's document.
    #[tokio::test]
    async fn a_rename_in_another_frame_does_not_move_this_frames_answer() {
        let landings = Landings::new();
        let mark = landings.navigating(FRAME, SERVED).await;
        landings.answering(mark, FRAME, SERVED, "93.184.216.34").await;
        landings.renamed("another frame", SHOWN).await;
        quick(&landings).await;
        assert_eq!(landings.refused(SHOWN).await, Some(Refusal::Unseen));
    }

    /// Changing the displayed URL does not make a private or unknown peer readable.
    #[tokio::test]
    async fn a_document_served_from_our_own_network_is_refused_after_it_renamed_itself() {
        for address in ["192.168.1.20", ""] {
            let landings = Landings::new();
            let mark = landings.navigating(FRAME, SERVED).await;
            landings.answering(mark, FRAME, SERVED, address).await;
            landings.renamed(FRAME, SHOWN).await;
            quick(&landings).await;
            let expected = if address.is_empty() { Refusal::Unseen } else { Refusal::Address };
            assert_eq!(landings.refused(SHOWN).await, Some(expected), "{address:?}");
        }
    }

    /// A new document needs its own response even when its URL was seen before.
    #[tokio::test]
    async fn a_second_visit_to_the_renamed_address_does_not_borrow_the_answer() {
        let landings = Landings::new();
        let mark = landings.navigating(FRAME, SERVED).await;
        landings.answering(mark, FRAME, SERVED, "93.184.216.34").await;
        landings.renamed(FRAME, SHOWN).await;
        landings.navigating(FRAME, SHOWN).await;
        quick(&landings).await;
        assert_eq!(landings.refused(SHOWN).await, Some(Refusal::Unseen));
    }

    /// A pending new navigation cannot inherit the previous document's response.
    #[tokio::test]
    async fn a_rename_after_a_newer_navigation_does_not_move_the_answer() {
        let landings = Landings::new();
        let mark = landings.navigating(FRAME, SERVED).await;
        landings.answering(mark, FRAME, SERVED, "93.184.216.34").await;
        landings.navigating(FRAME, SHOWN).await;
        landings.renamed(FRAME, SHOWN).await;
        quick(&landings).await;
        assert_eq!(landings.refused(SHOWN).await, Some(Refusal::Unseen));
    }

    /// **A peer in brackets is the address inside them.** Chromium writes an
    /// IPv6 peer the way an authority writes one — `[2606:50c0:8003::153]`, and
    /// `[::1]:443` where the port came with it — and an IPv4 one bare. Read as
    /// an address with the brackets still in it, an IPv6 peer is not an address
    /// at all, so every page on an IPv6-only host was filed as naming no peer
    /// and refused for ever: the guard refusing a page it had in fact reached.
    ///
    /// The brackets come off and nothing else does — a name that is not an
    /// address stays unreadable, because unreadable is what this refuses on.
    #[test]
    fn a_peer_written_in_brackets_is_the_address_inside_them() {
        assert_eq!(peer_of("[2606:50c0:8003::153]"), "2606:50c0:8003::153".parse().ok());
        assert_eq!(peer_of("[::1]"), Some(IpAddr::V6(Ipv6Addr::LOCALHOST)), "a loopback peer is one of ours");
        assert_eq!(peer_of("93.184.216.34"), "93.184.216.34".parse().ok(), "an IPv4 peer is already bare");
        for unreadable in ["", "not an address", "[not an address]", "[2606:50c0:8003::153"] {
            assert_eq!(peer_of(unreadable), None, "{unreadable:?} must stay unreadable");
        }
    }

    /// Dropping one address's answer is not dropping the store.
    #[tokio::test]
    async fn a_new_navigation_drops_its_own_address_only() {
        let landings = Landings::holding(vec![(PUBLIC, "93.184.216.34"), ("http://198.51.100.7/other", "198.51.100.7")]).await;
        landings.navigating(FRAME, PUBLIC).await;
        quick(&landings).await;
        assert_eq!(landings.refused(PUBLIC).await, Some(Refusal::Unseen));
        assert_eq!(landings.refused("http://198.51.100.7/other").await, None);
    }

    /// The count a read watches: it only ever goes up, and it moves for every
    /// main-frame navigation whatever the address. A page that reloads itself is
    /// the case the address cannot see.
    #[tokio::test]
    async fn every_navigation_is_given_its_own_number() {
        let landings = Landings::new();
        assert_eq!(landings.navigations().await, 0);
        landings.navigating(FRAME, PUBLIC).await;
        landings.navigating(FRAME, PUBLIC).await;
        landings.navigating(FRAME, "http://198.51.100.7/other").await;
        assert_eq!(landings.navigations().await, 3, "a page that reloads itself must move the count");
    }

    /// One answer per address, however many arrive — which is what makes the
    /// store bound by *distinct* navigations rather than by responses.
    #[test]
    fn an_address_repeated_is_one_record_and_not_a_growing_one() {
        let mut store = Store::default();
        for _ in 0..500 {
            note(&mut store, PUBLIC, private());
        }
        assert_eq!(store.answers.len(), 1);
    }

    /// A flood of later navigations may not push out the address being read; the
    /// entry that goes is the oldest one that is not the page on screen.
    #[test]
    fn the_page_on_screen_is_the_last_record_a_flood_can_push_out() {
        let mut store = Store::default();
        let shown = "https://shown.example/page".to_owned();
        note(&mut store, &shown, public());
        store.shown = Some(shown.clone());
        for index in 0..LANDING_RECORDS + 40 {
            note(&mut store, &format!("https://page-{index}.example/"), private());
        }
        assert_eq!(store.answers.len(), LANDING_RECORDS, "the store is bounded");
        assert_eq!(
            store.answers.iter().find(|(seen, _)| *seen == shown).map(|(_, server)| *server),
            Some(public()),
            "the address being read was evicted by pages that came after it"
        );
    }

    /// `#` is never sent to a server, so the fragment is not part of what came
    /// back and must not be part of what is looked up.
    #[tokio::test]
    async fn a_fragment_is_not_part_of_the_answer_and_not_part_of_the_lookup() {
        assert_eq!(key_of("https://example.com/a/page#section"), Some("https://example.com/a/page".to_owned()));
        let landings = Landings::holding(vec![("https://example.com/a/page", "93.184.216.34")]).await;
        quick(&landings).await;
        assert_eq!(landings.refused("https://example.com/a/page#section").await, None);
    }

    #[test]
    fn only_a_web_address_has_a_record_to_look_up() {
        assert_eq!(key_of("about:blank"), None);
        assert_eq!(key_of("data:text/html,x"), None);
        assert_eq!(key_of("file:///etc/passwd"), None);
        assert_eq!(key_of("http://"), None);
        assert_eq!(key_of("https://"), None);
        assert_eq!(key_of("https://#anchor"), None);
        assert_eq!(key_of("HTTP://example.com/"), None, "a scheme we never open has no record");
        assert_eq!(key_of("https://example.com/"), Some("https://example.com/".to_owned()));
    }
}