//! Every failure the bridge can produce, as values. None of these carries
//! secret material: the node key never appears here, in any variant, at any
//! level — a transport failure names its cause, never its credentials.

use std::error::Error;
use std::fmt;
use std::io;

#[derive(Debug)]
pub enum BridgeError {
    /// A socket or file operation failed before any transport was involved.
    Io(io::Error),
    /// The operating system would not provide the 32 key bytes. No node
    /// identity exists.
    Entropy,
    /// The stored node key violates its own structure: not hex, wrong
    /// length, wrong size. The tag is static and no file content is echoed
    /// back — the key itself can never ride out through this variant.
    Corrupt(&'static str),
    /// Our own deadline fired. iroh's dial and read paths block silently on
    /// an unreachable or dead peer — measured at 25 seconds and more — so
    /// every dial and every read this crate performs is bounded from
    /// outside; this is what that bound looks like when it works.
    Deadline,
    /// The caller's own configuration cannot be honored: a relay URL that
    /// does not parse, a door address that is not loopback. Nothing ran.
    Config(&'static str),
    /// The bridge was shut down before or while the operation ran.
    Closed,
    /// The transport underneath refused or dropped the attempt. The string
    /// is the cause as the transport words it; nothing secret passes
    /// through it.
    Transport(String),
}

impl fmt::Display for BridgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "iroh bridge: {e}"),
            Self::Entropy => f.write_str("the operating system would not provide entropy"),
            Self::Corrupt(tag) => write!(f, "stored node key is corrupt: {tag}"),
            Self::Config(tag) => write!(f, "bridge configuration: {tag}"),
            Self::Deadline => f.write_str("the bridge's own deadline fired before the peer answered"),
            Self::Closed => f.write_str("the bridge is shut down"),
            Self::Transport(cause) => write!(f, "iroh transport: {cause}"),
        }
    }
}

impl Error for BridgeError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<io::Error> for BridgeError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}
