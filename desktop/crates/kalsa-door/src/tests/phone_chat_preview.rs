//! The phone's preview route: who may ask for a picture of this computer's
//! page, what the app is asked, and what the phone is told.

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::json;

use super::paging_support::status_of;
use super::phone_chat_support::{answer, answer_as, chat_door, event, token_of, Page, TURN};
use super::room_support::{body_json, devices_labeled};
use super::support::bounded;
use crate::clocks::Clocks;

const PREVIEW: &str = "/kalsa/chat/browser/preview";

/// **The app is asked, and its picture comes back unchanged.** The door
/// carries the picture and decides nothing about it: the app took it, and the
/// phone is shown exactly what the app said.
#[test]
fn a_preview_reaches_the_app_and_its_picture_comes_back() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let response = answer(address, PREVIEW, "{}");
        assert_eq!(status_of(&response), 200);
        assert_eq!(
            body_json(&response),
            json!({
                "image": "QUJD",
                "media_type": "image/jpeg",
                "host": "shop.example",
                "taken_at": 1_700_000_000_000_u64,
            })
        );
        assert_eq!(*page.previews.lock().unwrap(), vec![1], "the app was asked about device 1");
        drop(door);
    });
}

/// **A refusal is the app's own code.** The phone is owed a word it has copy
/// for, and the door passes on the one the app chose.
#[test]
fn a_refusal_comes_back_as_the_code_the_app_named() {
    bounded(Duration::from_secs(20), || {
        for code in ["no_page", "not_yours", "busy", "too_large", "cancelled", "unavailable"] {
            let page = Arc::new(Page {
                preview_answer: Some(Err(code.to_string())),
                ..Page::default()
            });
            let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
            let response = answer(address, PREVIEW, "{}");
            assert_eq!(status_of(&response), 200);
            assert_eq!(body_json(&response), json!({"error": code}), "{code}");
            drop(door);
        }
    });
}

/// **A code nobody here wrote is refused at the door.** The phone has copy for
/// six words and no more, and a stranger's code is not one of them.
#[test]
fn a_code_the_phone_has_no_words_for_is_refused() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page {
            preview_answer: Some(Err("page.timeout".to_string())),
            ..Page::default()
        });
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let response = answer(address, PREVIEW, "{}");
        assert_eq!(status_of(&response), 200);
        assert_eq!(body_json(&response), json!({"error": "unavailable"}));
        drop(door);
    });
}

/// **An answer that is not a picture is refused.** The picture and the two
/// facts beside it are the contract, and a phone is never handed a field
/// nobody here wrote.
#[test]
fn an_answer_that_is_not_a_picture_is_refused() {
    bounded(Duration::from_secs(20), || {
        for said in [
            json!({"image": "", "media_type": "image/jpeg", "host": "shop.example", "taken_at": 1}),
            json!({"image": "QUJD", "media_type": "image/png", "host": "shop.example", "taken_at": 1}),
            json!({"image": "QUJD", "media_type": "image/jpeg", "host": "shop.example"}),
            json!({"host": "shop.example"}),
        ] {
            let page = Arc::new(Page { preview_answer: Some(Ok(said.clone())), ..Page::default() });
            let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
            let response = answer(address, PREVIEW, "{}");
            assert_eq!(status_of(&response), 200);
            assert_eq!(body_json(&response), json!({"error": "unavailable"}), "{said}");
            drop(door);
        }
    });
}

/// **A picture too big for the road is refused at the door.** The picture and
/// the words beside it have to fit in half a megabyte, and the door is the
/// last place that can say so before the bytes go out.
#[test]
fn a_picture_too_big_for_the_road_is_refused() {
    bounded(Duration::from_secs(20), || {
        let said = json!({
            "image": "A".repeat(349_529),
            "media_type": "image/jpeg",
            "host": "shop.example",
            "taken_at": 1_u64,
        });
        let page = Arc::new(Page { preview_answer: Some(Ok(said)), ..Page::default() });
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let response = answer(address, PREVIEW, "{}");
        assert_eq!(status_of(&response), 200);
        assert_eq!(body_json(&response), json!({"error": "unavailable"}));
        drop(door);
    });
}

/// **Another device's credential asks about itself, not about anybody else.**
/// The door resolved the device from the credential and the app is asked
/// about that device: the body cannot name a page, because the body carries
/// no identity at all.
#[test]
fn the_app_is_asked_about_the_device_that_authenticated() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        door.set_devices(devices_labeled(&[(1, "One", token_of(1).as_str()), (2, "Two", token_of(2).as_str())]));
        let response = answer_as(address, &token_of(2), PREVIEW, "{}");
        assert_eq!(status_of(&response), 200);
        assert_eq!(*page.previews.lock().unwrap(), vec![2], "the app was asked about device 2, which is who authenticated");
        drop(door);
    });
}

