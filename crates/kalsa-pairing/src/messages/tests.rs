use super::{phone_mac, seal_computer, verify_phone_mac, PhoneFields, MAC_BYTES, NONCE_BYTES};
use crate::handshake::Credential;
use crate::secret::OneTimeCode;
use kalsa_catalog::{Parameters, PhoneModel};

fn sample_phone() -> PhoneFields {
    PhoneFields::of(PhoneModel {
        weights_bytes: 2_200_000_000,
        parameters: Some(Parameters::mixture(7_600_000_000, 2_400_000_000)),
        measured_tokens_per_second: Some(9.5),
        battery_powered: Some(true),
    })
}

#[test]
fn the_primitive_is_hmac_sha256_as_rfc_4231_defines_it() {
    // RFC 4231, test case 1: key 0x0b repeated 20 times, data "Hi There".
    // With an empty domain and an empty nonce, `tag` is raw HMAC-SHA-256.
    let tag = super::tag(b"", &[0x0bu8; 20], &[], b"Hi There");
    assert_eq!(
        hex::encode(tag),
        "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
    );
}

#[test]
fn the_phone_tag_is_a_frozen_known_answer() {
    // Frozen from one real run and never recomputed by the test: if the
    // canonical serialization, the domain, the composition, or the
    // primitive drifts, this goes red and the drift is a deliberate
    // decision, not a phone that silently stops pairing. The second vector
    // freezes the node id in: a square that carries one and a square that
    // does not are different documents, and their tags must differ.
    let key = [0x31u8; super::CODE_BYTES];
    let nonce = [0x32u8; NONCE_BYTES];
    let reachable = "http://192.168.1.10:4952";
    let node = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    let mac = phone_mac(&key, &nonce, reachable, "", &sample_phone());
    let with_node = phone_mac(&key, &nonce, reachable, node, &sample_phone());
    assert_ne!(hex::encode(mac), hex::encode(with_node));
    // The same vectors verify through the ceremony's checking path.
    assert!(verify_phone_mac(
        &key,
        &nonce,
        reachable,
        "",
        &sample_phone(),
        FROZEN_PHONE_MAC_NO_NODE
    ));
    assert!(verify_phone_mac(
        &key,
        &nonce,
        reachable,
        node,
        &sample_phone(),
        FROZEN_PHONE_MAC_WITH_NODE
    ));
    // The composition has one deliberate change on record: the fields were
    // once concatenated bare, and two (reachable, node) pairs that shifted
    // the boundary between them produced the same MAC. Those old digests
    // are frozen too, and their refusal is the recorded decision — not a
    // regression.
    assert!(!verify_phone_mac(
        &key,
        &nonce,
        reachable,
        "",
        &sample_phone(),
        FROZEN_PHONE_MAC_NO_NODE_FLAT_CONCAT
    ));
    assert!(!verify_phone_mac(
        &key,
        &nonce,
        reachable,
        node,
        &sample_phone(),
        FROZEN_PHONE_MAC_WITH_NODE_FLAT_CONCAT
    ));
}

/// The v3 recipe's known answers: square without and with the node id.
/// Frozen from one real run; recomputing them is a deliberate recipe
/// change and goes through review.
// The first freeze: bare concatenation of the fields. Replaced the same
// day it was born, when the boundary between reachable and node proved
// shiftable into a shared digest.
const FROZEN_PHONE_MAC_NO_NODE_FLAT_CONCAT: &str =
    "54efe7d7cb77c19b34faa1ba6c85389ac7bf8129bfaf8a635465dba6e56e54a6";
const FROZEN_PHONE_MAC_WITH_NODE_FLAT_CONCAT: &str =
    "05c5ab9f3eab4049e44f4c67edaec8d08c527a353f71b89f28a9bc7a7ebdbf06";
// The current freeze: length-delimited fields.
const FROZEN_PHONE_MAC_NO_NODE: &str =
    "51e82d91c365352b430a40533ec8ea76966762ac1413557712e110889b44905e";
const FROZEN_PHONE_MAC_WITH_NODE: &str =
    "0503754d7ad8a465ffcf82506231bf961da877ff802087c8f8c5756da0de0d83";
// The delivery-bearing claim's freeze: the same recipe with the token
// MAC'd in ahead of the phone's fields. Sent to the phone team with the
// reachable below - a vector's strings are opaque, so the reachable keeps
// the port it was frozen with even though this computer's desk has since
// moved off it.
const FROZEN_PHONE_MAC_WITH_DELIVERY_TOKEN: &str =
    "ad34a8b2731b0a0e3d41f09d498e4f206333c1c1a67d3421f62b0659324f4132";

