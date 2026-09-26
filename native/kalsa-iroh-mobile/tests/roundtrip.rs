//! The host proof, network-free: brain's bridge plays the desktop (both
//! lanes open, key from a real file), the wrapper dials it exactly the way
//! Kotlin will, and real chunked HTTP and chunked SSE bodies cross the
//! tunnel. No env gate is needed because `RelayChoice::Disabled` plus an
//! in-process `AddressBook` is brain's own network-free seam — both
//! endpoints resolve each other in-process and bind only local sockets.

mod support;

use std::path::PathBuf;

use kalsa_iroh::AddressBook;
use kalsa_iroh_mobile::{Lane, MobileBridge};
use support::{spawn_upstream, temp_dir, Upstream};

/// One chunked body piece: the size in hex, the bytes, the CRLF.
fn chunk(payload: &[u8]) -> Vec<u8> {
    let mut framed = format!("{:x}\r\n", payload.len()).into_bytes();
    framed.extend_from_slice(payload);
    framed.extend_from_slice(b"\r\n");
    framed
}

fn chunked_head(content_type: &str) -> Vec<u8> {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\n\
         Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
    )
    .into_bytes()
}

fn chunked_door_response() -> Vec<u8> {
    let mut response = chunked_head("text/plain");
    response.extend_from_slice(&chunk(b"kalsa-"));
    response.extend_from_slice(&chunk(b"roundtrip!"));
    response.extend_from_slice(b"0\r\n\r\n");
    response
}

fn chunked_sse_desk_response() -> Vec<u8> {
    let mut response = chunked_head("text/event-stream");
    response.extend_from_slice(&chunk(b"data: offer-abc\n\n"));
    response.extend_from_slice(&chunk(b"data: complete-def\n\n"));
    response.extend_from_slice(b"0\r\n\r\n");
    response
}

/// Reassemble a chunked body from a raw response carried across the tunnel.
fn dechunk(raw: &str) -> String {
    let (_head, mut rest) = raw.split_once("\r\n\r\n").expect("response head");
    let mut body = String::new();
    loop {
        let Some((size_line, after)) = rest.split_once("\r\n") else {
            panic!("chunked stream broke off at: {rest:?}");
        };
        let Ok(size) = usize::from_str_radix(size_line, 16) else {
            panic!("bad chunk size {size_line:?} in: {rest:?}");
        };
        if size == 0 {
            return body;
        }
        body.push_str(&after[..size]);
        rest = &after[size + 2..];
    }
}

/// The phone's exact call sequence: connect, write the request, read to
/// EOF under per-call deadlines, shutdown. Runs on plain threads because
/// the wrapper is blocking and refuses runtime-thread callers.
fn read_response(
    phone: &MobileBridge,
    node_hex: &str,
    lane: Lane,
    request: &[u8],
) -> String {
    let tunnel = phone
        .connect(node_hex.to_string(), lane)
        .expect("tunnel opens");
    tunnel
        .write(request.to_vec(), 30_000)
        .expect("request written");
    let mut raw = Vec::new();
    loop {
        let bytes = tunnel.read(8192, 30_000).expect("tunnel read");
        if bytes.is_empty() {
            break;
        }
        raw.extend_from_slice(&bytes);
    }
    tunnel.shutdown();
    String::from_utf8(raw).expect("utf-8")
}

/// A read that outlives its deadline answers Deadline, not a hang — the
/// per-call deadline is this side's own bound, the upstream's silence
/// notwithstanding.
#[tokio::test(flavor = "multi_thread")]
async fn a_read_that_never_gets_bytes_answers_deadline() {
    let dir = temp_dir("read-deadline");
    let door = spawn_upstream(Upstream::Silent).await;
    let book = AddressBook::new();
    let desktop = support::desktop_bridge(&dir, &book, door, None).await;
    let desktop_hex = desktop.node_id().to_string();
    let phone_key = dir.join("phone.key");

    let outcome = std::thread::spawn(move || {
        let phone = MobileBridge::for_tests(phone_key, &book).expect("phone bridge starts");
        let tunnel = phone
            .connect(desktop_hex, Lane::Door)
            .expect("tunnel opens");
        let started = std::time::Instant::now();
        let read = tunnel.read(8192, 300);
        // Elapsed measured after the call returns: the read's own duration.
        (started.elapsed(), read)
    })
    .join()
    .expect("plain thread runs");
    assert!(
        matches!(outcome.1, Err(kalsa_iroh_mobile::IrohMobileError::Deadline)),
        "a silent upstream must answer Deadline"
    );
    assert!(
        outcome.0 < std::time::Duration::from_secs(5),
        "the deadline fired at {:?}, not when the caller set it",
        outcome.0
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn both_lanes_carry_http_through_the_tunnel() {
    let dir: PathBuf = temp_dir("lanes");
    let book = AddressBook::new();

    let door = spawn_upstream(Upstream::Respond(chunked_door_response())).await;
    let desk = spawn_upstream(Upstream::Respond(chunked_sse_desk_response())).await;
    let desktop = support::desktop_bridge(&dir, &book, door, Some(desk)).await;
    let desktop_hex = desktop.node_id().to_string();
    let phone_key = dir.join("phone.key");

    let (door_response, desk_response) =
        std::thread::spawn(move || {
            let phone = MobileBridge::for_tests(phone_key, &book)
                .expect("phone bridge starts");
            let door = read_response(
                &phone,
                &desktop_hex,
                Lane::Door,
                b"GET /v1/models HTTP/1.1\r\nHost: kalsa\r\nConnection: close\r\n\r\n",
            );
            let desk = read_response(
                &phone,
                &desktop_hex,
                Lane::Desk,
                b"POST /pair/claim HTTP/1.1\r\nHost: kalsa\r\nContent-Length: 0\r\n\
                  Connection: close\r\n\r\n",
            );
            (door, desk)
        })
        .join()
        .expect("plain thread runs");

    assert!(
        door_response.starts_with("HTTP/1.1 200 OK"),
        "expected the door's answer, got: {door_response}"
    );
    assert!(
        door_response.contains("Transfer-Encoding: chunked"),
        "expected chunked framing, got: {door_response}"
    );
    assert_eq!(
        dechunk(&door_response),
        "kalsa-roundtrip!",
        "both chunks must survive the tunnel"
    );

    assert!(
        desk_response.starts_with("HTTP/1.1 200 OK"),
        "expected the desk's answer, got: {desk_response}"
    );
    let desk_body = dechunk(&desk_response);
    let offer = desk_body.find("data: offer-abc").expect("the offer event");
    let complete = desk_body.find("data: complete-def").expect("the complete event");
    assert!(offer < complete, "the desk's events must arrive in order");

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_mistyped_node_hex_is_a_typed_error_not_a_panic() {
    let dir = temp_dir("badhex");
    let book = AddressBook::new();
    let phone_key = dir.join("phone.key");

    let attempts = std::thread::spawn(move || {
        let phone = MobileBridge::for_tests(phone_key, &book)
            .expect("phone bridge starts");
        vec![
            phone.connect("abcd".to_string(), Lane::Door),
            phone.connect("z".repeat(64), Lane::Door),
        ]
    })
    .join()
    .expect("plain thread runs");

    for attempt in attempts {
        let error = attempt
            .err()
            .expect("a mistyped hex must fail, never dial");
        assert!(
            matches!(error, kalsa_iroh_mobile::IrohMobileError::InvalidNodeHex),
            "expected InvalidNodeHex, got: {error}"
        );
    }

    let _ = std::fs::remove_dir_all(&dir);
}
