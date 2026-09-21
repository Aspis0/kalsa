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
//! The door also serves two routes of its own, under `/kalsa/`: opening one of
//! a device's chats and erasing one. They are not a passthrough — the engine's
//! own `/slots` routes stay refused to every client — so that a client names a
//! conversation and the door, which owns the device-to-slot map, names the file
//! and holds the slot for the whole save/restore (`paging`).
//!
//! The model being released while an answer is alive is not a door event:
//! the server releases its weights only when idle, and a generating request
//! is the opposite of idle, so a release can never cut a live job. What the
//! door can observe is the upstream dying or going silent — a crash, a
//! supervisor stop, a restart behind the door — and for all of those the
//! job fails with one honest sentence, kept for the retention window so a
//! returning phone is told the truth instead of being kept waiting.

mod chunk;
mod cors;
mod devices;
mod engine;
mod jobs;
mod paging;
mod payload;
mod proxy;
mod request;
mod response;
mod registry;
mod server;
mod slot_routes;
mod slots;
mod sse;
mod stream;
mod token;

#[cfg(test)]
mod tests;

pub use devices::{DeviceEntry, DeviceId, Devices};
pub use slots::EnginePrivateHeaders;
pub(crate) use slots::{DeviceSet, LeaseError};

use std::collections::HashMap;
use std::fmt;
use std::io;
use std::path::PathBuf;
use std::time::{Duration, Instant};
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
/// The refusal: an empty body whose length says so, and the origin headers
/// for the origin it was asked from when that origin is one the desktop can
/// have — a browser that cannot read the refusal is told the request failed
/// at the network, which is not what happened and is not something the app
/// can act on.
pub(crate) fn unauthorized_response(origin: Option<&[u8]>) -> Vec<u8> {
    let origin_headers = cors::origin_headers(origin);
    format!(
        "HTTP/1.1 401 Unauthorized\r\n{origin_headers}Content-Length: 0\r\nConnection: close\r\n\r\n"
    )
    .into_bytes()
}
/// The answer for a connection the door never got to read: pressure, not
/// authentication, and the words must not say "unauthorized". It is the one
/// answer that stays a constant, because it is written before any head exists
/// — there is no origin to name and nothing in it can vary by one. The same
/// answer for a request whose head WAS read is [`busy_response`].
pub(crate) const BUSY_RESPONSE: &[u8] =
    b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

/// The same answer as [`BUSY_RESPONSE`] for a request the door has already
/// read: every job slot holds an answer that has not finished, so no answer
/// can start. The same status and the same empty body; the origin headers are
/// on it because this one is written with the request's head in hand.
pub(crate) fn busy_response(origin: Option<&[u8]>) -> Vec<u8> {
    let origin_headers = cors::origin_headers(origin);
    format!(
        "HTTP/1.1 503 Service Unavailable\r\n{origin_headers}Content-Length: 0\r\nConnection: close\r\n\r\n"
    )
    .into_bytes()
}

/// The answer for an authenticated device with no slot left: the engine runs
/// a fixed number of slots, so this computer is already holding as many
/// devices as the launch planned for. It is the door's own 503, with the
/// count and one honest sentence — deliberately not [`BUSY_RESPONSE`] (which
/// carries no body and means pressure) and deliberately not `refuse` (which
/// is 401-only, for a credential the door does not know). Like the refusal,
/// it names the browser's origin when there is one.
///
/// The words name BOTH causes, because the door cannot tell them apart: the
/// set stored on disk may hold more devices than the launch funded seats for,
/// or a device may have been stored after the launch, so the engine's slot
/// count is behind the store. Restarting re-plans the seats from the devices
/// stored NOW, which answers the second cause and not the first; the first is
/// answered only by funding more seats (a lower context in Advanced) or by
/// storing fewer devices. "This computer is one of them" is in the count
/// rather than apart from it, because the host is a device now and a sentence
/// that forgot it would tell the owner to forget a phone when the seat this
/// computer holds is the one in question.
pub(crate) fn no_slot_response(capacity: u32, origin: Option<&[u8]>) -> Vec<u8> {
    // "1 devices" is the kind of thing that makes a sentence read like a
    // machine wrote it, and this one is the whole answer a phone will see.
    let seats = if capacity == 1 {
        "1 device".to_string()
    } else {
        format!("{capacity} devices")
    };
    let words = format!(
        "This computer is set up for {seats} at once, and one of them is this computer. Every \
         seat is taken. Turning the assistant off and on again re-plans the seats from the \
         devices stored now; if it still cannot fund one seat per stored device, lower the \
         context in Advanced, or forget a device on the Devices page."
    );
    let origin_headers = cors::origin_headers(origin);
    format!(
        "HTTP/1.1 503 Service Unavailable\r\n{origin_headers}\
         Content-Type: text/plain; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{words}",
        words.len()
    )
    .into_bytes()
}
/// The upstream the door could not reach, answered rather than left hanging —
/// and answered after the head was read, so this one names the origin too.
pub(crate) fn upstream_failure_response(origin: Option<&[u8]>) -> Vec<u8> {
    let origin_headers = cors::origin_headers(origin);
    format!(
        "HTTP/1.1 502 Bad Gateway\r\n{origin_headers}Content-Length: 0\r\nConnection: close\r\n\r\n"
    )
    .into_bytes()
}

