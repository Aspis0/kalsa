//! The walk's tune step: fingerprint the launch, look the winner up, and
//! either keep it or measure it — between the plan and the first byte of
//! argv the supervisor sees.
//!
//! Everything here degrades to the rule: an unmeasurable machine, a
//! refused candidate set or a failed record save leaves the launch exactly
//! as the plan made it. The tune is an optimisation allowed to fail, and
//! nothing in this file can fail the walk.

use std::path::{Path, PathBuf};

use kalsa_launch::{Offload, ServerArgs};
use kalsa_runtime::ServerBackend;

use crate::failure::StartupFailure;
use crate::startup::{LaunchInfo, Machine, PreparedStart, Progress};

/// The final launch and every candidate's lifetime come out of this one
/// function: the same plan argv, changed only in the binary, `--threads`/
/// `--threads-batch`, `--n-gpu-layers` and the port. Nothing else in argv
/// can differ, because nothing else is a parameter.
pub(crate) fn tuned_launch(
    args: &ServerArgs,
    exe: &Path,
    threads: Option<usize>,
    offload: Offload,
    port: u16,
) -> (PathBuf, Vec<String>) {
    let mut tuned = args.clone();
    tuned.threads = threads;
    tuned.offload = offload;
    tuned.port = port;
    (exe.to_path_buf(), tuned.argv())
}

/// The walk's memo for one tune: the two core counts (one source for the
/// candidates and the fingerprint alike) and the one processor-build cell
/// (resolved at most once, shared by the candidate loop and the winner's
/// lookup). The caller owns it — so a test can stand an answer in without
/// touching the store — and bundling keeps the hook's signature at seven.
pub(crate) struct Memo {
    pub cores: (Option<usize>, Option<usize>),
    pub processor: Option<PathBuf>,
}

/// What this launch's tune decided, in a shape the words can be built
/// from — the panel's line, and the real walk's per-candidate report.
#[derive(Clone, Debug)]
pub(crate) enum Tune {
    /// The tune ran (now or before): what was tried, and what won.
    Measured(kalsa_tune::record::Record),
    /// Nothing to compare: one candidate, or none.
    Skipped,
    /// The tune ran and kept nothing — the rule stands.
    NoWinner,
}

/// The exe for this candidate: the main build when the candidate IS the
/// main build, otherwise the processor build — decided through the walk's
/// own `decide_cpu`, which short-circuits on its standing verdict, and
/// resolved at most once per walk (the `processor` cell). Used by the
/// record hit, the fresh measure, and the lifetimes' build closure alike,
/// so a kept winner is launched exactly as a measured one would be.
pub(crate) fn exe_for(
    candidate: &kalsa_tune::Candidate,
    main: (ServerBackend, &Path),
    processor: &mut Option<PathBuf>,
    machine: &Machine,
    progress: &mut dyn FnMut(Progress),
) -> Result<PathBuf, StartupFailure> {
    if candidate.backend == main.0 {
        return Ok(main.1.to_path_buf());
    }
    if processor.is_none() {
        progress(Progress::Deciding);
        let decision = kalsa_runtime::decide_cpu(
            machine.measurement.will_run_on,
            &mut |bytes: kalsa_download::Progress| {
                progress(Progress::RuntimeBytes {
                    done: bytes.bytes_done,
                    total: bytes.bytes_total,
                })
            },
        )?;
        *processor = Some(decision.exe);
    }
    Ok(processor.clone().expect("just resolved"))
}

/// The record's key for this launch: one function, so the walk and any
/// later reader compose it identically (see `kalsa_tune::fingerprint`).
pub(crate) fn tune_fingerprint(
    machine: &Machine,
    info: &LaunchInfo,
    main: ServerBackend,
    cores: (Option<usize>, Option<usize>),
) -> String {
    // The walk cannot have reached a model without a platform: decide
    // refuses an unknown one before any row is ever chosen.
    let platform =
        kalsa_runtime::Platform::current().expect("the walk decided on a platform first");
    let detected = machine.measurement.will_run_on;
    let engine = |backend: ServerBackend| kalsa_runtime::fingerprint(platform, backend, detected);
    kalsa_tune::fingerprint(
        info.model_sha256
            .as_deref()
            .expect("a chosen row carries its digest on the model path"),
        info.args.context_tokens,
        cores.0,
        cores.1,
        (&engine(main), &engine(ServerBackend::Cpu)),
    )
}

