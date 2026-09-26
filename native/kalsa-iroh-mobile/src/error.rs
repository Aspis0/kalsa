//! The error face the app sees: one enum, every failure a variant, no
//! panic and no secret across the boundary. It mirrors brain's
//! `BridgeError` one-to-one, with the dial-string case split out because
//! a mistyped node hex is a caller bug, not a transport event.

use std::fmt;
use std::str::FromStr;

use kalsa_iroh::{BridgeError, NodeId};

/// Everything `MobileBridge` and `Tunnel` can fail with.
#[derive(Debug, uniffi::Error)]
pub enum IrohMobileError {
    /// A socket or file operation failed: the key file, the endpoint bind,
    /// a tunnel read or write.
    Io { message: String },
    /// The operating system would not provide the 32 key bytes.
    Entropy,
    /// The stored node key violates its own structure. The message names
    /// the shape of the corruption, never the key.
    KeyCorrupt { message: String },
    /// The dial target is not 64 hex characters.
    InvalidNodeHex,
    /// A caller argument or setting cannot be honored.
    Config { message: String },
    /// The dial or the idle deadline fired.
    Deadline,
    /// The bridge is shut down, or the tunnel is already closed.
    Closed,
    /// The transport refused or dropped the attempt.
    Transport { message: String },
}

impl fmt::Display for IrohMobileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { message } => write!(f, "kalsa iroh: io: {message}"),
            Self::Entropy => f.write_str("kalsa iroh: no entropy from the operating system"),
            Self::KeyCorrupt { message } => write!(f, "kalsa iroh: key file corrupt: {message}"),
            Self::InvalidNodeHex => f.write_str("kalsa iroh: node id is not 64 hex characters"),
            Self::Config { message } => write!(f, "kalsa iroh: config: {message}"),
            Self::Deadline => f.write_str("kalsa iroh: the deadline fired before the peer answered"),
            Self::Closed => f.write_str("kalsa iroh: the bridge or tunnel is closed"),
            Self::Transport { message } => write!(f, "kalsa iroh: transport: {message}"),
        }
    }
}

impl std::error::Error for IrohMobileError {}

impl From<BridgeError> for IrohMobileError {
    fn from(error: BridgeError) -> Self {
        match error {
            BridgeError::Io(e) => Self::Io { message: e.to_string() },
            BridgeError::Entropy => Self::Entropy,
            BridgeError::Corrupt(tag) => Self::KeyCorrupt { message: tag.to_string() },
            BridgeError::Deadline => Self::Deadline,
            BridgeError::Config(tag) => Self::Config { message: tag.to_string() },
            BridgeError::Closed => Self::Closed,
            BridgeError::Transport(cause) => Self::Transport { message: cause },
        }
    }
}

impl From<std::io::Error> for IrohMobileError {
    fn from(error: std::io::Error) -> Self {
        Self::Io { message: error.to_string() }
    }
}

pub(crate) fn parse_node_id(hex: &str) -> Result<NodeId, IrohMobileError> {
    NodeId::from_str(hex).map_err(|_| IrohMobileError::InvalidNodeHex)
}
