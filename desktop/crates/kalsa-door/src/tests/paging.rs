//! The disk tier: the name, the sequence, the per-slot gate, and the staging
//! file.

use std::fs;
use std::thread;
use std::time::Duration;

use super::paging_support::{activate, body_text, door_of, erase, file_name, post, salt_of, status_of, temp_dir, wait_for, Engine, Reply, CHAT, HASH};
use super::*;

#[test]
fn the_door_builds_the_name_from_its_own_device_and_the_pinned_model() {
    let slot_dir = temp_dir("paging-name");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let (first, second) = ("aaaa1111", "bbbb2222");

    // The first switch has nothing to save, so the name shows up when the slot
    // leaves the chat: the file the engine is told to write is the door's.
    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);
    assert_eq!(status_of(&activate(address, Some(&token), second)), 204);
    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);

    let sent = engine.sent();
    assert_eq!(
        sent[1].filename,
        format!("{}.staging", file_name(first)),
        "the save is staged under the door's own name: {sent:?}"
    );
    assert_eq!(
        sent[3].filename,
        format!("{}.staging", file_name(second)),
        "the second save names the chat that was in the slot: {sent:?}"
    );
    assert_eq!(
        sent[4].filename,
        file_name(first),
        "the restore names the target, not a staging file: {sent:?}"
    );
    assert!(slot_dir.join(file_name(first)).exists(), "the name on disk is the door's");
    assert!(slot_dir.join(file_name(second)).exists());
    door.shutdown();
}

#[test]
fn an_id_the_door_cannot_name_is_refused_before_anything_is_sent() {
    let slot_dir = temp_dir("paging-ids");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);

    for id in [
        "",
        "short",
        "0f1e.2d3c",
        "0f1e/2d3c",
        "..",
        "/etc/passwd",
        "0F1E2D3C",
        "-f1e2d3c",
        "0f1e 2d3c",
    ] {
        let response = activate(address, Some(&token), id);
        assert_eq!(
            status_of(&response),
            400,
            "the id {id:?} was not refused: {}",
            body_text(&response)
        );
    }
    // And the length the door does accept, at both ends of the range.
    assert_eq!(
        status_of(&activate(address, Some(&token), &"a".repeat(65))),
        400,
        "an id past 64 characters was accepted"
    );
    assert!(engine.sent().is_empty(), "a refused id reached the engine: {:?}", engine.sent());
    assert!(
        fs::read_dir(&slot_dir).unwrap().next().is_none(),
        "a refused id wrote a file"
    );
    assert_eq!(status_of(&activate(address, Some(&token), &"a".repeat(8))), 204);
    assert_eq!(status_of(&activate(address, Some(&token), &"b".repeat(64))), 204);
    assert_eq!(
        status_of(&activate(address, Some(&token), CHAT)),
        204,
        "the uuid shape the app's uid() produces was refused"
    );
    door.shutdown();
}

#[test]
fn a_switch_saves_the_chat_in_the_slot_before_it_restores_the_target() {
    let slot_dir = temp_dir("paging-order");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let (first, second) = ("aaaa1111", "bbbb2222");

    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);
    assert_eq!(status_of(&activate(address, Some(&token), second)), 204);
    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);

    let sent = engine.sent();
    let actions: Vec<&str> = sent.iter().map(|sent| sent.action.as_str()).collect();
    // Every action is accounted for, and the pair that matters is in order:
    // the chat in the slot is saved, then the one that was asked for is put
    // there.
    assert_eq!(
        actions,
        ["erase", "save", "erase", "save", "restore"],
        "the sequence the engine saw is not the door's: {sent:?}"
    );
    assert_eq!(sent[3].filename, format!("{}.staging", file_name(second)));
    assert_eq!(sent[4].filename, file_name(first));
    for request in &sent {
        assert_eq!(request.slot, "0", "the door used another slot: {request:?}");
        assert_eq!(
            request.salt,
            salt_of(&token),
            "the engine was told about another device: {request:?}"
        );
    }
    // The rename into place happened, and the staging file did not survive it.
    assert!(slot_dir.join(file_name(first)).exists());
    assert!(slot_dir.join(file_name(second)).exists());
    assert!(
        !slot_dir.join(format!("{}.staging", file_name(second))).exists(),
        "the staging file was left behind"
    );
    door.shutdown();
}

