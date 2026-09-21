//! The two chat routes as a client sees them: who may call them, what a
//! failure leaves behind, and what a payload can and cannot name.

use std::fs;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::time::Duration;

use super::paging_support::{activate, body_text, door_of, erase, file_name, post, status_of, temp_dir, Engine, Reply, HASH};
use super::*;

/// Every file the door keeps for device 0 in a directory the test prepared.
fn prewired(slot_dir: &std::path::Path, chats: &[&str]) {
    for chat in chats {
        fs::write(slot_dir.join(file_name(chat)), b"state").unwrap();
    }
}

#[test]
fn a_failed_restore_puts_the_chat_that_was_open_back_in_the_slot() {
    let slot_dir = temp_dir("route-rollback");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let (first, second, third) = ("aaaa1111", "bbbb2222", "cccc3333");
    prewired(&slot_dir, &[first, second, third]);
    assert_eq!(status_of(&activate(address, Some(&token), second)), 204);

    // The save of the chat that is open succeeds, the restore of the chat that
    // was asked for fails, and the repair is allowed to succeed.
    engine.reply([Reply::Answered(1), Reply::Refused, Reply::Answered(1)]);
    let response = activate(address, Some(&token), first);
    assert_eq!(status_of(&response), 502, "{}", body_text(&response));
    assert!(
        body_text(&response).contains("back in the slot"),
        "the door did not say what it did: {}",
        body_text(&response)
    );
    let sent = engine.sent();
    let actions: Vec<&str> = sent.iter().map(|sent| sent.action.as_str()).collect();
    assert_eq!(actions, ["restore", "save", "restore", "restore"], "{sent:?}");
    assert_eq!(sent[1].filename, format!("{}.staging", file_name(second)));
    assert_eq!(sent[2].filename, file_name(first));
    assert_eq!(
        sent[3].filename,
        file_name(second),
        "the repair restored a staging name or another chat: {sent:?}"
    );

    // The door still believes the second chat is the open one: the next switch
    // saves it, and not the chat whose restore just failed.
    let before = engine.sent().len();
    assert_eq!(status_of(&activate(address, Some(&token), third)), 204);
    assert_eq!(
        engine.sent()[before].filename,
        format!("{}.staging", file_name(second)),
        "the failure moved the door's idea of what is in the slot"
    );
    door.shutdown();
}

#[test]
fn a_repair_that_fails_too_says_the_slot_is_empty() {
    let slot_dir = temp_dir("route-empty");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let (first, second, third) = ("aaaa1111", "bbbb2222", "cccc3333");
    prewired(&slot_dir, &[first, second, third]);
    assert_eq!(status_of(&activate(address, Some(&token), second)), 204);

    engine.reply([Reply::Answered(1), Reply::Refused, Reply::Refused]);
    let response = activate(address, Some(&token), first);
    assert_eq!(status_of(&response), 502, "{}", body_text(&response));
    assert!(
        body_text(&response).contains("slot is now empty"),
        "the door did not tell the truth about the slot: {}",
        body_text(&response)
    );

    // The engine cleared the slot and nothing came back, so the door must not
    // claim a chat is in it: the next switch saves nothing.
    let before = engine.sent().len();
    assert_eq!(status_of(&activate(address, Some(&token), third)), 204);
    let after = engine.sent();
    assert!(
        after[before..].iter().all(|sent| sent.action != "save"),
        "the door saved a slot it had just lost: {:?}",
        &after[before..]
    );
    door.shutdown();
}

#[test]
fn a_restore_the_engine_never_answered_leaves_the_slot_unknown_not_empty() {
    let slot_dir = temp_dir("route-unknown");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let (first, second, third) = ("aaaa1111", "bbbb2222", "cccc3333");
    prewired(&slot_dir, &[first, second, third]);
    assert_eq!(status_of(&activate(address, Some(&token), second)), 204);

    // The save of the open chat succeeds; the restore of the one asked for
    // never gets an answer, so the engine may not have run it at all.
    engine.reply([Reply::Answered(1), Reply::Unreachable]);
    let response = activate(address, Some(&token), first);
    assert_eq!(status_of(&response), 502, "{}", body_text(&response));
    let words = body_text(&response);
    assert!(
        words.contains("unknown"),
        "the door did not say the slot's state is unknown: {words}"
    );
    assert!(
        !words.contains("empty"),
        "the door called an unverified slot empty: {words}"
    );

    // The residency is `Unknown`, not the chat that was there: the next
    // activation must not save a state it cannot name, and must restore the
    // target instead.
    let before = engine.sent().len();
    assert_eq!(status_of(&activate(address, Some(&token), third)), 204);
    let after = engine.sent();
    assert!(
        after[before..].iter().all(|sent| sent.action != "save"),
        "the door saved out of a slot it had said was unknown: {:?}",
        &after[before..]
    );
    assert_eq!(after.last().unwrap().action, "restore");
    assert_eq!(after.last().unwrap().filename, file_name(third));
    door.shutdown();
}

