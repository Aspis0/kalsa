//! The walk's tune step: fingerprint the launch, look the winner up, and
//! either keep it or measure it — between the plan and the first byte of
//! argv the supervisor sees.
//!
//! Everything here degrades to the rule: an unmeasurable machine, a
//! refused or incomplete candidate set, an unresolvable build or a panic
//! inside this file leaves the launch exactly as the plan made it (the
//! panic is caught here and logged as one line — no argv). The tune is an
//! optimisation allowed to fail, and nothing in it can fail the walk.
//!
//! A quit mid-tune costs no orphan: on Windows the probe-shaped child
//! rides the supervisor's kill-on-close job and dies with the app; on unix
//! it keeps the claimed state file, which the next start's decide reaps —
//! and the record is written only at the end, so the next start tunes
//! again. The development path never tunes at all: its pinned binary is
//! not in the catalog, so there is no fingerprint to key a record by.
//!
//! GPU safety on a RAM-funded plan is the engine's own, not ours: fit is
//! on by default and adjusts to FREE device memory — measured on the
//! Lenovo, `common_params_fit_impl: projected to use 3635 MiB of device
//! memory vs. 5150 MiB of free device memory` and `will leave 1515 >=
//! 1024 MiB of free device memory, no changes needed`. What licenses
//! trying the card at all is the tune's own measurement, and nothing in
//! this file passes a flag that disables fit.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

use kalsa_launch::{Offload, ServerArgs};
use kalsa_runtime::ServerBackend;

use crate::failure::StartupFailure;
use crate::startup::{LaunchInfo, Machine, PreparedStart, Progress};

/// The final launch and every candidate's lifetime come out of this one
/// function: the same plan argv, changed only in the binary, `--threads`/
/// `--threads-batch`, `--n-gpu-layers` and the port. Nothing else in argv
/// can differ, because nothing else is a parameter. One instrumented
/// exception: the measurer appends its `--alias` nonce to every lifetime —
/// a name the engine lists on `/v1/models` only, which never reaches load
/// or decode and is not part of the launch the record remembers.
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
/// candidates and the fingerprint alike) and the one processor-build cell —
/// success AND failure, so `decide_cpu` runs at most once per tune. The
/// caller owns it, so a test can stand an answer in without touching the
/// store, and bundling keeps the hook's signature small.
pub(crate) struct Memo {
    pub cores: (Option<usize>, Option<usize>),
    pub processor: Option<Result<PathBuf, StartupFailure>>,
}