#[test]
fn activating_the_chat_already_in_the_slot_touches_nothing() {
    let slot_dir = temp_dir("paging-noop");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let (first, second) = ("aaaa1111", "bbbb2222");
    // Both chats have a file, so both halves of a switch are real requests:
    // a restore of the target, and a save of the chat that was in the slot.
    for chat in [first, second] {
        fs::write(slot_dir.join(file_name(chat)), b"state").unwrap();
    }
    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);
    let opened = engine.sent();
    assert_eq!(opened.len(), 1, "the first activation of a stored chat is a restore: {opened:?}");

    // The chat asked for is the one the slot already holds, so the sequence
    // would be this chat's state written out and read back into the slot it
    // never left. The engine is not touched for that: the UI asks on every
    // mount, and a mount is not a reason to move hundreds of MB.
    let again = activate(address, Some(&token), first);
    assert_eq!(status_of(&again), 204, "{}", body_text(&again));
    assert_eq!(
        engine.sent().len(),
        opened.len(),
        "activating the resident chat reached the engine: {:?}",
        &engine.sent()[opened.len()..]
    );

    // A different chat is still a switch, and the sequence is the one it
    // always was: the chat in the slot is saved, the target restored.
    assert_eq!(status_of(&activate(address, Some(&token), second)), 204);
    let sent = engine.sent();
    let actions: Vec<&str> = sent[opened.len()..].iter().map(|sent| sent.action.as_str()).collect();
    assert_eq!(actions, ["save", "restore"], "{sent:?}");
    assert_eq!(sent[opened.len()].filename, format!("{}.staging", file_name(first)));
    assert_eq!(sent[opened.len() + 1].filename, file_name(second));
    door.shutdown();
}

#[test]
fn two_switches_of_one_slot_do_not_interleave() {
    let slot_dir = temp_dir("paging-gate");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let (first, second, third) = ("aaaa1111", "bbbb2222", "cccc3333");
    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);
    // The chats that are switched to have files of their own: the swap's second
    // half is then a restore, which is what makes an interleaved sequence show
    // up as a save under the wrong chat's name.
    for chat in [second, third] {
        fs::write(slot_dir.join(file_name(chat)), b"state").unwrap();
    }

    // The next save is held open, so a switch that is not serialised lands
    // inside it instead of after it.
    engine.delay(Duration::from_millis(600));
    let held = token.clone();
    let worker = thread::spawn(move || activate(address, Some(&held), second));
    wait_for(&engine, 2);
    let other = activate(address, Some(&token), third);
    assert_eq!(status_of(&other), 204, "{}", body_text(&other));
    assert_eq!(status_of(&worker.join().unwrap()), 204);

    let sent = engine.sent();
    let names: Vec<&str> = sent.iter().map(|sent| sent.filename.as_str()).collect();
    assert_eq!(sent.len(), 5, "a sequence was added or lost: {sent:?}");
    assert_eq!(names[1], format!("{}.staging", file_name(first)));
    // Whatever the second switch was, the third's save is the chat the second
    // left in the slot — and never the first one twice, which is what two
    // overlapping sequences produce.
    let (second, third) = if sent[2].filename == file_name(second) {
        (second, third)
    } else {
        (third, second)
    };
    assert_eq!(names[2], file_name(second), "a switch was interleaved: {sent:?}");
    assert_eq!(names[3], format!("{}.staging", file_name(second)));
    assert_eq!(names[4], file_name(third));
    door.shutdown();
}

#[test]
fn a_save_that_wrote_nothing_leaves_the_chat_file_alone() {
    let slot_dir = temp_dir("paging-staging");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let (first, second, third) = ("aaaa1111", "bbbb2222", "cccc3333");

    // Leave and re-enter the second chat, so it has a file of its own.
    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);
    assert_eq!(status_of(&activate(address, Some(&token), second)), 204);
    assert_eq!(status_of(&activate(address, Some(&token), third)), 204);
    assert_eq!(status_of(&activate(address, Some(&token), second)), 204);
    let real = slot_dir.join(file_name(second));
    let before = fs::read(&real).unwrap();
    assert!(!before.is_empty());

    // The engine has been unloaded: the slot is empty, so the save of the chat
    // that is open reports nothing written. The file that holds it must
    // survive that.
    engine.reply([Reply::Answered(0)]);
    let response = activate(address, Some(&token), first);
    assert_eq!(status_of(&response), 204, "{}", body_text(&response));
    assert_eq!(
        fs::read(&real).unwrap(),
        before,
        "an empty save was renamed over the chat's file"
    );
    assert!(
        !slot_dir.join(format!("{}.staging", file_name(second))).exists(),
        "the staging file was left behind"
    );
    door.shutdown();
}

