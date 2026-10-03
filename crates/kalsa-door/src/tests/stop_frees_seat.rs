//! Stop frees the engine at once for the devices whose answers are never
//! kept for a resume: the host's desktop detaching abandons its answer
//! immediately (no grace), a phone's detaching keeps the 2-minute grace,
//! and a phone's new completion supersedes its own detached answer. The
//! observable is the fake engine's SSE writes: a dropped upstream fails
//! them, a kept one lets the answer finish.

use std::io::{Read, Write};
use std::sync::Arc;
use std::time::{Duration, Instant};

use kalsa_room::Room;

use super::room_engine::{Engine, Reply};
use super::room_support::scratch;
use super::*;

const HOST: u32 = 0;
const PHONE: u32 = 1;

/// A door whose seat the host and one phone share, with the room's guest
/// seated — the app's own set.
fn house(engine: Vec<Reply>) -> (crate::RunningDoor, Engine, [String; 2]) {
    let fake = Engine::start(engine);
    let host = credential();
    let phone = credential();
    let devices = super::room_support::seated_labeled(&[
        (HOST, "This computer", &host),
        (PHONE, "Paired phone", &phone),
    ]);
    let room = Arc::new(Room::open(&scratch("stop-frees")).unwrap());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let door = crate::Door::new_with_engine(
        listener,
        fake.port,
        devices,
        1,
        EnginePrivateHeaders::Consumed,
    )
    .unwrap()
    .with_room(Arc::clone(&room), DeviceId::new(HOST))
    .start()
    .unwrap();
    (door, fake, [host, phone])
}

/// One streamed completion: send it, read `events` SSE events, and either
/// drop the connection (Stop) or hold it. Returns how many SSE events were
/// read and the events the fake streamed past the drop (the door's own
/// upstream socket state shows up as EOF here).
fn streamed_completion(
    door: &crate::RunningDoor,
    token: &str,
    events: usize,
    stop: bool,
    read_timeout: Duration,
) -> usize {
    let mut client: std::net::TcpStream = std::net::TcpStream::connect(door.address()).unwrap();
    client.set_read_timeout(Some(read_timeout)).unwrap();
    let body = format!(
        "{{\"model\":\"m\",\"messages\":[{{\"role\":\"user\",\"content\":\"walk {}\"}}],\"stream\":true}}",
        std::process::id()
    );
    write!(
        client,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {token}\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .unwrap();
    let mut seen = 0;
    let deadline = Instant::now() + Duration::from_secs(20);
    while seen < events && Instant::now() < deadline {
        let mut chunk = [0u8; 4096];
        match client.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                let text = String::from_utf8_lossy(&chunk[..read]);
                seen += text.matches("data: ").count();
            }
            Err(_) => break,
        }
    }
    if stop {
        client.shutdown(std::net::Shutdown::Both).unwrap();
    }
    seen
}

