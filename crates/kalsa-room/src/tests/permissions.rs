//! Owner-only on disk (unix): the transcript, the directory, the roster,
//! and the damaged-byte copies; and the read-only room a failed recovery
//! leaves behind.

#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use super::{log_path, open, scratch, say};
use crate::{PostError, Room};

fn mode(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[test]
fn the_transcript_the_directory_and_the_roster_are_owner_only() {
    let dir = scratch("permissions_owner_only");
    // A directory and a file both wider than the room should accept.
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
    fs::write(
        log_path(&dir),
        "{\"v\":1,\"kind\":\"member\",\"seq\":1,\"client_msg_id\":\"a\",\"member\":3,\"text\":\"first\",\"time\":100,\"call_ai\":false}\n",
    )
    .unwrap();
    fs::set_permissions(log_path(&dir), fs::Permissions::from_mode(0o644)).unwrap();

    let room = Room::open(&dir).expect("the room opens and narrows");
    assert_eq!(mode(&log_path(&dir)), 0o600, "a wider transcript is tightened");
    assert_eq!(mode(&dir), 0o700, "the room's directory is owner-only");

    room.enroll(3).expect("the device enrolls");
    room.set_name(room.member_of(3).unwrap(), "Marco")
        .expect("the name sets");
    assert_eq!(mode(&dir.join("room-roster.json")), 0o600);
}

#[test]
fn a_fresh_transcript_is_born_owner_only() {
    let (dir, _room) = open("permissions_fresh");
    assert_eq!(mode(&log_path(&dir)), 0o600);
    assert_eq!(mode(&dir), 0o700);
}

#[test]
fn the_damaged_copy_is_owner_only() {
    let (dir, _room) = open("permissions_damaged");
    fs::write(log_path(&dir), "not json at all\n").unwrap();
    Room::open(&dir).expect("the recovery runs");
    let copy = fs::read_dir(&dir)
        .unwrap()
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .find(|path| {
            path.file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("room-log.damaged-"))
        })
        .expect("the copy exists");
    assert_eq!(mode(&copy), 0o600);
}

#[test]
fn a_recovery_that_cannot_write_serves_reads_and_refuses_posts() {
    let (dir, room) = open("permissions_read_only");
    say(&room, 3, "m1", "the intact entry");
    drop(room);
    // Damage after the intact line, then take the directory's write bit
    // away: the copy cannot be made, so the recovery cannot land.
    let mut damaged = fs::read(log_path(&dir)).unwrap();
    damaged.extend_from_slice(b"garbage tail without a newline");
    fs::write(log_path(&dir), &damaged).unwrap();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();

    let room = Room::open(&dir).expect("the room opens on its intact prefix");
    assert_eq!(room.newest_page(10).unwrap().messages.len(), 1, "reads serve");
    let member = room.member_of(3).expect("the roster reads too");
    assert!(
        matches!(room.post(member, "m2", "refused", false), Err(PostError::ReadOnly)),
        "posts are refused, never appended after garbage"
    );

    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
    drop(room);
    let repaired = Room::open(&dir).expect("a reopen retries the recovery");
    let second = say(&repaired, 3, "m2", "the room continues");
    assert_eq!(second.seq, 2, "the repaired room appends after the prefix");
}
