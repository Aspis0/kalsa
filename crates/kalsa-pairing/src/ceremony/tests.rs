use std::time::{Duration, SystemTime};

use super::{ClaimResult, Pairing};
use crate::error::{CompleteError, OfferError, StoreError};
use crate::messages::{phone_mac_with_token, PhoneDeclaration, PhoneFields, NONCE_BYTES};
use crate::secret::OneTimeCode;
use kalsa_catalog::{Parameters, PhoneModel};

const TTL: Duration = Duration::from_secs(300);
const REACHABLE: &str = "http://192.168.1.10:4952";
const ELSEWHERE: &str = "http://192.168.1.66:1";

fn offered() -> (Pairing, SystemTime) {
    let start = SystemTime::now();
    (Pairing::offer(REACHABLE, None, start, TTL).unwrap(), start)
}

fn offered_with_node(node: Option<&str>) -> (Pairing, SystemTime) {
    let start = SystemTime::now();
    (
        Pairing::offer(REACHABLE, node, start, TTL).unwrap(),
        start,
    )
}

/// The code and the nonce, exactly as the QR carried them.
fn qr_secrets(session: &Pairing) -> (String, String) {
    let json = session.qr_payload().unwrap();
    let value: serde_json::Value = serde_json::from_str(&json).unwrap();
    (
        value["code"].as_str().unwrap().to_string(),
        value["nonce"].as_str().unwrap().to_string(),
    )
}

fn phone_with_weights(weights_bytes: u64) -> PhoneFields {
    PhoneFields::of(PhoneModel {
        weights_bytes,
        parameters: Some(Parameters::mixture(7_600_000_000, 2_400_000_000)),
        measured_tokens_per_second: Some(9.5),
        battery_powered: Some(true),
    })
}

fn sample_phone() -> PhoneFields {
    phone_with_weights(2_200_000_000)
}

fn declined_phone() -> PhoneFields {
    PhoneFields::of(PhoneModel {
        weights_bytes: 2_200_000_000,
        parameters: None,
        measured_tokens_per_second: None,
        battery_powered: None,
    })
}

/// The phone's side of the recipe in `messages`: decode what the QR gave,
/// MAC the address, the node id and the canonical metadata over the phone
/// domain. `node` is what the scanned square carried — empty when none.
fn declaration(
    code_hex: &str,
    nonce_hex: &str,
    reachable: &str,
    node: &str,
    phone: PhoneFields,
) -> PhoneDeclaration {
    let mut key = [0u8; 16];
    hex::decode_to_slice(code_hex, &mut key).unwrap();
    let mut nonce = [0u8; NONCE_BYTES];
    hex::decode_to_slice(nonce_hex, &mut nonce).unwrap();
    let delivery_token = "11".repeat(16);
    let mac = hex::encode(phone_mac_with_token(
        &key,
        &nonce,
        reachable,
        node,
        &delivery_token,
        &phone,
    ));
    PhoneDeclaration {
        phone,
        mac,
        delivery_token,
    }
}

/// A claimed ceremony, with everything the phone would need to finish.
fn claimed() -> (Pairing, SystemTime, String, String) {
    let (mut session, start) = offered();
    let (code, nonce) = qr_secrets(&session);
    assert!(matches!(
        session.claim(&code, start + Duration::from_secs(1)),
        ClaimResult::Claimed
    ));
    (session, start, code, nonce)
}

#[test]
fn a_code_is_single_use() {
    let (mut session, start) = offered();
    let (code, _) = qr_secrets(&session);
    let middle = start + TTL / 2;

    assert!(matches!(session.claim(&code, middle), ClaimResult::Claimed));
    // The same code, still inside the window: refused, exactly as a wrong
    // one would be.
    assert!(matches!(
        session.claim(&code, middle),
        ClaimResult::Rejected
    ));
    assert!(matches!(session, Pairing::Claimed(_)));
}

#[test]
fn an_expired_code_fails_without_ever_being_used() {
    let (mut session, start) = offered();
    let (code, _) = qr_secrets(&session);

    assert!(matches!(
        session.claim(&code, start + TTL + Duration::from_secs(1)),
        ClaimResult::Expired
    ));
    assert!(matches!(session, Pairing::Expired));
    // And a dead code cannot be resurrected.
    assert!(matches!(
        session.claim(&code, start + TTL + Duration::from_secs(2)),
        ClaimResult::Rejected
    ));
}

#[test]
fn sleep_counts_against_the_window() {
    // A suspend is a wall-clock gap nobody saw: the machine dozes with the
    // QR on screen and wakes hours later, and the photographer's clock kept
    // running through all of it. The deadline rides real time precisely so
    // this claim is refused — the wall clock says the window closed, even
    // though the process never got to tick past it.
    let (mut session, start) = offered();
    let (code, _) = qr_secrets(&session);

    let hours_later = start + TTL + Duration::from_secs(6 * 3600);
    assert!(matches!(
        session.claim(&code, hours_later),
        ClaimResult::Expired
    ));
    assert!(matches!(session, Pairing::Expired));
}

