use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use kalsa_catalog::{Parameters, PhoneModel};
use kalsa_pairing::PhoneDeclaration;

use super::{
    classify, connection_expired, handle, parser, request_queue, serve, worker, Accepted,
    Connection, Listener, LogState, Request, Work, WriteErrorLog, CONNECTION_LIFETIME,
    LOG_INTERVAL, PATIENCE, QUEUE, WORKERS,
};
use crate::pairing::Desk;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "kalsa-brain-transport-{name}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("scratch");
    dir.join("pairing.json")
}

fn phone() -> PhoneModel {
    PhoneModel {
        weights_bytes: 2_000_000_000,
        parameters: Some(Parameters::mixture(8_000_000_000, 1_000_000_000)),
        measured_tokens_per_second: Some(11.5),
        battery_powered: Some(true),
    }
}

fn setup(name: &str) -> (Arc<Desk>, Listener, String, String, String, String) {
    let desk = Arc::new(Desk::new(scratch(name)));
    let listener = serve(desk.clone()).expect("listener");
    let address = listener.address().to_string();
    let now = SystemTime::now();
    let dto = serde_json::to_value(desk.read(true, &address, None, now)).expect("dto");
    let qr = dto["qr_svg"].as_str().expect("page has a square");
    assert!(
        !qr.is_empty(),
        "the page must carry the square, not just ceremony state"
    );
    let payload = desk.test_square().expect("square payload");
    let value: serde_json::Value = serde_json::from_str(&payload).expect("payload");
    (
        desk,
        listener,
        address,
        value["code"].as_str().unwrap().to_string(),
        value["nonce"].as_str().unwrap().to_string(),
        value["reachable"].as_str().unwrap().to_string(),
    )
}

fn request(address: &str, method: &str, path: &str, body: &str) -> String {
    let target = address.strip_prefix("http://").unwrap();
    let mut stream = TcpStream::connect(target).expect("connect");
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).unwrap();
    stream.shutdown(Shutdown::Write).unwrap();
    let mut response = String::new();
    match stream.read_to_string(&mut response) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => {}
        Err(error) => panic!("response: {error}"),
    }
    response
}

fn body(response: &str) -> &str {
    response.split_once("\r\n\r\n").unwrap().1
}

fn read_response_or_close(stream: &mut TcpStream) -> String {
    let mut response = String::new();
    match stream.read_to_string(&mut response) {
        Ok(_) => response,
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::ConnectionReset
            ) =>
        {
            String::new()
        }
        Err(error) => panic!("response: {error}"),
    }
}

fn connect(address: &str) -> TcpStream {
    let target = address.strip_prefix("http://").unwrap();
    TcpStream::connect(target).expect("connect")
}

#[test]
fn a_phone_completes_over_real_http_and_the_post_route_is_required() {
    let (desk, listener, address, code, nonce, reachable) = setup("http");
    let claim = serde_json::json!({ "code": code });
    assert!(
        request(&address, "POST", "/pair/claim", &claim.to_string()).starts_with("HTTP/1.1 200")
    );

    let declaration = PhoneDeclaration::sign(&code, &nonce, &reachable, None, phone()).unwrap();
    let complete = serde_json::to_string(&declaration).unwrap();
    assert!(request(&address, "GET", "/pair/complete", &complete).starts_with("HTTP/1.1 403"));

    let response = request(&address, "POST", "/pair/complete", &complete);
    assert!(response.starts_with("HTTP/1.1 200"));
    let seal: kalsa_pairing::PairingSeal = serde_json::from_str(body(&response)).unwrap();
    assert_eq!(seal.open(&code, &nonce).unwrap().len(), 64);
    // Completion stores the phone waiting; this test's subject - the
    // protocol and the seal - is unchanged, so Allow, then the read.
    desk.allow_device(0).expect("the owner allows the phone");
    assert_eq!(desk.phone().unwrap().unwrap().weights_bytes, 2_000_000_000);
    let dto = serde_json::to_value(desk.read(true, &address, None, SystemTime::now())).unwrap();
    assert_eq!(dto["delivery_pending"], false);
    listener.shutdown();
}

