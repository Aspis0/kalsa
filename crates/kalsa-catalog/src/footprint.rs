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

/// The compute buffers (the micro-batch's attention and FFN intermediates):
/// they follow the batch, not the model, which is the naive formula's first
/// mistake. Measured on the shipped build with the shipped Trinity row at
/// the shipped ubatch 512, the allocator reports ~60 MiB where the weights
/// are ~4 GiB; the forfait stays 512 MiB on purpose, because a large dense
/// row's buffers cost more than an MoE's and the point of a forfait is to
/// stop the arithmetic from chasing per-model measurements.
pub const COMPUTE_BUFFER_BYTES: u64 = 512 * MIB;

/// Until a row carries its measured `kv_bytes_per_token`, assume the
/// pessimistic end of a quantised grouped-query cache: two tensors, eight KV
/// heads of 128 dimensions, one byte each — the q8_0 cache the launcher
/// pins, which a measured row's figure also assumes — forty-eight layers —
/// 96 KiB per
/// token, which is above every dense model in this catalog and only below the
/// largest. That one row is not offered on the assumption (see
/// `ModelEntry::kv_assumption_undercounts`): the constant errs safe for every
/// other row, and inflating it to cover the largest would halve their
/// contexts to buy insurance they do not need.
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
    /// True when the budget is sized for the path the model will take: system
    /// RAM on a CPU machine or in unified memory, the card's own memory for a
    /// discrete GPU whose size could be read. False means a discrete GPU is
    /// present but unmeasured: the budget fell back to system RAM and the GPU
    /// is NOT accounted for — said here, never guessed around.
    pub gpu_accounted_for: bool,
}

/// The budget for this machine's path. A model that will decode on a discrete
/// GPU is budgeted by the card's memory, because system RAM is irrelevant to
/// it: a 32 GiB PC with a 6 GiB card is a 3 GiB machine for this decision.
/// The margin applies to VRAM the same way it applies to RAM — the desktop
/// compositor and the browser keep VRAM for themselves exactly as the OS
/// keeps RAM, and no fraction of a small card is enough for them either.
pub fn memory_budget(backend: Backend, ram_bytes: u64) -> MemoryBudget {
    match backend {
        Backend::DiscreteGpu {
            vram_bytes: Some(vram),
        } => MemoryBudget {
            usable_bytes: usable_bytes(vram),
            gpu_accounted_for: true,
        },
        // Unified memory: the GPU decodes out of system RAM, so the RAM budget
        // is the whole story and nothing is left unaccounted for.
        Backend::Cpu | Backend::Metal => MemoryBudget {
            usable_bytes: usable_bytes(ram_bytes),
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
}

impl Footprint {
    /// Saturating all the way: a saturated KV term plus weights must stay
    /// impossible, not wrap back down into a model that looks like it fits.
    pub fn total_bytes(&self) -> u64 {
        self.weights_bytes
            .saturating_add(self.mmproj_bytes)
            .saturating_add(self.buffer_bytes)
            .saturating_add(self.kv_bytes)
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
    }
}

pub fn fits(entry: &ModelEntry, context_tokens: u64, budget: &MemoryBudget) -> bool {
    footprint_bytes(entry, context_tokens).total_bytes() <= budget.usable_bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{rows, SlotCache};

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
        // The largest row's cache is measured from its pinned file's header
        // (80 layers × 8 KV heads × 256 elements, one byte at q8_0), so its
        // footprint at a realistic context is sized from the measurement, not
        // from the constant that under-counts it by 1.7×.
        let apertus = rows()
            .find(|entry| entry.repo.starts_with("swiss-ai/"))
            .expect("apertus is in the catalog");
        assert_eq!(apertus.kv_bytes_per_token, Some(163_840));
        let footprint = footprint_bytes(apertus, 8192);
        assert_eq!(footprint.kv_bytes, 163_840 * 8192);
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
    fn the_budget_follows_the_path_the_model_will_take() {
        // A discrete card is budgeted by its own memory, not the machine's
        // RAM: a 32 GiB PC with a 6 GiB card is a 3 GiB machine for this
        // decision, and the RAM it also has must not size the model.
        let card = memory_budget(
            Backend::DiscreteGpu {
                vram_bytes: Some(6 * GIB),
            },
            32 * GIB,
        );
        assert_eq!(card.usable_bytes, 3 * GIB);
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
