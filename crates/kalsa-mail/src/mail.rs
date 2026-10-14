//! RFC822 source -> what the server reads: ordered headers, the sender, the
//! thread, and a body bounded to 64 KB.

use crate::html_text;
use crate::link::{self, Link};
use base64::Engine;
use mail_parser::{DateTime, HeaderValue, Message, MessageParser, PartType};

/// The lab measured its rules on the first 64 KB of a body, and the plan caps the
/// read tool at the same size. One bound, so the labels and the text agree.
pub(crate) const BODY_LIMIT: usize = 64 * 1024;

pub struct Attachment {
    pub name: String,
    pub size: usize,
}

pub struct ParsedMail {
    /// In wire order, names lowercased. The rules read position: a forwarded mail
    /// carries the original provider's header below ours.
    pub headers: Vec<(String, String)>,
    pub from_address: String,
    pub from_display: String,
    pub reply_to: Option<String>,
    /// Epoch milliseconds, or 0 when the Date header is missing or unreadable.
    pub date_ms: i64,
    pub message_id: Option<String>,
    pub subject: String,
    /// Plain text for a person or a model: HTML already converted.
    pub text: String,
    /// The decoded body as it arrived, which is what the link and hidden-text
    /// rules scan. A plain-text mail is scanned too: zero-width characters hide
    /// in it just the same.
    pub body: String,
    pub links: Vec<Link>,
    /// Names and sizes only. An attachment is never opened in this phase.
    pub attachments: Vec<Attachment>,
    /// Message ids from References and In-Reply-To: the thread this mail belongs to.
    pub thread_ids: Vec<String>,
}

pub fn parse(raw: &[u8]) -> ParsedMail {
    let start = body_start(raw);
    let headers = parse_headers(&String::from_utf8_lossy(&raw[..start]));
    let bounded = bounded(raw, start);
    let message = MessageParser::default().parse(bounded);
    fill(message, headers)
}

/// Headers only, for the "have I seen this sender before" check over a whole mailbox.
pub fn sender_of(header_bytes: &[u8]) -> (String, i64) {
    let start = body_start(header_bytes);
    let headers = parse_headers(&String::from_utf8_lossy(&header_bytes[..start]));
    let bounded = bounded(header_bytes, start);
    let message = MessageParser::default().parse(bounded);
    let address = message
        .as_ref()
        .and_then(|m| m.from())
        .and_then(first_addr)
        .and_then(|addr| addr.address().map(str::to_string))
        .map(|address| address.trim().to_lowercase())
        .or_else(|| header(&headers, "from").and_then(address_in))
        .unwrap_or_default();
    let date = message
        .as_ref()
        .and_then(|m| m.date())
        .and_then(epoch_ms)
        .unwrap_or(0);
    (address, date)
}

fn fill(message: Option<Message<'_>>, headers: Vec<(String, String)>) -> ParsedMail {
    let html = message.as_ref().and_then(html_of);
    let plain = message.as_ref().and_then(text_of);
    let from = message.as_ref().and_then(|m| m.from()).and_then(first_addr);
    let body_source = html.clone().or_else(|| plain.clone()).unwrap_or_default();
    let text = match (&html, &plain) {
        (Some(html), _) => html_text::to_text(html).text,
        (None, Some(plain)) => plain.trim().to_string(),
        (None, None) => String::new(),
    };

    ParsedMail {
        from_address: from
            .as_ref()
            .and_then(|addr| addr.address())
            .map(str::trim)
            .map(str::to_lowercase)
            .filter(|address| !address.is_empty())
            .or_else(|| header(&headers, "from").and_then(address_in))
            .unwrap_or_default(),
        from_display: from
            .as_ref()
            .and_then(|addr| addr.name())
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or_default()
            .to_string(),
        reply_to: message
            .as_ref()
            .and_then(|m| m.reply_to())
            .and_then(first_addr)
            .and_then(|addr| addr.address())
            .map(str::trim)
            .map(str::to_lowercase)
            .filter(|address| !address.is_empty())
            .or_else(|| header(&headers, "reply-to").and_then(address_in)),
        date_ms: message
            .as_ref()
            .and_then(|m| m.date())
            .and_then(epoch_ms)
            .unwrap_or(0),
        message_id: message
            .as_ref()
            .and_then(|m| m.message_id())
            .map(|id| id.trim().to_string()),
        subject: message
            .as_ref()
            .and_then(|m| m.subject().map(str::to_string))
            .or_else(|| header(&headers, "subject").map(str::to_string))
            .unwrap_or_default(),
        text,
        links: link::links_in(&body_source),
        body: body_source,
        attachments: message.as_ref().map(attachments).unwrap_or_default(),
        thread_ids: message.as_ref().map(thread_ids).unwrap_or_default(),
        headers,
    }
}

