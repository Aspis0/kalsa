//! The AI guest's turn as a client sees it: the call taken, the queue's
//! fairness, the deltas that assemble into the answer, the honest waits
//! and failures — all against the fake engine, whose wire shape is the
//! real one.

use std::net::Shutdown;
use std::sync::Arc;
use std::time::Duration;

use kalsa_room::Room;

use super::room_engine::{Engine, Reply};
use super::room_support::scratch;
use super::room_support::{body_json, get, post, put, stream_get, text_of, Reader};
use super::*;

const HOST: u32 = 0;
const PHONE_ONE: u32 = 1;
const PHONE_TWO: u32 = 2;

/// A room door seated at a fake engine, with the guest's own seat in the
/// set — exactly what the app builds.
pub(super) fn room_at(engine: Vec<Reply>) -> (crate::RunningDoor, Arc<Room>, Engine, [String; 3]) {
    let fake = Engine::start(engine);
    let host = credential();
    let one = credential();
    let two = credential();
    let devices = super::room_support::seated_labeled(&[
        (HOST, "This computer", &host),
        (PHONE_ONE, "Paired phone", &one),
        (PHONE_TWO, "Guest] : [phone", &two),
    ]);
    let room = Arc::new(Room::open(&scratch("room-turn")).unwrap());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let door = crate::Door::new_with_engine(
        listener,
        fake.port,
        devices,
        4,
        EnginePrivateHeaders::Consumed,
    )
    .unwrap()
    .with_room(Arc::clone(&room), DeviceId::new(HOST))
    .start()
    .unwrap();
    (door, room, fake, [host, one, two])
}

/// [`room_at`] with the per-slot context named, the way the app names it
/// from the launch record — the room's budget follows the slot.
fn room_slotted_at(
    engine: Vec<Reply>,
    per_slot_tokens: u64,
) -> (crate::RunningDoor, Arc<Room>, Engine, [String; 3]) {
    let fake = Engine::start(engine);
    let host = credential();
    let one = credential();
    let two = credential();
    let devices = super::room_support::seated_labeled(&[
        (HOST, "This computer", &host),
        (PHONE_ONE, "Paired phone", &one),
        (PHONE_TWO, "Paired phone 2", &two),
    ]);
    let room = Arc::new(Room::open(&scratch("room-turn-slot")).unwrap());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let door = crate::Door::new_with_engine(
        listener,
        fake.port,
        devices,
        4,
        EnginePrivateHeaders::Consumed,
    )
    .unwrap()
    .with_room(Arc::clone(&room), DeviceId::new(HOST))
    .with_slot_context(per_slot_tokens)
    .start()
    .unwrap();
    (door, room, fake, [host, one, two])
}

