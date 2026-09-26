//! Installs from before the stored choice: the model the old single
//! `tuning.txt` was tuned for becomes the choice, so an update opens as an
//! update and not as a first run. Per-model records never migrate — Allow
//! writes those for every model it tested, and none of them is a choice.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use kalsa_catalog::usable;

use crate::startup::{file_digest_is, model_token};

/// The pinned file a legacy record's digest names.
struct Pinned {
    token: String,
    file: String,
    bytes: u64,
    sha256: &'static str,
}

/// Starts the migration on its own thread when there is something to check
/// — no stored choice and a legacy record — so the window opens at once.
/// Hashing a model takes about a minute; `migrating` is true until it ends.
pub(crate) fn in_background(migrating: Arc<AtomicBool>, state_file: PathBuf, runtime_root: PathBuf) {
    if crate::options::load(&state_file).model.is_some()
        || kalsa_tune::record::legacy_model(&runtime_root).is_none()
    {
        return;
    }
    spawn_flagged(migrating, move || {
        migrate_with(&state_file, &runtime_root, catalog_row);
    });
}

/// Raises `flag`, runs `work` on a new thread, and lowers the flag when the
/// work ends — a panic included, or the home page would wait forever.
fn spawn_flagged(flag: Arc<AtomicBool>, work: impl FnOnce() + Send + 'static) -> JoinHandle<()> {
    struct Lower(Arc<AtomicBool>);
    impl Drop for Lower {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    flag.store(true, Ordering::SeqCst);
    let lower = Lower(flag);
    std::thread::spawn(move || {
        let _lower = lower;
        work();
    })
}

fn catalog_row(digest: &str) -> Option<Pinned> {
    let row = usable().find(|row| row.source().sha256 == digest)?;
    let source = row.source();
    let file = source.url().rsplit('/').next()?.to_string();
    (!file.is_empty()).then(|| Pinned {
        token: model_token(row.entry()),
        file,
        bytes: source.bytes,
        sha256: source.sha256,
    })
}

/// Stores the legacy model as the choice when nothing is stored yet and its
/// file in `runtime_root/models` hashes to the pinned digest. The choice it
/// stores stops it running again.
fn migrate_with(
    state_file: &Path,
    runtime_root: &Path,
    lookup: impl Fn(&str) -> Option<Pinned>,
) -> bool {
    let mut overrides = crate::options::load(state_file);
    if overrides.model.is_some() {
        return false;
    }
    let Some(pinned) = kalsa_tune::record::legacy_model(runtime_root).and_then(|d| lookup(&d))
    else {
        return false;
    };
    let path = runtime_root.join("models").join(&pinned.file);
    if !file_digest_is(&path, pinned.bytes, pinned.sha256) {
        return false;
    }
    overrides.model = Some(pinned.token);
    crate::options::save(state_file, overrides).is_ok()
}

#[cfg(test)]
mod tests;
