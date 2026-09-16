//! The row-by-row facts behind a catalog decision.
//!
//! This is diagnostic data, not a second chooser: usable rows are passed
//! through the same candidate construction as choice::choose, while
//! excluded rows remain visible with their manifest reason.

use crate::candidate::candidate;
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
    pub decode: Option<Prediction>,
    pub too_slow: bool,
}

/// Inspect every row without changing which rows choose considers.
pub fn inspect(input: &ChoiceInput) -> Vec<RowAssessment> {
    let usable: Vec<_> = manifest::usable().collect();
    manifest::CATALOG
        .iter()
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
            }
        })
        .collect()
}
