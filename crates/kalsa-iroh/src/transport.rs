//! The iroh boundary — the only file in this crate allowed to name `iroh::`.
//!
//! HOW TO UPGRADE IROH: (1) change the exact pin `iroh = "=…"` in this
//! crate's Cargo.toml to the new version; (2) run `cargo build -p
//! kalsa-iroh` and then `cargo test -p kalsa-iroh --test roundtrip` — that
//! test is the acceptance gate (two endpoints, a full HTTP round trip
//! through a real door, deadlines that fire); (3) expect breakage HERE
//! first, and only here: a changed upstream API surfaces as compile errors
//! confined to this file, because no other file, and no public signature of
//! `kalsa-iroh`, may name an iroh type. After a bump, re-read the deadline
//! code below with suspicion: the pinned iroh dials and reads that block
//! indefinitely are exactly the behavior most likely to change shape
//! without breaking the compiler.
//!
//! Everything exported from here speaks the crate's own language —
//! [`NodeId`], [`BridgeError`], [`TunnelStream`] — even though the
//! definitions live beside iroh's types. `AddressBook` is the one honest
//! seam: iroh resolves a bare 32-byte node id through address-lookup
//! services, production uses the n0 DNS road via `presets::N0`, and this
//! in-process book lets two endpoints on one machine resolve each other
//! without touching any network — which is what the round-trip test needs.

use std::net::SocketAddr;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;

use iroh::address_lookup::memory::MemoryLookup;
use iroh::endpoint::presets;
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMap, RelayMode, RelayUrl, SecretKey, TransportAddr};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::time::timeout_at;

use crate::bridge::RelayChoice;
use crate::error::BridgeError;
use crate::key::{NodeId, NodeKey};
use crate::pump;

/// The application protocol tag of this tunnel. Bump when the framing
/// changes; iroh refuses peers that do not answer this ALPN.
const ALPN: &[u8] = b"kalsa/door-tunnel/1";

/// The crate's hex-form node id, as the transport's key type. Fallible
/// because the transport re-checks the ed25519 curve point: 32 arbitrary
/// bytes off a mistyped square need not be one.
pub(crate) fn endpoint_id(id: &NodeId) -> Result<EndpointId, BridgeError> {
    EndpointId::from_bytes(&id.to_bytes())
        .map_err(|_| BridgeError::Transport("node id is not a valid public key".into()))
}

/// The id a key would announce, without binding an endpoint. Test-only:
/// minting a valid stranger id for the deadline test.
#[cfg(test)]
pub(crate) fn id_of(key: &NodeKey) -> NodeId {
    let secret = SecretKey::from_bytes(&key.to_bytes());
    NodeId::from_bytes(*secret.public().as_bytes())
}

/// An in-process address book: the shared seam where endpoints register
/// their own addressing and resolve others by node id alone. Production
/// roads do not use it; the round-trip test gives one book to both of its
/// endpoints so they find each other without any network.
#[derive(Clone, Default)]
pub struct AddressBook {
    inner: MemoryLookup,
}

impl AddressBook {
    pub fn new() -> Self {
        Self {
            inner: MemoryLookup::new(),
        }
    }

    /// Register one endpoint's addressing. Direct addresses only: no relay
    /// hint is ever written, so a book entry reaches a peer on the local
    /// link or not at all.
    pub(crate) fn register(&self, id: &NodeId, address: SocketAddr) {
        let entry = EndpointAddr::new(endpoint_id(id).expect("our own ids are valid keys"))
            .with_addrs([TransportAddr::Ip(address)]);
        self.inner.add_endpoint_info(entry);
    }
}

/// One tunneled connection: the two half-streams of a QUIC connection,
/// presented as an ordinary tokio duplex. The door's HTTP flows through
/// this unchanged.
pub struct TunnelStream {
    send: iroh::endpoint::SendStream,
    recv: iroh::endpoint::RecvStream,
}

impl AsyncRead for TunnelStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        // Trait methods, spelled out: the streams also carry inherent
        // `poll_*` methods, and inherent methods shadow trait methods.
        AsyncRead::poll_read(Pin::new(&mut self.recv), cx, buf)
    }
}

impl AsyncWrite for TunnelStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        AsyncWrite::poll_write(Pin::new(&mut self.send), cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        AsyncWrite::poll_flush(Pin::new(&mut self.send), cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        AsyncWrite::poll_shutdown(Pin::new(&mut self.send), cx)
    }
}

/// A bound iroh endpoint wearing this crate's types. Cloned per role: one
/// handle stays with the [`crate::bridge::Bridge`] for dialing, one is
/// moved into the accept loop.
#[derive(Clone)]
pub(crate) struct Transport {
    endpoint: Endpoint,
}

