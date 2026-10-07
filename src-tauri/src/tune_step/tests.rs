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
        mmproj: None,
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

/// The rule's args at `seats` slots holding `total` context — the pair
/// `kalsa_launch::plan` builds, `total` being the per-slot window times the
/// seats.
fn seats(slots: u32, total: u64) -> ServerArgs {
    ServerArgs {
        context_tokens: total,
        parallel: slots,
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
            mmproj: None,
            sizing: None,
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

/// The projector is not a tune parameter, pinned from the walk's own
/// composition: a launch that passes a verified projector and the same
/// launch before the projector arrived answer to the SAME record key, so a
/// kept tune answers the start on which vision turned on — the owner's
/// accept must never cost a re-measure. (The key's inputs are the model
/// digest, the per-slot window, the cores, the engine builds and the
/// drafter digest; `args.mmproj` is read by none of them.)
#[test]
fn a_projector_appearing_does_not_move_the_tune_key() {
    let machine = machine(Backend::Cpu);
    let plain = prepared("/engines/main");
    let mut seeing = prepared("/engines/main");
    seeing.info.args.mmproj = Some(PathBuf::from("/models/mmproj.gguf"));
    let plain_key =
        tune_fingerprint(&machine, &plain.info, ServerBackend::Cpu, CORES).expect("the key composes");
    let seeing_key = tune_fingerprint(&machine, &seeing.info, ServerBackend::Cpu, CORES)
        .expect("the key composes");
    assert_eq!(plain_key, seeing_key);
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

/// The measure's closing report when it ran everything: every candidate
/// counted in, the plan's count, and the candidate that last closed — the
/// shape `passes::tune` ends a full run with.
fn all_done(candidates: usize) -> kalsa_tune::Report {
    kalsa_tune::Report {
        done: candidates,
        total: candidates,
        candidate: candidates,
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
        |_, _, _, _| panic!("a kept record must not measure"),
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

/// The owner's own case: the same machine and model with one seat, then
/// two — a phone paired — is the same tune. The first start measures; the
/// second answers from that record and launches the SECOND plan,
/// `--parallel 2` with the doubled total context, never the first plan's
/// args. The key carries the per-slot window, so a seat count is not a
/// shape.
#[test]
fn a_second_seat_keeps_the_record_and_launches_the_new_plan() {
    let dir = scratch("seats");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut progress = |_: Progress| {};
    let stubbed = || Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };
    let mut one_seat = prepared_with("/main-gpu", seats(1, 8192));
    tune_launch(
        &mut one_seat,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut stubbed(),
        &mut progress,
        |resolved, _, _, counts| {
            counts(all_done(resolved.len()));
            let best = resolved[0].0;
            tuned(
                vec![replied(best, 900.0, 40.0)],
                Some(kalsa_tune::Winner {
                    candidate: best,
                    reply: reply(900.0, 40.0),
                }),
            )
        },
    );
    assert!(
        matches!(one_seat.info.tune, Some(Tune::Measured(_))),
        "the first seat's start measures: {:?}",
        one_seat.info.tune
    );

    // Two seats at the same window each: the total doubles, the key does not.
    let mut two_seats = prepared_with("/main-gpu", seats(2, 16384));
    tune_launch(
        &mut two_seats,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut stubbed(),
        &mut progress,
        |_, _, _, _| panic!("the second seat's start must answer from the record"),
    );
    assert!(
        matches!(two_seats.info.tune, Some(Tune::Measured(_))),
        "the kept record is what the second start shows: {:?}",
        two_seats.info.tune
    );
    assert_eq!(two_seats.info.args.parallel, 2, "the launch is the new plan's");
    assert_eq!(two_seats.info.args.context_tokens, 16384);
    let has = |flag: &str, value: &str| {
        two_seats
            .server
            .argv
            .windows(2)
            .any(|pair| pair[0] == flag && pair[1] == value)
    };
    assert!(
        has("--parallel", "2") && has("--ctx-size", "16384"),
        "the record's winner rides the current plan's own slots and window, \
         never the args it was measured with: {:?}",
        two_seats.server.argv
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// The window itself is still the key's: two seats with HALF the per-slot
/// context is a different shape, and the record does not answer for it.
#[test]
fn a_smaller_per_slot_window_still_misses_the_record() {
    let dir = scratch("narrower");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut progress = |_: Progress| {};
    let stubbed = || Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };
    let mut wide = prepared_with("/main-gpu", seats(2, 16384));
    tune_launch(
        &mut wide,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut stubbed(),
        &mut progress,
        |resolved, _, _, counts| {
            counts(all_done(resolved.len()));
            let best = resolved[0].0;
            tuned(
                vec![replied(best, 900.0, 40.0)],
                Some(kalsa_tune::Winner {
                    candidate: best,
                    reply: reply(900.0, 40.0),
                }),
            )
        },
    );

    let measured = std::cell::Cell::new(false);
    let mut narrower = prepared_with("/main-gpu", seats(2, 8192));
    tune_launch(
        &mut narrower,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut stubbed(),
        &mut progress,
        |resolved, _, _, counts| {
            measured.set(true);
            counts(all_done(resolved.len()));
            let best = resolved[0].0;
            tuned(
                vec![replied(best, 500.0, 20.0)],
                Some(kalsa_tune::Winner {
                    candidate: best,
                    reply: reply(500.0, 20.0),
                }),
            )
        },
    );
    assert!(
        measured.get(),
        "half the per-slot window is another shape: the record must not answer"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A tune where every shape refused: this start saves no verdict — a
/// reusable record of refusals would keep an iGPU start on its rule
/// launch with no processor fallback — only the marker that makes the
/// next start measure once more. The rule stands untouched, and the
/// counts reached the progress callback.
#[test]
fn a_refused_tune_is_not_saved_and_the_rule_stands() {
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
        |resolved, _, _, counts: &mut dyn FnMut(kalsa_tune::Report)| {
            counts(all_done(resolved.len()));
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
        seen.iter().any(|step| matches!(
            step,
            Progress::Tuning {
                done: 3,
                total: 3,
                candidate: 3,
                budget_seconds: kalsa_tune::TOTAL_BUDGET_SECONDS,
                cut: false,
                retry_next: false,
                kept_winner: false,
            }
        )),
        "three lifetimes planned, three done, the last one closed"
    );
    let model = prepared.info.model_sha256.as_deref().unwrap();
    assert!(
        kalsa_tune::record::load(&dir, model, &fingerprint).is_none(),
        "no verdict of refusals is kept: the next start measures again"
    );
    assert!(
        kalsa_tune::record::cut_before(&dir, model, &fingerprint),
        "only the marker, which is what owes the next start one measurement"
    );
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
        |_, _, _, _| panic!("one candidate must not be measured"),
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
        "the per-slot window is part of the key"
    );
    // A seat more with the window each seat keeps is the same shape: the
    // key must not move — pairing a phone is not a reason to measure again.
    let mut two_seats = prepared("/main-gpu").info;
    two_seats.args.parallel = 2;
    two_seats.args.context_tokens *= 2;
    assert_eq!(
        tune_fingerprint(&machine, &two_seats, ServerBackend::Vulkan, CORES)
            .expect("this walk has a platform and a digest"),
        base,
        "a seat count does not move the key"
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
        |resolved, rule, _, counts| {
            counts(all_done(resolved.len()));
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

/// A pass-one cut is an unfinished verdict, not a lost one: this start's
/// winner of what ran still launches and the file is only a marker
/// `load` refuses — the next start, cut the same way, saves what exists
/// instead of measuring on every start forever — and the start after
/// that answers from the record without measuring at all.
#[test]
fn a_pass_one_cut_is_withheld_once_and_saved_the_second_time() {
    let dir = scratch("pass-one-cut");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut first = prepared("/main-gpu");
    let digest = first.info.model_sha256.as_deref().unwrap().to_string();
    let fingerprint = tune_fingerprint(&machine, &first.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };
    let mut progress = |_: Progress| {};
    // The seam's answer when the budget stops pass one: two of the three
    // shapes answered, the last never began.
    fn cut_first(
        resolved: &[(kalsa_tune::Candidate, PathBuf)],
        _: &ServerArgs,
        _: &[(kalsa_tune::Candidate, kalsa_tune::record::Kept)],
        counts: &mut dyn FnMut(kalsa_tune::Report),
    ) -> kalsa_tune::Tuned {
        counts(all_done(resolved.len()));
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
    }
    // The first cut: the winner of what ran (the third candidate, 10
    // threads) launches; the file is only a marker.
    tune_launch(
        &mut first,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        cut_first,
    );
    assert_eq!(
        first.info.args.threads,
        Some(10),
        "this start's winner is applied"
    );
    assert!(
        matches!(first.info.tune, Some(Tune::Measured(_))),
        "the line shows what ran: {:?}",
        first.info.tune
    );
    assert!(
        kalsa_tune::record::load(&dir, &digest, &fingerprint).is_none(),
        "a pass-one cut is not a verdict yet"
    );
    assert!(
        kalsa_tune::record::cut_before(&dir, &digest, &fingerprint),
        "the marker says the next start measures once more"
    );
    // The second cut: both attempts measured the same two launches, so
    // the retry's fresher numbers stand and `reply_winner` picks over the
    // union — the faster 25.8 s reply, not the first start's input.
    let mut again = prepared("/main-gpu");
    tune_launch(
        &mut again,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        cut_first,
    );
    let saved = kalsa_tune::record::load(&dir, &digest, &fingerprint)
        .expect("a second pass-one cut saves what exists instead of re-tuning forever");
    assert_eq!(
        saved.winner.map(|win| win.reply.seconds),
        Some(reply(60.0, 30.0).seconds),
        "the pooled verdict is the same rule's pick: the faster reply"
    );
    let pooled_threads = saved.winner.as_ref().and_then(|win| win.candidate.threads);
    assert_eq!(
        again.info.args.threads, pooled_threads,
        "the second start launches the pooled winner"
    );
    assert!(!kalsa_tune::record::cut_before(&dir, &digest, &fingerprint));
    // The third start: the record answers, nothing measures.
    let mut third = prepared("/main-gpu");
    tune_launch(
        &mut third,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |_, _, _, _| panic!("the saved record answers; nothing measures"),
    );
    assert_eq!(third.info.args.threads, pooled_threads);
    assert!(
        matches!(third.info.tune, Some(Tune::Measured(_))),
        "kept: {:?}",
        third.info.tune
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// An all-refused tune is retried once and then stands: the first start
/// measures, keeps only the marker and runs the rule; the second
/// measures again and saves the no-winner record; the third goes
/// straight to the rule without measuring anything.
#[test]
fn an_all_refused_tune_is_retried_once_and_then_stands() {
    let dir = scratch("all-refused");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut first = prepared("/main-gpu");
    let digest = first.info.model_sha256.as_deref().unwrap().to_string();
    let fingerprint = tune_fingerprint(&machine, &first.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };
    let mut progress = |_: Progress| {};
    fn refused_tune(
        resolved: &[(kalsa_tune::Candidate, PathBuf)],
        _: &ServerArgs,
        _: &[(kalsa_tune::Candidate, kalsa_tune::record::Kept)],
        counts: &mut dyn FnMut(kalsa_tune::Report),
    ) -> kalsa_tune::Tuned {
        counts(all_done(resolved.len()));
        tuned(
            resolved
                .iter()
                .map(|(candidate, _)| refused(*candidate, kalsa_tune::Refusal::NotReady))
                .collect(),
            None,
        )
    }
    // First: nothing replied, so nothing is a verdict — only the marker.
    tune_launch(
        &mut first,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        refused_tune,
    );
    assert!(
        matches!(first.info.tune, Some(Tune::NoWinner(_))),
        "the rule stands: {:?}",
        first.info.tune
    );
    assert!(
        kalsa_tune::record::load(&dir, &digest, &fingerprint).is_none(),
        "an all-refused tune is not a verdict yet"
    );
    assert!(
        kalsa_tune::record::cut_before(&dir, &digest, &fingerprint),
        "the marker says the next start measures once more"
    );
    // The second refusal: the no-winner record stands.
    let mut again = prepared("/main-gpu");
    tune_launch(
        &mut again,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        refused_tune,
    );
    let saved = kalsa_tune::record::load(&dir, &digest, &fingerprint)
        .expect("a second all-refused tune is saved instead of re-tuning forever");
    assert!(saved.winner.is_none(), "a no-winner record: {saved:?}");
    assert!(!kalsa_tune::record::cut_before(&dir, &digest, &fingerprint));
    // The third start: straight to the rule, nothing measured.
    let mut third = prepared("/main-gpu");
    tune_launch(
        &mut third,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |_, _, _, _| panic!("the saved no-winner record answers; nothing measures"),
    );
    assert!(
        matches!(third.info.tune, Some(Tune::NoWinner(_))),
        "kept: {:?}",
        third.info.tune
    );
    assert_eq!(
        third.server.exe,
        PathBuf::from("/main-gpu"),
        "the rule's own launch"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A candidate build that cannot be resolved drops its shapes — and is
/// still an unfinished verdict: the first start withholds it as the marker
/// `load` refuses, the second saves what ran (the memo remembers the
/// failure, so it is not retried per candidate), and the third reads the
/// record instead of measuring again. A persistently missing build must
/// spend the budget once, not on every start.
#[test]
fn a_dropped_candidate_is_withheld_once_and_saved_the_second_time() {
    let dir = scratch("unresolvable");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut first = prepared("/main-gpu");
    let digest = first.info.model_sha256.as_deref().unwrap().to_string();
    let fingerprint = tune_fingerprint(&machine, &first.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Err(crate::failure::StartupFailure::NoBuildForThisMachine)),
    };
    let mut seen: Vec<Progress> = Vec::new();
    let mut progress = |step: Progress| seen.push(step);
    // One shape resolves (the memo has the processor failure), two are
    // dropped — every start.
    fn dropped(
        resolved: &[(kalsa_tune::Candidate, PathBuf)],
        _: &ServerArgs,
        _: &[(kalsa_tune::Candidate, kalsa_tune::record::Kept)],
        counts: &mut dyn FnMut(kalsa_tune::Report),
    ) -> kalsa_tune::Tuned {
        counts(all_done(resolved.len()));
        assert_eq!(resolved.len(), 1, "the processor candidates were dropped");
        let only = resolved[0].0;
        tuned(
            vec![replied(only, 60.0, 30.0)],
            Some(kalsa_tune::Winner {
                candidate: only,
                reply: reply(60.0, 30.0),
            }),
        )
    }
    tune_launch(
        &mut first,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        dropped,
    );
    // One shape ran, two candidates exist: a hole — and a marker, so the
    // hole gets exactly one more measurement instead of every start's.
    // (The progress walk is asserted after the last start, while the
    // `progress` closure is still borrowed.)
    assert!(
        matches!(first.info.tune, Some(Tune::Measured(_))),
        "what ran launches: {:?}",
        first.info.tune
    );
    assert!(
        kalsa_tune::record::load(&dir, &digest, &fingerprint).is_none(),
        "a dropped shape's tune is not a verdict yet"
    );
    assert!(
        kalsa_tune::record::cut_before(&dir, &digest, &fingerprint),
        "the marker owes the next start one measurement"
    );
    // The second start, the build still missing: what ran is saved.
    let mut again = prepared("/main-gpu");
    tune_launch(
        &mut again,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        dropped,
    );
    let saved = kalsa_tune::record::load(&dir, &digest, &fingerprint)
        .expect("a persistently missing build must not re-tune forever");
    assert!(saved.winner.is_some(), "what ran is the verdict: {saved:?}");
    assert_eq!(saved.trials.len(), 1, "one shape measured: {saved:?}");
    assert_eq!(
        again.info.args.threads,
        first.info.args.threads,
        "the same winner launches"
    );
    // The third start: the record answers, nothing measures.
    let mut third = prepared("/main-gpu");
    tune_launch(
        &mut third,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |_, _, _, _| panic!("the saved record answers; nothing measures"),
    );
    assert!(
        matches!(third.info.tune, Some(Tune::Measured(_))),
        "kept: {:?}",
        third.info.tune
    );
    assert_eq!(third.info.args.threads, first.info.args.threads);
    assert!(
        seen.iter().any(|step| matches!(
            step,
            Progress::Tuning {
                done: 1,
                total: 1,
                candidate: 1,
                budget_seconds: kalsa_tune::TOTAL_BUDGET_SECONDS,
                cut: false,
                retry_next: false,
                kept_winner: false,
            }
        )),
        "the processor candidates never ran"
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
        |resolved, _, _, counts| {
            measured.set(measured.get() + 1);
            counts(all_done(resolved.len()));
            // Complete: every candidate ran and the first replied, so the
            // result may be saved.
            let first = resolved[0].0;
            let mut trials = vec![replied(first, 1000.0, 50.0)];
            trials.extend(
                resolved[1..]
                    .iter()
                    .map(|(candidate, _)| refused(*candidate, kalsa_tune::Refusal::NotReady)),
            );
            tuned(
                trials,
                Some(kalsa_tune::Winner {
                    candidate: first,
                    reply: reply(1000.0, 50.0),
                }),
            )
        },
    );

    assert_eq!(
        measured.get(),
        1,
        "the refused record leads to a fresh measure"
    );
    assert!(
        matches!(prepared.info.tune, Some(Tune::Measured(_))),
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
        |_, _, _, _| panic!("the measure exploded"),
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
/// and one name on both sides is the whole point of the field. `candidate`
/// is the page's third number, carried whole — the index is the one thing
/// its "Test 2 of 4" line cannot get from the counts.
#[test]
fn the_tuning_step_serialises_the_total_the_page_reads() {
    let json = serde_json::to_value(Progress::Tuning {
        done: 1,
        total: 2,
        candidate: 2,
        budget_seconds: kalsa_tune::TOTAL_BUDGET_SECONDS,
        cut: false,
        retry_next: false,
        kept_winner: false,
    })
    .expect("serialise");
    assert_eq!(json["kind"], "tuning");
    assert_eq!(json["total"], 2);
    assert_eq!(json["candidate"], 2, "the index the page names arrives whole");
    assert_eq!(
        json["budget_seconds"], 1080,
        "the budget the page counts its wait down from, whole seconds"
    );
    assert_eq!(json["cut"], false, "and the stop marker rides along");
    assert_eq!(json["retry_next"], false, "with whether it owes the next start");
    assert_eq!(json["kept_winner"], false, "and with what, if anything, was kept");
    assert!(
        json.get("planned").is_none(),
        "the old name must not appear"
    );
}

/// The walk's words are built from the tune's reports and nothing else, so
/// the step passes each one through with its index and total untouched: a
/// start (the candidate about to run, `done` one behind) and a close
/// (`done` counting it in) for every candidate, in the order they happened.
#[test]
fn the_tune_passes_a_start_and_a_close_for_every_candidate_to_the_walk() {
    let dir = scratch("reports");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = prepared("/main-gpu");
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
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
        |resolved, _, _, counts| {
            // The production seam's shape, candidate by candidate: the
            // start report, then the close that answers it.
            for index in 0..resolved.len() {
                counts(kalsa_tune::Report {
                    done: index,
                    total: resolved.len(),
                    candidate: index + 1,
                    cut: false,
                });
                counts(kalsa_tune::Report {
                    done: index + 1,
                    total: resolved.len(),
                    candidate: index + 1,
                    cut: false,
                });
            }
            counts(all_done(resolved.len()));
            tuned(vec![], None)
        },
    );
    let reports: Vec<(usize, usize, usize, bool)> = seen
        .iter()
        .filter_map(|step| match step {
            Progress::Tuning {
                done,
                total,
                candidate,
                cut,
                ..
            } => Some((*done, *total, *candidate, *cut)),
            _ => None,
        })
        .collect();
    let candidates = 3; // the fixture's list: graphics, 16 threads, 22
    assert_eq!(
        reports,
        vec![
            (0, 3, 1, false),
            (1, 3, 1, false),
            (1, 3, 2, false),
            (2, 3, 2, false),
            (2, 3, 3, false),
            (3, 3, 3, false),
            (3, 3, 3, false),
        ],
        "a start and a close per candidate, index and total intact: {reports:?}"
    );
    assert_eq!(reports.len(), 2 * candidates + 1, "and nothing else");
    let _ = std::fs::remove_dir_all(&dir);
}

/// The stop rides the same wire as the counts: a measure whose plan was
/// cut short must reach the walk with its marker, because the page reads
/// `cut` to hold the bar where the tune really stopped instead of playing
/// the finish it did not earn — the record keeps the same stop as an
/// unfinished marker to retry next start (see `tune_launch`'s `unfinished`).
#[test]
fn the_cut_report_reaches_the_walk_untouched() {
    let dir = scratch("cut-report");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = prepared("/main-gpu");
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
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
        |_, _, _, counts| {
            // One candidate measured, then the budget: the plan still
            // names the two it owes.
            counts(kalsa_tune::Report {
                done: 0,
                total: 3,
                candidate: 1,
                cut: false,
            });
            counts(kalsa_tune::Report {
                done: 1,
                total: 3,
                candidate: 1,
                cut: false,
            });
            counts(kalsa_tune::Report {
                done: 1,
                total: 3,
                candidate: 1,
                cut: true,
            });
            counts(all_done(1));
            tuned(vec![], None)
        },
    );
    let reports: Vec<(usize, usize, usize, bool)> = seen
        .iter()
        .filter_map(|step| match step {
            Progress::Tuning {
                done,
                total,
                candidate,
                cut,
                ..
            } => Some((*done, *total, *candidate, *cut)),
            _ => None,
        })
        .collect();
    assert_eq!(
        reports,
        vec![
            (0, 3, 1, false),
            (1, 3, 1, false),
            (1, 3, 1, true),
            (1, 1, 1, false),
            // …and the stop's final word, emitted after the write.
            (1, 3, 1, true),
        ],
        "the stop arrives with its marker, the plan and the candidate: {reports:?}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// Both stops' flags, on the wire the page reads: the FIRST cut still owes
/// the next start its measurement — no marker on disk yet, so one will be
/// written and the page may promise the rest. The SECOND cut IS the retry
/// that marker was owed: its verdict pools and saves as a normal record,
/// nothing further will be measured, and the page must say what it kept
/// instead of promising a measurement that will never come.
#[test]
fn both_cuts_report_whether_the_next_start_is_still_owed_a_measurement() {
    let dir = scratch("cut-flags");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = prepared("/main-gpu");
    let fingerprint = tune_fingerprint(&machine, &prepared.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let model = prepared.info.model_sha256.as_deref().unwrap().to_string();
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };
    let mut progress = |_: Progress| {};

    // One candidate measured, then the budget — every run of this test.
    fn cut_measure(
        resolved: &[(kalsa_tune::Candidate, PathBuf)],
        _: &ServerArgs,
        _: &[(kalsa_tune::Candidate, kalsa_tune::record::Kept)],
        counts: &mut dyn FnMut(kalsa_tune::Report),
    ) -> kalsa_tune::Tuned {
        counts(kalsa_tune::Report {
            done: 1,
            total: 3,
            candidate: 1,
            cut: false,
        });
        counts(kalsa_tune::Report {
            done: 1,
            total: 3,
            candidate: 1,
            cut: true,
        });
        // One measured candidate: a record without trials cannot be
        // written at all, and the marker the first stop owes IS a record.
        tuned(vec![replied(resolved[0].0, 60.0, 30.0)], None)
    }
    // The stop's final word: the LAST cut report the walk saw — the one
    // emitted after the write, carrying the flags the page's line reads
    // (retry_next, kept_winner).
    let stop_word = |seen: &[Progress]| -> Option<(bool, bool)> {
        seen
            .iter()
            .filter_map(|step| match step {
                Progress::Tuning {
                    cut: true,
                    retry_next,
                    kept_winner,
                    ..
                } => Some((*retry_next, *kept_winner)),
                _ => None,
            })
            .last()
    };

    let seen = std::cell::RefCell::new(Vec::new());
    let mut collect = |step: Progress| seen.borrow_mut().push(step);
    // The first stop: nothing on disk yet, so a marker will be written.
    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut collect,
        cut_measure,
    );
    assert_eq!(
        stop_word(&seen.borrow()),
        Some((true, false)),
        "the first stop owes the next start its measurement, and kept no winner of its own"
    );
    assert!(
        kalsa_tune::record::cut_before(&dir, &model, &fingerprint),
        "and the marker it owes is on disk for the next start"
    );

    // The second stop: this start IS that retry, so its verdict saves as a
    // record — nothing is owed anymore.
    seen.borrow_mut().clear();
    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut collect,
        cut_measure,
    );
    assert_eq!(
        stop_word(&seen.borrow()),
        Some((false, true)),
        "the second stop owes nothing, and its pooled retry kept a winner"
    );
    assert!(
        !kalsa_tune::record::cut_before(&dir, &model, &fingerprint),
        "and no marker is left behind to promise a third measurement"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// The retry's own input: the marker's trials travel into the measure as
/// the prior — what the first attempt proved measured, so its plan skips
/// those lifetimes — while a first start, with no marker on disk for this
/// fingerprint, hands the seam nothing to skip.
#[test]
fn the_measure_receives_the_markers_trials_as_the_prior() {
    let dir = scratch("prior");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut first = prepared("/main-gpu");
    let digest = first.info.model_sha256.as_deref().unwrap().to_string();
    let fingerprint = tune_fingerprint(&machine, &first.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };
    let mut progress = |_: Progress| {};
    // The first attempt measures one launch, then the budget cuts it: the
    // withheld marker holds that one trial.
    tune_launch(
        &mut first,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |resolved, _, _, counts| {
            counts(all_done(resolved.len()));
            let mut measured = tuned(vec![replied(resolved[0].0, 60.0, 30.0)], None);
            measured.cut = true;
            measured
        },
    );
    let expected = kalsa_tune::record::cut_marker(&dir, &digest, &fingerprint)
        .expect("the first attempt was withheld as a marker")
        .trials;
    assert!(!expected.is_empty(), "the marker carries what it measured");
    // The retry: the seam receives exactly those trials to skip.
    let handed = std::cell::RefCell::new(Vec::new());
    let mut again = prepared("/main-gpu");
    tune_launch(
        &mut again,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |resolved, _, prior, counts| {
            *handed.borrow_mut() = prior.to_vec();
            counts(all_done(resolved.len()));
            let best = resolved[0].0;
            tuned(
                vec![replied(best, 60.0, 30.0)],
                Some(kalsa_tune::Winner {
                    candidate: best,
                    reply: reply(60.0, 30.0),
                }),
            )
        },
    );
    assert_eq!(
        *handed.borrow(),
        expected,
        "the retry skips exactly what the marker proved measured"
    );
    // A first start, no marker anywhere: nothing to skip.
    let fresh = scratch("prior-none");
    let fresh_handed = std::cell::Cell::new(true);
    let mut start = prepared("/main-gpu");
    tune_launch(
        &mut start,
        &machine,
        &fresh,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |resolved, _, prior, counts| {
            fresh_handed.set(prior.is_empty());
            counts(all_done(resolved.len()));
            let best = resolved[0].0;
            tuned(
                vec![replied(best, 60.0, 30.0)],
                Some(kalsa_tune::Winner {
                    candidate: best,
                    reply: reply(60.0, 30.0),
                }),
            )
        },
    );
    assert!(
        fresh_handed.get(),
        "a first tune hands the seam nothing to skip"
    );
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&fresh);
}

/// The pool obeys the same filter as the seam: a marker can hold a
/// launch this start's candidate list no longer runs (the plan's thread
/// count is not part of the fingerprint), and its reply — the fastest
/// in the file — must not re-enter the saved record through either door,
/// let alone win there.
#[test]
fn the_pool_restores_only_the_entries_the_plan_keeps() {
    let dir = scratch("pool-filter");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut first = prepared("/main-gpu");
    let digest = first.info.model_sha256.as_deref().unwrap().to_string();
    let fingerprint = tune_fingerprint(&machine, &first.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };
    let mut progress = |_: Progress| {};
    // A launch outside this candidate list — the plan's thread count
    // moved under the same fingerprint — measured by the first attempt.
    let stale = kalsa_tune::Candidate {
        backend: ServerBackend::Cpu,
        threads: Some(6),
        offload: Offload::NoGpuBuild,
        draft: None,
    };
    tune_launch(
        &mut first,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |resolved, _, _, counts| {
            counts(all_done(resolved.len()));
            let mut measured = tuned(
                vec![
                    replied(resolved[0].0, 60.0, 30.0),
                    replied(stale, 2000.0, 100.0),
                ],
                None,
            );
            measured.cut = true;
            measured
        },
    );
    assert!(
        kalsa_tune::record::cut_before(&dir, &digest, &fingerprint),
        "the first attempt was withheld as a marker"
    );
    // The retry: the seam's prior is the filtered set, and so is the
    // pool's — asserted after the closure, where no catch_unwind can
    // swallow the failure.
    let handed = std::cell::RefCell::new(Vec::new());
    let mut again = prepared("/main-gpu");
    tune_launch(
        &mut again,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        |resolved, _, prior, counts| {
            *handed.borrow_mut() = prior.to_vec();
            counts(all_done(resolved.len()));
            let best = resolved[0].0;
            tuned(
                vec![replied(best, 90.0, 20.0)],
                Some(kalsa_tune::Winner {
                    candidate: best,
                    reply: reply(90.0, 20.0),
                }),
            )
        },
    );
    assert!(
        !handed
            .borrow()
            .iter()
            .any(|(candidate, _)| candidate.threads == Some(6)),
        "the seam's prior is the plan's filter too: {:?}",
        handed.borrow()
    );
    let saved = kalsa_tune::record::load(&dir, &digest, &fingerprint)
        .expect("the retry's verdict is saved");
    assert!(
        !saved
            .trials
            .iter()
            .any(|(candidate, _)| candidate.threads == Some(6)),
        "the stale launch never re-enters the record: {:?}",
        saved.trials
    );
    assert_eq!(
        saved.trials.len(),
        1,
        "both attempts measured the same launch; the fresher stands: {:?}",
        saved.trials
    );
    assert_eq!(
        saved.winner.map(|win| win.candidate.threads),
        Some(Some(8)),
        "the pool chose over the filtered union, never the stale reply: {:?}",
        saved.winner
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// The stop's promise is only as good as the write behind it: a verdict the
/// record cannot carry — here no trials at all, which `save_marker` refuses
/// — writes nothing, so nothing is owed to the next start, and with no
/// winner there is nothing this run kept either. The walk sees both words:
/// the hope during the measure, the disk's answer after the failed write.
#[test]
fn a_stop_whose_marker_cannot_be_written_promises_nothing_and_keeps_nothing() {
    let dir = scratch("cut-unwritten");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = prepared("/main-gpu");
    let fingerprint = tune_fingerprint(&machine, &prepared.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let model = prepared.info.model_sha256.as_deref().unwrap().to_string();
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };

    fn unsaveable_measure(
        _: &[(kalsa_tune::Candidate, PathBuf)],
        _: &ServerArgs,
        _: &[(kalsa_tune::Candidate, kalsa_tune::record::Kept)],
        counts: &mut dyn FnMut(kalsa_tune::Report),
    ) -> kalsa_tune::Tuned {
        counts(kalsa_tune::Report {
            done: 1,
            total: 3,
            candidate: 1,
            cut: true,
        });
        // A record without trials is refused by `validate`, so the marker
        // write fails — this test's stand-in for any failed write.
        tuned(vec![], None)
    }

    let seen = std::cell::RefCell::new(Vec::new());
    let mut collect = |step: Progress| seen.borrow_mut().push(step);
    tune_launch(
        &mut prepared,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut collect,
        unsaveable_measure,
    );
    let words: Vec<(bool, bool)> = seen
        .borrow()
        .iter()
        .filter_map(|step| match step {
            Progress::Tuning {
                cut: true,
                retry_next,
                kept_winner,
                ..
            } => Some((*retry_next, *kept_winner)),
            _ => None,
        })
        .collect();
    assert_eq!(
        words,
        vec![(true, false), (false, false)],
        "the measure hopes, the disk answers: no marker written, no winner kept"
    );
    assert!(
        !kalsa_tune::record::cut_before(&dir, &model, &fingerprint),
        "and no marker was left behind to lie with"
    );
    let _ = std::fs::remove_dir_all(&dir);
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
        |resolved, rule, _, counts| {
            passes.set(passes.get() + 1);
            counts(all_done(resolved.len()));
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
        |_, _, _, _| panic!("a kept record must not measure"),
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
        |resolved, _, _, counts| {
            counts(all_done(resolved.len()));
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
        |_, _, _, _| panic!("a kept record must not measure"),
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
        |resolved, rule, _, counts| {
            passes.set(passes.get() + 1);
            counts(all_done(resolved.len()));
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
        |resolved, _, _, counts| {
            counts(all_done(resolved.len()));
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
        _: &[(kalsa_tune::Candidate, kalsa_tune::record::Kept)],
        counts: &mut dyn FnMut(kalsa_tune::Report),
    ) -> kalsa_tune::Tuned {
        counts(all_done(resolved.len()));
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
        |_, _, _, _| panic!("a kept record must not measure"),
    );
    assert!(third.server.argv.join(" ").contains("--spec-draft-n-max 2"));
    let _ = std::fs::remove_dir_all(&dir);
}

/// A retry that measures nothing must not erase what the first attempt
/// measured: the cut marker's winner is kept — saved as the verdict and
/// launched on THIS start — where a fresh record of refusals would have
/// replaced it.
#[test]
fn a_retry_that_refuses_everything_keeps_the_first_attempts_winner() {
    let dir = scratch("retry-keeps-winner");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut first = prepared("/main-gpu");
    let digest = first.info.model_sha256.as_deref().unwrap().to_string();
    let fingerprint = tune_fingerprint(&machine, &first.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };
    let mut progress = |_: Progress| {};
    // The first attempt measures a winner, then the budget cuts its sweep.
    fn cut_with_winner(
        resolved: &[(kalsa_tune::Candidate, PathBuf)],
        _: &ServerArgs,
        _: &[(kalsa_tune::Candidate, kalsa_tune::record::Kept)],
        counts: &mut dyn FnMut(kalsa_tune::Report),
    ) -> kalsa_tune::Tuned {
        counts(all_done(resolved.len()));
        let best = resolved[0].0;
        let mut measured = tuned(
            vec![replied(best, 60.0, 30.0)],
            Some(kalsa_tune::Winner {
                candidate: best,
                reply: reply(60.0, 30.0),
            }),
        );
        measured.cut = true;
        measured
    }
    // The retry: every shape refuses — no winner of its own.
    fn refuses_all(
        resolved: &[(kalsa_tune::Candidate, PathBuf)],
        _: &ServerArgs,
        _: &[(kalsa_tune::Candidate, kalsa_tune::record::Kept)],
        counts: &mut dyn FnMut(kalsa_tune::Report),
    ) -> kalsa_tune::Tuned {
        counts(all_done(resolved.len()));
        tuned(
            resolved
                .iter()
                .map(|(candidate, _)| refused(*candidate, kalsa_tune::Refusal::NotReady))
                .collect(),
            None,
        )
    }
    tune_launch(
        &mut first,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        cut_with_winner,
    );
    let winner_threads = first.info.args.threads;
    assert!(
        matches!(first.info.tune, Some(Tune::Measured(_))),
        "the measured winner launches: {:?}",
        first.info.tune
    );
    assert!(
        kalsa_tune::record::load(&dir, &digest, &fingerprint).is_none(),
        "the cut is a marker, not a verdict"
    );
    assert!(kalsa_tune::record::cut_before(&dir, &digest, &fingerprint));
    // Without the marker's trials the save below would replace the good
    // winner with refusals — the whole point of reading it back.
    let mut again = prepared("/main-gpu");
    tune_launch(
        &mut again,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        refuses_all,
    );
    let saved = kalsa_tune::record::load(&dir, &digest, &fingerprint)
        .expect("the second unfinished verdict is saved");
    assert_eq!(
        saved.winner.map(|win| win.candidate.threads),
        Some(winner_threads),
        "the first attempt's winner survives the refusing retry: {saved:?}"
    );
    assert!(
        saved.trials.len() == 3,
        "the pool is both attempts' facts — the marker's measurement and the retry's own: {saved:?}"
    );
    assert!(
        saved
            .trials
            .iter()
            .any(|(_, kept)| matches!(kept, kalsa_tune::record::Kept::Replied(_))),
        "the marker's measured trial stands: {saved:?}"
    );
    assert_eq!(
        again.info.args.threads, winner_threads,
        "and this start launches it"
    );
    assert!(
        matches!(again.info.tune, Some(Tune::Measured(_))),
        "kept: {:?}",
        again.info.tune
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// The better of the two attempts wins under the same rule that picks any
/// winner: a first attempt cut with a fast reply, then a retry that
/// finishes with a slower one — the pooled trials go back through
/// `reply_winner`, the fast reply stands, and this start launches it.
#[test]
fn a_slower_retry_cannot_erase_the_first_attempts_faster_winner() {
    let dir = scratch("slower-retry");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut first = prepared("/main-gpu");
    let digest = first.info.model_sha256.as_deref().unwrap().to_string();
    let fingerprint = tune_fingerprint(&machine, &first.info, ServerBackend::Vulkan, CORES)
        .expect("this walk has a platform and a digest");
    let mut memo = Memo {
        cores: CORES,
        processor: Some(Ok(PathBuf::from("/stub-cpu"))),
    };
    let mut progress = |_: Progress| {};
    // The first attempt: one fast reply, then the budget cuts its sweep.
    fn fast_then_cut(
        resolved: &[(kalsa_tune::Candidate, PathBuf)],
        _: &ServerArgs,
        _: &[(kalsa_tune::Candidate, kalsa_tune::record::Kept)],
        counts: &mut dyn FnMut(kalsa_tune::Report),
    ) -> kalsa_tune::Tuned {
        counts(all_done(resolved.len()));
        let fast = resolved[0].0;
        let mut measured = tuned(
            vec![replied(fast, 1000.0, 100.0)],
            Some(kalsa_tune::Winner {
                candidate: fast,
                reply: reply(1000.0, 100.0),
            }),
        );
        measured.cut = true;
        measured
    }
    // The retry: another shape answers, at a third of the speed — a winner,
    // but the worse one.
    fn slower_winner(
        resolved: &[(kalsa_tune::Candidate, PathBuf)],
        _: &ServerArgs,
        _: &[(kalsa_tune::Candidate, kalsa_tune::record::Kept)],
        counts: &mut dyn FnMut(kalsa_tune::Report),
    ) -> kalsa_tune::Tuned {
        counts(all_done(resolved.len()));
        let slower = resolved[1].0;
        tuned(
            vec![replied(slower, 100.0, 10.0)],
            Some(kalsa_tune::Winner {
                candidate: slower,
                reply: reply(100.0, 10.0),
            }),
        )
    }
    tune_launch(
        &mut first,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        fast_then_cut,
    );
    let first_winner = match &first.info.tune {
        Some(Tune::Measured(record)) => record.winner.expect("the first attempt had a winner"),
        other => panic!("the first start measured: {other:?}"),
    };
    assert!(
        kalsa_tune::record::load(&dir, &digest, &fingerprint).is_none(),
        "the cut is a marker, not a verdict"
    );
    let mut again = prepared("/main-gpu");
    tune_launch(
        &mut again,
        &machine,
        &dir,
        (ServerBackend::Vulkan, PathBuf::from("/main-gpu")),
        &mut memo,
        &mut progress,
        slower_winner,
    );
    let saved = kalsa_tune::record::load(&dir, &digest, &fingerprint)
        .expect("the retry's pooled verdict is saved");
    assert_eq!(
        saved.winner,
        Some(first_winner),
        "the faster first attempt stands over the slower retry: {saved:?}"
    );
    assert_eq!(
        saved.trials.len(),
        2,
        "the union of both attempts: {saved:?}"
    );
    match &again.info.tune {
        Some(Tune::Measured(record)) => {
            assert_eq!(
                record.winner,
                Some(first_winner),
                "and this start launches it"
            );
        }
        other => panic!("the retry kept a verdict: {other:?}"),
    }
    let _ = std::fs::remove_dir_all(&dir);
}

/// The winner's build must be launchable: when the processor build refuses
/// (so its shapes were dropped) and the seam still answers for one of
/// them, no verdict is kept — only the marker — so the next start measures
/// once more instead of reusing a record whose winner nobody can launch.
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
        |resolved, _, _, counts| {
            counts(all_done(resolved.len()));
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
        |resolved, _, _, counts| {
            counts(all_done(resolved.len()));
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

/// The Surface's shape: Vulkan on an integrated GPU measures the mixed
/// shape (the graphics build, no layer offloaded) beside the full offload
/// and the processor build. When the mixed shape wins, the launch is the
/// graphics build with `--n-gpu-layers 0` — and the processor build is still
/// prepared as the fallback, taken from the CPU shape's trial, never from
/// the mixed shape's own (which is the same graphics build).
#[test]
fn an_integrated_gpu_measures_the_mixed_shape_and_keeps_a_processor_fallback() {
    let dir = scratch("mixed-shape");
    let machine = machine(Backend::Cpu);
    let mut prepared = prepared_with("/main-gpu", rule_args());
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
        |resolved, _, _, counts| {
            counts(all_done(resolved.len()));
            let by = |offload: Offload| {
                resolved
                    .iter()
                    .map(|(candidate, _)| *candidate)
                    .find(|candidate| candidate.offload == offload)
                    .unwrap_or_else(|| panic!("no {offload:?} shape in {resolved:?}"))
            };
            let full = by(Offload::EngineFitted);
            let mixed = by(Offload::ForcedOff);
            let cpu = by(Offload::NoGpuBuild);
            assert_eq!(mixed.backend, ServerBackend::Vulkan, "the same build");
            assert_eq!(mixed.threads, full.threads);
            tuned(
                vec![
                    replied(full, 64.4, 5.3),
                    replied(mixed, 41.8, 9.9),
                    replied(cpu, 22.7, 13.3),
                ],
                Some(kalsa_tune::Winner {
                    candidate: mixed,
                    reply: reply(41.8, 9.9),
                }),
            )
        },
    );
    assert_eq!(prepared.server.exe, PathBuf::from("/main-gpu"));
    assert!(
        prepared.server.argv.join(" ").contains("--n-gpu-layers 0"),
        "the winner is the mixed launch: {:?}",
        prepared.server.argv
    );
    let (fallback, _) = prepared.processor.as_ref().expect("a processor fallback");
    assert_eq!(fallback.exe, PathBuf::from("/stub-cpu"), "the CPU build");
    assert!(
        !fallback.argv.join(" ").contains("--n-gpu-layers"),
        "and the CPU shape's own launch: {:?}",
        fallback.argv
    );
    let line = tune_line(prepared.info.tune.as_ref().expect("the tune ran"));
    assert!(line.starts_with("graphics + processor "), "{line}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// A dedicated card has its own memory: no mixed shape is offered there.
#[test]
fn a_dedicated_gpu_is_not_offered_the_mixed_shape() {
    let dir = scratch("no-mixed-shape");
    let machine = machine(Backend::DiscreteGpu {
        vram_bytes: Some(6_439_305_216),
    });
    let mut prepared = prepared_with("/main-gpu", rule_args());
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
        |resolved, _, _, counts| {
            counts(all_done(resolved.len()));
            assert!(
                resolved
                    .iter()
                    .all(|(candidate, _)| candidate.offload != Offload::ForcedOff),
                "{resolved:?}"
            );
            tuned(vec![], None)
        },
    );
    let _ = std::fs::remove_dir_all(&dir);
}
