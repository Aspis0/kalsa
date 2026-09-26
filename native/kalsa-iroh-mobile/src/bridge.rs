//! The phone-facing bridge: a key file in, this node's hex id out, and
//! tunnels dialed by the desktop's 32 public bytes alone. The wrapper owns
//! one private tokio runtime and parks every FFI call on it; field order
//! below is load-bearing, since fields drop in declaration order and the
//! bridge's graceful close needs the runtime alive under it.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use kalsa_iroh::{AddressBook, Bridge, BridgeConfig, Lane as UpstreamLane, RelayChoice};
use tokio::runtime::Runtime;

use crate::error::{parse_node_id, IrohMobileError};
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
    runtime: Runtime,
}

#[uniffi::export]
impl MobileBridge {
    /// Load or mint the node key at `key_path` — its parent directory must
    /// already exist; on Android the app passes
    /// `<Context.filesDir>/iroh-node.key` — and bind the endpoint. The
    /// phone is dial-only, so the door address is the placeholder a
    /// dialer's accept loop would never use.
    #[uniffi::constructor]
    pub fn new(key_path: String) -> Result<Arc<Self>, IrohMobileError> {
        Self::start(
            BridgeConfig::new(dialer_placeholder()).with_relay(RelayChoice::N0Public),
            PathBuf::from(key_path),
        )
    }

    /// This node's public identity, hex — the string the pairing square
    /// carries so the phone can dial this computer by it.
    pub fn node_id(&self) -> String {
        self.bridge.node_id().to_string()
    }

    /// Open one tunnel to the remote node, under the dial deadline. Reads
    /// and writes on the returned tunnel answer `Deadline` when the peer
    /// goes silent longer than brain's idle deadline.
    pub fn connect(&self, node_hex: String, lane: Lane) -> Result<Arc<Tunnel>, IrohMobileError> {
        let node = parse_node_id(&node_hex)?;
        let upstream_lane = match lane {
            Lane::Door => UpstreamLane::Door,
            Lane::Desk => UpstreamLane::Desk,
        };
        let stream = self.runtime.block_on(self.bridge.connect(node, upstream_lane))?;
        Ok(Arc::new(Tunnel::new(stream, self.runtime.handle().clone())))
    }
}

impl MobileBridge {
    fn start(config: BridgeConfig, key_path: PathBuf) -> Result<Arc<Self>, IrohMobileError> {
        let runtime = Runtime::new()?;
        let bridge = runtime.block_on(Bridge::start(config, &key_path))?;
        Ok(Arc::new(Self { bridge, runtime }))
    }

    /// The network-free seam for the host test, deliberately outside the
    /// uniffi face: relays off, resolution through an in-process book —
    /// the exact shape brain's own round-trip test runs. Production
    /// constructors never take a book.
    #[doc(hidden)]
    pub fn for_tests(key_path: PathBuf, book: &AddressBook) -> Result<Arc<Self>, IrohMobileError> {
        Self::start(
            BridgeConfig::new(dialer_placeholder())
                .with_relay(RelayChoice::Disabled)
                .with_address_book(book.clone()),
            key_path,
        )
    }
}

fn dialer_placeholder() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], 0))
}
