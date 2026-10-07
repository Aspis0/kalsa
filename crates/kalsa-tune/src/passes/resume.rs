//! What a withheld marker's trials give the retry: the answers the
//! picture starts from, and the lifetimes they prove measured — the ones
//! the plan does not count and the passes never run again.

use std::path::PathBuf;

use crate::candidates::Candidate;
use crate::record::Kept;
use crate::score::Reply;

/// The first attempt's trials, keyed on the launch each one ran: a
/// lifetime is its candidate — the shape with its draft setting — never a
/// count or a position, so the entry itself is the only proof. A lifetime
/// the budget stopped has no entry: it is missing here and runs again.
pub(crate) struct Resume<'a> {
    prior: &'a [(Candidate, Kept)],
}

/// The retry's picture before anything runs: the marker's trials whole,
/// and the pass-one state they answer — each shape's prefill, its off
/// reply the sweep order reads, which shapes' first lifetime stands, and
/// the fastest reply the prefill bound is measured against.
pub(crate) struct Seeded {
    pub(crate) trials: Vec<(Candidate, Kept)>,
    pub(crate) prompt: Vec<Option<f64>>,
    pub(crate) off_replies: Vec<Option<(Candidate, Reply)>>,
    pub(crate) answered: Vec<bool>,
    pub(crate) best: Option<f64>,
}

impl<'a> Resume<'a> {
    pub(crate) fn new(prior: &'a [(Candidate, Kept)]) -> Self {
        Resume { prior }
    }

    /// Whether the saved trials answer for this launch: an entry — a
    /// reply or a closed refusal — says the lifetime ran to an answer,
    /// and only an entry says so.
    pub(crate) fn measured(&self, candidate: &Candidate) -> bool {
        self.prior.iter().any(|(saved, _)| saved == candidate)
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
    /// from its first lifetime. A shape with no entry stays unanswered and
    /// runs like a first tune's.
    pub(crate) fn seed(&self, shapes: &[(Candidate, PathBuf)]) -> Seeded {
        let mut seeded = Seeded {
            trials: self.prior.to_vec(),
            prompt: vec![None; shapes.len()],
            off_replies: vec![None; shapes.len()],
            answered: vec![false; shapes.len()],
            best: None,
        };
        for (_, kept) in self.prior {
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
            let Some((_, kept)) = self.prior.iter().find(|(saved, _)| *saved == off) else {
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
