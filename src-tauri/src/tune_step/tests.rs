//! The tune step's own tests: the one builder, the exe rule, and the hook's
//! three answers (kept, measured, skipped) — each with the mutation that
//! would break it.

use std::path::PathBuf;

use kalsa_launch::{Draft as LaunchDraft, KvCache, Offload, ServerArgs};
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
        device: None,
        idle_unload_seconds: 600,
        batch_size: 2048,
        ubatch_size: 512,
        kv_cache: KvCache::Q8_0,
        parallel: 1,
        slot_save_path: PathBuf::from("/slots"),
        sampling: kalsa_catalog::Sampling::default(),
        draft: None,
    }
}

fn draft_args() -> ServerArgs {
    ServerArgs {
        draft: Some(LaunchDraft {
            model_path: PathBuf::from("/models/mtp.gguf"),
            n_max: kalsa_launch::DEFAULT_DRAFT_N_MAX,
        }),
        ..rule_args()
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
            maximum_context: ContextMaxima {
                q8_0: None,
                f16: None,
            },
            automatic_context: ContextMaxima {
                q8_0: None,
                f16: None,
            },
            context_prices: Default::default(),
            display_name: Some("Test Row".to_string()),
            reason: Some("the test chose it".to_string()),
            model_sha256: Some("deadbeef".to_string()),
            tune: None,
            checked: None,
            drafter_sha256: None,
        },
    }
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kalsa-tune-step-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("mkdir");
    dir
}

/// The drafter's own fingerprint key, so a plan with a drafter keys its
/// record on the same facts the walk does.
fn with_drafter(mut prepared: PreparedStart) -> PreparedStart {
    prepared.info.drafter_sha256 = Some("cafe1234".to_string());
    prepared
}

const CORES: (Option<usize>, Option<usize>) = (Some(10), Some(10));

/// A reply built the way the crate builds one: the seconds always follow
/// from the two rates, so a fixture never contradicts itself.
fn reply(prompt_rate: f64, decode_rate: f64) -> kalsa_tune::Reply {
    kalsa_tune::Reply::from_rates(prompt_rate, decode_rate).expect("two measurements")
}

/// A measured trial as the seam would hand it over.
fn replied(
    candidate: kalsa_tune::Candidate,
    prompt_rate: f64,
    decode_rate: f64,
) -> (kalsa_tune::Candidate, kalsa_tune::record::Kept) {
    (
        candidate,
        kalsa_tune::record::Kept::Replied(reply(prompt_rate, decode_rate)),
    )
}

/// A refused trial: the shape answered with a closed cause.
fn refused(
    candidate: kalsa_tune::Candidate,
    refusal: kalsa_tune::Refusal,
) -> (kalsa_tune::Candidate, kalsa_tune::record::Kept) {
    (
        candidate,
        kalsa_tune::record::Kept::Refused {
            refusal,
            prompt_rate: None,
        },
    )
}

/// A whole tune's answer as the production seam returns it. The winner is
/// the test's own input here: the selection is kalsa-tune's, tested there,
/// and this file tests what the step does with what it is handed.
fn tuned(
    trials: Vec<(kalsa_tune::Candidate, kalsa_tune::record::Kept)>,
    winner: Option<kalsa_tune::Winner>,
) -> kalsa_tune::Tuned {
    kalsa_tune::Tuned {
        trials,
        winner,
        complete: true,
        cut: false,
    }
}

