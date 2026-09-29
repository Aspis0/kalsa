//! History pages: the three cursor modes, the limit, the edges, and what
//! a page beyond either end answers.

use super::{open, phone, say};

#[test]
fn a_transcript_numbers_itself_from_one_with_no_gaps() {
    let (_dir, room) = open("history_numbering");
    for n in 1..=5 {
        let message = say(&room, 3, &format!("m{n}"), "text");
        assert_eq!(message.seq, n);
    }
}

#[test]
fn page_after_hands_out_what_is_newer_oldest_first() {
    let (_dir, room) = open("history_after");
    for n in 1..=5 {
        say(&room, 3, &format!("m{n}"), "text");
    }
    let page = room.page_after(1, 2, 100).unwrap();
    assert_eq!(page.messages.iter().map(|m| m.seq).collect::<Vec<_>>(), vec![3, 4, 5]);
    assert!(page.has_older, "messages 1 and 2 sit before the page");
    assert!(!page.has_newer, "the page ends at the newest");
}

#[test]
fn page_before_hands_out_the_nearest_older_page_oldest_first() {
    let (_dir, room) = open("history_before");
    for n in 1..=10 {
        say(&room, 3, &format!("m{n}"), "text");
    }
    let page = room.page_before(1, 8, 3).unwrap();
    assert_eq!(
        page.messages.iter().map(|m| m.seq).collect::<Vec<_>>(),
        vec![5, 6, 7],
        "the page nearest the cursor, not the transcript's head"
    );
    assert!(page.has_older && page.has_newer);
}

#[test]
fn the_newest_page_is_the_latest_limit_oldest_first() {
    let (_dir, room) = open("history_newest");
    for n in 1..=4 {
        say(&room, 3, &format!("m{n}"), "text");
    }
    let page = room.newest_page(1, 3).unwrap();
    assert_eq!(page.messages.iter().map(|m| m.seq).collect::<Vec<_>>(), vec![2, 3, 4]);
    assert!(page.has_older);
    assert!(!page.has_newer, "nothing is newer than the newest page");
}

#[test]
fn the_limit_rule_is_one_to_two_hundred() {
    let (_dir, room) = open("history_limit");
    say(&room, 3, "m1", "text");
    assert!(room.newest_page(1, 0).is_err(), "zero is not a page");
    assert!(room.newest_page(1, 201).is_err(), "201 is not a page");
    assert!(room.newest_page(1, 200).is_ok());
}

#[test]
fn a_cursor_beyond_either_end_is_an_empty_page_not_an_error() {
    let (_dir, room) = open("history_beyond");
    say(&room, 3, "m1", "text");
    let after = room.page_after(1, 1, 100).unwrap();
    assert!(after.messages.is_empty(), "nothing newer than the newest");
    assert!(after.has_older, "the whole transcript sits behind this page");
    assert!(!after.has_newer);
    let before_newest = room.page_before(1, 1, 100).unwrap();
    assert!(before_newest.messages.is_empty(), "nothing older than the oldest");
    let before_zero = room.page_before(1, 0, 100).unwrap();
    assert!(before_zero.messages.is_empty(), "below the floor, still an empty page");
    let past = room.page_before(1, u64::MAX, 100).unwrap();
    assert!(
        past.messages.is_empty() && !past.has_older && !past.has_newer,
        "a cursor far past the newest names a place the transcript never reached: \
         no page exists relative to it, not even the one behind"
    );
    // One past the newest is allowed: everything is older than that.
    let whole = room.page_before(1, 2, 100).unwrap();
    assert_eq!(whole.messages.iter().map(|m| m.seq).collect::<Vec<_>>(), vec![1]);
}

#[test]
fn pages_carry_what_the_protocol_promises_and_nothing_else() {
    let (_dir, room) = open("history_shape");
    let posted = say(&room, 3, "shape", "hello");
    let page = room.newest_page(1, 10).unwrap();
    assert_eq!(page.messages, vec![posted.clone()]);
    assert_eq!(page.messages[0].text, "hello");
    assert_eq!(page.messages[0].member, posted.member);
    assert_eq!(page.messages[0].time, posted.time);
    assert!(!page.messages[0].call_ai);
}

#[test]
fn a_members_history_begins_at_their_join() {
    let (_dir, room) = open("history_join");
    for n in 1..=3 {
        say(&room, 3, &format!("m{n}"), "before the join");
    }
    let member = phone(&room, 4);
    say(&room, 4, "late", "the first entry after joining");
    let join = room.join_of(member).unwrap();
    assert_eq!(join, 4, "the join point is the next seq at enrollment");
    assert_eq!(room.join_of(crate::MemberId::Host), None, "the host has no floor");

    let floor_of = |device: u32| room.member_of(device).unwrap();
    let seen = room
        .newest_page(room.join_of(floor_of(4)).unwrap(), 100)
        .unwrap();
    assert_eq!(
        seen.messages.iter().map(|m| m.seq).collect::<Vec<_>>(),
        vec![4],
        "nothing from before the join"
    );
    assert!(!seen.has_older, "no older page exists within this reader's view");

    let paged = room
        .page_before(room.join_of(floor_of(4)).unwrap(), join + 1, 1)
        .unwrap();
    assert_eq!(paged.messages.iter().map(|m| m.seq).collect::<Vec<_>>(), vec![4]);
    assert!(!paged.has_older, "the page at the floor is the first one");

    let caught_up = room
        .page_after(room.join_of(floor_of(4)).unwrap(), 0, 100)
        .unwrap();
    assert_eq!(
        caught_up.messages.iter().map(|m| m.seq).collect::<Vec<_>>(),
        vec![4],
        "a cursor below the join is raised to it"
    );

    let whole = room.newest_page(1, 100).unwrap();
    assert_eq!(whole.messages.len(), 4, "the whole transcript is the floor away");
}
