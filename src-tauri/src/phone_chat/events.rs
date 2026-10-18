//! The shape of each page event the phone may receive. The page is the WebView,
//! and a script in it can send anything: an event is checked here by its name,
//! by the kind of request it belongs to, and by the mail a turn was pinned to.

use serde_json::Value;

/// A page event the shape check refuses. Nothing of the event is passed on.
pub(super) const BAD_EVENT: &str = "bad_event";
/// An event the request's kind does not take, such as a read on a turn.
pub(super) const WRONG_KIND: &str = "wrong_kind";
/// A draft for another mail than the one the turn was pinned to.
pub(super) const REPLY_PIN: &str = "reply_pin";

const TURN_EVENTS: &[&str] = &[
    "accepted",
    "reasoning",
    "delta",
    "tool_run",
    "cards",
    "draft",
    "browser_card",
    "browser_outcome",
    "recap",
    "error",
    "done",
];
const READ_EVENTS: &[&str] = &["accepted", "read", "error"];

const MAX_CARDS: usize = 100;
const MAX_REASONS: usize = 16;
const TEXT_BYTES: usize = 1024 * 1024;
const GIST_BYTES: usize = 4 * 1024;
const SUBJECT_BYTES: usize = 1024;
const ADDRESS_BYTES: usize = 512;
const BODY_BYTES: usize = 64 * 1024;
const ID_BYTES: usize = 256;
const CODE_BYTES: usize = 64;
/// Fields on one browser card. A form with more than this is not a form a person
/// reads before answering it, and the card is the thing they are deciding on.
const MAX_FIELDS: usize = 200;
/// One field's value. A body is capped by the sidecar as well; this is the cap on
/// what one phone frame will carry.
const VALUE_BYTES: usize = 8 * 1024;
/// One field's label: the sidecar caps it at sixty characters, and four bytes is the
/// most a character takes, so this is the same cap in the bytes this road carries.
const LABEL_BYTES: usize = 60 * 4;
/// **A host's own cap**, which is what makes one: 253 bytes is the longest a DNS
/// name can be, and it is the rule rather than a frame's size that says whether a
/// string is a host at all.
const HOST_BYTES: usize = 253;
/// **One line of recap.** A phone draws it in a single quiet line and drops a
/// larger event whole, so a line it could not draw anyway is a line that would
/// have taken the rest of the event down with it. 500 bytes is a line in any of
/// the five languages, with room for two full host names and every outcome kind.
const RECAP_BYTES: usize = 500;
/// The address on a card. **The sidecar's own number** — [`hold::MAX_URL`] —
/// repeated here because this is the other end of the wire: a card at every cap
/// has to fit in one phone frame, and an address nobody reads is not worth the
/// megabyte it would take to refuse it. Named from the sidecar's rule, so the
/// two cannot drift.
pub(crate) const URL_BYTES: usize = 8 * 1024;

/// What became of a request, as the desktop's own closed set. A code outside it is
/// refused: the phone writes its own sentence per code, and inventing one here is
/// how a stranger's words would end up on a phone's screen.
const OUTCOME_CODES: &[&str] = &["sent", "declined", "expired", "gone", "unsendable", "unclear"];

/// The card id an event names, when it names one the shape allows.
pub(super) fn card_id(data: &Value) -> Option<String> {
    text(data, "card_id", ID_BYTES).map(str::to_owned)
}

/// Checks one page event against the kind of its request and, for a turn that
/// was pinned to a mail, against that mail's id.
pub(super) fn check(
    kind: &str,
    pin: Option<u32>,
    name: &str,
    data: &Value,
) -> Result<(), &'static str> {
    let allowed = if kind == "read" {
        READ_EVENTS
    } else {
        TURN_EVENTS
    };
    if !allowed.contains(&name) {
        return Err(WRONG_KIND);
    }
    let shaped = match name {
        "accepted" => data.as_object().is_some_and(serde_json::Map::is_empty),
        "reasoning" | "delta" => text(data, "text", TEXT_BYTES).is_some(),
        "tool_run" => tool_run(data),
        "cards" => cards(data),
        "draft" => return draft(data, pin),
        "read" => {
            data.get("record").is_some_and(Value::is_object)
                && text(data, "body", TEXT_BYTES).is_some()
        }
        "browser_card" => browser_card(data),
        "browser_outcome" => browser_outcome(data),
        // **What Kalsa did, in one line** (docs §3). Text and nothing else: it
        // is drawn as it arrives, so a shape this check does not name is a line
        // the phone cannot draw and must not show a field of as if it could.
        "recap" => text(data, "text", RECAP_BYTES).is_some(),
        "error" => text(data, "code", CODE_BYTES).is_some(),
        "done" => data.is_object(),
        _ => false,
    };
    if shaped {
        Ok(())
    } else {
        Err(BAD_EVENT)
    }
}

