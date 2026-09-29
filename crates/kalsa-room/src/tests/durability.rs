//! Durability: what a restart keeps, what a torn last line costs, and what
//! a transcript that disagrees with itself is refused with.

use super::{member, open, say};
use crate::{Room, RoomError};

const LINE_ONE: &str = r#"{"v":1,"seq":1,"client_msg_id":"a","member_id":3,"text":"first","time":100,"call_ai":false}"#;

fn log_path(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join("room-log.jsonl")
}

#[test]
fn a_reopen_keeps_every_entry_and_continues_the_numbering() {
    let (dir, room) = open("durability_restart");
    say(&room, member(3), "one", "before the restart");
    say(&room, member(4), "two", "also before");
    drop(room);

    let reopened = Room::open(&dir).expect("the room opens again");
    let page = reopened.page_before(u64::MAX, 100);
    assert_eq!(page.len(), 2);
    assert_eq!(page[0].text, "before the restart");
    let after = say(&reopened, member(3), "three", "after");
    assert_eq!(after.seq, 3);
}

#[test]
fn an_idempotent_retry_survives_the_restart_that_separated_it() {
    let (dir, room) = open("durability_idempotent");
    let first = say(&room, member(3), "retry-me", "posted before the restart");
    drop(room);

    let reopened = Room::open(&dir).expect("the room opens again");
    let replay = reopened
        .post(member(3), "retry-me", "posted before the restart", false)
        .expect("the retry after the restart is answered");
    assert_eq!(replay, first);
    assert_eq!(reopened.page_before(u64::MAX, 100).len(), 1);
}

#[test]
fn a_torn_last_line_is_truncated_and_the_room_continues() {
    let (dir, _room) = open("durability_torn");
    std::fs::write(
        log_path(&dir),
        format!("{LINE_ONE}\n{{\"v\":1,\"seq\":2,\"client_m"),
    )
    .unwrap();

    let room = Room::open(&dir).expect("a torn tail is recovered, not fatal");
    assert_eq!(room.page_before(u64::MAX, 100).len(), 1);
    let appended = say(&room, member(4), "b", "after the recovery");
    assert_eq!(appended.seq, 2, "the numbering continues from what survived");

    let lines = std::fs::read_to_string(log_path(&dir)).unwrap();
    assert_eq!(lines.lines().count(), 2, "the append landed on a clean end");
}

#[test]
fn a_torn_first_append_leaves_a_room_the_store_can_still_open() {
    let (dir, _room) = open("durability_torn_first");
    std::fs::write(log_path(&dir), "{\"v\":1,\"seq\":1,\"clie").unwrap();

    let room = Room::open(&dir).expect("a whole-file torn tail is recovered too");
    assert!(room.page_before(u64::MAX, 100).is_empty());
    let appended = say(&room, member(3), "a", "the first complete entry");
    assert_eq!(appended.seq, 1);
    assert_eq!(
        std::fs::read_to_string(log_path(&dir)).unwrap().lines().count(),
        1,
        "the fragment is gone, one clean line stands"
    );
}

#[test]
fn a_tail_that_lost_only_its_newline_is_repaired_and_kept() {
    let (dir, _room) = open("durability_newline");
    let whole_line = r#"{"v":1,"seq":2,"client_msg_id":"b","member_id":4,"text":"second","time":101,"call_ai":false}"#;
    std::fs::write(log_path(&dir), format!("{LINE_ONE}\n{whole_line}")).unwrap();

    let room = Room::open(&dir).expect("a complete entry is not thrown away");
    let page = room.page_before(u64::MAX, 100);
    assert_eq!(page.len(), 2, "the entry whose newline was lost is kept");
    assert_eq!(page[1].seq, 2);

    let bytes = std::fs::read(log_path(&dir)).unwrap();
    assert_eq!(*bytes.last().unwrap(), b'\n', "the newline is written back");
    let appended = say(&room, member(3), "c", "appends cleanly");
    assert_eq!(appended.seq, 3);
}

#[test]
fn corruption_before_the_tail_refuses_the_room_and_touches_nothing() {
    let (dir, _room) = open("durability_corrupt");
    std::fs::write(log_path(&dir), format!("{LINE_ONE}\nnot json at all\n")).unwrap();
    let before = std::fs::read(log_path(&dir)).unwrap();

    assert!(matches!(
        Room::open(&dir),
        Err(RoomError::Corrupt("a transcript line does not parse"))
    ));
    assert_eq!(
        std::fs::read(log_path(&dir)).unwrap(),
        before,
        "a refused room deletes nothing"
    );
}

#[test]
fn a_line_from_a_newer_format_is_corruption_not_a_default() {
    let (dir, _room) = open("durability_version");
    let newer = LINE_ONE.replace(r#""v":1"#, r#""v":2"#);
    std::fs::write(log_path(&dir), format!("{newer}\n")).unwrap();
    assert!(matches!(
        Room::open(&dir),
        Err(RoomError::Corrupt("transcript line is from a newer format"))
    ));
}

#[test]
fn numbering_with_a_gap_or_a_repeat_refuses_the_room() {
    let (dir, _room) = open("durability_gap");
    let second = LINE_ONE.replace("\"seq\":1", "\"seq\":3");
    std::fs::write(log_path(&dir), format!("{LINE_ONE}\n{second}\n")).unwrap();
    assert!(matches!(
        Room::open(&dir),
        Err(RoomError::Corrupt("transcript numbering has a gap or a repeat"))
    ));
}

#[test]
fn one_client_msg_id_on_two_entries_refuses_the_room() {
    let (dir, _room) = open("durability_repeat_id");
    let twin = LINE_ONE.replace("\"seq\":1", "\"seq\":2").replace("\"text\":\"first\"", "\"text\":\"again\"");
    std::fs::write(log_path(&dir), format!("{LINE_ONE}\n{twin}\n")).unwrap();
    assert!(matches!(
        Room::open(&dir),
        Err(RoomError::Corrupt("one client message id holds two transcript entries"))
    ));
}
