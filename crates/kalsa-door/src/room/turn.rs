//! The AI guest's turn: one thread that drives the whole queue — leases
//! the room's own engine seat, hands the model the room transcript within
//! a context budget, streams the answer to the room as deltas, and lands
//! the finished message with how much of the room it was built on.
//!
//! One thread for the whole queue, because HOUSEHOLD-RULES §5.2 says one
//! turn at a time ALWAYS — the machine's slots do not buy the room a
//! second turn, so there is nothing for a second driver to drive. The
//! thread lives while anything waits: it ends a turn, asks the room for
//! the next, and keeps going. A withdrawal or the owner's stop clears the
//! running turn under it; the driver notices between engine reads (the
//! reads are sliced, never blocking past a second) and moves on to
//! whatever waits.
//!
//! Nothing is sent to the model while people talk (§5.1): the thread is
//! spawned only where a call is taken, and it ends when the queue does.

use std::io::{BufRead, BufReader};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::sync::Arc;
use std::time::{Duration, Instant};

use kalsa_room::{AiEvent, Entry, MemberId};
use serde_json::json;

use crate::devices::DeviceId;
use crate::proxy::{self, Shared};
use crate::room::answers::name_of;
use crate::room::RoomDoor;
use crate::slots::LeaseError;

/// How much room transcript one turn may carry to the model, when the
/// launch's per-slot context was not named to the door. The budget is
/// derived from the slot when it is (see [`budget_of`]); this is the
/// floor for doors built without one.
const FALLBACK_BUDGET: usize = 32 * 1024;

/// The share of the slot's context the transcript may spend; the rest is
/// the answer's room and the framing.
const BUDGET_SHARE: u64 = 60;

/// The transcript budget in bytes, from the per-slot context the launch
/// actually funded (`--ctx-size / --parallel`). Tokens are estimated at
/// four bytes each — no tokenizer sits in this crate, and the estimate is
/// stated as one: the budget errs small, and the truncation marker on the
/// answer says how much of the room it was built on either way.
fn budget_of(slot_context: Option<u64>) -> usize {
    match slot_context {
        Some(tokens) => ((tokens.saturating_mul(BUDGET_SHARE) / 100) as usize).saturating_mul(4),
        None => FALLBACK_BUDGET,
    }
}

/// How long a turn waits between looks for a free seat before it says so
/// again.
const SEAT_POLL: Duration = Duration::from_secs(2);

/// How long one engine read may block before the driver checks that its
/// turn is still alive.
const READ_SLICE: Duration = Duration::from_secs(1);

/// How long the whole turn may run. An answer that outlives it is stopped
/// honestly rather than left running behind a door nobody watches.
#[cfg(not(test))]
const TURN_PATIENCE: Duration = Duration::from_secs(600);
#[cfg(test)]
const TURN_PATIENCE: Duration = Duration::from_secs(3);

/// Copy in the repo's own voice; the owner approves every line.
const SYSTEM_PROMPT: &str = "You are Kalsa, a guest in this family's room on their own computer. \
You speak only when called. Answer briefly and plainly, in the language of the room, \
and say so plainly when you are unsure.";

/// The sentences a status can carry. One line each, no secrets, no paths.
const BUSY_WAITING: (&str, &str) = (
    "busy_waiting",
    "Kalsa is busy with another conversation. You keep your turn.",
);
const UNAVAILABLE: (&str, &str) = ("unavailable", "Kalsa can't answer in this room right now.");
const STOPPED: (&str, &str) = ("stopped", "Kalsa stopped before finishing. Ask again.");
const EMPTY_ANSWER: (&str, &str) = ("empty_answer", "Kalsa had no answer to that.");
const COULD_NOT_START: (&str, &str) = ("could_not_start", "Kalsa couldn't start. Try again.");
const ENGINE_REFUSED: (&str, &str) = ("engine_refused", "Kalsa couldn't answer that just now.");
const CONTEXT_REFUSED: (&str, &str) = (
    "context_refused",
    "Kalsa couldn't fit that conversation. Try again.",
);
const PATIENCE_ENDED: (&str, &str) = (
    "patience_ended",
    "Kalsa took too long to finish. Ask again.",
);

/// The room's own seat at the engine: the fixed device id the door mints
/// into its set when it is given a room. A seat of its own, because the
/// host's seat is the host's private chat and a guest does not borrow it.
pub(crate) const ROOM_DEVICE: u32 = u32::MAX;

