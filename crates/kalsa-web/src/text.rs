//! HTML → the text a reader would see.
//!
//! A forward scan, no DOM and no parser dependency: markup is skipped by
//! finding the next tag, block-level tags become paragraph breaks, and the
//! text between them is entity-decoded once at the end. Decoding last is
//! deliberate: `&lt;script&gt;` in a page's prose must not become markup that
//! the scan then reacts to.
//!
//! Output shape is what the model reads, so blank lines separate paragraphs
//! and list items start on their own line.

/// Elements whose content is never text worth reading.
const DROPPED: [&str; 6] = ["script", "style", "noscript", "template", "svg", "head"];

/// Elements that end a paragraph, so paragraphs do not run together.
const BLOCKS: [&str; 42] = [
    "p", "div", "section", "article", "header", "footer", "main", "aside", "nav", "h1", "h2",
    "h3", "h4", "h5", "h6", "ul", "ol", "table", "tr", "td", "th", "blockquote", "pre",
    "figure", "figcaption", "dl", "dt", "dd", "hr", "form", "fieldset", "address", "details",
    "summary", "menu", "caption", "thead", "tbody", "tfoot", "option", "colgroup", "select",
];

/// Extract the readable text of an HTML document, cut to `max_chars`.
/// The flag is true when the page had more text than the cut allowed.
pub(crate) fn html_to_text(html: &str, max_chars: usize) -> (String, bool) {
    // Lowercased copy for case-insensitive searching; `to_ascii_lowercase`
    // preserves byte offsets, so every index found here is valid in `html`.
    let lower = html.to_ascii_lowercase();
    let mut raw = String::with_capacity(html.len().min(64 * 1024));
    let mut drop_until: Option<String> = None;
    let mut i = 0usize;

    while i < html.len() {
        let Some(offset) = html[i..].find('<') else {
            if drop_until.is_none() {
                raw.push_str(&html[i..]);
            }
            break;
        };
        let open = i + offset;
        if drop_until.is_none() {
            raw.push_str(&html[i..open]);
        }
        i = open;

        if lower[i..].starts_with("<!--") {
            match lower[i + 4..].find("-->") {
                Some(end) => i += 4 + end + 3,
                None => break,
            }
            continue;
        }
        if lower[i..].starts_with("<!") || lower[i..].starts_with("<?") {
            match lower[i..].find('>') {
                Some(end) => i += end + 1,
                None => break,
            }
            continue;
        }

        let closing = lower[i..].starts_with("</");
        let name_start = i + if closing { 2 } else { 1 };
        let name_end = lower[name_start..]
            .find(|c: char| !c.is_ascii_alphanumeric())
            .map(|off| name_start + off)
            .unwrap_or(lower.len());
        let tag_end = match lower[i..].find('>') {
            Some(end) => i + end + 1,
            None => break,
        };
        let name = &lower[name_start..name_end];
        i = tag_end;

        if let Some(wanted) = drop_until.take() {
            if closing && name == wanted {
                continue;
            }
            drop_until = Some(wanted);
            continue;
        }
        if closing {
            if BLOCKS.contains(&name) {
                raw.push('\n');
            }
            continue;
        }
        if DROPPED.contains(&name) {
            // A self-closed element has no content to skip.
            if !html[open..tag_end].trim_end().ends_with("/>") {
                drop_until = Some(name.to_string());
            }
            continue;
        }
        match name {
            // A break ends a line; two of them make a paragraph, as in prose.
            "br" => raw.push('\n'),
            "li" => raw.push_str("\n- "),
            _ if BLOCKS.contains(&name) => raw.push('\n'),
            _ => {}
        }
    }

    let text = collapse(&decode_entities(&raw));
    let (text, truncated) = cut(text, max_chars);
    (text, truncated)
}

/// Cut to `max_chars` characters, never mid-character.
fn cut(text: String, max_chars: usize) -> (String, bool) {
    if text.chars().count() <= max_chars {
        return (text, false);
    }
    match text.char_indices().nth(max_chars) {
        Some((byte, _)) => (text[..byte].to_string(), true),
        None => (text, false),
    }
}

/// One blank line between paragraphs, one space inside them, no trailing
/// whitespace on any line.
fn collapse(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut space = false;
    let mut breaks = 0usize;
    for ch in raw.chars() {
        match ch {
            '\n' => {
                space = false;
                breaks += 1;
            }
            c if c.is_whitespace() => space = true,
            c => {
                if breaks > 0 {
                    for _ in 0..breaks.min(2) {
                        out.push('\n');
                    }
                    breaks = 0;
                } else if space && !out.is_empty() {
                    out.push(' ');
                }
                space = false;
                out.push(c);
            }
        }
    }
    out.trim().to_string()
}

