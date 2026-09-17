//! The authenticated door in front of the local inference server.
//!
//! The caller supplies both the already-bound listener and the upstream port;
//! this crate never chooses a network interface. Construction refuses any
//! listener whose address is not loopback, so the door is safe to speak plain
//! HTTP because it never leaves this machine. Tailscale Serve supplies TLS on
//! the tailnet road, and iroh supplies QUIC confidentiality on its road; the
//! transports, not this local HTTP hop, protect traffic crossing the network.
//!
//! A bearer credential per paired device is therefore enough at this
//! boundary: both intended roads are confidential and replay-proof before
//! they reach the door. This
//! must not be read as permission to expose the listener directly on a LAN or
//! the public Internet — with one exception, earned elsewhere: the iroh road
//! (`kalsa-iroh`) terminates its tunnel on this listener, and that road is
//! reachable by strangers. The door answers them with its short head
//! patience (`proxy`) and per-peer budgets live in the road itself; the
//! credential, not reachability, is still what opens the upstream.
//!
//! The acceptor and queue are bounded. Each connection has one absolute
//! deadline beginning at accept, and workers relay bytes without buffering a
//! response, so SSE reaches the client as the upstream emits it.
//!
//! An event-stream answer is different in one way: it becomes a job. The
//! door numbers every event (`id: <token>:<index>`, the standard SSE id the
//! client echoes back as `Last-Event-ID`) and accumulates them while the
//! generation runs, so the answer belongs to the door, not to the socket
//! that happened to ask for it. A phone that disappears mid-answer leaves
//! the generation running; when it comes back and sends its last seen id,
//! the door replays what it missed and then follows the tail live — in
//! order, without duplicates and without holes. Resuming asks for the same
//! bearer credential as everything else and the same unguessable token the
//! one device alone was shown; a job answers to the device that started it
//! and nobody else, and it dies with
//! the door that started it: no stopped server ever keeps a job promising
//! that more of an answer is coming.
//!
//! The model being released while an answer is alive is not a door event:
//! the server releases its weights only when idle, and a generating request
//! is the opposite of idle, so a release can never cut a live job. What the
//! door can observe is the upstream dying or going silent — a crash, a
//! supervisor stop, a restart behind the door — and for all of those the
//! job fails with one honest sentence, kept for the retention window so a
//! returning phone is told the truth instead of being kept waiting.

mod chunk;
mod devices;
mod jobs;
mod proxy;
mod request;
mod response;
mod registry;
mod server;
mod sse;
mod stream;
mod token;

#[cfg(test)]
mod tests;

pub use devices::{DeviceEntry, DeviceId, Devices};

use std::collections::HashMap;
use std::fmt;
use std::io;
use std::time::Duration;
use std::net::{SocketAddr, TcpListener};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

const TOKEN_BYTES: usize = 64;
const WORKERS: usize = 4;
const QUEUE: usize = 8;
const MAX_CONNECTIONS: usize = WORKERS + QUEUE;
const PATIENCE: std::time::Duration = std::time::Duration::from_secs(10);
pub(crate) const HEAD_PATIENCE: Duration = Duration::from_secs(15);
const CONNECTION_LIFETIME: std::time::Duration = std::time::Duration::from_secs(300);
const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(5);
/// How long a finished answer stays resumable after its last event. A phone
/// may be away for minutes; it is not away forever.
const JOB_RETENTION: std::time::Duration = std::time::Duration::from_secs(600);
/// Jobs alive at once, running plus kept. Running ones cannot exceed the
/// workers; this roof exists so kept answers alone can never grow without
/// bound either.
const MAX_JOBS: usize = 64;
/// The most memory one answer may accumulate. A whole completion is tens of
/// kilobytes; reaching this roof means something is wrong, and the job
/// fails loudly instead of silently dropping what it could not keep.
const MAX_JOB_BYTES: usize = 2 * 1024 * 1024;
/// How often the reaper looks for kept answers past their retention.
const REAP_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);
const UNAUTHORIZED_RESPONSE: &[u8] =
    b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
/// The answer for a connection the door never got to read: pressure, not
/// authentication, and the words must not say "unauthorized".
pub(crate) const BUSY_RESPONSE: &[u8] =
    b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const UPSTREAM_FAILURE_RESPONSE: &[u8] =
    b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

type ResponseObserver = Arc<dyn Fn(&[u8]) + Send + Sync>;
type ResponseObserverFactory = Arc<dyn Fn() -> ResponseObserver + Send + Sync>;

/// A construction failure. `NonLoopback` is separate so callers cannot turn
/// an unsafe binding into a normal I/O failure by accident.
#[derive(Debug)]
pub enum DoorError {
    Listener(io::Error),
    NonLoopback(SocketAddr),
    InvalidCredential,
    Thread(io::Error),
}