#[test]
fn every_rejection_is_the_same_rejection() {
    let (mut session, start) = offered();
    let (code, _) = qr_secrets(&session);
    let wrong = code
        .chars()
        .map(|c| if c == '0' { '1' } else { '0' })
        .collect::<String>();
    assert_ne!(wrong, code);

    // Malformed, truncated, and wrong-but-well-formed: all refused, and a
    // wrong rendering would give the game away, so the outcome says nothing
    // but its own name.
    assert_eq!(format!("{:?}", ClaimResult::Rejected), "Rejected");
    for attempt in ["not hex at all", "abcd", wrong.as_str()] {
        assert!(matches!(
            session.claim(attempt, start + Duration::from_secs(1)),
            ClaimResult::Rejected
        ));
    }
    // Failed attempts did not consume the code.
    assert!(matches!(
        session.claim(&code, start + Duration::from_secs(2)),
        ClaimResult::Claimed
    ));
}

#[test]
fn a_valid_proof_completes_the_pairing() {
    let (mut session, start, code, nonce) = claimed();
    let declaration = declaration(&code, &nonce, REACHABLE, "", sample_phone());

    let (handshake, seal) = session
        .complete(declaration, start + Duration::from_secs(2))
        .unwrap();
    let phone = handshake
        .phone
        .expect("a completed ceremony declares a phone");
    assert_eq!(phone.weights_bytes, 2_200_000_000);
    let parameters = phone.parameters.unwrap();
    assert!(parameters.is_mixture());
    assert_eq!(parameters.total().count(), 7_600_000_000);
    assert!(matches!(session, Pairing::Paired));
    // The computer answered with an encrypted credential and its MAC; the
    // phone's QR secrets are enough to verify and open that delivery.
    assert!(serde_json::to_string(&seal).is_ok());
    assert_eq!(seal.open(&code, &nonce), Some(handshake.credential_hex()));
}

#[test]
fn a_single_flipped_bit_is_refused_and_the_real_phone_still_pairs() {
    let (mut session, start, code, nonce) = claimed();
    let mut tampered = declaration(&code, &nonce, REACHABLE, "", sample_phone());
    let mut raw = hex::decode(&tampered.mac).unwrap();
    raw[0] ^= 0x01;
    tampered.mac = hex::encode(raw);

    assert!(matches!(
        session.complete(tampered, start + Duration::from_secs(2)),
        Err(CompleteError::Refused)
    ));
    // The refusal moved nothing: only the window ends a claimed ceremony,
    // so a stranger's bogus proof cannot take the square from the phone.
    assert!(matches!(session, Pairing::Claimed(_)));

    // The real phone's valid proof, presented after the refused one, pairs.
    let honest = declaration(&code, &nonce, REACHABLE, "", sample_phone());
    let (handshake, seal) = session
        .complete(honest, start + Duration::from_secs(3))
        .expect("the refusal spent nothing");
    assert!(matches!(session, Pairing::Paired));
    assert_eq!(
        handshake
            .phone
            .expect("a completed ceremony declares a phone")
            .weights_bytes,
        2_200_000_000
    );
    assert_eq!(seal.open(&code, &nonce), Some(handshake.credential_hex()));
}

#[test]
fn metadata_altered_after_the_mac_is_refused() {
    let (mut session, start, code, nonce) = claimed();
    // MAC the honest metadata, then swap the field afterwards — exactly the
    // alteration a lying endpoint would attempt.
    let mut declaration = declaration(&code, &nonce, REACHABLE, "", sample_phone());
    declaration.phone = phone_with_weights(2_200_000_001);

    assert!(matches!(
        session.complete(declaration, start + Duration::from_secs(2)),
        Err(CompleteError::Refused)
    ));
    assert!(matches!(session, Pairing::Claimed(_)));
}

#[test]
fn the_declaration_is_bound_to_the_whole_square() {
    // The address rode in the QR, so it rides in the MAC: a declaration
    // composed over one square's address verifies against no other.
    let (mut session, start, code, nonce) = claimed();
    let wrong_square = declaration(&code, &nonce, ELSEWHERE, "", sample_phone());

    assert!(matches!(
        session.complete(wrong_square, start + Duration::from_secs(2)),
        Err(CompleteError::Refused)
    ));
    assert!(matches!(session, Pairing::Claimed(_)));
}

