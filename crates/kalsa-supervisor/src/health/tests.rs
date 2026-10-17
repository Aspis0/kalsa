//! The handshake's own tests.
//!
//! The fixture answers one request per connection, the way the fork is asked:
//! every question is a plain `GET` with `Connection: close`.

use std::io::Write as _;
use std::net::{SocketAddr, TcpListener};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use super::{
    Answer, HEALTH_PATH, IDENTITY_PATH, Who, code_of, content_length_of, health_ok, read_head,
    status_of, who_answers, wrong_key,
};

const OUR_KEY: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

#[test]
fn a_status_line_is_read_whole_and_only_whole() {
    assert_eq!(code_of("HTTP/1.1 200 OK\r\n"), "200");
    assert_eq!(code_of("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"), "401");
    assert_eq!(code_of("HTTP/1.1 403 Forbidden"), "403");
    assert_eq!(code_of(""), "");
    assert_eq!(code_of("garbage"), "");
    // A code without a status line is not a code.
    assert_eq!(code_of("200 OK"), "");
}

#[test]
fn any_2xx_is_an_answer_and_only_401_or_403_is_a_refused_key() {
    // The comment on `IDENTITY_PATH` says "any 2xx"; this is that sentence.
    assert_eq!(status_of("HTTP/1.1 200 OK\r\n\r\n"), Answer::Accepted);
    assert_eq!(status_of("HTTP/1.1 204 No Content\r\n\r\n"), Answer::Accepted);
    assert_eq!(status_of("HTTP/1.1 401 Unauthorized\r\n\r\n"), Answer::RefusedKey);
    assert_eq!(status_of("HTTP/1.1 403 Forbidden\r\n\r\n"), Answer::RefusedKey);
    // 503 is the fork saying it is still loading, and 404 is not this route.
    assert_eq!(status_of("HTTP/1.1 503 Service Unavailable\r\n\r\n"), Answer::Silent);
    assert_eq!(status_of("HTTP/1.1 404 Not Found\r\n\r\n"), Answer::Silent);
}

#[test]
fn the_control_key_is_never_the_key_it_corrects() {
    assert_ne!(wrong_key(OUR_KEY), OUR_KEY);
    assert!(wrong_key(OUR_KEY).starts_with('0'));
    assert!(wrong_key("0bcdef").starts_with('1'), "a key already starting 0 flips");
    // A key that cannot be flipped is returned as it is, and it is still not
    // what the fork would accept for us.
    assert_eq!(wrong_key(""), "");
}

