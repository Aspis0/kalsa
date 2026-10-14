//! How deeply a mail nests, measured before it is parsed.
//!
//! The parser behind the scan is quadratic in nesting depth, so the guard has to
//! sit here rather than around the walk: by the time a document is a tree, the
//! work is already done. Four thousand nested elements cost 85 ms and sixteen
//! thousand cost 2.2 s, and the sender picks the number.

/// Deeper than any mail ever nests, and past the point where a renderer would
/// give up. Nothing in a real mail comes close; a person sees the card and
/// decides.
pub(crate) const MAX_DEPTH: usize = 256;

/// Whether this source looks nested deeper than the bound. An estimate, and
/// deliberately a cheap one: a real parse is the thing being guarded here, so
/// the guard cannot use one. It only has to be right about mails nobody sends,
/// where a `<` in a paragraph counts as an opening tag.
pub(crate) fn nests_deeper_than(html: &str, bound: usize) -> bool {
    let bytes = html.as_bytes();
    let mut depth = 0usize;
    let mut at = 0usize;
    while at < bytes.len() {
        if bytes[at] != b'<' {
            at += 1;
            continue;
        }
        match bytes.get(at + 1) {
            Some(b'/') => depth = depth.saturating_sub(1),
            Some(byte) if byte.is_ascii_alphabetic() => {
                depth += 1;
                if depth > bound {
                    return true;
                }
            }
            _ => {}
        }
        at += 1;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mail_nested_as_deep_as_a_renderer_follows_is_below_the_bound() {
        assert!(!nests_deeper_than(&"<div>".repeat(200), MAX_DEPTH));
        assert!(!nests_deeper_than("<p>Ciao</p>", MAX_DEPTH));
    }

    #[test]
    fn a_mail_nested_past_the_bound_is_above_it() {
        assert!(nests_deeper_than(&"<div>".repeat(MAX_DEPTH + 1), MAX_DEPTH));
        assert!(nests_deeper_than(
            &format!("{}{}", "<b>".repeat(40_000), "</b>".repeat(40_000)),
            MAX_DEPTH
        ));
    }

    #[test]
    fn the_estimate_does_not_run_off_the_end() {
        assert!(!nests_deeper_than("", MAX_DEPTH));
        assert!(!nests_deeper_than("<", MAX_DEPTH));
        assert!(!nests_deeper_than("</", MAX_DEPTH));
        assert!(!nests_deeper_than("<p", MAX_DEPTH));
        assert!(!nests_deeper_than("a < b < c", MAX_DEPTH));
    }
}
