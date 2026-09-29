//! The roster: enrollment, retirement, and the name rules.

use super::{open, phone, scratch, say};
use crate::{MemberId, NameError, Room, RoomError};

#[test]
fn a_device_gets_one_member_id_for_the_life_of_the_room() {
    let (dir, room) = open("members_stable_id");
    let first = phone(&room, 3);
    assert_eq!(room.enroll(3).expect("enroll is idempotent"), first);
    let other = phone(&room, 4);
    assert_ne!(first, other);
    drop(room);

    let reopened = Room::open(&dir).expect("the room opens again");
    assert_eq!(
        reopened.enroll(3).expect("the roster survived"),
        first,
        "a restart does not re-mint what the roster already holds"
    );
    assert_eq!(reopened.member_of(4), Some(other));
    assert_eq!(reopened.member_of(9), None, "a look is never a mint");
}

#[test]
fn a_forgotten_member_retires_and_a_returning_device_is_new() {
    let (dir, room) = open("members_retire");
    let member = phone(&room, 3);
    room.set_name(member, "Mamma").expect("the name sets");
    say(&room, 3, "m1", "words that stay");

    room.forget_device(3).expect("the device is forgotten");
    assert!(
        room.post(member, "m2", "refused", false).is_err(),
        "a retired member cannot post",
    );
    assert_eq!(
        room.name_of(member),
        Some("Mamma".to_string()),
        "the name stays for the history it explains"
    );
    assert_eq!(room.member_of(3), None);

    let again = room.enroll(3).expect("the device pairs again");
    assert_ne!(again, member, "a returning device id is a fresh member");
    assert_eq!(room.name_of(again), None, "and inherits no name");
    let page = room.newest_page(10).unwrap();
    assert_eq!(page.messages[0].member, member, "past entries keep their author");

    room.forget_device(9).expect("an unknown device is success");
    drop(room);
    let reopened = Room::open(&dir).expect("the retirement survived the restart");
    assert_eq!(reopened.member_of(3), Some(again));
}

#[test]
fn the_name_rule_is_trimmed_short_and_free_of_invisible_characters() {
    let (_dir, room) = open("members_name_rule");
    let member = phone(&room, 3);
    assert!(matches!(room.set_name(member, "   "), Err(NameError::Empty)));
    assert!(matches!(
        room.set_name(member, &"m".repeat(41)),
        Err(NameError::TooLong)
    ));
    // The invisible set: zero-width, bidi, byte-order marks, plain
    // controls. Any one of them hides inside a name.
    for hidden in [
        "\u{200B}Marco",
        "Marco\u{200F}",
        "Ma\u{202E}rco",
        "\u{2066}Marco",
        "\u{FEFF}Marco",
        "Ma\u{AD}rco",
        "ma\tco",
    ] {
        assert!(
            matches!(room.set_name(member, hidden), Err(NameError::Invisible)),
            "{hidden:?} must not be a name",
        );
    }
    assert!(room.set_name(member, &"m".repeat(40)).is_ok());
    // Multi-byte names are measured in bytes, as the protocol states.
    assert!(matches!(
        room.set_name(phone(&room, 4), &"é".repeat(21)),
        Err(NameError::TooLong)
    ));
}

#[test]
fn kalsa_is_reserved_in_every_casing() {
    let (_dir, room) = open("members_reserved");
    let member = phone(&room, 3);
    for taken in ["Kalsa", "kalsa", "KALSA", "  Kalsa  "] {
        assert!(
            matches!(room.set_name(member, taken), Err(NameError::Reserved)),
            "{taken:?} is the assistant's name",
        );
    }
    assert!(
        matches!(room.set_host_name("kalsa"), Err(NameError::Reserved)),
        "the host path obeys the same rule",
    );
}

#[test]
fn a_live_name_cannot_be_taken_and_case_does_not_dodge_it() {
    let (_dir, room) = open("members_taken");
    let first = phone(&room, 3);
    let second = phone(&room, 4);
    room.set_name(first, "Marco").expect("the name sets");
    assert!(
        matches!(room.set_name(second, "MARCO"), Err(NameError::Taken)),
        "uniqueness compares folded names"
    );
    assert!(matches!(room.set_name(second, "Marco"), Err(NameError::Taken)));
    room.set_name(second, "Luca").expect("another name is free");
    assert_eq!(
        room.set_name(first, "Marco").unwrap(),
        "Marco",
        "keeping one's own name is not taking it"
    );
}

#[test]
fn the_hosts_name_comes_from_the_host_path_alone() {
    let (_dir, room) = open("members_host_path");
    assert!(
        matches!(room.set_name(MemberId::Host, "Studio"), Err(NameError::NotAMember)),
        "the host is not a phone",
    );
    room.set_host_name("Studio").expect("the host path works");
    assert_eq!(room.name_of(MemberId::Host), Some("Studio".to_string()));
    assert!(
        matches!(room.set_name(phone(&room, 3), "Studio"), Err(NameError::Taken)),
        "a member cannot wear the host's name",
    );
    assert_eq!(room.name_of(MemberId::Ai), Some("Kalsa".to_string()));
}

#[test]
fn a_roster_that_names_a_reserved_id_refuses_the_room() {
    let dir = scratch("members_roster_reserved");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("room-roster.json"),
        r#"{"v":1,"next_member":2,"devices":{"3":1},"retired":[],"names":{"4294967295":"Hand"},"host_name":null}"#,
    )
    .unwrap();
    assert!(
        matches!(
            Room::open(&dir),
            Err(RoomError::Corrupt("a name is stored for a reserved member id"))
        ),
        "a reserved key is a hand edit claiming to name the host or the AI",
    );
}

#[test]
fn a_roster_name_the_store_would_refuse_refuses_the_room() {
    let dir = scratch("members_roster_name");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("room-roster.json"),
        r#"{"v":1,"next_member":2,"devices":{"3":1},"retired":[],"names":{"1":"Kalsa"},"host_name":null}"#,
    )
    .unwrap();
    assert!(matches!(
        Room::open(&dir),
        Err(RoomError::Corrupt("a stored name is not one the store would take"))
    ));
}

#[test]
fn a_corrupt_roster_refuses_the_room_and_touches_nothing() {
    let (dir, room) = open("members_roster_corrupt");
    room.enroll(3).expect("the roster exists");
    drop(room);
    std::fs::write(dir.join("room-roster.json"), b"{not json").unwrap();
    assert!(matches!(
        Room::open(&dir),
        Err(RoomError::Corrupt("roster file does not parse"))
    ));
    assert_eq!(
        std::fs::read(dir.join("room-roster.json")).unwrap(),
        b"{not json".to_vec(),
        "the corrupt bytes are the owner's to read, not the store's to rewrite"
    );
}
