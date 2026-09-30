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
        "@Kalsabot",
        "@kalsa2",
        "@Kalsa_x",
        "marco@Kalsa",
    ] {
        assert!(!calls_ai(text), "{text:?} is an address or another name");
    }
}

#[test]
fn combining_marks_belong_to_the_word_in_either_spelling() {
    // NFC é is one character; NFD is e + U+0301. Both are an accented café
    // in front of the @, and the rule must read them the same way.
    assert!(!calls_ai("caf\u{e9}@Kalsa"), "NFC café is an address");
    assert!(
        !calls_ai("cafe\u{0301}@Kalsa"),
        "NFD café is an address too"
    );
    assert!(
        calls_ai("caf\u{e9} @Kalsa"),
        "a space still separates the word"
    );
    // A mark right after the word is part of it: @Kalsa-acute is not the
    // assistant's name, whatever follows the marks.
    assert!(!calls_ai("@Kalsa\u{0301}"));
    assert!(!calls_ai("@Kalsa\u{0301}\u{0301}'s brother aside, hi"));
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

#[test]
fn cjk_boundaries_call_without_splitting_latin_words() {
    for text in ["请问@Kalsa", "@Kalsa你好", "你好，@Kalsa"] {
        assert!(calls_ai(text), "{text:?} calls");
    }
    for text in [
        "marco@kalsa.io",
        "josé@Kalsa",
        "１@Kalsa",
        "caf\u{e9}@Kalsa",
        "cafe\u{0301}@Kalsa",
        "@Kalsabot",
        "@Kalsa\u{0301}",
    ] {
        assert!(!calls_ai(text), "{text:?} does not call");
    }
}
