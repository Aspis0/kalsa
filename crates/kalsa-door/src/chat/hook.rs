//! The app's side of the phone's chat: the door asks, and the app's window
//! answers. Installed with [`crate::Door::with_phone_chat`]; a door without
//! one answers every `/kalsa/chat/` route with 404, so a phone falls back.

use std::sync::mpsc::Receiver;

use serde_json::Value;

use crate::devices::DeviceId;

/// What the door needs from the app. Each method is called from a door
/// thread, never from inside the door's lock, so an implementation may block
/// on its own window.
pub trait PhoneChat: Send + Sync {
    /// Hands a request of `kind` (`"turn"` or `"read"`) and its `body` to the
    /// page. `None` when no page can take it now.
    fn open(&self, device: DeviceId, kind: &'static str, body: Value) -> Option<Opened>;

    /// The page's request is no longer wanted: the phone went away or the
    /// turn must stop.
    fn stop(&self, request: &str);

    /// Sends the draft `draft_id` of `device`: its recipient on success, or
    /// the refusal's code.
    fn send(&self, device: DeviceId, draft_id: &str, body: Option<String>) -> Result<String, String>;

    /// Whether `device` may reach this computer's mail. Asked once per mail
    /// route request, so the owner's switch takes effect on the next one
    /// rather than at the next reconcile.
    ///
    /// No default: a hook that does not answer has not said yes, and a door
    /// that answered for it would send every phone that can authenticate
    /// through to the owner's mailbox. A turn is never asked.
    fn mail_allowed(&self, device: DeviceId) -> bool;

    /// Answers one of `device`'s own browser cards: `allow` is the person
    /// pressing "send" or "no". The outcome the desktop keeps is what comes
    /// back — a code and a host — and nothing else.
    ///
    /// **Asked on a lane of its own**, because a card is answered *while the
    /// turn that raised it is still running*: the answer is what the turn is
    /// waiting on. Refusing it as busy would make every write unanswerable.
    ///
    /// No default: a hook that does not answer has not said yes, and a card is
    /// never silently declined by a door that could not reach the app.
    fn answer_browser(&self, device: DeviceId, card_id: &str, allow: bool) -> Result<Value, String>;
}

/// A request the page took: its id, and the page's events for it, in order.
pub struct Opened {
    pub request: String,
    pub events: Receiver<ChatEvent>,
}

/// One event the page sent for a request.
pub struct ChatEvent {
    pub name: String,
    pub data: Value,
}