#[test]
fn a_save_that_wrote_nothing_creates_no_file() {
    let slot_dir = temp_dir("paging-staging-new");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let (first, second) = ("aaaa1111", "bbbb2222");

    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);
    engine.reply([Reply::Answered(0)]);
    assert_eq!(status_of(&activate(address, Some(&token), second)), 204);
    assert!(
        !slot_dir.join(file_name(first)).exists(),
        "an empty state was written under the chat's name"
    );
    assert!(!slot_dir.join(format!("{}.staging", file_name(first))).exists());
    door.shutdown();
}

#[test]
fn a_rename_the_filesystem_refuses_leaves_no_staging_file() {
    let slot_dir = temp_dir("paging-rename-refused");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let (first, second) = ("aaaa1111", "bbbb2222");

    // The first activation has no file to bring back, so the slot leaves it
    // without writing anything out...
    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);
    // ...and the name the next save renames onto is a directory, which the
    // filesystem refuses. The fake engine cannot fail a rename; this can.
    fs::create_dir(slot_dir.join(file_name(first))).unwrap();
    let response = activate(address, Some(&token), second);
    assert_eq!(status_of(&response), 502, "{}", body_text(&response));
    assert!(
        body_text(&response).contains("nothing changed"),
        "the refusal does not say the file is untouched: {}",
        body_text(&response)
    );
    assert!(
        !slot_dir.join(format!("{}.staging", file_name(first))).exists(),
        "a rename the filesystem refused left its staging file behind"
    );
    assert!(slot_dir.join(file_name(first)).is_dir(), "the refused rename replaced the directory");
    door.shutdown();
}

#[test]
fn a_save_the_engine_never_answered_leaves_no_staging_file() {
    let slot_dir = temp_dir("paging-save-unreachable");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let (first, second) = ("aaaa1111", "bbbb2222");
    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);

    // The engine writes the state and loses the answer: the staging file is on
    // disk even though the door was never told anything was written.
    engine.reply([Reply::Unreachable]);
    let response = activate(address, Some(&token), second);
    assert_eq!(status_of(&response), 502, "{}", body_text(&response));
    assert!(
        !slot_dir.join(format!("{}.staging", file_name(first))).exists(),
        "a staging file survived a save whose answer was lost"
    );
    door.shutdown();
}

#[test]
fn erasing_a_chat_removes_its_staging_sibling_too() {
    let slot_dir = temp_dir("paging-erase-staging");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let id = "aaaa1111";
    fs::write(slot_dir.join(file_name(id)), b"state").unwrap();
    fs::write(slot_dir.join(format!("{}.staging", file_name(id))), b"state").unwrap();

    assert_eq!(status_of(&erase(address, Some(&token), id)), 204);
    assert!(!slot_dir.join(file_name(id)).exists(), "the chat's file survived");
    assert!(
        !slot_dir.join(format!("{}.staging", file_name(id))).exists(),
        "the staging sibling survived the erase"
    );
    door.shutdown();
}

#[test]
fn a_payload_nested_past_the_limit_is_refused_not_guessed() {
    let slot_dir = temp_dir("paging-depth");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let nested = |depth: usize| {
        format!(
            "{{\"id\":\"{}\",\"n\":{}1{}}}",
            CHAT,
            "[".repeat(depth),
            "]".repeat(depth)
        )
    };

    // Eight is the deepest value the door steps over without reading it...
    assert_eq!(
        status_of(&post(address, Some(&token), "/kalsa/chat/activate", &nested(8))),
        204
    );
    // ...and nine is refused rather than guessed at.
    assert_eq!(
        status_of(&post(address, Some(&token), "/kalsa/chat/activate", &nested(9))),
        400
    );
    door.shutdown();
}

#[test]
fn erasing_a_slot_that_holds_another_devices_record_drops_the_record_only() {
    let slot_dir = temp_dir("paging-foreign");
    let engine = Engine::start(&slot_dir);
    let (first, second) = (credential(), credential());
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&first]);
    let id = "aaaa1111";
    assert_eq!(status_of(&activate(address, Some(&first), id)), 204);

    // The first device is revoked and its id is handed to a second one, which
    // therefore leases the slot the first left — a slot whose record still
    // names the first device.
    door.set_devices(
        Devices::new(vec![DeviceEntry::new(DeviceId::new(1), "Second", second.clone()).unwrap()])
            .unwrap(),
    );
    let before = engine.sent().len();
    assert_eq!(status_of(&erase(address, Some(&second), id)), 204);
    assert_eq!(
        engine.sent().len(),
        before,
        "another device's slot was erased for this chat: {:?}",
        &engine.sent()[before..]
    );
    door.shutdown();
}
