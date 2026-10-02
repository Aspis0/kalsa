//! The walk's tune step: fingerprint the launch, look the winner up, keep
//! it or measure it — between the plan and the first byte of argv.
//!
//! Every failure degrades to the plan's launch, panic included (caught
//! below; the runtime's hook prints first, and neither line names argv).
//! The exception: an unfinished tune's measured winner runs and its
//! record is withheld as a marker — once — so the next start measures
//! again; a second unfinished result is saved as it stands.
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
use kalsa_runtime::ServerBackend;
use kalsa_supervisor::ServerConfig;

use crate::failure::StartupFailure;
use crate::startup::{LaunchInfo, Machine, PreparedStart, Progress};

/// The drafter a tuned launch carries: the plan's own file, at the n_max
/// the tune chose — or none, when the tune chose target-only or the plan
/// shipped no drafter at all.
fn chosen_drafter(rule_args: &ServerArgs, draft_n_max: Option<u32>) -> Option<kalsa_launch::Draft> {
    match (draft_n_max, &rule_args.draft) {
        (Some(n_max), Some(draft)) => Some(kalsa_launch::Draft {
            model_path: draft.model_path.clone(),
            n_max,
        }),
        _ => None,
    }
}

/// The final launch and every candidate's lifetime come out of this one
/// function: the same plan argv, changed only in the binary, `--threads`/
/// `--threads-batch`, `--n-gpu-layers`, the draft setting and the port.
/// Nothing else in argv can differ, because nothing else is a parameter.
/// One instrumented exception: the measurer appends its `--alias` nonce to
/// every lifetime — a name the engine lists on `/v1/models` only, which
/// never reaches load or decode and is not part of the launch the record
/// remembers.
///
/// `draft_n_max` is the trial's own draft decision: `None` launches the
/// target alone — decode without speculation — and `Some(n)` launches the
/// plan's own drafter proposing `n` per step; a plan without a drafter
/// ignores the setting: there is nothing to carry.
pub(crate) fn tuned_launch(
    args: &ServerArgs,
    exe: &Path,
    threads: Option<usize>,
    offload: Offload,
    draft_n_max: Option<u32>,
    port: u16,
) -> (PathBuf, Vec<String>) {
    let mut tuned = args.clone();
    tuned.threads = threads;
    tuned.offload = offload;
    tuned.port = port;
    tuned.draft = chosen_drafter(args, draft_n_max);
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
        info.drafter_sha256.as_deref(),
    ))
}

/// The production measurement: the whole tune through the ONE launch
/// builder — the exe travels with its candidate, so the pairing cannot be
/// lost between here and the spawn. The decode ask is the row's own
/// sampling on the draft prompt with a fixed seed: one short chat text for
/// every shape and setting, so every decode rate is the same work made,
/// and the room ask rides each shape's first lifetime beside its off
/// setting.
pub(crate) fn measure_with_rule(
    root: &Path,
    resolved: &[(kalsa_tune::Candidate, PathBuf)],
    rule: &ServerArgs,
    counts: &mut dyn FnMut(usize, usize),
) -> kalsa_tune::Tuned {
    let ask = kalsa_tune::Ask {
        prompt: kalsa_tune::DRAFT_PROMPT,
        temperature: rule.sampling.temperature,
        top_p: rule.sampling.top_p,
        top_k: rule.sampling.top_k,
        seed: Some(kalsa_tune::DRAFT_SEED),
        n_predict: kalsa_tune::DRAFT_N_PREDICT,
        chat: true,
        min_generated: kalsa_tune::DRAFT_MIN_GENERATED,
    };
    kalsa_tune::measure_tune(
        resolved,
        root,
        &ask,
        rule.draft.is_some(),
        |candidate, exe, port| {
            tuned_launch(
                rule,
                exe,
                candidate.threads,
                candidate.offload,
                candidate.draft,
                port,
            )
        },
        counts,
    )
}

