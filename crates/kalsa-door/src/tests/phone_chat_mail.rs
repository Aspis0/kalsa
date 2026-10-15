//! The phone's mail routes through the door's socket: the read the page
//! answers, the send the app answers, and their refusals.

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde_json::json;

use super::paging_support::status_of;
use super::phone_chat_support::{answer, chat_door, event, Page, DRAFT};
use super::room_support::body_json;
use super::support::bounded;
use crate::clocks::Clocks;

#[test]
fn a_mail_read_answers_with_the_record_and_the_body_the_page_gives() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let reading = thread::spawn(move || answer(address, "/kalsa/chat/mail/read", r#"{"id":"105"}"#));
        let sender = page.page(0);
        sender.send(event("accepted", json!({}))).unwrap();
        sender
            .send(event("read", json!({"record": {"id": "105"}, "body": "Ciao", "extra": "left out"})))
            .unwrap();
        let response = reading.join().unwrap();
        assert_eq!(
            body_json(&response),
            json!({"record": {"id": "105"}, "body": "Ciao"})
        );
        assert_eq!(page.opened(), vec![("read".to_string(), json!({"id": "105"}))]);

        let reading = thread::spawn(move || answer(address, "/kalsa/chat/mail/read", r#"{"id":"106"}"#));
        let sender = page.page(1);
        sender.send(event("accepted", json!({}))).unwrap();
        sender.send(event("error", json!({"code": "mail.invalid_account"}))).unwrap();
        assert_eq!(body_json(&reading.join().unwrap()), json!({"error": "mail.invalid_account"}));
        drop(door);
    });
}

#[test]
fn a_mail_read_the_page_never_takes_answers_no_runner() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page {
            refuse_opens: true,
            ..Page::default()
        });
        let (door, address) = chat_door(Some(page), Clocks::default());
        let response = answer(address, "/kalsa/chat/mail/read", r#"{"id":"105"}"#);
        assert_eq!(body_json(&response), json!({"error": "no_runner"}));
        drop(door);
    });
}

#[test]
fn a_send_goes_to_the_app_with_the_draft_and_the_edited_body_only() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let sent = answer(address, "/kalsa/chat/mail/send", &format!(r#"{{"draft_id":"{DRAFT}","body":"Va bene."}}"#));
        assert_eq!(body_json(&sent), json!({"sent_to": "segreteria@studio.example.it"}));
        let unedited = answer(address, "/kalsa/chat/mail/send", &format!(r#"{{"draft_id":"{DRAFT}"}}"#));
        assert_eq!(body_json(&unedited), json!({"sent_to": "segreteria@studio.example.it"}));
        assert_eq!(
            *page.sends.lock().unwrap(),
            vec![
                (DRAFT.to_string(), Some("Va bene.".to_string())),
                (DRAFT.to_string(), None),
            ]
        );
        assert!(page.opened().is_empty(), "a send went through the page");
        drop(door);
    });
}

#[test]
fn a_refused_send_answers_its_code() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page {
            send_answer: Some(Err("draft_unknown".to_string())),
            ..Page::default()
        });
        let (door, address) = chat_door(Some(page), Clocks::default());
        let response = answer(address, "/kalsa/chat/mail/send", &format!(r#"{{"draft_id":"{DRAFT}"}}"#));
        assert_eq!(status_of(&response), 200);
        assert_eq!(body_json(&response), json!({"error": "draft_unknown"}));
        drop(door);
    });
}

#[test]
fn a_mail_body_the_contract_refuses_is_a_bad_request() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let numeric_body = format!(r#"{{"draft_id":"{DRAFT}","body":7}}"#);
        for (target, body) in [
            ("/kalsa/chat/mail/read", r#"{"id":"10x"}"#),
            ("/kalsa/chat/mail/read", r#"{"id":105}"#),
            ("/kalsa/chat/mail/send", r#"{"draft_id":"xyz"}"#),
            ("/kalsa/chat/mail/send", numeric_body.as_str()),
        ] {
            let response = answer(address, target, body);
            assert_eq!(status_of(&response), 400, "{target} took {body}");
        }
        assert!(page.opened().is_empty() && page.sends.lock().unwrap().is_empty());
        drop(door);
    });
}
