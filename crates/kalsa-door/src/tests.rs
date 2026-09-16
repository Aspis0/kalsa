use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::AtomicBool;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use super::{proxy, Door, DoorError, CONNECTION_LIFETIME, TOKEN_BYTES};
use kalsa_catalog::PhoneModel;
use kalsa_pairing::{ClaimResult, Pairing, PhoneDeclaration};

fn request(address: std::net::SocketAddr, authorization: Option<&str>) -> Vec<u8> {
    let auth = authorization
        .map(|value| format!("Authorization: {value}\r\n"))
        .unwrap_or_default();
    let mut stream = TcpStream::connect(address).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    write!(
        stream,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n{auth}Content-Length: 0\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    stream.shutdown(Shutdown::Write).unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    response
}

fn credential() -> String {
    let now = SystemTime::now();
    let mut pairing =
        Pairing::offer("http://127.0.0.1:8131", now, Duration::from_secs(60)).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&pairing.qr_payload().unwrap()).unwrap();
    let code = payload["code"].as_str().unwrap();
    let nonce = payload["nonce"].as_str().unwrap();
    assert!(matches!(pairing.claim(code, now), ClaimResult::Claimed));
    let declaration = PhoneDeclaration::sign(
        code,
        nonce,
        payload["reachable"].as_str().unwrap(),
        PhoneModel {
            weights_bytes: 1,
            parameters: None,
            measured_tokens_per_second: None,
            battery_powered: None,
        },
    )
    .unwrap();
    let (handshake, _) = pairing.complete(declaration, now).unwrap();
    handshake.credential_hex()
}

fn wrong_credential(token: &str) -> String {
    let mut wrong = token.as_bytes().to_vec();
    wrong[0] = if wrong[0] == b'0' { b'1' } else { b'0' };
    String::from_utf8(wrong).unwrap()
}

#[test]
fn a_non_loopback_listener_is_refused_at_construction() {
    let listener = TcpListener::bind("0.0.0.0:0").unwrap();
    let result = Door::new(listener, 1, credential());
    assert!(matches!(result, Err(DoorError::NonLoopback(_))));
}

#[test]
fn the_running_door_reports_the_address_it_serves() {
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    let upstream_thread = thread::spawn(move || {
        let (mut stream, _) = upstream.accept().unwrap();
        let mut request = Vec::new();
        read_until(&mut stream, b"\r\n\r\n", &mut request).unwrap();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
            .unwrap();
    });
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let bound_address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_port, token.clone())
        .unwrap()
        .start()
        .unwrap();
    assert_eq!(door.address(), bound_address);
    assert_eq!(
        request(door.address(), Some(&format!("Bearer {token}"))),
        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
    );
    upstream_thread.join().unwrap();
    door.shutdown();
}

#[test]
fn every_authentication_failure_has_the_same_refusal() {
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    drop(upstream);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_port, token.clone())
        .unwrap()
        .start()
        .unwrap();
    let wrong = format!("Bearer {}", wrong_credential(&token));
    let refusal = request(address, Some(&wrong));
    assert!(refusal.starts_with(b"HTTP/1.1 401"));
    assert_eq!(
        request(address, None),
        refusal,
        "missing and wrong credentials are indistinguishable"
    );
    assert_eq!(request(address, Some("Basic anything")), refusal);
    assert_eq!(request(address, Some("Bearer")), refusal);
    door.shutdown();
}

#[test]
fn an_authenticated_request_when_upstream_is_down_returns_a_clean_error() {
    let unused = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = unused.local_addr().unwrap().port();
    drop(unused);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_port, token.clone())
        .unwrap()
        .start()
        .unwrap();
    let response = request(address, Some(&format!("Bearer {token}")));
    assert_eq!(
        response,
        b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    door.shutdown();
}

#[test]
fn a_connection_past_its_lifetime_is_cut() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let stop = AtomicBool::new(false);
        let accepted = Instant::now()
            .checked_sub(CONNECTION_LIFETIME + Duration::from_secs(1))
            .unwrap();
        proxy::handle(stream, accepted, 1, &[0u8; TOKEN_BYTES], &stop);
    });
    let mut client = TcpStream::connect(address).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(1)))
        .unwrap();
    let mut response = Vec::new();
    client.read_to_end(&mut response).unwrap();
    assert!(
        response.is_empty(),
        "an expired connection gets no response"
    );
    server.join().unwrap();
}

#[test]
fn an_sse_response_reaches_the_client_before_the_upstream_finishes() {
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_address = upstream.local_addr().unwrap();
    let (first_sent, first_received) = mpsc::channel();
    let (allow_second, second_allowed) = mpsc::channel();
    let upstream_thread = thread::spawn(move || {
        let (mut stream, _) = upstream.accept().unwrap();
        let mut request = Vec::new();
        read_until(&mut stream, b"\r\n\r\n", &mut request).unwrap();
        let body = b"{\"x\":1}";
        let mut received_body = vec![0u8; body.len()];
        stream.read_exact(&mut received_body).unwrap();
        assert_eq!(received_body, body);
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            )
            .unwrap();
        write_chunk(&mut stream, b"data: one\n\n");
        first_sent.send(()).unwrap();
        second_allowed.recv_timeout(Duration::from_secs(2)).unwrap();
        write_chunk(&mut stream, b"data: two\n\n");
        stream.write_all(b"0\r\n\r\n").unwrap();
    });

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_address.port(), token.clone())
        .unwrap()
        .start()
        .unwrap();
    let mut client = TcpStream::connect(address).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    write!(
        client,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\nContent-Length: 7\r\nConnection: close\r\n\r\n{{\"x\":1}}"
    )
    .unwrap();
    let started = Instant::now();
    let mut first = Vec::new();
    read_until(&mut client, b"data: one\n\n", &mut first).unwrap();
    assert!(started.elapsed() < Duration::from_secs(1));
    first_received.recv_timeout(Duration::from_secs(1)).unwrap();
    allow_second.send(()).unwrap();
    let mut rest = Vec::new();
    client.read_to_end(&mut rest).unwrap();
    assert!(first
        .windows(b"data: one\n\n".len())
        .any(|chunk| chunk == b"data: one\n\n"));
    assert!(rest
        .windows(b"data: two\n\n".len())
        .any(|chunk| chunk == b"data: two\n\n"));
    upstream_thread.join().unwrap();
    door.shutdown();
}

fn write_chunk(stream: &mut TcpStream, body: &[u8]) {
    write!(stream, "{:x}\r\n", body.len()).unwrap();
    stream.write_all(body).unwrap();
    stream.write_all(b"\r\n").unwrap();
}

fn read_until(stream: &mut TcpStream, needle: &[u8], output: &mut Vec<u8>) -> std::io::Result<()> {
    let mut byte = [0u8; 1];
    while !output.windows(needle.len()).any(|chunk| chunk == needle) {
        stream.read_exact(&mut byte)?;
        output.push(byte[0]);
    }
    Ok(())
}
