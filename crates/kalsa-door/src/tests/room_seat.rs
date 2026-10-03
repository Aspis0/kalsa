//! The room's seat at the engine, and how a turn ends: the host-alone
//! call on a one-slot house whose chat was used first, the bound on
//! waiting for a seat, and the last word a finished turn says.

use std::sync::Arc;
use std::time::Duration;

use kalsa_room::{CallTaken, MemberId, Room};

use super::room_engine::{Engine, Reply};
use super::room_support::{post, read_all, scratch, stream_get, Feed};
use super::*;

const HOST: u32 = 0;
const PHONE_ONE: u32 = 1;

/// The app's own house, at a fake engine: the named devices with the
/// room's guest seated beside them — the set the app builds — and
/// `capacity` engine seats, exactly what the launch funded.
fn house_at(
    engine: Vec<Reply>,
    seats: &[(u32, &str, &str)],
    capacity: u32,
    clocks: crate::clocks::Clocks,
) -> (crate::RunningDoor, Arc<Room>, Engine, Vec<String>) {
    let fake = Engine::start(engine);
    let credentials: Vec<String> = seats.iter().map(|(_, _, token)| token.to_string()).collect();
    let devices = super::room_support::seated_labeled(seats);
    let room = Arc::new(Room::open(&scratch("room-seat")).unwrap());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let door = crate::Door::new_with_engine(
        listener,
        fake.port,
        devices,
        capacity,
        EnginePrivateHeaders::Consumed,
    )
    .unwrap()
    .with_clocks(clocks)
    .with_room(Arc::clone(&room), DeviceId::new(seats[0].0))
    .start()
    .unwrap();
    (door, room, fake, credentials)
}

/// The host calls @Kalsa the way the desktop does: the message lands
/// through the room, the call is taken, and the app's own door drives the
/// turn — no room route carries the host's posts.
fn host_calls(door: &crate::RunningDoor, room: &Room, client_msg_id: &str, text: &str) -> u64 {
    room.post(MemberId::Host, client_msg_id, text, true, &[])
        .expect("the host's message lands");
    let turn = match room.submit_call(MemberId::Host, client_msg_id) {
        Ok(CallTaken::Starts(turn)) => turn,
        other => panic!("an empty queue starts the call at once: {other:?}"),
    };
    assert!(
        door.drive_room_turn(MemberId::Host, turn),
        "the door drives its own room's turns"
    );
    turn
}

#[test]
fn a_chat_used_first_leaves_the_room_a_seat_on_a_one_slot_engine() {
    // The owner's machine, reproduced: LFM on CPU, `--parallel 1`, the
    // regular chat used first. The chat's completion takes the engine's
    // only seat through the door and ENDS; the engine sits idle again.
    // Alone in the Room, the host calls @Kalsa the way the desktop drives
    // it. The seat must follow demand: a finished request's lasting
    // assignment may not keep the room's guest off an idle engine, with
    // the call polling every two seconds and nothing ever sent.
    let host_credential = credential();
    let (door, room, fake, _) = house_at(
        vec![
            Reply::Sse(vec!["the chat's own answer".to_string()]),
            Reply::Sse(vec!["ciao".to_string()]),
        ],
        &[(HOST, "This computer", &host_credential)],
        1,
        crate::clocks::Clocks::default(),
    );
    let bearer = format!("Bearer {host_credential}");
    // The chat, first: one whole completion through the door.
    let chat = post(
        door.address(),
        Some(&bearer),
        "/v1/chat/completions",
        r#"{"model":"x","messages":[{"role":"user","content":"hi"}]}"#,
    );
    assert!(
        String::from_utf8_lossy(&chat).contains("the chat's own answer"),
        "the chat's completion ran: {}",
        String::from_utf8_lossy(&chat)
    );
    // The Room, then: the host alone, calling @Kalsa.
    host_calls(&door, &room, "host-1", "@Kalsa ciao");
    let landed = super::room_turn::await_answer(&room);
    assert_eq!(landed.text, "ciao");
    let seen = fake.seen();
    assert_eq!(
        seen.len(),
        2,
        "the engine served the chat and then the room's turn"
    );
    assert!(seen[1].body.contains("ciao"), "the room's words reached the engine");
    door.shutdown();
}

