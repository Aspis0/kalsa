//! The phone's turn route through the door's socket: validation, the 404
//! without a hook, the stream's framing, busy, the runner's timeout, and a
//! phone that goes away. The mail routes are in `phone_chat_mail`.

use std::io::Read;
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;

use super::paging_support::status_of;
use super::logging::wait_for_new;
use super::phone_chat_support::{answer, chat_door, chat_door_for, event, open, open_as, text, token_of, Page, TURN};
use super::room_support::{devices_labeled, read_all};
use super::support::bounded;
use crate::clocks::Clocks;

#[test]
fn a_chat_body_the_contract_refuses_is_a_bad_request_and_reaches_no_page() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let too_many = format!(
            r#"{{"messages":[{}]}}"#,
            vec![r#"{"role":"user","content":"x"}"#; 201].join(",")
        );
        for body in [
            r#"{"messages":[{"role":"system","content":"x"}]}"#,
            r#"{"messages":[{"role":"user","content":["image"]}]}"#,
            r#"{"messages":[{"role":"user","content":"x"}],"reply_for":"10a"}"#,
            r#"{"messages":[{"role":"user","content":"x"}],"language":"fr"}"#,
            r#"{"messages":"hello"}"#,
            "not json",
            too_many.as_str(),
        ] {
            let response = text(&answer(address, "/kalsa/chat/turn", body));
            assert!(
                response.contains("event: error\ndata: {\"code\":\"bad_request\"}"),
                "a turn took {body:.60}: {response}"
            );
        }
        assert!(page.opened().is_empty(), "a refused turn reached the page");
        drop(door);
    });
}

#[test]
fn without_the_app_hook_the_chat_routes_answer_404() {
    bounded(Duration::from_secs(20), || {
        let (door, address) = chat_door(None, Clocks::default());
        assert_eq!(status_of(&answer(address, "/kalsa/chat/turn", TURN)), 404);
        assert_eq!(status_of(&answer(address, "/kalsa/chat/mail/read", r#"{"id":"105"}"#)), 404);
        assert_eq!(status_of(&answer(address, "/kalsa/chat/mail/send", "{}")), 404);
        drop(door);
    });
}

#[test]
fn a_chat_route_under_the_wrong_method_is_not_a_turn() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let response = read_all(&mut open(address, "GET", "/kalsa/chat/turn", ""));
        assert_eq!(status_of(&response), 404);
        assert!(page.opened().is_empty());
        drop(door);
    });
}

#[test]
fn a_turn_streams_the_pages_events_in_order_and_ends_with_one_terminal_frame() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let mut stream = open(address, "POST", "/kalsa/chat/turn", TURN);
        let sender = page.page(0);
        sender.send(event("accepted", json!({}))).unwrap();
        sender.send(event("reasoning", json!({"text": "pensiero"}))).unwrap();
        sender.send(event("delta", json!({"text": "Ciao"}))).unwrap();
        sender.send(event("tool_run", json!({"id": "t1", "name": "mail_list", "state": "ok"}))).unwrap();
        sender.send(event("done", json!({}))).unwrap();
        sender.send(event("delta", json!({"text": "dopo la fine"}))).unwrap();
        let response = text(&read_all(&mut stream));
        drop(door);

        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response}");
        assert!(response.contains("Content-Type: text/event-stream"), "{response}");
        let stream_body = response.split_once("\r\n\r\n").map_or("", |(_, body)| body);
        let frames: Vec<&str> = stream_body.split("\n\n").filter(|frame| !frame.is_empty()).collect();
        let names: Vec<&str> = frames
            .iter()
            .map(|frame| frame.lines().next().unwrap_or_default())
            .collect();
        assert_eq!(
            names,
            [
                "event: turn",
                "event: reasoning",
                "event: delta",
                "event: tool_run",
                "event: done"
            ],
            "{response}"
        );
        assert!(frames[0].ends_with(r#"data: {"turn":"req-1"}"#), "{response}");
        assert!(!response.contains("dopo la fine"), "an event after the terminal frame was written");
        assert_eq!(
            page.opened(),
            vec![("turn".to_string(), json!({
                "messages": [{"role": "user", "content": "che mail ho ricevuto oggi?"}],
                "reply_for": "105",
                "language": "it"
            }))]
        );
        assert!(page.stops.lock().unwrap().is_empty(), "a finished turn was stopped");
    });
}

#[test]
fn a_second_turn_of_one_device_is_busy_and_the_first_keeps_going() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let mut first = open(address, "POST", "/kalsa/chat/turn", TURN);
        let sender = page.page(0);
        sender.send(event("accepted", json!({}))).unwrap();
        sender.send(event("delta", json!({"text": "primo"}))).unwrap();

        let second = text(&answer(address, "/kalsa/chat/turn", TURN));
        assert!(second.contains("event: error\ndata: {\"code\":\"busy\"}"), "{second}");
        assert_eq!(page.opened().len(), 1, "the busy turn reached the page");

        sender.send(event("delta", json!({"text": "secondo"}))).unwrap();
        sender.send(event("done", json!({}))).unwrap();
        let first = text(&read_all(&mut first));
        drop(door);
        assert!(first.contains("primo") && first.contains("secondo"), "{first}");
    });
}

