//! Hidden text: an element styled to be invisible that still carries text, or a
//! character a person cannot see. The tag block and the bidi controls count too: they
//! are how a mail speaks to the model without speaking to the person. Hidden text is how an attacker speaks to the model
//! without the person seeing it. Marketing preheaders are hidden too, so this
//! rule can fire on a real newsletter, and that is the accepted cost.

use super::Reason;
use regex::Regex;
use std::sync::OnceLock;

fn styled_tag() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| {
        Regex::new(r#"(?i)<([a-z][a-z0-9]*)\b[^>]*?\bstyle\s*=\s*["']([^"']*)["'][^>]*>"#)
            .expect("valid pattern")
    })
}

fn tags() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| Regex::new(r"(?s)<[^>]*>").expect("valid pattern"))
}

/// The whole invisible alphabet, in one place, because the label rule and the text a
/// model reads have to agree on what counts as invisible.
pub const INVISIBLE: &str = r#"[\u{00ad}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{feff}\u{e0000}-\u{e007f}]"#;

fn zero_width() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| Regex::new(INVISIBLE).expect("valid pattern"))
}

fn hidden_style() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| {
        Regex::new(r"(?i)display\s*:\s*none|visibility\s*:\s*hidden").expect("valid pattern")
    })
}

fn font_size() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| {
        Regex::new(r"(?i)font-size\s*:\s*0(?:px|pt|em|rem|%)?").expect("valid pattern")
    })
}

/// `font-size: 0` hides text; `font-size: 0.9em` and `font-size: 02px` do not.
fn zero_font_size(style: &str) -> bool {
    font_size()
        .find_iter(style)
        .any(|found| !style[found.end()..].starts_with(|c: char| c.is_ascii_digit() || c == '.'))
}

fn white_text() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| {
        Regex::new(r"(?i)color\s*:\s*(#fff(?:fff)?\b|white\b|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))")
            .expect("valid pattern")
    })
}

fn white_background() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| {
        Regex::new(r"(?i)background(?:-color)?\s*:\s*(#fff(?:fff)?\b|white\b)")
            .expect("valid pattern")
    })
}

pub fn reasons(body: &str) -> Vec<Reason> {
    if zero_width().is_match(body) || has_hidden_element(body) {
        vec![Reason::HiddenText]
    } else {
        Vec::new()
    }
}

fn has_hidden_element(body: &str) -> bool {
    styled_tag().captures_iter(body).any(|caps| {
        let (Some(style), Some(name)) = (caps.get(2), caps.get(1)) else {
            return false;
        };
        if !is_hidden(style.as_str()) {
            return false;
        }
        // A lookahead in the lab's pattern: an outer element must not swallow the
        // hidden one inside it, so only the text up to this element's own close counts.
        match inner_html(body, caps.get(0).map_or(0, |m| m.end()), name.as_str()) {
            Some(inner) => carries_text(inner),
            None => false,
        }
    })
}

fn is_hidden(style: &str) -> bool {
    zero_font_size(style)
        || hidden_style().is_match(style)
        || (white_text().is_match(style) && white_background().is_match(style))
}

fn carries_text(inner: &str) -> bool {
    let stripped = tags().replace_all(inner, "");
    let stripped = stripped.replace("&nbsp;", "").replace("&#160;", "");
    stripped.chars().any(|c| !c.is_whitespace())
}

/// The text between the end of an opening tag and its own closing tag. Hand-scanned
/// because the closing tag has to match the opening one and `regex` has no backreferences.
fn inner_html<'a>(body: &'a str, from: usize, name: &str) -> Option<&'a str> {
    let needle = format!("</{name}");
    let lowered = body.to_ascii_lowercase();
    let mut at = from;
    while let Some(found) = lowered[at..].find(&needle) {
        let start = at + found;
        let tail = &body[start + needle.len()..];
        let end = tail.find('>')?;
        if tail[..end].trim().is_empty() {
            return Some(&body[from..start]);
        }
        at = start + needle.len();
    }
    None
}