#[test]
fn the_delivery_bearing_claim_is_a_frozen_known_answer() {
    let key = [0x31u8; super::CODE_BYTES];
    let nonce = [0x32u8; NONCE_BYTES];
    let mac = super::phone_mac_with_token(
        &key,
        &nonce,
        "http://127.0.0.1:8132",
        "",
        "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0",
        &sample_phone(),
    );
    assert_eq!(hex::encode(mac), FROZEN_PHONE_MAC_WITH_DELIVERY_TOKEN);
}

#[test]
fn the_computer_seal_is_a_frozen_known_answer() {
    let key = [0x41u8; super::CODE_BYTES];
    let nonce = [0x42u8; NONCE_BYTES];
    let credential = Credential::from_hex(&"ab".repeat(32)).unwrap();
    let seal = seal_computer(&key, &nonce, &credential);
    assert_eq!(
        seal.mac,
        "6d86a29391e258de9bb13dae9ceb3612143c4448050562a36ad2e6ac8dd4a849"
    );
    // The credential's ciphertext beside its tag: the phone team's second
    // vector, frozen from the same run their first one came from.
    assert_eq!(
        seal.credential_ciphertext,
        "19d0b3455e311a70ba202aea83ea569e8127f2f1936f67bdc557439a82222ba7"
    );
}

#[test]
fn the_seal_delivers_only_an_encrypted_credential_and_authenticates_it() {
    let key = [0x51u8; super::CODE_BYTES];
    let nonce = [0x52u8; NONCE_BYTES];
    let credential = Credential::from_hex(&"ab".repeat(32)).unwrap();
    let seal = seal_computer(&key, &nonce, &credential);

    assert_ne!(seal.credential_ciphertext, credential.hex());
    assert_eq!(
        seal.open(&hex::encode(key), &hex::encode(nonce)),
        Some(credential.hex())
    );

    let mut tampered = seal.clone();
    let mut bytes = hex::decode(&tampered.credential_ciphertext).unwrap();
    bytes[0] ^= 1;
    tampered.credential_ciphertext = hex::encode(bytes);
    assert!(tampered
        .open(&hex::encode(key), &hex::encode(nonce))
        .is_none());
}

#[test]
fn a_valid_mac_verifies_and_a_single_flipped_bit_does_not() {
    let code = OneTimeCode::generate().unwrap();
    let nonce = [7u8; NONCE_BYTES];
    let phone = sample_phone();
    let mut mac = phone_mac(code.bytes(), &nonce, "http://192.168.1.10:4952", "", &phone);

    assert!(verify_phone_mac(
        code.bytes(),
        &nonce,
        "http://192.168.1.10:4952",
        "",
        &phone,
        &hex::encode(mac)
    ));
    mac[0] ^= 0x01;
    assert!(!verify_phone_mac(
        code.bytes(),
        &nonce,
        "http://192.168.1.10:4952",
        "",
        &phone,
        &hex::encode(mac)
    ));
    // And a presentation that is not even hex is the same "no".
    assert!(!verify_phone_mac(
        code.bytes(),
        &nonce,
        "http://192.168.1.10:4952",
        "",
        &phone,
        "not hex"
    ));
}

#[test]
fn metadata_altered_after_the_mac_does_not_verify() {
    let code = OneTimeCode::generate().unwrap();
    let nonce = [3u8; NONCE_BYTES];
    let reachable = "http://192.168.1.10:4952";
    let mac = phone_mac(code.bytes(), &nonce, reachable, "", &sample_phone());

    let altered = PhoneFields::of(PhoneModel {
        weights_bytes: 2_200_000_001,
        parameters: Some(Parameters::mixture(7_600_000_000, 2_400_000_000)),
        measured_tokens_per_second: Some(9.5),
        battery_powered: Some(true),
    });
    assert!(
        !verify_phone_mac(code.bytes(), &nonce, reachable, "", &altered, &hex::encode(mac)),
        "the metadata is bound, not asserted"
    );
}

#[test]
fn an_address_altered_after_the_mac_does_not_verify() {
    let code = OneTimeCode::generate().unwrap();
    let nonce = [4u8; NONCE_BYTES];
    let mac = phone_mac(
        code.bytes(),
        &nonce,
        "http://192.168.1.10:4952",
        "",
        &sample_phone(),
    );
    // The address rode in the square, so it rides in the MAC.
    assert!(!verify_phone_mac(
        code.bytes(),
        &nonce,
        "http://192.168.1.66:1",
        "",
        &sample_phone(),
        &hex::encode(mac)
    ));
}

