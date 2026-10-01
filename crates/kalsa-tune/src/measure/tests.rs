//! The lifetime's own parts, with no process in sight: the closure of a
//! lifetime once both gates have spoken, the alias strip, and the identity.

use super::*;

/// The samples of a dead child count for nothing: the port was free
/// before the spawn, so a child that died means the answers may have
/// been somebody else's — however good they look.
#[test]
fn the_answers_of_a_dead_child_count_for_nothing() {
    assert_eq!(conclude(vec![9.9], false, true), Err(Refusal::DidNotStart));
    assert_eq!(conclude(vec![], true, true), Err(Refusal::NoUsableAnswer));
    assert_eq!(conclude(vec![7.5], true, true), Ok(vec![7.5]));
}

/// The identity gate: samples taken while the port serves somebody
/// else's model are somebody else's samples.
#[test]
fn answers_from_a_port_serving_another_model_count_for_nothing() {
    assert_eq!(
        conclude(vec![99.9], true, false),
        Err(Refusal::DidNotStart),
        "a fast answer from the wrong server is not our measurement"
    );
}

/// The caller's aliases come off in the two forms the engine's parser
/// actually knows — whole-token lookup, value in the next token — and
/// nothing else moves: an `=`-shaped token is not an alias to this
/// parser, so it is left as it was given.
#[test]
fn the_callers_aliases_are_removed_and_nothing_else() {
    let argv = vec![
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--alias".to_string(),
        "owner-name".to_string(),
        "--model".to_string(),
        "/m.gguf".to_string(),
        "-a".to_string(),
        "short".to_string(),
        "--alias=equals".to_string(),
        "--port".to_string(),
        "8131".to_string(),
    ];
    assert_eq!(
        without_aliases(argv),
        vec![
            "--host".to_string(),
            "127.0.0.1".to_string(),
            "--model".to_string(),
            "/m.gguf".to_string(),
            "--alias=equals".to_string(),
            "--port".to_string(),
            "8131".to_string(),
        ]
    );
}

/// No entropy, no panic: the lifetime refuses without spawning.
#[test]
fn a_nonce_that_cannot_be_drawn_is_a_refusal_not_a_panic() {
    assert_eq!(nonce_from(|_| Err::<(), _>("no entropy")), None);
    assert!(nonce_from(|_| Ok::<(), ()>(())).is_some());
}

/// The nonce's shape and freshness — the `kalsa-tune-` prefix, 128
/// bits of hex, and two draws that differ. It does not prove no model
/// on earth is called that; the aliases check proves ours is listed.
#[test]
fn a_nonce_is_unlike_any_model_name() {
    let nonce = fresh_nonce().expect("this machine has entropy");
    assert!(nonce.starts_with("kalsa-tune-"), "{nonce}");
    assert_eq!(nonce.len(), "kalsa-tune-".len() + 32, "{nonce}");
    assert_ne!(
        fresh_nonce().expect("this machine has entropy"),
        nonce,
        "a fresh identity per lifetime"
    );
}
