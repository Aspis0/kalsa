//! The upstream response head. The door reads it for one decision only —
//! is this answer an event stream the door must take custody of? — and
//! otherwise leaves the upstream's bytes untouched. Anything unusual or
//! malformed falls back to the raw relay, which is what the door has always
//! done with what it does not understand.

use std::io::Read;
use std::net::TcpStream;
use std::time::{Duration, Instant};

use crate::chunk::Dechunker;
use crate::clocks::patience;
use crate::proxy::{is_silence, Cancel};

pub(super) const MAX_HEAD: usize = 32 * 1024;

pub(super) struct Head {
    /// The exact bytes read from the upstream, for the raw relay path.
    pub(super) raw: Vec<u8>,
    /// Status 200 with `Content-Type: text/event-stream`.
    pub(super) event_stream: bool,
    /// The body is chunked, so the door can see its terminal chunk.
    pub(super) chunked: bool,
}

/// `waiting` is the caller's cancel and idle bound when the head of a model's
/// answer is being read: the engine sends it once it starts on the request,
/// which on a busy seat can be well past one patience, so a quiet read is
/// waited through (the deadline, the cancel and the idle bound still end it).
/// `None` keeps the single patience for the door's own short calls.
pub(super) fn read_upstream_head(
    stream: &mut TcpStream,
    deadline: Instant,
    waiting: Option<(&Cancel, Duration)>,
) -> std::io::Result<Head> {
    let begun = Instant::now();
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
            Err(error)
                if is_silence(&error)
                    && waiting.is_some_and(|(cancel, idle)| !cancel.stopped() && begun.elapsed() < idle) =>
            {
                arm_read_timeout(stream, deadline)?;
            }
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
    let timeout = remaining.min(patience());
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
/// and keep-alive — and, like every relayed head, made to say that it varies
/// by origin when the upstream named one.
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
    with_origin_vary(&out)
}

/// A rewritten answer is small — a props body and a chat template — and the
/// frame that says otherwise is refused rather than allocated.
const MAX_BODY: usize = 8 * 1024 * 1024;

/// A complete upstream body for an answer the door will rewrite: framed by
/// Content-Length or by chunks. Any other framing is refused — the caller
/// must either rewrite the body or answer with an error, never relay bytes
/// it did not read.
pub(super) fn read_body(
    stream: &mut TcpStream,
    head: &Head,
    deadline: Instant,
) -> std::io::Result<Vec<u8>> {
    if head.chunked {
        arm_read_timeout(stream, deadline)?;
        let mut dechunker = Dechunker::new();
        let mut out = Vec::new();
        let mut buffer = [0u8; 16 * 1024];
        loop {
            let read = stream.read(&mut buffer)?;
            if read == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "the chunked body ended before its last chunk",
                ));
            }
            dechunker
                .feed(&buffer[..read], &mut out)
                .map_err(|_| {
                    std::io::Error::new(std::io::ErrorKind::InvalidData, "a malformed chunk")
                })?;
            if out.len() > MAX_BODY {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "the upstream body is too large to rewrite",
                ));
            }
            if dechunker.is_done() {
                return Ok(out);
            }
        }
    }
    let length = content_length(&head.raw)?;
    if length > MAX_BODY {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "the upstream body is too large to rewrite",
        ));
    }
    arm_read_timeout(stream, deadline)?;
    let mut out = vec![0u8; length];
    stream.read_exact(&mut out)?;
    Ok(out)
}

/// The one `Content-Length` the head declares: two of them (or one that is
/// not a number) is refused rather than guessed at.
fn content_length(raw: &[u8]) -> std::io::Result<usize> {
    let text_end = raw.len() - 4;
    let mut found: Option<usize> = None;
    for line in raw[..text_end].split(|byte| *byte == b'\n') {
        let line = strip_cr(line);
        let Some(colon) = line.iter().position(|byte| *byte == b':') else {
            continue;
        };
        if !line[..colon].eq_ignore_ascii_case(b"content-length") {
            continue;
        }
        if found.is_some() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "two content-lengths in one head",
            ));
        }
        let text = String::from_utf8_lossy(&line[colon + 1..]);
        found = Some(text.trim().parse::<usize>().map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "a content-length that is not a number")
        })?);
    }
    found.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "the body declares no length",
        )
    })
}

