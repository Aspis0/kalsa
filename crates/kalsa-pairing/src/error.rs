//! Every failure the ceremony can produce, as values. None of these carries
//! secret material, and the phone-facing outcome (`ClaimResult`) deliberately
//! says even less than the errors here do.

use std::error::Error;
use std::fmt;

/// The operating system would not provide entropy. Nothing was generated: no
/// code was offered, no credential was minted.
#[derive(Debug)]
pub(crate) struct EntropyError;

impl fmt::Display for EntropyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("the operating system would not provide entropy")
    }
}

impl Error for EntropyError {}

/// Why an offer could not be put on the table.
#[derive(Debug)]
pub enum OfferError {
    /// The operating system would not provide entropy. No offer exists.
    Entropy,
    /// The caller's `ttl` does not fit the wall clock, so no deadline can be
    /// computed. No offer exists — a window that cannot be represented must
    /// not silently become an eternal one.
    Deadline,
}

impl fmt::Display for OfferError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Entropy => "the operating system would not provide entropy",
            Self::Deadline => "the requested window does not fit the clock",
        })
    }
}

impl Error for OfferError {}

/// The pairing payload does not fit in a QR code, so nothing was rendered:
/// a truncated symbol would scan into a payload that is not the ceremony's.
#[derive(Debug)]
pub struct PayloadTooLong;

impl fmt::Display for PayloadTooLong {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("the pairing payload is too long for a QR code")
    }
}

impl Error for PayloadTooLong {}

#[derive(Debug)]
pub enum CompleteError {
    /// The ceremony is finished or was never alive — offered without a
    /// claim, already paired, expired, or burned by a proof that did not
    /// verify. Deliberately **one** answer for every cause: distinguishing
    /// them would hand a prober an oracle for "is there a live, claimed
    /// ceremony sitting here". A completion against a session with nothing
    /// claimed changes no state; a completion against a live claim whose
    /// proof fails burns it.
    Refused,
    /// The long-lived credential could not be minted. This one is not
    /// attacker-facing — nothing the phone presented caused it — so the
    /// ceremony stays `Claimed` and may be completed again.
    Entropy,
}

impl fmt::Display for CompleteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Refused => "the pairing ceremony refused completion",
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
    /// is never implicit; the owner-only replacement path publishes a new
    /// complete file atomically instead.
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
