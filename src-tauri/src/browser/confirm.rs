//! How a card reaches the window and how a person's answer reaches the sidecar
//! (one responsibility: the round trip, in both directions).
//!
//! **The window is not a second copy of the truth.** Everything waiting is read
//! from the sidecar, which is the only thing that can dispatch or drop a held
//! request; this only draws what it says and hands back what a person pressed.
//!
//! **Nothing here decides anything.** A press is an id, and the id is spent
//! inside the sidecar before anything is dispatched, so the window cannot send a
//! request twice even by being asked to twice.
//!
//! **Desktop turns only.** The chat offers these tools on a desktop and not on a
//! phone, so a phone turn has no browser write to confirm — until the phone gets
//! the card too, this is the whole of the boundary rather than a rule someone
//! has to remember at the call site.

use std::time::Instant;

use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use super::error::{BrowserError, CommandFailure};
use super::pending::{self, Card, Field};
use super::state::BrowserState;

/// What the chat listens for. One event, carrying the whole list: a card that
/// has been answered or has expired is simply not on it, so the window draws
/// from one message and never from a diff it could get out of step with.
pub(crate) const CARDS: &str = "browser_cards";

/// What the chat listens for after a person answers, so the model is told what
/// became of the request rather than waiting to be told by the next call alone.
pub(crate) const ANSWERED: &str = "browser_answered";

/// What a person pressed, and what became of it.
///
/// **A code and a host. Nothing else, and in particular no sentence.** The
/// sidecar used to answer in its own words and this handed them straight on, which
/// put a path — and whatever a stranger's site wrote in the query — into a line
/// the model reads and then into a disk on it. It says which outcome this was and
/// where; the app and the chat build the words themselves, from their own copy,
/// out of those two things.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Answered {
    pub id: String,
    /// The conversation that caused the request. The note rides that turn and no
    /// other: an outcome in a chat that never asked for the request is worse
    /// than no outcome at all.
    pub conversation: String,
    /// One of [`CODES`]. Anything else the sidecar said is read as [`UNCLEAR`]:
    /// an outcome nobody can name is not one to report as anything nicer.
    pub code: String,
    /// The host, for a request that went. Omitted rather than empty when there
    /// was no address to name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
}

/// Every code the sidecar may report, and nothing else.
pub(crate) const CODES: [&str; 6] = ["sent", "declined", "expired", "gone", "unsendable", "unclear"];

/// What a press whose answer never came back is reported as. **Never "not sent"**:
/// the card was already spent and the dispatch was already under way, so what
/// that server saw could not be established, and a model that reads "declined"
/// will try again.
pub(crate) const UNCLEAR: &str = "unclear";

/// The code a window closing reports for everything it was holding: the request
/// was dropped and nothing went. It reads as **declined**, and not as the window
/// having gone, because the sidecar's own `Gone` is a single "the window closed"
/// for the turn while a person needs to know that *each* request they were being
/// asked about is not going to be sent.
pub(crate) const DECLINED: &str = "declined";

/// Re-reads what is waiting and tells the window, if anything changed.
///
/// **The call is optional.** A click on a link, or a type into a field that
/// sends nothing, leaves the sidecar with nothing to draw; then this is not
/// asked at all, because a failure to read the list is not a failure of the
/// click that came before it.
pub(crate) async fn refresh(app: &AppHandle, state: &State<'_, BrowserState>) {
    let Ok(app_data) = app.path().app_data_dir() else {
        return;
    };
    let Ok(listed) = state.inner().browser().call(&app_data, "browser_waiting", Map::new()).await else {
        return;
    };
    let cards = cards_of(&listed);
    let waiting = state.inner().pending();
    waiting.forget_stale(Instant::now());
    waiting.replace_with(cards.clone(), Instant::now());
    // **A phone's write is drawn on that phone and on no desktop.** The window is
    // told about the rest and only the rest: a card the owner cannot answer from
    // this window is a card that must not sit here looking answerable. The phone's
    // half — which phone owns it, when it expires, who may press it — is the
    // phone bridge's, and it is told the whole list so nothing is left behind when
    // a phone is not there to be shown it.
    let (for_phones, for_window): (Vec<Card>, Vec<Card>) =
        cards.into_iter().partition(|card| crate::phone_chat::is_phone_conversation(&card.conversation));
    crate::phone_chat::route_cards(app, for_phones);
    let _ = app.emit(CARDS, for_window);
}

