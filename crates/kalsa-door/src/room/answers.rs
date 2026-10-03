//! The room's answer bytes: the JSON bodies, the bounded body read, and
//! the name a member's entries answer with. The routes in `mod` decide
//! WHAT; this file is HOW it is written to the wire.

use std::io::Read;
use std::net::TcpStream;
use std::time::Instant;

use kalsa_room::{MemberId, Room};
use serde_json::{json, Value};

use crate::cors;
use crate::devices::{DeviceId, Devices};
use crate::proxy;

/// The largest body the room's routes read: a message is 8000 bytes of
/// text and 64 of id, a name is 40 — anything beyond is a client talking
/// to something else, refused before its bytes are read.
const MAX_BODY: usize = 16 * 1024;

/// One transcript entry as the protocol answers it: the author's CURRENT
/// name, resolved here at the door, and the former mark for a member whose
/// device is gone.
pub(super) fn entry_json(room: &Room, devices: &Devices, entry: &kalsa_room::Entry) -> Value {
    let mut value = json!({
        "seq": entry.seq,
        "epoch": room.epoch(),
        "member_id": entry.member.wire(),
        "name": name_of(room, devices, entry.member),
        "time": entry.time,
        "text": entry.text,
        "call_ai": entry.call_ai,
    });
    if room.is_former(entry.member) {
        value["former"] = json!(true);
    }
    if !entry.media.is_empty() {
        value["media"] =
            serde_json::to_value(&entry.media).expect("a media descriptor always serializes");
    }
    // The AI's answer says how much of the room it was built on: the
    // honest number behind the older messages that fell off the budget.
    if entry.member == kalsa_room::MemberId::Ai {
        value["read"] = json!(entry.read);
    }
    value
}

pub(super) fn name_of(room: &Room, devices: &Devices, member: MemberId) -> String {
    if let Some(name) = room.name_of(member) {
        return name;
    }
    room.device_of(member)
        .and_then(|device| devices.label(DeviceId::new(device)))
        .map(str::to_string)
        .unwrap_or_else(|| "Former member".to_string())
}

/// The client's body, bounded, drained whole when it is too big: an unread
/// body resets the socket on close and erases the answer.
pub(super) fn read_body(
    client: &mut TcpStream,
    length: usize,
    deadline: Instant,
) -> Option<Vec<u8>> {
    if length > MAX_BODY {
        let _ = proxy::discard_request_body(client, length, deadline);
        return None;
    }
    let mut body = vec![0u8; length];
    proxy::set_read_deadline(client, deadline).ok()?;
    client.read_exact(&mut body).ok()?;
    Some(body)
}

pub(super) fn store_failed() -> &'static str {
    "The room's store failed on disk."
}

pub(super) fn json_ok(origin: Option<&[u8]>, value: &Value) -> Vec<u8> {
    let body = serde_json::to_vec(value).expect("the answer always serializes");
    format!(
        "HTTP/1.1 200 OK\r\n{}Content-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n",
        cors::origin_headers(origin),
        body.len()
    )
    .into_bytes()
    .into_iter()
    .chain(body)
    .collect()
}

/// Success with nothing to say — the door's own 204 shape, origin headers
/// and no Content-Length.
pub(super) fn json_ok_no_content(origin: Option<&[u8]>) -> Vec<u8> {
    format!(
        "HTTP/1.1 204 No Content\r\n{}Connection: close\r\n\r\n",
        crate::cors::origin_headers(origin)
    )
    .into_bytes()
}

pub(super) fn json_error(status: u16, origin: Option<&[u8]>, code: &str, message: &str) -> Vec<u8> {
    let reason = match status {
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        413 => "Payload Too Large",
        416 => "Range Not Satisfiable",
        500 => "Internal Server Error",
        _ => "Service Unavailable",
    };
    let body = json!({"error": {"code": code, "message": message}});
    let body = serde_json::to_vec(&body).expect("the refusal always serializes");
    format!(
        "HTTP/1.1 {status} {reason}\r\n{}Content-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n",
        cors::origin_headers(origin),
        body.len()
    )
    .into_bytes()
    .into_iter()
    .chain(body)
    .collect()
}