/// A reply id the page sends as digits, or as a bare number.
pub(super) fn reply_id(value: Option<&Value>) -> Option<u32> {
    match value? {
        Value::String(digits) => digits.parse().ok(),
        other => u32::try_from(other.as_u64()?).ok(),
    }
}

fn draft(data: &Value, pin: Option<u32>) -> Result<(), &'static str> {
    let shaped = text(data, "to", ADDRESS_BYTES).is_some()
        && text(data, "to_name", ADDRESS_BYTES).is_some()
        && text(data, "subject", SUBJECT_BYTES).is_some()
        && text(data, "body", BODY_BYTES).is_some();
    let Some(reply) = reply_id(data.get("reply_to_id")).filter(|_| shaped) else {
        return Err(BAD_EVENT);
    };
    if pin.is_some_and(|pin| pin != reply) {
        return Err(REPLY_PIN);
    }
    Ok(())
}

fn tool_run(data: &Value) -> bool {
    text(data, "id", ID_BYTES).is_some()
        && text(data, "name", ID_BYTES).is_some()
        && matches!(
            data.get("state").and_then(Value::as_str),
            Some("running" | "ok" | "failed" | "refused")
        )
}

fn cards(data: &Value) -> bool {
    data.get("kind").and_then(Value::as_str) == Some("cards")
        && data.get("bulk").is_some_and(Value::is_u64)
        && data
            .get("items")
            .and_then(Value::as_array)
            .is_some_and(|items| items.len() <= MAX_CARDS && items.iter().all(card))
}

fn card(item: &Value) -> bool {
    text(item, "id", ID_BYTES).is_some()
        && item.get("from").is_some_and(person)
        && text(item, "subject", SUBJECT_BYTES).is_some()
        && text(item, "gist", GIST_BYTES).is_some()
        && (item.get("date").is_some_and(Value::is_null) || text(item, "date", ID_BYTES).is_some())
        && item.get("labels").is_some_and(labels)
}

fn person(value: &Value) -> bool {
    text(value, "name", SUBJECT_BYTES).is_some() && text(value, "address", ADDRESS_BYTES).is_some()
}

fn labels(value: &Value) -> bool {
    matches!(
        value.get("label").and_then(Value::as_str),
        Some("normal" | "suspicious" | "bulk")
    ) && value
        .get("reasons")
        .and_then(Value::as_array)
        .is_some_and(|reasons| {
            reasons.len() <= MAX_REASONS
                && reasons
                    .iter()
                    .all(|reason| reason.as_str().is_some_and(|code| code.len() <= ID_BYTES))
        })
}

/// One browser card as the phone is shown it. **The value crosses**: the card is
/// what the person decides on, so it is drawn exactly as the desktop draws it —
/// the real value with a flag saying to show dots and a Show button. Whether the
/// flag is honest is the app's business, not this file's; what is checked here is
/// the shape, because the page is the WebView.
fn browser_card(data: &Value) -> bool {
    card_id(data).is_some()
        && text(data, "method", ID_BYTES).is_some()
        && text(data, "url", URL_BYTES).is_some()
        && data.get("asked_at_ms").is_some_and(Value::is_u64)
        && data.get("answer_in_ms").is_some_and(Value::is_u64)
        && data
            .get("fields")
            .and_then(Value::as_array)
            .is_some_and(|fields| fields.len() <= MAX_FIELDS && fields.iter().all(field))
        // **No destination is a card this computer could not name a host for**
        // (docs §3.1), and it travels as `null`: a phone that is sent a
        // destination made up here would be showing a host nobody parsed.
        && destination(data.get("destination"))
}

