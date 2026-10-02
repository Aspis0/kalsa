//! The limits on a long answer: how long a client may wait for a worker, how
//! long the engine may say nothing at all, the ceiling on a runaway, and what
//! happens to an answer whose client has left. The clocks are shrunk through
//! each door's own `Clocks` so each limit costs a second, not minutes.

use std::net::SocketAddr;

use super::patience::{ask, read_to_end, scripted_upstream, SSE_HEAD};
use super::support::*;
use super::*;
use crate::clocks::Clocks;
use crate::RunningDoor;

const FRAME: &[u8] = b"data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\n";

/// A door whose workers give up on a silent connection only after
/// `head_patience`: a few connections that say nothing keep every worker busy.
fn slow_to_give_up(
    port: u16,
    token: &str,
    head_patience: Duration,
    clocks: Clocks,
) -> (RunningDoor, SocketAddr) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let door = Door::new(listener, port, door_devices(&[token]), 1)
        .unwrap()
        .with_head_patience(head_patience)
        .with_clocks(clocks)
        .start()
        .unwrap();
    (door, address)
}

/// Connections that occupy every worker without asking for anything.
fn busy_workers(address: SocketAddr) -> Vec<TcpStream> {
    let held = (0..crate::WORKERS)
        .map(|_| TcpStream::connect(address).unwrap())
        .collect();
    thread::sleep(Duration::from_millis(150));
    held
}

/// An upstream that streams a frame every 100 ms for up to `frames`, ends the
/// answer if it gets that far, and reports how long it was held: the moment its
/// socket is closed from the door's side.
fn streaming_until_closed(
    frames: usize,
    finish: bool,
    held: mpsc::Sender<Duration>,
) -> (u16, thread::JoinHandle<()>) {
    scripted_upstream(move |stream| {
        let begun = Instant::now();
        stream.write_all(SSE_HEAD).unwrap();
        for _ in 0..frames {
            if stream.write_all(FRAME).is_err() {
                let _ = held.send(begun.elapsed());
                return;
            }
            thread::sleep(Duration::from_millis(100));
        }
        if finish {
            let _ = stream.write_all(b"data: [DONE]\n\n");
        }
        let _ = held.send(begun.elapsed());
    })
}

#[test]
fn a_client_that_waits_too_long_for_a_worker_is_answered_busy_at_the_bound() {
    bounded(Duration::from_secs(30), || {
        let clocks = Clocks::default().queue_wait(Duration::from_millis(500));
        let token = credential();
        let (door, address) = slow_to_give_up(9, &token, Duration::from_secs(4), clocks);
        let _idlers = busy_workers(address);
        let begun = Instant::now();
        let answer = read_to_end(ask(address, &token));
        let waited = begun.elapsed();
        assert!(answer.starts_with("HTTP/1.1 503"), "not the busy answer: {answer}");
        assert!(
            waited >= Duration::from_millis(400) && waited < Duration::from_secs(2),
            "answered busy at the bound, not when a worker freed: {waited:?}"
        );
        door.shutdown();
    });
}

#[test]
fn the_answers_budget_counts_from_when_a_worker_takes_the_request_up() {
    bounded(Duration::from_secs(30), || {
        // Every worker is busy for 1.5 s; the answer then takes 1.5 s more. Counted
        // from accept it would need 3 s of a 2.5 s ceiling and be cut; counted from
        // pickup it needs 1.5 s and arrives whole.
        let clocks = Clocks::default().patience(Duration::from_millis(100)).ceiling(Duration::from_millis(2500));
        let (held_tx, _held) = mpsc::channel();
        let (port, upstream) = streaming_until_closed(15, true, held_tx);
        let token = credential();
        let (door, address) = slow_to_give_up(port, &token, Duration::from_millis(1500), clocks);
        let _idlers = busy_workers(address);
        let answer = read_to_end(ask(address, &token));
        assert!(answer.contains("[DONE]"), "a queued client was cut with its budget already spent: {answer}");
        upstream.join().unwrap();
        door.shutdown();
    });
}

#[test]
fn an_engine_that_says_nothing_at_all_for_the_idle_bound_ends_the_answer() {
    bounded(Duration::from_secs(30), || {
        let clocks = Clocks::default().patience(Duration::from_millis(100)).idle(Duration::from_millis(600));
        let (port, upstream) = scripted_upstream(|stream| {
            stream.write_all(SSE_HEAD).unwrap();
            stream.write_all(FRAME).unwrap();
            // Silent for far longer than the bound: the door lets go first, and
            // its close is what ends this read.
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut byte = [0u8; 1];
            let _ = stream.read(&mut byte);
        });
        let token = credential();
        let (door, address) = door_with(port, &[&token], clocks);
        let begun = Instant::now();
        let answer = read_to_end(ask(address, &token));
        let took = begun.elapsed();
        assert!(answer.contains("\"content\":\"x\"") && !answer.contains("[DONE]"), "{answer}");
        assert!(
            took >= Duration::from_millis(500) && took < Duration::from_secs(3),
            "ended by the idle bound, not the ceiling or the engine: {took:?}"
        );
        upstream.join().unwrap();
        door.shutdown();
    });
}

