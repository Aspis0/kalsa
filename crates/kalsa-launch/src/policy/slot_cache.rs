//! The per-slot term: what the engine allocates for EACH stream on top of the
//! context-wide pool, and the money solve that pays it before it buys tokens.
//!
//! The pinned reference is `docs/MULTI-DEVICE-SHAPE.md` §7 — the engine's own
//! `llama_kv_cache` log lines from the A/B2/B4 runs on the shipped b10950 with
//! the pinned `Trinity-Nano-Preview-Q4_K_M.gguf`, `--ctx-size 16384`, q8_0 and
//! ubatch 512. The numbers below are that log. If they move, either this
//! arithmetic or the engine changed, and the run says which:
//!
//! ```text
//! np=1: SWA  55.78 MiB ( 2560 cells, 42 layers, 1/1 seqs)
//!       base 119.00 MiB (16384 cells, 14 layers, 1/1 seqs)
//! np=2: SWA 111.56 MiB ( 2560 cells, 42 layers, 2/2 seqs)
//!       base 119.00 MiB ( 8192 cells, 14 layers, 2/2 seqs)
//! np=4: SWA 223.12 MiB ( 2560 cells, 42 layers, 4/4 seqs)
//!       base 119.00 MiB ( 4096 cells, 14 layers, 4/4 seqs)
//! ```
//!
//! One row's geometry is a MEASUREMENT rather than a header read, because its
//! header alone gives the wrong answer: Gemma 4 E4B carries
//! `shared_kv_layers 18`, so 20 windowed layers hold KV and not 35. The
//! solve's regimes and refusals are in the sibling `solve` module.

use super::tests::{input, shipped_row, M1_MAX_RAMP};
use super::*;
use crate::args::{KvCache, UBATCH};
use kalsa_catalog::footprint::{memory_budget, GIB, MIB};
use kalsa_catalog::manifest::{usable, ModelEntry, SlotCache};
use kalsa_probe::Backend;

/// The one context every §7 run used, in tokens.
const SECTION_7_CONTEXT: u64 = 16_384;

/// §7, verbatim. Trinity-Nano's geometry, read from the pinned file's header:
/// `afmoe.block_count 56`, `afmoe.attention.head_count_kv 2`,
/// `key_length 128`, `value_length 128`, `sliding_window 2048`; the 42
/// windowed layers are `afmoe.cpp`'s `swa_period = 4` default
/// (`llama-hparams.cpp:15`: `il % 4 < 3`), not a header key. The full
/// attention pool is the other 14 layers, 2 x (128 + 128) elements per cell.
#[test]
fn the_engine_log_of_section_7_reproduces() {
    let trinity = shipped_row("Arcee Trinity Nano");

    for (slots, logged_mib) in [(1u64, 55.78f64), (2, 111.56), (4, 223.12)] {
        let per_slot = SECTION_7_CONTEXT / slots;
        let bytes = slot_cache_bytes(trinity, per_slot, KvCache::Q8_0, u64::from(UBATCH)) * slots;
        let mib = bytes as f64 / MIB as f64;
        assert!(
            (mib - logged_mib).abs() < 0.005,
            "np={slots}: the engine logged {logged_mib} MiB of sliding-window KV, \
             this arithmetic says {mib:.4} MiB"
        );
    }

    // The full-attention pool divides with the slot count instead of
    // replicating (`src/llama-context.cpp:289-302`: `n_ctx_seq = n_ctx /
    // n_seq_max`), so its 119.00 MiB is the same total at every np. That
    // divisibility is also why the plan's context-wide term carries no `N`:
    // only [`SlotCache`] replicates.
    let full_width_per_cell = 14 * 2 * (128 + 128);
    for slots in [1u64, 2, 4] {
        let per_slot = SECTION_7_CONTEXT / slots;
        let bytes = KvCache::Q8_0.geometry_bytes(full_width_per_cell * per_slot * slots);
        let mib = bytes as f64 / MIB as f64;
        assert!(
            (mib - 119.00).abs() < 0.005,
            "np={slots}: the engine logged 119.00 MiB of full-attention KV, \
             this arithmetic says {mib:.4} MiB"
        );
    }

    // The §7 finding in one line: once the context reaches the window the
    // PER-SLOT pool is constant, so four streams pay it four times. The
    // difference is the "+167 MiB" the doc names (223.12 - 55.78 = 167.34).
    let per_slot_one =
        slot_cache_bytes(trinity, SECTION_7_CONTEXT, KvCache::Q8_0, u64::from(UBATCH));
    let per_slot_four = slot_cache_bytes(
        trinity,
        SECTION_7_CONTEXT / 4,
        KvCache::Q8_0,
        u64::from(UBATCH),
    );
    assert_eq!(
        per_slot_four, per_slot_one,
        "a saturated per-slot pool must not change with the context"
    );
    let total_one = per_slot_one;
    let total_four = per_slot_four * 4;
    assert_eq!(
        total_four,
        total_one * 4,
        "four streams pay the window pool four times"
    );
    let delta_mib = (total_four - total_one) as f64 / MIB as f64;
    assert!(
        (delta_mib - 167.343_75).abs() < 0.005,
        "§7 measured +167 MiB for the replication, this arithmetic says {delta_mib:.4}"
    );
}