/// A host, the port when there is one, and whether the connection is secure.
///
/// **Bounded by what a host can be, not by what a frame should carry.** A DNS
/// name is at most 253 bytes and a port is a number from 1 to 65535 or nothing
/// at all — anything else is not a host, and the page is the WebView, so this is
/// checked before a phone draws it.
fn destination(said: Option<&Value>) -> bool {
    match said {
        // **Missing and null are one thing here.** The wire always carries the key
        // — `json!` turns a `None` into `null` — and the phone reads a null
        // destination as no destination, the same as an absent one.
        None | Some(Value::Null) => true,
        Some(said) => {
            text(said, "host", HOST_BYTES).is_some_and(|host| !host.is_empty())
                && matches!(said.get("secure"), Some(Value::Bool(_)))
                && match said.get("port") {
                    None | Some(Value::Null) => true,
                    Some(Value::Number(port)) => {
                        port.as_u64().is_some_and(|port| (1..=65_535).contains(&port))
                    }
                    Some(_) => false,
                }
        }
    }
}

fn field(one: &Value) -> bool {
    text(one, "name", ID_BYTES).is_some()
        && text(one, "value", VALUE_BYTES).is_some()
        && matches!(one.get("secret"), Some(Value::Bool(_)) | None)
        && match one.get("label") {
            // Absent is the field the page gave no words to; present is words, bounded.
            None => true,
            Some(_) => text(one, "label", LABEL_BYTES).is_some(),
        }
}

/// What became of a card: a code from the desktop's own set, and **a host only
/// where a request went** — the same rule the desktop keeps, so a decline, an
/// expiry and a window that closed never put an address on a phone.
fn browser_outcome(data: &Value) -> bool {
    let Some(code) = text(data, "code", CODE_BYTES) else {
        return false;
    };
    if !OUTCOME_CODES.contains(&code) {
        return false;
    }
    match data.get("host") {
        None => true,
        Some(Value::String(host)) => code == "sent" && bare_host(host),
        Some(_) => false,
    }
}

