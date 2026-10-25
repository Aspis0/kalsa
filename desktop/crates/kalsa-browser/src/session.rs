//! The one browser this process drives (one responsibility: start it once, hand
//! out the page, keep one call at a time on it, and turn a dead window or a dead
//! driver into one plain line).
//!
//! One page is driven by one call. A second call while one is running gets
//! "the browser is busy", never a second browser, and a closed window ends the
//! session outright rather than leaving a half-dead one behind.

use playwright_rs::protocol::{BrowserContext, Page, Playwright};
use std::sync::Arc;
use tokio::sync::{Mutex, MutexGuard};

use crate::hold::Holds;
use crate::landing::Landings;
use crate::launch::{self, Unavailable};
use crate::refs;

/// What a failed call means, in the words a person reading the chat sees.
#[derive(PartialEq, Eq, Debug)]
pub enum Reason {
    /// The window is gone: the person closed it, or the browser ended.
    Closed,
    /// The driver process is gone, so nothing can be asked any more.
    DriverGone,
}

impl Reason {
    pub fn reason(&self) -> &'static str {
        match self {
            Reason::Closed => "the browser window is closed, so the page is not there: open it again to carry on",
            Reason::DriverGone => "the browser driver stopped, so the page cannot be read: start the browser again",
        }
    }
}

/// Upstream reports a closed target and a dead driver as prose in one string,
/// and the `Error` enum itself has no variant for either. The marks are the
/// driver's own wording; anything unrecognised stays unrecognised and becomes
/// the plain refusal the caller already had.
fn classify(text: &str) -> Option<Reason> {
    let lowered = text.to_lowercase();
    // Only the driver saying the thing is gone counts. `ERR_ABORTED` is what a
    // navigation that was cancelled looks like — the page went somewhere else,
    // the person pressed stop, the network answered with something else — and
    // the window is still open and still usable after one. Treating an abort as
    // a dead window would throw away a working browser over one cancelled load.
    let closed = ["has been closed", "target closed", "browser has been closed"];
    if closed.iter().any(|mark| lowered.contains(mark)) {
        return Some(Reason::Closed);
    }
    let gone = ["broken pipe", "connection reset", "transport error", "failed to connect", "eof", "channel closed"];
    if gone.iter().any(|mark| lowered.contains(mark)) {
        return Some(Reason::DriverGone);
    }
    None
}

/// Which of the two this failure is, when it is either of them.
pub fn reason_of(error: &playwright_rs::Error) -> Option<Reason> {
    classify(&error.to_string())
}

/// **The window the model was given on a page.** The lines it carried and how
/// many the page has: a read that asks for it again is a read the model has
/// already made, and the refusal says which lines it already has.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Given {
    /// The first line of the window, counted from zero.
    pub(crate) first: usize,
    /// The line after the last one of the window: where the next one starts.
    pub(crate) after: usize,
    /// How many lines the page has.
    pub(crate) total: usize,
}

pub struct Sessions {
    profile: String,
    started: Mutex<Option<Started>>,
    printed: Mutex<refs::Refs>,
    busy: Mutex<()>,
    /// **The windows the model was given on the page it is on.** One cell, and
    /// it is what makes a second read of a window a refusal instead of the same
    /// text again: the owner's test of 21 October had a turn read one page
    /// eight times in a row, every read the same lines, the page never moving.
    ///
    /// The key is the page, the line and the part; the value is the lines the
    /// window carried. **A new page is a new set of windows**, and the old ones
    /// are dropped with it.
    last_read: Mutex<std::collections::HashMap<(u64, usize, Option<usize>), Given>>,
    /// **Pausa is about the window, so it lives on the window.** A person can
    /// press it before the browser has opened anything, and the page that opens
    /// afterwards has to find the window already paused. One cell, handed to
    /// every [`Holds`] this window ever makes, so the tools and the route cannot
    /// disagree about whether the person has it.
    paused: Arc<std::sync::atomic::AtomicBool>,
}

struct Started {
    /// Held so the driver process outlives the calls that need it: dropping the
    /// `Playwright` handle shuts the driver down.
    _playwright: Playwright,
    _context: BrowserContext,
    page: Page,
    /// Where this window has landed, judged before any of its text is read.
    landings: Landings,
    /// The writes waiting for a person. A window that goes takes them with it:
    /// a request with nobody left to answer it is not dispatched.
    holds: Holds,
}

