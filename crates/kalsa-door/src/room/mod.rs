//! The room behind the door: the five routes of `docs/ROOM-PROTOCOL.md`,
//! served by the door itself on the same credential as everything else.
//! The author of every write is the device the bearer scan identified —
//! never a field of the body — and every device is enrolled into the room
//! by its first authenticated room request.
//!
//! The live stream is [`stream`]: one dedicated thread per connected
//! follower, cut the moment the device leaves the set, replaying from the
//! `Last-Event-ID` the client carries.

mod answers;
mod stream;

use answers::{entry_json, json_error, json_ok, read_body, store_failed};

use std::net::TcpStream;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use kalsa_room::{MemberId, Room};
use serde_json::{json, Value};

use crate::devices::{DeviceId, Devices};
use crate::proxy;
use crate::request::UnsealedHead;
use crate::slots::DeviceSet;

/// The room this door serves, and the device id the host seats. Built by
/// [`crate::Door::with_room`]; a door without one answers every room route
/// with the one honest sentence.
pub(crate) struct RoomDoor {
    room: Arc<Room>,
    host: DeviceId,
}

impl RoomDoor {
    pub(crate) fn new(room: Arc<Room>, host: DeviceId) -> Self {
        Self { room, host }
    }
}

/// The largest body the room's routes read: a message is 8000 bytes of
/// text and 64 of id, a name is 40 — anything beyond is a client talking
/// to something else, refused before its bytes are read.
pub(super) const MAX_BODY: usize = 16 * 1024;

/// One sentence per refusal, and no more: this is all a client sees. The
/// codes are the protocol's.
const NO_ROOM: &str = "The room is not open on this computer.";
const UNKNOWN_ROUTE: &str = "The door does not serve that room route.";
const MALFORMED: &str = "The room reads a json body of the shape its route defines.";
const BAD_QUERY: &str = "The room reads after, before and limit as plain numbers.";
const NO_ID: &str = "A message needs a client_msg_id and a text.";
const NO_NAME: &str = "A name needs a name field.";
const BAD_LAST_EVENT_ID: &str = "The room resumes from a numeric Last-Event-ID.";

pub(super) fn owns(target: &[u8]) -> bool {
    path_of(target).starts_with(b"/kalsa/room/")
}

/// The path without its query string: the routes are exact, the query is
/// each route's own to read.
fn path_of(target: &[u8]) -> &[u8] {
    target.split(|byte| *byte == b'?').next().unwrap_or(target)
}

/// What the door hands a room request it has authenticated: the head, the
/// device the credential named, the live set, and the room itself.
pub(super) struct Request<'a> {
    pub(super) head: &'a UnsealedHead,
    pub(super) device: DeviceId,
    pub(super) devices: &'a Devices,
    pub(super) room: Option<&'a Arc<RoomDoor>>,
    pub(super) stop: &'a Arc<AtomicBool>,
    pub(super) set: &'a Arc<DeviceSet>,
}

