//! The money solve's two regimes and its refusals, driven through `plan`.
//!
//! The per-slot term is subtracted before the context is bought, and a window
//! pool has a kink: below `n_swa + ubatch` cells a slot it grows with the
//! context, above it it is a constant. A shipped row cannot be held below the
//! kink on the menu: every shipped window saturates between 1024 and 2560
//! cells a slot, all under `MIN_CONTEXT_TOKENS_PER_SLOT` (4096), so the floor
//! refuses that whole regime. The growing case and the refusals are therefore
//! driven with fixtures — the refusals because they need a per-slot term
//! larger than any shipped row's relative to its per-token figure, so that the
//! state, not the floor, is what refuses.

use super::tests::{input, shipped_row, M1_MAX_RAMP};
use super::*;
use crate::args::{KvCache, MIN_CONTEXT_TOKENS_PER_SLOT, UBATCH};
use kalsa_catalog::footprint::GIB;
use kalsa_catalog::manifest::{ModelEntry, SlotCache};

/// A row with no per-slot term. It exists as a fixture because the shipped
/// menu has none: every pinned row is a sliding-window or recurrent hybrid.
/// Phi Mini is the one the ENGINE allocates as a single plain pool, and that
/// is measured — its `phimoe` loader never reads
/// `LLM_KV_ATTENTION_SLIDING_WINDOW`, so the header's
/// `phimoe.attention.sliding_window 2047` is inert and v1.1.0 logs
/// `print_info: n_swa = 0`, `is_swa_any = 0` and one
/// `llama_kv_cache: size = 272.00 MiB (4096 cells, 32 layers, 1/1 seqs)` with
/// no `llama_kv_cache_iswa` line at all.
fn plain_row(weights_bytes: u64) -> ModelEntry {
    ModelEntry {
        repo: "test/plain",
        display_name: "Plain Fixture",
        last_modified: "2026-01-01",
        licence: kalsa_catalog::Licence::Open("apache-2.0"),
        parameters: kalsa_catalog::Parameters::dense(1_000_000_000),
        quant: "Q4_K_M",
        weights_bytes,
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        slot_cache: SlotCache::None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        trained_context_tokens: None,
        stale: None,
    }
}

#[test]
fn a_plain_row_pays_no_per_slot_term() {
    let plain = plain_row(4 * GIB);
    for per_slot in [1u64, 4096, u64::MAX] {
        assert_eq!(
            slot_cache_bytes(&plain, per_slot, KvCache::Q8_0, u64::from(UBATCH)),
            0,
            "a plain row must pay nothing per slot"
        );
    }
    // The solve is the flat one, recomputed from first principles: the whole
    // KV budget over the per-token figure, nothing subtracted.
    let budget = MemoryBudget {
        usable_bytes: 16 * GIB,
        gpu_accounted_for: true,
    };
    let flat = funded_maximum(&input(ServerBackend::Cpu, budget, &plain, M1_MAX_RAMP))
        .expect("the fixture fits");
    let leftover = budget.usable_bytes - (4 * GIB + COMPUTE_BUFFER_BYTES);
    let roof = (leftover / 4).min(6_442_450_944);
    assert_eq!(flat, (leftover - roof) / ASSUMED_KV_BYTES_PER_TOKEN);

    // The shipped menu row the engine also allocates as one plain pool.
    let phi = shipped_row("Microsoft Phi Mini");
    assert_eq!(phi.slot_cache, SlotCache::None);
    assert_eq!(
        slot_cache_bytes(phi, 4096, KvCache::Q8_0, u64::from(UBATCH)),
        0
    );
}

/// The regime switch at the UNIT level: below `n_swa + ubatch` cells a slot
/// the window pool has not saturated, so "subtract N x the constant, then
/// divide" would charge for a full pool the engine never allocates.
#[test]
fn the_solve_switches_when_the_window_has_not_saturated() {
    let trinity = shipped_row("Arcee Trinity Nano");
    let per_token = ASSUMED_KV_BYTES_PER_TOKEN;
    let window = 2048u64;
    let width = 21_504u64;
    let saturated_cells = sliding_window_cells(window, u64::from(UBATCH), u64::MAX);
    assert_eq!(saturated_cells, 2560);
    let saturated_bytes = 21_504 * 2560 * 34 / 32;

    // Below the kink the engine holds the per-slot context, not the window:
    // the constant the saturated solve subtracts is bigger than the real pool,
    // so the growing side is the only exact one there.
    let below = 2048u64;
    assert_eq!(
        sliding_window_cells(window, u64::from(UBATCH), below),
        below
    );
    assert!(slot_cache_bytes(trinity, below, KvCache::Q8_0, u64::from(UBATCH)) < saturated_bytes);

    // One byte short of the budget that would buy a saturated pool a slot.
    let budget = saturated_bytes + 2560 * per_token - 1;
    let funded = funded_cache_tokens(
        trinity,
        budget,
        per_token,
        1,
        KvCache::Q8_0,
        u64::from(UBATCH),
    )
    .expect("only an empty budget refuses");
    // Growing side: ctx x (per-token + window width), on the engine's grid.
    let growing_per_token = per_token + width * 34 / 32;
    let raw = budget / growing_per_token;
    assert_eq!(funded, raw - raw % SLOT_CONTEXT_ALIGNMENT);
    assert_eq!(funded % SLOT_CONTEXT_ALIGNMENT, 0);
    assert!(
        funded < saturated_cells,
        "the kink must not be crossed: {funded} vs {saturated_cells}"
    );
    // The boundary is exact: the engine's real allocation at `funded` fits,
    // and one 256-token step up the grid does not.
    let kv = |ctx: u64| {
        ctx * per_token + width * sliding_window_cells(window, u64::from(UBATCH), ctx) * 34 / 32
    };
    assert!(
        kv(funded) <= budget,
        "{funded}: {} over {budget}",
        kv(funded)
    );
    assert!(
        kv(funded + SLOT_CONTEXT_ALIGNMENT) > budget,
        "one more step should not fit"
    );
    // The saturated solve answers ABOVE the boundary because it never pays
    // the pad from an off-grid context up to the grid the engine uses.
    let saturated_side = (budget - saturated_bytes) / per_token;
    assert!(
        saturated_side > funded,
        "the saturated side ({saturated_side}) must over-fund against {funded}"
    );
}

