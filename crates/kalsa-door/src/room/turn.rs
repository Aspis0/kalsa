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
//!
//! Two failures heal themselves before anyone is told. The engine
//! refusing a request as too large halves the transcript and tries again,
//! down to the newest message alone. An engine error or a broken stream
//! is retried once, fresh. A turn announces a failure only when the
//! healing did not help — and patience is the same story: a turn may run
//! as long as it lives, and what ends it is sixty seconds of silence from
//! the engine, not a clock on the whole answer.

use std::io::{BufRead, BufReader};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::sync::Arc;
use std::time::{Duration, Instant};

use kalsa_room::{AiEvent, Entry, MediaKind, MemberId};
use serde_json::json;

use crate::devices::DeviceId;
use crate::proxy::{self, Shared};
use crate::response;
use crate::room::answers::name_of;
use crate::room::prefill::Prefill;
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

/// The smallest transcript a too-large retry will carry: the newest
/// message alone. Below this there is nothing to halve.
const MIN_TRANSCRIPT: usize = 1;

/// The most images one turn may carry to the model, and the token cost of
/// each — the engine's own `--image-max-tokens`, estimated at four bytes a
/// token like the transcript's budget. The transcript shrinks by the same
/// bytes the images spend.
const MAX_TURN_IMAGES: usize = 8;
const IMAGE_TOKEN_BYTES: usize = 560 * 4;
/// The most still frames one video may lend the turn, the same cap its
/// upload was held to.
const FRAMES_PER_VIDEO: usize = 4;

/// How long a turn waits between looks for a free seat before it says so
/// again.
const SEAT_POLL: Duration = Duration::from_secs(2);

/// How long one engine read may block before the driver checks that its
/// turn is still alive.
const READ_SLICE: Duration = Duration::from_secs(1);

/// How long the engine may go without a sign of work before the turn is a
/// stall. Answer content and prefill reports are work (see `prefill`);
/// transport keep-alives are not. Tests shrink it through [`stall_for`].
const STALL_PATIENCE: Duration = Duration::from_secs(60);

/// The stall seam: a process-wide override in milliseconds, because the
/// test sets it on its own thread and the driver reads it on its. Zero
/// means the constant.
#[cfg(test)]
static STALL_OVERRIDE_MILLIS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn stall_patience() -> Duration {
    #[cfg(test)]
    {
        let millis = STALL_OVERRIDE_MILLIS.load(std::sync::atomic::Ordering::SeqCst);
        if millis > 0 {
            return Duration::from_millis(millis);
        }
    }
    STALL_PATIENCE
}