/// Where the body starts: the earliest blank line, whichever line ending it uses.
/// Trying CRLF first over the whole source would swallow a body that contains one.
fn body_start(raw: &[u8]) -> usize {
    let crlf = find(raw, b"\r\n\r\n");
    let lf = find(raw, b"\n\n");
    match (crlf, lf) {
        (Some(at), Some(other)) if other < at => other + 2,
        (Some(at), _) => at + 4,
        (None, Some(at)) => at + 2,
        (None, None) => raw.len(),
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// The same message with its body cut to the limit. Every part of the result is read
/// from this, so a message larger than the cap never reads a byte past it.
fn bounded(raw: &[u8], body_start: usize) -> &[u8] {
    &raw[..body_start.saturating_add(BODY_LIMIT).min(raw.len())]
}

fn parse_headers(head: &str) -> Vec<(String, String)> {
    let unfolded = head
        .replace("\r\n ", " ")
        .replace("\r\n\t", " ")
        .replace("\n ", " ")
        .replace("\n\t", " ");
    unfolded
        .split('\n')
        .filter_map(|line| {
            let at = line.find(':')?;
            if at == 0 {
                return None;
            }
            Some((
                line[..at].trim().to_lowercase(),
                line[at + 1..].trim().to_string(),
            ))
        })
        .collect()
}

fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}

/// The first mailbox of a header, which is the one the lab and the client both show.
fn first_addr<'a, 'b>(address: &'a mail_parser::Address<'b>) -> Option<&'a mail_parser::Addr<'b>> {
    address.first()
}

/// References and In-Reply-To arrive as a header value or as a list of them.
fn raw_value(value: &HeaderValue<'_>) -> Vec<u8> {
    match value {
        HeaderValue::Text(text) => text.as_bytes().to_vec(),
        HeaderValue::TextList(list) => list
            .iter()
            .map(|item| item.as_ref())
            .collect::<Vec<_>>()
            .join(" ")
            .into_bytes(),
        _ => Vec::new(),
    }
}

fn header_is(header: &mail_parser::Header<'_>, name: &str) -> bool {
    matches!(&header.name, mail_parser::HeaderName::Other(found) if found.eq_ignore_ascii_case(name))
}

/// mail-parser reads a Date header into its own fields rather than a time zone aware
/// type, so the offset is applied here before the instant exists.
fn epoch_ms(date: &DateTime) -> Option<i64> {
    let day = chrono::NaiveDate::from_ymd_opt(
        i32::from(date.year),
        u32::from(date.month),
        u32::from(date.day),
    )?;
    let local = day.and_hms_opt(
        u32::from(date.hour),
        u32::from(date.minute),
        u32::from(date.second),
    )?;
    let offset =
        chrono::Duration::seconds(i64::from(date.tz_hour) * 3600 + i64::from(date.tz_minute) * 60);
    let utc = if date.tz_before_gmt {
        local - offset
    } else {
        local + offset
    };
    Some(utc.and_utc().timestamp_millis())
}

fn html_of(message: &Message<'_>) -> Option<String> {
    message.html_bodies().find_map(|part| match &part.body {
        PartType::Html(body) => Some(body.to_string()),
        _ => None,
    })
}

fn text_of(message: &Message<'_>) -> Option<String> {
    message.text_bodies().find_map(|part| match &part.body {
        PartType::Text(body) => Some(body.to_string()),
        _ => None,
    })
}

/// `"Name" <addr@host>` -> `addr@host`, without needing a full address parser.
fn address_in(value: &str) -> Option<String> {
    let inside = match (value.find('<'), value.rfind('>')) {
        (Some(open), Some(close)) if close > open => &value[open + 1..close],
        _ => value,
    };
    let address = inside.trim().to_lowercase();
    (!address.is_empty()).then_some(address)
}

fn attachments(message: &Message<'_>) -> Vec<Attachment> {
    message
        .attachments()
        .map(|part| {
            let name = part
                .headers
                .iter()
                .find(|h| header_is(h, "content-disposition"))
                .and_then(|h| match &h.value {
                    HeaderValue::ContentType(content) => content.attribute("filename"),
                    _ => None,
                })
                .or_else(|| {
                    part.headers
                        .iter()
                        .find(|h| header_is(h, "content-type"))
                        .and_then(|h| match &h.value {
                            HeaderValue::ContentType(content) => content.attribute("name"),
                            _ => None,
                        })
                })
                .map(|name| decode_word(name).unwrap_or_else(|| name.to_string()))
                .unwrap_or_default();
            Attachment {
                name,
                size: part.body.len(),
            }
        })
        .collect()
}

fn thread_ids(message: &Message<'_>) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for header in [
        raw_value(message.references()),
        raw_value(message.in_reply_to()),
    ] {
        for chunk in header.split(|b| b.is_ascii_whitespace() || *b == b',') {
            let id = String::from_utf8_lossy(chunk)
                .trim()
                .trim_start_matches('<')
                .trim_end_matches('>')
                .to_string();
            if !id.is_empty() && !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    if ids.is_empty() {
        if let Some(id) = message.message_id() {
            let id = id.trim().trim_start_matches('<').trim_end_matches('>');
            if !id.is_empty() {
                ids.push(id.to_string());
            }
        }
    }
    ids
}

/// `=?utf-8?B?…?=` and `=?utf-8?Q?…?=`, as a filename or a display name may carry either.
fn decode_word(word: &str) -> Option<String> {
    let after_name = word.strip_prefix("=?")?.split_once('?')?.1;
    let (encoding, rest) = after_name.split_once('?')?;
    let payload = rest.strip_suffix("?=")?;
    let bytes = if encoding.eq_ignore_ascii_case("b") {
        base64::engine::general_purpose::STANDARD
            .decode(payload)
            .ok()?
    } else {
        decode_q(payload)
    };
    String::from_utf8(bytes).ok()
}

fn decode_q(data: &str) -> Vec<u8> {
    let bytes = data.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'_' => {
                out.push(b' ');
                i += 1;
            }
            b'=' if i + 2 < bytes.len() => {
                let hex = String::from_utf8_lossy(&bytes[i + 1..i + 3]).to_string();
                match u8::from_str_radix(&hex, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    out
}