/// The production measurement: step 2's driver, run through the ONE launch
/// builder with each candidate's pre-resolved exe.
pub(crate) fn measure_with_rule(
    root: &Path,
    candidates: &[kalsa_tune::Candidate],
    rule: &ServerArgs,
    resolved: &[(kalsa_tune::Candidate, PathBuf)],
    counts: &mut dyn FnMut(usize, usize),
) -> Vec<(kalsa_tune::Candidate, kalsa_tune::Outcome)> {
    kalsa_tune::measure_candidates(
        candidates,
        root,
        |candidate, port| {
            let exe = resolved
                .iter()
                .find(|(known, _)| known == candidate)
                .expect("only resolved candidates reach the measure")
                .1
                .clone();
            tuned_launch(rule, &exe, candidate.threads, candidate.offload, port)
        },
        counts,
    )
}

/// The tune step itself: look the winner up by fingerprint; keep it on a
/// hit; on a miss measure (when there is anything to compare), save, and
/// keep the best. A record is saved even when there is no winner: all
/// refused means something on this machine is broken, and re-spending the
/// whole budget every start is worse than the rule it falls back to.
/// Nothing here fails the walk — every miss, error or refusal degrades to
/// the plan exactly as it stands.
pub(crate) fn tune_launch(
    prepared: &mut PreparedStart,
    machine: &Machine,
    root: &Path,
    main: (ServerBackend, PathBuf),
    memo: &mut Memo,
    progress: &mut dyn FnMut(Progress),
    measure: impl FnOnce(
        &[kalsa_tune::Candidate],
        &ServerArgs,
        &[(kalsa_tune::Candidate, PathBuf)],
        &mut dyn FnMut(usize, usize),
    ) -> Vec<(kalsa_tune::Candidate, kalsa_tune::Outcome)>,
) {
    let rule_args = prepared.info.args.clone();
    let fingerprint = tune_fingerprint(machine, &prepared.info, main.0, memo.cores);

    // A kept record: the winner, no measuring.
    let kept = kalsa_tune::record::load(root, &fingerprint);
    let winner = match kept {
        Some(record) => {
            // Kept: no measuring, and the panel says what won from the
            // record itself.
            let winner = record.winner;
            prepared.info.tune = Some(Tune::Measured(record));
            winner
        }
        None => {
            // A fresh tune: the candidates the rule's own numbers describe.
            let candidates =
                kalsa_tune::candidates(Some(main.0), rule_args.threads, memo.cores.0, memo.cores.1);
            if !kalsa_tune::needs_tuning(&candidates) {
                prepared.info.tune = Some(Tune::Skipped);
                return;
            }
            // Exes first: a candidate whose processor build cannot be
            // decided is dropped — the rule stands rather than the walk
            // failing — and the measure only ever sees runnable launches.
            let mut resolved = Vec::new();
            for candidate in &candidates {
                match exe_for(candidate, (main.0, &main.1), &mut memo.processor, machine, progress) {
                    Ok(exe) => resolved.push((*candidate, exe)),
                    Err(_) => eprintln!(
                        "kalsa-brain: the {} candidate has no processor build to run; dropping it from the tune",
                        tune_label(candidate)
                    ),
                }
            }
            if resolved.is_empty() {
                prepared.info.tune = Some(Tune::Skipped);
                return;
            }
            let runnable = resolved.iter().map(|(c, _)| *c).collect::<Vec<_>>();
            let results = measure(&runnable, &rule_args, &resolved, &mut |done, planned| {
                progress(Progress::Tuning { done, planned })
            });
            let winner = kalsa_tune::winner(&results);
            let record = kalsa_tune::record::Record {
                fingerprint: fingerprint.clone(),
                winner,
                trials: results
                    .into_iter()
                    .map(|(candidate, outcome)| (candidate, (&outcome).into()))
                    .collect(),
            };
            if let Err(error) = kalsa_tune::record::save(root, &record) {
                // Best effort: a record that cannot be written costs a
                // re-tune next start, never this launch.
                eprintln!("kalsa-brain: the tune record could not be written: {error}");
            }
            prepared.info.tune = Some(match winner {
                Some(_) => Tune::Measured(record),
                None => Tune::NoWinner,
            });
            winner
        }
    };

    // The launch to apply: the winner (kept or measured), or the untouched
    // rule when there is no winner or its exe cannot be resolved. Every one
    // of those comes out of the one builder below.
    let (exe, threads, offload) = match &winner {
        Some(win) => {
            match exe_for(&win.candidate, (main.0, &main.1), &mut memo.processor, machine, progress) {
                Ok(exe) => (exe, win.candidate.threads, win.candidate.offload),
                Err(_) => {
                    // The winner's exe cannot be built after all (no
                    // processor build): the rule stands, and the line says so.
                    prepared.info.tune = Some(Tune::NoWinner);
                    (main.1.clone(), rule_args.threads, rule_args.offload)
                }
            }
        }
        None => (main.1.clone(), rule_args.threads, rule_args.offload),
    };
    apply(prepared, &rule_args, exe, threads, offload);
}