/// **A bare host, or nothing** — the desktop's own rule, checked again on this
/// road. Letters, digits, dots, dashes and underscores, or a bracketed IPv6
/// address. A path, a query, a port and a `user@` are all refused: whatever a
/// stranger's site put in its address is not something to hand a phone.
fn bare_host(host: &str) -> bool {
    if host.is_empty() || host.len() > ADDRESS_BYTES {
        return false;
    }
    let bracketed = host.strip_prefix('[').and_then(|rest| rest.strip_suffix(']')).is_some_and(|name| {
        !name.is_empty() && name.chars().all(|c| c.is_ascii_hexdigit() || matches!(c, ':' | '.'))
    });
    bracketed || host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

fn text<'a>(value: &'a Value, key: &str, max: usize) -> Option<&'a str> {
    value.get(key)?.as_str().filter(|text| text.len() <= max)
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::{
        check, reply_id, ADDRESS_BYTES, BAD_EVENT, BODY_BYTES, HOST_BYTES, LABEL_BYTES, RECAP_BYTES, REPLY_PIN,
        SUBJECT_BYTES, WRONG_KIND,
    };

    fn card_set(item: Value) -> Value {
        json!({"kind": "cards", "bulk": 0, "items": [item]})
    }

    fn good_card() -> Value {
        json!({
            "id": "105",
            "from": {"name": "Studio", "address": "segreteria@studio.example.it"},
            "subject": "Fattura",
            "gist": "",
            "date": null,
            "labels": {"label": "normal", "reasons": []},
        })
    }

    fn draft_of(subject: &str, body: &str, to: &str) -> Value {
        json!({
            "reply_to_id": "105",
            "to": to,
            "to_name": "Studio",
            "subject": subject,
            "body": body,
        })
    }

    #[test]
    fn a_page_event_with_the_wrong_shape_is_refused() {
        assert_eq!(
            check("turn", None, "delta", &json!({"text": 7})),
            Err(BAD_EVENT)
        );
        assert_eq!(
            check(
                "turn",
                None,
                "tool_run",
                &json!({"id": "t", "name": "mail_list", "state": "hacked"})
            ),
            Err(BAD_EVENT)
        );
        assert_eq!(
            check("turn", None, "accepted", &json!({"x": 1})),
            Err(BAD_EVENT)
        );
        assert_eq!(check("turn", None, "error", &json!({})), Err(BAD_EVENT));
        assert!(check(
            "turn",
            None,
            "tool_run",
            &json!({"id": "t", "name": "mail_list", "state": "ok"})
        )
        .is_ok());
    }

    #[test]
    fn a_card_with_an_unknown_badge_is_refused() {
        let mut forged = good_card();
        forged["labels"]["label"] = json!("trusted");
        assert_eq!(
            check("turn", None, "cards", &card_set(forged)),
            Err(BAD_EVENT)
        );
        assert!(check("turn", None, "cards", &card_set(good_card())).is_ok());
    }

    /// **A label is optional and bounded.** A browser card with one is a card, and a
    /// label that is not a string, or is longer than the cap, is refused rather than drawn.
    #[test]
    fn a_browser_card_field_label_is_optional_and_bounded_and_nothing_else() {
        let card_with = |field: Value| {
            json!({
                "card_id": "c1",
                "method": "POST",
                "url": "https://shop.example/order",
                "fields": [field],
                "asked_at_ms": 1,
                "answer_in_ms": 1,
            })
        };
        let plain = json!({"name": "city", "value": "Bologna", "secret": false});
        assert!(check("turn", None, "browser_card", &card_with(plain.clone())).is_ok(), "no label is a field");
        let labelled = json!({"name": "city", "value": "Bologna", "secret": false, "label": "La città"});
        assert!(check("turn", None, "browser_card", &card_with(labelled)).is_ok());
        let not_words = json!({"name": "city", "value": "Bologna", "secret": false, "label": 7});
        assert_eq!(check("turn", None, "browser_card", &card_with(not_words)), Err(BAD_EVENT), "not a string");
        let too_long = json!({"name": "city", "value": "Bologna", "secret": false, "label": "x".repeat(LABEL_BYTES + 1)});
        assert_eq!(check("turn", None, "browser_card", &card_with(too_long)), Err(BAD_EVENT), "over the cap");
    }

    /// **The destination is checked here, on this road, because the page is the
    /// WebView.** A phone draws this as the place the request goes, so a host with
    /// nothing in it, a host longer than a name can be, or a port no network has
    /// is refused rather than drawn. **Missing and `null` are both allowed**:
    /// it is a card this computer could not name a host for, and it travels with
    /// no destination on purpose.
    #[test]
    fn a_browser_card_destination_is_a_bare_host_a_real_port_or_nothing() {
        let with = |destination: Value| {
            json!({
                "card_id": "c1",
                "method": "POST",
                "url": "https://shop.example/order",
                "destination": destination,
                "fields": [],
                "asked_at_ms": 1,
                "answer_in_ms": 1,
            })
        };
        assert!(
            check("turn", None, "browser_card", &with(json!({"host": "shop.example", "port": null, "secure": true}))).is_ok(),
            "no port is a real answer"
        );
        assert!(
            check("turn", None, "browser_card", &with(json!({"host": "a.example", "port": 8443, "secure": false}))).is_ok(),
            "and a port that is one is too"
        );
        assert!(
            check("turn", None, "browser_card", &with(json!({"host": "[::1]", "port": 1, "secure": false}))).is_ok(),
            "an IPv6 host is a host"
        );
        for (why, bad) in [
            ("an empty host", json!({"host": "", "port": null, "secure": true})),
            ("a host longer than a name can be", json!({"host": "x".repeat(HOST_BYTES + 1), "port": null, "secure": true})),
            ("a host that is not words", json!({"host": 7, "port": null, "secure": true})),
            ("a port no network has", json!({"host": "shop.example", "port": 65_536, "secure": true})),
            ("a port of nothing", json!({"host": "shop.example", "port": 0, "secure": true})),
            ("a port that is not a number", json!({"host": "shop.example", "port": "8080", "secure": true})),
            ("a secure flag that is not one", json!({"host": "shop.example", "port": null, "secure": "yes"})),
        ] {
            assert_eq!(check("turn", None, "browser_card", &with(bad)), Err(BAD_EVENT), "{why}");
        }

        // **And a card with no destination is a card**, missing or null: it is the
        // one the computer could not name a host for, and it has to reach the
        // phone so the phone can draw it without a way to send it (docs §3.1).
        assert!(check("turn", None, "browser_card", &with(json!(null))).is_ok(), "a null destination is a card, not a bad one");
        let mut card = with(json!({"host": "shop.example", "port": null, "secure": true}));
        let object = card.as_object_mut().expect("a card is an object");
        object.remove("destination");
        assert!(check("turn", None, "browser_card", &card).is_ok(), "nor is a missing one");
    }

    /// **A recap is one line, and a phone drops a longer event whole.** So the
    /// line is capped at the phone's own number: a line too long to draw is
    /// refused here rather than taking the turn's other events with it.
    #[test]
    fn a_recap_is_one_line_and_a_longer_one_is_refused() {
        let said = |text: &str| json!({"text": text});
        let line = "Kalsa ha: chiesto reg.example.org · scritto in 2 campi · nessun clic";
        assert!(check("turn", None, "recap", &said(line)).is_ok(), "a line is a recap");
        assert!(
            check("turn", None, "recap", &said(&"x".repeat(RECAP_BYTES))).is_ok(),
            "and exactly the cap is still one line"
        );
        assert_eq!(
            check("turn", None, "recap", &said(&"x".repeat(RECAP_BYTES + 1))),
            Err(BAD_EVENT),
            "and one byte past it is an event the phone would drop whole"
        );
        assert_eq!(check("turn", None, "recap", &json!({"text": 42})), Err(BAD_EVENT), "not a line at all");
        assert_eq!(check("turn", None, "recap", &json!({})), Err(BAD_EVENT), "no line at all");
    }

    #[test]
    fn a_read_and_a_turn_do_not_take_each_others_events() {
        assert_eq!(
            check("turn", None, "read", &json!({"record": {}, "body": ""})),
            Err(WRONG_KIND)
        );
        assert_eq!(
            check("read", None, "delta", &json!({"text": "x"})),
            Err(WRONG_KIND)
        );
        assert_eq!(check("read", None, "done", &json!({})), Err(WRONG_KIND));
        assert!(check("read", None, "read", &json!({"record": {}, "body": "x"})).is_ok());
    }

    #[test]
    fn a_draft_field_over_its_cap_is_refused() {
        let long_subject = "s".repeat(SUBJECT_BYTES + 1);
        assert_eq!(
            check(
                "turn",
                None,
                "draft",
                &draft_of(&long_subject, "b", "a@b.example")
            ),
            Err(BAD_EVENT)
        );
        let long_to = "a".repeat(ADDRESS_BYTES + 1);
        assert_eq!(
            check("turn", None, "draft", &draft_of("s", "b", &long_to)),
            Err(BAD_EVENT)
        );
        let long_body = "b".repeat(BODY_BYTES + 1);
        assert_eq!(
            check(
                "turn",
                None,
                "draft",
                &draft_of("s", &long_body, "a@b.example")
            ),
            Err(BAD_EVENT)
        );
        let at_cap = "b".repeat(BODY_BYTES);
        assert!(check(
            "turn",
            None,
            "draft",
            &draft_of("s", &at_cap, "a@b.example")
        )
        .is_ok());
    }

    #[test]
    fn a_draft_for_another_mail_than_the_pinned_one_is_refused() {
        let other = json!({"reply_to_id": 106, "to": "a@b.example", "to_name": "", "subject": "s", "body": "b"});
        assert_eq!(check("turn", Some(105), "draft", &other), Err(REPLY_PIN));
        let pinned = json!({"reply_to_id": "105", "to": "a@b.example", "to_name": "", "subject": "s", "body": "b"});
        assert!(check("turn", Some(105), "draft", &pinned).is_ok());
        assert!(check("turn", None, "draft", &other).is_ok());
    }

    #[test]
    fn a_reply_id_is_digits_or_a_bare_number_and_nothing_else() {
        assert_eq!(reply_id(Some(&json!("105"))), Some(105));
        assert_eq!(reply_id(Some(&json!(105))), Some(105));
        assert_eq!(reply_id(Some(&json!("1x5"))), None);
        assert_eq!(reply_id(Some(&json!(-1))), None);
        assert_eq!(reply_id(None), None);
    }
}
