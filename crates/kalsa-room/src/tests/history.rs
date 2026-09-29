//! History pages: the two cursors, the limit, and what a page beyond
//! either end answers.

use super::{member, open, say};

#[test]
fn a_transcript_numbers_itself_from_one_with_no_gaps() {
    let (_dir, room) = open("history_numbering");
    for n in 1..=5 {
        let message = say(&room, member(3), &format!("m{n}"), "text");
        assert_eq!(message.seq, n);
    }
}

#[test]
fn page_after_hands_out_what_is_newer_oldest_first() {
    let (_dir, room) = open("history_after");
    for n in 1..=5 {
        say(&room, member(3), &format!("m{n}"), "text");
    }
    let page = room.page_after(2, 100);
    assert_eq!(page.len(), 3);
    assert_eq!(page[0].seq, 3);
    assert_eq!(page[2].seq, 5);
}

#[test]
fn page_before_hands_out_the_nearest_older_page_oldest_first() {
    let (_dir, room) = open("history_before");
    for n in 1..=10 {
        say(&room, member(3), &format!("m{n}"), "text");
    }
    let page = room.page_before(8, 3);
    assert_eq!(page.len(), 3);
    assert_eq!(page[0].seq, 5, "the page nearest the cursor, not the transcript's head");
    assert_eq!(page[2].seq, 7);
}

#[test]
fn the_whole_transcript_is_the_page_before_nothing_excluded() {
    let (_dir, room) = open("history_latest");
    for n in 1..=4 {
        say(&room, member(3), &format!("m{n}"), "text");
    }
    let page = room.page_before(u64::MAX, 100);
    assert_eq!(page.iter().map(|m| m.seq).collect::<Vec<_>>(), vec![1, 2, 3, 4]);
}

#[test]
fn a_limit_trims_each_cursor_from_its_own_end() {
    let (_dir, room) = open("history_limit");
    for n in 1..=6 {
        say(&room, member(3), &format!("m{n}"), "text");
    }
    assert_eq!(room.page_after(0, 2).iter().map(|m| m.seq).collect::<Vec<_>>(), vec![1, 2]);
    assert_eq!(room.page_before(u64::MAX, 2).iter().map(|m| m.seq).collect::<Vec<_>>(), vec![5, 6]);
    // A limit of zero is an empty page, not an error: the route's rule, kept.
    assert!(room.page_after(0, 0).is_empty());
}

#[test]
fn a_cursor_beyond_the_end_is_an_empty_page_not_an_error() {
    let (_dir, room) = open("history_beyond");
    say(&room, member(3), "m1", "text");
    assert!(room.page_after(1, 100).is_empty(), "nothing newer than the newest");
    assert!(room.page_before(1, 100).is_empty(), "nothing older than the oldest");
}

#[test]
fn pages_carry_what_the_protocol_promises() {
    let (_dir, room) = open("history_shape");
    let posted = say(&room, member(3), "shape", "hello");
    let page = room.page_before(u64::MAX, 10);
    assert_eq!(page.len(), 1);
    assert_eq!(page[0], posted);
    assert_eq!(page[0].client_msg_id, "shape");
    assert_eq!(page[0].text, "hello");
}
