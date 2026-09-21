//! The disk tier's cadence: a slot a completion changed is written out once it
//! has been quiet long enough — and never while it is still being used, never
//! when it is clean, and never when the door cannot name what it holds.

use std::fs;
use std::net::SocketAddr;
use std::thread;
use std::time::Duration;

use super::paging_support::{
    activate, body_text, door_of_with_save, file_name, salt_of, status_of, temp_dir, Engine, Reply,
    HASH,
};
use super::support::{chat_post, exchanged, ORIGIN};
use super::*;

/// The quiet the tests let a slot have. Long enough that the call right after a
/// completion is unambiguously "still active" on a loaded machine, short enough
/// to sleep through.
const QUIET: Duration = Duration::from_millis(300);
const PAST_QUIET: Duration = Duration::from_millis(500);

/// One completion through the door, the way a client sends it: this is what
/// marks the slot, and the only thing in the product that does.
fn complete(address: SocketAddr, token: &str) {
    let answer = exchanged(
        address,
        &chat_post(ORIGIN, Some(&format!("Bearer {token}")), None),
    );
    assert_eq!(status_of(&answer), 200, "{}", body_text(&answer));
}

#[test]
fn a_dirty_slot_is_saved_once_the_quiet_lasts_and_the_flag_clears() {
    let slot_dir = temp_dir("cadence-saved");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);
    let chat = "aaaa1111";
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    let opened = engine.sent().len();

    complete(address, &token);
    thread::sleep(PAST_QUIET);
    assert_eq!(
        door.save_idle(),
        1,
        "the tick did not save the chat a completion changed"
    );
    let sent = engine.sent();
    assert_eq!(
        sent.len(),
        opened + 2,
        "the tick sent more or less than one save: {:?}",
        &sent[opened..]
    );
    assert_eq!(sent[opened + 1].action, "save");
    assert_eq!(sent[opened + 1].filename, format!("{}.staging", file_name(chat)));
    assert!(
        slot_dir.join(file_name(chat)).exists(),
        "the chat never reached its file"
    );

    // The flag is clean now: nothing is written until a completion arrives.
    assert_eq!(door.save_idle(), 0);
    assert_eq!(engine.sent().len(), opened + 2, "a clean slot was saved again");
    door.shutdown();
}

#[test]
fn a_dirty_slot_that_is_still_being_used_is_not_saved() {
    let slot_dir = temp_dir("cadence-active");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);
    assert_eq!(status_of(&activate(address, Some(&token), "aaaa1111")), 204);
    complete(address, &token);
    let after_completion = engine.sent().len();

    // The slot is dirty, and the user is still here: the engine will not
    // release a slot that is being talked to, and a save now would put a state
    // on disk that the next token invalidates.
    assert_eq!(door.save_idle(), 0, "a slot still in use was saved");
    assert_eq!(
        engine.sent().len(),
        after_completion,
        "a slot still in use reached the engine"
    );

    // The clock was what was missing, not the flag.
    thread::sleep(PAST_QUIET);
    assert_eq!(door.save_idle(), 1, "the slot went quiet and was still not saved");
    door.shutdown();
}

#[test]
fn a_clean_slot_is_not_sent_to_the_engine() {
    let slot_dir = temp_dir("cadence-clean");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);

    // Nothing has ever been in the slot...
    assert_eq!(door.save_idle(), 0, "an empty slot was written out");
    // ...and a chat restored into it and then left alone is the file it came
    // from, so a tick after the quiet has run out has nothing to write.
    let chat = "aaaa1111";
    fs::write(slot_dir.join(file_name(chat)), b"state").unwrap();
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    let opened = engine.sent().len();
    thread::sleep(PAST_QUIET);
    assert_eq!(door.save_idle(), 0, "a clean slot was saved");
    assert_eq!(engine.sent().len(), opened, "a clean slot reached the engine");
    assert!(
        engine.sent().iter().all(|sent| sent.action == "restore"),
        "the tier sent something other than the restore: {:?}",
        engine.sent()
    );
    door.shutdown();
}

#[test]
fn an_unknown_slot_is_never_saved() {
    let slot_dir = temp_dir("cadence-unknown");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);
    let (first, second) = ("aaaa1111", "bbbb2222");
    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);
    // A file for the target, so the switch's second half is a restore.
    fs::write(slot_dir.join(file_name(second)), b"state").unwrap();

    // The save of the chat that is open answers; the restore never does, so the
    // engine may not have run it and the slot is `Unknown`.
    engine.reply([Reply::Answered(1), Reply::Unreachable]);
    let refused = activate(address, Some(&token), second);
    assert_eq!(status_of(&refused), 502, "{}", body_text(&refused));

    // A completion then passes through the same slot, which marks it dirty
    // again: the timer must still refuse to write out what it cannot name.
    complete(address, &token);
    thread::sleep(PAST_QUIET);
    let before = engine.sent().len();
    assert_eq!(door.save_idle(), 0, "an unknown slot was written out");
    assert_eq!(
        engine.sent().len(),
        before,
        "an unknown slot reached the engine: {:?}",
        &engine.sent()[before..]
    );
    door.shutdown();
}

#[test]
fn the_timed_save_writes_the_name_and_headers_an_activate_writes() {
    let slot_dir = temp_dir("cadence-name");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);
    let (first, second) = ("aaaa1111", "bbbb2222");
    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);
    complete(address, &token);
    thread::sleep(PAST_QUIET);
    assert_eq!(door.save_idle(), 1);
    let tick = engine
        .sent()
        .into_iter()
        .find(|sent| sent.action == "save")
        .expect("the tick wrote nothing");

    // The same chat then leaves the slot the ordinary way, and the switch's
    // save is the request the tick has to be indistinguishable from: the same
    // name, the same slot, the same salt. Nothing but the trigger is new.
    fs::write(slot_dir.join(file_name(second)), b"state").unwrap();
    assert_eq!(status_of(&activate(address, Some(&token), second)), 204);
    let switch = engine
        .sent()
        .into_iter()
        .filter(|sent| sent.action == "save")
        .nth(1)
        .expect("the switch wrote nothing");
    assert_eq!(tick, switch, "the timed save is not the switch's save");
    assert_eq!(tick.slot, "0");
    assert_eq!(tick.salt, salt_of(&token));
    assert_eq!(tick.filename, format!("{}.staging", file_name(first)));
    door.shutdown();
}
