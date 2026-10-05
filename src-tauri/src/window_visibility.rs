//! The window's own word on being out of sight.
//!
//! A minimized WebView2 window keeps `document.hidden` false on Windows, so
//! the page's visibility API never sees an icon: the clocks that slow down
//! for a hidden window would keep running at full speed behind one. This
//! module is the missing signal — one small event, emitted only when the
//! window starts or stops being looked at, which is the one thing the page
//! cannot observe for itself.

use std::sync::atomic::{AtomicI8, Ordering};

use tauri::{Emitter, Window, WindowEvent, Wry};

/// The event the page listens for (`chat/src/lib/pageVisible.ts`). Its
/// payload is [`WindowShown`].
pub(crate) const SHOWN_EVENT: &str = "window-shown";

/// What the page is told: `hidden` true means nobody is looking at the
/// window — it is an icon, or it is not shown at all.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub(crate) struct WindowShown {
    pub(crate) hidden: bool,
}

/// Nothing has been told yet.
const UNTOLD: i8 = -1;

/// The last state the page was told, as [`UNTOLD`], 0 or 1. One atomic, not
/// a map keyed by label: this app has one window, and a second one is the day
/// the label joins it here.
static TOLD: AtomicI8 = AtomicI8::new(UNTOLD);

/// The window's state from its own answers. A query that fails answers
/// "looked at": a window this app cannot interrogate must not make the page
/// stop working.
fn out_of_sight(minimized: Option<bool>, visible: Option<bool>) -> bool {
    minimized.unwrap_or(false) || !visible.unwrap_or(true)
}

/// The state to announce, or `None` when the page already holds it. The very
/// first look counts as a change: the page never asks, so that look is its
/// only chance to learn a window that starts out of sight.
fn announcement(told: Option<bool>, hidden: bool) -> Option<bool> {
    if told == Some(hidden) {
        None
    } else {
        Some(hidden)
    }
}

fn told_state() -> Option<bool> {
    match TOLD.load(Ordering::SeqCst) {
        UNTOLD => None,
        1 => Some(true),
        _ => Some(false),
    }
}

/// The window's events, from the app's own handler. A minimize, a restore or
/// a show arrives as a resize, a move or a focus change — the three a window
/// reports when its state changes — and the frame's own answer decides, so a
/// drag that resizes a visible window announces nothing.
pub(crate) fn on_window_event(window: &Window<Wry>, event: &WindowEvent) {
    if window.label() != crate::MAIN_WINDOW_LABEL {
        return;
    }
    if !matches!(
        event,
        WindowEvent::Resized(_) | WindowEvent::Moved(_) | WindowEvent::Focused(_)
    ) {
        return;
    }
    let Some(hidden) = announcement(
        told_state(),
        out_of_sight(window.is_minimized().ok(), window.is_visible().ok()),
    ) else {
        return;
    };
    TOLD.store(if hidden { 1 } else { 0 }, Ordering::SeqCst);
    let _ = window.emit(SHOWN_EVENT, WindowShown { hidden });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_icon_or_an_unshown_window_is_out_of_sight() {
        assert!(!out_of_sight(Some(false), Some(true)), "plainly visible");
        assert!(out_of_sight(Some(true), Some(true)), "an icon");
        assert!(out_of_sight(Some(false), Some(false)), "not shown");
        // A query that failed must not hide the page from itself.
        assert!(!out_of_sight(None, None));
        assert!(!out_of_sight(None, Some(true)));
    }

    #[test]
    fn only_a_change_of_state_is_announced() {
        assert_eq!(announcement(None, false), Some(false), "the first look");
        assert_eq!(announcement(None, true), Some(true), "an icon at start");
        assert_eq!(announcement(Some(false), false), None);
        assert_eq!(announcement(Some(true), true), None);
        assert_eq!(announcement(Some(false), true), Some(true));
        assert_eq!(announcement(Some(true), false), Some(false));
    }

    /// The page reads `payload.hidden`; the wire name is the contract.
    #[test]
    fn the_payload_is_the_one_field_the_page_reads() {
        assert_eq!(
            serde_json::to_string(&WindowShown { hidden: true }).unwrap(),
            "{\"hidden\":true}"
        );
        assert_eq!(SHOWN_EVENT, "window-shown");
    }
}
