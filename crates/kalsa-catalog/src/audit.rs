//! The row-by-row facts behind a catalog decision.
//!
//! This is diagnostic data, not a second chooser: usable rows are assessed
//! through the chooser's own resolution and candidate construction, while
//! the research record and gated rows remain visible with their manifest
//! reason.

use crate::choice::{dense_speed_floor, ChoiceInput, MINIMUM_TOKENS_PER_SECOND};
use crate::footprint::{footprint_bytes, Footprint};
use crate::licence::Standing;
use crate::manifest::{self, ModelEntry};
use crate::q8;
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

/// Inspect every row without changing which rows choose considers. A
/// usable row is assessed as the file the quant rule would serve on this
/// machine — the chooser's own resolution, drafter charged — so a line here
/// cannot disagree with the pick beside it; gated rows and the research
/// record stay visible with their manifest reason.
pub fn inspect(input: &ChoiceInput) -> Vec<RowAssessment> {
    let served = q8::resolved(input);
    let served_for = |entry: &ModelEntry| {
        served
            .iter()
            .find(|(owner, _)| std::ptr::eq(*owner, entry))
            .map(|(_, candidate)| candidate)
    };
    manifest::rows()
        .map(|entry| {
            let Some(candidate) = served_for(entry) else {
                return RowAssessment {
                    entry,
                    standing: entry.standing(),
                    footprint: footprint_bytes(entry, input.context_tokens),
                    decode: None,
                    too_slow: false,
                    dense_line: dense_speed_floor(entry),
                };
            };
            let decode = Some(candidate.decode);
            RowAssessment {
                entry: candidate.entry,
                standing: entry.standing(),
                footprint: candidate.footprint,
                decode,
                too_slow: matches!(
                    decode,
                    Some(Prediction::Range { low, .. }) if low < MINIMUM_TOKENS_PER_SECOND
                ),
                dense_line: dense_speed_floor(entry),
            }
        })
        .collect()
}