type ResponseObserver = Arc<dyn Fn(&[u8]) + Send + Sync>;
type ResponseObserverFactory = Arc<dyn Fn() -> ResponseObserver + Send + Sync>;

/// A construction failure. `NonLoopback` is separate so callers cannot turn
/// an unsafe binding into a normal I/O failure by accident.
#[derive(Debug)]
pub enum DoorError {
    Listener(io::Error),
    NonLoopback(SocketAddr),
    InvalidCredential,
    /// A door that can serve nobody: `capacity` was zero.
    CapacityZero,
    /// `capacity > 1` was asked for without an engine declared to read the
    /// door's private headers. Fail loudly: silently serving more devices
    /// than the engine can keep apart is the wrap this door exists to stop.
    CapacityWithoutHeaderSupport { capacity: u32 },
    /// The upstream the door was told to forward to is the port it listens
    /// on: every request would forward to itself, with no error line, until
    /// the worker and queue budgets saturate. Refused where the argument is
    /// still in hand.
    UpstreamIsListener { port: u16 },
    /// The model identity the disk tier names its files by is not eight
    /// lowercase hex characters. The value is deliberately not carried in the
    /// error: the caller meant to hand over a digest, and a malformed one may
    /// be something else entirely.
    InvalidModelHash,
    Thread(io::Error),
}

impl fmt::Display for DoorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Listener(error) => write!(f, "door listener: {error}"),
            Self::NonLoopback(address) => write!(f, "door listener is not loopback: {address}"),
            Self::InvalidCredential => f.write_str("door credential is invalid"),
            Self::CapacityZero => f.write_str("door capacity must be at least one"),
            Self::CapacityWithoutHeaderSupport { capacity } => write!(
                f,
                "door capacity {capacity} needs an engine that reads \
                 X-Kalsa-Slot and X-Kalsa-Cache-Salt"
            ),
            Self::UpstreamIsListener { port } => write!(
                f,
                "door upstream port {port} is the port the door listens on"
            ),
            Self::InvalidModelHash => f.write_str("door model hash is not 8 hex characters"),
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
    devices: Arc<DeviceSet>,
    /// How many devices the engine can serve at once. The same value as the
    /// `--parallel` the launcher renders, passed through as data: the door
    /// never derives it from the set, the count, or anything else.
    capacity: u32,
    head_patience: Duration,
    /// The disk tier's two halves, both the app's to supply and both absent
    /// until it does: the model identity a saved chat's name carries and the
    /// directory the engine writes into. A door without them serves every
    /// route it always did and refuses the two chat routes with a spoken
    /// reason, never in silence.
    model_hash: Option<String>,
    slot_dir: Option<PathBuf>,
    /// The tier's clock: how quiet a dirty slot has to be before the app's tick
    /// writes it out, derived by the app from the unload clock the engine was
    /// launched with (`kalsa_launch::idle_save_seconds`). Absent, the tier
    /// saves on a switch and never on a timer.
    idle_save: Option<Duration>,
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
    devices: Arc<DeviceSet>,
    active: Arc<ActiveDevices>,
    /// The disk tier's own state, and the port the engine listens on: the
    /// timed save calls the engine as the door does, so both come from the
    /// door that was started, never from a caller and never from a constant.
    chats: Arc<paging::Chats>,
    upstream_port: u16,
    threads: Mutex<Vec<JoinHandle<()>>>,
}

impl Door {
    /// Validate the caller's bound listener and retain the set of paired
    /// devices. The set already validated itself when it was built; the
    /// door does not know where it came from, and the running door's set
    /// changes only through [`RunningDoor::set_devices`].
    ///
    /// No engine is declared, so this door serves exactly one device:
    /// `capacity > 1` is refused loudly rather than served silently. A
    /// caller whose engine reads the private headers uses
    /// [`Door::new_with_engine`].
    pub fn new(
        listener: TcpListener,
        upstream_port: u16,
        devices: Devices,
        capacity: u32,
    ) -> Result<Self, DoorError> {
        Self::new_with_engine(
            listener,
            upstream_port,
            devices,
            capacity,
            EnginePrivateHeaders::NotConsumed,
        )
    }

