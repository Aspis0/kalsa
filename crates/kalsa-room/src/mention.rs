//! The one rule for calling the AI by name, exactly as the protocol states
//! it. The door composes this with the explicit flag when a message is
//! posted; the store only carries the verdict.

/// Whether `text` calls the AI: the six-character token `@Kalsa`, matched
/// ASCII-case-insensitively, standing at a word boundary — the character
/// before the `@` (if any) not alphanumeric in Unicode terms, and the
/// character after the final `a` (if any) neither alphanumeric in Unicode
/// terms nor an underscore. So "email@kalsa.io" and "café@Kalsa" are
/// addresses, and "@Kalsabot" is somebody else.
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
        let before_ok = start == 0 || !chars[start - 1].is_alphanumeric();
        let after_ok = chars
            .get(end)
            .is_none_or(|c| !c.is_alphanumeric() && *c != '_');
        before_ok && after_ok
    })
}
