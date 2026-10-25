//! The 8 GiB line: which LFM file a small machine is offered, and that a
//! machine above the line is offered what it was before.

use kalsa_catalog::choice::{
    chooser_context_tokens, is_small_machine, offered_on, runnable_row,
    SMALL_MACHINE_CONTEXT_TOKENS, SMALL_MACHINE_RAM_BYTES,
};
use kalsa_catalog::footprint::GIB;
use kalsa_catalog::manifest::{rows, ModelEntry};
use kalsa_catalog::{
    largest_that_runs_well, served, Backend, ChoiceInput, CHOOSER_CONTEXT_TOKENS,
};

const LFM_REPO: &str = "LiquidAI/LFM2.5-VL-3B";
const LFM_Q4_URL: &str = "https://huggingface.co/LiquidAI/LFM2.5-VL-3B-GGUF/resolve/6f730e9a2c454e8af9adc29db58e638e01e5957f/LFM2.5-VL-3B-Q4_K_M.gguf";

fn machine(backend: Backend, ram_bytes: u64) -> ChoiceInput {
    ChoiceInput {
        backend,
        ram_bytes,
        bandwidth_bytes_per_second: 100.0e9,
        bandwidth_is_lower_bound: false,
        compute_flops_per_second: 2.0e12,
        context_tokens: chooser_context_tokens(ram_bytes),
        phone: None,
    }
}

fn lfm(quant: &str) -> &'static ModelEntry {
    rows()
        .find(|entry| entry.repo == LFM_REPO && entry.quant == quant)
        .expect("the LFM row is in the catalog")
}

#[test]
fn the_line_is_eight_gibibytes_and_inclusive() {
    assert_eq!(SMALL_MACHINE_RAM_BYTES, 8 * GIB);
    assert!(is_small_machine(8 * GIB));
    assert!(!is_small_machine(8 * GIB + 1));
    assert_eq!(chooser_context_tokens(8 * GIB), SMALL_MACHINE_CONTEXT_TOKENS);
    assert_eq!(chooser_context_tokens(8 * GIB + 1), CHOOSER_CONTEXT_TOKENS);
}

#[test]
fn the_lfm_files_split_at_the_line() {
    assert!(!offered_on(lfm("Q8_0"), 8 * GIB), "Q8_0 is not offered at 8 GiB");
    assert!(offered_on(lfm("Q8_0"), 16 * GIB));
    assert!(offered_on(lfm("Q4_K_M"), 8 * GIB));
    assert!(!offered_on(lfm("Q4_K_M"), 16 * GIB), "Q4_K_M is the small machine's file only");
}

#[test]
fn an_eight_gib_mac_is_offered_the_q4_file_at_the_small_window() {
    let run = largest_that_runs_well(&machine(Backend::Metal, 8 * GIB))
        .expect("an 8 GiB Mac runs a model");
    assert_eq!(run.entry.repo, LFM_REPO);
    assert_eq!(run.entry.quant, "Q4_K_M");
    assert_eq!(run.download.url, LFM_Q4_URL);
    assert_eq!(run.download.bytes, 1_674_455_072);
    assert_eq!(
        run.download.sha256,
        "2436cf4bbac9a16e5dfc7799a140e583c2bc15958f4b24a391f8a8b10ecb8884"
    );
    assert_eq!(
        run.footprint.kv_bytes,
        8_704 * SMALL_MACHINE_CONTEXT_TOKENS,
        "the cache is priced at the 16 384-token window"
    );
}

#[test]
fn an_eight_gib_pc_without_a_gpu_is_offered_the_same_file() {
    let run = largest_that_runs_well(&machine(Backend::Cpu, 8 * GIB))
        .expect("an 8 GiB PC runs a model");
    assert_eq!((run.entry.repo, run.entry.quant), (LFM_REPO, "Q4_K_M"));
    assert_eq!(run.download.url, LFM_Q4_URL);
}

#[test]
fn a_stored_q8_choice_is_not_runnable_at_the_line_and_is_above_it() {
    let q8 = lfm("Q8_0");
    assert!(runnable_row(&machine(Backend::Metal, 8 * GIB), q8).is_none());
    assert!(runnable_row(&machine(Backend::Metal, 16 * GIB), q8).is_some());
}

#[test]
fn the_listing_serves_the_same_lfm_file_the_pick_does() {
    let at_line: Vec<_> = served(&machine(Backend::Metal, 8 * GIB))
        .into_iter()
        .filter(|entry| entry.entry().repo == LFM_REPO)
        .map(|entry| entry.entry().quant)
        .collect();
    assert_eq!(at_line, ["Q4_K_M"]);

    let above: Vec<_> = served(&machine(Backend::Metal, 16 * GIB))
        .into_iter()
        .filter(|entry| entry.entry().repo == LFM_REPO)
        .map(|entry| entry.entry().quant)
        .collect();
    assert!(above.contains(&"Q8_0"));
    assert!(!above.contains(&"Q4_K_M"));
}

#[test]
fn a_sixteen_gib_mac_keeps_the_pick_it_had() {
    let run = largest_that_runs_well(&machine(Backend::Metal, 16 * GIB))
        .expect("a 16 GiB Mac runs a model");
    assert_eq!(run.entry.repo, "google/gemma-4-E4B-it");
    assert_eq!(run.entry.quant, "Q4_K_M");
}
