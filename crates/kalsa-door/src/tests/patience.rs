//! The engine is allowed to be quiet. A long prompt on a slow computer is read
//! in batches, the engine reporting between them, and tokens come a few a
//! second: the door waits through those silences — up to the answer's own
//! lifetime — instead of ending the answer at the first quiet read. The wake-up
//! interval is shrunk on each test's own door so the silences cost
//! milliseconds.

use std::net::SocketAddr;

use super::support::*;
use super::*;
use crate::clocks::Clocks;

const QUIET: Duration = Duration::from_millis(900);
const PATIENCE: Duration = Duration::from_millis(250);

/// An upstream for one connection: the request is read (head and declared
/// body), then `script` has the socket.
pub(super) fn scripted_upstream(
    script: impl FnOnce(&mut TcpStream) + Send + 'static,
) -> (u16, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let thread = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut head = Vec::new();
        if read_until(&mut stream, b"\r\n\r\n", &mut head).is_err() {
            return;
        }
        script(&mut stream);
    });
    (port, thread)
}

/// A client that asks for a completion and does NOT half-close: the way a
/// browser keeps its end open while it waits.
pub(super) fn ask(address: SocketAddr, token: &str) -> TcpStream {
    let mut client = TcpStream::connect(address).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    client
        .write_all(
            format!(
                "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
                 Authorization: Bearer {token}\r\nContent-Type: application/json\r\n\
                 Content-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .as_bytes(),
        )
        .unwrap();
    client
}

pub(super) fn read_to_end(mut client: TcpStream) -> String {
    let mut answer = Vec::new();
    let _ = client.read_to_end(&mut answer);
    String::from_utf8_lossy(&answer).to_string()
}

pub(super) const SSE_HEAD: &[u8] = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
pub(super) const RAW_HEAD: &[u8] = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n";

#[test]
fn an_event_stream_that_goes_quiet_for_longer_than_the_patience_arrives_whole() {
    bounded(Duration::from_secs(30), || {
        let clocks = Clocks::default().patience(PATIENCE);
        // The shape of the Surface's failure: a first prefill report, a silence
        // the length of one batch, then the rest of the answer.
        let (port, upstream) = scripted_upstream(|stream| {
            stream.write_all(SSE_HEAD).unwrap();
            stream
                .write_all(b"data: {\"prompt_progress\":{\"total\":1434,\"processed\":267}}\n\n")
                .unwrap();
            thread::sleep(QUIET);
            stream
                .write_all(b"data: {\"choices\":[{\"delta\":{\"content\":\"Ciao\"}}]}\n\ndata: [DONE]\n\n")
                .unwrap();
        });
        let token = credential();
        let (door, address) = door_with(port, &[&token], clocks);
        let answer = read_to_end(ask(address, &token));
        assert!(answer.contains("prompt_progress"), "{answer}");
        assert!(answer.contains("\"content\":\"Ciao\""), "the answer after the quiet arrived: {answer}");
        assert!(answer.contains("[DONE]"), "and so did its end: {answer}");
        upstream.join().unwrap();
        door.shutdown();
    });
}

#[test]
fn a_relayed_answer_that_goes_quiet_for_longer_than_the_patience_arrives_whole() {
    bounded(Duration::from_secs(30), || {
        let clocks = Clocks::default().patience(PATIENCE);
        let (port, upstream) = scripted_upstream(|stream| {
            stream.write_all(RAW_HEAD).unwrap();
            stream.write_all(b"first half, ").unwrap();
            thread::sleep(QUIET);
            stream.write_all(b"second half").unwrap();
        });
        let token = credential();
        let (door, address) = door_with(port, &[&token], clocks);
        let answer = read_to_end(ask(address, &token));
        assert!(answer.ends_with("first half, second half"), "{answer}");
        upstream.join().unwrap();
        door.shutdown();
    });
}

#[test]
fn an_engine_that_is_slow_to_begin_answering_is_waited_for() {
    bounded(Duration::from_secs(30), || {
        let clocks = Clocks::default().patience(PATIENCE);
        let (port, upstream) = scripted_upstream(|stream| {
            thread::sleep(QUIET);
            stream.write_all(SSE_HEAD).unwrap();
            stream
                .write_all(b"data: {\"choices\":[{\"delta\":{\"content\":\"late\"}}]}\n\ndata: [DONE]\n\n")
                .unwrap();
        });
        let token = credential();
        let (door, address) = door_with(port, &[&token], clocks);
        let answer = read_to_end(ask(address, &token));
        assert!(answer.contains("\"content\":\"late\""), "{answer}");
        upstream.join().unwrap();
        door.shutdown();
    });
}

#[test]
fn a_client_that_leaves_while_the_engine_is_quiet_frees_the_relay_promptly() {
    bounded(Duration::from_secs(30), || {
        let clocks = Clocks::default().patience(PATIENCE);
        let (closed_tx, closed_rx) = mpsc::channel();
        let (port, upstream) = scripted_upstream(move |stream| {
            stream.write_all(RAW_HEAD).unwrap();
            stream.write_all(b"started").unwrap();
            // Silent, listening: the door closing its end of this socket is the
            // relay having stopped.
            stream
                .set_read_timeout(Some(Duration::from_millis(50)))
                .unwrap();
            let begun = Instant::now();
            let mut byte = [0u8; 1];
            loop {
                match stream.read(&mut byte) {
                    Ok(0) => break,
                    Err(error) if super::proxy::is_silence(&error) => {}
                    Err(_) => break,
                    Ok(_) => {}
                }
                if begun.elapsed() > Duration::from_secs(8) {
                    break;
                }
            }
            let _ = closed_tx.send(begun.elapsed());
        });
        let token = credential();
        let (door, address) = door_with(port, &[&token], clocks);
        let mut client = ask(address, &token);
        let mut seen = Vec::new();
        while !seen.ends_with(b"started") {
            let mut byte = [0u8; 1];
            client.read_exact(&mut byte).unwrap();
            seen.push(byte[0]);
        }
        drop(client);
        let after = closed_rx.recv_timeout(Duration::from_secs(9)).unwrap();
        assert!(
            after < Duration::from_secs(3),
            "the relay held the engine for {after:?} after the client was gone"
        );
        upstream.join().unwrap();
        door.shutdown();
    });
}

#[test]
fn a_completions_answer_has_a_long_ceiling_and_an_idle_bound_counted_from_pickup() {
    let started = Instant::now();
    let clocks = Clocks::default();
    let (completion, idle) = proxy::answer_window(started, true, &clocks);
    let (other, other_idle) = proxy::answer_window(started, false, &clocks);
    assert_eq!(other - started, CONNECTION_LIFETIME, "everything else keeps the connection's");
    assert_eq!(other_idle, CONNECTION_LIFETIME);
    assert_eq!(completion - started, clocks.completion_ceiling);
    assert!(
        completion - started >= Duration::from_secs(30 * 60),
        "a long answer on a slow computer is not cut at {CONNECTION_LIFETIME:?}"
    );
    assert!(
        idle >= Duration::from_secs(10 * 60) && idle < completion - started,
        "the idle bound is long enough for two prefill batches and shorter than the ceiling: {idle:?}"
    );
}
