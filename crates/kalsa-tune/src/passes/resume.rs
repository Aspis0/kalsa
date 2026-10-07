//! What a withheld marker's trials give the retry: the answers the
//! picture starts from, and the lifetimes they proved measured — the ones
//! the plan does not count and the passes never run again.

use std::path::PathBuf;

use crate::candidates::Candidate;
use crate::record::Kept;
use crate::refusal::Refusal;
use crate::score::Reply;

/// Whether a saved entry answers for its lifetime: the server was up, it
/// passed the identity gates, and the ask came back. A reply is the
/// measurement itself; of the refusals, `NoUsableAnswer` and
/// `PromptTooShort` come from a server that ran — the ask was made and
/// what came back held no usable number (a decode past its own 60 s
/// bound, a room answer read from cache; a plain HTTP or timeout error
/// lands in `NoUsableAnswer` too, and stays an answer: the setting had
/// its chance inside the tune's own bound). Re-measuring would spend a
/// lifetime to learn it again. `DidNotStart` (the spawn failed, the
/// process died, the identity was never ours) and `NotReady` (alive, but
/// past the readiness deadline) never answered: a slow first start under
/// an antivirus scan earns a retry, not a verdict.
fn answers(kept: &Kept) -> bool {
    match kept {
        Kept::Replied(_) => true,
        Kept::Refused { refusal, .. } => {
            matches!(refusal, Refusal::NoUsableAnswer | Refusal::PromptTooShort)
        }
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

impl Resume {
    pub(crate) fn new(
        prior: &[(Candidate, Kept)],
        shapes: &[(Candidate, PathBuf)],
        settings: &[Option<u32>],
    ) -> Self {
        let saved = prior
            .iter()
            .filter(|(candidate, kept)| answers(kept) && in_plan(shapes, settings, candidate))
            .cloned()
            .collect();
        Resume { saved }
    }

    /// Whether the saved trials prove this launch measured: an answered
    /// entry — a reply, or a refusal from a server that ran — says the
    /// lifetime ran to its answer, and only that says so. A lifetime that
    /// only ever failed to start has no answer here and runs again.
    pub(crate) fn measured(&self, candidate: &Candidate) -> bool {
        self.saved.iter().any(|(saved, _)| saved == candidate)
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
            let Some((_, kept)) = self.saved.iter().find(|(saved, _)| *saved == off) else {
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
