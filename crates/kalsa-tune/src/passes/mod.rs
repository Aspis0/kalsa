//! The tune's two passes under one budget: every shape's first lifetime —
//! the room ask and the shape's own off-decode in one server — then the
//! drafted sweep on the off-winner and on the shapes whose history reads
//! faster than it. A shape outside that set costs one lifetime instead of
//! four: what it measured is what the record keeps.

use std::path::PathBuf;
use std::time::Duration;

use crate::candidates::Candidate;
use crate::record::Kept;
use crate::refusal::Refusal;
use crate::score::{
    best_rate, decode_seconds, prefill_seconds, reply_winner, Reply, Winner, TIE_BAND,
};

/// The drafted settings a shape is swept at when the plan ships a drafter;
/// the off setting is not among them — it rides the shape's first lifetime
/// on the drafter-less launch a start without speculation really is.
const DRAFT_SETTINGS: [Option<u32>; 3] = [Some(2), Some(3), Some(4)];

/// How much faster a shape's history must read than the off-winner's to
/// earn a drafted sweep: a reply reads its history on every setting, and
/// MTP speeds decode only, so the shapes worth a sweep are the ones that
/// already read faster than the winner.
const PREFILL_EDGE: f64 = 1.05;

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

/// One report from the two passes, in the shape the walk's words are built
/// from: how far the plan has got (lifetimes finished and planned) and which
/// candidate the report is about — `done + 1` when that candidate starts,
/// `done` when it closes, and `done` too when only the plan lowered (nothing
/// new ran, so the last closed candidate still names the report). `cut` is
/// the stop marker: the budget (or a shape that never began) ended the tune
/// short of its plan, so `total` still names what this start OWED and the
/// page must not read `done == total` as a finish — the rest runs next time.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Report {
    pub done: usize,
    pub total: usize,
    pub candidate: usize,
    pub cut: bool,
}

/// What the two passes produced: the trials the record keeps, the winner
/// the launch applies, whether every shape's first lifetime ran, and
/// whether the budget stopped a drafted sweep. A shape that never began is
/// a hole in the picture, and the caller withholds that picture as a
/// marker so the next start can finish it — a second unfinished picture is
/// kept as it stands.
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
    progress: &mut dyn FnMut(Report),
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
    // Each shape's off reply with the candidate that made it: the sweep
    // order is read from these, so it cannot disagree with the entries.
    let mut off_replies: Vec<Option<(Candidate, Reply)>> = vec![None; shapes.len()];
    let mut best: Option<f64> = None;
    for (index, (shape, exe)) in shapes.iter().enumerate() {
        if since_start() >= budget {
            complete = false; // never began: a shape-sized hole in the picture
            break;
        }
        // The candidate starts: its index is what the page names, and the
        // close below is the only other report it makes about this one.
        progress(Report {
            done,
            total: planned,
            candidate: done + 1,
            cut: false,
        });
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
                            off_replies[index] = Some((off, reply));
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
            // A shape the first lifetime could not score has no off number
            // and no sweep: the refusal is its whole answer, and its planned
            // lifetimes leave the plan with every other unswept shape.
            trials.push((
                *shape,
                Kept::Refused {
                    refusal: refused[index].unwrap_or(Refusal::NoUsableAnswer),
                    prompt_rate: None,
                },
            ));
        }
        progress(Report {
            done,
            total: planned,
            candidate: done,
            cut: false,
        });
    }

    // Pass two: the drafted sweeps — the off-winner's first, then every
    // shape whose history reads at least [`PREFILL_EDGE`] faster than the
    // winner's, largest decode saving first. The rest keep their off entries
    // and the plan lowers with the lifetimes they will never run: a reply
    // reads its history on every setting, and speculation speeds decode
    // only. The bound below still stands on top: a reply costs at least its
    // shape's prefill, so a shape whose prefill lands beyond the best reply
    // outside [`TIE_BAND`] can no longer enter the band either.
    let order = sweep_order(&off_replies);
    // The ledger: every shape that ran and is not in `order` loses its sweep
    // here, once, whatever kept it out — a first lifetime that refused, an
    // off-decode that refused, or a history too slow to sweep — so the total
    // is what will really run and no planned sweep stays behind a shape that
    // never got one. `done` counts the shapes that began (pass one walks them
    // in order and stops at the first the budget cannot start): the shapes it
    // never reached stay owed, and the stop report says so.
    let unswept = if settings.is_empty() {
        0
    } else {
        (0..done).filter(|index| !order.contains(index)).count()
    };
    for _ in 0..unswept {
        planned = lower(planned, settings.len(), done);
        progress(Report {
            done,
            total: planned,
            candidate: done,
            cut: false,
        });
    }
    'sweep: for index in order {
        let (shape, exe) = &shapes[index];
        let Some(shape_prompt) = prompt[index] else {
            continue; // the first lifetime refused: its entry is that refusal
        };
        if best.is_some_and(|best| prefill_seconds(shape_prompt) > best * (1.0 + TIE_BAND)) {
            planned = lower(planned, settings.len(), done);
            progress(Report {
                done,
                total: planned,
                candidate: done,
                cut: false,
            });
            continue;
        }
        for setting in settings {
            if since_start() >= budget {
                // Nothing behind this check can begin: every later setting
                // and every later shape would stop here. The sweep is
                // unfinished — the caller must let the next start try
                // again — and the plan is finished as of now.
                cut = true;
                // The plan is NOT re-cut down to `done`: what this start
                // did not measure is what it still owes, and the page's bar
                // must stay at the height the tune really reached.
                progress(Report {
                    done,
                    total: planned,
                    candidate: done,
                    cut: true,
                });
                break 'sweep;
            }
            progress(Report {
                done,
                total: planned,
                candidate: done + 1,
                cut: false,
            });
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
            // The candidate closes: the page's bar counts these, and its
            // line names the one that just ran.
            progress(Report {
                done,
                total: planned,
                candidate: done,
                cut: false,
            });
        }
    }
    // The plan as it stands: on a finished tune that is exactly what ran,
    // and on one the budget stopped it is what the next start is owed.
    progress(Report {
        done,
        total: planned,
        candidate: done,
        cut: cut || !complete,
    });

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

/// The drafted sweeps this tune runs, in order: the off-winner first — the
/// same candidate the score picked, so a drafted setting can be measured
/// against it — then every shape whose history reads at least
/// [`PREFILL_EDGE`] faster than the winner's, the largest decode saving
/// (`200/D`, the most MTP can take away) first. `None` entries are shapes
/// whose first lifetime refused: they have no off number to sweep from.
fn sweep_order(off_replies: &[Option<(Candidate, Reply)>]) -> Vec<usize> {
    let scored: Vec<(Candidate, Reply)> = off_replies.iter().flatten().copied().collect();
    let Some(winner) = reply_winner(&scored) else {
        return Vec::new();
    };
    let Some(winner_index) = off_replies.iter().position(|entry| {
        matches!(entry, Some((candidate, reply))
            if *candidate == winner.candidate && *reply == winner.reply)
    }) else {
        return Vec::new();
    };
    let mut ahead: Vec<(usize, f64)> = off_replies
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            let (_, reply) = (*entry)?;
            (reply.prompt_rate >= winner.reply.prompt_rate * PREFILL_EDGE)
                .then(|| (index, decode_seconds(reply.decode_rate)))
        })
        .collect();
    ahead.sort_by(|left, right| right.1.total_cmp(&left.1));
    let mut order = vec![winner_index];
    order.extend(ahead.into_iter().map(|(index, _)| index));
    order
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