pub(super) fn serve(
    mut client: TcpStream,
    request: Request<'_>,
    deadline: Instant,
) {
    let Request { head, device, devices, room: room_door, stop, set } = request;
    let origin = head.origin.as_deref();
    let Some(door) = room_door else {
        let _ = proxy::discard_request_body(&mut client, head.body_length, deadline);
        let answer = json_error(503, origin, "no_room", NO_ROOM);
        let _ = proxy::write_with_deadline(&mut client, &answer, deadline);
        return;
    };
    let Ok(member) = door.room.enroll(device.value()) else {
        let _ = proxy::discard_request_body(&mut client, head.body_length, deadline);
        let answer = json_error(500, origin, "internal", store_failed());
        let _ = proxy::write_with_deadline(&mut client, &answer, deadline);
        return;
    };
    match (path_of(&head.target), &head.method[..]) {
        (b"/kalsa/room/info", b"GET") => {
            let _ = proxy::discard_request_body(&mut client, head.body_length, deadline);
            let answer = info(door, devices, member);
            let _ = proxy::write_with_deadline(&mut client, &json_ok(origin, &answer), deadline);
        }
        (b"/kalsa/room/history", b"GET") => {
            let _ = proxy::discard_request_body(&mut client, head.body_length, deadline);
            let answer = history(door, devices, member, &head.target, origin);
            let _ = proxy::write_with_deadline(&mut client, &answer, deadline);
        }
        (b"/kalsa/room/messages", b"POST") => {
            let answer = post(&mut client, door, head, member, origin, deadline);
            let _ = proxy::write_with_deadline(&mut client, &answer, deadline);
        }
        (b"/kalsa/room/name", b"PUT") => {
            let answer = set_name(&mut client, door, head, member, origin, deadline);
            let _ = proxy::write_with_deadline(&mut client, &answer, deadline);
        }
        (b"/kalsa/room/events", b"GET") => {
            // The stream owns the socket from here: it lives on its own
            // thread, because a follower never ends and must not spend a
            // worker the completions need.
            if proxy::discard_request_body(&mut client, head.body_length, deadline).is_err() {
                return;
            }
            stream::serve(
                client,
                &door.room,
                stream::Ctx {
                    set: Arc::clone(set),
                    stop: Arc::clone(stop),
                    device,
                },
                head.last_event_id.as_deref(),
                head.room_epoch.as_deref(),
                origin,
                deadline,
            );
        }
        _ => {
            let _ = proxy::discard_request_body(&mut client, head.body_length, deadline);
            let answer = json_error(404, origin, "not_found", UNKNOWN_ROUTE);
            let _ = proxy::write_with_deadline(&mut client, &answer, deadline);
        }
    }
}

/// The member list and the visible AI state. Names only, ever — and the
/// caller's own member id, the room's stable id, and the epoch its seqs
/// are unique within.
fn info(door: &RoomDoor, devices: &Devices, you: MemberId) -> Value {
    let mut members = vec![entry_member(
        door.room.clone(),
        MemberId::Host,
        devices.label(door.host).unwrap_or("This computer"),
        "host",
    )];
    for (id, label) in devices.entries() {
        if id == door.host {
            continue;
        }
        let _ = door.room.enroll(id.value());
        members.push(entry_member(door.room.clone(), MemberId::Member(id.value()), label, "phone"));
    }
    members.push(json!({
        "member_id": MemberId::Ai.wire(),
        "name": "Kalsa",
        "kind": "ai",
    }));
    json!({
        "room_name": devices.label(door.host).unwrap_or("This computer"),
        "room_id": door.room.room_id(),
        "epoch": door.room.epoch(),
        "you": you.wire(),
        "members": members,
        "ai": {"busy": false, "running": null, "queue": [], "you_pending": false},
    })
}

fn entry_member(room: Arc<Room>, member: MemberId, label: &str, kind: &str) -> Value {
    json!({
        "member_id": member.wire(),
        "name": room.name_of(member).unwrap_or_else(|| label.to_string()),
        "kind": kind,
    })
}

/// One history page, in the shape the protocol answers.
fn history(door: &RoomDoor, devices: &Devices, member: MemberId, target: &[u8], origin: Option<&[u8]>) -> Vec<u8> {
    let query = target.splitn(2, |byte| *byte == b'?').nth(1).unwrap_or(&[]);
    let mut after: Option<u64> = None;
    let mut before: Option<u64> = None;
    let mut limit = 100usize;
    for pair in query.split(|byte| *byte == b'&') {
        if pair.is_empty() {
            continue;
        }
        let Some(eq) = pair.iter().position(|byte| *byte == b'=') else {
            continue;
        };
        let (key, value) = (&pair[..eq], &pair[eq + 1..]);
        let number = match std::str::from_utf8(value).ok().and_then(|value| value.parse().ok()) {
            Some(number) => number,
            // A value that is not a plain number, on a key the page reads,
            // is refused; a key it does not read is ignored.
            None if matches!(key, b"after" | b"before" | b"limit") => {
                return json_error(400, origin, "bad_request", BAD_QUERY)
            }
            None => continue,
        };
        match key {
            b"after" => after = Some(number),
            b"before" => before = Some(number),
            b"limit" => limit = number as usize,
            _ => {}
        }
    }
    if !(1..=200).contains(&limit) {
        return json_error(400, origin, "bad_request", BAD_QUERY);
    }
    // A member's history begins where they joined; the host sees the
    // whole transcript. The floor travels into the page itself, so the
    // edges answer for what this reader may see, not what the room holds.
    let floor = door.room.join_of(member).unwrap_or(1);
    let page = match (after, before) {
        (Some(_), Some(_)) => {
            return json_error(400, origin, "bad_request", BAD_QUERY)
        }
        (Some(after), None) => door.room.page_after(floor, after, limit),
        (None, Some(before)) => door.room.page_before(floor, before, limit),
        (None, None) => door.room.newest_page(floor, limit),
    };
    let page = match page {
        Ok(page) => page,
        Err(_) => return json_error(400, origin, "bad_request", BAD_QUERY),
    };
    let messages = page
        .messages
        .iter()
        .map(|entry| entry_json(&door.room, devices, entry))
        .collect::<Vec<_>>();
    json_ok(
        origin,
        &json!({
            "messages": messages,
            "has_older": page.has_older,
            "has_newer": page.has_newer,
        }),
    )
}

