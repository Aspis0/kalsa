use std::time::{Duration, SystemTime};

use kalsa_catalog::PhoneModel;

use super::{ClaimResult, Pairing};
use crate::error::{CompleteError, EntropyError, StoreError};

const TTL: Duration = Duration::from_secs(300);
const REACHABLE: &str = "http://192.168.1.10:4952";

fn offered() -> (Pairing, SystemTime) {
    let start = SystemTime::now();
    (Pairing::offer(start, TTL).unwrap(), start)
}

/// The code and the binding, exactly as the QR carried them.
fn qr_secrets(session: &Pairing) -> (String, String) {
    let json = session.qr_payload(REACHABLE).unwrap();
    let value: serde_json::Value = serde_json::from_str(&json).unwrap();
    (
        value["code"].as_str().unwrap().to_string(),
        value["binding"].as_str().unwrap().to_string(),
    )
}

fn declined_phone() -> PhoneModel {
    PhoneModel {
        weights_bytes: 2_200_000_000,
        parameters: None,
        measured_tokens_per_second: None,
        battery_powered: None,
    }
}

#[test]
fn a_code_is_single_use() {
    let (mut session, start) = offered();
    let (code, _) = qr_secrets(&session);
    let middle = start + TTL / 2;

    assert!(matches!(
        session.claim(&code, [1; 32], middle),
        ClaimResult::Claimed
    ));
    // The same code, still inside the window: refused, exactly as a wrong
    // one would be.
    assert!(matches!(
        session.claim(&code, [2; 32], middle),
        ClaimResult::Rejected
    ));
    assert!(matches!(session, Pairing::Claimed(_)));
}

#[test]
fn an_expired_code_fails_without_ever_being_used() {
    let (mut session, start) = offered();
    let (code, _) = qr_secrets(&session);

    assert!(matches!(
        session.claim(&code, [1; 32], start + TTL + Duration::from_secs(1)),
        ClaimResult::Expired
    ));
    assert!(matches!(session, Pairing::Expired));
    // And a dead code cannot be resurrected.
    assert!(matches!(
        session.claim(&code, [1; 32], start + TTL + Duration::from_secs(2)),
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
        session.claim(&code, [1; 32], hours_later),
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
            session.claim(attempt, [3; 32], start + Duration::from_secs(1)),
            ClaimResult::Rejected
        ));
    }
    // Failed attempts did not consume the code.
    assert!(matches!(
        session.claim(&code, [4; 32], start + Duration::from_secs(2)),
        ClaimResult::Claimed
    ));
}

#[test]
fn a_declining_phone_is_taken_at_its_word() {
    let (mut session, start) = offered();
    let (code, _) = qr_secrets(&session);
    session.claim(&code, [1; 32], start + Duration::from_secs(1));

    let handshake = session.complete(declined_phone(), start + Duration::from_secs(2)).unwrap();
    assert!(handshake.phone.parameters.is_none());
    assert!(handshake.phone.measured_tokens_per_second.is_none());
    assert!(handshake.phone.battery_powered.is_none());
    assert_eq!(handshake.phone.weights_bytes, 2_200_000_000);
    assert!(matches!(session, Pairing::Paired));
}

#[test]
fn the_window_covers_the_whole_ceremony() {
    let (mut session, start) = offered();
    let (code, _) = qr_secrets(&session);
    assert!(matches!(
        session.claim(&code, [1; 32], start + TTL - Duration::from_secs(1)),
        ClaimResult::Claimed
    ));

    let outcome = session.complete(declined_phone(), start + TTL + Duration::from_secs(1));
    assert!(matches!(outcome, Err(CompleteError::WindowClosed)));
    assert!(matches!(session, Pairing::Expired));
}

#[test]
fn completion_without_a_claim_is_refused() {
    let (mut session, start) = offered();
    let outcome = session.complete(declined_phone(), start + Duration::from_secs(1));
    assert!(matches!(outcome, Err(CompleteError::NotClaimed)));
    assert!(matches!(session, Pairing::Offered(_)));
}

#[test]
fn the_offer_expires_on_its_own() {
    let (mut session, start) = offered();
    session.expire_if_due(start + Duration::from_secs(1));
    assert!(matches!(session, Pairing::Offered(_)));
    session.expire_if_due(start + TTL + Duration::from_secs(1));
    assert!(matches!(session, Pairing::Expired));
}

// The sweep the brief asks for: render everything a log line could plausibly
// hit — the session in every state, the handshake, the errors — and search
// the renderings for each secret, both in the hex it travels as and in the
// decimal array a derived Debug would have printed.
#[test]
fn no_rendering_carries_a_secret() {
    // The secret-holding types themselves: if any of their Debug impls ever
    // starts printing bytes — a stray derive, say — this catches it even
    // though no state rendering reaches inside them.
    let code = crate::secret::OneTimeCode::generate().unwrap();
    let binding = crate::secret::BindingSecret::generate().unwrap();
    let credential = crate::handshake::Credential::generate().unwrap();

    let (mut session, start) = offered();
    let (code_hex, binding_hex) = qr_secrets(&session);
    let code_bytes = hex::decode(&code_hex).unwrap();
    let binding_bytes = hex::decode(&binding_hex).unwrap();

    let mut rendered = format!("{:?}", session);
    session.claim(&code_hex, [1; 32], start + Duration::from_secs(1));
    rendered.push_str(&format!("{:?}", session));
    let handshake = session
        .complete(declined_phone(), start + Duration::from_secs(2))
        .unwrap();
    let credential_hex = handshake.credential_hex();
    let credential_bytes = hex::decode(&credential_hex).unwrap();
    rendered.push_str(&format!("{:?}", session));
    rendered.push_str(&format!("{handshake:?}"));

    // A session that died unused renders as Expired and holds nothing.
    let (mut lapsed, late) = offered();
    lapsed.expire_if_due(late + TTL + Duration::from_secs(1));
    rendered.push_str(&format!("{:?}", lapsed));

    rendered.push_str(&format!("{EntropyError:?} {EntropyError}"));
    for outcome in [
        CompleteError::NotClaimed,
        CompleteError::WindowClosed,
        CompleteError::Entropy,
    ] {
        rendered.push_str(&format!("{outcome:?} {outcome}"));
    }
    rendered.push_str(&format!("{:?}", StoreError::Corrupt("tag")));
    rendered.push_str(&format!("{:?}", ClaimResult::Expired));

    // The types' own Debug renderings.
    let direct = [
        (code.hex(), code.bytes().to_vec(), "code"),
        (binding.hex(), binding.bytes().to_vec(), "binding"),
        (credential.hex(), credential.bytes().to_vec(), "credential"),
    ];
    rendered.push_str(&format!("{code:?} {binding:?} {credential:?}"));

    let hunted = [
        (&code_hex, &code_bytes, "code"),
        (&binding_hex, &binding_bytes, "binding"),
        (&credential_hex, &credential_bytes, "credential"),
    ];
    let all = hunted
        .into_iter()
        .chain(direct.iter().map(|(h, b, n)| (h, b, *n)));
    for (hex_form, raw_bytes, name) in all {
        assert!(!rendered.contains(hex_form.as_str()), "leaked {name} as hex: {rendered}");
        assert!(
            !rendered.contains(&format!("{raw_bytes:?}")),
            "leaked {name} as bytes: {rendered}"
        );
    }
}
