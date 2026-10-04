//! The door's own lines, driven through a real door and read back from a
//! logger of the test's own: what a request line says, and what no line ever
//! says — a query string, a chat id, a message body.
//!
//! The canary is one string placed in every position a client's words could
//! reach a line — a query, a body, an id — and then searched for in every
//! line the door wrote. It is not a secret; it is only unique in this run.
//! So is every id and route below: the binary's tests run in parallel and
//! share one capture, so each assertion finds its own line by a marker no
//! other test writes, never by line order.

use std::sync::{Mutex, Once, OnceLock};
use std::time::{Duration, Instant};

use super::paging_support::{activate, door_of, file_name, status_of, temp_dir, Engine, Reply, HASH};
use super::support::{chat_post, device_set, door, exchanged, RecordingUpstream, ORIGIN};
use super::*;
use crate::audit::line::id_hash;

/// A string no other test writes, and one every forbidden field carries.
const CANARY: &str = "LOG-LEAK-CANARY-a91f";
/// The one template this test's completion request names: the route field is
/// a closed vocabulary, so a made-up path would log as `other` and pin
/// nothing. The line is found by its index instead (see [`wait_for_new`]).
const ROUTE: &str = "/v1/chat/completions";
/// A chat id of the shape the app mints, unique to this module (lowercase:
/// a real id's alphabet). `id_hash` is what the log may write.
const CHAT: &str = "0f1e2d3c-5a6b-4c7d-8e9f-0011logleakcanary";

/// Every line the door wrote in this run.
pub(super) fn lines() -> &'static Mutex<Vec<String>> {
    static LINES: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    LINES.get_or_init(|| Mutex::new(Vec::new()))
}

struct Capture;

/// One static, not a boxed logger: the facade's `alloc` feature is off in
/// this crate, and a capture that needs no heap is all a test wants anyway.
static CAPTURE: Capture = Capture;

impl log::Log for Capture {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }

    fn log(&self, record: &log::Record) {
        if let Ok(mut lines) = lines().lock() {
            lines.push(record.args().to_string());
        }
    }

    fn flush(&self) {}
}

/// Installs the capture once for the test binary. The whole binary's lines go
/// through it; every assertion below is by a marker only its own test writes.
pub(super) fn capture() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let _ = log::set_logger(&CAPTURE);
        log::set_max_level(log::LevelFilter::Info);
    });
}

/// Waits for a line containing `marker`, then answers every line written so
/// far. A marker that never arrives costs the wait and returns anyway, so the
/// assertion that reports it is the test's own.
fn wait_for(marker: &str) -> Vec<String> {
    let until = Instant::now() + Duration::from_secs(2);
    loop {
        let found = lines()
            .lock()
            .unwrap()
            .iter()
            .any(|line| line.contains(marker));
        if found || Instant::now() >= until {
            // The request line is written when the guard drops, a moment
            // after the chat line that names the marker: let both land
            // before the snapshot the assertions read.
            thread::sleep(Duration::from_millis(50));
            return lines().lock().unwrap().clone();
        }
        thread::sleep(Duration::from_millis(5));
    }
}

/// The lines written so far, as a count: what a test captures before its own
/// request, so [`wait_for_new`] can tell its line from an earlier test's.
pub(super) fn line_count() -> usize {
    lines().lock().unwrap().len()
}

