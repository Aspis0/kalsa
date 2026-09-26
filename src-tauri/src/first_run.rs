//! The first run: what Start answers — the suggestions, and which of them is
//! already on this computer — and the refusal that keeps every turn-on from
//! downloading anything before the owner has picked a model.

use std::path::Path;

use kalsa_catalog::ModelEntry;
use serde::Serialize;

use crate::failure::StartupFailure;
use crate::startup;

/// Start's answer on the wire: the chooser's pick first, then its faster
/// alternative when there is one.
#[derive(Serialize)]
pub(crate) struct Suggestions {
    options: Vec<Suggestion>,
    /// Why this computer can run nothing, when that is the answer.
    refusal: Option<String>,
}

#[derive(Serialize)]
struct Suggestion {
    id: String,
    name: &'static str,
    weights_bytes: u64,
    on_disk: bool,
}

/// A present model file is hashed whole, so this runs on a blocking thread.
pub(crate) fn suggest(
    entries: Vec<&'static ModelEntry>,
    refusal: Option<String>,
    root: &Path,
) -> Suggestions {
    let options = entries
        .into_iter()
        .map(|entry| Suggestion {
            id: startup::model_token(entry),
            name: entry.display_name,
            weights_bytes: entry.weights_bytes,
            on_disk: startup::model_on_disk(root, entry),
        })
        .collect();
    Suggestions { options, refusal }
}

/// Checked before a turn-on walks at all — no measuring, no engine, no
/// model: without a stored choice or a development override there is
/// nothing anyone agreed to download.
pub(crate) fn require_choice(state_file: &Path, dev_override: bool) -> Result<(), StartupFailure> {
    if dev_override || crate::options::load(state_file).model.is_some() {
        Ok(())
    } else {
        Err(StartupFailure::AwaitingChoice)
    }
}

#[cfg(test)]
mod tests;
