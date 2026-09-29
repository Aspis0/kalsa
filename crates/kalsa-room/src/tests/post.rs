//! Posting: what the store accepts, the idempotency promise that lets a
//! phone retry forever, and the refusal that keeps one id meaning one
//! message.

use super::{open, phone, say};
use crate::{MemberId, PostError};

#[test]
fn a_post_gets_the_next_seq_and_the_time_of_the_computer() {
    let (_dir, room) = open("post_seq");
    let first = say(&room, 3, "one", "hello");
    let second = say(&room, 4, "two", "hi back");
    assert_eq!(first.seq, 1);
    assert_eq!(second.seq, 2);
    assert!(
        first.time > 1_700_000_000,
        "unix seconds, the computer's own clock"
    );
}

#[test]
fn an_empty_or_oversized_text_is_refused_before_anything_is_stored() {
    let (_dir, room) = open("post_text");
    assert!(matches!(
        room.post(phone(&room, 3), "a", "", false),
        Err(PostError::EmptyText)
    ));
    assert!(matches!(
        room.post(phone(&room, 3), "a", &"x".repeat(8001), false),
        Err(PostError::TextTooLong)
    ));
    assert!(room.post(phone(&room, 3), "a", &"x".repeat(8000), false).is_ok());
}

#[test]
fn a_client_msg_id_must_be_short_ascii_graphic_characters() {
    let (_dir, room) = open("post_client_id");
    let member = phone(&room, 3);
    assert!(matches!(
        room.post(member, "", "text", false),
        Err(PostError::BadClientMsgId)
    ));
    assert!(matches!(
        room.post(member, &"a".repeat(65), "text", false),
        Err(PostError::BadClientMsgId)
    ));
    assert!(matches!(
        room.post(member, "has space", "text", false),
        Err(PostError::BadClientMsgId)
    ));
    assert!(matches!(
        room.post(member, "héllo", "text", false),
        Err(PostError::BadClientMsgId)
    ));
    assert!(room.post(member, "b3f1c2", "text", false).is_ok());
}

#[test]
fn the_same_id_and_content_replay_the_same_entry_with_no_second_post() {
    let (_dir, room) = open("post_idempotent");
    let first = say(&room, 3, "retry-me", "queued while the host slept");
    let replay = room
        .post(
            phone(&room, 3),
            "retry-me",
            "queued while the host slept",
            false,
        )
        .expect("the retry is answered");
    assert_eq!(replay, first, "the retry sees the stored entry, not a new one");
    assert_eq!(
        room.page_before(u64::MAX, 100).unwrap().messages.len(),
        1,
        "no duplicate landed"
    );
}

#[test]
fn the_same_id_with_different_text_or_flag_is_refused() {
    let (_dir, room) = open("post_reused_id");
    let member = phone(&room, 3);
    say(&room, 3, "one-id", "the first words");
    assert!(
        matches!(room.post(member, "one-id", "different words", false), Err(PostError::ClientIdReused)),
        "one id, one message: different text is a disagreement, not a retry"
    );
    assert!(
        matches!(room.post(member, "one-id", "the first words", true), Err(PostError::ClientIdReused)),
        "a different flag is a different message too"
    );
    assert_eq!(
        room.page_before(u64::MAX, 100).unwrap().messages.len(),
        1,
        "the refusal stored nothing"
    );
}

#[test]
fn two_members_may_use_the_same_client_msg_id() {
    let (_dir, room) = open("post_ids_per_member");
    let one = say(&room, 3, "same-id", "from the phone");
    let other = say(&room, 4, "same-id", "from the other phone");
    assert_eq!(other.seq, one.seq + 1);
}

#[test]
fn the_call_ai_flag_the_caller_computed_travels_with_the_entry() {
    let (_dir, room) = open("post_call_ai");
    let called = room
        .post(phone(&room, 3), "calling", "@Kalsa what time is it?", true)
        .expect("the post lands");
    assert!(called.call_ai, "the flag is the caller's verdict, stored as given");
    let plain = say(&room, 4, "not-calling", "as you were");
    assert!(!plain.call_ai);
}

#[test]
fn a_member_nobody_enrolled_and_the_ai_cannot_post_here() {
    let (_dir, room) = open("post_membership");
    assert!(matches!(
        room.post(MemberId::Member(999), "x", "text", false),
        Err(PostError::NotAMember)
    ));
    assert!(
        matches!(room.post(MemberId::Ai, "x", "text", false), Err(PostError::NotAMember)),
        "the AI speaks through post_ai, never as a member"
    );
    let host = room
        .post(MemberId::Host, "host-one", "from this computer", false)
        .expect("the host is always a member");
    assert_eq!(host.member, MemberId::Host);
}

#[test]
fn the_ai_entry_takes_the_next_seq_without_an_idempotency_key() {
    let (_dir, room) = open("post_ai_entry");
    say(&room, 3, "m1", "the question");
    let answer = room.post_ai("It is 17:00.").expect("the answer lands");
    assert_eq!(answer.seq, 2);
    assert_eq!(answer.member, MemberId::Ai);
    assert!(answer.call_ai, "an answer belongs to a called turn");
    let again = room.post_ai("And now it is 17:01.").expect("no key to collide with");
    assert_eq!(again.seq, 3, "every AI entry is its own entry");
    let page = room.page_before(u64::MAX, 100).unwrap();
    assert_eq!(page.messages.len(), 3);
}
