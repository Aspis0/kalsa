//! The public face of the crate: a bridge between one iroh endpoint and the
//! loopback door.
//!
//! The bridge is the whole production story in one type. `Bridge::start`
//! loads (or mints) the node's key beside the pairing file, binds the
//! endpoint, and starts the accept loop that forwards every accepted stream
//! to the door on `127.0.0.1`. `node_id` hands back the 32 public bytes the
//! pairing square carries. `connect` is the same road from the other side —
//! dialing a peer by its 32 public bytes alone, under a deadline. Nothing
//! here, in any signature, mentions the transport underneath; that is the
//! one-file rule this crate exists to keep.
//!
//! Two deadlines own this crate's behavior, because iroh does not supply
//! any: the dial deadline (a published-but-dead peer blocks the transport
//! for 25 seconds and more without erroring) and the idle deadline (a peer
//! killed mid-stream leaves reads silent for 12 seconds and more). Both
//! defaults are deliberately tighter than the measurements, and both are
//! the caller's to tune through [`BridgeConfig`].

use std::net::SocketAddr;
use std::path::Path;
use std::time::Duration;

use tokio::task::JoinHandle;

use crate::error::BridgeError;
use crate::key::{NodeId, NodeKey};
use crate::transport::{AddressBook, TunnelStream, Transport};

/// Which relay servers may carry the tunnel's ciphertext when hole punching
/// fails. The relay never sees plaintext — it forwards QUIC packets it
/// cannot read — but it is still infrastructure someone operates, so the
/// choice stays with the caller.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum RelayChoice {
    /// n0's public relays, together with the n0 DNS address lookup that
    /// resolves a bare node id. The road that works on day one.
    #[default]
    N0Public,
    /// Our own relay, at this URL, for when the product outgrows n0's.
    /// Address lookup stays on the n0 DNS road.
    Custom { url: String },
    /// No relay at all: direct paths only. Enough for a phone on the same
    /// LAN as its computer; the round-trip test runs this way too.
    Disabled,
}

/// Everything a bridge needs that is not a secret or a socket.
pub struct BridgeConfig {
    door: SocketAddr,
    dial_timeout: Duration,
    idle_timeout: Duration,
    relay: RelayChoice,
    book: Option<AddressBook>,
}

impl BridgeConfig {
    /// A config toward a door address, with the measured defaults: dial
    /// bounded well under iroh's natural 25-second stall, idle well under
    /// its natural 12-second-plus silence.
    pub fn new(door: SocketAddr) -> Self {
        Self {
            door,
            dial_timeout: Duration::from_secs(10),
            idle_timeout: Duration::from_secs(30),
            relay: RelayChoice::default(),
            book: None,
        }
    }

    /// Replace the dial deadline (lookup, hole punching, handshake, stream).
    pub fn with_dial_timeout(mut self, dial_timeout: Duration) -> Self {
        self.dial_timeout = dial_timeout;
        self
    }

    /// Replace the idle deadline: silence longer than this on any tunnel
    /// read or write closes the stream instead of parking it.
    pub fn with_idle_timeout(mut self, idle_timeout: Duration) -> Self {
        self.idle_timeout = idle_timeout;
        self
    }

    /// Replace the relay choice.
    pub fn with_relay(mut self, relay: RelayChoice) -> Self {
        self.relay = relay;
        self
    }

    /// Resolve node ids through this in-process book instead of a network.
    /// Production roads leave it unset; the round-trip test gives one book
    /// to both of its endpoints.
    pub fn with_address_book(mut self, book: AddressBook) -> Self {
        self.book = Some(book);
        self
    }
}

/// The running bridge: the accept loop toward the door, and the dialing
/// road back out. Dropping it stops the loop and closes the endpoint; in a
/// server whose lifetime is the process, that Drop is the safety net an
/// assert in a test once needed.
pub struct Bridge {
    transport: Transport,
    accept_loop: JoinHandle<()>,
    node_id: NodeId,
    dial_timeout: Duration,
}

impl Bridge {
    /// Load or mint the node key at `key_path` (its parent directory must
    /// exist; put it beside the pairing file), bind the endpoint, and start
    /// the accept loop forwarding to the door.
    pub async fn start(config: BridgeConfig, key_path: &Path) -> Result<Self, BridgeError> {
        let key = NodeKey::load_or_create(key_path)?;
        Self::start_with_key(config, &key).await
    }

    /// Start from an already-loaded key: the round-trip test mints keys in
    /// memory, and a future caller may hold the key in hand.
    pub async fn start_with_key(config: BridgeConfig, key: &NodeKey) -> Result<Self, BridgeError> {
        if !config.door.ip().is_loopback() {
            return Err(BridgeError::Config(
                "the door address must be loopback: the tunnel is the confidentiality boundary, \
                 not the door",
            ));
        }
        let transport = Transport::bind(key, &config.relay, config.book.as_ref()).await?;
        transport.register_self(config.book.as_ref());
        let node_id = transport.node_id();
        let (door, dial_timeout, idle_timeout) =
            (config.door, config.dial_timeout, config.idle_timeout);
        let loop_transport = transport.clone();
        let accept_loop = tokio::spawn(async move {
            loop_transport.serve(door, dial_timeout, idle_timeout).await;
        });
        Ok(Self {
            transport,
            accept_loop,
            node_id,
            dial_timeout,
        })
    }

    /// The node's public identity, hex — the string the pairing square
    /// carries so the phone can dial this computer by key alone.
    pub fn node_id(&self) -> NodeId {
        self.node_id
    }

    /// One tunneled stream to `remote`, resolved from its 32 public bytes
    /// alone, under the dial deadline. Reads and writes on the returned
    /// stream carry the idle deadline.
    pub async fn connect(&self, remote: NodeId) -> Result<TunnelStream, BridgeError> {
        self.transport.dial(&remote, self.dial_timeout).await
    }

    /// Stop accepting and close the endpoint. Idempotent.
    pub fn shutdown(&self) {
        self.accept_loop.abort();
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests;
