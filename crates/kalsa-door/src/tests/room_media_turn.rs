//! The room's AI turn as media meets it: the engine's own `/props` answer
//! decides whether the room's pictures ride, a video rides only through
//! the frames its sender extracted, and the images never eat the words —
//! the caps and the budget hold.

use std::sync::Arc;

use kalsa_room::Room;

use super::room_engine::{Engine, Reply};
use super::room_media::{jpeg_bytes, raw_bytes, reserve, sha256_of, upload_image, HOST, PHONE_TWO};
use super::room_support::{body_json, post, raw, read_all, scratch};
use super::room_turn::await_answer;
use super::*;

const PHONE_ONE: u32 = 1;

/// A room door seated at a fake engine, with the guest's own seat in the
/// set — the same fixture the turn tests drive.
fn turn_room(engine: Engine) -> (crate::RunningDoor, Arc<Room>, Engine, [String; 3]) {
    let host = credential();
    let one = credential();
    let two = credential();
    let devices = super::room_support::seated_labeled(&[
        (HOST, "This computer", &host),
        (PHONE_ONE, "Paired phone", &one),
        (PHONE_TWO, "Paired phone 2", &two),
    ]);
    let room = std::sync::Arc::new(Room::open(&scratch("room-media-turn")).unwrap());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let door = crate::Door::new_with_engine(
        listener,
        engine.port,
        devices,
        4,
        EnginePrivateHeaders::Consumed,
    )
    .unwrap()
    .with_room(Arc::clone(&room), DeviceId::new(HOST))
    .start()
    .unwrap();
    (door, room, engine, [host, one, two])
}

#[test]
fn a_turn_with_vision_carries_the_room_pictures_and_one_without_carries_none() {
    let bytes = jpeg_bytes();
    for vision in [true, false] {
        let engine = if vision {
            Engine::with_vision(vec![Reply::Sse(vec!["nice".to_string()])])
        } else {
            Engine::start(vec![Reply::Sse(vec!["nice".to_string()])])
        };
        let (door, _room, engine, [_, one, _]) = turn_room(engine);
        let address = door.address();
        let media = upload_image(address, &one, &bytes, "image/jpeg", None);
        post(
            address,
            Some(&format!("Bearer {one}")),
            "/kalsa/room/messages",
            &format!(r#"{{"client_msg_id":"m1","text":"@Kalsa look","media":["{media}"]}}"#),
        );
        let landed = await_answer(&_room);
        assert_eq!(landed.text, "nice");
        let seen = engine.seen();
        assert_eq!(seen.len(), 1, "one completion per turn");
        if vision {
            assert!(
                seen[0].body.contains("\"type\":\"image_url\""),
                "the picture rode as a part: {}",
                seen[0].body
            );
            assert!(
                seen[0].body.contains("data:image/jpeg;base64,"),
                "inline, as a data URI: {}",
                seen[0].body
            );
            assert!(
                seen[0]
                    .body
                    .contains("\"text\":\"[Paired phone] @Kalsa look\\n\\nSent on "),
                "the words ride as the text part, then the day they were sent: {}",
                seen[0].body
            );
        } else {
            assert!(
                !seen[0].body.contains("data:image"),
                "a blind engine is not shown pictures: {}",
                seen[0].body
            );
            assert!(
                seen[0]
                    .body
                    .contains("\"content\":\"[Paired phone] @Kalsa look\\n\\nSent on "),
                "the words ride as the string, then the day they were sent: {}",
                seen[0].body
            );
        }
        door.shutdown();
    }
}

#[test]
fn a_video_rides_only_through_its_frames() {
    let engine = Engine::with_vision(vec![Reply::Sse(vec!["seen".to_string()])]);
    let (door, _room, engine, [_, one, _]) = turn_room(engine);
    let address = door.address();
    let bearer = format!("Bearer {one}");

    // Two frames, then the video that names them.
    let frame_one = upload_image(address, &one, &jpeg_bytes(), "image/jpeg", None);
    let frame_two = upload_image(address, &one, &jpeg_bytes(), "image/jpeg", None);
    // An MP4 past its size floor (ten bytes of ftyp alone is not an MP4
    // to this store).
    let mut video = vec![0x00u8, 0x00, 0x00, 0x18, b'f', b't', b'y', b'p'];
    video.extend(std::iter::repeat_n(0x21u8, 1208));
    let create = format!(
        r#"{{"kind":"video","mime":"video/mp4","bytes":{},"sha256":"{}","width":1280,"height":720,
            "duration_ms":30000,"frames":["{frame_one}","{frame_two}"]}}"#,
        video.len(),
        sha256_of(&video)
    );
    let upload = reserve(address, &one, &create);
    raw_bytes(
        address,
        &one,
        "PUT",
        &format!("/kalsa/room/media/{upload}/0"),
        &video,
        &[],
    );
    let done = body_json(&read_all(&mut raw(
        address,
        Some(&bearer),
        "POST",
        &format!("/kalsa/room/media/{upload}/complete"),
        "",
        &[],
    )));
    assert_eq!(done["frames"].as_array().unwrap().len(), 2, "{}", done);
    let video_media = done["id"].as_str().unwrap().to_string();

    post(
        address,
        Some(&bearer),
        "/kalsa/room/messages",
        &format!(r#"{{"client_msg_id":"v1","text":"@Kalsa clip","media":["{video_media}"]}}"#),
    );
    let landed = await_answer(&_room);
    assert_eq!(landed.text, "seen");
    let body = &engine.seen()[0].body;
    let parts = body.matches("\"type\":\"image_url\"").count();
    assert_eq!(
        parts, 2,
        "the frames ride, the video's own bytes never do: {body}"
    );
    assert!(
        !body.contains("\"type\":\"video"),
        "no video part exists anywhere: {body}"
    );
    door.shutdown();
}

