//! The row-by-row facts behind a catalog decision.
//!
//! This is diagnostic data, not a second chooser: usable rows are passed
//! through the same candidate construction as choice::choose, while the
//! research record and gated rows remain visible with their manifest reason.

use crate::candidate::candidate;
use crate::choice::dense_speed_floor;
use crate::choice::ChoiceInput;
use crate::choice::MINIMUM_TOKENS_PER_SECOND;
use crate::footprint::{footprint_bytes, Footprint};
use crate::licence::Standing;
use crate::manifest::{self, ModelEntry};
use crate::Prediction;

/// The facts a diagnostic can print for one manifest row.
pub struct RowAssessment {
    pub entry: &'static ModelEntry,
    pub standing: Standing,
    pub footprint: Footprint,
    /// The speed prediction, for rows the chooser could consider at all:
    /// research rows have no identified file, so they have no prediction.
    pub decode: Option<Prediction>,
    pub too_slow: bool,
    /// The dense speed floor this row must clear to be offered — 20 tok/s
    /// at or above twenty billion parameters, 10 below, and `None` for a
    /// mixture, which the plain reading floor judges. The report needs it
    /// beside the prediction: a row withheld by this line is withheld for
    /// its shape, not for being old or uninteresting.
    pub dense_line: Option<f64>,
}

/// Inspect every row without changing which rows choose considers.
pub fn inspect(input: &ChoiceInput) -> Vec<RowAssessment> {
    let usable: Vec<_> = manifest::usable().collect();
    manifest::rows()
        .map(|entry| {
            let decode = usable
                .iter()
                .find(|usable| usable.entry().repo == entry.repo)
                .map(|usable| candidate(*usable, input).decode);
            let too_slow = matches!(
                decode,
                Some(Prediction::Range { low, .. }) if low < MINIMUM_TOKENS_PER_SECOND
            );
            RowAssessment {
                entry,
                standing: entry.standing(),
                footprint: footprint_bytes(entry, input.context_tokens),
                decode,
                too_slow,
                dense_line: dense_speed_floor(entry),
            }
        })
        .collect()
}
