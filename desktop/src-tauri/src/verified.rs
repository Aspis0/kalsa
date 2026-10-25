//! The record a model file carries beside it once its bytes have been read
//! whole and matched their pin.
//!
//! Reading 22 GB is a minute of silence on the way to a running assistant,
//! and the file on disk is the same file it was last launch. So the read
//! that ends in a match is written down — the pin, the size, the
//! modification time, the file id, and a digest of one sample of the file —
//! and the next launch compares the file against that line before reading
//! it whole: the same pin, the same stamp, and a fresh reading of the
//! sample to the same digest. Only all three are answered from the record;
//! a size or a time that moved, a file id that changed, a sample that
//! disagrees, a pin the record does not name, a record that cannot be
//! parsed: each falls back to the whole-file sha256. The sample is the
//! file's first and last four MiB plus sixteen chunks of 256 KiB across the
//! middle, at offsets the size alone decides — ~12 MiB of reads, a fraction
//! of a second where the whole file is a minute — and it is what catches a
//! changed byte inside the sampled ranges when the size, the time and the
//! file id were all kept.

use std::fs::Metadata;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use sha2::{Digest, Sha256};

/// The suffix the record carries: `Qwen….gguf` → `Qwen….gguf.verified`.
const SUFFIX: &str = ".verified";

/// The sample's shape: the file's first and last [`SAMPLE_END`] bytes, plus
/// [`SAMPLE_CHUNKS`] readings of [`SAMPLE_CHUNK`] across what lies between.
const SAMPLE_END: u64 = 4 * 1024 * 1024;
const SAMPLE_CHUNK: u64 = 256 * 1024;
const SAMPLE_CHUNKS: u64 = 16;

/// What a proven file looked like when it was last read whole.
#[derive(Clone, Copy, PartialEq)]
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
/// weaker, never wrong — the size, the time and the sample still stand.
#[cfg(unix)]
fn file_id(meta: &Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    meta.ino()
}

#[cfg(not(unix))]
fn file_id(_meta: &Metadata) -> u64 {
    0
}

/// The stamp worth writing down after a whole-file read: the one taken
/// before it, and only if the file's own stamp after it is the same. A file
/// that moved under the read is not a file the record may describe, and a
/// stamp that cannot be read is no stamp at all.
pub(crate) fn recordable(before: Option<Stamp>, after: Option<Stamp>) -> Option<Stamp> {
    match (before, after) {
        (Some(before), Some(after)) if before == after => Some(before),
        _ => None,
    }
}

/// Whether the record beside `path` says this file is the bytes that were
/// read whole: the pin and the stamp it was written for, and a fresh
/// reading of the sample to the digest it holds.
pub(crate) fn unchanged(path: &Path, sha: &str, stamp: &Stamp) -> bool {
    let Some(record) = read(&record_path(path)) else {
        return false;
    };
    if !record.sha.eq_ignore_ascii_case(sha) || record.stamp != *stamp {
        return false;
    }
    sample_digest(path, stamp.size).is_ok_and(|sample| sample == record.sample)
}

/// Writes the record beside `path` after a proof that held. The line lands
/// in a fresh temporary and takes the record's name by rename, so a link
/// planted at that name is replaced rather than written through. A record
/// that cannot be written costs the next launch a re-read, never the proof.
pub(crate) fn record(path: &Path, sha: &str, stamp: &Stamp) {
    let Ok(sample) = sample_digest(path, stamp.size) else {
        return;
    };
    let line = format!(
        "{sha} {} {} {} {sample}\n",
        stamp.size, stamp.modified_nanos, stamp.id
    );
    let target = record_path(path);
    let temp = beside(path, &format!("{SUFFIX}.tmp-{}", std::process::id()));
    // `create_new` is the other half of the link guard: a temporary that
    // already exists — a link among them — is not opened through, the
    // write simply does not happen.
    let written = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .and_then(|mut file| file.write_all(line.as_bytes()))
        .is_ok();
    if !written || std::fs::rename(&temp, &target).is_err() {
        let _ = std::fs::remove_file(&temp);
    }
}

/// `name` in `path`'s own directory: the record, and the temporary it lands
/// in — beside the file it describes, the place the drafter's failure
/// marker already uses.
fn beside(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    name.push(suffix);
    path.with_file_name(name)
}

fn record_path(path: &Path) -> PathBuf {
    beside(path, SUFFIX)
}

/// The ranges one sample reads, in the order it reads them: the file's
/// first and last [`SAMPLE_END`] bytes, then [`SAMPLE_CHUNKS`] chunks of
/// [`SAMPLE_CHUNK`] across what lies between, each offset a function of the
/// size alone, so the launch that records and every launch that checks read
/// the same bytes. A file smaller than the sample is read whole — the
/// ranges overlap and some bytes are hashed twice, which is harmless when
/// the reading is what must be the same.
fn sample_ranges(size: u64) -> Vec<(u64, u64)> {
    let mut ranges = vec![
        (0, size.min(SAMPLE_END)),
        (size.saturating_sub(SAMPLE_END), size.min(SAMPLE_END)),
    ];
    if size > 2 * SAMPLE_END {
        let span = size - 2 * SAMPLE_END;
        for index in 0..SAMPLE_CHUNKS {
            let offset = SAMPLE_END + span * (2 * index + 1) / (2 * SAMPLE_CHUNKS);
            ranges.push((offset, SAMPLE_CHUNK.min(size - offset)));
        }
    }
    ranges.retain(|(_, len)| *len > 0);
    ranges
}

/// The sha256 of one sample of the file at `path`, as lowercase hex.
fn sample_digest(path: &Path, size: u64) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    for (offset, len) in sample_ranges(size) {
        file.seek(SeekFrom::Start(offset))?;
        let mut left = len;
        while left > 0 {
            let want = left.min(buf.len() as u64) as usize;
            let read = file.read(&mut buf[..want])?;
            if read == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "the file ended inside its own sample",
                ));
            }
            hasher.update(&buf[..read]);
            left -= read as u64;
        }
    }
    Ok(format!("{:x}", hasher.finalize()))
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
    let sample = fields.next()?.to_string();
    fields.next().is_none().then_some(Record {
        sha,
        stamp,
        sample,
    })
}

struct Record {
    sha: String,
    stamp: Stamp,
    sample: String,
}

#[cfg(test)]
#[path = "verified/tests.rs"]
mod tests;
