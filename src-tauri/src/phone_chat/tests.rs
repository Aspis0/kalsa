//! The bridge's rules on the page's events and on the paired phones: what it
//! refuses, what it forwards, what it stores, and what a new pairing drops.

use std::cell::Cell;
use std::sync::mpsc;
use std::time::Instant;

use kalsa_door::{ChatEvent, DeviceId};
use serde_json::{json, Value};

use super::drafts::Owner;
use super::{digest, lock, Bridge, Live, SendOutcome, MAX_EVENT_BYTES};

const ID: &str = "0123456789abcdef0123456789abcdef";

/// Device 1 as paired under the credential "cred-a".
fn owner_a() -> Owner {
    (DeviceId::new(1), digest("cred-a"))
}

/// A bridge that has paired device 1 under the credential "cred-a", with one
/// live request of that phone, and the door's end of its events.
fn bridge_with_request(
    kind: &'static str,
    reply_for: Option<u32>,
) -> (Bridge, mpsc::Receiver<ChatEvent>) {
    let bridge = Bridge::default();
    bridge.pair(&[(DeviceId::new(1), "cred-a".to_string())]);
    let (inbox, events) = mpsc::channel();
    lock(&bridge.live).insert(
        "req".to_string(),
        Live {
            owner: (DeviceId::new(1), digest("cred-a")),
            kind,
            reply_for,
            inbox,
        },
    );
    (bridge, events)
}

/// A bridge holding one stored draft of device 1 under "cred-a".
fn bridge_with_draft() -> Bridge {
    let bridge = Bridge::default();
    bridge.pair(&[(DeviceId::new(1), "cred-a".to_string())]);
    lock(&bridge.drafts).insert(
        ID.to_string(),
        (DeviceId::new(1), digest("cred-a")),
        105,
        "Re".to_string(),
        "Va bene.".to_string(),
        Instant::now(),
    );
    bridge
}

fn draft_data(reply_to_id: &str, subject: &str, body: &str) -> Value {
    json!({
        "reply_to_id": reply_to_id,
        "to": "segreteria@studio.example.it",
        "to_name": "Studio",
        "subject": subject,
        "body": body,
    })
}

#[test]
fn an_unknown_event_name_is_refused() {
    let (bridge, _events) = bridge_with_request("turn", None);
    assert_eq!(
        bridge.accept("req", "shout", json!({})),
        Err("unknown_event")
    );
}

#[test]
fn an_event_for_a_finished_request_is_dropped_without_a_word() {
    let bridge = Bridge::default();
    assert_eq!(bridge.accept("gone", "delta", json!({"text": "x"})), Ok(()));
}

#[test]
fn a_draft_reaches_the_phone_under_an_id_and_the_store_keeps_the_mail_not_the_recipient() {
    let (bridge, events) = bridge_with_request("turn", None);
    bridge
        .accept("req", "draft", draft_data("105", "Re: Fattura", "Va bene."))
        .unwrap();
    let draft = events.try_recv().expect("the draft was forwarded");
    assert_eq!(draft.name, "draft");
    let id = draft.data["draft_id"]
        .as_str()
        .expect("the draft has an id");
    assert_eq!(id.len(), 32);
    assert_eq!(draft.data["reply_to_id"], "105");
    assert_eq!(draft.data["to"], "segreteria@studio.example.it");
    let ticket = lock(&bridge.drafts)
        .begin(owner_a(), id, None, Instant::now())
        .expect("the draft is stored under the id the phone holds");
    assert_eq!(ticket.reply_to_id, 105);
}

#[test]
fn a_draft_without_its_reply_id_is_refused_and_stores_nothing() {
    let (bridge, events) = bridge_with_request("turn", None);
    let data = json!({"to": "a@b.example", "to_name": "", "subject": "s", "body": "b"});
    assert_eq!(bridge.accept("req", "draft", data), Err("bad_event"));
    assert!(events.try_recv().is_err());
    assert_eq!(lock(&bridge.drafts).count(), 0);
    assert!(
        lock(&bridge.live).contains_key("req"),
        "a refused event ends nothing"
    );
}

#[test]
fn an_event_over_the_cap_ends_the_turn_as_an_engine_failure() {
    let (bridge, events) = bridge_with_request("turn", None);
    let big = "x".repeat(MAX_EVENT_BYTES);
    bridge.accept("req", "delta", json!({"text": big})).unwrap();
    let end = events.try_recv().expect("the turn was ended");
    assert_eq!(
        (end.name.as_str(), end.data["code"].as_str()),
        ("error", Some("engine"))
    );
    assert!(lock(&bridge.live).is_empty());
}

#[test]
fn a_forged_event_shape_is_refused_and_the_request_goes_on() {
    let (bridge, events) = bridge_with_request("turn", None);
    assert_eq!(
        bridge.accept("req", "delta", json!({"text": 7})),
        Err("bad_event")
    );
    assert!(events.try_recv().is_err());
    assert!(lock(&bridge.live).contains_key("req"));
}

