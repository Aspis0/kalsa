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
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::clocks::Clocks;
use crate::cors;
use crate::devices::DeviceId;
use crate::proxy::{self, Shared};
use crate::request::UnsealedHead;

/// The largest body a chat route reads. A turn is a few messages; a larger
/// body is drained and refused.
const MAX_BODY: usize = 1024 * 1024;

/// Chat requests reading a body or starting a route at once. Past this a
/// request is answered busy, so a body that trickles in holds a thread, not
/// an unbounded number of them.
const MAX_PENDING: usize = 8;

/// How long a wait on the page looks for a stop or a cut before it looks again.
const SLICE: Duration = Duration::from_secs(1);

/// What one device may have running at once in each lane: a turn, and a mail
/// read or send. The lanes are apart, so a read never refuses a turn.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum Lane {
    Turn,
    Mail,
}

/// The app's hook, the door's one-request-per-lane rule and the admission cap.
pub(crate) struct Chat {
    hook: Arc<dyn PhoneChat>,
    running: Mutex<HashSet<(Lane, DeviceId)>>,
    pending: AtomicUsize,
}

impl Chat {
    pub(crate) fn new(hook: Arc<dyn PhoneChat>) -> Self {
        Self {
            hook,
            running: Mutex::new(HashSet::new()),
            pending: AtomicUsize::new(0),
        }
    }

    /// The device's place in `lane`, or `None` while its request there still runs.
    fn take(self: &Arc<Self>, lane: Lane, device: DeviceId) -> Option<LaneGuard> {
        let mut running = self
            .running
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        running.insert((lane, device)).then(|| LaneGuard {
            chat: Arc::clone(self),
            lane,
            device,
        })
    }

    /// A place among the requests being read, or `None` at the cap.
    fn admit(self: &Arc<Self>) -> Option<Admission> {
        if self.pending.fetch_add(1, Ordering::SeqCst) >= MAX_PENDING {
            self.pending.fetch_sub(1, Ordering::SeqCst);
            return None;
        }
        Some(Admission {
            chat: Arc::clone(self),
        })
    }
}

/// Frees the device's place in its lane however the request ends, a panic included.
struct LaneGuard {
    chat: Arc<Chat>,
    lane: Lane,
    device: DeviceId,
}

impl Drop for LaneGuard {
    fn drop(&mut self) {
        self.chat
            .running
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&(self.lane, self.device));
    }
}

struct Admission {
    chat: Arc<Chat>,
}

impl Drop for Admission {
    fn drop(&mut self) {
        self.chat.pending.fetch_sub(1, Ordering::SeqCst);
    }
}

/// The door is stopping or the device was forgotten: the request must end.
pub(super) fn withdrawn(shared: &Shared, device: DeviceId) -> bool {
    shared.stop.load(Ordering::SeqCst) || !shared.set.holds(device)
}

/// What the door hands a chat route it has authenticated.
pub(super) struct Request<'a> {
    pub(super) head: &'a UnsealedHead,
    pub(super) device: DeviceId,
    pub(super) shared: &'a Arc<Shared>,
}

/// What a route needs once its head is read, owned so it can run on a thread
/// of its own while the body arrives.
struct Job {
    method: Vec<u8>,
    target: Vec<u8>,
    origin: Option<Vec<u8>>,
    body_length: usize,
    device: DeviceId,
    shared: Arc<Shared>,
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

/// The route runs on a thread of its own: the body may trickle in for as long
/// as the connection lives, and no worker waits on it.
pub(super) fn serve(client: TcpStream, request: Request<'_>, deadline: Instant) {
    let head = request.head;
    let origin = head.origin.clone();
    let admission = match request.shared.chat.as_ref() {
        Some(chat) => match chat.admit() {
            Some(admission) => Some(admission),
            None => {
                let mut client = client;
                let busy = crate::busy_response(origin.as_deref());
                let _ = proxy::answer_to(&mut client, &busy, deadline);
                return;
            }
        },
        None => None,
    };
    let job = Job {
        method: head.method.clone(),
        target: head.target.clone(),
        origin,
        body_length: head.body_length,
        device: request.device,
        shared: Arc::clone(request.shared),
    };
    let _ = thread::Builder::new()
        .name("kalsa-door-chat-request".into())
        .spawn(move || {
            let _admission = admission;
            run(client, job, deadline);
        });
}

fn run(mut client: TcpStream, job: Job, deadline: Instant) {
    let origin = job.origin.as_deref();
    let body = read_body(&mut client, job.body_length, deadline);
    let Some(chat) = job.shared.chat.clone() else {
        answer(&mut client, "404 Not Found", origin, deadline, &json!({"error": "not_found"}));
        return;
    };
    let route = route_name(&job.target);
    if job.method.as_slice() != b"POST" || route.is_none() {
        answer(&mut client, "404 Not Found", origin, deadline, &json!({"error": "not_found"}));
        return;
    }
    let shared = &job.shared;
    let device = job.device;
    let bad_request = "400 Bad Request";
    match route {
        // A refused turn is a stream's error, not a status: a non-2xx before
        // the stream tells the phone this computer has no chat routes at all.
        Some("/kalsa/chat/turn") => match body.as_deref().and_then(body::turn_request) {
            Some(turn) => turn::start(client, &chat, shared, device, turn, origin, deadline),
            None => turn::refuse(&mut client, origin, deadline, "bad_request"),
        },
        Some("/kalsa/chat/mail/read") => match body.as_deref().and_then(body::read_id) {
            Some(id) => mail::start(
                client,
                &chat,
                shared,
                device,
                mail::Call::Read(id),
                origin,
                deadline,
            ),
            None => answer(&mut client, bad_request, origin, deadline, &json!({"error": "bad_request"})),
        },
        _ => match body.as_deref().and_then(body::send_request) {
            Some((draft_id, edited)) => mail::start(
                client,
                &chat,
                shared,
                device,
                mail::Call::Send { draft_id, edited },
                origin,
                deadline,
            ),
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
/// Returns the event that answers it, or the code the phone is owed. `cut` is
/// asked between slices and ends the wait as `cancelled`.
fn await_answer(
    events: &Receiver<ChatEvent>,
    clocks: &Clocks,
    answer_kinds: &[&str],
    cut: &dyn Fn() -> bool,
) -> Result<ChatEvent, &'static str> {
    let runner_by = Instant::now() + clocks.chat_runner_wait;
    let answer_by = Instant::now() + clocks.chat_answer_wait;
    let mut accepted = false;
    loop {
        let now = Instant::now();
        if cut() {
            return Err("cancelled");
        }
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
