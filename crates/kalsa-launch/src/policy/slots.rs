//! What the one total context has to become once several devices share it.
//!
//! The engine divides `--ctx-size` by `--parallel` itself
//! (`src/llama-context.cpp`: `n_ctx_seq = n_ctx / n_seq_max`) and pads each
//! slot up to 256, so a total that is not a multiple of `256 * N` hands the
//! engine padding the budget above never paid for. These tests hold the plan
//! to the per-slot arithmetic, hold one slot to the number the pre-slot plan
//! produced, and hold the one floor refusal. The figures each real menu row
//! offers on this Mac are in `menu.rs`.

use super::tests::{input, shipped_row, M1_MAX_RAMP};
use super::*;
use crate::args::MIN_CONTEXT_TOKENS_PER_SLOT;
use kalsa_catalog::footprint::{memory_budget, GIB};
use kalsa_probe::Backend;

/// The big model actually on disk in the app's runtime
/// (`Qwen3.6-35B-A3B-UD-Q4_K_M.gguf`, 22.1 GB) — the row a household with a
/// 64 GiB Mac would run, and the one whose arithmetic this file pins.
const BIG: &str = "Alibaba Qwen 3.6";

pub(super) fn device_input<'a>(
    backend: ServerBackend,
    budget: MemoryBudget,
    model: &'a ModelEntry,
    parallel: u32,
) -> LaunchInput<'a> {
    LaunchInput {
        parallel,
        ..input(backend, budget, model, M1_MAX_RAMP)
    }
}

/// A limit on the TOTAL, as the panel's bounds are totals.
fn limited_input<'a>(
    backend: ServerBackend,
    budget: MemoryBudget,
    model: &'a ModelEntry,
    parallel: u32,
    context_limit: Option<u64>,
) -> LaunchInput<'a> {
    LaunchInput {
        context_limit,
        ..device_input(backend, budget, model, parallel)
    }
}

/// One slot minimum at the boundary: a raw field holding 0 must not render
/// `--parallel 0` beside one-slot arithmetic.
#[test]
fn a_zero_slot_count_is_clamped_to_one_slot() {
    let model = shipped_row("IBM Granite 4 Tiny");
    let budget = memory_budget(Backend::Cpu, 8 * GIB);
    let zero = plan(&device_input(ServerBackend::Cpu, budget, model, 0)).expect("fundable");
    let one = plan(&device_input(ServerBackend::Cpu, budget, model, 1)).expect("fundable");
    assert_eq!(zero.args.parallel, 1);
    assert_eq!(zero.args.context_tokens, one.args.context_tokens);
    let line = zero.args.argv().join(" ");
    assert!(line.contains("--parallel 1"), "{line}");
    assert!(!line.contains("--parallel 0"), "{line}");
}

/// One slot is today's plan, untouched: the engine's division by one is
/// exact, so aligning would trade tokens the engine pads back for nothing.
/// These two numbers are the regression lock — Granite on 8 GiB is the small
/// machine the existing suite already pins, and the on-disk big row is what
/// the app actually runs.
#[test]
fn one_slot_is_still_todays_number() {
    let granite = shipped_row("IBM Granite 4 Tiny");
    let small = memory_budget(Backend::Cpu, 8 * GIB);
    let one = plan(&device_input(ServerBackend::Cpu, small, granite, 1)).expect("fundable");
    assert_eq!(one.args.context_tokens, 4_584);
    assert_eq!(one.args.parallel, 1);
    assert_eq!(
        funded_context(granite, small.usable_bytes),
        Some(4_584),
        "the preview reads the same window as the one-slot plan"
    );

    let big = shipped_row(BIG);
    let mac = memory_budget(Backend::Metal, 64 * GIB);
    let one = plan(&device_input(ServerBackend::Metal, mac, big, 1)).expect("fundable");
    assert_eq!(one.args.context_tokens, 262_144);
    assert_eq!(funded_context(big, mac.usable_bytes), Some(262_144));
}