/// Holds the stall override for one test. The override is process-wide, so
/// the tests that set it take turns, and it is cleared however the test ends.
#[cfg(test)]
pub(crate) struct StallGuard(std::sync::MutexGuard<'static, ()>);

#[cfg(test)]
static STALL_SEAM: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
pub(crate) fn stall_for(duration: Duration) -> StallGuard {
    let turn = STALL_SEAM.lock().unwrap_or_else(|e| e.into_inner());
    STALL_OVERRIDE_MILLIS.store(
        duration.as_millis() as u64,
        std::sync::atomic::Ordering::SeqCst,
    );
    StallGuard(turn)
}

#[cfg(test)]
impl Drop for StallGuard {
    fn drop(&mut self) {
        STALL_OVERRIDE_MILLIS.store(0, std::sync::atomic::Ordering::SeqCst);
    }
}

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
const EMPTY_ANSWER: (&str, &str) = ("empty_answer", "Kalsa had no answer to that.");
const COULD_NOT_START: (&str, &str) = ("could_not_start", "Kalsa couldn't start. Try again.");
const ENGINE_PROBLEM: (&str, &str) = (
    "engine_problem",
    "Kalsa ran into a problem on this computer and couldn't answer. Ask again.",
);
const SEAT_TIMEOUT: (&str, &str) = (
    "seat_timeout",
    "Kalsa waited for a turn at the engine and gave up. Ask again.",
);

/// The room's own seat at the engine: the fixed device id the door mints
/// into its set when it is given a room. A seat of its own, because the
/// host's seat is the host's private chat and a guest does not borrow it.
pub(crate) const ROOM_DEVICE: u32 = u32::MAX;

/// Starts the queue's driver for a turn that `submit` began. One at a
/// time by construction: the room only answers `Starts` when nothing runs.
pub(crate) fn spawn(door: &Arc<RoomDoor>, shared: &Arc<Shared>, member: MemberId, turn: u64) {
    let driving = Arc::clone(door);
    let shared = Arc::clone(shared);
    let spawned = std::thread::Builder::new()
        .name("kalsa-door-room-turn".into())
        .spawn(move || drive(&driving, &shared, member, turn));
    if spawned.is_err() {
        log::info!("room turn finished: turn {turn} reason could_not_start");
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
        // The app's log carries the turn's phases and their stable reason
        // codes — ids and turn numbers only, never a word anyone said.
        log::info!("room turn started: member {} turn {turn}", member.wire());
        let reason = run_one_turn(door, shared, turn);
        log::info!("room turn finished: turn {turn} reason {reason}");
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

/// How one request to the engine ended.
enum Exchange {
    Answered(String),
    /// The turn was withdrawn or stopped under the request; nothing is
    /// stored and nothing is said — the withdrawal said it.
    Abandoned,
    /// The engine refused the request as too large; the transcript budget
    /// must come down and the request go again. Nobody is told: the room
    /// heals this itself, and the `read` count on the answer that lands
    /// says what the healing cost.
    TooLarge,
    /// Any other engine error, or a stream that broke. Retried once.
    Failed,
}

/// One turn, from the thinking frame to its end. The `&'static str` is the
/// stable reason code the log carries; the room is told only what the
/// publish calls along the way said.
fn run_one_turn(door: &Arc<RoomDoor>, shared: &Arc<Shared>, turn: u64) -> &'static str {
    publish(door.room.clone(), "thinking", None);
    // Read once per turn, never cached across turns: whether the model can
    // see is the engine's own answer, and a model switch is believed at
    // the very next call. An engine that does not answer is blind — the
    // honest default.
    let vision = engine_vision(shared.port);
    let mut budget = budget_of(shared.slot_context);
    // One free retry for an engine problem: a stream that broke, a socket
    // that died, an error that is not about size. The second failure is
    // the one the room is told about.
    let mut engine_retries = 1;
    loop {
        if !door.room.turn_alive(turn) {
            return "cancelled";
        }
        let (messages, read) = transcript(door, shared, budget, vision);
        let mut said_waiting = false;
        let waiting_since = Instant::now();
        let lease = loop {
            if !door.room.turn_alive(turn) {
                return "cancelled";
            }
            match shared.set.lease(DeviceId::new(ROOM_DEVICE)) {
                Ok(lease) => {
                    // A seat taken from a device is a handover the disk tier
                    // must hear about before the room's prompt writes into
                    // the slot (see `paging::Chats::handover`): the evicted
                    // chat is saved under its own name and the slot stops
                    // being named for it, or the idle tick would write the
                    // room's words into that chat's file and the evicted
                    // device's next activate would find them as its own. A
                    // save the engine refuses ends the turn with the
                    // engine-problem note — the same closure activate gives
                    // a switch it could not save for — and nothing was sent
                    // to the engine, so the slot still holds what the tier
                    // says it holds.
                    if let Some(evicted) = lease.evicted() {
                        let to = DeviceId::new(ROOM_DEVICE);
                        match shared
                            .chats
                            .handover(&shared.set, lease.slot(), evicted, shared.port)
                        {
                            Ok(saved) => log::info!(
                                "{}",
                                crate::audit::line::handover_line(
                                    lease.slot(),
                                    evicted,
                                    to,
                                    saved,
                                    None
                                )
                            ),
                            Err(error) => {
                                log::warn!(
                                    "{}",
                                    crate::audit::line::handover_line(
                                        lease.slot(),
                                        evicted,
                                        to,
                                        false,
                                        Some(error.code())
                                    )
                                );
                                publish(door.room.clone(), "refused", Some(ENGINE_PROBLEM));
                                return "handover_failed";
                            }
                        }
                    }
                    break lease;
                }
                // No seat, no failure: the call keeps its place and says
                // what it is waiting for, which is a computer, not a
                // model — and the wait is bounded (the door's own seat
                // clock), because a call that waits forever is a lie the
                // Room keeps on screen.
                Err(LeaseError::NoRoom) => {
                    if waiting_since.elapsed() >= shared.clocks.seat_wait {
                        publish(door.room.clone(), "refused", Some(SEAT_TIMEOUT));
                        return "seat_timeout";
                    }
                    if !said_waiting {
                        said_waiting = true;
                        log::info!("room turn waiting for a seat: turn {turn}");
                    }
                    publish(door.room.clone(), "waiting", Some(BUSY_WAITING));
                    std::thread::sleep(SEAT_POLL);
                }
                // The room's seat is minted into the set with the room
                // itself; not held means the door was built without it.
                Err(LeaseError::NotHeld) => {
                    publish(door.room.clone(), "refused", Some(UNAVAILABLE));
                    return "unavailable";
                }
            }
        };
        let Some(salt) = shared.set.cache_salt(DeviceId::new(ROOM_DEVICE)) else {
            publish(door.room.clone(), "refused", Some(UNAVAILABLE));
            return "unavailable";
        };
        match ask_the_engine(door, shared, turn, &lease, &salt, &messages) {
            Exchange::Answered(answer) => {
                if answer.is_empty() {
                    publish(door.room.clone(), "refused", Some(EMPTY_ANSWER));
                    return "empty_answer";
                }
                let _ = door.room.post_ai(&answer, read);
                door.room.publish_ai(AiEvent::Status {
                    state: "done",
                    note_code: None,
                    note: None,
                });
                return "done";
            }
            // Too large for the engine: halve and go again, down to the
            // newest message alone. Only when even that is refused is the
            // room told — and told as an engine problem, because the
            // healing had its chance and the size was never the room's
            // to fix by dropping more of it.
            Exchange::TooLarge => match halve_budget(door, shared, budget) {
                Some(smaller) => {
                    budget = smaller;
                    continue;
                }
                None => {
                    publish(door.room.clone(), "refused", Some(ENGINE_PROBLEM));
                    return "engine_problem";
                }
            },
            Exchange::Abandoned => return "cancelled",
            Exchange::Failed => {
                if engine_retries > 0 {
                    engine_retries -= 1;
                    continue;
                }
                publish(door.room.clone(), "refused", Some(ENGINE_PROBLEM));
                return "engine_problem";
            }
        }
    }
}

/// One streamed request to the engine, from the head write to the terminal
/// event. The lease is held for the whole exchange: the engine binds the
/// slot for the stream (it selects by the door's private header and holds
/// the slot through generation), and the door's accounting stays true for
/// as long as the engine's does.
fn ask_the_engine(
    door: &Arc<RoomDoor>,
    shared: &Arc<Shared>,
    turn: u64,
    lease: &crate::slots::SlotLease<'_>,
    salt: &[u8; 32],
    messages: &serde_json::Value,
) -> Exchange {
    let body = json!({
        "model": "kalsa-room",
        "messages": messages,
        "stream": true,
        // The prompt's prefill, reported as it goes: a long history on a slow
        // computer is a stream that is working, not a silence.
        "return_progress": true,
    });
    let body = serde_json::to_vec(&body).expect("the turn's request always serializes");
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, shared.port));
    let mut engine = match TcpStream::connect_timeout(&address, Duration::from_secs(5)) {
        Ok(engine) => engine,
        Err(_) => return Exchange::Failed,
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
    crate::request::private_headers(&mut head, lease.slot(), salt);
    head.extend_from_slice(b"\r\n");
    head.extend_from_slice(&body);
    if proxy::write_with_deadline(&mut engine, &head, Instant::now() + Duration::from_secs(30))
        .is_err()
    {
        return Exchange::Failed;
    }
    log::info!("room turn request sent: turn {turn}");
    let mut reader = BufReader::new(engine);
    let mut answer = String::new();
    let mut answered = false;
    // The stall clock follows work — answer content, and prefill reports while
    // the prompt is being read — not transport keep-alives. There is no clock
    // on the whole answer: a long, live answer is never cut.
    let mut last_work = Instant::now();
    let stall = stall_patience();
    let mut allowed = stall;
    let mut prefill = Prefill::new();
    loop {
        if !door.room.turn_alive(turn) {
            // The engine socket closes with this scope; a half answer is
            // discarded, never stored — the room does not keep words the
            // model was still choosing.
            return Exchange::Abandoned;
        }
        let mut line = String::new();
        let _ = reader.get_ref().set_read_timeout(Some(READ_SLICE));
        match reader.read_line(&mut line) {
            // The socket ended without the terminal event: the stream is
            // truncated — the desktop chat reports a stream that ends
            // without [DONE] and never announces it complete, and neither
            // does the room.
            Ok(0) => return Exchange::Failed,
            Ok(_) => {}
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                if last_work.elapsed() >= allowed {
                    return Exchange::Failed;
                }
                continue;
            }
            Err(_) => return Exchange::Failed,
        }
        let mut worked = false;
        if let Some(payload) = line.strip_prefix("data: ") {
            let payload = payload.trim_end();
            if payload == "[DONE]" {
                // The terminal event was seen: the answer's own end, and the
                // socket's close after it changes nothing.
                return Exchange::Answered(answer);
            }
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
                // A prefill report is work: it restarts the clock with the
                // gap the engine's own pace allows, and carries no words.
                if let Some(progress) = value.get("prompt_progress").filter(|p| !p.is_null()) {
                    worked = true;
                    allowed = prefill.report(progress, stall);
                }
                // Content only: reasoning is the computer's own channel — the
                // desktop chat shows it beside the answer, the room carries the
                // answer alone, and no reasoning token is streamed or stored.
                if let Some(text) = value
                    .pointer("/choices/0/delta/content")
                    .and_then(|content| content.as_str())
                    .filter(|text| !text.is_empty())
                {
                    worked = true;
                    allowed = stall;
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
            }
        } else {
            // The status line: a refusal for size halves the transcript
            // and goes again; any other refusal is a failure like a
            // broken stream.
            if line.starts_with("HTTP/1.") {
                let code = line.split_whitespace().nth(1).unwrap_or("?");
                if code == "400" || code == "413" {
                    return Exchange::TooLarge;
                }
                if code != "200" {
                    return Exchange::Failed;
                }
            }
        }
        if worked {
            last_work = Instant::now();
        } else if last_work.elapsed() >= allowed {
            return Exchange::Failed;
        }
    }
}

