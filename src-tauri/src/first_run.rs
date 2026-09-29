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
    /// What downloading this model costs, as one number: its file plus the
    /// drafter its row ships beside it.
    download_bytes: u64,
    /// Whether a second file comes with the first, for the copy that says
    /// "file" or "files".
    drafter: bool,
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
        .map(|entry| {
            // Off the menu there is no plan to price: the entry's own
            // weight is the honest fallback for a row nothing fetches.
            let (download_bytes, drafter) =
                startup::entry_download(entry).unwrap_or((entry.weights_bytes, false));
            Suggestion {
                id: startup::model_token(entry),
                name: entry.display_name,
                download_bytes,
                drafter,
                on_disk: startup::model_on_disk(root, entry),
            }
        })
        .collect();
    Suggestions { options, refusal }
}

/// The stored choice, when a catalog row still answers to its token. A
/// token nothing answers to is no choice at all — that is the one fact the
/// home page reads to tell the first run from an install, and the gate below
/// holds before any walk.
pub(crate) fn stored_choice(state_file: &Path) -> Option<&'static ModelEntry> {
    let token = crate::options::load(state_file).model?;
    startup::row_for_token(&token)
}

/// Checked before a turn-on walks at all — no measuring, no engine, no
/// model: without a stored choice or a development override there is
/// nothing anyone agreed to download.
pub(crate) fn require_choice(state_file: &Path, dev_override: bool) -> Result<(), StartupFailure> {
    if dev_override || stored_choice(state_file).is_some() {
        Ok(())
    } else {
        Err(StartupFailure::AwaitingChoice)
    }
}

#[cfg(test)]
mod tests;
