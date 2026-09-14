//! What the QR encodes: one versioned JSON document with everything the
//! phone needs — how to reach this computer, the one-time code the whole
//! completion protocol is keyed on, and the per-offer nonce both MACs cover.
//! The version field comes first: a phone that meets a `v` it does not know
//! refuses the whole document instead of guessing at the fields.
//!
//! Only `encode` lives here, because only the desktop writes the QR. The
//! tests parse what it wrote with a generic JSON reader, so the format is
//! pinned without this crate pretending to be the phone.

use serde::Serialize;

use crate::messages::NONCE_BYTES;
use crate::secret::OneTimeCode;

const VERSION: u8 = 2;

// No Debug on purpose: this struct holds the code in the clear — that is its
// job, in the QR and nowhere else. A compile error beats a derived Debug the
// day someone logs a payload.
#[derive(Serialize)]
struct QrPayloadV2 {
    v: u8,
    /// How the phone reaches this computer on the LAN. Version 2 carries it
    /// as a URL (for example `http://192.168.1.10:4952`); the computer's
    /// transport decides what goes here.
    reachable: String,
    /// The one-time code, hex. Single use; keyed on for both completion MACs.
    code: String,
    /// The per-offer nonce, hex — fresh with every QR, covered by the phone's
    /// and the computer's MACs alike (`messages`).
    nonce: String,
}

/// The QR's content, or `None` if serialization failed — for a plain struct
/// of strings it cannot, but a desktop app does not get to bet on "cannot":
/// `None` just means there is no QR to show.
pub(crate) fn encode(
    code: &OneTimeCode,
    nonce: &[u8; NONCE_BYTES],
    reachable: &str,
) -> Option<String> {
    serde_json::to_string(&QrPayloadV2 {
        v: VERSION,
        reachable: reachable.to_string(),
        code: code.hex(),
        nonce: hex::encode(nonce),
    })
    .ok()
}

#[cfg(test)]
mod tests {
    use super::{encode, OneTimeCode, NONCE_BYTES};

    const REACHABLE: &str = "http://192.168.1.10:4952";

    #[test]
    fn the_qr_names_its_version_and_carries_both_secrets() {
        let code = OneTimeCode::generate().unwrap();
        let nonce = [9u8; NONCE_BYTES];
        let json = encode(&code, &nonce, REACHABLE).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(value["v"], 2);
        assert_eq!(value["reachable"], REACHABLE);
        let code_hex = value["code"].as_str().unwrap();
        let nonce_hex = value["nonce"].as_str().unwrap();
        assert_eq!(code_hex.len(), 32);
        assert_eq!(nonce_hex.len(), 64);
        assert_eq!(nonce_hex, hex::encode(nonce));
        assert!(code_hex.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(nonce_hex.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn every_offer_is_fresh() {
        let first = encode(&OneTimeCode::generate().unwrap(), &[1u8; NONCE_BYTES], REACHABLE)
            .unwrap();
        let second = encode(&OneTimeCode::generate().unwrap(), &[2u8; NONCE_BYTES], REACHABLE)
            .unwrap();
        assert_ne!(first, second);
    }
}