#[test]
fn a_turn_waiting_for_a_seat_ends_after_a_bound_and_says_so() {
    // One seat, held by a completion that streams to its end slowly. The
    // call waits and says what it is waiting for — and, the bound, gives
    // up instead of polling forever: the note names what happened, the
    // queue is idle, and once the seat is free the room answers the next
    // call. The door under test carries its own short seat clock, the way
    // a test gives one door shorter limits and no other door sees it.
    let host_credential = credential();
    let one = credential();
    let pieces: Vec<String> = (0..40).map(|n| format!("piece{n} ")).collect();
    let (door, room, _fake, _) = house_at(
        vec![Reply::Sse(pieces), Reply::Sse(vec!["after".to_string()])],
        &[
            (HOST, "This computer", &host_credential),
            (PHONE_ONE, "Paired phone", &one),
        ],
        1,
        crate::clocks::Clocks::default().seat_wait(Duration::from_millis(300)),
    );
    let bearer = format!("Bearer {one}");
    // The phone holds the one seat with a completion that runs ~4 seconds.
    let mut held = super::room_support::raw(
        door.address(),
        Some(&bearer),
        "POST",
        "/v1/chat/completions",
        r#"{"model":"x","messages":[]}"#,
        &[],
    );
    std::thread::sleep(Duration::from_millis(500));
    let mut follower = stream_get(door.address(), &bearer, "/kalsa/room/events", None);
    // The stream's cursor is taken at attach: wait for the opening frame
    // before the call, so every event the turn publishes is live news and
    // not behind the cursor.
    let mut feed = Feed::new(&mut follower);
    let _ = feed.until(b"ai_status", Duration::from_secs(6));
    host_calls(&door, &room, "host-1", "@Kalsa whenever");
    let waiting = feed.until(b"seat_timeout", Duration::from_secs(10));
    assert!(
        waiting.contains("\"note_code\":\"busy_waiting\""),
        "the wait said what it was for: {waiting}"
    );
    assert!(
        waiting.contains("\"note_code\":\"seat_timeout\"") && waiting.contains("gave up"),
        "the bounded wait ended with a visible note: {waiting}"
    );
    assert_eq!(
        room.turn_state().state,
        "idle",
        "the turn ended instead of waiting forever"
    );
    // The seat's holder finishes; the lease goes with its request.
    read_all(&mut held);
    // The room answers the next call.
    host_calls(&door, &room, "host-2", "@Kalsa di nuovo");
    let landed = super::room_turn::await_answer(&room);
    assert_eq!(landed.text, "after");
    let _ = follower;
    door.shutdown();
}

#[test]
fn a_finished_turns_last_word_reaches_the_room_stream() {
    // Delivery, not publication: the Room's answering line and its Stop
    // button read the status frames the stream DELIVERS, so the last word
    // of a finished turn has to arrive — the idle frame with running null,
    // after the done frame. The room's log orders the two (done is
    // published inside the turn, idle by its end), so a follower attached
    // before the call must deliver idle after done.
    //
    // The reading is read_more and a predicate, never a second `until` on
    // "idle": the stream's opening snapshot is itself an idle frame, and a
    // needle-wait would return on that one without reading another byte —
    // the spin that once read as a delivery flake.
    let host_credential = credential();
    let (door, room, _fake, _) = house_at(
        vec![Reply::Sse(vec!["ciao".to_string()])],
        &[(HOST, "This computer", &host_credential)],
        1,
        crate::clocks::Clocks::default(),
    );
    let bearer = format!("Bearer {host_credential}");
    let mut follower = stream_get(door.address(), &bearer, "/kalsa/room/events", None);
    let mut feed = Feed::new(&mut follower);
    // The snapshot fixes the cursor: everything after this is live news.
    let opened = feed.until(b"ai_status", Duration::from_secs(6));
    assert!(opened.contains("\"state\":\"idle\""), "the stream opened idle: {opened}");
    host_calls(&door, &room, "host-1", "@Kalsa ciao");
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    let delivered = loop {
        feed.read_more(Duration::from_millis(200));
        let whole = feed.history();
        let done_at = whole.rfind("\"state\":\"done\"");
        let last_status = whole.rsplit("event: ai_status").next().unwrap_or("");
        if done_at.is_some()
            && whole[..done_at.expect("checked just above")].contains("event: ai_status")
            && last_status.contains("\"state\":\"idle\"")
            && last_status.contains("\"running\":null")
        {
            break whole;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the turn's end never reached the stream: {whole}"
        );
    };
    assert!(
        delivered.contains("\"state\":\"done\""),
        "the turn's own done frame is in there too: {delivered}"
    );
    assert_eq!(
        room.turn_state().running,
        None,
        "nobody is running after the turn"
    );
    door.shutdown();
}
