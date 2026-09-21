//! Every answer that can name an origin, and what it must say: the door's own
//! refusals and the heads it relays from the upstream. The carve-out that
//! decides which requests get this far is held to its own rule in `cors`.

use super::support::*;
use super::*;

/// The body every canned upstream sends: eleven bytes, the length its
/// hand-written heads declare.
const BODY: &[u8] = b"{\"ok\":true}";

/// The head the upstream really sends — measured on this app's
/// `llama-server` (10360, default `--cors-origins *` with credentials on):
/// it echoes the origin and says nothing about varying by one.
const UPSTREAM_CORS_HEAD: &[u8] = b"HTTP/1.1 200 OK\r\nServer: llama.cpp\r\n\
    Access-Control-Allow-Origin: tauri://localhost\r\n\
    Content-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n";

/// An upstream that already says it varies by origin: the door has nothing
/// to add, so these bytes must arrive as they are.
const UPSTREAM_MARKED_HEAD: &[u8] = b"HTTP/1.1 200 OK\r\n\
    Access-Control-Allow-Origin: tauri://localhost\r\nVary: Origin\r\n\
    Content-Length: 11\r\nConnection: close\r\n\r\n";

/// An upstream that varies by something else: its own `Vary` line is not the
/// door's to rewrite, so the origin arrives as a `Vary` field beside it.
const UPSTREAM_OTHER_VARY_HEAD: &[u8] = b"HTTP/1.1 200 OK\r\n\
    Access-Control-Allow-Origin: tauri://localhost\r\nVary: Accept-Encoding\r\n\
    Content-Length: 11\r\nConnection: close\r\n\r\n";

/// An event-stream head that names an origin: the door re-frames this head
/// itself, and the re-framed one must keep the permission and say it varies.
const UPSTREAM_STREAM_HEAD: &[u8] = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\
    Access-Control-Allow-Origin: tauri://localhost\r\nTransfer-Encoding: chunked\r\n\r\n";

/// An upstream that is not a browser's: it names no origin, so the door must
/// add nothing at all to what it sends.
const UPSTREAM_PLAIN_HEAD: &[u8] = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
    Content-Length: 11\r\nConnection: close\r\n\r\n";

#[test]
fn an_authenticated_post_is_served_with_the_upstreams_cors_header_once() {
    let (port, stop, upstream) = echoing_upstream();
    let token = credential();
    let (door, address) = door(port, &[&token]);

    // The preflight first, then the POST it gates, on a door of capacity
    // one: the POST only gets its slot if the preflight never took one.
    let answered = exchanged(address, &preflight(ORIGIN));
    assert!(
        answered.starts_with(b"HTTP/1.1 204 No Content\r\n"),
        "the preflight that would gate the POST was not answered: {}",
        String::from_utf8_lossy(&answered)
    );
    let response = exchanged(
        address,
        &chat_post(ORIGIN, Some(&format!("Bearer {token}")), None),
    );
    assert!(
        response.starts_with(b"HTTP/1.1 200 OK\r\n"),
        "an authenticated POST was not served: {}",
        String::from_utf8_lossy(&response)
    );
    assert!(
        response.ends_with(b"{\"ok\":true}"),
        "the upstream's body did not reach the client: {}",
        String::from_utf8_lossy(&response)
    );
    assert_eq!(
        allowed_origins(&response),
        vec![ORIGIN.to_string()],
        "the door must relay the upstream's own CORS header exactly once: {}",
        String::from_utf8_lossy(&response)
    );
    stop.store(true, Ordering::SeqCst);
    upstream.join().unwrap();
    door.shutdown();
}

#[test]
fn an_authentication_refusal_names_the_origin_that_asked() {
    let upstream = RecordingUpstream::start();
    let token = credential();
    let (door, address) = door(upstream.port, &[&token]);

    let stranger = format!("Bearer {}", wrong_credential(&token));
    let response = exchanged(address, &chat_post(ORIGIN, Some(&stranger), None));
    assert!(
        response.starts_with(b"HTTP/1.1 401 Unauthorized\r\n"),
        "the refusal is not a refusal: {}",
        String::from_utf8_lossy(&response)
    );
    assert_origin_aware(&response, Some(ORIGIN), "the authentication refusal");

    // A refusal to an origin the desktop cannot have stays bare.
    let foreign = exchanged(
        address,
        &chat_post("https://evil.example", Some(&stranger), None),
    );
    assert!(foreign.starts_with(b"HTTP/1.1 401 Unauthorized\r\n"));
    assert_origin_aware(&foreign, None, "the refusal of an unknown origin");
    no_upstream_connection(&upstream);
    door.shutdown();
}