/// What this launch's tune decided, in a shape the words can be built
/// from — the panel's line, and the real walk's per-candidate report.
#[derive(Clone, Debug)]
pub(crate) enum Tune {
    /// The tune ran (now or before): what was tried, and what won.
    Measured(kalsa_tune::record::Record),
    /// Nothing to compare: one candidate, or none.
    Skipped,
    /// The tune ran and kept nothing — the rule stands, and the record
    /// says which candidates refused. The payload is read by the real
    /// walk's per-candidate report; the panel only needs the words, so in
    /// a build without the walk there is nothing to read it with.
    NoWinner(#[cfg_attr(not(test), allow(dead_code))] kalsa_tune::record::Record),
}

/// The exe for this candidate: the main build when the candidate IS the
/// main build, otherwise the processor build — decided through the walk's
/// own `decide_cpu`, resolved at most once per tune (the `processor` cell
/// remembers a failure too, so one broken fetch is not retried per
/// candidate). Used by the record hit, the fresh measure and the
/// lifetimes' build closure alike, so a kept winner is launched exactly
/// as a measured one would be.
pub(crate) fn exe_for(
    candidate: &kalsa_tune::Candidate,
    main: (ServerBackend, &Path),
    processor: &mut Option<Result<PathBuf, StartupFailure>>,
    machine: &Machine,
    progress: &mut dyn FnMut(Progress),
) -> Result<PathBuf, StartupFailure> {
    if candidate.backend == main.0 {
        return Ok(main.1.to_path_buf());
    }
    if let Some(resolved) = processor {
        return resolved.clone();
    }
    progress(Progress::Deciding);
    let resolved = kalsa_runtime::decide_cpu(
        machine.measurement.will_run_on,
        &mut |bytes: kalsa_download::Progress| {
            progress(Progress::RuntimeBytes {
                done: bytes.bytes_done,
                total: bytes.bytes_total,
            })
        },
    )
    .map(|decision| decision.exe)
    .map_err(StartupFailure::from);
    *processor = Some(resolved.clone());
    resolved
}

/// The record's key for this launch: one function, so the walk and any
/// later reader compose it identically (see `kalsa_tune::fingerprint`).
/// `None` when the machine has no platform or the row no digest — a state
/// the walk cannot reach (decide refuses an unknown platform before any
/// row is chosen), and never a reason to measure without a key.
pub(crate) fn tune_fingerprint(
    machine: &Machine,
    info: &LaunchInfo,
    main: ServerBackend,
    cores: (Option<usize>, Option<usize>),
) -> Option<String> {
    let platform = kalsa_runtime::Platform::current()?;
    let detected = machine.measurement.will_run_on;
    let engine = |backend: ServerBackend| kalsa_runtime::fingerprint(platform, backend, detected);
    Some(kalsa_tune::fingerprint(
        info.model_sha256.as_deref()?,
        info.args.context_tokens,
        cores.0,
        cores.1,
        (&engine(main), &engine(ServerBackend::Cpu)),
    ))
}

/// The production measurement: step 2's driver, run through the ONE launch
/// builder — the exe travels with its candidate, so the pairing cannot be
/// lost between here and the spawn.
pub(crate) fn measure_with_rule(
    root: &Path,
    resolved: &[(kalsa_tune::Candidate, PathBuf)],
    rule: &ServerArgs,
    counts: &mut dyn FnMut(usize, usize),
) -> Vec<(kalsa_tune::Candidate, kalsa_tune::Outcome)> {
    kalsa_tune::measure_candidates(
        resolved,
        root,
        |candidate, exe, port| tuned_launch(rule, exe, candidate.threads, candidate.offload, port),
        counts,
    )
}

/// The tune step itself: look the winner up by fingerprint; keep it on a
/// hit; on a miss measure (when there is anything to compare), save — only
/// when every candidate ran — and keep the best. An incomplete tune is
/// never saved: a partial picture would lock the next start out of the
/// re-run that would complete it. Nothing here fails the walk: the whole
/// step is caught below, and any panic degrades to the plan with one log
/// line.
pub(crate) fn tune_launch(
    prepared: &mut PreparedStart,
    machine: &Machine,
    root: &Path,
    main: (ServerBackend, PathBuf),
    memo: &mut Memo,
    progress: &mut dyn FnMut(Progress),
    measure: impl FnOnce(
        &[(kalsa_tune::Candidate, PathBuf)],
        &ServerArgs,
        &mut dyn FnMut(usize, usize),
    ) -> Vec<(kalsa_tune::Candidate, kalsa_tune::Outcome)>,
) {
    // The plan's own launch, kept before anything may rewrite it: the rule
    // to fall back to, and the config main.rs retries with when a tuned
    // launch fails to load.
    let rule = prepared.server.clone();
    let rule_info = prepared.info.args.clone();
    prepared.rule_launch = Some((rule.clone(), rule_info.clone()));
    let result = catch_unwind(AssertUnwindSafe(|| {
        tune_launch_inner(prepared, machine, root, main, memo, progress, measure)
    }));
    if result.is_err() {
        // One line, no argv: a panic here is our bug, and the walk's plan
        // is still a launch this machine can run.
        eprintln!("kalsa-brain: the tune failed unexpectedly; running the plan's launch");
        prepared.server = rule.clone();
        prepared.info.args = rule_info;
        prepared.info.tune = None;
    }
}

fn tune_launch_inner(
    prepared: &mut PreparedStart,
    machine: &Machine,
    root: &Path,
    main: (ServerBackend, PathBuf),
    memo: &mut Memo,
    progress: &mut dyn FnMut(Progress),
    measure: impl FnOnce(
        &[(kalsa_tune::Candidate, PathBuf)],
        &ServerArgs,
        &mut dyn FnMut(usize, usize),
    ) -> Vec<(kalsa_tune::Candidate, kalsa_tune::Outcome)>,
) {
    let rule_args = prepared.info.args.clone();
    let rule_exe = prepared.server.exe.clone();
    let Some(fingerprint) = tune_fingerprint(machine, &prepared.info, main.0, memo.cores) else {
        prepared.info.tune = Some(Tune::Skipped);
        return;
    };

    // A kept record: the winner, no measuring.
    let kept = kalsa_tune::record::load(root, &fingerprint);
    let (record, winner) = match kept {
        Some(record) => {
            // Kept: no measuring, and the panel says what won from the
            // record itself.
            let winner = record.winner;
            (record, winner)
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
                match exe_for(
                    candidate,
                    (main.0, &main.1),
                    &mut memo.processor,
                    machine,
                    progress,
                ) {
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
            let results = measure(&resolved, &rule_args, &mut |done, planned| {
                progress(Progress::Tuning { done, total: planned })
            });
            let winner = kalsa_tune::winner(&results);
            let ran = results.len();
            let record = kalsa_tune::record::Record {
                fingerprint: fingerprint.clone(),
                winner,
                trials: results
                    .into_iter()
                    .map(|(candidate, outcome)| (candidate, (&outcome).into()))
                    .collect(),
            };
            // Every candidate must have RUN once: a budget cut in round
            // one or an exe that could not be resolved leaves a partial
            // picture, and saving it would lock the next start out of the
            // re-run that would complete it. This start's winner still
            // launches — it just is not remembered.
            if ran == candidates.len() {
                if let Err(error) = kalsa_tune::record::save(root, &record) {
                    // Best effort: a record that cannot be written costs a
                    // re-tune next start, never this launch.
                    eprintln!("kalsa-brain: the tune record could not be written: {error}");
                }
            } else {
                eprintln!(
                    "kalsa-brain: the tune ran {} of {} candidates; not saved — the next start tries again",
                    ran,
                    candidates.len()
                );
            }
            (record, winner)
        }
    };

    // The launch to apply: the winner (kept or measured), or the untouched
    // rule when there is no winner or its exe cannot be resolved — and
    // every one of those comes out of the one builder.
    let chosen = match &winner {
        Some(win) => exe_for(
            &win.candidate,
            (main.0, &main.1),
            &mut memo.processor,
            machine,
            progress,
        )
        .ok()
        .map(|exe| (win, exe)),
        None => None,
    };
    match &chosen {
        Some((win, exe)) => {
            apply(
                prepared,
                &rule_args,
                exe.clone(),
                win.candidate.threads,
                win.candidate.offload,
            );
            prepared.info.tune = Some(Tune::Measured(record));
        }
        None => {
            // The rule stands — the plan's own exe, threads and offload —
            // and the line says why there is no winner to show.
            apply(
                prepared,
                &rule_args,
                rule_exe,
                rule_args.threads,
                rule_args.offload,
            );
            prepared.info.tune = Some(Tune::NoWinner(record));
            if winner.is_some() {
                eprintln!(
                    "kalsa-brain: the winning candidate's build could not be resolved; the rule stands"
                );
            }
        }
    }
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
        (Offload::All, _) => "graphics".to_string(),
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
        Tune::NoWinner(_) => "no winner, using the standard setting".to_string(),
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