#[test]
fn a_talkative_engine_is_still_cut_at_the_ceiling() {
    bounded(Duration::from_secs(30), || {
        let clocks = Clocks::default().patience(Duration::from_millis(100)).ceiling(Duration::from_millis(900));
        let (held_tx, held) = mpsc::channel();
        let (port, upstream) = streaming_until_closed(60, false, held_tx);
        let token = credential();
        let (door, address) = door_with(port, &[&token], clocks);
        let begun = Instant::now();
        let answer = read_to_end(ask(address, &token));
        let took = begun.elapsed();
        assert!(answer.contains("\"content\":\"x\""), "{answer}");
        assert!(
            took >= Duration::from_millis(800) && took < Duration::from_secs(3),
            "a runaway generation is cut at the ceiling: {took:?}"
        );
        assert!(held.recv_timeout(Duration::from_secs(3)).unwrap() < Duration::from_secs(3));
        upstream.join().unwrap();
        door.shutdown();
    });
}

/// A phone asking to rejoin an answer from the last event id it saw.
fn resume(address: SocketAddr, token: &str, last_event_id: &str) -> TcpStream {
    let mut phone = TcpStream::connect(address).unwrap();
    phone.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    phone
        .write_all(
            format!(
                "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
                 Authorization: Bearer {token}\r\nLast-Event-ID: {last_event_id}\r\n\
                 Content-Type: application/json\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .as_bytes(),
        )
        .unwrap();
    phone
}

/// Reads from `client` until one whole event with an `id:` line has arrived,
/// and returns that id.
fn first_event_id(client: &mut TcpStream) -> String {
    let mut seen = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        client.read_exact(&mut byte).unwrap();
        seen.push(byte[0]);
        let text = String::from_utf8_lossy(&seen);
        if let Some(from) = text.find("\nid: ") {
            if let Some(line) = text[from + 1..].lines().next() {
                if text.ends_with("\n\n") && line.starts_with("id: ") {
                    return line["id: ".len()..].to_string();
                }
            }
        }
    }
}

#[test]
fn a_client_that_stops_does_not_hold_the_engine_until_the_ceiling() {
    bounded(Duration::from_secs(30), || {
        // The desktop's Stop just closes the connection. With nobody reading and
        // nobody resuming, the answer is cancelled after the grace, which closes
        // the engine's socket: its slot, the device's seat and the worker are free.
        let clocks = Clocks::default().patience(Duration::from_millis(100)).detached(Duration::from_millis(600));
        let (held_tx, held) = mpsc::channel();
        let (port, upstream) = streaming_until_closed(60, true, held_tx);
        let token = credential();
        let (door, address) = door_with(port, &[&token], clocks);
        let mut client = ask(address, &token);
        first_event_id(&mut client);
        drop(client);
        let held_for = held.recv_timeout(Duration::from_secs(8)).unwrap();
        assert!(
            held_for < Duration::from_secs(3),
            "the engine was held for {held_for:?} after nobody was left to read"
        );
        upstream.join().unwrap();
        door.shutdown();
    });
}

#[test]
fn a_resuming_reader_keeps_a_detached_answer_alive() {
    bounded(Duration::from_secs(30), || {
        let clocks = Clocks::default().patience(Duration::from_millis(100)).detached(Duration::from_millis(600));
        let (held_tx, _held) = mpsc::channel();
        let (port, upstream) = streaming_until_closed(20, true, held_tx);
        let token = credential();
        let (door, address) = door_with(port, &[&token], clocks);
        let mut client = ask(address, &token);
        let id = first_event_id(&mut client);
        drop(client);
        // The phone comes back before the grace is over and stays to the end —
        // longer than the grace, so only the reader is what keeps the answer.
        let phone = resume(address, &token, &id);
        let rest = read_to_end(phone);
        assert!(rest.contains("[DONE]"), "the resumed answer was abandoned under its reader: {rest}");
        upstream.join().unwrap();
        door.shutdown();
    });
}

#[test]
fn a_resumed_answer_that_was_abandoned_gets_its_tail_and_then_the_reason() {
    bounded(Duration::from_secs(30), || {
        let clocks = Clocks::default()
            .patience(Duration::from_millis(100))
            .detached(Duration::from_millis(400));
        let (held_tx, _held) = mpsc::channel();
        let (port, upstream) = streaming_until_closed(60, true, held_tx);
        let token = credential();
        let (door, address) = door_with(port, &[&token], clocks);
        let mut client = ask(address, &token);
        let id = first_event_id(&mut client);
        drop(client);
        // Nobody reads and nobody comes back inside the grace: the door
        // abandons the answer, with more events logged than the client saw.
        thread::sleep(Duration::from_millis(1500));
        let rest = read_to_end(resume(address, &token, &id));
        assert!(
            rest.contains("\"content\":\"x\""),
            "the part of the answer the phone missed is replayed: {rest}"
        );
        let last = rest.trim_end().lines().last().unwrap_or_default();
        let event: serde_json::Value =
            serde_json::from_str(last.strip_prefix("data: ").unwrap_or(last))
                .unwrap_or_else(|error| panic!("the last event is not json ({error}): {rest}"));
        assert_eq!(
            event["error"]["code"], "abandoned",
            "and then it is told why it ends, not left with a silent close: {rest}"
        );
        assert!(
            event["error"]["message"]
                .as_str()
                .is_some_and(|words| words.contains("stopped because nobody was reading it")),
            "with the English fallback beside the code: {rest}"
        );
        assert!(!rest.contains("[DONE]"), "{rest}");
        upstream.join().unwrap();
        door.shutdown();
    });
}
