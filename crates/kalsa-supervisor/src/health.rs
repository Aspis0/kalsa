//! Readiness handshake.
//!
//! `llama-server` has no startup line to read: it logs to stderr and starts
//! answering `/health` once the model is loaded (`503` while it is still
//! loading). So readiness is a probe with a deadline, never a `sleep` of a
//! guessed duration — a sleep is either too short (the first request fails) or
//! too long (the user waits on a machine that is already serving).
//!
//! `/health` cannot answer "is that OUR engine", and the fork says so itself:
//! `/health` and `/v1/health` are the routes it serves WITHOUT the key
//! (`common/arg.cpp:3496-3506`, `server-http.cpp:251-300`). A stale
//! engine from an earlier run — same port, its own key, still holding the model
//! it loaded last night — answers `/health` with `200`, so a handshake built on
//! that route alone reports somebody else's server as ours.
//!
//! So identity is PROVED, not assumed, in three plain requests:
//!
//! 1. a key-gated route with OUR key answers `2xx` — only a process this run
//!    handed the key to can accept it;
//! 2. the same route with a key this run did NOT mint is refused (`401`/
//!    `403`) — a `2xx` there means the listener ignores `Authorization`
//!    altogether, and a `200` from a listener that ignores it proves nothing
//!    about anybody's key;
//! 3. `/health`, the open route, answers `200`: that engine is loaded.
//!
//! Anything short of all three is `Loading`: an engine that has not bound yet
//! refuses the connection, one still loading answers `503`, and a question
//! this handshake could not read is not a question it may answer. A refused
//! key at (1), or a key accepted at (2), is a `Stranger` — reported, never
//! signalled.
//!
//! Each request is its own `GET` on its own connection, ended by the server
//! with `Connection: close`. That is deliberate: keep-alive and pipelining are
//! the fork's business, and a handshake that depends on them is a handshake
//! that cannot start the engine on a build which does not do them. Separate
//! connections cost three round trips on loopback and buy a handshake that
//! works on every build this app ships.
//!
//! Deliberately no HTTP client dependency: three requests, three status lines,
//! and each body read past — exactly as long as its head promised — so the
//! connection closes on a finished read.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

/// The route that says "loaded", and the one route behind no key.
pub const HEALTH_PATH: &str = "/health";

/// A route behind the key, used for both halves of the identity proof.
const IDENTITY_PATH: &str = "/props";

/// Enough for any status line and the headers this needs; a head longer than
/// this is not one to keep reading.
const HEAD_CAP: usize = 8 * 1024;

/// How much of a body this will read past. The engine's `/props` is a few
/// KiB; a megabyte is far past anything a status check needs, and the read is
/// thrown away either way.
const BODY_CAP: usize = 1024 * 1024;

/// Who answers on the port, and whether it is ready.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Who {
    /// Nothing proved yet: the port refuses, the engine has not answered
    /// behind its key, or a question could not be read. The caller polls, and
    /// its own deadline is what eventually gives up.
    Loading,
    /// A listener that is NOT the engine this run started: it refuses this
    /// run's key, or it accepts every key. Adopting it would report somebody
    /// else's server — with somebody else's model, and a key this process does
    /// not have — as ours. Never signalled, only reported.
    Stranger,
    /// The engine this run started, with its model loaded.
    Ready,
}

/// What one request found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Answer {
    /// `2xx`: the route answered.
    Accepted,
    /// `401`/`403`: it is there, and it will not have this key.
    RefusedKey,
    /// Refused, timed out, `503` "loading", unreadable, garbage — no answer.
    Silent,
}

/// The handshake: our engine, our key, loaded.
///
/// Three connections, and the first one that proves anything else ends it:
/// there is no reason to ask a stranger a third question.
pub fn who_answers(addr: SocketAddr, key: &str, timeout: Duration) -> Who {
    // 1. Our key, on the gated route.
    match ask(addr, IDENTITY_PATH, Some(key), timeout) {
        Answer::Accepted => {}
        Answer::RefusedKey => return Who::Stranger,
        Answer::Silent => return Who::Loading,
    }
    // 2. Loaded.
    if ask(addr, HEALTH_PATH, None, timeout) != Answer::Accepted {
        return Who::Loading;
    }
    // 3. The negative control: it must refuse a key this run never minted. A
    // `2xx` here is a listener that ignores `Authorization`, so the `2xx` at
    // (1) proved nothing; a control it could not answer proves nothing either,
    // and nothing is adopted either way.
    match ask(addr, IDENTITY_PATH, Some(&wrong_key(key)), timeout) {
        Answer::RefusedKey => Who::Ready,
        Answer::Accepted => Who::Stranger,
        Answer::Silent => Who::Loading,
    }
}

