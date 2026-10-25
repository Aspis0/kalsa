//! What a withheld marker's trials give the retry: the answers the
//! picture starts from, and the lifetimes they proved measured — the ones
//! the plan does not count and the passes never run again.

use std::path::PathBuf;

use super::settings_for;
use crate::candidates::Candidate;
use crate::record::Kept;
use crate::score::Reply;

/// Whether a saved entry answers for its lifetime: a reply by itself,
/// a refusal only when its own `answers` says the server did — the one
/// list, held by the refusal.
fn answers(kept: &Kept) -> bool {
    match kept {
        Kept::Replied(_) => true,
        Kept::Refused { refusal, .. } => refusal.answers(),
    }
}

/// Whether the entry names a lifetime THIS plan runs: one of the current
/// shapes with its off setting, or with a setting the sweep drafts. The
/// plan's thread count is not part of the fingerprint, so a marker can
/// outlive a candidate list — an entry for a launch this start will not
/// run is neither seeded nor counted.
fn in_plan(
    shapes: &[(Candidate, PathBuf)],
    settings: &[Option<u32>],
    candidate: &Candidate,
) -> bool {
    let shape = Candidate {
        draft: None,
        ..*candidate
    };
    shapes.iter().any(|(known, _)| *known == shape)
        && (candidate.draft.is_none() || settings.contains(&candidate.draft))
}

/// The marker's trials as this plan may use them: answered, and a
/// lifetime of the current shapes — everything a retry skips, seeds and
/// counts flows from this one filter.
pub(crate) struct Resume {
    saved: Vec<(Candidate, Kept)>,
}

/// The retry's picture before anything runs: the saved answers whole, and
/// the pass-one state they give — each shape's prefill, its off reply the
/// sweep order reads, which shapes' first lifetime stands, and the
/// fastest reply the prefill bound is measured against.
pub(crate) struct Seeded {
    pub(crate) trials: Vec<(Candidate, Kept)>,
    pub(crate) prompt: Vec<Option<f64>>,
    pub(crate) off_replies: Vec<Option<(Candidate, Reply)>>,
    pub(crate) answered: Vec<bool>,
    pub(crate) best: Option<f64>,
}

/// The marker's trials THIS plan may use — the one filter a retry
/// obeys, given to both the measure (which seeds and counts exactly
/// these) and the pool (which may restore exactly these): answered, and
/// a lifetime of the current shapes at the settings the sweep drafts.
/// The plan's thread count is not part of the fingerprint, so a marker
/// can outlive a candidate list — an entry for a launch this start will
/// not run is dropped here, before anyone seeds or counts it.
pub fn plan_prior(
    prior: &[(Candidate, Kept)],
    shapes: &[(Candidate, PathBuf)],
    drafter: bool,
) -> Vec<(Candidate, Kept)> {
    let settings = settings_for(drafter);
    prior
        .iter()
        .filter(|(candidate, kept)| answers(kept) && in_plan(shapes, settings, candidate))
        .cloned()
        .collect()
}

impl Resume {
    pub(crate) fn new(
        prior: &[(Candidate, Kept)],
        shapes: &[(Candidate, PathBuf)],
        drafter: bool,
    ) -> Self {
        Resume {
            saved: plan_prior(prior, shapes, drafter),
        }
    }

    /// The saved entry for this launch, if the plan keeps one: answered,
    /// and a lifetime of the current shapes.
    pub(crate) fn kept(&self, candidate: &Candidate) -> Option<&Kept> {
        self.saved
            .iter()
            .find(|(saved, _)| saved == candidate)
            .map(|(_, kept)| kept)
    }

    /// Whether the saved trials prove this launch measured: an answered
    /// entry — a reply, or a refusal from a server that ran — says the
    /// lifetime ran to its answer, and only that says so. A lifetime that
    /// only ever failed to start has no answer here and runs again.
    pub(crate) fn measured(&self, candidate: &Candidate) -> bool {
        self.kept(candidate).is_some()
    }

    /// One shape's drafted settings nothing has proved measured: what its
    /// sweep still costs this start.
    pub(crate) fn sweeps_left(&self, shape: &Candidate, settings: &[Option<u32>]) -> usize {
        settings
            .iter()
            .filter(|setting| {
                !self.measured(&Candidate {
                    draft: **setting,
                    ..*shape
                })
            })
            .count()
    }

    /// The saved answers in the picture: every trial the first attempt
    /// proved kept, and — per shape — the state pass one would have built
    /// from its first lifetime. A shape whose entry is missing, or never
    /// answered (a startup refusal, a cut), stays unanswered and runs
    /// like a first tune's.
    pub(crate) fn seed(&self, shapes: &[(Candidate, PathBuf)]) -> Seeded {
        let mut seeded = Seeded {
            trials: self.saved.clone(),
            prompt: vec![None; shapes.len()],
            off_replies: vec![None; shapes.len()],
            answered: vec![false; shapes.len()],
            best: None,
        };
        for (_, kept) in &self.saved {
            if let Kept::Replied(reply) = kept {
                seeded.best = Some(
                    seeded
                        .best
                        .map_or(reply.seconds, |fast| fast.min(reply.seconds)),
                );
            }
        }
        for (index, (shape, _)) in shapes.iter().enumerate() {
            let off = Candidate {
                draft: None,
                ..*shape
            };
            let Some(kept) = self.kept(&off) else {
                continue; // nothing proved this shape's first lifetime: it runs
            };
            seeded.answered[index] = true;
            match kept {
                Kept::Replied(reply) => {
                    seeded.prompt[index] = Some(reply.prompt_rate);
                    seeded.off_replies[index] = Some((off, *reply));
                }
                // The room ask answered and the off-decode refused: the
                // prefill stands, the shape has no off number and no sweep.
                Kept::Refused { prompt_rate, .. } => seeded.prompt[index] = *prompt_rate,
            }
        }
        seeded
    }
}
