//! The engine's stderr, kept: a size-capped rotating file beside the app's
//! other logs.
//!
//! The drain in `child` sees every line the server writes, but the app log
//! carries only the sanitized tail at an exit (40 lines, gone by the next
//! one), so a fact that shows only on stderr — the model entering or
//! leaving its sleeping state above all — vanished unless an exit happened
//! to follow it. This file keeps the stream, capped the way the app's own
//! log is capped: one live file, at most one rotated one, the live file
//! reset in place when a rotation cannot happen. The folder is handed in
//! by the app; nothing here knows where it is.
//!
//! The privacy wall is the drain's denylist (`carries_request_text`), the
//! same wall the app log's stderr lines stand behind: a line that carries
//! request bytes is written as the withheld sentence, never as itself.
//! No other redaction runs here — which is exactly why the Send-report
//! does not read this file (see `src-tauri/src/report.rs`).

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The live file, inside the folder the app hands over.
const LIVE_NAME: &str = "kalsa-engine.log";
/// The previous file, kept beside the live one. Two files, no more — the
/// app's own log follows the same rule.
const ROTATED_NAME: &str = "kalsa-engine.1.log";
/// The live file is rotated when a write would carry it past this.
const CAP_BYTES: u64 = 2 * 1024 * 1024;
/// No single line may be longer than this, whatever the server wrote: a
/// runaway line must not eat the cap on its own. The app log's own rule.
const LINE_CHAR_CAP: usize = 8 * 1024;

pub(crate) struct StderrLog {
    state: Mutex<Option<(File, u64)>>,
    dir: PathBuf,
    cap: u64,
}

impl StderrLog {
    pub(crate) fn open(dir: PathBuf) -> Self {
        Self {
            state: Mutex::new(open_live(&dir)),
            dir,
            cap: CAP_BYTES,
        }
    }

    /// One line, already carried through the drain's denylist pass. A
    /// folder or file that will not take it costs the line, never the
    /// server: a failed write closes the file for this child's life, the
    /// in-memory tail and the exit line keep theirs.
    pub(crate) fn write_line(&self, line: &str) {
        let Ok(mut slot) = self.state.lock() else {
            return;
        };
        if let Some((_, len)) = slot.as_ref() {
            let line_bytes = line.len() as u64 + 1;
            if len + line_bytes > self.cap && self.rotate(&mut slot).is_none() {
                return;
            }
        }
        if let Some((file, len)) = slot.as_mut() {
            let bytes = format!("{line}\n");
            if file.write_all(bytes.as_bytes()).is_ok() {
                *len += bytes.len() as u64;
            } else {
                *slot = None;
            }
        }
    }

    /// The live file becomes the rotated one (replacing whatever rotated
    /// file was there) and a fresh live file takes its place. A rotation
    /// that cannot happen — the folder refusing the rename — resets the
    /// live file in place rather than letting it grow past the cap: the
    /// bound is the point. `None` says no file is left.
    fn rotate(&self, slot: &mut Option<(File, u64)>) -> Option<()> {
        *slot = None;
        let live = self.dir.join(LIVE_NAME);
        let rotated = self.dir.join(ROTATED_NAME);
        let room = std::fs::remove_file(&rotated).is_ok() || !rotated.exists();
        if room && std::fs::rename(&live, &rotated).is_ok() {
            *slot = open_live(&self.dir);
            return slot.as_ref().map(|_| ());
        }
        if let Ok(file) = OpenOptions::new().create(true).append(true).open(&live) {
            if file.set_len(0).is_ok() {
                *slot = Some((file, 0));
            }
        }
        slot.as_ref().map(|_| ())
    }
}

fn open_live(dir: &Path) -> Option<(File, u64)> {
    std::fs::create_dir_all(dir).ok()?;
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(LIVE_NAME))
        .ok()?;
    let len = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    Some((file, len))
}

/// One line as it is written to the file: never longer than
/// [`LINE_CHAR_CAP`] characters, cut on a character boundary with the
/// app log's own marker behind it.
pub(crate) fn clip_line(line: &str) -> String {
    if line.chars().count() <= LINE_CHAR_CAP {
        return line.to_string();
    }
    let mut cut: String = line.chars().take(LINE_CHAR_CAP).collect();
    cut.push_str(" …[truncated]");
    cut
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-stderr-{name}-{}",
            std::process::id() as u64 + std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos() as u64
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    /// A log with the app's 2 MiB cap replaced by one a test can roll over.
    fn with_cap(dir: PathBuf, cap: u64) -> StderrLog {
        let mut log = StderrLog::open(dir);
        log.cap = cap;
        log
    }

    #[test]
    fn lines_reach_the_file_in_order() {
        let dir = scratch("lines");
        let log = StderrLog::open(dir.clone());
        log.write_line("first");
        log.write_line("second");
        assert_eq!(
            std::fs::read_to_string(dir.join(LIVE_NAME)).unwrap(),
            "first\nsecond\n"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_write_past_the_cap_rotates_and_keeps_one_rotated_file() {
        let dir = scratch("rotate");
        // Three 26-byte lines fit under this cap; the fourth forces the
        // first rotation.
        let log = with_cap(dir.clone(), 100);
        for n in 0..6 {
            log.write_line(&format!("line-{n:020}")); // 26 bytes with the newline
        }
        assert!(
            dir.join(ROTATED_NAME).exists(),
            "nothing was rotated out at the cap"
        );
        let rotated = std::fs::read_to_string(dir.join(ROTATED_NAME)).unwrap();
        let live = std::fs::read_to_string(dir.join(LIVE_NAME)).unwrap();
        // The oldest lines live in the rotated file, the newest in the live
        // one, and the live one is back under the cap.
        assert!(rotated.starts_with("line-00000000000000000000"), "{rotated}");
        assert!(live.ends_with("line-00000000000000000005\n"), "{live}");
        assert!(
            (live.len() as u64) <= 100,
            "the live file is past its cap: {live}"
        );
        // A second rollover replaces the rotated file rather than piling up.
        for n in 6..12 {
            log.write_line(&format!("line-{n:020}"));
        }
        let rotated = std::fs::read_to_string(dir.join(ROTATED_NAME)).unwrap();
        assert!(
            rotated.contains("line-00000000000000000008"),
            "the rotation did not take the newest complete file: {rotated}"
        );
        assert!(
            !rotated.contains("line-00000000000000000000"),
            "an older rotated file survived: {rotated}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_runaway_line_is_clipped_not_whole() {
        // The drain clips before it hands the line over (the same pass that
        // filters it); the file writes what it is given.
        let dir = scratch("clip");
        let log = StderrLog::open(dir.clone());
        let long = "x".repeat(LINE_CHAR_CAP + 500);
        log.write_line(&clip_line(&long));
        let written = std::fs::read_to_string(dir.join(LIVE_NAME)).unwrap();
        assert!(written.contains("…[truncated]"), "{:.60}", written);
        assert!(
            written.chars().count() <= LINE_CHAR_CAP + " …[truncated]".len() + 1,
            "the line kept more than its cap"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
