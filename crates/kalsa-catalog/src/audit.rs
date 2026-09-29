//! The row-by-row facts behind a catalog decision.
//!
//! This is diagnostic data, not a second chooser: usable rows are assessed
//! through the chooser's own resolution and candidate construction, while
//! the research record and gated rows remain visible with their manifest
//! reason.

use crate::candidate::Candidate;
use crate::choice::{dense_speed_floor, provably_too_slow, ChoiceInput};
use crate::footprint::{footprint_bytes, Footprint};
use crate::licence::Standing;
use crate::manifest::{self, ModelEntry, CATALOG, DOWNLOADABLE};
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
/// record stay visible with their manifest reason. The rows walk in the
/// tables' own order, and each download row's candidate comes from the
/// pairing over that row itself, so the two cannot desync.
pub fn inspect(input: &ChoiceInput) -> Vec<RowAssessment> {
    let mut rows: Vec<RowAssessment> = CATALOG
        .iter()
        .map(|entry| assessed(entry, None, input))
        .collect();
    rows.extend(DOWNLOADABLE.iter().map(|row| {
        let served = q8::resolved_in(
            manifest::usable_with_q8_in(std::slice::from_ref(row)),
            input,
        )
        .into_iter()
        .next()
        .map(|(_, candidate)| candidate);
        assessed(&row.model, served, input)
    }));
    rows
}

/// One row's facts: its own standing and dense line always; the chooser's
/// served candidate — file, footprint, prediction — when the row is on the
/// menu, and plain table arithmetic otherwise.
fn assessed(
    entry: &'static ModelEntry,
    served: Option<Candidate<'static>>,
    input: &ChoiceInput,
) -> RowAssessment {
    match served {
        Some(candidate) => RowAssessment {
            entry: candidate.entry,
            standing: entry.standing(),
            footprint: candidate.footprint,
            decode: Some(candidate.decode),
            too_slow: provably_too_slow(&candidate.decode),
            dense_line: dense_speed_floor(entry),
        },
        None => RowAssessment {
            entry,
            standing: entry.standing(),
            footprint: footprint_bytes(entry, input.context_tokens),
            decode: None,
            too_slow: false,
            dense_line: dense_speed_floor(entry),
        },
    }
}
