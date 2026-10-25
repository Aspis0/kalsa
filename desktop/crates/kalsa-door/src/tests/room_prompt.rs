//! The Room's system prompt in its two variants: the vision clause follows the
//! engine, and the app sentences hold in both. The Room has no Think switch,
//! so neither variant may name one.

use crate::room::turn::room_system_prompt;

#[test]
fn a_seeing_engine_is_told_pictures_reach_it() {
    let prompt = room_system_prompt(true);
    assert!(prompt.contains("reach you as images"), "{prompt}");
    assert!(!prompt.contains("You cannot see pictures"), "{prompt}");
}

#[test]
fn a_blind_engine_is_told_it_cannot_see_pictures() {
    let prompt = room_system_prompt(false);
    assert!(
        prompt.contains("You cannot see pictures or video"),
        "{prompt}"
    );
    assert!(!prompt.contains("reach you as images"), "{prompt}");
}

#[test]
fn both_variants_carry_the_app_and_no_think_switch() {
    for vision in [true, false] {
        let prompt = room_system_prompt(vision);
        assert!(
            prompt.starts_with("You are Kalsa, a guest in this family's room"),
            "{prompt}"
        );
        assert!(prompt.contains("by writing @Kalsa"), "{prompt}");
        assert!(
            prompt.contains("A paperclip attaches pictures and videos"),
            "{prompt}"
        );
        assert!(
            prompt.contains("Phones paired to this computer join the room"),
            "{prompt}"
        );
        assert!(!prompt.contains("Think"), "{prompt}");
    }
}
