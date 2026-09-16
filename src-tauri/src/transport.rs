//! What carries the ceremony: a loopback listener the phone reaches through
//! the same tunnel it uses for the server.
//!
//! The acceptor reads incomplete requests without tying up a route worker.
//! Active sockets and complete-request queue entries are both bounded, and a
//! full bound gets a best-effort 403 without making the acceptor wait for a
//! peer that refuses to read.

mod parser;

use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
#[cfg(test)]
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use crate::pairing::SharedDesk;
use parser::{ParseResult, Request, MAX_BUFFER};

/// Inactivity is not enough: a peer sending one byte every few seconds must
/// still be evicted by the absolute deadline below.
const PATIENCE: Duration = Duration::from_secs(10);
const CONNECTION_LIFETIME: Duration = Duration::from_secs(30);
const WORKERS: usize = 4;
const QUEUE: usize = 8;
/// A partial socket is cheap and bounded; route workers never wait on it.
/// Keep the admission bound tied to the only two downstream capacities.
const MAX_CONNECTIONS: usize = WORKERS + QUEUE;
const POLL_INTERVAL: Duration = Duration::from_millis(5);
const LOG_INTERVAL: Duration = Duration::from_secs(1);

pub(crate) struct Listener {
    address: String,
    stop: Arc<AtomicBool>,
    #[cfg(test)]
    accepted: Arc<AtomicUsize>,
}

struct Connection {
    stream: TcpStream,
    accepted: Instant,
    last_activity: Instant,
    buffer: Vec<u8>,
}

struct Work {
    stream: TcpStream,
    request: Request,
    accepted: Instant,
}

struct WriteErrorLog {
    state: Mutex<LogState>,
}

struct LogState {
    last: Option<Instant>,
    suppressed: usize,
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

impl WriteErrorLog {
    fn new() -> Self {
        Self {
            state: Mutex::new(LogState {
                last: None,
                suppressed: 0,
            }),
        }
    }

    fn report(&self, error: &io::Error) {
        let now = Instant::now();
        let Some(suppressed) = self.should_report(now) else {
            return;
        };
        if suppressed == 0 {
            eprintln!("kalsa pairing response was not delivered: {error}");
        } else {
            eprintln!(
                "kalsa pairing response was not delivered: {error} ({suppressed} similar errors suppressed)"
            );
        }
    }

    fn should_report(&self, now: Instant) -> Option<usize> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state
            .last
            .is_some_and(|last| now.duration_since(last) < LOG_INTERVAL)
        {
            state.suppressed += 1;
            return None;
        }
        let suppressed = state.suppressed;
        state.last = Some(now);
        state.suppressed = 0;
        Some(suppressed)
    }
}

/// Starts the listener and returns the address the square should advertise.
/// The acceptor remains bound so a fresh square does not need a new address.
pub(crate) fn serve(desk: SharedDesk) -> io::Result<Listener> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    let address = format!("http://127.0.0.1:{port}");
    let stop = Arc::new(AtomicBool::new(false));
    #[cfg(test)]
    let accepted = Arc::new(AtomicUsize::new(0));
    let logger = Arc::new(WriteErrorLog::new());
    let (sender, receiver) = request_queue();

    for index in 0..WORKERS {
        let desk = desk.clone();
        let worker_stop = stop.clone();
        let receiver = receiver.clone();
        let logger = logger.clone();
        if let Err(error) = thread::Builder::new()
            .name(format!("kalsa-pairing-worker-{index}"))
            .spawn(move || worker(&desk, &worker_stop, &receiver, &logger))
        {
            stop.store(true, Ordering::SeqCst);
            return Err(io::Error::other(format!("pairing worker: {error}")));
        }
    }

    let accept_stop = stop.clone();
    let accept_desk = desk.clone();
    let accept_logger = logger.clone();
    #[cfg(test)]
    let accepted_counter = accepted.clone();
    if let Err(error) = thread::Builder::new()
        .name("kalsa-pairing".into())
        .spawn(move || {
            accept_loop(
                listener,
                accept_desk,
                accept_stop,
                sender,
                accept_logger,
                #[cfg(test)]
                accepted_counter,
            );
        })
    {
        stop.store(true, Ordering::SeqCst);
        return Err(io::Error::other(format!("pairing listener: {error}")));
    }
    Ok(Listener {
        address,
        stop,
        #[cfg(test)]
        accepted,
    })
}

fn request_queue() -> (mpsc::SyncSender<Work>, Arc<Mutex<mpsc::Receiver<Work>>>) {
    let (sender, receiver) = mpsc::sync_channel(QUEUE);
    (sender, Arc::new(Mutex::new(receiver)))
}

