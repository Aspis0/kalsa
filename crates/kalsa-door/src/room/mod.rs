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
mod media;
mod prefill;
mod routes;
mod stream;
pub(crate) mod turn;

use answers::{json_error, json_ok, json_ok_no_content, store_failed};
use routes::{floor_of, history, info, post, set_name, PostContext};

use std::net::TcpStream;
use std::sync::Arc;
use std::time::Instant;

use kalsa_room::Room;

use crate::devices::{DeviceEntry, DeviceId, Devices};
use crate::proxy;
use crate::request::UnsealedHead;

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
    /// The device id this door seats the host at — the desktop webview's
    /// own seat, the one device whose answers are never kept for a resume.
    pub(crate) fn host(&self) -> DeviceId {
        self.host
    }
}

/// The AI guest's entry in the device set: the reserved top device id, a
/// label of its own name, and a credential derived from the host's — a
/// labeled SHA-256, the same shape as the door's own cache salts. Derived,
/// not random, because the app rebuilds its device set every second and a
/// fresh secret each time would look like a change and churn the door; a
/// stable derivation keeps the set equal until the host's own credential
/// changes. Held in the set, written nowhere, never sent to a phone — a
/// client cannot derive it without the host's secret.
pub fn guest_entry(host_credential: &str) -> Option<DeviceEntry> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(b"kalsa-room-seat-v1");
    hasher.update(host_credential.as_bytes());
    let digest: [u8; 32] = hasher.finalize().into();
    let credential: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    DeviceEntry::new(DeviceId::new(turn::ROOM_DEVICE), "Kalsa", credential).ok()
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
const NO_CALL_TO_WITHDRAW: &str = "You have no question waiting.";

pub(super) fn owns(target: &[u8]) -> bool {
    path_of(target).starts_with(b"/kalsa/room/")
}

/// The path without its query string: the routes are exact, the query is
/// each route's own to read.
fn path_of(target: &[u8]) -> &[u8] {
    target.split(|byte| *byte == b'?').next().unwrap_or(target)
}

/// What the door hands a room request it has authenticated: the head, the
/// device the credential named, and the door's shared state — the set, the
/// stop flag, the room, and the engine port the room's turns dial.
pub(super) struct Request<'a> {
    pub(super) head: &'a UnsealedHead,
    pub(super) device: DeviceId,
    pub(super) devices: &'a Devices,
    pub(super) room: Option<&'a Arc<RoomDoor>>,
    pub(super) shared: &'a Arc<crate::proxy::Shared>,
}

pub(super) fn serve(mut client: TcpStream, request: Request<'_>, deadline: Instant) {
    let Request {
        head,
        device,
        devices,
        room: room_door,
        shared,
    } = request;
    let origin = head.origin.as_deref();
    let arrival = Instant::now();
    let Some(door) = room_door else {
        let _ = proxy::discard_request_body(&mut client, head.body_length, deadline);
        let answer = json_error(503, origin, "no_room", NO_ROOM);
        let _ = proxy::answer_to(&mut client, &answer, deadline);
        return;
    };
    // The epoch guard, once, ahead of every route AND of the enrollment:
    // a phone that cached a different transcript is told to drop it and
    // refetch before it reads one byte of this one or mints anything in
    // it — history and posts included, because a reused seq on a stale
    // cache is wrong in both. An absent header is a phone that cached
    // nothing and checks nothing.
    if let Some(held) = head.room_epoch.as_deref() {
        if held != door.room.epoch().as_bytes() {
            let _ = proxy::discard_request_body(&mut client, head.body_length, deadline);
            let answer = json_error(
                409,
                origin,
                "epoch_changed",
                "The room's transcript restarted; drop what was cached and read it again.",
            );
            let _ = proxy::answer_to(&mut client, &answer, deadline);
            return;
        }
    }
    let Ok(member) = door.room.enroll(device.value()) else {
        let _ = proxy::discard_request_body(&mut client, head.body_length, deadline);
        let answer = json_error(500, origin, "internal", store_failed());
        let _ = proxy::answer_to(&mut client, &answer, deadline);
        return;
    };
    match (path_of(&head.target), &head.method[..]) {
        (b"/kalsa/room/info", b"GET") => {
            let _ = proxy::discard_request_body(&mut client, head.body_length, deadline);
            let answer = info(door, devices, member);
            let _ = proxy::answer_to(&mut client, &json_ok(origin, &answer), deadline);
        }
        (b"/kalsa/room/history", b"GET") => {
            let _ = proxy::discard_request_body(&mut client, head.body_length, deadline);
            let answer = history(door, devices, member, &head.target, origin);
            let _ = proxy::answer_to(&mut client, &answer, deadline);
        }
        (b"/kalsa/room/messages", b"POST") => {
            let answer = post(
                &mut client,
                door,
                PostContext {
                    shared,
                    head,
                    member,
                    origin,
                    deadline,
                    arrival,
                },
            );
            let _ = proxy::answer_to(&mut client, &answer, deadline);
        }
        (b"/kalsa/room/call", b"DELETE") => {
            let _ = proxy::discard_request_body(&mut client, head.body_length, deadline);
            // §5.5: a member withdraws their own call — pending, or the
            // turn it started. Nobody withdraws anyone else's.
            match door.room.withdraw_call(member) {
                kalsa_room::Withdrawn::Nothing => {
                    let answer = json_error(404, origin, "no_call", NO_CALL_TO_WITHDRAW);
                    let _ = proxy::answer_to(&mut client, &answer, deadline);
                }
                _ => {
                    let _ = proxy::answer_to(&mut client, &json_ok_no_content(origin), deadline);
                }
            }
        }
        (b"/kalsa/room/name", b"PUT") => {
            let answer = set_name(&mut client, door, head, member, origin, deadline);
            let _ = proxy::answer_to(&mut client, &answer, deadline);
        }
        // The media road: reserve at the bare path, then the whole
        // subtree — chunks, completes and downloads — one file's routes.
        (b"/kalsa/room/media", b"POST") => {
            let answer = media::create(&mut client, &door.room, head, member, origin, deadline);
            let _ = proxy::answer_to(&mut client, &answer, deadline);
        }
        (path, _) if path.starts_with(b"/kalsa/room/media/") => {
            let answer = media::serve(&mut client, door, head, member, origin, deadline, path);
            let _ = proxy::answer_to(&mut client, &answer, deadline);
        }
        (b"/kalsa/room/events", b"GET") => {
            // The stream owns the socket from here: it lives on its own
            // thread, because a follower never ends and must not spend a
            // worker the completions need. The request line says so: the
            // head is written on that thread, so the status this worker
            // knows is the one it is handing over.
            if proxy::discard_request_body(&mut client, head.body_length, deadline).is_err() {
                return;
            }
            crate::audit::status(200);
            crate::audit::streamed();
            stream::serve(
                client,
                &door.room,
                stream::Ctx {
                    set: Arc::clone(&shared.set),
                    stop: Arc::clone(&shared.stop),
                    device,
                    host: door.host,
                    seats: Arc::clone(&door.seats),
                },
                member,
                head,
                deadline,
            );
        }
        _ => {
            let _ = proxy::discard_request_body(&mut client, head.body_length, deadline);
            let answer = json_error(404, origin, "not_found", UNKNOWN_ROUTE);
            let _ = proxy::answer_to(&mut client, &answer, deadline);
        }
    }
}
