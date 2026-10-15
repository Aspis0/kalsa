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
