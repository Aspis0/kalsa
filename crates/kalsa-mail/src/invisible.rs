//! Characters that make the text a model reads differ from the text a person
//! reads: the tags block, the bidi controls, the soft hyphen, the zero-width
//! joiners, and every control character in between.

/// What a person cannot see and a model can.
fn is_invisible(c: char) -> bool {
    matches!(
        c,
        '\u{00ad}'
            | '\u{200b}'..='\u{200f}'
            | '\u{202a}'..='\u{202e}'
            | '\u{2060}'..='\u{2064}'
            | '\u{2066}'..='\u{2069}'
            | '\u{feff}'
            | '\u{e0000}'..='\u{e007f}'
    )
}

/// A control character ends a string for one reader and not for another, and a
/// tab is the one this server has a use for.
fn is_control(c: char) -> bool {
    c.is_control() && c != '\n' && c != '\t'
}

/// Every separator a reader might split a line on: a lone return, the vertical
/// separators, the Unicode breaks.
fn is_separator(c: char) -> bool {
    matches!(
        c,
        '\n' | '\r' | '\u{b}' | '\u{c}' | '\u{85}' | '\u{2028}' | '\u{2029}'
    )
}

pub(crate) fn any_invisible(text: &str) -> bool {
    text.chars().any(is_invisible)
}

/// Every separator becomes `\n` and nothing invisible or controlled survives. A
/// reader splits lines on the first character of the pair and shows the rest of
/// the line unprefixed, so the marker has to be the only thing on it.
pub(crate) fn normalise(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if is_separator(c) {
            out.push('\n');
        } else if !is_invisible(c) && !is_control(c) {
            out.push(c);
        }
    }
    out
}

/// A header value is one line however it arrived: folded, with a stray return,
/// or with a newline the sender chose. It is drawn in a card, so it stays one.
pub(crate) fn one_line(text: &str) -> String {
    normalise(text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_whole_invisible_alphabet_is_invisible() {
        for c in [
            '\u{00ad}',
            '\u{200b}',
            '\u{200f}',
            '\u{202a}',
            '\u{202e}',
            '\u{2060}',
            '\u{2064}',
            '\u{2066}',
            '\u{2069}',
            '\u{feff}',
            '\u{e0001}',
            '\u{e007f}',
        ] {
            assert!(is_invisible(c), "U+{:04X}", c as u32);
        }
        for c in ['a', ' ', '\n', '\t', 'à', '\u{200a}'] {
            assert!(!is_invisible(c), "U+{:04X}", c as u32);
        }
    }

    #[test]
    fn every_separator_becomes_a_newline_and_the_rest_goes() {
        assert_eq!(
            normalise("uno\rdue\u{2028}tre\u{85}quattro\u{b}cinque"),
            "uno\ndue\ntre\nquattro\ncinque"
        );
        assert_eq!(normalise("ciao\0 \u{7f}\u{1b} vao"), "ciao  vao");
    }

    #[test]
    fn a_header_value_is_one_line_however_it_arrived() {
        assert_eq!(one_line("Fattura\u{0}\r\n SEGRETO"), "Fattura SEGRETO");
        assert_eq!(one_line("a\r\nb\tc"), "a b c");
        assert_eq!(one_line("  vuoto  "), "vuoto");
    }
}