/// Push one launch through the one builder into the prepared start: the
/// server's exe and argv, and the args the panel reads back.
fn apply(
    prepared: &mut PreparedStart,
    rule_args: &ServerArgs,
    exe: PathBuf,
    threads: Option<usize>,
    offload: Offload,
) {
    let (exe, argv) = tuned_launch(rule_args, &exe, threads, offload, crate::startup::PORT);
    prepared.info.args.threads = threads;
    prepared.info.args.offload = offload;
    prepared.server.exe = exe;
    prepared.server.argv = argv;
}

/// One candidate in the owner's words: the offload decides the family,
/// the threads the member. `candidates()` never builds an offloaded
/// candidate without a count, so the bare fallback is only defensive.
pub(crate) fn tune_label(candidate: &kalsa_tune::Candidate) -> String {
    match (candidate.offload, candidate.threads) {
        (Offload::All, _) => "graphics card".to_string(),
        (_, Some(threads)) => format!("processor {threads} threads"),
        (Offload::NoGpuBuild | Offload::ForcedOff, None) => "processor".to_string(),
    }
}

/// The tune's line for the panel — the one place these words are written.
/// The runner-up in parentheses only when it measured: a refusal beside the
/// winner would be a second claim the owner did not ask for.
pub(crate) fn tune_line(tune: &Tune) -> String {
    match tune {
        Tune::Skipped => "skipped — nothing to compare".to_string(),
        Tune::NoWinner => "no winner, using the standard setting".to_string(),
        Tune::Measured(record) => {
            let Some(winner) = &record.winner else {
                return "no winner, using the standard setting".to_string();
            };
            let mut line = format!(
                "{}, {:.1} tokens/s",
                tune_label(&winner.candidate),
                winner.best
            );
            let alternative = record
                .trials
                .iter()
                .filter_map(|(candidate, kept)| match kept {
                    kalsa_tune::record::Kept::Best(rate) if *candidate != winner.candidate => {
                        Some((*candidate, *rate))
                    }
                    _ => None,
                })
                .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            if let Some((candidate, rate)) = alternative {
                line.push_str(&format!(" ({}: {:.1} tokens/s)", tune_label(&candidate), rate));
            }
            line
        }
    }
}

#[cfg(test)]
#[path = "tune_step/tests.rs"]
mod tests;
