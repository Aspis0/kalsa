//! The room's media routes as a phone drives them: the upload road through
//! the door, the download with its Range, the caps and the ownership and
//! the join floor — and the AI turn that sees the room's pictures only
//! when the engine says it can.

use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::sync::Arc;
use std::time::Duration;

use kalsa_room::Room;
use sha2::{Digest, Sha256};

use super::room_support::{body_json, devices_labeled, get, post, raw, read_all, scratch, text_of};
use super::support::response_body;
use super::*;

pub(super) const HOST: u32 = 0;
const PHONE_ONE: u32 = 1;
pub(super) const PHONE_TWO: u32 = 2;

/// A running door with a room, one host and two phones, and the three
/// credentials that open it. The port is never dialed: the room routes
/// are the door's own.
fn media_room() -> (crate::RunningDoor, Arc<Room>, [String; 3]) {
    let host = credential();
    let one = credential();
    let two = credential();
    let devices = devices_labeled(&[
        (HOST, "This computer", &host),
        (PHONE_ONE, "Paired phone", &one),
        (PHONE_TWO, "Paired phone 2", &two),
    ]);
    let room = Arc::new(Room::open(&scratch("room-media")).unwrap());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let door =
        crate::Door::new_with_engine(listener, 1, devices, 3, EnginePrivateHeaders::Consumed)
            .unwrap()
            .with_room(Arc::clone(&room), DeviceId::new(HOST))
            .start()
            .unwrap();
    (door, room, [host, one, two])
}

pub(super) fn jpeg_bytes() -> Vec<u8> {
    let mut bytes = vec![0xff, 0xd8, 0xff, 0xe0];
    bytes.extend(std::iter::repeat_n(0xa5u8, 3000));
    bytes
}