impl fmt::Display for DoorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Listener(error) => write!(f, "door listener: {error}"),
            Self::NonLoopback(address) => write!(f, "door listener is not loopback: {address}"),
            Self::InvalidCredential => f.write_str("door credential is invalid"),
            Self::Thread(error) => write!(f, "door thread: {error}"),
        }
    }
}

impl std::error::Error for DoorError {}

/// A validated, not-yet-started door.
pub struct Door {
    listener: TcpListener,
    address: SocketAddr,
    upstream_port: u16,
    devices: Arc<Devices>,
    head_patience: Duration,
    response_observer: Option<ResponseObserverFactory>,
}

/// The devices with a connection currently being served. Presence, not
/// history: a device is counted once per connection, exactly while the door
/// is inside its request. Ids only — a credential never comes near this,
/// and there is deliberately no `Debug`.
pub(crate) struct ActiveDevices {
    counts: Mutex<HashMap<DeviceId, usize>>,
}

impl ActiveDevices {
    pub(crate) fn new() -> Self {
        Self {
            counts: Mutex::new(HashMap::new()),
        }
    }

    /// Marks the device active until the returned guard drops — on the
    /// request's every ending path, an unwind included.
    pub(crate) fn enter(&self, device: DeviceId) -> ActiveGuard<'_> {
        *self.lock().entry(device).or_insert(0) += 1;
        ActiveGuard { devices: self, device }
    }

    /// The active devices, smallest id first: a list the reader can render
    /// without being handed whatever order a hash map keeps.
    pub(crate) fn snapshot(&self) -> Vec<DeviceId> {
        let mut ids: Vec<DeviceId> = self.lock().keys().copied().collect();
        ids.sort();
        ids
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<DeviceId, usize>> {
        self.counts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub(crate) struct ActiveGuard<'a> {
    devices: &'a ActiveDevices,
    device: DeviceId,
}

impl Drop for ActiveGuard<'_> {
    fn drop(&mut self) {
        let mut counts = self.devices.lock();
        if let Some(count) = counts.get_mut(&self.device) {
            *count -= 1;
            if *count == 0 {
                counts.remove(&self.device);
            }
        }
    }
}

/// The running door. Dropping it stops and joins its bounded thread set.
pub struct RunningDoor {
    stop: Arc<AtomicBool>,
    address: SocketAddr,
    active: Arc<ActiveDevices>,
    threads: Mutex<Vec<JoinHandle<()>>>,
}

impl Door {
    /// Validate the caller's bound listener and retain the set of paired
    /// devices. The set already validated itself when it was built; the
    /// door does not know where it came from and never changes it.
    pub fn new(listener: TcpListener, upstream_port: u16, devices: Devices) -> Result<Self, DoorError> {
        let address = listener.local_addr().map_err(DoorError::Listener)?;
        if !address.ip().is_loopback() {
            return Err(DoorError::NonLoopback(address));
        }
        listener
            .set_nonblocking(true)
            .map_err(DoorError::Listener)?;
        Ok(Self {
            listener,
            address,
            upstream_port,
            devices: Arc::new(devices),
            head_patience: HEAD_PATIENCE,
            response_observer: None,
        })
    }

    /// Replace how long a worker waits for a complete request head before
    /// taking the connection off its slot. Production keeps the default;
    /// tests shrink it, the way they shrink the tunnel's deadlines.
    pub fn with_head_patience(mut self, head_patience: Duration) -> Self {
        self.head_patience = head_patience;
        self
    }

    /// Build a per-connection observer for response bytes after forwarding.
    /// Each observer must stay small and incremental: the door never buffers
    /// an SSE body and separate responses never share parser state.
    pub fn with_response_observer<F, O>(mut self, factory: F) -> Self
    where
        F: Fn() -> O + Send + Sync + 'static,
        O: Fn(&[u8]) + Send + Sync + 'static,
    {
        self.response_observer = Some(Arc::new(move || Arc::new(factory()) as ResponseObserver));
        self
    }

    /// Start the acceptor and its fixed worker pool.
    pub fn start(self) -> Result<RunningDoor, DoorError> {
        server::start(self)
    }
}

impl RunningDoor {
    /// The address the handed-in listener actually bound. Callers use this
    /// value to configure the outer transport; it is never reconstructed from
    /// a preferred port or an address remembered before binding.
    pub fn address(&self) -> SocketAddr {
        self.address
    }

    /// Which devices currently have a connection being served, smallest id
    /// first. This is a transport fact, not a guess based on whether a
    /// credential exists; who the devices are is the app's translation.
    pub fn active_devices(&self) -> Vec<DeviceId> {
        self.active.snapshot()
    }

    /// Stop accepting and wait for the bounded thread set to leave.
    pub fn shutdown(&self) {
        self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        let threads = self
            .threads
            .lock()
            .ok()
            .map(|mut threads| std::mem::take(&mut *threads));
        if let Some(threads) = threads {
            for thread in threads {
                let _ = thread.join();
            }
        }
    }
}

impl Drop for RunningDoor {
    fn drop(&mut self) {
        self.shutdown();
    }
}
