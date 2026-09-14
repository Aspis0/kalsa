use super::{phone_mac, seal_computer, verify_phone_mac, PhoneFields, NONCE_BYTES};
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
fn a_valid_mac_verifies_and_a_single_flipped_bit_does_not() {
    let code = OneTimeCode::generate().unwrap();
    let nonce = [7u8; NONCE_BYTES];
    let phone = sample_phone();
    let mut mac = phone_mac(code.bytes(), &nonce, &phone);

    assert!(verify_phone_mac(&code, &nonce, &phone, &hex::encode(mac)));
    mac[0] ^= 0x01;
    assert!(!verify_phone_mac(&code, &nonce, &phone, &hex::encode(mac)));
    // And a presentation that is not even hex is the same "no".
    assert!(!verify_phone_mac(&code, &nonce, &phone, "not hex"));
}

#[test]
fn metadata_altered_after_the_mac_does_not_verify() {
    let code = OneTimeCode::generate().unwrap();
    let nonce = [3u8; NONCE_BYTES];
    let mac = phone_mac(code.bytes(), &nonce, &sample_phone());

    let mut altered = sample_phone();
    altered.weights_bytes += 1;
    assert!(
        !verify_phone_mac(&code, &nonce, &altered, &hex::encode(mac)),
        "the metadata is bound, not asserted"
    );
}

#[test]
fn the_computers_mac_is_never_the_phones() {
    let code = OneTimeCode::generate().unwrap();
    let nonce = [5u8; NONCE_BYTES];
    let phone = sample_phone();
    let phone_tag = phone_mac(code.bytes(), &nonce, &phone);

    // Domain separation, isolated: the SAME bytes under the two domains —
    // the canonical metadata fed to both — must produce different tags. If
    // only the domain distinguishes the roles, this is where it shows.
    let canonical = serde_json::to_vec(&phone).unwrap();
    let computer_tag = seal_computer(&code, &nonce, std::str::from_utf8(&canonical).unwrap());
    assert_ne!(computer_tag.mac, hex::encode(phone_tag));

    let seal = seal_computer(&code, &nonce, &"ab".repeat(32));
    // The computer's answer is not accepted where the phone's is expected.
    assert!(!verify_phone_mac(&code, &nonce, &phone, &seal.mac));
    assert!(verify_phone_mac(&code, &nonce, &phone, &hex::encode(phone_tag)));
}

#[test]
fn a_mac_is_worthless_under_a_different_nonce() {
    let code = OneTimeCode::generate().unwrap();
    let phone = sample_phone();
    let mac = phone_mac(code.bytes(), &[1u8; NONCE_BYTES], &phone);

    // The nonce is what ties the proof to one offer: recorded and replayed
    // against any other offer — or this one after a re-offer — it refuses.
    assert!(!verify_phone_mac(
        &code,
        &[2u8; NONCE_BYTES],
        &phone,
        &hex::encode(mac)
    ));
}
