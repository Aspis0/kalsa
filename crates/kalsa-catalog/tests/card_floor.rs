//! The owner's rule against the machine it was written for, and against the
//! three machines it must not touch.
//!
//! A row that fits entirely in a dedicated card's budget runs on the card,
//! which is faster than the processor path the probe timed — so the floor
//! from that processor may keep such a row but never exclude it. The
//! fixture is the owner's Lenovo as `measurement.json` records it, taken
//! through the same measurement-to-input lines the app's capability page
//! builds; the counters are a card that cannot hold the row, a Mac, and a
//! processor-only box, whose answers must not move.

use kalsa_catalog::{
    fits_footprint, largest_that_runs_well, memory_budget, quicker_alternative, usable,
    ChoiceInput, Prediction, RefusalReason, CHOOSER_CONTEXT_TOKENS, GIB,
};
use kalsa_probe::{Backend, ExecutionPath, Measurement, Reliability, Series};

/// What the probe hands the chooser after it has measured this machine:
/// every figure the catalog is given, derived the way `capability::input_for`
/// derives it — nothing here restates the app's wiring by hand.
fn input_from(measurement: &Measurement, ram_bytes: u64) -> ChoiceInput {
    ChoiceInput {
        backend: measurement.will_run_on,
        ram_bytes,
        bandwidth_bytes_per_second: measurement.decode_bandwidth_bytes_per_second(),
        bandwidth_is_lower_bound: measurement.bandwidth_is_lower_bound(),
        compute_flops_per_second: measurement.compute.max(),
        context_tokens: CHOOSER_CONTEXT_TOKENS,
        phone: None,
    }
}

/// A machine probed the way the probe reports one: the numbers timed on the
/// CPU (`measured_on`), no chip figure beside them, so a GPU machine's
/// bandwidth arrives as a floor and a processor machine's as itself.
fn measurement(will_run_on: Backend, ceiling_bytes_per_second: f64) -> Measurement {
    Measurement {
        ramp: vec![(2, ceiling_bytes_per_second)],
        ceiling_bytes_per_second,
        ceiling: Series::new(vec![ceiling_bytes_per_second]),
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
        will_run_on,
        decode_bytes_per_second: None,
    }
}

/// The owner's Lenovo: 32 GiB of RAM, the 6 439 305 216-byte RTX 4050, and
/// the processor's own 62 460 761 598 B/s — the ceiling `measurement.json`
/// holds, timed on the CPU while the model will decode on the card.
fn lenovo() -> Measurement {
    measurement(
        Backend::DiscreteGpu {
            vram_bytes: Some(6_439_305_216),
        },
        62_460_761_598.0,
    )
}

#[test]
fn the_processor_floor_never_excludes_a_row_that_lives_on_the_card() {
    let input = input_from(&lenovo(), 32 * GIB);
    assert!(
        input.bandwidth_is_lower_bound,
        "the premise: this machine's figure is a floor, not a rate"
    );

    let pick = largest_that_runs_well(&input).expect("the card runs something");
    assert_eq!(pick.entry.repo, "google/gemma-4-E4B-it");
    assert_eq!(pick.entry.quant, "Q4_K_M");
    assert!(
        matches!(pick.decode, Prediction::Floor(_)),
        "the speed stays a floor: at least this, unknown above — {:?}",
        pick.decode
    );
    assert!(pick.budget.card_sized, "sized against the card's memory");
    assert!(fits_footprint(pick.entry, &pick.footprint, &pick.budget));

    // The second card is the existing rule's answer, unchanged: Gemma
    // before LFM, LFM only against LFM — beside the pick the bar clears is
    // the family the owner ranks last.
    let second = quicker_alternative(&input, &pick.decode).expect("a second card beside it");
    assert_eq!(second.entry.repo, "LiquidAI/LFM2.5-2.6B");
}

#[test]
fn a_card_that_cannot_hold_the_row_keeps_todays_answer() {
    // The same machine with a 4 GiB card: the row the rule spares does not
    // fit it, so the fit decides first and nothing about speed is asked —
    // the machine is refused exactly as it was before the rule existed.
    let small = measurement(
        Backend::DiscreteGpu {
            vram_bytes: Some(4 * GIB),
        },
        62_460_761_598.0,
    );
    let input = input_from(&small, 32 * GIB);
    let budget = memory_budget(input.backend, input.ram_bytes);
    let e4b = usable()
        .find(|row| row.entry().repo == "google/gemma-4-E4B-it")
        .expect("the row is on the menu");
    let entry = e4b.entry();
    let footprint = kalsa_catalog::candidate_footprint(e4b, &input);
    assert!(
        !fits_footprint(entry, &footprint, &budget),
        "the premise: a 4 GiB card's budget does not hold the row"
    );

    let refusal = match largest_that_runs_well(&input) {
        Err(refusal) => refusal,
        Ok(row) => panic!(
            "nothing fits the small card, yet {} was offered",
            row.entry.repo
        ),
    };
    assert_eq!(refusal.reason, RefusalReason::NothingFits);
}

#[test]
fn metal_and_processor_machines_keep_todays_gates() {
    // A Mac: the same CPU-timed figure arrives as a floor, but Metal is
    // budgeted in RAM, not by a card — so its dense line still withholds
    // the row the card rule spares, and the pick is the row it was.
    let mac = input_from(&measurement(Backend::Metal, 62_460_761_598.0), 16 * GIB);
    assert!(
        mac.bandwidth_is_lower_bound,
        "the premise: a floor on a Mac"
    );
    let mac_pick = largest_that_runs_well(&mac).expect("a Mac runs something");
    assert_eq!(mac_pick.entry.repo, "LiquidAI/LFM2.5-2.6B");
    assert_eq!(mac_pick.entry.quant, "Q8_0");
    assert!(matches!(mac_pick.decode, Prediction::Floor(_)));
    let mac_budget = memory_budget(mac.backend, mac.ram_bytes);
    let e4b = usable()
        .find(|row| row.entry().repo == "google/gemma-4-E4B-it")
        .expect("the row is on the menu");
    let entry = e4b.entry();
    assert!(
        fits_footprint(
            entry,
            &kalsa_catalog::candidate_footprint(e4b, &mac),
            &mac_budget
        ),
        "the premise: the row fits this Mac, so its line — not memory — withholds it"
    );

    // A processor-only box at the Surface's 60 GB/s: the bandwidth is the
    // path the model runs on, so it predicts a range and gates by it, as
    // before.
    let cpu = input_from(&measurement(Backend::Cpu, 60.0e9), 16 * GIB);
    assert!(
        !cpu.bandwidth_is_lower_bound,
        "the premise: on the processor the figure is the path itself"
    );
    let cpu_pick = largest_that_runs_well(&cpu).expect("a processor runs something");
    assert_eq!(cpu_pick.entry.repo, "LiquidAI/LFM2.5-2.6B");
    assert_eq!(cpu_pick.entry.quant, "Q8_0");
    assert!(matches!(cpu_pick.decode, Prediction::Range { .. }));
}
