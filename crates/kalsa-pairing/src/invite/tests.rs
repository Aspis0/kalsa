use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use kalsa_catalog::{Parameters, PhoneModel};

use super::{Invites, INVITE_TTL, LINK_ORIGIN, MAX_INVITES};
use crate::ceremony::ClaimResult;
use crate::error::InviteError;
use crate::messages::PhoneDeclaration;

const REACHABLE: &str = "http://127.0.0.1:8134";
const NODE: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

fn scratch(name: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("kalsa-pairing-invite-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("scratch");
    dir.join("invites.json")
}

/// A start time off the real clock, so every deadline in a test lands where
/// the test says it does.
fn start() -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(1_770_000_000)
}

fn link_of(invites: &Invites, id: u32) -> String {
    invites.link(id).expect("the invitation is still on the table")
}

/// The payload a link carries, decoded: the inverse of the link builder,
/// kept here because nothing but a test ever needs to take a link apart.
fn payload_of(link: &str) -> String {
    let encoded = link
        .strip_prefix(LINK_ORIGIN)
        .expect("the link wears this origin");
    String::from_utf8(URL_SAFE_NO_PAD.decode(encoded).expect("base64url")).expect("json")
}

/// The four values a phone takes out of a link — code, nonce, address, node
/// — exactly as the square on screen would have carried them.
fn square_of(link: &str) -> (String, String, String, Option<String>) {
    let value: serde_json::Value = serde_json::from_str(&payload_of(link)).expect("the payload");
    (
        value["code"].as_str().expect("code").to_string(),
        value["nonce"].as_str().expect("nonce").to_string(),
        value["reachable"].as_str().expect("reachable").to_string(),
        value["node"].as_str().map(str::to_string),
    )
}

fn declares(square: &(String, String, String, Option<String>)) -> PhoneDeclaration {
    PhoneDeclaration::sign(
        &square.0,
        &square.1,
        &square.2,
        square.3.as_deref(),
        PhoneModel {
            weights_bytes: 1_593_894_944,
            parameters: Some(Parameters::dense(4_000_000_000)),
            measured_tokens_per_second: Some(9.0),
            battery_powered: Some(true),
        },
    )
    .expect("the phone can sign what its link carried")
}

#[test]
fn a_claim_consumes_only_the_invitation_it_matches() {
    let now = start();
    let mut invites = Invites::open(&scratch("two-invites"), now).unwrap();
    let first = invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    let second = invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    let (code, ..) = square_of(&link_of(&invites, first));
    let (other, ..) = square_of(&link_of(&invites, second));

    assert!(matches!(
        invites.claim(&code, now + Duration::from_secs(1)),
        Ok(ClaimResult::Claimed)
    ));
    // The same code a second time is answered exactly as a wrong code is:
    // nothing here says "already used" to a guesser.
    assert!(matches!(
        invites.claim(&code, now + Duration::from_secs(2)),
        Ok(ClaimResult::Rejected)
    ));
    // And the first claim left the other invitation alone — it is still
    // worth its own code.
    assert!(matches!(
        invites.claim(&other, now + Duration::from_secs(3)),
        Ok(ClaimResult::Claimed)
    ));
}

#[test]
fn a_wrong_code_consumes_nothing() {
    let now = start();
    let mut invites = Invites::open(&scratch("wrong-code"), now).unwrap();
    let first = invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    let second = invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    let (code, ..) = square_of(&link_of(&invites, first));
    let (other, ..) = square_of(&link_of(&invites, second));

    let miss = "0".repeat(code.len());
    assert!(matches!(
        invites.claim(&miss, now + Duration::from_secs(1)),
        Ok(ClaimResult::Rejected)
    ));
    // A failed claim is not a claim: both invitations are still on the
    // table, codes and all.
    assert_eq!(invites.list().len(), 2);
    assert!(matches!(
        invites.claim(&code, now + Duration::from_secs(2)),
        Ok(ClaimResult::Claimed)
    ));
    assert!(matches!(
        invites.claim(&other, now + Duration::from_secs(3)),
        Ok(ClaimResult::Claimed)
    ));
}

#[test]
fn an_invitation_lives_exactly_one_day() {
    let now = start();
    let mut invites = Invites::open(&scratch("one-day"), now).unwrap();
    let doomed = invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    let last_second = invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    let (code, ..) = square_of(&link_of(&invites, doomed));
    let (other, ..) = square_of(&link_of(&invites, last_second));
    assert_eq!(invites.list()[0].1, now + INVITE_TTL, "a day, to the second");

    // One second inside the window the link still opens.
    assert!(matches!(
        invites.claim(&other, now + INVITE_TTL - Duration::from_secs(1)),
        Ok(ClaimResult::Claimed)
    ));
    assert_eq!(invites.list().len(), 2, "both are still on the list");
    // Exactly at the deadline it does not — and the answer is the same one
    // a wrong code gets, never a distinct "expired" for a stranger to read.
    assert!(matches!(
        invites.claim(&code, now + INVITE_TTL),
        Ok(ClaimResult::Rejected)
    ));
    // The sweep retires both: a claim does not extend the window, so a code
    // claimed at the last second buys nothing after it either, and neither
    // invitation comes back.
    invites.expire_if_due(now + INVITE_TTL).unwrap();
    assert!(invites.list().is_empty());
    assert!(matches!(
        invites.claim(&code, now + INVITE_TTL + Duration::from_secs(1)),
        Ok(ClaimResult::Rejected)
    ));
}

