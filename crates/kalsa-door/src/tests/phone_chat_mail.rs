//! The phone's mail routes through the door's socket: the read the page
//! answers, the send the app answers, and their refusals.

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde_json::json;

use super::paging_support::status_of;
use super::phone_chat_support::{
    answer, answer_as, chat_door, chat_door_for, event, open_as, token_of, Page, DRAFT,
};
use super::room_support::{body_json, devices_labeled, Reader};
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

#[test]
fn a_second_mail_read_of_one_device_is_busy_while_the_first_waits() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let first = thread::spawn(move || answer(address, "/kalsa/chat/mail/read", r#"{"id":"105"}"#));
        let sender = page.page(0);
        sender.send(event("accepted", json!({}))).unwrap();
        let second = answer(address, "/kalsa/chat/mail/read", r#"{"id":"106"}"#);
        assert_eq!(body_json(&second), json!({"error": "busy"}));
        sender
            .send(event("read", json!({"record": {"id": "105"}, "body": "Ciao"})))
            .unwrap();
        assert_eq!(
            body_json(&first.join().unwrap()),
            json!({"record": {"id": "105"}, "body": "Ciao"})
        );
        drop(door);
    });
}

#[test]
fn mail_reads_waiting_on_the_page_hold_no_door_worker() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door_for(Some(Arc::clone(&page)), Clocks::default(), 5);
        // The door has four workers: four reads waiting on the page would fill them all.
        let mut waiting = Vec::new();
        for device in 1..=4u32 {
            waiting.push(open_as(
                address,
                &token_of(device),
                "POST",
                "/kalsa/chat/mail/read",
                r#"{"id":"105"}"#,
            ));
            page.page(device as usize - 1)
                .send(event("accepted", json!({})))
                .unwrap();
        }
        let sent = answer_as(
            address,
            &token_of(5),
            "/kalsa/chat/mail/send",
            &format!(r#"{{"draft_id":"{DRAFT}"}}"#),
        );
        assert_eq!(body_json(&sent), json!({"sent_to": "segreteria@studio.example.it"}));
        drop(waiting);
        drop(door);
    });
}

#[test]
fn bodies_that_trickle_in_hold_no_door_worker() {
    // Under the door's read patience a worker freed after 10 s would still answer
    // inside 20 s; 5 s is the bound a worker held by a trickle cannot meet.
    bounded(Duration::from_secs(5), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door_for(Some(Arc::clone(&page)), Clocks::default(), 5);
        // Heads declare a body that never arrives: four such requests would hold four workers.
        let mut trickling = Vec::new();
        for device in 1..=4u32 {
            let mut stream = std::net::TcpStream::connect(address).unwrap();
            std::io::Write::write_all(
                &mut stream,
                format!(
                    "POST /kalsa/chat/mail/send HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {}\r\n\
                     Content-Length: 100\r\nConnection: close\r\n\r\n",
                    token_of(device)
                )
                .as_bytes(),
            )
            .unwrap();
            trickling.push(stream);
        }
        let sent = answer_as(
            address,
            &token_of(5),
            "/kalsa/chat/mail/send",
            &format!(r#"{{"draft_id":"{DRAFT}"}}"#),
        );
        assert_eq!(body_json(&sent), json!({"sent_to": "segreteria@studio.example.it"}));
        drop(trickling);
        drop(door);
    });
}

#[test]
fn a_mail_read_whose_device_is_forgotten_ends_as_cancelled() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door_for(Some(Arc::clone(&page)), Clocks::default(), 2);
        let reading = thread::spawn(move || {
            answer_as(address, &token_of(1), "/kalsa/chat/mail/read", r#"{"id":"105"}"#)
        });
        let sender = page.page(0);
        sender.send(event("accepted", json!({}))).unwrap();
        let keep = token_of(2);
        door.set_devices(devices_labeled(&[(2, "Keep", keep.as_str())]));
        assert_eq!(body_json(&reading.join().unwrap()), json!({"error": "cancelled"}));
        assert!(page.stopped("req-1"), "the page was not told to stop");
        drop(door);
    });
}

#[test]
fn a_mail_read_does_not_refuse_a_turn_of_the_same_device() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let reading = thread::spawn(move || answer(address, "/kalsa/chat/mail/read", r#"{"id":"105"}"#));
        page.page(0).send(event("accepted", json!({}))).unwrap();
        let mut turn = open_as(
            address,
            &token_of(1),
            "POST",
            "/kalsa/chat/turn",
            r#"{"messages":[{"role":"user","content":"ciao"}]}"#,
        );
        page.page(1).send(event("accepted", json!({}))).unwrap();
        let started = Reader::until(&mut turn, b"event: turn", Duration::from_secs(5));
        assert!(started.contains("event: turn"), "{started}");
        page.page(0).send(event("error", json!({"code": "mail.failed"}))).unwrap();
        reading.join().unwrap();
        page.page(1).send(event("done", json!({}))).unwrap();
        drop(door);
    });
}
