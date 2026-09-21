//! What the tick must not do while it saves: hold the slot's mutex across the
//! engine call. The lock is the one `mark_dirty` takes at the end of a turn
//! and the one `activate`/`erase` take — all on the door's four workers — so
//! these tests drive a save whose answer is deliberately slow and assert on
//! who is allowed to move while it is in flight: the end of a turn, a mark
//! that arrives during the save, a switch, and the next slot's own budget.

use std::fs;
use std::thread;
use std::time::{Duration, Instant};

use super::paging_support::{
    activate, complete, door_of_with_save, file_name, quiet_since, status_of, temp_dir,
    wait_for, Engine, Reply, QUIET, HASH,
};
use super::*;

/// How long the fake engine holds the tick's save before answering it: long
/// enough that whoever wrongly waits for the save is measurably late, short
/// of the door's patience so the save itself still succeeds.
const SLOW_SAVE: Duration = Duration::from_millis(1500);

/// A wait of this long waited for the save. A completion is two loopback
/// round-trips, and the fake engine's delay sits only on the tick's save.
const WAITED: Duration = Duration::from_millis(1000);

#[test]
fn the_mark_at_the_end_of_a_turn_does_not_wait_for_the_ticks_save() {
    let slot_dir = temp_dir("tick-mark");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);
    let chat = "aaaa1111";
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    complete(address, &token);
    let opened = engine.sent().len();

    engine.delay(SLOW_SAVE);
    thread::scope(|scope| {
        let ticking = scope.spawn(|| door.save_idle(quiet_since(Instant::now())));
        // The tick's save has reached the engine, and the engine is sitting
        // on the answer: this is the window in which the tick holds — or does
        // not hold — the slot's mutex.
        wait_for(&engine, opened + 1);

        // The turn ends now. Its mark takes the slot's mutex; if the tick
        // holds that mutex across the engine call, this waits out the save
        // inside a door worker, and every mark behind it waits with it.
        let started = Instant::now();
        complete(address, &token);
        let waited = started.elapsed();
        assert!(
            waited < WAITED,
            "the end of a turn waited {waited:?} for the tick's save to finish"
        );

        assert_eq!(
            ticking.join().unwrap(),
            1,
            "the tick did not write the slot it had gone quiet for"
        );
    });
    assert!(
        slot_dir.join(file_name(chat)).exists(),
        "the chat never reached its file"
    );
    door.shutdown();
}

#[test]
fn a_mark_that_arrives_while_the_save_is_in_flight_survives_it() {
    let slot_dir = temp_dir("tick-race");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);
    let chat = "aaaa1111";
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    complete(address, &token);
    let opened = engine.sent().len();

    engine.delay(SLOW_SAVE);
    thread::scope(|scope| {
        let ticking = scope.spawn(|| door.save_idle(quiet_since(Instant::now())));
        wait_for(&engine, opened + 1);

        // A completion lands while the save is in flight. Its mark stamps a
        // NEW instant — a turn the in-flight save cannot have written — and
        // the lock is free precisely because the tick released it around the
        // engine call.
        complete(address, &token);
        let marked = Instant::now();

        assert_eq!(
            ticking.join().unwrap(),
            1,
            "the tick did not save the slot it read"
        );

        // The save succeeded. Clearing the instant it started with is only
        // correct while that instant is still the slot's: this one is not,
        // so it must have survived the save it interrupted, and the turn it
        // names is still owed to disk.
        assert_eq!(
            door.save_idle(quiet_since(marked)),
            1,
            "the mark that arrived during the save was erased by it"
        );
    });
    let sends = engine.sent();
    let saves = sends.iter().filter(|sent| sent.action == "save").count();
    assert_eq!(saves, 2, "the surviving mark was not written out: {saves:?} saves in {sends:?}");
    assert!(
        slot_dir.join(file_name(chat)).exists(),
        "the chat never reached its file"
    );
    door.shutdown();
}

#[test]
fn a_slot_switched_away_while_the_save_was_in_flight_is_not_written_out() {
    let slot_dir = temp_dir("tick-switched");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);
    let (first, second) = ("aaaa1111", "bbbb2222");
    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);
    // The target has a file, so the switch's second half is a restore.
    fs::write(slot_dir.join(file_name(second)), b"state").unwrap();
    complete(address, &token);
    let opened = engine.sent().len();

    engine.delay(SLOW_SAVE);
    thread::scope(|scope| {
        let ticking = scope.spawn(|| door.save_idle(quiet_since(Instant::now())));
        wait_for(&engine, opened + 1);

        // The user opens another chat while the tick's save is still being
        // answered. The switch saves `first` itself and puts `second` in the
        // slot — so when the tick's engine call finally returns, its staging
        // file is not allowed to reach `first`'s name, whatever it holds.
        assert_eq!(status_of(&activate(address, Some(&token), second)), 204);

        assert_eq!(
            ticking.join().unwrap(),
            0,
            "the tick counted a save of a slot it no longer held"
        );
    });
    assert!(
        !slot_dir.join(format!("{}.staging", file_name(first))).exists(),
        "the superseded staging file survived the tick"
    );
    // The switch's own save is what put `first` in place, and its restore
    // what put `second` in the slot; the tick added nothing under any name.
    assert!(
        slot_dir.join(file_name(first)).exists(),
        "the switch did not save the chat it left"
    );
    assert!(
        slot_dir.join(file_name(second)).exists(),
        "the restore did not land"
    );
    door.shutdown();
}

