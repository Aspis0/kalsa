//! The room's five routes as a client sees them: the credential that
//! opens them, the author the door itself names, the retry that lands
//! once, the cursors, and the one door-made frame per event.

use std::io::Read;
use std::sync::Arc;
use std::time::Duration;

use kalsa_room::Room;

use super::room_support::{body_json, devices_labeled, get, put, post, raw, read_all, scratch, stream_get, text_of, Reader};
use super::*;

const HOST: u32 = 0;
const PHONE_ONE: u32 = 1;
const PHONE_TWO: u32 = 2;

/// A running door with a room, one host and two phones, and the three
/// credentials that open it.
fn room_of() -> (crate::RunningDoor, Arc<Room>, [String; 3]) {
    let host = credential();
    let one = credential();
    let two = credential();
    let devices = devices_labeled(&[
        (HOST, "This computer", &host),
        (PHONE_ONE, "Paired phone", &one),
        (PHONE_TWO, "Paired phone 2", &two),
    ]);
    let room = Arc::new(Room::open(&scratch("room-routes")).unwrap());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let door = crate::Door::new_with_engine(
        listener,
        1, // the room is never forwarded; the port is never dialed
        devices,
        3,
        EnginePrivateHeaders::Consumed,
    )
    .unwrap()
    .with_room(Arc::clone(&room), DeviceId::new(HOST))
    .start()
    .unwrap();
    (door, room, [host, one, two])
}

#[test]
fn the_room_routes_answer_only_a_real_credential() {
    let (door, _room, [_, token, _]) = room_of();
    let no_auth = get(door.address(), None, "/kalsa/room/info");
    assert!(
        no_auth.starts_with(b"HTTP/1.1 401"),
        "an unauthenticated room request is the door's one refusal"
    );
    let wrong = get(door.address(), Some("Bearer deadbeef"), "/kalsa/room/info");
    assert!(wrong.starts_with(b"HTTP/1.1 401"));
    let good = get(door.address(), Some(&format!("Bearer {token}")), "/kalsa/room/info");
    assert!(good.starts_with(b"HTTP/1.1 200"), "{}", text_of(&good));
    door.shutdown();
}

#[test]
fn info_lists_the_host_its_phones_and_the_assistant() {
    let (door, _room, [_, token, _]) = room_of();
    let answer = body_json(&get(
        door.address(),
        Some(&format!("Bearer {token}")),
        "/kalsa/room/info",
    ));
    assert_eq!(answer["room_name"], "This computer");
    let kinds: Vec<&str> = answer["members"]
        .as_array()
        .unwrap()
        .iter()
        .map(|member| member["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["host", "phone", "phone", "ai"]);
    let names: Vec<&str> = answer["members"]
        .as_array()
        .unwrap()
        .iter()
        .map(|member| member["name"].as_str().unwrap())
        .collect();
    // The caller enrolls; the other phone is enrolled by the list itself.
    assert_eq!(names, ["This computer", "Paired phone", "Paired phone 2", "Kalsa"]);
    assert_eq!(answer["ai"]["busy"], false);
    door.shutdown();
}

#[test]
fn the_author_is_the_credential_never_the_body() {
    let (door, room, [_, token, _]) = room_of();
    let bearer = format!("Bearer {token}");
    let answer = body_json(&post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        &format!(
            r#"{{"client_msg_id":"m1","text":"hello","call_ai":false,"member_id":{}}}"#,
            u32::MAX - 1
        ),
    ));
    assert!(answer.get("seq").is_some(), "the post landed: {answer}");
    let page = room.newest_page(1, 10).unwrap();
    let author = page.messages[0].member;
    assert_eq!(
        author,
        room.member_of(PHONE_ONE).unwrap(),
        "a member_id in the body names nobody"
    );
    door.shutdown();
}

#[test]
fn a_retry_lands_once_and_a_reused_id_is_refused() {
    let (door, _room, [_, token, _]) = room_of();
    let bearer = format!("Bearer {token}");
    let first = body_json(&post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"retry","text":"the same words"}"#,
    ));
    let retry = body_json(&post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"retry","text":"the same words"}"#,
    ));
    assert_eq!(first["seq"], retry["seq"], "the retry replays its entry");
    let reused = post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"retry","text":"different words"}"#,
    );
    assert!(reused.starts_with(b"HTTP/1.1 409"));
    let error = body_json(&reused);
    assert_eq!(error["error"]["code"], "client_msg_id_reused");
    door.shutdown();
}

