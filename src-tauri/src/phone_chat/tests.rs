//! The bridge's rules on the page's events and on the paired phones: what it
//! refuses, what it forwards, what it stores, and what a new pairing drops.

use std::cell::Cell;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use kalsa_door::{ChatEvent, DeviceId};
use serde_json::{json, Value};

use crate::browser::pending;

use super::events;

use super::cards::{self, Held};
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
            conversation: super::cards::conversation_of(DeviceId::new(1)),
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

/// **The turn's own line about what it did** (docs §3.2). It is a name the
/// protocol now has, and a phone that does not know it ignores it — so this
/// build may send it. What is checked is the shape: text and nothing else,
/// because the phone draws the line as it arrives and a field it cannot draw
/// must not arrive.
#[test]
fn the_turn_recap_reaches_the_phone_as_one_line_of_text() {
    let (bridge, events) = bridge_with_request("turn", None);
    bridge
        .accept(
            "req",
            "recap",
            json!({"text": "Kalsa ha: chiesto reg.example.org · scritto in 2 campi · nessun clic"}),
        )
        .expect("a recap is a turn event now");
    let said = events.try_recv().expect("the line was forwarded");
    assert_eq!(said.name, "recap");
    assert_eq!(
        said.data["text"],
        "Kalsa ha: chiesto reg.example.org · scritto in 2 campi · nessun clic"
    );
}

#[test]
fn a_recap_that_is_not_a_line_of_text_is_refused() {
    let (bridge, events) = bridge_with_request("turn", None);
    for data in [json!({}), json!({"text": 42}), json!({"line": "x"})] {
        assert_eq!(bridge.accept("req", "recap", data.clone()), Err("bad_event"), "{data}");
    }
    assert!(events.try_recv().is_err());
}

