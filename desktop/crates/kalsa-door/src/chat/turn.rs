//! The turn route's stream: the app's window runs the turn, and its events
//! come back to the phone as SSE. The stream owns its socket on a thread of
//! its own — a turn can last as long as the connection lifetime, and a worker
//! is not spent on it.

use std::net::TcpStream;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::{withdrawn, Chat, Lane, SLICE};
use crate::audit;
use crate::cors;
use crate::devices::DeviceId;
use crate::proxy::{self, Shared};

/// Silence on the stream longer than this gets a `: ping`. The contract says
/// at least every 15 s; this is comfortably under that.
const PING: Duration = Duration::from_secs(10);

/// The events a turn passes on as they come. `accepted` is consumed for the
/// `turn` frame, and `error` or `done` ends the stream.
///
/// A card and its outcome ride it too, and so does the turn's own `recap` line:
/// all three are said inside the turn and read after it.
const STREAMED: &[&str] = &[
    "reasoning",
    "delta",
    "tool_run",
    "cards",
    "draft",
    "browser_card",
    "browser_outcome",
    "recap",
];

pub(super) fn start(
    mut client: TcpStream,
    chat: &Arc<Chat>,
    shared: &Arc<Shared>,
    device: DeviceId,
    turn: Value,
    origin: Option<&[u8]>,
    deadline: Instant,
) {
    let Some(guard) = chat.take(Lane::Turn, device) else {
        refuse(&mut client, origin, deadline, "busy");
        return;
    };
    crate::audit::status(200);
    crate::audit::streamed();
    let chat = Arc::clone(chat);
    let shared = Arc::clone(shared);
    let origin = origin.map(<[u8]>::to_vec);
    // No thread: the closure is dropped with the socket, and the phone sees the
    // close before any byte, the same as a stream that could not start.
    let _ = thread::Builder::new()
        .name("kalsa-door-chat-turn".into())
        .spawn(move || {
            let _turn = guard;
            let wire = Wire {
                client,
                deadline,
                last_write: Instant::now(),
                frames: 0,
            };
            follow(wire, &chat, &shared, device, turn, origin.as_deref());
        });
}

/// The stream's socket, the clock that paces its pings, and how many answer
/// frames this phone actually holds — counted only once the socket has taken
/// them, so the count is what the phone could have read.
struct Wire {
    client: TcpStream,
    deadline: Instant,
    last_write: Instant,
    frames: u64,
}

impl Wire {
    fn send(&mut self, bytes: &[u8]) -> bool {
        self.last_write = Instant::now();
        proxy::answer_to(&mut self.client, bytes, self.deadline).is_ok()
    }

    /// One frame of the answer, as opposed to a ping or the head: what a
    /// disconnect line counts. The count rises only when the write landed —
    /// a frame the socket refused was never delivered, and counting it would
    /// report progress the phone did not get.
    fn send_frame(&mut self, bytes: &[u8]) -> bool {
        let sent = self.send(bytes);
        if sent {
            self.frames += 1;
        }
        sent
    }

    /// The one line a lost phone leaves, whether it was noticed by the loop's
    /// own check or by a write that would not land.
    fn log_gone(&self, device: DeviceId) {
        log::info!("{}", audit::line::phone_gone_line(device, self.frames));
    }
}

fn follow(
    mut wire: Wire,
    chat: &Chat,
    shared: &Shared,
    device: DeviceId,
    turn: Value,
    origin: Option<&[u8]>,
) {
    if !wire.send(&head(origin)) {
        // The phone was already gone when its turn began. Its own line, like
        // any other drop.
        wire.log_gone(device);
        return;
    }
    // Asked before the page is: a stop or a forget that came with the request
    // must not reach the window at all.
    if withdrawn(shared, device) {
        wire.send(&frame("error", &json!({"code": "cancelled"})));
        return;
    }
    let Some(opened) = chat.hook.open(device, "turn", turn) else {
        wire.send(&frame("error", &json!({"code": "no_runner"})));
        return;
    };
    let request = opened.request;
    let events = opened.events;
    let runner_by = Instant::now() + shared.clocks.chat_runner_wait;
    let mut accepted = false;
    loop {
        if proxy::client_gone(&wire.client) {
            // The phone went away mid-turn. One line, so a turn that died with
            // its reader is told apart from one the window refused: the frames
            // it already held are a count, never a word of the answer.
            wire.log_gone(device);
            chat.hook.stop(&request);
            return;
        }
        if withdrawn(shared, device) {
            wire.send(&frame("error", &json!({"code": "cancelled"})));
            chat.hook.stop(&request);
            return;
        }
        let now = Instant::now();
        let refusal = if now >= wire.deadline {
            Some("cancelled")
        } else if !accepted && now >= runner_by {
            Some("no_runner")
        } else {
            None
        };
        if let Some(code) = refusal {
            wire.send(&frame("error", &json!({"code": code})));
            chat.hook.stop(&request);
            return;
        }
        match events.recv_timeout(SLICE) {
            Ok(event) => {
                let name = event.name.as_str();
                let (bytes, terminal) = match name {
                    "accepted" if !accepted => {
                        accepted = true;
                        (frame("turn", &json!({"turn": request})), false)
                    }
                    "error" | "done" => (frame(name, &event.data), true),
                    _ if accepted && STREAMED.contains(&name) => (frame(name, &event.data), false),
                    _ => continue,
                };
                if !wire.send_frame(&bytes) {
                    // The phone's socket stopped taking bytes mid-answer: the
                    // same disconnect the loop's own check reports, reached
                    // here instead because the phone vanished between two
                    // slices. One line either way, never the answer's words.
                    wire.log_gone(device);
                    chat.hook.stop(&request);
                    return;
                }
                if terminal {
                    return;
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                // A ping is not an answer frame, so it does not raise the
                // count — but a ping the socket refuses is the same phone gone.
                if wire.last_write.elapsed() >= PING && !wire.send(b": ping\n\n") {
                    wire.log_gone(device);
                    chat.hook.stop(&request);
                    return;
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                wire.send(&frame("error", &json!({"code": "engine"})));
                return;
            }
        }
    }
}

/// A turn refused before it runs: the stream opens and its one terminal frame
/// says why.
pub(super) fn refuse(client: &mut TcpStream, origin: Option<&[u8]>, deadline: Instant, code: &str) {
    crate::audit::status(200);
    crate::audit::streamed();
    let _ = proxy::answer_to(client, &head(origin), deadline);
    let _ = proxy::answer_to(client, &frame("error", &json!({"code": code})), deadline);
}

/// The stream's head: the same shape the room's stream answers with.
fn head(origin: Option<&[u8]>) -> Vec<u8> {
    format!(
        "HTTP/1.1 200 OK\r\n{}Content-Type: text/event-stream\r\n\
         Cache-Control: no-cache\r\nConnection: close\r\n\r\n",
        cors::origin_headers(origin)
    )
    .into_bytes()
}

/// One event as SSE bytes: the name, the json, the blank line.
fn frame(name: &str, data: &Value) -> Vec<u8> {
    format!("event: {name}\ndata: {data}\n\n").into_bytes()
}
