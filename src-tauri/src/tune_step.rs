//! The walk's tune step: fingerprint the launch, look the winner up, keep
//! it or measure it — between the plan and the first byte of argv.
//!
//! Every failure degrades to the plan's launch, panic included (caught
//! below; the runtime's hook prints first, and neither line names argv).
//! The exception: an incomplete tune's measured winner runs and only its
//! record is withheld, so the next start measures again.
//!
//! No GPU flag on the graphics candidate: the engine's fit adapts the
//! layers to this start's free memory only when no count is given
//! (`LLAMA_ARG_FIT` in the environment turns that off — auto then offloads
//! every layer).
//!
//! The development path never tunes: a pinned binary has no catalog digest
//! to key a record on.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

use kalsa_launch::{Offload, ServerArgs};
use kalsa_supervisor::ServerConfig;
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
            // A refusal is a candidate that ran — it was attempted and
            // answered, `DidNotStart` included; only a candidate whose
            // lifetime never began (the budget cut round one, or an exe
            // that could not be resolved) makes the picture incomplete.
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
            if matches!(win.candidate.offload, Offload::All | Offload::EngineFitted) {
                // The processor alternative beside a graphics winner: what
                // the per-start check hands the slot to when the card
                // answers slow. A hit and a fresh tune both arrive here.
                prepared.processor = processor_launch(
                    &record,
                    &rule_args,
                    machine,
                    main,
                    memo,
                    progress,
                    &prepared.server,
                );
            }
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
        (Offload::All | Offload::EngineFitted, _) => "graphics".to_string(),
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

/// The graphics winner's processor alternative: the best processor trial
/// in the record, on its own exe, threads and offload, same port — the
/// launch (and the args) the per-start check hands the slot to when the
/// card answers slow.
fn processor_launch(
    record: &kalsa_tune::record::Record,
    rule_args: &ServerArgs,
    machine: &Machine,
    main: (ServerBackend, PathBuf),
    memo: &mut Memo,
    progress: &mut dyn FnMut(Progress),
    base: &ServerConfig,
) -> Option<(ServerConfig, ServerArgs)> {
    let (_, candidate) = record
        .trials
        .iter()
        .filter_map(|(candidate, kept)| match kept {
            kalsa_tune::record::Kept::Best(rate)
                if matches!(candidate.offload, Offload::ForcedOff | Offload::NoGpuBuild) =>
            {
                Some((*rate, *candidate))
            }
            _ => None,
        })
        .max_by(|(a, _), (b, _)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))?;
    let exe = exe_for(
        &candidate,
        (main.0, &main.1),
        &mut memo.processor,
        machine,
        progress,
    )
    .ok()?;
    let (exe, argv) =
        tuned_launch(rule_args, &exe, candidate.threads, candidate.offload, base.port);
    // The config AND its args together: the panel's "In force" reads the
    // args, and after a switch they must be the processor's.
    let args = ServerArgs {
        threads: candidate.threads,
        offload: candidate.offload,
        ..rule_args.clone()
    };
    Some((
        ServerConfig {
            exe,
            argv,
            ..base.clone()
        },
        args,
    ))
}

/// What the per-start check decided, for the panel's words.
pub(crate) enum Checked {
    Kept,
    Switched,
    NoProcessor,
    /// The processor start failed: the graphics launch, once.
    StillGraphics,
    /// Neither launch came up.
    Down,
    /// The check itself failed: it says nothing about speed.
    Failed,
}

/// The check's line: this start's own speed against the recorded best,
/// then what the launch did about it.
pub(crate) fn checked_line(checked: Option<f64>, recorded: f64, outcome: Checked) -> String {
    let speed = match checked {
        Some(rate) => format!("{rate:.1} tokens/s"),
        None => "no rate in 15 s".to_string(),
    };
    let head = format!("checked {speed} against {recorded:.1} recorded");
    match outcome {
        // The check itself failed: it says nothing about speed.
        Checked::Failed => "the check failed; the graphics launch stays".to_string(),
        Checked::Kept => head,
        Checked::Switched => format!("{head} — running the processor candidate"),
        Checked::NoProcessor => format!("{head} — nothing to switch to"),
        Checked::StillGraphics => format!(
            "{head} — the processor candidate would not start; keeping the graphics launch"
        ),
        Checked::Down => format!("{head} — neither launch came up"),
    }
}

#[cfg(test)]
#[path = "tune_step/tests.rs"]
mod tests;
