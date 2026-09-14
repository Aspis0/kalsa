//! The state machine: Offered → Claimed → Paired, plus Expired.
//!
//! The states *are* the enum — there is no `claimed: bool` to forget to check
//! and no way to pair an offer nobody claimed. Time is injected, not read:
//! every transition takes `now`, so the window behaves identically in
//! production and in a test, and the caller — the shell's server loop — owns
//! the clock the way it owns the socket.
//!
//! The rules the transitions enforce:
//!
//! * the window covers the whole ceremony: a code claimed at the last second
//!   does not buy an open-ended handshake;
//! * the code is single-use. The first successful claim consumes it — the
//!   one-time code and the binding secret are dropped from memory at that
//!   moment — and any later claim, right code included, gets the same
//!   `Rejected`, because to a code-guesser "already used" is information
//!   worth mining;
//! * a *failed* claim does not consume the code: the real phone may still be
//!   on its way;
//! * a rejection never says how wrong the presentation was.

use std::fmt;
use std::time::{Duration, Instant};

use kalsa_catalog::PhoneModel;

use crate::error::{CompleteError, EntropyError};
use crate::handshake::{Credential, Handshake};
use crate::payload;
use crate::secret::{BINDING_BYTES, BindingSecret, OneTimeCode};

/// An offer on the table: the QR is (or was) on screen, and the code is
/// waiting for exactly one phone.
pub struct Offer {
    code: OneTimeCode,
    binding: BindingSecret,
    expires_at: Instant,
}

/// The code has been claimed. The one-time code and the binding secret are
/// already gone from memory; only the proof computed from them survives, along
/// with the rest of the window.
pub struct Claimed {
    proof: [u8; BINDING_BYTES],
    expires_at: Instant,
}

/// What a claim attempt came to. These are outcomes, not errors: every one of
/// them is a normal thing a phone can cause.
#[derive(Debug)]
pub enum ClaimResult {
    /// The code matched and the ceremony advanced; `binding_proof` now holds
    /// the answer to send the phone.
    Claimed,
    /// Not accepted — wrong, malformed, already used, or the ceremony has
    /// already moved on. One answer for all of these, on purpose. The session
    /// is unchanged.
    Rejected,
    /// The window closed before a valid code arrived. The session is now
    /// `Expired`.
    Expired,
}

pub enum Pairing {
    Offered(Offer),
    Claimed(Claimed),
    /// Done. The handshake result was handed to `complete`'s caller; only the
    /// marker remains.
    Paired,
    Expired,
}

// Written by hand and printing the state name and nothing else: the Offered
// and Claimed payloads hold secret material, and a derived Debug on this enum
// would print it the first time anything logged a session.
impl fmt::Debug for Pairing {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Offered(_) => "Pairing::Offered",
            Self::Claimed(_) => "Pairing::Claimed",
            Self::Paired => "Pairing::Paired",
            Self::Expired => "Pairing::Expired",
        })
    }
}

impl Pairing {
    /// A fresh offer: a one-time code and a binding secret, both from OS
    /// entropy, alive for `ttl`.
    pub fn offer(now: Instant, ttl: Duration) -> Result<Self, EntropyError> {
        Ok(Self::Offered(Offer {
            code: OneTimeCode::generate()?,
            binding: BindingSecret::generate()?,
            expires_at: now + ttl,
        }))
    }

    /// The QR's content: the versioned payload — how to reach this computer,
    /// the code, the binding. `None` once the ceremony has moved past the
    /// offer; there is no QR to show then.
    pub fn qr_payload(&self, reachable: &str) -> Option<String> {
        match self {
            Self::Offered(offer) => payload::encode(&offer.code, &offer.binding, reachable),
            _ => None,
        }
    }

    /// A phone — or anything posing as one — presents a code. `challenge` is
    /// the fresh nonce the phone sent along, for the binding proof.
    pub fn claim(&mut self, presented: &str, challenge: [u8; BINDING_BYTES], now: Instant) -> ClaimResult {
        let Self::Offered(offer) = self else {
            // Claimed, Paired, or Expired: the same rejection a wrong code
            // would get. In particular a correct code presented a second
            // time learns nothing.
            return ClaimResult::Rejected;
        };
        let deadline = offer.expires_at;
        if now >= deadline {
            *self = Self::Expired;
            return ClaimResult::Expired;
        }
        let accepted = offer.code.matches_hex(presented);
        if !accepted {
            return ClaimResult::Rejected;
        }
        let proof = offer.binding.answer(&challenge, &offer.code);
        *self = Self::Claimed(Claimed {
            proof,
            expires_at: deadline,
        });
        ClaimResult::Claimed
    }

    /// The answer to send the phone after a claim: proof that this session is
    /// the computer the QR was about. `Some` only while `Claimed`.
    pub fn binding_proof(&self) -> Option<[u8; BINDING_BYTES]> {
        match self {
            Self::Claimed(claimed) => Some(claimed.proof),
            _ => None,
        }
    }

    /// The phone finished the handshake: take its declaration, mint the
    /// long-lived credential, and return the result to persist and to
    /// deliver. Only a `Claimed` ceremony can complete.
    pub fn complete(
        &mut self,
        phone: PhoneModel,
        now: Instant,
    ) -> Result<Handshake, CompleteError> {
        let Self::Claimed(claimed) = self else {
            return Err(CompleteError::NotClaimed);
        };
        let deadline = claimed.expires_at;
        if now >= deadline {
            *self = Self::Expired;
            return Err(CompleteError::WindowClosed);
        }
        let credential = Credential::generate().map_err(|_| CompleteError::Entropy)?;
        let handshake = Handshake::new(phone, credential);
        *self = Self::Paired;
        Ok(handshake)
    }

    /// Retire the offer when its window closes on its own — the QR screen has
    /// to show "expired" whether or not anything ever claimed.
    pub fn expire_if_due(&mut self, now: Instant) {
        let due = match self {
            Self::Offered(offer) => now >= offer.expires_at,
            Self::Claimed(claimed) => now >= claimed.expires_at,
            Self::Paired | Self::Expired => false,
        };
        if due {
            *self = Self::Expired;
        }
    }
}

#[cfg(test)]
mod tests;
