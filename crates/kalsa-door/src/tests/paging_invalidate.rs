//! T5a from the door's side: a door is born not knowing its slots, and the
//! engine releasing its model takes the map's claims away — which is what
//! makes the next activation restore from disk instead of no-oping.

use std::fs;

use super::paging_support::{
    activate, door_of, file_name, status_of, temp_dir, Engine, HASH,
};
use super::*;

#[test]
fn a_new_door_calls_every_slot_unknown_not_empty() {
    // The birth state, read directly: at birth `empty` and `unknown` behave
    // identically through the engine (neither saves a previous chat), so no
    // request could ever tell them apart — and `empty` would be an assertion
    // nobody can make. A door can be built against an engine that already
    // holds state in its slots (an adopted run, or a door rebuilt by
    // `stop_door`'s successor while the engine lives).
    let token = credential();
    let (door, _address) = door_of(1, None, None, &[&token]);
    for slot in 0..4 {
        let (dirty, claim) = door.chats.observed(slot);
        assert_eq!(
            claim, "unknown",
            "slot {slot} was born {claim}: a door that has never looked at a slot \
             may not assert it is empty"
        );
        assert!(dirty.is_none(), "slot {slot} was born dirty");
    }
    door.shutdown();
}

#[test]
fn a_released_model_stops_the_map_claiming_resident_and_the_next_activate_restores() {
    let slot_dir = temp_dir("invalidate-release");
    let engine = Engine::start(&slot_dir);
    let token = credential();
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&token]);
    let chat = "aaaa1111";
    fs::write(slot_dir.join(file_name(chat)), b"state").unwrap();

    // The chat is in the slot: one restore, and the map says who is there.
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    assert_eq!(door.chats.observed(0).1, "resident");

    // Baseline for the no-op: asking for the resident chat again touches
    // nothing — that is `569d31e`, and it is correct while the state is in
    // memory.
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    let baseline = engine.sent().len();

    // The engine releases the model (`--sleep-idle-seconds`): the state in
    // the slot is gone, and the app's tick tells the door.
    door.invalidate_residency();

    // THE test. On a map that still says `Resident` this activation is the
    // no-op, the restore that would bring the cache back from the file never
    // happens, and the tier's warmth is lost without a word.
    assert_eq!(status_of(&activate(address, Some(&token), chat)), 204);
    let sent = engine.sent();
    assert!(
        sent[baseline..]
            .iter()
            .any(|sent| sent.action == "restore" && sent.filename == file_name(chat)),
        "the activation after the release skipped the restore: {:?}",
        &sent[baseline..]
    );
    assert_eq!(
        door.chats.observed(0).1,
        "resident",
        "the restore did not put the chat back in the map"
    );

    // And the claim itself: a release leaves no `Resident` behind — a second
    // release is a second reason to say `unknown`, never `empty`.
    door.invalidate_residency();
    assert_eq!(
        door.chats.observed(0).1,
        "unknown",
        "a release left the map claiming a chat the engine no longer holds"
    );
    door.shutdown();
}
