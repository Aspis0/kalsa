//! The live stream: order, waiting, cursors for a fresh follower and a
//! reconnect, the unnumbered member news, and the bad cursor.

use std::time::{Duration, Instant};

use super::{open, phone, say};
use crate::{Event, MemberEvent, Take};

const SHORT: Duration = Duration::from_millis(50);

fn messages(events: &[Event]) -> Vec<u64> {
    events
        .iter()
        .filter_map(|event| match event {
            Event::Message(entry) => Some(entry.seq),
            Event::Member(_) | Event::Ai(_) | Event::Media(_) => None,
        })
        .collect()
}

#[test]
fn a_waiter_receives_entries_in_order_without_duplicates() {
    let (_dir, room) = open("subscribe_order");
    say(&room, 3, "m1", "already here");
    let room = std::sync::Arc::new(room);
    let mut cursor = room.next_cursor();

    let writer = {
        let room = room.clone();
        std::thread::spawn(move || {
            say(&room, 3, "m2", "one");
            say(&room, 4, "m3", "two");
        })
    };
    let mut out = Vec::new();
    // Two posts may wake the waiter separately or together; drain until
    // the writer is done and the stream is quiet.
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut last = Take::TimedOut;
    while Instant::now() < deadline && messages(&out) != vec![2, 3] {
        last = room.read_since(&mut cursor, deadline, &mut out);
    }
    writer.join().unwrap();
    while Instant::now() < deadline && messages(&out) != vec![2, 3] {
        room.read_since(&mut cursor, deadline, &mut out);
    }

    assert_eq!(last, Take::Events);
    assert_eq!(messages(&out), vec![2, 3]);
    assert_eq!(cursor, room.next_cursor());
}

#[test]
fn a_quiet_wait_times_out_and_leaves_the_cursor_where_it_was() {
    let (_dir, room) = open("subscribe_timeout");
    let mut cursor = room.next_cursor();
    let mut out = Vec::new();
    let take = room.read_since(&mut cursor, Instant::now() + SHORT, &mut out);
    assert_eq!(take, Take::TimedOut);
    assert!(out.is_empty());
    assert_eq!(cursor, room.next_cursor());
}

#[test]
fn cursor_zero_replays_the_whole_transcript() {
    let (_dir, room) = open("subscribe_replay");
    say(&room, 3, "m1", "one");
    say(&room, 4, "m2", "two");
    let mut cursor = 0;
    let mut out = Vec::new();
    let take = room.read_since(&mut cursor, Instant::now() + SHORT, &mut out);
    assert_eq!(take, Take::Events);
    assert_eq!(messages(&out), vec![1, 2]);
}

#[test]
fn a_rename_reaches_a_live_subscriber() {
    let (_dir, room) = open("subscribe_rename");
    let member = phone(&room, 3);
    let mut cursor = room.next_cursor();
    room.set_name(member, "Marco").expect("the name sets");

    let mut out = Vec::new();
    let take = room.read_since(&mut cursor, Instant::now() + SHORT, &mut out);
    assert_eq!(take, Take::Events);
    assert_eq!(
        out,
        vec![Event::Member(MemberEvent::Renamed {
            member,
            name: "Marco".to_string(),
        })]
    );
}

#[test]
fn a_forgotten_member_reaches_a_live_subscriber() {
    let (_dir, room) = open("subscribe_left");
    let member = phone(&room, 3);
    let mut cursor = room.next_cursor();
    room.forget_device(3).expect("the device is forgotten");

    let mut out = Vec::new();
    room.read_since(&mut cursor, Instant::now() + SHORT, &mut out);
    assert_eq!(out, vec![Event::Member(MemberEvent::Left { member })]);
}

#[test]
fn a_reconnect_resumes_after_its_last_seq_and_skips_what_came_before() {
    let (_dir, room) = open("subscribe_resume");
    say(&room, 3, "m1", "one");
    let member = phone(&room, 3);
    room.set_name(member, "Marco").expect("the name sets");
    say(&room, 4, "m2", "two");

    // A client that last saw seq 2 missed nothing before it: the rename
    // that predates its cursor is skipped, not replayed.
    let mut cursor = room.resume_after_seq(2).expect("seq 2 is a real cursor");
    let mut out = Vec::new();
    let take = room.read_since(&mut cursor, Instant::now() + SHORT, &mut out);
    assert_eq!(take, Take::TimedOut);
    assert!(out.is_empty());

    // A client that last saw seq 1 gets the news after it, in order.
    let mut cursor = room.resume_after_seq(1).expect("seq 1 is a real cursor");
    let mut out = Vec::new();
    room.read_since(&mut cursor, Instant::now() + SHORT, &mut out);
    assert_eq!(
        out,
        vec![
            Event::Member(MemberEvent::Renamed {
                member,
                name: "Marco".to_string(),
            }),
            Event::Message(room.page_after(1, 1, 1).unwrap().messages.remove(0)),
        ]
    );
}

#[test]
fn a_cursor_beyond_the_stream_is_refused_not_waited_on() {
    let (_dir, room) = open("subscribe_bad_cursor");
    say(&room, 3, "m1", "one");
    let beyond = room.next_cursor() + 1;
    let mut cursor = beyond;
    let mut out = Vec::new();
    assert_eq!(
        room.read_since(&mut cursor, Instant::now() + SHORT, &mut out),
        Take::BadCursor
    );
    assert!(
        room.resume_after_seq(2).is_none(),
        "a Last-Event-ID above the newest seq claims events that never happened"
    );
    assert!(room.resume_after_seq(1).is_some());
}

#[test]
fn two_subscribers_each_follow_at_their_own_pace() {
    let (_dir, room) = open("subscribe_two");
    say(&room, 3, "m1", "one");
    let mut behind = room.next_cursor();
    say(&room, 3, "m2", "two");
    let mut caught_up = room.next_cursor();
    assert_ne!(behind, caught_up, "one subscriber sat out the second entry");

    let mut first = Vec::new();
    room.read_since(&mut behind, Instant::now() + SHORT, &mut first);
    assert_eq!(messages(&first), vec![2]);

    let mut second = Vec::new();
    let take = room.read_since(&mut caught_up, Instant::now() + SHORT, &mut second);
    assert_eq!(take, Take::TimedOut, "a cursor at the end waits for news");
    assert!(second.is_empty());
}

#[test]
fn an_empty_room_opens_its_first_stream_from_zero() {
    let (_dir, room) = open("subscribe_empty_resume");
    assert_eq!(
        room.resume_after_seq(0),
        Some(0),
        "seen = 0 is a real cursor when the newest is nothing"
    );
    assert_eq!(room.resume_after_seq(1), None, "one past nothing never happened");
    let mut cursor = room.resume_after_seq(0).unwrap();
    let mut out = Vec::new();
    assert_eq!(
        room.read_since(&mut cursor, Instant::now() + SHORT, &mut out),
        Take::TimedOut,
        "an empty room's first stream opens, and waits"
    );
    say(&room, 3, "m1", "hello");
    assert_eq!(room.resume_after_seq(0), Some(0), "0 stays real behind the newest");
}
