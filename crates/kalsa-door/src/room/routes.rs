//! The room's four JSON handlers: the member list, the history pages, the
//! post, and the name. The routing in `mod` decides WHO; these decide
//! WHAT each route answers, on the room and the roster the door holds.

use std::net::TcpStream;
use std::time::Instant;

use kalsa_room::MemberId;
use serde_json::{json, Value};

use super::answers::{entry_json, json_error, json_ok, name_of, read_body, store_failed};
use super::RoomDoor;
use super::{BAD_QUERY, MALFORMED, NO_ID, NO_NAME};
use crate::devices::Devices;
use crate::request::UnsealedHead;
use kalsa_room::Room;
use std::sync::Arc;

pub(super) struct PostContext<'a> {
    pub(super) shared: &'a std::sync::Arc<crate::proxy::Shared>,
    pub(super) head: &'a UnsealedHead,
    pub(super) member: MemberId,
    pub(super) origin: Option<&'a [u8]>,
    pub(super) deadline: Instant,
    pub(super) arrival: Instant,
}

/// The floor a reader's pages begin at: the host's whole transcript, a
/// member's join point. `None` is a member the room cannot place — the
/// caller refuses rather than guess.
pub(super) fn floor_of(room: &Room, member: MemberId) -> Option<u64> {
    match member {
        MemberId::Host | MemberId::Ai => Some(1),
        MemberId::Member(_) => room.join_of(member),
    }
}

/// The member list and the visible AI state. Names only, ever — and the
/// caller's own member id, the room's stable id, and the epoch its seqs
/// are unique within.
pub(super) fn info(door: &RoomDoor, devices: &Devices, you: MemberId) -> Value {
    let mut members = vec![entry_member(
        door.room.clone(),
        MemberId::Host,
        devices.label(door.host).unwrap_or("This computer"),
        "host",
    )];
    for (id, label) in devices.entries() {
        // The host's row is fixed and the guest's seat is not a member at
        // all: the AI guest holds an engine seat, never a room membership,
        // and enrolling it here would put a second "Kalsa" in the room.
        if id == door.host || id.value() == crate::ROOM_DEVICE {
            continue;
        }
        // The row carries the ROOM's member id, minted at this device's
        // enrollment — never the pairing id, which is another namespace a
        // re-paired device reuses. The list enrolls any device the app's
        // reconcile has not, so every row has an id the caller can address.
        let Ok(member) = door.room.enroll(id.value()) else {
            continue;
        };
        members.push(entry_member(door.room.clone(), member, label, "phone"));
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
        "ai": ai_state(&door.room, devices, you, door.room.turn_state().state, None, None),
    })
}

/// The AI's visible state, the one shape `info`'s `ai` object, the
/// stream's opening snapshot, and every `ai_status` event answer with —
/// one constructor, so the three can never drift apart. `state` is the
/// word this answer is for (a transition's own word on an event, the
/// queue's live word otherwise); the names are resolved here, from the
/// live queue, because names are the door's to give and the queue's to
/// order. Names only, ever.
pub(super) fn ai_state(
    room: &Room,
    devices: &Devices,
    you: MemberId,
    state: &'static str,
    note_code: Option<&str>,
    note: Option<&str>,
) -> Value {
    let turns = room.turn_state();
    let running = turns.running.map(|member| name_of(room, devices, member));
    let queue: Vec<String> = turns
        .pending
        .iter()
        .map(|member| name_of(room, devices, *member))
        .collect();
    json!({
        "state": state,
        "busy": turns.running.is_some() || !turns.pending.is_empty(),
        "running": running,
        "queue": queue,
        "who": null,
        "you_pending": turns.running == Some(you) || turns.pending.contains(&you),
        "note_code": note_code,
        "note": note,
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
pub(super) fn history(
    door: &RoomDoor,
    devices: &Devices,
    member: MemberId,
    target: &[u8],
    origin: Option<&[u8]>,
) -> Vec<u8> {
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
        let number = match std::str::from_utf8(value)
            .ok()
            .and_then(|value| value.parse().ok())
        {
            Some(number) => number,
            // A value that is not a plain number, on a key the page reads,
            // is refused; a key it does not read is ignored.
            None if matches!(key, b"after" | b"before" | b"limit") => {
                return json_error(400, origin, "bad_request", BAD_QUERY);
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
    // A member with no join point is a room this door cannot explain: the
    // honest answer is the internal one, never a floor of nothing that
    // quietly serves everything.
    let Some(floor) = floor_of(&door.room, member) else {
        log::error!("a member with no join point asked for history");
        return json_error(500, origin, "internal", store_failed());
    };
    let page = match (after, before) {
        (Some(_), Some(_)) => return json_error(400, origin, "bad_request", BAD_QUERY),
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
pub(super) fn post(
    client: &mut TcpStream,
    door: &Arc<RoomDoor>,
    request: PostContext<'_>,
) -> Vec<u8> {
    let PostContext {
        shared,
        head,
        member,
        origin,
        deadline,
        arrival,
    } = request;
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
    let call_ai = value
        .get("call_ai")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    // The blobs a post attaches: ids only, the descriptors living on the
    // shelf the store keeps. A media field that is not an array of strings
    // is a body of a shape the route does not read.
    let media = match value.get("media") {
        None => Vec::new(),
        Some(media) => match media.as_array() {
            Some(ids) if ids.len() <= kalsa_room::POST_MEDIA_MAX => {
                let mut names = Vec::with_capacity(ids.len());
                for id in ids {
                    match id.as_str() {
                        Some(id) => names.push(id.to_string()),
                        None => {
                            return json_error(400, origin, "bad_request", MALFORMED);
                        }
                    }
                }
                names
            }
            _ => return json_error(400, origin, "bad_request", MALFORMED),
        },
    };
    match door.room.post(member, client_msg_id, text, call_ai, &media) {
        Ok(entry) => {
            // A called message takes its place in the queue — the store
            // already derived the call from the flag or the token — and
            // the answer says which happened. The message itself landed
            // either way.
            let called = entry.call_ai;
            let (ai_call, refusal) = if !called {
                (json!(null), json!(null))
            } else {
                match door.room.submit_call_at(member, client_msg_id, arrival) {
                    Ok(kalsa_room::CallTaken::Queued) => (json!("queued"), json!(null)),
                    Ok(kalsa_room::CallTaken::Starts(turn)) => {
                        super::turn::spawn(door, shared, member, turn);
                        (json!("queued"), json!(null))
                    }
                    Err(_) => (json!("refused"), json!("already_pending")),
                }
            };
            json_ok(
                origin,
                &json!({"seq": entry.seq, "time": entry.time, "ai_call": ai_call, "refusal": refusal}),
            )
        }
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
        E::Media(media) => super::media::refusal(origin, media),
        E::ReadOnly => json_error(503, origin, "read_only", &error.to_string()),
        E::Io(_) => json_error(500, origin, "internal", store_failed()),
    }
}

pub(super) fn set_name(
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
        E::Empty | E::Invisible | E::NotAMember => {
            json_error(400, origin, "bad_request", &error.to_string())
        }
        E::MixedScripts => json_error(400, origin, "name_mixed_scripts", &error.to_string()),
        E::Framing => json_error(400, origin, "name_framing", &error.to_string()),
        E::TooLong => json_error(413, origin, "name_too_long", &error.to_string()),
        E::Reserved => json_error(409, origin, "name_reserved", &error.to_string()),
        E::Taken => json_error(409, origin, "name_taken", &error.to_string()),
        E::Io(_) => json_error(500, origin, "internal", store_failed()),
    }
}
