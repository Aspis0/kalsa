//! The tune's two passes under one budget: every shape's first lifetime —
//! the room ask and the shape's own off-decode in one server — then the
//! drafted sweep on the off-winner and on the shapes whose history reads
//! faster than it. A shape outside that set costs one lifetime instead of
//! four: what it measured is what the record keeps.
//!
//! A withheld marker's trials arrive as `prior`: what they ANSWERED is
//! seeded in whole and never runs again, and the plan — and its report —
//! count only the lifetimes that are left. A lifetime that never started
//! has no answer and runs again.

use std::path::PathBuf;
use std::time::Duration;

mod resume;

pub use self::resume::plan_prior;
use self::resume::{Resume, Seeded};
use crate::candidates::Candidate;
use crate::record::{Kept, Trials};
use crate::refusal::Refusal;
use crate::score::{
    best_rate, decode_seconds, prefill_seconds, reply_winner, Reply, Winner, TIE_BAND,
};

/// The drafted settings a shape is swept at when the plan ships a drafter;
/// the off setting is not among them — it rides the shape's first lifetime
/// on the drafter-less launch a start without speculation really is.
const DRAFT_SETTINGS: [Option<u32>; 3] = [Some(2), Some(3), Some(4)];

/// The drafted settings THIS plan runs — one home for the rule, so the
/// sweep, the plan's counts and the retry's filter cannot disagree.
fn settings_for(drafter: bool) -> &'static [Option<u32>] {
    if drafter {
        &DRAFT_SETTINGS
    } else {
        &[]
    }
}

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