#[test]
fn slow_clients_do_not_block_a_second_phone() {
    let (_desk, listener, address, code, _nonce, _reachable) = setup("parallel");
    let mut slow = Vec::new();
    for _ in 0..(WORKERS + 1) {
        let mut stream = connect(&address);
        stream
            .write_all(b"POST /pair/claim HTTP/1.1\r\nContent-Length: 8192\r\n\r\n")
            .unwrap();
        slow.push(stream);
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    while listener.accepted_count() < WORKERS + 1 && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    assert!(listener.accepted_count() >= WORKERS + 1);

    let claim = serde_json::json!({ "code": code });
    assert!(
        request(&address, "POST", "/pair/claim", &claim.to_string()).starts_with("HTTP/1.1 200")
    );
    for stream in slow {
        let _ = stream.shutdown(Shutdown::Both);
    }
    listener.shutdown();
}

#[test]
fn the_complete_request_queue_is_bounded() {
    let (sender, _receiver) = request_queue();
    let mut clients = Vec::new();
    for _ in 0..QUEUE {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let client = TcpStream::connect(address).unwrap();
        let (stream, _) = listener.accept().unwrap();
        clients.push(client);
        sender
            .send(Work {
                stream,
                request: Request {
                    method: String::from("GET"),
                    path: String::from("/"),
                    body: Vec::new(),
                },
                accepted: Instant::now(),
            })
            .unwrap();
    }
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let client = TcpStream::connect(address).unwrap();
    let (stream, _) = listener.accept().unwrap();
    let overflow = sender.try_send(Work {
        stream,
        request: Request {
            method: String::from("GET"),
            path: String::from("/"),
            body: Vec::new(),
        },
        accepted: Instant::now(),
    });
    assert!(matches!(overflow, Err(mpsc::TrySendError::Full(_))));
    clients.push(client);
}

#[test]
fn the_body_limit_is_applied_before_waiting_for_the_body() {
    let (_desk, listener, address, _code, _nonce, _reachable) = setup("body-limit");
    let mut stream = connect(&address);
    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .unwrap();
    write!(
        stream,
        "POST /pair/claim HTTP/1.1\r\nContent-Length: {}\r\n\r\n",
        parser::MAX_BODY + 1
    )
    .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 403"));
    listener.shutdown();
}

#[test]
fn the_head_limit_is_applied_while_a_line_is_still_open() {
    let (_desk, listener, address, _code, _nonce, _reachable) = setup("head-limit");
    let mut stream = connect(&address);
    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .unwrap();
    stream.write_all(&vec![b'x'; parser::MAX_HEAD + 1]).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 403"));
    listener.shutdown();
}

#[test]
fn a_connection_already_near_its_deadline_does_not_get_a_new_lifetime() {
    let desk = Arc::new(Desk::new(scratch("old-connection")));
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (ready_sender, ready_receiver) = mpsc::channel();
    let client = thread::spawn(move || {
        let mut stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_millis(500)))
            .unwrap();
        ready_sender.send(()).unwrap();
        read_response_or_close(&mut stream)
    });
    ready_receiver.recv().unwrap();
    let (stream, _) = listener.accept().unwrap();
    let work = Work {
        stream,
        request: Request {
            method: String::from("GET"),
            path: String::from("/"),
            body: Vec::new(),
        },
        accepted: Instant::now() - CONNECTION_LIFETIME - Duration::from_secs(1),
    };
    handle(&desk, work, &WriteErrorLog::new());
    assert!(client.join().unwrap().is_empty());
}

#[test]
fn shutdown_drops_work_that_arrives_after_the_worker_is_stopped() {
    let desk = Arc::new(Desk::new(scratch("worker-stop")));
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let client = thread::spawn(move || {
        let mut stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_millis(500)))
            .unwrap();
        read_response_or_close(&mut stream)
    });
    let (stream, _) = listener.accept().unwrap();
    let (sender, receiver) = mpsc::sync_channel(1);
    sender
        .send(Work {
            stream,
            request: Request {
                method: String::from("GET"),
                path: String::from("/"),
                body: Vec::new(),
            },
            accepted: Instant::now(),
        })
        .unwrap();
    drop(sender);
    let stop = AtomicBool::new(true);
    let receiver = Mutex::new(receiver);
    worker(&desk, &stop, &receiver, &WriteErrorLog::new());
    assert!(client.join().unwrap().is_empty());
}

#[test]
fn the_connection_bound_answers_when_it_is_full() {
    let (_desk, listener, address, code, _nonce, _reachable) = setup("connection-bound");
    let mut slow = Vec::new();
    for _ in 0..(WORKERS + QUEUE) {
        let mut stream = connect(&address);
        stream
            .write_all(b"POST /pair/claim HTTP/1.1\r\nContent-Length: 8192\r\n\r\n")
            .unwrap();
        slow.push(stream);
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    while listener.accepted_count() < WORKERS + QUEUE && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    assert!(listener.accepted_count() >= WORKERS + QUEUE);
    let claim = serde_json::json!({ "code": code });
    assert!(
        request(&address, "POST", "/pair/claim", &claim.to_string()).starts_with("HTTP/1.1 403")
    );
    for stream in slow {
        let _ = stream.shutdown(Shutdown::Both);
    }
    listener.shutdown();
}

#[test]
fn an_idle_connection_expires_even_before_the_absolute_deadline() {
    let now = Instant::now();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (stream, _) = listener.accept().unwrap();
    let connection = Connection {
        stream,
        accepted: now - Duration::from_secs(1),
        last_activity: now - PATIENCE - Duration::from_secs(1),
        buffer: Vec::new(),
    };
    assert!(connection_expired(&connection, now));
    drop(client);
}

#[cfg(unix)]
#[test]
fn resource_exhaustion_accept_results_are_retried() {
    for errno in [libc::EMFILE, libc::ENFILE, libc::ECONNABORTED] {
        assert!(matches!(
            classify(Err(std::io::Error::from_raw_os_error(errno))),
            Accepted::Retry
        ));
    }
    assert!(matches!(
        classify(Err(std::io::Error::other("fatal accept"))),
        Accepted::Fatal(_)
    ));
}

#[test]
fn response_error_logging_is_rate_limited() {
    let log = WriteErrorLog {
        state: Mutex::new(LogState {
            last: None,
            suppressed: 0,
        }),
    };
    let now = Instant::now();
    assert_eq!(log.should_report(now), Some(0));
    assert_eq!(log.should_report(now + LOG_INTERVAL / 2), None);
    assert_eq!(log.should_report(now + LOG_INTERVAL), Some(1));
}

#[test]
fn ambiguous_http_framing_is_refused() {
    let (_desk, listener, address, code, _nonce, _reachable) = setup("framing");
    let mut stream = connect(&address);
    let body = serde_json::json!({ "code": code }).to_string();
    let raw = format!(
        "POST /pair/claim HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len(),
        body.len()
    );
    stream.write_all(raw.as_bytes()).unwrap();
    stream.shutdown(Shutdown::Write).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 403"));
    listener.shutdown();
}

#[test]
fn transfer_encoding_is_not_silently_interpreted() {
    assert!(matches!(
        parser::parse(b"POST / HTTP/1.1\nTransfer-Encoding: chunked\n\n"),
        parser::ParseResult::Refuse
    ));
}