#[test]
fn two_pairs_of_fields_that_concatenate_identically_produce_different_macs() {
    // The composition's own property, independent of who validates what:
    // two DIFFERENT (reachable, node) pairs whose naive concatenation is
    // byte-identical — the boundary between the two fields has moved one
    // character — must produce two different MACs. The second pair's node
    // is one character longer than a legal node id on purpose: the recipe
    // cannot lean on somebody else's validation to make its fields
    // unambiguous.
    let key = [0x77u8; super::CODE_BYTES];
    let nonce = [0x78u8; NONCE_BYTES];
    let phone = sample_phone();

    let tail = "2".repeat(63);
    let pair_a = ("http://a.b:49", format!("5{tail}"));
    let pair_b = ("http://a.b:4", format!("95{tail}"));

    // The trap this test is aimed at: the two naive concatenations are the
    // same bytes.
    assert_eq!(
        format!("{}{}", pair_a.0, pair_a.1),
        format!("{}{}", pair_b.0, pair_b.1)
    );

    let mac_a = phone_mac(&key, &nonce, pair_a.0, &pair_a.1, &phone);
    let mac_b = phone_mac(&key, &nonce, pair_b.0, &pair_b.1, &phone);
    assert_ne!(
        hex::encode(mac_a),
        hex::encode(mac_b),
        "shifted field boundaries produced the same MAC: the composition is ambiguous"
    );
}

#[test]
fn a_node_id_swapped_in_the_square_does_not_verify() {
    // The pairing hijack this field exists to stop: the machine showed node
    // A, an attacker replaced it with node B on screen, and the phone,
    // faithfully signing what it scanned, presents a declaration MACed over
    // B. The computer — which showed A — must refuse it, exactly as it
    // refuses a swapped address. The same refusal covers a declaration
    // MACed over "no node" where the square showed one.
    let key = [0x71u8; super::CODE_BYTES];
    let nonce = [0x72u8; NONCE_BYTES];
    let reachable = "http://192.168.1.10:4952";
    let shown = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    let swapped = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    let phone = sample_phone();

    let honest = verify_phone_mac(
        &key,
        &nonce,
        reachable,
        shown,
        &phone,
        &hex::encode(phone_mac(&key, &nonce, reachable, shown, &phone)),
    );
    assert!(honest, "the honest square must verify");

    let hijacked = verify_phone_mac(
        &key,
        &nonce,
        reachable,
        shown,
        &phone,
        &hex::encode(phone_mac(&key, &nonce, reachable, swapped, &phone)),
    );
    assert!(
        !hijacked,
        "a swapped node id paired the phone with an attacker"
    );

    let absent = verify_phone_mac(
        &key,
        &nonce,
        reachable,
        shown,
        &phone,
        &hex::encode(phone_mac(&key, &nonce, reachable, "", &phone)),
    );
    assert!(
        !absent,
        "a node-less declaration passed where the square showed a node id"
    );
}

#[test]
fn the_computers_mac_is_never_the_phones() {
    let code = OneTimeCode::generate().unwrap();
    let nonce = [5u8; NONCE_BYTES];
    let phone = sample_phone();
    let phone_tag = phone_mac(code.bytes(), &nonce, "http://192.168.1.10:4952", "", &phone);

    // Domain separation, isolated: the SAME bytes under the two domains must
    // produce different tags. If only the payload distinguishes the roles,
    // this is where it shows.
    let ciphertext = hex::decode("ab".repeat(32)).unwrap();
    let computer_tag = super::computer_mac(code.bytes(), &nonce, &ciphertext);
    assert_ne!(hex::encode(computer_tag), hex::encode(phone_tag));

    let credential = Credential::from_hex(&"ab".repeat(32)).unwrap();
    let seal = seal_computer(code.bytes(), &nonce, &credential);
    // The computer's answer is not accepted where the phone's is expected.
    assert!(!verify_phone_mac(
        code.bytes(),
        &nonce,
        "http://192.168.1.10:4952",
        "",
        &phone,
        &seal.mac
    ));
    assert!(verify_phone_mac(
        code.bytes(),
        &nonce,
        "http://192.168.1.10:4952",
        "",
        &phone,
        &hex::encode(phone_tag)
    ));
}

#[test]
fn a_mac_is_worthless_under_a_different_nonce() {
    let code = OneTimeCode::generate().unwrap();
    let phone = sample_phone();
    let mac = phone_mac(
        code.bytes(),
        &[1u8; NONCE_BYTES],
        "http://192.168.1.10:4952",
        "",
        &phone,
    );

    // The nonce is what ties the proof to one offer: recorded and replayed
    // against any other offer — or this one after a re-offer — it refuses.
    assert!(!verify_phone_mac(
        code.bytes(),
        &[2u8; NONCE_BYTES],
        "http://192.168.1.10:4952",
        "",
        &phone,
        &hex::encode(mac)
    ));
}

// MAC_BYTES is referenced through the sized decode inside verify; keep the
// import honest with a compile-time touch.
const _: () = assert!(MAC_BYTES == 32);
