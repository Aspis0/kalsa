//! The tester's report: the log files joined and trimmed into one body,
//! sent to the one endpoint — only ever on a press, never automatically.
//!
//! The body is the same two files the log folder holds, oldest first
//! behind a one-line separator, kept to the newest [`MAX_BYTES`] cut at a
//! line boundary. The transport is ureq, the client the app already runs
//! on for every download, with a 30-second budget and nothing else: no
//! retries, no queue — a press that fails is a sentence on the screen.

use std::path::Path;
use std::time::Duration;

/// The one endpoint a report ever goes to.
pub(crate) const ENDPOINT: &str = "https://kalsa.io/report";
/// The body's ceiling: the newest this many bytes, cut at a line boundary.
pub(crate) const MAX_BYTES: usize = 4 * 1024 * 1024;
/// The single request's whole budget.
const SEND_TIMEOUT: Duration = Duration::from_secs(30);
/// The one line between the rotated file and the live one.
const SEPARATOR: &str = "──────── earlier log ────────";

/// Why a send failed, as the page can word it. The codes are stable: the
/// UI maps them, the words may move.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SendFailure {
    RateLimited,
    TryTomorrow,
    /// No network reached, or none answered.
    Offline,
    /// Everything else, including a `payload_too_large` the trim should
    /// have made impossible.
    Failed,
}

impl SendFailure {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            SendFailure::RateLimited => "rate_limited",
            SendFailure::TryTomorrow => "try_tomorrow",
            SendFailure::Offline => "offline",
            SendFailure::Failed => "failed",
        }
    }
}

/// The report body: the rotated file (the older one) first, then the live
/// file, one separator line between them; the newest [`MAX_BYTES`] when
/// the two together are longer, cut at a line boundary so the body still
/// reads as lines. An empty half contributes nothing — no separator for a
/// missing file.
pub(crate) fn report_text(rotated: Option<&str>, live: Option<&str>) -> String {
    let halves: Vec<&str> = [rotated.unwrap_or(""), live.unwrap_or("")]
        .into_iter()
        .filter(|half| !half.trim().is_empty())
        .collect();
    let joined = match halves.len() {
        0 => return String::new(),
        1 => halves[0].to_string(),
        _ => format!("{}\n{SEPARATOR}\n{}", halves[0], halves[1]),
    };
    trim_to_newest(joined)
}

/// The newest [`MAX_BYTES`] of a body, cut at a line boundary. A body with
/// no newline past the cut keeps its newest bytes anyway — one runaway
/// line is not a reason to send nothing.
fn trim_to_newest(text: String) -> String {
    if text.len() <= MAX_BYTES {
        return text;
    }
    let mut cut = text.len() - MAX_BYTES;
    while !text.is_char_boundary(cut) {
        cut += 1;
    }
    match text[cut..].find('\n') {
        Some(newline) => text[cut + newline + 1..].to_string(),
        None => text[cut..].to_string(),
    }
}

/// The `X-Kalsa-App` value: `<version>/<os>/<arch>`, exactly the shape the
/// server's own check reads (`^[0-9A-Za-z._-]{1,32}/[a-z0-9_]{1,16}/[a-z0-9_]{1,16}$`).
pub(crate) fn app_header(version: &str, os: &str, arch: &str) -> String {
    format!("{version}/{os}/{arch}")
}

/// The server's shape, hand-checked: no regex crate for one pattern. The
/// first segment carries dots and dashes (a semver pre-release); the other
/// two are the platform names `std::env::consts` already spells the way
/// the server expects.
pub(crate) fn header_is_well_formed(value: &str) -> bool {
    let segments: Vec<&str> = value.split('/').collect();
    if segments.len() != 3 {
        return false;
    }
    let word = |text: &str| !text.is_empty() && text.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    let version = |text: &str| {
        (1..=32).contains(&text.chars().count())
            && text
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    };
    version(segments[0]) && word(segments[1]) && word(segments[2])
}

/// Reads the two log files as they sit in the log folder — the rotated one
/// if it is there, then the live one — and builds the body. A folder with
/// nothing in it answers empty, and the command refuses that before any
/// network is touched.
pub(crate) fn read_body(log_dir: &Path) -> String {
    let rotated = std::fs::read_to_string(log_dir.join("kalsa-brain.1.log")).ok();
    let live = std::fs::read_to_string(log_dir.join("kalsa-brain.log")).ok();
    report_text(rotated.as_deref(), live.as_deref())
}

/// What the server answered, as the page can word it: 201 with an id is
/// the only success; the named errors keep their own stable codes; a body
/// that is not the JSON it should be reads as `failed`, never as a parse
/// panic.
pub(crate) fn map_response(status: u16, body: &str) -> Result<String, SendFailure> {
    let parsed: Option<serde_json::Value> = serde_json::from_str(body).ok();
    if status == 201 {
        return match parsed.as_ref().and_then(|value| value["id"].as_str()) {
            Some(id) => Ok(id.to_string()),
            None => Err(SendFailure::Failed),
        };
    }
    let code = parsed
        .as_ref()
        .and_then(|value| value["error"]["code"].as_str())
        .unwrap_or_default();
    match (status, code) {
        (429, "rate_limited") => Err(SendFailure::RateLimited),
        (503, "daily_limit") => Err(SendFailure::TryTomorrow),
        (413, "payload_too_large") => Err(SendFailure::Failed),
        _ => match code {
            "rate_limited" => Err(SendFailure::RateLimited),
            "daily_limit" => Err(SendFailure::TryTomorrow),
            _ => Err(SendFailure::Failed),
        },
    }
}

