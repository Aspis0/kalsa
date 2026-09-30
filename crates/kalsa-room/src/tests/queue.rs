//! The call queue's own rules: one turn at a time, one pending call per
//! member, and the least-recently-served tie-break — the sentences of
//! HOUSEHOLD-RULES §5.2–5.3 as state transitions.

use super::{open, phone, say};
use crate::{CallRefused, CallTaken, Withdrawn};

#[test]
fn a_second_call_of_one_member_is_refused_and_a_retry_is_not() {
    let (_dir, room) = open("queue_second");
    let member = phone(&room, 3);
    assert_eq!(
        room.submit_call(member, "one"),
        Ok(CallTaken::Starts(1)),
        "an idle room starts the first call's turn"
    );
    assert_eq!(
        room.submit_call(member, "two"),
        Err(CallRefused::AlreadyPending),
        "one member, one pending call"
    );
    assert_eq!(
        room.submit_call(member, "one"),
        Ok(CallTaken::Queued),
        "the retry of the call being served is the answer, not a refusal"
    );
}

#[test]
fn arrival_order_wins_and_recency_only_breaks_a_same_instant_tie() {
    let (_dir, room) = open("queue_order");
    let a = phone(&room, 1);
    let b = phone(&room, 2);
    let c = phone(&room, 3);
    assert_eq!(room.submit_call(a, "a1"), Ok(CallTaken::Starts(1)));
    assert_eq!(room.submit_call(b, "b1"), Ok(CallTaken::Queued));
    assert_eq!(room.submit_call(c, "c1"), Ok(CallTaken::Queued));
    // Arrival order: B waited before C, so B is served before C.
    assert_eq!(room.end_turn(a), Some((b, 2)));
    assert_eq!(room.end_turn(b), Some((c, 3)));
    // A was served first and calls again BEFORE D ever does: A's call
    // arrived first, so A is next — being recently served does not move
    // anyone behind a later arrival. That is the owner's decision.
    let d = phone(&room, 4);
    assert_eq!(room.submit_call(a, "a2"), Ok(CallTaken::Queued));
    assert_eq!(room.submit_call(d, "d1"), Ok(CallTaken::Queued));
    assert_eq!(
        room.end_turn(c),
        Some((a, 4)),
        "the earlier arrival is served first"
    );
    assert_eq!(room.end_turn(a), Some((d, 5)));
    assert_eq!(room.end_turn(d), None, "an empty queue ends the driving");
}

#[test]
fn a_member_withdraws_their_own_call_and_nothing_else() {
    let (_dir, room) = open("queue_withdraw");
    let a = phone(&room, 1);
    let b = phone(&room, 2);
    assert_eq!(room.submit_call(a, "a1"), Ok(CallTaken::Starts(1)));
    assert_eq!(room.submit_call(b, "b1"), Ok(CallTaken::Queued));
    // C holds nothing and cannot withdraw A's running turn.
    let c = phone(&room, 3);
    assert_eq!(room.withdraw_call(c), Withdrawn::Nothing);
    // B withdraws their own pending call; A withdraws their own turn.
    assert_eq!(room.withdraw_call(b), Withdrawn::Pending);
    assert_eq!(room.withdraw_call(a), Withdrawn::Running(1));
    assert_eq!(room.end_turn(a), None);
}

#[test]
fn the_owners_stop_ends_any_turn_and_the_queue_keeps_its_place() {
    let (_dir, room) = open("queue_host_stop");
    let cursor = room.next_cursor();
    assert!(!room.host_stop_turn(), "nothing was running to stop");
    assert_eq!(
        room.next_cursor(),
        cursor,
        "an empty stop publishes nothing"
    );
    let a = phone(&room, 1);
    let b = phone(&room, 2);
    assert_eq!(room.submit_call(a, "a1"), Ok(CallTaken::Starts(1)));
    assert_eq!(room.submit_call(b, "b1"), Ok(CallTaken::Queued));
    assert!(room.host_stop_turn(), "the running turn stopped");
    assert!(!room.turn_alive(1), "the owner stopped A's turn");
    // The driver's end tick still hands B the next turn.
    assert_eq!(room.end_turn(a), Some((b, 2)));
}

#[test]
fn the_running_turn_is_marked_and_reported() {
    let (_dir, room) = open("queue_state");
    let a = phone(&room, 1);
    assert_eq!(room.submit_call(a, "a1"), Ok(CallTaken::Starts(1)));
    let state = room.turn_state();
    assert_eq!(state.state, "thinking");
    assert_eq!(state.running, Some(a));
    room.mark_turn(1, true);
    assert_eq!(room.turn_state().state, "answering");
    room.end_turn(a);
    assert_eq!(room.turn_state().state, "idle");
}

#[test]
fn the_ai_reads_the_whole_room_and_lands_its_read_count() {
    let (dir, room) = open("queue_ai_entry");
    for n in 1..=3 {
        say(&room, 1, &format!("m{n}"), "words");
    }
    let landed = room.post_ai("It is 17:00.", 3).expect("the answer lands");
    assert_eq!(landed.read, 3);
    assert_eq!(
        room.entries_for_ai().len(),
        4,
        "the AI's view has no member's floor"
    );
    drop(room);
    let reopened = super::reopen(&dir).expect("the room opens again");
    assert_eq!(
        reopened.entries_for_ai()[3].read,
        3,
        "the read count is part of the entry"
    );
}