#[test]
fn a_page_that_never_takes_the_turn_ends_it_as_no_runner() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let clocks = Clocks::default().chat_runner_wait(Duration::from_millis(200));
        let (door, address) = chat_door(Some(Arc::clone(&page)), clocks);
        let response = text(&answer(address, "/kalsa/chat/turn", TURN));
        assert!(response.contains("event: error\ndata: {\"code\":\"no_runner\"}"), "{response}");
        assert!(page.stopped("req-1"), "the page was never told to stop");
        drop(door);
    });
}

#[test]
fn a_phone_that_goes_away_stops_its_turn() {
    bounded(Duration::from_secs(20), || {
        super::logging::capture();
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let since = super::logging::line_count();
        let mut stream = open(address, "POST", "/kalsa/chat/turn", TURN);
        let sender = page.page(0);
        sender.send(event("accepted", json!({}))).unwrap();
        sender.send(event("delta", json!({"text": "parte"}))).unwrap();
        let mut seen = Vec::new();
        let mut chunk = [0u8; 256];
        while !text(&seen).contains("parte") {
            let read = stream.read(&mut chunk).unwrap();
            assert!(read > 0, "the stream closed before the first delta");
            seen.extend_from_slice(&chunk[..read]);
        }
        drop(stream);
        assert!(page.stopped("req-1"), "the page was not told to stop");
        // A turn that died with its reader leaves one line saying how far it
        // got: the delta above and nothing of its words.
        let lines = wait_for_new("phone turn dropped", since);
        let line = lines
            .iter()
            .skip(since)
            .find(|line| line.contains("phone turn dropped"))
            .expect("a phone that went away mid-turn logged nothing");
        assert!(line.contains("frames 2"), "{line}");
        assert!(!line.contains("parte"), "the answer reached the log: {line}");
        drop(door);
    });
}

#[test]
fn a_forgotten_phone_is_told_its_turn_was_cancelled() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door_for(Some(Arc::clone(&page)), Clocks::default(), 2);
        let mut stream = open(address, "POST", "/kalsa/chat/turn", TURN);
        let sender = page.page(0);
        sender.send(event("accepted", json!({}))).unwrap();
        sender.send(event("delta", json!({"text": "parte"}))).unwrap();
        let mut seen = Vec::new();
        let mut chunk = [0u8; 256];
        while !text(&seen).contains("parte") {
            let read = stream.read(&mut chunk).unwrap();
            assert!(read > 0, "the stream closed before the first delta");
            seen.extend_from_slice(&chunk[..read]);
        }
        let keep = token_of(2);
        door.set_devices(devices_labeled(&[(2, "Keep", keep.as_str())]));
        let rest = text(&read_all(&mut stream));
        assert!(rest.contains("event: error\ndata: {\"code\":\"cancelled\"}"), "{rest}");
        assert!(page.stopped("req-1"), "the page was not told to stop");
        drop(door);
    });
}

#[test]
fn a_stopped_door_tells_the_phone_its_turn_was_cancelled() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let mut stream = open(address, "POST", "/kalsa/chat/turn", TURN);
        let sender = page.page(0);
        sender.send(event("accepted", json!({}))).unwrap();
        sender.send(event("delta", json!({"text": "parte"}))).unwrap();
        let mut seen = Vec::new();
        let mut chunk = [0u8; 256];
        while !text(&seen).contains("parte") {
            let read = stream.read(&mut chunk).unwrap();
            assert!(read > 0, "the stream closed before the first delta");
            seen.extend_from_slice(&chunk[..read]);
        }
        door.shutdown();
        let rest = text(&read_all(&mut stream));
        assert!(rest.contains("event: error\ndata: {\"code\":\"cancelled\"}"), "{rest}");
    });
}

/// **Who is asking is what the phone authenticated as, and nothing it wrote.**
///
/// Two phones are paired, and the second opens a turn whose body claims to be the
/// first. The app is told the request is the second phone's — because `device`
/// was resolved from the Bearer credential at the socket, before any body was
/// read — and the body handed over carries no `device` at all: `turn_request`
/// builds the page's turn from `messages`, `reply_for` and `language`, and drops
/// every other field. There is no contract by which a phone could name itself,
/// and no route by which a body could claim to be somebody else.
#[test]
fn a_turn_reaches_the_app_as_the_phone_that_authenticated_and_the_body_cannot_name_another() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door_for(Some(Arc::clone(&page)), Clocks::default(), 2);

        let liar = r#"{"messages":[{"role":"user","content":"ciao"}],"language":"it","device":1}"#;
        let mut stream = open_as(
            address,
            &token_of(2),
            "POST",
            "/kalsa/chat/turn",
            liar,
        );
        let sender = page.page(0);
        sender.send(event("accepted", json!({}))).unwrap();
        sender.send(event("done", json!({}))).unwrap();
        let response = text(&read_all(&mut stream));
        assert!(response.contains("event: done"), "{response}");
        drop(door);

        // The app is handed the second phone's turn: the credential's own
        // device, which is what a browser card of this turn is routed by.
        assert_eq!(page.opened_devices(), vec![2], "the turn was opened as the phone the body named");

        // And the body it was opened with cannot hold a device: the field the
        // phone tried to lie with is not part of the page's turn at all.
        let opened = page.opened();
        let turn = &opened[0].1;
        assert!(
            turn.get("device").is_none(),
            "a phone's own device reached the app in the body: {turn}"
        );
        assert_eq!(
            *turn,
            json!({"messages": [{"role": "user", "content": "ciao"}], "reply_for": null, "language": "it"}),
            "the body is exactly the contract's three fields"
        );
    });
}
