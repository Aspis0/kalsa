//! The room's fake engine: a loopback llama-server that answers scripted
//! turns, so the driver's whole road — the seat, the prompt, the stream,
//! the failures — is tested against the wire shape it actually speaks.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
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
    /// A request that carries images answers only after `silence` has
    /// passed with no frame at all — the projector's first encode, which
    /// reports nothing while it works — and a request without images
    /// answers at once. In both cases the answer is `pieces`, streamed.
    SseAfterImages {
        silence: Duration,
        pieces: Vec<String>,
    },
    /// A prompt being read: `reports` prefill frames (`prompt_progress`, empty
    /// delta) one `gap` apart, timed the way the engine times them, and then
    /// the answer `then` — or silence for ever when there is none.
    Prefill {
        reports: usize,
        gap: Duration,
        then: Option<String>,
    },
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
    writes_failed: Arc<AtomicUsize>,
    listener: TcpListener,
    replies: Arc<Mutex<Vec<Reply>>>,
}

impl Engine {
    /// Starts the fake with a script; each accepted connection takes the
    /// next reply, and `Hang` is served forever once the script runs out.
    pub(super) fn start(replies: Vec<Reply>) -> Self {
        Self::build(replies, serde_json::json!({}))
    }

    /// The same fake, whose `/props` names this model's media: the shape
    /// the room turn's vision probe reads, `modalities.vision` true meaning
    /// the room's pictures ride.
    pub(super) fn with_vision(replies: Vec<Reply>) -> Self {
        Self::build(
            replies,
            serde_json::json!({ "modalities": { "vision": true } }),
        )
    }

    fn build(replies: Vec<Reply>, props: serde_json::Value) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let replies = Arc::new(Mutex::new(replies));
        let writes_failed = Arc::new(AtomicUsize::new(0));
        let thread_seen = Arc::clone(&seen);
        let thread_replies = Arc::clone(&replies);
        let thread_writes = Arc::clone(&writes_failed);
        thread::Builder::new()
            .name("room-fake-engine".into())
            .spawn(move || {
                accept(
                    listener,
                    thread_seen,
                    thread_replies,
                    thread_writes,
                    Arc::new(Mutex::new(props)),
                )
            })
            .unwrap();
        Self {
            port: address.port(),
            seen,
            writes_failed,
            listener: TcpListener::bind("127.0.0.1:0").unwrap(),
            replies,
        }
    }

    /// How many of the fake's SSE piece writes failed — nonzero when the
    /// door dropped the upstream while the answer was still streaming.
    pub(super) fn writes_failed(&self) -> usize {
        self.writes_failed.load(Ordering::SeqCst)
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

fn accept(
    listener: TcpListener,
    seen: Arc<Mutex<Vec<Seen>>>,
    replies: Arc<Mutex<Vec<Reply>>>,
    writes_failed: Arc<AtomicUsize>,
    props: Arc<Mutex<serde_json::Value>>,
) {
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else {
            continue;
        };
        let seen = Arc::clone(&seen);
        let writes = Arc::clone(&writes_failed);
        let replies = Arc::clone(&replies);
        let props = Arc::clone(&props);
        thread::spawn(move || serve(&mut stream, replies, props, seen, writes));
    }
}

fn serve(
    stream: &mut TcpStream,
    replies: Arc<Mutex<Vec<Reply>>>,
    props: Arc<Mutex<serde_json::Value>>,
    seen: Arc<Mutex<Vec<Seen>>>,
    writes_failed: Arc<AtomicUsize>,
) {
    let request = read_request(stream);
    // The vision probe is a standing answer, never a script line: the
    // turn reads /props once before each completion, and the script is
    // the completions' own. It is not recorded in `seen`, which is the
    // completions' ledger — the tests' counts and bodies stay completion
    // counts and bodies.
    if request.head.starts_with("GET /props") {
        let body = props.lock().unwrap().to_string();
        let answer = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
             Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(answer.as_bytes());
        return;
    }
    // The size-capped refusal reads the body before choosing, so the
    // record keeps it and the cap borrows it back.
    let body_length = request.body.len();
    seen.lock().unwrap().push(request.clone());
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
                let _ = stream
                    .write_all(b"data: {\"choices\":[{\"delta\":{\"content\":\"fitted\"}}]}\n\n");
                let _ = stream.write_all(b"data: [DONE]\n\n");
            }
        }
        Reply::Stall => {
            let head =
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
            if stream.write_all(head.as_bytes()).is_err() {
                return;
            }
            let _ = stream
                .write_all(b"data: {\"choices\":[{\"delta\":{\"content\":\"then nothing\"}}]}\n\n");
            thread::sleep(Duration::from_secs(120));
        }
        Reply::Prefill { reports, gap, then } => {
            let head =
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
            if stream.write_all(head.as_bytes()).is_err() {
                return;
            }
            let total = (reports + 1) * 2048;
            for report in 0..reports {
                if report > 0 {
                    thread::sleep(gap);
                }
                let frame = format!(
                    "data: {{\"choices\":[{{\"index\":0,\"delta\":{{\"role\":\"assistant\",\"content\":null}}}}],\
                     \"prompt_progress\":{{\"total\":{total},\"cache\":0,\"processed\":{},\"time_ms\":{}}}}}\n\n",
                    report * 2048,
                    gap.as_millis() as usize * report
                );
                if stream.write_all(frame.as_bytes()).is_err() {
                    return;
                }
            }
            match then {
                Some(text) => {
                    thread::sleep(gap);
                    let frame = format!(
                        "data: {{\"choices\":[{{\"delta\":{{\"content\":\"{text}\"}}}}]}}\n\n"
                    );
                    let _ = stream.write_all(frame.as_bytes());
                    let _ = stream.write_all(b"data: [DONE]\n\n");
                }
                None => thread::sleep(Duration::from_secs(120)),
            }
        }
        Reply::SseAfterImages { silence, pieces } => {
            if request.body.contains("\"image_url\"") {
                thread::sleep(silence);
            }
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
                thread::sleep(Duration::from_millis(20));
            }
            let _ = stream.write_all(b"data: [DONE]\n\n");
        }
        Reply::KeepAlive => {
            let head =
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
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
                    writes_failed.fetch_add(1, Ordering::SeqCst);
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