#[test]
fn the_no_slot_refusal_names_the_origin_that_asked() {
    let upstream = RecordingUpstream::start();
    let (first, second) = (credential(), credential());
    let (door, address) = door(upstream.port, &[&first, &second]);

    let served = exchanged(
        address,
        &chat_post(ORIGIN, Some(&format!("Bearer {first}")), None),
    );
    assert!(
        served.starts_with(b"HTTP/1.1 200 OK\r\n"),
        "the first device was not served: {}",
        String::from_utf8_lossy(&served)
    );
    let refused = exchanged(
        address,
        &chat_post(ORIGIN, Some(&format!("Bearer {second}")), None),
    );
    assert!(
        refused.starts_with(b"HTTP/1.1 503 Service Unavailable\r\n"),
        "the second device did not get the door's own 503: {}",
        String::from_utf8_lossy(&refused)
    );
    assert_origin_aware(&refused, Some(ORIGIN), "the no-slot refusal");
    assert!(
        String::from_utf8_lossy(&refused)
            .contains("This computer is set up for 1 device at once, and one of them is this computer."),
        "the refusal stopped saying what it says: {}",
        String::from_utf8_lossy(&refused)
    );
    door.shutdown();
}

#[test]
fn the_gone_answer_names_the_origin_that_asked() {
    let upstream = RecordingUpstream::start();
    let token = credential();
    let (door, address) = door(upstream.port, &[&token]);

    let unknown = format!("{}:3", "ab".repeat(16));
    let response = exchanged(
        address,
        &chat_post(ORIGIN, Some(&format!("Bearer {token}")), Some(&unknown)),
    );
    assert!(
        response.starts_with(b"HTTP/1.1 410 Gone\r\n"),
        "a resume of an answer nobody kept is not the gone answer: {}",
        String::from_utf8_lossy(&response)
    );
    assert_origin_aware(&response, Some(ORIGIN), "the gone answer");
    no_upstream_connection(&upstream);
    door.shutdown();
}

#[test]
fn every_answer_that_can_name_an_origin_says_it_varies_by_origin() {
    let upstream = RecordingUpstream::start();
    let (first, second) = (credential(), credential());
    let (door, address) = door(upstream.port, &[&first, &second]);
    let stranger = format!("Bearer {}", wrong_credential(&first));
    let unknown = format!("{}:3", "ab".repeat(16));
    let asked_from = [(ORIGIN, Some(ORIGIN)), ("https://evil.example", None)];

    // Three answers a browser reads and three answers that can name an
    // origin: the refusal of a credential the door does not know, the gone
    // answer to a resume nobody kept, and the no-slot refusal.
    for (origin, expected) in asked_from {
        let refused = exchanged(address, &chat_post(origin, Some(&stranger), None));
        assert!(
            refused.starts_with(b"HTTP/1.1 401 Unauthorized\r\n"),
            "not the authentication refusal: {}",
            String::from_utf8_lossy(&refused)
        );
        assert_origin_aware(&refused, expected, "the authentication refusal");
    }
    for (origin, expected) in asked_from {
        let gone = exchanged(
            address,
            &chat_post(origin, Some(&format!("Bearer {first}")), Some(&unknown)),
        );
        assert!(
            gone.starts_with(b"HTTP/1.1 410 Gone\r\n"),
            "not the gone answer: {}",
            String::from_utf8_lossy(&gone)
        );
        assert_origin_aware(&gone, expected, "the gone answer");
    }
    for (origin, expected) in asked_from {
        let no_slot = exchanged(
            address,
            &chat_post(origin, Some(&format!("Bearer {second}")), None),
        );
        assert!(
            no_slot.starts_with(b"HTTP/1.1 503 Service Unavailable\r\n"),
            "not the no-slot refusal: {}",
            String::from_utf8_lossy(&no_slot)
        );
        assert_origin_aware(&no_slot, expected, "the no-slot refusal");
    }
    no_upstream_connection(&upstream);
    door.shutdown();
}

