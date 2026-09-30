//! The one rule for calling the AI by name, exactly as the protocol states
//! it. The door composes this with the explicit flag when a message is
//! posted; the store only carries the verdict.

use unicode_properties::{GeneralCategory, GeneralCategoryGroup, UnicodeGeneralCategory};

/// Whether `text` calls the AI: the six-character token `@Kalsa`, matched
/// ASCII-case-insensitively, standing at a word boundary — Latin, Greek,
/// Cyrillic letters and digits before `@` block it (after skipping marks
/// back to their base); those letters, digits, `_` and marks after `Kalsa`
/// block it. So "email@kalsa.io" is an address,
/// "café@Kalsa" is one in every spelling of é (NFC and NFD alike, because
/// the mark before the @ is skipped to its base), and "@Kalsabot" and
/// "@Kalsa\u{0301}" are somebody else.
fn is_mark(c: char) -> bool {
    c.general_category_group() == GeneralCategoryGroup::Mark
}

pub fn calls_ai(text: &str) -> bool {
    const WORD: [char; 5] = ['k', 'a', 'l', 's', 'a'];
    let chars: Vec<char> = text.chars().collect();
    (0..chars.len()).any(|start| {
        let end = start + 6;
        if end > chars.len() || chars[start] != '@' {
            return false;
        }
        if chars[start + 1..end]
            .iter()
            .zip(WORD)
            .any(|(c, letter)| c.to_ascii_lowercase() != letter)
        {
            return false;
        }
        // Marks bind to the base they follow: walk past them to the
        // character the boundary rule is actually about.
        let mut before = start;
        while before > 0 && is_mark(chars[before - 1]) {
            before -= 1;
        }
        let before_ok = before == 0 || !blocks_before(chars[before - 1]);
        let after_ok = chars.get(end).is_none_or(|c| !blocks_after(*c));
        let after_ok = after_ok && chars.get(end).is_none_or(|c| !is_mark(*c));
        before_ok && after_ok
    })
}

fn blocks_before(c: char) -> bool {
    is_script_letter(c) || is_digit(c)
}

fn blocks_after(c: char) -> bool {
    is_script_letter(c) || is_digit(c) || c == '_' || is_mark(c)
}

fn is_digit(c: char) -> bool {
    c.general_category() == GeneralCategory::DecimalNumber
}

fn is_script_letter(c: char) -> bool {
    c.is_alphabetic()
        && (crate::names::is_latin(c) || crate::names::is_greek(c) || crate::names::is_cyrillic(c))
}
