//! What the plan offers for every row the app can actually ship, on this Mac.
//!
//! The menu is `kalsa_catalog::manifest::usable()`: every downloadable row
//! that passed the licence, cache and staleness gates. Driving this file from
//! that iterator rather than a hand-written list means a row added to the menu
//! is covered by the invariant loop the moment it ships. Four rows an earlier
//! list named are deliberately absent because `standing()` keeps them off the
//! menu: Swiss AI Apertus 1.5 (stale; its cache IS measured, at 163 840, so
//! staleness is its only live gate), Moonshot Moonlight 16B (stale), Alibaba
//! Qwen 3 Next 80B (stale), InclusionAI Ling Mini 2.0 (stale). Apertus was
//! the second measured-KV row; with it excluded, Qwen 3.6 is the only
//! measured-KV row on the menu.
//!
//! The offer table is per DEVICE (what one phone gets), q8_0, on a 64 GiB Mac.
//! It is the real answer, not the 4096 floor: on this machine a row usually
//! offers tens of thousands of tokens per device, and the floor appears only
//! as a refusal (in `slots.rs`) and as Phi Mini's accept boundary.
//!
//! The three sliding-window rows — Trinity Nano, Gemma 4 26B, Gemma 4 12B —
//! carry a PINNED under-budget: the plan prices one flat per-token cache with
//! no `np` term, while `docs/MULTI-DEVICE-SHAPE.md` §7 measured the
//! sliding-window layers replicating per slot (+167 MiB going np=1 → np=4 on
//! Trinity-Nano). What the plan reports for those rows at N > 1 is a lower
//! bound on the engine's allocation, not a prediction of it.

use super::slots::device_input;
use super::tests::shipped_row;
use super::*;
use crate::args::MIN_CONTEXT_TOKENS_PER_SLOT;
use kalsa_catalog::footprint::{memory_budget, GIB};
use kalsa_catalog::manifest::usable;
use kalsa_probe::Backend;

/// Which limit sets a figure.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Bind {
    /// The length the model was trained for.
    Trained,
    /// The memory left after weights, buffers and the prompt-cache roof.
    Memory,
}

fn label(bind: Bind) -> &'static str {
    match bind {
        Bind::Trained => "trained",
        Bind::Memory => "memory",
    }
}

/// Did the limit `bind` names really set this per-slot figure? `Trained`
/// means the slot sits exactly on the training length; `Memory` means it sits
/// strictly below it.
fn binds(bind: Bind, total: u64, slots: u64, trained: Option<u64>) -> bool {
    let per_slot = total / slots;
    match (bind, trained) {
        (Bind::Trained, Some(trained)) => per_slot == trained,
        (Bind::Memory, Some(trained)) => per_slot < trained,
        (Bind::Memory, None) => true,
        // A shipped row with no training length cannot be a Trained case.
        (Bind::Trained, None) => false,
    }
}

/// One menu row's offer, per device, at one, two and four devices, with the
/// limit that set each figure.
struct Offer {
    name: &'static str,
    n1: (u64, Bind),
    n2: (u64, Bind),
    n4: (u64, Bind),
    /// Sliding-window hybrid: the plan's flat per-token figure excludes the
    /// per-slot replication (see the SWA test below).
    swa: bool,
    /// Carries a measured per-token cache figure rather than the assumption.
    measured_kv: bool,
}

const OFFERS: &[Offer] = &[
    // Measured KV, the row on disk. The trained length binds one device and
    // still binds two; at four the memory binds.
    Offer {
        name: "Alibaba Qwen 3.6",
        n1: (262_144, Bind::Trained),
        n2: (262_144, Bind::Trained),
        n4: (136_704, Bind::Memory),
        swa: false,
        measured_kv: true,
    },
    // SWA, assumed KV: the row the +167 MiB replication was measured on.
    Offer {
        name: "Arcee Trinity Nano",
        n1: (131_072, Bind::Trained),
        n2: (131_072, Bind::Trained),
        n4: (103_680, Bind::Memory),
        swa: true,
        measured_kv: false,
    },
    // SWA, assumed KV (`sliding_window_pattern` in the row's own comment).
    Offer {
        name: "Google Gemma 4 26B",
        n1: (262_144, Bind::Trained),
        n2: (153_088, Bind::Memory),
        n4: (76_544, Bind::Memory),
        swa: true,
        measured_kv: false,
    },
    // SWA ("iswa and NOT flat per token"), assumed KV.
    Offer {
        name: "Google Gemma 4 12B",
        n1: (131_072, Bind::Trained),
        n2: (131_072, Bind::Trained),
        n4: (93_696, Bind::Memory),
        swa: true,
        measured_kv: false,
    },
    // THE 4096-trained row: the training length bounds each slot, so four
    // slots each take the full 4096 and the total is 16384. That lands the
    // slot exactly on the floor — the accept boundary — and the old clamp on
    // the total would have served 1024 a slot in silence.
    Offer {
        name: "Microsoft Phi Mini",
        n1: (4_096, Bind::Trained),
        n2: (4_096, Bind::Trained),
        n4: (4_096, Bind::Trained),
        swa: false,
        measured_kv: false,
    },
    // Mid-range controls.
    Offer {
        name: "Liquid LFM 2.5",
        n1: (128_000, Bind::Trained),
        n2: (128_000, Bind::Trained),
        n4: (101_632, Bind::Memory),
        swa: false,
        measured_kv: false,
    },
    Offer {
        name: "Google Gemma 4 E4B",
        n1: (131_072, Bind::Trained),
        n2: (131_072, Bind::Trained),
        n4: (100_608, Bind::Memory),
        swa: false,
        measured_kv: false,
    },
    Offer {
        name: "IBM Granite 4 Tiny",
        n1: (410_250, Bind::Memory),
        n2: (205_056, Bind::Memory),
        n4: (102_400, Bind::Memory),
        swa: false,
        measured_kv: false,
    },
];

