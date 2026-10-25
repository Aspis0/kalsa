//! The start command a small machine gets (lighter window, no prompt cache),
//! and the one an 8 GiB-plus machine keeps: argv pinned on both sides of the line.

use std::path::PathBuf;

use kalsa_catalog::choice::{chooser_context_tokens, is_small_machine, SMALL_MACHINE_CONTEXT_TOKENS};
use kalsa_catalog::footprint::{memory_budget, GIB};
use kalsa_catalog::{largest_that_runs_well, Backend, ChoiceInput, ModelEntry};
use kalsa_launch::{funded_maximum, plan, KvCache, LaunchInput, LaunchPlan, PromptCache};
use kalsa_runtime::ServerBackend;

/// The pick the app makes for this machine, priced at the window the app prices at.
fn pick(backend: Backend, ram_bytes: u64) -> &'static ModelEntry {
    largest_that_runs_well(&ChoiceInput {
        backend,
        ram_bytes,
        bandwidth_bytes_per_second: 100.0e9,
        bandwidth_is_lower_bound: false,
        compute_flops_per_second: 2.0e12,
        context_tokens: chooser_context_tokens(ram_bytes),
        phone: None,
    })
    .expect("the machine runs a model")
    .entry
}

/// The input the app builds: the small window (when the owner set none) and
/// no prompt cache exactly on the small side of the line.
fn app_input<'a>(
    (backend, server): (Backend, ServerBackend),
    model: &'a ModelEntry,
    ram_gib: u64,
    ramp: &'a [(usize, f64)],
    prompt_cache: PromptCache,
) -> LaunchInput<'a> {
    let small = is_small_machine(ram_gib * GIB);
    LaunchInput {
        backend: server,
        model,
        budget: memory_budget(backend, ram_gib * GIB),
        drafter_bytes: 0,
        mmproj_bytes: 0,
        thread_ramp: ramp,
        physical_cores: Some(8),
        model_path: PathBuf::from("/models/model.gguf"),
        port: 8191,
        context_limit: small.then_some(SMALL_MACHINE_CONTEXT_TOKENS),
        batch_size: 2048,
        ubatch_size: 512,
        kv_cache: KvCache::default(),
        parallel: 1,
        slot_save_path: PathBuf::from("/slots"),
        prompt_cache,
    }
}

const RAMP: &[(usize, f64)] = &[(4, 20.0), (8, 30.0)];

fn start(backend: Backend, server: ServerBackend, ram_gib: u64) -> LaunchPlan {
    let model = pick(backend, ram_gib * GIB);
    let cache = if is_small_machine(ram_gib * GIB) {
        PromptCache::Off
    } else {
        PromptCache::Kept
    };
    plan(&app_input((backend, server), model, ram_gib, RAMP, cache))
        .expect("the machine funds the model")
}

fn has_pair(argv: &[String], flag: &str, value: &str) -> bool {
    argv.windows(2)
        .any(|pair| pair[0] == flag && pair[1] == value)
}

#[test]
fn an_eight_gib_mac_starts_the_small_window_with_no_prompt_cache() {
    let planned = start(Backend::Metal, ServerBackend::Metal, 8);
    let argv = planned.args.argv();
    assert_eq!(planned.args.context_tokens, 16_384);
    assert_eq!(planned.args.cache_ram_mib, 0);
    assert!(has_pair(&argv, "--ctx-size", "16384"), "{argv:?}");
    assert!(has_pair(&argv, "--cache-ram", "0"), "{argv:?}");
    assert!(
        planned.memory.total_bytes <= memory_budget(Backend::Metal, 8 * GIB).usable_bytes,
        "the reported total sits inside the budget"
    );
}

#[test]
fn an_eight_gib_pc_without_a_gpu_starts_the_same_way() {
    let planned = start(Backend::Cpu, ServerBackend::Cpu, 8);
    let argv = planned.args.argv();
    assert!(has_pair(&argv, "--ctx-size", "16384"), "{argv:?}");
    assert!(has_pair(&argv, "--cache-ram", "0"), "{argv:?}");
    assert!(
        !argv.iter().any(|arg| arg == "--n-gpu-layers"),
        "a CPU build has no GPU flag: {argv:?}"
    );
}

#[test]
fn a_sixteen_gib_mac_keeps_its_window_and_prompt_cache() {
    let argv = start(Backend::Metal, ServerBackend::Metal, 16).args.argv();
    assert!(has_pair(&argv, "--ctx-size", "65536"), "{argv:?}");
    assert!(has_pair(&argv, "--cache-ram", "1757"), "{argv:?}");
}

#[test]
fn a_sixteen_gib_pc_without_a_gpu_keeps_its_window_and_prompt_cache() {
    let argv = start(Backend::Cpu, ServerBackend::Cpu, 16).args.argv();
    assert!(has_pair(&argv, "--ctx-size", "65536"), "{argv:?}");
    assert!(has_pair(&argv, "--cache-ram", "1757"), "{argv:?}");
}

#[test]
fn larger_machines_keep_the_plan_they_had() {
    let cpu_32 = start(Backend::Cpu, ServerBackend::Cpu, 32).args.argv();
    assert!(has_pair(&cpu_32, "--ctx-size", "55125"), "{cpu_32:?}");
    assert!(has_pair(&cpu_32, "--cache-ram", "738"), "{cpu_32:?}");
    let mac_64 = start(Backend::Metal, ServerBackend::Metal, 64).args.argv();
    assert!(has_pair(&mac_64, "--ctx-size", "65536"), "{mac_64:?}");
    assert!(has_pair(&mac_64, "--cache-ram", "6144"), "{mac_64:?}");
}

#[test]
fn dropping_the_cache_frees_the_context_and_nothing_else() {
    // The 32 GiB PC's pick is trained far past what its memory funds, so the
    // trained cap does not hide the cache's share (on Gemma it would).
    let model = pick(Backend::Cpu, 32 * GIB);
    let pc = (Backend::Cpu, ServerBackend::Cpu);
    let kept = app_input(pc, model, 32, RAMP, PromptCache::Kept);
    let off = app_input(pc, model, 32, RAMP, PromptCache::Off);
    let kept_ceiling = funded_maximum(&kept).expect("funded");
    let off_ceiling = funded_maximum(&off).expect("funded");
    assert!(off_ceiling > kept_ceiling, "{off_ceiling} vs {kept_ceiling}");
    assert_eq!(plan(&off).expect("funded").args.cache_ram_mib, 0);
}