#[test]
fn the_eleventh_invitation_is_refused_and_nothing_is_evicted() {
    let now = start();
    let mut invites = Invites::open(&scratch("cap"), now).unwrap();
    let mut minted = Vec::new();
    for _ in 0..MAX_INVITES {
        minted.push(invites.mint(REACHABLE, Some(NODE), None, now).unwrap());
    }
    let first_link = link_of(&invites, minted[0]);

    assert!(matches!(
        invites.mint(REACHABLE, Some(NODE), None, now),
        Err(InviteError::Full)
    ));
    // Refusal evicts nothing: the link handed out first still opens.
    assert_eq!(invites.list().len(), MAX_INVITES);
    assert!(payload_of(&first_link).contains("\"code\""));

    // One cancel, one mint: the owner makes room rather than being moved.
    invites.cancel(minted[0]).unwrap();
    assert!(invites.mint(REACHABLE, Some(NODE), None, now).is_ok());
    assert_eq!(invites.list().len(), MAX_INVITES);
}

#[test]
fn minting_without_a_node_is_refused() {
    let now = start();
    let mut invites = Invites::open(&scratch("no-node"), now).unwrap();

    // A link whose phone has no node to dial would carry a code and no
    // road: refused, not minted half working.
    assert!(matches!(
        invites.mint(REACHABLE, None, None, now),
        Err(InviteError::NoNode)
    ));
    assert!(matches!(
        invites.mint(REACHABLE, Some(""), None, now),
        Err(InviteError::NoNode)
    ));
    assert!(invites.list().is_empty(), "nothing was minted");

    assert!(invites.mint(REACHABLE, Some(NODE), None, now).is_ok());
}

#[test]
fn cancelling_takes_the_link_down() {
    let now = start();
    let mut invites = Invites::open(&scratch("cancel"), now).unwrap();
    let id = invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    let (code, ..) = square_of(&link_of(&invites, id));

    invites.cancel(id).unwrap();
    assert!(invites.list().is_empty());
    assert!(matches!(
        invites.claim(&code, now + Duration::from_secs(1)),
        Ok(ClaimResult::Rejected)
    ));
    // An id the set never held changes nothing and writes nothing.
    invites.cancel(id + 99).unwrap();
    assert!(invites.list().is_empty());
}

#[test]
fn the_claimed_ceremony_finishes_through_the_set() {
    let now = start();
    let mut invites = Invites::open(&scratch("complete"), now).unwrap();
    let first = invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    let second = invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    let left = square_of(&link_of(&invites, first));
    let right = square_of(&link_of(&invites, second));
    invites
        .claim(&left.0, now + Duration::from_secs(1))
        .unwrap();
    invites
        .claim(&right.0, now + Duration::from_secs(1))
        .unwrap();

    // Two ceremonies are claimed at once; the MAC decides which one the
    // declaration belongs to, and the set does not have to be told.
    let (handshake, seal) = invites
        .complete(declares(&right), now + Duration::from_secs(2))
        .expect("the second ceremony verifies");
    let _ = handshake;
    // The seal is keyed on that square alone: the other link's code and
    // nonce must not open it.
    assert!(seal.open(&right.0, &right.1).is_some());
    assert!(seal.open(&left.0, &left.1).is_none());
    // The one that paired leaves the set; the other claim is still alive.
    assert_eq!(invites.list().len(), 1);

    let (handshake, seal) = invites
        .complete(declares(&left), now + Duration::from_secs(3))
        .expect("the first ceremony verifies when its turn comes");
    let _ = handshake;
    assert!(seal.open(&left.0, &left.1).is_some());
    assert!(invites.list().is_empty());
}

#[test]
fn the_debug_of_a_set_prints_no_code() {
    let now = start();
    let mut invites = Invites::open(&scratch("debug"), now).unwrap();
    let first = invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    let (code, nonce, _, _) = square_of(&link_of(&invites, first));

    // Both formatters the set has: a Debug is what anything logging the set
    // would reach, and it prints ids and deadlines — the ceremonies inside
    // print their state name and nothing else.
    for shown in [format!("{:?}", invites), format!("{:#?}", invites)] {
        assert!(!shown.contains(&code), "the code leaked: {shown}");
        assert!(!shown.contains(&nonce), "the nonce leaked: {shown}");
        assert!(shown.contains("Pairing::Offered"), "{shown}");
    }
    // And the set still lists what it should, so the silence is not a lie
    // by emptiness.
    assert_eq!(invites.list().len(), 2);
}

#[test]
fn the_link_round_trips_to_the_square_json() {
    let now = start();
    let path = scratch("link");
    let mut invites = Invites::open(&path, now).unwrap();
    let id = invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    let link = link_of(&invites, id);

    // The document behind the `#` is the square's own: the version the phone
    // gates on, and the four values the completion MAC covers.
    let payload = payload_of(&link);
    let value: serde_json::Value = serde_json::from_str(&payload).expect("the square's json");
    assert_eq!(value["v"], 3);
    assert_eq!(value["reachable"], REACHABLE);
    assert_eq!(value["node"], NODE);
    assert_eq!(value["code"].as_str().unwrap().len(), 32);
    assert_eq!(value["nonce"].as_str().unwrap().len(), 64);

    // And it is byte for byte what the set put on disk, which is byte for
    // byte what `qr_payload` produced: the link and the file hold one
    // document, and re-encoding what came out puts the link back together
    // unchanged — base64url without padding loses nothing.
    let on_disk: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).expect("the file")).expect("the envelope");
    assert_eq!(payload, on_disk["invites"][0]["payload"]);
    assert_eq!(
        format!("{LINK_ORIGIN}{}", URL_SAFE_NO_PAD.encode(&payload)),
        link
    );
}
