//! The record a model file carries beside it once its bytes have been read
//! whole and matched their pin.
//!
//! Reading 22 GB is a minute of silence on the way to a running assistant,
//! and the file on disk is the same file it was last launch. So the read
//! that ends in a match is written down — the pin, the size, the
//! modification time, the file id — and the next launch compares the file
//! against that line before reading a byte. Only a full match skips the
//! read; a size or a time that moved, a file id that changed, a pin the
//! record does not name, a record that cannot be parsed: each falls back to
//! the sha256. The trust this buys is the trust a build system's stamp
//! carries — a replacement that keeps the size, the time and the id is
//! indistinguishable from the file that was read.

use std::fs::Metadata;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// The suffix the record carries: `Qwen….gguf` → `Qwen….gguf.verified`.
const SUFFIX: &str = ".verified";

/// What a proven file looked like when it was last read whole.
pub(crate) struct Stamp {
    size: u64,
    /// Nanoseconds since the epoch, as the platform's clock reports them,
    /// so the same reading comes back on the next launch.
    modified_nanos: u128,
    /// The file id where the platform has one — a Unix inode — so a
    /// replacement that restored the time is still caught; zero where it
    /// does not.
    id: u64,
}

impl Stamp {
    /// The stamp of an open file, or `None` when its modification time is
    /// not a moment this record can hold (before 1970, or unreadable), so
    /// such a file is read whole every time rather than trusted against a
    /// borrowed zero.
    pub(crate) fn of(meta: &Metadata) -> Option<Self> {
        let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
        Some(Self {
            size: meta.len(),
            modified_nanos: modified.as_nanos(),
            id: file_id(meta),
        })
    }
}

/// The file's own id where the platform keeps one: the Windows handle's
/// lives behind an unstable feature, and a missing id only makes the record
/// weaker, never wrong — the size and the time still stand.
#[cfg(unix)]
fn file_id(meta: &Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    meta.ino()
}

#[cfg(not(unix))]
fn file_id(_meta: &Metadata) -> u64 {
    0
}

/// Whether the record beside `path` names this pin and this stamp, so the
/// bytes need not be read again.
pub(crate) fn unchanged(path: &Path, sha: &str, stamp: &Stamp) -> bool {
    let Some(record) = read(&record_path(path)) else {
        return false;
    };
    record.sha.eq_ignore_ascii_case(sha)
        && record.stamp.size == stamp.size
        && record.stamp.modified_nanos == stamp.modified_nanos
        && record.stamp.id == stamp.id
}

/// Writes the record beside `path` after a proof that held. A record that
/// cannot be written costs the next launch a re-read, never the proof.
pub(crate) fn record(path: &Path, sha: &str, stamp: &Stamp) {
    let line = format!(
        "{sha} {} {} {}\n",
        stamp.size, stamp.modified_nanos, stamp.id
    );
    let _ = std::fs::write(record_path(path), line);
}

/// The record's own path, beside the file it describes — the place the
/// drafter's failure marker already uses.
fn record_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    name.push(SUFFIX);
    path.with_file_name(name)
}

/// One record line's fields, or `None` when the file is missing or does not
/// hold exactly them: a record that cannot be read is no record.
fn read(path: &Path) -> Option<Record> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut fields = text.split_whitespace();
    let sha = fields.next()?.to_string();
    let stamp = Stamp {
        size: fields.next()?.parse().ok()?,
        modified_nanos: fields.next()?.parse().ok()?,
        id: fields.next()?.parse().ok()?,
    };
    fields.next().is_none().then_some(Record { sha, stamp })
}

struct Record {
    sha: String,
    stamp: Stamp,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kalsa-verified-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    fn stamp_of(path: &Path) -> Stamp {
        Stamp::of(&std::fs::metadata(path).expect("stat")).expect("a stamp")
    }

    /// The recorded pin and stamp answer; every difference — another pin,
    /// another byte under the same name, another size, a record that is not
    /// one — reads again.
    #[test]
    fn a_recorded_file_answers_and_every_difference_re_reads() {
        let dir = scratch("roundtrip");
        let path = dir.join("model.gguf");
        std::fs::write(&path, b"the bytes").expect("write");
        let sha = "a".repeat(64);
        assert!(
            !unchanged(&path, &sha, &stamp_of(&path)),
            "no record is not a match"
        );
        record(&path, &sha, &stamp_of(&path));
        assert!(unchanged(&path, &sha, &stamp_of(&path)));
        assert!(
            !unchanged(&path, &"b".repeat(64), &stamp_of(&path)),
            "a pin the record does not name"
        );
        // The same name and size, another byte: the time is the signal.
        std::fs::write(&path, b"other one").expect("write");
        assert!(!unchanged(&path, &sha, &stamp_of(&path)));
        // A size that moved is the other signal, and a record that is not
        // one — or misses a field — is no record at all.
        std::fs::write(&path, b"a longer set of bytes").expect("write");
        assert!(!unchanged(&path, &sha, &stamp_of(&path)), "the size moved");
        record(&path, &sha, &stamp_of(&path));
        assert!(unchanged(&path, &sha, &stamp_of(&path)));
        std::fs::write(record_path(&path), "not a record\n").expect("write");
        assert!(!unchanged(&path, &sha, &stamp_of(&path)));
        std::fs::write(record_path(&path), format!("{sha} 1 2\n")).expect("write");
        assert!(
            !unchanged(&path, &sha, &stamp_of(&path)),
            "a record missing a field is no record"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A replacement that restored the time is another file: the inode says
    /// so on the platforms that have one.
    #[cfg(unix)]
    #[test]
    fn a_replaced_file_with_the_restored_time_is_still_caught() {
        let dir = scratch("replaced");
        let path = dir.join("model.gguf");
        std::fs::write(&path, b"the bytes").expect("write");
        let sha = "c".repeat(64);
        let stamp = stamp_of(&path);
        record(&path, &sha, &stamp);
        let modified = std::fs::metadata(&path)
            .expect("stat")
            .modified()
            .expect("mtime");
        // A file that exists while the old one does cannot be handed the
        // old one's inode, so the replacement is guaranteed to be another
        // file even where inode numbers are reused.
        let replacement = dir.join("replacement.gguf");
        std::fs::write(&replacement, b"the bytes").expect("write");
        std::fs::rename(&replacement, &path).expect("replace");
        std::fs::File::open(&path)
            .expect("open")
            .set_modified(modified)
            .expect("restore the time");
        let replacement = stamp_of(&path);
        assert_eq!(replacement.modified_nanos, stamp.modified_nanos);
        assert_ne!(replacement.id, stamp.id, "the replacement is another file");
        assert!(!unchanged(&path, &sha, &replacement));
        std::fs::remove_dir_all(&dir).ok();
    }
}