#[test]
fn a_swapped_node_in_the_square_cannot_pair() {
    // The machine showed node A; an attacker swapped it for node B before
    // the phone scanned, and the phone — faithfully — signed what it saw.
    // The completion must refuse: the declaration is bound to the square
    // the machine actually showed, node id included.
    const NODE_A: &str =
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    const NODE_B: &str =
        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    let start = SystemTime::now();
    let (mut session, _) = offered_with_node(Some(NODE_A));
    let json = session.qr_payload().unwrap();
    let value: serde_json::Value = serde_json::from_str(&json).unwrap();
    let code = value["code"].as_str().unwrap().to_string();
    let nonce = value["nonce"].as_str().unwrap().to_string();
    assert!(matches!(
        session.claim(&code, start + Duration::from_secs(1)),
        ClaimResult::Claimed
    ));

    let swapped = declaration(&code, &nonce, REACHABLE, NODE_B, sample_phone());
    assert!(matches!(
        session.complete(swapped, start + Duration::from_secs(2)),
        Err(CompleteError::Refused)
    ));
    assert!(matches!(session, Pairing::Claimed(_)));
}

#[test]
fn the_honest_node_id_completes_the_pairing() {
    // The other side of the hijack test: with the road on and its node id
    // in the square, a phone that signs exactly what the square showed
    // pairs normally.
    const NODE_A: &str =
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    let start = SystemTime::now();
    let (mut session, _) = offered_with_node(Some(NODE_A));
    let json = session.qr_payload().unwrap();
    let value: serde_json::Value = serde_json::from_str(&json).unwrap();
    let code = value["code"].as_str().unwrap().to_string();
    let nonce = value["nonce"].as_str().unwrap().to_string();
    assert!(matches!(
        session.claim(&code, start + Duration::from_secs(1)),
        ClaimResult::Claimed
    ));

    let honest = declaration(&code, &nonce, REACHABLE, NODE_A, sample_phone());
    let (handshake, _seal) = session
        .complete(honest, start + Duration::from_secs(2))
        .unwrap();
    assert_eq!(
        handshake
            .phone
            .expect("a completed ceremony declares a phone")
            .weights_bytes,
        2_200_000_000
    );
    assert!(matches!(session, Pairing::Paired));
}

#[test]
fn a_declining_phone_is_taken_at_its_word() {
    let (mut session, start, code, nonce) = claimed();
    let declaration = declaration(&code, &nonce, REACHABLE, "", declined_phone());

    let (handshake, _seal) = session
        .complete(declaration, start + Duration::from_secs(2))
        .unwrap();
    let phone = handshake
        .phone
        .expect("a completed ceremony declares a phone");
    assert!(phone.parameters.is_none());
    assert!(phone.measured_tokens_per_second.is_none());
    assert!(phone.battery_powered.is_none());
    assert_eq!(phone.weights_bytes, 2_200_000_000);
    assert!(matches!(session, Pairing::Paired));
}

#[test]
fn completion_is_one_shot() {
    let (mut session, start, code, nonce) = claimed();
    let first = declaration(&code, &nonce, REACHABLE, "", sample_phone());
    session
        .complete(first, start + Duration::from_secs(2))
        .unwrap()
        .0;

    // A second completion — even with a fresh, valid proof — is refused,
    // and the paired state is untouched.
    let second = declaration(&code, &nonce, REACHABLE, "", sample_phone());
    assert!(matches!(
        session.complete(second, start + Duration::from_secs(3)),
        Err(CompleteError::Refused)
    ));
    assert!(matches!(session, Pairing::Paired));
}

#[test]
fn the_window_covers_the_whole_ceremony() {
    let (mut session, start, code, nonce) = claimed();
    let declaration = declaration(&code, &nonce, REACHABLE, "", sample_phone());

    let outcome = session.complete(declaration, start + TTL + Duration::from_secs(1));
    assert!(matches!(outcome, Err(CompleteError::Refused)));
    assert!(matches!(session, Pairing::Expired));
}

#[test]
fn a_refusal_does_not_say_why() {
    // Three ceremonies, three causes: a wrong proof, a closed window, and a
    // session nothing ever claimed. The caller sees the same error for all
    // three — no oracle here tells a prober whether a live, claimed
    // ceremony is on the table.
    let (mut wrong_proof, w_start, w_code, w_nonce) = claimed();
    let mut wrong_declaration = declaration(&w_code, &w_nonce, REACHABLE, "", sample_phone());
    wrong_declaration.mac = "0".repeat(64);
    let wrong = wrong_proof.complete(wrong_declaration, w_start + Duration::from_secs(2));

    let (mut closed, c_start, c_code, c_nonce) = claimed();
    let closed_declaration = declaration(&c_code, &c_nonce, REACHABLE, "", sample_phone());
    let expired = closed.complete(closed_declaration, c_start + TTL + Duration::from_secs(1));

    let (mut unclaimed, u_start) = offered();
    let stranger = unclaimed.complete(
        declaration(
            &"0".repeat(32),
            &"0".repeat(64),
            REACHABLE,
            "",
            declined_phone(),
        ),
        u_start + Duration::from_secs(1),
    );

    assert_eq!(format!("{wrong:?}"), format!("{expired:?}"));
    assert_eq!(format!("{expired:?}"), format!("{stranger:?}"));
    assert!(matches!(wrong, Err(CompleteError::Refused)));
    assert!(matches!(expired, Err(CompleteError::Refused)));
    assert!(matches!(stranger, Err(CompleteError::Refused)));
    // And neither of the first two refusals changed anything: the live
    // offer stands untouched, and the wrong proof left the claim standing
    // for the real phone. Only the closed window expired its ceremony.
    assert!(matches!(unclaimed, Pairing::Offered(_)));
    assert!(matches!(wrong_proof, Pairing::Claimed(_)));
    assert!(matches!(closed, Pairing::Expired));
}