#[test]
fn a_recap_is_not_a_read_event() {
    let (bridge, _events) = bridge_with_request("read", None);
    assert_eq!(
        bridge.accept("req", "recap", json!({"text": "x"})),
        Err("wrong_kind")
    );
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

// ---------------------------------------------------------------------------
// Browser cards: whose phone may answer, and what happens when it cannot.

/// The card as the page sends it on: the same wire the app relayed, so a proof
/// about what a phone may send is about what the page really sends.
fn card_data(card_id: &str) -> Value {
    json!({
        "card_id": card_id,
        "method": "POST",
        "url": "https://shop.example/order",
        "fields": [{"name": "size", "value": "L", "secret": false}],
        "asked_at_ms": 1_700_000_000_000_u64,
        "answer_in_ms": 300_000_u64,
    })
}

/// **The phone's card carries each field's label where the page gave one, and a field
/// the page gave none has no `label` key at all** — so a phone that predates labels
/// reads the same card it always did.
#[test]
fn the_phone_card_carries_a_label_only_where_the_page_gave_one() {
    let mut card = held(1, "cred", "turn-1", "c-label");
    card.fields = vec![
        pending::Field {
            name: "custname".to_owned(),
            value: "Giulia".to_owned(),
            secret: false,
            label: Some("Nome e cognome".to_owned()),
        },
        pending::Field { name: "csrf".to_owned(), value: "a-token".to_owned(), secret: false, label: None },
    ];
    let wire = super::card_wire(&card);
    assert_eq!(wire["fields"][0]["label"], "Nome e cognome");
    assert_eq!(wire["fields"][0]["value"], "Giulia", "the value is what goes, labelled or not");
    assert!(wire["fields"][1].get("label").is_none(), "no label is no key: {}", wire["fields"][1]);
}

/// One card as the sidecar is holding it, for the phone `device` under the
/// credential `cred`, raised on the turn `request`.
fn held(device: u32, cred: &str, request: &str, id: &str) -> Held {
    Held {
        owner: (DeviceId::new(device), digest(cred)),
        conversation: cards::conversation_of(DeviceId::new(device)),
        request: request.to_string(),
        id: id.to_string(),
        method: "POST".to_string(),
        url: "https://shop.example/order".to_string(),
        // **A real card names where it goes**, and the phone is shown that.
        destination: Some(pending::Destination { host: "shop.example".to_string(), port: None, secure: true }),
        fields: vec![],
        created: Instant::now(),
    }
}

/// A live turn for `device`, put in by hand where `Bridge::open` cannot be: the
/// real `open` needs an app to emit into, and what these proofs are about is what
/// happens to a card once a phone is listening. Returns the request id.
fn open_for(
    bridge: &Bridge,
    device: DeviceId,
    request: &str,
    kind: &'static str,
) -> mpsc::Receiver<ChatEvent> {
    let credential = if device == DeviceId::new(1) { "cred-a" } else { "cred-b" };
    let asking = super::asking((device, digest(credential)), device, &json!({}));
    bridge.start_live(request, kind, &asking)
}

/// A bridge that has paired two phones.
fn bridge_with_two_phones() -> Bridge {
    let bridge = Bridge::default();
    bridge.pair(&[
        (DeviceId::new(1), "cred-a".to_string()),
        (DeviceId::new(2), "cred-b".to_string()),
    ]);
    bridge
}

/// One card as the sidecar is holding it, for the phone `device`, raised on the
/// turn `request`.
/// The id of the ninth card a phone is offered — the first one refused.
const NINTH: usize = 8;

fn routed(device: u32, _request: &str, id: &str) -> pending::Card {
    pending::card_of(
        id,
        "POST",
        "https://shop.example/order",
        &cards::conversation_of(DeviceId::new(device)),
        vec![],
        Some(pending::Destination { host: "shop.example".to_owned(), port: None, secure: true }),
    )
}

/// **A phone's card is shown to that phone, and to no one else, once.**
///
/// The card goes on the wire of the turn that raised it — `route_cards` looks up
/// the live request by device *and* credential, so a card for phone 1 cannot be
/// put on phone 2's socket even by a caller that got the two mixed up. **Exactly
/// one frame**: the card used to be written onto that socket *and* emitted to the
/// window, which forwarded a second copy onto the same socket by hand, so a phone
/// was handed every card it was ever shown. The count below is the whole claim.
#[test]
fn a_card_goes_to_the_phone_that_raised_it_once() {
    let bridge = bridge_with_two_phones();
    let (inbox_a, events_a) = mpsc::channel();
    let (inbox_b, events_b) = mpsc::channel();
    lock(&bridge.live).insert(
        "req-a".to_string(),
        Live {
            owner: (DeviceId::new(1), digest("cred-a")),
            kind: "turn",
            reply_for: None,
            inbox: inbox_a,
            conversation: cards::conversation_of(DeviceId::new(1)),
        },
    );
    lock(&bridge.live).insert(
        "req-b".to_string(),
        Live {
            owner: (DeviceId::new(2), digest("cred-b")),
            kind: "turn",
            reply_for: None,
            inbox: inbox_b,
            conversation: cards::conversation_of(DeviceId::new(2)),
        },
    );

    // **A real card, on the real path:** the sidecar says it is holding one and
    // the bridge routes it. The old version of this proof routed an empty list,
    // which asserted nothing about delivery at all.
    bridge.route_cards(vec![routed(1, "req-a", ID)]);

    let mut sent: Vec<ChatEvent> = events_a.try_iter().collect();
    assert_eq!(sent.len(), 1, "the phone was handed its card {} times", sent.len());
    let said = sent.remove(0);
    assert_eq!(said.name, "browser_card");
    // **Where it goes, told to the phone rather than worked out there.** A phone
    // that parses `url` itself can show a different host than the request goes to,
    // and this is the three fields that stop it. `url` stays beside them for the
    // phones that know no better (docs §3.1).
    assert_eq!(
        said.data["destination"],
        serde_json::json!({"host": "shop.example", "port": null, "secure": true}),
        "the destination the sidecar parsed, and only the three fields of it"
    );
    assert_eq!(said.data["url"], "https://shop.example/order", "and the address is still there, whole");
    // The card is not on the second phone's socket, which is the rest of the
    // claim, and it is held for the phone that raised it and for no one else.
    assert!(events_b.try_recv().is_err(), "a card reached a phone that did not raise it");
    assert!(lock(&bridge.cards).shows("req-a", &(DeviceId::new(1), digest("cred-a")), ID));
    assert!(!lock(&bridge.cards).shows("req-a", &(DeviceId::new(2), digest("cred-b")), ID));
}

/// **The page cannot invent a card.** A `browser_card` event is checked against
/// what the bridge is really holding for *that phone* on *that turn*: a forged id,
/// another phone's id, and an id this turn did not raise are one refusal, and
/// nothing of the event is passed on.
#[test]
fn a_page_may_only_send_the_cards_its_own_phone_is_holding() {
    let (bridge, events) = bridge_with_request("turn", None);
    lock(&bridge.cards).note(held(1, "cred-a", "req", ID), Instant::now());

    bridge.accept("req", "browser_card", card_data(ID)).expect("the card it really holds");
    bridge
        .accept("req", "browser_card", card_data("ffffffffffffffffffffffffffffffff"))
        .expect_err("a card nobody holds");
    bridge.accept("req", "browser_card", card_data(ID)).expect("the same card again");
    // And nothing of a refused event ever reached the phone.
    while events.try_recv().is_ok() {}
    assert!(events.try_recv().is_err(), "a refused card still went out");
}

/// **One phone may not answer another's card, and an id is spent once.**
///
/// The two are the same check seen from both sides: taking is by owner, so a
/// second press of the same id finds nothing at all, and a stranger's press of
/// somebody else's id leaves the card exactly where it was.
#[test]
fn a_card_is_answered_once_and_only_by_the_phone_that_owns_it() {
    let bridge = bridge_with_two_phones();
    lock(&bridge.cards).note(held(1, "cred-a", "req-a", ID), Instant::now());
    let now = Instant::now();

    // The wrong phone spends nothing and is told nothing that would help.
    assert_eq!(
        lock(&bridge.cards).take((DeviceId::new(2), digest("cred-b")), ID, now).err(),
        Some(cards::UNKNOWN),
    );
    assert_eq!(lock(&bridge.cards).ids(), vec![ID.to_string()], "a refused answer took the card");

    // The right phone takes it, and the second press finds nothing.
    assert!(lock(&bridge.cards).take((DeviceId::new(1), digest("cred-a")), ID, now).is_ok());
    assert_eq!(
        lock(&bridge.cards).take((DeviceId::new(1), digest("cred-a")), ID, now).err(),
        Some(cards::UNKNOWN),
    );
}

/// **A phone that unpairs takes its card with it, and the card is declined.** The
/// card was held, nobody is left to answer it, and nothing was let through — a
/// card that simply vanished would leave the model carrying a request it believes
/// is still waiting.
#[test]
fn a_phone_that_unpairs_takes_its_cards_with_it() {
    let bridge = bridge_with_two_phones();
    lock(&bridge.cards).note(held(1, "cred-a", "req", ID), Instant::now());

    // The top phone is forgotten; the second stays paired.
    bridge.pair(&[(DeviceId::new(2), "cred-b".to_string())]);

    assert!(lock(&bridge.cards).ids().is_empty(), "a forgotten phone left its card behind");
    // And a new phone taking the old number finds nothing: the card went when the
    // old phone was forgotten.
    bridge.pair(&[(DeviceId::new(1), "cred-c".to_string()), (DeviceId::new(2), "cred-b".to_string())]);
    assert_eq!(
        lock(&bridge.cards).take((DeviceId::new(1), digest("cred-c")), ID, Instant::now()).err(),
        Some(cards::UNKNOWN),
        "a phone that took a forgotten number answered a card it never saw",
    );
}

/// **A card nobody answered inside the person's five minutes is declined**, and the
/// phone is told so its own screen can take it down. Not silent: a card that
/// simply stopped existing would leave a phone pressing a button that can only
/// ever be refused.
#[test]
fn a_card_outlives_nobody_and_says_so() {
    let (bridge, events) = bridge_with_request("turn", None);
    let stale = Held { created: Instant::now() - crate::browser::pending::ASKED_FOR, ..held(1, "cred-a", "req", ID) };
    lock(&bridge.cards).note(stale, Instant::now());

    // The sweep is what turns an unanswered card into an outcome and hands it to
    // the phone that was asked.
    bridge.route_cards(vec![]);

    assert!(lock(&bridge.cards).ids().is_empty(), "an expired card stayed on the table");
    let said = events.into_iter().find(|said| said.name == "browser_outcome");
    let said = said.expect("the phone was told its card expired");
    assert_eq!(said.data["code"], super::EXPIRED_OUTCOME);
    assert_eq!(said.data["card_id"], ID);
}

/// **A phone's conversation is its credential, not its say-so.**
///
/// The door resolves `device` from the Bearer token before the page is ever told
/// a request exists, so that argument is the only thing a phone's conversation
/// can come from. A body naming somebody else changes nothing: the door builds
/// the turn body without a `device` at all, and `asking` reads the body for
/// `reply_for` and for nothing else.
#[test]
fn a_turns_conversation_is_the_credential_s_device_and_not_what_the_body_says() {
    let lie = json!({"messages": [], "reply_for": "5", "device": "7"});

    let one = super::asking(owner_a(), DeviceId::new(1), &lie);
    assert_eq!(
        one.conversation,
        super::cards::conversation_of(DeviceId::new(1)),
        "the conversation is the credential's own device, in the one string the card side also builds"
    );
    assert_ne!(
        one.conversation,
        super::cards::conversation_of(DeviceId::new(7)),
        "and not the number the body named"
    );
    // The body is not thrown away wholesale: the one field it legitimately
    // carries still arrives, so "ignored" is about identity alone.
    assert_eq!(one.reply_for, Some(5), "the mail id the body names is still read");

    // A body that agrees is no different, so the line above is not the body
    // happening to be wrong by accident.
    assert_eq!(
        super::asking(owner_a(), DeviceId::new(1), &json!({"messages": [], "device": "1"})).conversation,
        one.conversation,
        "whoever the body says, the credential decides"
    );

    // And a different bearer is a different phone, whatever its body claims.
    let seven = super::asking(
        (DeviceId::new(7), digest("cred-b")),
        DeviceId::new(7),
        &json!({"messages": [], "device": "1"}),
    );
    assert_ne!(
        seven.conversation, one.conversation,
        "so one phone's card can never land in another's conversation"
    );
    assert_eq!(seven.owner.0, DeviceId::new(7), "and the owner is the credential's too");
}

/// **An outcome with nobody listening is handed over at that phone's next
/// TURN — after `accepted`, and never into a mail read.**
///
/// A turn lasts seconds and a card is asked about for five minutes, so the window
/// usually closes long after the turn is over. The phone would then be left
/// drawing a card that was already declined, pressing a button that can only be
/// refused. So an outcome with nowhere to go is queued for the **device** and
/// handed over at the next turn.
///
/// **Where in the stream matters as much as on which one.** The door throws away
/// any event that arrives before `accepted` (`chat::turn`, the `_ if accepted`
/// arm), so a drain done when the request opens is consumed and never written to
/// the wire — which is exactly what this test holds: the outcome comes *after*
/// `accepted`, never before.
#[test]
fn an_outcome_with_nobody_listening_is_handed_over_after_accepted_on_the_next_turn() {
    let bridge = bridge_with_two_phones();
    // The window goes with this phone's card on it: the real path, and the one
    // that leaves nobody listening.
    bridge.decline_cards(vec![pending::card_of(
        ID,
        "POST",
        "https://shop.example/order",
        &cards::conversation_of(DeviceId::new(1)),
        vec![],
        Some(pending::Destination { host: "shop.example".to_owned(), port: None, secure: true }),
    )]);
    assert_eq!(lock(&bridge.waiting).get(&DeviceId::new(1)).map(Vec::len), Some(1), "an outcome with nowhere to go was dropped");

    let events = open_for(&bridge, DeviceId::new(1), "req-a", "turn");
    assert!(events.try_recv().is_err(), "nothing is handed over before the turn is accepted");
    assert_eq!(lock(&bridge.waiting).get(&DeviceId::new(1)).map(Vec::len), Some(1), "and nothing is given away either");

    // The turn is accepted — and only then does the phone hear what became of
    // the card it was still drawing.
    bridge.accept("req-a", "accepted", json!({})).expect("the turn is accepted");
    let first = events.try_recv().expect("the phone was told what became of its card");
    assert_eq!(first.name, "accepted");
    let said = events.try_recv().expect("the outcome follows it");
    assert_eq!(said.name, "browser_outcome");
    assert_eq!(said.data["card_id"], ID);
    assert_eq!(said.data["code"], crate::browser::confirm::DECLINED);
    assert!(events.try_recv().is_err(), "and nothing else was queued for it");
    assert!(lock(&bridge.waiting).get(&DeviceId::new(1)).is_none(), "the queue is handed over once");

    // **The other phone is never handed another's outcome**, and its own queue
    // waits for its own turn.
    let events_b = open_for(&bridge, DeviceId::new(2), "req-b", "turn");
    bridge.accept("req-b", "accepted", json!({})).expect("the second turn is accepted");
    assert_eq!(events_b.try_recv().map(|said| said.name), Ok("accepted".to_string()));
    assert!(events_b.try_recv().is_err(), "one phone was handed another's outcome");
}

/// **A mail read is not a place a card was ever raised from, so it never drains
/// the queue.** The door lets a read carry `accepted`, `read` and `error` and
/// nothing else, so an outcome written into a read's stream would be dropped at
/// the door — and, worse, a phone that made a read would have nothing to apply
/// it to. **The queue waits for the phone's next turn**, where its cards are.
#[test]
fn a_mail_read_leaves_the_queue_alone_for_the_next_turn() {
    let bridge = bridge_with_two_phones();
    bridge.decline_cards(vec![pending::card_of(
        ID,
        "POST",
        "https://shop.example/order",
        &cards::conversation_of(DeviceId::new(1)),
        vec![],
        Some(pending::Destination { host: "shop.example".to_owned(), port: None, secure: true }),
    )]);

    let events = open_for(&bridge, DeviceId::new(1), "req-read", "read");
    bridge.accept("req-read", "accepted", json!({})).expect("a read is accepted");
    assert_eq!(events.try_recv().map(|said| said.name), Ok("accepted".to_string()));
    assert!(events.try_recv().is_err(), "a read was handed a browser outcome");
    assert_eq!(
        lock(&bridge.waiting).get(&DeviceId::new(1)).map(Vec::len),
        Some(1),
        "and the outcome is still waiting for a turn"
    );

    // The turn that follows still gets it.
    let turn = open_for(&bridge, DeviceId::new(1), "req-a", "turn");
    bridge.accept("req-a", "accepted", json!({})).expect("the turn is accepted");
    assert_eq!(turn.try_recv().map(|said| said.name), Ok("accepted".to_string()));
    assert_eq!(turn.try_recv().map(|said| said.name), Ok("browser_outcome".to_string()));
}

/// **The queue is a run of outcomes, not a store.** A phone that never comes back
/// is not remembered by the cards it was once asked about: the oldest goes when
/// the run is full, because the newest is about the card it last saw, and every
/// outcome in it is about a card the person can no longer answer — the computer's
/// own five minutes settled all of them long ago.
#[test]
fn the_queue_of_a_phone_that_is_not_listening_is_bounded() {
    let bridge = bridge_with_two_phones();
    for at in 0..24 {
        let id = format!("{at:032x}");
        bridge.decline_cards(vec![pending::card_of(
            &id,
            "POST",
            "https://shop.example/order",
            &cards::conversation_of(DeviceId::new(1)),
            vec![],
            Some(pending::Destination { host: "shop.example".to_owned(), port: None, secure: true }),
        )]);
    }
    let waiting = lock(&bridge.waiting).get(&DeviceId::new(1)).cloned().unwrap_or_default();
    assert_eq!(waiting.len(), super::WAITING_ROOM, "the queue grew without a limit");
    // **The oldest are the ones that went**, and the newest are still there.
    assert_eq!(
        waiting.first().and_then(|said| said["card_id"].as_str()),
        Some(format!("{:032x}", 24 - super::WAITING_ROOM).as_str()),
        "the oldest went first"
    );
    assert_eq!(waiting.last().and_then(|said| said["card_id"].as_str()), Some("00000000000000000000000000000017"));
}

/// **A phone that is forgotten takes its queued outcomes with it.** They were for
/// it to act on; a phone that is no longer paired will never draw the cards they
/// name, so keeping them is keeping ids in memory for a phone that will never
/// come back under that pairing.
#[test]
fn a_forgotten_phones_queued_outcomes_go_with_it() {
    let bridge = bridge_with_two_phones();
    bridge.decline_cards(vec![pending::card_of(
        ID,
        "POST",
        "https://shop.example/order",
        &cards::conversation_of(DeviceId::new(1)),
        vec![],
        Some(pending::Destination { host: "shop.example".to_owned(), port: None, secure: true }),
    )]);
    assert_eq!(lock(&bridge.waiting).get(&DeviceId::new(1)).map(Vec::len), Some(1));

    bridge.pair(&[(DeviceId::new(2), "cred-b".to_string())]);
    assert!(lock(&bridge.waiting).get(&DeviceId::new(1)).is_none(), "a forgotten phone's queue was kept");
}

/// **A ninth card is not a decision, it is a queue.** A person is being asked to
/// decide on a stranger's write, and one screen holding eight of them is already
/// as much as anybody reads; a ninth is answered by pressing the top one. So it
/// is refused rather than held: it never reaches the phone, which is a card
/// nobody is shown, and the sidecar is told to let it go so it is not sitting in
/// a hold with nobody able to answer it.
///
/// **The number is part of the contract**, so it is written out here rather than
/// read off the constant — a proof that asks the product what the product thinks
/// the answer is, proves nothing.
#[test]
fn a_phone_is_never_asked_about_more_than_eight_requests_at_once() {
    assert_eq!(super::MAX_HELD, 8, "the cap is eight cards on one phone's screen");
    let bridge = bridge_with_two_phones();
    let events = open_for(&bridge, DeviceId::new(1), "req", "turn");

    let held_cards: Vec<pending::Card> = (0..8).map(|at| routed(1, "req", &format!("{at:032x}"))).collect();
    bridge.route_cards(held_cards);
    let mut sent: Vec<ChatEvent> = events.try_iter().collect();
    assert_eq!(sent.len(), 8, "every card up to the cap is shown");
    sent.clear();
    assert!(sent.is_empty());

    // The ninth is not shown, and not kept either.
    bridge.route_cards(vec![routed(1, "req", &format!("{NINTH:032x}"))]);
    assert!(events.try_recv().is_err(), "the ninth card was put in front of the person");
    assert_eq!(
        lock(&bridge.cards).held_in(&cards::conversation_of(DeviceId::new(1))),
        8,
        "and it was kept anyway"
    );

    // The other phone's cap is its own: a second phone is not refused for the
    // first one's backlog.
    let events_b = open_for(&bridge, DeviceId::new(2), "req-b", "turn");
    bridge.route_cards(vec![routed(2, "req-b", &format!("{NINTH:032x}"))]);
    assert_eq!(events_b.try_recv().map(|said| said.name), Ok("browser_card".to_string()));
}

/// **The card's deadline crosses as a duration, never as an absolute time.**
///
/// Both clocks here are the computer's, and a phone cannot read either: a phone
/// whose clock is a day out reads an absolute deadline as already past, and one
/// that is half an hour out reads it as not yet arrived — in both cases without
/// ever pressing anything. So what crosses is what is *left*, and the phone counts
/// it down from the moment the card arrived.
#[test]
fn a_card_says_how_long_the_person_has_left_rather_than_when_they_must_answer() {
    let _bridge = bridge_with_request("turn", None);
    let fresh = Held { created: Instant::now(), ..held(1, "cred-a", "req", ID) };
    let wire = super::card_wire(&fresh);
    assert!(wire.get("answer_by_ms").is_none(), "an absolute deadline crossed: {wire}");
    let left = wire["answer_in_ms"].as_u64().expect("a budget");
    assert!(
        left <= crate::browser::pending::ASKED_FOR.as_millis() as u64 && left > 290_000,
        "a fresh card offers the whole five minutes, not {left} ms"
    );

    // A card shown a minute ago offers four minutes, because that is what is left
    // of the person's five.
    let aged = Held { created: Instant::now() - Duration::from_secs(60), ..held(1, "cred-a", "req", ID) };
    let left = super::card_wire(&aged)["answer_in_ms"].as_u64().expect("a budget");
    assert!((239_000..=240_000).contains(&left), "a card a minute old offers {left} ms, not about four minutes");

    // And the phone cannot be told a card that is over: the app refuses to show a
    // budget of nothing.
    assert!(
        events::check("turn", None, "browser_card", &super::card_wire(&aged)).is_ok(),
        "the wire the phone is handed is one it accepts"
    );
    assert!(
        events::check(
            "turn",
            None,
            "browser_card",
            &json!({"card_id": ID, "method": "POST", "url": "https://shop.example/o", "fields": [], "asked_at_ms": 1, "answer_by_ms": 2})
        )
        .is_err(),
        "and a card carrying the old absolute stamp is refused"
    );
    // A card the app cannot draw is not shown at all: the budget has to be a
    // number the phone can count down.
    assert!(
        events::check(
            "turn",
            None,
            "browser_card",
            &json!({"card_id": ID, "method": "POST", "url": "https://shop.example/o", "fields": [], "asked_at_ms": 1})
        )
        .is_err()
    );
}

/// **The address on a card is capped on this side too, and the cap is the
/// sidecar's.** A card at every other cap — two hundred fields of eight
/// kilobytes — has to fit in one phone frame; an address nobody is going to read
/// is not worth a megabyte to refuse.
#[test]
fn a_card_address_over_the_cap_is_not_one_this_side_would_ask_a_phone_to_draw() {
    // The cap is on the whole address, so the prefix is part of what it holds.
    let over = "h".repeat(super::events::URL_BYTES - "https://shop.example/".len() + 1);
    let wire = json!({
        "card_id": ID,
        "method": "POST",
        "url": format!("https://shop.example/{over}"),
        "fields": [],
        "asked_at_ms": 1,
        "answer_in_ms": 1,
    });
    assert_eq!(events::check("turn", None, "browser_card", &wire), Err(events::BAD_EVENT));
    let at = "h".repeat(super::events::URL_BYTES - "https://shop.example/".len());
    let wire = json!({
        "card_id": ID,
        "method": "POST",
        "url": format!("https://shop.example/{at}"),
        "fields": [],
        "asked_at_ms": 1,
        "answer_in_ms": 1,
    });
    assert!(events::check("turn", None, "browser_card", &wire).is_ok(), "the address at the cap is drawn");
}

/// **The pairing is asked twice, and only the second ask is the one that
/// counts.** The first finds the card; the second is asked after the card has
/// been spent and before the sidecar is given anything, so a phone the owner
/// unpaired while its finger was on the button cannot dispatch a request its turn
/// raised. **The window it closes is one no test can stage**, because the pair
/// change that would land in it removes the card first — that is what `pair`
/// does, and it is the ordinary answer. What a proof can hold is the order: the
/// card is gone before the app is asked for anything, and a phone that is not
/// paired spends nothing, tells nobody and dispatches nothing.
#[test]
fn a_press_from_a_phone_that_is_not_paired_finds_nothing_and_spends_nothing() {
    let bridge = bridge_with_two_phones();
    lock(&bridge.cards).note(held(1, "cred-a", "", ID), Instant::now());

    // A phone that was never paired, and one whose number was taken by another
    // phone under a new credential: one refusal, and the same one.
    assert_eq!(bridge.answer_card(DeviceId::new(9), ID, true), Err(cards::UNKNOWN.to_string()));
    bridge.pair(&[(DeviceId::new(1), "cred-c".to_string()), (DeviceId::new(2), "cred-b".to_string())]);
    assert_eq!(bridge.answer_card(DeviceId::new(1), ID, true), Err(cards::UNKNOWN.to_string()));

    // Nothing was dispatched, nothing was queued for a phone to be told later,
    // and the card the new owner found is the one a new phone's turn raises.
    assert!(lock(&bridge.waiting).is_empty(), "a refused press told somebody something");
    assert!(
        lock(&bridge.cards)
            .take((DeviceId::new(1), digest("cred-c")), ID, Instant::now())
            .is_err(),
        "the press spent a card it was not allowed to answer"
    );
}

/// **A card at its budget is owed nothing, and the press is told so rather than
/// raced.** The five minutes is what the person was promised; a card past it is
/// the sidecar's to give up on, and an answer that arrives afterwards is
/// `card_expired` so the phone takes the card off its screen instead of trying
/// again.
#[test]
fn a_press_after_the_person_s_five_minutes_is_expired_and_not_dispatched() {
    let bridge = bridge_with_two_phones();
    let spent = Instant::now() - crate::browser::pending::ASKED_FOR - Duration::from_secs(1);
    lock(&bridge.cards).note(Held { created: spent, ..held(1, "cred-a", "", ID) }, Instant::now());

    assert_eq!(bridge.answer_card(DeviceId::new(1), ID, true), Err(cards::EXPIRED.to_string()));
    assert!(lock(&bridge.waiting).is_empty(), "an expired card produced an outcome to deliver");
    assert_eq!(super::budget_left(&Held { created: spent, ..held(1, "cred-a", "", ID) }, Instant::now()), Duration::ZERO);
}

/// **A phone unpaired between its own check and the browser is stopped before the
/// browser is given anything.**
///
/// This is the whole point of the in-flight mark, and the only way to hold it up
/// is to stand the answer still — so the proof does exactly that: the answer is
/// held **after** it has passed its pairing check and **before** it dispatches,
/// the phone is unpaired, and the answer is let go. What has to be true is that
/// the request is refused, and that nothing was sent: the card belonged to a
/// phone the owner removed a moment ago, and the owner removing a phone is a
/// statement about who may act for it.
#[test]
fn a_phone_unpaired_between_its_check_and_the_browser_sends_nothing() {
    let bridge = Arc::new(Bridge::default());
    bridge.pair(&[(DeviceId::new(1), "cred-a".to_string()), (DeviceId::new(2), "cred-b".to_string())]);
    lock(&bridge.cards).note(held(1, "cred-a", "", ID), Instant::now());

    // **Armed before the answer starts**, then the answer is run on its own
    // thread: this is a race the door and the owner's reconcile thread are really
    // in, and the proof stands in the middle of it.
    bridge.arm_gate();
    let answering = {
        let bridge = Arc::clone(&bridge);
        std::thread::spawn(move || bridge.answer_card(DeviceId::new(1), ID, true))
    };
    bridge.wait_at_the_gate();

    // **The owner unpairs the phone while its finger is still on the button.**
    bridge.pair(&[(DeviceId::new(2), "cred-b".to_string())]);
    assert!(
        lock(&bridge.answering).contains_key(&((DeviceId::new(1), digest("cred-a")), ID.to_string())),
        "an answer in flight is known, which is what lets the pairing stop it"
    );
    bridge.release();

    let said = answering.join().expect("the answer is not a panic");
    assert_eq!(said, Err(crate::browser::confirm::DECLINED.to_string()), "a forgotten phone is told no");
    assert_eq!(bridge.answer_card(DeviceId::new(1), ID, true), Err(cards::UNKNOWN.to_string()), "and the card is spent, so a retry finds nothing");
    // **The mark is taken down however the answer ended**, so a phone that did
    // finish answering is not left looking as though it were still answering.
    assert!(lock(&bridge.answering).is_empty(), "an answer that has ended is still marked in flight");
    // Nothing was queued for a phone that was refused: there was no card on its
    // screen that this could be about.
    assert!(lock(&bridge.waiting).is_empty(), "a refused answer told somebody something");

    // **Every way out takes the mark down, and not only the one above.** A phone
    // that gets as far as the browser and finds none is the ordinary path, and a
    // mark left behind would let a later pairing change stop an answer that has
    // already ended — or, worse, keep re-inserting for a card that is spent.
    lock(&bridge.cards).note(held(2, "cred-b", "", "other"), Instant::now());
    assert_eq!(
        bridge.answer_card(DeviceId::new(2), "other", true),
        Err("no_runner".to_string()),
        "there is no app in this proof, which is the last thing an answer meets"
    );
    assert!(lock(&bridge.answering).is_empty(), "an answer that has ended is still marked in flight");
}

/// **Refusing a write must not block the thread that found it.**
///
/// `route_cards` is called from a tauri command and `pair` from the reconcile
/// timer, and both run inside an async runtime; asking the sidecar is a call
/// across a pipe to another process. Blocking on that future from inside a
/// runtime is a deadlock at best and a panic at worst — and it was being done
/// exactly there, once per card over the cap. So the declines are **collected**
/// under the locks, every lock is released, and the work is spawned onto the app's
/// runtime.
///
/// **Both branches are run inside a runtime here**, the over-cap refusal below
/// and the unpair above, because a call that waits inside a runtime does not
/// return and the test would rather say so than hang. What it cannot do is make
/// the sidecar slow: sending a decline needs an app, and there is none in a unit
/// test — so what is proved is that the decision is complete and the call
/// returns, and the guarantee itself is structural: the only await in either
/// function is the spawn.
#[tokio::test]
async fn refusing_a_write_from_inside_a_runtime_does_not_block() {
    let bridge = bridge_with_two_phones();
    let events = open_for(&bridge, DeviceId::new(1), "req", "turn");

    // Nine cards into a screen that holds eight: the ninth is refused, which is
    // the branch that asks the sidecar.
    let over: Vec<pending::Card> = (0..9).map(|at| routed(1, "req", &format!("{at:032x}"))).collect();
    let before = std::time::Instant::now();
    bridge.route_cards(over);
    let took = before.elapsed();

    assert!(took < std::time::Duration::from_millis(500), "routing blocked for {took:?} waiting on the sidecar");
    // And it still did the work: the eighth is on the phone's stream and the
    // ninth is not, without anything having been waited for.
    let mut sent: Vec<ChatEvent> = events.try_iter().collect();
    assert_eq!(sent.len(), 8, "every card up to the cap is shown");
    sent.clear();
    assert!(sent.is_empty());
    assert_eq!(lock(&bridge.cards).held_in(&cards::conversation_of(DeviceId::new(1))), 8);

    // **And the other branch: a phone that is unpaired under its card.** The card
    // is held, the phone is paired, and the pairing changes — the decline that
    // asks the sidecar to let it go is decided here and sent after the table is
    // set, from inside this same runtime.
    let bridge = bridge_with_two_phones();
    lock(&bridge.cards).note(held(1, "cred-a", "", ID), Instant::now());
    let before = std::time::Instant::now();
    bridge.pair(&[(DeviceId::new(2), "cred-b".to_string())]);
    let took = before.elapsed();
    assert!(took < std::time::Duration::from_millis(500), "unpairing blocked for {took:?} waiting on the sidecar");
    // The card is gone from the bridge and the pairing is already the new one,
    // which is the order the declines are sent in.
    assert!(!lock(&bridge.cards).shows("", &(DeviceId::new(1), digest("cred-a")), ID), "a forgotten phone kept its card");
    // The table is whole when this returns. **What it cannot show** is the order
    // against the decline itself: sending one needs an app, so here the decline is
    // never dispatched and an ordering that put it first would look the same. The
    // order is in the code — `*lock(&self.paired) = owners;` then
    // `self.send_declines(…)` — and the answer path's own re-check, which does
    // read the table, is held by the proof above.
    assert_eq!(lock(&bridge.paired).as_slice(), &[(DeviceId::new(2), digest("cred-b"))], "the pairing is whole when this returns");
}