#[test]
fn a_door_the_app_never_gave_an_identity_refuses_the_action_and_says_why() {
    let slot_dir = temp_dir("route-no-model");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), None, &[&token]);
    let response = activate(address, Some(&token), "aaaa1111");
    assert_eq!(status_of(&response), 501, "{}", body_text(&response));
    assert!(
        body_text(&response).contains("no model identity"),
        "the refusal does not say what is missing: {}",
        body_text(&response)
    );
    door.shutdown();
    assert!(engine.sent().is_empty(), "a door without a tier called the engine");
}

#[test]
fn a_door_the_app_never_gave_a_directory_refuses_the_action_and_says_why() {
    let slot_dir = temp_dir("route-no-dir");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, None, Some(HASH), &[&token]);
    let response = activate(address, Some(&token), "aaaa1111");
    assert_eq!(status_of(&response), 501, "{}", body_text(&response));
    assert!(
        body_text(&response).contains("no save directory"),
        "the refusal does not say what is missing: {}",
        body_text(&response)
    );
    door.shutdown();
    assert!(engine.sent().is_empty(), "a door without a tier called the engine");
}

#[test]
fn a_model_hash_that_is_not_eight_hex_characters_is_refused() {
    for bad in ["", "a1b2c3d", "a1b2c3d45", "A1B2C3D4", "a1b2c3dg", "a1b2c3d4 "] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let door = Door::new(listener, 1, door_devices(&[&credential()]), 1).unwrap();
        assert!(
            matches!(door.with_model_hash(bad), Err(DoorError::InvalidModelHash)),
            "the model hash {bad:?} was accepted"
        );
    }
}

#[test]
fn the_bearer_decides_whose_chat_is_named() {
    let slot_dir = temp_dir("route-bearer");
    let engine = Engine::start(&slot_dir);
    let (first, second) = (credential(), credential());
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&first, &second]);
    let (one, two) = ("aaaa1111", "bbbb2222");
    prewired(&slot_dir, &[two]);

    assert_eq!(status_of(&activate(address, Some(&first), one)), 204);
    assert_eq!(status_of(&activate(address, Some(&second), one)), 204);
    assert_eq!(status_of(&activate(address, Some(&first), two)), 204);
    // The second device's second chat has no file, so the same id is asked for
    // again and this time it is the first one that gets saved.
    assert_eq!(status_of(&activate(address, Some(&second), two)), 204);
    assert_eq!(status_of(&activate(address, Some(&second), one)), 204);

    let sent = engine.sent();
    let saves: Vec<&str> = sent
        .iter()
        .filter(|sent| sent.action == "save")
        .map(|sent| sent.filename.as_str())
        .collect();
    assert_eq!(
        saves,
        [
            format!("{}.staging", file_name(one)),
            format!("d1-m{HASH}-c{one}.bin.staging"),
            format!("d1-m{HASH}-c{two}.bin.staging"),
        ],
        "the same id was not named for the two devices: {sent:?}"
    );
    assert_eq!(sent[0].slot, "0");
    assert_eq!(sent[1].slot, "1", "two devices shared a slot");
    assert_ne!(sent[0].salt, sent[1].salt, "two devices shared a namespace");

    // And no credential is no route at all.
    let before = engine.sent().len();
    let response = activate(address, None, one);
    assert_eq!(status_of(&response), 401, "{}", body_text(&response));
    assert_eq!(engine.sent().len(), before, "an unauthenticated call reached the engine");
    door.shutdown();
}

