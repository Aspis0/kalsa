//! The order of operations, which is the safety story: make room, own the
//! part file, get bytes, prove them, and only then let the file exist under
//! its real name.

use std::cmp::Ordering;
use std::io;
use std::path::{Path, PathBuf};

use crate::disk;
use crate::fetch;
use crate::part::PartFile;
use crate::verify;
use crate::{DownloadError, Progress};

/// Kept free on top of the file itself: the OS and the user's other programs
/// need somewhere to write while we download.
const SPACE_MARGIN: u64 = 256 * 1024 * 1024;

/// Fetches `url` into `dest`, resuming from whatever `.part` file is already
/// there, and renames it onto `dest` only after `expected_size` and
/// `expected_sha256` both match. The digest is not optional: HuggingFace
/// publishes it with the file (the LFS oid), a download without one cannot be
/// proven to be the model, and this file is fed to a server that aborts on a
/// malformed GGUF rather than returning an error. `progress` receives the
/// promised total and the running count; this crate prints nothing itself.
///
/// Blocking on purpose: meant to be called from a background thread.
pub fn download(
    url: &str,
    dest: &Path,
    expected_size: u64,
    expected_sha256: &str,
    progress: &mut dyn FnMut(Progress),
) -> Result<(), DownloadError> {
    let part_path = part_path(dest)?;
    // Before the space probe, not after: it needs a directory that exists,
    // and creating one moves no bytes.
    if let Some(dir) = dest.parent() {
        if !dir.as_os_str().is_empty() {
            std::fs::create_dir_all(dir)?;
        }
    }
    let free = disk::free_bytes(part_path.parent().unwrap_or(Path::new(".")))?;
    let mut part = PartFile::claim(part_path)?;
    let have = part.len()?;
    let remaining = match have.cmp(&expected_size) {
        Ordering::Less => expected_size - have,
        // Everything is already there; fetch will not move a byte.
        Ordering::Equal => 0,
        // Longer than the promise is not a prefix of it; fetch restarts from
        // zero, so the whole file has to fit.
        Ordering::Greater => expected_size,
    };
    let needed = remaining.saturating_add(SPACE_MARGIN);
    if free < needed {
        // A part we created empty is ours to take back; a resumed one is the
        // user's progress and stays.
        if part.is_fresh() {
            part.discard();
        }
        return Err(DownloadError::NotEnoughSpace { free, needed });
    }
    let fetched = fetch::fetch(url, &mut part, expected_size, progress);
    match fetched {
        // The stream ran past the publisher's promise: the same mismatch
        // `verify` would have caught at the end, caught earlier. The part
        // cannot resume into anything — a server that overruns once fails
        // the size gate on every retry — so it goes now, keeping the
        // enum's "the part is gone after a mismatch" contract true.
        Err(error @ DownloadError::SizeMismatch { .. }) => {
            part.discard();
            Err(error)
        }
        fetched => {
            fetched?;
            verify::publish(part, dest, expected_size, expected_sha256)
        }
    }
}

/// `<dest>.part`, next to the destination: same filesystem, so the final
/// rename is atomic and never crosses a mount point.
fn part_path(dest: &Path) -> Result<PathBuf, DownloadError> {
    let mut name = dest.file_name().map(|n| n.to_os_string()).ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "destination has no file name")
    })?;
    name.push(".part");
    Ok(dest.with_file_name(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::httptest::{self, RangeMode};
    use sha2::{Digest, Sha256};
    use std::cell::RefCell;
    use std::fs;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("kalsa-download-{name}-{}", std::process::id()));
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
    fn an_overrun_throws_the_part_away_as_the_mismatch_it_is() {
        let dir = scratch("dl-overrun");
        let data = payload(1024 * 1024);
        let server = httptest::serve(data, RangeMode::Overrun);
        let dest = dir.join("model.gguf");
        let err = download(&server.url, &dest, 1024 * 1024, &"0".repeat(64), &mut |_| {})
            .expect_err("the overrun must be refused");
        assert!(
            matches!(err, DownloadError::SizeMismatch { .. }),
            "{err:?}"
        );
        assert!(
            !dest.with_file_name("model.gguf.part").exists(),
            "the part is thrown away with the mismatch, not kept for a resume \
             that can only fail the size gate again"
        );
        assert!(!dest.exists(), "nothing may land under the final name");
        let _ = fs::remove_dir_all(&dir);
    }

    fn digest_of(bytes: &[u8]) -> String {
        verify::to_hex(&Sha256::digest(bytes))
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
            &digest_of(&data),
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
        let wrong = digest_of(b"a different model entirely");
        let err = download(&server.url, &dest, data.len() as u64, &wrong, &mut |_| {})
            .expect_err("the digest must not pass");
        match err {
            DownloadError::DigestMismatch { actual, .. } => {
                assert_eq!(actual, digest_of(&data));
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
        let err = download(
            &server.url,
            &dest,
            data.len() as u64 + 1,
            &digest_of(&data),
            &mut |_| {},
        )
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
        let err = download(&server.url, &dest, u64::MAX / 2, "00", &mut |_| {})
            .expect_err("no machine has this much space");
        let DownloadError::NotEnoughSpace { needed, .. } = &err else {
            panic!("expected not-enough-space, got {err:?}");
        };
        // The margin is part of the promise, not an implementation detail.
        assert!(*needed > u64::MAX / 2);
        assert_eq!(server.requests.lock().expect("requests").len(), 0);
        assert!(!dest.exists());
        assert!(!dir.join("model.gguf.part").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_right_length_part_is_hashed_even_when_no_byte_moved() {
        let dir = scratch("dl-unhashed");
        let data = payload(1024 * 1024);
        let mut wrong = data.clone();
        wrong[0] ^= 0xff;
        let dest = dir.join("model.gguf");
        // Right length, wrong bytes: the part is complete, so the download
        // needs no request — and must still not skip the one check that
        // makes the file trustworthy.
        fs::write(dir.join("model.gguf.part"), &wrong).expect("part");
        let server = httptest::serve(data.clone(), RangeMode::Honor);
        let err = download(
            &server.url,
            &dest,
            wrong.len() as u64,
            &digest_of(&data),
            &mut |_| {},
        )
        .expect_err("right length is not right content");
        assert!(
            matches!(err, DownloadError::DigestMismatch { .. }),
            "{err:?}"
        );
        assert_eq!(
            server.requests.lock().expect("requests").len(),
            0,
            "the part was complete; the server must not be asked"
        );
        assert!(!dest.exists());
        assert!(!dir.join("model.gguf.part").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