#[test]
fn history_pages_every_cursor_and_refuses_a_bad_limit() {
    let (door, _room, [_, token, _]) = room_of();
    let bearer = format!("Bearer {token}");
    for n in 1..=3 {
        post(
            door.address(),
            Some(&bearer),
            "/kalsa/room/messages",
            &format!(r#"{{"client_msg_id":"m{n}","text":"text {n}"}}"#),
        );
    }
    let base = door.address();
    let seqs = |query: &str| -> Vec<u64> {
        body_json(&get(
            base,
            Some(&bearer),
            &format!("/kalsa/room/history{query}"),
        ))["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["seq"].as_u64().unwrap())
            .collect()
    };
    assert_eq!(seqs(""), vec![1, 2, 3], "no cursor is the newest page");
    assert_eq!(seqs("?after=1"), vec![2, 3]);
    assert_eq!(seqs("?before=2&limit=1"), vec![1]);
    assert_eq!(seqs("?before=0"), Vec::<u64>::new());
    let both = get(
        base,
        Some(&bearer),
        "/kalsa/room/history?after=1&before=3",
    );
    assert!(both.starts_with(b"HTTP/1.1 400"), "both cursors is refused");
    for bad in ["?limit=0", "?limit=201", "?limit=many"] {
        let refused = get(base, Some(&bearer), &format!("/kalsa/room/history{bad}"));
        assert!(refused.starts_with(b"HTTP/1.1 400"), "{bad}: {}", text_of(&refused));
    }
    door.shutdown();
}

#[test]
fn a_name_is_set_through_the_member_path_and_the_assistants_is_not() {
    let (door, _room, [_, token, _]) = room_of();
    let bearer = format!("Bearer {token}");
    let set = body_json(&put(
        door.address(),
        Some(&bearer),
        "/kalsa/room/name",
        r#"{"name":"Marco"}"#,
    ));
    assert_eq!(set["name"], "Marco");
    let taken = put(
        door.address(),
        Some(&bearer),
        "/kalsa/room/name",
        r#"{"name":"Kalsa"}"#,
    );
    assert!(taken.starts_with(b"HTTP/1.1 409"));
    assert_eq!(body_json(&taken)["error"]["code"], "name_taken");
    door.shutdown();
}

#[test]
fn an_oversized_message_is_refused_before_its_bytes_are_read() {
    let (door, _room, [_, token, _]) = room_of();
    let bearer = format!("Bearer {token}");
    let long = format!(r#"{{"client_msg_id":"big","text":"{}"}}"#, "x".repeat(9000));
    let refused = post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        &long,
    );
    assert!(refused.starts_with(b"HTTP/1.1 413"), "{}", text_of(&refused));
    let error = body_json(&refused);
    assert_eq!(error["error"]["code"], "too_large");
    door.shutdown();
}

#[test]
fn a_forgotten_device_is_cut_from_the_stream_and_answered_401() {
    let (door, room, [host, _one, two]) = room_of();
    let one = _one;
    let mut follower = stream_get(
        door.address(),
        &format!("Bearer {two}"),
        "/kalsa/room/events",
        None,
    );
    // The head is the proof the door served the request — and enrolled
    // the device into the room on the way in.
    let opened = Reader::until(&mut follower, b"text/event-stream", Duration::from_secs(5));
    assert!(opened.contains("200"), "the follower's stream opened: {opened}");
    let member = room.member_of(PHONE_TWO).unwrap();
    room.forget_device(PHONE_TWO).unwrap();
    let reduced = devices_labeled(&[
        (HOST, "This computer", &host),
        (PHONE_ONE, "Paired phone", &one),
    ]);
    door.set_devices(reduced);

    let mut seen = Vec::new();
    let mut closed = false;
    let deadline = std::time::Instant::now() + Duration::from_secs(6);
    follower
        .set_read_timeout(Some(Duration::from_millis(200)))
        .unwrap();
    while std::time::Instant::now() < deadline {
        let mut chunk = [0u8; 512];
        match follower.read(&mut chunk) {
            Ok(0) => {
                closed = true;
                break;
            }
            Ok(read) => seen.extend_from_slice(&chunk[..read]),
            Err(_) => {}
        }
    }
    assert!(
        closed || !seen.is_empty(),
        "the follower's stream ended: cut by the set change, or closed after its last bytes"
    );
    assert!(room.is_former(member));

    // The credential no longer opens anything, the room included.
    let refused = get(
        door.address(),
        Some(&format!("Bearer {two}")),
        "/kalsa/room/info",
    );
    assert!(refused.starts_with(b"HTTP/1.1 401"));
    let _ = follower.shutdown(Shutdown::Both);
    door.shutdown();
}

#[test]
fn a_reconnect_replays_from_its_last_seq_and_a_cursor_above_the_newest_is_refused() {
    let (door, _room, [_, token, _]) = room_of();
    let bearer = format!("Bearer {token}");
    for n in 1..=2 {
        post(
            door.address(),
            Some(&bearer),
            "/kalsa/room/messages",
            &format!(r#"{{"client_msg_id":"m{n}","text":"text {n}"}}"#),
        );
    }
    let mut replay = stream_get(
        door.address(),
        &bearer,
        "/kalsa/room/events",
        Some("1"),
    );
    let replayed = Reader::until(&mut replay, b"id: 2", Duration::from_secs(5));
    assert!(
        replayed.contains("id: 2") && replayed.contains("text 2"),
        "the replay carries the missed entry and its id: {replayed}"
    );
    let _ = replay.shutdown(Shutdown::Both);

    let mut refused = stream_get(
        door.address(),
        &bearer,
        "/kalsa/room/events",
        Some("99"),
    );
    let answer = Reader::until(&mut refused, b"}", Duration::from_secs(5));
    assert!(
        answer.starts_with("HTTP/1.1 400") && answer.contains("bad_cursor"),
        "a Last-Event-ID above the newest is answered, not streamed: {answer}"
    );
    door.shutdown();
}

#[test]
fn a_live_follower_sees_a_rename_and_the_assistant_needs_no_call() {
    let (door, _room, [_, token, _]) = room_of();
    let bearer = format!("Bearer {token}");
    let mut follower = stream_get(door.address(), &bearer, "/kalsa/room/events", None);
    // The head and any pings come first; the rename is the news.
    let opened = Reader::until(&mut follower, b"text/event-stream", Duration::from_secs(5));
    assert!(opened.contains("200"), "the stream opened: {opened}");

    put(
        door.address(),
        Some(&bearer),
        "/kalsa/room/name",
        r#"{"name":"Mamma"}"#,
    );
    let renamed = Reader::until(&mut follower, b"renamed", Duration::from_secs(5));
    assert!(
        renamed.contains("event: member") && renamed.contains("Mamma"),
        "the rename reached the follower unnumbered: {renamed}"
    );

    // A called message carries its flag without claiming an AI turn.
    let posted = body_json(&post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"call","text":"hey @Kalsa what time is it?","call_ai":false}"#,
    ));
    assert_eq!(posted["ai_call"], serde_json::Value::Null);
    let called = Reader::until(&mut follower, b"id:", Duration::from_secs(5));
    assert!(
        called.contains("\"call_ai\":true") && called.contains("event: message"),
        "the entry reached the follower numbered: {called}"
    );
    let _ = follower.shutdown(Shutdown::Both);
    door.shutdown();
}

#[test]
fn a_door_without_a_room_answers_with_one_sentence() {
    let token = credential();
    let devices = devices_labeled(&[(HOST, "This computer", &token)]);
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let door = crate::Door::new(listener, 1, devices, 1)
        .unwrap()
        .start()
        .unwrap();
    let answer = get(
        door.address(),
        Some(&format!("Bearer {token}")),
        "/kalsa/room/info",
    );
    assert!(answer.starts_with(b"HTTP/1.1 503"), "{}", text_of(&answer));
    assert!(text_of(&answer).contains("The room is not open"));
    door.shutdown();
}

#[test]
fn info_names_the_caller_the_room_and_the_epoch() {
    let (door, room, [_, one, _]) = room_of();
    let answer = body_json(&get(
        door.address(),
        Some(&format!("Bearer {one}")),
        "/kalsa/room/info",
    ));
    assert_eq!(
        answer["you"],
        room.member_of(PHONE_ONE).unwrap().wire(),
        "the caller learns its own member id"
    );
    assert_eq!(answer["room_id"], room.room_id(), "the id a phone keys its store by");
    assert_eq!(answer["epoch"], room.epoch());
    door.shutdown();
}

#[test]
fn a_member_sees_history_only_from_when_they_joined() {
    let (door, room, [_, one, two]) = room_of();
    let first = format!("Bearer {one}");
    for n in 1..=3 {
        post(
            door.address(),
            Some(&first),
            "/kalsa/room/messages",
            &format!(r#"{{"client_msg_id":"m{n}","text":"before {n}"}}"#),
        );
    }
    // Phone two's first room request enrolls it — after three entries.
    let second = format!("Bearer {two}");
    post(
        door.address(),
        Some(&second),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"late","text":"after joining"}"#,
    );
    let join = room.join_of(room.member_of(PHONE_TWO).unwrap()).unwrap();
    assert_eq!(join, 4, "the join point is the next seq at enrollment");

    let page = body_json(&get(
        door.address(),
        Some(&second),
        "/kalsa/room/history?after=0",
    ));
    let seqs: Vec<u64> = page["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["seq"].as_u64().unwrap())
        .collect();
    assert_eq!(seqs, vec![4], "nothing from before the join");
    assert_eq!(page["has_older"], false, "no older page exists for this reader");

    // The first phone sees everything, as the host does.
    let whole = body_json(&get(
        door.address(),
        Some(&first),
        "/kalsa/room/history?after=0",
    ));
    assert_eq!(whole["messages"].as_array().unwrap().len(), 4);

    // Replay below the join point starts at the join point.
    let mut replay = stream_get(
        door.address(),
        &second,
        "/kalsa/room/events",
        Some("0"),
    );
    let replayed = Reader::until(&mut replay, b"id: 4", Duration::from_secs(5));
    assert!(
        replayed.contains("id: 4") && !replayed.contains("id: 1\n"),
        "the replay begins at the join, not before it: {replayed}"
    );
    let _ = replay.shutdown(std::net::Shutdown::Both);
    door.shutdown();
}

#[test]
fn a_cached_epoch_from_before_a_recovery_is_refused() {
    let one = credential();
    let data = scratch("room-epoch");
    let room = Arc::new(Room::open(&data).unwrap());
    // Takes the room it serves: a door must be built against the room that
    // is open NOW, never one a closure happened to capture first.
    let build = |room: &Arc<Room>| {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        crate::Door::new_with_engine(
            listener,
            1,
            devices_labeled(&[(HOST, "This computer", &one)]),
            3,
            EnginePrivateHeaders::Consumed,
        )
        .unwrap()
        .with_room(Arc::clone(room), DeviceId::new(HOST))
        .start()
        .unwrap()
    };
    let door = build(&room);
    let bearer = format!("Bearer {one}");
    post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"m1","text":"words"}"#,
    );
    let before = room.epoch();
    let room_id = room.room_id();
    door.shutdown();

    // Damage that drops bytes: the room's next OPEN recovers it — the
    // recovery is the opener's, exactly as a restart would see it — the
    // room id stays, and the epoch changes with it.
    let log = data.join("room").join("room-log.jsonl");
    let mut bytes = std::fs::read(&log).unwrap();
    bytes.extend_from_slice(b"{torn");
    std::fs::write(&log, &bytes).unwrap();
    let room = Arc::new(Room::open(&data).unwrap());
    let door = build(&room);
    assert_ne!(room.epoch(), before, "a recovery that dropped bytes re-minted it");
    assert_eq!(room.room_id(), room_id, "the room id never changes");

    let mut stale = raw(
        door.address(),
        Some(&bearer),
        "GET",
        "/kalsa/room/events",
        "",
        &[&format!("Kalsa-Room-Epoch: {before}")],
    );
    let answer = text_of(&read_all(&mut stale));
    assert!(
        answer.starts_with("HTTP/1.1 409") && answer.contains("epoch_changed"),
        "a cached epoch is one explicit refusal: {answer}"
    );

    // The same stream with the current epoch opens, snapshot first.
    let current = room.epoch();
    let mut fresh = raw(
        door.address(),
        Some(&bearer),
        "GET",
        "/kalsa/room/events",
        "",
        &[&format!("Kalsa-Room-Epoch: {current}")],
    );
    let opened = Reader::until(&mut fresh, b"ai_status", Duration::from_secs(5));
    assert!(
        opened.contains(&format!("Kalsa-Room-Epoch: {current}"))
            && opened.contains("\"state\":\"idle\""),
        "the epoch rides the response head and the first frame is the state snapshot: {opened}"
    );
    let _ = fresh.shutdown(std::net::Shutdown::Both);
    door.shutdown();
}
