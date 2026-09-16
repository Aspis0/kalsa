use std::io::{self, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use super::registry::Registry;
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
                        // On macOS an accepted socket inherits the
                        // listener's non-blocking flag; a read that gives
                        // up on WouldBlock would answer before the
                        // request arrived and its drop would reset the
                        // door mid-relay. The head is therefore read
                        // blocking, bounded, and loudly.
                        let _ = stream.set_nonblocking(false);
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                        let mut request = Vec::new();
                        read_until(&mut stream, b"\r\n\r\n", &mut request)
                            .expect("upstream got a whole request head");
                        std::io::Write::write_all(
                            &mut stream,
                            b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        )
                        .expect("upstream answered");
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
    let registry = Registry::new();
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
            1,
            &[0u8; TOKEN_BYTES],
            &registry,
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

/// The ids the door minted, in the order the client received them. This is
/// the whole resume contract in one line of text per event.
fn event_ids(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| line.strip_prefix("id: ").map(str::to_string))
        .collect()
}

fn post(address: std::net::SocketAddr, token: &str, last_event_id: Option<&str>) -> TcpStream {
    let mut client = TcpStream::connect(address).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let resume = last_event_id
        .map(|id| format!("Last-Event-ID: {id}\r\n"))
        .unwrap_or_default();
    write!(
        client,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\n{resume}Content-Length: 7\r\nConnection: close\r\n\r\n{{\"x\":1}}"
    )
    .unwrap();
    client
}

#[test]
fn an_answer_survives_a_brutal_disconnect_and_resumes_from_the_last_event_id() {
    // The whole point of jobs, end to end: a client reading a live stream
    // dies with a reset — no goodbye — the model finishes the answer with
    // nobody listening, the client comes back naming the last id it saw,
    // and receives the rest of one answer, in order, once.
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_address = upstream.local_addr().unwrap();
    let (client_died, client_gone) = mpsc::channel();
    let upstream_thread = thread::spawn(move || {
        let (mut stream, _) = upstream.accept().unwrap();
        let mut request = Vec::new();
        read_until(&mut stream, b"\r\n\r\n", &mut request).unwrap();
        let mut body = vec![0u8; 7];
        stream.read_exact(&mut body).unwrap();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n")
            .unwrap();
        write_chunk(&mut stream, b"data: one\n\ndata: two\n\n");
        // The phone is gone from here on; the model keeps producing.
        client_gone.recv_timeout(Duration::from_secs(5)).unwrap();
        write_chunk(&mut stream, b"data: three\n\ndata: four\n\ndata: five\n\ndata: [DONE]\n\n");
        stream.write_all(b"0\r\n\r\n").unwrap();
        // The server drains until the client's side disappears.
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let mut byte = [0u8; 1];
        loop {
            match stream.read(&mut byte) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
    });

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_address.port(), token.clone())
        .unwrap()
        .start()
        .unwrap();

    // Read two numbered events, then hang up brutally: linger zero turns
    // the drop into a reset, not a polite close.
    let (job, last_seen) = {
        let mut client = post(address, &token, None);
        let mut seen = Vec::new();
        read_until(&mut client, b"data: two\n\n", &mut seen).unwrap();
        let ids = event_ids(&String::from_utf8(seen).unwrap());
        assert_eq!(ids.len(), 2, "the door numbered both events: {ids:?}");
        let job = ids[0]
            .rsplit_once(':')
            .map(|(token, _)| token.to_string())
            .unwrap();
        let last_seen = ids[1].clone();
        // No goodbye: the transport dies under the client, mid-answer.
        client.shutdown(Shutdown::Both).unwrap();
        drop(client);
        client_died.send(()).unwrap();
        (job, last_seen)
    };
    assert_ne!(job, "", "the job token is real bytes, never empty");

    // The answer finished with nobody listening at all.
    upstream_thread.join().unwrap();

    // The phone returns, naming the last id it saw.
    let mut returning = post(address, &token, Some(&last_seen));
    let mut raw = Vec::new();
    returning.read_to_end(&mut raw).unwrap();
    let text = String::from_utf8(raw).unwrap();
    assert!(
        text.starts_with("HTTP/1.1 200 OK"),
        "a resume is the same answer: {text}"
    );
    let ids = event_ids(&text);
    let wanted: Vec<String> = (2..6).map(|index| format!("{job}:{index}")).collect();
    assert_eq!(
        ids, wanted,
        "exactly the missed events, in order, without duplicates or holes"
    );
    for words in ["data: three", "data: four", "data: five", "data: [DONE]"] {
        assert!(text.contains(words), "the answer kept its content: {words}");
    }
    for lost in ["data: one", "data: two"] {
        assert!(
            !text.contains(lost),
            "what the client already had is not sent again: {lost}"
        );
    }
    door.shutdown();
}

#[test]
fn a_returning_client_rejoins_an_answer_still_in_motion() {
    // The resumer is served what it missed and then the live tail of the
    // same generation, with no seam between the two.
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_address = upstream.local_addr().unwrap();
    let (client_died, client_gone) = mpsc::channel();
    let upstream_thread = thread::spawn(move || {
        let (mut stream, _) = upstream.accept().unwrap();
        let mut request = Vec::new();
        read_until(&mut stream, b"\r\n\r\n", &mut request).unwrap();
        let mut body = vec![0u8; 7];
        stream.read_exact(&mut body).unwrap();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n")
            .unwrap();
        write_chunk(&mut stream, b"data: one\n\ndata: two\n\n");
        client_gone.recv_timeout(Duration::from_secs(5)).unwrap();
        // Long enough that the resumer is attached and waiting before the
        // generation moves on.
        thread::sleep(Duration::from_millis(200));
        write_chunk(&mut stream, b"data: three\n\ndata: [DONE]\n\n");
        stream.write_all(b"0\r\n\r\n").unwrap();
    });

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_address.port(), token.clone())
        .unwrap()
        .start()
        .unwrap();

    let (job, last_seen) = {
        let mut client = post(address, &token, None);
        let mut seen = Vec::new();
        read_until(&mut client, b"data: two\n\n", &mut seen).unwrap();
        let ids = event_ids(&String::from_utf8(seen).unwrap());
        // No goodbye: the transport dies under the client, mid-answer.
        client.shutdown(Shutdown::Both).unwrap();
        let last_seen = ids[1].clone();
        let job = ids[0]
            .rsplit_once(':')
            .map(|(token, _)| token.to_string())
            .unwrap();
        drop(client);
        client_died.send(()).unwrap();
        (job, last_seen)
    };
    let mut returning = post(address, &token, Some(&last_seen));
    let mut raw = Vec::new();
    returning.read_to_end(&mut raw).unwrap();
    let text = String::from_utf8(raw).unwrap();
    let ids = event_ids(&text);
    let wanted: Vec<String> = (2..4).map(|index| format!("{job}:{index}")).collect();
    assert_eq!(ids, wanted, "one continuous answer, no seam: {ids:?}");
    upstream_thread.join().unwrap();
    door.shutdown();
}

#[test]
fn a_resume_the_door_cannot_honor_is_refused_and_starts_nothing() {
    // An upstream that is never reached: bound, deaf. Every refusal below
    // must be the door's own words, without a generation being started.
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_address = upstream.local_addr().unwrap();
    upstream.set_nonblocking(true).unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_address.port(), token.clone())
        .unwrap()
        .start()
        .unwrap();

    let nonsense = post(address, &token, Some("not-an-id"));
    let refusal = read_all(nonsense);
    assert!(
        refusal.starts_with(b"HTTP/1.1 410 Gone"),
        "an unusable id is answered, not ignored: {refusal:?}"
    );
    let unknown = post(address, &token, Some(&format!("{}:1", "0".repeat(32))));
    let refusal = read_all(unknown);
    assert!(refusal.starts_with(b"HTTP/1.1 410 Gone"));
    assert!(
        String::from_utf8_lossy(&refusal).contains("no longer kept"),
        "the refusal says what happened: {refusal:?}"
    );

    // Resuming is authenticated like everything else: the wrong credential
    // is a 401 before any question about the job is even considered.
    let wrong = wrong_credential(&token);
    let stranger = post(address, &wrong, Some(&format!("{}:1", "0".repeat(32))));
    assert!(read_all(stranger).starts_with(b"HTTP/1.1 401"));

    // Nothing derailed into the upstream: no connection was ever made.
    assert!(
        upstream.accept().is_err(),
        "a refused resume must not start a generation"
    );
    door.shutdown();
}

