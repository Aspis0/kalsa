//! The room's fake engine: a loopback llama-server that answers scripted
//! turns, so the driver's whole road — the seat, the prompt, the stream,
//! the failures — is tested against the wire shape it actually speaks.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// What one connection to the fake engine does.
#[derive(Clone)]
pub(super) enum Reply {
    /// A streamed answer in the given content pieces.
    Sse(Vec<String>),
    /// One piece, then the socket dies without the terminal event: an
    /// answer the engine abandoned halfway.
    SseBroken(String),
    /// An HTTP refusal, no body worth reading.
    Refuse,
    RefuseStatus(u16),
    /// Accept and say nothing at all: the caller hangs.
    Hang,
    /// Refuse with 413 only when the request body exceeds the cap: the
    /// engine that ran out of context for what it was handed.
    RefuseIfOver(usize),
    /// The SSE head and one delta, then silence forever: a stream that
    /// stalls without dying.
    Stall,
    /// SSE comments at a steady pace without ever sending answer content.
    KeepAlive,
}

/// What the fake saw on one connection: the request head and body.
#[derive(Clone, Debug)]
pub(super) struct Seen {
    pub(super) head: String,
    pub(super) body: String,
}

pub(super) struct Engine {
    pub(super) port: u16,
    seen: Arc<Mutex<Vec<Seen>>>,
    listener: TcpListener,
    replies: Arc<Mutex<Vec<Reply>>>,
}

impl Engine {
    /// Starts the fake with a script; each accepted connection takes the
    /// next reply, and `Hang` is served forever once the script runs out.
    pub(super) fn start(replies: Vec<Reply>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let replies = Arc::new(Mutex::new(replies));
        let thread_seen = Arc::clone(&seen);
        let thread_replies = Arc::clone(&replies);
        thread::Builder::new()
            .name("room-fake-engine".into())
            .spawn(move || accept(listener, thread_seen, thread_replies))
            .unwrap();
        Self {
            port: address.port(),
            seen,
            listener: TcpListener::bind("127.0.0.1:0").unwrap(),
            replies,
        }
    }

    /// The requests the fake has served, in order.
    pub(super) fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }

    /// Lets a test add more script once the first runs out.
    pub(super) fn script(&self, replies: Vec<Reply>) {
        self.replies.lock().unwrap().extend(replies);
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        // The accept thread ends with the listener it holds.
        let _ = TcpStream::connect(("127.0.0.1", self.port));
    }
}

fn accept(listener: TcpListener, seen: Arc<Mutex<Vec<Seen>>>, replies: Arc<Mutex<Vec<Reply>>>) {
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else {
            continue;
        };
        // Each connection consumes the next reply, except the two that
        // describe a standing engine (a size cap, a stall) — those apply
        // to every connection until the script moves past them. Past the
        // script's end the engine says nothing, forever.
        let standing = matches!(
            replies.lock().unwrap().first(),
            Some(Reply::RefuseIfOver(_)) | Some(Reply::Stall) | Some(Reply::KeepAlive)
        );
        let reply = replies
            .lock()
            .unwrap()
            .first()
            .cloned()
            .unwrap_or(Reply::Hang);
        if !standing && !replies.lock().unwrap().is_empty() {
            replies.lock().unwrap().remove(0);
        }
        let seen = Arc::clone(&seen);
        thread::spawn(move || serve(&mut stream, reply, seen));
    }
}

fn serve(stream: &mut TcpStream, reply: Reply, seen: Arc<Mutex<Vec<Seen>>>) {
    let request = read_request(stream);
    // The size-capped refusal reads the body before choosing, so the
    // record keeps it and the cap borrows it back.
    let body_length = request.body.len();
    seen.lock().unwrap().push(request.clone());
    match reply {
        Reply::SseBroken(piece) => {
            let head =
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
            if stream.write_all(head.as_bytes()).is_err() {
                return;
            }
            let escaped = piece.replace('"', "\\\"");
            let frame =
                format!("data: {{\"choices\":[{{\"delta\":{{\"content\":\"{escaped}\"}}}}]}}\n\n");
            let _ = stream.write_all(frame.as_bytes());
            let _ = stream.shutdown(std::net::Shutdown::Both);
        }
        Reply::Refuse => {
            let _ = stream.write_all(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        }
        Reply::RefuseStatus(status) => {
            let response = format!(
                "HTTP/1.1 {status} Refused\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            let _ = stream.write_all(response.as_bytes());
        }
        Reply::RefuseIfOver(cap) => {
            if body_length > cap {
                let _ = stream.write_all(
                    b"HTTP/1.1 413 Payload Too Large\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
            } else {
                let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
                if stream.write_all(head.as_bytes()).is_err() {
                    return;
                }
                let _ = stream.write_all(b"data: {\"choices\":[{\"delta\":{\"content\":\"fitted\"}}]}\n\n");
                let _ = stream.write_all(b"data: [DONE]\n\n");
            }
        }
        Reply::Stall => {
            let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
            if stream.write_all(head.as_bytes()).is_err() {
                return;
            }
            let _ = stream.write_all(b"data: {\"choices\":[{\"delta\":{\"content\":\"then nothing\"}}]}\n\n");
            thread::sleep(Duration::from_secs(120));
        }
        Reply::KeepAlive => {
            let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
            if stream.write_all(head.as_bytes()).is_err() {
                return;
            }
            loop {
                if stream.write_all(b": keep-alive\n\n").is_err() {
                    return;
                }
                thread::sleep(Duration::from_millis(50));
            }
        }
        // Hold the connection open, saying nothing: the caller hangs. The
        // thread sleeps rather than returning, because returning closes
        // the socket and the caller reads an end, not a silence.
        Reply::Hang => {
            thread::sleep(Duration::from_secs(120));
        }
        Reply::Sse(pieces) => {
            let head =
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
            if stream.write_all(head.as_bytes()).is_err() {
                return;
            }
            for piece in pieces {
                let escaped = piece
                    .replace('\\', "\\\\")
                    .replace('"', "\\\"")
                    .replace('\n', "\\n");
                let frame = format!(
                    "data: {{\"choices\":[{{\"delta\":{{\"content\":\"{escaped}\"}}}}]}}\n\n"
                );
                if stream.write_all(frame.as_bytes()).is_err() {
                    return;
                }
                // Slow enough for a test to act between pieces, fast
                // enough for the whole answer to arrive in seconds.
                thread::sleep(Duration::from_millis(100));
            }
            let _ = stream.write_all(b"data: [DONE]\n\n");
        }
    }
}

/// One request, head and body, read by length.
fn read_request(stream: &mut TcpStream) -> Seen {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut bytes = Vec::new();
    let mut byte = [0u8; 1];
    while !bytes.ends_with(b"\r\n\r\n") {
        match stream.read(&mut byte) {
            Ok(0) => break,
            Ok(_) => bytes.push(byte[0]),
            Err(_) => break,
        }
    }
    let head = String::from_utf8_lossy(&bytes).to_string();
    let length = head
        .lines()
        .find_map(|line| line.strip_prefix("Content-Length: "))
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = vec![0u8; length];
    let _ = stream.read_exact(&mut body);
    Seen {
        head,
        body: String::from_utf8_lossy(&body).to_string(),
    }
}
