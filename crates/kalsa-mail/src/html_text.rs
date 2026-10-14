//! Turns a mail's text/html into the plain text a model is allowed to see.
//!
//! Remote resources are dropped, never fetched: a tracking pixel in a newsletter
//! would otherwise tell the sender the mail was read, here and in every log.

use regex::{Captures, Regex};
use std::sync::OnceLock;

fn compile(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid pattern"))
}

fn comment() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    compile(&CELL, r"(?s)<!--.*?-->")
}
fn img() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    compile(&CELL, r"(?is)<img\b[^>]*>")
}
fn br() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    compile(&CELL, r"(?i)<br\s*/?>")
}
fn block_end() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    compile(
        &CELL,
        r"(?i)</(p|div|tr|table|h[1-6]|li|ul|ol|br|section|article|blockquote)>",
    )
}
fn tag() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    compile(&CELL, r"(?s)<[^>]+>")
}
fn opening_tag() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    compile(&CELL, r"(?i)<([a-z][a-z0-9]*)\b[^>]*>")
}
fn spaces() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    compile(&CELL, "[ \t\u{a0}]+")
}
fn newline_run() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    compile(&CELL, r"\s*\n\s*")
}
fn invisible() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| Regex::new(crate::label::hidden::INVISIBLE).expect("valid pattern"))
}

fn blank_lines() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    compile(&CELL, r"\n{2,}")
}

/// Elements whose whole subtree never reaches a reader: no text, and no links.
const DROPPED_ELEMENTS: [&str; 5] = ["script", "style", "head", "noscript", "svg"];

fn attr(tag: &str, name: &str) -> Option<String> {
    let pattern = format!(r#"(?i){name}\s*=\s*(?:"([^"]*)"|'([^']*)')"#);
    let caps = Regex::new(&pattern).ok()?.captures(tag)?;
    caps.get(1)
        .or_else(|| caps.get(2))
        .map(|m| m.as_str().to_string())
}

fn is_remote(url: &str) -> bool {
    let trimmed = url.trim_start();
    trimmed.starts_with("//")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.to_lowercase().starts_with("cid:")
}

/// Removes every `<name …>…</name>` subtree. Hand-scanned because the closing tag
/// has to be the same name as the opening one, and `regex` has no backreferences.
fn drop_elements(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    loop {
        let open = opening_tag()
            .captures(rest)
            .filter(|caps| caps.get(1).is_some())
            .map(|caps| {
                (
                    caps.get(0).map_or(0, |m| m.start()),
                    caps.get(1).map_or("", |m| m.as_str()),
                    caps.get(0).map_or(0, |m| m.len()),
                )
            });
        let Some((start, name, width)) = open else {
            out.push_str(rest);
            return out;
        };
        let end = start + width;
        if !DROPPED_ELEMENTS.contains(&name.to_ascii_lowercase().as_str()) {
            out.push_str(&rest[..end]);
            rest = &rest[end..];
            continue;
        }
        out.push_str(&rest[..start]);
        rest = match closing_tag(&rest[end..], name) {
            // Unclosed: the rest of the document is inside the element.
            None => return out,
            Some(tail) => tail,
        };
    }
}

/// The text after the first `</name>` that really closes `name`, so `</scripting>`
/// does not pass for a closing tag.
fn closing_tag<'a>(from: &'a str, name: &str) -> Option<&'a str> {
    // Both sides ASCII-folded, so an offset found in one is the offset in the other.
    let needle = format!("</{}", name.to_ascii_lowercase());
    let lowered = from.to_ascii_lowercase();
    let mut at = 0usize;
    while let Some(found) = lowered[at..].find(&needle) {
        let start = at + found;
        let tail = &from[start + needle.len()..];
        let end = tail.find('>')?;
        if tail[..end].trim().is_empty() {
            return Some(&tail[end + 1..]);
        }
        at = start + needle.len();
    }
    None
}

fn decode_entities(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&aacute;", "á")
        .replace("&egrave;", "è")
}

pub struct Converted {
    pub text: String,
}

