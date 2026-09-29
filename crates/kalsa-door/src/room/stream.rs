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

use super::{entry_json, json_error, BAD_LAST_EVENT_ID};
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
/// door, and the device itself.
pub(super) struct Ctx {
    pub(super) set: Arc<DeviceSet>,
    pub(super) stop: Arc<AtomicBool>,
    pub(super) device: DeviceId,
}

pub(super) fn serve(
    mut client: TcpStream,
    room: &Arc<Room>,
    ctx: Ctx,
    last_event_id: Option<&[u8]>,
    client_epoch: Option<&[u8]>,
    origin: Option<&[u8]>,
    deadline: Instant,
) {
    // A cached epoch that is not this room's names a transcript whose seqs
    // mean something else now: the phone is told to drop its cache and
    // refetch, in one explicit refusal rather than a stream of right
    // numbers attached to wrong words.
    if let Some(held) = client_epoch {
        if held != room.epoch().as_bytes() {
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
    // A member's replay never reaches before their join: a Last-Event-ID
    // below it is raised to it, so the replay begins where their history
    // does. The host has no floor.
    let floor = room
        .member_of(ctx.device.value())
        .and_then(|member| room.join_of(member))
        .map(|join| join - 1);
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
    let spawned = std::thread::Builder::new().name("kalsa-door-room-stream".into()).spawn(
        move || follow(Follower { client, room, ctx, cursor, origin, deadline }),
    );
    if spawned.is_err() {
        // No thread, no stream: the socket closes and the phone's next
        // attempt starts a fresh one. The entry it leaves behind is not
        // worth an error body nobody is positioned to read.
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
}

fn follow(follower: Follower) {
    let Follower {
        client,
        room,
        ctx,
        cursor,
        origin,
        deadline,
    } = follower;
    let mut client = client;
    let mut cursor = cursor;
    let cut =
        |ctx: &Ctx| ctx.stop.load(Ordering::SeqCst) || !ctx.set.holds(ctx.device);
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
    // One state snapshot before anything else, so a phone connecting in
    // the middle of a turn knows a turn is running. R2 has no AI: the
    // snapshot is idle, but the first frame a follower reads is the frame
    // R3 will fill.
    let snapshot = b"event: ai_status\ndata: {\"state\":\"idle\",\"running\":null,\"queue\":[],\"who\":null}\n\n";
    if proxy::write_with_deadline(&mut client, snapshot, deadline).is_err() {
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
