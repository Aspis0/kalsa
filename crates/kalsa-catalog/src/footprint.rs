//! The memory arithmetic, and the numbers behind it.
//!
//! ```text
//! weights + mmproj + compute buffers + KV + margin <= usable RAM
//! ```
//!
//! Three of those terms are choices, and the plan is explicit about two of them:
//! compute buffers follow the micro-batch we ship rather than the model size,
//! and KV per token must be *measured* per model — the manifest carries the
//! measurement, and until a row has one this module says out loud that it
//! assumed a figure instead of presenting it as data.

use kalsa_probe::Backend;

use crate::manifest::ModelEntry;

pub const MIB: u64 = 1024 * 1024;
pub const KIB: u64 = 1024;
pub const GIB: u64 = 1024 * MIB;

/// What the operating system and whatever else the user has open keep for
/// themselves.
///
/// A fixed floor, not a percentage: a current Windows idles around 3 GiB and a
/// browser adds one to three more, and no fraction of an 8 GiB machine is enough
/// for that. A quarter, on top, covers the fact that the OS does not grow in
/// proportion once the machine is large — 16 GiB on a 64 GiB machine is more
/// than Windows will ever want for itself.
pub const MARGIN_FLOOR_BYTES: u64 = 3 * GIB;
pub const MARGIN_FRACTION: f64 = 0.25;

/// What the card keeps for everything that is not the model, as its own
/// measured floor rather than the RAM margin. One GiB — the number the
/// engine's planner already refuses to go under (`will leave 1515 >= 1024
/// MiB of free device memory`, twice, in the load log quoted at
/// docs/VRAM-LENOVO-2026-09-28.md §3), measured on the owner's Lenovo
/// (§6): the worst peak on that card, 3 800 MiB, still left 2 341 MiB of
/// the 6 141 MiB card free, against an idle desktop that read 0 MiB there
/// and at most ≈ 221 MiB on 09-26 (§4). The owner approved replacing
/// `max(3 GiB, 25%)` with this: "replace the VRAM margin with a smaller,
/// measured one". A percentage of a small card was never what the desktop
/// took from it.
pub const VRAM_MARGIN_BYTES: u64 = GIB;

/// The compute buffers (the micro-batch's attention and FFN intermediates):
/// they follow the batch, not the model, which is the naive formula's first
/// mistake. Measured on the shipped build with a 4 GiB MoE row at
/// the shipped ubatch 512, the allocator reports ~60 MiB where the weights
/// are ~4 GiB; the forfait stays 512 MiB on purpose, because a large dense
/// row's buffers cost more than an MoE's and the point of a forfait is to
/// stop the arithmetic from chasing per-model measurements.
pub const COMPUTE_BUFFER_BYTES: u64 = 512 * MIB;

/// Until a row carries its measured `kv_bytes_per_token`, assume the
/// pessimistic end of a quantised grouped-query cache: two tensors, eight KV
/// heads of 128 dimensions, one byte each — the q8_0 cache the launcher
/// pins, which a measured row's figure also assumes — forty-eight layers —
/// 96 KiB per token. No row in the tables today carries a measured figure
/// above it; a row research finds this constant under-counts is not offered
/// on the assumption at all (see `ModelEntry::kv_assumption_undercounts`).
/// If a measured figure ever exceeded the constant, raising the constant
/// to cover it would shrink the context funded for every row still priced
/// on it — insurance those rows do not need.
pub const ASSUMED_KV_BYTES_PER_TOKEN: u64 = 96 * KIB;

/// What the machine can give a model.
pub fn usable_bytes(ram_bytes: u64) -> u64 {
    let margin = MARGIN_FLOOR_BYTES.max((ram_bytes as f64 * MARGIN_FRACTION) as u64);
    ram_bytes.saturating_sub(margin)
}