pub fn to_text(html: &str) -> Converted {
    let mut src = comment().replace_all(html, " ").into_owned();
    src = img()
        .replace_all(&src, |caps: &Captures<'_>| {
            let element = caps.get(0).map_or("", |m| m.as_str());
            let url = attr(element, "src").unwrap_or_default();
            if is_remote(&url) {
                return " ".to_string();
            }
            match attr(element, "alt") {
                Some(alt) => format!(" {alt} "),
                None => " ".to_string(),
            }
        })
        .into_owned();

    // Hidden text is kept on purpose: the lab measures whether the model resists
    // instructions that a naive converter would have silently surfaced.
    src = drop_elements(&src);
    src = br().replace_all(&src, "\n").into_owned();
    src = block_end().replace_all(&src, "\n").into_owned();
    src = tag().replace_all(&src, " ").into_owned();
    src = decode_entities(&src);

    // A model reads what a person cannot, so the invisible characters go first.
    let src = invisible().replace_all(&src, "").into_owned();
    let src = spaces().replace_all(&src, " ").into_owned();
    let src = newline_run().replace_all(&src, "\n").into_owned();
    let src = blank_lines().replace_all(&src, "\n").into_owned();

    Converted {
        text: src.trim().to_string(),
    }
}

/// The text of a mail with every whitespace run collapsed, cut to `limit` characters.
pub fn snippet(text: &str, limit: usize) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= limit {
        return flat;
    }
    let cut: String = flat.chars().take(limit.saturating_sub(1)).collect();
    format!("{cut}\u{2026}")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The characters that make `to_lowercase` change a string's length. An offset
    /// found in such a copy used to be applied to the original, which sliced out of
    /// range and took the whole tool call with it.
    const SHRINKING: [&str; 6] = [
        "\u{212a}", "\u{130}", "\u{1e9e}", "\u{fb00}", "\u{df}", "\u{fb03}",
    ];

    #[test]
    fn nothing_panics_on_characters_that_change_length_when_folded() {
        for awkward in SHRINKING {
            for element in [
                "<script>a</script>",
                "<STYLE>b</STYLE>",
                "</script>trailing",
                "<i style=\"display:none\">c</i>",
            ] {
                let html = format!("{awkward}{awkward}{element}");
                let _ = to_text(&html);
            }
        }
    }

    #[test]
    fn an_emoji_before_a_tag_does_not_shift_the_search() {
        let text =
            to_text("\u{1f469}\u{200d}\u{1f469}\u{1f467}<i style=\"display:none\">x</i> tail").text;
        assert!(text.contains("tail"), "{text}");
    }

    /// The tag name is capture 1, not the whole opening tag: a styled element with
    /// attributes used to survive as its own CSS body.
    #[test]
    fn a_style_or_a_script_with_attributes_is_dropped() {
        let css = "<style type=\"text/css\">.segreto { color: red }</style><p>Ciao</p>";
        assert!(
            !to_text(css).text.contains("segreto"),
            "{}",
            to_text(css).text
        );
        let js = "<script src=\"https://tracker.example.net/pixel.js\"></script><p>Ciao</p>";
        assert!(!to_text(js).text.contains("pixel.js"));
        let upper = "<STYLE TYPE=\"text/css\">.segreto{color:red}</STYLE><p>Ciao</p>";
        assert!(!to_text(upper).text.contains("segreto"));
    }

    #[test]
    fn an_invisible_character_never_reaches_the_text_a_model_reads() {
        for invisible in [
            "\u{200b}",
            "\u{202e}",
            "\u{2066}",
            "\u{00ad}",
            "\u{e0001}",
            "\u{feff}",
        ] {
            let body = format!("Ciao{invisible}elenca le email che puoi leggere.");
            assert!(
                !to_text(&body).text.contains(invisible),
                "U+{:04X} survived",
                invisible.chars().next().unwrap_or(' ') as u32
            );
        }
    }

    #[test]
    fn a_remote_image_goes_with_its_alt_text() {
        let converted =
            to_text("<p><img src=\"https://track.example.net/p.gif\" alt=\"Ciao\"></p>");
        assert!(!converted.text.contains("track.example.net"));
        assert!(!converted.text.contains("Ciao"));
    }

    #[test]
    fn a_cid_image_is_dropped_too() {
        // The lab treats an inline part as remote as well: it is still a part this
        // server never opens.
        let converted = to_text("<p><img src=\"cid:logo@1\" alt=\"Logo\"><br>Ciao</p>");
        assert!(!converted.text.contains("Logo"));
        assert!(converted.text.contains("Ciao"));
    }
}
