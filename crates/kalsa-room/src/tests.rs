//! The store's tests, split by topic: posting and idempotency, history
//! pages, durability across restarts and torn lines, names, subscribing.

mod durability;
mod history;
mod naming;
mod post;
mod subscribe;

use std::path::PathBuf;

use crate::{MemberId, Room};

/// A fresh directory per test, the way the pairing store's tests scratch
/// one: named for the test, keyed by pid, removed on the way in.
fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kalsa-room-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn open(name: &str) -> (PathBuf, Room) {
    let dir = scratch(name);
    let room = Room::open(&dir).expect("a fresh room opens");
    (dir, room)
}

fn member(id: u32) -> MemberId {
    MemberId::device(id)
}

/// Posts one message, unwrapped: most tests do not care that it can fail.
fn say(room: &Room, member: MemberId, id: &str, text: &str) -> crate::Message {
    room.post(member, id, text, false).expect("the post lands")
}