/// The one builder: binary, threads, offload and port — nothing else in
/// argv may move.
#[test]
fn tuned_launch_changes_only_what_it_owns() {
    let base = rule_args();
    let (_, base_argv) = tuned_launch(
        &base,
        Path::new("/base"),
        base.threads,
        base.offload,
        None,
        PORT,
    );
    let (exe, argv) = tuned_launch(
        &base,
        Path::new("/other"),
        Some(4),
        Offload::ForcedOff,
        None,
        9999,
    );
    assert_eq!(exe, PathBuf::from("/other"));
    let has = |argv: &[String], flag: &str, value: &str| {
        argv.windows(2)
            .any(|pair| pair[0] == flag && pair[1] == value)
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

/// The pin rides every shape: the device is not one of the things
/// `tuned_launch` owns, so a graphics trial and the processor's both carry
/// the rule's card name — and the renderer drops it only where the build
/// cannot name devices (`NoGpuBuild`, the CPU build).
#[test]
fn every_shape_keeps_the_rules_pinned_device() {
    let mut base = rule_args();
    base.device = Some("Vulkan0".to_string());
    for offload in [Offload::All, Offload::EngineFitted, Offload::ForcedOff, Offload::NoGpuBuild] {
        let (_, argv) = tuned_launch(&base, Path::new("/e"), Some(4), offload, None, PORT);
        let pinned = argv
            .windows(2)
            .any(|pair| pair[0] == "--device" && pair[1] == "Vulkan0");
        assert_eq!(
            pinned,
            offload != Offload::NoGpuBuild,
            "{offload:?}: {argv:?}"
        );
    }
}

/// The main candidate is the main build — no processor decision is asked.
#[test]
fn exe_for_returns_the_main_build_without_asking() {
    let machine = machine(Backend::Cpu);
    let candidate = kalsa_tune::Candidate {
        backend: ServerBackend::Cpu,
        threads: Some(8),
        offload: Offload::NoGpuBuild,
        draft: None,
    };
    let mut processor = None;
    let exe = exe_for(
        &candidate,
        (ServerBackend::Cpu, Path::new("/m")),
        &mut processor,
        &machine,
        &mut |_| {},
    )
    .expect("the main build needs no decision");
    assert_eq!(exe, PathBuf::from("/m"));
    assert!(
        processor.is_none(),
        "the processor decision was never asked"
    );
}

/// A different backend resolves through the memo the walk shares with the
/// candidate loop — the seeded value is returned, not recomputed.
#[test]
fn exe_for_uses_the_resolved_processor_build() {
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let candidate = kalsa_tune::Candidate {
        backend: ServerBackend::Cpu,
        threads: Some(16),
        offload: Offload::NoGpuBuild,
        draft: None,
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
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = prepared("/main-gpu");
    let fingerprint = tune_fingerprint(&machine, &prepared.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let winner_candidate = kalsa_tune::Candidate {
        backend: ServerBackend::Vulkan,
        threads: Some(4),
        offload: Offload::All,
        draft: None,
    };
    let record = kalsa_tune::record::Record {
        fingerprint,
        winner: Some(kalsa_tune::Winner {
            candidate: winner_candidate,
            reply: reply(1000.0, 49.0),
        }),
        trials: vec![replied(winner_candidate, 1000.0, 49.0)],
    };
    kalsa_tune::record::save(
        &dir,
        prepared.info.model_sha256.as_deref().unwrap(),
        &record,
    )
    .expect("save");
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
    assert_eq!(
        prepared.info.args.threads,
        Some(4),
        "the winner's threads are applied"
    );
    let argv = &prepared.server.argv;
    assert!(
        argv.windows(2)
            .any(|pair| pair[0] == "--threads" && pair[1] == "4"),
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
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
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
            tuned(
                resolved
                    .iter()
                    .map(|(candidate, _)| refused(*candidate, kalsa_tune::Refusal::NotReady))
                    .collect(),
                None,
            )
        },
    );

    assert!(
        matches!(prepared.info.tune, Some(Tune::NoWinner(_))),
        "nothing won: {:?}",
        prepared.info.tune
    );
    let argv = &prepared.server.argv;
    assert!(
        argv.windows(2)
            .any(|pair| pair[0] == "--threads" && pair[1] == "8"),
        "the rule's threads stand: {argv:?}"
    );
    assert!(
        seen.iter()
            .any(|step| matches!(step, Progress::Tuning { done: 3, total: 3 })),
        "three lifetimes planned, three done"
    );
    let saved = kalsa_tune::record::load(
        &dir,
        prepared.info.model_sha256.as_deref().unwrap(),
        &fingerprint,
    )
    .expect("the record was saved");
    assert_eq!(saved.winner, None, "and it says there was no winner");
    let _ = std::fs::remove_dir_all(&dir);
}

/// One candidate: nothing to compare, nothing measured — the line says so.
#[test]
fn a_single_candidate_is_skipped_and_never_measured() {
    let dir = scratch("skipped");
    let machine = machine(Backend::Cpu);
    let args = ServerArgs {
        threads: None,
        ..rule_args()
    };
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
        kalsa_tune::record::load(
            &dir,
            prepared.info.model_sha256.as_deref().unwrap(),
            &fingerprint
        )
        .is_none(),
        "nothing measured, nothing saved"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// The words, exactly as the panel will show them — the owner's copy. The
/// winner's own reply is the figure, in the room's unit, with the two rates
/// it was computed from beside it; the alternative is the fastest other
/// reply, never the fastest rate.
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
        draft: None,
    };
    let alternative = kalsa_tune::Candidate {
        backend: ServerBackend::Cpu,
        threads: Some(16),
        offload: Offload::NoGpuBuild,
        draft: None,
    };
    let slower = kalsa_tune::Candidate {
        backend: ServerBackend::Cpu,
        threads: Some(22),
        offload: Offload::NoGpuBuild,
        draft: None,
    };
    let record = kalsa_tune::record::Record {
        fingerprint: "fp".to_string(),
        winner: Some(kalsa_tune::Winner {
            candidate: winner,
            reply: reply(1900.0, 47.0),
        }),
        trials: vec![
            replied(winner, 1900.0, 47.0),
            replied(alternative, 1000.0, 11.8),
            replied(slower, 900.0, 11.0),
        ],
    };
    assert_eq!(
        tune_line(&Tune::Measured(record.clone())),
        "graphics, reply ≈ 4.9 s (prompt 1,900 tok/s, decode 47 tok/s) \
         (processor 16 threads: reply ≈ 18.1 s)"
    );
    // EngineFitted is the graphics family in the owner's words too, and a
    // winner with no measured alternative stands alone on the line.
    let fitted = kalsa_tune::Candidate {
        backend: ServerBackend::Vulkan,
        threads: Some(16),
        offload: Offload::EngineFitted,
        draft: None,
    };
    assert_eq!(
        tune_line(&Tune::Measured(kalsa_tune::record::Record {
            fingerprint: "fp".to_string(),
            winner: Some(kalsa_tune::Winner {
                candidate: fitted,
                reply: reply(1900.0, 47.0),
            }),
            trials: vec![replied(fitted, 1900.0, 47.0)],
        })),
        "graphics, reply ≈ 4.9 s (prompt 1,900 tok/s, decode 47 tok/s)"
    );
}

/// The fingerprint is one function and every part moves it — the map the
/// record is keyed on cannot silently stop covering something.
#[test]
fn the_fingerprint_follows_the_launch_and_the_machine() {
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
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
    // A machine whose 4 GiB card refuses the model — 3 GiB of budget after
    // the card's one-GiB floor, and the smallest row needs 3.7 GiB — so the
    // choice falls through and the stub decides the processor build.
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(4 * 1024 * 1024 * 1024),
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
    let captured = std::cell::RefCell::new(Vec::<(kalsa_tune::Candidate, PathBuf)>::new());
    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        // The MAIN verdict, carried beside the CPU build the fallback chose.
        (ServerBackend::Vulkan, PathBuf::from("/gpu-exe")),
        &mut memo,
        &mut progress,
        |resolved, rule, counts| {
            counts(resolved.len(), resolved.len());
            *captured.borrow_mut() = resolved.to_vec();
            assert!(
                rule.draft.is_none(),
                "this plan ships no drafter, so the sweep is off alone"
            );
            tuned(vec![], None)
        },
    );
    assert!(
        captured
            .borrow()
            .iter()
            .any(
                |(candidate, resolved_exe)| candidate.backend == ServerBackend::Vulkan
                    && resolved_exe.as_path() == std::path::Path::new("/gpu-exe")
            ),
        "the graphics candidate runs on the main build's exe: {captured:?}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A partial picture is not a picture: when the budget cut a shape before
/// its first lifetime (the seam says `complete: false`), this start's
/// winner still launches, but no record is written — the next start must
/// try the whole thing again.
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
            // The budget cut before the last shape ran: two of the three
            // candidates answered.
            let best = resolved[2].0;
            let mut tuned = tuned(
                vec![
                    replied(resolved[0].0, 60.0, 30.0),
                    replied(best, 80.0, 12.0),
                ],
                Some(kalsa_tune::Winner {
                    candidate: best,
                    reply: reply(80.0, 12.0),
                }),
            );
            tuned.complete = false;
            tuned
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
        kalsa_tune::record::load(
            &dir,
            prepared.info.model_sha256.as_deref().unwrap(),
            &fingerprint
        )
        .is_none(),
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
    let fingerprint_for_seam = fingerprint.clone();
    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        move |resolved, _, counts| {
            counts(resolved.len(), resolved.len());
            assert_eq!(
                resolved.len(),
                1,
                "the processor candidates were dropped: {fingerprint_for_seam}"
            );
            let only = resolved[0].0;
            tuned(
                vec![replied(only, 60.0, 30.0)],
                Some(kalsa_tune::Winner {
                    candidate: only,
                    reply: reply(60.0, 30.0),
                }),
            )
        },
    );
    // The processor candidates were dropped by the memoized failure — one
    // shape ran, two candidates exist — so this is incomplete.
    assert!(
        seen.iter()
            .any(|step| matches!(step, Progress::Tuning { done: 1, total: 1 })),
        "the processor candidates never ran"
    );
    assert!(
        kalsa_tune::record::load(
            &dir,
            prepared.info.model_sha256.as_deref().unwrap(),
            &fingerprint
        )
        .is_none(),
        "an incomplete tune must not be saved"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// An old record — here a v3 one, the last decode-only format — is
/// refused, the refusal is a fresh tune, and the complete result replaces
/// it with a fresh record on disk.
#[test]
fn a_legacy_record_is_refused_and_the_tune_runs_again() {
    let dir = scratch("legacy");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = prepared("/main-gpu");
    let fingerprint = tune_fingerprint(&machine, &prepared.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    // The shape the previous format wrote: the same trial lines, one
    // magic behind.
    let winner_candidate = kalsa_tune::Candidate {
        backend: ServerBackend::Vulkan,
        threads: Some(8),
        offload: Offload::All,
        draft: None,
    };
    let record = kalsa_tune::record::Record {
        fingerprint: fingerprint.clone(),
        winner: Some(kalsa_tune::Winner {
            candidate: winner_candidate,
            reply: reply(1000.0, 49.0),
        }),
        trials: vec![replied(winner_candidate, 1000.0, 49.0)],
    };
    kalsa_tune::record::save(
        &dir,
        prepared.info.model_sha256.as_deref().unwrap(),
        &record,
    )
    .expect("save");
    // The file as the pre-room build wrote it:
    let file = dir.join("tuning-deadbeef.txt");
    let text = std::fs::read_to_string(&file).expect("read");
    std::fs::write(&file, text.replacen("kalsa-tune v6", "kalsa-tune v5", 1)).expect("rewrite");

    let measured = std::cell::Cell::new(0usize);
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
            measured.set(measured.get() + 1);
            counts(resolved.len(), resolved.len());
            // Complete: every candidate ran (each refused is an answer),
            // so the result may be saved.
            tuned(
                resolved
                    .iter()
                    .map(|(candidate, _)| refused(*candidate, kalsa_tune::Refusal::NotReady))
                    .collect(),
                None,
            )
        },
    );

    assert_eq!(
        measured.get(),
        1,
        "the refused record leads to a fresh measure"
    );
    assert!(
        matches!(prepared.info.tune, Some(Tune::NoWinner(_))),
        "and the walk completes with a line, not a failure: {:?}",
        prepared.info.tune
    );
    let text = std::fs::read_to_string(dir.join("tuning-deadbeef.txt")).expect("read the record");
    assert!(
        text.starts_with("kalsa-tune v6\n"),
        "the complete tune replaced it with a current record"
    );
    assert!(
        kalsa_tune::record::load(
            &dir,
            prepared.info.model_sha256.as_deref().unwrap(),
            &fingerprint
        )
        .is_some(),
        "and the rewritten record loads"
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
    assert_eq!(
        prepared.server.argv, rule.argv,
        "the rule's argv is restored"
    );
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
    let json = serde_json::to_value(Progress::Tuning { done: 1, total: 2 }).expect("serialise");
    assert_eq!(json["kind"], "tuning");
    assert_eq!(json["total"], 2);
    assert!(
        json.get("planned").is_none(),
        "the old name must not appear"
    );
}

/// MTP on a shape whose target-only reply loses: the drafted processor
/// trial is the winner on the room's own unit, it is persisted with the
/// rest of the record, and a later start reuses it without measuring.
#[test]
fn a_draft_winner_is_measured_persisted_and_reused() {
    let dir = scratch("draft-winner");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = with_drafter(prepared_with("/main-gpu", draft_args()));
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };
    let mut progress = |_: Progress| {};
    let passes = std::cell::Cell::new(0usize);
    let shapes = std::cell::RefCell::new(Vec::<kalsa_tune::Candidate>::new());
    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |resolved, rule, counts| {
            passes.set(passes.get() + 1);
            counts(resolved.len(), resolved.len());
            assert!(rule.draft.is_some(), "this plan ships a drafter");
            assert!(
                resolved
                    .iter()
                    .all(|(candidate, _)| candidate.draft.is_none()),
                "the seam sees shapes; the sweep belongs to the crate"
            );
            *shapes.borrow_mut() = resolved.iter().map(|(candidate, _)| *candidate).collect();
            let gpu = resolved
                .iter()
                .map(|(candidate, _)| *candidate)
                .find(|candidate| candidate.offload == Offload::EngineFitted)
                .expect("the graphics shape leads");
            let processor = resolved
                .iter()
                .map(|(candidate, _)| *candidate)
                .find(|candidate| matches!(candidate.offload, Offload::NoGpuBuild))
                .expect("a processor shape follows");
            let drafted = |n_max: u32| kalsa_tune::Candidate {
                draft: Some(n_max),
                ..processor
            };
            tuned(
                vec![
                    replied(gpu, 60.0, 30.0),
                    replied(processor, 150.0, 8.0),
                    replied(drafted(2), 150.0, 10.0),
                    replied(drafted(3), 150.0, 12.0),
                    replied(drafted(4), 150.0, 11.0),
                ],
                Some(kalsa_tune::Winner {
                    candidate: drafted(3),
                    reply: reply(150.0, 12.0),
                }),
            )
        },
    );
    assert_eq!(passes.get(), 1, "the whole tune measured once");
    assert!(
        !shapes.borrow().is_empty(),
        "the shapes run through the seam together"
    );
    let argv = prepared.server.argv.join(" ");
    assert!(
        argv.contains("--model-draft /models/mtp.gguf"),
        "the winner launches its drafter: {argv}"
    );
    assert!(argv.contains("--spec-draft-n-max 3"), "{argv}");
    assert_eq!(
        prepared.info.args.draft.as_ref().map(|draft| draft.n_max),
        Some(3),
        "the args the panel reads carry the choice"
    );
    let line = tune_line(prepared.info.tune.as_ref().expect("the tune ran"));
    assert!(line.contains("drafter 3"), "{line}");
    assert!(
        line.contains("reply ≈ 24.3 s"),
        "the number is the room's own: {line}"
    );
    let digest = prepared.info.model_sha256.as_deref().unwrap();
    let fingerprint = tune_fingerprint(&machine, &prepared.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let record =
        kalsa_tune::record::load(&dir, digest, &fingerprint).expect("the record was saved");
    assert_eq!(record.trials.len(), 5, "{:?}", record.trials);

    // A later start: the record answers, nothing is measured, and the same
    // drafter setting is applied from it.
    let mut again = with_drafter(prepared_with("/main-gpu", draft_args()));
    tune_launch(
        &mut again,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |_, _, _| panic!("a kept record must not measure"),
    );
    assert!(
        again.server.argv.join(" ").contains("--spec-draft-n-max 3"),
        "the kept record carries the draft choice"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A draft lifetime that fails simply loses: refused n_maxes leave the
/// target-only reply standing, and that verdict is what persists.
#[test]
fn a_failing_draft_candidate_loses() {
    let dir = scratch("draft-refused");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = with_drafter(prepared_with("/main-gpu", draft_args()));
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
            let gpu = resolved[0].0;
            let processor = resolved
                .iter()
                .map(|(candidate, _)| *candidate)
                .find(|candidate| matches!(candidate.offload, Offload::NoGpuBuild))
                .expect("a processor shape follows");
            let mut trials = vec![replied(gpu, 50.0, 25.0), replied(processor, 150.0, 8.0)];
            trials.extend([2, 3, 4].map(|n_max| {
                refused(
                    kalsa_tune::Candidate {
                        draft: Some(n_max),
                        ..processor
                    },
                    kalsa_tune::Refusal::DidNotStart,
                )
            }));
            tuned(
                trials,
                Some(kalsa_tune::Winner {
                    candidate: processor,
                    reply: reply(150.0, 8.0),
                }),
            )
        },
    );
    let argv = prepared.server.argv.join(" ");
    assert!(
        !argv.contains("--model-draft"),
        "every n_max refused: the target-only reply stands: {argv}"
    );
    assert!(prepared.info.args.draft.is_none());

    // And "off" is the persisted verdict: a later start reuses it.
    let mut again = with_drafter(prepared_with("/main-gpu", draft_args()));
    tune_launch(
        &mut again,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |_, _, _| panic!("a kept record must not measure"),
    );
    assert!(
        !again.server.argv.join(" ").contains("--model-draft"),
        "the kept record says off"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// No drafter, no draft flags and no draft lifetimes: the plan's own launch
/// stands, and the seam — the whole tune — was asked once. The per-shape
/// sweep policy itself is the crate's, tested where the passes are.
#[test]
fn a_launch_without_a_drafter_measures_no_draft_lifetimes() {
    let dir = scratch("no-drafter");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = prepared("/main-gpu");
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };
    let mut progress = |_: Progress| {};
    let passes = std::cell::Cell::new(0usize);
    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |resolved, rule, counts| {
            passes.set(passes.get() + 1);
            counts(resolved.len(), resolved.len());
            assert!(
                rule.draft.is_none(),
                "no drafter in the plan: nothing to sweep"
            );
            let gpu = resolved[0].0;
            tuned(
                vec![replied(gpu, 60.0, 30.0)],
                Some(kalsa_tune::Winner {
                    candidate: gpu,
                    reply: reply(60.0, 30.0),
                }),
            )
        },
    );
    assert_eq!(passes.get(), 1, "the tune alone: no drafter, no sweep");
    assert!(!prepared.server.argv.join(" ").contains("--model-draft"));
    let _ = std::fs::remove_dir_all(&dir);
}

/// Off wins the room when the drafter did not clearly buy it: the drafted
/// trial's own reply is 4 % shorter — inside the band — so the draft axis
/// ranks last and the target-only launch stays. The figure the line shows
/// is the record's own, never a decode rate borrowed from elsewhere.
#[test]
fn off_wins_the_second_ask_even_though_the_grid_measured_it() {
    let dir = scratch("draft-off-wins");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = with_drafter(prepared_with("/main-gpu", draft_args()));
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
            let gpu = resolved[0].0;
            let processor = resolved
                .iter()
                .map(|(candidate, _)| *candidate)
                .find(|candidate| matches!(candidate.offload, Offload::NoGpuBuild))
                .expect("a processor shape follows");
            let drafted = kalsa_tune::Candidate {
                draft: Some(3),
                ..gpu
            };
            tuned(
                vec![
                    replied(gpu, 60.0, 30.0),
                    // The drafted trial decodes faster (33.8 against 30)
                    // and its reply is 25.1 s against 25.8 — inside 5 %.
                    replied(drafted, 60.0, 33.8),
                    replied(processor, 80.0, 8.0),
                ],
                Some(kalsa_tune::Winner {
                    candidate: gpu,
                    reply: reply(60.0, 30.0),
                }),
            )
        },
    );
    let argv = prepared.server.argv.join(" ");
    assert!(
        !argv.contains("--model-draft"),
        "the drafted trial only tied: speculation is not kept: {argv}"
    );
    assert!(prepared.info.args.draft.is_none());
    // The line carries the winning trial's own reply — 25.8 s at the
    // target-only 30 tok/s — not the drafted trial's faster decode.
    let line = tune_line(prepared.info.tune.as_ref().expect("the tune ran"));
    assert!(line.contains("graphics"), "{line}");
    assert!(line.contains("reply ≈ 25.8 s"), "{line}");
    assert!(line.contains("decode 30 tok/s"), "{line}");
    assert!(
        !line.contains("33.8"),
        "a losing rate ranks nothing: {line}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A sweep the budget cut is not this start's verdict: the file is
/// written as a marker `load` refuses, so the next start gets the chance
/// to finish the sweep — while this start's winner still launches. A
/// start whose predecessor was cut too saves what exists: the machine is
/// slow, not the tune broken, and re-tuning forever would spend the
/// budget every start.
#[test]
fn a_cut_sweep_is_withheld_once_and_saved_the_second_time() {
    let dir = scratch("draft-cut");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    // The tune a cut sweep produces: the drafted card wins what ran, the
    // processor's own drafted sweep never began (its first lifetime did).
    fn cut_tune(
        resolved: &[(kalsa_tune::Candidate, PathBuf)],
        _: &ServerArgs,
        counts: &mut dyn FnMut(usize, usize),
    ) -> kalsa_tune::Tuned {
        counts(resolved.len(), resolved.len());
        let gpu = resolved[0].0;
        let processor = resolved
            .iter()
            .map(|(candidate, _)| *candidate)
            .find(|candidate| matches!(candidate.offload, Offload::NoGpuBuild))
            .expect("a processor shape follows");
        let drafted = kalsa_tune::Candidate {
            draft: Some(2),
            ..gpu
        };
        let mut tuned = tuned(
            vec![
                replied(gpu, 60.0, 30.0),
                // 37.8 s against 40.0: outside the band, so the drafted
                // setting wins what the budget let run.
                replied(drafted, 60.0, 45.0),
                replied(processor, 150.0, 8.0),
            ],
            Some(kalsa_tune::Winner {
                candidate: drafted,
                reply: reply(60.0, 45.0),
            }),
        );
        tuned.cut = true;
        tuned
    }
    let mut prepared = with_drafter(prepared_with("/main-gpu", draft_args()));
    let digest = prepared.info.model_sha256.as_deref().unwrap().to_string();
    let fingerprint = tune_fingerprint(&machine, &prepared.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };
    let mut progress = |_: Progress| {};

    // The first cut: the winner launches, the file is only a marker.
    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        cut_tune,
    );
    assert!(
        prepared
            .server
            .argv
            .join(" ")
            .contains("--spec-draft-n-max 2"),
        "this start's winner launches: {:?}",
        prepared.server.argv
    );
    assert!(
        kalsa_tune::record::load(&dir, &digest, &fingerprint).is_none(),
        "a cut sweep must not be reused as a verdict"
    );
    assert!(
        kalsa_tune::record::cut_before(&dir, &digest, &fingerprint),
        "the marker says the next start must finish the sweep"
    );

    // The second cut: what exists is saved, and the winner launches again.
    let mut again = with_drafter(prepared_with("/main-gpu", draft_args()));
    tune_launch(
        &mut again,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        cut_tune,
    );
    assert!(
        again.server.argv.join(" ").contains("--spec-draft-n-max 2"),
        "the second start's winner launches too"
    );
    let saved = kalsa_tune::record::load(&dir, &digest, &fingerprint)
        .expect("a second cut saves what exists instead of re-tuning forever");
    assert_eq!(
        saved.winner.map(|win| win.candidate.draft),
        Some(Some(2)),
        "and the saved verdict is the cut tune's own winner"
    );
    assert!(!kalsa_tune::record::cut_before(&dir, &digest, &fingerprint));

    // The third start: the record answers, nothing measured.
    let mut third = with_drafter(prepared_with("/main-gpu", draft_args()));
    tune_launch(
        &mut third,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |_, _, _| panic!("a kept record must not measure"),
    );
    assert!(third.server.argv.join(" ").contains("--spec-draft-n-max 2"));
    let _ = std::fs::remove_dir_all(&dir);
}

/// The winner's build must be launchable: when the processor build refuses
/// (so its shapes were dropped) and the seam still answers for one of
/// them, nothing is saved — the next start measures again instead of
/// reusing a record whose winner nobody can launch.
#[test]
fn an_unresolvable_draft_exe_leaves_the_tune_unsaved() {
    let dir = scratch("draft-no-exe");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = with_drafter(prepared_with("/main-gpu", draft_args()));
    // The processor build refuses: the tune drops its shapes, and the seam
    // below still answers for one — the defensive case, where a winner
    // arrives whose build nobody can launch.
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Err(StartupFailure::DownloadCorrupted)),
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
            let ghost = kalsa_tune::Candidate {
                backend: ServerBackend::Cpu,
                threads: Some(8),
                offload: Offload::NoGpuBuild,
                draft: None,
            };
            let mut trials = vec![replied(resolved[0].0, 60.0, 30.0)];
            trials.push(replied(ghost, 150.0, 8.0));
            tuned(
                trials,
                Some(kalsa_tune::Winner {
                    candidate: ghost,
                    reply: reply(150.0, 8.0),
                }),
            )
        },
    );
    let digest = prepared.info.model_sha256.as_deref().unwrap();
    let fingerprint = tune_fingerprint(&machine, &prepared.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    assert!(
        kalsa_tune::record::load(&dir, digest, &fingerprint).is_none(),
        "incomplete is unsaved: the next start retries"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// The processor alternative carries the drafter the processor trial was
/// measured with, pinned to the CPU beside its own `--n-gpu-layers 0`.
#[test]
fn the_processor_leg_carries_the_drafter_pinned_to_the_cpu() {
    let dir = scratch("draft-processor-leg");
    // The Mac's shape: the processor leg is the SAME Metal build with the
    // offload forced off — the one leg that renders --n-gpu-layers 0.
    let machine = machine(Backend::Metal);
    let mut prepared = with_drafter(prepared_with("/main-gpu", draft_args()));
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };
    let mut progress = |_: Progress| {};
    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        (ServerBackend::Metal, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |resolved, _, counts| {
            counts(resolved.len(), resolved.len());
            let fitted = resolved
                .iter()
                .map(|(candidate, _)| *candidate)
                .find(|candidate| candidate.offload == Offload::EngineFitted)
                .expect("the engine-fitted shape leads");
            let forced = resolved
                .iter()
                .map(|(candidate, _)| *candidate)
                .find(|candidate| candidate.offload == Offload::ForcedOff)
                .expect("the forced-off shape follows");
            let drafted = kalsa_tune::Candidate {
                draft: Some(3),
                ..fitted
            };
            let forced_drafted = kalsa_tune::Candidate {
                draft: Some(3),
                ..forced
            };
            tuned(
                vec![
                    replied(fitted, 60.0, 30.0),
                    replied(drafted, 60.0, 45.0),
                    replied(forced, 70.0, 12.0),
                    // The shortest processor reply is a drafted one, and
                    // that setting is what the alternative must carry.
                    replied(forced_drafted, 70.0, 18.0),
                ],
                Some(kalsa_tune::Winner {
                    candidate: drafted,
                    reply: reply(60.0, 45.0),
                }),
            )
        },
    );
    let (config, leg_args) = prepared
        .processor
        .as_ref()
        .expect("the processor alternative");
    let argv = config.argv.join(" ");
    assert!(argv.contains("--n-gpu-layers 0"), "the CPU leg: {argv}");
    assert!(
        argv.contains("--n-gpu-layers-draft 0"),
        "its drafter is pinned to the CPU too: {argv}"
    );
    assert!(argv.contains("--spec-draft-n-max 3"), "{argv}");
    assert_eq!(leg_args.draft.as_ref().map(|draft| draft.n_max), Some(3));
    let _ = std::fs::remove_dir_all(&dir);
}