#[test]
fn the_upstream_failure_answer_names_the_origin_that_asked() {
    // The upstream port is bound and dropped: nothing is listening, so the
    // door's connection attempt is refused — after the head was read, when
    // the origin is already known.
    let dead = TcpListener::bind("127.0.0.1:0").unwrap();
    let dead_port = dead.local_addr().unwrap().port();
    drop(dead);
    let token = credential();
    let (door, address) = door(dead_port, &[&token]);

    for (origin, expected) in [(ORIGIN, Some(ORIGIN)), ("https://evil.example", None)] {
        let response = exchanged(
            address,
            &chat_post(origin, Some(&format!("Bearer {token}")), None),
        );
        assert!(
            response.starts_with(b"HTTP/1.1 502 Bad Gateway\r\n"),
            "not the upstream-failure answer: {}",
            String::from_utf8_lossy(&response)
        );
        assert_origin_aware(&response, expected, "the upstream-failure answer");
    }
    door.shutdown();
}

#[test]
fn the_busy_answer_to_a_read_request_names_the_origin_that_asked() {
    // This branch cannot be reached through a running door: four workers can
    // run four answers, and the registry refuses a new job only while all of
    // its sixty-four are still running. The registry is filled by hand and
    // `handle` is called directly, as the revocation tests do.
    let (upstream_port, upstream_stop, upstream_thread) = sse_head_upstream();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let devices = DeviceSet::new(device_set(&[(0, &token)]), 1);
    let registry = Registry::new();
    for _ in 0..crate::MAX_JOBS {
        registry
            .start(DeviceId::new(0), b"HTTP/1.1 200 OK\r\n\r\n".to_vec())
            .unwrap();
    }
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let stop = AtomicBool::new(false);
        let active = ActiveDevices::new();
        proxy::handle(
            stream,
            Instant::now(),
            crate::HEAD_PATIENCE,
            upstream_port,
            1,
            &devices,
            &registry,
            &stop,
            &active,
            None,
        );
    });

    let body = "{\"x\":1}";
    let request = format!(
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nOrigin: {ORIGIN}\r\n\
         Authorization: Bearer {token}\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let response = exchanged(address, &request);
    assert!(
        response.starts_with(b"HTTP/1.1 503 Service Unavailable\r\n"),
        "a full registry did not answer busy: {}",
        String::from_utf8_lossy(&response)
    );
    assert_origin_aware(&response, Some(ORIGIN), "the busy answer to a read request");
    server.join().unwrap();
    upstream_stop.store(true, Ordering::SeqCst);
    upstream_thread.join().unwrap();
}

#[test]
fn a_relayed_answer_that_names_an_origin_says_it_varies_by_origin() {
    let (port, stop, upstream) = answering_upstream(UPSTREAM_CORS_HEAD, BODY);
    let token = credential();
    let (door, address) = door(port, &[&token]);

    let response = exchanged(
        address,
        &chat_post(ORIGIN, Some(&format!("Bearer {token}")), None),
    );
    assert!(
        response.starts_with(b"HTTP/1.1 200 OK\r\n"),
        "the answer was not relayed: {}",
        String::from_utf8_lossy(&response)
    );
    // The upstream names the origin and sends no `Vary`, so a cache between
    // it and the browser could hand this answer to another origin. The door
    // is the one that must say it varies: exactly one permission line, one
    // vary — and the body, whose length the added line does not change.
    assert_origin_aware(&response, Some(ORIGIN), "the relayed answer");
    assert_eq!(
        response_body(&response),
        BODY,
        "a header line was added, so the body must not have moved"
    );
    stop.store(true, Ordering::SeqCst);
    upstream.join().unwrap();
    door.shutdown();
}

