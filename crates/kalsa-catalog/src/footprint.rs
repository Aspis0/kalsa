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

/// Buffers for the micro-batch the supervisor ships (ubatch 128): they follow
/// the batch, not the model, which is the naive formula's first mistake.
pub const COMPUTE_BUFFER_BYTES: u64 = 512 * MIB;

/// Until a row carries its measured `kv_bytes_per_token`, assume the
/// pessimistic end of a quantised grouped-query cache: two tensors, eight KV
/// heads of 128 dimensions, one byte each, forty-eight layers — 96 KiB per
/// token, which is above every dense model in this catalog and only below the
/// largest.
pub const ASSUMED_KV_BYTES_PER_TOKEN: u64 = 96 * KIB;

/// What the machine can give a model.
pub fn usable_bytes(ram_bytes: u64) -> u64 {
    let margin = MARGIN_FLOOR_BYTES.max((ram_bytes as f64 * MARGIN_FRACTION) as u64);
    ram_bytes.saturating_sub(margin)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Footprint {
    pub weights_bytes: u64,
    pub mmproj_bytes: u64,
    pub buffer_bytes: u64,
    pub kv_bytes: u64,
}

impl Footprint {
    pub fn total_bytes(&self) -> u64 {
        self.weights_bytes + self.mmproj_bytes + self.buffer_bytes + self.kv_bytes
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

pub fn fits(entry: &ModelEntry, context_tokens: u64, ram_bytes: u64) -> bool {
    footprint_bytes(entry, context_tokens).total_bytes() <= usable_bytes(ram_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::CATALOG;

    fn dense_row(weights_bytes: u64) -> ModelEntry {
        ModelEntry {
            repo: "test/dense",
            gguf_repo: None,
            last_modified: "2026-01-01",
            licence: crate::licence::Licence::Open("apache-2.0"),
            parameters: crate::parameters::Parameters::dense(8_000_000_000),
            quant: "Q4_K_M",
            weights_bytes,
            mmproj_bytes: None,
            kv_bytes_per_token: None,
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
        let biggest = CATALOG
            .iter()
            .max_by_key(|entry| entry.weights_bytes)
            .expect("catalog is not empty");
        assert!(!fits(biggest, 8192, 16 * GIB));
        assert!(fits(biggest, 8192, 64 * GIB));
    }
}
