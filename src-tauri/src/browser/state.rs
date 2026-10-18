use std::sync::Arc;

use tokio::sync::Mutex;

use super::error::BrowserError;
use super::fetch::Cancel;
use super::host::Browser;

/// What the browser holds between calls.
///
/// One thing, and it is deliberately not a host held under a lock: the flag of
/// a download that is running. Mail's shape is right for a short mailbox call
/// and wrong here — a held request waits for a person for minutes, so anything
/// locked across `host.call().await` would lock out every other browser command
/// and would break the moment a window closes (docs/PLAN-BROWSER-2026-10-17.md:60).
/// The pending confirms are a store of their own and no lock crosses a call.
#[derive(Default)]
pub(crate) struct BrowserState {
    running: Mutex<Option<Arc<Cancel>>>,
    /// The sidecar and the session it holds. Its own lock is taken and given
    /// back around each call and is never held across one — see `host.rs`.
    browser: Browser,
}

impl BrowserState {
    /// The sidecar and the session it holds.
    pub(crate) fn browser(&self) -> &Browser {
        &self.browser
    }

    /// Ends the session, for the window closing and the app quitting. Sync, so
    /// a window event can end it without waiting on the runtime.
    pub(crate) fn end(&self) {
        self.browser.end();
    }

    /// Whether a browser is open, so clearing its data can refuse.
    pub(crate) fn session_open(&self) -> bool {
        self.browser.is_open()
    }

    /// Takes the one download slot and hands back the flag the transfer reads.
    /// A second press is refused rather than queued behind the first.
    pub(crate) async fn begin(&self) -> Result<Arc<Cancel>, BrowserError> {
        let mut slot = self.running.lock().await;
        if slot.is_some() {
            return Err(BrowserError::Busy);
        }
        let cancel = Arc::new(Cancel::new());
        *slot = Some(cancel.clone());
        Ok(cancel)
    }

    /// Gives the slot back. Called once the transfer has actually stopped, so a
    /// Cancel press is never answered by a second download that finds the first
    /// one still writing.
    pub(crate) async fn release(&self) {
        *self.running.lock().await = None;
    }

    /// The flag of the download that is running, if there is one. What Cancel
    /// presses, and what tells a clear it must not go ahead.
    pub(crate) async fn running(&self) -> Option<Arc<Cancel>> {
        self.running.lock().await.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn one_download_at_a_time_and_the_slot_comes_back() {
        let state = BrowserState::default();
        let first = state.begin().await.expect("the slot is free");
        assert_eq!(state.begin().await.err(), Some(BrowserError::Busy), "a second press was accepted");
        state.release().await;
        assert!(state.begin().await.is_ok(), "a refused download must not hold the slot");
        assert!(!first.stopped(), "giving the slot back is not a cancel");
    }

    /// The rule the whole module rests on: the slot is released on the way out
    /// of a scope, so nothing can be held while a call waits on a person.
    #[tokio::test]
    async fn the_slot_is_released_when_a_download_leaves_the_scope_early() {
        let state = BrowserState::default();
        let cancel = state.begin().await.expect("the slot is free");
        cancel.stop();
        state.release().await;
        assert!(state.running().await.is_none(), "the slot outlived the transfer");
        assert!(state.begin().await.is_ok());
    }

    /// Cancel reaches the transfer through the very flag the slot handed out, so
    /// there is no second flag that could disagree with the one being read.
    #[tokio::test]
    async fn a_cancel_presses_the_flag_the_transfer_is_read() {
        let state = BrowserState::default();
        assert!(state.running().await.is_none(), "nothing is running before a press");

        let cancel = state.begin().await.expect("the slot is free");
        let seen = state.running().await.expect("the running download");
        seen.stop();

        assert!(cancel.stopped(), "the transfer's own flag is the one that moved");
        assert!(state.running().await.expect("still running").stopped());
    }

    #[tokio::test]
    async fn two_downloads_racing_for_the_slot_produce_exactly_one_winner() {
        const RACERS: usize = 8;
        let state = Arc::new(BrowserState::default());
        let lined_up = std::sync::Barrier::new(RACERS);
        let winners: usize = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..RACERS)
                .map(|_| {
                    let state = Arc::clone(&state);
                    let lined_up = &lined_up;
                    scope.spawn(move || {
                        // A runtime per thread: the race is between eight real
                        // tasks, not between eight polls of one.
                        let taken = tokio::runtime::Builder::new_current_thread()
                            .build()
                            .expect("a runtime")
                            .block_on(async { state.begin().await.is_ok() });
                        // Nobody lets go before everyone has tried, so this is
                        // a real race rather than eight sequential presses.
                        lined_up.wait();
                        usize::from(taken)
                    })
                })
                .collect();
            handles.into_iter().map(|handle| handle.join().expect("thread")).sum()
        });
        assert_eq!(winners, 1, "two downloads took the slot at once");
    }
}