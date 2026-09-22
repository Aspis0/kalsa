//! T6b from the door's side: the two reads the panel makes in-process — how
//! many slots hold a named chat, and what the save directory weighs. Neither
//! is a route (the door refuses `GET /slots`), and neither may answer with a
//! number the door does not have.

use std::fs;

use super::paging_support::{
    activate, door_of, erase, status_of, temp_dir, Engine, HASH,
};
use super::*;

#[test]
fn the_panel_counts_a_named_chat_and_nothing_else() {
    let slot_dir = temp_dir("panel-residents");
    let engine = Engine::start(&slot_dir);
    let (first, second) = (credential(), credential());
    let (door, address) = door_of(engine.port, Some(&slot_dir), Some(HASH), &[&first, &second]);

    // The denominator first: the slots the door itself was built with. Four,
    // not `/props`' `total_slots` — `door_capacity` can force one of those to
    // 1 and this door consumed the private headers.
    assert_eq!(door.capacity(), 4, "the capacity is not the slots this door built");

    // Two slots nobody has looked at: born `Unknown`, and `Unknown` is not a
    // resident — nor a zero the panel may print as if it knew.
    assert_eq!(door.chats.observed(0).1, "unknown");
    assert_eq!(door.chats.observed(1).1, "unknown");
    assert_eq!(door.residents(), 0, "an unopened slot holds a resident");

    // Two devices, two slots, two named chats.
    assert_eq!(status_of(&activate(address, Some(&first), "aaaa1111")), 204);
    assert_eq!(door.residents(), 1, "the first resident was not counted");
    assert_eq!(status_of(&activate(address, Some(&second), "bbbb2222")), 204);
    assert_eq!(door.residents(), 2, "the second resident was not counted");
    assert_eq!(door.chats.observed(0).1, "resident");
    assert_eq!(door.chats.observed(1).1, "resident");

    // Erasing the resident chat empties that slot: `Empty` is not a resident
    // either, and the second slot keeps its chat.
    assert_eq!(status_of(&erase(address, Some(&first), "aaaa1111")), 204);
    assert_eq!(door.chats.observed(0).1, "empty");
    assert_eq!(door.residents(), 1, "an empty slot was counted as a resident");

    // A release takes the claims away: the slot reads `Unknown` again, and
    // "I do not know" leaves the count rather than inflating it.
    door.invalidate_residency();
    assert_eq!(door.chats.observed(1).1, "unknown");
    assert_eq!(door.residents(), 0, "an unknown slot was counted as a resident");
    door.shutdown();
}

#[test]
fn the_disk_line_is_the_bytes_of_the_files_that_are_there() {
    let slot_dir = temp_dir("panel-disk");
    // Real files, real lengths, both names under the device in the set so the
    // construction sweep leaves them alone. The `.staging` sibling counts:
    // it is bytes on this disk whether or not anyone will rename it.
    fs::write(slot_dir.join("d0-ma1b2c3d4-caaaa1111.bin"), vec![0u8; 11]).unwrap();
    fs::write(slot_dir.join("d0-ma1b2c3d4-caaaa1111.bin.staging"), vec![0u8; 7]).unwrap();
    let token = credential();
    let (door, _address) = door_of(1, Some(&slot_dir), Some(HASH), &[&token]);

    let scan = door.disk_usage().expect("a door with a directory answers a scan");
    assert_eq!(scan.bytes, 18, "the scan did not sum the files' own bytes");
    assert_eq!(scan.files, 2, "the scan did not count the files");
    assert_eq!(scan.unreadable, 0, "nothing failed to read and nothing was skipped");
    door.shutdown();
}

#[test]
fn a_save_directory_nobody_can_read_is_unknown_not_zero() {
    let slot_dir = temp_dir("panel-disk-gone");
    let token = credential();
    let (door, _address) = door_of(1, Some(&slot_dir), Some(HASH), &[&token]);
    assert!(door.disk_usage().is_some(), "an existing directory did not answer");

    // Gone after construction: `read_dir` fails the same way a missing
    // directory does, and either means "not known" — 0 bytes here would be a
    // total invented out of a failure.
    fs::remove_dir_all(&slot_dir).unwrap();
    assert!(
        door.disk_usage().is_none(),
        "an unreadable directory read as zero bytes"
    );
    door.shutdown();

    // And a door built without the tier at all (no directory named): the
    // same absence, for the other reason.
    let (untiered, _address) = door_of(1, None, Some(HASH), &[&token]);
    assert!(
        untiered.disk_usage().is_none(),
        "a door without a save directory answered a disk number"
    );
    untiered.shutdown();
}
