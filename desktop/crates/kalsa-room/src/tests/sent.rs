//! The day a call is sent: English words for the local day, read once at post
//! and kept with the entry, so the AI replays the same bytes on every turn.

use super::{log_path, open, phone, reopen, Scratch};
use crate::sent::sent_on;

/// 23:30 UTC on 8 October 2026: still the 8th in UTC, the 9th in UTC+2.
const LATE_UTC: u64 = 1_791_502_200;
/// Marks the child process that checks the zone; its value is unused.
const CHILD_MARK: &str = "KALSA_ROOM_TZ_CHILD";

#[test]
fn the_day_is_the_local_day_not_the_utc_day() {
    // TZ is read when a process starts, so the zone is given to a child
    // process and this test's own environment is never touched.
    if std::env::var_os(CHILD_MARK).is_some() {
        assert_eq!(
            sent_on(LATE_UTC).as_deref(),
            Some("Friday, 9 October 2026"),
            "in UTC+2 the instant is the 9th"
        );
        return;
    }
    let status = std::process::Command::new(std::env::current_exe().expect("the test binary"))
        .args([
            "--exact",
            "tests::sent::the_day_is_the_local_day_not_the_utc_day",
        ])
        .env(CHILD_MARK, "1")
        .env("TZ", "UTC-2")
        .status()
        .expect("the child process starts");
    assert!(status.success(), "the child in UTC+2 failed its day check");
}

#[test]
fn only_a_members_call_keeps_its_day_and_the_day_survives_a_reopen() {
    let (dir, room) = open("sent_on");
    let _scratch = Scratch::of(&dir);
    let member = phone(&room, 3);
    let call = room
        .post(member, "call", "@Kalsa hello", false, &[])
        .expect("the call lands");
    let plain = room
        .post(member, "plain", "just talking", false, &[])
        .expect("the message lands");
    assert!(call.call_ai, "the mention makes the call");
    assert!(call.sent_on.is_some(), "a call keeps its day");
    assert_eq!(plain.sent_on, None, "a plain message keeps none");
    drop(room);

    let room = reopen(&dir).expect("the room reopens");
    let kept = room
        .entries_for_ai()
        .into_iter()
        .find(|entry| entry.seq == call.seq)
        .expect("the call is in the transcript");
    assert_eq!(
        kept.sent_on, call.sent_on,
        "the reopened room replays the same day"
    );
}

/// One member line as a transcript holds it, with the day given as written.
fn raw_line(seq: u64, call_ai: bool, sent_on: &str) -> String {
    serde_json::json!({
        "v": 1,
        "kind": "member",
        "seq": seq,
        "client_msg_id": format!("m{seq}"),
        "member": 3,
        "text": format!("line {seq}"),
        "time": 100,
        "call_ai": call_ai,
        "sent_on": sent_on,
    })
    .to_string()
}

#[test]
fn a_stored_day_is_kept_only_on_a_call_in_the_writers_spelling() {
    let (dir, room) = open("sent_on_read");
    let _scratch = Scratch::of(&dir);
    drop(room);
    let oversized = "x".repeat(200);
    let lines = [
        raw_line(1, true, "Thursday, 8 October 2026"),
        raw_line(2, true, &oversized),
        raw_line(3, false, "Thursday, 8 October 2026"),
        raw_line(4, true, "Friday, 8 October 2026"),
    ];
    std::fs::write(log_path(&dir), format!("{}\n", lines.join("\n"))).unwrap();

    let room = reopen(&dir).expect("the room reopens");
    let days: Vec<(u64, Option<String>)> = room
        .entries_for_ai()
        .into_iter()
        .map(|entry| (entry.seq, entry.sent_on))
        .collect();
    assert_eq!(
        days,
        vec![
            (1, Some("Thursday, 8 October 2026".to_string())),
            (2, None),
            (3, None),
            (4, None),
        ],
        "every line is kept; only the day is dropped where it is not a call's writer-spelled day"
    );
}