#[test]
fn erasing_a_chat_removes_its_file_and_the_state_in_the_slot() {
    let slot_dir = temp_dir("route-erase");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let (first, second, third) = ("aaaa1111", "bbbb2222", "cccc3333");
    prewired(&slot_dir, &[first, second, third]);
    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);
    assert_eq!(status_of(&activate(address, Some(&token), second)), 204);

    // The chat that is not in the slot: its file goes, nothing else moves.
    let before = engine.sent().len();
    assert_eq!(status_of(&erase(address, Some(&token), first)), 204);
    assert_eq!(engine.sent().len(), before, "erasing a chat that is not open touched the engine");
    assert!(!slot_dir.join(file_name(first)).exists(), "the file survived the erase");

    // The chat that is in the slot: the slot goes with it, and so does the
    // door's idea of what is in it.
    assert_eq!(status_of(&erase(address, Some(&token), second)), 204);
    assert_eq!(engine.sent().last().unwrap().action, "erase");
    assert!(!slot_dir.join(file_name(second)).exists());
    let before = engine.sent().len();
    assert_eq!(status_of(&activate(address, Some(&token), third)), 204);
    let after = engine.sent();
    assert!(
        after[before..].iter().all(|sent| sent.action != "save"),
        "a chat that was erased was still saved as the one in the slot: {:?}",
        &after[before..]
    );
    door.shutdown();
}

#[test]
fn a_filename_in_the_payload_is_ignored() {
    let slot_dir = temp_dir("route-filename");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let (first, second) = ("aaaa1111", "bbbb2222");
    prewired(&slot_dir, &[second]);

    let response = post(
        address,
        Some(&token),
        "/kalsa/chat/activate",
        &format!("{{\"filename\":\"../../evil.bin\",\"id\":\"{first}\"}}"),
    );
    assert_eq!(status_of(&response), 204, "{}", body_text(&response));
    assert_eq!(status_of(&activate(address, Some(&token), second)), 204);

    let sent = engine.sent();
    assert_eq!(
        sent[1].filename,
        format!("{}.staging", file_name(first)),
        "the client's filename was used: {sent:?}"
    );
    assert!(
        sent.iter().all(|sent| !sent.filename.contains("evil")),
        "a client name reached the engine: {sent:?}"
    );
    assert!(slot_dir.join(file_name(first)).exists());
    assert!(!std::env::temp_dir().join("evil.bin").exists());

    // A payload with no id at all is refused, a doubled id is refused like a
    // doubled private header, and so is a value that is not a string.
    for body in [
        "{\"filename\":\"x\"}",
        "{}",
        "\"id\"",
        "{\"id\":\"aaaa1111\",\"id\":\"bbbb2222\"}",
        "{\"id\":5}",
        // A string the door cannot read plainly is refused, never
        // reinterpreted: the door does not unescape a client's value to find
        // out whether it meant a field name.
        "{\"id\":\"aaaa1111\",\"note\":\"say \\\"hi\\\"\"}",
        "{\\u0069d:\"aaaa1111\"}",
    ] {
        let response = post(address, Some(&token), "/kalsa/chat/activate", body);
        assert_eq!(status_of(&response), 400, "{body} was accepted: {}", body_text(&response));
    }
    // An unknown field whose value is a structure is stepped over, not
    // refused: the door reads one field and skips the rest.
    let nested = post(
        address,
        Some(&token),
        "/kalsa/chat/activate",
        "{\"id\":\"aaaa1111\",\"n\":{\"a\":[1,\"x\",null]}}",
    );
    assert_eq!(status_of(&nested), 204, "{}", body_text(&nested));
    door.shutdown();
}

#[test]
fn a_request_outside_the_two_routes_is_answered_by_the_door() {
    let slot_dir = temp_dir("route-unknown");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);

    for path in ["/kalsa/chat", "/kalsa/chat/", "/kalsa/chat/delete", "/kalsa/other"] {
        let response = post(address, Some(&token), path, "{\"id\":\"aaaa1111\"}");
        assert_eq!(status_of(&response), 404, "{path} was not refused: {}", body_text(&response));
    }
    // The route is the POST spelling only: the same path asked for with GET is
    // not one of the two, and is not forwarded either.
    let mut client = TcpStream::connect(address).unwrap();
    client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    write!(
        client,
        "GET /kalsa/chat/activate HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    client.shutdown(Shutdown::Write).unwrap();
    let mut response = Vec::new();
    client.read_to_end(&mut response).unwrap();
    assert_eq!(status_of(&response), 404, "a GET of the activate route was served");
    assert!(engine.sent().is_empty(), "the door's namespace was forwarded: {:?}", engine.sent());
    door.shutdown();
}