/// The prompt budget in bytes, from the per-slot context the launch
/// actually funded (`--ctx-size / --parallel`), including the system
/// prompt. Tokens are estimated at four bytes each — no tokenizer sits in
/// this crate, and the truncation marker says what that bought either way.
fn budget_of(slot_context: Option<u64>) -> usize {
    match slot_context {
        Some(tokens) => ((tokens.saturating_mul(BUDGET_SHARE) / 100) as usize).saturating_mul(4),
        None => FALLBACK_BUDGET,
    }
}

/// The transcript window `budget` carries, newest-first into the budget.
/// One shape, shared by the request builder and the halving step, so both
/// agree on what a budget buys.
fn window(door: &Arc<RoomDoor>, shared: &Arc<Shared>, budget: usize) -> (Vec<Entry>, usize) {
    let entries = door.room.entries_for_ai();
    let devices = shared.set.current();
    // Cloned, not borrowed: the window is one turn's working set, the
    // room's transcript is household-sized, and one turn runs at a time.
    let mut kept: Vec<Entry> = Vec::new();
    let mut bytes = SYSTEM_PROMPT.len();
    for entry in entries.iter().rev() {
        let name = frame_name(&door.room, &devices, entry.member);
        let cost = name.len() + entry.text.len() + 8;
        if bytes + cost > budget && !kept.is_empty() {
            break;
        }
        bytes += cost;
        kept.push(entry.clone());
    }
    (kept, bytes)
}

