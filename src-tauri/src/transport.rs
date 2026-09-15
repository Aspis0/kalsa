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
//! * **No runtime, no framework.** Two routes, small bodies, a bounded worker
//!   pool. A machine old enough to need this product should not spend a core
//!   on an executor to exchange two messages.
//! * **Bounded by construction.** A request that never ends, a body that
//!   never stops, or a client that connects and says nothing must cost this
//!   machine a known, small amount and then be dropped.
//! * **One answer for every refusal.** Wrong code, expired window, no
//!   ceremony, malformed body: all 403 with no detail. A caller who can tell
//!   these apart can tell whether a square is live on a screen it cannot see.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use crate::pairing::SharedDesk;

/// The most a request may be. Both bodies are a handful of fields; anything
/// beyond this is not a phone of ours.
const MAX_BODY: usize = 8 * 1024;
/// The most the head may be, counted while bytes are read.
const MAX_HEAD: usize = 8 * 1024;
/// How long a connection may take to say what it wants, and to hear back.
const PATIENCE: Duration = Duration::from_secs(10);
/// Inactivity is not enough: a peer sending one byte every few seconds must
/// still be evicted so it cannot keep the phone behind it forever.
const CONNECTION_LIFETIME: Duration = Duration::from_secs(30);
const WORKERS: usize = 4;
const QUEUE: usize = 8;

pub(crate) struct Listener {
    address: String,
    stop: Arc<AtomicBool>,
    #[cfg(test)]
    accepted: Arc<AtomicUsize>,
}

struct Connection {
    stream: TcpStream,
    accepted: Instant,
}

impl Listener {
    pub(crate) fn address(&self) -> &str {
        &self.address
    }

    pub(crate) fn shutdown(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    #[cfg(test)]
    pub(crate) fn accepted_count(&self) -> usize {
        self.accepted.load(Ordering::SeqCst)
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Starts the listener and returns the address the square should advertise.
///
/// The listener outlives any single window on purpose: a port that changed
/// with every fresh square would change the address inside a QR the owner is
/// already pointing a camera at. It accepts at any time and refuses whenever
/// no ceremony is live, which is the same answer it gives to a wrong code.
pub(crate) fn serve(desk: SharedDesk) -> io::Result<Listener> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    let address = format!("http://127.0.0.1:{port}");
    let stop = Arc::new(AtomicBool::new(false));
    #[cfg(test)]
    let accepted = Arc::new(AtomicUsize::new(0));
    let (sender, receiver) = mpsc::sync_channel(QUEUE);
    let receiver = Arc::new(Mutex::new(receiver));

    for index in 0..WORKERS {
        let desk = desk.clone();
        let stop = stop.clone();
        let receiver = receiver.clone();
        thread::Builder::new()
            .name(format!("kalsa-pairing-worker-{index}"))
            .spawn(move || worker(&desk, &stop, &receiver))
            .map_err(|error| io::Error::other(format!("pairing worker: {error}")))?;
    }

    let accept_stop = stop.clone();
    #[cfg(test)]
    let accepted_counter = accepted.clone();
    std::thread::Builder::new()
        .name("kalsa-pairing".into())
        .spawn(move || {
            while !accept_stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        #[cfg(test)]
                        accepted_counter.fetch_add(1, Ordering::SeqCst);
                        let Ok(()) = stream.set_nonblocking(false) else {
                            continue;
                        };
                        // A bounded queue keeps a crowd of idle clients from
                        // becoming an unbounded thread or memory allocation.
                        let _ = sender.try_send(Connection {
                            stream,
                            accepted: Instant::now(),
                        });
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(20));
                    }
                    Err(_) => break,
                }
            }
        })?;
    Ok(Listener {
        address,
        stop,
        #[cfg(test)]
        accepted,
    })
}

