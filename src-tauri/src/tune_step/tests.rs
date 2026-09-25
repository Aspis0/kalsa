//! The tune step's own tests: the one builder, the exe rule, and the hook's
//! three answers (kept, measured, skipped) — each with the mutation that
//! would break it.

use std::path::PathBuf;

use kalsa_launch::{KvCache, Offload, ServerArgs};
use kalsa_probe::{Backend, ExecutionPath, Measurement, Reliability, Series};
use kalsa_supervisor::ServerConfig;

use super::*;
use crate::startup::{ContextMaxima, Machine, PreparedStart, Progress, PORT};

/// A measurement with the shape every startup fixture uses: the CPU-path
/// bandwidth, the backend this test machine would decode on.
fn measured(bandwidth: f64, backend: Backend) -> Measurement {
    Measurement {
        ramp: vec![(2, bandwidth)],
        ceiling_bytes_per_second: bandwidth,
        decode_bytes_per_second: None,
        ceiling: Series::new(vec![bandwidth]),
        plateau_threads: 2,
        cache: Series::new(vec![200.0e9]),
        compute: Series::new(vec![100.0e9]),
        reliability: Reliability {
            reliable: true,
            effective_parallelism: None,
            threads: 2,
            spread: 0.0,
            cache_ratio: None,
            notes: Vec::new(),
        },
        measured_on: ExecutionPath::Cpu,
        will_run_on: backend,
    }
}

fn machine(will_run_on: Backend) -> Machine {
    Machine {
        measurement: measured(80.0e9, will_run_on),
        ram_bytes: 32 * 1024 * 1024 * 1024,
    }
}

fn rule_args() -> ServerArgs {
    ServerArgs {
        model_path: PathBuf::from("/models/chosen.gguf"),
        port: PORT,
        context_tokens: 8192,
        cache_ram_mib: 4096,
        threads: Some(8),
        offload: Offload::All,
        idle_unload_seconds: 600,
        batch_size: 2048,
        ubatch_size: 512,
        kv_cache: KvCache::Q8_0,
        parallel: 1,
        slot_save_path: PathBuf::from("/slots"),
    }
}

/// A prepared start exactly as `planned_config_with_overrides` leaves it:
/// the rule's exe and argv, a full info, nothing tuned yet.
fn prepared(main: &str) -> PreparedStart {
    prepared_with(main, rule_args())
}

fn prepared_with(main: &str, args: ServerArgs) -> PreparedStart {
    PreparedStart {
        rule_launch: None,
        processor: None,
        server: ServerConfig {
            exe: PathBuf::from(main),
            argv: args.argv(),
            state_file: PathBuf::from("/tmp/kalsa-tune-step-test.state"),
            port: PORT,
            ready_timeout: std::time::Duration::from_secs(1),
            stop_grace: std::time::Duration::from_millis(50),
        },
        info: LaunchInfo {
            args,
            maximum_context: ContextMaxima { q8_0: None, f16: None },
            automatic_context: ContextMaxima { q8_0: None, f16: None },
            context_prices: Default::default(),
            display_name: Some("Test Row".to_string()),
            reason: Some("the test chose it".to_string()),
            model_sha256: Some("deadbeef".to_string()),
            tune: None,
            checked: None,
        },
    }
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kalsa-tune-step-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("mkdir");
    dir
}

const CORES: (Option<usize>, Option<usize>) = (Some(10), Some(10));

