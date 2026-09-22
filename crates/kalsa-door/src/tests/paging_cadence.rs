//! The disk tier's cadence: a slot a completion changed is written out once it
//! has been quiet long enough — and never while it is still being used, never
//! when it is clean, and never when the door cannot name what it holds.

use std::fs;
use std::io::Write;
use std::net::{Shutdown, TcpStream};
use std::thread;
use std::time::{Duration, Instant};

use super::paging_support::{
    activate, body_text, complete, door_of_with_save, file_name, quiet_since, salt_of, status_of,
    temp_dir, wait_for, Engine, Reply, QUIET, HASH,
};
use super::support::ORIGIN;
use super::*;

/// How long the fake engine holds a completion before answering it, when a
/// test needs the generation to be caught in flight.
const GENERATION: Duration = Duration::from_millis(1500);

#[test]
fn a_dirty_slot_is_saved_once_the_quiet_lasts_and_the_flag_clears() {
    let slot_dir = temp_dir("cadence-saved");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);
    let chat = "aaaa1111";
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    let opened = engine.sent().len();

    let before = Instant::now();
    complete(address, &token);
    let after = Instant::now();

    // The instant from before the completion, on purpose: the slot has not been
    // quiet at all, and no sleep decides that.
    assert_eq!(door.save_idle(before), 0, "a slot that just changed was written out");
    assert_eq!(
        door.save_idle(quiet_since(after)),
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
    assert_eq!(door.save_idle(quiet_since(after)), 0);
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
    let before = Instant::now();
    complete(address, &token);
    let after = Instant::now();
    let after_completion = engine.sent().len();

    // The slot is dirty, and the user is still here: the engine will not
    // release a slot that is being talked to, and a save now would put a state
    // on disk that the next token invalidates. The tick's instant is the one
    // from before the completion, so this is a fact and not a race.
    assert_eq!(door.save_idle(before), 0, "a slot still in use was saved");
    assert_eq!(
        engine.sent().len(),
        after_completion,
        "a slot still in use reached the engine"
    );

    // The clock was what was missing, not the flag.
    assert_eq!(
        door.save_idle(quiet_since(after)),
        1,
        "the slot went quiet and was still not saved"
    );
    door.shutdown();
}

#[test]
fn a_clean_slot_is_not_sent_to_the_engine() {
    let slot_dir = temp_dir("cadence-clean");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);

    // Nothing has ever been in the slot...
    assert_eq!(door.save_idle(Instant::now()), 0, "an empty slot was written out");
    // ...and a chat restored into it and then left alone is the file it came
    // from, so a tick after the quiet has run out has nothing to write.
    let chat = "aaaa1111";
    fs::write(slot_dir.join(file_name(chat)), b"state").unwrap();
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    let opened = engine.sent().len();
    assert_eq!(door.save_idle(quiet_since(Instant::now())), 0, "a clean slot was saved");
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
    let before = engine.sent().len();
    assert_eq!(
        door.save_idle(quiet_since(Instant::now())),
        0,
        "an unknown slot was written out"
    );
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
    assert_eq!(door.save_idle(quiet_since(Instant::now())), 1);
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

#[test]
fn a_refused_save_is_not_retried_before_the_interval() {
    let slot_dir = temp_dir("cadence-refused");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);
    assert_eq!(status_of(&activate(address, Some(&token), "aaaa1111")), 204);
    complete(address, &token);

    // The first tick's save is refused. The slot is still dirty afterwards:
    // the state is owed, and refusing it does not make it written.
    engine.reply([Reply::Refused]);
    let failed_at = Instant::now() + QUIET;
    assert_eq!(door.save_idle(failed_at), 0, "a refused save was counted as written");
    let after_failure = engine.sent().len();
    assert_eq!(engine.sent()[after_failure - 1].action, "save");

    // A tick a hair before another full interval has passed does not ask again:
    // an engine that refuses would otherwise be asked once a second, each ask
    // held for the engine's own patience.
    assert_eq!(
        door.save_idle(failed_at + QUIET - Duration::from_millis(1)),
        0,
        "a refused save was retried at the next tick"
    );
    assert_eq!(
        engine.sent().len(),
        after_failure,
        "a refused save reached the engine again: {:?}",
        &engine.sent()[after_failure..]
    );

    // The interval passed, and the slot is still dirty: the retry is owed and
    // this time it is written.
    assert_eq!(
        door.save_idle(failed_at + QUIET),
        1,
        "a dirty slot was never retried"
    );
    assert!(
        slot_dir.join(file_name("aaaa1111")).exists(),
        "the retry wrote nothing"
    );
    door.shutdown();
}