/// **A body that names somebody else is not read.** The picture is the page of
/// the device that authenticated, and a body that carries an identity is a
/// field this route does not read.
#[test]
fn a_body_that_names_a_phone_is_ignored() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let response = answer(address, PREVIEW, r#"{"device":2,"conversation":"phone:2"}"#);
        assert_eq!(status_of(&response), 200);
        assert_eq!(*page.previews.lock().unwrap(), vec![1], "the body named nobody");
        drop(door);
    });
}

/// **A credential the door does not hold is refused before the app is
/// asked.** The picture is the person's page, and a phone that cannot
/// authenticate never gets to ask for one.
#[test]
fn a_wrong_credential_is_refused_and_the_app_is_not_asked() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let response = answer_as(address, &token_of(9), PREVIEW, "{}");
        assert_eq!(status_of(&response), 401);
        assert!(page.previews.lock().unwrap().is_empty(), "the app was asked about a phone that did not authenticate");
        drop(door);
    });
}

/// **A phone the owner removed is refused.** The door's device set is what
/// the owner's reconcile writes, and a phone that is no longer in it cannot
/// authenticate — so the picture never leaves this computer for it.
#[test]
fn a_revoked_phone_is_refused() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        door.set_devices(devices_labeled(&[(2, "Two", token_of(2).as_str())]));
        let response = answer(address, PREVIEW, "{}");
        assert_eq!(status_of(&response), 401);
        assert!(page.previews.lock().unwrap().is_empty(), "a revoked phone was asked for a picture");
        drop(door);
    });
}

/// **A body that is not a JSON object is a bad request.** The phone is owed
/// its own "unreadable" answer for a body it cannot send, and this is where
/// that starts.
#[test]
fn a_body_that_is_not_an_object_is_a_bad_request() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        for body in ["not json", "[]", "\"a string\"", "42", "null"] {
            let response = answer(address, PREVIEW, body);
            assert_eq!(status_of(&response), 400, "{body} was not a refusal");
        }
        assert!(page.previews.lock().unwrap().is_empty(), "a bad body reached the app");
        drop(door);
    });
}

/// **A preview is not refused as busy by the turn that is running.** A turn
/// is somebody talking to Kalsa and a preview is a picture of the screen: they
/// are different things and neither waits for the other.
#[test]
fn a_preview_is_not_blocked_by_a_running_turn() {
    bounded(Duration::from_secs(20), || {
        let page = Arc::new(Page::default());
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let running = thread::spawn(move || answer(address, "/kalsa/chat/turn", TURN));
        let opener = page.page(0);
        opener.send(event("accepted", json!({}))).unwrap();
        let response = answer(address, PREVIEW, "{}");
        assert_eq!(status_of(&response), 200, "the preview was refused as busy");
        assert_eq!(body_json(&response).get("image").and_then(|image| image.as_str()), Some("QUJD"));
        opener.send(event("done", json!({}))).unwrap();
        assert!(status_of(&running.join().unwrap()) == 200, "the turn did not finish");
        drop(door);
    });
}

/// **One preview at a time for one phone.** A second press while the first
/// is being taken is told the browser is busy, rather than two pictures of
/// the same page arriving together.
#[test]
fn a_second_preview_for_one_phone_is_refused_as_busy() {
    bounded(Duration::from_secs(20), || {
        let (release, held) = mpsc::channel();
        let page = Arc::new(Page {
            preview_release: Some(Arc::new(Mutex::new(held))),
            ..Page::default()
        });
        let (door, address) = chat_door(Some(Arc::clone(&page)), Clocks::default());
        let first = thread::spawn(move || answer(address, PREVIEW, "{}"));
        // The first preview is held at the app's gate, so the lane is taken.
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while page.previewed().is_empty() {
            assert!(std::time::Instant::now() < deadline, "the first preview never reached the app");
            thread::sleep(Duration::from_millis(5));
        }
        let second = answer(address, PREVIEW, "{}");
        assert_eq!(status_of(&second), 200);
        assert_eq!(body_json(&second), json!({"error": "busy"}));
        release.send(()).expect("the gate is released");
        assert_eq!(status_of(&first.join().unwrap()), 200);
        drop(door);
    });
}