/// Starts the queue's driver for a turn that `submit` began. One at a
/// time by construction: the room only answers `Starts` when nothing runs.
pub(super) fn spawn(door: &Arc<RoomDoor>, shared: &Arc<Shared>, member: MemberId, turn: u64) {
    let driving = Arc::clone(door);
    let shared = Arc::clone(shared);
    let spawned = std::thread::Builder::new()
        .name("kalsa-door-room-turn".into())
        .spawn(move || drive(&driving, &shared, member, turn));
    if spawned.is_err() {
        publish(Arc::clone(&door.room), "refused", Some(COULD_NOT_START));
        let _ = door.room.end_turn(member);
    }
}

fn drive(door: &Arc<RoomDoor>, shared: &Arc<Shared>, mut member: MemberId, mut turn: u64) {
    loop {
        // Armed for the whole turn: a driver that unwinds mid-turn still
        // ends it and hands whatever waits to a fresh driver, or the queue
        // would hold a running turn forever and refuse every later call.
        let guard = TurnGuard {
            door: Arc::clone(door),
            shared: Arc::clone(shared),
            member,
            armed: true,
        };
        run_one_turn(door, shared, turn);
        match guard.finish() {
            Some((next_member, next_turn)) => {
                member = next_member;
                turn = next_turn;
            }
            None => return,
        }
    }
}

/// Ends the member's turn — and starts whatever waits, on a fresh driver —
/// on every way out of the turn, an unwind included.
struct TurnGuard {
    door: Arc<RoomDoor>,
    shared: Arc<Shared>,
    member: MemberId,
    armed: bool,
}

impl TurnGuard {
    fn finish(mut self) -> Option<(MemberId, u64)> {
        self.armed = false;
        self.door.room.end_turn(self.member)
    }
}

impl Drop for TurnGuard {
    fn drop(&mut self) {
        if self.armed {
            if let Some((next_member, next_turn)) = self.door.room.end_turn(self.member) {
                spawn(&self.door, &self.shared, next_member, next_turn);
            }
        }
    }
}

fn run_one_turn(door: &Arc<RoomDoor>, shared: &Arc<Shared>, turn: u64) {
    publish(door.room.clone(), "thinking", None);
    let deadline = Instant::now() + TURN_PATIENCE;
    let (messages, read) = transcript(door, shared);
    let lease = loop {
        if !door.room.turn_alive(turn) {
            return;
        }
        if Instant::now() >= deadline {
            publish(door.room.clone(), "stopped", Some(PATIENCE_ENDED));
            return;
        }
        match shared.set.lease(DeviceId::new(ROOM_DEVICE)) {
            Ok(lease) => break lease,
            // No seat, no failure: the call keeps its place and says what
            // it is waiting for, which is a computer, not a model.
            Err(LeaseError::NoRoom) => {
                publish(door.room.clone(), "waiting", Some(BUSY_WAITING));
                std::thread::sleep(SEAT_POLL);
            }
            // The room's seat is minted into the set with the room itself;
            // not held means the door was built without it.
            Err(LeaseError::NotHeld) => {
                publish(door.room.clone(), "refused", Some(UNAVAILABLE));
                return;
            }
        }
    };
    if Instant::now() >= deadline {
        publish(door.room.clone(), "stopped", Some(PATIENCE_ENDED));
        return;
    }
    let Some(salt) = shared.set.cache_salt(DeviceId::new(ROOM_DEVICE)) else {
        publish(door.room.clone(), "refused", Some(UNAVAILABLE));
        return;
    };
    let body = json!({
        "model": "kalsa-room",
        "messages": messages,
        "stream": true,
    });
    let body = serde_json::to_vec(&body).expect("the turn's request always serializes");
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, shared.port));
    let mut engine = match TcpStream::connect_timeout(&address, Duration::from_secs(5)) {
        Ok(engine) => engine,
        Err(_) => {
            publish(door.room.clone(), "refused", Some(COULD_NOT_START));
            return;
        }
    };
    let mut head = Vec::with_capacity(512);
    head.extend_from_slice(
        format!(
            "POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\
             Content-Type: application/json\r\nAccept: text/event-stream\r\n\
             Content-Length: {}\r\nConnection: close\r\n",
            shared.port,
            body.len()
        )
        .as_bytes(),
    );
    crate::request::private_headers(&mut head, lease.slot(), &salt);
    head.extend_from_slice(b"\r\n");
    head.extend_from_slice(&body);
    if proxy::write_with_deadline(&mut engine, &head, deadline).is_err() {
        publish(door.room.clone(), "refused", Some(COULD_NOT_START));
        return;
    }
    let mut reader = BufReader::new(engine);
    let mut answer = String::new();
    let mut answered = false;
    loop {
        if !door.room.turn_alive(turn) || Instant::now() >= deadline {
            // The engine socket closes with this scope; a half answer is
            // discarded, never stored — the room does not keep words the
            // model was still choosing. The patience running out is the
            // machine stopping, said as that, answered or not.
            if Instant::now() >= deadline {
                publish(door.room.clone(), "stopped", Some(PATIENCE_ENDED));
            }
            return;
        }
        let mut line = String::new();
        let _ = reader.get_ref().set_read_timeout(Some(READ_SLICE));
        match reader.read_line(&mut line) {
            // The socket ended without the terminal event: the stream is
            // truncated — the desktop chat reports a stream that ends
            // without [DONE] and never announces it complete, and neither
            // does the room.
            Ok(0) => {
                let state = if answered { "stopped" } else { "refused" };
                publish(door.room.clone(), state, Some(STOPPED));
                return;
            }
            Ok(_) => {}
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                continue;
            }
            Err(_) => {
                let state = if answered { "stopped" } else { "refused" };
                publish(door.room.clone(), state, Some(STOPPED));
                return;
            }
        }
        let Some(payload) = line.strip_prefix("data: ") else {
            // The status line: an engine that refuses the request is
            // reported as its own refusal, never as a stream that died.
            if line.starts_with("HTTP/1.") {
                let code = line.split_whitespace().nth(1).unwrap_or("?");
                if code != "200" {
                    let note = if code == "400" || code == "413" {
                        CONTEXT_REFUSED
                    } else {
                        ENGINE_REFUSED
                    };
                    publish(door.room.clone(), "refused", Some(note));
                    return;
                }
            }
            continue;
        };
        let payload = payload.trim_end();
        if payload == "[DONE]" {
            // The terminal event was seen: the answer's own end, and the
            // socket's close after it changes nothing.
            break;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
            continue;
        };
        // Content only: reasoning is the computer's own channel — the
        // desktop chat shows it beside the answer, the room carries the
        // answer alone, and no reasoning token is streamed or stored.
        let Some(text) = value
            .pointer("/choices/0/delta/content")
            .and_then(|content| content.as_str())
        else {
            continue;
        };
        if text.is_empty() {
            continue;
        }
        if !answered {
            answered = true;
            door.room.mark_turn(turn, true);
        }
        answer.push_str(text);
        door.room.publish_ai(AiEvent::Delta {
            turn,
            text: text.to_string(),
        });
    }
    if !door.room.turn_alive(turn) {
        return;
    }
    if answer.is_empty() {
        publish(door.room.clone(), "refused", Some(EMPTY_ANSWER));
        return;
    }
    let _ = door.room.post_ai(&answer, read);
    door.room.publish_ai(AiEvent::Status {
        state: "done",
        note_code: None,
        note: None,
    });
}

