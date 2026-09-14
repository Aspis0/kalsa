//! The gate between "bytes arrived" and "this is the model".
//!
//! Nothing reaches its final name before its size and its sha256 match — and
//! a mismatch deletes the part file rather than keeping a failure around to
//! fail again. This is what lets the rest of the app trust "the model is on
//! disk" without re-checking: the file was fed to a server that aborts on a
//! malformed GGUF, so by then it is far too late to be wrong.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::part::PartFile;
use crate::DownloadError;

/// Lowercase hex sha256 of a handle's contents from the start, streamed: the
/// file can be many gigabytes and must never be held in memory.
pub fn sha256_hex(file: &mut File) -> std::io::Result<String> {
    file.seek(SeekFrom::Start(0))?;
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
/// and only then publishes it under `dest`: a corrupt file never becomes "the
/// model", and a good one appears under its final name in one step. Length
/// and digest are read from the handle we have held since before the first
/// byte arrived; how `dest` is made to name exactly those bytes — by
/// descriptor where the platform allows, identity-checked on both sides of
/// the rename where it does not — is `publish`'s contract, not this
/// function's claim.
pub fn publish(
    mut part: PartFile,
    dest: &Path,
    expected_size: u64,
    expected_sha256: &str,
) -> Result<(), DownloadError> {
    let actual = part.len()?;
    if actual != expected_size {
        part.discard();
        return Err(DownloadError::SizeMismatch {
            expected: expected_size,
            actual,
        });
    }
    let actual = sha256_hex(part.handle())?;
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        part.discard();
        return Err(DownloadError::DigestMismatch {
            expected: expected_sha256.to_string(),
            actual,
        });
    }
    // The bytes proved right; make sure they reached the platter before they
    // become visible under the final name.
    part.handle().sync_all()?;
    crate::publish::verified(&mut part, dest)?;
    drop(part); // the lock dies here, after the file has changed its name
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
        let mut file = File::open(&path).expect("open");
        assert_eq!(
            sha256_hex(&mut file).expect("hash"),
            to_hex(&Sha256::digest(b"kalsa"))
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