/// The growing regime driven through `plan` at two slots. No shipped row can
/// reach it (see the module doc), so the fixture's window is wide enough that
/// a legal two-slot plan — 6144 tokens a slot — is still growing.
#[test]
fn the_growing_regime_is_reached_through_plan_at_two_slots() {
    let mut row = plain_row(GIB);
    row.slot_cache = SlotCache::SlidingWindow {
        window_tokens: 8192,
        width_per_cell: 21_504,
    };
    let per_token = ASSUMED_KV_BYTES_PER_TOKEN;
    let width = 21_504u64;
    let saturating_cells = sliding_window_cells(8192, u64::from(UBATCH), u64::MAX);
    assert_eq!(saturating_cells, 8704);

    // A budget whose KV is exactly 1_500_000_000 B: the roof is a quarter of
    // the 2_000_000_000 B leftover, well under the 6144 MiB cap.
    let fixed = row.weights_bytes + COMPUTE_BUFFER_BYTES;
    let budget = MemoryBudget {
        usable_bytes: fixed + 2_000_000_000,
        gpu_accounted_for: true,
    };
    let kv_budget = 1_500_000_000;
    assert_eq!(
        budget.usable_bytes - fixed - (budget.usable_bytes - fixed) / 4,
        kv_budget
    );

    let launched = plan(&LaunchInput {
        parallel: 2,
        ..input(ServerBackend::Cpu, budget, &row, M1_MAX_RAMP)
    })
    .expect("the fixture is fundable at two slots");
    let per_slot = launched.args.context_tokens / 2;
    assert_eq!(launched.args.context_tokens, 12_288, "the growing solve");
    assert_eq!(per_slot, 6_144);
    assert!(
        per_slot >= MIN_CONTEXT_TOKENS_PER_SLOT && per_slot < saturating_cells,
        "{per_slot} must be a legal slot still below the kink"
    );
    // Growing means every windowed layer holds the whole per-slot context, so
    // the total is ctx x (per-token + window width). Exact at the boundary.
    let kv = |slots: u64, per_slot: u64| slots * per_slot * (per_token + width * 34 / 32);
    assert!(kv(2, per_slot) <= kv_budget);
    assert!(
        kv(2, per_slot + SLOT_CONTEXT_ALIGNMENT) > kv_budget,
        "one step up the grid must not fit"
    );
    // The saturated solve would have answered LOWER, not higher: it charges a
    // full window pool the context has not reached.
    let saturated_side = (kv_budget - 2 * width * saturating_cells * 34 / 32) / per_token;
    assert!(
        saturated_side < launched.args.context_tokens,
        "the saturated side ({saturated_side}) must under-fund in the growing regime"
    );
}

/// The negative-budget refusal, driven through `plan` at N > 1: a budget that
/// clears the floor on the flat per-token arithmetic, but cannot pay every
/// slot's own term, is refused outright rather than funded with a state the
/// machine cannot hold.
#[test]
fn a_budget_that_cannot_pay_every_slot_refuses_at_two_slots() {
    let mut row = plain_row(GIB);
    row.slot_cache = SlotCache::Recurrent {
        bytes_per_slot: 3 * GIB,
    };
    let per_token = ASSUMED_KV_BYTES_PER_TOKEN;
    let fixed = row.weights_bytes + COMPUTE_BUFFER_BYTES;
    // Leftover 1_333_333_333; the roof takes a quarter and the KV budget is
    // exactly 1_000_000_000 B.
    let budget = MemoryBudget {
        usable_bytes: fixed + 1_333_333_333,
        gpu_accounted_for: true,
    };
    let kv_budget = 1_000_000_000;
    // The flat arithmetic alone would clear the floor at two slots: 5086 a
    // slot. The refusal that follows is the per-slot term's, not the floor's.
    assert!(kv_budget / (2 * per_token) >= MIN_CONTEXT_TOKENS_PER_SLOT);
    assert!(
        kv_budget < 2 * (3 * GIB),
        "the state is what is unaffordable"
    );
    assert!(
        plan(&LaunchInput {
            parallel: 2,
            ..input(ServerBackend::Cpu, budget, &row, M1_MAX_RAMP)
        })
        .is_none(),
        "two slots' states do not fit and must not be served"
    );
    // One slot cannot pay a single state either, from a budget that would
    // otherwise fund more than 10,000 tokens.
    assert!(kv_budget / per_token > 10_000);
    assert!(
        plan(&input(ServerBackend::Cpu, budget, &row, M1_MAX_RAMP)).is_none(),
        "one state alone exceeds the KV budget"
    );
}
