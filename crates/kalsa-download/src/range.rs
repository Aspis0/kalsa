//! Negotiating the resume with the server: what we ask for, and which
//! answers count as an answer.
//!
//! The part file is append-only truth, so a resume may only append a body
//! that provably continues it: a 206 whose `Content-Range` starts exactly at
//! the offset we asked for. A 200 to the Range request — the server ignored
//! it — and a 206 that starts anywhere else get the same treatment: one
//! fresh request, from zero, overwriting the part file rather than gluing a
//! foreign body onto our prefix.

use std::io;
use std::time::Duration;

use crate::DownloadError;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
// Thirty seconds allows several TCP retransmission backoffs; it detects
// silence too long for ordinary recovery, not a slow connection.
pub(crate) const DEFAULT_READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Asks for the suffix at `resume_from` and checks the answer against the
/// header we sent. Returns the response and the offset its body starts at.
pub fn connect(url: &str, resume_from: u64) -> Result<(ureq::Response, u64), DownloadError> {
    connect_with_read_timeout(url, resume_from, DEFAULT_READ_TIMEOUT)
}

pub(crate) fn connect_with_read_timeout(
    url: &str,
    resume_from: u64,
    read_timeout: Duration,
) -> Result<(ureq::Response, u64), DownloadError> {
    if resume_from > 0 {
        let response = send(url, Some(resume_from), read_timeout)?;
        match response.status() {
            // Range ignored: the body is the whole file.
            200 => return Ok((response, 0)),
            206 => match response
                .header("Content-Range")
                .and_then(content_range_start)
            {
                Some(at) if at == resume_from => return Ok((response, resume_from)),
                // Missing or lying: whatever this body is, it does not
                // continue our file.
                _ => {}
            },
            code if (200..300).contains(&code) => return Err(unexpected_success(code)),
            code => return Err(http_error(code)),
        }
    }
    let response = send(url, None, read_timeout)?;
    let start = match response.status() {
        200 => 0,
        // A 206 to a request with no Range is a broken server; its body may
        // only be used if it claims to start at zero.
        206 => response
            .header("Content-Range")
            .and_then(content_range_start)
            .filter(|at| *at == 0)
            .ok_or_else(|| http_error(206))?,
        code if (200..300).contains(&code) => return Err(unexpected_success(code)),
        code => return Err(http_error(code)),
    };
    Ok((response, start))
}

fn send(
    url: &str,
    range: Option<u64>,
    read_timeout: Duration,
) -> Result<ureq::Response, DownloadError> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout_read(read_timeout)
        .build();
    let mut request = agent.get(url);
    if let Some(at) = range {
        // No If-Range alongside this, on purpose: we persist no ETag from the
        // first request, so any validator here would be fabricated — and a
        // made-up one silently converts every resume into a full restart.
        // The sha256 gate in `verify` is what catches a URL whose content
        // changed underneath our prefix.
        request = request.set("Range", &format!("bytes={at}-"));
    }
    request.call().map_err(|e| match e {
        // ureq hands a 4xx/5xx back as an error, not a response: a real
        // 403 or 429 must not wear the connection's sentence, which is
        // what a blanket map_err here once did.
        ureq::Error::Status(code, _) => DownloadError::Refused { status: code },
        ureq::Error::Transport(t) => {
            DownloadError::Network(io::Error::new(io::ErrorKind::Other, t.to_string()))
        }
    })
}

/// Start offset of a `Content-Range: bytes N-M/T` header value, or None when
/// absent or unintelligible — and None is treated as "not a continuation".
fn content_range_start(value: &str) -> Option<u64> {
    let rest = value.trim().strip_prefix("bytes")?.trim_start();
    let range = rest.split('/').next()?;
    range.split('-').next()?.parse().ok()
}

/// An HTTP status is the publisher refusing the download — an answer, not
/// a transport failure — so it carries its own kind: the sentence for a
/// dropped connection would be false, and resuming is not what it calls
/// for.
fn http_error(code: u16) -> DownloadError {
    DownloadError::Refused { status: code }
}

/// A 2xx that is neither 200 nor 206: the origin ALLOWED the request and
/// still served nothing this code can place — a broken exchange, not a
/// refusal, so it rides `Network`, whose sentence's retry can work.
fn unexpected_success(code: u16) -> DownloadError {
    DownloadError::Network(io::Error::new(
        io::ErrorKind::InvalidData,
        format!("unexpected successful status {code}"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::httptest::{self, RangeMode};
    use std::path::PathBuf;

    const SPLIT: u64 = 1024 * 1024;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("kalsa-download-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    fn payload(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i % 251) as u8).collect()
    }

    #[test]
    fn a_content_range_is_parsed_or_distrusted() {
        assert_eq!(content_range_start("bytes 123-456/789"), Some(123));
        assert_eq!(content_range_start("bytes 0-0/1"), Some(0));
        assert_eq!(content_range_start("bytes */789"), None);
        assert_eq!(content_range_start("garbage"), None);
        assert_eq!(content_range_start(""), None);
    }

    #[test]
    fn an_http_status_is_a_refusal_not_a_dropped_connection() {
        // A 403 or a 429 is the publisher answering; only the transport
        // half may ride `Network`, whose sentence says the connection
        // dropped.
        assert!(matches!(http_error(403), DownloadError::Refused { status: 403 }));
        assert!(matches!(http_error(429), DownloadError::Refused { status: 429 }));
        assert_eq!(
            http_error(503).to_string(),
            "the server refused the download: HTTP 503"
        );
    }

    #[test]
    fn a_real_403_over_the_wire_is_a_refusal_not_a_dropped_connection() {
        // ureq hands a 4xx back as an Err, so the old blanket map_err —
        // every error to `Network` — turned a live 403 into "the
        // connection dropped", and only this path through the real
        // request can catch that.
        let dir = scratch("range-wire-refused");
        let server = httptest::serve(payload(64), RangeMode::Refused);
        let err = connect(&server.url, 0).expect_err("a 403 is an error");
        assert!(
            matches!(err, DownloadError::Refused { status: 403 }),
            "{err:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_lying_206_gets_a_fresh_request_not_an_appended_body() {
        let dir = scratch("range-lie");
        let data = payload(3 * SPLIT as usize);
        let server = httptest::serve(data, RangeMode::Lie);
        // The fixture answers 206 with a Content-Range that starts past the
        // prefix we asked to resume; trusting it would glue on a wrong
        // suffix. The right answer is to ask again from zero.
        let (response, start) = connect(&server.url, SPLIT).expect("negotiate");
        assert_eq!(start, 0, "a mismatched Content-Range is not a continuation");
        assert_eq!(response.status(), 200);
        assert_eq!(
            *server.requests.lock().expect("requests"),
            vec![Some(SPLIT), None],
            "the mismatched answer must be replaced by a fresh request"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
