//! Whether the weights the catalog wants are already on this machine, and
//! where — without ever writing to a directory that belongs to another
//! program.
//!
//! The plan draws the line twice. Weights are the part we reuse: GGUF blobs
//! already on disk are just files our own llama-server can read, and a
//! digest-verified copy beats a multi-gigabyte download on the connection
//! this crate exists for. Processes are the part we never touch: nothing
//! here starts, stops, configures or talks to another program's server. And
//! the on-disk layout of ollama, LM Studio or the Hugging Face cache is an
//! internal format that may change, so every answer here is an optimization
//! allowed to fail into "not found", never a dependency.
//!
//! Identity is the digest, and only the digest — the same promise
//! `kalsa-download` holds a download to before a file may become the model.
//! What this crate adds on top of [`kalsa_download::find_local`] is a cheap
//! first pass over the stores that NAME their blobs by the digest of their
//! contents (ollama's `sha256-<hex>`, the HF hub cache's bare `<hex>`): a
//! wrong store costs a stat, not a multi-gigabyte read, and the right store
//! is read exactly once to confirm its claim. [`kalsa_download::find_local`]
//! stays underneath as the engine, for every store that names its files like
//! files (LM Studio) and any layout we did not anticipate.
//!
//! One risk is decided here rather than avoided: a found file is used where
//! it lies, inside a store another program owns and may one day tidy —
//! `ollama rm`, an LM Studio delete. We accept that dependence: the consumer
//! opens the file and holds the handle for as long as it needs the bytes,
//! and an open file keeps its contents even when the name is unlinked. The
//! window between our answer and that open is not a shape these stores
//! produce by accident — both replace blobs by rename, never in place — and
//! the loader still refuses a malformed GGUF at first read. What we never do
//! is write: no create, no move, no rename, no delete, no tidy.

use std::path::PathBuf;

use kalsa_download::find_local;

mod claim;

/// Answers the download path's first question: is this exact model already
/// on this disk, and where? `size` and `sha256` are the same promises the
/// download is held to, as resolved for the catalog's model — never the
/// catalog's rounded figures, which are not a claim about the exact file.
///
/// `roots` are the model directories to search, read-only; hand it the list
/// from [`kalsa_download::default_roots`]. A missing or unreadable root is
/// "not found here", not an error: reuse is an optimization, and the caller
/// falls back to downloading.
pub fn find_reusable(roots: &[PathBuf], size: u64, sha256: &str) -> Option<PathBuf> {
    roots
        .iter()
        .find_map(|root| claim::find_claiming(root.as_path(), size, sha256))
        // The claim pass only hears files whose name names a digest. A store
        // that names its files like files is find_local's to search — and if
        // a claimant lied about its bytes, the honest copy may still be
        // somewhere this pass never looked.
        .or_else(|| find_local(roots, size, sha256))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::Path;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kalsa-reuse-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    /// Deterministic bytes, big enough that hashing only part of a file
    /// would produce a wrong digest.
    fn payload(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i % 251) as u8).collect()
    }

    fn digest_of(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    /// A plausible ollama store: flat blobs, each named by its own digest.
    fn ollama_blob(root: &Path, bytes: &[u8]) -> PathBuf {
        let path = root
            .join("models")
            .join("blobs")
            .join(format!("sha256-{}", digest_of(bytes)));
        fs::create_dir_all(path.parent().expect("parent")).expect("mkdirs");
        fs::write(&path, bytes).expect("write");
        path
    }

    #[test]
    fn a_missing_root_is_not_found_not_an_error() {
        let root = scratch("missing");
        let nowhere = root.join("no").join("such").join("store");
        assert_eq!(find_reusable(&[nowhere], 10, &digest_of(b"0123456789")), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_half_written_copy_with_the_right_name_is_refused() {
        // An interrupted pull can leave a blob under its final
        // content-addressed name with the final length and not the final
        // bytes. Only the whole file hashed proves it is not that.
        let root = scratch("half-written");
        let data = payload(3 * 64 * 1024);
        let mut torn = data.clone();
        let cut = torn.len() - 1;
        torn[cut] ^= 0xff;
        let claimed = root
            .join("blobs")
            .join(format!("sha256-{}", digest_of(&data)));
        fs::create_dir_all(claimed.parent().expect("parent")).expect("mkdirs");
        fs::write(&claimed, &torn).expect("write");
        assert_eq!(
            find_reusable(&[root.clone()], torn.len() as u64, &digest_of(&data)),
            None
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_match_reports_the_real_path() {
        let root = scratch("real-path");
        let bytes = b"the copy that was here all along";
        let blob = ollama_blob(&root, bytes);
        assert_eq!(
            find_reusable(&[root.clone()], bytes.len() as u64, &digest_of(bytes)),
            Some(blob)
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_store_that_names_its_files_like_files_is_still_searched() {
        // LM Studio keeps friendly names and no digests; the generic engine
        // underneath this crate is what finds it, and dropping the fallback
        // must be visible here.
        let root = scratch("nameless");
        let bytes = b"named like a user would name it";
        let model = root.join("pub").join("repo").join("model-Q4_K_M.gguf");
        fs::create_dir_all(model.parent().expect("parent")).expect("mkdirs");
        fs::write(&model, bytes).expect("write");
        assert_eq!(
            find_reusable(&[root.clone()], bytes.len() as u64, &digest_of(bytes)),
            Some(model)
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_search_writes_nothing_to_the_scanned_tree() {
        let root = scratch("read-only");
        let bytes = b"a copy that must survive being found";
        let blob = ollama_blob(&root, bytes);
        let listing = |dir: &Path| -> Vec<(PathBuf, u64)> {
            let mut rows = walk(dir);
            rows.sort();
            rows
        };
        let before = listing(&root);
        assert_eq!(
            find_reusable(&[root.clone()], bytes.len() as u64, &digest_of(bytes)),
            Some(blob)
        );
        assert_eq!(listing(&root), before, "finding must not touch the tree");
        let _ = fs::remove_dir_all(&root);

        fn walk(dir: &Path) -> Vec<(PathBuf, u64)> {
            let mut rows = Vec::new();
            for entry in fs::read_dir(dir).expect("read_dir").flatten() {
                let meta = entry.metadata().expect("meta");
                if meta.is_dir() {
                    rows.extend(walk(&entry.path()));
                } else {
                    rows.push((entry.path(), meta.len()));
                }
            }
            rows
        }
    }
}
