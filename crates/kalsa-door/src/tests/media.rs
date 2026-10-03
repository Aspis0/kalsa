//! The media guard through a real door: a body that names a source the engine
//! would fetch is answered at the door, before any upstream socket exists, and
//! a body that keeps its media inline reaches the engine byte for byte.
//!
//! The engine's own behaviour is what this guards: llama-server downloads an
//! `http(s)` source itself and reads a `file://` one under `--media-path`, so
//! a paired phone must never be able to name either. The door's rule is the
//! subject here, and the recording upstream is the proof — its accept count
//! stays at zero for every refusal.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use kalsa_room::Room;

use super::paging_support::status_of;
use super::room_support::{devices_labeled, post as room_post, scratch};
use super::support::*;
use super::*;

/// A chat POST with a body, the shape the webview sends: JSON content type, a
/// bearer credential, an origin.
fn chat_request(token: &str, body: &str) -> String {
    format!(
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nOrigin: {ORIGIN}\r\n\
         Authorization: Bearer {token}\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

/// The error object of a refusal, parsed from the answer.
fn error_of(response: &[u8]) -> serde_json::Value {
    let body = response_body(response);
    serde_json::from_slice(body).unwrap_or_else(|_| {
        panic!("the refusal is not JSON: {}", String::from_utf8_lossy(body))
    })
}

/// One request whose declared body is past the cap, with only `sent` bytes of
/// it written: the door refuses at the head, so the client never has to upload
/// the body it just learned is too big. The write side is closed before the
/// answer is read, which is what a real client does once it has lost interest.
fn over_cap_request(address: SocketAddr, token: &str, declared: usize, sent: usize) -> Vec<u8> {
    let head = format!(
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nOrigin: {ORIGIN}\r\n\
         Authorization: Bearer {token}\r\nContent-Type: application/json\r\n\
         Content-Length: {declared}\r\nConnection: close\r\n\r\n"
    );
    let mut client = TcpStream::connect(address).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    client.write_all(head.as_bytes()).unwrap();
    let chunk = vec![b'x'; sent];
    client.write_all(&chunk).unwrap();
    client.shutdown(Shutdown::Write).unwrap();
    let mut response = Vec::new();
    client.read_to_end(&mut response).unwrap();
    response
}

/// A phone sends a URL for the engine to download; the door answers, and the
/// engine is never contacted — the accept count is the proof that nothing was
/// opened for it.
#[test]
fn a_named_source_is_refused_before_the_engine_is_contacted() {
    let upstream = RecordingUpstream::start();
    let token = credential();
    let (door, address) = door(upstream.port, &[&token]);
    let source = "http://169.254.169.254/latest/meta-data/iam/security-credentials/";
    let body = format!(
        "{{\"messages\":[{{\"role\":\"user\",\"content\":[\
         {{\"type\":\"text\",\"text\":\"look at this\"}},\
         {{\"type\":\"image_url\",\"image_url\":{{\"url\":\"{source}\"}}}}]}}]}}"
    );
    let response = exchanged(address, &chat_request(&token, &body));

    assert_eq!(
        status_of(&response),
        400,
        "a named source was not refused: {}",
        String::from_utf8_lossy(&response)
    );
    assert_eq!(error_of(&response)["error"]["code"], "media_source_refused");
    assert_origin_aware(&response, Some(ORIGIN), "the media refusal");
    assert!(
        !String::from_utf8_lossy(&response).contains("169.254.169.254"),
        "the answer names the refused source: {}",
        String::from_utf8_lossy(&response)
    );
    assert_eq!(
        upstream.accepts(),
        0,
        "the engine was contacted for a body naming a source"
    );
    door.shutdown();
}

/// Video is refused whole at the door too: 400 with its own code, the sentence
/// the client reads saying why, and no socket opened for it.
#[test]
fn a_video_part_is_refused_whole_at_the_door() {
    for body in [
        r#"{"messages":[{"role":"user","content":[{"type":"input_video","input_video":{"data":"data:video/mp4;base64,AAAAIGZ0eXA="}}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"video_url","video_url":{"url":"http://example.com/a.mp4"}}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:video/mp4;base64,AAAAIGZ0eXA="}}]}]}"#,
    ] {
        let upstream = RecordingUpstream::start();
        let token = credential();
        let (door, address) = door(upstream.port, &[&token]);
        let response = exchanged(address, &chat_request(&token, body));

        assert_eq!(
            status_of(&response),
            400,
            "a video part was not refused: {}",
            String::from_utf8_lossy(&response)
        );
        let error = error_of(&response);
        assert_eq!(error["error"]["code"], "media_kind_refused");
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .contains("still frames"),
            "the refusal does not say why: {error}"
        );
        assert_origin_aware(&response, Some(ORIGIN), "the video refusal");
        assert_eq!(
            upstream.accepts(),
            0,
            "the engine was contacted for a video body"
        );
        door.shutdown();
    }
}

/// The accepted body is the client's own bytes: the guard reads it, the proxy
/// writes it upstream unchanged, and the upstream reads exactly that.
#[test]
fn an_accepted_inline_body_reaches_the_engine_byte_for_byte() {
    for body in [
        r#"{"messages":[{"role":"user","content":[{"type":"text","text":"what is this"},{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,/9j/4AAQSkZJRg=="}}]}]}"#,
        // A body that mentions a URL in its text is not a body that names a
        // source: the guard reads the JSON, it does not scan for words.
        r#"{"messages":[{"role":"user","content":"read http://example.com/x — it is text"}]}"#,
        // A tool's schema mentions url too, and it is not a media part.
        r#"{"messages":[{"role":"user","content":"call it"}],"tools":[{"type":"function","function":{"name":"web_fetch","parameters":{"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}}}]}"#,
    ] {
        let upstream = RecordingUpstream::start();
        let token = credential();
        let (door, address) = door(upstream.port, &[&token]);
        let response = exchanged(address, &chat_request(&token, body));
        assert_eq!(
            status_of(&response),
            200,
            "an inline body was not served: {}",
            String::from_utf8_lossy(&response)
        );
        assert_eq!(
            upstream.bodies(),
            vec![body.as_bytes().to_vec()],
            "the door rewrote a body it accepted"
        );
        door.shutdown();
    }
}

/// A body the door's parser cannot read, with no source spelled in it, keeps
/// the answer it always had: it goes to the engine, whose own 400 is the
/// answer. The guard does not turn malformed JSON into a refusal.
#[test]
fn a_malformed_body_keeps_its_old_answer() {
    let upstream = RecordingUpstream::start();
    let token = credential();
    let (door, address) = door(upstream.port, &[&token]);
    let body = r#"{"messages":[{"role":"user","content":"truncated"#;
    let response = exchanged(address, &chat_request(&token, body));
    assert_eq!(status_of(&response), 200, "{}", String::from_utf8_lossy(&response));
    assert_eq!(
        upstream.bodies(),
        vec![body.as_bytes().to_vec()],
        "a malformed body was not relayed as it always was"
    );
    door.shutdown();
}

/// A body past the cap is a size, not a credential: 413 with a JSON error the
/// clients can read, the origin named so a browser may read it too, and the
/// engine untouched.
#[test]
fn a_body_past_the_cap_is_answered_with_a_413() {
    let upstream = RecordingUpstream::start();
    let token = credential();
    let (door, address) = door(upstream.port, &[&token]);
    let declared = crate::request::MAX_BODY + 1;

    // Nothing of the body is sent: the declared length is the refusal, and a
    // client that hears it early never uploads the rest.
    let response = over_cap_request(address, &token, declared, 0);
    assert_eq!(
        status_of(&response),
        413,
        "an oversize body was not refused as one: {}",
        String::from_utf8_lossy(&response)
    );
    assert_eq!(error_of(&response)["error"]["code"], 413);
    assert!(
        error_of(&response)["error"]["message"]
            .as_str()
            .unwrap()
            .contains("16 MiB"),
        "the size refusal does not say the size: {}",
        String::from_utf8_lossy(&response)
    );
    assert_origin_aware(&response, Some(ORIGIN), "the size refusal");

    // And with part of the body already in flight, the answer is still read —
    // the settle that keeps the close from resetting it away.
    let response = over_cap_request(address, &token, declared, 64 * 1024);
    assert_eq!(status_of(&response), 413, "{}", String::from_utf8_lossy(&response));
    assert_eq!(
        upstream.accepts(),
        0,
        "the engine was contacted for an oversize body"
    );
    door.shutdown();
}

/// The room's routes are the door's own and stay text-only: a body shaped like
/// a media part is read as a message with no text, refused by the room, and
/// never reaches an engine. Nothing about the room changes with this guard.
#[test]
fn a_room_message_never_carries_media_to_the_engine() {
    let upstream = RecordingUpstream::start();
    let host = credential();
    let phone = credential();
    let devices = devices_labeled(&[(0, "This computer", &host), (1, "Paired phone", &phone)]);
    let room = Arc::new(Room::open(&scratch("media-room")).unwrap());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let door = Door::new_with_engine(
        listener,
        upstream.port,
        devices,
        2,
        EnginePrivateHeaders::Consumed,
    )
    .unwrap()
    .with_room(Arc::clone(&room), DeviceId::new(0))
    .start()
    .unwrap();

    let body = r#"{"client_msg_id":"m1","content":[{"type":"image_url","image_url":{"url":"http://169.254.169.254/"}}]}"#;
    let response = room_post(address, Some(&format!("Bearer {phone}")), "/kalsa/room/messages", body);
    assert_eq!(
        status_of(&response),
        400,
        "the room answered a textless message with something else: {}",
        String::from_utf8_lossy(&response)
    );
    assert_eq!(upstream.accepts(), 0, "the room reached an engine");
    door.shutdown();
}
