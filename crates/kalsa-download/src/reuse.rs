//! Weights that are already on this machine — and belong to another program.
//!
//! ollama, LM Studio and the huggingface cache each keep copies of popular
//! GGUFs, and a verified copy already on disk beats a six-gigabyte download on
//! the flaky connection this crate exists for. So callers look here first.
//!
//! The rules of engagement are absolute: those directories belong to another
//! program. We read, and that is all — no create, no move, no rename, no
//! delete — and we do not follow directory symlinks into layouts we were not
//! invited to.

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

/// Finds a file of `size` bytes under one of `roots`. With `sha256` given, the
/// digest decides and the name is whatever the other program calls the file
/// (ollama names blobs by its own hash); without it, `file_name` must match
/// exactly. Read-only, always: a missing or unreadable root is just "not
/// found here", not an error.
pub fn find_local(
    roots: &[PathBuf],
    file_name: &str,
    size: u64,
    sha256: Option<&str>,
) -> Option<PathBuf> {
    roots
        .iter()
        .find_map(|root| scan(root, file_name, size, sha256, 0))
}

fn scan(
    dir: &Path,
    file_name: &str,
    size: u64,
    sha256: Option<&str>,
    depth: usize,
) -> Option<PathBuf> {
    if depth > MAX_DEPTH {
        return None;
    }
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if kind.is_dir() {
            if !kind.is_symlink() {
                if let Some(found) = scan(&path, file_name, size, sha256, depth + 1) {
                    return Some(found);
                }
            }
            continue;
        }
        // Reading through a file symlink is fine — hub snapshots link into
        // their blob store — and opening read-only touches nothing.
        let Ok(file) = File::open(&path) else {
            continue;
        };
        let Ok(len) = file.metadata().map(|m| m.len()) else {
            continue;
        };
        // Size first: one stat, and no content check can save a file of the
        // wrong length.
        if len != size {
            continue;
        }
        let matched = match sha256 {
            Some(want) => sha256_hex(&path).is_ok_and(|got| got.eq_ignore_ascii_case(want)),
            None => entry.file_name().to_str() == Some(file_name),
        };
        if matched {
            return Some(path);
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

    #[test]
    fn a_name_and_size_match_is_found_below_a_missing_root() {
        let root = scratch("scan-name");
        let model = root.join("lmstudio").join("Qwen").join("model.gguf");
        write(&model, b"0123456789");
        let missing = root.join("no-such-place");
        assert_eq!(
            find_local(&[missing, root.clone()], "model.gguf", 10, None),
            Some(model)
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_digest_matches_a_blob_by_any_name() {
        let root = scratch("scan-sha");
        let bytes = b"a model ollama already has";
        let blob = root.join("blobs").join("sha256-its-own-name");
        write(&blob, bytes);
        let want = to_hex(&Sha256::digest(bytes));
        assert_eq!(
            find_local(&[root.clone()], "sha256-its-own-name", bytes.len() as u64, Some(&want)),
            Some(blob)
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_digest_mismatch_beats_a_matching_name_and_size() {
        let root = scratch("scan-decoy");
        let mut wrong = *b"0123456789";
        wrong[0] ^= 0xff;
        write(&root.join("blobs").join("model.gguf"), &wrong);
        let want = to_hex(&Sha256::digest(b"0123456789"));
        assert_eq!(find_local(&[root], "model.gguf", 10, Some(&want)), None);
    }

    #[test]
    fn a_name_match_requires_an_exact_size() {
        let root = scratch("scan-size");
        let model = root.join("model.gguf");
        write(&model, b"0123456789");
        assert_eq!(find_local(&[root.clone()], "model.gguf", 9, None), None);
        assert_eq!(find_local(&[root.clone()], "model.gguf", 10, None), Some(model));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_default_roots_are_absolute() {
        let roots = default_roots();
        assert!(!roots.is_empty());
        assert!(roots.iter().all(|root| root.is_absolute()));
    }
}
