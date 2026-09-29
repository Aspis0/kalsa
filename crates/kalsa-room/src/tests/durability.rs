//! Durability: what a restart keeps, what damage costs, and the recovery
//! that keeps every dropped byte beside the transcript.

use std::path::{Path, PathBuf};

use super::{log_path, open, phone, reopen, say};
use crate::PostError;

const LINE_ONE: &str = r#"{"v":1,"kind":"member","seq":1,"client_msg_id":"a","member":3,"text":"first","time":100,"call_ai":false}"#;
const LINE_TWO: &str = r#"{"v":1,"kind":"member","seq":2,"client_msg_id":"b","member":4,"text":"second","time":101,"call_ai":false}"#;
const AI_LINE: &str = r#"{"v":1,"kind":"ai","seq":2,"client_msg_id":"","member":4294967294,"text":"It is 17:00.","time":101,"call_ai":true}"#;

fn damaged_copies(dir: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("room-log.damaged-"))
        })
        .collect();
    found.sort();
    found
}

#[test]
fn a_reopen_keeps_every_entry_and_continues_the_numbering() {
    let (dir, room) = open("durability_restart");
    say(&room, 3, "one", "before the restart");
    say(&room, 4, "two", "also before");
    drop(room);

    let reopened = reopen(&dir).expect("the room opens again");
    let page = reopened.newest_page(1, 100).unwrap();
    assert_eq!(page.messages.len(), 2);
    assert_eq!(page.messages[0].text, "before the restart");
    let after = say(&reopened, 3, "three", "after");
    assert_eq!(after.seq, 3);
}

#[test]
fn an_idempotent_retry_survives_the_restart_that_separated_it() {
    let (dir, room) = open("durability_idempotent");
    let first = say(&room, 3, "retry-me", "posted before the restart");
    drop(room);

    let reopened = reopen(&dir).expect("the room opens again");
    let member = reopened.member_of(3).expect("the roster survived too");
    let replay = reopened
        .post(member, "retry-me", "posted before the restart", false)
        .expect("the retry after the restart is answered");
    assert_eq!(replay, first);
    assert!(
        matches!(reopened.post(member, "retry-me", "different words", false), Err(PostError::ClientIdReused)),
        "and the reused-id rule survives with it"
    );
    assert_eq!(reopened.newest_page(1, 100).unwrap().messages.len(), 1);
}

#[test]
fn the_ai_entry_survives_the_restart_like_any_other() {
    let (dir, _room) = open("durability_ai_line");
    std::fs::write(log_path(&dir), format!("{LINE_ONE}\n{AI_LINE}\n")).unwrap();

    let room = reopen(&dir).expect("the room opens again");
    let page = room.newest_page(1, 100).unwrap();
    assert_eq!(page.messages.len(), 2);
    assert_eq!(page.messages[1].member, crate::MemberId::Ai);
    let next = room.post_ai("Still 17:00.").unwrap();
    assert_eq!(next.seq, 3);
}

#[test]
fn a_torn_last_line_is_cut_back_and_every_dropped_byte_is_kept_beside() {
    let (dir, _room) = open("durability_torn");
    let original = format!("{LINE_ONE}\n{{\"v\":1,\"seq\":2,\"client_m");
    std::fs::write(log_path(&dir), &original).unwrap();

    let room = reopen(&dir).expect("the room opens again");
    assert_eq!(room.newest_page(1, 100).unwrap().messages.len(), 1);
    assert_eq!(
        std::fs::read_to_string(log_path(&dir)).unwrap(),
        format!("{LINE_ONE}\n"),
        "the live file is the intact prefix"
    );
    let copies = damaged_copies(&dir);
    assert_eq!(copies.len(), 1, "the dropped bytes are kept, once");
    assert_eq!(std::fs::read(&copies[0]).unwrap(), original.as_bytes());
    let appended = say(&room, 4, "b", "after the recovery");
    assert_eq!(appended.seq, 2, "the numbering continues from what survived");
}

#[test]
fn a_tail_that_lost_only_its_newline_is_repaired_and_kept() {
    let (dir, _room) = open("durability_newline");
    std::fs::write(log_path(&dir), format!("{LINE_ONE}\n{LINE_TWO}")).unwrap();

    let room = reopen(&dir).expect("the room opens again");
    let page = room.newest_page(1, 100).unwrap();
    assert_eq!(page.messages.len(), 2, "the entry whose newline was lost is kept");
    let bytes = std::fs::read(log_path(&dir)).unwrap();
    assert_eq!(*bytes.last().unwrap(), b'\n', "the newline is written back");
    assert!(damaged_copies(&dir).is_empty(), "nothing was dropped, so nothing is owed");
    let appended = say(&room, 3, "c", "appends cleanly");
    assert_eq!(appended.seq, 3);
}

