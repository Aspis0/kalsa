//! Weights that are already on this machine — and belong to another program.
//!
//! ollama, LM Studio and the huggingface cache (which Unsloth Desktop and
//! every Hub client downloads through) each keep copies of popular GGUFs,
//! and a digest-verified copy already on disk beats a six-gigabyte
//! download on the flaky connection this crate exists for. So callers look
//! here first.
//!
//! The rules of engagement are absolute: those directories belong to another
//! program. We read regular files, and that is all — no create, no move, no
//! rename, no delete — and we do not follow links: a file that is a symlink
//! can point anywhere on the disk, and anything else (a FIFO, a device) is
//! not a model file and could hang the scan on open. The no-follow rule
//! covers what the scan steps into; a root's own path is used as
//! configured, so if one of its parent folders is a link the operating
//! system follows it when we open files below — deliberate, because a
//! cache on an external drive behind a linked parent is the user's own
//! configuration.

use std::ffi::OsString;
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
    roots_under(&home, |name| std::env::var_os(name))
}

/// The roots under `home`, with the environment consulted through `env` so
/// the tests can drive the cache-relocation precedence without touching the
/// process environment (an env-mutating test races every other test).
fn roots_under(home: &Path, env: impl Fn(&str) -> Option<OsString>) -> Vec<PathBuf> {
    // The hub cache sits wherever its owner put it — huggingface_hub's
    // constants.py fallback order: HF_HUB_CACHE, then the legacy
    // HUGGINGFACE_HUB_CACHE, then $HF_HOME/hub, then
    // $XDG_CACHE_HOME/huggingface/hub, then the default. Wherever the cache
    // moved, it keeps the hub's FIRST place: the ordering ranks programs,
    // and a relocated cache is the same program's cache. An env value equal
    // to another root yields a duplicate entry — the scan is read-only, so
    // it only costs the time of a second pass.
    let hub = env_path(env("HF_HUB_CACHE"), home)
        .or_else(|| env_path(env("HUGGINGFACE_HUB_CACHE"), home))
        .or_else(|| env_path(env("HF_HOME"), home).map(|base| base.join("hub")))
        .or_else(|| {
            env_path(env("XDG_CACHE_HOME"), home).map(|base| base.join("huggingface/hub"))
        })
        .unwrap_or_else(|| home.join(".cache/huggingface/hub"));
    [
        hub,
        home.join(".ollama/models/blobs"),
        home.join(".lmstudio/models"),
        // LM Studio's older model folder, named "Legacy cache location" in
        // Unsloth Studio's own source (studio/backend/utils/paths/
        // storage_roots.py). The current layout goes first.
        home.join(".cache/lm-studio/models"),
    ]
    .to_vec()
}

/// One env value as an absolute root, or None to fall through to the next
/// arm. A leading `~` (exactly, or `~/…`) expands against `home`, the way
/// huggingface_hub's expanduser treats these values; `~user` is NOT
/// expanded, and nor are $VARS. A value that is empty or still relative after that counts as
/// unset — OUR rule, not Python's: os.getenv keeps an empty value and
/// Python resolves a relative path against its working directory, and a
/// GUI app's working directory is not the user's shell's. Falling through
/// keeps the roots absolute whatever the environment holds.
fn env_path(value: Option<OsString>, home: &Path) -> Option<PathBuf> {
    let value = value?;
    if value.is_empty() {
        return None;
    }
    let path = PathBuf::from(&value);
    let path = if path == Path::new("~") {
        home.to_path_buf()
    } else if let Ok(rest) = path.strip_prefix("~/") {
        home.join(rest)
    } else {
        path
    };
    path.is_absolute().then_some(path)
}