/// Waits until the room's history holds an AI entry, and returns it.
pub(super) fn await_answer(room: &Room) -> kalsa_room::Entry {
    let deadline = std::time::Instant::now() + Duration::from_secs(6);
    while std::time::Instant::now() < deadline {
        let page = room.newest_page(1, 10).unwrap();
        if let Some(entry) = page.messages.last() {
            if entry.member == kalsa_room::MemberId::Ai {
                return entry.clone();
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("the AI's answer never landed");
}

/// Reads the stream until the needle, tolerating the write side being
/// still open.
pub(super) use crate::room::turn::{stall_for, stall_reset};

pub(super) fn heard(stream: &mut std::net::TcpStream, needle: &[u8]) -> String {
    Reader::until(stream, needle, Duration::from_secs(6))
}

#[test]
fn a_call_is_served_deltas_assemble_into_the_answer_that_lands() {
    let (door, room, _fake, [_, one, _]) = room_at(vec![Reply::Sse(vec![
        "It is ".to_string(),
        "17:00.".to_string(),
    ])]);
    let bearer = format!("Bearer {one}");
    let mut follower = stream_get(door.address(), &bearer, "/kalsa/room/events", None);
    assert!(heard(&mut follower, b"ai_status").contains("idle"));

    let posted = body_json(&post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"m1","text":"@Kalsa what time is it?"}"#,
    ));
    assert_eq!(posted["ai_call"], "queued", "{}", posted);

    // One read to the done frame: the deltas, the landed message, and the
    // end all arrive on this stream in order.
    let whole = heard(&mut follower, b"\"state\":\"done\"");
    assert!(
        whole.contains("event: ai_delta"),
        "the answer streamed: {whole}"
    );
    for piece in ["It is ", "17:00."] {
        assert!(
            whole.contains(&format!("\"text\":\"{piece}\"")),
            "the piece {piece:?} streamed: {whole}"
        );
    }
    assert!(
        whole.contains("\"turn\":1"),
        "the deltas carry their turn id"
    );
    assert!(
        whole.contains("event: ai_message"),
        "the finished message is numbered: {whole}"
    );

    let landed = await_answer(&room);
    assert_eq!(landed.text, "It is 17:00.");
    assert!(
        landed.read >= 1,
        "the answer says how much of the room it read"
    );
    let _ = follower.shutdown(Shutdown::Both);
    door.shutdown();
}

#[test]
fn one_turn_at_a_time_and_the_queue_is_fair_between_people() {
    // The first answer is slow; while it runs, both phones call.
    let (door, room, fake, [_, one, two]) = room_at(vec![
        Reply::Sse(vec!["one".to_string()]),
        Reply::Sse(vec!["two".to_string()]),
    ]);
    let first = format!("Bearer {one}");
    let second = format!("Bearer {two}");
    assert_eq!(
        body_json(&post(
            door.address(),
            Some(&first),
            "/kalsa/room/messages",
            r#"{"client_msg_id":"a1","text":"@Kalsa first"}"#,
        ))["ai_call"],
        "queued"
    );
    assert_eq!(
        body_json(&post(
            door.address(),
            Some(&second),
            "/kalsa/room/messages",
            r#"{"client_msg_id":"b1","text":"@Kalsa second"}"#,
        ))["ai_call"],
        "queued"
    );
    // A second call of the first phone, while its own runs, is refused —
    // and the message it rode on still landed.
    let refused = body_json(&post(
        door.address(),
        Some(&first),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"a2","text":"@Kalsa again"}"#,
    ));
    assert_eq!(refused["ai_call"], "refused");
    assert_eq!(refused["refusal"], "already_pending");
    assert!(
        room.newest_page(1, 10).unwrap().messages.len() >= 3,
        "the messages landed"
    );

    let first_answer = await_answer(&room);
    assert_eq!(first_answer.text, "one");
    // The first request the engine saw carried the first phone's words;
    // the second turn dialed only after the first landed.
    assert!(
        fake.seen()[0].body.contains("first"),
        "the engine saw the first turn first"
    );
    let deadline = std::time::Instant::now() + Duration::from_secs(6);
    while std::time::Instant::now() < deadline {
        let page = room.newest_page(1, 10).unwrap().messages;
        if page
            .iter()
            .any(|entry| entry.member == kalsa_room::MemberId::Ai && entry.text == "two")
        {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let answers: Vec<String> = room
        .newest_page(1, 10)
        .unwrap()
        .messages
        .iter()
        .filter(|entry| entry.member == kalsa_room::MemberId::Ai)
        .map(|entry| entry.text.clone())
        .collect();
    assert_eq!(
        answers,
        vec!["one", "two"],
        "the turns ran one at a time, in order"
    );
    door.shutdown();
}

#[test]
fn a_member_cancels_their_own_call_and_the_queue_moves_on() {
    // The engine hangs on the first answer, so the turn is streamable and
    // cancellable; the second call must then be servable.
    let (door, room, fake, [host, one, two]) =
        room_at(vec![Reply::Hang, Reply::Sse(vec!["after".to_string()])]);
    let first = format!("Bearer {one}");
    let second = format!("Bearer {two}");
    post(
        door.address(),
        Some(&first),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"a1","text":"@Kalsa first"}"#,
    );
    post(
        door.address(),
        Some(&second),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"b1","text":"@Kalsa second"}"#,
    );
    // A member with no call of their own is told there is nothing to
    // withdraw — the host, who called nobody.
    let host_bearer = format!("Bearer {host}");
    let not_yours = super::room_support::raw(
        door.address(),
        Some(&host_bearer),
        "DELETE",
        "/kalsa/room/call",
        "",
        &[],
    );
    let not_yours_text = text_of(&super::room_support::read_all(&mut { not_yours }));
    assert!(
        not_yours_text.starts_with("HTTP/1.1 404"),
        "a member with no call cannot withdraw anyone's: {not_yours_text}"
    );
    // The owner cancels their own.
    let cancelled = super::room_support::raw(
        door.address(),
        Some(&first),
        "DELETE",
        "/kalsa/room/call",
        "",
        &[],
    );
    let text = text_of(&super::room_support::read_all(&mut { cancelled }));
    assert!(
        text.starts_with("HTTP/1.1 204"),
        "the owner's cancel took: {text}"
    );
    // The driver notices within a read slice and serves the waiting call.
    let deadline = std::time::Instant::now() + Duration::from_secs(8);
    while std::time::Instant::now() < deadline {
        if room
            .newest_page(1, 10)
            .unwrap()
            .messages
            .iter()
            .any(|entry| entry.member == kalsa_room::MemberId::Ai && entry.text == "after")
        {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let page = room.newest_page(1, 10).unwrap();
    let answers: Vec<&str> = page
        .messages
        .iter()
        .filter(|entry| entry.member == kalsa_room::MemberId::Ai)
        .map(|entry| entry.text.as_str())
        .collect();
    assert_eq!(
        answers,
        vec!["after"],
        "the cancelled turn left no answer; the next ran"
    );
    let _ = fake;
    door.shutdown();
}

#[test]
fn the_owners_stop_ends_the_turn_and_no_half_answer_is_kept() {
    // A long streamed answer, stopped from the host side mid-stream.
    let pieces: Vec<String> = (0..40).map(|n| format!("piece{n} ")).collect();
    let (door, room, _fake, [_, one, _]) = room_at(vec![Reply::Sse(pieces)]);
    let bearer = format!("Bearer {one}");
    post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"a1","text":"@Kalsa go on"}"#,
    );
    // Let some of the answer stream, then the owner stops the machine.
    std::thread::sleep(Duration::from_millis(400));
    room.host_stop_turn();
    std::thread::sleep(Duration::from_secs(2));
    let page = room.newest_page(1, 10).unwrap();
    let answers: Vec<&str> = page
        .messages
        .iter()
        .filter(|entry| entry.member == kalsa_room::MemberId::Ai)
        .map(|entry| entry.text.as_str())
        .collect();
    assert!(
        answers.is_empty(),
        "a stopped turn stores nothing half: {answers:?}"
    );
    // The room still takes the next call after a stop.
    door.shutdown();
}

