//! The secret material of the ceremony: the one-time code the QR carries,
//! which both directions of the completion protocol are keyed on.
//!
//! Every secret is drawn from the operating system's entropy pool
//! (`getrandom`) — never from a timestamp, a counter, or a hash of something
//! the network has seen.
//!
//! The completion proof is symmetric and keyed on this one secret, with the
//! domains kept apart (`messages`). The QR carries the code, a per-offer
//! nonce, and the address; the phone completes with `HMAC(code,
//! "…/phone-mac/v2" ‖ nonce ‖ address ‖ metadata)` and the computer answers
//! `HMAC(code, "…/computer-mac/v2" ‖ nonce ‖ credential)`. The first binds
//! the phone's metadata to knowledge of the code; the second binds the
//! delivered credential to it. This is aimed at the attacker the QR alone
//! cannot stop: one on the same network who can answer faster than the real
//! computer (a squatted hostname, ARP spoofing) but has *not* seen the QR.
//! It lacks the code, and nothing it observed lets it compute either MAC.
//!
//! What the MACs prove — and their ceiling, said exactly: they prove
//! **knowledge of the square**, nothing more. Key and nonce ride the QR, so
//! whoever can see it can compute either MAC; the domains separate the two
//! *messages*, not two *parties*. "The computer answered" and "the phone
//! completed" both ever mean "someone who scanned the square did". The
//! pairing screen says the same thing to the user: anyone who can see this
//! square can connect a phone.
//!
//! What this does **not** protect against, said plainly:
//!
//! * whoever sees or photographs the QR holds the address, the code, and the
//!   nonce, and for the rest of the window *is* the phone as far as this
//!   ceremony can tell. That is out of scope by the product's own definition
//!   of pairing — the ceremony is the scan;
//! * the MACs say nothing about the transport: no confidentiality, no
//!   channel integrity. That is the connection's job;
//! * the only thing the ceremony ever learns about the completer is
//!   knowledge of the QR. That is a real gate — the code is 128 bits, single
//!   use, and the proof is one-shot — but it is not identity, and the
//!   transport still owes endpoint confinement (a LAN interface, not
//!   0.0.0.0) and rate-limited claims, because this crate cannot provide
//!   either.
//!
//! Why there is no `zeroize` here — decided, not forgotten. Wiping arrays
//! defends against heap disclosure: crash dumps, swap, reuse of freed
//! memory. This crate cannot buy that by halves. The credential the ceremony
//! produces sits for its whole life in a 0600 file on the same disk, and the
//! QR path is *supposed* to hold the payload in the clear; an attacker who
//! can read this process's memory can read that file, so wiping the heap
//! would move the secret from two places to one, not from reachable to safe
//! — while the SVG string, the hex renderings, and the serializer buffers
//! stay outside any array's reach anyway. What the crate does instead is
//! bound the exposure: the code lives exactly as long as the ceremony can
//! still complete — carried through `Claimed` because the completion proof
//! is keyed on it, dropped at `Paired`, burned with the ceremony on any
//! refusal. If the store ever moves behind OS keychain encryption, this
//! calculus changes and `zeroize` earns its place; until then, adding it
//! would be ritual, not defense.

use std::fmt;

use getrandom::fill;
use subtle::ConstantTimeEq;

use crate::error::EntropyError;

/// The one-time code is 128 bits, rendered as 32 hex characters in the QR —
/// short enough to scan comfortably, long enough that guessing inside the
/// window is hopeless.
pub(crate) const CODE_BYTES: usize = 16;

pub(crate) struct OneTimeCode {
    bytes: [u8; CODE_BYTES],
}

impl OneTimeCode {
    pub(crate) fn generate() -> Result<Self, EntropyError> {
        let mut bytes = [0u8; CODE_BYTES];
        fill(&mut bytes).map_err(|_| EntropyError)?;
        Ok(Self { bytes })
    }

    /// The rendering the QR carries.
    pub(crate) fn hex(&self) -> String {
        hex::encode(self.bytes)
    }

    /// Constant-time comparison against what was presented. A malformed or
    /// wrong-length presentation is simply "no match": the length of the code
    /// is public anyway (it is on the QR), and nothing here says how close a
    /// guess was.
    ///
    /// The length is refused *before* anything is decoded, and `decode_to_slice`
    /// writes only into this fixed array, so a peer presenting megabytes of
    /// hex buys no allocation here. That is not the request limit: this crate
    /// has no transport, and whoever builds it still owes a bound on request
    /// size. This check only keeps the code comparison from being the lens.
    pub(crate) fn matches_hex(&self, presented: &str) -> bool {
        let mut candidate = [0u8; CODE_BYTES];
        match hex::decode_to_slice(presented, &mut candidate) {
            Ok(()) => bool::from(candidate.ct_eq(&self.bytes)),
            Err(_) => false,
        }
    }

    /// The HMAC key of the completion protocol (`messages`).
    pub(crate) fn bytes(&self) -> &[u8; CODE_BYTES] {
        &self.bytes
    }
}

// A derived Debug would print the code the first time anything logged the
// struct — a class of leak this project has already been bitten by. The
// placeholder is deliberate, and this hand-written impl is the only Debug the
// type will ever have.
impl fmt::Debug for OneTimeCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("OneTimeCode(_)")
    }
}

#[cfg(test)]
mod tests {
    use super::{OneTimeCode, CODE_BYTES};

    #[test]
    fn the_code_matches_only_itself() {
        let code = OneTimeCode::generate().unwrap();
        let other = OneTimeCode::generate().unwrap();
        assert!(code.matches_hex(&code.hex()));
        assert!(!code.matches_hex(&other.hex()));
        assert!(!code.matches_hex("not hex at all"));
        assert!(!code.matches_hex(&code.hex()[..30]));
    }

    #[test]
    fn an_oversized_presentation_is_just_a_rejection() {
        let code = OneTimeCode::generate().unwrap();
        // A megabyte of presentation that carries the real code as a prefix:
        // still one plain "no". The length gate must refuse what cannot be
        // the code *before* anything decodes it — a peer paying in bytes
        // must not buy partial credit.
        let prefix = code.hex() + &"0".repeat(2_000_000);
        assert!(!code.matches_hex(&prefix));
        // And the same for junk that is merely big.
        assert!(!code.matches_hex(&"z".repeat(2_000_000)));
    }

    #[test]
    fn the_code_is_the_announced_size() {
        let code = OneTimeCode::generate().unwrap();
        assert_eq!(code.hex().len(), CODE_BYTES * 2);
    }
}
