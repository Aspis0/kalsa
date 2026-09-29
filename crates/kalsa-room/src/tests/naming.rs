//! Display names: the rule, the persistence, the independence per member.

use super::{member, open};
use crate::{MemberId, NameError};

#[test]
fn a_set_name_answers_the_trimmed_name_and_keeps_it_across_a_restart() {
    let (dir, room) = open("naming_set");
    let set = room.set_name(member(3), "  Marco  ").expect("the name sets");
    assert_eq!(set, "Marco");
    drop(room);

    let reopened = crate::Room::open(&dir).expect("the room opens again");
    assert_eq!(reopened.name_of(member(3)), Some("Marco".to_string()));
}

#[test]
fn a_member_who_never_set_a_name_has_none_here() {
    let (_dir, room) = open("naming_default");
    assert_eq!(room.name_of(member(3)), None, "the device label is the pairing store's business");
    assert_eq!(room.name_of(MemberId::HOST), None);
}

#[test]
fn the_name_rule_is_trimmed_short_and_control_free() {
    let (_dir, room) = open("naming_rule");
    assert!(matches!(room.set_name(member(3), "   "), Err(NameError::Empty)));
    assert!(matches!(
        room.set_name(member(3), &"m".repeat(41)),
        Err(NameError::TooLong)
    ));
    assert!(matches!(
        room.set_name(member(3), "ma\rco"),
        Err(NameError::ControlCharacter)
    ));
    assert!(room.set_name(member(3), &"m".repeat(40)).is_ok());
    // Multi-byte names are measured in bytes, as the protocol states.
    assert!(matches!(
        room.set_name(member(4), &"é".repeat(21)),
        Err(NameError::TooLong)
    ));
}

#[test]
fn setting_the_same_name_again_writes_a_valid_file_and_keeps_others() {
    let (dir, room) = open("naming_idempotent");
    room.set_name(member(3), "Marco").expect("the first set");
    room.set_name(member(4), "Luca").expect("the second set");
    room.set_name(member(3), "Marco").expect("the same name again");
    assert_eq!(room.name_of(member(3)), Some("Marco".to_string()));
    assert_eq!(room.name_of(member(4)), Some("Luca".to_string()));

    let bytes = std::fs::read(dir.join("room-names.json")).unwrap();
    let document: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(document["v"], 1);
    assert_eq!(document["names"]["3"], "Marco");
    assert_eq!(document["names"]["4"], "Luca");
}

#[test]
fn a_hand_edited_names_file_is_refused_not_repaired() {
    let (dir, _room) = open("naming_corrupt");
    std::fs::write(
        dir.join("room-names.json"),
        format!(r#"{{"v":1,"names":{{"3":"{}"}}}}"#, "x".repeat(41)),
    )
    .unwrap();
    assert!(matches!(
        crate::Room::open(&dir),
        Err(crate::RoomError::Corrupt("a stored display name is invalid"))
    ));
}