#[test]
fn a_read_request_takes_no_turn_events_and_a_turn_takes_no_read() {
    let (read, read_events) = bridge_with_request("read", None);
    assert_eq!(
        read.accept("req", "delta", json!({"text": "x"})),
        Err("wrong_kind")
    );
    assert!(read_events.try_recv().is_err());

    let (turn, turn_events) = bridge_with_request("turn", None);
    assert_eq!(
        turn.accept("req", "read", json!({"record": {}, "body": "x"})),
        Err("wrong_kind")
    );
    assert!(turn_events.try_recv().is_err());
}

#[test]
fn a_read_request_ends_on_its_read_event() {
    let (bridge, events) = bridge_with_request("read", None);
    bridge
        .accept(
            "req",
            "read",
            json!({"record": {"id": "105"}, "body": "Ciao"}),
        )
        .unwrap();
    let answer = events.try_recv().expect("the read was forwarded");
    assert_eq!(answer.name, "read");
    assert!(lock(&bridge.live).is_empty());
}

#[test]
fn a_draft_for_another_mail_than_the_pinned_one_is_refused_and_stores_nothing() {
    let (bridge, events) = bridge_with_request("turn", Some(105));
    assert_eq!(
        bridge.accept("req", "draft", draft_data("106", "Re", "Va bene.")),
        Err("reply_pin")
    );
    assert!(events.try_recv().is_err());
    assert_eq!(lock(&bridge.drafts).count(), 0);
}

#[test]
fn a_draft_for_the_pinned_mail_is_kept() {
    let (bridge, events) = bridge_with_request("turn", Some(105));
    bridge
        .accept("req", "draft", draft_data("105", "Re", "Va bene."))
        .unwrap();
    assert_eq!(events.try_recv().expect("forwarded").name, "draft");
    assert_eq!(lock(&bridge.drafts).count(), 1);
}

#[test]
fn a_draft_over_a_field_cap_is_refused_before_anything_is_stored() {
    let (bridge, events) = bridge_with_request("turn", None);
    let long_subject = "s".repeat(1025);
    assert_eq!(
        bridge.accept("req", "draft", draft_data("105", &long_subject, "b")),
        Err("bad_event")
    );
    assert!(events.try_recv().is_err());
    assert_eq!(lock(&bridge.drafts).count(), 0);
}

#[test]
fn a_forgotten_phones_drafts_go_when_the_pairing_changes() {
    let bridge = bridge_with_draft();
    bridge.pair(&[]);
    assert_eq!(lock(&bridge.drafts).count(), 0);
}

#[test]
fn a_reused_id_under_a_new_credential_cannot_spend_the_old_draft() {
    let bridge = bridge_with_draft();
    bridge.pair(&[(DeviceId::new(1), "cred-b".to_string())]);
    assert_eq!(
        lock(&bridge.drafts)
            .begin(owner_a(), ID, None, Instant::now())
            .err(),
        Some("draft_unknown")
    );
}

#[test]
fn a_draft_survives_a_pairing_pass_that_keeps_its_phone() {
    let bridge = bridge_with_draft();
    bridge.pair(&[(DeviceId::new(1), "cred-a".to_string())]);
    assert_eq!(lock(&bridge.drafts).count(), 1);
}

#[test]
fn a_send_that_unwinds_frees_its_draft_for_a_retry() {
    let bridge = bridge_with_draft();
    assert!(lock(&bridge.drafts)
        .begin(owner_a(), ID, None, Instant::now())
        .is_ok());
    let unwound = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _outcome = SendOutcome {
            drafts: &bridge.drafts,
            draft_id: ID,
            sent: false,
        };
        panic!("the send path failed");
    }));
    assert!(unwound.is_err());
    assert!(lock(&bridge.drafts)
        .begin(owner_a(), ID, None, Instant::now())
        .is_ok());
}

/// The send path with its window and its mail replaced by recorders: `mailed`
/// says whether the mail was reached.
fn send_with(
    bridge: &Bridge,
    device: u32,
    still_paired: bool,
    mailed: &Cell<bool>,
) -> Result<String, String> {
    bridge.send_draft_via(
        DeviceId::new(device),
        ID,
        None,
        |_| still_paired,
        |_| {
            mailed.set(true);
            Ok("segreteria@studio.example.it".to_string())
        },
    )
}

#[test]
fn a_paired_phone_sends_its_draft_once_and_the_draft_is_spent() {
    let bridge = bridge_with_draft();
    let mailed = Cell::new(false);
    assert_eq!(
        send_with(&bridge, 1, true, &mailed),
        Ok("segreteria@studio.example.it".to_string())
    );
    assert!(mailed.get());
    assert_eq!(
        send_with(&bridge, 1, true, &Cell::new(false)),
        Err("draft_unknown".to_string())
    );
}

/// A phone revoked after its draft was taken, before the mail goes: the mail
/// must not leave.
#[test]
fn a_phone_revoked_mid_send_sends_nothing() {
    let bridge = bridge_with_draft();
    let mailed = Cell::new(false);
    assert_eq!(
        send_with(&bridge, 1, false, &mailed),
        Err("draft_unknown".to_string())
    );
    assert!(!mailed.get(), "the mail was reached after the phone was revoked");
}

#[test]
fn a_device_that_is_not_paired_never_reaches_the_mail() {
    let bridge = bridge_with_draft();
    let mailed = Cell::new(false);
    assert_eq!(
        send_with(&bridge, 9, true, &mailed),
        Err("draft_unknown".to_string())
    );
    assert!(!mailed.get());
}