/// [`wait_for`], but only a line at or after `since` counts. Two tests can
/// drive the same route through two doors, and the capture is one for the
/// whole binary; the index is what makes the marker this test's.
fn wait_for_new(marker: &str, since: usize) -> Vec<String> {
    let until = Instant::now() + Duration::from_secs(2);
    loop {
        let found = lines()
            .lock()
            .unwrap()
            .iter()
            .skip(since)
            .any(|line| line.contains(marker));
        if found || Instant::now() >= until {
            thread::sleep(Duration::from_millis(50));
            return lines().lock().unwrap().clone();
        }
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn a_request_line_names_the_route_and_never_the_query_or_the_body() {
    capture();
    let upstream = RecordingUpstream::start();
    let token = credential();
    let (door, address) = door(upstream.port, &[&token]);
    let body = format!("{{\"messages\":[{{\"role\":\"user\",\"content\":\"{CANARY}\"}}]}}");
    let request = format!(
        "POST {ROUTE}?api_key={CANARY}&q={CANARY} HTTP/1.1\r\n\
         Host: localhost\r\nAuthorization: Bearer {token}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\n\
         Connection: close\r\n\r\n{body}",
        body.len()
    );
    let since = line_count();
    let response = exchanged(address, &request);
    assert_eq!(
        status_of(&response),
        200,
        "{}",
        String::from_utf8_lossy(&response)
    );

    let marker = format!("door request: POST {ROUTE} device 0 status 200");
    let lines = wait_for_new(&marker, since);
    let line = lines
        .iter()
        .skip(since)
        .find(|line| line.contains(&marker))
        .expect("the door wrote no request line for this request");
    assert!(line.contains("ms ") && line.ends_with('b'), "{line}");
    assert!(
        !lines.iter().any(|line| line.contains(CANARY)),
        "a client's words reached the log: {lines:?}"
    );
    // The query is gone, and the route it hung from is still named.
    assert!(!line.contains("api_key"), "{line}");
    assert!(line.contains(ROUTE), "{line}");
    door.shutdown();
}

#[test]
fn an_absolute_form_target_with_credentials_logs_as_other() {
    capture();
    let upstream = RecordingUpstream::start();
    let token = credential();
    let (door, address) = door(upstream.port, &[&token]);
    // The P0's shape: an absolute-form target (the form a proxy sends) whose
    // authority carries a user and a password and whose query carries the
    // canary. The door forwards it; the line must name none of it.
    let target = format!(
        "http://leak-user:leak-password@127.0.0.1:8131/v1/chat/completions?token={CANARY}"
    );
    // PROPFIND on purpose: no other test sends one, so this line is
    // unmistakably this test's in the capture the whole binary shares.
    let request = format!(
        "PROPFIND {target} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\n\
         Content-Type: application/json\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    let since = line_count();
    let _ = exchanged(address, &request);

    let lines = wait_for_new("door request: PROPFIND other device 0", since);
    let line = lines
        .iter()
        .skip(since)
        .find(|line| line.contains("door request: PROPFIND other device 0"))
        .expect("the door wrote no line for the absolute-form request");
    assert!(line.contains("ms ") && line.ends_with('b'), "{line}");
    for secret in ["leak-user", "leak-password", "8131", "127.0.0.1", CANARY] {
        assert!(!line.contains(secret), "{line}");
    }
    assert!(
        !lines
            .iter()
            .any(|line| line.contains("leak-user") || line.contains("leak-password")),
        "credentials reached the log: {lines:?}"
    );
    door.shutdown();
}

#[test]
fn a_chat_line_names_the_hash_and_never_the_chat_id() {
    capture();
    let slot_dir = temp_dir("log-chat");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    std::fs::write(slot_dir.join(file_name(CHAT)), b"state").unwrap();

    assert_eq!(status_of(&activate(address, Some(&token), CHAT)), 204);
    let marker = format!("chat activate: slot 0 device 0 chat {} ", id_hash(CHAT));
    let lines = wait_for(&marker);
    let line = lines
        .iter()
        .find(|line| line.contains(&marker))
        .expect("the door wrote no activate line for this chat");
    assert!(line.contains("ok") && line.contains("ms ") && line.ends_with('b'), "{line}");
    assert!(
        lines
            .iter()
            .any(|line| line.contains("chat restore:") && line.contains(&id_hash(CHAT))),
        "the restore inside the switch is not on the record: {lines:?}"
    );
    assert!(
        !lines.iter().any(|line| line.contains(CHAT)),
        "the chat id reached the log: {lines:?}"
    );
    door.shutdown();
}

#[test]
fn a_refused_chat_line_carries_the_code_and_never_a_sentence() {
    capture();
    let slot_dir = temp_dir("log-refusal");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let (first, second) = ("l0g-a1111", "l0g-b2222");
    std::fs::write(slot_dir.join(file_name(first)), b"state").unwrap();
    std::fs::write(slot_dir.join(file_name(second)), b"state").unwrap();
    assert_eq!(status_of(&activate(address, Some(&token), second)), 204);

    // The save of what is open succeeds, the restore of the chat asked for is
    // refused, and the repair puts the open chat back: the refusal the owner
    // reads as "could not open this conversation".
    engine.reply([Reply::Answered(1), Reply::Refused, Reply::Answered(1)]);
    let response = activate(address, Some(&token), first);
    assert_eq!(status_of(&response), 502);

    let marker = format!(
        "chat activate: slot 0 device 0 chat {} code door.restore_failed",
        id_hash(first)
    );
    let lines = wait_for(&marker);
    assert!(
        lines.iter().any(|line| line.contains(&marker)),
        "the chat line carries no code: {lines:?}"
    );
    assert!(
        lines.iter().any(|line| {
            line.contains("chat restore:")
                && line.contains(&id_hash(first))
                && line.contains("code door.slot_empty")
        }),
        "the refused restore is not on the record: {lines:?}"
    );
    // The request line of this switch, by the code only it can carry.
    assert!(
        lines.iter().any(|line| {
            line.contains("door request: POST /kalsa/chat/activate device 0 status 502 reason door.restore_failed")
        }),
        "the request line carries no reason code: {lines:?}"
    );
    assert!(
        !lines
            .iter()
            .any(|line| line.contains(CHAT) || line.contains(first) || line.contains(second)),
        "a chat id reached the log: {lines:?}"
    );
    door.shutdown();
}

#[test]
fn a_handover_says_which_devices_and_whether_it_was_saved() {
    capture();
    let upstream = RecordingUpstream::start();
    let (first, second) = (credential(), credential());
    // One seat, two devices: the second takes the first's.
    let (door, address) = door(upstream.port, &[&first, &second]);

    assert_eq!(
        status_of(&activate(address, Some(&first), "l0g-c3333")),
        501,
        "the tier is not wired here, so the route answers no_model"
    );
    assert_eq!(status_of(&activate(address, Some(&second), "l0g-d4444")), 501);

    let lines = wait_for("slot 0 handover: device 0 -> device 1");
    assert!(
        lines.iter().any(|line| line.contains("slot 0 assigned: device 0")),
        "the first seat is not on the record: {lines:?}"
    );
    assert!(
        lines
            .iter()
            .any(|line| line.contains("slot 0 handover: device 0 -> device 1 saved no")),
        "the handover line is missing or lies about the save: {lines:?}"
    );
    door.shutdown();
}

#[test]
fn a_release_relaxes_the_map_and_says_how_many_slots() {
    capture();
    let slot_dir = temp_dir("log-release");
    let engine = Engine::start(&slot_dir);
    let tokens: Vec<String> = (0..4).map(|_| credential()).collect();
    let borrowed: Vec<&str> = tokens.iter().map(String::as_str).collect();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &borrowed);
    // Four devices, four seats, four residents: the count on the line is this
    // test's own, not any other test's one.
    for (index, token) in borrowed.iter().enumerate() {
        let chat = format!("l0g-e{index}0000");
        assert_eq!(status_of(&activate(address, Some(token), &chat)), 204);
    }

    door.invalidate_residency();
    let lines = wait_for("engine residency invalidated: 4 slot(s) -> unknown");
    assert!(
        lines
            .iter()
            .any(|line| line.contains("engine residency invalidated: 4 slot(s) -> unknown")),
        "the release is not on the record: {lines:?}"
    );
    door.shutdown();
}

/// A refused media source is named nowhere: not in the 400 the client reads,
/// and not in the line the door writes about it. The address is a canary no
/// other test writes, in a URL whose host, path and query all carry it.
#[test]
fn a_refused_media_source_is_not_in_the_answer_or_the_line() {
    capture();
    let upstream = RecordingUpstream::start();
    let token = credential();
    let (door, address) = door(upstream.port, &[&token]);
    const CANARY: &str = "media-leak-canary-7f31";
    let body = format!(
        "{{\"messages\":[{{\"role\":\"user\",\"content\":[{{\"type\":\"image_url\",\
         \"image_url\":{{\"url\":\"http://{CANARY}.example/private/{CANARY}.png?token={CANARY}\"}}}}]}}]}}"
    );
    let request = format!(
        "POST {ROUTE} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\n\
         Origin: {ORIGIN}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\
         Connection: close\r\n\r\n{body}",
        body.len()
    );
    let since = line_count();
    let response = exchanged(address, &request);
    let text = String::from_utf8_lossy(&response).to_string();
    assert_eq!(status_of(&response), 400, "the source was not refused: {text}");
    assert!(!text.contains(CANARY), "the refused source reached the answer: {text}");
    assert_eq!(
        upstream.accepts(),
        0,
        "the engine was contacted for a refused body"
    );

    let _ = wait_for_new("reason door.media_source_refused", since);
    // One more settle: a line written a moment after the marker's own is in
    // the snapshot the canary is searched in.
    thread::sleep(Duration::from_millis(50));
    let lines = lines().lock().unwrap().clone();
    assert!(
        lines
            .iter()
            .skip(since)
            .any(|line| line.contains("reason door.media_source_refused")),
        "the refusal is not on the record: {lines:?}"
    );
    assert!(
        !lines.iter().skip(since).any(|line| line.contains(CANARY)),
        "the refused source reached the log: {lines:?}"
    );
    door.shutdown();
}

/// The app restarts its door in place when the engine restarts under it — the
/// vision enable stops the first door and starts the next in the same process.
/// The log belongs to the process, not to the instance: the second door's
/// authorized traffic must be on the record as the first door's was.
#[test]
fn a_second_door_in_the_same_process_still_audits_an_authorized_request() {
    capture();
    let upstream = RecordingUpstream::start();
    let token = credential();
    // A device id of this test's own: the line it waits for cannot be another
    // door's, in the capture the whole test binary shares.
    let marker = "door request: POST /v1/chat/completions device 41 status 200";
    let door_of = |token: &str| {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let door = Door::new(listener, upstream.port, device_set(&[(41, token)]), 1)
            .unwrap()
            .start()
            .unwrap();
        (door, address)
    };
    let request = chat_post(ORIGIN, Some(&format!("Bearer {token}")), None);

    let (first, first_address) = door_of(&token);
    let since = line_count();
    let served = exchanged(first_address, &request);
    assert_eq!(status_of(&served), 200, "{}", String::from_utf8_lossy(&served));
    let lines = wait_for_new(marker, since);
    assert!(
        lines.iter().skip(since).any(|line| line.contains(marker)),
        "the first door audited nothing: {lines:?}"
    );
    first.shutdown();

    // The same process starts the next door, as the app does when the engine
    // it forwards to is replaced under it.
    let (second, second_address) = door_of(&token);
    let since = line_count();
    let served = exchanged(second_address, &request);
    assert_eq!(status_of(&served), 200, "{}", String::from_utf8_lossy(&served));
    let lines = wait_for_new(marker, since);
    assert!(
        lines.iter().skip(since).any(|line| line.contains(marker)),
        "the second door audited nothing: {lines:?}"
    );
    second.shutdown();
}