#[test]
fn the_turns_images_are_capped_and_the_newest_win() {
    let engine = Engine::with_vision(vec![Reply::Sse(vec!["ok".to_string()])]);
    let (door, _room, engine, [_, one, _]) = turn_room(engine);
    let address = door.address();
    let bearer = format!("Bearer {one}");
    let media = upload_image(address, &one, &jpeg_bytes(), "image/jpeg", None);
    // Nine pictured messages: the turn may carry eight, the newest eight.
    for n in 0..9 {
        post(
            address,
            Some(&bearer),
            "/kalsa/room/messages",
            &format!(r#"{{"client_msg_id":"m{n}","text":"pic {n}","media":["{media}"]}}"#),
        );
    }
    post(
        address,
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"call","text":"@Kalsa all of it","call_ai":true}"#,
    );
    let landed = await_answer(&_room);
    assert_eq!(landed.text, "ok");
    let body = &engine.seen()[0].body;
    let parts = body.matches("\"type\":\"image_url\"").count();
    assert_eq!(parts, 8, "eight images, never nine: {body}");
    door.shutdown();
}

#[test]
fn the_images_never_eat_the_message_the_turn_is_about() {
    let engine = Engine::with_vision(vec![Reply::Sse(vec!["tight".to_string()])]);
    let host = credential();
    let one = credential();
    let devices = super::room_support::seated_labeled(&[
        (HOST, "This computer", &host),
        (PHONE_ONE, "Paired phone", &one),
    ]);
    let room = std::sync::Arc::new(Room::open(&scratch("room-media-tight")).unwrap());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let door = crate::Door::new_with_engine(
        listener,
        engine.port,
        devices,
        2,
        EnginePrivateHeaders::Consumed,
    )
    .unwrap()
    .with_room(Arc::clone(&room), DeviceId::new(HOST))
    .with_slot_context(2100)
    .start()
    .unwrap();
    let address = door.address();
    let bearer = format!("Bearer {one}");
    let media = upload_image(address, &one, &jpeg_bytes(), "image/jpeg", None);
    // A tiny slot: 60% of 2100 tokens is 1260 tokens = 5040 bytes. Eight
    // images cost far more than that; the budget keeps the newest message
    // and the images it has room for, never zero of the words.
    for n in 0..6 {
        post(
            address,
            Some(&bearer),
            "/kalsa/room/messages",
            &format!(r#"{{"client_msg_id":"m{n}","text":"pic {n}","media":["{media}"]}}"#),
        );
    }
    post(
        address,
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"call","text":"@Kalsa tight","call_ai":true}"#,
    );
    let landed = await_answer(&room);
    assert_eq!(landed.text, "tight");
    let body = &engine.seen()[0].body;
    let parts = body.matches("\"type\":\"image_url\"").count();
    assert!(parts < 6, "the budget, not the count, decides: {body}");
    assert!(
        body.contains("[Paired phone] @Kalsa tight"),
        "the turn's own message is still there: {body}"
    );
    door.shutdown();
}

