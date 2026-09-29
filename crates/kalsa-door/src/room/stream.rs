//! The room's live stream: one thread per follower, framed as SSE by the
//! door itself. Numbered events carry the transcript's seq as the SSE id —
//! the id a phone echoes back as `Last-Event-ID` to replay from — and
//! member news is unnumbered, fetched again through info by anyone who
//! missed it.
//!
//! The thread is cut the moment the door stops or the device leaves the
//! set, the same gate a completion's stream runs behind, and it never
//! holds a worker: a follower never ends, and the workers belong to work
//! that does.

use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use kalsa_room::{Event, MemberEvent, Room, Take};

use super::answers::{entry_json, json_error};
use super::routes::ai_state;
use super::BAD_LAST_EVENT_ID;
use crate::cors;
use crate::devices::{DeviceId, Devices};
use crate::proxy;
use crate::slots::DeviceSet;

/// How long a quiet stream waits before looking for a stop or a cut again.
const SLICE: Duration = Duration::from_secs(1);
/// How long a follower may hear nothing before the door says it is there.
const PING: Duration = Duration::from_secs(15);

/// Serves the events route with the socket in hand: the cursor is resolved
/// first — a bad `Last-Event-ID` is answered as an ordinary refusal, not
/// streamed — and the live follow then owns the socket on its own thread.
/// The stream's cut and its subject, the one bundle the spawned thread
/// keeps: the set that can revoke the device, the flag that stops the
/// door, the device itself, and the follower's seat in the per-device cap.
pub(super) struct Ctx {
    pub(super) set: Arc<DeviceSet>,
    pub(super) stop: Arc<AtomicBool>,
    pub(super) device: DeviceId,
    pub(super) seats: Arc<Seats>,
}

/// How many live streams one device may hold. A phone that reconnects
/// after a network change opens the new one BEFORE the old one dies, so
/// the cap closes the OLDEST — the stream the phone is leaving — and the
/// fresh connection is never the one refused.
const PER_DEVICE: usize = 2;

/// One device's live streams, each by its retire flag. Guarded, small,
/// and only ever touched at open and at close.
#[derive(Default)]
pub struct Seats {
    live: std::sync::Mutex<Vec<(DeviceId, Arc<AtomicBool>)>>,
}

impl Seats {
    /// Takes a seat for a new stream, closing this device's oldest beyond
    /// the cap by setting its retire flag — its thread sees the flag
    /// within a second and closes the socket. Every OTHER device's rows
    /// stay: the cap is per device, and one house's phones do not share
    /// seats.
    fn take(&self, device: DeviceId) -> Arc<AtomicBool> {
        let mut live = self
            .live
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while live.iter().filter(|(held, _)| *held == device).count() >= PER_DEVICE {
            let position = live
                .iter()
                .position(|(held, _)| *held == device)
                .expect("the count above found one");
            let (_, oldest) = live.remove(position);
            oldest.store(true, Ordering::SeqCst);
        }
        let seat = Arc::new(AtomicBool::new(false));
        live.push((device, Arc::clone(&seat)));
        seat
    }

    /// Gives the seat back when its stream ends, so the cap counts the
    /// living only.
    fn give(&self, device: DeviceId, seat: &Arc<AtomicBool>) {
        let mut live = self
            .live
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        live.retain(|(held, flag)| *held != device || !Arc::ptr_eq(flag, seat));
    }
}

pub(super) fn serve(
    mut client: TcpStream,
    room: &Arc<Room>,
    ctx: Ctx,
    member: kalsa_room::MemberId,
    head: &crate::request::UnsealedHead,
    deadline: Instant,
) {
    let (last_event_id, client_epoch, origin) =
        (head.last_event_id.as_deref(), head.room_epoch.as_deref(), head.origin.as_deref());
    // The epoch of the cached seqs was checked ahead of the routes; the
    // stream itself only names the epoch it speaks. A non-numeric
    // Last-Event-ID names nothing and is answered, not streamed.
    let _ = client_epoch;
    // A member's replay never reaches before their join: a Last-Event-ID
    // below it is raised to it, so the replay begins where their history
    // does. The member is the one the door enrolled for this request — not
    // a fresh lookup, which a forget between the two could turn into a
    // stranger's whole transcript. The host has no floor; a member the
    // room cannot place is refused, exactly as history refuses one.
    let floor = match super::floor_of(room, member) {
        Some(join) if member != kalsa_room::MemberId::Host => Some(join - 1),
        Some(_) => None,
        None => {
            eprintln!("kalsa door: a member with no join point opened a stream");
            let answer = json_error(500, origin, "internal", "The room's store failed on disk.");
            let _ = proxy::write_with_deadline(&mut client, &answer, deadline);
            return;
        }
    };
    // A fresh follower starts from now; a reconnect resumes after the seq
    // it last saw. A cursor above the newest claims events that never
    // happened, and a non-numeric one names nothing: both are answered.
    let cursor = match last_event_id {
        None => room.next_cursor(),
        Some(seen) => match std::str::from_utf8(seen)
            .ok()
            .and_then(|seen| seen.parse::<u64>().ok())
        {
            Some(seen) => {
                let seen = floor.map_or(seen, |floor| seen.max(floor));
                match room.resume_after_seq(seen) {
                    Some(cursor) => cursor,
                    None => {
                        let answer = json_error(400, origin, "bad_cursor", BAD_LAST_EVENT_ID);
                        let _ = proxy::write_with_deadline(&mut client, &answer, deadline);
                        return;
                    }
                }
            }
            None => {
                let answer = json_error(400, origin, "bad_request", BAD_LAST_EVENT_ID);
                let _ = proxy::write_with_deadline(&mut client, &answer, deadline);
                return;
            }
        },
    };
    let origin = origin.map(<[u8]>::to_vec);
    let room = Arc::clone(room);
    let seats = Arc::clone(&ctx.seats);
    let device = ctx.device;
    let seat = seats.take(device);
    let spawned = std::thread::Builder::new().name("kalsa-door-room-stream".into()).spawn(
        move || {
            // The guard, not a call at the end: a stream that unwinds
            // still hands its seat back, or the cap would count the dead.
            let _seat_held = SeatGuard {
                seats: Arc::clone(&seats),
                device,
                seat: Arc::clone(&seat),
            };
            follow(Follower {
                client,
                room,
                ctx,
                cursor,
                origin,
                deadline,
                seat,
            });
        },
    );
    if spawned.is_err() {
        // No thread, no stream: the socket closes and the phone's next
        // attempt starts a fresh one. The entry it leaves behind is not
        // worth an error body nobody is positioned to read.
    }
}