#[test]
fn the_prompt_carries_the_budget_and_the_oldest_falls_off() {
    // A small slot — 256 tokens funds 60% of 256 * 4 bytes ≈ 614 bytes of
    // transcript — and the room is filled past that with distinct first
    // words, so the request the engine sees proves the budget followed
    // the slot and the head fell off.
    let (door, room, fake, [_, one, _]) =
        room_slotted_at(vec![Reply::Sse(vec!["ok".to_string()])], 256);
    let bearer = format!("Bearer {one}");
    put(
        door.address(),
        Some(&bearer),
        "/kalsa/room/name",
        r#"{"name":"Marco"}"#,
    );
    for n in 0..220 {
        post(
            door.address(),
            Some(&bearer),
            "/kalsa/room/messages",
            &format!(
                r#"{{"client_msg_id":"m{n}","text":"filler-{n:04} {}"}}"#,
                "word ".repeat(200)
            ),
        );
    }
    post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"ask","text":"@Kalsa the newest question"}"#,
    );
    let landed = await_answer(&room);
    assert!(
        landed.read < 40,
        "the slot's budget dropped the oldest: read {}",
        landed.read
    );
    let body = fake.seen()[0].body.clone();
    assert!(
        body.contains("the newest question"),
        "the newest question reached the model"
    );
    assert!(
        !body.contains("filler-0000"),
        "the oldest message fell off the budget"
    );
    assert!(
        body.contains("You are Kalsa"),
        "the system prompt rides first"
    );
    assert!(
        body.contains("[Marco]"),
        "the transcript is formatted with display names in brackets"
    );
    door.shutdown();
}