/// Waits until the fake's failed-write counter reaches `want` or the bound.
fn wait_writes(fake: &Engine, want: usize, budget: Duration) -> usize {
    let deadline = Instant::now() + budget;
    loop {
        let got = fake.writes_failed();
        if got >= want || Instant::now() >= deadline {
            return got;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[test]
fn the_hosts_stop_drops_the_engine_at_once() {
    // The host detaches mid-answer: the answer is abandoned immediately and
    // the engine connection dropped — the fake's remaining piece writes
    // fail within the bound instead of streaming to the end.
    let pieces: Vec<String> = (0..40).map(|n| format!("piece{n} ")).collect();
    let (door, fake, [host, _]) = house(vec![Reply::Sse(pieces)]);
    let read = streamed_completion(&door, &host, 3, true, Duration::from_secs(5));
    assert!(read >= 2, "the host read its events first: {read}");
    let failed = wait_writes(&fake, 1, Duration::from_secs(3));
    assert!(
        failed > 0,
        "the engine connection was not dropped after the host's Stop"
    );
    door.shutdown();
}

#[test]
fn a_phones_detach_keeps_the_answer_resumable_within_the_grace() {
    // A phone that detaches keeps the 2-minute grace: the answer keeps
    // streaming into the job (the fake finishes all its writes) and the
    // producer does not abandon it.
    let pieces: Vec<String> = (0..40).map(|n| format!("piece{n} ")).collect();
    let (door, fake, [_, phone]) = house(vec![Reply::Sse(pieces)]);
    let read = streamed_completion(&door, &phone, 3, true, Duration::from_secs(5));
    assert!(read >= 2, "the phone read its events first: {read}");
    let failed = wait_writes(&fake, 1, Duration::from_secs(3));
    assert_eq!(failed, 0, "a phone's detach dropped the engine early");
    door.shutdown();
}

#[test]
fn a_phones_new_completion_supersedes_its_detached_answer() {
    // Phone detaches (grace running), then asks a NEW question: the old
    // answer is abandoned at once — its upstream dropped, the fake's
    // writes fail — and the new completion is served.
    let pieces: Vec<String> = (0..40).map(|n| format!("piece{n} ")).collect();
    let (door, fake, [_, phone]) = house(vec![Reply::Sse(pieces)]);
    let read = streamed_completion(&door, &phone, 3, true, Duration::from_secs(5));
    assert!(read >= 2, "the phone read its events first: {read}");

    // A supersede may only take a job the door knows is detached. The
    // producer learns the phone left when its next piece write fails — the
    // fake paces one piece per 100 ms — so the new completion waits for
    // that knowledge (four pieces' worth) before it can supersede.
    std::thread::sleep(Duration::from_millis(400));

    // The new completion from the same phone — the fake gets a fresh script.
    fake.script(vec![Reply::Sse((0..40).map(|n| format!("nuova{n} ")).collect())]);
    let mut client: std::net::TcpStream = std::net::TcpStream::connect(door.address()).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let body = "{\"model\":\"m\",\"messages\":[{\"role\":\"user\",\"content\":\"nuova\"}],\"stream\":true}";
    write!(
        client,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {phone}\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .unwrap();
    // The new completion is served (the fake answers it with a fresh
    // piece stream — reads flow), and the OLD answer's writes fail.
    let mut new_events = 0;
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        let mut chunk = [0u8; 4096];
        match client.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                new_events += String::from_utf8_lossy(&chunk[..read]).matches("data: ").count();
            }
            Err(_) => break,
        }
    }
    assert!(new_events >= 2, "the new completion was served: {new_events}");
    let failed = wait_writes(&fake, 1, Duration::from_secs(3));
    assert!(failed > 0, "the detached answer was not abandoned");
    door.shutdown();
}

/// Opens one streamed completion and hands back the live connection: the
/// answer is flowing, and the caller decides when to stop reading.
fn opened_stream(
    door: &crate::RunningDoor,
    token: &str,
    question: &str,
) -> std::net::TcpStream {
    let mut client: std::net::TcpStream = std::net::TcpStream::connect(door.address()).unwrap();
    client.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
    let body = format!(
        "{{\"model\":\"m\",\"messages\":[{{\"role\":\"user\",\"content\":\"{question}\"}}],\"stream\":true}}"
    );
    write!(
        client,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {token}\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .unwrap();
    client
}

/// Reads until `want` events have arrived (or the wire ends), returning
/// how many were seen — the proof an answer is streaming, not connected.
fn events_seen(client: &mut std::net::TcpStream, want: usize) -> usize {
    let mut seen = 0;
    let deadline = Instant::now() + Duration::from_secs(20);
    while seen < want && Instant::now() < deadline {
        let mut chunk = [0u8; 4096];
        match client.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                seen += String::from_utf8_lossy(&chunk[..read]).matches("data: ").count();
            }
            Err(_) => break,
        }
    }
    seen
}

/// Reads everything left on the wire until it ends, returning how many
/// events the stream carried in total.
fn events_to_the_end(client: &mut std::net::TcpStream) -> usize {
    let mut seen = 0;
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        let mut chunk = [0u8; 4096];
        match client.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                seen += String::from_utf8_lossy(&chunk[..read]).matches("data: ").count();
            }
            Err(_) => break,
        }
    }
    seen
}

#[test]
fn a_stream_the_device_is_still_reading_survives_a_sibling_completion() {
    // The desktop's chats are many connections of ONE device: chat B's
    // new completion arrives while chat A's answer is still streaming to
    // its own connected, reading client. The supersede must leave A
    // alone — its original client is attached — so A runs to its whole
    // end, its engine connection never drops, and B is served beside it
    // (the same device's second request leases the same seat).
    let pieces: Vec<String> = (0..40).map(|n| format!("piece{n} ")).collect();
    let (door, fake, [_, phone]) = house(vec![Reply::Sse(pieces)]);

    // Chat A, streaming and read.
    let mut a = opened_stream(&door, &phone, "chat A");
    let flowing = events_seen(&mut a, 3);
    assert!(flowing >= 2, "chat A was not streaming before B asked: {flowing}");

    // Chat B, the same device, while A is still mid-answer.
    fake.script(vec![Reply::Sse(
        (0..20).map(|n| format!("sibling{n} ")).collect(),
    )]);
    let mut b = opened_stream(&door, &phone, "chat B");

    // A receives every piece and its [DONE] — forty pieces plus the
    // terminal frame — and B is served beside it, to its own end. The
    // count spans both read phases: the opening read that proved the
    // stream was flowing, and everything after B asked.
    let a_events = flowing + events_to_the_end(&mut a);
    assert_eq!(
        a_events, 41,
        "the streaming chat lost its answer to its sibling: {a_events} of 41"
    );
    let b_events = events_to_the_end(&mut b);
    assert_eq!(b_events, 21, "the sibling chat was not served: {b_events}");
    assert_eq!(
        fake.writes_failed(),
        0,
        "a completed answer's engine connection was dropped"
    );
    door.shutdown();
}
