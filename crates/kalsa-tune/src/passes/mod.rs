//! The tune's two passes under one budget: every shape's prefill first, so
//! a shape whose history alone already costs more than the best complete
//! reply costs one lifetime instead of five; then the decode sweep, off
//! first, on every shape the bound did not skip.

use std::path::PathBuf;
use std::time::Duration;

use crate::candidates::Candidate;
use crate::record::Kept;
use crate::refusal::Refusal;
use crate::score::{best_rate, prefill_seconds, reply_winner, Reply, Skip, Winner};

/// The draft settings every shape is swept at when the plan ships a
/// drafter; off is first, so a budget cut leaves every shape a complete
/// target-only reply rather than a hole. No drafter, one setting: the
/// shape alone.
const DRAFT_SETTINGS: [Option<u32>; 4] = [None, Some(2), Some(3), Some(4)];

/// What the two passes produced: the trials the record keeps, the winner
/// the launch applies, whether every shape's first lifetime ran, and
/// whether the budget stopped a decode sweep. A shape that never began is
/// a hole in the picture, and the caller withholds the record rather than
/// pinning a partial one; a sweep the budget cut is a marker for the next
/// start, which gets the chance to finish it.
#[derive(Debug, PartialEq)]
pub struct Tuned {
    pub trials: Vec<(Candidate, Kept)>,
    pub winner: Option<Winner>,
    pub complete: bool,
    pub cut: bool,
}

/// One shape's answer to one lifetime: the rates it measured, or the
/// closed cause that kept them from arriving.
pub(crate) type Samples = Result<Vec<f64>, Refusal>;

/// The two passes over the resolved shapes, under the caller's own clock
/// and budget: each shape's prefill, then its decode sweep. A shape's
/// answer arrives whole — a prefill that refuses costs no decode lifetime,
/// a skip keeps the prefill number that justified it.
pub(crate) fn tune<P, D>(
    shapes: &[(Candidate, PathBuf)],
    drafter: bool,
    budget: Duration,
    since_start: impl Fn() -> Duration,
    progress: &mut dyn FnMut(usize, usize),
    mut prefill: P,
    mut decode: D,
) -> Tuned
where
    P: FnMut(&Candidate, &PathBuf) -> Samples,
    D: FnMut(&Candidate, &PathBuf) -> Samples,
{
    let settings: &[Option<u32>] = if drafter { &DRAFT_SETTINGS } else { &[None] };
    let mut planned = shapes.len() * (1 + settings.len());
    let mut done = 0usize;
    let mut trials: Vec<(Candidate, Kept)> = Vec::new();
    let mut complete = true;
    let mut cut = false;

    // Pass one: every shape's prefill, in the order built — the likely
    // winner first, so its complete reply is the bound for everything
    // after it.
    let mut prompt: Vec<Option<f64>> = vec![None; shapes.len()];
    let mut refused: Vec<Option<Refusal>> = vec![None; shapes.len()];
    let mut ran: Vec<bool> = vec![false; shapes.len()];
    for (index, (shape, exe)) in shapes.iter().enumerate() {
        if since_start() >= budget {
            complete = false; // never began: a shape-sized hole in the picture
            break;
        }
        progress(done, planned);
        ran[index] = true;
        match prefill(shape, exe) {
            Ok(rates) => match best_rate(&rates) {
                Some(rate) => prompt[index] = Some(rate),
                None => refused[index] = Some(Refusal::NoUsableAnswer),
            },
            Err(refusal) => refused[index] = Some(refusal),
        }
        done += 1;
        if prompt[index].is_none() {
            // A shape that cannot be scored has no sweep left to run: the
            // plan lowers now, so the panel's total is what will happen.
            planned -= settings.len();
            progress(done, planned);
        }
    }

    // Pass two: each shape's decode sweep, in the same order. A shape
    // whose prefill alone already costs at least the best complete reply
    // cannot beat it, so its lifetimes become one skip — not a hole, and
    // not an answer either.
    let mut best: Option<f64> = None;
    for (index, (shape, exe)) in shapes.iter().enumerate() {
        if !ran[index] {
            break; // the budget cut pass one: the shapes behind it never ran
        }
        let Some(shape_prompt) = prompt[index] else {
            // The prefill refused: no reply can be scored, and the shape's
            // own answer is that refusal.
            trials.push((
                *shape,
                Kept::Refused {
                    refusal: refused[index].unwrap_or(Refusal::NoUsableAnswer),
                    prompt_rate: None,
                },
            ));
            continue;
        };
        if best.is_some_and(|best| prefill_seconds(shape_prompt) >= best) {
            trials.push((
                *shape,
                Kept::PromptOnly {
                    prompt_rate: shape_prompt,
                    skipped: Skip::Bounded,
                },
            ));
            // The bound skipped lifetimes that will never run: the plan
            // lowers with them.
            planned -= settings.len();
            progress(done, planned);
            continue;
        }
        let before = trials.len();
        for setting in settings {
            if since_start() >= budget {
                // The settings behind this one never ran: losers, not
                // holes — but the sweep is unfinished, and the caller must
                // let the next start try again.
                cut = true;
                break;
            }
            progress(done, planned);
            let trial = Candidate {
                draft: *setting,
                ..*shape
            };
            done += 1;
            match decode(&trial, exe) {
                Ok(rates) => match best_rate(&rates)
                    .and_then(|decode_rate| Reply::from_rates(shape_prompt, decode_rate))
                {
                    Some(reply) => {
                        best =
                            Some(best.map_or(reply.seconds, |current| current.min(reply.seconds)));
                        trials.push((trial, Kept::Replied(reply)));
                    }
                    None => trials.push((
                        trial,
                        Kept::Refused {
                            refusal: Refusal::NoUsableAnswer,
                            prompt_rate: Some(shape_prompt),
                        },
                    )),
                },
                Err(refusal) => trials.push((
                    trial,
                    Kept::Refused {
                        refusal,
                        prompt_rate: Some(shape_prompt),
                    },
                )),
            }
        }
        if trials.len() == before {
            // The budget ran out before this shape's first decoded ask:
            // its prefill ran, so the record is still whole — the shape
            // has a number, just no reply.
            trials.push((
                *shape,
                Kept::PromptOnly {
                    prompt_rate: shape_prompt,
                    skipped: Skip::Cut,
                },
            ));
        }
    }
    // The plan may only shrink at the end, to what really began.
    progress(done, done);

    let scored: Vec<(Candidate, Reply)> = trials
        .iter()
        .filter_map(|(candidate, kept)| match kept {
            Kept::Replied(reply) => Some((*candidate, *reply)),
            _ => None,
        })
        .collect();
    Tuned {
        trials,
        winner: reply_winner(&scored),
        complete,
        cut,
    }
}

#[cfg(test)]
mod tests;
