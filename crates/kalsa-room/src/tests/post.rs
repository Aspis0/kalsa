//! Posting: what the store accepts, and the idempotency promise that lets a
//! phone retry forever.

use super::{member, open, say};
use crate::{MemberId, PostError};

#[test]
fn a_post_gets_the_next_seq_and_the_time_of_the_computer() {
    let (_dir, room) = open("post_seq");
    let first = say(&room, member(3), "one", "hello");
    let second = say(&room, member(4), "two", "hi back");
    assert_eq!(first.seq, 1);
    assert_eq!(second.seq, 2);
    assert!(first.time > 1_700_000_000, "the time is unix seconds, the computer's own");
}

#[test]
fn an_empty_or_oversized_text_is_refused_before_anything_is_stored() {
    let (_dir, room) = open("post_text");
    assert!(matches!(room.post(member(3), "a", "", false), Err(PostError::EmptyText)));
    assert!(matches!(
        room.post(member(3), "a", &"x".repeat(8001), false),
        Err(PostError::TextTooLong)
    ));
    assert!(room.post(member(3), "a", &"x".repeat(8000), false).is_ok());
}

#[test]
fn a_client_msg_id_must_be_short_ascii_graphic_characters() {
    let (_dir, room) = open("post_client_id");
    assert!(matches!(
        room.post(member(3), "", "text", false),
        Err(PostError::BadClientMsgId)
    ));
    assert!(matches!(
        room.post(member(3), &"a".repeat(65), "text", false),
        Err(PostError::BadClientMsgId)
    ));
    assert!(matches!(
        room.post(member(3), "has space", "text", false),
        Err(PostError::BadClientMsgId)
    ));
    assert!(matches!(
        room.post(member(3), "héllo", "text", false),
        Err(PostError::BadClientMsgId)
    ));
    assert!(room.post(member(3), "b3f1c2", "text", false).is_ok());
}

#[test]
fn the_same_member_and_client_msg_id_get_the_same_seq_and_no_second_entry() {
    let (_dir, room) = open("post_idempotent");
    let first = say(&room, member(3), "retry-me", "queued while the host slept");
    let replay = room
        .post(member(3), "retry-me", "queued while the host slept", false)
        .expect("the retry is answered");
    assert_eq!(replay, first, "the retry sees the stored message, not a new one");
    let again = room
        .post(member(3), "retry-me", "a DIFFERENT text", false)
        .expect("even a changed text cannot post twice on one id");
    assert_eq!(again.seq, first.seq);
    assert_eq!(room.page_before(u64::MAX, 100).len(), 1, "no duplicate landed");
}

#[test]
fn two_members_may_use_the_same_client_msg_id() {
    let (_dir, room) = open("post_ids_per_member");
    let one = say(&room, member(3), "same-id", "from the phone");
    let other = say(&room, member(4), "same-id", "from the other phone");
    assert_eq!(other.seq, one.seq + 1);
}

#[test]
fn the_host_and_the_ai_are_members_no_device_can_be() {
    let (_dir, room) = open("post_fixed_members");
    let host = say(&room, MemberId::HOST, "host-one", "from this computer");
    assert_eq!(host.member, MemberId::HOST);
    assert_ne!(MemberId::AI, MemberId::HOST);
    assert!(MemberId::HOST > member(3), "the fixed ids sit above the minted ones");
}

#[test]
fn the_call_ai_flag_travels_with_the_message() {
    let (_dir, room) = open("post_call_ai");
    let called = room
        .post(member(3), "calling", "@Kalsa what time is it?", true)
        .expect("the post lands");
    assert!(called.call_ai);
    let plain = say(&room, member(4), "not-calling", "as you were");
    assert!(!plain.call_ai);
}

#[test]
fn posting_wakes_a_waiter_holding_the_room_behind_an_arc() {
    let (_dir, room) = open("post_shared");
    let shared = std::sync::Arc::new(room);
    let writer = {
        let shared = shared.clone();
        std::thread::spawn(move || say(&shared, member(3), "woken", "from another thread"))
    };
    let written = writer.join().unwrap();
    assert_eq!(written.seq, 1);
}