/// Finds a regular file of `size` bytes whose sha256 is `sha256` under one of
/// `roots`. The digest is the only identity we trust for another program's
/// file — a matching name and length alone is a bet we do not make — so the
/// name it happens to have (a blob hash, a snapshot link name) is irrelevant.
/// Read-only, always: a missing or unreadable root is just "not found here",
/// not an error.
pub fn find_local(roots: &[PathBuf], size: u64, sha256: &str) -> Option<PathBuf> {
    roots.iter().find_map(|root| scan(root, size, sha256, 0))
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
    let name = "HOME";
    #[cfg(windows)]
    let name = "USERPROFILE";
    // Absolute-only: an empty or relative home counts as absent, so no
    // root can come back relative whatever the environment holds. Python
    // would fall back further on a missing home - the passwd database on
    // Unix, HOMEDRIVE+HOMEPATH on Windows; we do neither.
    let path = PathBuf::from(std::env::var_os(name)?);
    path.is_absolute().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::to_hex;
    use sha2::{Digest, Sha256};
    use std::fs;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("kalsa-download-{name}-{}", std::process::id()));
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
        assert_eq!(
            find_local(&[root.clone()], 9, &digest_of(b"0123456789")),
            None
        );
        assert_eq!(
            find_local(&[root.clone()], 10, &digest_of(b"0123456789")),
            Some(model)
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_default_roots_are_absolute() {
        let roots = default_roots();
        assert!(!roots.is_empty());
        assert!(roots.iter().all(|root| root.is_absolute()));
    }

    fn lookup<'a>(values: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        move |name| {
            values
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| OsString::from(value))
        }
    }

    /// huggingface_hub's precedence, driven through the lookup seam:
    /// HF_HUB_CACHE, then the legacy HUGGINGFACE_HUB_CACHE, then
    /// $HF_HOME/hub, then $XDG_CACHE_HOME's arm, then the default. A value
    /// that is empty or still relative counts as
    /// unset and falls through - OUR rule, not Python's: a GUI app's
    /// working directory is not the user's shell's, so a relative cache
    /// path resolves against nothing meaningful here.
    #[test]
    fn a_relocated_hub_cache_is_found_through_the_environment() {
        let home = PathBuf::from("/the/home");
        let default = home.join(".cache/huggingface/hub");

        let roots = roots_under(&home, lookup(&[("HF_HUB_CACHE", "/moved/hub")]));
        assert_eq!(roots[0], PathBuf::from("/moved/hub"));
        assert!(!roots.contains(&default), "the moved cache replaces the default, not joins it");

        let roots = roots_under(&home, lookup(&[("HF_HOME", "/hf/home")]));
        assert_eq!(roots[0], PathBuf::from("/hf/home/hub"));

        // constants.py falls back from HF_HUB_CACHE to the legacy
        // HUGGINGFACE_HUB_CACHE before anything else - and HF_HUB_CACHE
        // still wins over it.
        let roots = roots_under(&home, lookup(&[("HUGGINGFACE_HUB_CACHE", "/legacy/hub")]));
        assert_eq!(roots[0], PathBuf::from("/legacy/hub"));
        let roots = roots_under(
            &home,
            lookup(&[("HF_HUB_CACHE", "/moved/hub"), ("HUGGINGFACE_HUB_CACHE", "/legacy/hub")]),
        );
        assert_eq!(roots[0], PathBuf::from("/moved/hub"));
        // The order, not just membership: the legacy variable also beats
        // HF_HOME, so it cannot be silently moved further down the chain.
        let roots = roots_under(
            &home,
            lookup(&[("HUGGINGFACE_HUB_CACHE", "/legacy/hub"), ("HF_HOME", "/hf/home")]),
        );
        assert_eq!(
            roots[0],
            PathBuf::from("/legacy/hub"),
            "the legacy variable outranks HF_HOME"
        );

        // constants.py falls back to XDG_CACHE_HOME when HF_HOME is unset.
        let roots = roots_under(&home, lookup(&[("XDG_CACHE_HOME", "/xdg/cache")]));
        assert_eq!(roots[0], PathBuf::from("/xdg/cache/huggingface/hub"));

        let roots = roots_under(&home, lookup(&[]));
        assert_eq!(roots[0], default);
    }

    /// huggingface_hub runs expanduser over these values, so a leading
    /// tilde is a home path; $VARS are not expanded (none of these
    /// variables carry them in practice, and a shell is not running).
    #[test]
    fn a_leading_tilde_expands_against_home() {
        let home = PathBuf::from("/the/home");
        let roots = roots_under(&home, lookup(&[("HF_HUB_CACHE", "~/moved/hub")]));
        assert_eq!(roots[0], home.join("moved/hub"));

        let roots = roots_under(&home, lookup(&[("HF_HUB_CACHE", "~")]));
        assert_eq!(roots[0], home);
    }

    /// Empty and relative values fall through to the next arm, so the
    /// roots are absolute whatever the environment holds - the
    /// absolute-roots test does not depend on the ambient environment.
    #[test]
    fn a_value_that_is_empty_or_relative_counts_as_unset() {
        let home = PathBuf::from("/the/home");

        let roots = roots_under(&home, lookup(&[("HF_HUB_CACHE", ""), ("HF_HOME", "/hf/home")]));
        assert_eq!(
            roots[0],
            PathBuf::from("/hf/home/hub"),
            "an empty HF_HUB_CACHE is unset, not a path"
        );

        let roots = roots_under(&home, lookup(&[("HF_HUB_CACHE", "rel/hub"), ("HF_HOME", "/hf/home")]));
        assert_eq!(
            roots[0],
            PathBuf::from("/hf/home/hub"),
            "a relative HF_HUB_CACHE resolves against nothing meaningful; it is unset"
        );

        let roots = roots_under(&home, lookup(&[("HF_HUB_CACHE", "~/rel")]));
        assert_eq!(
            roots[0],
            home.join("rel"),
            "a tilde is expanded first, and the result is absolute"
        );
    }

    /// LM Studio's older model folder rides beside the current one, after
    /// it, so a live install's fresher copies are scanned first.
    #[test]
    fn the_lm_studio_legacy_root_sits_after_the_current_one() {
        let home = PathBuf::from("/the/home");
        let roots = roots_under(&home, lookup(&[]));
        let current = home.join(".lmstudio/models");
        let legacy = home.join(".cache/lm-studio/models");
        assert_eq!(
            roots.iter().position(|root| *root == legacy),
            Some(roots.iter().position(|root| *root == current).unwrap() + 1),
            "the legacy folder belongs right after the current one"
        );
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
        assert_eq!(
            find_local(&[root.clone()], bytes.len() as u64, &digest_of(bytes)),
            None
        );
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
            find_local(
                &[link_root.join("hub")],
                bytes.len() as u64,
                &digest_of(bytes)
            ),
            None
        );
        let _ = fs::remove_dir_all(&real);
        let _ = fs::remove_dir_all(&link_root);
    }
}
