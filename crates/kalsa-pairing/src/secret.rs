//! The secret material of the ceremony: the one-time code the QR carries, and
//! the binding secret that ties the phone to *this* computer.
//!
//! Every secret is drawn from the operating system's entropy pool
//! (`getrandom`) — never from a timestamp, a counter, or a hash of something
//! the network has seen.
//!
//! The binding is symmetric, and the QR itself carries it. The QR holds a
//! fresh 256-bit binding secret next to the address and the one-time code;
//! when the phone claims the code, the computer answers with
//! `SHA-256(domain || binding || the phone's challenge || the code)`, which
//! the phone — holding the same binding secret from the QR — recomputes and
//! compares. This is aimed at the attacker the QR alone cannot stop: one on
//! the same network who can answer faster than the real computer (a squatted
//! hostname, ARP spoofing) but has *not* seen the QR. It lacks the binding
//! secret, and nothing it observed lets it compute the proof.
//!
//! What this does **not** protect against, said plainly:
//!
//! * whoever sees or photographs the QR holds the address, the code, and the
//!   binding secret, and for the rest of the window *is* the phone as far as
//!   this ceremony can tell. That is out of scope by the product's own
//!   definition of pairing — the ceremony is the scan;
//! * the proof says nothing about the transport: no confidentiality, no
//!   channel integrity. That is the connection's job;
//! * the code authenticates the phone to the computer only in the sense that
//!   whoever presents it is served. There is no phone identity before pairing.

use std::fmt;

use getrandom::fill;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use crate::error::EntropyError;

/// The one-time code is 128 bits, rendered as 32 hex characters in the QR —
/// short enough to scan comfortably, long enough that guessing inside the
/// window is hopeless.
const CODE_BYTES: usize = 16;
pub(crate) const BINDING_BYTES: usize = 32;

/// Domain separation, so a hash computed for one purpose can never verify in
/// another.
const PROOF_DOMAIN: &[u8] = b"kalsa-pairing/binding-proof/v1";

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
    pub(crate) fn matches_hex(&self, presented: &str) -> bool {
        let Ok(candidate) = hex::decode(presented) else {
            return false;
        };
        if candidate.len() != CODE_BYTES {
            return false;
        }
        let mut candidate_bytes = [0u8; CODE_BYTES];
        candidate_bytes.copy_from_slice(&candidate);
        bool::from(candidate_bytes.ct_eq(&self.bytes))
    }

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

pub(crate) struct BindingSecret {
    bytes: [u8; BINDING_BYTES],
}

impl BindingSecret {
    pub(crate) fn generate() -> Result<Self, EntropyError> {
        let mut bytes = [0u8; BINDING_BYTES];
        fill(&mut bytes).map_err(|_| EntropyError)?;
        Ok(Self { bytes })
    }

    /// The rendering the QR carries; the phone holds it and checks the proof
    /// against it.
    pub(crate) fn hex(&self) -> String {
        hex::encode(self.bytes)
    }

    /// The answer sent back when the phone claims the code: proof that this
    /// computer is the one the QR was about. The phone's challenge is mixed
    /// in so the proof is fresh for this exchange; the code, so it is bound
    /// to this pairing and to nothing else.
    pub(crate) fn answer(
        &self,
        challenge: &[u8; BINDING_BYTES],
        code: &OneTimeCode,
    ) -> [u8; BINDING_BYTES] {
        proof(&self.bytes, challenge, code.bytes())
    }
}

// Same reasoning as `OneTimeCode` above.
impl fmt::Debug for BindingSecret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("BindingSecret(_)")
    }
}

fn proof(
    binding: &[u8; BINDING_BYTES],
    challenge: &[u8; BINDING_BYTES],
    code: &[u8; CODE_BYTES],
) -> [u8; BINDING_BYTES] {
    let mut hasher = Sha256::new();
    hasher.update(PROOF_DOMAIN);
    hasher.update(binding);
    hasher.update(challenge);
    hasher.update(code);
    hasher.finalize().into()
}

/// What the phone does with the proof, kept as an executable definition so
/// the tests can stand on the verifier's side: recompute from what the QR
/// gave it, and compare in constant time. The phone is a separate artifact;
/// this pins the ceremony it must implement.
#[cfg(test)]
pub(crate) fn proof_matches(
    binding_hex: &str,
    challenge: &[u8; BINDING_BYTES],
    code_hex: &str,
    presented: &[u8; BINDING_BYTES],
) -> bool {
    let Ok(binding) = hex::decode(binding_hex) else {
        return false;
    };
    let Ok(binding) = <[u8; BINDING_BYTES]>::try_from(binding.as_slice()) else {
        return false;
    };
    let Ok(code) = hex::decode(code_hex) else {
        return false;
    };
    let Ok(code) = <[u8; CODE_BYTES]>::try_from(code.as_slice()) else {
        return false;
    };
    bool::from(presented.ct_eq(&proof(&binding, challenge, &code)))
}

#[cfg(test)]
mod tests {
    use super::{
        BindingSecret, OneTimeCode, proof_matches, BINDING_BYTES, CODE_BYTES,
    };

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
    fn the_secrets_are_the_announced_sizes() {
        let code = OneTimeCode::generate().unwrap();
        let binding = BindingSecret::generate().unwrap();
        assert_eq!(code.hex().len(), CODE_BYTES * 2);
        assert_eq!(binding.hex().len(), BINDING_BYTES * 2);
    }

    #[test]
    fn the_binding_proof_binds_the_challenge_and_the_code() {
        let binding = BindingSecret::generate().unwrap();
        let code = OneTimeCode::generate().unwrap();
        let first_challenge = [1u8; BINDING_BYTES];
        let second_challenge = [2u8; BINDING_BYTES];
        let answer = binding.answer(&first_challenge, &code);

        assert!(proof_matches(&binding.hex(), &first_challenge, &code.hex(), &answer));
        // A different challenge with the same answer: refused.
        assert!(!proof_matches(&binding.hex(), &second_challenge, &code.hex(), &answer));
        // A flipped bit in the answer: refused.
        let mut tampered = answer;
        tampered[0] ^= 1;
        assert!(!proof_matches(&binding.hex(), &first_challenge, &code.hex(), &tampered));
        // A different binding secret verifying the same answer: refused.
        let lookalike = BindingSecret::generate().unwrap();
        assert!(!proof_matches(&lookalike.hex(), &first_challenge, &code.hex(), &answer));
    }
}
