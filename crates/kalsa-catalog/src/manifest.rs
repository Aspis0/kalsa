//! Every model we have researched, usable or not.
//!
//! Rows arrive from the Hugging Face API (`lastModified`, `cardData.license`)
//! and are never edited from memory. The three refused rows stay here on
//! purpose: they were evaluated, and the next reader deserves to know why they
//! are not in the running instead of redoing the work.
//!
//! Two vintages of row share this table, and they do not make the same claim
//! about their sizes. The research-table rows record GiB rounded to two
//! decimals, so bytes are that × 2^30 and printing byte precision from a
//! rounded figure would be false precision. The rows verified against the
//! Hugging Face API on 2026-09-14 carry the exact size of the exact file from
//! the GGUF repo's tree — byte precision there is a measurement. `gguf_repo`
//! tells the vintages apart: only rows the API was actually asked about carry
//! one.

use crate::licence::{Licence, Standing};
use crate::parameters::Parameters;

pub const GIB: u64 = 1024 * 1024 * 1024;

/// The research-table helper: keep that shape so nobody later mistakes it for
/// a file size measured to the byte. The verified rows below write their bytes
/// literally instead.
const fn gigabytes(whole: u64, centi: u64) -> u64 {
    whole * GIB + GIB * centi / 100
}

#[derive(Clone, Copy, Debug)]
pub struct ModelEntry {
    /// Hugging Face repo of the base model.
    pub repo: &'static str,
    /// Repo the GGUF comes from, as the Hugging Face API reports it today.
    ///
    /// None until the API is asked: writing a plausible repo name from memory is
    /// how a download 404s a week later.
    pub gguf_repo: Option<&'static str>,
    /// `lastModified` from the API, verbatim.
    pub last_modified: &'static str,
    pub licence: Licence,
    pub parameters: Parameters,
    pub quant: &'static str,
    pub weights_bytes: u64,
    /// Separate vision projector, when the model needs one.
    pub mmproj_bytes: Option<u64>,
    /// Measured per the plan. None until it is measured: the chooser then says
    /// out loud that it assumed a figure.
    pub kv_bytes_per_token: Option<u64>,
    /// Superseded by newer rows in the same tier.
    pub stale: Option<&'static str>,
}

impl ModelEntry {
    pub fn standing(&self) -> Standing {
        if let Some(reason) = self.licence.refusal() {
            return Standing::Excluded { reason };
        }
        match self.stale {
            Some(reason) => Standing::Excluded { reason },
            None => Standing::Usable,
        }
    }

    pub fn is_usable(&self) -> bool {
        self.standing().is_usable()
    }
}

/// A row that passed every gate.
///
/// The only way to hold one is to receive it from this module, which is what
/// makes "a research-only licence can never be recommended" a property of the
/// code rather than a rule someone remembers to follow.
#[derive(Clone, Copy, Debug)]
pub struct UsableEntry<'a>(&'a ModelEntry);

impl<'a> UsableEntry<'a> {
    pub fn entry(&self) -> &'a ModelEntry {
        self.0
    }
}

#[cfg(test)]
impl<'a> UsableEntry<'a> {
    /// Unit tests need to hand a synthetic row to the chooser's internals; the
    /// chooser itself can only ever receive what `usable()` produces.
    pub(crate) fn for_test(entry: &'a ModelEntry) -> Self {
        Self(entry)
    }
}