fn decode_entities(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let after = &rest[amp + 1..];
        // An entity is short; a stray `&` in prose is not an entity.
        let candidate = after.split(';').next().unwrap_or("");
        let decoded = if candidate.len() <= 10 && after.contains(';') {
            named(candidate).or_else(|| numeric(candidate))
        } else {
            None
        };
        match decoded {
            Some(text) => {
                out.push_str(&text);
                rest = &after[candidate.len() + 1..];
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn named(name: &str) -> Option<String> {
    let ch = match name {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => ' ',
        "mdash" => '\u{2014}',
        "ndash" => '\u{2013}',
        "hellip" => '\u{2026}',
        "lsquo" => '\u{2018}',
        "rsquo" => '\u{2019}',
        "ldquo" => '\u{201C}',
        "rdquo" => '\u{201D}',
        "laquo" => '\u{00AB}',
        "raquo" => '\u{00BB}',
        "copy" => '\u{00A9}',
        "middot" => '\u{00B7}',
        "deg" => '\u{00B0}',
        "eacute" => '\u{00E9}',
        "egrave" => '\u{00E8}',
        "agrave" => '\u{00E0}',
        "ograve" => '\u{00F2}',
        "ugrave" => '\u{00F9}',
        "igrave" => '\u{00EC}',
        _ => return None,
    };
    Some(ch.to_string())
}

fn numeric(body: &str) -> Option<String> {
    let (digits, radix) = match body.strip_prefix("#x").or_else(|| body.strip_prefix("#X")) {
        Some(hex) => (hex, 16),
        None => (body.strip_prefix('#')?, 10),
    };
    let code = u32::from_str_radix(digits, radix).ok()?;
    char::from_u32(code).map(|c| c.to_string())
}

#[cfg(test)]
mod tests {
    use super::html_to_text;

    const LIMIT: usize = 10_000;

    #[test]
    fn keeps_prose_and_drops_markup() {
        let (text, truncated) = html_to_text("<p>Hello <b>world</b>.</p><p>Second.</p>", LIMIT);
        assert_eq!(text, "Hello world.\n\nSecond.");
        assert!(!truncated);
    }

    #[test]
    fn drops_script_style_and_the_head() {
        let html = "<head><title>T</title><style>p{color:red}</style></head>\
                    <body><script>alert('x')</script><p>Real text.</p></body>";
        assert_eq!(html_to_text(html, LIMIT).0, "Real text.");
    }

    #[test]
    fn a_self_closed_script_does_not_swallow_the_page() {
        let html = "<script src=\"/a.js\" /><p>Still here.</p>";
        assert_eq!(html_to_text(html, LIMIT).0, "Still here.");
    }

    #[test]
    fn decodes_entities_after_the_scan() {
        let (text, _) = html_to_text("<p>&lt;script&gt; is not a tag &amp; 3 &gt; 2</p>", LIMIT);
        assert_eq!(text, "<script> is not a tag & 3 > 2");
        let (text, _) = html_to_text("<p>caf&#233; &#x2014; ok</p>", LIMIT);
        assert_eq!(text, "café — ok");
        let (text, _) = html_to_text("<p>Tom &amp; Jerry & Co</p>", LIMIT);
        assert_eq!(text, "Tom & Jerry & Co");
    }

    #[test]
    fn comments_never_reach_the_reader() {
        let (text, _) = html_to_text("<p>a</p><!-- <p>hidden</p> --><p>b</p>", LIMIT);
        assert_eq!(text, "a\n\nb");
    }

    #[test]
    fn list_items_start_their_own_line() {
        let (text, _) = html_to_text("<ul><li>one</li><li>two</li></ul>", LIMIT);
        assert_eq!(text, "- one\n- two");
    }

    #[test]
    fn one_break_is_a_line_and_two_are_a_paragraph() {
        let (text, _) = html_to_text("first<br>second<br><br>third", LIMIT);
        assert_eq!(text, "first\nsecond\n\nthird");
    }

    #[test]
    fn cuts_at_the_limit_and_says_so() {
        let html = format!("<p>{}</p>", "x".repeat(500));
        let (text, truncated) = html_to_text(&html, 100);
        assert_eq!(text.chars().count(), 100);
        assert!(truncated);
        assert_eq!(html_to_text(&html, 1000).1, false);
    }

    #[test]
    fn cuts_on_a_character_boundary() {
        let html = "é".repeat(50);
        let (text, truncated) = html_to_text(&html, 10);
        assert_eq!(text, "é".repeat(10));
        assert!(truncated);
    }

    #[test]
    fn an_unclosed_page_still_returns_its_text() {
        let (text, _) = html_to_text("<div><p>no closing tags here", LIMIT);
        assert_eq!(text, "no closing tags here");
        assert_eq!(html_to_text("", LIMIT).0, "");
    }
}