/// Returns a follower's seat on every way out of its thread, an unwind
/// included.
struct SeatGuard {
    seats: Arc<Seats>,
    device: DeviceId,
    seat: Arc<AtomicBool>,
}

impl Drop for SeatGuard {
    fn drop(&mut self) {
        self.seats.give(self.device, &self.seat);
    }
}

/// Everything the live follow owns: the socket, the room, the cut, the
/// cursor, and its deadlines. One struct because it is one thing — the
/// follower — moved whole into its thread.
struct Follower {
    client: TcpStream,
    room: Arc<Room>,
    ctx: Ctx,
    cursor: usize,
    origin: Option<Vec<u8>>,
    deadline: Instant,
    /// This stream's retire flag, checked beside the door's own cuts.
    seat: Arc<AtomicBool>,
}

fn follow(follower: Follower) {
    let Follower {
        client,
        room,
        ctx,
        cursor,
        origin,
        deadline,
        seat,
    } = follower;
    let mut client = client;
    let mut cursor = cursor;
    let cut = |ctx: &Ctx| {
        ctx.stop.load(Ordering::SeqCst) || !ctx.set.holds(ctx.device) || seat.load(Ordering::SeqCst)
    };
    let epoch = room.epoch();
    let head = format!(
        "HTTP/1.1 200 OK\r\n{}Content-Type: text/event-stream\r\n\
         Cache-Control: no-cache\r\nKalsa-Room-Epoch: {epoch}\r\n\
         Connection: close\r\n\r\n",
        cors::origin_headers(origin.as_deref())
    )
    .into_bytes();
    // The cut check and the head write are one step: a device revoked in
    // between gets the closed socket, not a stream for a credential that
    // no longer opens anything.
    if cut(&ctx) {
        return;
    }
    if proxy::write_with_deadline(&mut client, &head, deadline).is_err() {
        return;
    }
    // One state snapshot before anything else — the same object `info`
    // answers with, framed — so a phone connecting mid-turn knows a turn
    // is running. R2 has no AI: idle through and through, but the frame
    // R3 fills is first from now on.
    let mut snapshot = b"event: ai_status\ndata: ".to_vec();
    snapshot.extend_from_slice(
        &serde_json::to_vec(&ai_state()).expect("the state always serializes"),
    );
    snapshot.extend_from_slice(b"\n\n");
    if proxy::write_with_deadline(&mut client, &snapshot, deadline).is_err() {
        return;
    }
    let mut out = Vec::new();
    let mut last_write = Instant::now();
    loop {
        if cut(&ctx) || Instant::now() >= deadline {
            return;
        }
        let slice = Instant::now() + SLICE;
        let devices = ctx.set.current();
        match room.read_since(&mut cursor, slice, &mut out) {
            Take::Events => {
                for event in &out {
                    let frame = frame(&room, &devices, event);
                    if proxy::write_with_deadline(&mut client, &frame, deadline).is_err() {
                        return;
                    }
                }
                last_write = Instant::now();
            }
            Take::TimedOut => {
                if last_write.elapsed() >= PING
                    && proxy::write_with_deadline(&mut client, b": ping\n\n", deadline).is_err()
                {
                    return;
                }
            }
            // The cursor was minted by this module against this room; a
            // stream that claims past the end is a bug, and closing is the
            // honest answer.
            Take::BadCursor => return,
        }
        out.clear();
    }
}

/// One event as SSE bytes.
fn frame(room: &Room, devices: &Devices, event: &Event) -> Vec<u8> {
    match event {
        Event::Message(entry) => {
            let event_name = if entry.member == kalsa_room::MemberId::Ai {
                "ai_message"
            } else {
                "message"
            };
            let data = serde_json::to_vec(&entry_json(room, devices, entry))
                .expect("an entry always serializes");
            let mut frame = Vec::with_capacity(data.len() + 48);
            frame.extend_from_slice(
                format!("id: {}\nevent: {event_name}\ndata: ", entry.seq).as_bytes(),
            );
            frame.extend_from_slice(&data);
            frame.extend_from_slice(b"\n\n");
            frame
        }
        Event::Member(event) => {
            let (action, member, name) = match event {
                MemberEvent::Joined { member, name } => ("joined", *member, Some(name.clone())),
                MemberEvent::Renamed { member, name } => ("renamed", *member, Some(name.clone())),
                // The last name the member was known by, which the room
                // keeps for exactly this.
                MemberEvent::Left { member } => ("left", *member, room.name_of(*member)),
            };
            let data = serde_json::json!({
                "action": action,
                "member_id": member.wire(),
                "name": name,
            });
            let data = serde_json::to_vec(&data).expect("a member event always serializes");
            let mut frame = Vec::with_capacity(data.len() + 32);
            frame.extend_from_slice(b"event: member\ndata: ");
            frame.extend_from_slice(&data);
            frame.extend_from_slice(b"\n\n");
            frame
        }
    }
}
