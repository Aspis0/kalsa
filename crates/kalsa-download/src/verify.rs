//! The gate between "bytes arrived" and "this is the model".
//!
//! Nothing reaches its final name before its size and, when given, its sha256
//! match — and a mismatch deletes the part file rather than keeping a failure
//! around to fail again. This is what lets the rest of the app trust "the
//! model is on disk" without re-checking.

use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::DownloadError;

/// Length of `path`, or None when it does not exist.
pub fn file_len(path: &Path) -> std::io::Result<Option<u64>> {
    match std::fs::metadata(path) {
        Ok(meta) => Ok(Some(meta.len())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Lowercase hex sha256 of a file's contents, streamed: the file can be many
/// gigabytes and must never be held in memory.
pub fn sha256_hex(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(to_hex(&hasher.finalize()))
}

pub fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut hex = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        hex.push(HEX[(byte >> 4) as usize] as char);
        hex.push(HEX[(byte & 0xf) as usize] as char);
    }
    hex
}

/// Checks the part file against what was promised, deletes it on any mismatch,
/// and only then renames it onto `dest`: a corrupt file never becomes "the
/// model", and a good one appears under its final name in one step.
pub fn publish(
    part: &Path,
    dest: &Path,
    expected_size: u64,
    expected_sha256: Option<&str>,
) -> Result<(), DownloadError> {
    let actual = file_len(part)?.unwrap_or(0);
    if actual != expected_size {
        let _ = std::fs::remove_file(part);
        return Err(DownloadError::SizeMismatch {
            expected: expected_size,
            actual,
        });
    }
    if let Some(expected) = expected_sha256 {
        let actual = sha256_hex(part)?;
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = std::fs::remove_file(part);
            return Err(DownloadError::DigestMismatch {
                expected: expected.to_string(),
                actual,
            });
        }
    }
    // The bytes proved right; make sure they reached the platter before the
    // rename lets anything start reading them under the final name.
    std::fs::File::open(part)?.sync_all()?;
    std::fs::rename(part, dest)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kalsa-download-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    #[test]
    fn hex_is_lowercase() {
        assert_eq!(to_hex(&[]), "");
        assert_eq!(to_hex(&[0xde, 0xad, 0xbe, 0xef]), "deadbeef");
        assert_eq!(to_hex(&[0x0a]), "0a");
    }

    #[test]
    fn the_digest_is_of_the_content() {
        let dir = scratch("verify-sha");
        let path = dir.join("any.gguf");
        fs::write(&path, b"kalsa").expect("write");
        assert_eq!(
            sha256_hex(&path).expect("hash"),
            to_hex(&Sha256::digest(b"kalsa"))
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_file_has_no_length() {
        assert_eq!(
            file_len(Path::new("/kalsa-download-no-such-file.gguf")).expect("stat"),
            None
        );
    }
}
