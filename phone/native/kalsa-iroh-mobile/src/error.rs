//! The error face the app sees: one enum, every failure a variant, no
//! secret across the boundary. It mirrors brain's `BridgeError`, with two
//! cases of our own split out: a mistyped node hex is a caller bug, and a
//! call from inside an async context is a caller threading bug — neither
//! is a transport event.

use std::fmt;
use std::str::FromStr;

use kalsa_iroh::{BridgeError, NodeId};

/// Everything `MobileBridge` and `Tunnel` can fail with.
#[derive(Debug, uniffi::Error)]
pub enum IrohMobileError {
    /// A socket or file operation failed: the key file, the endpoint bind,
    /// a tunnel read or write.
    Io { detail: String },
    /// The operating system would not provide the 32 key bytes.
    Entropy,
    /// The stored node key violates its own structure. The detail names
    /// the shape of the corruption, never the key.
    KeyCorrupt { detail: String },
    /// The dial target is not 64 hex characters.
    InvalidNodeHex,
    /// A caller argument or setting cannot be honored.
    Config { detail: String },
    /// A deadline the caller set (or the dial deadline) fired.
    Deadline,
    /// The bridge is shut down, or the tunnel is already closed.
    Closed,
    /// The call was made from inside an async runtime thread; park it on
    /// a plain thread instead.
    AsyncContext,
    /// The transport refused or dropped the attempt.
    Transport { detail: String },
}

impl fmt::Display for IrohMobileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { detail } => write!(f, "kalsa iroh: io: {detail}"),
            Self::Entropy => f.write_str("kalsa iroh: no entropy from the operating system"),
            Self::KeyCorrupt { detail } => write!(f, "kalsa iroh: key file corrupt: {detail}"),
            Self::InvalidNodeHex => f.write_str("kalsa iroh: node id is not 64 hex characters"),
            Self::Config { detail } => write!(f, "kalsa iroh: config: {detail}"),
            Self::Deadline => f.write_str("kalsa iroh: the deadline fired before the peer answered"),
            Self::Closed => f.write_str("kalsa iroh: the bridge or tunnel is closed"),
            Self::AsyncContext => {
                f.write_str("kalsa iroh: called from inside an async context; use a plain thread")
            }
            Self::Transport { detail } => write!(f, "kalsa iroh: transport: {detail}"),
        }
    }
}

impl std::error::Error for IrohMobileError {}

impl From<BridgeError> for IrohMobileError {
    fn from(error: BridgeError) -> Self {
        match error {
            BridgeError::Io(e) => Self::Io { detail: e.to_string() },
            BridgeError::Entropy => Self::Entropy,
            BridgeError::Corrupt(tag) => Self::KeyCorrupt { detail: tag.to_string() },
            BridgeError::Deadline => Self::Deadline,
            BridgeError::Config(tag) => Self::Config { detail: tag.to_string() },
            BridgeError::Closed => Self::Closed,
            BridgeError::Transport(cause) => Self::Transport { detail: cause },
        }
    }
}

impl From<std::io::Error> for IrohMobileError {
    fn from(error: std::io::Error) -> Self {
        Self::Io { detail: error.to_string() }
    }
}

pub(crate) fn parse_node_id(hex: &str) -> Result<NodeId, IrohMobileError> {
    NodeId::from_str(hex).map_err(|_| IrohMobileError::InvalidNodeHex)
}
