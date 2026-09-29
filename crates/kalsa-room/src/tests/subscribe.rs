//! The subscribe primitive: a waiter sees new entries in order, a fresh
//! cursor sees only the future, cursor zero replays everything.

use std::time::{Duration, Instant};

use super::{member, open, say};
use crate::Take;

const SHORT: Duration = Duration::from_millis(50);

#[test]
fn a_waiter_woken_by_a_post_receives_entries_in_order_without_duplicates() {
    let (_dir, room) = open("subscribe_order");
    say(&room, member(3), "m1", "already here");
    let mut cursor = room.next_cursor();
    let room = std::sync::Arc::new(room);

    let writer = {
        let room = room.clone();
        std::thread::spawn(move || {
            say(&room, member(3), "m2", "one");
            say(&room, member(4), "m3", "two");
        })
    };
    let mut out = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(2);
    let take = room.read_since(&mut cursor, deadline, &mut out);
    writer.join().unwrap();

    assert_eq!(take, Take::Events);
    assert_eq!(out.iter().map(|m| m.seq).collect::<Vec<_>>(), vec![2, 3]);
    assert_eq!(out[0].text, "one");
    assert_eq!(cursor, 3);
}

#[test]
fn a_quiet_wait_times_out_and_leaves_the_cursor_where_it_was() {
    let (_dir, room) = open("subscribe_timeout");
    let mut cursor = room.next_cursor();
    let mut out = Vec::new();
    let take = room.read_since(&mut cursor, Instant::now() + SHORT, &mut out);
    assert_eq!(take, Take::TimedOut);
    assert!(out.is_empty());
    assert_eq!(cursor, 0);
}

#[test]
fn cursor_zero_replays_the_whole_transcript() {
    let (_dir, room) = open("subscribe_replay");
    say(&room, member(3), "m1", "one");
    say(&room, member(4), "m2", "two");
    let mut cursor = 0;
    let mut out = Vec::new();
    let take = room.read_since(&mut cursor, Instant::now() + SHORT, &mut out);
    assert_eq!(take, Take::Events);
    assert_eq!(out.len(), 2);
}

#[test]
fn two_subscribers_each_follow_at_their_own_pace() {
    let (_dir, room) = open("subscribe_two");
    say(&room, member(3), "m1", "one");
    let mut behind = room.next_cursor();
    say(&room, member(3), "m2", "two");
    let mut caught_up = room.next_cursor();
    assert_ne!(behind, caught_up, "one subscriber sat out the second entry");

    let mut first = Vec::new();
    room.read_since(&mut behind, Instant::now() + SHORT, &mut first);
    assert_eq!(first.iter().map(|m| m.seq).collect::<Vec<_>>(), vec![2]);

    let mut second = Vec::new();
    let take = room.read_since(&mut caught_up, Instant::now() + SHORT, &mut second);
    assert_eq!(take, Take::TimedOut, "a cursor at the end waits for new entries");
    assert!(second.is_empty());
}

#[test]
fn a_name_change_alone_is_never_handed_to_a_waiter_as_an_entry() {
    let (_dir, room) = open("subscribe_names");
    let mut cursor = room.next_cursor();
    room.set_name(member(3), "Marco").expect("the name sets");
    let mut out = Vec::new();
    let take = room.read_since(&mut cursor, Instant::now() + SHORT, &mut out);
    assert_eq!(take, Take::TimedOut);
    assert!(out.is_empty(), "the stream carries transcript entries; names are read, not pushed, in this store");
}
