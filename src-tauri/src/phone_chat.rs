//! The phone's chat, app side. The door hands a phone's turn or mail read to
//! the page as `phone-chat-request`; the page answers through
//! `brain_phone_chat_event`, and each event goes to the door's stream for its
//! request. A reply draft the page makes is kept here, and a phone's send goes
//! through the same path the panel's send button takes.

mod drafts;
mod events;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::{mpsc, Mutex, MutexGuard, OnceLock};
use std::time::Instant;

use kalsa_door::{ChatEvent, DeviceId, Opened, PhoneChat};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::mail::commands::send_confirmed;
use crate::mail::state::MailState;
use drafts::{Drafts, Owner, Ticket};

const REQUEST_EVENT: &str = "phone-chat-request";
const STOP_EVENT: &str = "phone-chat-stop";

/// The page's event names. Anything else is refused.
const EVENTS: &[&str] = &[
    "accepted",
    "reasoning",
    "delta",
    "tool_run",
    "cards",
    "draft",
    "read",
    "error",
    "done",
];

/// The events that end their request. The request is retired after one, so a
/// later event for it is dropped.
const ENDING: &[&str] = &["read", "error", "done"];

/// One event's data once serialized. A larger one ends its turn as an engine failure.
const MAX_EVENT_BYTES: usize = 1024 * 1024;

/// The request the page owns: the phone it serves and that phone's credential
/// digest, what kind of request it is, the mail a turn was pinned to, and the
/// inbox the door reads.
struct Live {
    owner: Owner,
    kind: &'static str,
    reply_for: Option<u32>,
    inbox: mpsc::Sender<ChatEvent>,
}

/// The door's hook and the page's side of the phone's chat, in one place: the
/// live requests, the paired phones, and the drafts the page made for them.
#[derive(Default)]
pub(crate) struct Bridge {
    /// Set once the app exists. Until then no page can take a request.
    app: OnceLock<AppHandle>,
    live: Mutex<HashMap<String, Live>>,
    paired: Mutex<Vec<Owner>>,
    drafts: Mutex<Drafts>,
}

impl Bridge {
    pub(crate) fn attach(&self, app: AppHandle) {
        let _ = self.app.set(app);
    }

    /// The paired phones, by id and credential. Called wherever the door is
    /// given a new set, before the door takes it: a draft whose phone is no
    /// longer paired under its credential is dropped first, so a reused id can
    /// never spend a forgotten phone's draft.
    pub(crate) fn pair(&self, phones: &[(DeviceId, String)]) {
        let owners: Vec<Owner> = phones
            .iter()
            .map(|(device, credential)| (*device, digest(credential)))
            .collect();
        lock(&self.drafts).keep_paired(&owners, Instant::now());
        *lock(&self.paired) = owners;
    }

