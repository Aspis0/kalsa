//! What the QR encodes: one versioned JSON document with everything the phone
//! needs — the address this computer advertises, the one-time code the
//! whole completion protocol is keyed on, the per-offer nonce both MACs
//! cover, and
//! — when this machine has its internet road open — the node id the phone
//! dials that road by. The version field comes first: a phone that meets a
//! `v` it does not know refuses the whole document instead of guessing at
//! the fields.
//!
//! Only `encode` lives here, because only the desktop writes the QR. The
//! tests parse what it wrote with a generic JSON reader, so the format is
//! pinned without this crate pretending to be the phone.

use serde::Serialize;

use crate::messages::NONCE_BYTES;
use crate::secret::OneTimeCode;

/// Version 3, and there is no version 2 to stay compatible with: no phone
/// has ever read one of these squares, and a version whose meaning depends
/// on an optional field is two documents wearing one name. A `v: 2` square
/// is refused whole by anything that speaks this version.
const VERSION: u8 = 3;

// No Debug on purpose: this struct holds the code in the clear — that is its
// job, in the QR and nowhere else. A compile error beats a derived Debug the
// day someone logs a payload.
#[derive(Serialize)]
struct QrPayloadV3 {
    v: u8,
    /// The address this computer advertises for the ceremony: the pairing
    /// desk's own loopback bind (`http://127.0.0.1:8134`, built by the
    /// shell from the listener — nothing is opened on the LAN). The phone
    /// never dials it — it arrives through the tunnel — but it MACs
    /// `reachable` like everything else the square showed, so both sides
    /// still hold the same string.
    reachable: String,
    /// The one-time code, hex. Single use; keyed on for both completion MACs.
    code: String,
    /// The per-offer nonce, hex — fresh with every QR, covered by the phone's
    /// and the computer's MACs alike (`messages`).
    nonce: String,
    /// The iroh node id of this machine, hex — present only while the
    /// internet road is open. The phone dials the inference road by these 32
    /// public bytes after pairing, and the completion MAC covers them: a
    /// square whose node id was swapped pairs with nobody. Absent — the
    /// field itself, not an empty string — whenever the road is not open:
    /// offering an identity the machine is not announcing would be a
    /// promise the square cannot keep. The next refresh of the square
    /// carries it once the road is up.
    #[serde(skip_serializing_if = "Option::is_none")]
    node: Option<String>,
}

/// The QR's content, or `None` if serialization failed — for a plain struct
/// of strings it cannot, but a desktop app does not get to bet on "cannot":
/// `None` just means there is no QR to show.
pub(crate) fn encode(
    reachable: &str,
    code: &OneTimeCode,
    nonce: &[u8; NONCE_BYTES],
    node: Option<&str>,
) -> Option<String> {
    serde_json::to_string(&QrPayloadV3 {
        v: VERSION,
        reachable: reachable.to_string(),
        code: code.hex(),
        nonce: hex::encode(nonce),
        node: node.map(str::to_string),
    })
    .ok()
}

#[cfg(test)]
mod tests {
    use super::{encode, OneTimeCode, NONCE_BYTES};

    const REACHABLE: &str = "http://192.168.1.10:4952";
    const NODE: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

    #[test]
    fn the_qr_names_its_version_and_carries_both_secrets() {
        let code = OneTimeCode::generate().unwrap();
        let nonce = [9u8; NONCE_BYTES];
        let json = encode(REACHABLE, &code, &nonce, None).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(value["v"], 3);
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
    fn an_open_road_rides_in_the_square() {
        let code = OneTimeCode::generate().unwrap();
        let json = encode(REACHABLE, &code, &[7u8; NONCE_BYTES], Some(NODE)).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["node"], NODE);
        assert_eq!(value["node"].as_str().unwrap().len(), 64);
    }

    #[test]
    fn a_road_that_is_not_open_promises_nothing() {
        // With the road absent, the field itself is absent — not an empty
        // string, not a placeholder. A square that named a node id while the
        // machine announces nothing would promise what it cannot keep.
        let code = OneTimeCode::generate().unwrap();
        let json = encode(REACHABLE, &code, &[7u8; NONCE_BYTES], None).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(
            value.get("node").is_none(),
            "the square offered a node id with the road off: {}",
            json
        );
    }

    #[test]
    fn every_offer_is_fresh() {
        let first = encode(
            REACHABLE,
            &OneTimeCode::generate().unwrap(),
            &[1u8; NONCE_BYTES],
            None,
        )
        .unwrap();
        let second = encode(
            REACHABLE,
            &OneTimeCode::generate().unwrap(),
            &[2u8; NONCE_BYTES],
            None,
        )
        .unwrap();
        assert_ne!(first, second);
    }
}