fn accept_loop(
    listener: TcpListener,
    desk: SharedDesk,
    stop: Arc<AtomicBool>,
    sender: mpsc::SyncSender<Work>,
    logger: Arc<WriteErrorLog>,
    #[cfg(test)] accepted: Arc<AtomicUsize>,
) {
    let mut connections = Vec::new();
    while !stop.load(Ordering::SeqCst) {
        let mut progressed = match accept_connections(
            &listener,
            &mut connections,
            &logger,
            #[cfg(test)]
            &accepted,
        ) {
            Ok(progressed) => progressed,
            Err(error) => {
                eprintln!("kalsa pairing listener stopped: {error}");
                desk.listener_failed();
                stop.store(true, Ordering::SeqCst);
                break;
            }
        };
        let mut index = 0;
        while index < connections.len() {
            match read_connection(&mut connections[index]) {
                ReadResult::Pending => {
                    if connection_expired(&connections[index], Instant::now()) {
                        refuse_connection(&mut connections[index].stream, &logger);
                        connections.remove(index);
                        progressed = true;
                    } else {
                        index += 1;
                    }
                }
                ReadResult::Refuse => {
                    refuse_connection(&mut connections[index].stream, &logger);
                    connections.remove(index);
                    progressed = true;
                }
                ReadResult::Ready(request) => {
                    let connection = connections.remove(index);
                    let stream = connection.stream;
                    let work = Work {
                        stream,
                        request,
                        accepted: connection.accepted,
                    };
                    match sender.try_send(work) {
                        Ok(()) => {}
                        Err(mpsc::TrySendError::Full(mut work)) => {
                            refuse_connection(&mut work.stream, &logger);
                        }
                        Err(mpsc::TrySendError::Disconnected(_)) => {
                            eprintln!("kalsa pairing listener stopped: worker pool disconnected");
                            desk.listener_failed();
                            stop.store(true, Ordering::SeqCst);
                        }
                    }
                    progressed = true;
                }
            }
        }
        if !progressed {
            thread::sleep(POLL_INTERVAL);
        }
    }
}

fn accept_connections(
    listener: &TcpListener,
    connections: &mut Vec<Connection>,
    logger: &WriteErrorLog,
    #[cfg(test)] accepted: &AtomicUsize,
) -> io::Result<bool> {
    let mut progressed = false;
    loop {
        match classify(listener.accept()) {
            Accepted::Socket(mut stream) => {
                #[cfg(test)]
                accepted.fetch_add(1, Ordering::SeqCst);
                progressed = true;
                if connections.len() >= MAX_CONNECTIONS {
                    refuse_connection(&mut stream, logger);
                    continue;
                }
                if stream.set_nonblocking(true).is_err() {
                    refuse_connection(&mut stream, logger);
                    continue;
                }
                let now = Instant::now();
                connections.push(Connection {
                    stream,
                    accepted: now,
                    last_activity: now,
                    buffer: Vec::with_capacity(MAX_BUFFER),
                });
            }
            Accepted::Idle => return Ok(progressed),
            Accepted::Retry => {
                thread::sleep(POLL_INTERVAL);
                return Ok(true);
            }
            Accepted::Fatal(error) => return Err(error),
        }
    }
}

enum Accepted {
    Socket(TcpStream),
    Idle,
    Retry,
    Fatal(io::Error),
}

fn classify(result: io::Result<(TcpStream, SocketAddr)>) -> Accepted {
    match result {
        Ok((stream, _)) => Accepted::Socket(stream),
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => Accepted::Idle,
        Err(error) if accept_error_is_transient(&error) => Accepted::Retry,
        Err(error) => Accepted::Fatal(error),
    }
}

fn accept_error_is_transient(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::Interrupted
            | io::ErrorKind::ConnectionAborted
            | io::ErrorKind::ConnectionReset
            | io::ErrorKind::TimedOut
    ) || transient_errno(error.raw_os_error())
}

#[cfg(unix)]
fn transient_errno(errno: Option<i32>) -> bool {
    matches!(
        errno,
        Some(libc::EMFILE | libc::ENFILE | libc::ECONNABORTED)
    )
}

#[cfg(not(unix))]
fn transient_errno(_errno: Option<i32>) -> bool {
    false
}

enum ReadResult {
    Pending,
    Ready(Request),
    Refuse,
}

