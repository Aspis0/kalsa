//! What an outcome that wrote nothing must leave behind on the slot: the mark
//! the turn put there and the backoff the slot's current holder is owed. Both
//! were cleared by the tick reading "nothing reached a file" as "the slot is
//! saved" — one books a lost turn as written, the other re-offers the engine a
//! slot its own refusal had delayed by an interval.

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
fn n_saved_zero_keeps_the_turns_mark_and_the_backoff_bounds_its_retries() {
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

    // The engine answers the save with `n_saved` 0: it holds nothing of this
    // turn. The door's map says this chat is resident and a completion has
    // passed through — so 0 means the turn is NOT on disk, and neither the
    // count nor the mark may say otherwise.
    engine.reply([Reply::Answered(0)]);
    let count = door.save_idle(quiet_since(after));
    let (mark, _) = door.chats.observed(0);
    assert!(
        count == 0 && mark.is_some(),
        "n_saved 0 was booked as a save: count {count}, mark {}",
        if mark.is_some() { "kept" } else { "CLEARED" }
    );
    assert!(
        !slot_dir.join(format!("{}.staging", file_name(chat))).exists(),
        "the zero-token staging file survived the door"
    );
    assert_eq!(
        fs::read(slot_dir.join(file_name(chat))).unwrap(),
        b"state",
        "a save that wrote nothing touched the chat's file"
    );

    // The kept mark is bounded by the backoff, not open-ended: a tick inside
    // the interval asks the engine nothing, and the tick at the interval's
    // end asks once — which is what writes the mark clean when the slot's
    // state is whole again.
    let owed = engine.sent().len();
    assert_eq!(
        door.save_idle(quiet_since(after) + QUIET - Duration::from_millis(1)),
        0,
        "a zero-token save was re-asked inside its backoff"
    );
    assert_eq!(
        engine.sent().len(),
        owed,
        "the backoff did not hold the engine back: {:?}",
        &engine.sent()[owed..]
    );
    assert_eq!(
        door.save_idle(quiet_since(after) + QUIET),
        1,
        "the retry at the interval's end did not save the mark"
    );
    assert!(door.chats.observed(0).0.is_none(), "the written mark stayed set");
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