/// The one call allowed on this session at a time. Dropping it lets the next in.
/// The guard is held for its name alone: nothing may take the lock while a call
/// is running, and the lock is released when this goes out of scope.
pub struct Busy<'a>(#[allow(dead_code)] MutexGuard<'a, ()>);

/// What a second call is told while one is running.
pub const BUSY: &str = "the browser is busy with another step: wait for it to finish";

#[cfg(test)]
impl Sessions {
    /// Headless fixtures need the same session state as the headed product window.
    pub(crate) fn with_window(
        playwright: Playwright,
        context: BrowserContext,
        page: Page,
        landings: Landings,
        holds: Holds,
    ) -> Sessions {
        Sessions {
            profile: String::new(),
            started: Mutex::new(Some(Started { _playwright: playwright, _context: context, page, landings, holds })),
            printed: Mutex::new(refs::Refs::default()),
            busy: Mutex::new(()),
            last_read: Mutex::new(std::collections::HashMap::new()),
            paused: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }
}

impl Sessions {
    pub fn new(profile: String) -> Sessions {
        Sessions {
            profile,
            started: Mutex::new(None),
            printed: Mutex::new(refs::Refs::default()),
            busy: Mutex::new(()),
            last_read: Mutex::new(std::collections::HashMap::new()),
            paused: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    /// **The window the model was given for this read**, if it was given one:
    /// the same page, the same line, the same part.
    ///
    /// **And a line at or past the end of the page is the last window however
    /// it is asked for.** The last window is remembered by its own start, and a
    /// read from beyond the end serves that same window — so asking for it by
    /// the end, or past it, is the same read, not a new one.
    pub(crate) async fn read_given(&self, document: u64, from: usize, part: Option<usize>) -> Option<Given> {
        let windows = self.last_read.lock().await;
        if let Some(given) = windows.get(&(document, from, part)) {
            return Some(*given);
        }
        windows
            .iter()
            .filter(|((page, _, asked_as), given)| {
                *page == document && *asked_as == part && given.after >= given.total && from >= given.total
            })
            .min_by_key(|(_, given)| given.first)
            .map(|(_, given)| *given)
    }

    /// **Remembers the window the model was given.** The next read of the same
    /// window of the same page is a refusal, and this is what makes it one.
    pub(crate) async fn remember_read(&self, document: u64, from: usize, part: Option<usize>, given: Given) {
        let mut windows = self.last_read.lock().await;
        windows.retain(|(page, _, _), _| *page == document);
        windows.insert((document, from, part), given);
    }

    /// Whether the person has this window. A window that has not started is
    /// still a window, and pressing Pausa on it is the press that counts.
    pub fn paused(&self) -> bool {
        self.paused.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// The same cell `holds()` binds every page's store to, so a press here is a
    /// press on the page that opens next.
    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, std::sync::atomic::Ordering::SeqCst);
    }

    /// The writes waiting for a person in this window.
    ///
    /// A window that has not started yet has nothing waiting, and an empty store
    /// is the honest answer to that: there is no request to confirm or decline.
    pub async fn holds(&self) -> Holds {
        self.started.lock().await.as_ref().map(|started| started.holds.clone()).unwrap_or_default()
    }

    /// Take the session for one call. A second call is refused rather than
    /// queued: two turns driving one window at once would interleave clicks on
    /// the same page, and neither would be the action the person saw.
    pub async fn begin(&self) -> Result<Busy<'_>, &'static str> {
        self.busy.try_lock().map(Busy).map_err(|_| BUSY)
    }

    /// The page, where it has landed, and what is waiting for a person,
    /// starting the browser the first time it is asked for. The lock is held
    /// only across the start: a tool call never waits behind another tool call.
    pub async fn page(&self) -> Result<(Page, Landings, Holds), Unavailable> {
        let mut guard = self.started.lock().await;
        if guard.is_none() {
            let (playwright, context, page, landings, holds) = launch::start(&self.profile, self.paused.clone()).await?;
            *guard = Some(Started {
                _playwright: playwright,
                _context: context,
                page: page.clone(),
                landings,
                holds,
            });
        }
        let started = guard.as_ref().expect("just started");
        Ok((started.page.clone(), started.landings.clone(), started.holds.clone()))
    }

    /// The page, where it has landed, and what is waiting for a person — **only
    /// if the browser has already been started**.
    ///
    /// **Nothing here starts anything.** A call that must not open a window on
    /// the person's desk asks for the page this way: there is one or there is
    /// not, and the answer is the difference between a refusal and a browser
    /// that appeared for a preview nobody asked to be opened.
    pub async fn page_if_started(&self) -> Option<(Page, Landings, Holds)> {
        let guard = self.started.lock().await;
        let started = guard.as_ref()?;
        Some((started.page.clone(), started.landings.clone(), started.holds.clone()))
    }

    /// Forget a window that has gone, so the next call opens a fresh one instead
    /// of asking a dead page.
    ///
    /// **Everything it was holding is declined first.** The window is the only
    /// thing the person could have answered on, so a request still waiting when
    /// it closes has nobody left to say yes, and a request nobody answered is
    /// never dispatched.
    pub async fn reset(&self) {
        let gone = self.started.lock().await.take().map(|started| started.holds);
        if let Some(holds) = gone {
            holds.decline_all(crate::hold::Outcome::Gone).await;
        }
        *self.printed.lock().await = refs::Refs::default();
    }

    /// Probe unclassified failures before discarding a usable window.
    pub async fn forget_if_gone(&self, error: &playwright_rs::Error, page: &Page) -> bool {
        let ended = if reason_of(error).is_some() { true } else { page.title().await.is_err() };
        if ended {
            self.reset().await;
        }
        ended
    }

    /// What the reads printed, which is the only thing a call may act on.
    pub async fn remember(&self, text: &str, document: u64) {
        self.printed.lock().await.remember(text, document);
    }

    /// The same, with the page's own document named by the tree the read was
    /// made of: the ref's own shape cannot say which document a ref is in.
    pub(crate) async fn remember_classified(        &self,
        text: &str,
        document: u64,
        main: &std::collections::HashSet<String>,
    ) {
        self.printed.lock().await.remember_classified(text, document, main);
    }

    /// Preserve the public sentence contract while MCP keeps the typed refusal.
    pub async fn ref_of(&self, reference: &str) -> Result<String, &'static str> {
        self.ref_kind_of(reference).await.map_err(|refused| refused.reason())
    }

