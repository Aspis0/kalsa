//! The "@Kalsa" matcher, on the exact rule the protocol states.

use crate::calls_ai;

#[test]
fn the_bounded_token_calls() {
    for text in [
        "@Kalsa",
        "@kalsa, ciao",
        "(@Kalsa)",
        "@Kalsa's",
        "say @kalsa?",
        "  @KALSA  ",
        "@KalsA",
        "one @Kalsa two",
    ] {
        assert!(calls_ai(text), "{text:?} calls");
    }
}

#[test]
fn an_alphanumeric_neighbour_makes_it_not_a_call() {
    for text in [
        "email@kalsa.io",
        "josé2@Kalsa",
        "café@Kalsa",
        "@Kalsabot",
        "@kalsa2",
        "@Kalsa_x",
        "marco@Kalsa",
    ] {
        assert!(!calls_ai(text), "{text:?} is an address or another name");
    }
}

#[test]
fn the_word_alone_is_not_a_call() {
    for text in ["Kalsa", "kalsa", "KALSA", "@", "@Kals", "@ kal sa"] {
        assert!(!calls_ai(text), "{text:?} is not the token");
    }
}

#[test]
fn the_boundaries_are_unicode_aware_on_both_sides() {
    // A letter before the @ in Unicode terms blocks the call...
    assert!(!calls_ai("café@Kalsa"));
    // ...and so does a digit, while punctuation does not.
    assert!(!calls_ai("josé2@Kalsa"));
    assert!(calls_ai("¡@Kalsa!"));
    // The stated rule: '_' before the @ is not alphanumeric, so it is a
    // boundary; '_' after the word is a word character, so it is not.
    assert!(calls_ai("_@Kalsa"));
    assert!(!calls_ai("@Kalsa_"));
}