/// The one send. `ureq` sets `Content-Length` for a string body itself;
/// the two headers that are ours are the content type and the app stamp —
/// and the stamp is checked before the network is touched, so a version
/// string that broke the server's shape fails here and not as a 400. A
/// network-level failure (DNS, connect, silence) is `offline`; the
/// server's own answers go through [`map_response`].
pub(crate) fn send(body: &str, header: &str) -> Result<String, SendFailure> {
    if !header_is_well_formed(header) {
        return Err(SendFailure::Failed);
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(SEND_TIMEOUT)
        .build();
    let request = agent
        .post(ENDPOINT)
        .set("Content-Type", "text/plain; charset=utf-8")
        .set("X-Kalsa-App", header);
    match request.send_string(body) {
        Ok(response) => map_response(response.status(), &response.into_string().unwrap_or_default()),
        Err(ureq::Error::Status(code, response)) => {
            map_response(code, &response.into_string().unwrap_or_default())
        }
        Err(ureq::Error::Transport(_)) => Err(SendFailure::Offline),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_body_is_the_rotated_file_then_the_live_one_behind_one_line() {
        let body = report_text(
            Some("older line\nolder line 2\n"),
            Some("newer line\n"),
        );
        // Each file ends in its own newline; the separator is one line of
        // its own between them.
        assert_eq!(
            body,
            "older line\nolder line 2\n\n──────── earlier log ────────\nnewer line\n"
        );
        // A missing half contributes nothing, not an empty half with a
        // separator.
        assert_eq!(report_text(None, Some("newer line\n")), "newer line\n");
        assert_eq!(report_text(Some("older\n"), None), "older\n");
        assert_eq!(report_text(None, None), "");
        assert_eq!(report_text(Some("  \n"), Some("")), "");
    }

    #[test]
    fn a_body_past_four_mib_keeps_the_newest_cut_at_a_line_boundary() {
        // Numbered lines, so a survivor can be told from a dropped line.
        let mut huge = String::new();
        let mut number: u64 = 0;
        while huge.len() <= MAX_BYTES + 1024 {
            huge.push_str(&format!("{number:08}\n"));
            number += 1;
        }
        let kept = report_text(Some(&huge), None);
        assert!(
            kept.len() <= MAX_BYTES,
            "the body is at most the cap: {}",
            kept.len()
        );
        assert!(
            kept.ends_with(&format!("{:08}\n", number - 1)),
            "the newest line survives the cut"
        );
        // The cut is at a line boundary: every surviving line still parses
        // as the number it was written as, and the oldest are gone.
        assert!(kept.lines().all(|line| line.parse::<u64>().is_ok()));
        let first: u64 = kept.lines().next().unwrap().parse().unwrap();
        assert!(first > 0, "the oldest lines are dropped, not kept");
        // A body already inside the cap is passed through untouched.
        assert_eq!(report_text(Some("small\n"), None), "small\n");
    }

    #[test]
    fn the_app_header_fits_the_server_s_shape_for_every_platform() {
        for version in ["0.0.1", "10.20.30-rc.4", "1.2.3_4"] {
            for os in ["macos", "windows", "linux"] {
                for arch in ["aarch64", "x86_64"] {
                    let header = app_header(version, os, arch);
                    assert!(
                        header_is_well_formed(&header),
                        "{header} must fit the server's shape"
                    );
                }
            }
        }
        // The shapes the server refuses, so the check is not a tautology.
        for bad in [
            "0.0.1/MacOS/aarch64",
            "0.0.1/macos/ARM64",
            "0.0.1/macos",
            "0.0.1/macos/aarch64/extra",
            "/macos/aarch64",
            "0.0.1//aarch64",
        ] {
            assert!(!header_is_well_formed(bad), "{bad} must be refused");
        }
        let long = "a".repeat(33);
        assert!(!header_is_well_formed(&app_header(&long, "macos", "aarch64")));
    }

    #[test]
    fn every_server_answer_maps_to_a_stable_code() {
        assert_eq!(
            map_response(201, r#"{"id":"K7XQ2M9P"}"#),
            Ok("K7XQ2M9P".to_string())
        );
        assert_eq!(
            map_response(429, r#"{"error":{"code":"rate_limited","message":"slow down"}}"#),
            Err(SendFailure::RateLimited)
        );
        assert_eq!(
            map_response(503, r#"{"error":{"code":"daily_limit","message":"tomorrow"}}"#),
            Err(SendFailure::TryTomorrow)
        );
        assert_eq!(
            map_response(413, r#"{"error":{"code":"payload_too_large","message":"too big"}}"#),
            Err(SendFailure::Failed)
        );
        // The code leads even off its usual status; a body that is not the
        // JSON it should be is a plain failure, never a panic.
        assert_eq!(
            map_response(500, r#"{"error":{"code":"daily_limit","message":""}}"#),
            Err(SendFailure::TryTomorrow)
        );
        assert_eq!(
            map_response(500, "gateway html"),
            Err(SendFailure::Failed)
        );
        assert_eq!(map_response(201, "{}"), Err(SendFailure::Failed));
        assert_eq!(map_response(200, r#"{"id":"nope"}"#), Err(SendFailure::Failed));
    }
}
