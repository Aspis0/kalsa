//! The tester's report: the log files joined and trimmed into one body,
//! sent to the one endpoint. The tester presses a button, and a serious
//! telemetry error sends the same body the same way on its own (see
//! `telemetry::log`).
//!
//! The body is the same two files the log folder holds, oldest first
//! behind a one-line separator, kept to the newest [`MAX_BYTES`] cut at a
//! line boundary. The transport is ureq, the client the app already runs
//! on for every download, with a 30-second budget and nothing else: no
//! retries, no queue — a press that fails is a sentence on the screen.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The one endpoint a report ever goes to.
pub(crate) const ENDPOINT: &str = "https://kalsa.io/report";
/// The body's ceiling: the newest this many bytes of EACH file, and the
/// joined body at most this many too.
pub(crate) const MAX_BYTES: usize = 4 * 1024 * 1024;
/// The single request's whole budget, connect included.
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

/// The halves oldest-first behind one separator line — an empty half
/// contributes nothing.
pub(crate) fn join_halves(halves: Vec<String>) -> String {
    let present: Vec<&str> = halves
        .iter()
        .map(|half| half.as_str())
        .filter(|half| !half.trim().is_empty())
        .collect();
    match present.len() {
        0 => String::new(),
        1 => present[0].to_string(),
        _ => format!("{}\n{SEPARATOR}\n{}", present[0], present[1]),
    }
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
/// if it is there, then the live one — and builds the body: the newest
/// [`MAX_BYTES`] of EACH file (read from the end, so a file grown past the
/// cap contributes its tail), joined oldest-first behind one separator.
/// The read holds the logger's write lock, so the snapshot is between two
/// lines rather than mid-write. A file that is there but cannot be read is
/// REPORTED as one note line in the body, never silently dropped; a folder
/// with nothing in it answers empty, and the command refuses that before
/// any network is touched. The body then meets the sink's own redaction:
/// the files can hold lines an older build wrote before the sink learned to
/// redact, and this body is uploaded as it sits, so the joined body goes
/// through the same rule here, before any send.
///
/// The engine's stderr file (`kalsa-engine.log`, beside these two) is
/// deliberately NOT a half: its lines pass the drain's denylist, but they
/// never pass the sink's redaction this body is built on, so sending it
/// would upload home paths and hostnames the log's promise keeps back. It
/// stays a local diagnostic.
pub(crate) fn read_body(log_dir: &Path) -> String {
    let body = crate::logging::with_log_held(|| {
        let halves = [
            read_half(&log_dir.join("kalsa-brain.1.log"), "the earlier log file"),
            read_half(&log_dir.join("kalsa-brain.log"), "the live log file"),
        ];
        let mut parts: Vec<String> = Vec::new();
        let mut notes: Vec<String> = Vec::new();
        for half in halves {
            match half {
                Some(Half {
                    text: Some(text), ..
                }) if !text.trim().is_empty() => parts.push(text),
                Some(Half {
                    unreadable_note: Some(note),
                    ..
                }) => notes.push(note),
                _ => {}
            }
        }
        let mut body = join_halves(parts);
        for note in notes {
            body.push_str(&note);
            body.push('\n');
        }
        body
    });
    // The trim comes first, so the pass runs over at most four MiB, and once
    // more after it: a redaction can lengthen what it replaces (a
    // three-letter account name becomes `<user>`), and the cap is the cap.
    // Both are outside the logger's lock, so neither holds a writer.
    trim_to_newest(crate::logging::redact_str(&trim_to_newest(body)))
}

/// One half of the body: the file's last [`MAX_BYTES`] bytes as text,
/// starting at a line boundary. `None` is a file that is not there (an
/// ordinary absence); [`Half::unreadable_note`] says so in the body's own
/// words when the file IS there and cannot be read.
fn read_half(path: &PathBuf, name: &str) -> Option<Half> {
    if !path.exists() {
        return None;
    }
    let opened = std::fs::File::open(path).and_then(|mut file| {
        let len = file.metadata()?.len();
        if len > MAX_BYTES as u64 {
            file.seek(SeekFrom::End(-(MAX_BYTES as i64)))?;
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        Ok(bytes)
    });
    match opened {
        Ok(bytes) => {
            let mut text = String::from_utf8_lossy(&bytes).into_owned();
            // The seek can land mid-line or mid-character: the first
            // partial line is not a line, and it goes.
            if bytes.len() == MAX_BYTES {
                text = text
                    .split_once('\n')
                    .map(|(_, rest)| rest.to_string())
                    .unwrap_or_default();
            }
            Some(Half {
                text: Some(text),
                unreadable_note: None,
            })
        }
        Err(_) => Some(Half {
            text: None,
            unreadable_note: Some(format!("[{name} was there but could not be read]")),
        }),
    }
}

/// What one file contributed.
struct Half {
    text: Option<String>,
    unreadable_note: Option<String>,
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
/// string that broke the server's shape fails here and not as a 400. The
/// agent takes HTTPS only and follows no redirect: the report goes to the
/// one endpoint or nowhere, and a 3xx is a failure the mapping words. A
/// network-level failure (DNS, connect, silence) is `offline`; the
/// server's own answers go through [`map_response`].
pub(crate) fn send(body: &str, header: &str) -> Result<String, SendFailure> {
    if !header_is_well_formed(header) {
        return Err(SendFailure::Failed);
    }
    let agent = ureq::AgentBuilder::new()
        .https_only(true)
        .redirects(0)
        .timeout_connect(SEND_TIMEOUT)
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
        let body = join_halves(vec![
            "older line\nolder line 2\n".to_string(),
            "newer line\n".to_string(),
        ]);
        // Each file ends in its own newline; the separator is one line of
        // its own between them.
        assert_eq!(
            body,
            "older line\nolder line 2\n\n──────── earlier log ────────\nnewer line\n"
        );
        // A missing half contributes nothing, not an empty half with a
        // separator.
        assert_eq!(join_halves(vec!["newer line\n".to_string()]), "newer line\n");
        assert_eq!(join_halves(vec!["older\n".to_string()]), "older\n");
        assert_eq!(join_halves(Vec::new()), "");
        assert_eq!(join_halves(vec!["  \n".to_string(), String::new()]), "");
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
        let kept = trim_to_newest(huge.clone());
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
        assert_eq!(trim_to_newest("small\n".to_string()), "small\n");
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
        // No redirects are followed: a 3xx reaches the mapping as a failure.
        assert_eq!(map_response(302, "found"), Err(SendFailure::Failed));
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-report-{name}-{}",
            std::process::id() as u64 + std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos() as u64
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    /// The body as the folder answers it: the rotated file first, then the
    /// live one, one separator between; an absent file contributes nothing.
    #[test]
    fn the_body_reads_the_folder_oldest_first_behind_one_separator() {
        let dir = scratch("read");
        std::fs::write(dir.join("kalsa-brain.1.log"), "older\n").unwrap();
        std::fs::write(dir.join("kalsa-brain.log"), "newer\n").unwrap();
        // Each file ends in its own newline; the separator is one line of
        // its own between them.
        assert_eq!(
            read_body(&dir),
            "older\n\n──────── earlier log ────────\nnewer\n"
        );
        std::fs::remove_file(dir.join("kalsa-brain.1.log")).unwrap();
        assert_eq!(read_body(&dir), "newer\n");
        let empty = scratch("read-empty");
        assert_eq!(read_body(&empty), "");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&empty);
    }

    /// A file past the cap contributes its LAST [`MAX_BYTES`], cut at a
    /// line boundary — per file, so each half is bounded on its own.
    #[test]
    fn each_file_contributes_its_own_last_four_mib_at_a_line_boundary() {
        let dir = scratch("tail");
        let line = "0123456789abcdef\n";
        std::fs::write(
            dir.join("kalsa-brain.1.log"),
            line.repeat(MAX_BYTES / line.len() + 10),
        )
        .unwrap();
        std::fs::write(dir.join("kalsa-brain.log"), "the newest line\n").unwrap();
        let body = read_body(&dir);
        assert!(body.ends_with("the newest line\n"), "{body:.80}");
        assert!(body.contains(SEPARATOR));
        let first_line = body.split('\n').next().unwrap_or_default();
        assert_eq!(
            first_line, "0123456789abcdef",
            "the cut lands at a line boundary, so the first line is a whole one"
        );
        let older = body.split(SEPARATOR).next().unwrap();
        assert!(
            older.len() <= MAX_BYTES,
            "each half is bounded on its own: {}",
            older.len()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The unreadable-file note rides INSIDE the cap: a body at the
    /// ceiling plus its notes would otherwise be over the ceiling, and the
    /// note is the newest line there is.
    #[test]
    fn the_unreadable_note_rides_inside_the_four_mib_cap() {
        // A live file past the cap beside an unreadable rotated half: the
        // body the command would send must respect the cap WITH the note
        // inside it, and the note — the newest line — must survive.
        let dir = scratch("note-cap");
        let line = "0123456789abcdef\n";
        std::fs::write(
            dir.join("kalsa-brain.log"),
            line.repeat(MAX_BYTES / line.len() + 10),
        )
        .unwrap();
        std::fs::create_dir_all(dir.join("kalsa-brain.1.log")).unwrap();
        let body = read_body(&dir);
        assert!(
            body.len() <= MAX_BYTES,
            "the cap covers the notes too: {}",
            body.len()
        );
        assert!(
            body.ends_with("[the earlier log file was there but could not be read]\n"),
            "the note survives as the newest line"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A file that is there and cannot be read is REPORTED in the body —
    /// the tester must know a half is missing, and so must we.
    #[test]
    fn an_unreadable_half_is_said_in_the_body_not_dropped() {
        let dir = scratch("unreadable");
        // A directory where the file should be: present, unopenable.
        std::fs::create_dir_all(dir.join("kalsa-brain.1.log")).unwrap();
        std::fs::write(dir.join("kalsa-brain.log"), "readable\n").unwrap();
        let body = read_body(&dir);
        assert!(
            body.contains("[the earlier log file was there but could not be read]"),
            "{body}"
        );
        assert!(body.contains("readable"), "{body}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The files can hold lines an older build wrote before the sink
    /// redacted addresses, and the body is uploaded as it sits: the read
    /// puts it through the sink's own rule — every non-loopback literal
    /// becomes `<addr>`, IPv4 and IPv6, the port beside it kept, and
    /// loopback left alone.
    #[test]
    fn an_old_style_line_loses_its_addresses_and_keeps_loopback() {
        let dir = scratch("old-addresses");
        std::fs::write(
            dir.join("kalsa-brain.log"),
            concat!(
                "INFO iroh::socket::transports: poll_send; network_path=Ip { remote: 203.0.113.7:41641 }\n",
                "INFO iroh::socket::transports: poll_send; remote=[2001:db8::5]:49755\n",
                "the door listens on 127.0.0.1:8131 and [::1]:8131\n",
            ),
        )
        .unwrap();
        let body = read_body(&dir);
        assert!(!body.contains("203.0.113.7"), "{body}");
        assert!(!body.contains("2001:db8::5"), "{body}");
        assert!(
            body.contains("<addr>:41641"),
            "the port beside a redacted IPv4 stays: {body}"
        );
        assert!(
            body.contains("[<addr>]:49755"),
            "the port beside a redacted IPv6 stays: {body}"
        );
        assert!(
            body.contains("127.0.0.1:8131") && body.contains("[::1]:8131"),
            "loopback stays, IPv4 and IPv6: {body}"
        );
        assert_eq!(body.matches("<addr>").count(), 2, "{body}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