fn read_all(mut stream: TcpStream) -> Vec<u8> {
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    response
}

#[test]
fn the_generation_continues_after_its_client_dies() {
    // The product's own promise, in two separated moments of time: the
    // client reads part of the answer and dies; the producer must LEARN
    // that nobody is listening (its write into the dead socket fails — the
    // keep-alive pings below are what makes it write); and only then does
    // the model emit the rest. A producer that stops when nobody listens
    // would never read that last part, and the returning phone would find
    // the answer missing it.
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_address = upstream.local_addr().unwrap();
    let (client_died, client_gone) = mpsc::channel();
    let upstream_thread = thread::spawn(move || {
        let (mut stream, _) = upstream.accept().unwrap();
        let mut request = Vec::new();
        read_until(&mut stream, b"\r\n\r\n", &mut request).unwrap();
        let mut body = vec![0u8; 7];
        stream.read_exact(&mut body).unwrap();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n")
            .unwrap();
        write_chunk(&mut stream, b"data: one\n\ndata: two\n\n");
        client_gone.recv_timeout(Duration::from_secs(5)).unwrap();
        // The server's own keep-alives, in their own reads: by the second
        // one the producer has written into the dead socket and failed.
        // Pings are fire-and-forget: a dropped road must not end the
        // answer here.
        for _ in 0..4 {
            let _ = write_chunk(&mut stream, b": ping\n\n");
            thread::sleep(Duration::from_millis(50));
        }
        // Only now the last of the answer, in reads of their own.
        write_chunk(&mut stream, b"data: three\n\ndata: four\n\ndata: five\n\ndata: [DONE]\n\n");
        stream.write_all(b"0\r\n\r\n").unwrap();
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let mut byte = [0u8; 1];
        loop {
            match stream.read(&mut byte) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
    });

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_address.port(), token.clone())
        .unwrap()
        .start()
        .unwrap();

    // The client reads two numbered events and dies with no goodbye.
    let (job, last_seen) = {
        let mut client = post(address, &token, None);
        let mut seen = Vec::new();
        read_until(&mut client, b"data: two\n\n", &mut seen).unwrap();
        let ids = event_ids(&String::from_utf8(seen).unwrap());
        assert_eq!(ids.len(), 2);
        client.shutdown(Shutdown::Both).unwrap();
        let last_seen = ids[1].clone();
        let job = ids[0]
            .rsplit_once(':')
            .map(|(token, _)| token.to_string())
            .unwrap();
        drop(client);
        client_died.send(()).unwrap();
        (job, last_seen)
    };

    // The phone returns long after, naming the last id it saw.
    let mut returning = post(address, &token, Some(&last_seen));
    let mut raw = Vec::new();
    match returning.read_to_end(&mut raw) {
        Ok(_) => {}
        // macOS surfaces a socket read timeout as EAGAIN/WouldBlock.
        Err(error)
            if error.kind() == io::ErrorKind::TimedOut
                || error.kind() == io::ErrorKind::WouldBlock =>
        {
            panic!("the answer stopped when nobody was listening: {error}")
        }
        Err(error) => panic!("{error}"),
    }
    let text = String::from_utf8(raw).unwrap();
    assert!(
        text.starts_with("HTTP/1.1 200 OK"),
        "a resume is the same answer: {text}"
    );
    let ids = event_ids(&text);
    let wanted: Vec<String> = (2..6).map(|index| format!("{job}:{index}")).collect();
    assert_eq!(
        ids, wanted,
        "the events made after the client died are in the answer"
    );
    for words in ["data: three", "data: four", "data: five", "data: [DONE]"] {
        assert!(text.contains(words), "the tail was produced anyway: {words}");
    }
    for seen_before in ["data: one", "data: two"] {
        assert!(!text.contains(seen_before), "no duplicates: {seen_before}");
    }
    upstream_thread.join().unwrap();
    door.shutdown();
}
