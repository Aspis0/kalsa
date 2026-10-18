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
//! `headers` (`response.rs:114-281`). So the request comes first and is used as
//! a mark: `Request::is_navigation_request` is `resourceType == "document"`
//! (`request.rs:283`), and a document request belonging to the main frame is one
//! whose `Frame::parent_frame` is `None` — the API says so in as many words
//! (*"or `None` if this is the top-level (main) frame"*, `frame.rs:186-187`). An
//! iframe's document passes the first test and fails the second; a stylesheet
//! fails the first.
//!
//! **Keyed by the address without its fragment**, because `#` is never sent to a
//! server: two URLs differing only in `#` are one request, and answering under
//! the fragment the page happens to carry would be answering about an address no
//! response was ever filed under.
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

use std::collections::BTreeSet;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use playwright_rs::protocol::{BrowserContext, Request, ResponseObject};
use tokio::sync::Mutex;

use crate::guard::{decide, is_our_own, Refusal, Verdict};

/// How many answered addresses are kept, and how many unanswered navigations may
/// be waiting for theirs. Only whole-page navigations reach either, so these are
/// both a long walk through history and not a page's worth of assets.
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

/// The answers, the navigations still waiting for theirs, and the one address a
/// read is asking about.
#[derive(Clone)]
struct Store {
    answers: Answers,
    /// Addresses the browser asked for as main-frame navigations, and whose
    /// response has not been filed yet. A response not in here is a
    /// subresource's, and is not recorded.
    pending: BTreeSet<String>,
    /// Set by a read before it waits, so a navigation arriving mid-wait cannot
    /// push out the record that read depends on.
    shown: Option<String>,
    settle: Duration,
}

impl Default for Store {
    fn default() -> Self {
        Self { answers: Answers::new(), pending: BTreeSet::new(), shown: None, settle: SETTLE }
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

    /// Remembers an address the browser is fetching as the main document. Its
    /// response is filed; every other response in the world is not.
    async fn mark(&self, request: &Request) {
        if !is_main_frame_navigation(request) {
            return;
        }
        let Some(key) = key_of(request.url()) else {
            return;
        };
        let mut store = self.0.lock().await;
        // A navigation that never answers leaves a mark behind, so the set is
        // bounded too. Forgetting one costs a refused read, never a false one.
        if store.pending.len() >= LANDING_RECORDS {
            let oldest = store.pending.iter().next().cloned();
            if let Some(oldest) = oldest {
                store.pending.remove(&oldest);
            }
        }
        store.pending.insert(key);
    }

    /// Files a response under its own address, if it is the main document's.
    async fn record(&self, response: &ResponseObject) {
        let Some(key) = key_of(response.url()) else {
            return;
        };
        if !self.0.lock().await.pending.remove(&key) {
            return;
        }
        let Ok(address) = response.server_addr().await else {
            return;
        };
        let mut store = self.0.lock().await;
        note(&mut store, &key, address.and_then(|address| address.ip_address.parse().ok()));
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
/// `None` for anything else, because there is nothing to look up — a page we
/// never asked for, or a scheme we would have refused before making a request.
fn key_of(url: &str) -> Option<String> {
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

/// Files the main document's own responses, so a read can ask where the page it
/// is about to show was actually served from. Installed beside the route and
/// before it: a response for a request that is then refused never arrives, which
/// is the right way round.
pub async fn watch(context: &BrowserContext, landings: &Landings) -> Result<(), playwright_rs::Error> {
    let marked = landings.clone();
    context
        .on_request(move |request| {
            let marked = marked.clone();
            async move {
                marked.mark(&request).await;
                Ok(())
            }
        })
        .await?;
    let recorded = landings.clone();
    context
        .on_response(move |response| {
            let recorded = recorded.clone();
            async move {
                recorded.record(&response).await;
                Ok(())
            }
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::{key_of, note, Landings, Store, LANDING_RECORDS};
    use crate::guard::Refusal;
    use std::net::IpAddr;
    use std::time::Duration;

    /// A literal public address, so the lexical rules pass with no resolver and
    /// no network: whatever `refused` answers here came from the record.
    const PUBLIC: &str = "http://93.184.216.34/page";

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