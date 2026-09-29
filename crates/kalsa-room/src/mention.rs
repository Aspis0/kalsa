//! The one rule for calling the AI by name, exactly as the protocol states
//! it. The door composes this with the explicit flag when a message is
//! posted; the store only carries the verdict.

/// Whether `text` calls the AI: the six-character token `@Kalsa`, matched
/// ASCII-case-insensitively, standing at a word boundary — the base
/// character before the `@` (skipping back over combining marks, which
/// belong to the word they decorate) not alphanumeric in Unicode terms,
/// and the character after the final `a` neither alphanumeric, nor an
/// underscore, nor a combining mark. So "email@kalsa.io" is an address,
/// "café@Kalsa" is one in every spelling of é (NFC and NFD alike, because
/// the mark before the @ is skipped to its base), and "@Kalsabot" and
/// "@Kalsa\u{0301}" are somebody else.
/// The combining marks (Unicode category M) a household keyboard
/// produces, hand-listed because std has no category API: the ranges
/// cover the common diacriticals of Latin, Cyrillic, Hebrew, Arabic,
/// Devanagari and Thai, plus the variation selectors. A mark outside the
/// list would leave the token's boundary alone — stated, not hidden.
fn is_mark(c: char) -> bool {
    matches!(c as u32,
        0x0300..=0x036F | 0x0483..=0x0489 | 0x0591..=0x05C7 | 0x0610..=0x061A
        | 0x064B..=0x065F | 0x0670 | 0x06D6..=0x06DC | 0x0730..=0x074A
        | 0x07A6..=0x07B0 | 0x0900..=0x0903 | 0x093A..=0x094F | 0x0951..=0x0957
        | 0x0E31 | 0x0E34..=0x0E3A | 0x0E47..=0x0E4E | 0x1AB0..=0x1AFF
        | 0x1DC0..=0x1DFF | 0x20D0..=0x20F0 | 0xFE00..=0xFE0F | 0xFE20..=0xFE2F)
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
        let before_ok = before == 0 || !chars[before - 1].is_alphanumeric();
        let after_ok = chars.get(end).is_none_or(|c| !c.is_alphanumeric() && *c != '_');
        let after_ok = after_ok && chars.get(end).is_none_or(|c| !is_mark(*c));
        before_ok && after_ok
    })
}