    /// MCP needs the refusal kind without recovering it from prose.
    pub(crate) async fn ref_kind_of(&self, reference: &str) -> Result<String, refs::Refused> {
        let document = self.document().await;
        self.printed.lock().await.check(reference, document)
    }

    /// The document the window is on, as the number of main-frame navigations it
    /// has made, or `None` when there is no window to ask.
    ///
    /// **The driver numbers a document once**, so this says whether a ref still
    /// names the element it named.
    async fn document(&self) -> Option<u64> {
        let landings = self.started.lock().await.as_ref()?.landings.clone();
        Some(landings.navigations().await)
    }
}

/// The answer to a call that could not be completed. Fixed, because what reached
/// this far is a stranger's page and must not be echoed back with its own words.
const ANSWER_FAILED: &str = "the page did not answer that call; try again";

/// A driver failure in one plain line: a closed window and a dead driver say
/// which they are, and anything else says only that the page did not answer.
pub fn explain(error: &playwright_rs::Error) -> String {
    match classify(&error.to_string()) {
        Some(reason) => reason.reason().to_string(),
        None => ANSWER_FAILED.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{classify, Given, Reason, Sessions, BUSY};
    use crate::refs;

    #[test]
    fn a_closed_window_is_not_a_dead_driver() {
        assert_eq!(classify("Target page, context or browser has been closed"), Some(Reason::Closed));
        assert_eq!(classify("Target closed"), Some(Reason::Closed));
    }

    /// A refused request and a cancelled navigation both arrive as a net error,
    /// and neither is the window going. Reporting either as a closed window
    /// would send the person to open a browser that is already open.
    #[test]
    fn neither_a_refused_request_nor_a_cancelled_navigation_is_a_closed_window() {
        assert_eq!(classify("net::ERR_ABORTED at https://example.com/"), None);
        assert_eq!(classify("net::ERR_BLOCKED_BY_CLIENT at http://example.com/"), None);
        assert_eq!(classify("net::ERR_CONNECTION_RESET at https://example.com/"), None);
    }

    #[test]
    fn a_dead_driver_is_not_a_closed_window() {
        assert_eq!(classify("Transport error: broken pipe"), Some(Reason::DriverGone));
        assert_eq!(classify("connection reset by peer"), Some(Reason::DriverGone));
    }

    /// A page that is merely slow, or an element that is not there, must not be
    /// reported as a window that closed: the person would go and open a browser
    /// that is already open.
    #[test]
    fn an_ordinary_failure_is_not_mistaken_for_a_closed_window() {
        for text in ["Timeout 30000ms exceeded", "element is not attached to the DOM"] {
            assert_eq!(classify(text), None, "{text}");
        }
    }

    /// Two calls, one window: the second is told so rather than waiting behind
    /// the first and then acting on a page that has moved on.
    #[tokio::test]
    async fn a_second_call_while_one_is_running_is_told_the_browser_is_busy() {
        let sessions = Sessions::new("/tmp/a-profile-nobody-uses".to_string());
        let first = sessions.begin().await.expect("the first call takes the session");
        assert_eq!(sessions.begin().await.err(), Some(BUSY));
        drop(first);
        // It is the session, not the browser: once the call is over the next one
        // is served, and none of this needed a browser to be true.
        assert!(sessions.begin().await.is_ok());
    }

    #[test]
    fn both_reasons_are_one_line_and_never_name_a_path() {
        for reason in [Reason::Closed, Reason::DriverGone] {
            let line = reason.reason();
            assert!(line.chars().count() < 160, "{line}");
            assert!(!line.contains('/') && !line.contains('\\'), "{line}");
        }
        assert!(BUSY.contains("busy") && !BUSY.contains('/'));
    }

    /// A stranger's page must not reach the chat through an error message, so
    /// the only words out of a failure are our own.
    #[test]
    fn a_failure_is_never_answered_with_what_the_driver_said() {
        let error = playwright_rs::Error::ProtocolError(
            "net::ERR_NAME_NOT_RESOLVED at https://a-very-private-place.example/secret".to_string(),
        );
        assert_eq!(super::explain(&error), "the page did not answer that call; try again");
        let closed = playwright_rs::Error::ProtocolError("Target page, context or browser has been closed".to_string());
        assert_eq!(super::explain(&closed), Reason::Closed.reason());
    }

    /// **The three ways a ref can be refused are three different refusals, and
    /// the kind is what travels.**
    #[tokio::test]
    async fn a_ref_is_refused_by_the_kind_it_was_refused_for() {
        let sessions = Sessions::new("/tmp/a-profile-nobody-uses".to_string());
        assert_eq!(sessions.ref_kind_of("").await.err(), Some(refs::Refused::Nothing));
        assert_eq!(sessions.ref_kind_of("   ").await.err(), Some(refs::Refused::Nothing));
        assert_eq!(sessions.ref_kind_of("E12").await.err(), Some(refs::Refused::NotARef));
        assert_eq!(sessions.ref_kind_of("e12 >> nth=0").await.err(), Some(refs::Refused::NotARef));
        assert_eq!(sessions.ref_kind_of("e12").await.err(), Some(refs::Refused::NotOnPage));
    }

    /// **The windows the model was given are remembered, and a new page forgets
    /// the old ones.** A read of a window the model already has is the loop the
    /// owner's turn made on 21 October; a read of a window it does not have is
    /// a new text, and is answered.
    #[tokio::test]
    async fn the_windows_the_model_was_given_are_remembered_and_a_new_page_forgets_them() {
        let sessions = Sessions::new("/tmp/a-profile-nobody-uses".to_string());
        let given = Given { first: 0, after: 200, total: 1340 };
        assert!(sessions.read_given(1, 0, None).await.is_none(), "nothing was given yet");
        sessions.remember_read(1, 0, None, given).await;
        assert_eq!(sessions.read_given(1, 0, None).await, Some(given), "the same window is found again");
        assert!(sessions.read_given(1, 200, None).await.is_none(), "another window is not it");
        assert!(sessions.read_given(2, 0, None).await.is_none(), "another page is not it");
        sessions.remember_read(2, 0, None, given).await;
        assert!(sessions.read_given(1, 0, None).await.is_none(), "and the new page forgets the old windows");
    }

    /// **The public wrapper still says the words the model reads**, and says the
    /// right one for each kind of refusal.
    #[tokio::test]
    async fn the_public_refusal_still_says_the_line_the_model_reads() {
        let sessions = Sessions::new("/tmp/a-profile-nobody-uses".to_string());
        assert_eq!(sessions.ref_of("").await.err(), Some(refs::Refused::Nothing.reason()));
        assert_eq!(sessions.ref_of("E12").await.err(), Some(refs::Refused::NotARef.reason()));
        assert_eq!(sessions.ref_of("e12").await.err(), Some(refs::Refused::NotOnPage.reason()));
    }
}
