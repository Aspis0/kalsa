//! The upstream response head. The door reads it for one decision only —
//! is this answer an event stream the door must take custody of? — and
//! otherwise leaves the upstream's bytes untouched. Anything unusual or
//! malformed falls back to the raw relay, which is what the door has always
//! done with what it does not understand.

use std::io::Read;
use std::net::TcpStream;
use std::time::Instant;

use crate::PATIENCE;

pub(super) const MAX_HEAD: usize = 32 * 1024;

pub(super) struct Head {
    /// The exact bytes read from the upstream, for the raw relay path.
    pub(super) raw: Vec<u8>,
    /// Status 200 with `Content-Type: text/event-stream`.
    pub(super) event_stream: bool,
    /// The body is chunked, so the door can see its terminal chunk.
    pub(super) chunked: bool,
}

pub(super) fn read_upstream_head(stream: &mut TcpStream, deadline: Instant) -> std::io::Result<Head> {
    // The timeout is set once for the whole head: the reads are one byte
    // each (the body must not be swallowed), and re-arming SO_RCVTIMEO per
    // byte only multiplies the odds of hitting the macOS quirk below.
    arm_read_timeout(stream, deadline)?;
    let mut raw = Vec::with_capacity(1024);
    loop {
        if raw.len() == MAX_HEAD {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "upstream response head too large",
            ));
        }
        let mut byte = [0u8; 1];
        match stream.read(&mut byte) {
            Ok(0) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "upstream response ended in the head",
                ));
            }
            Ok(1) => {
                raw.push(byte[0]);
                if raw.ends_with(b"\r\n\r\n") {
                    return Ok(parse(raw));
                }
            }
            Ok(_) => unreachable!("a one-byte read returned more than one byte"),
            Err(error) => return Err(error),
        }
    }
}

/// Arms the read timeout for the response head. macOS can refuse
/// `SO_RCVTIMEO` with `EINVAL` on a perfectly healthy socket under load —
/// a read straight after succeeds — so one refused arm is retried once
/// before being believed.
fn arm_read_timeout(stream: &mut TcpStream, deadline: Instant) -> std::io::Result<()> {
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::TimedOut, "door deadline"))?;
    let timeout = remaining.min(PATIENCE);
    if stream.set_read_timeout(Some(timeout)).is_ok() {
        return Ok(());
    }
    stream.set_read_timeout(Some(timeout))
}

fn parse(raw: Vec<u8>) -> Head {
    let text_end = raw.len() - 4;
    let mut lines = raw[..text_end].split(|byte| *byte == b'\n');
    let status_line = lines
        .next()
        .unwrap_or(&[])
        .strip_suffix(b"\r")
        .unwrap_or(&[]);
    let event_stream_status = status_ok(status_line);
    let mut event_stream_type = false;
    let mut chunked = false;
    for line in lines {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        let Some(colon) = line.iter().position(|byte| *byte == b':') else {
            continue;
        };
        let name = &line[..colon];
        let value = trim(&line[colon + 1..]);
        if name.eq_ignore_ascii_case(b"content-type") {
            event_stream_type = value_starts_with_event_stream(value);
        } else if name.eq_ignore_ascii_case(b"transfer-encoding") {
            chunked = ascii_contains(value, b"chunked");
        }
    }
    Head {
        raw,
        event_stream: event_stream_status && event_stream_type,
        chunked,
    }
}

fn status_ok(line: &[u8]) -> bool {
    // "HTTP/1.1 200 anything" — version, one space, the three status bytes.
    line.len() > 12 && line.starts_with(b"HTTP/") && &line[9..12] == b"200"
}

fn value_starts_with_event_stream(value: &[u8]) -> bool {
    let lower: Vec<u8> = value.to_ascii_lowercase();
    ascii_contains(&lower, b"text/event-stream")
}

fn ascii_contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|window| window == needle)
}

fn trim(value: &[u8]) -> &[u8] {
    let start = value
        .iter()
        .position(|byte| *byte != b' ' && *byte != b'\t');
    match start {
        Some(start) => &value[start..],
        None => &[],
    }
}

/// The head a client receives for a job: the upstream's own status line and
/// headers, with the framing headers replaced — the body is re-framed by the
/// door as close-delimited, so the door must speak for itself about length
/// and keep-alive.
pub(super) fn client_head(upstream: &[u8]) -> Vec<u8> {
    let text_end = upstream.len() - 4;
    let mut lines = upstream[..text_end].split(|byte| *byte == b'\n');
    let mut out = Vec::with_capacity(upstream.len() + 32);
    for line in lines.by_ref().take(1) {
        out.extend_from_slice(strip_cr(line));
        out.extend_from_slice(b"\r\n");
    }
    for line in lines {
        let line = strip_cr(line);
        let is_framing = line
            .split(|byte| *byte == b':')
            .next()
            .is_some_and(|name| {
                name.eq_ignore_ascii_case(b"transfer-encoding")
                    || name.eq_ignore_ascii_case(b"content-length")
                    || name.eq_ignore_ascii_case(b"connection")
                    || name.eq_ignore_ascii_case(b"keep-alive")
            });
        if is_framing {
            continue;
        }
        out.extend_from_slice(line);
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(b"Connection: close\r\n\r\n");
    out
}

fn strip_cr(line: &[u8]) -> &[u8] {
    line.strip_suffix(b"\r").unwrap_or(line)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SSE_HEAD: &[u8] = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n";

    #[test]
    fn an_event_stream_head_is_recognized() {
        let head = parse(SSE_HEAD.to_vec());
        assert!(head.event_stream);
        assert!(head.chunked);
    }

    #[test]
    fn anything_else_is_relayed_raw() {
        let plain = parse(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 5\r\n\r\n".to_vec());
        assert!(!plain.event_stream);
        let refused = parse(b"HTTP/1.1 401 Unauthorized\r\nContent-Type: text/event-stream\r\n\r\n".to_vec());
        assert!(!refused.event_stream);
        let odd = parse(b"garbage\r\n\r\n".to_vec());
        assert!(!odd.event_stream && !odd.chunked);
    }

    #[test]
    fn the_client_head_keeps_everything_but_framing() {
        let head = client_head(SSE_HEAD);
        let text = String::from_utf8(head).unwrap();
        assert!(text.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(text.contains("Content-Type: text/event-stream\r\n"));
        assert!(!text.contains("Transfer-Encoding"));
        assert!(text.ends_with("Connection: close\r\n\r\n"));
    }
}