/// Waits for the AI's landed answer with a deadline the caller names —
/// the slow-first-image turn needs more than [`await_answer`]'s window.
fn wait_answer(room: &Room, within: Duration) -> kalsa_room::Entry {
    let deadline = std::time::Instant::now() + within;
    loop {
        if let Some(entry) = room
            .newest_page(1, 10)
            .unwrap()
            .messages
            .iter()
            .rev()
            .find(|entry| entry.member == kalsa_room::MemberId::Ai)
        {
            return entry.clone();
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the AI's answer never landed"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn a_slow_first_image_prefill_is_waited_out_not_killed_and_resent() {
    // The walk's first media turn (fb477ddd, 2026-10-04 03:28Z): the
    // projector's first encode reports nothing while it runs, the clock
    // read that silence as a stall, killed the request mid-encode and
    // re-sent it — doubling the engine's work and, cold, failing twice
    // into engine_problem. The turn must wait the silence out on ONE
    // request.
    let silence = Duration::from_secs(3);
    let engine = Engine::with_vision(vec![
        Reply::SseAfterImages {
            silence,
            pieces: vec!["seen".to_string()],
        },
        // Only the old, killing behavior ever reaches this one.
        Reply::SseAfterImages {
            silence,
            pieces: vec!["resent".to_string()],
        },
    ]);
    let (door, room, engine, [_, one, _]) = turn_room(engine);
    let address = door.address();
    // The stall clock shrunk: the media floor follows at ten times it, so
    // three seconds of image silence is a wait, not a stall.
    let _stall = crate::room::turn::stall_for(Duration::from_millis(400));
    let bearer = format!("Bearer {one}");
    let media = upload_image(address, &one, &jpeg_bytes(), "image/jpeg", None);
    post(
        address,
        Some(&bearer),
        "/kalsa/room/messages",
        &format!(r#"{{"client_msg_id":"m1","text":"@Kalsa look","media":["{media}"]}}"#),
    );
    let landed = wait_answer(&room, Duration::from_secs(12));
    assert_eq!(landed.text, "seen");
    // ONE completion reached the engine: no duplicate send while the
    // first was still encoding.
    assert_eq!(
        engine.seen().len(),
        1,
        "the first request was waited out, not killed and re-sent"
    );
    door.shutdown();
}

#[test]
fn a_failed_exchange_names_its_class_in_one_line() {
    // The walk could not tell why the turn died; now every failed
    // exchange leaves one line behind, naming the class and nothing of
    // the content. A silent engine is a stall.
    super::logging::capture();
    let before = super::logging::line_count();
    let engine = Engine::start(vec![Reply::Hang, Reply::Hang]);
    let (door, room, _engine, [_, one, _]) = turn_room(engine);
    let address = door.address();
    let _stall = crate::room::turn::stall_for(Duration::from_millis(300));
    post(
        address,
        Some(&format!("Bearer {one}")),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"n1","text":"@Kalsa nope"}"#,
    );
    // Wait for MY line: the capture is one for the whole test binary and
    // other turns fail under other classes, so the marker is the class
    // itself, not the generic word.
    let deadline = std::time::Instant::now() + Duration::from_secs(8);
    let mine = loop {
        let mine: Vec<String> = super::logging::lines()
            .lock()
            .unwrap()
            .iter()
            .skip(before)
            .filter(|line| line.contains("room turn exchange failed"))
            .cloned()
            .collect();
        if mine.iter().any(|line| line.contains("class stall"))
            || std::time::Instant::now() >= deadline
        {
            break mine;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    assert!(
        mine.iter().any(|line| line.contains("class stall")),
        "the stall is named: {mine:?}"
    );
    // And the line carries no content: the class is the whole story.
    assert!(
        mine.iter().all(|line| line.matches('"').count() == 0),
        "no quoted content rides the line: {mine:?}"
    );
    // The room was still told the honest word.
    let deadline = std::time::Instant::now() + Duration::from_secs(6);
    while room.turn_state().running.is_some() {
        assert!(std::time::Instant::now() < deadline, "the turn never ended");
        std::thread::sleep(Duration::from_millis(50));
    }
    door.shutdown();
}

#[test]
fn a_media_stall_that_burned_the_floor_is_not_retried() {
    // The confirmed review of the floor fix: a media turn that stays
    // silent pays the whole media patience, and the automatic retry would
    // pay it AGAIN — twenty minutes of one member's turn while the room
    // queues. The turn fails after ONE floor, having sent once.
    let forever = Duration::from_secs(120);
    let engine = Engine::with_vision(vec![
        Reply::SseAfterImages {
            silence: forever,
            pieces: vec!["never".to_string()],
        },
        // Only the old, retrying behavior ever reaches this one.
        Reply::SseAfterImages {
            silence: forever,
            pieces: vec!["neither".to_string()],
        },
    ]);
    let (door, room, engine, [_, one, _]) = turn_room(engine);
    let address = door.address();
    // The stall clock shrunk: the media floor follows at ten times it.
    let _stall = crate::room::turn::stall_for(Duration::from_millis(300));
    let bearer = format!("Bearer {one}");
    let media = upload_image(address, &one, &jpeg_bytes(), "image/jpeg", None);
    post(
        address,
        Some(&bearer),
        "/kalsa/room/messages",
        &format!(r#"{{"client_msg_id":"m1","text":"@Kalsa look","media":["{media}"]}}"#),
    );
    // The turn ends refused, after one floor — not two.
    let begun = std::time::Instant::now();
    let deadline = begun + Duration::from_secs(15);
    while room.turn_state().running.is_some() || engine.seen().is_empty() {
        assert!(std::time::Instant::now() < deadline, "the turn never ended");
        std::thread::sleep(Duration::from_millis(50));
    }
    // No answer ever landed, and the seat is free for whoever waits.
    assert!(
        room.newest_page(1, 10)
            .unwrap()
            .messages
            .iter()
            .all(|entry| entry.member != kalsa_room::MemberId::Ai),
        "a stalled media turn stores nothing"
    );
    assert_eq!(
        engine.seen().len(),
        1,
        "one send: the floor is not paid twice"
    );
    let elapsed = begun.elapsed();
    assert!(
        // One floor (3 s) plus the turn's own overhead — well under two.
        elapsed < Duration::from_secs(5),
        "one floor, not two: {elapsed:?}"
    );
    door.shutdown();
}
