//! Fixtures shared by the door's test submodules: the upstreams, the readers
//! over them, and the request and answer helpers the CORS tests share.

use std::io;
use std::net::{SocketAddr, TcpListener};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use super::*;
use crate::RunningDoor;

/// A canned upstream for the slot tests: it counts every accepted
/// connection, records the complete request head it read, and answers 200
/// with no body. The count is the proof that a refusal happened before any
/// socket was opened; the recorded heads are the proof of which slot and
/// which private headers the door sealed.
pub(super) struct RecordingUpstream {
    pub(super) port: u16,
    accepts: Arc<AtomicUsize>,
    heads: Arc<Mutex<Vec<Vec<u8>>>>,
    stop: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl RecordingUpstream {
    pub(super) fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let stop = Arc::new(AtomicBool::new(false));
        let accepts = Arc::new(AtomicUsize::new(0));
        let heads = Arc::new(Mutex::new(Vec::new()));
        let thread_stop = Arc::clone(&stop);
        let thread_accepts = Arc::clone(&accepts);
        let thread_heads = Arc::clone(&heads);
        let handle = thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            while !thread_stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        thread_accepts.fetch_add(1, Ordering::SeqCst);
                        // Each connection is served on its own thread: a
                        // held exchange must not stop the next accept.
                        let heads = Arc::clone(&thread_heads);
                        thread::spawn(move || {
                            let mut stream = stream;
                            stream.set_nonblocking(false).unwrap();
                            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                            let mut head = Vec::new();
                            if read_until(&mut stream, b"\r\n\r\n", &mut head).is_err() {
                                return;
                            }
                            heads.lock().unwrap().push(head);
                            let _ = std::io::Write::write_all(
                                &mut stream,
                                b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                            );
                        });
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(_) => return,
                }
            }
        });
        Self {
            port,
            accepts,
            heads,
            stop,
            handle: Some(handle),
        }
    }

    pub(super) fn accepts(&self) -> usize {
        self.accepts.load(Ordering::SeqCst)
    }

    pub(super) fn heads(&self) -> Vec<Vec<u8>> {
        self.heads.lock().unwrap().clone()
    }
}

impl Drop for RecordingUpstream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

/// Every value the head carries for a field name, case-insensitively.
pub(super) fn header_values(head: &[u8], name: &str) -> Vec<String> {
    let text = String::from_utf8_lossy(head);
    text.lines()
        .filter_map(|line| line.split_once(':'))
        .filter(|(field, _)| field.trim().eq_ignore_ascii_case(name))
        .map(|(_, value)| value.trim().to_string())
        .collect()
}

/// The one sealed slot header, asserted present exactly once.
pub(super) fn sealed_slot(head: &[u8]) -> u32 {
    let values = header_values(head, "x-kalsa-slot");
    assert_eq!(
        values.len(),
        1,
        "the head must carry exactly one sealed slot header: {}",
        String::from_utf8_lossy(head)
    );
    values[0]
        .parse()
        .unwrap_or_else(|_| panic!("the sealed slot is not a number: {}", values[0]))
}

/// Devices with explicit ids, for tests where a device must keep its id
/// across a set change (`door_devices` numbers by position).
pub(super) fn device_set(entries: &[(u32, &str)]) -> Devices {
    let entries = entries
        .iter()
        .map(|(id, token)| {
            DeviceEntry::new(
                DeviceId::new(*id),
                format!("device {id}"),
                token.to_string(),
            )
            .unwrap()
        })
        .collect();
    Devices::new(entries).unwrap()
}

/// The one origin the desktop webview has.
pub(super) const ORIGIN: &str = "tauri://localhost";

/// A genuine preflight, the shape a browser sends: `OPTIONS`, both the
/// `Origin` and the `Access-Control-Request-Method` header, and no credential.
pub(super) fn preflight(origin: &str) -> String {
    format!(
        "OPTIONS /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
         Origin: {origin}\r\n\
         Access-Control-Request-Method: POST\r\n\
         Access-Control-Request-Headers: authorization,content-type\r\n\
         Connection: close\r\n\r\n"
    )
}

/// The chat POST a preflight gates: JSON content type, a bearer credential,
/// an origin — the three things that make the browser send one.
pub(super) fn chat_post(
    origin: &str,
    authorization: Option<&str>,
    last_event_id: Option<&str>,
) -> String {
    let auth = authorization
        .map(|value| format!("Authorization: {value}\r\n"))
        .unwrap_or_default();
    let resume = last_event_id
        .map(|id| format!("Last-Event-ID: {id}\r\n"))
        .unwrap_or_default();
    format!(
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
         Origin: {origin}\r\n{auth}{resume}Content-Type: application/json\r\n\
         Content-Length: 0\r\nConnection: close\r\n\r\n"
    )
}

/// One request, its whole answer read.
pub(super) fn exchanged(address: SocketAddr, request: &str) -> Vec<u8> {
    let mut client = TcpStream::connect(address).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    client.write_all(request.as_bytes()).unwrap();
    client.shutdown(Shutdown::Write).unwrap();
    let mut response = Vec::new();
    client.read_to_end(&mut response).unwrap();
    response
}

/// The answer up to and including the blank line that ends its head.
pub(super) fn response_head(response: &[u8]) -> &[u8] {
    let end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|at| at + 4)
        .unwrap_or(response.len());
    &response[..end]
}

