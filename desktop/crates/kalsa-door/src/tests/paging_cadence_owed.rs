//! What an outcome that wrote nothing leaves behind on the slot. `n_saved` 0
//! while the map still names this chat no longer keeps mark and backoff: the
//! slot holds no tokens, so the map is relaxed to `Unknown` and both go with
//! it — kept, the mark would promise a save that can never be made, because
//! the tick refuses every slot it cannot name (T4a-fix4, and the arm says the
//! whole reason). What must NOT be moved is the other outcome: a save that
//! came back `Superseded` leaves mark, backoff and refusals untouched on
//! whoever holds the slot now.

use std::fs;
use std::thread;
use std::time::{Duration, Instant};

use super::paging_support::{
    activate, complete, door_of_with_save, file_name, quiet_since, status_of, temp_dir,
    wait_for, Engine, Reply, QUIET, HASH,
};
use super::*;

/// A tick's save held long enough for the slot to be switched under it, for
/// the new holder's own save to fail, and for the held save to come back
/// `Superseded`: the window the second test needs, short of the door's
/// patience so the held save still answers.
const IN_FLIGHT: Duration = Duration::from_millis(4000);

#[test]
fn n_saved_zero_relaxes_the_slot_to_unknown_and_asks_no_more() {
    let slot_dir = temp_dir("owed-zero");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);
    let chat = "aaaa1111";
    // The chat has a file, so the activate is a restore: the slot holds this
    // chat, and its file holds the state the mark exists to protect.
    fs::write(slot_dir.join(file_name(chat)), b"state").unwrap();
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    complete(address, &token);
    let after = Instant::now();

    // The engine answers the save with `n_saved` 0: the slot holds no tokens,
    // so the map naming this chat is a lie — the idle purge (or a request that
    // never reached the engine) emptied the slot after the mark. The count is
    // not booked, the map is relaxed to `Unknown`, and the mark goes with it:
    // a mark on a slot the tick cannot name would promise a save no attempt
    // can ever make.
    engine.reply([Reply::Answered(0)]);
    let count = door.save_idle(quiet_since(after));
    let (mark, claim) = door.chats.observed(0);
    assert_eq!(count, 0, "n_saved 0 was booked as a save");
    assert_eq!(claim, "unknown", "the map went on claiming a slot the engine emptied");
    assert!(mark.is_none(), "the mark stayed: a promise nothing can redeem");
    assert!(
        !slot_dir.join(format!("{}.staging", file_name(chat))).exists(),
        "the zero-token staging file survived the door"
    );
    assert_eq!(
        fs::read(slot_dir.join(file_name(chat))).unwrap(),
        b"state",
        "a save that wrote nothing touched the chat's file"
    );

    // And the answer ENDS the attempts — this is the loop the old arm fed.
    // Every attempt is a post the engine counts toward its idle clock, so a
    // retry at each interval never let the release (or the invalidation it
    // prints) happen; `Unknown` is the residency this tick never saves out of,
    // so the relaxed slot is never offered again, at any instant.
    let owed = engine.sent().len();
    assert_eq!(
        door.save_idle(quiet_since(after) + QUIET),
        0,
        "a relaxed slot was offered to the engine again"
    );
    assert_eq!(
        engine.sent().len(),
        owed,
        "the retry that fed its own condition ran again: {:?}",
        &engine.sent()[owed..]
    );

    // The file is what the next activate restores: the chat is opened again
    // from it — an `Unknown` slot has no previous chat to save, so the state
    // on disk is all there is and it is read back, not written over.
    let sent = engine.sent();
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    let reopen = engine.sent();
    assert_eq!(reopen.len(), sent.len() + 1, "the reopen sent {:?}", &reopen[sent.len()..]);
    assert_eq!(reopen[sent.len()].action, "restore", "the reopen did not restore the file");
    assert_eq!(reopen[sent.len()].filename, file_name(chat));
    assert_eq!(
        fs::read(slot_dir.join(file_name(chat))).unwrap(),
        b"state",
        "the reopen wrote over the file it restored from"
    );
    door.shutdown();
}

#[test]
fn a_superseded_save_leaves_the_new_holders_backoff_alone() {
    let slot_dir = temp_dir("owed-superseded");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);
    let (first, second) = ("aaaa1111", "bbbb2222");
    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);
    complete(address, &token);
    let opened = engine.sent().len();
    let marked = Instant::now();

    // The tick's save of `first` is in flight, held by the engine.
    engine.delay(IN_FLIGHT);
    thread::scope(|scope| {
        let ticking = scope.spawn(|| door.save_idle(quiet_since(marked)));
        wait_for(&engine, opened + 1);

        // The slot is handed to `second` under that save, and a turn through
        // `second` makes its state the slot's owed one.
        fs::write(slot_dir.join(file_name(second)), b"state").unwrap();
        assert_eq!(status_of(&activate(address, Some(&token), second)), 204);
        complete(address, &token);
        let owed = Instant::now();

        // The new holder's own save fails while the old one is still in
        // flight, so the slot is in BACKOFF: `second` is owed one full
        // interval before anybody may ask the engine for it again.
        engine.reply([Reply::Refused]);
        assert_eq!(
            door.save_idle(quiet_since(owed)),
            0,
            "the new holder's refused save was counted as written"
        );

        // The held save comes back `Superseded` — the slot it read is not
        // its anymore. Nothing here belongs to it: clearing the backoff
        // would let the very next tick re-offer `second` the refusal just
        // delayed, breaking the once-per-interval rule on the new holder's
        // account.
        assert_eq!(
            ticking.join().unwrap(),
            0,
            "the tick counted a save of a slot it no longer held"
        );
        let sent = engine.sent().len();
        assert_eq!(
            door.save_idle(quiet_since(owed) + QUIET - Duration::from_millis(1)),
            0,
            "a superseded save cleared the new holder's backoff"
        );
        assert_eq!(
            engine.sent().len(),
            sent,
            "the new holder was re-offered inside its backoff: {:?}",
            &engine.sent()[sent..]
        );

        // And the backoff it kept is one interval, not forever: the tick at
        // its end writes `second` out and clears the mark.
        assert_eq!(
            door.save_idle(quiet_since(owed) + QUIET),
            1,
            "the kept backoff outlived its interval"
        );
        assert!(door.chats.observed(0).0.is_none(), "the written mark stayed set");
    });
    assert!(
        !slot_dir.join(format!("{}.staging", file_name(first))).exists(),
        "the superseded staging file survived"
    );
    door.shutdown();
}
