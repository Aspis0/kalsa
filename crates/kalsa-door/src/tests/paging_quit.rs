//! The clean quit's save: the resident chat's last turns reach its file while
//! the engine still runs, and nothing the engine no longer holds is written.

use std::fs;
use std::thread;
use std::time::{Duration, Instant};

use super::paging_support::{
    activate, complete, door_of, file_name, status_of, temp_dir, wait_for, Engine, Sent, HASH,
};
use super::*;

/// The budget the app hands the quit save (`exit::SAVE_BUDGET`).
const BUDGET: Duration = Duration::from_secs(8);

fn saves_since(engine: &Engine, from: usize) -> Vec<Sent> {
    engine.sent()[from..]
        .iter()
        .filter(|sent| sent.action == "save")
        .cloned()
        .collect()
}

#[test]
fn a_clean_quit_writes_the_resident_chat_out_once() {
    let slot_dir = temp_dir("quit-resident");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let chat = "aaaa1111";
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    complete(address, &token);
    let before = engine.sent().len();

    door.save_on_quit(BUDGET);

    let saves = saves_since(&engine, before);
    assert_eq!(saves.len(), 1, "the quit did not save the open chat once: {saves:?}");
    // The engine writes the staging sibling; the door renames it into place.
    assert_eq!(saves[0].filename, format!("{}.staging", file_name(chat)));
    assert!(slot_dir.join(file_name(chat)).exists(), "the chat never reached its file");
    assert!(
        door.chats.observed(0).0.is_none(),
        "the slot is still dirty after its state was written out"
    );
    door.shutdown();
}

#[test]
fn a_clean_resident_chat_is_not_written_again_on_quit() {
    let slot_dir = temp_dir("quit-clean");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let chat = "aaaa1111";
    fs::write(slot_dir.join(file_name(chat)), b"state").unwrap();
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    let before = engine.sent().len();

    door.save_on_quit(BUDGET);

    assert!(
        saves_since(&engine, before).is_empty(),
        "a chat whose file already holds its state was written again"
    );
    door.shutdown();
}

#[test]
fn an_unknown_slot_writes_nothing_on_quit() {
    let slot_dir = temp_dir("quit-unknown");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    // A completion on a door that never activated a chat: the slot is dirty
    // but the map cannot name what is in it.
    complete(address, &token);
    assert_eq!(door.chats.observed(0).1, "unknown");
    let before = engine.sent().len();

    door.save_on_quit(BUDGET);

    assert!(
        saves_since(&engine, before).is_empty(),
        "an unnamed slot was written out on quit"
    );
    door.shutdown();
}

#[test]
fn a_released_slot_writes_nothing_on_quit() {
    let slot_dir = temp_dir("quit-released");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let chat = "aaaa1111";
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    complete(address, &token);
    door.invalidate_residency(&door.residency_sample());
    let before = engine.sent().len();

    door.save_on_quit(BUDGET);

    assert!(
        saves_since(&engine, before).is_empty(),
        "the engine released this slot, and the quit wrote it out anyway"
    );
    door.shutdown();
}

#[test]
fn a_hung_engine_cannot_hold_the_quit_past_its_patience() {
    let slot_dir = temp_dir("quit-hung");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let chat = "aaaa1111";
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    complete(address, &token);
    // The engine holds its answer well past the bound handed in below.
    engine.delay(Duration::from_millis(1500));

    let patience = Duration::from_millis(150);
    let started = Instant::now();
    door.chats.save_on_quit(&door.devices, engine.port, patience);
    let took = started.elapsed();

    assert!(
        took < Duration::from_secs(1),
        "the quit waited {took:?} for a save the engine held past its patience"
    );
    door.shutdown();
}

#[test]
fn a_quit_under_a_restore_returns_in_bound_and_saves_nothing() {
    let slot_dir = temp_dir("quit-restore");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let (first, second) = ("aaaa1111", "bbbb2222");
    assert_eq!(status_of(&activate(address, Some(&token), first)), 204);
    complete(address, &token);
    fs::write(slot_dir.join(file_name(second)), b"state").unwrap();
    let opened = engine.sent().len();
    // The switch saves `first` at once, then restores `second`, which the
    // engine holds for two seconds while the restore keeps the slot's lock.
    engine.delay(Duration::ZERO);
    engine.delay(Duration::from_secs(2));

    thread::scope(|scope| {
        let switching = scope.spawn(|| status_of(&activate(address, Some(&token), second)));
        wait_for(&engine, opened + 2);
        let before = engine.sent().len();

        let started = Instant::now();
        door.chats
            .save_on_quit(&door.devices, engine.port, Duration::from_millis(200));
        let took = started.elapsed();

        assert!(
            took < Duration::from_secs(1),
            "the quit waited {took:?} for a slot a restore held"
        );
        assert!(
            saves_since(&engine, before).is_empty(),
            "the quit saved a slot a restore was still writing"
        );
        assert_eq!(switching.join().unwrap(), 204, "the switch itself failed");
    });
    door.shutdown();
}
