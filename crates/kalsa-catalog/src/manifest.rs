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
//! the GGUF repo's tree — byte precision there is a measurement. `source`
//! tells the vintages apart: only rows the API was actually asked about carry
//! one, and it is complete or absent, never partial.

use kalsa_probe::Backend;

use crate::licence::{Licence, Standing};
use crate::parameters::Parameters;

pub const GIB: u64 = 1024 * 1024 * 1024;

/// The exact file a row's weights come from, pinned so it can be fetched and
/// verified: the GGUF repo, the commit it was published at, the file name in
/// that commit's tree, the size every byte must add up to, and the sha256
/// the download is checked against. Complete or absent — a repo plus a quant
/// is a guess, a commit plus a file name is an address, and a half-filled
/// address is how an unverified download sneaks through.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GgufSource {
    /// The GGUF repo the file lives in.
    pub repo: &'static str,
    /// The commit of that repo the file is pinned to: a file renamed or
    /// replaced in a later commit cannot silently change what is downloaded.
    pub commit: &'static str,
    /// The file name inside that commit's tree.
    pub file: &'static str,
    /// The exact size of the file, in bytes.
    pub bytes: u64,
    /// The sha256 every downloaded byte is verified against, as 64 lowercase
    /// hex characters.
    ///
    /// Where it came from, plainly: these are HuggingFace's `x-linked-etag`
    /// values for the pinned commits, which for an LFS object is the object's
    /// sha256. That identity was verified by hand once, on a small file —
    /// downloaded, hashed, compared — not by re-hashing four gigabyte
    /// objects on a laptop. The first download on a real machine is what
    /// proves a digest: `kalsa-download` refuses bytes that do not match, so
    /// a wrong digest fails loudly and nothing unverified ever runs.
    pub sha256: &'static str,
}

/// A decode rate measured for real, with the machine it was measured on —
/// because a rate is a fact about one machine, never a property of the
/// model. The catalog uses it only for a machine that decodes on the same
/// backend; anywhere else the probe prediction is the honest answer, and the
/// measurement stays on the record for whoever rebuilds the traffic model.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MeasuredDecode {
    /// Decode throughput, from the serving engine's own timings.
    pub tokens_per_second: f64,
    /// The backend the rate was measured on: the figure is used only for a
    /// machine that decodes on the same path.
    pub backend: Backend,
    /// The machine, the configuration and the date — verbatim enough that
    /// the reader can judge the figure.
    pub measured_on: &'static str,
}

impl GgufSource {
    /// The address the file is fetched from: HuggingFace's resolve endpoint,
    /// which serves exactly this file at exactly this commit and redirects
    /// to the object store.
    pub fn url(&self) -> String {
        format!(
            "https://huggingface.co/{}/resolve/{}/{}",
            self.repo, self.commit, self.file
        )
    }
}

/// A publisher's own comparison of this MoE against a dense model trained by
/// the same lab on the same recipe. Carried per row, because it is data about
/// that row and not a rule about MoEs — no citable formula converts total and
/// active parameters into a dense size, and inventing one is how the byte bar
/// got into trouble. `None` means nothing has been published for this exact
/// model, not that the model is weak; a figure published for another version
/// does not transfer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DenseEquivalent {
    /// The dense parameter count the publisher's own benchmark table places
    /// this row near.
    pub parameters: u64,
    /// The direction the published table gives: where the row is above and
    /// below its dense neighbour.
    pub note: &'static str,
    /// Where the comparison was published.
    pub source: &'static str,
}

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
    /// The only model identity the user ever sees: vendor plus family, with
    /// the vendor's own size word where it has one. Everything else on this
    /// row — the repo path, the quantisation, the parameter suffixes, the
    /// variant codes — is ours, and none of it reaches the interface as a
    /// name. Required: a row with no name is a row the interface cannot show.
    pub display_name: &'static str,
    /// The exact file the weights come from, pinned and verifiable — or
    /// None, when no GGUF has been identified for this row at all. The type
    /// carries the whole address or nothing: a half-filled source is not a
    /// state that exists, because a half-filled source is how an unverified
    /// download sneaks through.
    pub source: Option<GgufSource>,
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
    /// The publisher's own same-recipe dense comparison, where one exists.
    /// None on every row to which it does not apply.
    pub dense_equivalent: Option<DenseEquivalent>,
    /// Set by research where the shared 96 KiB cache assumption is known to
    /// under-count this row — Apertus 70B is deeper than the forty-eight
    /// layers the constant models, so a context sized from the assumption is
    /// roughly half the allocation the server will make. Such a row is not
    /// offered on the assumption: the measured figure goes into
    /// `kv_bytes_per_token` and the door reopens. The flag stays true as the
    /// record of why the measurement was needed — and so that removing the
    /// measurement closes the door again.
    pub kv_assumption_undercounts: bool,
    /// A decode rate measured on the real path, where one exists. When it
    /// does, it is what the row's speed sentence says — a measurement beats
    /// a prediction. None on every row not yet measured: those keep the
    /// probe-side prediction, and none of them pretends otherwise.
    pub measured_decode: Option<MeasuredDecode>,
    /// Superseded by newer rows in the same tier.
    pub stale: Option<&'static str>,
}

