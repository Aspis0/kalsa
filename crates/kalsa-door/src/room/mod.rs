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
mod routes;
mod stream;

use answers::{json_error, json_ok, store_failed};
use routes::{floor_of, history, info, post, set_name};

use std::net::TcpStream;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use kalsa_room::Room;

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
    /// The room's live stream seats, so the per-device cap spans every
    /// worker and every connection.
    seats: Arc<stream::Seats>,
}

impl RoomDoor {
    pub(crate) fn new(room: Arc<Room>, host: DeviceId) -> Self {
        Self {
            room,
            host,
            seats: Arc::new(stream::Seats::default()),
        }
    }
}

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
    // The epoch guard, once, ahead of every route: a phone that cached a
    // different transcript is told to drop it and refetch before it reads
    // one byte of this one — history and posts included, because a reused
    // seq on a stale cache is wrong in both. An absent header is a phone
    // that cached nothing and checks nothing.
    if let Some(held) = head.room_epoch.as_deref() {
        if held != door.room.epoch().as_bytes() {
            let _ = proxy::discard_request_body(&mut client, head.body_length, deadline);
            let answer = json_error(
                409,
                origin,
                "epoch_changed",
                "The room's transcript restarted; drop what was cached and read it again.",
            );
            let _ = proxy::write_with_deadline(&mut client, &answer, deadline);
            return;
        }
    }
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
                    seats: Arc::clone(&door.seats),
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


