//! The host proof, network-free: brain's bridge plays the desktop (both
//! lanes open, key from a real file), the wrapper dials it exactly the way
//! Kotlin will, and real chunked HTTP and chunked SSE bodies cross the
//! tunnel. No env gate is needed because `RelayChoice::Disabled` plus an
//! in-process `AddressBook` is brain's own network-free seam — both
//! endpoints resolve each other in-process and bind only local sockets.

use std::net::SocketAddr;
use std::path::PathBuf;

use kalsa_iroh::{AddressBook, Bridge, BridgeConfig, RelayChoice};
use kalsa_iroh_mobile::{Lane, MobileBridge};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir()
        .join(format!("kalsa-iroh-mobile-rt-{}-{tag}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir creates");
    dir
}

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

/// A stand-in loopback service: one accept, one request head drained, one
/// canned response, write side closed — EOF for the reader.
async fn serve_once(listener: TcpListener, response: Vec<u8>) {
    let Ok((mut socket, _)) = listener.accept().await else {
        return;
    };
    let mut buffer = vec![0u8; 4096];
    let mut head = Vec::new();
    loop {
        match socket.read(&mut buffer).await {
            Ok(0) | Err(_) => return,
            Ok(n) => {
                head.extend_from_slice(&buffer[..n]);
                if head.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
        }
    }
    let _ = socket.write_all(&response).await;
    let _ = socket.shutdown().await;
}

async fn spawn_upstream(response: Vec<u8>) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("upstream binds");
    let address = listener.local_addr().expect("upstream address");
    tokio::spawn(serve_once(listener, response));
    address
}

/// Reassemble a chunked body from a raw response carried across the tunnel.
fn dechunk(raw: &str) -> String {
    let (_head, rest) = raw.split_once("\r\n\r\n").expect("response head");
    let mut body = String::new();
    let mut rest = rest;
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
/// EOF, close. Runs on a blocking thread because the wrapper is blocking.
fn read_response(phone: &MobileBridge, node_hex: &str, lane: Lane, request: &[u8]) -> String {
    let tunnel = phone
        .connect(node_hex.to_string(), lane)
        .expect("tunnel opens");
    tunnel.write(request.to_vec()).expect("request written");
    let mut raw = Vec::new();
    loop {
        let bytes = tunnel.read(8192).expect("tunnel read");
        if bytes.is_empty() {
            break;
        }
        raw.extend_from_slice(&bytes);
    }
    tunnel.close();
    String::from_utf8(raw).expect("utf-8")
}

#[tokio::test(flavor = "multi_thread")]
async fn both_lanes_carry_http_through_the_tunnel() {
    let dir = temp_dir("lanes");
    let book = AddressBook::new();

    let door_addr = spawn_upstream(chunked_door_response()).await;
    let desk_addr = spawn_upstream(chunked_sse_desk_response()).await;

    let desktop = Bridge::start(
        BridgeConfig::new(door_addr)
            .with_desk(desk_addr)
            .with_relay(RelayChoice::Disabled)
            .with_address_book(book.clone()),
        &dir.join("desktop.key"),
    )
    .await
    .expect("desktop bridge starts");
    let desktop_hex = desktop.node_id().to_string();

    // The phone bridge starts its own runtime, so it is born on the
    // blocking pool too — never inside this test's async context.
    let phone_key = dir.join("phone.key");
    let phone_book = book.clone();
    let (door_response, desk_response) =
        tokio::task::spawn_blocking(move || {
            let phone = MobileBridge::for_tests(phone_key, &phone_book)
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
        .await
        .expect("blocking client runs");

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
        "both chunks must survive the tunnel: {door_response}"
    );

    assert!(
        desk_response.starts_with("HTTP/1.1 200 OK"),
        "expected the desk's answer, got: {desk_response}"
    );
    let desk_body = dechunk(&desk_response);
    let offer = desk_body.find("data: offer-abc").expect("the offer event");
    let complete = desk_body.find("data: complete-def").expect("the complete event");
    assert!(
        offer < complete,
        "the desk's events must arrive in order: {desk_body}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_mistyped_node_hex_is_a_typed_error_not_a_panic() {
    let dir = temp_dir("badhex");
    let book = AddressBook::new();
    let phone_key = dir.join("phone.key");
    let attempts = tokio::task::spawn_blocking(move || {
        let phone = MobileBridge::for_tests(phone_key, &book)
            .expect("phone bridge starts");
        vec![
            phone.connect("abcd".to_string(), Lane::Door),
            phone.connect("z".repeat(64), Lane::Door),
        ]
    })
    .await
    .expect("blocking client runs");

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
