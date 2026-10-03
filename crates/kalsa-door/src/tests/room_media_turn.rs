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
                    .contains("\"text\":\"[Paired phone] @Kalsa look\""),
                "the words ride as the text part: {}",
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
                    .contains("\"content\":\"[Paired phone] @Kalsa look\""),
                "the words ride as the string they always were: {}",
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
    let video = vec![0x00u8, 0x00, 0x00, 0x18, b'f', b't', b'y', b'p', 0x01, 0x02];
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