impl ModelEntry {
    pub fn standing(&self) -> Standing {
        if let Some(reason) = self.licence.refusal() {
            return Standing::Excluded { reason };
        }
        if self.kv_bytes_per_token.is_none() && self.kv_assumption_undercounts {
            return Standing::Excluded {
                reason: "its per-token cache has not been measured, and the shared 96 KiB \
                         assumption is known to under-count it: the context would be sized \
                         against roughly half the truth. Measure the cache — the pinned \
                         file's GGUF header or the published config — and it is offerable \
                         again.",
            };
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
        display_name: "Google Gemma 4 E2B",
        source: None,
        last_modified: "2026-07-20",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(5_100_000_000, 2_300_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(3, 22),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        stale: None,
    },
    ModelEntry {
        repo: "google/gemma-4-E4B-it",
        display_name: "Google Gemma 4 E4B",
        source: None,
        last_modified: "2026-07-20",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(8_000_000_000, 4_500_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(5, 3),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        stale: None,
    },
    ModelEntry {
        repo: "Qwen/Qwen3.5-4B",
        display_name: "Alibaba Qwen 3.5",
        source: None,
        last_modified: "2026-03-02",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::dense(4_000_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(2, 81),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        stale: None,
    },
    ModelEntry {
        repo: "mistralai/Ministral-3-8B-Instruct-2512",
        display_name: "Mistral Ministral 3",
        source: None,
        last_modified: "2026-07-15",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::dense(8_800_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(4, 84),
        mmproj_bytes: Some(gigabytes(0, 86)),
        kv_bytes_per_token: None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        stale: None,
    },
    ModelEntry {
        repo: "google/gemma-4-12B-it",
        display_name: "Google Gemma 4 12B",
        source: None,
        last_modified: "2026-07-20",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::dense(11_950_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(7, 14),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        stale: None,
    },
    ModelEntry {
        repo: "google/gemma-4-26B-A4B-it",
        display_name: "Google Gemma 4 26B",
        source: None,
        last_modified: "2026-07-20",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(25_200_000_000, 3_800_000_000),
        quant: "Q4_0",
        weights_bytes: gigabytes(13, 61),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        stale: None,
    },
    ModelEntry {
        repo: "Qwen/Qwen3.6-35B-A3B",
        display_name: "Alibaba Qwen 3.6",
        source: None,
        last_modified: "2026-04-24",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(35_000_000_000, 3_000_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(19, 2),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        stale: None,
    },
    ModelEntry {
        repo: "llm-jp/llm-jp-4-32b-a3b-thinking",
        display_name: "LLM-jp 4",
        source: None,
        last_modified: "2026-04-24",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(32_100_000_000, 3_830_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(19, 93),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        stale: None,
    },
    ModelEntry {
        repo: "swiss-ai/Apertus-v1.5-70B",
        display_name: "Swiss AI Apertus 1.5",
        source: None,
        last_modified: "2026-07-24",
        licence: Licence::Open("apache-2.0+AUP"),
        parameters: Parameters::dense(70_000_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(40, 72),
        mmproj_bytes: None,
        // Its per-token cache is measured, not assumed: the pinned file's
        // GGUF header reads block_count 80, head_count_kv 8, key/value
        // lengths 128 — 80 × 8 × 256 = 163,840 elements per token. At the
        // q8_0 cache the launcher pins (one byte per element) that is
        // 160 KiB. Stored at that precision rather than f16's 320 KiB
        // because the whole catalog's arithmetic already assumes a quantised
        // cache — the same launcher pin the 96 KiB constant rides — and
        // budgeting this one row for f16 would halve its context to insure
        // against a dependency every other row already carries.
        kv_bytes_per_token: Some(163_840),
        dense_equivalent: None,
        kv_assumption_undercounts: true,
        measured_decode: None,
        stale: None,
    },
    // ── verified against the Hugging Face API on 2026-09-14 ─────────────────
    // `weights_bytes` here is the exact size of the exact GGUF file in the
    // repo's tree, `last_modified` is verbatim from the API, and each row
    // carries the source it was verified against — pinned to a commit, with
    // the digest the download is checked against (see GgufSource for where
    // those digests came from). None of them needs an mmproj, and none
    // carries a KV figure: that is measured, never guessed.
    ModelEntry {
        repo: "LiquidAI/LFM2.5-8B-A1B",
        display_name: "Liquid LFM 2.5",
        source: Some(GgufSource {
            repo: "liodon-ai/LFM2.5-8B-A1B-imatrix-GGUF",
            commit: "dc77c293fd6f9107db3c9cecfb19befe2ae49755",
            file: "LFM2.5-8B-A1B-IQ4_XS.gguf",
            bytes: 4_588_301_888,
            sha256: "2237675ffa1c2d5a277db4ef02b79e613fc172d4b63511ae8cbcb8c3d75d1148",
        }),
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
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        stale: None,
    },
    ModelEntry {
        repo: "microsoft/Phi-mini-MoE-instruct",
        display_name: "Microsoft Phi Mini",
        source: Some(GgufSource {
            repo: "smarttasks/Phi-mini-MoE-instruct-GGUF",
            commit: "ba0df1bd60632b932002d3aaae14808de2c0d804",
            file: "Phi-mini-MoE-instruct-Q4_K_S.gguf",
            bytes: 4_616_170_016,
            sha256: "16e1824f25a890ead375fd7f6476ef0813128079796286319e5594e8ffa1aefa",
        }),
        last_modified: "2025-12-10T18:20:28.000Z",
        licence: Licence::Open("mit"),
        parameters: Parameters::mixture(7_600_000_000, 2_400_000_000),
        quant: "Q4_K_S",
        weights_bytes: 4_616_170_016,
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        // Microsoft's model card runs the same lm-evaluation-harness table for
        // this row and the dense Phi-3 models of the same lab: the published
        // place to put it is near Phi-3 mini, clearly below Phi-3 small.
        dense_equivalent: Some(DenseEquivalent {
            parameters: 3_800_000_000,
            note: "near Phi-3 mini on the model card's evaluation table, clearly below \
                   Phi-3 small (7.4B)",
            source: "Microsoft's Phi-mini-MoE-instruct model card, accessed 2026-09-14",
        }),
        kv_assumption_undercounts: false,
        measured_decode: None,
        stale: None,
    },
    ModelEntry {
        repo: "ibm-granite/granite-4.0-h-tiny",
        display_name: "IBM Granite 4 Tiny",
        source: Some(GgufSource {
            repo: "ibm-granite/granite-4.0-h-tiny-GGUF",
            commit: "08d5a8a9741dd5c1a95d2d39e25253226aa1464e",
            file: "granite-4.0-h-tiny-Q4_K_M.gguf",
            bytes: 4_230_976_352,
            sha256: "5a38b08c441ae1adbafb1d2b8a7167e0d48734d83af68b268cefea1eec553dcd",
        }),
        last_modified: "2025-11-03T19:42:57.000Z",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(7_000_000_000, 1_000_000_000),
        quant: "Q4_K_M",
        weights_bytes: 4_230_976_352,
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        // IBM's own documentation compares this row to their dense Granite
        // 4.0 H-Micro, trained on the same recipe — the strongest evidence
        // that exists for a MoE's class, and it exists only for this row.
        dense_equivalent: Some(DenseEquivalent {
            parameters: 3_000_000_000,
            note: "close to it: above on GSM8K, DeepMind-Math and MBPP, below on BBH and \
                   IFEval",
            source: "IBM's Granite 4.0 model documentation, accessed 2026-09-14",
        }),
        kv_assumption_undercounts: false,
        measured_decode: None,
        stale: None,
    },
    ModelEntry {
        repo: "arcee-ai/Trinity-Nano-Preview",
        display_name: "Arcee Trinity Nano",
        source: Some(GgufSource {
            repo: "arcee-ai/Trinity-Nano-Preview-GGUF",
            commit: "2aa08593b79242d224da0215fb36924dcc0f87ea",
            file: "Trinity-Nano-Preview-Q4_K_M.gguf",
            bytes: 3_786_957_088,
            sha256: "287562a3824ce2277e2c71cfcc70248b2d90f7fa342a4779979e0bf3e37ad546",
        }),
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
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        // Measured tonight, 2026-09-14, on the machine this catalog is
        // developed on: the real engine, the real path, the server's own
        // timings. Every other row is unmeasured, and none of them pretends
        // otherwise.
        measured_decode: Some(MeasuredDecode {
            tokens_per_second: 62.7,
            backend: Backend::Metal,
            measured_on: "M1 Max (Metal, q8_0 KV cache, flash-attention, all layers \
                          on GPU, context 4096), 2026-09-14",
        }),        stale: None,
    },
    // ── refused, kept for the record ────────────────────────────────────────
    ModelEntry {
        repo: "amd/Instella-MoE-16B-A3B-Think",
        display_name: "AMD Instella",
        source: None,
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
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        stale: None,
    },
    ModelEntry {
        repo: "openai/gpt-oss-20b",
        display_name: "OpenAI GPT-OSS",
        source: None,
        last_modified: "2025-08-05",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(21_000_000_000, 3_600_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(11, 60),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        stale: Some("2025 model, superseded in its tier by the 2026 MoE rows"),
    },
    ModelEntry {
        repo: "Qwen/Qwen3-30B-A3B",
        display_name: "Alibaba Qwen 3",
        source: None,
        last_modified: "2025-04-28",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(30_500_000_000, 3_300_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(17, 30),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
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
    fn the_largest_row_carries_its_measured_cache() {
        // Measured from the pinned file's GGUF header: block_count 80,
        // head_count_kv 8, key/value lengths 128 — 163,840 elements per
        // token, one byte each at the q8_0 cache the launcher pins. The door
        // is open because the figure is measured; removing the measurement
        // closes it again, because the shared constant under-counts this row.
        let apertus = CATALOG
            .iter()
            .find(|entry| entry.repo.starts_with("swiss-ai/"))
            .expect("apertus is in the catalog");
        assert_eq!(apertus.kv_bytes_per_token, Some(163_840));
        assert!(apertus.is_usable());
        assert!(
            apertus.kv_assumption_undercounts,
            "the record stays: the shared constant under-counts this row"
        );
        let mut unmeasured = *apertus;
        unmeasured.kv_bytes_per_token = None;
        assert!(
            !unmeasured.is_usable(),
            "without the measurement, the assumption is known wrong for this row"
        );
    }

    #[test]
    fn trinitys_measured_decode_names_its_machine() {
        // Measured tonight on the M1 Max, on the path the row will decode
        // on: the figure and the machine travel together, and the backend
        // gate means a different machine is never told this one's speed.
        let trinity = CATALOG
            .iter()
            .find(|entry| entry.repo == "arcee-ai/Trinity-Nano-Preview")
            .expect("trinity is in the catalog");
        let measured = trinity
            .measured_decode
            .expect("trinity was measured on the real engine");
        assert_eq!(measured.tokens_per_second, 62.7);
        assert_eq!(measured.backend, Backend::Metal);
        assert!(measured.measured_on.contains("M1 Max"), "{}", measured.measured_on);
        assert!(
            measured.measured_on.contains("2026-09-14"),
            "{}",
            measured.measured_on
        );
        // Every other row is unmeasured, and none of them pretends otherwise.
        assert!(CATALOG
            .iter()
            .filter(|entry| entry.repo != trinity.repo)
            .all(|entry| entry.measured_decode.is_none()));
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
    fn every_row_has_a_name_a_person_can_say() {
        // Vendor plus family: the only model identity the user ever sees. The
        // repo path, the quantisation, the parameter suffixes and the variant
        // codes are ours, and none of them may appear in a display name.
        for entry in CATALOG {
            let name = entry.display_name;
            assert!(!name.is_empty(), "{} has no name", entry.repo);
            assert!(!name.contains('/'), "{name} leaks a repo path");
            assert!(!name.contains('_'), "{name} leaks a code");
            assert!(!name.contains("Q4"), "{name} leaks a quantisation");
            assert!(!name.contains("instruct"), "{name} leaks a variant code");
            assert!(
                !name.contains("A3B") && !name.contains("A4B"),
                "{name} leaks an active-parameter suffix"
            );
        }
        // The rows the 8 GB tier was built around, as the interface shows them.
        let named: Vec<(&str, &str)> = CATALOG
            .iter()
            .filter(|entry| entry.source.is_some())
            .map(|entry| (entry.repo, entry.display_name))
            .collect();
        assert_eq!(
            named,
            vec![
                ("LiquidAI/LFM2.5-8B-A1B", "Liquid LFM 2.5"),
                ("microsoft/Phi-mini-MoE-instruct", "Microsoft Phi Mini"),
                ("ibm-granite/granite-4.0-h-tiny", "IBM Granite 4 Tiny"),
                ("arcee-ai/Trinity-Nano-Preview", "Arcee Trinity Nano"),
            ]
        );
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
    fn only_the_verified_rows_know_where_their_weights_live() {
        // A repo name written from memory is how a download 404s a week later:
        // the research-table rows never asked the API, so they carry no source
        // at all and the downloader asks. The 2026-09-14 rows were asked, and
        // carry a complete pinned address.
        let pinned: Vec<&str> = CATALOG
            .iter()
            .filter_map(|entry| entry.source.as_ref())
            .map(|source| source.repo)
            .collect();
        assert_eq!(
            pinned,
            [
                "liodon-ai/LFM2.5-8B-A1B-imatrix-GGUF",
                "smarttasks/Phi-mini-MoE-instruct-GGUF",
                "ibm-granite/granite-4.0-h-tiny-GGUF",
                "arcee-ai/Trinity-Nano-Preview-GGUF",
            ]
        );
    }

    #[test]
    fn every_source_is_pinned_and_consistent_with_its_row() {
        // The digest and the size are the download's promises. The digest must
        // be a sha256 — 64 lowercase hex characters — and the size must be the
        // file this row describes: a mismatch here is a copy-paste between
        // rows, which is exactly how an unverified download would sneak
        // through.
        for entry in CATALOG {
            let Some(source) = entry.source else { continue };
            let lowercase_hex = |s: &str| {
                s.chars()
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
            };
            assert_eq!(
                source.sha256.len(),
                64,
                "{}: a sha256 is 64 characters",
                source.sha256
            );
            assert!(
                lowercase_hex(source.sha256),
                "{}: a sha256 is lowercase hex",
                source.sha256
            );
            assert_eq!(
                source.commit.len(),
                40,
                "{}: a git commit is 40 characters",
                source.commit
            );
            assert!(
                lowercase_hex(source.commit),
                "{}: a commit is lowercase hex",
                source.commit
            );
            assert!(
                source.file.ends_with(".gguf"),
                "{}: the pinned file is the gguf itself",
                source.file
            );
            assert!(!source.repo.is_empty(), "a source names its repo");
            assert_eq!(
                source.bytes, entry.weights_bytes,
                "{}: the pinned file's size must be the row's weight size",
                entry.repo
            );
        }
    }

    #[test]
    fn a_source_serves_its_exact_file_at_its_commit() {
        // The URL is an address: repo, pinned commit, exact file name —
        // nothing derived from a quant string, nothing that 404s when a
        // publisher renames a file in a later commit.
        let lfm = CATALOG
            .iter()
            .find(|entry| entry.repo == "LiquidAI/LFM2.5-8B-A1B")
            .expect("the LFM row is in the catalog");
        let source = lfm.source.expect("the LFM row has a pinned source");
        assert_eq!(
            source.url(),
            "https://huggingface.co/liodon-ai/LFM2.5-8B-A1B-imatrix-GGUF/resolve/dc77c293fd6f9107db3c9cecfb19befe2ae49755/LFM2.5-8B-A1B-IQ4_XS.gguf"
        );
    }

    #[test]
    fn the_verified_rows_carry_their_exact_bytes() {
        // Figures from the Hugging Face API on 2026-09-14, verbatim: the byte
        // size of the exact file in each repo's tree. Rounding a measurement
        // would be throwing the measurement away.
        let bytes: Vec<(&str, u64)> = CATALOG
            .iter()
            .filter(|entry| entry.source.is_some())
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
    fn dense_equivalents_carry_only_published_comparisons() {
        // The two rows whose publisher compared them to a same-recipe dense
        // model, with the source that makes the figure citable.
        for repo in [
            "ibm-granite/granite-4.0-h-tiny",
            "microsoft/Phi-mini-MoE-instruct",
        ] {
            let entry = CATALOG
                .iter()
                .find(|entry| entry.repo == repo)
                .expect("row is in the catalog");
            let equivalent = entry
                .dense_equivalent
                .unwrap_or_else(|| panic!("{repo} has a published dense equivalent"));
            assert!(equivalent.parameters > 0);
            assert!(!equivalent.note.is_empty());
            let source = equivalent.source;
            assert!(source.contains("accessed 2026-09-14"), "{source}");
        }
        // LFM publishes vendor-to-vendor tables, not a same-recipe dense LFM
        // comparison, and Trinity publishes nothing: None is the honest value,
        // and it means nothing was published — not that the model is weak.
        for repo in ["LiquidAI/LFM2.5-8B-A1B", "arcee-ai/Trinity-Nano-Preview"] {
            let entry = CATALOG
                .iter()
                .find(|entry| entry.repo == repo)
                .expect("row is in the catalog");
            assert!(entry.dense_equivalent.is_none(), "{repo}");
        }
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