fn read_connection(connection: &mut Connection) -> ReadResult {
    match parser::parse(&connection.buffer) {
        ParseResult::Ready(request) => return ReadResult::Ready(request),
        ParseResult::Refuse => return ReadResult::Refuse,
        ParseResult::Pending => {}
    }
    let mut chunk = [0u8; 4096];
    match connection.stream.read(&mut chunk) {
        Ok(0) => match parser::parse(&connection.buffer) {
            ParseResult::Ready(request) => ReadResult::Ready(request),
            ParseResult::Pending | ParseResult::Refuse => ReadResult::Refuse,
        },
        Ok(read) => {
            connection.last_activity = Instant::now();
            if connection.buffer.len() + read > MAX_BUFFER {
                return ReadResult::Refuse;
            }
            connection.buffer.extend_from_slice(&chunk[..read]);
            match parser::parse(&connection.buffer) {
                ParseResult::Ready(request) => ReadResult::Ready(request),
                ParseResult::Pending => ReadResult::Pending,
                ParseResult::Refuse => ReadResult::Refuse,
            }
        }
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => ReadResult::Pending,
        Err(_) => ReadResult::Refuse,
    }
}

fn connection_expired(connection: &Connection, now: Instant) -> bool {
    now.duration_since(connection.accepted) >= CONNECTION_LIFETIME
        || now.duration_since(connection.last_activity) >= PATIENCE
}

fn worker(
    desk: &SharedDesk,
    stop: &AtomicBool,
    receiver: &Mutex<mpsc::Receiver<Work>>,
    logger: &WriteErrorLog,
) {
    loop {
        let work = {
            let receiver = receiver.lock().unwrap_or_else(|e| e.into_inner());
            receiver.recv_timeout(POLL_INTERVAL)
        };
        let work = match work {
            Ok(work) => Some(work),
            Err(mpsc::RecvTimeoutError::Timeout) => None,
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        };
        if stop.load(Ordering::SeqCst) {
            return;
        }
        let Some(work) = work else {
            continue;
        };
        handle(desk, work, logger);
    }
}

/// A complete request is the only thing a route worker sees. Its absolute
/// deadline still begins when the socket was accepted, not when it reached
/// the queue.
fn handle(desk: &SharedDesk, work: Work, logger: &WriteErrorLog) {
    let deadline = work.accepted + CONNECTION_LIFETIME;
    let mut stream = work.stream;
    if let Some(answer) = route(desk, &work.request) {
        let result = respond(&mut stream, &answer.body, deadline);
        if result.is_ok() {
            if let Some(token) = answer.delivery_token {
                desk.acknowledge(&token);
            }
        } else if let Err(error) = result {
            logger.report(&error);
        }
    } else if let Err(error) = refuse(&mut stream, deadline) {
        logger.report(&error);
    }
}

struct Answer {
    body: String,
    delivery_token: Option<String>,
}

fn route(desk: &SharedDesk, request: &Request) -> Option<Answer> {
    let now = SystemTime::now();
    match (request.method.as_str(), request.path.as_str()) {
        ("POST", "/pair/claim") => {
            let claim: Claim = serde_json::from_slice(&request.body).ok()?;
            desk.claim(&claim.code, now).then_some(Answer {
                body: String::from("{}"),
                delivery_token: None,
            })
        }
        ("POST", "/pair/complete") => {
            let declaration: kalsa_pairing::PhoneDeclaration =
                serde_json::from_slice(&request.body).ok()?;
            let token = declaration.delivery_token().to_string();
            let seal = desk.complete(declaration, now)?;
            Some(Answer {
                body: serde_json::to_string(&seal).ok()?,
                delivery_token: Some(token),
            })
        }
        _ => None,
    }
}

#[derive(serde::Deserialize)]
struct Claim {
    code: String,
}

fn refuse_connection(stream: &mut TcpStream, logger: &WriteErrorLog) {
    if let Err(error) = refuse(stream, Instant::now() + PATIENCE) {
        logger.report(&error);
    }
}

fn respond(stream: &mut TcpStream, body: &str, deadline: Instant) -> io::Result<()> {
    remaining(deadline)
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "connection deadline"))?;
    stream.set_nonblocking(true)?;
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

fn refuse(stream: &mut TcpStream, deadline: Instant) -> io::Result<()> {
    remaining(deadline)
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "connection deadline"))?;
    // Refusals stay non-blocking deliberately: a peer that refuses to read
    // must not make the acceptor wait. This is best-effort, bounded by the
    // caller's deadline, rather than a blocking promise that can be abused.
    stream.set_nonblocking(true)?;
    stream.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
}

fn remaining(deadline: Instant) -> Option<Duration> {
    let duration = deadline.checked_duration_since(Instant::now())?;
    (!duration.is_zero()).then_some(duration)
}

#[cfg(test)]
mod tests;
