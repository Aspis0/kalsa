//! The authenticated door in front of the local inference server.
//!
//! The caller supplies both the already-bound listener and the upstream port;
//! this crate never chooses a network interface. Construction refuses any
//! listener whose address is not loopback, so the door is safe to speak plain
//! HTTP because it never leaves this machine. Tailscale Serve supplies TLS on
//! the tailnet road, and iroh supplies QUIC confidentiality on its road; the
//! transports, not this local HTTP hop, protect traffic crossing the network.
//!
//! A bearer credential is therefore enough at this boundary: both intended
//! roads are confidential and replay-proof before they reach the door. This
//! must not be read as permission to expose the listener directly on a LAN or
//! the public Internet.
//!
//! The acceptor and queue are bounded. Each connection has one absolute
//! deadline beginning at accept, and workers relay bytes without buffering a
//! response, so SSE reaches the client as the upstream emits it.

mod proxy;
mod request;
mod server;

#[cfg(test)]
mod tests;

use std::fmt;
use std::io;
use std::net::{SocketAddr, TcpListener};
use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

const TOKEN_BYTES: usize = 64;
const WORKERS: usize = 4;
const QUEUE: usize = 8;
const MAX_CONNECTIONS: usize = WORKERS + QUEUE;
const PATIENCE: std::time::Duration = std::time::Duration::from_secs(10);
const CONNECTION_LIFETIME: std::time::Duration = std::time::Duration::from_secs(300);
const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(5);
const UNAUTHORIZED_RESPONSE: &[u8] =
    b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
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
    credential: [u8; TOKEN_BYTES],
    response_observer: Option<ResponseObserverFactory>,
}

/// The running door. Dropping it stops and joins its bounded thread set.
pub struct RunningDoor {
    stop: Arc<AtomicBool>,
    address: SocketAddr,
    active_connections: Arc<AtomicUsize>,
    threads: Mutex<Vec<JoinHandle<()>>>,
}

impl Door {
    /// Validate the caller's bound listener and retain the pairing credential.
    pub fn new(
        listener: TcpListener,
        upstream_port: u16,
        credential: String,
    ) -> Result<Self, DoorError> {
        let address = listener.local_addr().map_err(DoorError::Listener)?;
        if !address.ip().is_loopback() {
            return Err(DoorError::NonLoopback(address));
        }
        let credential = credential_bytes(&credential).ok_or(DoorError::InvalidCredential)?;
        listener
            .set_nonblocking(true)
            .map_err(DoorError::Listener)?;
        Ok(Self {
            listener,
            address,
            upstream_port,
            credential,
            response_observer: None,
        })
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

    /// Whether a client is currently being served by the door. This is a
    /// transport fact, not a guess based on whether a credential exists.
    pub fn has_active_connection(&self) -> bool {
        self.active_connections
            .load(std::sync::atomic::Ordering::SeqCst)
            > 0
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

fn credential_bytes(credential: &str) -> Option<[u8; TOKEN_BYTES]> {
    if credential.len() != TOKEN_BYTES || !credential.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let mut bytes = [0u8; TOKEN_BYTES];
    bytes.copy_from_slice(credential.as_bytes());
    Some(bytes)
}
