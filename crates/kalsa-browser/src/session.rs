//! The one browser this process drives (one responsibility: start it once, hand
//! out the page, keep one call at a time on it, and turn a dead window or a dead
//! driver into one plain line).
//!
//! One page is driven by one call. A second call while one is running gets
//! "the browser is busy", never a second browser, and a closed window ends the
//! session outright rather than leaving a half-dead one behind.

use playwright_rs::protocol::{BrowserContext, Page, Playwright};
use tokio::sync::{Mutex, MutexGuard};

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

pub struct Sessions {
    profile: String,
    started: Mutex<Option<Started>>,
    printed: Mutex<refs::Refs>,
    busy: Mutex<()>,
}

struct Started {
    /// Held so the driver process outlives the calls that need it: dropping the
    /// `Playwright` handle shuts the driver down.
    _playwright: Playwright,
    _context: BrowserContext,
    page: Page,
}

/// The one call allowed on this session at a time. Dropping it lets the next in.
/// The guard is held for its name alone: nothing may take the lock while a call
/// is running, and the lock is released when this goes out of scope.
pub struct Busy<'a>(#[allow(dead_code)] MutexGuard<'a, ()>);

/// What a second call is told while one is running.
pub const BUSY: &str = "the browser is busy with another step: wait for it to finish";

impl Sessions {
    pub fn new(profile: String) -> Sessions {
        Sessions {
            profile,
            started: Mutex::new(None),
            printed: Mutex::new(refs::Refs::default()),
            busy: Mutex::new(()),
        }
    }

    /// Take the session for one call. A second call is refused rather than
    /// queued: two turns driving one window at once would interleave clicks on
    /// the same page, and neither would be the action the person saw.
    pub async fn begin(&self) -> Result<Busy<'_>, &'static str> {
        self.busy.try_lock().map(Busy).map_err(|_| BUSY)
    }

    /// The page, starting the browser the first time it is asked for. The lock
    /// is held only across the start: a tool call never waits behind another
    /// tool call.
    pub async fn page(&self) -> Result<Page, Unavailable> {
        let mut guard = self.started.lock().await;
        if guard.is_none() {
            let (playwright, context, page) = launch::start(&self.profile).await?;
            *guard = Some(Started { _playwright: playwright, _context: context, page: page.clone() });
        }
        Ok(guard.as_ref().expect("just started").page.clone())
    }

    /// Forget a window that has gone, so the next call opens a fresh one instead
    /// of asking a dead page.
    pub async fn reset(&self) {
        *self.started.lock().await = None;
        *self.printed.lock().await = refs::Refs::default();
    }

    /// Forget the session when this failure means there is nothing left to ask:
    /// a window that closed, or a driver that stopped.
    ///
    /// A load that was cancelled and a window that went in the middle of one look
    /// the same from here, and guessing would cost a working browser: an abort is
    /// usually a person pressing stop, and throwing the window away over that
    /// would be worse than useless. So an unclassified failure is not believed
    /// either way — the page is asked, once, and only a page that cannot answer
    /// is written off. That costs one round trip, and only when a call has
    /// already failed.
    ///
    /// The rule lives here rather than at the call site so that every caller
    /// forgets a dead session for the same reason, and so that this is testable
    /// without standing up an MCP server.
    pub async fn forget_if_gone(&self, error: &playwright_rs::Error, page: &Page) {
        if reason_of(error).is_some() {
            self.reset().await;
            return;
        }
        if page.title().await.is_err() {
            self.reset().await;
        }
    }

    /// What the last read printed, which is the only thing a call may act on.
    pub async fn remember(&self, text: &str) {
        self.printed.lock().await.remember(text);
    }

    /// The element to act on, or the line that says this page never printed it.
    /// The line is returned rather than the reason so that the ref rules stay
    /// inside this crate.
    pub async fn ref_of(&self, reference: &str) -> Result<String, &'static str> {
        self.printed.lock().await.check(reference).map_err(|refused| refused.reason())
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
    use super::{classify, Reason, Sessions, BUSY};

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
}