#[test]
fn the_key_goes_on_the_wire_only_where_one_is_asked_for() {
    // `stand_in` reads the request as the engine would, so this reads the
    // bytes on the port: the gated request carries the bearer, the health
    // request behind it carries nothing.
    let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let (addr, stop) = stand_in(Arc::clone(&seen), |request| {
        if request.contains(IDENTITY_PATH) {
            if request.contains(&format!("Bearer {OUR_KEY}")) {
                status(200, "{}")
            } else {
                status(401, "unauthorized")
            }
        } else {
            status(200, r#"{"status":"ok"}"#)
        }
    });
    assert_eq!(who_answers(addr, OUR_KEY, Duration::from_secs(2)), Who::Ready);
    stop();
    let seen = seen.lock().expect("the requests the stand-in read");
    assert_eq!(seen.len(), 3, "the proof is three requests: {seen:?}");
    assert!(
        seen[0].contains(&format!("GET {IDENTITY_PATH} ")) && seen[0].contains("Authorization: Bearer"),
        "the gated request went out without a key: {}",
        seen[0]
    );
    assert!(
        seen[1].contains("GET /health ") && !seen[1].contains("Authorization"),
        "the health request carried a key it does not need: {}",
        seen[1]
    );
    assert!(
        seen[2].contains("Authorization: Bearer") && seen[2].contains(&wrong_key(OUR_KEY)),
        "the control did not carry the key it is meant to be refused: {}",
        seen[2]
    );
}

/// Every request ends with this, and the handshake depends on it: a server
/// that held the connection open would leave the body unread, and the read
/// past it would block for the whole probe bound.
#[test]
fn every_request_asks_for_the_connection_to_close() {
    let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let (addr, stop) = stand_in(Arc::clone(&seen), |request| {
        if request.contains(IDENTITY_PATH) && request.contains(&format!("Bearer {OUR_KEY}")) {
            status(200, "{}")
        } else if request.contains(IDENTITY_PATH) {
            status(401, "unauthorized")
        } else {
            status(200, r#"{"status":"ok"}"#)
        }
    });
    assert_eq!(who_answers(addr, OUR_KEY, Duration::from_secs(2)), Who::Ready);
    stop();
    let seen = seen.lock().expect("the requests");
    assert!(
        seen.iter().all(|request| request.contains("Connection: close")),
        "a request did not ask for its connection to close: {seen:?}"
    );
}

/// The bug that cost an evening of CPU-only decoding: a stale engine from an
/// earlier run answers the open route — `/health`, which the fork serves
/// without a key — with a plain `200`, and a handshake built on that route
/// alone reports it as the engine this run just started.
#[test]
fn a_stale_engine_that_refuses_our_key_is_a_stranger_however_healthy_it_looks() {
    let (addr, stop) = stand_in(Arc::new(Mutex::new(Vec::new())), |request| {
        if request.contains(IDENTITY_PATH) {
            status(401, "unauthorized")
        } else {
            status(200, r#"{"status":"ok"}"#)
        }
    });
    let who = who_answers(addr, OUR_KEY, Duration::from_secs(2));
    stop();
    assert_eq!(
        who,
        Who::Stranger,
        "a listener that refuses our key was taken for our own engine"
    );
}

/// The other half of the hole: a `200` from a listener that never checks
/// `Authorization` proves nothing about anybody's key. It must not pass.
#[test]
fn a_listener_that_answers_every_key_is_a_stranger() {
    let (addr, stop) = stand_in(Arc::new(Mutex::new(Vec::new())), |_| status(200, "{}"));
    let who = who_answers(addr, OUR_KEY, Duration::from_secs(2));
    stop();
    assert_eq!(
        who,
        Who::Stranger,
        "a listener that took the wrong key too was taken for our own engine"
    );
}

#[test]
fn our_own_loaded_engine_is_ready() {
    let (addr, stop) = stand_in(Arc::new(Mutex::new(Vec::new())), |request| {
        if request.contains(HEALTH_PATH) {
            status(200, r#"{"status":"ok"}"#)
        } else if request.contains(&format!("Bearer {OUR_KEY}")) {
            status(200, r#"{"a_body":"long_enough_to_be_read_past"}"#)
        } else {
            status(401, "unauthorized")
        }
    });
    let who = who_answers(addr, OUR_KEY, Duration::from_secs(2));
    stop();
    assert_eq!(who, Who::Ready);
}

/// Ours, but still loading: the fork's `503` on the open route is the start
/// still happening, not a failure to report.
#[test]
fn an_engine_still_loading_is_not_ready_yet() {
    let (addr, stop) = stand_in(Arc::new(Mutex::new(Vec::new())), |request| {
        if request.contains(HEALTH_PATH) {
            status(503, "loading")
        } else if request.contains(&format!("Bearer {OUR_KEY}")) {
            status(200, "{}")
        } else {
            status(401, "unauthorized")
        }
    });
    let who = who_answers(addr, OUR_KEY, Duration::from_secs(2));
    stop();
    assert_eq!(who, Who::Loading);
}

#[test]
fn a_port_nobody_listens_on_is_loading_not_a_stranger() {
    // Nothing there to refuse the key, so there is nobody to be a stranger:
    // this is an engine that has not bound yet.
    let addr: SocketAddr = "127.0.0.1:1".parse().expect("a literal address");
    assert_eq!(
        who_answers(addr, OUR_KEY, Duration::from_millis(250)),
        Who::Loading
    );
}

/// A control the engine could not answer proves nothing, so nothing is adopted.
#[test]
fn a_listener_that_cannot_answer_the_whole_proof_is_not_ready() {
    let (addr, stop) = stand_in(Arc::new(Mutex::new(Vec::new())), |request| {
        if request.contains(HEALTH_PATH) {
            status(200, "ok")
        } else if request.contains(&format!("Bearer {OUR_KEY}")) {
            status(200, "{}")
        } else {
            // The control cannot be answered at all: a reset, not a refusal.
            "\r\n".to_string()
        }
    });
    let who = who_answers(addr, OUR_KEY, Duration::from_secs(2));
    stop();
    assert_eq!(who, Who::Loading, "a half-proved identity was called ready");
}

#[test]
fn the_liveness_watch_reads_a_status_without_a_key() {
    let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let (addr, stop) = stand_in(Arc::clone(&seen), |_| status(200, "ok"));
    assert!(health_ok(addr, HEALTH_PATH, Duration::from_secs(2)));
    stop();
    let seen = seen.lock().expect("the requests");
    assert!(
        seen.iter().all(|request| !request.contains("Authorization")),
        "the liveness watch asked with a key it does not need: {seen:?}"
    );
}

/// A head that arrives in pieces is still a head; one that never finishes is
/// not read at all, because half a status line is not a status.
#[test]
fn a_head_split_across_reads_is_read_and_a_head_that_never_ends_is_not() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("its own address");
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("a connection");
        let _ = stream.write_all(b"HTTP/1.1 20");
        std::thread::sleep(Duration::from_millis(20));
        let _ = stream.write_all(b"1 Partial Content\r\nContent-Length: 0\r\n\r\n");
        std::thread::sleep(Duration::from_millis(50));

        let (mut stream, _) = listener.accept().expect("a second connection");
        let _ = stream.write_all(b"HTTP/1.1 401 Unau");
        std::thread::sleep(Duration::from_millis(80));
    });
    let mut client = std::net::TcpStream::connect(addr).expect("connect");
    // A client with no read bound would hang the suite instead of failing.
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .expect("a bounded client");
    let _ = client.write_all(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    let head = read_head(&mut client).expect("a head, however it arrived").text;

    let mut truncated = std::net::TcpStream::connect(addr).expect("connect");
    truncated
        .set_read_timeout(Some(Duration::from_secs(2)))
        .expect("a bounded client");
    let _ = truncated.write_all(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    let partial = read_head(&mut truncated);
    server.join().expect("the server thread");

    assert!(head.starts_with("HTTP/1.1 201 Partial Content"), "{head:?}");
    assert_eq!(status_of(&head), Answer::Accepted);
    assert!(
        partial.is_none(),
        "a status line cut after 401 was read as a refused key"
    );
}

#[test]
fn a_body_is_read_exactly_as_long_as_its_head_promised() {
    assert_eq!(content_length_of("HTTP/1.1 200 OK\r\nContent-Length: 41\r\n\r\n{}"), Some(41));
    // The name is case-insensitive, as HTTP header names are.
    assert_eq!(content_length_of("HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n"), Some(0));
    // A close-delimited body promises nothing, and a status line is not a header.
    assert_eq!(content_length_of("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n"), None);
    assert_eq!(content_length_of("HTTP/1.1 200 OK\r\nContent-Length: none\r\n\r\n"), None);
}

/// Every answer this fixture gives arrives in the same write as its head, and
/// the fixture never closes the socket. A handshake that read the body by
/// waiting for the connection to end would spend its whole bound per question
/// here — three bounds for one verdict, against a real engine that ignores
/// nothing but whose keep-alive would still be one.
#[test]
fn a_body_that_arrives_with_its_head_is_not_waited_on() {
    let (addr, stop) = stand_in(Arc::new(Mutex::new(Vec::new())), |request| {
        if request.contains(HEALTH_PATH) {
            status(200, r#"{"status":"ok"}"#)
        } else if request.contains(&format!("Bearer {OUR_KEY}")) {
            status(200, "{}")
        } else {
            status(401, "unauthorized")
        }
    });
    let started = std::time::Instant::now();
    let who = who_answers(addr, OUR_KEY, Duration::from_secs(5));
    stop();
    let took = started.elapsed();
    assert_eq!(who, Who::Ready);
    assert!(
        took < Duration::from_secs(1),
        "the handshake waited {took:?} for a close that never came"
    );
}

/// A listener that answers one request per connection, the way the handshake
/// asks: it records every request it reads and answers `reply`.
fn stand_in(
    seen: Arc<Mutex<Vec<String>>>,
    reply: impl Fn(&str) -> String + Send + 'static,
) -> (SocketAddr, impl FnOnce()) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind the stand-in");
    let addr = listener.local_addr().expect("the stand-in's own address");
    listener.set_nonblocking(true).expect("nonblocking accept");
    let done = Arc::new(AtomicBool::new(false));
    let handle: JoinHandle<()> = {
        let done = Arc::clone(&done);
        std::thread::spawn(move || {
            while !done.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        // An accepted socket inherits the listener's
                        // non-blocking flag on BSD; this one reads a request.
                        let _ = stream.set_nonblocking(false);
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                        // Only a WHOLE head: a fragment answered as if it were
                        // the request would let a half-read "401" pass for a
                        // refused key. Whatever came after the head on the
                        // same read is a body this fixture does not parse.
                        let Some(request) = read_head(&mut stream).map(|head| head.text) else {
                            continue;
                        };
                        seen.lock()
                            .expect("the seen requests")
                            .push(request.clone());
                        if stream.write_all(reply(&request).as_bytes()).is_err() {
                            continue;
                        }
                    }
                    // Any accept error is a hiccup, not the end: leaving here
                    // would drop the listener and hand this port to another
                    // test's stand-in.
                    Err(_) => std::thread::sleep(Duration::from_millis(5)),
                }
            }
        })
    };
    let stop = move || {
        // `accept` is non-blocking, so the loop leaves on its own within a
        // poll; connecting here would only hand it a request to read.
        done.store(true, Ordering::Relaxed);
        let _ = handle.join();
    };
    (addr, stop)
}

/// One response, framed the way the fork frames it.
fn status(code: u16, body: &str) -> String {
    let reason = match code {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        401 => "Unauthorized",
        403 => "Forbidden",
        503 => "Service Unavailable",
        _ => "Answer",
    };
    format!("HTTP/1.1 {code} {reason}\r\nContent-Length: {}\r\n\r\n{body}", body.len())
}