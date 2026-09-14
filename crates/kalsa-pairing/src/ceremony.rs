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
//! * the code is single-use. The first successful claim consumes it — and
//!   any later claim, right code included, gets the same `Rejected`, because
//!   to a code-guesser "already used" is information worth mining;
//! * a *failed* claim does not consume the code: the real phone may still be
//!   on its way;
//! * a rejection never says how wrong the presentation was;
//! * completion is a second gate and a one-shot: the phone proves knowledge
//!   of the code with a MAC over the per-offer nonce and its metadata, and a
//!   proof that fails burns the ceremony — one attempt, per completion, ever.

use std::fmt;
use std::time::{Duration, SystemTime};

use getrandom::fill;

use crate::error::{CompleteError, EntropyError};
use crate::handshake::{Credential, Handshake};
use crate::messages::{seal_computer, verify_phone_mac, PairingSeal, PhoneDeclaration, NONCE_BYTES};
use crate::payload;
use crate::secret::OneTimeCode;

/// An offer on the table: the QR is (or was) on screen, and the code is
/// waiting for exactly one phone.
///
/// The deadline is **wall-clock time, and that is a decision.** The window
/// exists so a code photographed and abandoned stops working within minutes
/// of *real* time — and the likeliest way minutes become hours is the
/// machine sleeping with the QR on screen. A suspend is a gap in `Instant`,
/// but the photographer's clock kept running, so the deadline must ride
/// `SystemTime` and sleep counts against it. The trade is `Instant`'s
/// rollback immunity, declined deliberately: the only actor a rolled-back
/// clock helps is the owner standing in front of the screen, and this
/// ceremony already treats whoever presents the code as the phone.
pub struct Offer {
    code: OneTimeCode,
    /// Fresh per offer, carried in the QR: both completion MACs cover it, so
    /// a proof recorded in one ceremony verifies in no other.
    nonce: [u8; NONCE_BYTES],
    expires_at: SystemTime,
}

/// The code has been claimed. The code itself survives here — the completion
/// proof is keyed on it, so it lives exactly as long as the ceremony can
/// still complete — together with the nonce and the rest of the window, on
/// the same wall-clock terms as `Offer`.
pub struct Claimed {
    code: OneTimeCode,
    nonce: [u8; NONCE_BYTES],
    expires_at: SystemTime,
}

/// What a claim attempt came to. These are outcomes, not errors: every one of
/// them is a normal thing a phone can cause.
#[derive(Debug)]
pub enum ClaimResult {
    /// The code matched and the ceremony advanced; the phone may now finish
    /// with its signed-in-stone declaration.
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
    /// A fresh offer: a one-time code and a per-offer nonce, both from OS
    /// entropy, alive for `ttl`. The code keys both completion MACs; the
    /// nonce is what makes a proof from one ceremony worthless in another.
    pub fn offer(now: SystemTime, ttl: Duration) -> Result<Self, EntropyError> {
        let mut nonce = [0u8; NONCE_BYTES];
        fill(&mut nonce).map_err(|_| EntropyError)?;
        Ok(Self::Offered(Offer {
            code: OneTimeCode::generate()?,
            nonce,
            expires_at: now + ttl,
        }))
    }

    /// The QR's content: the versioned payload — how to reach this computer,
    /// the code, the nonce. `None` once the ceremony has moved past the
    /// offer; there is no QR to show then.
    pub fn qr_payload(&self, reachable: &str) -> Option<String> {
        match self {
            Self::Offered(offer) => payload::encode(&offer.code, &offer.nonce, reachable),
            _ => None,
        }
    }

    /// A phone — or anything posing as one — presents a code. The claim is
    /// the first gate; the completion proof (also keyed on this code) is
    /// the second.
    pub fn claim(&mut self, presented: &str, now: SystemTime) -> ClaimResult {
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
        // The offer's parts move into the claimed state: take ownership with
        // a placeholder — the else arm is unreachable, the state was just
        // `Offered`, and a placeholder beats a panic in a desktop app.
        let Self::Offered(offer) = std::mem::replace(self, Self::Expired) else {
            return ClaimResult::Rejected;
        };
        *self = Self::Claimed(Claimed {
            code: offer.code,
            nonce: offer.nonce,
            expires_at: deadline,
        });
        ClaimResult::Claimed
    }

    /// The phone finished the handshake: its declaration arrives bound to
    /// the ceremony by a MAC keyed on the one-time secret the QR carried
    /// (`messages`). Verified in constant time, or the ceremony burns.
    ///
    /// One attempt. A completion that fails — wrong proof, malformed proof,
    /// metadata that cannot exist — burns the ceremony to `Expired` and it
    /// stays burned even for a later, valid proof: an endpoint that mints
    /// credentials does not offer an unbounded retry loop, and guessing a
    /// 128-bit key was never the threat being managed here. The refusal is
    /// [`CompleteError::Refused`] for every cause, deliberately: telling a
    /// wrong proof from a closed window would tell a prober whether a live,
    /// claimed ceremony is on the table, and after the burn there is no
    /// difference left to report. Only entropy failure spares the ceremony —
    /// nothing the phone presented caused it.
    ///
    /// The two results go to two audiences: the handshake is this computer's
    /// to persist and serve from; the seal is the message the phone is
    /// waiting for — proof that the credential came from the computer that
    /// showed the square.
    pub fn complete(
        &mut self,
        declaration: PhoneDeclaration,
        now: SystemTime,
    ) -> Result<(Handshake, PairingSeal), CompleteError> {
        let Self::Claimed(claimed) = self else {
            return Err(CompleteError::NotClaimed);
        };
        let deadline = claimed.expires_at;
        if now >= deadline {
            *self = Self::Expired;
            return Err(CompleteError::Refused);
        }
        if !verify_phone_mac(&claimed.code, &claimed.nonce, &declaration.phone, &declaration.mac)
        {
            *self = Self::Expired;
            return Err(CompleteError::Refused);
        }
        let Some(phone) = declaration.phone.into_phone() else {
            *self = Self::Expired;
            return Err(CompleteError::Refused);
        };
        let credential = Credential::generate().map_err(|_| CompleteError::Entropy)?;
        let seal = seal_computer(&claimed.code, &claimed.nonce, &credential.hex());
        let handshake = Handshake::new(phone, credential);
        *self = Self::Paired;
        Ok((handshake, seal))
    }

    /// Retire the offer when its window closes on its own — the QR screen has
    /// to show "expired" whether or not anything ever claimed.
    pub fn expire_if_due(&mut self, now: SystemTime) {
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
