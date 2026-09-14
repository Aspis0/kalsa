//! What the QR encodes: one versioned JSON document with everything the phone
//! needs — how to reach this computer, the one-time code, and the binding
//! secret that lets it tell this computer from a look-alike on the same
//! network. The version field comes first: a phone that meets a `v` it does
//! not know refuses the whole document instead of guessing at the fields.
//!
//! Only `encode` lives here, because only the desktop writes the QR. The
//! tests parse what it wrote with a generic JSON reader, so the format is
//! pinned without this crate pretending to be the phone.

use serde::Serialize;

use crate::secret::{BindingSecret, OneTimeCode};

const VERSION: u8 = 1;

// No Debug on purpose: this struct holds the code and the binding in the
// clear — that is its job, in the QR and nowhere else. A compile error beats
// a derived Debug the day someone logs a payload.
#[derive(Serialize)]
struct QrPayloadV1 {
    v: u8,
    /// How the phone reaches this computer on the LAN. Version 1 carries it
    /// as a URL (for example `http://192.168.1.10:4952`); the computer's
    /// transport decides what goes here.
    reachable: String,
    /// The one-time code, hex. Single use; see `ceremony`.
    code: String,
    /// The binding secret, hex — see `secret` for what it does and does not
    /// buy.
    binding: String,
}

/// The QR's content, or `None` if serialization failed — for a plain struct
/// of strings it cannot, but a desktop app does not get to bet on "cannot":
/// `None` just means there is no QR to show.
pub(crate) fn encode(
    code: &OneTimeCode,
    binding: &BindingSecret,
    reachable: &str,
) -> Option<String> {
    serde_json::to_string(&QrPayloadV1 {
        v: VERSION,
        reachable: reachable.to_string(),
        code: code.hex(),
        binding: binding.hex(),
    })
    .ok()
}

#[cfg(test)]
mod tests {
    use super::{BindingSecret, OneTimeCode, encode};

    const REACHABLE: &str = "http://192.168.1.10:4952";

    #[test]
    fn the_qr_names_its_version_and_carries_both_secrets() {
        let code = OneTimeCode::generate().unwrap();
        let binding = BindingSecret::generate().unwrap();
        let json = encode(&code, &binding, REACHABLE).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(value["v"], 1);
        assert_eq!(value["reachable"], REACHABLE);
        let code_hex = value["code"].as_str().unwrap();
        let binding_hex = value["binding"].as_str().unwrap();
        assert_eq!(code_hex.len(), 32);
        assert_eq!(binding_hex.len(), 64);
        assert!(code_hex.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(binding_hex.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn every_offer_is_fresh() {
        let first = encode(&OneTimeCode::generate().unwrap(), &BindingSecret::generate().unwrap(), REACHABLE).unwrap();
        let second = encode(&OneTimeCode::generate().unwrap(), &BindingSecret::generate().unwrap(), REACHABLE).unwrap();
        assert_ne!(first, second);
    }
}
