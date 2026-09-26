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

use std::collections::HashMap;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::Duration;

use iroh::address_lookup::{memory::MemoryLookup, DnsAddressLookup, PkarrResolver};
use iroh::endpoint::{presets, Builder, TransportAddrUsage};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMap, RelayMode, RelayUrl, SecretKey, TransportAddr};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::time::timeout_at;

use crate::bridge::{Lane, RelayChoice};
use crate::error::BridgeError;
use crate::key::{NodeId, NodeKey};
use crate::pump;

/// The application protocol tag of this tunnel. Bump when the framing
/// changes; iroh refuses peers that do not answer this ALPN.
const ALPN: &[u8] = b"kalsa/door-tunnel/1";

/// The desk's tag, negotiated on its own connections. One QUIC connection
/// carries exactly one ALPN, which makes this tag the routing between the
/// two loopback services — the lanes cannot cross inside one endpoint.
const DESK_ALPN: &[u8] = b"kalsa/pair-desk/1";

/// How many tunneled streams one remote peer may hold toward the door at
/// the same time. Stated honestly, this ceiling does NOT close the threat
/// it aims at: the node id is public and a new identity costs nothing, so
/// an attacker simply mints several — six identities at two streams each
/// still fill the door's twelve slots. It also counts streams, not
/// connections, which an attacker opens freely. What it buys is a cost
/// multiple (roughly six times more identities and bookkeeping to hold
/// every slot) and a guarantee that ONE peer cannot alone take the whole
/// queue. The closure is the pairing allowlist: when the phone side
/// exists and the square carries the paired node id, the accept path will
/// refuse every peer that is not on it — until then, this ceiling and the
/// door's short head patience are what holds.
pub const STREAMS_PER_PEER: usize = 2;

/// The in-flight stream count per remote peer.
#[derive(Clone, Default)]
pub(crate) struct PeerBudgets {
    in_flight: Arc<Mutex<HashMap<NodeId, usize>>>,
}

impl PeerBudgets {
    /// One stream's worth of a peer's budget, or none when the peer is at
    /// its ceiling — the stream is then dropped unopened toward its target,
    /// which from the phone is a tunnel that closes at once.
    fn acquire(&self, peer: &NodeId) -> Option<StreamPermit> {
        let mut in_flight = self.in_flight.lock().ok()?;
        let held = in_flight.entry(*peer).or_insert(0);
        if *held >= STREAMS_PER_PEER {
            return None;
        }
        *held += 1;
        Some(StreamPermit {
            budgets: self.clone(),
            peer: *peer,
        })
    }
}

/// One held stream's worth of budget; dropping it hands it back.
pub(crate) struct StreamPermit {
    budgets: PeerBudgets,
    peer: NodeId,
}

impl Drop for StreamPermit {
    fn drop(&mut self) {
        if let Ok(mut in_flight) = self.budgets.in_flight.lock() {
            if let Some(held) = in_flight.get_mut(&self.peer) {
                *held -= 1;
                if *held == 0 {
                    in_flight.remove(&self.peer);
                }
            }
        }
    }
}

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
/// presented as an ordinary tokio duplex. The door's HTTP — and the
/// desk's — flows through this unchanged.
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
    runtime: Option<tokio::runtime::Handle>,
}

/// The endpoint builder behind [`Transport::bind`]: the address lookups
/// that resolve a bare node id, the relays that may carry the ciphertext,
/// and — for a bridge that serves — the ALPNs offered inbound.
///
/// `dial_only` derives from `presets::N0` instead of mirroring it:
/// `clear_address_lookup` removes the publisher the preset adds
/// (`PkarrPublisher::n0_dns()`, iroh-1.2.0/src/endpoint/presets.rs:125) and
/// the two resolvers are re-added. Publishing is what hands n0's pkarr DNS
/// this node's stable id and addresses — what lets a stranger dial back —
/// and a dialer only ever needs to resolve the other side.
fn endpoint_builder(relay: &RelayChoice, dial_only: bool) -> Result<Builder, BridgeError> {
    let mut builder = match relay {
        RelayChoice::Disabled => Endpoint::builder(presets::Minimal),
        RelayChoice::N0Public | RelayChoice::Custom { .. } if dial_only => {
            Endpoint::builder(presets::N0)
                .clear_address_lookup()
                .address_lookup(PkarrResolver::n0_dns())
                .address_lookup(DnsAddressLookup::n0_dns())
        }
        RelayChoice::N0Public | RelayChoice::Custom { .. } => Endpoint::builder(presets::N0),
    };
    if !dial_only {
        builder = builder.alpns(vec![ALPN.to_vec(), DESK_ALPN.to_vec()]);
    }
    match relay {
        // The n0 preset set the relay mode in both branches above.
        RelayChoice::N0Public => {}
        RelayChoice::Custom { url } => {
            let parsed: RelayUrl = url
                .parse()
                .map_err(|_| BridgeError::Config("the relay URL is not a valid URL"))?;
            builder = builder.relay_mode(RelayMode::Custom(RelayMap::from(parsed)));
        }
        RelayChoice::Disabled => builder = builder.relay_mode(RelayMode::Disabled),
    }
    Ok(builder)
}