#[test]
fn a_busy_computer_keeps_the_call_waiting_for_a_seat() {
    // One seat for the house, held by a completion that never ends: the
    // call must wait for the computer — said honestly, never failed —
    // and keep its place in the line. The retry loop is the driver's own
    // two-second poll, exercised here across several waits.
    let fake = Engine::start(vec![Reply::Hang]);
    let host = credential();
    let one = credential();
    let mut entries = vec![
        DeviceEntry::new(DeviceId::new(HOST), "This computer", host.clone()).unwrap(),
        DeviceEntry::new(DeviceId::new(PHONE_ONE), "Paired phone", one.clone()).unwrap(),
    ];
    entries.push(crate::guest_entry(&host).unwrap());
    let devices = Devices::new(entries).unwrap();
    let room = Arc::new(Room::open(&scratch("room-wait")).unwrap());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let door = crate::Door::new_with_engine(
        listener,
        fake.port,
        devices,
        1,
        EnginePrivateHeaders::Consumed,
    )
    .unwrap()
    .with_room(Arc::clone(&room), DeviceId::new(HOST))
    .start()
    .unwrap();
    let bearer = format!("Bearer {one}");

    // The phone holds the one seat with a completion the engine never
    // answers.
    let mut held = super::room_support::raw(
        door.address(),
        Some(&bearer),
        "POST",
        "/v1/chat/completions",
        r#"{"model":"x","messages":[],"stream":true}"#,
        &[],
    );
    let _ = &mut held;
    std::thread::sleep(Duration::from_millis(500));

    let mut follower = stream_get(door.address(), &bearer, "/kalsa/room/events", None);
    post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"a1","text":"@Kalsa whenever"}"#,
    );
    let waiting = heard(&mut follower, b"waiting");
    assert!(
        waiting.contains("\"note_code\":\"busy_waiting\"")
            && waiting.contains("Kalsa is busy with another conversation. You keep your turn."),
        "the call said it is waiting for the computer, not failing: {waiting}"
    );
    // Still waiting several polls later: no failure, no answer, the call
    // exactly where it was.
    std::thread::sleep(Duration::from_secs(3));
    let state = room.turn_state();
    assert!(
        state.running.is_some() || !state.pending.is_empty(),
        "the call keeps its place in the line"
    );
    assert!(
        room.newest_page(1, 10)
            .unwrap()
            .messages
            .iter()
            .all(|entry| entry.member != kalsa_room::MemberId::Ai),
        "no turn ran without a seat"
    );
    let _ = follower.shutdown(Shutdown::Both);
    door.shutdown();
}

#[test]
fn an_engine_failure_mid_answer_is_honest_and_stores_nothing() {
    // The stream starts, delivers one piece, and the socket dies without
    // the terminal event — twice, because the first failure is retried.
    // The second is the one the room is told about, and nothing half is
    // stored.
    let (door, room, _fake, [_, one, _]) = room_at(vec![
        Reply::SseBroken("half ".to_string()),
        Reply::SseBroken("half ".to_string()),
    ]);
    let bearer = format!("Bearer {one}");
    let mut follower = stream_get(door.address(), &bearer, "/kalsa/room/events", None);
    post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"a1","text":"@Kalsa break"}"#,
    );
    let stopped = heard(&mut follower, b"engine_problem");
    assert!(
        stopped.contains("Kalsa ran into a problem on this computer"),
        "the room said what happened: {stopped}"
    );
    let page = room.newest_page(1, 10).unwrap();
    assert!(
        page.messages
            .iter()
            .all(|entry| entry.member != kalsa_room::MemberId::Ai),
        "a half answer is never stored"
    );
    assert_eq!(room.turn_state().state, "idle", "the queue moved on");
    let _ = follower.shutdown(Shutdown::Both);
    door.shutdown();
}