/// The one builder: binary, threads, offload and port — nothing else in
/// argv may move.
#[test]
fn tuned_launch_changes_only_what_it_owns() {
    let base = rule_args();
    let (_, base_argv) = tuned_launch(&base, Path::new("/base"), base.threads, base.offload, PORT);
    let (exe, argv) = tuned_launch(
        &base,
        Path::new("/other"),
        Some(4),
        Offload::ForcedOff,
        9999,
    );
    assert_eq!(exe, PathBuf::from("/other"));
    let has = |argv: &[String], flag: &str, value: &str| {
        argv.windows(2).any(|pair| pair[0] == flag && pair[1] == value)
    };
    assert!(has(&argv, "--threads", "4") && has(&argv, "--threads-batch", "4"));
    assert!(has(&argv, "--n-gpu-layers", "0"));
    assert!(has(&argv, "--port", "9999"));
    assert!(!has(&argv, "--n-gpu-layers", "all"));
    // Everything the rule decided is untouched: same model, same batch.
    assert!(has(&argv, "--batch-size", "2048"));
    assert!(has(&base_argv, "--batch-size", "2048"));
    assert!(has(&base_argv, "--threads", "8"), "the base is the rule");
}

/// The main candidate is the main build — no processor decision is asked.
#[test]
fn exe_for_returns_the_main_build_without_asking() {
    let machine = machine(Backend::Cpu);
    let candidate = kalsa_tune::Candidate {
        backend: ServerBackend::Cpu,
        threads: Some(8),
        offload: Offload::NoGpuBuild,
    };
    let mut processor = None;
    let exe = exe_for(&candidate, (ServerBackend::Cpu, Path::new("/m")), &mut processor, &machine, &mut |_| {})
        .expect("the main build needs no decision");
    assert_eq!(exe, PathBuf::from("/m"));
    assert!(processor.is_none(), "the processor decision was never asked");
}

/// A different backend resolves through the memo the walk shares with the
/// candidate loop — the seeded value is returned, not recomputed.
#[test]
fn exe_for_uses_the_resolved_processor_build() {
    let machine = machine(Backend::DiscreteGpu { vram_bytes: Some(6_439_305_216) });
    let candidate = kalsa_tune::Candidate {
        backend: ServerBackend::Cpu,
        threads: Some(16),
        offload: Offload::NoGpuBuild,
    };
    let mut processor = Some(Ok(PathBuf::from("/stub-cpu")));
    let exe = exe_for(
        &candidate,
        (ServerBackend::Vulkan, Path::new("/m")),
        &mut processor,
        &machine,
        &mut |_| {},
    )
    .expect("the memo answers without asking the store");
    assert_eq!(exe, PathBuf::from("/stub-cpu"));
    assert!(
        matches!(processor, Some(Ok(path)) if path.as_path() == std::path::Path::new("/stub-cpu")),
        "the memo answers without asking the store"
    );
}

