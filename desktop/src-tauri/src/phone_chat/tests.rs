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
use super::{digest, lock, Bridge, Live, SendOutcome, MAX_EVENT_BYTES, NO_CARD, TURN_ENDED, UNPAIRED};

const ID: &str = "0123456789abcdef0123456789abcdef";

/// Device 1 as paired under the credential "cred-a".
fn owner_a() -> Owner {
    (DeviceId::new(1), digest("cred-a"))
}

/// **The claim one phone's turn makes on the page**: the phone's number, the
/// pairing it belongs to and the turn's own id. This is what the sidecar stamps
/// a card with, and what the bridge matches that card against.
fn claim(device: u32, request: &str) -> String {
    claim_under(device, if device == 1 { "cred-a" } else { "cred-b" }, request)
}

/// **The same claim, for a phone paired under a credential of its own.** The
/// pairing is part of the claim: the same number under another credential is
/// another phone, and it has a claim of its own.
fn claim_under(device: u32, credential: &str, request: &str) -> String {
    let owner = (DeviceId::new(device), digest(credential));
    super::cards::stamp_of(DeviceId::new(device), &super::pairing_of(&owner), request)
}

/// A bridge that has paired device 1 under the credential "cred-a", with one
/// live request of that phone, and the door's end of its events.
///
/// **The live request is a turn whose phone announced it can draw a card** —
/// the capability is the live turn's, so a turn that announced none is a turn
/// whose cards are declined.
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
            stamp: claim(1, "req"),
            draws_cards: kind == "turn",
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
        // **The sidecar stamps the card with the claim of the turn that raised
        // it**, so this is the turn's name and not the phone's conversation.
        conversation: claim_under(device, cred, request),
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
///
/// **The turn announces what the phone's app announced**, so the cards it raised
/// can be drawn: the capability is the live turn's, and a turn that announced
/// none has its cards declined at once. **A read announces nothing**: the
/// capability is a turn's, and a read drives no page at all.
fn open_for(
    bridge: &Bridge,
    device: DeviceId,
    request: &str,
    kind: &'static str,
) -> mpsc::Receiver<ChatEvent> {
    let capabilities = if kind == "turn" { json!([super::CARD_CAPABILITY]) } else { json!([]) };
    open_for_that(bridge, device, request, kind, capabilities)
}

/// A live turn for `device` whose phone announced **no** capability: a phone
/// that cannot be shown a card, whatever the turn says otherwise.
fn open_for_that_cannot_draw(
    bridge: &Bridge,
    device: DeviceId,
    request: &str,
    kind: &'static str,
) -> mpsc::Receiver<ChatEvent> {
    open_for_that(bridge, device, request, kind, json!([]))
}