/// The body the client received, byte for byte.
pub(super) fn response_body(response: &[u8]) -> &[u8] {
    &response[response_head(response).len()..]
}

/// Every `Access-Control-Allow-Origin` the answer carries. Two values mean
/// the door spoke where the upstream had already spoken.
pub(super) fn allowed_origins(response: &[u8]) -> Vec<String> {
    header_values(response_head(response), "access-control-allow-origin")
}

/// The rule every answer that can name an origin obeys: `Vary: Origin` is on
/// all of them — the answer differs by origin whether or not it grants
/// anything — and the permission line names an allowlisted origin only.
pub(super) fn assert_origin_aware(response: &[u8], expected: Option<&str>, case: &str) {
    let text = String::from_utf8_lossy(response);
    assert_eq!(
        header_values(response_head(response), "vary"),
        vec!["Origin".to_string()],
        "{case} does not say that it varies by origin: {text}"
    );
    let expected: Vec<String> = expected.map(str::to_string).into_iter().collect();
    assert_eq!(
        allowed_origins(response),
        expected,
        "{case} names an origin it must not, or misses the one it must: {text}"
    );
}

/// A started door with capacity one, the shape the desktop app runs.
pub(super) fn door(upstream_port: u16, tokens: &[&str]) -> (RunningDoor, SocketAddr) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let door = Door::new(listener, upstream_port, door_devices(tokens), 1)
        .unwrap()
        .start()
        .unwrap();
    (door, address)
}

/// Waits out the window in which a connection to the upstream could still
/// arrive, so a zero is read after the door has had its chance to open one.
pub(super) fn no_upstream_connection(upstream: &RecordingUpstream) {
    let window = Instant::now() + Duration::from_millis(250);
    while upstream.accepts() == 0 && Instant::now() < window {
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(upstream.accepts(), 0, "the door opened an upstream connection");
}

/// The upstream's own CORS behaviour, measured against the `llama-server`
/// this app launches (version 10360, default `--cors-origins *` with
/// credentials on): it echoes the request's `Origin` on every answer head.
pub(super) fn echoing_upstream() -> (u16, Arc<AtomicBool>, thread::JoinHandle<()>) {
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = upstream.local_addr().unwrap().port();
    let stop = Arc::new(AtomicBool::new(false));
    let thread = {
        let stop = Arc::clone(&stop);
        thread::spawn(move || {
            upstream.set_nonblocking(true).unwrap();
            while !stop.load(Ordering::SeqCst) {
                match upstream.accept() {
                    Ok((stream, _)) => {
                        let mut stream = stream;
                        stream.set_nonblocking(false).unwrap();
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                        let mut head = Vec::new();
                        if read_until(&mut stream, b"\r\n\r\n", &mut head).is_err() {
                            continue;
                        }
                        let origin = header_values(&head, "origin").pop().unwrap_or_default();
                        let answer = format!(
                            "HTTP/1.1 200 OK\r\nServer: llama.cpp\r\n\
                             Access-Control-Allow-Origin: {origin}\r\n\
                             Content-Type: application/json\r\n\
                             Content-Length: 11\r\nConnection: close\r\n\r\n{{\"ok\":true}}"
                        );
                        let _ = stream.write_all(answer.as_bytes());
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

/// An upstream that answers every request with the head and the body a test
/// hands it, whatever the request said. The head arrives as bytes, so a test
/// chooses exactly which CORS lines the upstream sends.
pub(super) fn answering_upstream(
    head: &'static [u8],
    body: &'static [u8],
) -> (u16, Arc<AtomicBool>, thread::JoinHandle<()>) {
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = upstream.local_addr().unwrap().port();
    let stop = Arc::new(AtomicBool::new(false));
    let thread = {
        let stop = Arc::clone(&stop);
        thread::spawn(move || {
            upstream.set_nonblocking(true).unwrap();
            while !stop.load(Ordering::SeqCst) {
                match upstream.accept() {
                    Ok((mut stream, _)) => {
                        stream.set_nonblocking(false).unwrap();
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                        let mut request = Vec::new();
                        if read_until(&mut stream, b"\r\n\r\n", &mut request).is_err() {
                            continue;
                        }
                        let _ = stream.write_all(head);
                        let _ = stream.write_all(body);
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

/// An upstream that answers with an event-stream head, so the door takes
/// custody of the answer and asks the registry for a job — and nothing more:
/// the door answers 503 the moment that request is refused, so the write may
/// well fail on a socket it has already closed, and that failure is expected.
pub(super) fn sse_head_upstream() -> (u16, Arc<AtomicBool>, thread::JoinHandle<()>) {
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = upstream.local_addr().unwrap().port();
    let stop = Arc::new(AtomicBool::new(false));
    let thread = {
        let stop = Arc::clone(&stop);
        thread::spawn(move || {
            upstream.set_nonblocking(true).unwrap();
            while !stop.load(Ordering::SeqCst) {
                match upstream.accept() {
                    Ok((mut stream, _)) => {
                        stream.set_nonblocking(false).unwrap();
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                        let mut head = Vec::new();
                        if read_until(&mut stream, b"\r\n\r\n", &mut head).is_err() {
                            continue;
                        }
                        let mut body = vec![0u8; 7];
                        let _ = stream.read_exact(&mut body);
                        let _ = stream.write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\
                              Transfer-Encoding: chunked\r\n\r\n",
                        );
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
