//! The disk tier's fixture: a fake engine and the helpers every disk-tier test
//! needs. It plays the engine on a `TcpListener` — recording every request and
//! answering from a queue the test fills — so none of this needs a model.
use std::collections::VecDeque;
use std::fs;
use std::io::{self, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::RunningDoor;

use super::support::header_values;
use super::*;

/// The pin the app hands the door, and the id a chat is opened by.
pub(super) const HASH: &str = "a1b2c3d4";
pub(super) const CHAT: &str = "0f1e2d3c-5a6b";

/// One request the door made to the engine, as the engine would read it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Sent {
    pub(super) action: String,
    pub(super) slot: String,
    pub(super) salt: String,
    pub(super) filename: String,
}

/// What the engine answers with. A save writes the file it is told to write
/// whatever it reports, because the engine does: an empty slot is a 200 with
/// `n_saved` 0, and that is the case the staging file exists for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Reply {
    Answered(u64),
    Refused,
    /// The engine never answers: the connection closes with the request read,
    /// which is what the door cannot tell apart from an action that ran.
    Unreachable,
}

/// A fake engine: it records every request and answers from a queue. Without a
/// queued answer it reports one token written, which is a normal save.
pub(super) struct Engine {
    pub(super) port: u16,
    log: Arc<Mutex<Vec<Sent>>>,
    replies: Arc<Mutex<VecDeque<Reply>>>,
    delays: Arc<Mutex<VecDeque<Duration>>>,
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Engine {
    pub(super) fn start(dir: &Path) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let stop = Arc::new(AtomicBool::new(false));
        let log: Arc<Mutex<Vec<Sent>>> = Arc::new(Mutex::new(Vec::new()));
        let replies = Arc::new(Mutex::new(VecDeque::new()));
        let delays = Arc::new(Mutex::new(VecDeque::new()));
        let handle = {
            let stop = Arc::clone(&stop);
            let log = Arc::clone(&log);
            let replies = Arc::clone(&replies);
            let delays = Arc::clone(&delays);
            let dir = dir.to_path_buf();
            thread::spawn(move || {
                listener.set_nonblocking(true).unwrap();
                while !stop.load(Ordering::SeqCst) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            let log = Arc::clone(&log);
                            let replies = Arc::clone(&replies);
                            let delays = Arc::clone(&delays);
                            let dir = dir.clone();
                            // One thread per connection: a held answer must
                            // not stop the next request from arriving, which
                            // is exactly what the gate test needs.
                            thread::spawn(move || answer(stream, log, replies, delays, dir));
                        }
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(2))
                        }
                        Err(_) => return,
                    }
                }
            })
        };
        Self {
            port,
            log,
            replies,
            delays,
            stop,
            handle: Some(handle),
        }
    }

    pub(super) fn sent(&self) -> Vec<Sent> {
        self.log.lock().unwrap().clone()
    }

    /// Queues the answers the next requests get, in order.
    pub(super) fn reply(&self, replies: impl IntoIterator<Item = Reply>) {
        self.replies.lock().unwrap().extend(replies);
    }

    /// Holds the next request open for this long, after recording it.
    pub(super) fn delay(&self, delay: Duration) {
        self.delays.lock().unwrap().push_back(delay);
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn answer(
    mut stream: TcpStream,
    log: Arc<Mutex<Vec<Sent>>>,
    replies: Arc<Mutex<VecDeque<Reply>>>,
    delays: Arc<Mutex<VecDeque<Duration>>>,
    dir: PathBuf,
) {
    stream.set_nonblocking(false).unwrap();
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut head = Vec::new();
    if read_until(&mut stream, b"\r\n\r\n", &mut head).is_err() {
        return;
    }
    let length: usize = header_values(&head, "content-length")
        .first()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let mut body = vec![0u8; length];
    if stream.read_exact(&mut body).is_err() {
        return;
    }
    let body = String::from_utf8_lossy(&body).to_string();
    let target = String::from_utf8_lossy(&head)
        .split(' ')
        .nth(1)
        .unwrap_or_default()
        .to_string();
    let sent = Sent {
        action: target.split("action=").nth(1).unwrap_or_default().to_string(),
        slot: header_values(&head, "x-kalsa-slot")
            .first()
            .cloned()
            .unwrap_or_default(),
        salt: header_values(&head, "x-kalsa-cache-salt")
            .first()
            .cloned()
            .unwrap_or_default(),
        // The engine parses this field out of the body; a request without one
        // (erase) has no name at all.
        filename: body
            .split("\"filename\":\"")
            .nth(1)
            .and_then(|rest| rest.split('"').next())
            .unwrap_or_default()
            .to_string(),
    };
    log.lock().unwrap().push(sent.clone());
    let reply = replies.lock().unwrap().pop_front().unwrap_or(Reply::Answered(1));
    let delay = delays.lock().unwrap().pop_front().unwrap_or_default();
    if !delay.is_zero() {
        thread::sleep(delay);
    }
    // A save writes the state it is reporting, and a refused save writes
    // nothing at all: an empty slot is a file whose state holds no token,
    // which is why renaming it over a real one is destructive. `Unreachable`
    // writes it too and then loses the answer: the save whose staging file is
    // on disk with nobody told about it, which is the accumulation to catch.
    if sent.action == "save" && !matches!(reply, Reply::Refused) {
        let tokens = match reply {
            Reply::Answered(tokens) => tokens,
            _ => 1,
        };
        let _ = fs::write(dir.join(&sent.filename), format!("state:{tokens}:{}", sent.filename));
    }
    let (status, body) = match reply {
        Reply::Answered(tokens) => {
            let field = if sent.action == "restore" { "n_restored" } else { "n_saved" };
            (
                "200 OK",
                format!("{{\"id_slot\":{},\"{field}\":{tokens}}}", sent.slot),
            )
        }
        Reply::Refused => (
            "400 Bad Request",
            "{\"error\":{\"message\":\"Unable to restore slot\"}}".to_string(),
        ),
        // No answer at all: the door's call is `Unreachable`.
        Reply::Unreachable => return,
    };
    let _ = stream.write_all(
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n\
             Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .as_bytes(),
    );
}

/// A directory of the test's own, under the system's temp root: the crate has
/// no dependency that makes one, and the door only ever names files inside it.
pub(super) fn temp_dir(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("kalsa-door-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).unwrap();
    path
}

/// A started door, with the tier configured as the app configures it.
pub(super) fn door_of(
    engine_port: u16,
    slot_dir: Option<&Path>,
    hash: Option<&str>,
    tokens: &[&str],
) -> (RunningDoor, SocketAddr) {
    door_with(engine_port, slot_dir, hash, tokens, None)
}

/// The same door with the tier's clock wired: the cadence tests need to sleep
/// through the interval, and the shipped one is derived from a 300 s unload
/// clock.
pub(super) fn door_of_with_save(
    engine_port: u16,
    slot_dir: &Path,
    hash: &str,
    tokens: &[&str],
    idle_save: Duration,
) -> (RunningDoor, SocketAddr) {
    door_with(engine_port, Some(slot_dir), Some(hash), tokens, Some(idle_save))
}

fn door_with(
    engine_port: u16,
    slot_dir: Option<&Path>,
    hash: Option<&str>,
    tokens: &[&str],
    idle_save: Option<Duration>,
) -> (RunningDoor, SocketAddr) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let mut door = Door::new_with_engine(
        listener,
        engine_port,
        door_devices(tokens),
        4,
        EnginePrivateHeaders::Consumed,
    )
    .unwrap();
    if let Some(hash) = hash {
        door = door.with_model_hash(hash).unwrap();
    }
    if let Some(slot_dir) = slot_dir {
        door = door.with_slot_dir(slot_dir.to_path_buf());
    }
    if let Some(idle_save) = idle_save {
        door = door.with_idle_save(idle_save);
    }
    (door.start().unwrap(), address)
}

pub(super) fn post(
    address: SocketAddr,
    token: Option<&str>,
    path: &str,
    body: &str,
) -> Vec<u8> {
    let auth = token
        .map(|token| format!("Authorization: Bearer {token}\r\n"))
        .unwrap_or_default();
    let mut client = TcpStream::connect(address).unwrap();
    client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    write!(
        client,
        "POST {path} HTTP/1.1\r\nHost: localhost\r\n{auth}Origin: tauri://localhost\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .unwrap();
    client.shutdown(Shutdown::Write).unwrap();
    let mut response = Vec::new();
    client.read_to_end(&mut response).unwrap();
    response
}

pub(super) fn activate(address: SocketAddr, token: Option<&str>, id: &str) -> Vec<u8> {
    post(address, token, "/kalsa/chat/activate", &format!("{{\"id\":\"{id}\"}}"))
}

pub(super) fn erase(address: SocketAddr, token: Option<&str>, id: &str) -> Vec<u8> {
    post(address, token, "/kalsa/chat/erase", &format!("{{\"id\":\"{id}\"}}"))
}

pub(super) fn status_of(response: &[u8]) -> u16 {
    String::from_utf8_lossy(response)
        .split(' ')
        .nth(1)
        .and_then(|code| code.parse().ok())
        .unwrap_or_default()
}

pub(super) fn body_text(response: &[u8]) -> String {
    let text = String::from_utf8_lossy(response).to_string();
    text.split_once("\r\n\r\n").map(|(_, body)| body.to_string()).unwrap_or_default()
}

/// The name the door must build for device 0.
pub(super) fn file_name(id: &str) -> String {
    format!("d0-m{HASH}-c{id}.bin")
}

pub(super) fn salt_of(token: &str) -> String {
    let devices = door_devices(&[token]);
    let salt = devices.cache_salt(DeviceId::new(0)).unwrap().to_owned();
    salt.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Waits until the engine has recorded this many requests.
pub(super) fn wait_for(engine: &Engine, count: usize) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while engine.sent().len() < count && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(2));
    }
    assert_eq!(engine.sent().len(), count, "the engine never saw the request");
}