#[test]
fn a_save_the_engine_never_answered_is_retried_and_the_retry_writes_the_turn() {
    let slot_dir = temp_dir("cadence-deferred");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);
    let chat = "aaaa1111";
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    complete(address, &token);

    // A save the engine never answered: the shape a deferred save leaves when it
    // outlasts the door's patience. It is not a lost turn — the flag stays — and
    // nothing may be renamed on it: an engine that is still writing has written
    // nothing the door can name yet.
    engine.reply([Reply::Unreachable]);
    let failed_at = Instant::now() + QUIET;
    assert_eq!(
        door.save_idle(failed_at),
        0,
        "an unanswered save was counted as written"
    );
    assert!(
        !slot_dir.join(file_name(chat)).exists(),
        "an unanswered save put a state in place"
    );
    assert!(
        !slot_dir.join(format!("{}.staging", file_name(chat))).exists(),
        "the unanswered save's staging file survived the door"
    );

    // The retry is owed, and it is the one that writes the turn.
    assert_eq!(
        door.save_idle(failed_at + QUIET - Duration::from_millis(1)),
        0,
        "an unanswered save was retried at the next tick"
    );
    assert_eq!(
        door.save_idle(failed_at + QUIET),
        1,
        "the retry did not write the turn the first attempt was owed"
    );
    assert!(
        slot_dir.join(file_name(chat)).exists(),
        "the retry renamed nothing into place"
    );
    door.shutdown();
}

#[test]
fn a_generation_in_flight_is_not_quiet_and_the_end_of_the_relay_is() {
    let slot_dir = temp_dir("cadence-inflight");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);
    let chat = "aaaa1111";
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    let opened = engine.sent().len();

    engine.delay(GENERATION);
    let completing = {
        let token = token.clone();
        thread::spawn(move || complete(address, &token))
    };
    // The request reached the engine. Its answer has not.
    wait_for(&engine, opened + 1);

    // The slot is not quiet, and that is not a statement about how much time has
    // passed: the turn has not ended, so no instant at all can make this slot
    // writable. An hour of it is the same answer as a millisecond.
    let far = Instant::now() + Duration::from_secs(3600);
    assert_eq!(door.save_idle(far), 0, "a generation in flight was written out");
    assert_eq!(
        engine.sent().len(),
        opened + 1,
        "a generation in flight reached the engine with a save: {:?}",
        &engine.sent()[opened..]
    );

    // The generation ends, its last byte relayed to the client. The quiet
    // starts here: the file the tick writes holds the answer, not its prefix.
    completing.join().unwrap();
    let after = Instant::now();
    assert_eq!(
        door.save_idle(quiet_since(after)),
        1,
        "the end of the relay did not mark the slot"
    );
    door.shutdown();
}

#[test]
fn an_interrupted_generation_still_marks_the_slot() {
    let slot_dir = temp_dir("cadence-interrupted");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);
    assert_eq!(status_of(&activate(address, Some(&token), "aaaa1111")), 204);
    let opened = engine.sent().len();

    // The client announces a body and never sends it, then closes. The door's
    // relay of the request ends in an error — the branch a client that hangs up
    // or a door that stops leaves by — and the engine may have read a partial
    // request and started a turn, so the slot cannot be called clean.
    let mut client = TcpStream::connect(address).unwrap();
    write!(
        client,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nOrigin: {ORIGIN}\r\n\
         Authorization: Bearer {token}\r\nContent-Type: application/json\r\n\
         Content-Length: 32\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    client.shutdown(Shutdown::Write).unwrap();

    // This waits for the mark to exist, not for a clock: the tick's instant is
    // injected, so a loaded machine cannot decide the outcome — only whether
    // the wait had to loop.
    let deadline = Instant::now() + Duration::from_secs(3);
    while door.save_idle(quiet_since(Instant::now())) == 0 {
        assert!(Instant::now() < deadline, "an interrupted generation left the slot clean");
        thread::sleep(Duration::from_millis(2));
    }
    assert_eq!(
        engine.sent().len(),
        opened + 1,
        "the interrupted turn was not written out exactly once: {:?}",
        &engine.sent()[opened..]
    );
    drop(client);
    door.shutdown();
}

#[test]
fn a_dirty_unknown_slot_is_never_saved() {
    // A name of its own: this test asserts the directory is EMPTY, so sharing
    // one with the test above (which writes files into it) made the pair a
    // race — red on a loaded machine, green in isolation.
    let slot_dir = temp_dir("cadence-dirty-unknown");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);

    // Nobody has looked at this slot: it is born `Unknown`, exactly as a door
    // built against an engine that may already hold state in it.
    let (dirty, claim) = door.chats.observed(0);
    assert_eq!(claim, "unknown", "the door was born claiming a sight it never had");
    assert!(dirty.is_none(), "a new slot came out dirty");

    // A turn writes into it all the same: the mark records the turn and does
    // not consult the map — `cadence::note_activity` carries the reason.
    let before = Instant::now();
    complete(address, &token);
    let (dirty, claim) = door.chats.observed(0);
    assert_eq!(claim, "unknown", "the completion moved the map");
    assert!(dirty.is_some(), "the turn through the slot was not marked");

    // And the save refuses it: nothing leaves a slot whose chat the door
    // cannot name — no request to the engine, no file, no staging file.
    assert_eq!(
        door.save_idle(quiet_since(before)),
        0,
        "the tick saved a slot the door cannot name"
    );
    assert!(
        engine.sent().iter().all(|sent| sent.action != "save"),
        "the tick asked the engine to write an unknown slot: {:?}",
        engine.sent()
    );
    assert!(
        fs::read_dir(&slot_dir).unwrap().next().is_none(),
        "a file appeared for a slot nobody could name"
    );
    door.shutdown();
}