/// A kept record: no measuring, and the winner's own settings are applied
/// through the one builder.
#[test]
fn a_record_hit_keeps_the_winner_and_never_measures() {
    let dir = scratch("hit");
    let machine = machine(Backend::DiscreteGpu { vram_bytes: Some(6_439_305_216) });
    let mut prepared = prepared("/main-gpu");
    let fingerprint = tune_fingerprint(&machine, &prepared.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let winner_candidate = kalsa_tune::Candidate {
        backend: ServerBackend::Vulkan,
        threads: Some(4),
        offload: Offload::All,
    };
    let record = kalsa_tune::record::Record {
        fingerprint,
        winner: Some(kalsa_tune::Winner { candidate: winner_candidate, best: 49.0 }),
        trials: vec![(
            winner_candidate,
            kalsa_tune::record::Kept::Best(49.0),
        )],
    };
    kalsa_tune::record::save(&dir, &record).expect("save");
    let mut seen: Vec<Progress> = Vec::new();
    let mut progress = |step: Progress| seen.push(step);
    let mut memo = Memo {
        cores: CORES,
        processor: None,
    };

    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |_, _, _| panic!("a kept record must not measure"),
    );

    assert!(
        matches!(prepared.info.tune, Some(Tune::Measured(_))),
        "the kept record is what the panel shows: {:?}",
        prepared.info.tune
    );
    assert_eq!(prepared.info.args.threads, Some(4), "the winner's threads are applied");
    let argv = &prepared.server.argv;
    assert!(
        argv.windows(2).any(|pair| pair[0] == "--threads" && pair[1] == "4"),
        "the winner launches with its own argv: {argv:?}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A refused tune: the record is still written (all-refused means the
/// machine is broken — re-spending the budget every start is worse), the
/// rule stands untouched, and the counts reached the progress callback.
#[test]
fn a_refused_tune_is_saved_and_the_rule_stands() {
    let dir = scratch("refused");
    let machine = machine(Backend::DiscreteGpu { vram_bytes: Some(6_439_305_216) });
    let mut prepared = prepared("/main-gpu");
    let fingerprint = tune_fingerprint(&machine, &prepared.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let mut seen: Vec<Progress> = Vec::new();
    let mut progress = |step: Progress| seen.push(step);
    // The processor build, stood in: `decide_cpu` cannot answer for a
    // Windows build on this machine, and the test is about the record and
    // the rule, not about the store.
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };

    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |resolved, _, counts: &mut dyn FnMut(usize, usize)| {
            counts(resolved.len(), resolved.len());
            resolved
                .iter()
                .map(|(candidate, _)| {
                    (*candidate, kalsa_tune::Outcome::Refused(kalsa_tune::Refusal::NotReady))
                })
                .collect()
        },
    );

    assert!(
        matches!(prepared.info.tune, Some(Tune::NoWinner(_))),
        "nothing won: {:?}",
        prepared.info.tune
    );
    let argv = &prepared.server.argv;
    assert!(
        argv.windows(2).any(|pair| pair[0] == "--threads" && pair[1] == "8"),
        "the rule's threads stand: {argv:?}"
    );
    assert!(
        seen.iter().any(|step| matches!(step, Progress::Tuning { done: 3, total: 3 })),
        "three lifetimes planned, three done"
    );
    let saved = kalsa_tune::record::load(&dir, &fingerprint).expect("the record was saved");
    assert_eq!(saved.winner, None, "and it says there was no winner");
    let _ = std::fs::remove_dir_all(&dir);
}

/// One candidate: nothing to compare, nothing measured — the line says so.
#[test]
fn a_single_candidate_is_skipped_and_never_measured() {
    let dir = scratch("skipped");
    let machine = machine(Backend::Cpu);
    let args = ServerArgs { threads: None, ..rule_args() };
    let mut prepared = prepared_with("/main-cpu", args);
    // Exactly one candidate: no rule count and one core count (the gpu
    // filter drops a Cpu verdict's graphics side) — one thing to run, so
    // there is nothing to compare.
    let cores = (Some(10), Some(10));
    let fingerprint = tune_fingerprint(&machine, &prepared.info, ServerBackend::Cpu, cores)
        .expect("this walk has a platform and a digest");
    let mut progress = |_: Progress| {};
    let mut memo = Memo {
        cores,
        processor: None,
    };

    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        (ServerBackend::Cpu, PathBuf::from("/main-cpu")),
        &mut memo,
        &mut progress,
        |_, _, _| panic!("one candidate must not be measured"),
    );

    assert!(
        matches!(prepared.info.tune, Some(Tune::Skipped)),
        "skipped, not guessed: {:?}",
        prepared.info.tune
    );
    assert!(prepared.server.argv.iter().all(|arg| arg != "--threads"));
    assert!(
        kalsa_tune::record::load(&dir, &fingerprint).is_none(),
        "nothing measured, nothing saved"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// The words, exactly as the panel will show them — the owner's copy.
#[test]
fn the_tune_line_is_the_owners_copy() {
    assert_eq!(tune_line(&Tune::Skipped), "skipped — nothing to compare");
    assert_eq!(
        tune_line(&Tune::NoWinner(kalsa_tune::record::Record {
            fingerprint: "fp".to_string(),
            winner: None,
            trials: vec![],
        })),
        "no winner, using the standard setting"
    );
    let winner = kalsa_tune::Candidate {
        backend: ServerBackend::Vulkan,
        threads: Some(16),
        offload: Offload::All,
    };
    let alternative = kalsa_tune::Candidate {
        backend: ServerBackend::Cpu,
        threads: Some(16),
        offload: Offload::NoGpuBuild,
    };
    let record = kalsa_tune::record::Record {
        fingerprint: "fp".to_string(),
        winner: Some(kalsa_tune::Winner { candidate: winner, best: 49.0 }),
        trials: vec![
            (winner, kalsa_tune::record::Kept::Best(49.0)),
            (alternative, kalsa_tune::record::Kept::Best(11.8)),
        ],
    };
    assert_eq!(
        tune_line(&Tune::Measured(record.clone())),
        "graphics, 49.0 tokens/s (processor 16 threads: 11.8 tokens/s)"
    );
    // EngineFitted is the graphics family in the owner's words too.
    let fitted = kalsa_tune::Candidate {
        backend: ServerBackend::Vulkan,
        threads: Some(16),
        offload: Offload::EngineFitted,
    };
    assert_eq!(
        tune_line(&Tune::Measured(kalsa_tune::record::Record {
            fingerprint: "fp".to_string(),
            winner: Some(kalsa_tune::Winner {
                candidate: fitted,
                best: 49.0,
            }),
            trials: vec![(fitted, kalsa_tune::record::Kept::Best(49.0))],
        })),
        "graphics, 49.0 tokens/s"
    );

    // A winner with no measured alternative stands alone on the line.
    let alone = kalsa_tune::record::Record {
        winner: record.winner,
        trials: vec![(winner, kalsa_tune::record::Kept::Best(49.0))],
        ..record
    };
    assert_eq!(tune_line(&Tune::Measured(alone)), "graphics, 49.0 tokens/s");
}

/// The fingerprint is one function and every part moves it — the map the
/// record is keyed on cannot silently stop covering something.
#[test]
fn the_fingerprint_follows_the_launch_and_the_machine() {
    let machine = machine(Backend::DiscreteGpu { vram_bytes: Some(6_439_305_216) });
    let info = prepared("/main-gpu").info;
    let base = tune_fingerprint(&machine, &info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    assert_eq!(
        base,
        tune_fingerprint(&machine, &info, ServerBackend::Vulkan, CORES)
            .expect("this walk has a platform and a digest"),
        "the same launch is the same key"
    );
    let mut other_context = prepared("/main-gpu").info;
    other_context.args.context_tokens = 4096;
    assert_ne!(
        tune_fingerprint(&machine, &other_context, ServerBackend::Vulkan, CORES)
            .expect("this walk has a platform and a digest"),
        base,
        "the context is part of the key"
    );
    // The engine strings are the two engine identities: on this machine
    // the Metal build has a published digest and there is no MacArm64 CPU
    // row at all, so the two slots differ. The digests themselves are the
    // verdict's own format and have their own test
    // (kalsa-runtime `a_changed_build_or_machine_is_a_changed_fingerprint`).
    let base = tune_fingerprint(&machine, &info, ServerBackend::Metal, CORES)
        .expect("this walk has a platform and a digest");
    assert_ne!(
        tune_fingerprint(&machine, &info, ServerBackend::Cpu, CORES)
            .expect("this walk has a platform and a digest"),
        base,
        "the engine build is part of the key"
    );
    assert_ne!(
        tune_fingerprint(&machine, &info, ServerBackend::Vulkan, (Some(16), Some(32)))
            .expect("this walk has a platform and a digest"),
        base,
        "the cores are part of the key"
    );
}

/// The Lenovo's handoff, through the choice path itself: the model choice
/// falls through to the processor (build = CPU, decided by the fallback)
/// while the MAIN verdict — the Vulkan that answered its probe — is what
/// the tune builds its candidates from. Without that graphics candidate
/// the machine never measures the thing it is fastest at.
#[test]
fn a_processor_fallback_still_tunes_the_graphics_candidate() {
    // A machine whose 6 GiB card refuses the model: the choice falls
    // through, and the stub decides the processor build.
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let (build, exe, _plan, _row, reason) = crate::startup::choose_with_processor_fallback(
        (ServerBackend::Vulkan, PathBuf::from("/gpu-exe")),
        &machine,
        None,
        None,
        || {
            Ok(kalsa_runtime::Decision {
                backend: ServerBackend::Cpu,
                exe: PathBuf::from("/cpu-exe"),
            })
        },
    )
    .expect("the fallback answers with the processor build");
    assert_eq!(
        build,
        ServerBackend::Cpu,
        "the model choice fell through to the processor"
    );
    assert_eq!(exe, PathBuf::from("/cpu-exe"));
    assert!(
        reason.starts_with(crate::startup::PROCESSOR_FALLBACK_REASON),
        "the fallback's own reason carries: {reason}"
    );

    let dir = scratch("fallback");
    let mut prepared = prepared("/cpu-exe");
    let mut memo = Memo {
        cores: CORES,
        processor: None,
    };
    let mut progress = |_: Progress| {};
    let mut captured: Vec<(kalsa_tune::Candidate, PathBuf)> = Vec::new();
    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        // The MAIN verdict, carried beside the CPU build the fallback chose.
        (ServerBackend::Vulkan, PathBuf::from("/gpu-exe")),
        &mut memo,
        &mut progress,
        |resolved, _, counts| {
            counts(resolved.len(), resolved.len());
            captured = resolved.to_vec();
            vec![]
        },
    );
    assert!(
        captured
            .iter()
            .any(|(candidate, resolved_exe)| candidate.backend == ServerBackend::Vulkan
                && resolved_exe.as_path() == std::path::Path::new("/gpu-exe")),
        "the graphics candidate runs on the main build's exe: {captured:?}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A partial picture is not a picture: when the budget cut the list (only
/// some candidates ran), this start's winner still launches, but no record
/// is written — the next start must try the whole thing again.
#[test]
fn an_incomplete_tune_is_not_saved() {
    let dir = scratch("incomplete");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = prepared("/main-gpu");
    let fingerprint = tune_fingerprint(&machine, &prepared.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };
    let mut progress = |_: Progress| {};
    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |resolved, _, counts| {
            counts(resolved.len(), resolved.len());
            // The budget cut after two candidates: the third never ran.
            vec![
                (resolved[0].0, kalsa_tune::Outcome::Measured(vec![55.0])),
                // The best of what ran is the third candidate — 10 threads.
                (resolved[2].0, kalsa_tune::Outcome::Measured(vec![66.0])),
            ]
        },
    );
    // The winner of what ran (the third candidate, 10 threads) launches…
    assert_eq!(
        prepared.info.args.threads,
        Some(10),
        "this start's winner is applied"
    );
    assert!(
        matches!(prepared.info.tune, Some(Tune::Measured(_))),
        "the line shows what ran: {:?}",
        prepared.info.tune
    );
    // …but nothing was written down.
    assert!(
        kalsa_tune::record::load(&dir, &fingerprint).is_none(),
        "an incomplete tune must not be saved"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A processor build that could not be resolved makes the tune incomplete
/// too (candidates were dropped): same rule — use it, do not save it —
/// and the memo remembers the failure so it is not retried per candidate.
#[test]
fn an_unresolvable_processor_build_makes_the_tune_incomplete() {
    let dir = scratch("unresolvable");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = prepared("/main-gpu");
    let fingerprint = tune_fingerprint(&machine, &prepared.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Err(crate::failure::StartupFailure::NoBuildForThisMachine)),
    };
    let mut seen: Vec<Progress> = Vec::new();
    let mut progress = |step: Progress| seen.push(step);
    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |resolved, _, counts| {
            counts(resolved.len(), resolved.len());
            resolved
                .iter()
                .map(|(candidate, _)| (*candidate, kalsa_tune::Outcome::Measured(vec![66.0])))
                .collect()
        },
    );
    // The processor candidates were dropped by the memoized failure — one
    // lifetime ran, three candidates exist — so this is incomplete.
    assert!(
        seen.iter().any(|step| matches!(step, Progress::Tuning { done: 1, total: 1 })),
        "the processor candidates never ran"
    );
    assert!(
        kalsa_tune::record::load(&dir, &fingerprint).is_none(),
        "an incomplete tune must not be saved"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A legacy record — v1 magic, its graphics winner pinning `--n-gpu-layers
/// all` — is refused, the refusal is a fresh tune, and the complete result
/// replaces it with a v2 record on disk.
#[test]
fn a_legacy_record_is_refused_and_the_tune_runs_again() {
    let dir = scratch("legacy");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = prepared("/main-gpu");
    let fingerprint = tune_fingerprint(&machine, &prepared.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    // The shape a v1 build wrote: a graphics winner carrying `all`.
    let winner_candidate = kalsa_tune::Candidate {
        backend: ServerBackend::Vulkan,
        threads: Some(8),
        offload: Offload::All,
    };
    let record = kalsa_tune::record::Record {
        fingerprint: fingerprint.clone(),
        winner: Some(kalsa_tune::Winner {
            candidate: winner_candidate,
            best: 49.0,
        }),
        trials: vec![(
            winner_candidate,
            kalsa_tune::record::Kept::Best(49.0),
        )],
    };
    kalsa_tune::record::save(&dir, &record).expect("save");
    // The file as the pre-fit build wrote it:
    let file = dir.join("tuning.txt");
    let text = std::fs::read_to_string(&file).expect("read");
    std::fs::write(&file, text.replacen("kalsa-tune v2", "kalsa-tune v1", 1)).expect("rewrite");

    let mut measured = 0usize;
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };
    let mut progress = |_: Progress| {};
    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |resolved, _, counts| {
            measured += 1;
            counts(resolved.len(), resolved.len());
            // Complete: every candidate ran (each refused is an answer),
            // so the result may be saved.
            resolved
                .iter()
                .map(|(candidate, _)| {
                    (
                        *candidate,
                        kalsa_tune::Outcome::Refused(kalsa_tune::Refusal::NotReady),
                    )
                })
                .collect()
        },
    );

    assert_eq!(measured, 1, "the refused record leads to a fresh measure");
    assert!(
        matches!(prepared.info.tune, Some(Tune::NoWinner(_))),
        "and the walk completes with a line, not a failure: {:?}",
        prepared.info.tune
    );
    let text = std::fs::read_to_string(dir.join("tuning.txt")).expect("read the record");
    assert!(
        text.starts_with("kalsa-tune v2\n"),
        "the complete tune replaced it with a v2 record"
    );
    assert!(
        kalsa_tune::record::load(&dir, &fingerprint).is_some(),
        "and the v2 record loads"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A panic inside the step degrades to the plan: the rule's launch comes
/// back exactly, and no claim about the tune survives.
#[test]
fn a_panicking_tune_leaves_the_plan_standing() {
    let dir = scratch("panic");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = prepared("/main-gpu");
    let rule = prepared.server.clone();
    let rule_threads = prepared.info.args.threads;
    let mut memo = Memo {
        cores: CORES,
        processor: None,
    };
    let mut progress = |_: Progress| {};
    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |_, _, _| panic!("the measure exploded"),
    );
    assert_eq!(prepared.server.argv, rule.argv, "the rule's argv is restored");
    assert_eq!(prepared.server.exe, rule.exe, "the rule's exe is restored");
    assert_eq!(prepared.info.args.threads, rule_threads, "and its threads");
    assert!(
        prepared.info.tune.is_none(),
        "a panicked tune claims nothing on the panel"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// The count's wire name is the page's name: ProgressStep reads `total`,
/// and one name on both sides is the whole point of the field.
#[test]
fn the_tuning_step_serialises_the_total_the_page_reads() {
    let json =
        serde_json::to_value(Progress::Tuning { done: 1, total: 2 }).expect("serialise");
    assert_eq!(json["kind"], "tuning");
    assert_eq!(json["total"], 2);
    assert!(json.get("planned").is_none(), "the old name must not appear");
}
