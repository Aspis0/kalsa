use std::io::{self, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use super::{proxy, Door, DoorError, CONNECTION_LIFETIME, MAX_CONNECTIONS, TOKEN_BYTES};
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
    let mut pairing = Pairing::offer(
        "http://127.0.0.1:8131",
        None,
        now,
        Duration::from_secs(60),
    )
    .unwrap();
    let payload: serde_json::Value = serde_json::from_str(&pairing.qr_payload().unwrap()).unwrap();
    let code = payload["code"].as_str().unwrap();
    let nonce = payload["nonce"].as_str().unwrap();
    assert!(matches!(pairing.claim(code, now), ClaimResult::Claimed));
    let declaration = PhoneDeclaration::sign(
        code,
        nonce,
        payload["reachable"].as_str().unwrap(),
        None,
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
    assert!(!door.has_active_connection());
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
fn an_unauthenticated_socket_is_not_an_active_phone() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let door = Door::new(listener, 1, credential())
        .unwrap()
        .start()
        .unwrap();
    let client = TcpStream::connect(address).unwrap();
    thread::sleep(Duration::from_millis(25));
    assert!(!door.has_active_connection());
    drop(client);
    door.shutdown();
}

#[test]
fn a_connection_whose_stamp_has_expired_still_gets_its_head_read() {
    // The accepted stamp here is long stale — the shape of a connection
    // that waited in the queue. The head arrives complete, so the worker's
    // own patience reads it and answers on its merits: the credential
    // below is wrong, and the answer says exactly that, byte for byte.
    // (A connection whose head was never read at all is answered busy
    // instead — see the true-path test.)
    let upstream = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    drop(upstream);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let stop = AtomicBool::new(false);
        let active = AtomicUsize::new(0);
        let accepted = Instant::now()
            .checked_sub(super::HEAD_PATIENCE + Duration::from_secs(5))
            .unwrap();
        proxy::handle(
            stream,
            accepted,
            super::HEAD_PATIENCE,
            upstream_port,
            &[0u8; TOKEN_BYTES],
            &stop,
            &active,
            None,
        );
    });
    let mut client = TcpStream::connect(address).unwrap();
    client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    client
        .write_all(b"POST / HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .unwrap();
    let mut response = Vec::new();
    client.read_to_end(&mut response).expect("answer arrives");
    assert_eq!(
        response,
        super::UNAUTHORIZED_RESPONSE.to_vec(),
        "a complete head on a stale stamp was not read and answered"
    );
    server.join().unwrap();
}

