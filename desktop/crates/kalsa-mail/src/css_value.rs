//! How one CSS value reads, once a sender has written it the way they wanted.
//!
//! Everything here exists because a value that looks harmless is not: a comment,
//! an `!important`, an escaped letter or a unit on a zero all mean the same
//! declaration written to be read by the wrong parser. A renderer decodes them,
//! so a rule that did not would answer a question nobody asked.

pub(crate) fn decode_escapes(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        let mut digits = String::new();
        while digits.len() < 6 {
            match chars.peek() {
                Some(c) if c.is_ascii_hexdigit() => {
                    digits.push(*c);
                    chars.next();
                }
                _ => break,
            }
        }
        if digits.is_empty() {
            // `\` is an escaped backslash; anything else is itself.
            out.push(chars.next().unwrap_or('\\'));
        } else {
            if let Some(decoded) = u32::from_str_radix(&digits, 16)
                .ok()
                .and_then(char::from_u32)
            {
                out.push(decoded);
            }
            // CSS eats one whitespace after a hex escape: `\64 ` is one char.
            if matches!(chars.peek(), Some(' ') | Some('\t') | Some('\n')) {
                chars.next();
            }
        }
    }
    out
}

/// `/* … */`, which a sender can put anywhere to hide a keyword from a reader
/// that does not decode comments.
pub(crate) fn strip_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(open) = rest.find("/*") {
        out.push_str(&rest[..open]);
        match rest[open + 2..].find("*/") {
            Some(close) => rest = &rest[open + 2 + close + 2..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

/// The value of one declaration, in the form a renderer sees it: no comment, no
/// `!important`, escapes decoded.
pub(crate) fn declaration_value(value: &str) -> String {
    let cleaned = strip_comments(value);
    let cleaned = decode_escapes(&cleaned);
    let lowered = cleaned.to_ascii_lowercase();
    let tail = match lowered.rfind('!') {
        Some(at) if collapsed(&lowered[at..]) == "!important" => at,
        _ => cleaned.len(),
    };
    cleaned[..tail]
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn collapsed(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

/// `display:none` and `visibility:hidden`, with any spacing a CSS writer likes.
pub(crate) fn hidden_value(value: &str) -> bool {
    let value = value.trim();
    value.eq_ignore_ascii_case("none") || value.eq_ignore_ascii_case("hidden")
}

/// A number and whatever unit follows it, read as a number. `0`, `0px` and
/// `0.0em` are all zero; `0.9em` and `02px` are not, and `-0` is.
pub(crate) fn is_zero(value: &str) -> bool {
    let value = value.trim();
    let bytes = value.as_bytes();
    let mut at = usize::from(matches!(bytes.first(), Some(b'+' | b'-')));
    let mut seen_dot = false;
    while let Some(&byte) = bytes.get(at) {
        match byte {
            b'0'..=b'9' => at += 1,
            b'.' if !seen_dot => {
                seen_dot = true;
                at += 1;
            }
            // An exponent only when digits follow it, so the `e` of `0em` is
            // not read as one.
            b'e' | b'E' => {
                let mut ahead = at + 1;
                if matches!(bytes.get(ahead), Some(b'+' | b'-')) {
                    ahead += 1;
                }
                if !matches!(bytes.get(ahead), Some(b'0'..=b'9')) {
                    break;
                }
                at = ahead;
            }
            _ => break,
        }
    }
    value[..at].parse::<f64>().is_ok_and(|n| n == 0.0)
}

/// `clip` and `clip-path` values that leave nothing on the page.
pub(crate) fn clips_to_nothing(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    value.contains("inset(100%")
        || value.contains("inset(50%")
        || value.replace(' ', "").contains("circle(0")
        || value.replace(' ', "").contains("rect(0px,0px,0px,0px")
        || value.replace(' ', "").contains("rect(0,0,0,0")
        || value.starts_with("path(\"none\"")
}

/// `transform: scale(0)` in any arity: every axis has to be zero for the
/// element to vanish, and one axis is still an axis a person can see.
pub(crate) fn scaled_to_nothing(value: &str) -> bool {
    let value: String = value
        .to_ascii_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    let Some(open) = value.find("scale") else {
        return false;
    };
    let rest = value[open..].find('(').map(|at| &value[open + at + 1..]);
    let Some(args) = rest else {
        return false;
    };
    let Some(close) = args.find(')') else {
        return false;
    };
    let axes: Vec<&str> = args[..close].split(',').collect();
    !axes.is_empty() && axes.iter().all(|axis| is_zero(axis))
}

/// Far enough off the page that nobody scrolls to it.
pub(crate) fn is_off_screen(value: &str) -> bool {
    let number: String = value
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
        .collect();
    number
        .parse::<f64>()
        .is_ok_and(|offset| offset.abs() >= 500.0)
}

/// The colours a mail writes by name rather than by hex. `color` and
/// `background` have to compare equal for the rule to see a letter written on
/// its own paper.
const NAMED: [(&str, &str); 17] = [
    ("white", "#ffffff"),
    ("black", "#000000"),
    ("red", "#ff0000"),
    ("green", "#008000"),
    ("lime", "#00ff00"),
    ("blue", "#0000ff"),
    ("yellow", "#ffff00"),
    ("aqua", "#00ffff"),
    ("cyan", "#00ffff"),
    ("fuchsia", "#ff00ff"),
    ("magenta", "#ff00ff"),
    ("silver", "#c0c0c0"),
    ("gray", "#808080"),
    ("grey", "#808080"),
    ("maroon", "#800000"),
    ("navy", "#000080"),
    ("purple", "#800080"),
];

/// `#abc`, `#aabbcc`, `rgb(1,2,3)` and `red` all have to compare equal to their
/// twins, or a colour rule is walked past.
pub(crate) fn colour(value: &str) -> Option<String> {
    let value: String = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    if value == "transparent" {
        return Some("transparent".to_string());
    }
    if let Some(hex) = value.strip_prefix('#') {
        return match hex.len() {
            3 => Some(expand(hex)),
            6 => Some(format!("#{hex}")),
            _ => None,
        };
    }
    if let Some((_, hex)) = NAMED.iter().find(|(name, _)| *name == value) {
        return Some((*hex).to_string());
    }
    let alpha = value.starts_with("rgba(");
    let rgb = if alpha {
        value.strip_prefix("rgba(")
    } else {
        value.strip_prefix("rgb(")
    }?;
    // The fourth channel of rgba is an alpha: it changes what a colour looks
    // like over, not what the colour is.
    let parts: Vec<&str> = rgb.trim_end_matches(')').split(',').collect();
    if parts.len() != if alpha { 4 } else { 3 } {
        return None;
    }
    let channels: Option<Vec<u8>> = parts[..3].iter().map(|c| c.parse::<u8>().ok()).collect();
    let channels = channels?;
    Some(format!(
        "#{:02x}{:02x}{:02x}",
        channels[0], channels[1], channels[2]
    ))
}

fn expand(hex: &str) -> String {
    let doubled: String = hex.chars().flat_map(|c| [c, c]).collect();
    format!("#{doubled}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_escape_is_the_character_it_names() {
        for (written, expected) in [
            (r"\64 isplay", "display"),
            (r"\64\69\73\70\6c\61\79", "display"),
            ("none", "none"),
            (r"a\ b", "a b"),
        ] {
            assert_eq!(decode_escapes(written), expected, "{written}");
        }
    }

    #[test]
    fn a_comment_and_an_important_are_not_part_of_the_value() {
        assert_eq!(strip_comments("a /* x */ b"), "a  b");
        assert_eq!(strip_comments("/* unterminated"), "");
        assert_eq!(declaration_value("none !important"), "none");
        assert_eq!(declaration_value("none!important"), "none");
        assert_eq!(declaration_value("  none  "), "none");
        assert_eq!(declaration_value("red"), "red");
    }

    #[test]
    fn a_zero_is_a_zero_whichever_unit_wears() {
        for zero in ["0", "0px", "0.0em", "0rem", "-0", "00pt", "0%"] {
            assert!(is_zero(zero), "{zero}");
        }
        for not_zero in ["0.9em", "02px", "1", "-1px", "none", ""] {
            assert!(!is_zero(not_zero), "{not_zero}");
        }
    }

    #[test]
    fn the_same_colour_written_two_ways_compares_equal() {
        assert_eq!(colour("#ffffff"), colour("#fff"));
        assert_eq!(colour("white"), colour("#FFFFFF"));
        assert_eq!(colour("rgb(255,0,0)"), colour("#ff0000"));
        assert_eq!(colour("rgba(255,0,0,0.5)"), colour("red"));
        assert_eq!(colour("transparent"), Some("transparent".to_string()));
        assert_eq!(colour("not-a-colour"), None);
        assert_eq!(expand("abc"), "#aabbcc");
    }

    #[test]
    fn a_transform_only_hides_when_every_axis_is_zero() {
        for nothing in [
            "scale(0)",
            "scale(0,0)",
            "scale( 0 , 0 )",
            "scale3d(0,0,0)",
            "scaleX(0)",
        ] {
            assert!(scaled_to_nothing(nothing), "{nothing}");
        }
        for something in ["scale(1)", "scale(0,1)", "rotate(45deg)", "scaleX(0.5)"] {
            assert!(!scaled_to_nothing(something), "{something}");
        }
    }

    #[test]
    fn only_a_clip_that_leaves_nothing_counts_as_hiding() {
        for nothing in [
            "inset(100%)",
            "circle(0)",
            "rect(0,0,0,0)",
            "path(\"none\")",
        ] {
            assert!(clips_to_nothing(nothing), "{nothing}");
        }
        for something in ["auto", "inset(10%)", "circle(50%)", "none"] {
            assert!(!clips_to_nothing(something), "{something}");
        }
    }

    #[test]
    fn only_an_offset_far_enough_away_counts_as_hidden() {
        for away in ["-9999px", "-500", "9999px"] {
            assert!(is_off_screen(away), "{away}");
        }
        for here in ["0", "-5px", "left", "auto", ""] {
            assert!(!is_off_screen(here), "{here}");
        }
    }
}