/// Every sliding-window row prices ITS OWN geometry, not Trinity's: window,
/// windowed layer count and per-cell width all differ. Each expected figure
/// carries where it came from, and a wrong row entry fails here rather than
/// silently funding a wrong context.
#[test]
fn each_sliding_window_row_prices_its_own_geometry() {
    // (row, window tokens, per-cell K+V elements, saturated MiB)
    let cases = [
        // Header + `afmoe.cpp` default: 42 x 2 x (128 + 128) = 21_504 per
        // cell, PAD(2048 + 512, 256) = 2560 cells.
        ("Arcee Trinity Nano", 2048u64, 21_504u64, 55.781_25f64),
        // Header (Explorer's read): 25 windowed x 8 x (256 + 256) = 102_400
        // per cell, PAD(1024 + 512, 256) = 1536 cells.
        ("Google Gemma 4 26B", 1024, 102_400, 159.375),
        // Header: 40 windowed x 8 x (256 + 256) = 163_840 per cell, 1536
        // cells — the "255 MiB fixed" half of the row's own 136+255.
        ("Google Gemma 4 12B", 1024, 163_840, 255.0),
        // Header + MEASUREMENT: `shared_kv_layers 18` leaves 20 windowed
        // layers with KV, not 35 — 20 x 2 x (256 + 256) = 20_480 per cell,
        // PAD(512 + 512, 256) = 1024 cells.
        ("Google Gemma 4 E4B", 512, 20_480, 21.25),
    ];
    for (name, window_tokens, width_per_cell, saturated_mib) in cases {
        let row = shipped_row(name);
        match row.slot_cache {
            SlotCache::SlidingWindow {
                window_tokens: window,
                width_per_cell: width,
            } => {
                assert_eq!(window, window_tokens, "{name}: window");
                assert_eq!(width, width_per_cell, "{name}: per-cell width");
            }
            other => panic!("{name} is a sliding-window row, not {other:?}"),
        }
        let saturating = u64::MAX;
        let bytes = slot_cache_bytes(row, saturating, KvCache::Q8_0, u64::from(UBATCH));
        let mib = bytes as f64 / MIB as f64;
        assert!(
            (mib - saturated_mib).abs() < 0.005,
            "{name}: saturated pool {mib:.5} MiB, expected {saturated_mib}"
        );
        // f16 is two bytes per element exactly, where q8_0 is 34/32, so the
        // ratio is 64/34 rather than 2 — that 2 belongs to the catalogue's
        // one-byte per-token convention, not to header geometry.
        let cells = sliding_window_cells(window_tokens, u64::from(UBATCH), saturating);
        assert_eq!(
            slot_cache_bytes(row, saturating, KvCache::F16, u64::from(UBATCH)),
            width_per_cell * cells * 2,
            "{name}: the f16 pool is two bytes per element"
        );
    }
}

/// The one sliding-window row whose HEADER alone is wrong. `gemma4.cpp:10`
/// sets `n_layer_kv_from_start = n_layer_all - shared_kv_layers = 42 - 18 =
/// 24`, and `llama-kv-cache.cpp:189` allocates no tensor for a layer without
/// KV, so only the 20 windowed layers among 0..23 hold a pool. MEASURED on the
/// v1.1.0 engine, the pinned file, ctx 16384, ubatch 512, q8_0,
/// `--parallel 1`:
///
/// ```text
/// llama_kv_cache_iswa: creating     SWA KV cache, size = 1024 cells
/// llama_kv_cache: size =   21.25 MiB (  1024 cells,  20 layers,  1/1 seqs)
/// ```
///
/// The 35-layer figure the pattern array alone suggests (38_993_920 B =
/// 37.19 MiB a slot) would over-charge this row by 75%; the measured figure is
/// pinned here so that regression names the log line.
#[test]
fn gemma_4_e4b_prices_the_measured_shared_kv_pool() {
    let e4b = shipped_row("Google Gemma 4 E4B");
    assert_eq!(
        slot_cache_bytes(e4b, u64::MAX, KvCache::Q8_0, u64::from(UBATCH)),
        22_282_240,
        "20 windowed layers x 1024 elements x 1024 cells x 34/32"
    );
    // The engine's own cell count at the app's shape (explicit -np 1), and
    // the four-slot replication §7's finding predicts for a window pool.
    assert_eq!(sliding_window_cells(512, u64::from(UBATCH), u64::MAX), 1024);
    assert_eq!(
        slot_cache_bytes(e4b, 4096, KvCache::Q8_0, u64::from(UBATCH)) * 4,
        89_128_960,
        "a saturated pool pays four times for four streams"
    );
    // And the header-only figure is larger, which is the trap this pins.
    let header_only = 35 * 2 * (256 + 256) * 1024 * 34 / 32;
    assert_eq!(header_only, 38_993_920);
    assert!(22_282_240 < header_only);
}

