//! The engine's timing numbers on the completion's request line: an SSE
//! answer and a plain one, each driven through a real door against an
//! upstream that answers with a recorded tail, and the line that carries
//! the counters afterwards.
//!
//! The counters are this module's own markers: no other test's completion
//! carries these numbers, so the shared capture's lines are searched for
//! them and nothing else. The content words are canaries — they ride the
//! relay to the client and must never ride the line.

use std::io::Write;
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use super::logging::{capture, line_count, serial, wait_for_new};
use super::support::{chat_post, door, exchanged, ORIGIN};
use super::*;

/// A recorded stream tail, as the engine frames a completion: two content
/// chunks, the final chunk with the counters, and the sentinel.
const STREAM_TAIL: &str = concat!(
    r#"data: {"content":"ALPHA-CANARY","stop":false}"#,
    "\n\n",
    r#"data: {"content":"BETA-CANARY","stop":false}"#,
    "\n\n",
    r#"data: {"content":"","stop":true,"timings":{"prompt_n":1452,"prompt_ms":312.53,"predicted_n":97,"predicted_ms":3001.25},"tokens_cached":1408}"#,
    "\n\n",
    "data: [DONE]\n\n",
);

/// An upstream that answers every POST with the bytes handed here: the SSE
/// stub sends the tail chunked with an event-stream head, the plain stub
/// sends a Content-Length JSON body.
fn scripted_upstream(head: String, body: String) -> (u16, Arc<AtomicBool>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let stop = Arc::new(AtomicBool::new(false));
    let thread = {
        let stop = Arc::clone(&stop);
        thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            while !stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream.set_nonblocking(false).unwrap();
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                        let mut head_bytes = Vec::new();
                        if read_until(&mut stream, b"\r\n\r\n", &mut head_bytes).is_err() {
                            continue;
                        }
                        let _ = stream.write_all(head.as_bytes());
                        let _ = stream.write_all(body.as_bytes());
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(_) => return,
                }
            }
        })
    };
    (port, stop, thread)
}

fn sse_upstream() -> (u16, Arc<AtomicBool>, thread::JoinHandle<()>) {
    // Every event framed as its own chunk, then the terminal chunk, so the
    // door sees a complete chunked stream and closes the answer itself.
    let mut body = String::new();
    for event in STREAM_TAIL.split("\n\n") {
        if event.is_empty() {
            continue;
        }
        let framed = format!("{event}\n\n");
        body.push_str(&format!("{:X}\r\n{framed}\r\n", framed.len()));
    }
    body.push_str("0\r\n\r\n");
    scripted_upstream(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\
         Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
            .to_string(),
        body,
    )
}

fn plain_upstream(body: &str) -> (u16, Arc<AtomicBool>, thread::JoinHandle<()>) {
    scripted_upstream(
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
             Content-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        ),
        body.to_string(),
    )
}

/// The line this module's completion produced, found by `marker`.
fn the_line(marker: &str, since: usize) -> String {
    wait_for_new(marker, since)
        .into_iter()
        .skip(since)
        .find(|line| line.contains(marker))
        .expect("the door wrote no request line for the completion")
}

#[test]
fn a_streamed_completion_line_carries_the_engine_counters() {
    capture();
    let _serial = serial();
    let (port, stop, thread) = sse_upstream();
    let token = credential();
    let (door, address) = door(port, &[&token]);
    let since = line_count();
    let answer = exchanged(address, &chat_post(ORIGIN, Some(&format!("Bearer {token}")), None));
    assert!(
        String::from_utf8_lossy(&answer).contains("ALPHA-CANARY"),
        "the stub's events never reached the client"
    );

    let line = the_line("prompt 1452/313ms predicted 97/3001ms cache 1408", since);
    assert!(
        line.starts_with("door request: POST /v1/chat/completions device 0 status 200"),
        "{line}"
    );
    // The content the relay moved never rides the line.
    for canary in ["ALPHA-CANARY", "BETA-CANARY", "content"] {
        assert!(!line.contains(canary), "{line}");
    }
    door.shutdown();
    stop.store(true, Ordering::SeqCst);
    let _ = thread.join();
}

#[test]
fn a_plain_completion_line_carries_the_engine_counters_too() {
    capture();
    let _serial = serial();
    // A non-stream body: Content-Length JSON, relayed by the plain relay,
    // counters at the end where the engine puts them.
    let (port, stop, thread) = plain_upstream(
        r#"{"content":"GAMMA-CANARY","id_slot":0,"timings":{"prompt_n":48,"prompt_ms":180.4,"predicted_n":11,"predicted_ms":900.7},"tokens_cached":40}"#,
    );
    let token = credential();
    let (door, address) = door(port, &[&token]);
    let since = line_count();
    let _ = exchanged(address, &chat_post(ORIGIN, Some(&format!("Bearer {token}")), None));

    let line = the_line("prompt 48/180ms predicted 11/901ms cache 40", since);
    assert!(
        line.starts_with("door request: POST /v1/chat/completions device 0 status 200"),
        "{line}"
    );
    assert!(!line.contains("GAMMA-CANARY"), "{line}");
    door.shutdown();
    stop.store(true, Ordering::SeqCst);
    let _ = thread.join();
}

/// One shape check beside the counters: a completion whose answer names no
/// keys logs exactly as it always did — no suffix at all, not an empty
/// `timings` word.
#[test]
fn a_completion_without_counters_logs_the_shape_it_always_did() {
    capture();
    let _serial = serial();
    let (port, stop, thread) = plain_upstream(r#"{"content":"no counters","id_slot":0}"#);
    let token = credential();
    let (door, address) = door(port, &[&token]);
    let since = line_count();
    let _ = exchanged(address, &chat_post(ORIGIN, Some(&format!("Bearer {token}")), None));

    let line = the_line("door request: POST /v1/chat/completions device 0 status 200", since);
    assert!(!line.contains("timings"), "{line}");
    assert!(!line.contains("prompt "), "{line}");
    door.shutdown();
    stop.store(true, Ordering::SeqCst);
    let _ = thread.join();
}
