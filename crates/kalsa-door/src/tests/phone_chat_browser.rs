//! The phone's browser answer route: which phone may answer which card, what the
//! app is asked, and what comes back.

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde_json::json;

use super::paging_support::status_of;
use super::phone_chat_support::{answer, answer_as, chat_door, event, token_of, Page, TURN};
use super::room_support::{body_json, devices_labeled};
use super::support::bounded;
use crate::clocks::Clocks;

const CARD: &str = "0123456789abcdef0123456789abcdef";

/// **The app is asked with the id and which button the person pressed, and its
/// answer comes back unchanged.** The door decides nothing about whether a write
/// went: the app's card is the card, and the app's own outcome is the outcome.
#[test]
fn an_answer_reaches_the_app_and_its_outcome_comes_back() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let response = answer(
            address,
            "/kalsa/chat/browser/answer",
            &format!(r#"{{"card_id":"{CARD}","answer":"send"}}"#),
        );
        assert_eq!(status_of(&response), 200);
        assert_eq!(body_json(&response), json!({"code": "sent", "host": "shop.example"}));
        assert_eq!(
            *page.answers.lock().unwrap(),
            vec![(1, CARD.to_string(), true)],
            "the app was asked about device 1's card, as a send"
        );
        drop(door);
    });
}

/// **Decline is its own answer, not the absence of one.** A phone that says no
/// must reach the app as a no: a card that fell off because nobody pressed the
/// other button is a card that stays held, and the person is left looking at a
/// question they already answered.
#[test]
fn a_decline_is_asked_as_a_decline() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let response = answer(
            address,
            "/kalsa/chat/browser/answer",
            &format!(r#"{{"card_id":"{CARD}","answer":"decline"}}"#),
        );
        assert_eq!(status_of(&response), 200);
        assert_eq!(page.answers.lock().unwrap().len(), 1);
        assert!(!page.answers.lock().unwrap()[0].2, "a decline was asked as a send");
        drop(door);
    });
}

/// **Another device's credential cannot answer a card it does not hold.** The id
/// is on this wire and is still refused, because the route is bound to the device
/// that authenticated and the app is asked about *that* device's cards — the two
/// are different keys, and only together do they say whose card this is.
///
/// The refusal is the app's, not the door's: the door cannot know which cards
/// exist, and pretending to is how a door starts deciding for a person.
#[test]
fn another_devices_credential_cannot_answer_a_card_it_does_not_hold() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page {
            answer_browser: Some(Err("card_unknown".to_string())),
            ..Page::default()
        });
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        door.set_devices(devices_labeled(&[(1, "One", token_of(1).as_str()), (2, "Two", token_of(2).as_str())]));
        let response = answer_as(
            address,
            &token_of(2),
            "/kalsa/chat/browser/answer",
            &format!(r#"{{"card_id":"{CARD}","answer":"send"}}"#),
        );
        assert_eq!(status_of(&response), 200);
        assert_eq!(body_json(&response), json!({"error": "card_unknown"}));
        assert_eq!(
            *page.answers.lock().unwrap(),
            vec![(2, CARD.to_string(), true)],
            "the app was asked about device 2, which is who authenticated"
        );
        drop(door);
    });
}

/// **A second answer of the same card is refused, and the first answer stands.**
/// The card was spent before anything was dispatched, so a phone that retries —
/// on a timeout, or on a finger pressed twice — must not send the request twice.
/// The app is the thing that knows, and it says `card_unknown` because there is
/// nothing left of that card to answer.
#[test]
fn a_card_answered_twice_is_refused_the_second_time() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let first = answer(
            address,
            "/kalsa/chat/browser/answer",
            &format!(r#"{{"card_id":"{CARD}","answer":"send"}}"#),
        );
        assert_eq!(body_json(&first), json!({"code": "sent", "host": "shop.example"}));
        let second = answer(
            address,
            "/kalsa/chat/browser/answer",
            &format!(r#"{{"card_id":"{CARD}","answer":"send"}}"#),
        );
        assert_eq!(body_json(&second), json!({"error": "card_unknown"}));
        assert_eq!(page.answers.lock().unwrap().len(), 2, "both presses reached the app");
        drop(door);
    });
}

/// **A body that does not name one of the two buttons is not answered at all.**
/// The door does not choose which way a card went on a phone's behalf, and a verb
/// outside the desktop's own two is a door inventing an action.
#[test]
fn an_answer_naming_anything_but_send_or_decline_is_bad_request() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        for body in [
            format!(r#"{{"card_id":"{CARD}","answer":"retry"}}"#),
            format!(r#"{{"card_id":"{CARD}"}}"#),
            format!(r#"{{"card_id":"{CARD}","answer":true}}"#),
            // An id that is not a card id at all.
            r#"{"card_id":"not-an-id","answer":"send"}"#.to_string(),
            r#"{}"#.to_string(),
        ] {
            let response = answer(address, "/kalsa/chat/browser/answer", &body);
            assert_eq!(status_of(&response), 400, "{body} was not a refusal");
        }
        assert!(page.answers.lock().unwrap().is_empty(), "a bad body reached the app");
        drop(door);
    });
}

/// **An answer is not refused as busy while the phone's own turn is running.**
/// The turn raised the card and finished; the answer is what the person does next,
/// and it has a lane of its own so a card can always be answered.
#[test]
fn an_answer_is_not_blocked_by_the_turn_that_raised_the_card() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        // The turn that raised the card is still running: its stream is open and
        // has said nothing that ends it.
        let running = thread::spawn(move || answer(address, "/kalsa/chat/turn", TURN));
        let opener = page.page(0);
        opener.send(event("accepted", json!({}))).unwrap();
        let response = answer(
            address,
            "/kalsa/chat/browser/answer",
            &format!(r#"{{"card_id":"{CARD}","answer":"decline"}}"#),
        );
        assert_eq!(status_of(&response), 200, "the answer was refused as busy");
        assert_eq!(body_json(&response), json!({"code": "sent", "host": "shop.example"}));
        opener.send(event("done", json!({}))).unwrap();
        assert!(status_of(&running.join().unwrap()) == 200, "the turn did not finish");
        drop(door);
    });
}