impl Transport {
    /// Bind the endpoint under the node's persisted key. The relay choice,
    /// the address book and the role are the caller's decisions; the ALPNs
    /// and the identity are not.
    ///
    /// `dial_only` is the phone's half: no ALPN is registered for inbound —
    /// iroh accepts a connection only under a configured ALPN — and nothing
    /// about this node is published to n0's pkarr DNS.
    pub(crate) async fn bind(
        key: &NodeKey,
        relay: &RelayChoice,
        book: Option<&AddressBook>,
        dial_only: bool,
    ) -> Result<Self, BridgeError> {
        // Captured for a graceful close: `Endpoint::close` is async, and
        // shutdown is called from threads that own no runtime.
        let runtime = tokio::runtime::Handle::try_current().ok();
        let mut builder = endpoint_builder(relay, dial_only)?;
        if let Some(book) = book {
            builder = builder.address_lookup(book.inner.clone());
        }
        let endpoint = builder
            .secret_key(SecretKey::from_bytes(&key.to_bytes()))
            .bind()
            .await
            .map_err(|e| BridgeError::Transport(e.to_string()))?;
        Ok(Self { endpoint, runtime })
    }

    /// Close the endpoint gracefully: QUIC close frames reach the tunnels
    /// in flight, so a peer sees an ending, not a reset. The close runs on
    /// the runtime the endpoint was bound on; without one (nothing should
    /// bind outside a runtime) the caller's abort of the accept loop is
    /// what remains.
    pub(crate) fn close(&self) {
        if let Some(runtime) = &self.runtime {
            let endpoint = self.endpoint.clone();
            runtime.spawn(async move {
                endpoint.close().await;
            });
        }
    }

    pub(crate) fn node_id(&self) -> NodeId {
        NodeId::from_bytes(*self.endpoint.id().as_bytes())
    }

    /// The transports iroh currently knows for `remote`, as plain text:
    /// `active ip <addr>` or `known relay <url>` — `active` marks the path
    /// in use. A snapshot, not a watcher; the dial example polls it. An
    /// unknown or closed remote answers an empty list, which is a fact, not
    /// an error.
    pub(crate) async fn remote_paths(&self, remote: &NodeId) -> Vec<String> {
        let Ok(id) = endpoint_id(remote) else {
            return Vec::new();
        };
        let Some(info) = self.endpoint.remote_info(id).await else {
            return Vec::new();
        };
        info.addrs()
            .map(|entry| {
                let usage = match entry.usage() {
                    TransportAddrUsage::Active => "active",
                    TransportAddrUsage::Inactive => "known",
                    // The enum is `non_exhaustive` upstream.
                    _ => "unknown-usage",
                };
                format!("{usage} {}", entry.addr())
            })
            .collect()
    }

