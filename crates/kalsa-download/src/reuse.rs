//! Weights that are already on this machine — and belong to another program.
//!
//! ollama, LM Studio and the huggingface cache each keep copies of popular
//! GGUFs, and a digest-verified copy already on disk beats a six-gigabyte
//! download on the flaky connection this crate exists for. So callers look
//! here first.
//!
//! The rules of engagement are absolute: those directories belong to another
//! program. We read regular files, and that is all — no create, no move, no
//! rename, no delete — and we do not follow links: a file that is a symlink
//! can point anywhere on the disk, and anything else (a FIFO, a device) is
//! not a model file and could hang the scan on open.

use std::fs::File;
use std::path::{Path, PathBuf};

use crate::verify::sha256_hex;

/// Deepest nesting we descend: every real layout here (hub snapshots, LM
/// Studio publisher dirs) sits far inside this, and the cap is what keeps a
/// directory loop from becoming a hang.
const MAX_DEPTH: usize = 8;

/// The model directories of the programs known to keep GGUFs, best first.
/// Empty when there is no home directory to look under.
pub fn default_roots() -> Vec<PathBuf> {
    let Some(home) = home() else {
        return Vec::new();
    };
    [".cache/huggingface/hub", ".ollama/models/blobs", ".lmstudio/models"]
        .iter()
        .map(|rest| home.join(rest))
        .collect()
}

/// Finds a regular file of `size` bytes whose sha256 is `sha256` under one of
/// `roots`. The digest is the only identity we trust for another program's
/// file — a matching name and length alone is a bet we do not make — so the
/// name it happens to have (a blob hash, a snapshot link name) is irrelevant.
/// Read-only, always: a missing or unreadable root is just "not found here",
/// not an error.
pub fn find_local(roots: &[PathBuf], size: u64, sha256: &str) -> Option<PathBuf> {
    roots
        .iter()
        .find_map(|root| scan(root, size, sha256, 0))
}

fn scan(dir: &Path, size: u64, sha256: &str, depth: usize) -> Option<PathBuf> {
    if depth > MAX_DEPTH {
        return None;
    }
    // A root we were handed through a link is not the directory we were
    // invited into; whatever it holds is out of scope.
    match std::fs::symlink_metadata(dir) {
        Ok(meta) if meta.is_dir() && !meta.is_symlink() => {}
        _ => return None,
    }
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            if !kind.is_symlink() {
                if let Some(found) = scan(&entry.path(), size, sha256, depth + 1) {
                    return Some(found);
                }
            }
            continue;
        }
        // Regular files only. This is an lstat: a symlink to even the right
        // content is skipped, because following it can leave the roots.
        if !kind.is_file() {
            continue;
        }
        let Ok(mut file) = File::open(entry.path()) else {
            continue;
        };
        let Ok(len) = file.metadata().map(|m| m.len()) else {
            continue;
        };
        // Size first: one stat on the handle, and no content check can save
        // a file of the wrong length.
        if len != size {
            continue;
        }
        if sha256_hex(&mut file).is_ok_and(|got| got.eq_ignore_ascii_case(sha256)) {
            return Some(entry.path());
        }
    }
    None
}

fn home() -> Option<PathBuf> {
    #[cfg(unix)]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::to_hex;
    use sha2::{Digest, Sha256};
    use std::fs;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kalsa-download-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().expect("parent")).expect("mkdirs");
        fs::write(path, bytes).expect("write");
    }

    fn digest_of(bytes: &[u8]) -> String {
        to_hex(&Sha256::digest(bytes))
    }

    #[test]
    fn a_digest_match_is_found_below_a_missing_root() {
        let root = scratch("scan-name");
        let model = root
            .join("hub")
            .join("models--x")
            .join("snapshots")
            .join("abc")
            .join("model.gguf");
        write(&model, b"0123456789");
        let missing = root.join("no-such-place");
        assert_eq!(
            find_local(&[missing, root.clone()], 10, &digest_of(b"0123456789")),
            Some(model)
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_digest_mismatch_beats_a_matching_name_and_size() {
        let root = scratch("scan-decoy");
        let mut wrong = *b"0123456789";
        wrong[0] ^= 0xff;
        write(&root.join("blobs").join("model.gguf"), &wrong);
        assert_eq!(find_local(&[root], 10, &digest_of(b"0123456789")), None);
    }

    #[test]
    fn the_size_is_checked_before_the_digest() {
        let root = scratch("scan-size");
        let model = root.join("model.gguf");
        write(&model, b"0123456789");
        assert_eq!(find_local(&[root.clone()], 9, &digest_of(b"0123456789")), None);
        assert_eq!(find_local(&[root.clone()], 10, &digest_of(b"0123456789")), Some(model));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_default_roots_are_absolute() {
        let roots = default_roots();
        assert!(!roots.is_empty());
        assert!(roots.iter().all(|root| root.is_absolute()));
    }

    #[cfg(unix)]
    #[test]
    fn a_file_symlink_out_of_the_roots_is_not_a_found_copy() {
        let root = scratch("scan-link");
        let outside = scratch("scan-link-outside");
        let bytes = b"the real copy lives elsewhere";
        write(&outside.join("real.gguf"), bytes);
        std::os::unix::fs::symlink(outside.join("real.gguf"), root.join("model.gguf"))
            .expect("link");
        assert_eq!(find_local(&[root.clone()], bytes.len() as u64, &digest_of(bytes)), None);
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[cfg(unix)]
    #[test]
    fn a_fifo_is_skipped_not_opened() {
        use std::os::unix::ffi::OsStrExt;

        let root = scratch("scan-fifo");
        let fifo = root.join("blob");
        let c = std::ffi::CString::new(fifo.as_os_str().as_bytes()).expect("fifo path");
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o600) }, 0);
        // Opening a FIFO with no writer would block forever; the scan must
        // refuse it by type, and answer, not hang.
        assert_eq!(find_local(&[root], 0, &digest_of(b"")), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_root_is_not_entered() {
        let real = scratch("scan-root-real");
        let bytes = b"behind a link";
        write(&real.join("model.gguf"), bytes);
        let link_root = scratch("scan-root-link");
        std::os::unix::fs::symlink(&real, link_root.join("hub")).expect("link");
        assert_eq!(
            find_local(&[link_root.join("hub")], bytes.len() as u64, &digest_of(bytes)),
            None
        );
        let _ = fs::remove_dir_all(&real);
        let _ = fs::remove_dir_all(&link_root);
    }
}