#[test]
fn the_offer_expires_on_its_own() {
    let (mut session, start) = offered();
    session.expire_if_due(start + Duration::from_secs(1));
    assert!(matches!(session, Pairing::Offered(_)));
    session.expire_if_due(start + TTL + Duration::from_secs(1));
    assert!(matches!(session, Pairing::Expired));
}

#[test]
fn an_absurd_window_is_an_error_not_a_panic() {
    let start = SystemTime::now();
    let outcome = Pairing::offer(REACHABLE, None, start, Duration::from_secs(u64::MAX));
    assert!(matches!(outcome, Err(OfferError::Deadline)));
    // And a sane window is fine.
    assert!(Pairing::offer(REACHABLE, None, start, TTL).is_ok());
}

// The sweep: render everything a log line could plausibly hit — the session
// in every state, the handshake, the errors — and search the renderings for
// each secret, both in the hex it travels as and in the decimal array a
// derived Debug would have printed.
#[test]
fn no_rendering_carries_a_secret() {
    // The secret-holding types themselves: if any of their Debug impls ever
    // starts printing bytes — a stray derive, say — this catches it even
    // though no state rendering reaches inside them.
    let code = OneTimeCode::generate().unwrap();
    let credential = crate::handshake::Credential::generate().unwrap();

    let (mut session, start) = offered();
    let (code_hex, nonce_hex) = qr_secrets(&session);
    let code_bytes = hex::decode(&code_hex).unwrap();
    let nonce_bytes = hex::decode(&nonce_hex).unwrap();

    let mut rendered = format!("{:?}", session);
    assert!(matches!(
        session.claim(&code_hex, start + Duration::from_secs(1)),
        ClaimResult::Claimed
    ));
    rendered.push_str(&format!("{:?}", session));
    let (handshake, seal) = session
        .complete(
            declaration(&code_hex, &nonce_hex, REACHABLE, "", sample_phone()),
            start + Duration::from_secs(2),
        )
        .unwrap();
    let credential_hex = handshake.credential_hex();
    let credential_bytes = hex::decode(&credential_hex).unwrap();
    rendered.push_str(&format!("{:?}", session));
    rendered.push_str(&format!("{handshake:?}"));
    rendered.push_str(&format!("{:?}", seal));

    // A session that died unused renders as Expired and holds nothing.
    let (mut lapsed, late) = offered();
    lapsed.expire_if_due(late + TTL + Duration::from_secs(1));
    rendered.push_str(&format!("{:?}", lapsed));

    rendered.push_str(&format!(
        "{:?} {} {:?} {}",
        OfferError::Entropy,
        OfferError::Entropy,
        OfferError::Deadline,
        OfferError::Deadline
    ));
    for outcome in [CompleteError::Refused, CompleteError::Entropy] {
        rendered.push_str(&format!("{outcome:?} {outcome}"));
    }
    rendered.push_str(&format!("{:?}", StoreError::Corrupt("tag")));
    rendered.push_str(&format!("{:?}", ClaimResult::Expired));

    // The types' own Debug renderings.
    let direct = [
        (code.hex(), code.bytes().to_vec(), "code"),
        (credential.hex(), credential.bytes().to_vec(), "credential"),
    ];
    rendered.push_str(&format!("{code:?} {credential:?}"));

    let hunted = [
        (&code_hex, &code_bytes, "code"),
        (&nonce_hex, &nonce_bytes, "nonce"),
        (&credential_hex, &credential_bytes, "credential"),
    ];
    let all = hunted
        .into_iter()
        .chain(direct.iter().map(|(h, b, n)| (h, b, *n)));
    for (hex_form, raw_bytes, name) in all {
        assert!(
            !rendered.contains(hex_form.as_str()),
            "leaked {name} as hex: {rendered}"
        );
        assert!(
            !rendered.contains(&format!("{raw_bytes:?}")),
            "leaked {name} as bytes: {rendered}"
        );
    }
}