/// A live turn for `device`, with the capabilities the turn's body carried.
fn open_for_that(
    bridge: &Bridge,
    device: DeviceId,
    request: &str,
    kind: &'static str,
    capabilities: Value,
) -> mpsc::Receiver<ChatEvent> {
    let credential = if device == DeviceId::new(1) { "cred-a" } else { "cred-b" };
    let body = json!({"capabilities": capabilities});
    let asking = super::asking((device, digest(credential)), device, &body, request);
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

fn routed(device: u32, request: &str, id: &str) -> pending::Card {
    pending::card_of(
        id,
        "POST",
        "https://shop.example/order",
        &claim(device, request),
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
            stamp: claim(1, "req-a"),
            draws_cards: true,
        },
    );
    lock(&bridge.live).insert(
        "req-b".to_string(),
        Live {
            owner: (DeviceId::new(2), digest("cred-b")),
            kind: "turn",
            reply_for: None,
            inbox: inbox_b,
            stamp: claim(2, "req-b"),
            draws_cards: true,
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

    let one = super::asking(owner_a(), DeviceId::new(1), &lie, "req-a");
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
        super::asking(owner_a(), DeviceId::new(1), &json!({"messages": [], "device": "1"}), "req-a").conversation,
        one.conversation,
        "whoever the body says, the credential decides"
    );

    // And a different bearer is a different phone, whatever its body claims.
    let seven = super::asking(
        (DeviceId::new(7), digest("cred-b")),
        DeviceId::new(7),
        &json!({"messages": [], "device": "1"}),
        "req-7",
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

    // The ninth is not shown, and not kept either. **And its refusal is not
    // silent**: the turn's stream carries the outcome of the write nobody was
    // asked about, so the model is not left waiting on its "awaiting confirm".
    bridge.route_cards(vec![routed(1, "req", &format!("{NINTH:032x}"))]);
    let said = events.try_recv().expect("the ninth write said nothing at all");
    assert_eq!(said.name, "browser_outcome", "the ninth card was put in front of the person");
    assert_eq!(said.data["card_id"], format!("{NINTH:032x}"), "and about the write that was refused");
    assert!(events.try_recv().is_err(), "and it was said twice");
    assert_eq!(
        lock(&bridge.cards).held_for(DeviceId::new(1)),
        8,
        "and it was kept anyway"
    );

    // The other phone's cap is its own: a second phone is not refused for the
    // first one's backlog.
    let events_b = open_for(&bridge, DeviceId::new(2), "req-b", "turn");
    bridge.route_cards(vec![routed(2, "req-b", &format!("{NINTH:032x}"))]);
    assert_eq!(events_b.try_recv().map(|said| said.name), Ok("browser_card".to_string()));
}

/// **One snapshot of nine cards shows eight and refuses the ninth.** The cap is
/// a count of what the phone is holding, and a list of nine cards that arrive
/// together is nine cards the phone would be asked about at once.
#[test]
fn one_snapshot_of_nine_cards_shows_eight_and_refuses_the_ninth() {
    let bridge = bridge_with_two_phones();
    let events = open_for(&bridge, DeviceId::new(1), "req", "turn");

    let snapshot: Vec<pending::Card> = (0..9).map(|at| routed(1, "req", &format!("{at:032x}"))).collect();
    bridge.route_cards(snapshot);

    let mut shown = 0;
    let mut refused = 0;
    while let Ok(said) = events.try_recv() {
        match said.name.as_str() {
            "browser_card" => shown += 1,
            "browser_outcome" => refused += 1,
            other => panic!("an event nobody expected: {other}"),
        }
    }
    assert_eq!(shown, 8, "every card up to the cap is shown");
    assert_eq!(refused, 1, "and the ninth is refused");
    assert_eq!(lock(&bridge.cards).held_for(DeviceId::new(1)), 8, "and only eight are held");
}

/// **A refresh of the cards a phone already holds declines none of them.**
///
/// The sidecar holds a card until it is answered or expires, and a refresh after
/// every browser call hands the whole list over again. A card the phone already
/// has is not a card to send it a second time — and it is not counted against
/// the cap either, or a refresh of eight held cards would decline all eight.
#[test]
fn a_refresh_of_the_cards_a_phone_already_holds_declines_none_of_them() {
    let bridge = bridge_with_two_phones();
    let events = open_for(&bridge, DeviceId::new(1), "req", "turn");

    let snapshot: Vec<pending::Card> = (0..8).map(|at| routed(1, "req", &format!("{at:032x}"))).collect();
    bridge.route_cards(snapshot.clone());
    assert_eq!(events.try_iter().count(), 8, "every card up to the cap is shown");

    // The same list again, as the refresh after the next browser call sends it.
    bridge.route_cards(snapshot);

    assert!(events.try_recv().is_err(), "a card the phone already has was sent or declined again");
    assert!(lock(&bridge.declined).is_empty(), "and it was declined");
    assert_eq!(lock(&bridge.cards).held_for(DeviceId::new(1)), 8, "and the phone still holds eight");
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

/// **A press that found the browser busy gives the card back.**
///
/// The browser was busy: **nothing was sent**, the request is still held at
/// the sidecar, and the card is still the person's to press. So the card goes
/// back on the table — with the budget it had, because the five minutes the
/// person was given are the five minutes they had.
///
/// Without this the card was gone from the phone's table for a press that
/// never reached anything: the next press was a press about nothing
/// (`card_unknown`), and the person was told their answer had gone to a card
/// that had never been there. The desktop's own reducer puts the card back on
/// a busy browser for exactly this reason; the phone's table has to do the
/// same, or the phone is the one place where a busy browser loses the card.
///
/// **And nothing is told to anybody.** An outcome about a request that never
/// left would be this app saying the request was settled when it was not, and
/// the model would go on believing it has an answer it does not have.
#[test]
fn a_press_that_found_the_browser_busy_gives_the_card_back() {
    let bridge = bridge_with_two_phones();
    lock(&bridge.cards).note(held(1, "cred-a", "req-a", ID), Instant::now());

    // **The press takes the card**, the way a phone's answer does.
    let taken = lock(&bridge.cards)
        .take((DeviceId::new(1), digest("cred-a")), ID, Instant::now())
        .expect("the card is there to be pressed");
    assert!(lock(&bridge.cards).ids().is_empty(), "the card is off the table while it is answered");

    // **And the browser was busy**: nothing was sent.
    assert!(
        bridge.a_press_that_never_went(&taken, crate::browser::error::BrowserError::Busy.code()),
        "a busy browser is a press that never went"
    );

    // **The card is on the table again**, and the person may press it again.
    assert_eq!(lock(&bridge.cards).ids(), vec![ID.to_string()], "the card is on the table again");
    assert!(
        lock(&bridge.cards)
            .take((DeviceId::new(1), digest("cred-a")), ID, Instant::now())
            .is_ok(),
        "and the next press finds the card"
    );
    // **And nothing was told to anybody**: a request that never left has no
    // outcome, so there is no second verdict about it.
    assert!(lock(&bridge.waiting).is_empty(), "a press that never went told somebody something");
}

/// **A press that found the card already resolved leaves it gone, and tells
/// nobody.**
///
/// The request had its verdict somewhere else — from the decline that took it,
/// or from the expiry that removed it — and **nothing was sent**. So it is a
/// press that never went, and it leaves no outcome behind: an outcome about it
/// would be this app saying the request was settled when it was not, and a model
/// told "unclear" about a request it already has the answer to goes on not
/// knowing what it said.
///
/// **And the card does not come back.** A card that came back would be a card
/// the person could press again only to be refused again: there is nothing left
/// to press about it. The busy browser is the other half of the same family, and
/// it is the one that gives the card back.
#[test]
fn a_press_that_found_the_card_already_resolved_leaves_it_gone_and_tells_nobody() {
    let (bridge, events) = bridge_with_request("turn", None);
    lock(&bridge.cards).note(held(1, "cred-a", "req", ID), Instant::now());

    // **The press takes the card**, the way a phone's answer does.
    let taken = lock(&bridge.cards)
        .take((DeviceId::new(1), digest("cred-a")), ID, Instant::now())
        .expect("the card is there to be pressed");
    assert!(lock(&bridge.cards).ids().is_empty(), "the card is off the table while it is answered");

    // **And the card was already resolved somewhere else**: nothing was sent.
    let code = crate::browser::error::BrowserError::NoCard.code();
    assert!(
        bridge.a_press_that_never_went(&taken, code),
        "a card that was already resolved is a press that never went"
    );
    assert!(lock(&bridge.cards).ids().is_empty(), "and the card does not come back");

    // **And nothing was told to anybody**: no outcome on the stream, and
    // nothing queued for the phone to be told later.
    assert!(
        !bridge.report_a_refusal(&taken, code),
        "a press that never went is not reported as one"
    );
    assert!(events.try_recv().is_err(), "an outcome went down the stream");
    assert!(lock(&bridge.waiting).is_empty(), "and something was queued for a phone to be told later");
}

/// **A press that was refused for any other reason does not give the card
/// back.** A busy browser is a press that never went; anything else is a
/// verdict, and a card that has had one is not the person's to press again.
#[test]
fn a_press_that_was_refused_for_another_reason_does_not_give_the_card_back() {
    let bridge = bridge_with_two_phones();
    lock(&bridge.cards).note(held(1, "cred-a", "req-a", ID), Instant::now());
    let taken = lock(&bridge.cards)
        .take((DeviceId::new(1), digest("cred-a")), ID, Instant::now())
        .expect("the card is there to be pressed");

    assert!(
        !bridge.a_press_that_never_went(&taken, crate::browser::confirm::UNCLEAR),
        "a refusal that is a verdict is not a press that never went"
    );
    assert!(lock(&bridge.cards).ids().is_empty(), "and the card is gone, because it was answered");
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
    // And it still did the work: the eighth is on the phone's stream, the ninth
    // is not — its refusal is what is there instead — without anything having
    // been waited for.
    let sent: Vec<ChatEvent> = events.try_iter().collect();
    assert_eq!(
        sent.iter().filter(|event| event.name == "browser_card").count(),
        8,
        "every card up to the cap is shown"
    );
    assert_eq!(
        sent.iter().filter(|event| event.name == "browser_outcome").count(),
        1,
        "and the write over the cap was said, once"
    );
    assert_eq!(lock(&bridge.cards).held_for(DeviceId::new(1)), 8);

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

/// **A phone that is unpaired while its picture is being taken gets no
/// picture.**
///
/// The owner removes a phone in the middle of the capture, and the pairing
/// change lands in the mark the preview is registered under. The picture is
/// taken and thrown away: nothing of the person's page goes to a phone the
/// owner has taken away. What has already gone on the wire is not recalled —
/// there is no way to recall it — but nothing leaves here either.
#[test]
fn a_phone_unpaired_while_its_picture_is_taken_gets_no_picture() {
    let bridge = Arc::new(Bridge::default());
    bridge.pair(&[(DeviceId::new(1), "cred-a".to_string())]);
    // **The phone's turn is running**, so it has a claim of its own to ask the
    // picture for: the picture is asked in the name of that turn's claim.
    let _events = open_for(&bridge, DeviceId::new(1), "req", "turn");

    // **Armed before the preview starts**, then the preview is run on its own
    // thread: this is a race the door and the owner's reconcile thread are
    // really in, and the proof stands in the middle of it.
    bridge.arm_gate();
    let previewing = {
        let bridge = Arc::clone(&bridge);
        std::thread::spawn(move || {
            bridge.preview_guarded(DeviceId::new(1), |_| {
                // The picture, taken while the owner removes the phone.
                Ok(json!({
                    "image": "QUJD",
                    "media_type": "image/jpeg",
                    "host": "shop.example",
                    "taken_at": 1_u64,
                }))
            })
        })
    };
    bridge.wait_at_the_gate();

    // **The owner removes the phone while the picture is being taken.**
    bridge.pair(&[]);
    assert!(
        !lock(&bridge.answering).is_empty(),
        "a preview in flight is known, which is what lets the pairing stop it"
    );
    bridge.release();

    let said = previewing.join().expect("the preview is not a panic");
    assert_eq!(said, Err("cancelled".to_string()), "a forgotten phone is told no");
    // **The mark is taken down however the preview ended**, so a phone that
    // did finish is not left looking as though it were still asking.
    assert!(lock(&bridge.answering).is_empty(), "a preview that has ended is still marked in flight");
}

/// **A picture is only given to a phone that is still paired.** The pairing is
/// asked before the picture is taken, and a phone this computer does not know
/// is refused without one being taken at all.
#[test]
fn a_phone_that_is_not_paired_gets_no_picture() {
    let bridge = Bridge::default();
    bridge.pair(&[(DeviceId::new(1), "cred-a".to_string())]);
    let said = bridge.preview_guarded(DeviceId::new(2), |_| {
        panic!("a picture was taken for a phone this computer does not know")
    });
    assert_eq!(said, Err("unavailable".to_string()));
    assert!(lock(&bridge.answering).is_empty());
}

/// **A phone that is still paired gets its picture.** The pairing is asked
/// twice and both answers are the same phone, so the picture goes.
#[test]
fn a_paired_phone_gets_its_picture() {
    let bridge = Bridge::default();
    bridge.pair(&[(DeviceId::new(1), "cred-a".to_string())]);
    // **The phone's turn is running**, so it has a claim of its own to ask the
    // picture for.
    let _events = open_for(&bridge, DeviceId::new(1), "req", "turn");
    let picture = json!({
        "image": "QUJD",
        "media_type": "image/jpeg",
        "host": "shop.example",
        "taken_at": 1_u64,
    });
    let said = bridge.preview_guarded(DeviceId::new(1), |_| Ok(picture.clone()));
    assert_eq!(said, Ok(picture));
    assert!(lock(&bridge.answering).is_empty(), "the mark is taken down when the preview ends");
}

/// **A phone with no turn of its own is told there is no page.** The picture is
/// asked for in the name of the turn's claim, and a phone whose turn has ended
/// has no claim — so it is refused as no page, and no picture is taken of
/// anything.
#[test]
fn a_phone_with_no_turn_of_its_own_is_told_there_is_no_page() {
    let bridge = Bridge::default();
    bridge.pair(&[(DeviceId::new(1), "cred-a".to_string())]);
    let said = bridge.preview_guarded(DeviceId::new(1), |_| {
        panic!("a picture was taken for a phone with no claim of its own")
    });
    assert_eq!(said, Err("no_page".to_string()));
    assert!(lock(&bridge.answering).is_empty());
}

/// The desktop's own conversation, as a card of the window carries it: a UUID, which
/// can never begin with the phone's prefix.
const DESKTOP: &str = "3f0a1c2e-9b7d-4f21-8a55-6c1e2b3d4f50";

/// **A card a phone cannot be shown is declined at once, and it is never shown.**
///
/// **The phone's app says it cannot draw a card**: its turn announced no
/// capability, and the capability is the live turn's. A card that goes to it
/// anyway is a card nobody can answer, and the person would wait the whole five
/// minutes for it. So the card is declined on the spot with its reason, nothing
/// is held for it, and the phone is handed nothing it could press.
///
/// **And the decline is not silent.** The model's own write is still "awaiting
/// confirm" to it, so the outcome reaches the model's path, and the phone's live
/// turn is handed the outcome too — the same two words the expiry speaks.
#[test]
fn a_card_a_phone_cannot_be_shown_is_declined_at_once_and_never_shown() {
    let bridge = Bridge::default();
    bridge.pair(&[(DeviceId::new(1), "cred-a".to_string())]);
    let events = open_for_that_cannot_draw(&bridge, DeviceId::new(1), "req", "turn");

    bridge.route_cards(vec![routed(1, "req", ID)]);

    let on_the_wire: Vec<ChatEvent> = events.try_iter().collect();
    assert!(
        on_the_wire.iter().all(|event| event.name != "browser_card"),
        "a card reached a phone that cannot draw one"
    );
    assert_eq!(
        lock(&bridge.declined).as_slice(),
        &[(ID.to_string(), NO_CARD)],
        "the card was declined at once, with the reason the model is told"
    );
    assert!(
        !lock(&bridge.cards).shows("req", &(DeviceId::new(1), digest("cred-a")), ID),
        "and nothing was held for it"
    );
    // **The model is told, in the conversation that raised the card**, with the
    // word the sidecar settles such a decline with — the note its next turn
    // reads, and the sentence its next browser call is prefixed with.
    assert_eq!(
        lock(&bridge.told).as_slice(),
        &[(ID.to_string(), claim(1, "req"), "unsendable".to_owned())],
        "the model was not told the request was let go"
    );
    // **The phone's live turn is handed the outcome**, so its screen can settle
    // a request it was never asked about.
    let said: Vec<&ChatEvent> = on_the_wire.iter().filter(|event| event.name == "browser_outcome").collect();
    assert_eq!(said.len(), 1, "the phone was told {} times", said.len());
    assert_eq!(
        said[0].data,
        json!({"card_id": ID, "code": "unsendable"}),
        "the outcome the phone was handed"
    );
}

/// **A card whose turn has ended is declined at once too.** No turn means no socket, and
/// the card would otherwise sit at the sidecar for the rest of its five minutes. The
/// model is told all the same — its write did not go — and the outcome waits in the
/// queue the phone reads at its next turn.
#[test]
fn a_card_whose_turn_has_ended_is_declined_at_once() {
    let bridge = bridge_with_two_phones();

    bridge.route_cards(vec![routed(1, "req", ID)]);

    assert_eq!(lock(&bridge.declined).as_slice(), &[(ID.to_string(), TURN_ENDED)]);
    assert_eq!(
        lock(&bridge.told).as_slice(),
        &[(ID.to_string(), claim(1, "req"), "unsendable".to_owned())],
        "the model was not told the request was let go"
    );
    assert_eq!(
        lock(&bridge.waiting)[&DeviceId::new(1)],
        vec![json!({"card_id": ID, "code": "unsendable"})],
        "the outcome waits for the phone's next turn"
    );
}

/// **A card for a phone that is not paired is declined as an unpair would decline it.**
/// A card for a phone the owner removed was raised by a turn that no longer has anybody
/// to answer it. The model is told — its write did not go — and the phone nothing:
/// a pairing that is gone has no next turn to hear an outcome on.
#[test]
fn a_card_for_a_phone_that_is_not_paired_is_declined_as_an_unpair_would_decline_it() {
    let bridge = Bridge::default();
    bridge.pair(&[(DeviceId::new(1), "cred-a".to_string())]);

    bridge.route_cards(vec![routed(2, "req", ID)]);

    assert_eq!(lock(&bridge.declined).as_slice(), &[(ID.to_string(), UNPAIRED)]);
    assert_eq!(
        lock(&bridge.told).as_slice(),
        &[(ID.to_string(), claim(2, "req"), "unsendable".to_owned())],
        "the model was not told the request was let go"
    );
    assert!(lock(&bridge.waiting).is_empty(), "an outcome was queued for a phone that is no longer paired");
}

/// **A phone's card whose conversation names no usable number is declined at once.**
///
/// The prefix says it is a phone's, but there is no number to find the phone by, so the
/// card is no phone's to be shown. It used to be skipped, and the sidecar's five minutes
/// were the only thing that ever ended it.
#[test]
fn a_phone_card_with_no_usable_number_is_declined_at_once() {
    let bridge = bridge_with_two_phones();
    let malformed = pending::card_of(
        ID,
        "POST",
        "https://shop.example/order",
        "phone:abc",
        vec![],
        Some(pending::Destination { host: "shop.example".to_owned(), port: None, secure: true }),
    );

    bridge.route_cards(vec![malformed]);

    assert_eq!(lock(&bridge.declined).as_slice(), &[(ID.to_string(), NO_CARD)]);
}

/// **A desktop turn never raises a card for a phone.** A desktop's card is the window's
/// to draw and answer: the phone's path does not decline it, does not send it, and does
/// not count it.
#[test]
fn a_desktop_turns_card_is_never_routed_to_a_phone() {
    let bridge = Bridge::default();
    bridge.pair(&[(DeviceId::new(1), "cred-a".to_string())]);
    let events = open_for(&bridge, DeviceId::new(1), "req", "turn");
    let desktop = pending::card_of(
        ID,
        "POST",
        "https://shop.example/order",
        DESKTOP,
        vec![],
        Some(pending::Destination { host: "shop.example".to_owned(), port: None, secure: true }),
    );

    bridge.route_cards(vec![desktop]);

    assert!(events.try_iter().next().is_none(), "a desktop's card reached a phone");
    assert!(lock(&bridge.declined).is_empty(), "and the phone's path declined a card that is not a phone's");
}

/// **The capability is the live turn's own, and it is the turn that decides.**
///
/// Two phones, two turns, one answer each: the turn that announced it can draw
/// a card has its card drawn on it, and the turn that announced nothing has its
/// card declined at once. **Nothing here is a property of the phone or of the
/// build**: it is what each turn said, and the two turns say different things.
#[test]
fn the_capability_is_the_live_turn_s_own_and_not_the_phone_s() {
    let bridge = bridge_with_two_phones();
    let events_a = open_for(&bridge, DeviceId::new(1), "req-a", "turn");
    let events_b = open_for_that_cannot_draw(&bridge, DeviceId::new(2), "req-b", "turn");

    bridge.route_cards(vec![routed(1, "req-a", ID), routed(2, "req-b", "22222222222222222222222222222222")]);

    let sent: Vec<ChatEvent> = events_a.try_iter().collect();
    assert_eq!(
        sent.iter().filter(|event| event.name == "browser_card").count(),
        1,
        "the turn that announced the capability was not shown its card"
    );
    let declined_b: Vec<ChatEvent> = events_b.try_iter().collect();
    assert!(
        declined_b.iter().all(|event| event.name != "browser_card"),
        "a card reached a phone whose turn said it cannot draw one"
    );
    assert_eq!(
        lock(&bridge.declined).as_slice(),
        &[("22222222222222222222222222222222".to_string(), NO_CARD)],
        "and the card that could not be drawn was declined at once, with the reason"
    );
}

/// **A card belongs to the turn that raised it, and to no other turn.**
///
/// The card is stamped with that turn's claim, so a card of a turn that has
/// ended finds no turn to be drawn on — **even when the phone's next turn is
/// running and able to draw**. The protocol says a card arrives on the turn
/// that raised it, once, and that a card whose turn has closed is declined with
/// the reason that the turn had ended.
#[test]
fn a_card_of_a_turn_that_has_ended_is_not_drawn_on_the_phone_s_next_turn() {
    let bridge = bridge_with_two_phones();
    // The turn that raised the card is over; the phone's next turn is running.
    let events = open_for(&bridge, DeviceId::new(1), "req-b", "turn");

    bridge.route_cards(vec![routed(1, "req-a", ID)]);

    assert!(
        events.try_iter().all(|event| event.name != "browser_card"),
        "a card of a turn that had ended was drawn on the phone's next turn"
    );
    assert_eq!(
        lock(&bridge.declined).as_slice(),
        &[(ID.to_string(), TURN_ENDED)],
        "and it was declined with the reason that names what is true: the turn had ended"
    );
}

/// **While the phone cannot draw a card, the first reason is the one given,
/// whatever the turn's state.**
///
/// The card's own turn has ended and the phone's live turn cannot draw a card,
/// so the card is declined with the reason that says the phone cannot be shown
/// one — and not with the reason about the turn that had ended, which is the
/// later of the two.
#[test]
fn while_the_phone_cannot_draw_a_card_the_first_reason_is_the_one_given() {
    let bridge = bridge_with_two_phones();
    // The phone's live turn cannot draw a card.
    let events = open_for_that_cannot_draw(&bridge, DeviceId::new(1), "req-b", "turn");

    bridge.route_cards(vec![routed(1, "req-a", ID)]);

    assert!(
        events.try_iter().all(|event| event.name != "browser_card"),
        "a card reached a phone that cannot draw one"
    );
    assert_eq!(
        lock(&bridge.declined).as_slice(),
        &[(ID.to_string(), NO_CARD)],
        "the first reason is the one given, whatever the turn's state"
    );
}

/// **Two turns of one phone make two claims, and the phone keeps one
/// conversation.**
///
/// The claim names the turn, so a release can let go of one turn's claim and
/// never of another's. The conversation names the phone, so a card's outcome
/// still comes back to the phone that raised it, on whichever turn it reads it.
#[test]
fn two_turns_of_one_phone_make_two_claims_and_one_conversation() {
    let one = claim(1, "req-a");
    let two = claim(1, "req-b");

    assert_ne!(one, two, "a claim that does not name the turn cannot tell two turns apart");
    assert!(one.starts_with("phone:1:"), "and it is the phone's conversation with the turn's own name after it");
    assert_eq!(
        super::cards::conversation_of(DeviceId::new(1)),
        "phone:1",
        "while the conversation itself is the phone's and outlives every turn of it"
    );
}

/// **And the pairing is part of the claim, so another phone under the same
/// number has a claim of its own.**
///
/// A device id is reused once the top one is forgotten, so the next phone
/// paired under it is another phone and not the old one: it must not take over
/// the page the old one left claimed, and it must not read it either.
#[test]
fn a_phone_paired_again_under_the_same_number_makes_another_claim() {
    let old = claim_under(1, "cred-a", "req");
    let new = claim_under(1, "cred-c", "req");

    assert_ne!(old, new, "two pairings under one number made one claim");
    assert!(old.starts_with("phone:1:") && new.starts_with("phone:1:"), "and both name the phone");
}

/// **The picture is asked for in the name of the claim of the turn that opened
/// the page.** The page belongs to the conversation that opened it, so a
/// preview that asked under any other name would be told the page is somebody
/// else's — and the phone would get no picture of the page its own turn is
/// driving.
#[test]
fn the_picture_is_asked_for_in_the_name_of_the_live_turn_s_claim() {
    let (bridge, _events) = bridge_with_request("turn", None);
    let asked = std::cell::RefCell::new(String::new());

    let said = bridge.preview_guarded(DeviceId::new(1), |conversation| {
        *asked.borrow_mut() = conversation.to_string();
        Ok(json!({"image": "QUJD"}))
    });

    assert!(said.is_ok(), "the picture was not given");
    assert_eq!(asked.into_inner(), claim(1, "req"), "the picture was asked for in somebody else's name");
}