impl Transport {
    /// Bind the endpoint under the node's persisted key. The relay choice
    /// and the address book are the caller's decisions; the ALPN and the
    /// identity are not.
    pub(crate) async fn bind(
        key: &NodeKey,
        relay: &RelayChoice,
        book: Option<&AddressBook>,
    ) -> Result<Self, BridgeError> {
        let mut builder = match relay {
            RelayChoice::N0Public | RelayChoice::Custom { .. } => Endpoint::builder(presets::N0),
            RelayChoice::Disabled => Endpoint::builder(presets::Minimal),
        };
        builder = match relay {
            RelayChoice::N0Public => builder,
            RelayChoice::Custom { url } => {
                let parsed: RelayUrl = url
                    .parse()
                    .map_err(|_| BridgeError::Config("the relay URL is not a valid URL"))?;
                builder.relay_mode(RelayMode::Custom(RelayMap::from(parsed)))
            }
            RelayChoice::Disabled => builder.relay_mode(RelayMode::Disabled),
        };
        if let Some(book) = book {
            builder = builder.address_lookup(book.inner.clone());
        }
        let endpoint = builder
            .alpns(vec![ALPN.to_vec()])
            .secret_key(SecretKey::from_bytes(&key.to_bytes()))
            .bind()
            .await
            .map_err(|e| BridgeError::Transport(e.to_string()))?;
        Ok(Self { endpoint })
    }

    pub(crate) fn node_id(&self) -> NodeId {
        NodeId::from_bytes(*self.endpoint.id().as_bytes())
    }

    /// This endpoint's current addressing, into a book that was handed to
    /// `bind`. Without a book this is nothing to do: production roads
    /// publish through iroh's own lookup services. An address the socket
    /// reports as unspecified (`0.0.0.0`) is registered as loopback: a book
    /// is an in-process fact, and a dial to `0.0.0.0` is not one.
    pub(crate) fn register_self(&self, book: Option<&AddressBook>) {
        let Some(book) = book else {
            return;
        };
        let addr = self.endpoint.addr();
        if let Some(address) = addr.addrs.iter().find_map(transport_ip) {
            let address = if address.ip().is_unspecified() {
                SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), address.port())
            } else {
                address
            };
            book.register(&self.node_id(), address);
        }
    }

    /// Open one tunneled stream to a remote node, resolved by its 32 public
    /// bytes alone. `deadline` covers the whole dial — lookup, hole
    /// punching, handshake, stream open — because iroh itself would wait
    /// indefinitely on a published-but-dead peer (measured: 25 seconds of
    /// silence and counting).
    pub(crate) async fn dial(
        &self,
        remote: &NodeId,
        deadline: Duration,
    ) -> Result<TunnelStream, BridgeError> {
        let remote = endpoint_id(remote)?;
        let overall = tokio::time::Instant::now() + deadline;
        let connection =
            match timeout_at(overall, self.endpoint.connect(remote, ALPN)).await {
            Ok(result) => result.map_err(|e| BridgeError::Transport(e.to_string()))?,
            Err(_) => return Err(BridgeError::Deadline),
        };
        let (send, recv) = match timeout_at(overall, connection.open_bi()).await {
            Ok(result) => result.map_err(|e| BridgeError::Transport(e.to_string()))?,
            Err(_) => return Err(BridgeError::Deadline),
        };
        Ok(TunnelStream { send, recv })
    }

    /// The accept loop: every accepted bidirectional stream becomes one TCP
    /// connection to the door on loopback. Runs until the endpoint closes.
    pub(crate) async fn serve(self, door: SocketAddr, dial_timeout: Duration, idle: Duration) {
        while let Some(incoming) = self.endpoint.accept().await {
            let accepting = match incoming.accept() {
                Ok(accepting) => accepting,
                Err(_) => continue,
            };
            let connection = match accepting.await {
                Ok(connection) => connection,
                Err(_) => continue,
            };
            tokio::spawn(forward_connection(connection, door, dial_timeout, idle));
        }
    }
}

fn transport_ip(addr: &TransportAddr) -> Option<SocketAddr> {
    match addr {
        TransportAddr::Ip(socket) => Some(*socket),
        _ => None,
    }
}

async fn forward_connection(
    connection: iroh::endpoint::Connection,
    door: SocketAddr,
    dial_timeout: Duration,
    idle: Duration,
) {
    loop {
        let stream = match timeout_at(
            tokio::time::Instant::now() + idle,
            connection.accept_bi(),
        )
        .await
        {
            Ok(Ok((send, recv))) => TunnelStream { send, recv },
            // Connection gone, or silent past the idle deadline: a dead
            // peer must close the tunnel, not park it.
            Ok(Err(_)) | Err(_) => return,
        };
        tokio::spawn(forward_stream(stream, door, dial_timeout, idle));
    }
}

async fn forward_stream(
    stream: TunnelStream,
    door: SocketAddr,
    dial_timeout: Duration,
    idle: Duration,
) {
    let tcp = match tokio::time::timeout(dial_timeout, tokio::net::TcpStream::connect(door)).await {
        Ok(Ok(tcp)) => tcp,
        // The door is loopback-only; failing to reach it in `dial_timeout`
        // means the door is down. The phone sees the stream close.
        Ok(Err(_)) | Err(_) => return,
    };
    let _ = pump::pump(stream, tcp, idle).await;
}
