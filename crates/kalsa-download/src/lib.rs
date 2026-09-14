//! Get one model file onto this machine, once, safely.
//!
//! The enemy is the user's laptop: an old machine, a flaky connection, a disk
//! with some gigabytes free but not gigabytes to spare. The rules follow from
//! that:
//!
//! * bytes land in a `.part` file next to the destination and every restart
//!   asks the server to skip what survived, so an hour of downloading is
//!   never paid for twice;
//! * the `.part` file is renamed onto its final name only after its size and,
//!   when given, its sha256 check out — a half-finished file can never be
//!   mistaken for the model, and a corrupt one leaves nothing behind;
//! * free space is checked before the first byte moves: a full disk is a way
//!   to break a machine, not just a failed download.
//!
//! Nothing here decides WHICH model to fetch. Call [`find_local`] first — a
//! verified copy in another program's cache beats any resume.

mod disk;
mod download;
mod fetch;
mod reuse;
mod verify;

pub use download::download;
pub use reuse::{default_roots, find_local};

#[cfg(test)]
mod httptest;

use std::io;

/// How far along a download is. `bytes_total` is the size the caller promised,
/// never what the server claims: the promise is what verification holds it to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Progress {
    pub bytes_done: u64,
    pub bytes_total: u64,
}

/// Why the download did not become the model. After `SizeMismatch` or
/// `DigestMismatch` the `.part` file is gone: keeping it would only fail
/// verification again. After `Io` it is still there — a dropped connection is
/// resumable, which is the whole point.
#[derive(Debug)]
pub enum DownloadError {
    Io(io::Error),
    NotEnoughSpace { free: u64, needed: u64 },
    SizeMismatch { expected: u64, actual: u64 },
    DigestMismatch { expected: String, actual: String },
}

impl From<io::Error> for DownloadError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

impl std::fmt::Display for DownloadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "download failed: {e}"),
            Self::NotEnoughSpace { free, needed } => {
                write!(f, "not enough disk space: {free} bytes free, {needed} needed")
            }
            Self::SizeMismatch { expected, actual } => {
                write!(f, "wrong size: expected {expected} bytes, got {actual}")
            }
            Self::DigestMismatch { expected, actual } => {
                write!(f, "wrong sha256: expected {expected}, got {actual}")
            }
        }
    }
}

impl std::error::Error for DownloadError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            _ => None,
        }
    }
}