/// The next smaller budget: the bytes of half the entries the current one
/// carried, so a refusal shrinks the room by what the engine named too
/// large. `None` when there is nothing left to halve — the newest message
/// alone is the floor, and a budget that cannot carry it cannot shrink.
fn halve_budget(door: &Arc<RoomDoor>, shared: &Arc<Shared>, budget: usize) -> Option<usize> {
    let (kept, _) = window(door, shared, budget);
    let half = kept.len() / 2;
    if half < MIN_TRANSCRIPT {
        return None;
    }
    // The newest `half` entries, in arrival order, sum to the budget that
    // carries exactly them.
    let mut older: Vec<Entry> = kept[..half].to_vec();
    older.reverse();
    let devices = shared.set.current();
    let bytes = older
        .iter()
        .map(|entry| {
            let name = frame_name(&door.room, &devices, entry.member);
            name.len() + entry.text.len() + 8
        })
        .sum::<usize>()
        .saturating_add(SYSTEM_PROMPT.len());
    Some(bytes.max(SYSTEM_PROMPT.len() + 1))
}

/// The transcript one turn is built on, newest-first into the budget, then
/// reversed to speaking order: the oldest messages are the ones that fall
/// off, and `read` is the honest count of what stayed. The AI's view has
/// no member's join floor — the room it answers in is one room.
///
/// With vision, the room's own pictures ride beside the words: each
/// member's message becomes a text part and `image_url` parts, the images
/// chosen newest first (a video lends its still frames), the whole set
/// capped, and the transcript budget shrunk by the tokens they spend. A
/// blob the shelf cannot produce does not ride — the text part still says
/// what was said.
fn transcript(
    door: &Arc<RoomDoor>,
    shared: &Arc<Shared>,
    budget: usize,
    vision: bool,
) -> (serde_json::Value, u32) {
    let (windowed, _) = window(door, shared, budget);
    let images = if vision {
        turn_images(&windowed, budget)
    } else {
        Vec::new()
    };
    let (mut kept, _) = window(door, shared, budget - images.len() * IMAGE_TOKEN_BYTES);
    let devices = shared.set.current();
    kept.reverse();
    let read = kept.len() as u32;
    let mut messages = vec![json!({"role": "system", "content": SYSTEM_PROMPT})];
    for entry in kept {
        let name = frame_name(&door.room, &devices, entry.member);
        let text = format!("[{name}] {}", entry.text);
        let mut parts = Vec::new();
        if vision {
            for image in images.iter().filter(|image| image.seq == entry.seq) {
                if let Some(uri) = data_uri(&door.room, &image.id) {
                    parts.push(json!({"type": "image_url", "image_url": {"url": uri}}));
                }
            }
        }
        if entry.member == MemberId::Ai {
            messages.push(json!({"role": "assistant", "content": entry.text}));
        } else if parts.is_empty() {
            messages.push(json!({"role": "user", "content": text}));
        } else {
            let mut content = vec![json!({"type": "text", "text": text})];
            content.extend(parts);
            messages.push(json!({"role": "user", "content": content}));
        }
    }
    (json!(messages), read)
}