/// Posts a message. The author is the enrolled caller; a `member_id` in
/// the body is read by nobody.
fn post(
    client: &mut TcpStream,
    door: &RoomDoor,
    head: &UnsealedHead,
    member: MemberId,
    origin: Option<&[u8]>,
    deadline: Instant,
) -> Vec<u8> {
    let Some(body) = read_body(client, head.body_length, deadline) else {
        return json_error(413, origin, "too_large", "The message is too long.");
    };
    let Ok(value) = serde_json::from_slice::<Value>(&body) else {
        return json_error(400, origin, "bad_request", MALFORMED);
    };
    let (Some(client_msg_id), Some(text)) = (
        value.get("client_msg_id").and_then(Value::as_str),
        value.get("text").and_then(Value::as_str),
    ) else {
        return json_error(400, origin, "bad_request", NO_ID);
    };
    let call_ai = value.get("call_ai").and_then(Value::as_bool).unwrap_or(false);
    match door.room.post(member, client_msg_id, text, call_ai) {
        Ok(entry) => json_ok(
            origin,
            // The AI half of a called message arrives with its step; until
            // then the flag lands and the call is not claimed.
            &json!({"seq": entry.seq, "time": entry.time, "ai_call": null, "refusal": null}),
        ),
        Err(error) => post_error(origin, &error),
    }
}

fn post_error(origin: Option<&[u8]>, error: &kalsa_room::PostError) -> Vec<u8> {
    use kalsa_room::PostError as E;
    match error {
        E::EmptyText | E::BadClientMsgId | E::NotAMember => {
            json_error(400, origin, "bad_request", &error.to_string())
        }
        E::TextTooLong => json_error(413, origin, "too_large", &error.to_string()),
        E::ClientIdReused => json_error(409, origin, "client_msg_id_reused", &error.to_string()),
        E::ReadOnly => json_error(503, origin, "read_only", &error.to_string()),
        E::Io(_) => json_error(500, origin, "internal", store_failed()),
    }
}

fn set_name(
    client: &mut TcpStream,
    door: &RoomDoor,
    head: &UnsealedHead,
    member: MemberId,
    origin: Option<&[u8]>,
    deadline: Instant,
) -> Vec<u8> {
    let Some(body) = read_body(client, head.body_length, deadline) else {
        return json_error(413, origin, "too_large", "The name is too long.");
    };
    let Ok(value) = serde_json::from_slice::<Value>(&body) else {
        return json_error(400, origin, "bad_request", MALFORMED);
    };
    let Some(name) = value.get("name").and_then(Value::as_str) else {
        return json_error(400, origin, "bad_request", NO_NAME);
    };
    match door.room.set_name(member, name) {
        Ok(name) => json_ok(origin, &json!({"member_id": member.wire(), "name": name})),
        Err(error) => name_error(origin, &error),
    }
}

fn name_error(origin: Option<&[u8]>, error: &kalsa_room::NameError) -> Vec<u8> {
    use kalsa_room::NameError as E;
    match error {
        E::Empty | E::Invisible | E::MixedScripts | E::NotAMember => {
            json_error(400, origin, "bad_request", &error.to_string())
        }
        E::TooLong => json_error(413, origin, "too_large", &error.to_string()),
        E::Reserved | E::Taken => json_error(409, origin, "name_taken", &error.to_string()),
        E::Io(_) => json_error(500, origin, "internal", store_failed()),
    }
}