    /// This endpoint's current addressing, into a book that was handed to
    /// `bind`. Without a book this is nothing to do: the book is the only
    /// destination for these addresses — only the n0 and custom serving
    /// roads publish through iroh's lookups, a disabled road has no
    /// publisher at all, and a dial-only node publishes nothing either. An address the socket reports as unspecified (`0.0.0.0`) is
    /// registered as loopback: a book is an in-process fact, and a dial to
    /// `0.0.0.0` is not one.
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
    /// bytes alone, on the lane [`Lane`] names. `deadline` covers the whole
    /// dial — lookup, hole punching, handshake, stream open — because iroh
    /// itself would wait indefinitely on a published-but-dead peer
    /// (measured: 25 seconds of silence and counting).
    pub(crate) async fn dial(
        &self,
        remote: &NodeId,
        lane: Lane,
        deadline: Duration,
    ) -> Result<TunnelStream, BridgeError> {
        let alpn = match lane {
            Lane::Door => ALPN,
            Lane::Desk => DESK_ALPN,
        };
        let remote = endpoint_id(remote)?;
        let overall = tokio::time::Instant::now() + deadline;
        let connection = match timeout_at(overall, self.endpoint.connect(remote, alpn)).await {
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
    /// connection — to `door`, or to `desk` when the stream arrived on the
    /// desk's ALPN. Runs until the endpoint closes.
    pub(crate) async fn serve(
        self,
        door: SocketAddr,
        desk: Option<SocketAddr>,
        dial_timeout: Duration,
        idle: Duration,
    ) {
        // One budget per lane: desk traffic must not spend the door's
        // slots, nor the door's the desk's.
        let door_budgets = PeerBudgets::default();
        let desk_budgets = PeerBudgets::default();
        while let Some(incoming) = self.endpoint.accept().await {
            let accepting = match incoming.accept() {
                Ok(accepting) => accepting,
                Err(_) => continue,
            };
            let connection = match accepting.await {
                Ok(connection) => connection,
                Err(_) => continue,
            };
            // The peer is known from the tunnel's own handshake; its ALPN
            // is the route, and each lane's budget is checked per stream,
            // before anything is forwarded.
            let (target, budgets) = if connection.alpn() == DESK_ALPN {
                // The desk lane is open to anyone who knows the node id;
                // the gate is the desk's own — a 128-bit one-time code in a
                // two-minute window, one uniform refusal — not this tunnel.
                (desk, &desk_budgets)
            } else if connection.alpn() == ALPN {
                (Some(door), &door_budgets)
            } else {
                // This endpoint registered both tags, so TLS should never
                // have negotiated a third: a peer we cannot place is a
                // peer we do not forward.
                continue;
            };
            let Some(target) = target else {
                // The desk lane with no desk behind it: refuse the
                // connection whole — the dialer sees its stream close, it
                // never hangs and never reaches the door.
                continue;
            };
            let peer = NodeId::from_bytes(*connection.remote_id().as_bytes());
            tokio::spawn(forward_connection(
                connection,
                target,
                dial_timeout,
                idle,
                budgets.clone(),
                peer,
            ));
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
    target: SocketAddr,
    dial_timeout: Duration,
    idle: Duration,
    budgets: PeerBudgets,
    peer: NodeId,
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
        let Some(permit) = budgets.acquire(&peer) else {
            // Past the ceiling: the stream is dropped here, never given
            // a chance to hold a slot at the service.
            continue;
        };
        tokio::spawn(forward_stream(stream, target, dial_timeout, idle, permit));
    }
}

async fn forward_stream(
    stream: TunnelStream,
    target: SocketAddr,
    dial_timeout: Duration,
    idle: Duration,
    _permit: StreamPermit,
) {
    let tcp =
        match tokio::time::timeout(dial_timeout, tokio::net::TcpStream::connect(target)).await {
            Ok(Ok(tcp)) => tcp,
            // The targets are loopback-only; failing to reach one in
            // `dial_timeout` means that service is down. The phone sees
            // the stream close — the desk being down refuses, it does not
            // hang.
            Ok(Err(_)) | Err(_) => return,
        };
    let _ = pump::pump(stream, tcp, idle).await;
}

#[cfg(test)]
mod tests {
    use super::{endpoint_builder, RelayChoice, ALPN, DESK_ALPN};

    // A phone pinned to an older brain commit dials the ALPN it was built
    // with, so an edited tag would break that phone's handshake silently —
    // iroh just refuses the peer — instead of failing here.
    #[test]
    fn the_two_alpn_tags_are_exactly_these_bytes() {
        assert_eq!(ALPN, &b"kalsa/door-tunnel/1"[..]);
        assert_eq!(DESK_ALPN, &b"kalsa/pair-desk/1"[..]);
    }

    // The phone's audit finding, pinned where it is decided: the serving
    // road publishes to n0's pkarr DNS (that is how the Mac is found by id)
    // and the dial-only road does not — it still resolves through both n0
    // lookups and still rides n0's relays. `Builder` renders what it holds,
    // so this reads the config without touching a network.
    #[test]
    fn the_dial_only_road_resolves_without_publishing() {
        let serving = format!("{:?}", endpoint_builder(&RelayChoice::N0Public, false).unwrap());
        let dialing = format!("{:?}", endpoint_builder(&RelayChoice::N0Public, true).unwrap());

        assert!(
            serving.contains("PkarrPublisherBuilder"),
            "the serving road must still publish this node to n0's pkarr DNS"
        );
        assert!(
            !dialing.contains("PkarrPublisherBuilder"),
            "a dial-only bridge must never publish its node id: {dialing}"
        );
        assert!(dialing.contains("PkarrResolverBuilder"), "it must still resolve");
        assert!(
            dialing.contains("DnsAddressLookupBuilder"),
            "it must still resolve through the DNS lookup N0 adds"
        );
        assert!(
            dialing.contains("Relay { relay_map:"),
            "it must still ride n0's relays"
        );
    }

    // The other dial-only half, pinned where it is decided: no ALPN is
    // offered inbound, and iroh refuses an inbound handshake it has no tag
    // for — so nothing can be dialled into a phone at all.
    #[test]
    fn the_dial_only_road_offers_no_inbound_alpn() {
        let serving = format!("{:?}", endpoint_builder(&RelayChoice::N0Public, false).unwrap());
        let dialing = format!("{:?}", endpoint_builder(&RelayChoice::N0Public, true).unwrap());
        let alpns = format!("{:?}", vec![ALPN.to_vec(), DESK_ALPN.to_vec()]);

        assert!(
            serving.contains(&alpns),
            "the serving road must still answer both lanes: {serving}"
        );
        assert!(
            !dialing.contains(&alpns),
            "a dial-only bridge must offer no inbound ALPN: {dialing}"
        );
    }
}
