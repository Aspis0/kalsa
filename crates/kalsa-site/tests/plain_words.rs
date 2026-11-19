mod common;

use kalsa_site::catalog;

use common::{attribute_text, generated, html, visible};

const FORBIDDEN: [&str; 14] = [
    "seamless", "robust", "powerful", "leverage", "unlock", "empower", "journey", "dive into", "cutting-edge", "blazing", "game-changer",
    "effortless", "on this site", "this site",
];

/// Lower-case words with every non-alphanumeric run (a hyphen included) collapsed to one space, so a phrase matches whole words only.
fn normalized(text: &str) -> String {
    let words: Vec<String> = text.split(|c: char| !c.is_alphanumeric()).filter(|word| !word.is_empty()).map(str::to_lowercase).collect();
    format!(" {} ", words.join(" "))
}

fn hits(text: &str) -> Vec<&'static str> {
    let words = normalized(text);
    FORBIDDEN.into_iter().filter(|phrase| words.contains(&format!(" {} ", normalized(phrase).trim()))).collect()
}

#[test]
fn the_matcher_finds_whole_words_and_phrases_in_any_case() {
    assert_eq!(hits("A Robust, seamless tool"), ["seamless", "robust"]);
    assert_eq!(hits("Cutting-edge and game-changer."), ["cutting-edge", "game-changer"]);
    assert_eq!(hits("Dive INTO it on this site"), ["dive into", "on this site", "this site"]);
    assert!(hits("A journeyman unlocked leveraged powerfully").is_empty(), "only whole words count");
}

#[test]
fn no_page_uses_a_marketing_word() {
    for (page, text) in html(&generated()) {
        assert!(hits(&visible(text)).is_empty(), "{page:?} uses {:?}", hits(&visible(text)));
        assert!(hits(&attribute_text(text)).is_empty(), "{page:?} uses {:?} in its title, description or attributes", hits(&attribute_text(text)));
    }
}

#[test]
fn no_engine_summary_uses_a_marketing_word() {
    for engine in &catalog().engine {
        assert!(hits(&engine.summary).is_empty(), "{} uses {:?}", engine.id, hits(&engine.summary));
    }
}

#[test]
fn every_summary_is_one_plain_sentence_of_about_twenty_words() {
    for engine in &catalog().engine {
        let words = engine.summary.split_whitespace().count();
        assert!((4..=22).contains(&words), "{} has {words} words", engine.id);
        assert!(engine.summary.ends_with('.') && !engine.summary[..engine.summary.len() - 1].contains(". "), "{} is not one sentence", engine.id);
    }
}