fn worker(desk: &SharedDesk, stop: &AtomicBool, receiver: &Mutex<mpsc::Receiver<Connection>>) {
    loop {
        if stop.load(Ordering::SeqCst) {
            return;
        }
        let stream = {
            let receiver = receiver.lock().unwrap_or_else(|e| e.into_inner());
            receiver.recv_timeout(Duration::from_millis(50))
        };
        match stream {
            Ok(connection) => handle(desk, connection.stream, connection.accepted),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
    }
}

/// One connection, start to finish. Every early return closes it; the phone
/// learns nothing from which of them happened.
fn handle(desk: &SharedDesk, stream: TcpStream, accepted: Instant) {
    let deadline = accepted + CONNECTION_LIFETIME;
    let _ = stream.set_read_timeout(Some(PATIENCE));
    let _ = stream.set_write_timeout(Some(PATIENCE));
    let mut reader = BufReader::new(stream);
    let Some(request) = read_request(&mut reader, deadline) else {
        if let Some(remaining) = remaining(deadline) {
            let _ = reader
                .get_mut()
                .set_write_timeout(Some(remaining.min(PATIENCE)));
            let _ = refuse(reader.get_mut());
        }
        return;
    };
    let answer = route(desk, &request);
    let stream = reader.get_mut();
    if let Some(remaining) = remaining(deadline) {
        let _ = stream.set_write_timeout(Some(remaining.min(PATIENCE)));
    }
    let result = match answer {
        Some(body) => respond(stream, &body),
        None => refuse(stream),
    };
    if let Err(error) = result {
        // A successful persist retains its seal in the desk, so the phone can
        // retry when this response was lost after the file was published.
        eprintln!("kalsa pairing response was not delivered: {error}");
    }
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
fn read_request(reader: &mut BufReader<TcpStream>, deadline: Instant) -> Option<Request> {
    let mut head = Vec::new();
    loop {
        let line = read_line_bounded(reader, MAX_HEAD.saturating_sub(head.len()), deadline)?;
        if line.as_slice() == b"\r\n" || line.as_slice() == b"\n" {
            break;
        }
        head.extend_from_slice(&line);
    }
    let head = String::from_utf8(head).ok()?;
    let mut lines = head.lines();
    let mut start = lines.next()?.split_whitespace();
    let method = start.next()?.to_string();
    let path = start.next()?.to_string();
    let length = content_length(&head)?;
    if length > MAX_BODY {
        return None;
    }
    let mut body = vec![0u8; length];
    set_read_deadline(reader, deadline)?;
    reader.read_exact(&mut body).ok()?;
    // Connection: close makes ignored bytes harmless to the next request,
    // but bytes already buffered beyond Content-Length are still ambiguous
    // input and are refused rather than silently selected.
    if !reader.buffer().is_empty() {
        return None;
    }
    Some(Request { method, path, body })
}

fn read_line_bounded(
    reader: &mut BufReader<TcpStream>,
    limit: usize,
    deadline: Instant,
) -> Option<Vec<u8>> {
    let mut line = Vec::new();
    loop {
        set_read_deadline(reader, deadline)?;
        let buffer = reader.fill_buf().ok()?;
        if buffer.is_empty() {
            return None;
        }
        let take = buffer
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(buffer.len(), |index| index + 1);
        let chunk = &buffer[..take];
        let blank = line.is_empty() && (chunk == b"\n" || chunk == b"\r\n");
        if !blank && take > limit.saturating_sub(line.len()) {
            return None;
        }
        let ends = chunk.last() == Some(&b'\n');
        line.extend_from_slice(chunk);
        reader.consume(take);
        if ends {
            return Some(line);
        }
    }
}

fn remaining(deadline: Instant) -> Option<Duration> {
    let duration = deadline.checked_duration_since(Instant::now())?;
    (!duration.is_zero()).then_some(duration)
}

fn set_read_deadline(reader: &mut BufReader<TcpStream>, deadline: Instant) -> Option<()> {
    let timeout = remaining(deadline)?.min(PATIENCE);
    reader.get_mut().set_read_timeout(Some(timeout)).ok()
}

/// The announced body length. A request without one carries no body, which is
/// a length of zero rather than an error.
fn content_length(head: &str) -> Option<usize> {
    let mut length = None;
    for line in head.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("transfer-encoding") {
            return None;
        }
        if name.trim().eq_ignore_ascii_case("content-length") {
            if length.is_some() {
                return None;
            }
            length = Some(value.trim().parse().ok()?);
        }
    }
    Some(length.unwrap_or(0))
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

#[cfg(test)]
mod tests;
