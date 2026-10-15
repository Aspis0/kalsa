//! The phone's chat, app side. The door hands a phone's turn or mail read to
//! the page as `phone-chat-request`; the page answers through
//! `brain_phone_chat_event`, and each event goes to the door's stream for its
//! request. A reply draft the page makes is kept here, and a phone's send goes
//! through the same path the panel's send button takes.

mod drafts;

use std::collections::HashMap;
use std::sync::{mpsc, Mutex, MutexGuard, OnceLock};
use std::time::Instant;

use kalsa_door::{ChatEvent, DeviceId, Opened, PhoneChat};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::mail::commands::send_confirmed;
use crate::mail::state::MailState;
use drafts::Drafts;

const REQUEST_EVENT: &str = "phone-chat-request";
const STOP_EVENT: &str = "phone-chat-stop";

/// The page's event names. Anything else is refused.
const EVENTS: &[&str] = &[
    "accepted", "reasoning", "delta", "tool_run", "cards", "draft", "read", "error", "done",
];

/// The events that end their request. The request is retired after one, so a
/// later event for it is dropped.
const ENDING: &[&str] = &["read", "error", "done"];

/// One event's data once serialized. A larger one ends its turn as an engine failure.
const MAX_EVENT_BYTES: usize = 1024 * 1024;

/// The request the page owns: the device it serves, and the inbox the door reads.
struct Live {
    device: DeviceId,
    inbox: mpsc::Sender<ChatEvent>,
}

/// The door's hook and the page's side of the phone's chat, in one place: the
/// live requests, and the drafts the page made for them.
#[derive(Default)]
pub(crate) struct Bridge {
    /// Set once the app exists. Until then no page can take a request.
    app: OnceLock<AppHandle>,
    live: Mutex<HashMap<String, Live>>,
    drafts: Mutex<Drafts>,
}

impl Bridge {
    pub(crate) fn attach(&self, app: AppHandle) {
        let _ = self.app.set(app);
    }

    /// One page event for one request. An unknown name is refused; an event
    /// for a request that is unknown or finished is dropped without a word.
    fn accept(&self, request: &str, name: &str, data: Value) -> Result<(), &'static str> {
        let name = EVENTS.iter().copied().find(|known| *known == name).ok_or("unknown_event")?;
        if !data.is_object() {
            return Err("bad_request");
        }
        let Some(device) = lock(&self.live).get(request).map(|live| live.device) else {
            return Ok(());
        };
        let data = if name == "draft" {
            self.keep_draft(device, &data)
        } else {
            Some(data)
        };
        match data {
            Some(data) if data.to_string().len() <= MAX_EVENT_BYTES => self.forward(request, name, data),
            _ => self.forward(request, "error", json!({"code": "engine"})),
        }
        Ok(())
    }

    /// Stores the page's draft under a fresh id and returns what the phone is
    /// shown. The recipient is shown, never kept: a send takes the stored mail.
    fn keep_draft(&self, device: DeviceId, data: &Value) -> Option<Value> {
        let reply_to_id = reply_id(data.get("reply_to_id")?)?;
        let text = |key: &str| data.get(key)?.as_str().map(str::to_string);
        let (to, to_name, subject, body) = (text("to")?, text("to_name")?, text("subject")?, text("body")?);
        let draft_id = random_hex()?;
        lock(&self.drafts).insert(
            draft_id.clone(),
            device,
            reply_to_id,
            subject.clone(),
            body.clone(),
            Instant::now(),
        );
        Some(json!({
            "draft_id": draft_id,
            "reply_to_id": reply_to_id.to_string(),
            "to": to,
            "to_name": to_name,
            "subject": subject,
            "body": body,
        }))
    }

    /// Passes an event to the door. An ending event, or one the door no longer
    /// reads, retires the request.
    fn forward(&self, request: &str, name: &str, data: Value) {
        let mut live = lock(&self.live);
        let delivered = live
            .get(request)
            .is_some_and(|entry| entry.inbox.send(ChatEvent { name: name.to_string(), data }).is_ok());
        if !delivered || ENDING.contains(&name) {
            live.remove(request);
        }
    }

    fn send_draft(&self, device: DeviceId, draft_id: &str, edited: Option<String>) -> Result<String, String> {
        let app = self.app.get().ok_or("mail.failed")?;
        let ticket = lock(&self.drafts)
            .begin(device, draft_id, edited, Instant::now())
            .map_err(str::to_string)?;
        let state = app.state::<MailState>();
        let sent = tauri::async_runtime::block_on(send_confirmed(
            app,
            &state,
            ticket.reply_to_id,
            ticket.subject,
            ticket.body,
        ));
        lock(&self.drafts).finish(draft_id, sent.is_ok());
        match sent {
            Ok(sent_to) => Ok(sent_to),
            Err(error) => {
                log::warn!("a phone's mail send was refused: {}", error.code());
                Err(error.code().to_string())
            }
        }
    }
}

