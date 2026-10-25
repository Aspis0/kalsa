//! What the page is told about the browser window, and the one command it asks.
//!
//! **The page is not the source of truth for either half of this.** The slot
//! knows whether a session exists and holds the pause with it, so the app says
//! both: after every browser call, whenever a pause moves, when a session ends,
//! and once when a page mounts. A webview that reloaded mid-session has heard no
//! event at all, and the window it was driving is still there — the command is
//! what puts that back.
//!
//! **A pause cannot outlive its window**, and that is the slot's own doing rather
//! than this file's care: ending a session drops the pause inside the same lock,
//! because the sidecar holding it died with the window. A page left saying
//! "paused" over a browser that is gone would be a promise about nothing, and a
//! registry that trusted it would refuse every later call with no control left to
//! clear it.
//!
//! **Every snapshot carries a number**, raised under the slot's lock with the
//! change it describes. It is what makes order a fact rather than a hope: the
//! read a page does on its mount and the events it listens to can cross, and the
//! one with the smaller number is the older truth and is dropped. Without it, a
//! pre-open snapshot landing after an open would put a window back that is gone.

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::state::BrowserState;

/// The event, and the command's name: the page asks for the state and listens
/// for the state, and there is one shape for both.
pub(crate) const STATE: &str = "brain_browser_state";

/// What the page draws the window from, read out of the slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WindowState {
    /// Whether a session exists in any form. A running call and an ended one
    /// whose call has not returned are sessions too, so they are open.
    pub(crate) open: bool,
    /// Whether the person has paused it.
    pub(crate) paused: bool,
    /// How many times this has moved. **Read under the same lock as the two above
    /// it**, so a snapshot is one moment and not three.
    pub(crate) seq: u64,
}

/// What the window is, asked once by a page that has just mounted.
///
/// It cannot fail: there is nothing here to refuse, and a page that cannot ask
/// is left with what it already has — no window, which is the honest answer for
/// a browser that was never opened.
#[tauri::command]
pub(crate) fn brain_browser_state(state: State<'_, BrowserState>) -> WindowState {
    state.inner().window_state()
}

/// Publishes it. An event nobody is listening for is not a failure — the page
/// asks for the state on its mount, so a window that opened before any page was
/// there is still told once.
pub(crate) fn emit(app: &AppHandle, state: WindowState) {
    let _ = app.emit(STATE, state);
}

#[cfg(test)]
mod tests {
    use super::{WindowState, STATE};

    /// **What the page is sent is three words named as the page reads them**, and
    /// nothing that belongs to the host.
    #[test]
    fn the_state_is_three_words_named_as_the_page_reads_them() {
        let said = serde_json::to_string(&WindowState { open: true, paused: false, seq: 7 }).expect("plain data");
        assert_eq!(said, r#"{"open":true,"paused":false,"seq":7}"#);
    }

    /// A browser that was never opened is not a window, and a page that has
    /// asked nothing is still told that much: the shape has a bottom to it.
    #[test]
    fn a_browser_that_was_never_opened_is_no_window_and_no_pause() {
        let nothing = WindowState { open: false, paused: false, seq: 0 };
        assert_eq!(nothing.open, false);
        assert_eq!(nothing.paused, false);
    }

    /// The event is the browser's own, so an update or a mail event cannot move
    /// the window the page draws.
    #[test]
    fn the_state_event_is_the_browsers_own() {
        assert_eq!(STATE, "brain_browser_state");
        assert_ne!(STATE, "brain_browser_driver_progress");
        assert_ne!(STATE, "browser_cards");
    }
}