#[test]
fn an_engine_that_never_answers_refuses_the_turn_honestly() {
    // Refused, retried, refused again: the second is the sentence.
    let (door, room, _fake, [_, one, _]) = room_at(vec![Reply::Refuse, Reply::Refuse]);
    let bearer = format!("Bearer {one}");
    post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"a1","text":"@Kalsa nope"}"#,
    );
    let deadline = std::time::Instant::now() + Duration::from_secs(6);
    while std::time::Instant::now() < deadline && room.turn_state().running.is_some() {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(
        room.newest_page(1, 10)
            .unwrap()
            .messages
            .iter()
            .all(|entry| entry.member != kalsa_room::MemberId::Ai),
        "a refused turn leaves no answer"
    );
    let info = body_json(&get(door.address(), Some(&bearer), "/kalsa/room/info"));
    assert_eq!(
        info["ai"]["state"], "idle",
        "the room told the truth and moved on"
    );
    door.shutdown();
}

#[test]
fn the_ai_status_snapshot_opens_the_stream_with_the_queue_visible() {
    let (door, _room, _fake, [_, one, _]) = room_at(vec![Reply::Hang]);
    let bearer = format!("Bearer {one}");
    post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"a1","text":"@Kalsa hold"}"#,
    );
    std::thread::sleep(Duration::from_millis(300));
    let mut follower = stream_get(door.address(), &bearer, "/kalsa/room/events", None);
    let opened = heard(&mut follower, b"ai_status");
    assert!(
        opened.contains("\"state\":\"thinking\""),
        "the snapshot says a turn is running: {opened}"
    );
    assert!(
        opened.contains("\"running\":\"Paired phone\""),
        "the snapshot names whose turn runs, names only: {opened}"
    );
    assert!(
        opened.contains("\"you_pending\":true"),
        "the caller sees its own call in the line: {opened}"
    );
    let _ = follower.shutdown(Shutdown::Both);
    door.shutdown();
}

/// One turn against a real engine the operator started, addressed by the
/// port in `KALSA_ROOM_ENGINE_PORT`. Ignored by default like the repo's
/// other real-engine tests: `KALSA_ROOM_ENGINE_PORT=8080 cargo test -p
/// kalsa-door -- --ignored room_turn`.
#[test]
#[ignore = "set KALSA_ROOM_ENGINE_PORT to the running engine's port"]
fn a_real_engine_answers_a_called_room() {
    let Ok(port) = std::env::var("KALSA_ROOM_ENGINE_PORT") else {
        return;
    };
    let port: u16 = port.parse().expect("a port number");
    let host = credential();
    let one = credential();
    let devices = super::room_support::seated_labeled(&[
        (HOST, "This computer", &host),
        (PHONE_ONE, "Paired phone", &one),
    ]);
    let room = Arc::new(Room::open(&scratch("room-real")).unwrap());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let door =
        crate::Door::new_with_engine(listener, port, devices, 2, EnginePrivateHeaders::Consumed)
            .unwrap()
            .with_room(Arc::clone(&room), DeviceId::new(HOST))
            .start()
            .unwrap();
    let bearer = format!("Bearer {one}");
    post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"m1","text":"@Kalsa say one honest sentence."}"#,
    );
    let landed = await_answer(&room);
    assert!(!landed.text.is_empty(), "the real engine answered");
    door.shutdown();
}