/// The memory a model may occupy, and whether that memory is the memory the
/// model will actually run in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MemoryBudget {
    pub usable_bytes: u64,
    /// True when `usable_bytes` is the CARD's memory: on this budget a row's
    /// [`host_bytes_on_gpu`] are not charged to it, because they never enter
    /// the card. False for every budget sized in system RAM — where those
    /// bytes run, and are charged as part of the file, as they always were.
    pub card_sized: bool,
    /// True when the budget is sized for the path the model will take: system
    /// RAM on a CPU machine or in unified memory, the card's own memory for a
    /// discrete GPU whose size could be read. False means a discrete GPU is
    /// present but unmeasured: the budget fell back to system RAM and the GPU
    /// is NOT accounted for — said here, never guessed around.
    pub gpu_accounted_for: bool,
}

/// The budget for this machine's path. A model that will decode on a discrete
/// GPU is budgeted by the card's memory, because system RAM is irrelevant to
/// it: a 32 GiB PC with a 6 GiB card is a machine with a 6 GiB card for this
/// decision. The card's margin is its own floor — [`VRAM_MARGIN_BYTES`], one
/// GiB, the number the engine's planner enforces and the desktop on the
/// machine that measured it never approached (docs/VRAM-LENOVO-2026-09-28.md
/// §3–§4) — not [`MARGIN_FLOOR_BYTES`]/[`MARGIN_FRACTION`], which stay the
/// RAM margin for the paths that run in RAM.
pub fn memory_budget(backend: Backend, ram_bytes: u64) -> MemoryBudget {
    match backend {
        Backend::DiscreteGpu {
            vram_bytes: Some(vram),
        } => MemoryBudget {
            usable_bytes: vram.saturating_sub(VRAM_MARGIN_BYTES),
            card_sized: true,
            gpu_accounted_for: true,
        },
        // Unified memory: the GPU decodes out of system RAM, so the RAM budget
        // is the whole story and nothing is left unaccounted for.
        Backend::Cpu | Backend::Metal => MemoryBudget {
            usable_bytes: usable_bytes(ram_bytes),
            card_sized: false,
            gpu_accounted_for: true,
        },
        // A card whose size could not be read honestly: the chooser refuses
        // this case before any offer is built — a model that will decode on
        // the card must fit it entirely, and the size is unknown. The
        // fallback here only keeps the function total. An undetected machine
        // gets the CPU budget with the same honesty: nothing unlisted is
        // accounted for.
        Backend::DiscreteGpu { vram_bytes: None } | Backend::Unknown => MemoryBudget {
            usable_bytes: usable_bytes(ram_bytes),
            card_sized: false,
            gpu_accounted_for: false,
        },
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Footprint {
    pub weights_bytes: u64,
    pub mmproj_bytes: u64,
    pub buffer_bytes: u64,
    pub kv_bytes: u64,
    /// A second model resident beside the weights (a speculative decoder's
    /// drafter): wherever the row runs, it runs too, so the fit charges it.
    /// Zero on every row that runs alone, and on the machine with no room
    /// for one beside the row — there the chooser drops the drafter, never
    /// the row.
    pub drafter_bytes: u64,
}

impl Footprint {
    /// Saturating all the way: a saturated KV term plus weights must stay
    /// impossible, not wrap back down into a model that looks like it fits.
    pub fn total_bytes(&self) -> u64 {
        self.weights_bytes
            .saturating_add(self.mmproj_bytes)
            .saturating_add(self.buffer_bytes)
            .saturating_add(self.kv_bytes)
            .saturating_add(self.drafter_bytes)
    }

    /// True when the row has no measured cache size and we had to assume one.
    pub fn kv_is_assumed(&self, entry: &ModelEntry) -> bool {
        entry.kv_bytes_per_token.is_none()
    }
}

pub fn footprint_bytes(entry: &ModelEntry, context_tokens: u64) -> Footprint {
    let per_token = entry
        .kv_bytes_per_token
        .unwrap_or(ASSUMED_KV_BYTES_PER_TOKEN);
    Footprint {
        weights_bytes: entry.weights_bytes,
        mmproj_bytes: entry.mmproj_bytes.unwrap_or(0),
        buffer_bytes: COMPUTE_BUFFER_BYTES,
        kv_bytes: per_token.saturating_mul(context_tokens),
        // The row's own file only: a drafter rides beside the row, so the
        // caller that knows one runs charges its bytes — the chooser to the
        // fit, the launcher to the window it funds.
        drafter_bytes: 0,
    }
}

/// Bytes of this row that never enter a discrete card: the engine's
/// `CPU_Mapped` buffer. The load logs on the owner's Lenovo print them for
/// two rows, quoted in docs/VRAM-LENOVO-2026-09-28.md §3 — Gemma 4 E4B
/// Q4_K_M leaves **2 208.00 MiB** (2_315_556_864 bytes) of its per-layer
/// embeddings in host memory while "offloaded 43/43 layers to GPU", and
/// LFM2.5-2.6B Q8_0 leaves **265.62 MiB** (278_527_367 bytes — the log
/// prints two decimals) of its output weight. The sizes are measured; what
/// the tensors are is the report's INFERRED reading of them. `None` on
/// every row nobody has measured this way — nothing is guessed, and such a
/// row is charged whole, exactly as before.
pub fn host_bytes_on_gpu(entry: &ModelEntry) -> Option<u64> {
    match (entry.repo, entry.quant) {
        ("google/gemma-4-E4B-it", "Q4_K_M") => Some(2_315_556_864),
        ("LiquidAI/LFM2.5-2.6B", "Q8_0") => Some(278_527_367),
        _ => None,
    }
}

/// What a row has to fit: its whole footprint on a budget sized in system
/// RAM — those bytes are in RAM where the row runs, so they are charged
/// there as part of the file — and on a card's budget the footprint minus
/// [`host_bytes_on_gpu`], because they never enter the card. Nothing is
/// dropped from the arithmetic; each byte is charged where it lives, and
/// `weights_bytes` still says what the file weighs on either path.
pub fn fits_footprint(entry: &ModelEntry, footprint: &Footprint, budget: &MemoryBudget) -> bool {
    let total = footprint.total_bytes();
    let charged = if budget.card_sized {
        total.saturating_sub(host_bytes_on_gpu(entry).unwrap_or(0))
    } else {
        total
    };
    charged <= budget.usable_bytes
}

pub fn fits(entry: &ModelEntry, context_tokens: u64, budget: &MemoryBudget) -> bool {
    fits_footprint(entry, &footprint_bytes(entry, context_tokens), budget)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{rows, Sampling, SlotCache};

    fn dense_row(weights_bytes: u64) -> ModelEntry {
        ModelEntry {
            repo: "test/dense",
            display_name: "Test Dense",
            last_modified: "2026-01-01",
            licence: crate::licence::Licence::Open("apache-2.0"),
            parameters: crate::parameters::Parameters::dense(8_000_000_000),
            quant: "Q4_K_M",
            weights_bytes,
            mmproj_bytes: None,
            kv_bytes_per_token: None,
            slot_cache: SlotCache::None,
            kv_assumption_undercounts: false,
            dense_equivalent: None,
            measured_decode: None,
            // The fixture's limit is the memory's, so the trained cap never binds.
            trained_context_tokens: None,
            stale: None,
            sampling: Sampling::default(),
        }
    }

    #[test]
    fn the_margin_is_a_floor_on_small_machines_and_a_share_on_large_ones() {
        assert_eq!(usable_bytes(8 * GIB), 5 * GIB);
        assert_eq!(usable_bytes(12 * GIB), 9 * GIB);
        assert_eq!(usable_bytes(32 * GIB), 24 * GIB);
        assert_eq!(usable_bytes(64 * GIB), 48 * GIB);
        // A machine smaller than the floor gives nothing, and does not underflow.
        assert_eq!(usable_bytes(2 * GIB), 0);
    }

    #[test]
    fn the_footprint_is_the_sum_of_its_parts() {
        let row = dense_row(4 * GIB);
        let footprint = footprint_bytes(&row, 8192);
        assert_eq!(footprint.weights_bytes, 4 * GIB);
        assert_eq!(footprint.buffer_bytes, COMPUTE_BUFFER_BYTES);
        assert_eq!(footprint.kv_bytes, 96 * KIB * 8192);
        assert_eq!(
            footprint.total_bytes(),
            4 * GIB + COMPUTE_BUFFER_BYTES + 96 * KIB * 8192
        );
        assert!(footprint.kv_is_assumed(&row), "no measured KV on this row");
    }

    #[test]
    fn a_measured_cache_size_is_used_instead_of_the_assumption() {
        let mut row = dense_row(4 * GIB);
        row.kv_bytes_per_token = Some(16 * KIB);
        let footprint = footprint_bytes(&row, 8192);
        assert_eq!(footprint.kv_bytes, 16 * KIB * 8192);
        assert!(!footprint.kv_is_assumed(&row));
    }

    #[test]
    fn the_biggest_row_does_not_fit_the_smallest_tier() {
        let biggest = rows()
            .max_by_key(|entry| entry.weights_bytes)
            .expect("catalog is not empty");
        assert!(!fits(biggest, 8192, &memory_budget(Backend::Cpu, 16 * GIB)));
        assert!(fits(biggest, 8192, &memory_budget(Backend::Cpu, 64 * GIB)));
    }

    #[test]
    fn the_measured_figure_reaches_the_footprint() {
        // The row's cache is measured from its pinned file's header
        // (40 blocks × 2 KV heads × (256 + 256) elements, one byte at q8_0),
        // so its footprint at a realistic context is sized from the
        // measurement, not from the shared constant.
        let qwen = rows()
            .find(|entry| entry.repo == "Qwen/Qwen3.6-35B-A3B")
            .expect("qwen 3.6 is in the catalog");
        assert_eq!(qwen.kv_bytes_per_token, Some(40_960));
        let footprint = footprint_bytes(qwen, 8192);
        assert_eq!(footprint.kv_bytes, 40_960 * 8192);
    }

    #[test]
    fn an_absurd_context_cannot_wrap_into_a_small_model() {
        // The KV term saturates at u64::MAX; the sum must saturate with it,
        // or an absurd context wraps an impossible model back down into one
        // that looks like it fits. Saturating one multiplication and not the
        // sum is half a defence.
        let row = dense_row(4 * GIB);
        let footprint = footprint_bytes(&row, u64::MAX);
        assert_eq!(footprint.kv_bytes, u64::MAX);
        assert_eq!(footprint.total_bytes(), u64::MAX);
        assert!(!fits(
            &row,
            u64::MAX,
            &memory_budget(Backend::Cpu, 64 * GIB)
        ));
    }

    #[test]
    fn the_card_budget_is_the_measured_floor_not_a_share_of_the_card() {
        // The owner's Lenovo, as the measurement report states it
        // (docs/VRAM-LENOVO-2026-09-28.md §6): the card reads 6 141 MiB and
        // the approved floor is one GiB, so the budget is 5 117 MiB — the
        // number the measured peaks (3 800, 3 496, 3 436, 3 132 MiB) all
        // fit with room to spare. The RAM side is untouched: 32 GiB still
        // budgets 24 GiB, and Metal still budgets RAM less 25%.
        let card = memory_budget(
            Backend::DiscreteGpu {
                vram_bytes: Some(6_141 * MIB),
            },
            32 * GIB,
        );
        assert_eq!(card.usable_bytes, 5_117 * MIB, "the report's own figure");
        assert_eq!(card.usable_bytes, 6_141 * MIB - VRAM_MARGIN_BYTES);

        let ram = memory_budget(Backend::Cpu, 32 * GIB);
        assert_eq!(ram.usable_bytes, usable_bytes(32 * GIB));
        let mac = memory_budget(Backend::Metal, 16 * GIB);
        assert_eq!(mac.usable_bytes, usable_bytes(16 * GIB));
    }

    #[test]
    fn a_row_that_keeps_weights_in_host_memory_is_charged_to_the_card_they_never_enter() {
        // The Lenovo's load logs, as the report quotes them
        // (docs/VRAM-LENOVO-2026-09-28.md §3): Gemma 4 E4B leaves
        // 2 208.00 MiB of its per-layer embeddings in a CPU_Mapped buffer
        // while all 43 layers are offloaded; LFM2.5 leaves 265.62 MiB of
        // its output weight there. Only those two rows carry a figure —
        // measured sizes, on rows the log printed — and nothing else
        // guesses one.
        let find = |repo: &str| {
            rows()
                .find(|entry| entry.repo == repo)
                .expect("the row is in the catalog")
        };
        let e4b = find("google/gemma-4-E4B-it");
        let lfm = find("LiquidAI/LFM2.5-2.6B");
        assert_eq!(host_bytes_on_gpu(e4b), Some(2_315_556_864), "2 208.00 MiB");
        assert_eq!(host_bytes_on_gpu(lfm), Some(278_527_367), "265.62 MiB");
        assert_eq!(
            host_bytes_on_gpu(find("google/gemma-4-12B-it")),
            None,
            "unmeasured rows are charged whole, as they always were"
        );

        // The card as the report measures it: 6 141 MiB with the one-GiB
        // floor — 5 117 MiB — where the catalog's own estimates for these
        // two rows are 5 802 and 3 798 MiB at 65 536 tokens (§2).
        let card = memory_budget(
            Backend::DiscreteGpu {
                vram_bytes: Some(6_141 * MIB),
            },
            32 * GIB,
        );
        let at_64k = footprint_bytes(e4b, 65_536);
        assert_eq!(at_64k.total_bytes(), 6_084_467_840, "the report's estimate");
        assert!(
            at_64k.total_bytes() > card.usable_bytes,
            "charged whole, the file is over the card"
        );
        assert!(
            fits_footprint(e4b, &at_64k, &card),
            "the card holds the 3 594 MiB that actually enter it"
        );
        let lfm_fp = footprint_bytes(lfm, 65_536);
        assert_eq!(lfm_fp.total_bytes(), 3_982_075_904, "the report's estimate");
        assert!(fits_footprint(lfm, &lfm_fp, &card));

        // The host bytes are not dropped: on a budget sized in RAM the whole
        // file is still charged, host-mapped bytes and all.
        let ram = memory_budget(Backend::Cpu, 8 * GIB);
        assert_eq!(ram.usable_bytes, 5 * GIB);
        assert!(
            !fits_footprint(e4b, &at_64k, &ram),
            "a 5 GiB RAM budget holds no row whose file weighs 5 802 MiB"
        );
        assert!(
            fits_footprint(lfm, &lfm_fp, &ram),
            "and the LFM file fits it whole — nothing was subtracted"
        );
        assert!(!ram.card_sized, "a RAM budget never subtracts");
    }

    #[test]
    fn the_budget_follows_the_path_the_model_will_take() {
        // A discrete card is budgeted by its own memory, not the machine's
        // RAM: a 32 GiB PC with a 6 GiB card is a machine with a 6 GiB card
        // for this decision, and the RAM it also has must not size the
        // model. The card's margin is its own one-GiB floor (measured —
        // [`VRAM_MARGIN_BYTES`]), not the RAM margin the rest of this test
        // keeps pinning.
        let card = memory_budget(
            Backend::DiscreteGpu {
                vram_bytes: Some(6 * GIB),
            },
            32 * GIB,
        );
        assert_eq!(card.usable_bytes, 6 * GIB - VRAM_MARGIN_BYTES);
        assert!(card.gpu_accounted_for);

        // Apple Silicon decodes through Metal out of unified memory: system
        // RAM is the budget and nothing is left unaccounted for.
        let mac = memory_budget(Backend::Metal, 16 * GIB);
        assert_eq!(mac.usable_bytes, usable_bytes(16 * GIB));
        assert!(mac.gpu_accounted_for);

        // A card whose size could not be read honestly: fall back to the RAM
        // arithmetic and say the GPU was not accounted for — never guess a
        // VRAM size.
        let unread = memory_budget(Backend::DiscreteGpu { vram_bytes: None }, 32 * GIB);
        assert_eq!(unread.usable_bytes, usable_bytes(32 * GIB));
        assert!(!unread.gpu_accounted_for);

        // Detection found nothing at all: the RAM budget, same honesty.
        let unknown = memory_budget(Backend::Unknown, 32 * GIB);
        assert_eq!(unknown.usable_bytes, usable_bytes(32 * GIB));
        assert!(!unknown.gpu_accounted_for);

        // CPU only: the RAM budget is the whole story.
        let cpu = memory_budget(Backend::Cpu, 8 * GIB);
        assert_eq!(cpu.usable_bytes, 5 * GIB);
        assert!(cpu.gpu_accounted_for);
    }
}
