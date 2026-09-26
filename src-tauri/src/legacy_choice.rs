//! Installs from before the stored choice: the model the old single
//! `tuning.txt` was tuned for becomes the choice, so an update opens as an
//! update and not as a first run. Per-model records never migrate — Allow
//! writes those for every model it tested, and none of them is a choice.

use std::path::Path;

use kalsa_catalog::usable;

use crate::startup::{file_digest_is, model_token};

/// The pinned file a legacy record's digest names.
struct Pinned {
    token: String,
    file: String,
    bytes: u64,
    sha256: &'static str,
}

/// Stores the legacy model as the choice when nothing is stored yet and its
/// file in `runtime_root/models` hashes to the pinned digest. It hashes
/// the whole file, once: the choice it stores stops it running again.
pub(crate) fn migrate(state_file: &Path, runtime_root: &Path) -> bool {
    migrate_with(state_file, runtime_root, catalog_row)
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
