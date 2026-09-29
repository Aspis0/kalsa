//! The name rules: what a display name must pass, and the folded form
//! names are compared by. One rule, shared by the setter and the loader —
//! a name the store refuses to take is also a name it refuses to read
//! back, so a hand edit cannot put past the store what the store refuses
//! from a member.

use crate::roster::AI_NAME;

/// The most a display name may be, after trimming.
const MAX_NAME_BYTES: usize = 40;

/// Why a name was refused. The words below are all a client sees; the io
/// error stays in the value for the app's local log, where paths belong.
#[derive(Debug)]
pub enum NameError {
    Empty,
    TooLong,
    /// A control, format, bidi or zero-width character — anything that
    /// renders as nothing and can make two different names look alike.
    Invisible,
    /// Latin letters mixed with Cyrillic or Greek ones — the mix that
    /// makes convincing lookalikes ("Kalsа" with a Cyrillic а). A name in
    /// one script, whatever script, is fine.
    MixedScripts,
    /// "Kalsa" in any casing, spacing or fullwidth dress: the AI's name is
    /// not takeable.
    Reserved,
    Taken,
    NotAMember,
    Io(std::io::Error),
}

impl std::fmt::Display for NameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => f.write_str("a name cannot be empty"),
            Self::TooLong => f.write_str("the name is too long"),
            Self::Invisible => {
                f.write_str("a name cannot hold invisible characters")
            }
            Self::MixedScripts => {
                f.write_str("a name cannot mix Latin with Cyrillic or Greek letters")
            }
            Self::Reserved => f.write_str("that name belongs to the assistant"),
            Self::Taken => f.write_str("someone in this room already wears that name"),
            Self::NotAMember => f.write_str("that member is not in this room"),
            Self::Io(_) => f.write_str("the room's store failed on disk"),
        }
    }
}

/// The one name rule, shared by the setter and the loader: trimmed, some
/// text, short enough in bytes, nothing invisible, no script mixing.
/// Comparison happens on [`fold`]ings, so "MARCO" does not dodge "Marco";
/// two names that differ only in Unicode composition (é as one character
/// or as two) are different names in v1 — an honest limit, stated in the
/// protocol.
pub fn valid(name: &str) -> Result<String, NameError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(NameError::Empty);
    }
    if name.len() > MAX_NAME_BYTES {
        return Err(NameError::TooLong);
    }
    if name.chars().any(is_invisible) {
        return Err(NameError::Invisible);
    }
    if mixes_scripts(name) {
        return Err(NameError::MixedScripts);
    }
    Ok(name.to_string())
}

/// The folded form compared for uniqueness: fullwidth characters mapped to
/// their ASCII twins, the Cyrillic and Greek letters below mapped to the
/// Latin letters a hand spelling a Latin word means by them, every Unicode
/// space as one plain space with runs collapsed, trimmed, then lowercased
/// by Unicode's own simple lowercasing. No composition normalization is
/// applied — std has none, and pulling a crate for it buys little a
/// household name needs.
pub(crate) fn fold(name: &str) -> String {
    let mut folded = String::with_capacity(name.len());
    let mut pending_space = false;
    for c in name.chars() {
        let lower: Vec<char> = fullwidth_to_ascii(c).to_lowercase().collect();
        let lower = lower.as_slice();
        if is_space_separator(lower[0]) {
            if !folded.is_empty() {
                pending_space = true;
            }
            continue;
        }
        if pending_space {
            folded.push(' ');
            pending_space = false;
        }
        match lookalike_to_latin(lower[0]) {
            Some(latin) => folded.push(latin),
            None => folded.extend(lower.iter().copied()),
        }
    }
    folded
}

/// The Cyrillic and Greek letters that carry one Latin letter when a hand
/// types a Latin word on that keyboard — so an all-Cyrillic "Калса" folds
/// to "kalsa" and is refused like every other spelling of the assistant's
/// name. The map follows what the key MEANS (с is s, р is r), not the
/// nearest glyph, because the name being smuggled past the comparison is
/// typed, not drawn. Hand-listed, and honest about being the common
/// letters, not a transliterator.
fn lookalike_to_latin(c: char) -> Option<char> {
    Some(match c {
        'а' => 'a', 'е' => 'e', 'о' => 'o', 'р' => 'r', 'с' => 's',
        'у' => 'u', 'х' => 'h', 'к' => 'k', 'м' => 'm', 'т' => 't',
        'н' => 'n', 'в' => 'v', 'л' => 'l',
        'α' => 'a', 'ο' => 'o', 'κ' => 'k', 'ν' => 'n', 'ρ' => 'r',
        'τ' => 't', 'ι' => 'i', 'υ' => 'u', 'ε' => 'e', 'λ' => 'l',
        'σ' => 's',
        _ => return None,
    })
}

/// The reserved-name comparison: spaces removed entirely, so "K alsa" and
/// "Kal\u{2003}sa" are the assistant's name too. Uniqueness does NOT go
/// this far — "Mar co" and "Marco" stay two names.
pub(crate) fn is_reserved(name: &str) -> bool {
    fold(name).replace(' ', "") == fold(AI_NAME).replace(' ', "")
}

fn fullwidth_to_ascii(c: char) -> char {
    match c as u32 {
        code @ 0xFF01..=0xFF5E => char::from_u32(code - 0xFEE0).unwrap_or(c),
        _ => c,
    }
}

/// Every Unicode space separator (Zs), plus the plain space. Each counts
/// as one space, runs collapse in [`fold`].
fn is_space_separator(c: char) -> bool {
    matches!(c as u32, 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x202F | 0x205F | 0x3000)
}

/// The scripts one name must not mix: Latin with Cyrillic or Greek — the
/// pairs whose letters look alike. Detected with hand-listed ranges
/// because std has no script API; these are the COMMON lookalikes, not a
/// claim about every script pair.
fn mixes_scripts(name: &str) -> bool {
    let latin = name.chars().any(is_latin);
    let other = name.chars().any(|c| is_cyrillic(c) || is_greek(c));
    latin && other
}

fn is_latin(c: char) -> bool {
    c.is_ascii_alphabetic()
        || matches!(c as u32, 0xC0..=0x24F if !matches!(c as u32, 0xD7 | 0xF7))
}

fn is_cyrillic(c: char) -> bool {
    matches!(c as u32, 0x0400..=0x052F)
}

fn is_greek(c: char) -> bool {
    matches!(c as u32, 0x0370..=0x03FF | 0x1F00..=0x1FFF)
}

fn is_invisible(c: char) -> bool {
    c.is_control() || is_format_mark(c)
}

/// std has no general-category API, so the format ranges a name can hide
/// in are listed by hand: the zero-width and bidi controls (Cf) that make
/// two different strings render as one, and their neighbours that exist
/// only to steer rendering. These are the ranges that matter in a name;
/// the list is stated as the store's own rule, not as Unicode's entirety.
fn is_format_mark(c: char) -> bool {
    matches!(c as u32,
        0x00AD
        | 0x0600..=0x0605
        | 0x061C
        | 0x070F
        | 0x08E2
        | 0x180E
        | 0x200B..=0x200F
        | 0x202A..=0x202E
        | 0x2060..=0x2064
        | 0x2066..=0x2069
        | 0xFEFF
        | 0xFFF9..=0xFFFB
        | 0x110BD
        | 0x110CD
        | 0x13430..=0x1343F
        | 0x1BCA0..=0x1BCA3
        | 0x1D173..=0x1D17A
        | 0xE0001
        | 0xE0020..=0xE007F)
}
