//! Every failure the ceremony can produce, as values. None of these carries
//! secret material, and the phone-facing outcome (`ClaimResult`) deliberately
//! says even less than the errors here do.

use std::error::Error;
use std::fmt;

/// The operating system would not provide entropy. Nothing was generated: no
/// code was offered, no credential was minted.
#[derive(Debug)]
pub struct EntropyError;

impl fmt::Display for EntropyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("the operating system would not provide entropy")
    }
}

impl Error for EntropyError {}

#[derive(Debug)]
pub enum CompleteError {
    /// `complete` was called on a ceremony that no phone has claimed.
    NotClaimed,
    /// The window closed between the claim and the completion. The ceremony is
    /// `Expired`; the QR must be shown again.
    WindowClosed,
    /// The long-lived credential could not be minted. The ceremony stays
    /// `Claimed` and may be completed again.
    Entropy,
}

impl fmt::Display for CompleteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::NotClaimed => "the ceremony was completed without a claim",
            Self::WindowClosed => "the pairing window closed before the handshake finished",
            Self::Entropy => "the operating system would not provide entropy",
        })
    }
}

impl Error for CompleteError {}

#[derive(Debug)]
pub enum StoreError {
    /// The file could not be written or read.
    Io(std::io::Error),
    /// A credential is already stored, so `persist` refused. Overwriting one
    /// is never implicit: the computer forgets its phone first (`store::forget`)
    /// — on purpose, and that operation works whatever is in the file.
    AlreadyPaired,
    /// The store's own JSON failed to encode or parse.
    Serde(serde_json::Error),
    /// The file violates its own structure: an unknown version, a credential
    /// that is not hex, parameters that cannot exist. The tag is static and
    /// no file content is echoed back.
    Corrupt(&'static str),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "credential store: {e}"),
            Self::AlreadyPaired => f.write_str(
                "credential store: this computer is already paired with a phone; \
                 forget it before pairing another",
            ),
            Self::Serde(e) => write!(f, "credential store: {e}"),
            Self::Corrupt(tag) => write!(f, "credential store is corrupt: {tag}"),
        }
    }
}

impl Error for StoreError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            Self::Serde(e) => Some(e),
            Self::AlreadyPaired | Self::Corrupt(_) => None,
        }
    }
}