/// The nine rows the research verified, three it refused, and four the API
/// verified on 2026-09-14.
///
/// Bytes in the research rows are the table's GiB × 2^30: 3.22 GiB is
/// 3_457_363_886 bytes as recorded, not a claim about the exact file. The
/// 2026-09-14 rows carry the exact file size from the repo tree instead, so
/// byte precision there is real.
pub const CATALOG: &[ModelEntry] = &[
    ModelEntry {
        repo: "google/gemma-4-E2B-it",
        gguf_repo: None,
        last_modified: "2026-07-20",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(5_100_000_000, 2_300_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(3, 22),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        stale: None,
    },
    ModelEntry {
        repo: "google/gemma-4-E4B-it",
        gguf_repo: None,
        last_modified: "2026-07-20",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(8_000_000_000, 4_500_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(5, 3),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        stale: None,
    },
    ModelEntry {
        repo: "Qwen/Qwen3.5-4B",
        gguf_repo: None,
        last_modified: "2026-03-02",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::dense(4_000_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(2, 81),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        stale: None,
    },
    ModelEntry {
        repo: "mistralai/Ministral-3-8B-Instruct-2512",
        gguf_repo: None,
        last_modified: "2026-07-15",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::dense(8_800_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(4, 84),
        mmproj_bytes: Some(gigabytes(0, 86)),
        kv_bytes_per_token: None,
        stale: None,
    },
    ModelEntry {
        repo: "google/gemma-4-12B-it",
        gguf_repo: None,
        last_modified: "2026-07-20",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::dense(11_950_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(7, 14),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        stale: None,
    },
    ModelEntry {
        repo: "google/gemma-4-26B-A4B-it",
        gguf_repo: None,
        last_modified: "2026-07-20",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(25_200_000_000, 3_800_000_000),
        quant: "Q4_0",
        weights_bytes: gigabytes(13, 61),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        stale: None,
    },
    ModelEntry {
        repo: "Qwen/Qwen3.6-35B-A3B",
        gguf_repo: None,
        last_modified: "2026-04-24",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(35_000_000_000, 3_000_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(19, 2),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        stale: None,
    },
    ModelEntry {
        repo: "llm-jp/llm-jp-4-32b-a3b-thinking",
        gguf_repo: None,
        last_modified: "2026-04-24",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(32_100_000_000, 3_830_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(19, 93),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        stale: None,
    },
    ModelEntry {
        repo: "swiss-ai/Apertus-v1.5-70B",
        gguf_repo: None,
        last_modified: "2026-07-24",
        licence: Licence::Open("apache-2.0+AUP"),
        parameters: Parameters::dense(70_000_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(40, 72),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        stale: None,
    },
    // ── verified against the Hugging Face API on 2026-09-14 ─────────────────
    // `weights_bytes` here is the exact size of the exact GGUF file in the
    // repo's tree, `last_modified` is verbatim from the API, and each row
    // carries the gguf repo it was verified against. None of them needs an
    // mmproj, and none carries a KV figure: that is measured, never guessed.
    ModelEntry {
        repo: "LiquidAI/LFM2.5-8B-A1B",
        gguf_repo: Some("liodon-ai/LFM2.5-8B-A1B-imatrix-GGUF"),
        last_modified: "2026-08-24T21:05:21.000Z",
        // LFM 1.0 permits commercial use only for entities under $10M annual
        // revenue: a condition on whoever ships a paid fine-tune of this base,
        // not a refusal of the row. See Licence::Conditional.
        licence: Licence::Conditional {
            id: "lfm1.0",
            condition: "commercial use only for entities under $10M annual revenue",
        },
        parameters: Parameters::mixture(8_300_000_000, 1_500_000_000),
        quant: "IQ4_XS",
        weights_bytes: 4_588_301_888,
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        stale: None,
    },
    ModelEntry {
        repo: "microsoft/Phi-mini-MoE-instruct",
        gguf_repo: Some("smarttasks/Phi-mini-MoE-instruct-GGUF"),
        last_modified: "2025-12-10T18:20:28.000Z",
        licence: Licence::Open("mit"),
        parameters: Parameters::mixture(7_600_000_000, 2_400_000_000),
        quant: "Q4_K_S",
        weights_bytes: 4_616_170_016,
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        stale: None,
    },
    ModelEntry {
        repo: "ibm-granite/granite-4.0-h-tiny",
        gguf_repo: Some("ibm-granite/granite-4.0-h-tiny-GGUF"),
        last_modified: "2025-11-03T19:42:57.000Z",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(7_000_000_000, 1_000_000_000),
        quant: "Q4_K_M",
        weights_bytes: 4_230_976_352,
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        stale: None,
    },
    ModelEntry {
        repo: "arcee-ai/Trinity-Nano-Preview",
        gguf_repo: Some("arcee-ai/Trinity-Nano-Preview-GGUF"),
        last_modified: "2026-05-28T22:45:39.000Z",
        // OpenMDW permits commercial use and modification; preserving licence
        // and notices, and terminating rights on a patent suit, is the same
        // standard permissive package MIT and Apache-2.0 ship under other
        // words, so this is Open rather than its own category.
        licence: Licence::Open("openmdw-1.1"),
        parameters: Parameters::mixture(6_000_000_000, 1_000_000_000),
        quant: "Q4_K_M",
        weights_bytes: 3_786_957_088,
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        stale: None,
    },
    // ── refused, kept for the record ────────────────────────────────────────
    ModelEntry {
        repo: "amd/Instella-MoE-16B-A3B-Think",
        gguf_repo: None,
        last_modified: "2026-08-01",
        licence: Licence::Blocked {
            id: "researchrail",
            reason: "research only: a paid fine-tune of this base would not be licit",
        },
        parameters: Parameters::mixture(16_000_000_000, 2_800_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(9, 75),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        stale: None,
    },
    ModelEntry {
        repo: "openai/gpt-oss-20b",
        gguf_repo: None,
        last_modified: "2025-08-05",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(21_000_000_000, 3_600_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(11, 60),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        stale: Some("2025 model, superseded in its tier by the 2026 MoE rows"),
    },
    ModelEntry {
        repo: "Qwen/Qwen3-30B-A3B",
        gguf_repo: None,
        last_modified: "2025-04-28",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(30_500_000_000, 3_300_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(17, 30),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        stale: Some("2025 model, superseded in its tier by the 2026 MoE rows"),
    },
];

/// The rows the chooser may see. Nothing else can build a `UsableEntry`.
pub fn usable() -> impl Iterator<Item = UsableEntry<'static>> {
    CATALOG
        .iter()
        .filter(|entry| entry.is_usable())
        .map(UsableEntry)
}

/// Everything refused, with the reason, for the page that explains the catalog.
pub fn excluded() -> impl Iterator<Item = (&'static ModelEntry, &'static str)> {
    CATALOG.iter().filter_map(|entry| match entry.standing() {
        Standing::Usable => None,
        Standing::Excluded { reason } => Some((entry, reason)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_research_only_row_cannot_reach_the_chooser() {
        assert!(!CATALOG
            .iter()
            .find(|entry| entry.repo.starts_with("amd/"))
            .expect("instella is in the catalog")
            .is_usable());
        assert!(usable().all(|entry| entry.entry().repo != "amd/Instella-MoE-16B-A3B-Think"));
    }

    #[test]
    fn refused_rows_keep_their_reason() {
        let refused: Vec<_> = excluded().collect();
        assert_eq!(refused.len(), 3, "three rows were evaluated and refused");
        assert!(refused.iter().any(|(entry, reason)| {
            entry.repo.starts_with("amd/") && reason.contains("research only")
        }));
        assert!(refused
            .iter()
            .any(|(entry, reason)| entry.repo.contains("gpt-oss") && reason.contains("2025")));
    }

    #[test]
    fn every_row_passes_the_axes_and_the_floor() {
        for entry in CATALOG {
            let total = entry.parameters.total().count();
            let active = entry.parameters.active().count();
            assert!(
                total >= 4_000_000_000,
                "{} is under the 4B floor",
                entry.repo
            );
            assert!(active <= total, "{} has active > total", entry.repo);
            assert!(entry.weights_bytes > 0);
            assert!(entry.mmproj_bytes.is_none_or(|bytes| bytes > 0));
        }
    }

    #[test]
    fn only_the_verified_rows_know_where_their_gguf_lives() {
        // A repo name written from memory is how a download 404s a week later:
        // the research-table rows never asked the API, so they carry None and
        // the downloader asks. The 2026-09-14 rows were asked.
        let verified: Vec<&str> = CATALOG
            .iter()
            .filter(|entry| entry.gguf_repo.is_some())
            .map(|entry| entry.repo)
            .collect();
        assert_eq!(
            verified,
            [
                "LiquidAI/LFM2.5-8B-A1B",
                "microsoft/Phi-mini-MoE-instruct",
                "ibm-granite/granite-4.0-h-tiny",
                "arcee-ai/Trinity-Nano-Preview",
            ]
        );
    }

    #[test]
    fn the_verified_rows_carry_their_exact_bytes() {
        // Figures from the Hugging Face API on 2026-09-14, verbatim: the byte
        // size of the exact file in each repo's tree. Rounding a measurement
        // would be throwing the measurement away.
        let bytes: Vec<(&str, u64)> = CATALOG
            .iter()
            .filter(|entry| entry.gguf_repo.is_some())
            .map(|entry| (entry.repo, entry.weights_bytes))
            .collect();
        assert_eq!(
            bytes,
            vec![
                ("LiquidAI/LFM2.5-8B-A1B", 4_588_301_888),
                ("microsoft/Phi-mini-MoE-instruct", 4_616_170_016),
                ("ibm-granite/granite-4.0-h-tiny", 4_230_976_352),
                ("arcee-ai/Trinity-Nano-Preview", 3_786_957_088),
            ]
        );
    }

    #[test]
    fn the_lfm_row_is_usable_and_carries_its_condition() {
        let lfm = CATALOG
            .iter()
            .find(|entry| entry.repo == "LiquidAI/LFM2.5-8B-A1B")
            .expect("lfm row is in the catalog");
        assert!(
            lfm.is_usable(),
            "a condition on the shipper is not a refusal of the row"
        );
        assert_eq!(lfm.licence.refusal(), None);
        assert_eq!(
            lfm.licence.condition(),
            Some("commercial use only for entities under $10M annual revenue"),
        );
        assert!(usable().any(|entry| entry.entry().repo == lfm.repo));
    }

    #[test]
    fn the_mixture_rows_are_the_ones_with_a_gap() {
        let mixtures: Vec<_> = CATALOG
            .iter()
            .filter(|entry| entry.parameters.is_mixture())
            .map(|entry| entry.repo)
            .collect();
        assert!(mixtures.contains(&"Qwen/Qwen3.6-35B-A3B"));
        assert!(!mixtures.contains(&"google/gemma-4-12B-it"));
    }
}
