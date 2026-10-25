use std::fmt;

use crate::name::NamespacedName;
use crate::permission::DenyReason;
use crate::server_id::ServerId;

/// Every message is fixed text. Server replies and bootstrap material never
/// reach an error, so an error can be logged or reported as it is.
#[derive(Debug)]
pub enum Error {
    InvalidServerId,
    InvalidSecret,
    RelativeCommand(ServerId),
    DuplicateServer(ServerId),
    NoNamespace,
    UnknownServer,
    UnknownTool(NamespacedName),
    DuplicateTool(NamespacedName),
    InvalidToolName(ServerId),
    Denied(NamespacedName, DenyReason),
    BinaryUnreadable(ServerId),
    BinaryChanged(ServerId),
    NotPinned(ServerId),
    ThirdPartyNeedsSandbox(ServerId),
    BootstrapNeedsFirstParty(ServerId),
    Launch(ServerId),
    ServerGone(ServerId),
    Protocol(ServerId),
    Unsupported(ServerId),
    TooManyPages(ServerId),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidServerId => {
                f.write_str("server id must start with a-z and use only a-z, 0-9 and _ (32 characters at most)")
            }
            Self::InvalidSecret => f.write_str("bootstrap secret must be one non-empty line"),
            Self::RelativeCommand(id) => write!(f, "server {id}: command must be an absolute path"),
            Self::DuplicateServer(id) => write!(f, "server id {id} is registered twice"),
            Self::NoNamespace => f.write_str("tool name must be <server>.<tool>"),
            Self::UnknownServer => f.write_str("no server with that id is registered"),
            Self::UnknownTool(name) => write!(f, "{name} is not a tool that server lists"),
            Self::DuplicateTool(name) => write!(f, "{name} is listed twice"),
            Self::InvalidToolName(id) => {
                write!(f, "server {id} listed a tool name that is empty or contains '.'")
            }
            Self::Denied(name, reason) => write!(f, "{name} is denied: {reason}"),
            Self::BinaryUnreadable(id) => write!(f, "server {id}: program could not be read"),
            Self::BinaryChanged(id) => write!(f, "server {id}: program differs from the approved one"),
            Self::NotPinned(id) => write!(f, "server {id} has no approved program yet"),
            Self::ThirdPartyNeedsSandbox(id) => {
                write!(f, "server {id} is third-party: third-party servers need a sandbox, and none exists yet")
            }
            Self::BootstrapNeedsFirstParty(id) => {
                write!(f, "server {id} is third-party: only first-party servers take a bootstrap secret")
            }
            Self::Launch(id) => write!(f, "server {id} did not start"),
            Self::ServerGone(id) => write!(f, "server {id} stopped answering; register it again"),
            Self::Protocol(id) => write!(f, "server {id} failed or sent an unexpected reply"),
            Self::Unsupported(id) => {
                write!(f, "server {id} asked for a result type this host does not handle")
            }
            Self::TooManyPages(id) => write!(f, "server {id} listed too many pages of tools"),
        }
    }
}

impl std::error::Error for Error {}