/// True when `addr` answers `path` with `2xx` within `timeout`, without a key.
///
/// Any failure (refused, timeout, 503 "loading", garbage) is false: the caller
/// polls until its own deadline, and reports the last probe as the reason.
/// This is the `Started` server's own liveness watch, where the thing on the
/// port was already proved to be ours at the handshake, so no key is asked
/// again on every tick.
pub fn health_ok(addr: SocketAddr, path: &str, timeout: Duration) -> bool {
    ask(addr, path, None, timeout) == Answer::Accepted
}

/// One `GET` on its own connection, read to its status line and then past its
/// body so the server sees a finished read rather than a reset.
fn ask(addr: SocketAddr, path: &str, key: Option<&str>, timeout: Duration) -> Answer {
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, timeout) else {
        return Answer::Silent;
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let mut request = format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\n");
    if let Some(key) = key {
        request.push_str(&format!("Authorization: Bearer {key}\r\n"));
    }
    request.push_str("Connection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return Answer::Silent;
    }
    let Some(head) = read_head(&mut stream) else {
        return Answer::Silent;
    };
    let answer = status_of(&head.text);
    // The body is read past so the server sees a finished read rather than a
    // reset, and it is read EXACTLY: a head that promises `Content-Length: n`
    // owes n bytes, of which some may already be in hand, so a server that
    // honours `Connection: close` costs nothing and one that ignores it costs
    // no more than the body it promised.
    let owed = content_length_of(&head.text).map(|length| length.saturating_sub(head.body_read));
    read_body(&mut stream, owed);
    answer
}

/// A key this run did not mint: the real one with its first hex digit flipped.
/// A key that cannot be flipped is returned unchanged, and it is still not the
/// key this run handed to its child.
fn wrong_key(key: &str) -> String {
    let mut bytes = key.as_bytes().to_vec();
    if let Some(first) = bytes.first_mut() {
        *first = if *first == b'0' { b'1' } else { b'0' };
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Where a head ends: the blank line, and everything up to and including it.
fn head_end(bytes: &[u8]) -> Option<usize> {
    bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|start| start + 4)
}

/// A complete response head, and what came after it on the same read.
struct Head {
    /// The head itself, blank line included.
    text: String,
    /// Bytes of body already in hand: a server writes headers and body
    /// together as often as not, and those bytes must count towards the body
    /// or this handshake waits for bytes that already arrived.
    body_read: usize,
}

/// The response head, read until it is COMPLETE.
///
/// One `read` is not a head: TCP splits anywhere, and a head cut in half is a
/// status line this cannot read — which must be silence, never a guess. A head
/// that never gets its blank line is not read at all, for the same reason: a
/// status line cut after "401" would read as a refused key.
fn read_head(stream: &mut TcpStream) -> Option<Head> {
    let mut head = Vec::new();
    let mut scratch = [0u8; 512];
    loop {
        if let Some(end) = head_end(&head) {
            return Some(Head {
                text: String::from_utf8_lossy(&head[..end]).into_owned(),
                body_read: head.len() - end,
            });
        }
        if head.len() >= HEAD_CAP {
            return None;
        }
        match stream.read(&mut scratch) {
            Ok(0) | Err(_) => return None,
            Ok(read) => head.extend_from_slice(&scratch[..read]),
        }
    }
}

/// How long a body this head promises, when it promises one.
fn content_length_of(head: &str) -> Option<usize> {
    head.lines()
        .skip(1) // the status line is not a header
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.trim().parse().ok())
}

/// Reads the body to the end, bounded, and throws it away.
///
/// `owed` is what the head promised: `Some(n)` reads exactly n bytes and
/// stops, so a server that keeps the connection open anyway costs the
/// handshake nothing. `None` — no `Content-Length`, so the body ends where the
/// connection does — reads to EOF, still bounded by [`BODY_CAP`]: a body
/// longer than that is not one to keep reading, and the status line is the
/// whole answer either way.
fn read_body(stream: &mut TcpStream, owed: Option<usize>) {
    let mut scratch = [0u8; 8 * 1024];
    let mut left = owed.unwrap_or(BODY_CAP).min(BODY_CAP);
    while left > 0 {
        match stream.read(&mut scratch) {
            Ok(0) | Err(_) => return,
            Ok(read) => left -= read.min(left),
        }
    }
}

/// Reads one status line into the three answers that matter here.
fn status_of(response_head: &str) -> Answer {
    match code_of(response_head) {
        "401" | "403" => Answer::RefusedKey,
        code if code.len() == 3 && code.starts_with('2') => Answer::Accepted,
        _ => Answer::Silent,
    }
}

/// `HTTP/1.x <code> …` — the version may be nothing else, the reason phrase
/// may be anything, and only the code is read. Empty for anything that is not
/// a status line at all.
fn code_of(response_head: &str) -> &str {
    let mut parts = response_head.split_whitespace();
    let version = parts.next().unwrap_or_default();
    let code = parts.next().unwrap_or_default();
    if version.starts_with("HTTP/1.") {
        code
    } else {
        ""
    }
}

#[cfg(test)]
#[path = "health/tests.rs"]
mod tests;