fn menu() -> Vec<(&'static str, &'static ModelEntry)> {
    usable()
        .map(|row| {
            let entry = row.entry();
            (entry.display_name, entry)
        })
        .collect()
}

/// THE OFFER TABLE: per device, on this 64 GiB Mac. Headline first — the row
/// on disk keeps its full 262 144 for one device and for two, and still gives
/// four devices 136 704 each.
#[test]
fn the_offer_table_on_this_mac() {
    let budget = memory_budget(Backend::Metal, 64 * GIB);
    let qwen = shipped_row("Alibaba Qwen 3.6");
    for (parallel, expected) in [(1u32, 262_144u64), (2, 262_144), (4, 136_704)] {
        let planned = plan(&device_input(ServerBackend::Metal, budget, qwen, parallel))
            .expect("the row on disk is fundable");
        assert_eq!(
            planned.args.context_tokens / u64::from(parallel),
            expected,
            "Qwen 3.6 at N={parallel}"
        );
    }

    println!(
        "{:<24} {:>9} {:>9} {:>9}",
        "row (per device)", "N=1", "N=2", "N=4"
    );
    let rows = menu();
    for offer in OFFERS {
        let entry = rows
            .iter()
            .find(|(name, _)| *name == offer.name)
            .map(|(_, entry)| *entry)
            .unwrap_or_else(|| panic!("{} left the menu", offer.name));
        let mut cells = String::new();
        for (parallel, (expected, bind)) in [(1u32, offer.n1), (2, offer.n2), (4, offer.n4)] {
            let slots = u64::from(parallel);
            let planned = plan(&device_input(ServerBackend::Metal, budget, entry, parallel))
                .unwrap_or_else(|| panic!("{}: N={parallel} must be fundable here", offer.name));
            let total = planned.args.context_tokens;
            assert_eq!(total / slots, expected, "{} at N={parallel}", offer.name);
            assert_eq!(
                total,
                expected * slots,
                "{} at N={parallel}: the total must be the per-device figure times the slots",
                offer.name
            );
            assert!(
                binds(bind, total, slots, entry.trained_context_tokens),
                "{} at N={parallel}: the figure is not what {} says binds",
                offer.name,
                label(bind)
            );
            assert!(expected >= MIN_CONTEXT_TOKENS_PER_SLOT);
            cells.push_str(&format!(" {expected:>9}"));
        }
        println!("{:<24}{cells}", offer.name);
    }
}

