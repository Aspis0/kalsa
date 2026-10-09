//! The day a call is sent: English words for the local day, read once at post
//! and kept with the entry, so the AI replays the same bytes on every turn.

use chrono::NaiveDate;

use super::{open, phone, reopen};
use crate::sent::{day_phrase, sent_on};

#[test]
fn the_day_is_english_words_with_no_time() {
    let thursday = NaiveDate::from_ymd_opt(2026, 10, 8).unwrap();
    assert_eq!(day_phrase(thursday), "Thursday, 8 October 2026");
    let new_year = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    assert_eq!(day_phrase(new_year), "Thursday, 1 January 2026");
}

#[test]
fn a_unix_time_names_a_local_day_in_its_year() {
    // Noon UTC on 8 October 2026 is 8 or 9 October in every timezone.
    let phrase = sent_on(1_791_460_800).expect("a valid time has a day");
    assert!(phrase.ends_with(" 2026"), "{phrase}");
}

#[test]
fn only_a_members_call_keeps_its_day_and_the_day_survives_a_reopen() {
    let (dir, room) = open("sent_on");
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
