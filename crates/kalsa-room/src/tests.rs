//! The store's tests, split by topic: posting and idempotency, history
//! pages, durability and recovery, members and names, the live stream, the
//! mention matcher, and concurrency.

mod concurrency;
mod durability;
mod history;
mod members;
mod media;
mod mention;
mod permissions;
mod post;
mod queue;
mod subscribe;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use crate::{Entry, MemberId, Room};

/// The transcript's path inside a room directory, for the tests that
/// damage one on purpose.
fn log_path(dir: &std::path::Path) -> PathBuf {
    dir.join("room-log.jsonl")
}

/// One scratch directory per call: the test's name, a process-unique
/// counter, and the pid — parallel runs and reruns never share one.
static SCRATCH: AtomicU32 = AtomicU32::new(0);

fn scratch(name: &str) -> PathBuf {
    let unique = SCRATCH.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!(
        "kalsa-room-{name}-{unique}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Opens a room in a fresh scratch DATA directory and hands back the
/// room's own directory (`<data>/room`) — where every file the store
/// keeps lives.
fn open(name: &str) -> (PathBuf, Room) {
    let data = scratch(name);
    let room = Room::open(&data).expect("a fresh room opens");
    (data.join("room"), room)
}

/// Reopens the room whose own directory this is: `Room::open` takes the
/// DATA directory, the tests hold the room's.
fn reopen(room_dir: &std::path::Path) -> Result<Room, crate::RoomError> {
    Room::open(room_dir.parent().expect("a room dir has a parent"))
}

/// The room's own directory inside a scratch data dir, created empty for
/// the tests that damage files before the first open.
fn room_dir(dir: &std::path::Path) -> PathBuf {
    let dir = dir.join("room");
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// The member a paired device is, enrolling it on first sight.
fn phone(room: &Room, device: u32) -> MemberId {
    room.enroll(device).expect("the device enrolls")
}

fn say(room: &Room, device: u32, id: &str, text: &str) -> Entry {
    room.post(phone(room, device), id, text, false, &[])
        .expect("the post lands")
}
