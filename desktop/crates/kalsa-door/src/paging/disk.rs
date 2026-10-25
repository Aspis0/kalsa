//! The save directory read for measurement: how many bytes of saved chat are
//! on it, and how many files those bytes came from.
//!
//! **This is a scan, not a stat.** It walks every entry of the directory the
//! sweep already reads (`paging/sweep`), so it belongs on a poll that asks
//! for the panel's numbers — never on a render, once per frame. It decides
//! nothing and deletes nothing: the sweep keeps the rules, this only weighs.
//!
//! No KB-per-token coefficient lives here on purpose: the measurement
//! (`dev/results/save-on-busy-slot`, `b3ded12`'s artifact) showed the weight
//! per token is not constant (~51.85 KB/token at 603 tokens, ~30.79 at 2529),
//! so a coefficient would freeze a moving ratio into a panel constant.

use std::fs;

use super::Chats;
use crate::RunningDoor;

/// What one scan saw. `unreadable` is the entries whose metadata would not
/// read: they are skipped, never guessed, so `bytes` and `files` are short
/// by exactly that many — a declared partial total instead of an invented
/// complete one.
pub struct DiskUsage {
    /// `fs::metadata().len()` summed over the regular files present.
    pub bytes: u64,
    /// How many regular files those bytes came from.
    pub files: usize,
    /// Entries skipped because their metadata could not be read.
    pub unreadable: usize,
}

impl Chats {
    /// Weighs the save directory: one `fs::metadata().len()` per regular
    /// file, plus the file count. `None` when the directory cannot be read —
    /// a missing or unreadable directory answers the same way, and both mean
    /// "not known": 0 bytes out of a failed read would be a total invented
    /// from a failure.
    ///
    /// Only regular files are weighed: a subdirectory's own length is an
    /// inode's, not its content's, and a symlink's is a link's — neither
    /// says what this tier put on the disk.
    pub(crate) fn disk_usage(&self) -> Option<DiskUsage> {
        let dir = self.dir.as_deref()?;
        let Ok(entries) = fs::read_dir(dir) else {
            return None;
        };
        let mut usage = DiskUsage { bytes: 0, files: 0, unreadable: 0 };
        for entry in entries {
            let Ok(entry) = entry else {
                usage.unreadable += 1;
                continue;
            };
            let Ok(metadata) = entry.metadata() else {
                usage.unreadable += 1;
                continue;
            };
            if !metadata.is_file() {
                continue;
            }
            usage.files += 1;
            usage.bytes += metadata.len();
        }
        Some(usage)
    }
}

impl RunningDoor {
    /// One scan of the save directory, for the panel's disk line. Like the
    /// two counts beside it the call is in-process, not a route — and because
    /// it is a scan, its caller asks on a poll, never on a render.
    pub fn disk_usage(&self) -> Option<DiskUsage> {
        self.chats.disk_usage()
    }
}