impl PhoneChat for Bridge {
    fn open(&self, device: DeviceId, kind: &'static str, body: Value) -> Option<Opened> {
        let app = self.app.get()?;
        let request = random_hex()?;
        let (inbox, events) = mpsc::channel();
        lock(&self.live).insert(request.clone(), Live { device, inbox });
        let mut payload = json!({"request": request});
        payload[kind] = body;
        payload["kind"] = json!(kind);
        if app.emit(REQUEST_EVENT, payload).is_err() {
            lock(&self.live).remove(&request);
            return None;
        }
        Some(Opened { request, events })
    }

    fn stop(&self, request: &str) {
        if lock(&self.live).remove(request).is_some() {
            if let Some(app) = self.app.get() {
                let _ = app.emit(STOP_EVENT, json!({"request": request}));
            }
        }
    }

    fn send(&self, device: DeviceId, draft_id: &str, body: Option<String>) -> Result<String, String> {
        self.send_draft(device, draft_id, body)
    }
}

/// The page's event, as the page sends it.
#[tauri::command]
pub(crate) fn brain_phone_chat_event(
    brain: State<'_, std::sync::Arc<crate::Brain>>,
    request: String,
    event: String,
    data: Value,
) -> Result<(), String> {
    brain
        .phone_chat
        .accept(&request, &event, data)
        .map_err(str::to_string)
}

/// A draft's reply id: the page sends it as digits, and a bare number is read too.
fn reply_id(value: &Value) -> Option<u32> {
    match value {
        Value::String(text) => text.parse().ok(),
        other => u32::try_from(other.as_u64()?).ok(),
    }
}

/// Sixteen random bytes as lowercase hex: a request id, or a draft id.
fn random_hex() -> Option<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    Some(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// A panic in one request's handling must not silence every other request.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A bridge with one live request of device 1, and the door's end of its events.
    fn bridge_with_request() -> (Bridge, mpsc::Receiver<ChatEvent>) {
        let bridge = Bridge::default();
        let (inbox, events) = mpsc::channel();
        lock(&bridge.live).insert("req".to_string(), Live { device: DeviceId::new(1), inbox });
        (bridge, events)
    }

    #[test]
    fn an_unknown_event_name_is_refused() {
        let (bridge, _events) = bridge_with_request();
        assert_eq!(bridge.accept("req", "shout", json!({})), Err("unknown_event"));
    }

    #[test]
    fn an_event_for_a_finished_request_is_dropped_without_a_word() {
        let bridge = Bridge::default();
        assert_eq!(bridge.accept("gone", "delta", json!({"text": "x"})), Ok(()));
    }

    #[test]
    fn a_draft_reaches_the_phone_under_an_id_and_the_store_keeps_the_mail_not_the_recipient() {
        let (bridge, events) = bridge_with_request();
        let data = json!({
            "reply_to_id": "105",
            "to": "segreteria@studio.example.it",
            "to_name": "Studio",
            "subject": "Re: Fattura",
            "body": "Va bene.",
        });
        bridge.accept("req", "draft", data).unwrap();
        let draft = events.try_recv().expect("the draft was forwarded");
        assert_eq!(draft.name, "draft");
        let id = draft.data["draft_id"].as_str().expect("the draft has an id");
        assert_eq!(id.len(), 32);
        assert_eq!(draft.data["reply_to_id"], "105");
        assert_eq!(draft.data["to"], "segreteria@studio.example.it");
        let ticket = lock(&bridge.drafts)
            .begin(DeviceId::new(1), id, None, Instant::now())
            .expect("the draft is stored under the id the phone holds");
        assert_eq!(ticket.reply_to_id, 105);
    }

    #[test]
    fn a_draft_without_its_reply_id_ends_the_turn_as_an_engine_failure() {
        let (bridge, events) = bridge_with_request();
        let data = json!({"to": "a@b.example", "to_name": "", "subject": "s", "body": "b"});
        bridge.accept("req", "draft", data).unwrap();
        let end = events.try_recv().expect("the turn was ended");
        assert_eq!((end.name.as_str(), end.data["code"].as_str()), ("error", Some("engine")));
        assert!(lock(&bridge.live).is_empty());
    }

    #[test]
    fn an_event_over_the_cap_ends_the_turn_as_an_engine_failure() {
        let (bridge, events) = bridge_with_request();
        let big = "x".repeat(MAX_EVENT_BYTES);
        bridge.accept("req", "delta", json!({"text": big})).unwrap();
        let end = events.try_recv().expect("the turn was ended");
        assert_eq!((end.name.as_str(), end.data["code"].as_str()), ("error", Some("engine")));
        assert!(lock(&bridge.live).is_empty());
    }
}
