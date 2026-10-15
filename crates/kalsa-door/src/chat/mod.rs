//! The phone's chat routes under `/kalsa/chat/`, the contract in
//! `docs/PHONE-CHAT-PROTOCOL.md`: a turn the app's window runs and streams
//! back, and the mail read and send the window answers. Served after the
//! credential and before the seat lease, so a phone's turn takes no seat (the
//! window's own completions need one), and before the disk tier, which claims
//! the whole `/kalsa/` prefix.

mod body;
mod hook;
mod mail;
mod turn;

pub use hook::{ChatEvent, Opened, PhoneChat};

use std::collections::HashSet;
use std::io::Read;
use std::net::TcpStream;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::cors;
use crate::devices::DeviceId;
use crate::proxy::{self, Shared};
use crate::request::UnsealedHead;

/// The largest body a chat route reads. A turn is a few messages; a larger
/// body is drained and refused.
const MAX_BODY: usize = 1024 * 1024;

/// How long a wait on the page looks for a stop or a cut before it looks again.
const SLICE: Duration = Duration::from_secs(1);

/// The app's hook and the door's one-turn-per-device rule.
pub(crate) struct Chat {
    hook: Arc<dyn PhoneChat>,
    /// The devices with a turn running. A second turn of one is refused busy.
    turns: Mutex<HashSet<DeviceId>>,
}

impl Chat {
    pub(crate) fn new(hook: Arc<dyn PhoneChat>) -> Self {
        Self {
            hook,
            turns: Mutex::new(HashSet::new()),
        }
    }

    /// The device's turn, or `None` while one of its turns still runs.
    fn take_turn(self: &Arc<Self>, device: DeviceId) -> Option<TurnGuard> {
        let mut turns = self.turns.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        turns.insert(device).then(|| TurnGuard {
            chat: Arc::clone(self),
            device,
        })
    }
}

/// Frees the device's turn however the turn ends, a panic included.
struct TurnGuard {
    chat: Arc<Chat>,
    device: DeviceId,
}

impl Drop for TurnGuard {
    fn drop(&mut self) {
        self.chat
            .turns
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&self.device);
    }
}

/// What the door hands a chat route it has authenticated.
pub(super) struct Request<'a> {
    pub(super) head: &'a UnsealedHead,
    pub(super) device: DeviceId,
    pub(super) shared: &'a Arc<Shared>,
}

/// The route's template, or `None` for a path that is not one of the three.
pub(crate) fn route_name(target: &[u8]) -> Option<&'static str> {
    match path_of(target) {
        b"/kalsa/chat/turn" => Some("/kalsa/chat/turn"),
        b"/kalsa/chat/mail/read" => Some("/kalsa/chat/mail/read"),
        b"/kalsa/chat/mail/send" => Some("/kalsa/chat/mail/send"),
        _ => None,
    }
}

pub(super) fn owns(target: &[u8]) -> bool {
    route_name(target).is_some()
}

fn path_of(target: &[u8]) -> &[u8] {
    target.split(|byte| *byte == b'?').next().unwrap_or(target)
}

pub(super) fn serve(mut client: TcpStream, request: Request<'_>, deadline: Instant) {
    let head = request.head;
    let origin = head.origin.as_deref();
    let body = read_body(&mut client, head.body_length, deadline);
    let Some(chat) = request.shared.chat.as_ref() else {
        answer(&mut client, "404 Not Found", origin, deadline, &json!({"error": "not_found"}));
        return;
    };
    let route = route_name(&head.target);
    if head.method.as_slice() != b"POST" || route.is_none() {
        answer(&mut client, "404 Not Found", origin, deadline, &json!({"error": "not_found"}));
        return;
    }
    let bad_request = "400 Bad Request";
    match route {
        // A refused turn is a stream's error, not a status: a non-2xx before
        // the stream tells the phone this computer has no chat routes at all.
        Some("/kalsa/chat/turn") => match body.as_deref().and_then(body::turn_request) {
            Some(turn) => turn::start(client, chat, request.shared, request.device, turn, origin, deadline),
            None => turn::refuse(&mut client, origin, deadline, "bad_request"),
        },
        Some("/kalsa/chat/mail/read") => match body.as_deref().and_then(body::read_id) {
            Some(id) => {
                let value = mail::read(chat, request.device, id, &request.shared.clocks);
                answer(&mut client, "200 OK", origin, deadline, &value);
            }
            None => answer(&mut client, bad_request, origin, deadline, &json!({"error": "bad_request"})),
        },
        _ => match body.as_deref().and_then(body::send_request) {
            Some((draft_id, edited)) => {
                let value = mail::send(chat, request.device, &draft_id, edited);
                answer(&mut client, "200 OK", origin, deadline, &value);
            }
            None => answer(&mut client, bad_request, origin, deadline, &json!({"error": "bad_request"})),
        },
    }
}

/// The request's body, read whole when it is within the cap. A larger one is
/// drained rather than read, so the answer is not lost to a reset, and comes
/// back as `None`.
fn read_body(client: &mut TcpStream, length: usize, deadline: Instant) -> Option<Vec<u8>> {
    if length > MAX_BODY {
        let _ = proxy::discard_request_body(client, length, deadline);
        return None;
    }
    let mut body = vec![0u8; length];
    proxy::set_read_deadline(client, deadline).ok()?;
    client.read_exact(&mut body).ok()?;
    Some(body)
}

/// A JSON answer in the door's own voice, naming the origin the browser asked from.
fn answer(client: &mut TcpStream, status: &str, origin: Option<&[u8]>, deadline: Instant, value: &Value) {
    let body = value.to_string();
    let head = format!(
        "HTTP/1.1 {status}\r\n{}Content-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n",
        cors::origin_headers(origin),
        body.len()
    );
    let _ = proxy::answer_to(client, head.as_bytes(), deadline);
    let _ = proxy::answer_to(client, body.as_bytes(), deadline);
}

/// Waits for the page's answer to a request it was handed: `accepted` within
/// `runner_wait` of the hand-over, and an answer within `answer_wait` of it.
/// Returns the event that answers it, or the code the phone is owed.
fn await_answer(
    events: &std::sync::mpsc::Receiver<ChatEvent>,
    clocks: &crate::clocks::Clocks,
    answer_kinds: &[&str],
) -> Result<ChatEvent, &'static str> {
    let runner_by = Instant::now() + clocks.chat_runner_wait;
    let answer_by = Instant::now() + clocks.chat_answer_wait;
    let mut accepted = false;
    loop {
        let now = Instant::now();
        if !accepted && now >= runner_by {
            return Err("no_runner");
        }
        if now >= answer_by {
            return Err("cancelled");
        }
        match events.recv_timeout(SLICE) {
            Ok(event) if event.name == "accepted" => accepted = true,
            Ok(event) if answer_kinds.contains(&event.name.as_str()) || event.name == "error" => {
                return Ok(event);
            }
            Ok(_) => {}
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Err("engine"),
        }
    }
}
