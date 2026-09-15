use std::str;

pub(crate) const MAX_BODY: usize = 8 * 1024;
pub(crate) const MAX_HEAD: usize = 8 * 1024;
pub(crate) const MAX_BUFFER: usize = MAX_HEAD + MAX_BODY + 4;

pub(crate) struct Request {
    pub(crate) method: String,
    pub(crate) path: String,
    pub(crate) body: Vec<u8>,
}

pub(crate) enum ParseResult {
    Pending,
    Ready(Request),
    Refuse,
}

pub(crate) fn parse(buffer: &[u8]) -> ParseResult {
    let Some((head_len, body_start)) = head_end(buffer) else {
        return if buffer.len() > MAX_HEAD {
            ParseResult::Refuse
        } else {
            ParseResult::Pending
        };
    };
    if head_len > MAX_HEAD {
        return ParseResult::Refuse;
    }
    let Ok(head) = str::from_utf8(&buffer[..head_len]) else {
        return ParseResult::Refuse;
    };
    let Some((method, path)) = request_line(head) else {
        return ParseResult::Refuse;
    };
    let Some(length) = content_length(head) else {
        return ParseResult::Refuse;
    };
    if length > MAX_BODY {
        return ParseResult::Refuse;
    }
    let Some(body_end) = body_start.checked_add(length) else {
        return ParseResult::Refuse;
    };
    if buffer.len() < body_end {
        return ParseResult::Pending;
    }
    if buffer.len() != body_end {
        return ParseResult::Refuse;
    }
    ParseResult::Ready(Request {
        method,
        path,
        body: buffer[body_start..body_end].to_vec(),
    })
}

fn head_end(buffer: &[u8]) -> Option<(usize, usize)> {
    if let Some(index) = find_bytes(buffer, b"\r\n\r\n") {
        return Some((index, index + 4));
    }
    find_bytes(buffer, b"\n\n").map(|index| (index, index + 2))
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn request_line(head: &str) -> Option<(String, String)> {
    let mut parts = head.lines().next()?.split_whitespace();
    Some((parts.next()?.to_string(), parts.next()?.to_string()))
}

fn content_length(head: &str) -> Option<usize> {
    let mut length = None;
    for line in head.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("transfer-encoding") {
            return None;
        }
        if name.trim().eq_ignore_ascii_case("content-length") {
            if length.is_some() {
                return None;
            }
            length = Some(value.trim().parse().ok()?);
        }
    }
    Some(length.unwrap_or(0))
}
