use std::sync::Arc;

use tauri::{AppHandle, Manager};

use tokio::sync::Mutex;

use super::error::BrowserError;
use super::fetch::Cancel;
use super::host::Browser;
use super::pending;
use super::window::{self, WindowState};

/// What the browser holds between calls.
///
/// One thing, and it is deliberately not a host held under a lock: the flag of
/// a download that is running. Mail's shape is right for a short mailbox call
/// and wrong here — a held request waits for a person for minutes, so anything
/// locked across `host.call().await` would lock out every other browser command
/// and would break the moment a window closes (docs/PLAN-BROWSER-2026-10-17.md:60).
/// The pending confirms are a store of their own and no lock crosses a call.
/// The one thing holding a clear, released when it is dropped — which a command
/// that is cancelled before its work finishes will do for us.
pub(crate) struct ClearGuard<'a> {
    browser: &'a Browser,
}

impl Drop for ClearGuard<'_> {
    fn drop(&mut self) {
        self.browser.end_clear();
    }
}

#[derive(Default)]
pub(crate) struct BrowserState {
    running: Mutex<Option<Arc<Cancel>>>,
    /// The requests the person is being asked about. Its own store, because a
    /// card waits for minutes and nothing may be locked across the call that
    /// asks the sidecar what is waiting.
    pending: pending::Pending,
    /// The sidecar and the session it holds. Its own lock is taken and given
    /// back around each call and is never held across one — see `host.rs`.
    browser: Browser,
}

impl BrowserState {
    /// The sidecar and the session it holds.
    pub(crate) fn browser(&self) -> &Browser {
        &self.browser
    }

    /// The requests the person is being asked about, and the only thing that
    /// knows how long they have been on the window.
    pub(crate) fn pending(&self) -> &pending::Pending {
        &self.pending
    }

    /// What the page draws the window from, **read out of the slot in one move** —
    /// so the state a page asks for and the events it listens to cannot disagree,
    /// and neither can be a page's own guess.
    pub(crate) fn window_state(&self) -> WindowState {
        self.browser.window_state()
    }

    /// **The person pressed Pausa**, which is recorded here whether or not the
    /// sidecar has taken it yet — a session running is a session to pause, so
    /// this is never refused as busy. The page is told at once: from this moment
    /// the app's own gate offers no browser tool, and a pause that waited for the
    /// slot would be a window in which Kalsa carried on driving.
    pub(crate) fn pause(&self, app: &AppHandle, paused: bool) -> bool {
        if self.browser.set_paused(paused) {
            window::emit(app, self.window_state());
            return true;
        }
        // Nothing moved: either there is no session, or it is already in the
        // state asked for, and the page needs to hear neither.
        self.browser.is_open()
    }

    /// The emptying of the profile, taken as one move with the check for it.
    /// The guard is what is given back — by being dropped, on every path: a
    /// command that is cancelled mid-clear would otherwise hold the slot and
    /// refuse every later browser for the life of the window.
    pub(crate) fn begin_clear(&self) -> Option<ClearGuard<'_>> {
        self.browser.begin_clear().then(|| ClearGuard { browser: &self.browser })
    }

    /// **One browser call, and the one place the slot is read afterwards.**
    ///
    /// Every caller goes through here — the chat's five tools, the pause and the
    /// resume, the confirm and the decline, and the refresh of what is waiting —
    /// because this is where the slot has settled and what it settled on is said
    /// to the page. A caller that called the host for itself would move the slot
    /// without saying anything, which is how a page ends up drawing a browser that
    /// was abandoned under it.
    ///
    /// **A browser that is gone takes the cards it was holding with it.** Whether
    /// it went because the host could not answer or because the person closed the
    /// window, every request it was holding is declined and said: the sidecar
    /// holding them died, so nobody is left to answer, and a card left on the
    /// window outlives the thing it was about.
    pub(crate) async fn call(
        &self,
        app: &AppHandle,
        tool: &str,
        args: serde_json::Map<String, serde_json::Value>,
    ) -> Result<String, BrowserError> {
        let app_data = app.path().app_data_dir().map_err(|_| BrowserError::Storage)?;
        let said = self.browser.call(&app_data, tool, args).await;
        if !self.browser.is_open() {
            super::confirm::declined_by_the_window_going(app, self);
        }
        window::emit(app, self.window_state());
        said
    }

    /// Ends the session, for the window closing and the app quitting — and says
    /// so when there was one to end, so a page that was drawing a browser is not
    /// left drawing it after the person closed the window. Sync, so a window
    /// event can end it without waiting on the runtime.
    ///
    /// **The cards go with the session**, on the same path as a call that found
    /// the browser gone: this is the same moment seen from the other side.
    pub(crate) fn end(&self, app: &AppHandle) {
        let had = self.browser.is_open() || self.browser.paused();
        self.browser.end();
        super::confirm::declined_by_the_window_going(app, self);
        if had {
            window::emit(app, self.window_state());
        }
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