#[test]
fn a_queued_request_is_served_and_a_silent_one_answered_busy() {
    // The true path: accept loop, queue, workers. Four long exchanges fill
    // the pool, so the next connections wait in the queue longer than the
    // head patience. One of them arrives complete — bytes already on the
    // wire — and must be read with a fresh patience and answered. One says
    // nothing at all: its answer is the busy one, never a lying 401.
    let head_patience = Duration::from_millis(300);
    let upstream = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    let upstream_stop = Arc::new(AtomicBool::new(false));
    let upstream_thread = {
        let stop = Arc::clone(&upstream_stop);
        thread::spawn(move || {
            upstream.set_nonblocking(true).unwrap();
            while !stop.load(Ordering::SeqCst) {
                match upstream.accept() {
                    // Each connection is served on its own thread: a held
                    // exchange must not stop the next one from being
                    // accepted and answered.
                    Ok((stream, _)) => {
                        thread::spawn(move || {
                            let mut stream = stream;
                            stream.set_nonblocking(false).expect("blocking");
                            let mut head = Vec::new();
                            let mut byte = [0u8; 1];
                            loop {
                                use std::io::Read;
                                if stream.read(&mut byte).unwrap_or(0) == 0
                                    || (head.push(byte[0]), head.ends_with(b"\r\n\r\n")).1
                                {
                                    break;
                                }
                            }
                            if head.windows(7).any(|window| window == b"/answer") {
                                let _ = std::io::Write::write_all(
                                    &mut stream,
                                    b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello",
                                );
                            }
                            // Anything else is a held exchange: open and
                            // silent for a fixed hold — long enough that
                            // the queued connections outwait the head
                            // patience — then the socket is dropped, which
                            // frees the worker that serves it. Read
                            // timeouts are not a close: the hold survives
                            // them.
                            let hold_until = std::time::Instant::now()
                                + Duration::from_millis(600);
                            let _ = stream
                                .set_read_timeout(Some(Duration::from_millis(50)));
                            loop {
                                if std::time::Instant::now() >= hold_until {
                                    break;
                                }
                                match stream.read(&mut byte) {
                                    Ok(0) => break,
                                    Err(ref e)
                                        if e.kind() == io::ErrorKind::WouldBlock
                                            || e.kind() == io::ErrorKind::TimedOut =>
                                    {
                                        continue
                                    }
                                    Err(_) => break,
                                    Ok(_) => {}
                                }
                            }
                        });
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(_) => return,
                }
            }
        })
    };

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_port, token.clone())
        .unwrap()
        .with_head_patience(head_patience)
        .start()
        .unwrap();

    let request_for = |path: &str, stream: &mut TcpStream| {
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        stream
            .write_all(
                format!(
                    "POST {path} HTTP/1.1\r\nHost: localhost\r\n\
                     Authorization: Bearer {token}\r\nContent-Length: 0\r\n\
                     Connection: close\r\n\r\n"
                )
                .as_bytes(),
            )
            .unwrap();
    };

    // Four exchanges the upstream holds open: the pool is full.
    let mut held = Vec::new();
    for _ in 0..4 {
        let mut stream = TcpStream::connect(address).unwrap();
        request_for("/hold", &mut stream);
        held.push(stream);
    }
    thread::sleep(Duration::from_millis(100));

    // The victims of the queue: one speaks at once, one never speaks.
    let mut speaking = TcpStream::connect(address).unwrap();
    request_for("/answer", &mut speaking);
    let mut silent = TcpStream::connect(address).unwrap();
    thread::sleep(head_patience + Duration::from_millis(200));

    drop(held);
    let mut served = Vec::new();
    speaking
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    speaking.read_to_end(&mut served).expect("the queued request is served");
    assert!(
        served.starts_with(b"HTTP/1.1 200 OK"),
        "a complete request that waited in the queue was refused on the queue's clock: {served:?}"
    );

    let mut busy = Vec::new();
    silent
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    silent.read_to_end(&mut busy).expect("the silent one is answered");
    assert!(
        busy.starts_with(b"HTTP/1.1 503"),
        "a connection whose head was never read must be answered busy, not unauthorized: {busy:?}"
    );

    drop(speaking);
    drop(silent);
    door.shutdown();
    upstream_stop.store(true, Ordering::SeqCst);
    upstream_thread.join().unwrap();
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
fn handled_requests_free_their_slot_so_the_door_stays_open() {
    // One slot per in-flight request, handed back when the request is done:
    // twice as many sequential requests as the budget allows must all be
    // served. A slot leaked per request would fill the door at exactly
    // MAX_CONNECTIONS and start refusing.
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    let upstream_stop = Arc::new(AtomicBool::new(false));
    let upstream_thread = thread::spawn({
        let stop = Arc::clone(&upstream_stop);
        move || {
            upstream
                .set_nonblocking(true)
                .expect("upstream nonblocking");
            while !stop.load(Ordering::SeqCst) {
                match upstream.accept() {
                    Ok((mut stream, _)) => {
                        // macOS inherits the listener's non-blocking flag on
                        // accepted sockets; the relay below is blocking.
                        stream.set_nonblocking(false).expect("accepted stream blocking");
                        let mut request = Vec::new();
                        let _ = read_until(&mut stream, b"\r\n\r\n", &mut request);
                        let _ = std::io::Write::write_all(
                            &mut stream,
                            b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        );
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(_) => return,
                }
            }
        }
    });
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_port, token.clone())
        .unwrap()
        .start()
        .unwrap();
    for _ in 0..(MAX_CONNECTIONS * 2) {
        let response = request(address, Some(&format!("Bearer {token}")));
        assert_eq!(
            response,
            b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
            "a handled request did not free its slot: the door filled up"
        );
    }
    door.shutdown();
    upstream_stop.store(true, Ordering::SeqCst);
    upstream_thread.join().unwrap();
}

#[test]
fn a_connection_past_its_lifetime_is_cut() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let stop = AtomicBool::new(false);
        let active = AtomicUsize::new(0);
        let accepted = Instant::now()
            .checked_sub(CONNECTION_LIFETIME + Duration::from_secs(1))
            .unwrap();
        proxy::handle(
            stream,
            accepted,
            super::HEAD_PATIENCE,
            1,
            &[0u8; TOKEN_BYTES],
            &stop,
            &active,
            None,
        );
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
