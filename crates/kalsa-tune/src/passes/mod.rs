//! The tune's two passes under one budget: every shape's first lifetime —
//! the room ask and the shape's own off-decode in one server — then the
//! drafted sweep, off the shape's own numbers, so a shape that cannot
//! reach the best complete reply even inside the tie band costs one
//! lifetime instead of four.

use std::path::PathBuf;
use std::time::Duration;

use crate::candidates::Candidate;
use crate::record::Kept;
use crate::refusal::Refusal;
use crate::score::{best_rate, prefill_seconds, reply_winner, Reply, Winner, TIE_BAND};

/// The drafted settings a shape is swept at when the plan ships a drafter;
/// the off setting is not among them — it rides the shape's first lifetime
/// on the drafter-less launch a start without speculation really is.
const DRAFT_SETTINGS: [Option<u32>; 3] = [Some(2), Some(3), Some(4)];

/// One shape's answer to one lifetime: the rates it measured, or the
/// closed cause that kept them from arriving.
pub(crate) type Samples = Result<Vec<f64>, Refusal>;

/// What one shape's first lifetime measured: the room ask's prefill rate,
/// and the shape's own off-decode — the same ask, warm-up and two measured
/// requests every drafted setting gets.
pub(crate) struct First {
    pub prompt_rate: f64,
    pub off: Samples,
}

/// What the two passes produced: the trials the record keeps, the winner
/// the launch applies, whether every shape's first lifetime ran, and
/// whether the budget stopped a drafted sweep. A shape that never began is
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

/// The two passes over the resolved shapes, under the caller's own clock
/// and budget: each shape's first lifetime, then its drafted sweep. A
/// shape's answer arrives whole — a first lifetime that refuses costs no
/// drafted lifetime, and a refused off-decode still leaves the prefill
/// number that the sweep and the bound run on.
pub(crate) fn tune<P, D>(
    shapes: &[(Candidate, PathBuf)],
    drafter: bool,
    budget: Duration,
    since_start: impl Fn() -> Duration,
    progress: &mut dyn FnMut(usize, usize),
    mut first: P,
    mut decode: D,
) -> Tuned
where
    P: FnMut(&Candidate, &PathBuf) -> Result<First, Refusal>,
    D: FnMut(&Candidate, &PathBuf) -> Samples,
{
    let settings: &[Option<u32>] = if drafter { &DRAFT_SETTINGS } else { &[] };
    let mut planned = shapes.len() * (1 + settings.len());
    let mut done = 0usize;
    let mut trials: Vec<(Candidate, Kept)> = Vec::new();
    let mut complete = true;
    let mut cut = false;

    // Pass one: every shape's first lifetime, in the order built — the
    // likely winner first, so its complete off reply is the bound for
    // everything after it. The off trial is kept here, not in the sweep:
    // its reply is the shape's own number, and it can be the best before
    // any drafted setting runs.
    let mut prompt: Vec<Option<f64>> = vec![None; shapes.len()];
    let mut refused: Vec<Option<Refusal>> = vec![None; shapes.len()];
    let mut ran: Vec<bool> = vec![false; shapes.len()];
    let mut best: Option<f64> = None;
    for (index, (shape, exe)) in shapes.iter().enumerate() {
        if since_start() >= budget {
            complete = false; // never began: a shape-sized hole in the picture
            break;
        }
        progress(done, planned);
        ran[index] = true;
        match first(shape, exe) {
            Ok(measured) => {
                prompt[index] = Some(measured.prompt_rate);
                let off = Candidate {
                    draft: None,
                    ..*shape
                };
                match measured.off {
                    Ok(rates) => match best_rate(&rates)
                        .and_then(|rate| Reply::from_rates(measured.prompt_rate, rate))
                    {
                        Some(reply) => {
                            best = Some(
                                best.map_or(reply.seconds, |current| current.min(reply.seconds)),
                            );
                            trials.push((off, Kept::Replied(reply)));
                        }
                        None => trials.push((
                            off,
                            Kept::Refused {
                                refusal: Refusal::NoUsableAnswer,
                                prompt_rate: Some(measured.prompt_rate),
                            },
                        )),
                    },
                    Err(refusal) => trials.push((
                        off,
                        Kept::Refused {
                            refusal,
                            prompt_rate: Some(measured.prompt_rate),
                        },
                    )),
                }
            }
            Err(refusal) => refused[index] = Some(refusal),
        }
        done += 1;
        if prompt[index].is_none() {
            // A shape that cannot be scored has no sweep left to run: the
            // plan lowers now, so the panel's total is what will happen.
            planned = lower(planned, settings.len(), done);
            progress(done, planned);
            trials.push((
                *shape,
                Kept::Refused {
                    refusal: refused[index].unwrap_or(Refusal::NoUsableAnswer),
                    prompt_rate: None,
                },
            ));
        }
    }

    // Pass two: each shape's drafted sweep, in the same order. A reply
    // costs at least its shape's prefill, so a shape whose prefill lands
    // beyond the best reply outside [`TIE_BAND`] can no longer enter the
    // band and its drafted lifetimes are skipped — not a hole, its own off
    // entry stands. Inside the band it still competes, and on decode.
    'sweep: for (index, (shape, exe)) in shapes.iter().enumerate() {
        if !ran[index] {
            break; // the budget cut pass one: the shapes behind it never ran
        }
        let Some(shape_prompt) = prompt[index] else {
            continue; // the first lifetime refused: its entry is that refusal
        };
        if best.is_some_and(|best| prefill_seconds(shape_prompt) > best * (1.0 + TIE_BAND)) {
            // The bound skipped lifetimes that will never run: the plan
            // lowers with them.
            planned = lower(planned, settings.len(), done);
            progress(done, planned);
            continue;
        }
        for setting in settings {
            if since_start() >= budget {
                // Nothing behind this check can begin: every later setting
                // and every later shape would stop here. The sweep is
                // unfinished — the caller must let the next start try
                // again — and the plan is finished as of now.
                cut = true;
                planned = done;
                progress(done, planned);
                break 'sweep;
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

/// Lower the plan by the sweeps a shape will never run. The plan counted
/// exactly one sweep per shape, so a subtraction past what is left is this
/// side's bug: loud here, never a wrapped number on a panel.
fn lower(planned: usize, settings: usize, done: usize) -> usize {
    let lowered = planned
        .checked_sub(settings)
        .expect("the plan counted every shape's sweep");
    debug_assert!(lowered >= done, "the plan cannot fall below what began");
    lowered
}

#[cfg(test)]
mod tests;
