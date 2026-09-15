//! What carries the ceremony: a loopback listener the phone reaches through
//! the same tunnel it uses for the server.
//!
//! Until this existed the ceremony authenticated nobody to nobody — the page
//! invoked four commands that were never written, nothing ever called
//! `store::persist`, and so the computer's answer to "which phone is this?"
//! was always "none". Every model choice was made on the no-phone path.
//!
//! The decisions here, and why:
//!
//! * **`127.0.0.1` and nothing else.** Binding the LAN "just for the pairing
//!   window" would put an endpoint that mints credentials on the same network
//!   as everything else in the house. The inference server is loopback for
//!   this reason and the phone already arrives through a tunnel; pairing
//!   takes the same road.
//! * **No runtime, no framework.** Two routes, small bodies, one thread. A
//!   machine old enough to need this product should not spend a core on an
//!   executor to exchange two messages.
//! * **Bounded by construction.** A request that never ends, a body that
//!   never stops, or a client that connects and says nothing must cost this
//!   machine a known, small amount and then be dropped.
//! * **One answer for every refusal.** Wrong code, expired window, no
//!   ceremony, malformed body: all 403 with no detail. A caller who can tell
//!   these apart can tell whether a square is live on a screen it cannot see.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::time::{Duration, SystemTime};

use crate::pairing::SharedDesk;

/// The most a request may be. Both bodies are a handful of fields; anything
/// beyond this is not a phone of ours.
const MAX_BODY: usize = 8 * 1024;
/// The most the head may be, counted the same way.
const MAX_HEAD: usize = 8 * 1024;
/// How long a connection may take to say what it wants, and to hear back.
const PATIENCE: Duration = Duration::from_secs(10);

/// Starts the listener and returns the address the square should advertise.
///
/// The listener outlives any single window on purpose: a port that changed
/// with every fresh square would change the address inside a QR the owner is
/// already pointing a camera at. It accepts at any time and refuses whenever
/// no ceremony is live, which is the same answer it gives to a wrong code.
pub(crate) fn serve(desk: SharedDesk) -> io::Result<String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let port = listener.local_addr()?.port();
    std::thread::Builder::new()
        .name("kalsa-pairing".into())
        .spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                // One connection at a time: two phones racing the same square
                // would serialise on the desk's mutex anyway, and the
                // ceremony is one-shot regardless of who gets there first.
                handle(&desk, stream);
            }
        })?;
    Ok(format!("http://127.0.0.1:{port}"))
}

/// One connection, start to finish. Every early return closes it; the phone
/// learns nothing from which of them happened.
fn handle(desk: &SharedDesk, stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(PATIENCE));
    let _ = stream.set_write_timeout(Some(PATIENCE));
    let mut reader = BufReader::new(stream);
    let Some(request) = read_request(&mut reader) else {
        let _ = refuse(reader.get_mut());
        return;
    };
    let answer = route(desk, &request);
    let stream = reader.get_mut();
    let _ = match answer {
        Some(body) => respond(stream, &body),
        None => refuse(stream),
    };
}

/// The two moves a phone can make. Anything else is refused without being
/// told what it got wrong.
fn route(desk: &SharedDesk, request: &Request) -> Option<String> {
    let now = SystemTime::now();
    match (request.method.as_str(), request.path.as_str()) {
        ("POST", "/pair/claim") => {
            let claim: Claim = serde_json::from_slice(&request.body).ok()?;
            desk.claim(&claim.code, now).then(|| String::from("{}"))
        }
        ("POST", "/pair/complete") => {
            let declaration = serde_json::from_slice(&request.body).ok()?;
            let seal = desk.complete(declaration, now)?;
            serde_json::to_string(&seal).ok()
        }
        _ => None,
    }
}

/// The code from the square, as the phone sends it back.
#[derive(serde::Deserialize)]
struct Claim {
    code: String,
}

/// A request, reduced to what these two routes need.
struct Request {
    method: String,
    path: String,
    body: Vec<u8>,
}

/// Reads one request, refusing anything larger than this machine agreed to
/// hold. `None` for a head that never ends, a body that does not match its
/// announced length, or bytes that are not a request at all.
fn read_request(reader: &mut BufReader<TcpStream>) -> Option<Request> {
    let mut head = String::new();
    loop {
        let mut line = String::new();
        // A peer that never sends a newline stops at the read timeout; a peer
        // that sends nothing but newlines stops at this cap.
        if reader.read_line(&mut line).ok()? == 0 {
            return None;
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        head.push_str(&line);
        if head.len() > MAX_HEAD {
            return None;
        }
    }
    let mut lines = head.lines();
    let mut start = lines.next()?.split_whitespace();
    let method = start.next()?.to_string();
    let path = start.next()?.to_string();
    let length = content_length(&head)?;
    if length > MAX_BODY {
        return None;
    }
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body).ok()?;
    Some(Request { method, path, body })
}

/// The announced body length. A request without one carries no body, which is
/// a length of zero rather than an error.
fn content_length(head: &str) -> Option<usize> {
    for line in head.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("content-length") {
            return value.trim().parse().ok();
        }
    }
    Some(0)
}

fn respond(stream: &mut TcpStream, body: &str) -> io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

/// The one refusal. No body, no reason, no variation: everything a caller
/// could learn from the difference is something we do not want it to learn.
fn refuse(stream: &mut TcpStream) -> io::Result<()> {
    stream.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
}
