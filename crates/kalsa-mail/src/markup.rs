//! One HTML start tag and the attributes on it, read out of a source string.
//!
//! Hand-read rather than regexed: the walk over a mail has to know where a tag
//! stops and what it says, and a regular expression cannot tell an unquoted
//! value from the next attribute.

/// A tag found in a source string. `start` and `end` are byte offsets into that
/// same string, so a caller can keep walking from where the tag stopped.
pub(crate) struct Tag {
    pub name: String,
    pub start: usize,
    pub end: usize,
    pub closing: bool,
    pub self_closing: bool,
    attributes: Vec<(String, String)>,
}

/// The first real tag in `src`. A doctype, a processing instruction and a
/// stray `<` are not tags, and are stepped over rather than ending the walk.
pub(crate) fn first(src: &str) -> Option<Tag> {
    let mut at = 0;
    while let Some(found) = src[at..].find('<') {
        if let Some(tag) = at_tag(src, at + found) {
            return Some(tag);
        }
        at += found + 1;
    }
    None
}

fn at_tag(src: &str, start: usize) -> Option<Tag> {
    let after = &src[start + 1..];
    let closing = after.starts_with('/');
    let body = if closing { &after[1..] } else { after };
    let name_end = body
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
        .unwrap_or(body.len());
    if name_end == 0 || !body[..name_end].starts_with(|c: char| c.is_ascii_alphabetic()) {
        return None;
    }

    let mut attributes = Vec::new();
    let bytes = body.as_bytes();
    let mut at = name_end;
    let mut self_closing = false;
    let mut closed = false;
    while at < bytes.len() {
        match bytes[at] {
            b'>' => {
                at += 1;
                closed = true;
                break;
            }
            b'/' => {
                self_closing = true;
                at += 1;
            }
            byte if byte.is_ascii_whitespace() => at += 1,
            _ => {
                let from = at;
                while at < bytes.len() && !is_separator(bytes[at]) {
                    at += 1;
                }
                let key = body[from..at].to_ascii_lowercase();
                while at < bytes.len() && bytes[at].is_ascii_whitespace() {
                    at += 1;
                }
                let value = if bytes.get(at) == Some(&b'=') {
                    at += 1;
                    while at < bytes.len() && bytes[at].is_ascii_whitespace() {
                        at += 1;
                    }
                    value_at(body, &mut at)
                } else {
                    String::new()
                };
                if !key.is_empty() {
                    attributes.push((key, value));
                }
            }
        }
    }
    if !closed {
        at = bytes.len();
    }

    Some(Tag {
        name: body[..name_end].to_ascii_lowercase(),
        start,
        end: start + 1 + at,
        closing,
        self_closing,
        attributes,
    })
}

fn is_separator(byte: u8) -> bool {
    byte.is_ascii_whitespace() || matches!(byte, b'=' | b'>' | b'/')
}

/// Quoted or not: a sender writes `style=display:none` as often as
/// `style="display:none"`, and only the second one is a well-formed document.
fn value_at(body: &str, at: &mut usize) -> String {
    let bytes = body.as_bytes();
    let Some(&first) = bytes.get(*at) else {
        return String::new();
    };
    if first != b'"' && first != b'\'' {
        let from = *at;
        while *at < bytes.len() && !(bytes[*at].is_ascii_whitespace() || bytes[*at] == b'>') {
            *at += 1;
        }
        return unescape(&body[from..*at]);
    }
    let from = *at + 1;
    let Some(found) = body[from..].find(first as char) else {
        *at = bytes.len();
        return unescape(&body[from..]);
    };
    *at = from + found + 1;
    unescape(&body[from..from + found])
}

impl Tag {
    pub(crate) fn get(&self, name: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    pub(crate) fn has(&self, name: &str) -> bool {
        self.attributes.iter().any(|(key, _)| key == name)
    }

    pub(crate) fn classes(&self) -> impl Iterator<Item = &str> {
        self.get("class").unwrap_or_default().split_whitespace()
    }
}

/// The entities that change what a tag means. `&#100;isplay` is `display`, so
/// an attribute read without decoding them is a different attribute.
pub(crate) fn unescape(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let Some(end) = rest[1..].find(';').map(|found| found + 1) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        match character(entity) {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn character(entity: &str) -> Option<char> {
    let named = match entity {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => '\u{a0}',
        "aacute" => 'á',
        "egrave" => 'è',
        _ => return numeric(entity),
    };
    Some(named)
}

fn numeric(entity: &str) -> Option<char> {
    let digits = entity.strip_prefix('#')?;
    let code = match digits.strip_prefix(['x', 'X']) {
        Some(hex) => u32::from_str_radix(hex, 16),
        None => digits.parse(),
    };
    code.ok().and_then(char::from_u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tag_of(html: &str) -> Tag {
        first(html).expect("a tag")
    }

    #[test]
    fn a_quoted_and_an_unquoted_value_are_both_read() {
        assert_eq!(
            tag_of(r#"<div style="display:none">"#).get("style"),
            Some("display:none")
        );
        assert_eq!(
            tag_of("<div style=display:none>").get("style"),
            Some("display:none")
        );
        assert_eq!(
            tag_of("<div class='a b'>").classes().collect::<Vec<_>>(),
            vec!["a", "b"]
        );
    }

    #[test]
    fn the_tag_name_is_lower_case_and_where_it_stops_is_known() {
        let html = "<DIV ID=x>testo</DIV> resto";
        let tag = tag_of(html);
        assert_eq!(tag.name, "div");
        assert_eq!(tag.get("id"), Some("x"));
        assert!(!tag.closing);
        assert_eq!(&html[tag.end..], "testo</DIV> resto");
    }

    #[test]
    fn a_doctype_and_a_stray_angle_bracket_are_stepped_over() {
        assert_eq!(tag_of("<!DOCTYPE html><p>x</p>").name, "p");
        assert_eq!(tag_of("1 < 2 <p>x</p>").name, "p");
        assert!(tag_of("</div>").closing);
    }

    #[test]
    fn an_entity_in_an_attribute_is_the_character_it_names() {
        assert_eq!(
            tag_of("<div style=\"&#100;isplay:none\">").get("style"),
            Some("display:none")
        );
        assert_eq!(unescape("a &amp; b &#65; c &egrave;"), "a & b A c è");
        assert_eq!(
            unescape("100% &notanentity; &#x41;"),
            "100% &notanentity; A"
        );
    }

    #[test]
    fn an_unclosed_tag_does_not_swallow_the_walk() {
        let tag = tag_of("<div style=\"color:red");
        assert_eq!(tag.end, "<div style=\"color:red".len());
        assert_eq!(tag.get("style"), Some("color:red"));
    }
}
