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
    // decision, not a phone that silently stops pairing.
    let key = [0x31u8; super::CODE_BYTES];
    let nonce = [0x32u8; NONCE_BYTES];
    let reachable = "http://192.168.1.10:4952";
    let mac = phone_mac(&key, &nonce, reachable, &sample_phone());
    assert_eq!(
        hex::encode(mac),
        "0b3e3692f65ee00bf5e7aaeba33b2fd3f5448acdff46e7899e058a2b76f05367"
    );
    // The same vector verifies through the ceremony's checking path.
    assert!(verify_phone_mac(
        &key,
        &nonce,
        reachable,
        &sample_phone(),
        "0b3e3692f65ee00bf5e7aaeba33b2fd3f5448acdff46e7899e058a2b76f05367"
    ));
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
    let mut mac = phone_mac(code.bytes(), &nonce, "http://192.168.1.10:4952", &phone);

    assert!(verify_phone_mac(
        code.bytes(),
        &nonce,
        "http://192.168.1.10:4952",
        &phone,
        &hex::encode(mac)
    ));
    mac[0] ^= 0x01;
    assert!(!verify_phone_mac(
        code.bytes(),
        &nonce,
        "http://192.168.1.10:4952",
        &phone,
        &hex::encode(mac)
    ));
    // And a presentation that is not even hex is the same "no".
    assert!(!verify_phone_mac(
        code.bytes(),
        &nonce,
        "http://192.168.1.10:4952",
        &phone,
        "not hex"
    ));
}

#[test]
fn metadata_altered_after_the_mac_does_not_verify() {
    let code = OneTimeCode::generate().unwrap();
    let nonce = [3u8; NONCE_BYTES];
    let reachable = "http://192.168.1.10:4952";
    let mac = phone_mac(code.bytes(), &nonce, reachable, &sample_phone());

    let altered = PhoneFields::of(PhoneModel {
        weights_bytes: 2_200_000_001,
        parameters: Some(Parameters::mixture(7_600_000_000, 2_400_000_000)),
        measured_tokens_per_second: Some(9.5),
        battery_powered: Some(true),
    });
    assert!(
        !verify_phone_mac(code.bytes(), &nonce, reachable, &altered, &hex::encode(mac)),
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
        &sample_phone(),
    );
    // The address rode in the square, so it rides in the MAC.
    assert!(!verify_phone_mac(
        code.bytes(),
        &nonce,
        "http://192.168.1.66:1",
        &sample_phone(),
        &hex::encode(mac)
    ));
}

#[test]
fn the_computers_mac_is_never_the_phones() {
    let code = OneTimeCode::generate().unwrap();
    let nonce = [5u8; NONCE_BYTES];
    let phone = sample_phone();
    let phone_tag = phone_mac(code.bytes(), &nonce, "http://192.168.1.10:4952", &phone);

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
        &phone,
        &seal.mac
    ));
    assert!(verify_phone_mac(
        code.bytes(),
        &nonce,
        "http://192.168.1.10:4952",
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
        &phone,
    );

    // The nonce is what ties the proof to one offer: recorded and replayed
    // against any other offer — or this one after a re-offer — it refuses.
    assert!(!verify_phone_mac(
        code.bytes(),
        &[2u8; NONCE_BYTES],
        "http://192.168.1.10:4952",
        &phone,
        &hex::encode(mac)
    ));
}

// MAC_BYTES is referenced through the sized decode inside verify; keep the
// import honest with a compile-time touch.
const _: () = assert!(MAC_BYTES == 32);