/// The recurrent rows, each with its own state and provenance. A recurrent
/// state is F32 and one row per sequence regardless of the context
/// (`llama-model.cpp:2681` feeds `max(1, n_seq_max)`; the R+S tensors are
/// `GGML_TYPE_F32`, `:2679-2680`), so `slot_cache_bytes` is a constant across
/// contexts AND across the cache-type knob.
#[test]
fn each_recurrent_row_prices_its_own_state() {
    // (row, bytes per slot)
    let cases = [
        // Qwen 3.6: 30 gated-delta-net layers (40 blocks,
        // `full_attention_interval 4`), R+S = 24_576 + 524_288 F32 elements.
        ("Alibaba Qwen 3.6", 65_863_680u64),
        // Granite 4 Tiny: 36 Mamba-style layers (head_count_kv is an array
        // whose four non-zero entries are layers 5/15/25/35), R+S = 3 x 3328
        // + 393_216 F32 elements.
        ("IBM Granite 4 Tiny", 58_060_800),
        // LFM 2.5: 18 shortconv-recurrent layers, conv history only,
        // `n_embd x (l_cache - 1)` = 2048 x 2 F32 elements.
        ("Liquid LFM 2.5", 294_912),
    ];
    for (name, bytes_per_slot) in cases {
        let row = shipped_row(name);
        match row.slot_cache {
            SlotCache::Recurrent {
                bytes_per_slot: got,
            } => {
                assert_eq!(got, bytes_per_slot, "{name}: state bytes per slot");
            }
            other => panic!("{name} is a recurrent row, not {other:?}"),
        }
        assert_eq!(
            slot_cache_bytes(row, 1, KvCache::Q8_0, u64::from(UBATCH)),
            bytes_per_slot
        );
        assert_eq!(
            slot_cache_bytes(row, 1_000_000, KvCache::Q8_0, u64::from(UBATCH)),
            bytes_per_slot,
            "{name}: the state must not grow with the context"
        );
        assert_eq!(
            slot_cache_bytes(row, 4096, KvCache::F16, u64::from(UBATCH)),
            bytes_per_slot,
            "{name}: R+S are F32, so the cache type must not scale them"
        );
    }
}

/// The Qwen row at the PLAN level: the recurrent state is subtracted before
/// the context is bought and is charged once per slot. `funded_maximum` is
/// the funded ceiling (the automatic launch is the smaller chat default).
#[test]
fn the_plan_charges_the_recurrent_state_to_every_slot() {
    let qwen = shipped_row("Alibaba Qwen 3.6");
    let budget = memory_budget(Backend::Metal, 64 * GIB);
    let four = plan(&LaunchInput {
        parallel: 4,
        ..input(ServerBackend::Metal, budget, qwen, M1_MAX_RAMP)
    })
    .expect("four slots of the row on disk are fundable");
    // The automatic context is the chat default a slot (65 536), not the
    // funded maximum; the recurrent state is paid on top of it, per slot.
    assert_eq!(four.args.context_tokens, 262_144);
    let term = slot_cache_bytes(qwen, four.args.context_tokens / 4, KvCache::Q8_0, 512);
    assert_eq!(
        four.memory.kv_cache_bytes,
        four.args.context_tokens * 40_960 + term * 4,
        "the flat figure plus four states is what must be reported"
    );
    // The same state subtracted from the total before the context is bought:
    // 540 672, not 262 144 times anything, because it is per stream.
    assert_eq!(
        funded_maximum(&LaunchInput {
            parallel: 4,
            ..input(ServerBackend::Metal, budget, qwen, M1_MAX_RAMP)
        }),
        Some(540_672)
    );
}

/// The one-slot argv does not move because a row gained its slot geometry.
/// Compared against the same row with the geometry removed — exactly the
/// pre-change arithmetic. Two things absorb the term at one slot on this Mac:
/// the automatic launch is the 65 536-token chat default, far below every
/// funded ceiling here, and the trained cap binds the sliding-window rows. A
/// future row whose one-slot context is memory-bound with a per-slot term
/// WOULD move, and this test is where that change gets reviewed.
#[test]
fn the_one_slot_argv_is_identical_with_and_without_the_slot_geometry() {
    let budget = memory_budget(Backend::Metal, 64 * GIB);
    for row in usable() {
        let entry = row.entry();
        let without = ModelEntry {
            slot_cache: SlotCache::None,
            ..*entry
        };
        let with = plan(&input(ServerBackend::Metal, budget, entry, M1_MAX_RAMP))
            .unwrap_or_else(|| panic!("{} must be fundable at one slot here", entry.display_name));
        let bare = plan(&input(ServerBackend::Metal, budget, &without, M1_MAX_RAMP))
            .expect("removing a per-slot term cannot make a row unfundable");
        assert_eq!(
            with.args.argv(),
            bare.args.argv(),
            "{}: the one-slot argv moved when its slot geometry appeared",
            entry.display_name
        );
        let line = with.args.argv().join(" ");
        assert!(
            line.contains("--parallel 1"),
            "{}: {line}",
            entry.display_name
        );
    }
}
