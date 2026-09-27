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
    /// claim, already paired, expired, or presented with a proof that did
    /// not verify. Deliberately **one** answer for every cause: distinguishing
    /// them would hand a prober an oracle for "is there a live, claimed
    /// ceremony sitting here". No refusal moves the state machine: only the
    /// window ends a claimed ceremony, so a bogus completion cannot take it.
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
    /// The credential about to be added is ALREADY in the set — a replayed
    /// handshake or a caller mistake, never a new pairing. Deliberately not
    /// `AlreadyPaired`: that variant means "the store refused to grow through
    /// the single-device path", which a caller turns into an owner-facing
    /// offer to replace the existing phone. Offering a replacement because a
    /// replayed credential arrived would ask the owner to throw a phone away,
    /// so this refusal says what happened instead.
    CredentialAlreadyStored,
    /// The store's ids are exhausted, so no new device can be added. It
    /// takes one pairing per existing id — 2^32 of them — to reach this,
    /// but the alternative was a silently saturated duplicate id, and the
    /// reader refuses a set whose devices share one: one saturation would
    /// cost every pairing the user has, so the refusal is explicit.
    StoreFull,
    /// The host's own credential could not be minted, so self-enrolment
    /// wrote nothing. Nothing the owner did caused it; the same answer the
    /// ceremony gives when entropy is unavailable.
    Entropy,
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
            Self::CredentialAlreadyStored => f.write_str(
                "credential store: this credential is already stored here",
            ),
            Self::StoreFull => f.write_str(
                "credential store: every device id is in use, \
                 so no further device can be paired",
            ),
            Self::Entropy => {
                f.write_str("credential store: the operating system would not provide entropy")
            }
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
            Self::AlreadyPaired
            | Self::CredentialAlreadyStored
            | Self::StoreFull
            | Self::Entropy
            | Self::Corrupt(_) => None,
        }
    }
}

/// Why an invitation could not be minted, kept, or written. A file that
/// cannot be read is not one of these: the reader hands back an empty set
/// instead (`Invites::open`), so every error here is either a refusal to
/// mint — nothing exists, the owner may try again — or a write that did not
/// land.
#[derive(Debug)]
pub enum InviteError {
    /// The ceremony would not go on the table: no entropy, or a deadline
    /// the clock cannot hold. No invite was minted.
    Offer(OfferError),
    /// A link is an iroh link: without this computer's node id a phone that
    /// scans it has a code and no road to dial. Refused, never defaulted.
    NoNode,
    /// The set is at its cap — ten invitations offered and unclaimed, or an
    /// id space the file has already handed out — so no new invite can be
    /// minted. Nothing is evicted: an owner who wants a new link cancels
    /// one first.
    Full,
    /// The invite file could not be written.
    Io(std::io::Error),
}

impl fmt::Display for InviteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Offer(e) => write!(f, "invitation: {e}"),
            Self::NoNode => {
                f.write_str("invitation: the road to this computer is not open, \
                     so a link could not be made")
            }
            Self::Full => f.write_str(
                "invitation: this computer already has as many invitations as it can hold",
            ),
            Self::Io(e) => write!(f, "invite file: {e}"),
        }
    }
}

impl Error for InviteError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Offer(e) => Some(e),
            Self::Io(e) => Some(e),
            Self::NoNode | Self::Full => None,
        }
    }
}