/// The body with the machine's model path out of it: the same JSON, every
/// field but that one. `None` when the bytes are not a JSON object — the
/// caller answers with an error instead, because leaking the path is worse
/// than a failed answer.
pub(super) fn without_model_path(body: &[u8]) -> Option<Vec<u8>> {
    let mut value: serde_json::Value = serde_json::from_slice(body).ok()?;
    let object = value.as_object_mut()?;
    object.remove("model_path");
    serde_json::to_vec(&value).ok()
}

/// The one header the door adds to a head it relays.
const VARY_ORIGIN: &[u8] = b"Vary: Origin\r\n";

/// A relayed head, with the one addition the browser's CORS rules require: an
/// answer that names an origin must also say that it varies by one, or a cache
/// between the upstream and the browser can hand that answer to a different
/// origin. The upstream this app launches names the origin and says nothing
/// about varying (measured: `llama-server` 10360, default `--cors-origins *`).
///
/// Exactly one thing may happen to these bytes, and only when it must:
/// `Vary: Origin` is inserted after the permission line. A `Vary` field
/// carrying other names is left exactly as the upstream sent it and the origin
/// arrives as a field beside it — RFC 9110 §12.5.5 combines multiple `Vary`
/// fields into the one list — and a head that names no origin, or already says
/// it varies by one, comes back untouched. A header line does not change the
/// length of the body that follows it, so the body still moves byte for byte.
pub(super) fn with_origin_vary(upstream: &[u8]) -> Vec<u8> {
    if !upstream.ends_with(b"\r\n\r\n") {
        return upstream.to_vec();
    }
    // The head is the bytes before the blank line that ends it; the offset is
    // kept without a second pass so the line can be spliced in exactly there.
    let head = &upstream[..upstream.len() - 2];
    let mut permission_end = None;
    let mut marked = false;
    let mut offset = 0;
    for line in head.split_inclusive(|byte| *byte == b'\n') {
        if let Some(colon) = line.iter().position(|byte| *byte == b':') {
            let name = &line[..colon];
            if name.eq_ignore_ascii_case(b"access-control-allow-origin") {
                permission_end = Some(offset + line.len());
            } else if name.eq_ignore_ascii_case(b"vary") && names_origin(&line[colon + 1..]) {
                marked = true;
            }
        }
        offset += line.len();
    }
    let Some(at) = permission_end.filter(|_| !marked) else {
        return upstream.to_vec();
    };
    let mut out = Vec::with_capacity(upstream.len() + VARY_ORIGIN.len());
    out.extend_from_slice(&upstream[..at]);
    out.extend_from_slice(VARY_ORIGIN);
    out.extend_from_slice(&upstream[at..]);
    out
}

/// Whether a `Vary` field value names `Origin` among the field names it
/// lists. Anything else in it belongs to the upstream.
fn names_origin(value: &[u8]) -> bool {
    value
        .split(|byte| *byte == b',')
        .any(|name| name.trim_ascii().eq_ignore_ascii_case(b"origin"))
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

    /// The streaming head is the one the webview actually reads for a chat
    /// answer, and the upstream's CORS header on it is not framing: the door
    /// replaces the framing, and must not take the origin with it.
    #[test]
    fn the_streaming_head_keeps_the_upstreams_cors_header() {
        let head = client_head(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\
              Access-Control-Allow-Origin: tauri://localhost\r\n\
              Transfer-Encoding: chunked\r\n\r\n",
        );
        let text = String::from_utf8(head).unwrap();
        assert_eq!(
            text.matches("Access-Control-Allow-Origin").count(),
            1,
            "the streaming answer must carry the upstream's one CORS header: {text}"
        );
        assert!(text.contains("Access-Control-Allow-Origin: tauri://localhost\r\n"));
        assert_eq!(
            text.matches("Vary: Origin\r\n").count(),
            1,
            "the re-framed head must say it varies by origin exactly once: {text}"
        );
        assert!(!text.contains("Transfer-Encoding"));
    }

    /// The heads the rule must not touch: one that already says it varies by
    /// origin — as a field of its own or inside the upstream's list — and one
    /// that never named an origin at all.
    #[test]
    fn a_relayed_head_that_needs_nothing_comes_back_byte_for_byte() {
        for head in [
            &b"HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: x\r\nVary: Origin\r\n\r\n"[..],
            b"HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: x\r\n\
              Vary: Accept-Encoding, Origin\r\n\r\n",
            b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n",
        ] {
            assert_eq!(
                with_origin_vary(head),
                head,
                "a head that needs nothing was edited"
            );
        }
    }
}