/// The total the plan hands the server must divide exactly by the slot count
/// after the engine's own 256 alignment, for every N above one.
#[test]
fn the_total_divides_exactly_across_the_slots() {
    let model = shipped_row(BIG);
    let budget = memory_budget(Backend::Metal, 64 * GIB);
    for parallel in [2u32, 3, 4, 8] {
        let launched = plan(&device_input(ServerBackend::Metal, budget, model, parallel))
            .unwrap_or_else(|| panic!("{parallel} slots of the big row are fundable"));
        let slots = u64::from(parallel);
        assert_eq!(
            launched.args.context_tokens % (256 * slots),
            0,
            "N={parallel}: the engine pads {} to the next multiple of {}",
            launched.args.context_tokens,
            256 * slots
        );
        assert_eq!(
            launched.args.context_tokens,
            (launched.args.context_tokens / slots) * slots,
            "N={parallel}: the engine would round the total down"
        );
    }
}

/// The owner's total is divided exactly as the engine divides `--ctx-size`:
/// the funded total comes back as itself, and a smaller total splits per the
/// same arithmetic. `None` at N=1 for one slot is refused by the machine's
/// own guard, tested where the machine is (`startup`), not here.
#[test]
fn the_owners_total_is_divided_the_way_the_engine_divides_it() {
    let model = shipped_row(BIG);
    let budget = memory_budget(Backend::Metal, 64 * GIB);
    let funded = plan(&device_input(ServerBackend::Metal, budget, model, 4)).expect("fundable");
    assert_eq!(funded.args.context_tokens, 546_816);

    let asked = plan(&limited_input(
        ServerBackend::Metal,
        budget,
        model,
        4,
        Some(546_816),
    ))
    .expect("the funded total is accepted");
    assert_eq!(asked.args.context_tokens, 546_816);
    assert_eq!(asked.args.context_tokens / 4, 136_704);

    // A request for less is divided and aligned the same way: 131072 over
    // four slots is 32768 each, already a multiple of 256.
    let smaller = plan(&limited_input(
        ServerBackend::Metal,
        budget,
        model,
        4,
        Some(131_072),
    ))
    .expect("a smaller total is accepted");
    assert_eq!(smaller.args.context_tokens, 131_072);
    assert_eq!(smaller.args.context_tokens / 4, 32_768);
}

/// A zero trained length is a header that read as nothing, refused at every
/// slot count exactly as it is at one.
#[test]
fn a_zero_trained_length_is_refused_at_every_slot_count() {
    let mut model = *shipped_row("IBM Granite 4 Tiny");
    model.trained_context_tokens = Some(0);
    let budget = memory_budget(Backend::Cpu, 16 * GIB);
    assert!(plan(&device_input(ServerBackend::Cpu, budget, &model, 1)).is_none());
    assert!(plan(&device_input(ServerBackend::Cpu, budget, &model, 4)).is_none());
}

/// THE floor refusal, and the only test of the floor: a machine that cannot
/// give every slot 4096 tokens refuses rather than serving a smaller slot.
/// Granite on 8 GiB funds 4584 in total, so four slots would get 1146, cut by
/// the engine's 256 alignment to 1024 — below the 4096 a slot needs for a
/// real conversation (`docs/MULTI-DEVICE-SHAPE.md` §4). The accept boundary,
/// Phi Mini landing exactly on 4096 a slot at N=4, is in `menu.rs`.
#[test]
fn a_budget_that_cannot_floor_four_slots_is_refused() {
    let model = shipped_row("IBM Granite 4 Tiny");
    let budget = memory_budget(Backend::Cpu, 8 * GIB);
    let one = plan(&device_input(ServerBackend::Cpu, budget, model, 1)).expect("one slot fits");
    assert_eq!(one.args.context_tokens, 4_584);
    assert!(
        one.args.context_tokens / 4 < MIN_CONTEXT_TOKENS_PER_SLOT,
        "the budget must be short of the floor for four slots"
    );
    assert!(
        plan(&device_input(ServerBackend::Cpu, budget, model, 4)).is_none(),
        "four slots of 1024 were served silently"
    );
}