pub(super) fn sha256_of(bytes: &[u8]) -> String {
    let digest: [u8; 32] = Sha256::digest(bytes).into();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// One raw request with a binary body, answered whole.
pub(super) fn raw_bytes(
    address: std::net::SocketAddr,
    token: &str,
    method: &str,
    target: &str,
    body: &[u8],
    extra: &[&str],
) -> Vec<u8> {
    let mut head = format!(
        "{method} {target} HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {token}\r\nContent-Type: application/octet-stream\r\n"
    );
    for header in extra {
        head.push_str(header);
        head.push_str("\r\n");
    }
    head.push_str(&format!(
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    ));
    let mut stream = TcpStream::connect(address).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    stream.write_all(head.as_bytes()).unwrap();
    stream.write_all(body).unwrap();
    stream.shutdown(Shutdown::Write).unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    response
}

/// Uploads one image the honest way and answers the media id.
pub(super) fn upload_image(
    address: std::net::SocketAddr,
    token: &str,
    bytes: &[u8],
    mime: &str,
    declared_sha: Option<&str>,
) -> String {
    let sha = declared_sha.unwrap_or(&sha256_of(bytes)).to_string();
    let create = format!(
        r#"{{"kind":"image","mime":"{mime}","bytes":{},"sha256":"{sha}","width":640,"height":480}}"#,
        bytes.len()
    );
    let answer = body_json(&post(
        address,
        Some(&format!("Bearer {token}")),
        "/kalsa/room/media",
        &create,
    ));
    let upload = answer["upload"]
        .as_str()
        .expect("the reserve answers")
        .to_string();
    let chunked = raw_bytes(
        address,
        token,
        "PUT",
        &format!("/kalsa/room/media/{upload}/0"),
        bytes,
        &[],
    );
    assert!(
        text_of(&chunked).starts_with("HTTP/1.1 200"),
        "the chunk landed: {}",
        text_of(&chunked)
    );
    let done = read_all(&mut raw(
        address,
        Some(&format!("Bearer {token}")),
        "POST",
        &format!("/kalsa/room/media/{upload}/complete"),
        "",
        &[],
    ));
    let body = body_json(&done);
    body["id"].as_str().expect("the blob published").to_string()
}

/// Reserves an upload and answers its upload id, whatever the body said.
pub(super) fn reserve(address: std::net::SocketAddr, token: &str, create: &str) -> String {
    body_json(&post(
        address,
        Some(&format!("Bearer {token}")),
        "/kalsa/room/media",
        create,
    ))["upload"]
        .as_str()
        .expect("the reserve answers")
        .to_string()
}

#[test]
fn the_upload_road_publishes_and_the_room_serves_the_blob() {
    let (door, _room, [_, one, two]) = media_room();
    let address = door.address();
    let bytes = jpeg_bytes();
    // Phone two is in the room from the start, so the post it will read
    // is above its floor.
    get(address, Some(&format!("Bearer {two}")), "/kalsa/room/info");
    let media = upload_image(address, &one, &bytes, "image/jpeg", None);

    // The post names it; history carries the descriptor whole.
    let posted = post(
        address,
        Some(&format!("Bearer {one}")),
        "/kalsa/room/messages",
        &format!(r#"{{"client_msg_id":"m1","text":"look","media":["{media}"]}}"#),
    );
    assert!(
        text_of(&posted).starts_with("HTTP/1.1 200"),
        "{}",
        text_of(&posted)
    );
    let history = body_json(&get(
        address,
        Some(&format!("Bearer {two}")),
        "/kalsa/room/history",
    ));
    let entry = &history["messages"][0];
    assert_eq!(entry["media"][0]["id"], media.as_str());
    assert_eq!(entry["media"][0]["mime"], "image/jpeg");
    assert_eq!(entry["media"][0]["bytes"], bytes.len() as u64);

    // The other member downloads the same bytes, whole.
    let response = raw_bytes(
        address,
        &two,
        "GET",
        &format!("/kalsa/room/media/{media}"),
        &[],
        &[],
    );
    let whole = text_of(&response);
    assert!(whole.starts_with("HTTP/1.1 200"), "{whole}");
    assert!(whole.contains("Content-Type: image/jpeg"));
    assert!(whole.contains("Cache-Control: private"));
    assert!(whole.contains("Accept-Ranges: bytes"));
    assert_eq!(response_body(&response), &bytes);
    door.shutdown();
}

#[test]
fn the_download_honours_a_single_range() {
    let (door, _room, [_, one, two]) = media_room();
    let address = door.address();
    let bytes = jpeg_bytes();
    get(address, Some(&format!("Bearer {two}")), "/kalsa/room/info");
    let media = upload_image(address, &one, &bytes, "image/jpeg", None);
    post(
        address,
        Some(&format!("Bearer {one}")),
        "/kalsa/room/messages",
        &format!(r#"{{"client_msg_id":"m1","text":"look","media":["{media}"]}}"#),
    );
    // A closed slice: 206, the asked bytes, the range named back.
    let sliced = raw_bytes(
        address,
        &two,
        "GET",
        &format!("/kalsa/room/media/{media}"),
        &[],
        &["Range: bytes=4-15"],
    );
    let head = text_of(&sliced);
    assert!(head.starts_with("HTTP/1.1 206"), "{head}");
    assert!(head.contains(&format!("Content-Range: bytes 4-15/{}", bytes.len())));
    assert_eq!(response_body(&sliced), &bytes[4..16]);

    // An open start, and a suffix, ride the same road.
    let tail = raw_bytes(
        address,
        &two,
        "GET",
        &format!("/kalsa/room/media/{media}"),
        &[],
        &["Range: bytes=-8"],
    );
    assert!(text_of(&tail).starts_with("HTTP/1.1 206"));
    assert_eq!(response_body(&tail), &bytes[bytes.len() - 8..]);

    // A start past the end is unsatisfiable, in the blob's own words.
    let gone = raw_bytes(
        address,
        &two,
        "GET",
        &format!("/kalsa/room/media/{media}"),
        &[],
        &[&format!("Range: bytes={}-", bytes.len() + 10)],
    );
    let head = text_of(&gone);
    assert!(head.starts_with("HTTP/1.1 416"), "{head}");
    assert!(head.contains(&format!("Content-Range: bytes */{}", bytes.len())));

    // A range the door cannot parse is no range at all.
    let garbage = raw_bytes(
        address,
        &two,
        "GET",
        &format!("/kalsa/room/media/{media}"),
        &[],
        &["Range: chunks=0-1"],
    );
    assert!(text_of(&garbage).starts_with("HTTP/1.1 200"));
    assert_eq!(response_body(&garbage), &bytes);
    door.shutdown();
}

#[test]
fn the_upload_road_refuses_what_the_shelf_refuses() {
    let (door, _room, [_, one, _]) = media_room();
    let address = door.address();
    let bearer = format!("Bearer {one}");
    let bytes = jpeg_bytes();
    let create_for = |len: u64, sha: &str, mime: &str| {
        format!(
            r#"{{"kind":"image","mime":"{mime}","bytes":{len},"sha256":"{sha}","width":1,"height":1}}"#
        )
    };

    // The digest lied: the reserve and the chunks are fine, the publish
    // is not, and nothing was published.
    let upload = reserve(
        address,
        &one,
        &create_for(bytes.len() as u64, &"a".repeat(64), "image/jpeg"),
    );
    raw_bytes(
        address,
        &one,
        "PUT",
        &format!("/kalsa/room/media/{upload}/0"),
        &bytes,
        &[],
    );
    let done = text_of(&read_all(&mut raw(
        address,
        Some(&bearer),
        "POST",
        &format!("/kalsa/room/media/{upload}/complete"),
        "",
        &[],
    )));
    assert!(done.contains("media_bad_sha"), "{done}");

    // The magic lied.
    let mut png = vec![0x89u8, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    png.extend(std::iter::repeat_n(0x11u8, 64));
    let upload = reserve(
        address,
        &one,
        &create_for(png.len() as u64, &sha256_of(&png), "image/jpeg"),
    );
    raw_bytes(
        address,
        &one,
        "PUT",
        &format!("/kalsa/room/media/{upload}/0"),
        &png,
        &[],
    );
    let done = text_of(&read_all(&mut raw(
        address,
        Some(&bearer),
        "POST",
        &format!("/kalsa/room/media/{upload}/complete"),
        "",
        &[],
    )));
    assert!(done.contains("media_bad_magic"), "{done}");

    // An image past the cap is refused at the reserve.
    let answer = text_of(&post(
        address,
        Some(&bearer),
        "/kalsa/room/media",
        &create_for(4 * 1024 * 1024 + 1, &sha256_of(&png), "image/jpeg"),
    ));
    assert!(answer.starts_with("HTTP/1.1 413"), "{answer}");
    assert!(answer.contains("too_large"), "{answer}");

    // A chunk past the cap is refused before its bytes are read.
    let upload = reserve(
        address,
        &one,
        &create_for(png.len() as u64, &sha256_of(&png), "image/jpeg"),
    );
    let big = vec![0u8; 4 * 1024 * 1024 + 1];
    let answer = text_of(&raw_bytes(
        address,
        &one,
        "PUT",
        &format!("/kalsa/room/media/{upload}/0"),
        &big,
        &[],
    ));
    assert!(answer.starts_with("HTTP/1.1 413"), "{answer}");

    // A body that is not the shape the route reads is a bad request.
    let answer = text_of(&post(
        address,
        Some(&bearer),
        "/kalsa/room/media",
        r#"{"kind":"image"}"#,
    ));
    assert!(answer.contains("bad_request"), "{answer}");
    door.shutdown();
}

#[test]
fn an_upload_belongs_to_its_uploader_alone() {
    let (door, _room, [_, one, two]) = media_room();
    let address = door.address();
    let bytes = jpeg_bytes();
    let create = format!(
        r#"{{"kind":"image","mime":"image/jpeg","bytes":{},"sha256":"{}","width":640,"height":480}}"#,
        bytes.len(),
        sha256_of(&bytes)
    );
    let upload = reserve(address, &one, &create);

    // Nobody else feeds it, publishes it, or posts it.
    let answer = text_of(&raw_bytes(
        address,
        &two,
        "PUT",
        &format!("/kalsa/room/media/{upload}/0"),
        &bytes,
        &[],
    ));
    assert!(answer.contains("media_not_yours"), "{answer}");
    let answer = text_of(&read_all(&mut raw(
        address,
        Some(&format!("Bearer {two}")),
        "POST",
        &format!("/kalsa/room/media/{upload}/complete"),
        "",
        &[],
    )));
    assert!(answer.contains("media_not_yours"), "{answer}");

    // The uploader publishes; still nobody else posts the blob.
    raw_bytes(
        address,
        &one,
        "PUT",
        &format!("/kalsa/room/media/{upload}/0"),
        &bytes,
        &[],
    );
    let done = body_json(&read_all(&mut raw(
        address,
        Some(&format!("Bearer {one}")),
        "POST",
        &format!("/kalsa/room/media/{upload}/complete"),
        "",
        &[],
    )));
    let media = done["id"].as_str().unwrap().to_string();
    let answer = text_of(&post(
        address,
        Some(&format!("Bearer {two}")),
        "/kalsa/room/messages",
        &format!(r#"{{"client_msg_id":"t1","text":"mine now","media":["{media}"]}}"#),
    ));
    assert!(answer.contains("media_not_yours"), "{answer}");
    door.shutdown();
}

#[test]
fn the_join_floor_guards_the_download_and_the_removed_lose_it() {
    let (door, room, [host, one, _]) = media_room();
    let address = door.address();
    let bytes = jpeg_bytes();
    let media = upload_image(address, &one, &bytes, "image/jpeg", None);
    post(
        address,
        Some(&format!("Bearer {one}")),
        "/kalsa/room/messages",
        &format!(r#"{{"client_msg_id":"m1","text":"for all","media":["{media}"]}}"#),
    );

    // The uploader reads its own post, above its floor.
    let answer = text_of(&get(
        address,
        Some(&format!("Bearer {one}")),
        &format!("/kalsa/room/media/{media}"),
    ));
    assert!(answer.starts_with("HTTP/1.1 200"), "{answer}");

    // A device that joins the room LATER has the post below its floor —
    // a brand-new credential plays the latecomer here: it enrolls fresh,
    // and the past's blobs are as invisible as the past's words.
    let fresh = credential();
    let devices = devices_labeled(&[
        (HOST, "This computer", &host),
        (PHONE_ONE, "Paired phone", &one),
        (PHONE_TWO, "Paired phone 2", &fresh),
    ]);
    door.set_devices(devices);
    let answer = text_of(&get(
        address,
        Some(&format!("Bearer {fresh}")),
        &format!("/kalsa/room/media/{media}"),
    ));
    assert!(answer.starts_with("HTTP/1.1 403"), "{answer}");
    assert!(answer.contains("media_forbidden"), "{answer}");

    // The owner forgets the uploader: its member retires, and the road
    // refuses before any floor is asked.
    room.forget_device(PHONE_ONE).unwrap();
    let answer = text_of(&get(
        address,
        Some(&format!("Bearer {one}")),
        &format!("/kalsa/room/media/{media}"),
    ));
    assert!(answer.starts_with("HTTP/1.1 403"), "{answer}");

    door.shutdown();
}

#[test]
fn a_textless_post_stores_the_fallback_and_the_idempotent_retry_sees_it() {
    let (door, room, [_, one, _]) = media_room();
    let address = door.address();
    let bytes = jpeg_bytes();
    let media = upload_image(address, &one, &bytes, "image/jpeg", None);
    let body = format!(r#"{{"client_msg_id":"m1","text":"","media":["{media}"]}}"#);
    let first = body_json(&post(
        address,
        Some(&format!("Bearer {one}")),
        "/kalsa/room/messages",
        &body,
    ));
    let again = body_json(&post(
        address,
        Some(&format!("Bearer {one}")),
        "/kalsa/room/messages",
        &body,
    ));
    assert_eq!(first["seq"], again["seq"], "the retry is the same entry");
    let landed = room.newest_page(1, 10).unwrap().messages;
    assert_eq!(landed.len(), 1);
    assert_eq!(landed[0].text, "[Image]");
    assert_eq!(landed[0].media.len(), 1);
    door.shutdown();
}