    /// The door with an explicit engine declaration. `capacity > 1` is
    /// refused unless the engine is declared to read the door's private
    /// headers: against an engine that ignores them, more than one device is
    /// auto-scheduled into the same slot, and the door would be promising an
    /// isolation the engine does not provide. The refusal is an error at
    /// construction — fail loudly, never in silence.
    pub fn new_with_engine(
        listener: TcpListener,
        upstream_port: u16,
        devices: Devices,
        capacity: u32,
        engine: EnginePrivateHeaders,
    ) -> Result<Self, DoorError> {
        if capacity == 0 {
            return Err(DoorError::CapacityZero);
        }
        if capacity > 1 && engine != EnginePrivateHeaders::Consumed {
            return Err(DoorError::CapacityWithoutHeaderSupport { capacity });
        }
        let address = listener.local_addr().map_err(DoorError::Listener)?;
        if !address.ip().is_loopback() {
            return Err(DoorError::NonLoopback(address));
        }
        if upstream_port == address.port() {
            return Err(DoorError::UpstreamIsListener { port: upstream_port });
        }
        listener
            .set_nonblocking(true)
            .map_err(DoorError::Listener)?;
        Ok(Self {
            listener,
            address,
            upstream_port,
            devices: Arc::new(DeviceSet::new(devices, capacity)),
            capacity,
            head_patience: HEAD_PATIENCE,
            model_hash: None,
            slot_dir: None,
            idle_save: None,
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

    /// The model identity the disk tier names a chat's file by: the first
    /// eight hex characters of the catalog row's pinned sha256, which the app
    /// has — the digest the download verified — and the door does not, because
    /// `kalsa-catalog` is a dev-dependency here. Refused unless it is exactly
    /// that: a name built from a hash the app did not mean would be a name no
    /// later launch could find again.
    pub fn with_model_hash(mut self, hash8: &str) -> Result<Self, DoorError> {
        let hex = |byte: u8| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte);
        if hash8.len() != 8 || !hash8.bytes().all(hex) {
            return Err(DoorError::InvalidModelHash);
        }
        self.model_hash = Some(hash8.to_string());
        Ok(self)
    }

    /// The directory the engine was launched with (`--slot-save-path`), which
    /// is where the disk tier keeps a chat and where the engine is told to
    /// write one. The door does not create or check it: the app does, before
    /// the launch, and a directory that is not there fails the first action
    /// loudly rather than silently.
    pub fn with_slot_dir(mut self, dir: PathBuf) -> Self {
        self.slot_dir = Some(dir);
        self
    }

    /// The quiet a dirty slot is allowed before the tick writes it out. It is
    /// the app's to derive, because the unload clock is the app's to set: a
    /// fixed interval would lose the turn of every device whose owner lowered
    /// the clock below it, and the point of this timer is that it always fires
    /// first.
    pub fn with_idle_save(mut self, idle_save: Duration) -> Self {
        self.idle_save = Some(idle_save);
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

    /// Writes out every slot that a completion has changed since it was last
    /// saved, and answers how many were written. This is the tier's second
    /// trigger, and it is what an unload cannot take away: the engine releases
    /// the slot — and the state in it — after `--sleep-idle-seconds` idle, so
    /// a turn that no switch ever saved would go with the release. The caller
    /// owns the clock and it must be shorter than that one; the door owns the
    /// save, because the door owns the slot, the device and the salt.
    ///
    /// The call is in-process, not a route: no client asks for it, no HTTP
    /// head carries it, and the residency — which the caller never says — is
    /// the door's own map. A slot that is clean, empty or `Unknown` is not
    /// touched, and a save the engine refuses is simply still owed.
    ///
    /// `now` is the tick's own instant. It is passed in rather than read here
    /// so the caller's clock is the only one that decides, which is what lets
    /// a test prove "the quiet has not lasted" without sleeping.
    pub fn save_idle(&self, now: Instant) -> usize {
        self.chats.save_idle(&self.devices, self.upstream_port, now)
    }

    /// What the app's tick calls when the supervisor says the engine no longer
    /// holds what the map may claim: its model was released, or the server
    /// died announcing nothing. Every `Resident` slot becomes `Unknown`, and
    /// that is what makes the next activation restore from disk instead of
    /// no-oping against a released model.
    ///
    /// Observed on the ticker's thread, not by `brain_state`: that command is
    /// polled by the webview, and with no poll nobody would ever invalidate —
    /// the door, the map and the timer would outlive the engine.
    pub fn invalidate_residency(&self) {
        self.chats.invalidate_residency();
    }

    /// Replaces the credential set without stopping anything: the listener
    /// stays bound, the workers keep serving, the road never notices.
    ///
    /// The two sides of the swap are not symmetric, on purpose. Adding a
    /// device disturbs nobody — the next request from it authenticates, and
    /// every exchange already in flight keeps its bytes. Removing a device
    /// revokes it: every later request is refused outright, and an exchange
    /// of the revoked device that is mid-flight right now is CUT at the
    /// next relay check. The owner's forget outranks the tail of an answer
    /// the device streamed for before it was revoked; the alternative —
    /// letting a revoked credential pull the rest of its answer — is the
    /// one outcome revocation cannot mean.
    pub fn set_devices(&self, devices: Devices) {
        self.devices.swap(devices);
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
