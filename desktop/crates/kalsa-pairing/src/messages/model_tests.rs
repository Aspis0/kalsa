use super::{verify_phone_mac_with_token, PhoneDeclaration, PhoneFields, CODE_BYTES, NONCE_BYTES};
use kalsa_catalog::{Parameters, PhoneModel};

const REACHABLE: &str = "http://192.168.1.10:4952";
const WITHOUT_MODEL: &str = r#"{"weights_bytes":2200000000,"parameters":{"total":7600000000,"active":2400000000},"measured_tokens_per_second":9.5,"battery_powered":true}"#;

fn phone() -> PhoneModel {
    PhoneModel {
        weights_bytes: 2_200_000_000,
        parameters: Some(Parameters::mixture(7_600_000_000, 2_400_000_000)),
        measured_tokens_per_second: Some(9.5),
        battery_powered: Some(true),
    }
}

fn code() -> String {
    hex::encode([0x31u8; CODE_BYTES])
}

fn nonce() -> String {
    hex::encode([0x32u8; NONCE_BYTES])
}

fn named(model: Option<&str>) -> PhoneDeclaration {
    PhoneDeclaration::sign_naming(&code(), &nonce(), REACHABLE, None, phone(), model)
        .expect("declaration")
}

#[test]
fn a_declaration_without_a_model_canonicalises_to_the_bytes_it_always_did() {
    assert_eq!(serde_json::to_string(&PhoneFields::of(phone())).unwrap(), WITHOUT_MODEL);
}

#[test]
fn a_named_declaration_carries_the_model_last_in_its_canonical_bytes() {
    let declared = named(Some("iPhone 15 Pro Max"));
    assert_eq!(
        serde_json::to_string(&declared.phone).unwrap(),
        format!(r#"{}{}"#, &WITHOUT_MODEL[..WITHOUT_MODEL.len() - 1], r#","model":"iPhone 15 Pro Max"}"#)
    );
}

#[test]
fn a_named_declaration_verifies_over_its_name() {
    let key = [0x31u8; CODE_BYTES];
    let nonce = [0x32u8; NONCE_BYTES];
    let declared = named(Some("iPhone 15 Pro Max"));
    assert!(verify_phone_mac_with_token(
        &key,
        &nonce,
        REACHABLE,
        "",
        declared.delivery_token(),
        &declared.phone,
        &declared.mac,
    ));
}

#[test]
fn a_name_changed_after_signing_fails_the_mac() {
    let key = [0x31u8; CODE_BYTES];
    let nonce = [0x32u8; NONCE_BYTES];
    let mut declared = named(Some("iPhone 15 Pro Max"));
    declared.phone.model = Some("Galaxy S23".to_owned());
    assert!(!verify_phone_mac_with_token(
        &key,
        &nonce,
        REACHABLE,
        "",
        declared.delivery_token(),
        &declared.phone,
        &declared.mac,
    ));
}

#[test]
fn a_desk_that_drops_the_name_refuses_the_declaration() {
    // What a desk that predates `model` does: it keeps the fields it knows,
    // canonicalises those, and checks the MAC against that. The phone signed
    // the name too, so the check fails — which is why the phone sends a name
    // only to a desk that advertised it.
    let key = [0x31u8; CODE_BYTES];
    let nonce = [0x32u8; NONCE_BYTES];
    let declared = named(Some("iPhone 15 Pro Max"));
    let older_desk = PhoneFields::of(phone());
    assert!(!verify_phone_mac_with_token(
        &key,
        &nonce,
        REACHABLE,
        "",
        declared.delivery_token(),
        &older_desk,
        &declared.mac,
    ));
}

#[test]
fn the_phone_bytes_with_a_model_parse_back_to_the_same_bytes() {
    // The MAC is recomputed from the parsed fields, so parsing the phone's
    // canonical JSON must give back exactly those bytes.
    let wire = format!(
        r#"{}{}"#,
        &WITHOUT_MODEL[..WITHOUT_MODEL.len() - 1],
        r#","model":"Galaxy S23"}"#
    );
    let parsed: PhoneFields = serde_json::from_str(&wire).expect("parses");
    assert_eq!(serde_json::to_string(&parsed).unwrap(), wire);
    assert_eq!(parsed.model(), Some("Galaxy S23"));
}

/// The canonical bytes of a non-ASCII name, frozen from the phone's own
/// encoder: `é`, an emoji and U+2028, which JSON leaves unescaped. The same
/// hex is pinned in `pairingWire.test.ts`; both sides must spell it alike.
const FROZEN_NON_ASCII_CANONICAL: &str = "7b22776569676874735f6279746573223a323230303030303030302c22706172616d6574657273223a7b22746f74616c223a373630303030303030302c22616374697665223a323430303030303030307d2c226d656173757265645f746f6b656e735f7065725f7365636f6e64223a392e352c22626174746572795f706f7765726564223a747275652c226d6f64656c223a22436166c3a920f09f9982e280a850726f227d";

#[test]
fn a_non_ascii_name_canonicalises_to_the_bytes_the_phone_signs() {
    let fields = PhoneFields::of(phone()).with_model(Some("Caf\u{e9} \u{1F642}\u{2028}Pro".to_owned()));
    assert_eq!(hex::encode(serde_json::to_vec(&fields).unwrap()), FROZEN_NON_ASCII_CANONICAL);
}
