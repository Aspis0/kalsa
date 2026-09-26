//! The phone-facing bridge: a key file in, this node's hex id out, and
//! tunnels dialed by the desktop's 32 public bytes alone. The wrapper
//! owns one tokio runtime, `Arc`-shared with every tunnel so a tunnel can
//! outlive the bridge without the runtime dropping under a parked call,
//! and parks every FFI call on it — from plain threads only; a call made
//! inside an async context answers a typed error instead of panicking.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use kalsa_iroh::{Bridge, BridgeConfig, Lane as UpstreamLane, RelayChoice};
use tokio::runtime::Runtime;

use crate::error::{parse_node_id, IrohMobileError};
use crate::runtime::{require_plain_thread, SharedRuntime};
use crate::stream::Tunnel;

/// Which loopback service behind the desktop the tunnel is for. Rides the
/// connection's ALPN, so the lanes cannot cross.
#[derive(Clone, Copy, Debug, PartialEq, Eq, uniffi::Enum)]
pub enum Lane {
    /// The authenticated door: chat and inference.
    Door,
    /// The pairing desk: claim and complete.
    Desk,
}

#[derive(uniffi::Object)]
pub struct MobileBridge {
    bridge: Bridge,
    // Last on purpose: the bridge must close while the runtime still runs.
    runtime: SharedRuntime,
}

#[uniffi::export]
impl MobileBridge {
    /// Load or mint the node key at `key_path` — its parent directory must
    /// already exist; on Android the app passes
    /// `<Context.filesDir>/iroh-node.key` — and bind the endpoint. The
    /// phone is dial-only, so the door address is the placeholder a
    /// dialer's accept loop would never use. The dial itself is bounded
    /// by brain's 10 s dial deadline.
    #[uniffi::constructor]
    pub fn new(key_path: String) -> Result<Arc<Self>, IrohMobileError> {
        Self::start(
            // TODO(kalsa-brain): N0Public also publishes this phone's id to
            // n0 pkarr DNS, and brain spawns an accept loop even for a
            // dial-only endpoint; both belong in kalsa-iroh, tracked there.
            BridgeConfig::new(dialer_placeholder()).with_relay(RelayChoice::N0Public),
            PathBuf::from(key_path),
        )
    }

    /// This node's public identity, hex — the string the pairing square
    /// carries so the phone can dial this computer by it.
    pub fn node_id(&self) -> String {
        self.bridge.node_id().to_string()
    }

    /// Open one tunnel to the remote node, under brain's dial deadline.
    /// Reads and writes on the returned tunnel are bounded by the
    /// deadlines the caller passes each call; this side trusts no
    /// silence, because keepalives can keep a dead connection open.
    pub fn connect(&self, node_hex: String, lane: Lane) -> Result<Arc<Tunnel>, IrohMobileError> {
        require_plain_thread()?;
        let node = parse_node_id(&node_hex)?;
        let upstream_lane = match lane {
            Lane::Door => UpstreamLane::Door,
            Lane::Desk => UpstreamLane::Desk,
        };
        let stream = self.runtime.block_on(self.bridge.connect(node, upstream_lane))?;
        Ok(Arc::new(Tunnel::new(stream, self.runtime.clone())))
    }
}

impl MobileBridge {
    fn start(config: BridgeConfig, key_path: PathBuf) -> Result<Arc<Self>, IrohMobileError> {
        require_plain_thread()?;
        let runtime = SharedRuntime::new(Runtime::new()?);
        let bridge = runtime.block_on(Bridge::start(config, &key_path))?;
        Ok(Arc::new(Self { bridge, runtime }))
    }
}

/// The door address a dial-only bridge hands brain's accept loop: never
/// used for inbound traffic, `127.0.0.1:0` because a socket address is
/// required even when nothing listens behind it.
fn dialer_placeholder() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], 0))
}

/// The network-free seam for the integration tests, deliberately outside
/// the uniffi face: relays off, resolution through an in-process book —
/// the exact shape brain's own round-trip test runs. Production
/// constructors never take a book.
#[cfg(feature = "test-support")]
impl MobileBridge {
    #[doc(hidden)]
    pub fn for_tests(key_path: PathBuf, book: &kalsa_iroh::AddressBook) -> Result<Arc<Self>, IrohMobileError> {
        Self::start(
            BridgeConfig::new(dialer_placeholder())
                .with_relay(RelayChoice::Disabled)
                .with_address_book(book.clone()),
            key_path,
        )
    }
}