#[test]
fn middle_damage_recovers_the_longest_valid_prefix_and_keeps_the_bytes() {
    let (dir, _room) = open("durability_middle");
    let original = format!("{LINE_ONE}\nnot json at all\n{LINE_TWO}\n");
    std::fs::write(log_path(&dir), &original).unwrap();

    let room = reopen(&dir).expect("the room opens again");
    let page = room.newest_page(1, 100).unwrap();
    assert_eq!(page.messages.len(), 1, "everything after the damage waits in the copy");
    let copies = damaged_copies(&dir);
    assert_eq!(copies.len(), 1);
    assert_eq!(std::fs::read(&copies[0]).unwrap(), original.as_bytes());
    let appended = say(&room, 4, "z", "the room continues");
    assert_eq!(appended.seq, 2);
}

#[test]
fn a_line_from_a_newer_format_is_recovered_not_served() {
    let (dir, _room) = open("durability_version");
    let newer = LINE_ONE.replace(r#""v":1"#, r#""v":2"#);
    std::fs::write(log_path(&dir), format!("{newer}\n")).unwrap();
    let room = reopen(&dir).expect("the room opens again");
    assert!(room.newest_page(1, 10).unwrap().messages.is_empty());
    assert_eq!(damaged_copies(&dir).len(), 1);
}

#[test]
fn numbering_with_a_gap_recovers_up_to_the_gap() {
    let (dir, _room) = open("durability_gap");
    let third = LINE_ONE.replace("\"seq\":1", "\"seq\":3");
    std::fs::write(log_path(&dir), format!("{LINE_ONE}\n{third}\n")).unwrap();
    let room = reopen(&dir).expect("the room opens again");
    assert_eq!(room.newest_page(1, 10).unwrap().messages.len(), 1);
    assert_eq!(damaged_copies(&dir).len(), 1);
}

#[test]
fn one_idempotency_key_on_two_entries_keeps_only_the_first() {
    let (dir, _room) = open("durability_repeat_id");
    let twin = LINE_ONE.replace("\"seq\":1", "\"seq\":2").replace("\"text\":\"first\"", "\"text\":\"again\"");
    std::fs::write(log_path(&dir), format!("{LINE_ONE}\n{twin}\n")).unwrap();
    let room = reopen(&dir).expect("the room opens again");
    assert_eq!(room.newest_page(1, 10).unwrap().messages.len(), 1);
    assert_eq!(damaged_copies(&dir).len(), 1);
}

#[test]
fn a_torn_first_append_leaves_an_openable_room() {
    let (dir, _room) = open("durability_torn_first");
    std::fs::write(log_path(&dir), "{\"v\":1,\"seq\":1,\"clie").unwrap();

    let room = reopen(&dir).expect("the room opens again");
    assert!(room.newest_page(1, 10).unwrap().messages.is_empty());
    let appended = say(&room, 3, "a", "the first complete entry");
    assert_eq!(appended.seq, 1);
    assert_eq!(
        std::fs::read_to_string(log_path(&dir))
            .unwrap()
            .lines()
            .count(),
        1,
        "the fragment is gone, one clean line stands"
    );
    assert_eq!(damaged_copies(&dir).len(), 1);
}

#[test]
fn damage_recovery_touches_the_original_only_through_its_copy() {
    // The invariant under the others: a recovered room never serves bytes
    // the damaged copy does not hold.
    let (dir, _room) = open("durability_no_loss");
    let original = format!("{LINE_ONE}\ngarbage middle\n{LINE_TWO}\n");
    std::fs::write(log_path(&dir), &original).unwrap();
    let room = reopen(&dir).expect("the room opens again");
    let live = std::fs::read_to_string(log_path(&dir)).unwrap();
    assert!(
        original.starts_with(&live),
        "the live file is a prefix of what the copy kept"
    );
    drop(room);
}

#[test]
fn only_the_two_newest_damaged_copies_stay() {
    let (dir, _room) = open("durability_prune");
    let mut originals = Vec::new();
    for round in 0..3 {
        let bytes = format!("{LINE_ONE}\ngarbage from round {round}\n");
        std::fs::write(log_path(&dir), &bytes).unwrap();
        originals.push(bytes);
        let room = reopen(&dir).expect("the room opens again");
        drop(room);
    }
    let copies = damaged_copies(&dir);
    assert_eq!(copies.len(), 2, "the newest two, never more");
    let kept: Vec<String> = copies
        .iter()
        .map(|path| std::fs::read_to_string(path).unwrap())
        .collect();
    assert_eq!(kept, originals[1..], "the oldest copy is the one pruned");
}

#[test]
fn an_injected_append_failure_that_stored_nothing_reports_io_and_the_room_continues() {
    let (_dir, room) = open("durability_inject_clean");
    say(&room, 3, "m1", "the first entry");
    crate::append::inject_append_failure();
    let refused = room.post(phone(&room, 3), "m2", "the second entry", false);
    crate::append::clear_append_failure();
    assert!(
        matches!(refused, Err(PostError::Io(_))),
        "the file holds what memory holds: nothing landed, the refusal is the io error"
    );
    let retry = say(&room, 3, "m2", "the second entry");
    assert_eq!(retry.seq, 2, "the room still writes after the honest refusal");
}

#[test]
fn a_reopened_file_the_room_cannot_explain_stops_the_writes() {
    let (dir, room) = open("durability_inject_divergent");
    say(&room, 3, "m1", "the entry memory holds");
    // The file loses that entry behind the room's back: a reopen now
    // disagrees with memory by more than the one entry being posted.
    std::fs::write(log_path(&dir), b"").unwrap();
    crate::append::inject_append_failure();
    let refused = room.post(phone(&room, 3), "m2", "never lands", false);
    crate::append::clear_append_failure();
    assert!(
        matches!(refused, Err(PostError::ReadOnly)),
        "a transcript the room cannot explain is not adopted"
    );
    assert!(
        matches!(room.post(phone(&room, 3), "m3", "also refused", false), Err(PostError::ReadOnly)),
        "and the room stays read-only, not just for the one post"
    );
}

#[test]
fn the_room_id_is_stable_and_the_epoch_moves_only_with_recovery() {
    let (dir, room) = open("durability_identity");
    super::phone(&room, 3);
    for n in 1..=3 {
        say(&room, 3, &format!("m{n}"), "words");
    }
    // A late member: the floor is the interesting part of both recoveries.
    let late = super::phone(&room, 4);
    let room_id = room.room_id();
    let epoch = room.epoch();
    drop(room);

    let reopened = reopen(&dir).expect("the room opens again");
    assert_eq!(reopened.room_id(), room_id, "the id a phone keys its store by never changes");
    assert_eq!(reopened.epoch(), epoch, "a clean reopen keeps the epoch");
    drop(reopened);

    // A pure torn tail: nobody was ever served those bytes, so nothing
    // acknowledged was lost — the epoch stands and every floor survives.
    let whole = std::fs::read_to_string(log_path(&dir)).unwrap();
    std::fs::write(log_path(&dir), format!("{whole}{{\"torn")).unwrap();
    let tail_recovered = reopen(&dir).expect("the tail is recovered");
    assert_eq!(tail_recovered.epoch(), epoch, "a torn tail lost nothing acknowledged");
    assert_eq!(
        tail_recovered.join_of(late),
        Some(4),
        "the late member's floor survives a tail recovery untouched"
    );
    let tail_epoch = tail_recovered.epoch();
    drop(tail_recovered);

    // A complete last line that parses but breaks a rule — a seq out of
    // order — is middle damage however it ended: a complete line is
    // something a client may have read, so the epoch moves for it.
    let wrong_seq = LINE_ONE.replace("\"seq\":1", "\"seq\":9");
    let whole = std::fs::read_to_string(log_path(&dir)).unwrap();
    let terminated = format!("{whole}{wrong_seq}\n");
    std::fs::write(log_path(&dir), &terminated).unwrap();
    let rule_broken = reopen(&dir).expect("the rule-breaking line is dropped");
    assert_ne!(
        rule_broken.epoch(),
        tail_epoch,
        "a terminated line failing a rule re-mints the epoch"
    );
    let broken_epoch = rule_broken.epoch();
    drop(rule_broken);
    std::fs::write(log_path(&dir), terminated.trim_end_matches('\n')).unwrap();
    let unterminated = reopen(&dir).expect("the unterminated rule-breaker opens");
    assert_ne!(
        unterminated.epoch(),
        broken_epoch,
        "and so does the same line without its newline"
    );

    // Middle damage: acknowledged entries are gone, the epoch moves, and
    // a join past what survived is clamped to just past it.
    let whole = std::fs::read_to_string(log_path(&dir)).unwrap();
    let lines: Vec<String> = whole.lines().map(str::to_string).collect();
    assert_eq!(lines.len(), 3);
    std::fs::write(
        log_path(&dir),
        format!("{}\ngarbage middle\n{}\n", lines[0], lines[2]),
    )
    .unwrap();
    let recovered = reopen(&dir).expect("the recovery opens on the prefix");
    assert_eq!(recovered.room_id(), room_id);
    assert_ne!(recovered.epoch(), epoch, "middle damage dropped acknowledged entries");
    let member_again = recovered.member_of(3).expect("the roster survived");
    assert_eq!(recovered.join_of(member_again), Some(1), "a join within what survived is kept");
    assert_eq!(
        recovered.join_of(late),
        Some(2),
        "a join past what survived clamps to just past it: min(4, surviving 1 + 1)"
    );
}