/// What the two passes produced: the trials the record keeps — the
/// marker's seeded answers beside everything this run measured — the
/// winner the launch applies, whether every shape's first lifetime has an
/// answer, and whether the budget stopped a drafted sweep. A shape that
/// never began is a hole in the picture, and the caller withholds that
/// picture as a marker so the next start can finish it — a second
/// unfinished picture is kept as it stands.
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
///
/// `prior` is the withheld marker's trials: a lifetime they answered —
/// a reply, or a refusal from a server that ran — keeps its entry and
/// never runs again, so on a retry the plan, the budget and the reports
/// below are only about what is left; a lifetime that never got its
/// answer (the budget cut it, the spawn failed) runs like any other.
///
/// `checkpoint` receives the trials whole after every finished lifetime —
/// the caller writes them to disk there, so a run that dies later keeps
/// every lifetime it already measured. It is called on closes only, never
/// on plan-lowering or budget reports: one write per lifetime, none per
/// progress tick.
#[allow(clippy::too_many_arguments)]
pub(crate) fn tune<P, D>(
    shapes: &[(Candidate, PathBuf)],
    drafter: bool,
    prior: &[(Candidate, Kept)],
    budget: Duration,
    since_start: impl Fn() -> Duration,
    progress: &mut dyn FnMut(Report),
    checkpoint: &mut dyn FnMut(&Trials),
    mut first: P,
    mut decode: D,
) -> Tuned
where
    P: FnMut(&Candidate, &PathBuf) -> Result<First, Refusal>,
    D: FnMut(&Candidate, &PathBuf) -> Samples,
{
    let settings = settings_for(drafter);
    // The marker's trials this plan may use: answered, and lifetimes of
    // the current shapes. What they proved measured is seeded into the
    // picture and leaves this start's plan — the retry runs only the
    // lifetimes they never answered.
    let resume = Resume::new(prior, shapes, drafter);
    let Seeded {
        mut trials,
        mut prompt,
        mut off_replies,
        mut answered,
        mut best,
    } = resume.seed(shapes);
    // The plan as it starts: the first lifetimes nothing has proved
    // measured plus every shape's drafted settings less the ones saved —
    // what this start owes, never the whole tune's share.
    let mut planned = shapes
        .iter()
        .map(|(shape, _)| {
            let off = Candidate {
                draft: None,
                ..*shape
            };
            usize::from(!resume.measured(&off)) + resume.sweeps_left(shape, settings)
        })
        .sum();
    let mut done = 0usize;
    let mut complete = true;
    let mut cut = false;
    let mut refused: Vec<Option<Refusal>> = vec![None; shapes.len()];

    // Pass one: every shape whose first lifetime is still unproved, in
    // the order built — the likely winner first, so its complete off
    // reply is the bound for everything after it. The off trial is kept
    // here, not in the sweep: its reply is the shape's own number, and it
    // can be the best before any drafted setting runs. Shapes the marker
    // already answered are seeded above and cost this loop nothing.
    for (index, (shape, exe)) in shapes.iter().enumerate() {
        if answered[index] {
            continue;
        }
        if since_start() >= budget {
            complete = false; // never began: a shape-sized hole in the picture
            break;
        }
        // The candidate starts: `done + 1` names it in this start's own
        // plan — the lifetimes already proved measured are behind it — and
        // the close below is the only other report it makes about this one.
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
        answered[index] = true;
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
        // The lifetime is finished and its entry is in: the disk gets the
        // picture as it stands, so a run that dies after this keeps it.
        checkpoint(&trials);
    }

    // Pass two: the drafted sweeps — the off-winner's first, then every
    // shape whose history reads at least [`PREFILL_EDGE`] faster than the
    // winner's, largest decode saving first. The rest keep their off entries
    // and the plan lowers with the lifetimes they will never run: a reply
    // reads its history on every setting, and speculation speeds decode
    // only — so a shape's sweep ends at its first drafted setting that is
    // refused or does not write faster than the shape with the drafter off,
    // and the settings behind it leave the plan (measured: a setting that
    // loses to off is not followed by a higher n that wins). The bound below
    // still stands on top: a reply costs at least its
    // shape's prefill, so a shape whose prefill lands beyond the best reply
    // outside [`TIE_BAND`] can no longer enter the band either.
    let order = sweep_order(&off_replies);
    // The ledger: every answered shape that is not in `order` loses its
    // sweep here, once, whatever kept it out — a first lifetime that
    // refused, an off-decode that refused, or a history too slow to sweep
    // — so the total is what will really run and no planned sweep stays
    // behind a shape that never got one. The shapes pass one never
    // reached are unanswered: their sweeps stay owed, and the stop report
    // says so.
    for (index, (shape, _)) in shapes.iter().enumerate() {
        if !answered[index] || order.contains(&index) {
            continue;
        }
        let owed = resume.sweeps_left(shape, settings);
        if owed == 0 {
            continue; // the marker already holds this shape's sweeps
        }
        planned = lower(planned, owed, done);
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
        // Every shape in the order carries its off reply — the order is
        // read from them — so the sweep has the drafter-off decode each
        // drafted setting must beat.
        let off_decode = off_replies[index]
            .expect("the sweep order names shapes with an off reply")
            .1
            .decode_rate;
        if best.is_some_and(|best| prefill_seconds(shape_prompt) > best * (1.0 + TIE_BAND)) {
            let owed = resume.sweeps_left(shape, settings);
            if owed > 0 {
                planned = lower(planned, owed, done);
                progress(Report {
                    done,
                    total: planned,
                    candidate: done,
                    cut: false,
                });
            }
            continue;
        }
        for (position, setting) in settings.iter().enumerate() {
            let trial = Candidate {
                draft: *setting,
                ..*shape
            };
            // A saved setting answers to the same rule as a run one: its
            // entry stands either way, and it may end the sweep here. A
            // saved startup refusal is not in the marker at all (never
            // an answer), so it reaches the run below instead.
            let stop = if let Some(saved) = resume.kept(&trial) {
                sweep_ends(saved, off_decode)
            } else {
                if since_start() >= budget {
                    // Nothing behind this check can begin: every later
                    // setting and every later shape would stop here. The
                    // sweep is unfinished — the caller must let the next
                    // start try again — and the plan is finished as of now.
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
                done += 1;
                let kept = match decode(&trial, exe) {
                    Ok(rates) => match best_rate(&rates)
                        .and_then(|decode_rate| Reply::from_rates(shape_prompt, decode_rate))
                    {
                        Some(reply) => {
                            best = Some(
                                best.map_or(reply.seconds, |current| current.min(reply.seconds)),
                            );
                            Kept::Replied(reply)
                        }
                        None => Kept::Refused {
                            refusal: Refusal::NoUsableAnswer,
                            prompt_rate: Some(shape_prompt),
                        },
                    },
                    Err(refusal) => Kept::Refused {
                        refusal,
                        prompt_rate: Some(shape_prompt),
                    },
                };
                let ends = sweep_ends(&kept, off_decode);
                trials.push((trial, kept));
                // The candidate closes: the page's bar counts these, and its
                // line names the one that just ran.
                progress(Report {
                    done,
                    total: planned,
                    candidate: done,
                    cut: false,
                });
                // Finished and entered: the checkpoint lands between
                // lifetimes, never per report — the budget's own reports
                // carry no write.
                checkpoint(&trials);
                ends
            };
            if stop {
                // The settings behind this one were counted in the plan
                // and will never run — the ones no marker has already
                // answered: lower them, one report for the shape.
                let behind = settings[position + 1..]
                    .iter()
                    .filter(|setting| {
                        !resume.measured(&Candidate {
                            draft: **setting,
                            ..*shape
                        })
                    })
                    .count();
                if behind > 0 {
                    planned = lower(planned, behind, done);
                    progress(Report {
                        done,
                        total: planned,
                        candidate: done,
                        cut: false,
                    });
                }
                break;
            }
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

/// The one rule that ends a shape's sweep, judged on the entry exactly
/// as the record holds it — saved or just run, the same question: a
/// refusal ends it when it ANSWERS (the server ran and said nothing
/// usable; a startup refusal answers nothing, so the next setting runs
/// and the retry re-runs it), and a reply ends it when it does not write
/// faster than the shape's own off decode.
fn sweep_ends(kept: &Kept, off_decode: f64) -> bool {
    match kept {
        Kept::Refused { refusal, .. } => refusal.answers(),
        Kept::Replied(reply) => reply.decode_rate <= off_decode,
    }
}

/// Lower the plan by the sweeps a shape will never run. The plan counted
/// each shape's sweeps that were still left, so a subtraction past what is
/// left is this side's bug: loud here, never a wrapped number on a panel.
fn lower(planned: usize, owed: usize, done: usize) -> usize {
    let lowered = planned
        .checked_sub(owed)
        .expect("the plan counted every sweep that was left");
    debug_assert!(lowered >= done, "the plan cannot fall below what began");
    lowered
}

#[cfg(test)]
mod tests;
