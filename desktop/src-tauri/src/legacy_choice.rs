//! Installs from before the stored choice: the model the old single
//! `tuning.txt` was tuned for becomes the choice, so an update opens as an
//! update and not as a first run. Per-model records never migrate — Allow
//! writes those for every model it tested, and none of them is a choice.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use kalsa_catalog::usable;

use crate::startup::{file_digest_checked, model_token};

/// The pinned file a legacy record's digest names.
struct Pinned {
    token: String,
    file: String,
    bytes: u64,
    sha256: &'static str,
}

/// Starts the migration on its own thread when there is something to check
/// — no stored choice, no answer yet to a check already made, and a legacy
/// record — so the window opens at once.
/// Hashing a model takes about a minute; `migrating` is true until it ends.
pub(crate) fn in_background(migrating: Arc<AtomicBool>, state_file: PathBuf, runtime_root: PathBuf) {
    let digest = kalsa_tune::record::legacy_model(&runtime_root);
    if crate::options::load(&state_file).model.is_some()
        || digest.as_deref().is_none_or(|digest| settled(state_file.as_path(), digest))
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

/// The record of a settled check: the legacy digest it settled on, empty
/// for a marker written before the digest lived here. The same digest, or
/// an empty one, stays settled; a record naming another model reopens the
/// question, and no marker at all was never settled.
fn settled(state_file: &Path, digest: &str) -> bool {
    match std::fs::read(marker(state_file)) {
        Ok(content) => content.is_empty() || content == digest.as_bytes(),
        Err(_) => false,
    }
}

/// Records the digest the check settled on, through the owner-only
/// publication the credential store uses. A write that fails records
/// nothing — the question stays open and the next launch hashes again,
/// never a silent "checked" — and says so here, once.
fn mark_checked(state_file: &Path, digest: &str) {
    if let Err(error) =
        kalsa_pairing::store::write_owner_only(&marker(state_file), digest.as_bytes())
    {
        log::warn!(
            "the legacy check could not be recorded: {error}; \
             it will run again on the next launch"
        );
    }
}

fn marker(state_file: &Path) -> PathBuf {
    state_file.with_file_name("legacy-choice-checked")
}

/// Stores the legacy model as the choice when nothing is stored yet and its
/// file in `runtime_root/models` hashes to the pinned digest. Either
/// terminal answer — the choice, or a file proven not to be the pinned one —
/// is recorded beside the digest that was checked, so the hash runs at most
/// once per legacy record: the choice can be cleared later by an owner or a
/// walk that refused it, and the migration must not start over when that
/// happens.
fn migrate_with(
    state_file: &Path,
    runtime_root: &Path,
    lookup: impl Fn(&str) -> Option<Pinned>,
) -> bool {
    let mut overrides = crate::options::load(state_file);
    if overrides.model.is_some() {
        return false;
    }
    let Some(digest) = kalsa_tune::record::legacy_model(runtime_root) else {
        // No record: nothing was read, so nothing is recorded and the next
        // launch asks again. Cheap — no model is hashed — and asking again
        // is the point: a later catalog can still adopt the file.
        return false;
    };
    if settled(state_file, &digest) {
        return false;
    }
    let Some(pinned) = lookup(&digest) else {
        // No catalog row for the digest: nothing was read, so nothing is
        // recorded and the next launch asks again. Cheap — no model is
        // hashed — and asking again is the point: a later catalog can
        // still adopt the file.
        return false;
    };
    let path = runtime_root.join("models").join(&pinned.file);
    match file_digest_checked(&path, pinned.bytes, pinned.sha256) {
        // Read whole, and not the pinned file: a re-check next launch would
        // answer the same, so the answer is the record. Nothing was
        // adopted either way.
        Ok(false) => {
            mark_checked(state_file, &digest);
            false
        }
        // The pinned file becomes the choice, and only a saved choice marks
        // the check done: a save that failed must be retried whole. The
        // marker, not the choice, is what runs this once — the choice says
        // what migrated, the marker says it was settled.
        Ok(true) => {
            overrides.model = Some(pinned.token);
            if crate::options::save(state_file, overrides).is_ok() {
                mark_checked(state_file, &digest);
                true
            } else {
                false
            }
        }
        // Absent, the wrong size, or the disk said no — no verdict, so no
        // record. The file may still arrive.
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests;