/// Every invariant, for every row the menu can offer, at slot counts the
/// panel does not pin: a plan that exists is aligned, exact and inside the
/// budget, and its one-slot figure is the one the panel previews.
#[test]
fn every_offered_row_keeps_the_invariants_at_every_slot_count() {
    let budget = memory_budget(Backend::Metal, 64 * GIB);
    let rows = menu();
    for (name, entry) in &rows {
        let one = plan(&device_input(ServerBackend::Metal, budget, entry, 1))
            .unwrap_or_else(|| panic!("{name}: one slot must be fundable here"));
        assert_eq!(one.args.parallel, 1);
        assert_eq!(
            one.args.context_tokens,
            funded_context(entry, budget.usable_bytes)
                .unwrap_or_else(|| panic!("{name}: the preview must have a window")),
            "{name}: the one-slot plan must be the figure the panel previews"
        );
        for parallel in [2u32, 3, 4, 8] {
            let Some(planned) = plan(&device_input(ServerBackend::Metal, budget, entry, parallel))
            else {
                continue; // the memory cannot floor N slots: refused, never under-served
            };
            let slots = u64::from(parallel);
            let per_slot = planned.args.context_tokens / slots;
            assert_eq!(planned.args.parallel, parallel);
            assert_eq!(
                planned.args.context_tokens % (256 * slots),
                0,
                "{name} at N={parallel}: {} is not a multiple of 256*N",
                planned.args.context_tokens
            );
            assert_eq!(
                planned.args.context_tokens,
                per_slot * slots,
                "{name} at N={parallel}: the engine would round the total down"
            );
            assert!(
                per_slot >= MIN_CONTEXT_TOKENS_PER_SLOT,
                "{name} at N={parallel}: one slot was served {per_slot} tokens, under the floor"
            );
            assert!(
                planned.memory.total_bytes <= budget.usable_bytes,
                "{name} at N={parallel}: the plan reports {} bytes over a {} byte budget",
                planned.memory.total_bytes,
                budget.usable_bytes
            );
            assert_eq!(planned.memory.context_tokens, planned.args.context_tokens);
        }
    }
    // The four rows an earlier list named are off the menu by `standing()`;
    // this pins that they stay out of scope rather than reappearing as if
    // they shipped.
    let names: Vec<&str> = rows.iter().map(|(name, _)| *name).collect();
    for excluded in [
        "Swiss AI Apertus 1.5",
        "Moonshot Moonlight 16B",
        "Alibaba Qwen 3 Next 80B",
        "InclusionAI Ling Mini 2.0",
    ] {
        assert!(
            !names.contains(&excluded),
            "{excluded} is on the menu again: re-derive its expectations before offering it"
        );
    }
    assert!(names.len() >= OFFERS.len(), "the menu shrank: {names:?}");
}

/// The cache figure is the row's own measurement or the shared assumption,
/// and never the other one; Phi Mini is the row that lands exactly on the
/// floor at N=4, which is the floor's accept boundary.
#[test]
fn the_menu_rows_price_their_cache_and_the_4096_row_lands_on_the_floor() {
    let budget = memory_budget(Backend::Metal, 64 * GIB);
    let rows = menu();
    for offer in OFFERS {
        let entry = rows
            .iter()
            .find(|(name, _)| *name == offer.name)
            .map(|(_, entry)| *entry)
            .unwrap_or_else(|| panic!("{} left the menu", offer.name));
        let planned =
            plan(&device_input(ServerBackend::Metal, budget, entry, 4)).expect("four slots");
        let per_token = if offer.measured_kv {
            entry
                .kv_bytes_per_token
                .unwrap_or_else(|| panic!("{} is marked measured", offer.name))
        } else {
            ASSUMED_KV_BYTES_PER_TOKEN
        };
        assert_eq!(
            planned.memory.kv_cache_bytes,
            planned.args.context_tokens * per_token,
            "{}: the plan did not price the cache it claims",
            offer.name
        );
        assert_eq!(
            !planned.memory.kv_per_token_assumed, offer.measured_kv,
            "{}: the assumed/measured flag does not match the row",
            offer.name
        );
    }
    let phi = shipped_row("Microsoft Phi Mini");
    let planned = plan(&device_input(ServerBackend::Metal, budget, phi, 4)).expect("marketed");
    assert_eq!(planned.args.context_tokens, 16_384);
    assert_eq!(
        planned.args.context_tokens / 4,
        MIN_CONTEXT_TOKENS_PER_SLOT,
        "Phi Mini's four slots land exactly on the floor: the accept boundary"
    );
}

/// The sliding-window rows are a PINNED under-budget at N > 1, not an unknown
/// one: the plan reports a flat `total tokens × 96 KiB`, with no term for the
/// sliding-window layers that §7 measured replicating per slot (+167 MiB,
/// np=1 → np=4). The figures above are what the launcher will SAY, and a
/// lower bound on what the engine will allocate.
#[test]
fn the_sliding_window_rows_carry_no_per_slot_term() {
    let budget = memory_budget(Backend::Metal, 64 * GIB);
    for offer in OFFERS.iter().filter(|offer| offer.swa) {
        let entry = shipped_row(offer.name);
        let planned =
            plan(&device_input(ServerBackend::Metal, budget, entry, 4)).expect("fundable");
        assert!(
            planned.memory.kv_per_token_assumed,
            "{}: the SWA rows are priced on the assumption",
            offer.name
        );
        assert_eq!(
            planned.memory.kv_cache_bytes,
            planned.args.context_tokens * ASSUMED_KV_BYTES_PER_TOKEN,
            "{}: the plan priced something other than one flat cache",
            offer.name
        );
    }
    assert_eq!(
        OFFERS.iter().filter(|offer| offer.swa).count(),
        3,
        "the sliding-window set on the menu changed"
    );
}