/// One image the turn may carry: the transcript entry it belongs to, and
/// the blob that holds its bytes.
struct TurnImage {
    seq: u64,
    id: String,
}

/// The turn's images, newest first: every member entry's own pictures, a
/// video lending its still frames, all under the turn's cap and the
/// budget's room. The first entry the window always keeps is protected —
/// the images never eat the message the turn is about.
fn turn_images(windowed: &[Entry], budget: usize) -> Vec<TurnImage> {
    let mut out: Vec<TurnImage> = Vec::new();
    for entry in windowed {
        if entry.member == MemberId::Ai {
            continue;
        }
        for asset in &entry.media {
            let frames: Box<dyn Iterator<Item = &String>> = match asset.kind {
                MediaKind::Image => Box::new(std::iter::once(&asset.id)),
                MediaKind::Video => Box::new(asset.frames.iter().take(FRAMES_PER_VIDEO)),
            };
            for id in frames {
                let spent = (out.len() + 1) * IMAGE_TOKEN_BYTES;
                if out.len() >= MAX_TURN_IMAGES || spent + SYSTEM_PROMPT.len() > budget {
                    return out;
                }
                out.push(TurnImage {
                    seq: entry.seq,
                    id: id.clone(),
                });
            }
        }
    }
    out
}

/// The data: URI one image rides in on, read from the shelf the room
/// keeps. The room's own reader — no join floor binds the AI's turn, the
/// same rule its transcript runs on.
fn data_uri(room: &kalsa_room::Room, id: &str) -> Option<String> {
    use base64::Engine as _;
    let (mime, bytes) = room.media_bytes(id)?;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// Whether the engine can see: its `/props` says so, `modalities` naming
/// the media it takes. Absent, or not exactly true, is cannot — the same
/// rule every reader of that answer runs. Five seconds, once a turn.
fn engine_vision(port: u16) -> bool {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let deadline = Instant::now() + Duration::from_secs(5);
    let Ok(mut engine) = TcpStream::connect_timeout(&address, Duration::from_secs(5)) else {
        return false;
    };
    let head =
        format!("GET /props HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if proxy::write_with_deadline(&mut engine, head.as_bytes(), deadline).is_err() {
        return false;
    }
    let Ok(head) = response::read_upstream_head(&mut engine, deadline, crate::PATIENCE, None)
    else {
        return false;
    };
    if !head.raw.starts_with(b"HTTP/1.1 200") {
        return false;
    }
    let Ok(body) = response::read_body(&mut engine, &head, deadline) else {
        return false;
    };
    serde_json::from_slice::<serde_json::Value>(&body)
        .ok()
        .and_then(|props| {
            props
                .get("modalities")
                .and_then(|modalities| modalities.get("vision"))
                .and_then(|vision| vision.as_bool())
        })
        .unwrap_or(false)
}

/// The name as the model reads it: the brackets that frame a speaker are
/// stripped from the name itself, so an owner's label cannot close its
/// bracket and forge another speaker. Member-chosen names refuse the
/// characters outright; the strip remains for the labels, which their
/// owner never chose to be framing.
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
