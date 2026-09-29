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

/// How much room transcript one turn may carry to the model, in UTF-8
/// bytes of formatted text — roughly eight thousand tokens, chosen to
/// leave the answer room inside any context this app launches. The oldest
/// messages are the ones that fall off, and the answer says how many it
/// read.
const TRANSCRIPT_BUDGET: usize = 32 * 1024;

/// How long a turn waits between looks for a free seat before it says so
/// again.
const SEAT_POLL: Duration = Duration::from_secs(2);

/// How long one engine read may block before the driver checks that its
/// turn is still alive.
const READ_SLICE: Duration = Duration::from_secs(1);

/// How long the whole turn may run. An answer that outlives it is stopped
/// honestly rather than left running behind a door nobody watches.
const TURN_PATIENCE: Duration = Duration::from_secs(600);

/// Copy in the repo's own voice; the owner approves every line.
const SYSTEM_PROMPT: &str = "You are Kalsa, a guest in this family's room on their own computer. \
You speak only when called. Answer briefly and plainly, in the language of the room, \
and say so plainly when you are unsure.";

/// The sentences a status can carry. One line each, no secrets, no paths.
const NO_SEAT_NOTE: &str =
    "The computer is busy with other conversations; the call keeps its place and waits.";
const NO_ROOM_SEAT_NOTE: &str = "This computer's room has no seat at its own engine.";
const ENGINE_GONE_NOTE: &str = "The model server stopped producing this answer.";
const EMPTY_ANSWER_NOTE: &str = "The model had nothing to say to that.";

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
        publish(Arc::clone(&door.room), "refused", Some("The room's turn could not start on this computer."));
        let _ = door.room.end_turn(member);
    }
}

fn drive(door: &Arc<RoomDoor>, shared: &Arc<Shared>, mut member: MemberId, mut turn: u64) {
    loop {
        run_one_turn(door, shared, turn);
        // The turn is over on every path above. `end_turn` records the
        // serve and starts whatever waits — and running it here, after the
        // turn body, is what keeps a cleared turn from wedging the queue
        // if the body itself could not.
        match door.room.end_turn(member) {
            Some((next_member, next_turn)) => {
                member = next_member;
                turn = next_turn;
            }
            None => return,
        }
    }
}

fn run_one_turn(door: &Arc<RoomDoor>, shared: &Arc<Shared>, turn: u64) {
    publish(door.room.clone(), "thinking", None);
    let (messages, read) = transcript(door, shared);
    let lease = loop {
        if !door.room.turn_alive(turn) {
            return;
        }
        match shared.set.lease(DeviceId::new(ROOM_DEVICE)) {
            Ok(lease) => break lease,
            // No seat, no failure: the call keeps its place and says what
            // it is waiting for, which is a computer, not a model.
            Err(LeaseError::NoRoom) => {
                publish(door.room.clone(), "waiting", Some(NO_SEAT_NOTE));
                std::thread::sleep(SEAT_POLL);
            }
            // The room's seat is minted into the set with the room itself;
            // not held means the door was built without it.
            Err(LeaseError::NotHeld) => {
                publish(door.room.clone(), "refused", Some(NO_ROOM_SEAT_NOTE));
                return;
            }
        }
    };
    let Some(salt) = shared.set.cache_salt(DeviceId::new(ROOM_DEVICE)) else {
        publish(door.room.clone(), "refused", Some(NO_ROOM_SEAT_NOTE));
        return;
    };
    let body = json!({
        "model": "kalsa-room",
        "messages": messages,
        "stream": true,
    });
    let body = serde_json::to_vec(&body).expect("the turn's request always serializes");
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, shared.port));
    let deadline = Instant::now() + TURN_PATIENCE;
    let mut engine = match TcpStream::connect_timeout(&address, Duration::from_secs(5)) {
        Ok(engine) => engine,
        Err(_) => {
            publish(door.room.clone(), "refused", Some(ENGINE_GONE_NOTE));
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
        publish(door.room.clone(), "refused", Some(ENGINE_GONE_NOTE));
        return;
    }
    // The lease is held across the request write only: the engine binds
    // the slot at the head, and the answer streams back on the open
    // socket while the seat is free for the next turn of anything.
    drop(lease);

    let mut reader = BufReader::new(engine);
    let mut answer = String::new();
    let mut answered = false;
    let mut saw_done = false;
    loop {
        if !door.room.turn_alive(turn) || Instant::now() >= deadline {
            // The engine socket closes with this scope; a half answer is
            // discarded, never stored — the room does not keep words the
            // model was still choosing.
            if answered && Instant::now() >= deadline {
                publish(door.room.clone(), "stopped", Some(ENGINE_GONE_NOTE));
            }
            return;
        }
        let mut line = String::new();
        let _ = reader.get_ref().set_read_timeout(Some(READ_SLICE));
        match reader.read_line(&mut line) {
            // The socket ended. With the terminal event it is the answer's
            // end; without it the stream is truncated — the desktop chat
            // reports a stream that ends without [DONE] and never
            // announces it complete, and neither does the room.
            // The socket ended. With the terminal event it is the
            // answer's end; without it the stream is truncated — the
            // desktop chat reports a stream that ends without [DONE] and
            // never announces it complete, and neither does the room.
            Ok(0) if saw_done => break,
            Ok(0) => {
                let state = if answered { "stopped" } else { "refused" };
                publish(door.room.clone(), state, Some(ENGINE_GONE_NOTE));
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
                publish(door.room.clone(), state, Some(ENGINE_GONE_NOTE));
                return;
            }
        }
        let Some(payload) = line.strip_prefix("data: ") else {
            continue;
        };
        let payload = payload.trim_end();
        if payload == "[DONE]" {
            // The terminal event was seen; the end-of-socket that follows
            // is the answer's own end, not a truncation.
            saw_done = true;
        }
        if saw_done {
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
        publish(door.room.clone(), "refused", Some(EMPTY_ANSWER_NOTE));
        return;
    }
    let _ = door.room.post_ai(&answer, read);
    door.room.publish_ai(AiEvent::Status { state: "done", note: None });
}

/// The transcript one turn is built on, newest-first into the budget, then
/// reversed to speaking order: the oldest messages are the ones that fall
/// off, and `read` is the honest count of what stayed. The AI's view has
/// no member's join floor — the room it answers in is one room.
fn transcript(door: &Arc<RoomDoor>, shared: &Arc<Shared>) -> (serde_json::Value, u32) {
    let entries = door.room.entries_for_ai();
    let devices = shared.set.current();
    let mut kept: Vec<&Entry> = Vec::new();
    let mut bytes = 0usize;
    for entry in entries.iter().rev() {
        let name = name_of(&door.room, &devices, entry.member);
        let cost = name.len() + entry.text.len() + 8;
        if bytes + cost > TRANSCRIPT_BUDGET && !kept.is_empty() {
            break;
        }
        bytes += cost;
        kept.push(entry);
    }
    kept.reverse();
    let read = kept.len() as u32;
    let mut messages = vec![json!({"role": "system", "content": SYSTEM_PROMPT})];
    for entry in kept {
        let name = name_of(&door.room, &devices, entry.member);
        if entry.member == MemberId::Ai {
            messages.push(json!({"role": "assistant", "content": entry.text}));
        } else {
            messages.push(json!({"role": "user", "content": format!("{name}: {}", entry.text)}));
        }
    }
    (json!(messages), read)
}

fn publish(room: Arc<kalsa_room::Room>, state: &'static str, note: Option<&'static str>) {
    room.publish_ai(AiEvent::Status { state, note });
}