#[test]
fn a_relayed_answer_the_upstream_already_marked_is_left_alone() {
    let (port, stop, upstream) = answering_upstream(UPSTREAM_MARKED_HEAD, BODY);
    let token = credential();
    let (door, address) = door(port, &[&token]);

    let response = exchanged(
        address,
        &chat_post(ORIGIN, Some(&format!("Bearer {token}")), None),
    );
    let mut expected = UPSTREAM_MARKED_HEAD.to_vec();
    expected.extend_from_slice(BODY);
    assert_eq!(
        response,
        expected,
        "a head the upstream already marked must be relayed byte for byte: {}",
        String::from_utf8_lossy(&response)
    );
    assert_origin_aware(&response, Some(ORIGIN), "the relayed answer");
    stop.store(true, Ordering::SeqCst);
    upstream.join().unwrap();
    door.shutdown();
}

#[test]
fn a_vary_line_that_does_not_name_the_origin_gets_one_beside_it() {
    let (port, stop, upstream) = answering_upstream(UPSTREAM_OTHER_VARY_HEAD, BODY);
    let token = credential();
    let (door, address) = door(port, &[&token]);

    let response = exchanged(
        address,
        &chat_post(ORIGIN, Some(&format!("Bearer {token}")), None),
    );
    let head = response_head(&response);
    // The upstream's own `Vary` is not the door's to rewrite: its line stays
    // exactly as it was sent and `Origin` arrives as a second `Vary` field,
    // which RFC 9110 §12.5.5 combines into the one list.
    assert_eq!(
        header_values(head, "vary"),
        vec!["Origin".to_string(), "Accept-Encoding".to_string()],
        "the door's field and the upstream's must both be there: {}",
        String::from_utf8_lossy(head)
    );
    assert_eq!(allowed_origins(&response), vec![ORIGIN.to_string()]);
    assert_eq!(response_body(&response), BODY);
    stop.store(true, Ordering::SeqCst);
    upstream.join().unwrap();
    door.shutdown();
}

#[test]
fn a_streamed_answer_that_names_an_origin_says_it_varies_by_origin() {
    let (port, stop, upstream) = answering_upstream(UPSTREAM_STREAM_HEAD, b"");
    let token = credential();
    let (door, address) = door(port, &[&token]);

    // The door re-frames an event stream's head, so this is the one relayed
    // head it builds itself. The upstream closes without a body, which fails
    // the job — after the head went out, which is all this asks about.
    let response = exchanged(
        address,
        &chat_post(ORIGIN, Some(&format!("Bearer {token}")), None),
    );
    assert!(
        response.starts_with(b"HTTP/1.1 200 OK\r\n"),
        "the answer was not relayed: {}",
        String::from_utf8_lossy(&response)
    );
    assert_origin_aware(&response, Some(ORIGIN), "the streamed answer");
    let head = String::from_utf8_lossy(response_head(&response)).to_string();
    assert!(
        head.contains("Content-Type: text/event-stream\r\n"),
        "the re-framed head lost what kind of answer it is: {head}"
    );
    assert!(
        !head.contains("Transfer-Encoding"),
        "the re-framed head kept a framing promise of its own: {head}"
    );
    stop.store(true, Ordering::SeqCst);
    upstream.join().unwrap();
    door.shutdown();
}

#[test]
fn an_upstream_that_names_no_origin_is_relayed_untouched() {
    let (port, stop, upstream) = answering_upstream(UPSTREAM_PLAIN_HEAD, BODY);
    let token = credential();
    let (door, address) = door(port, &[&token]);

    let response = exchanged(
        address,
        &chat_post(ORIGIN, Some(&format!("Bearer {token}")), None),
    );
    let mut expected = UPSTREAM_PLAIN_HEAD.to_vec();
    expected.extend_from_slice(BODY);
    assert_eq!(
        response,
        expected,
        "an upstream that names no origin must be relayed byte for byte"
    );
    assert!(allowed_origins(&response).is_empty());
    assert!(
        header_values(response_head(&response), "vary").is_empty(),
        "the door added a header to an answer that depends on no origin: {}",
        String::from_utf8_lossy(&response)
    );
    stop.store(true, Ordering::SeqCst);
    upstream.join().unwrap();
    door.shutdown();
}