    /// One page event for one request. A name the request's kind does not take,
    /// or a shape the phone would not be shown safely, is refused and forwards
    /// nothing; an event for a request that is unknown or finished is dropped
    /// without a word.
    fn accept(&self, request: &str, name: &str, data: Value) -> Result<(), &'static str> {
        let name = EVENTS
            .iter()
            .copied()
            .find(|known| *known == name)
            .ok_or("unknown_event")?;
        if !data.is_object() {
            return Err("bad_request");
        }
        let Some((owner, kind, pin)) = lock(&self.live)
            .get(request)
            .map(|live| (live.owner, live.kind, live.reply_for))
        else {
            return Ok(());
        };
        events::check(kind, pin, name, &data)?;
        if data.to_string().len() > MAX_EVENT_BYTES {
            self.forward(request, "error", json!({"code": "engine"}));
            return Ok(());
        }
        let data = if name == "draft" {
            self.keep_draft(owner, &data)
        } else {
            Some(data)
        };
        match data {
            Some(data) => self.forward(request, name, data),
            None => self.forward(request, "error", json!({"code": "engine"})),
        }
        Ok(())
    }

    /// Stores a draft the page made, already checked, under a fresh id, and
    /// returns what the phone is shown. The recipient is shown, never kept: a
    /// send takes the stored mail.
    fn keep_draft(&self, owner: Owner, data: &Value) -> Option<Value> {
        let reply_to_id = events::reply_id(data.get("reply_to_id"))?;
        let text = |key: &str| data.get(key)?.as_str().map(str::to_string);
        let (to, to_name, subject, body) = (
            text("to")?,
            text("to_name")?,
            text("subject")?,
            text("body")?,
        );
        let draft_id = random_hex()?;
        lock(&self.drafts).insert(
            draft_id.clone(),
            owner,
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
        let delivered = live.get(request).is_some_and(|entry| {
            entry
                .inbox
                .send(ChatEvent {
                    name: name.to_string(),
                    data,
                })
                .is_ok()
        });
        if !delivered || ENDING.contains(&name) {
            live.remove(request);
        }
    }

    fn paired_owner(&self, device: DeviceId) -> Option<Owner> {
        lock(&self.paired)
            .iter()
            .copied()
            .find(|(paired, _)| *paired == device)
    }

    fn send_draft(
        &self,
        device: DeviceId,
        draft_id: &str,
        edited: Option<String>,
    ) -> Result<String, String> {
        let app = self.app.get().ok_or("mail.failed")?;
        let state = app.state::<MailState>();
        self.send_draft_via(
            device,
            draft_id,
            edited,
            |owner| self.paired_owner(device) == Some(owner),
            |ticket| {
                let sent = tauri::async_runtime::block_on(send_confirmed(
                    app,
                    &state,
                    ticket.reply_to_id,
                    ticket.subject,
                    ticket.body,
                ));
                sent.map_err(|error| {
                    log::warn!("a phone's mail send was refused: {}", error.code());
                    error.code().to_string()
                })
            },
        )
    }

    /// The send with its pairing check and its mail supplied. The caller's owner
    /// comes from the paired set and the draft must be that owner's; the caller
    /// is checked again once the draft is taken, just before the mail goes.
    fn send_draft_via(
        &self,
        device: DeviceId,
        draft_id: &str,
        edited: Option<String>,
        still_paired: impl FnOnce(Owner) -> bool,
        mail: impl FnOnce(Ticket) -> Result<String, String>,
    ) -> Result<String, String> {
        let owner = self.paired_owner(device).ok_or("draft_unknown")?;
        let ticket = lock(&self.drafts)
            .begin(owner, draft_id, edited, Instant::now())
            .map_err(str::to_string)?;
        let mut outcome = SendOutcome {
            drafts: &self.drafts,
            draft_id,
            sent: false,
        };
        if !still_paired(owner) {
            return Err("draft_unknown".to_string());
        }
        let sent = mail(ticket)?;
        outcome.sent = true;
        Ok(sent)
    }
}

/// Ends a draft's send however the send ends. The send can unwind, and a draft
/// left in flight would refuse every later send of it. Spent only on success.
struct SendOutcome<'a> {
    drafts: &'a Mutex<Drafts>,
    draft_id: &'a str,
    sent: bool,
}

impl Drop for SendOutcome<'_> {
    fn drop(&mut self) {
        lock(self.drafts).finish(self.draft_id, self.sent, Instant::now());
    }
}

impl PhoneChat for Bridge {
    fn open(&self, device: DeviceId, kind: &'static str, body: Value) -> Option<Opened> {
        let app = self.app.get()?;
        let owner = self.paired_owner(device)?;
        let request = random_hex()?;
        let reply_for = body
            .get("reply_for")
            .and_then(Value::as_str)
            .and_then(|id| id.parse().ok());
        let (inbox, events) = mpsc::channel();
        lock(&self.live).insert(
            request.clone(),
            Live {
                owner,
                kind,
                reply_for,
                inbox,
            },
        );
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

    fn send(
        &self,
        device: DeviceId,
        draft_id: &str,
        body: Option<String>,
    ) -> Result<String, String> {
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

/// Sixteen random bytes as lowercase hex: a request id, or a draft id.
fn random_hex() -> Option<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    Some(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// The digest that stands for a credential in the drafts table. The credential
/// itself is never kept here.
fn digest(credential: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"kalsa-phone-identity-v1");
    hasher.update(credential.as_bytes());
    hasher.finalize().into()
}

/// A panic in one request's handling must not silence every other request.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
