//! The stores that name their blobs by the digest of their contents.
//!
//! ollama keeps every blob flat under its models dir as `sha256-<hex>`, and
//! the Hugging Face hub cache keeps them as bare `<hex>` under
//! `models--*/blobs/`. In both, the name IS a claim about the bytes: a file
//! that claims a different digest than the one we want can be refused
//! without reading a byte of it, and a file that claims ours is worth one
//! full read to confirm. The claim only ever shortlists — the hash is what
//! turns a claimant into an answer, because a name is somebody else's
//! promise, not an identity.
//!
//! A name that parses as no digest at all (`model-Q4_K_M.gguf`,
//! `<hex>.incomplete`) identifies nothing honestly, so this pass never
//! opens it; the generic scan underneath answers for those.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// Deepest nesting we descend, the same cap as `kalsa-download`'s scan:
/// every real layout here sits far inside it, and the cap is what keeps a
/// directory loop from becoming a hang.
const MAX_DEPTH: usize = 8;

/// Finds under `root` a regular file whose name claims digest `sha256` and
/// whose bytes — length first, then the whole file hashed — keep that
/// claim. Read-only: a missing or unreadable root is simply not found.
pub(crate) fn find_claiming(root: &Path, size: u64, sha256: &str) -> Option<PathBuf> {
    scan(root, size, sha256, 0)
}

fn scan(dir: &Path, size: u64, sha256: &str, depth: usize) -> Option<PathBuf> {
    if depth > MAX_DEPTH {
        return None;
    }
    // A root reached through a link is not the directory we were invited
    // into; whatever it holds is out of scope.
    match std::fs::symlink_metadata(dir) {
        Ok(meta) if meta.is_dir() && !meta.is_symlink() => {}
        _ => return None,
    }
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        // DirEntry's file type is the entry's own kind and never follows a
        // link: a symlink reports itself, and is neither entered nor opened,
        // because following it can leave the tree we were invited into.
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            if let Some(found) = scan(&entry.path(), size, sha256, depth + 1) {
                return Some(found);
            }
        } else if kind.is_file() {
            if let Some(found) = claimant(&entry.path(), size, sha256) {
                return Some(found);
            }
        }
    }
    None
}

/// The file at `path` is the answer only if its name claims our digest AND
/// its length is the promised one AND its bytes hash to it. The length is
/// read from the opened handle, so the size check and the hash speak about
/// the same file even if the path is re-planted between the two.
fn claimant(path: &Path, size: u64, sha256: &str) -> Option<PathBuf> {
    let name = path.file_name()?.to_str()?;
    // Non-UTF8 names claim nothing we can read; skip, do not guess.
    if !digest_claim(name)?.eq_ignore_ascii_case(sha256) {
        return None;
    }
    let Ok(mut file) = File::open(path) else {
        return None;
    };
    // Size first: one stat on the handle, and no content check can save a
    // file of the wrong length.
    if !matches!(file.metadata(), Ok(meta) if meta.len() == size) {
        return None;
    }
    if sha256_hex(&mut file).is_ok_and(|got| got.eq_ignore_ascii_case(sha256)) {
        Some(path.to_path_buf())
    } else {
        None
    }
}

/// The digest a blob's name claims, lowercased: `sha256-<hex>` (ollama) or
/// bare `<hex>` (HF hub blobs). Anything else — a friendly model name, a
/// partial download's suffix — claims nothing.
fn digest_claim(name: &str) -> Option<String> {
    let hex = name.strip_prefix("sha256-").unwrap_or(name);
    let hex = hex.to_ascii_lowercase();
    (hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit())).then_some(hex)
}

/// Lowercase hex sha256 of the handle's contents, streamed: the file can be
/// many gigabytes and must never be held in memory.
fn sha256_hex(file: &mut File) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::fs;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("kalsa-reuse-claim-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    fn digest_of(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn write(root: &Path, rel: &[&str], bytes: &[u8]) -> PathBuf {
        let mut path = root.to_path_buf();
        for part in rel {
            path = path.join(part);
        }
        fs::create_dir_all(path.parent().expect("parent")).expect("mkdirs");
        fs::write(&path, bytes).expect("write");
        path
    }

    #[test]
    fn an_ollama_blob_is_found_under_its_own_digest_name() {
        let root = scratch("ollama");
        let bytes = b"the weights ollama already pulled";
        let blob = write(
            &root,
            &["models", "blobs", &format!("sha256-{}", digest_of(bytes))],
            bytes,
        );
        assert_eq!(
            find_claiming(&root, bytes.len() as u64, &digest_of(bytes)),
            Some(blob)
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_hub_blob_named_by_its_digest_alone_is_found() {
        let root = scratch("hub");
        let bytes = b"the weights some other tool fetched";
        let blob = write(
            &root,
            &["models--org--repo", "blobs", &digest_of(bytes)],
            bytes,
        );
        assert_eq!(
            find_claiming(&root, bytes.len() as u64, &digest_of(bytes)),
            Some(blob)
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_blob_lying_about_its_name_is_refused() {
        // The one name that must never be trusted without the hash: it says
        // it is the model, its length agrees, its bytes are not.
        let root = scratch("liar");
        let mut bytes = *b"0123456789abcdef";
        bytes[0] ^= 0xff;
        write(
            &root,
            &[
                "blobs",
                &format!("sha256-{}", digest_of(b"0123456789abcdef")),
            ],
            &bytes,
        );
        assert_eq!(
            find_claiming(&root, bytes.len() as u64, &digest_of(b"0123456789abcdef")),
            None
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_wrong_claim_spared_the_read_still_leaves_the_truth_findable() {
        // A blob whose NAME claims another digest than ours is refused
        // without its bytes; a blob after it in the same tree can still be
        // the answer.
        let root = scratch("wrong-claim");
        let other = *b"a different quant of the same model, honestly named";
        write(
            &root,
            &["blobs", &format!("sha256-{}", digest_of(&other))],
            &other,
        );
        let mine = b"the quant the catalog actually wants";
        let blob = write(
            &root,
            &["blobs", &format!("sha256-{}", digest_of(mine))],
            mine,
        );
        assert_eq!(
            find_claiming(&root, mine.len() as u64, &digest_of(mine)),
            Some(blob)
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn a_claiming_symlink_is_neither_followed_nor_entered() {
        let root = scratch("links");
        let outside = scratch("links-outside");
        let bytes = b"the real copy lives elsewhere";
        write(&outside, &["real.gguf"], bytes);
        let sha = digest_of(bytes);
        // A file link under our digest's name, and a directory link whose
        // target holds a right-named copy. Neither may become the answer.
        std::os::unix::fs::symlink(
            outside.join("real.gguf"),
            root.join(format!("sha256-{sha}")),
        )
        .expect("file link");
        let inner = write(&outside, &["hub", "blobs", &sha], bytes);
        std::os::unix::fs::symlink(outside.join("hub"), root.join("hub")).expect("dir link");
        assert_eq!(find_claiming(&root, bytes.len() as u64, &sha), None);
        assert!(inner.exists());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }
}
