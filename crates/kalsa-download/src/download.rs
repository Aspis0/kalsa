//! The order of operations, which is the safety story: make room, get bytes,
//! prove them, and only then let the file exist under its real name.

use std::cmp::Ordering;
use std::io;
use std::path::{Path, PathBuf};

use crate::disk;
use crate::fetch;
use crate::verify::{self, file_len};
use crate::{DownloadError, Progress};

/// Kept free on top of the file itself: the OS and the user's other programs
/// need somewhere to write while we download.
const SPACE_MARGIN: u64 = 256 * 1024 * 1024;

/// Fetches `url` into `dest`, resuming from whatever `.part` file is already
/// there, and renames it onto `dest` only after `expected_size` — and, when
/// given, `expected_sha256` — match. `progress` receives the promised total
/// and the running count; this crate prints nothing itself.
///
/// Blocking on purpose: meant to be called from a background thread.
pub fn download(
    url: &str,
    dest: &Path,
    expected_size: u64,
    expected_sha256: Option<&str>,
    progress: &mut dyn FnMut(Progress),
) -> Result<(), DownloadError> {
    let part = part_path(dest)?;
    // Before the preflight, not after: the free-space probe needs a directory
    // that exists, and creating one moves no bytes.
    if let Some(dir) = dest.parent() {
        if !dir.as_os_str().is_empty() {
            std::fs::create_dir_all(dir)?;
        }
    }
    preflight(&part, expected_size)?;
    fetch::fetch(url, &part, expected_size, progress)?;
    verify::publish(&part, dest, expected_size, expected_sha256)
}

/// `<dest>.part`, next to the destination: same filesystem, so the final
/// rename is atomic and never crosses a mount point.
fn part_path(dest: &Path) -> Result<PathBuf, DownloadError> {
    let mut name = dest
        .file_name()
        .map(|n| n.to_os_string())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "destination has no file name"))?;
    name.push(".part");
    Ok(dest.with_file_name(name))
}

/// Refuses before any byte moves if the disk could not hold the rest of the
/// file plus [`SPACE_MARGIN`]. Filling a user's disk breaks their machine,
/// which is the one thing this product must not do.
fn preflight(part: &Path, expected_size: u64) -> Result<(), DownloadError> {
    let have = file_len(part)?.unwrap_or(0);
    let remaining = match have.cmp(&expected_size) {
        Ordering::Less => expected_size - have,
        // Everything is already there; fetch will not move a byte.
        Ordering::Equal => 0,
        // Longer than the promise is not a prefix of it; fetch restarts from
        // zero, so the whole file has to fit.
        Ordering::Greater => expected_size,
    };
    let needed = remaining.saturating_add(SPACE_MARGIN);
    let dir = part.parent().unwrap_or(Path::new("."));
    let free = disk::free_bytes(dir)?;
    if free < needed {
        return Err(DownloadError::NotEnoughSpace { free, needed });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::httptest::{self, RangeMode};
    use sha2::{Digest, Sha256};
    use std::cell::RefCell;
    use std::fs;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kalsa-download-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    /// Deterministic bytes: cheap to make, and any wrong offset shows in the
    /// digest.
    fn payload(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i % 251) as u8).collect()
    }

    #[test]
    fn a_clean_download_lands_only_under_its_final_name() {
        let dir = scratch("dl-clean");
        let data = payload(3 * 1024 * 1024);
        let server = httptest::serve(data.clone(), RangeMode::Honor);
        let dest = dir.join("model.gguf");
        let seen = RefCell::new(Vec::new());
        download(
            &server.url,
            &dest,
            data.len() as u64,
            Some(&verify::to_hex(&Sha256::digest(&data))),
            &mut |p| seen.borrow_mut().push(p),
        )
        .expect("download");
        assert_eq!(fs::read(&dest).expect("read"), data);
        assert!(!dir.join("model.gguf.part").exists());
        let seen = seen.borrow();
        assert_eq!(
            seen.last(),
            Some(&Progress {
                bytes_done: data.len() as u64,
                bytes_total: data.len() as u64,
            })
        );
        assert!(seen.iter().all(|p| p.bytes_total == data.len() as u64));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_digest_mismatch_leaves_nothing_behind() {
        let dir = scratch("dl-digest");
        let data = payload(1024 * 1024);
        let server = httptest::serve(data.clone(), RangeMode::Honor);
        let dest = dir.join("model.gguf");
        let wrong = verify::to_hex(&Sha256::digest(b"a different model entirely"));
        let err = download(&server.url, &dest, data.len() as u64, Some(&wrong), &mut |_| {})
            .expect_err("the digest must not pass");
        match err {
            DownloadError::DigestMismatch { actual, .. } => {
                assert_eq!(actual, verify::to_hex(&Sha256::digest(&data)));
            }
            other => panic!("expected digest mismatch, got {other:?}"),
        }
        assert!(!dest.exists());
        assert!(!dir.join("model.gguf.part").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_size_mismatch_leaves_nothing_behind() {
        let dir = scratch("dl-size");
        let data = payload(1024 * 1024);
        let server = httptest::serve(data.clone(), RangeMode::Honor);
        let dest = dir.join("model.gguf");
        let err = download(&server.url, &dest, data.len() as u64 + 1, None, &mut |_| {})
            .expect_err("the size must not pass");
        assert!(matches!(err, DownloadError::SizeMismatch { .. }), "{err:?}");
        assert!(!dest.exists());
        assert!(!dir.join("model.gguf.part").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_full_disk_refuses_before_the_first_byte_moves() {
        let dir = scratch("dl-space");
        let data = payload(1024);
        let server = httptest::serve(data, RangeMode::Honor);
        let dest = dir.join("model.gguf");
        // Far beyond any real disk: the preflight must say no without asking
        // the server for anything.
        let err = download(&server.url, &dest, u64::MAX / 2, None, &mut |_| {})
            .expect_err("no machine has this much space");
        let DownloadError::NotEnoughSpace { needed, .. } = err else {
            panic!("expected not-enough-space, got {err:?}");
        };
        // The margin is part of the promise, not an implementation detail.
        assert!(needed > u64::MAX / 2);
        assert_eq!(server.requests.lock().expect("requests").len(), 0);
        assert!(!dest.exists());
        assert!(!dir.join("model.gguf.part").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