/// The transcript one turn is built on, newest-first into the budget, then
/// reversed to speaking order: the oldest messages are the ones that fall
/// off, and `read` is the honest count of what stayed. The AI's view has
/// no member's join floor — the room it answers in is one room.
fn transcript(door: &Arc<RoomDoor>, shared: &Arc<Shared>) -> (serde_json::Value, u32) {
    let entries = door.room.entries_for_ai();
    let devices = shared.set.current();
    let budget = budget_of(shared.slot_context);
    let mut kept: Vec<&Entry> = Vec::new();
    let mut bytes = 0usize;
    for entry in entries.iter().rev() {
        let name = frame_name(&door.room, &devices, entry.member);
        let cost = name.len() + entry.text.len() + 8;
        if bytes + cost > budget && !kept.is_empty() {
            break;
        }
        bytes += cost;
        kept.push(entry);
    }
    kept.reverse();
    let read = kept.len() as u32;
    let mut messages = vec![json!({"role": "system", "content": SYSTEM_PROMPT})];
    for entry in kept {
        let name = frame_name(&door.room, &devices, entry.member);
        if entry.member == MemberId::Ai {
            messages.push(json!({"role": "assistant", "content": entry.text}));
        } else {
            messages.push(json!({"role": "user", "content": format!("[{name}] {}", entry.text)}));
        }
    }
    (json!(messages), read)
}

/// The name as the model reads it: the brackets that frame a speaker are
/// stripped from the name itself, so no name — a member's choice or an
/// owner's label — can close its own bracket and forge another speaker.
/// Refusing the characters in names would break labels the owner already
/// gave; stripping makes every name safe without touching what anyone
/// chose.
fn frame_name(room: &kalsa_room::Room, devices: &crate::Devices, member: MemberId) -> String {
    let name = name_of(room, devices, member);
    name.replace(['[', ']'], "")
}

fn publish(
    room: Arc<kalsa_room::Room>,
    state: &'static str,
    note: Option<(&'static str, &'static str)>,
) {
    room.publish_ai(AiEvent::Status {
        state,
        note_code: note.map(|(code, _)| code),
        note: note.map(|(_, text)| text.to_string()),
    });
}