/// The tune step itself: look the winner up by fingerprint; keep it on a
/// hit; on a miss measure (when there is anything to compare) and keep the
/// best. A verdict the budget or a refusal left unfinished is saved as the
/// marker `load` refuses, so the next start measures once more; a second
/// unfinished verdict is saved as it stands — a slow or broken machine
/// must not spend the whole budget on every start forever. Nothing here
/// fails the walk: the whole step is caught below, and any panic degrades
/// to the plan with one log line.
pub(crate) fn tune_launch(
    prepared: &mut PreparedStart,
    machine: &Machine,
    root: &Path,
    main: (ServerBackend, PathBuf),
    memo: &mut Memo,
    progress: &mut dyn FnMut(Progress),
    measure: impl Fn(
        &[(kalsa_tune::Candidate, PathBuf)],
        &ServerArgs,
        &mut dyn FnMut(usize, usize),
    ) -> kalsa_tune::Tuned,
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
    measure: impl Fn(
        &[(kalsa_tune::Candidate, PathBuf)],
        &ServerArgs,
        &mut dyn FnMut(usize, usize),
    ) -> kalsa_tune::Tuned,
) {
    let rule_args = prepared.info.args.clone();
    let rule_exe = prepared.server.exe.clone();
    let Some(model_digest) = prepared.info.model_sha256.clone() else {
        // A model with no digest has nothing to key a record on.
        prepared.info.tune = Some(Tune::Skipped);
        return;
    };
    let Some(fingerprint) = tune_fingerprint(machine, &prepared.info, main.0, memo.cores) else {
        prepared.info.tune = Some(Tune::Skipped);
        return;
    };

    // A kept record: the winner, no measuring.
    let kept = kalsa_tune::record::load(root, &model_digest, &fingerprint);
    let (record, winner) = match kept {
        Some(record) => {
            // Kept: no measuring, and the panel says what won from the
            // record itself.
            let winner = record.winner;
            (record, winner)
        }
        None => {
            // A fresh tune: the candidates the rule's own numbers describe.
            // Vulkan with no dedicated card detected is the integrated GPU's
            // path: it also measures the mixed shape.
            let integrated = matches!(
                machine.measurement.will_run_on,
                kalsa_probe::Backend::Cpu
            );
            let candidates = kalsa_tune::candidates(
                Some(main.0),
                rule_args.threads,
                memo.cores.0,
                memo.cores.1,
                integrated,
            );
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
            let tuned = measure(&resolved, &rule_args, &mut |done, planned| {
                progress(Progress::Tuning {
                    done,
                    total: planned,
                })
            });
            let mut winner = tuned.winner;
            let mut record = kalsa_tune::record::Record {
                fingerprint: fingerprint.clone(),
                winner,
                trials: tuned.trials,
            };
            // An unfinished verdict — a candidate's build never resolved,
            // the budget stopped a lifetime in either pass, or nothing
            // replied — is written as the marker `load` refuses, so the
            // next start measures once more; a second unfinished verdict is
            // saved as it stands. The marker IS the "retried once":
            // `cut_before` reads it back, so a persistently missing build
            // (like a slow or broken machine) spends the budget on one
            // retry, not on every start. A shape the bound skipped ran —
            // its own entry stands — and is never a hole here.
            let unfinished = if resolved.len() != candidates.len() {
                Some(kalsa_tune::record::Marker::Unresolved)
            } else if tuned.cut {
                Some(kalsa_tune::record::Marker::Sweep)
            } else if !tuned.complete {
                Some(kalsa_tune::record::Marker::PassOne)
            } else if winner.is_none() {
                Some(kalsa_tune::record::Marker::Refused)
            } else {
                None
            };
            let retried = unfinished.is_some()
                && kalsa_tune::record::cut_before(root, &model_digest, &fingerprint);
            // A retry that measured nothing keeps the better of the pair:
            // the marker's winner was measured too, and a fresh record of
            // refusals must not erase it — this start launches it and the
            // save below keeps it.
            if retried && winner.is_none() {
                if let Some(prior) =
                    kalsa_tune::record::cut_marker(root, &model_digest, &fingerprint)
                {
                    if prior.winner.is_some() {
                        winner = prior.winner;
                        record = prior;
                        eprintln!(
                            "kalsa-brain: the retry measured nothing; keeping the first attempt's winner"
                        );
                    }
                }
            }
            let staged = match (unfinished, retried) {
                (Some(cause), false) => {
                    eprintln!(
                        "kalsa-brain: the tune's verdict is unfinished ({cause:?}; {}/{} candidates ran); withheld once — the next start measures again",
                        resolved.len(),
                        candidates.len()
                    );
                    kalsa_tune::record::save_marker(root, &model_digest, &record, cause)
                }
                _ => kalsa_tune::record::save(root, &model_digest, &record),
            };
            if let Err(error) = staged {
                // Best effort: a record that cannot be written costs a
                // re-tune next start, never this launch.
                eprintln!("kalsa-brain: the tune record could not be written: {error}");
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
                win.candidate.draft,
            );
            if runs_on_graphics_build(&win.candidate) {
                // The processor alternative beside a graphics winner: what
                // the per-start check hands the slot to when the card
                // answers slow, and what a start that cannot load on the
                // card falls back to. A hit and a fresh tune both arrive
                // here.
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
            // The rule stands — the plan's own exe, threads, offload and
            // drafter setting — and the line says why there is no winner.
            apply(
                prepared,
                &rule_args,
                rule_exe,
                rule_args.threads,
                rule_args.offload,
                rule_args.draft.as_ref().map(|draft| draft.n_max),
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
    draft_n_max: Option<u32>,
) {
    let (exe, argv) = tuned_launch(
        rule_args,
        &exe,
        threads,
        offload,
        draft_n_max,
        crate::startup::PORT,
    );
    prepared.info.args.threads = threads;
    prepared.info.args.offload = offload;
    prepared.info.args.draft = chosen_drafter(rule_args, draft_n_max);
    prepared.server.exe = exe;
    prepared.server.argv = argv;
}

/// Whether this launch runs on the graphics build — the card's own shapes
/// and the mixed shape (Vulkan build, no layer offloaded) alike — so a
/// processor build can stand in for it. On Metal `ForcedOff` is the
/// processor itself, on the same build, and needs no stand-in.
fn runs_on_graphics_build(candidate: &kalsa_tune::Candidate) -> bool {
    matches!(candidate.offload, Offload::All | Offload::EngineFitted)
        || candidate.backend == ServerBackend::Vulkan
}

/// One candidate in the owner's words: the offload decides the family,
/// the threads the member. `candidates()` never builds an offloaded
/// candidate without a count, so the bare fallback is only defensive.
pub(crate) fn tune_label(candidate: &kalsa_tune::Candidate) -> String {
    let mut label = match (candidate.offload, candidate.threads) {
        (Offload::All | Offload::EngineFitted, _) => "graphics".to_string(),
        (Offload::ForcedOff, Some(threads)) if candidate.backend == ServerBackend::Vulkan => {
            format!("graphics + processor {threads} threads")
        }
        (_, Some(threads)) => format!("processor {threads} threads"),
        (Offload::NoGpuBuild | Offload::ForcedOff, None) => "processor".to_string(),
    };
    if let Some(n_max) = candidate.draft {
        label.push_str(&format!(" + drafter {n_max}"));
    }
    label
}

/// The tune's line for the panel — the one place these words are written.
/// The figure is the room's wait, with the two rates it was computed from
/// beside it; the alternative in parentheses only when it measured, and in
/// the same unit — every scored trial shares the room's history and the
/// same short ask, so the replies compare directly.
pub(crate) fn tune_line(tune: &Tune) -> String {
    match tune {
        Tune::Skipped => "skipped — nothing to compare".to_string(),
        Tune::NoWinner(_) => "no winner, using the standard setting".to_string(),
        Tune::Measured(record) => {
            let Some(winner) = &record.winner else {
                return "no winner, using the standard setting".to_string();
            };
            let reply = winner.reply;
            let mut line = format!(
                "{}, reply ≈ {:.1} s (prompt {} tok/s, decode {} tok/s)",
                tune_label(&winner.candidate),
                reply.seconds,
                thousands(reply.prompt_rate),
                thousands(reply.decode_rate),
            );
            let alternative = record
                .trials
                .iter()
                .filter_map(|(candidate, kept)| match kept {
                    kalsa_tune::record::Kept::Replied(reply) if *candidate != winner.candidate => {
                        Some((*candidate, reply.seconds))
                    }
                    _ => None,
                })
                .min_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            if let Some((candidate, seconds)) = alternative {
                line.push_str(&format!(
                    " ({}: reply ≈ {seconds:.1} s)",
                    tune_label(&candidate)
                ));
            }
            line
        }
    }
}

/// A rate in the owner's units: whole tokens a second, thousands
/// separated, because the line is read at a glance.
fn thousands(rate: f64) -> String {
    let digits = format!("{rate:.0}");
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

/// The graphics winner's processor alternative: the shortest processor
/// reply in the record, on its own exe, threads, offload and draft
/// setting, same port — the launch (and the args) the per-start check
/// hands the slot to when the card answers slow.
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
            kalsa_tune::record::Kept::Replied(reply)
                if matches!(candidate.offload, Offload::ForcedOff | Offload::NoGpuBuild)
                    && candidate.backend != ServerBackend::Vulkan =>
            {
                Some((reply.seconds, *candidate))
            }
            _ => None,
        })
        .min_by(|(a, _), (b, _)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))?;
    let exe = exe_for(
        &candidate,
        (main.0, &main.1),
        &mut memo.processor,
        machine,
        progress,
    )
    .ok()?;
    let (exe, argv) = tuned_launch(
        rule_args,
        &exe,
        candidate.threads,
        candidate.offload,
        candidate.draft,
        base.port,
    );
    // The config AND its args together: the panel's "In force" reads the
    // args, and after a switch they must be the processor's. The drafter
    // is the one this trial measured with, never the graphics winner's
    // setting: the record keeps each trial's own reply.
    let mut args = ServerArgs {
        threads: candidate.threads,
        offload: candidate.offload,
        ..rule_args.clone()
    };
    args.draft = chosen_drafter(rule_args, candidate.draft);
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
        // The number counts asks, not wall clock: ureq's request
        // timeout bounds an ask's redirects and body read, the connect
        // leg runs on its own equal clock, and slow DNS can overrun —
        // two asks, one bound each.
        None => format!("no rate in {} s", kalsa_tune::CHECK_TIMEOUT.as_secs() * 2),
    };
    let head = format!("checked {speed} against {recorded:.1} recorded");
    match outcome {
        // The check itself failed: it says nothing about speed.
        Checked::Failed => "the check failed; the graphics launch stays".to_string(),
        Checked::Kept => head,
        Checked::Switched => format!("{head} — running the processor candidate"),
        Checked::NoProcessor => format!("{head} — nothing to switch to"),
        Checked::StillGraphics => {
            format!("{head} — the processor candidate would not start; keeping the graphics launch")
        }
        Checked::Down => format!("{head} — neither launch came up"),
    }
}

#[cfg(test)]
#[path = "tune_step/tests.rs"]
mod tests;