#[test]
fn the_second_dirty_slot_of_one_tick_is_offered_a_budget_of_its_own() {
    let slot_dir = temp_dir("tick-budget");
    let engine = Engine::start(&slot_dir);
    let first = credential();
    let second = credential();
    let (door, address) =
        door_of_with_save(engine.port, &slot_dir, HASH, &[&first, &second], QUIET);
    let (one, two) = ("aaaa1111", "bbbb2222");
    assert_eq!(status_of(&activate(address, Some(&first), one)), 204);
    assert_eq!(status_of(&activate(address, Some(&second), two)), 204);
    complete(address, &first);
    complete(address, &second);
    let opened = engine.sent().len();

    // The first save is held past the whole patience: the tick spends its
    // ten seconds on slot 0 before it even looks at slot 1.
    engine.delay(crate::PATIENCE + Duration::from_millis(400));
    // A real tick passes `Instant::now()`, and the quiet has to have genuinely
    // run out under it — so this one sleeps instead of being handed a future
    // instant, which would push the deadline slot 1 is measured against.
    thread::sleep(QUIET + Duration::from_millis(50));
    let saved = door.save_idle(Instant::now());

    // The offer, not the timing: both attempts must REACH the engine. A
    // deadline computed once per tick is spent by the first slot, and the
    // second is then declared unreachable with no budget left — without a
    // connection ever being opened for it, so the engine does not see the
    // request and the slot's turn stays owed for a whole interval.
    let sends = engine.sent();
    let ticked = &sends[opened..];
    assert_eq!(
        ticked
            .iter()
            .filter(|sent| sent.action == "save" && sent.slot == "1")
            .count(),
        1,
        "the second dirty slot of the tick never reached the engine: {ticked:?}"
    );
    assert_eq!(
        ticked
            .iter()
            .filter(|sent| sent.action == "save" && sent.slot == "0")
            .count(),
        1,
        "the first dirty slot of the tick never reached the engine: {ticked:?}"
    );
    assert_eq!(
        saved, 1,
        "the tick wrote {saved} of its two dirty slots: {ticked:?}"
    );
    assert!(
        slot_dir.join(format!("d1-m{HASH}-c{two}.bin")).exists(),
        "the second slot's save wrote nothing"
    );
    door.shutdown();
}

#[test]
fn two_consecutive_failures_are_the_ceiling_and_the_third_attempt_is_the_release() {
    let slot_dir = temp_dir("tick-ceiling");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of_with_save(engine.port, &slot_dir, HASH, &[&token], QUIET);
    assert_eq!(status_of(&activate(address, Some(&token), "aaaa1111")), 204);
    complete(address, &token);
    let opened = engine.sent().len();
    let marked = Instant::now();

    // Two failures in a row, from the same engine.
    engine.reply([Reply::Refused, Reply::Refused]);
    assert_eq!(
        door.save_idle(marked + QUIET),
        0,
        "the first attempt was counted as written"
    );
    assert_eq!(
        door.save_idle(marked + QUIET * 2),
        0,
        "the first retry came before its interval"
    );
    // The backoff restarts from each attempt's own start: attempt three is
    // three intervals from the mark, and three intervals is the unload clock —
    // one hair before it, the slot is still owed and nothing is asked.
    assert_eq!(
        door.save_idle(marked + QUIET * 3 - Duration::from_millis(1)),
        0,
        "the third attempt preceded the release"
    );
    assert_eq!(
        engine.sent().len(),
        opened + 2,
        "a save was sent inside the backoff: {:?}",
        &engine.sent()[opened..]
    );
    assert_eq!(
        door.save_idle(marked + QUIET * 3),
        1,
        "the third attempt did not fall at three intervals"
    );
    assert_eq!(engine.sent().len(), opened + 3);
    assert!(
        slot_dir.join(file_name("aaaa1111")).exists(),
        "the third attempt wrote nothing"
    );
    door.shutdown();
}