/// **A card was spent and no answer came back.** Said to the window and to the
/// model, and refreshed so the card comes off the board. The phone's own button
/// goes through the same sentence by calling this rather than repeating it.
pub(crate) async fn answer_failed(app: &AppHandle, state: &State<'_, BrowserState>, id: &str, conversation: &str) {
    let _ = app.emit(
        ANSWERED,
        Answered { id: id.to_owned(), conversation: conversation.to_owned(), code: UNCLEAR.to_owned(), host: None },
    );
    refresh(app, state).await;
}

/// Actually the cards, rather than a count: the window has to draw them, and a
/// count is a thing it would then have to ask a second question to resolve.
///
/// **A card the sidecar would not show is not drawn.** Every field is dropped
/// rather than guessed at if it does not have the two names the window needs —
/// a card drawn with a missing address is a card the person answers blind.
fn cards_of(listed: &str) -> Vec<Card> {
    let Ok(Value::Array(cards)) = serde_json::from_str::<Value>(listed) else {
        return Vec::new();
    };
    cards.iter().filter_map(|card| {
        let (Some(id), Some(method), Some(url)) =
            (string_of(card, "id"), string_of(card, "method"), string_of(card, "url"))
        else {
            return None;
        };
        let fields = card
            .get("fields")
            .and_then(Value::as_array)
            .map(|fields| {
                fields
                    .iter()
                    .filter_map(|field| {
                        Some(Field {
                            name: string_of(field, "name")?,
                            value: string_of(field, "value")?,
                            secret: field.get("secret").and_then(Value::as_bool).unwrap_or(false),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Some(pending::card_of(&id, &method, &url, &conversation_of(card), fields))
    })
    .collect()
}

fn string_of(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
}

/// Which conversation a card belongs to. **Absent is the empty one, not the
/// first**: a card that names no conversation is a card that no conversation can
/// answer, which is the safe way round.
fn conversation_of(card: &Value) -> String {
    string_of(card, "conversation").unwrap_or_default()
}

/// What the sidecar said, read as a code and a host — and nothing else.
///
/// **The host is checked here rather than trusted**, because this is the last
/// place before the model: a host is a run of letters, digits, dots and dashes
/// (or a bracketed IPv6 address), and a path, a query, a fragment, a port or a
/// user@ in one of those is not a host and is dropped.
pub(crate) fn outcome_of(said: &str) -> (String, Option<String>) {
    let Ok(Value::Object(said)) = serde_json::from_str::<Value>(said) else {
        return (UNCLEAR.to_owned(), None);
    };
    let code = said.get("code").and_then(Value::as_str).filter(|code| CODES.contains(code));
    let host = said.get("host").and_then(Value::as_str).and_then(host_only);
    (
        code.unwrap_or(UNCLEAR).to_owned(),
        host.filter(|_| code == Some("sent")).map(str::to_owned),
    )
}

/// **A bare host, or nothing.** Letters, digits, dots and dashes — or a
/// bracketed IPv6 address, which is the one host that may carry colons. A port,
/// a path, a query, a fragment, a `user@` and a space are all refused, so a
/// host is a thing that can be put in a sentence and nothing else can.
fn host_only(host: &str) -> Option<&str> {
    let plain = |name: &str| {
        !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    };
    let bracketed = host.strip_prefix('[').and_then(|rest| rest.strip_suffix(']'));
    (bracketed.is_some_and(|name| {
        !name.is_empty() && name.chars().all(|c| c.is_ascii_hexdigit() || matches!(c, ':' | '.'))
    }) || plain(host))
    .then_some(host)
}

/// The person's answer. The card comes off the window first, so a second press
/// finds nothing to press about, and the sidecar spends the id before it
/// dispatches — so even a press that got this far twice sends one request.
/// **Lets one held request go, by its id, in the conversation that raised it.**
///
/// The path a person's own "no" takes, and for a phone the only one that
/// matters: **the hold is the sidecar's, and only the sidecar can drop it.** A
/// phone that unpairs, or a ninth write that is refused, has to reach the hold
/// itself — a local note says nothing to the process still sitting on the
/// request, and the model-facing outcome list is the sidecar's too, so this is
/// what settles both. A card the sidecar no longer holds is not an error: it was
/// answered, or it expired, and both were settled where they happened.
pub(crate) async fn decline_one(
    app: &AppHandle,
    state: &State<'_, BrowserState>,
    id: &str,
    conversation: &str,
    why: &'static str,
) {
    let Ok(app_data) = app.path().app_data_dir() else {
        return;
    };
    state.inner().pending().spend_in(id, conversation);
    let mut args = two(id, conversation);
    args.insert("why".to_owned(), Value::from(why));
    let _ = state.inner().browser().call(&app_data, "browser_decline", args).await;
    // **No refresh here, on purpose.** The card is already spent in this app's
    // store, so the window and the phone stop showing it whatever the sidecar
    // says. A refresh would re-read the whole list and call back into
    // `phone_chat::route_cards`, which decides on declines of its own — the two
    // are callers of each other, and a refresh inside a decline is how that
    // becomes a loop rather than a pass.
}

/// **How a dispatch ended, or that nobody ever said.**
///
/// `Unclear` is not an error code, because it is the one case where the app
/// cannot tell the person what happened: the request was already at the sidecar
/// and that sidecar has not said whether it went. It is never `declined` — a
/// model that reads "declined" for a request that went will try again.
#[derive(Debug)]
pub(crate) enum Dispatch<T> {
    /// The dispatch came back, one way or the other. What it said is the
    /// caller's to read.
    Answered(T),
    /// The budget ran out with the request still at the sidecar.
    Unclear,
}

/// **Waits for the sidecar's answer, and no longer than the card's own budget.**
///
/// The lane this sits on is the door's — a phone's answer is dispatched from a
/// door thread with no runtime of ours — so a sidecar that stops answering would
/// otherwise hold a door thread for ever, and the phone's turn with it. The
/// budget is what the person was promised, so it is what the wait is worth: past
/// it the wait ends and the card is reported as unclear, never retried.
///
/// **Only the deadline is this function's.** A refusal is an answer, and the
/// caller's own words for it are better than anything invented here.
pub(crate) async fn await_dispatch<F: std::future::Future<Output = T>, T>(
    budget: std::time::Duration,
    dispatch: F,
) -> Dispatch<T> {
    match tokio::time::timeout(budget, dispatch).await {
        Ok(answered) => Dispatch::Answered(answered),
        Err(_elapsed) => Dispatch::Unclear,
    }
}

pub(crate) async fn answer(
    app: &AppHandle,
    state: &State<'_, BrowserState>,
    id: String,
    conversation: String,
    allow: bool,
) -> Result<String, CommandFailure> {
    // Only where it was raised: a card from another conversation is not this
    // one's to press, and it stays on the window for whoever did cause it.
    state.inner().pending().spend_in(&id, &conversation).ok_or(BrowserError::NoCard)?;
    let app_data = app.path().app_data_dir().map_err(|_| CommandFailure::from(super::error::BrowserError::Storage))?;
    let tool = if allow { "browser_confirm" } else { "browser_decline" };
    let said = match state.inner().browser().call(&app_data, tool, two(&id, &conversation)).await {
        Ok(said) => said,
        Err(refused) => {
            // **The card is spent and no answer came back.** The person pressed a
            // button and this is the last moment anybody can tell them what it
            // did: swallowed here, the model never hears, the person never hears,
            // and both go on believing nothing happened while a stranger's server
            // may already have it.
            answer_failed(app, state, &id, &conversation).await;
            return Err(CommandFailure::from(refused));
        }
    };
    let (code, host) = outcome_of(&said);
    let _ = app.emit(ANSWERED, Answered { id, conversation, code, host });
    refresh(app, state).await;
    Ok(said)
}

/// **The window went: every card is declined, and each one says so.**
///
/// Declined locally, without a round trip, and that is the point: the sidecar is
/// being killed with the window, so there is nobody left to ask, and a close that
/// waited on a call to a process that is on its way out is a close that hangs. A
/// decline never dispatches, so **declined is the truth whatever the sidecar did
/// or did not hear** — the request was held, and it was not let through.
///
/// The person is told each one rather than being shown an empty window: "nothing
/// was sent" and "we did not tell you what" are different, and only the second
/// one is what happened.
pub(crate) fn declined_by_the_window_going(app: &AppHandle, state: &State<'_, BrowserState>) {
    decline_all_and_tell_phones(app, state);
    for said in take_every_card(state) {
        let _ = app.emit(ANSWERED, said);
    }
}

pub(crate) async fn decline_all(app: &AppHandle, state: &State<'_, BrowserState>) {
    declined_by_the_window_going(app, state)
}

/// Every card on the window, taken off it and reported as declined — **one
/// answer per card**, in the conversation that raised it, so each note lands
/// where the request was asked for.
///
/// It does not await anything: a decline never dispatches, so what is left to do
/// is to say it. That is what lets a window event, which is not async, call the
/// same thing the close command does.
pub(crate) fn take_every_card(state: &State<'_, BrowserState>) -> Vec<Answered> {
    state
        .inner()
        .pending()
        .cards()
        .into_iter()
        .filter_map(|card| {
            state.inner().pending().spend_in(&card.id, &card.conversation)?;
            Some(Answered { id: card.id, conversation: card.conversation, code: DECLINED.to_owned(), host: None })
        })
        .collect()
}

/// **The window says the cards it is answering go away; the phone's are the
/// phone's.** A card raised by a phone's turn is not drawn here and is not
/// answered here, so the empty list it is told must not claim it is still waiting
/// for the owner to press something that was never on this screen.
pub(crate) fn decline_all_and_tell_phones(app: &AppHandle, state: &State<'_, BrowserState>) {
    let (phone_cards, window_cards): (Vec<Card>, Vec<Card>) = state
        .inner()
        .pending()
        .cards()
        .into_iter()
        .partition(|card| crate::phone_chat::is_phone_conversation(&card.conversation));
    let _ = app.emit(CARDS, window_cards);
    crate::phone_chat::decline_phones(app, phone_cards);
}

fn two(id: &str, conversation: &str) -> Map<String, Value> {
    let mut args = Map::new();
    args.insert("id".to_owned(), Value::from(id));
    args.insert("conversation".to_owned(), Value::from(conversation));
    args
}

#[cfg(test)]
mod tests {
    use super::{cards_of, host_only, outcome_of, pending, Answered, CODES, DECLINED, UNCLEAR};

    /// **A phone's write is drawn on that phone and on no desktop.** The split is
    /// the conversation the card was stamped with, and the rule is the prefix: a
    /// desktop conversation is a UUID and can never begin with it, so the only
    /// cards that leave for a phone are cards a phone asked for.
    ///
    /// Proven here on the split itself rather than on a running app, because the
    /// app is what a person would see the mistake on: a phone's card drawn on the
    /// desktop is a card that looks answerable and answers nothing.
    #[test]
    fn a_phones_card_leaves_the_window_and_a_desktops_card_stays() {
        let listed = r#"[
          {"id":"c1","method":"POST","url":"https://shop.example/order","fields":[]},
          {"id":"c2","method":"POST","url":"https://shop.example/order","fields":[]},
          {"id":"c3","method":"POST","url":"https://shop.example/order","fields":[]}
        ]"#;
        let cards = cards_of(listed);
        // The sidecar names the conversation on each card; the two below are what
        // it names for a desktop and for a phone.
        assert_eq!(cards.len(), 3, "the sidecar is holding all three");
        let desktop = "3f0a1c2e-9b7d-4f21-8a55-6c1e2b3d4f50";
        let phone = crate::phone_chat::conversation_of(kalsa_door::DeviceId::new(2));
        let split = |one: &str| crate::phone_chat::is_phone_conversation(one);
        assert!(!split(desktop), "a desktop conversation was taken for a phone's");
        assert!(split(&phone), "a phone's own conversation was not taken for a phone's");
        // And the rule is a prefix and nothing else: nothing else can be one.
        assert!(!split(""), "an empty conversation was taken for a phone's");
        assert!(!split("phone"), "the bare prefix was taken for a phone's");
        assert!(!split(&format!("x{desktop}")), "a prefixed uuid was taken for a phone's");
    }

    /// The sidecar's list is drawn as it stands: every card, with its fields as
    /// sent. **A secret field arrives with its value** and a flag saying the
    /// window should draw dots — the value is what the person is deciding about,
    /// and it is kept in the window's own state, not here.
    #[test]
    fn every_card_the_sidecar_lists_is_drawn_with_its_fields_as_sent() {
        let listed = r#"[
          {"id":"c1","method":"POST","url":"https://shop.example/order",
           "fields":[{"name":"city","value":"Bologna","secret":false},
                     {"name":"csrf","value":"a-token","secret":false}]},
          {"id":"c2","method":"POST","url":"https://shop.example/login",
           "fields":[{"name":"passphrase_2","value":"hunter2","secret":true}]}
        ]"#;
        let cards = cards_of(listed);
        assert_eq!(cards.len(), 2, "both cards are on the window");
        assert_eq!(cards[0].method, "POST");
        assert_eq!(cards[0].url, "https://shop.example/order");
        assert_eq!(cards[0].fields.len(), 2, "every field is a field");
        assert_eq!(cards[0].fields[1].name, "csrf");
        assert!(cards[1].fields[0].secret, "and the one that is a secret says so");
        assert_eq!(cards[1].fields[0].value, "hunter2", "with the value on it, because that is what goes");
        assert!(!format!("{:?}", cards[1].fields[0]).contains("hunter2"), "while nothing prints it");
        assert!(cards[0].asked_at_ms > 0, "a card with no time is a card with no clock");
    }

    /// A card the person would be answering blind is not drawn at all: no
    /// address, no id, or a field missing the name the window shows it by. An
    /// empty window is better than a card that cannot be read.
    #[test]
    fn a_card_that_cannot_be_read_is_not_drawn() {
        let cards = cards_of(r#"[{"method":"POST","url":"https://a.example/x","fields":[]}]"#);
        assert!(cards.is_empty(), "a card with no id cannot be answered");
        assert!(cards_of(r#"[{"id":"c1","method":"POST","fields":[]}]"#).is_empty(), "nor one with no address");
        let nameless = cards_of(r#"[{"id":"c1","method":"POST","url":"https://a.example/x","fields":[{"value":"Bologna"}]}]"#);
        assert_eq!(nameless.len(), 1, "the card itself is still readable");
        assert!(nameless[0].fields.is_empty(), "and a field with no name is dropped, not drawn blank");
    }

    /// Nothing waiting, or something the sidecar said that is not a list, is an
    /// empty window and not a panic: the window must never be the thing that
    /// breaks because a stranger's server answered oddly.
    #[test]
    fn nothing_waiting_is_an_empty_window_and_odd_words_are_not_a_list() {
        assert!(cards_of("[]").is_empty());
        assert!(cards_of("not json at all").is_empty());
        assert!(cards_of(r#"{"id":"c1"}"#).is_empty());
    }

    /// The window's own store: a card is on it until it is answered, and a
    /// second press of the same id finds nothing.
    #[test]
    fn a_second_press_of_the_same_card_finds_nothing_to_press_about() {
        let pending = pending::Pending::default();
        let cards = cards_of(r#"[{"id":"c1","method":"POST","url":"https://a.example/x","conversation":"chat-a","fields":[]}]"#);
        for card in cards {
            pending.note(card);
        }
        assert_eq!(pending.waiting(), 1);
        assert!(pending.spend_in("c1", "chat-a").is_some());
        assert!(pending.spend_in("c1", "chat-a").is_none());
    }

    /// **A card belongs to the chat whose turn raised it.** It is drawn and
    /// answered there, and another chat pressing the id is refused — with the
    /// card left alone, because the person who caused it is still looking at it.
    #[test]
    fn a_card_is_answered_only_in_the_conversation_that_caused_it() {
        let pending = pending::Pending::default();
        pending.note(pending::card_of("c1", "POST", "https://a.example/x", "chat-a", Vec::new()));
        assert_eq!(
            pending.card("c1").expect("it is on the window").conversation,
            "chat-a",
            "and it says which chat that is"
        );

        assert!(pending.spend_in("c1", "chat-b").is_none(), "another chat cannot press it");
        assert_eq!(pending.waiting(), 1, "and it is still there for the chat that can");
        assert!(pending.spend_in("c1", "chat-a").is_some(), "which can, exactly once");
    }

    /// The card the sidecar lists says which conversation caused it, and a card
    /// that names none belongs to none: a window that guessed would draw a card
    /// in a chat that never caused the request.
    #[test]
    fn a_card_carries_its_conversation_and_one_that_names_none_belongs_to_none() {
        let cards = cards_of(r#"[{"id":"c1","method":"POST","url":"https://a.example/x","conversation":"chat-a","fields":[]},
                              {"id":"c2","method":"POST","url":"https://a.example/x","fields":[]}]"#);
        assert_eq!(cards[0].conversation, "chat-a");
        assert_eq!(cards[1].conversation, "", "and no conversation is the empty one, not the first");
    }

    /// **What crossed into the app is a code and a validated host, and the host
    /// is checked here rather than trusted.** A path or a query on a stranger's
    /// site is theirs — a session token in a query is the reason — so anything
    /// that is not a bare host is dropped, and an address that is all query and
    /// no host is reported with no host at all.
    #[test]
    fn an_outcome_is_a_code_and_a_bare_host_and_never_a_path_or_a_query() {
        assert_eq!(
            outcome_of(r#"{"code":"sent","host":"shop.example"}"#),
            ("sent".to_owned(), Some("shop.example".to_owned()))
        );
        assert_eq!(outcome_of(r#"{"code":"declined","host":"shop.example"}"#).0, "declined");
        assert_eq!(
            outcome_of(r#"{"code":"declined","host":"shop.example"}"#).1,
            None,
            "and only a request that went names where"
        );

        for injected in [
            "shop.example/order?token=sk-live-SECRET",
            "https://shop.example/checkout?next=//evil.example",
            "shop.example:8443",
            "user@shop.example",
            "",
            "shop example",
        ] {
            assert_eq!(outcome_of(&format!(r#"{{"code":"sent","host":"{injected}"}}"#)).1, None, "{injected:?} is not a host");
        }
        assert_eq!(host_only("shop.example"), Some("shop.example"));
        assert_eq!(host_only("[::1]"), Some("[::1]"), "a bracketed IPv6 address is a host");

        // Anything the sidecar says that is not a code of ours is unclear: an
        // outcome nobody can name is not one to report as something nicer.
        assert_eq!(outcome_of(r#"{"code":"fine, thanks"}"#), (UNCLEAR.to_owned(), None));
        assert_eq!(outcome_of("the page did not answer that call"), (UNCLEAR.to_owned(), None));
        assert_eq!(outcome_of(r#"{"code":"sent"}"#), ("sent".to_owned(), None), "a send with no address says so");
    }

    /// **Every code there is, and nothing else.** A window closing reports
    /// `declined` for what it was holding — the request was dropped and nothing
    /// went — and a person pressing "no" reports the same one, which is why the
    /// sentence for it is written as "not allowed" rather than as "you said no":
    /// both are true, and only the first is always true.
    #[test]
    fn a_window_that_closes_declines_everything_it_was_holding() {
        let pending = pending::Pending::default();
        for (id, chat) in [("c1", "chat-a"), ("c2", "chat-a"), ("c3", "chat-b")] {
            pending.note(pending::card_of(id, "POST", "https://a.example/x", chat, Vec::new()));
        }
        assert_eq!(pending.waiting(), 3);

        // What `decline_all` does, without the app handle: each card is taken in
        // the conversation that raised it, and each is reported as declined.
        let mut declined = Vec::new();
        for card in pending.cards() {
            if let Some(gone) = pending.spend_in(&card.id, &card.conversation) {
                declined.push(Answered { id: gone.id, conversation: gone.conversation, code: DECLINED.to_owned(), host: None });
            }
        }
        assert_eq!(declined.len(), 3, "every card, not one for the window");
        assert_eq!(pending.waiting(), 0, "and none of them is left on the window to answer");
        assert!(declined.iter().all(|one| one.code == DECLINED), "each is a declined request: {declined:?}");
        assert_eq!(
            declined.iter().map(|one| one.conversation.as_str()).collect::<Vec<&str>>(),
            vec!["chat-a", "chat-a", "chat-b"],
            "and each says which chat it belonged to, so its note lands there"
        );
        assert!(CODES.contains(&DECLINED));
    }

    /// **What leaves this side is the code, the host and the conversation —
    /// nothing else.** This is the shape that reaches the chat, and a sentence
    /// here would be a sentence somebody else's words chose.
    #[test]
    fn what_the_chat_is_told_is_a_code_a_host_and_a_conversation() {
        let said = serde_json::to_value(Answered {
            id: "c1".to_owned(),
            conversation: "chat-a".to_owned(),
            code: "sent".to_owned(),
            host: Some("shop.example".to_owned()),
        })
        .expect("serializes");
        assert_eq!(said["code"], "sent");
        assert_eq!(said["host"], "shop.example");
        assert_eq!(said["conversation"], "chat-a");
        let keys: Vec<&str> = said.as_object().expect("an object").keys().map(String::as_str).collect();
        let mut sorted = keys.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, ["code", "conversation", "host", "id"], "and there is nothing else to read");

        let nothing_to_name = serde_json::to_value(Answered {
            id: "c2".to_owned(),
            conversation: "chat-a".to_owned(),
            code: UNCLEAR.to_owned(),
            host: None,
        })
        .expect("serializes");
        assert!(nothing_to_name.get("host").is_none(), "a decline names no host, so it carries none");

        assert_eq!(CODES.len(), 6, "and these are the six codes there is");
    }
}
#[cfg(test)]
mod dispatch_tests {
    use super::{await_dispatch, Dispatch};
    use std::time::Duration;

    /// **A sidecar that stops answering must not hold the lane for ever.**
    ///
    /// The lane is the door's: a phone's answer is dispatched from a door thread
    /// with no runtime of ours, so an unbounded wait on a sidecar that has stopped
    /// would take the door thread with it — and the phone's turn, and every other
    /// phone behind it. The wait is bounded by the card's own budget, and what
    /// comes back is **unclear** rather than declined, because the request was
    /// already at the sidecar when the wait began and that server may already have
    /// it: a model told "declined" tries again.
    #[tokio::test]
    async fn a_sidecar_that_never_answers_ends_the_lane_and_is_never_retried() {
        let stalled = std::future::pending::<Result<String, super::CommandFailure>>();
        let lane = tokio::time::Instant::now();
        let outcome = await_dispatch(Duration::from_millis(40), stalled).await;
        assert!(matches!(outcome, Dispatch::Unclear));
        assert!(lane.elapsed() < Duration::from_secs(5), "the lane was held: {:?}", lane.elapsed());
    }

    /// **A sidecar that answers in time is its own answer, whatever it said** — a
    /// refusal is an answer too, and the deadline is not this function's to
    /// reinterpret.
    #[tokio::test]
    async fn an_answer_inside_the_budget_is_the_dispatch_s_own() {
        let said = await_dispatch(Duration::from_secs(30), async { Ok::<_, ()>("answered".to_string()) }).await;
        assert!(matches!(said, Dispatch::Answered(Ok(answer)) if answer == "answered"));
        let refused = await_dispatch(Duration::from_secs(30), async { Err::<String, _>(7) }).await;
        assert!(matches!(refused, Dispatch::Answered(Err(7))), "a refusal is an answer: {refused:?}");
    }
}
