//! Every model we have researched, usable or not — and, separately, every
//! model that can actually be downloaded.
//!
//! Rows arrive from the Hugging Face API (`lastModified`, `cardData.license`)
//! and are never edited from memory. The refused rows stay in the research
//! table on purpose: they were evaluated, and the next reader deserves to
//! know why they are not in the running instead of redoing the work.
//!
//! Two tables, and the split is the point. [`CATALOG`] is the research
//! record: rows whose weights were sized on paper and whose file was never
//! identified. [`DOWNLOADABLE`] is the chooser's only menu: a row gets there
//! only by carrying a complete [`GgufSource`] — repo, commit, file, exact
//! size, sha256 — and there is no way to write one without it. "Usable but
//! unfetchable" is therefore not a state the chooser can reach, by
//! construction rather than by discipline: a tier with no downloadable row
//! that fits is refused honestly instead of being handed a name nobody can
//! fetch.
//!
//! Two vintages of size share the research table, and they do not make the
//! same claim about their numbers. The research rows record GiB rounded to
//! two decimals, so bytes are that × 2^30 and printing byte precision from a
//! rounded figure would be false precision. [`DOWNLOADABLE`] rows carry the
//! exact size of the exact file, verified against the Hugging Face response
//! headers (`x-linked-size`, `x-linked-etag`) — byte precision there is a
//! measurement.

use kalsa_probe::Backend;

use crate::licence::{Licence, Standing};
use crate::parameters::Parameters;

pub const GIB: u64 = 1024 * 1024 * 1024;

/// The exact file a row's weights come from, pinned so it can be fetched and
/// verified: the GGUF repo, the commit it was published at, the file name in
/// that commit's tree, the size every byte must add up to, and the sha256
/// the download is checked against. Complete — a repo plus a quant is a
/// guess, a commit plus a file name is an address, and a half-filled
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
/// a file size measured to the byte. The download table's rows write their
/// bytes literally instead.
const fn gigabytes(whole: u64, centi: u64) -> u64 {
    whole * GIB + GIB * centi / 100
}

/// A researched row: everything a decision needs except a way to fetch it.
/// There is deliberately no `source` field here — a row with an identified
/// file is a [`DownloadableEntry`], and the types do not mix.
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

/// A row whose weights are a pinned, verifiable file. This is the only shape
/// the chooser is ever handed: the model's numbers and the file's address
/// travel together, and neither exists without the other.
#[derive(Clone, Copy, Debug)]
pub struct DownloadableEntry {
    /// The row's numbers and licences, exactly as a [`ModelEntry`] carries
    /// them.
    pub model: ModelEntry,
    /// The file the weights come from — complete, pinned, verified.
    pub source: GgufSource,
}

/// A row that passed every gate.
///
/// The only way to hold one is to receive it from this module, which is what
/// makes two refusal rules properties of the code rather than rules someone
/// remembers to follow: a research-only licence can never be recommended,
/// and neither can a row with no identified file — the type carries the
/// file's address, so there is nothing to forget.
#[derive(Clone, Copy, Debug)]
pub struct UsableEntry<'a> {
    entry: &'a ModelEntry,
    source: &'a GgufSource,
}

impl<'a> UsableEntry<'a> {
    pub fn entry(&self) -> &'a ModelEntry {
        self.entry
    }

    /// The pinned file behind the row: complete by construction, because the
    /// only constructor is [`usable`], fed by [`DOWNLOADABLE`].
    pub fn source(&self) -> &'a GgufSource {
        self.source
    }
}

#[cfg(test)]
impl<'a> UsableEntry<'a> {
    /// Unit tests need to hand a synthetic row to the chooser's internals;
    /// the chooser itself can only ever receive what `usable()` produces.
    /// The synthetic source is a placeholder address — these tests exercise
    /// arithmetic, never the network.
    pub(crate) fn for_test(entry: &'a ModelEntry) -> Self {
        Self {
            entry,
            source: &TEST_ONLY_SOURCE,
        }
    }
}

#[cfg(test)]
static TEST_ONLY_SOURCE: GgufSource = GgufSource {
    repo: "test/only",
    commit: "0000000000000000000000000000000000000000",
    file: "test.gguf",
    bytes: 1,
    sha256: "0000000000000000000000000000000000000000000000000000000000000000",
};

/// The research record: rows sized on paper, three of them refused, none of
/// them with an identified file. This table is why the audit page can say
/// what was evaluated and turned down — and it is structurally NOT the
/// chooser's menu; nothing here can produce a [`DownloadPlan`](crate::DownloadPlan).
pub const CATALOG: &[ModelEntry] = &[
    ModelEntry {
        repo: "google/gemma-4-E2B-it",
        display_name: "Google Gemma 4 E2B",
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
    // ── refused, kept for the record ────────────────────────────────────────
    ModelEntry {
        repo: "amd/Instella-MoE-16B-A3B-Think",
        display_name: "AMD Instella",
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

/// The chooser's menu: rows whose weights are one exact, pinned, verified
/// file. A row is written here only after both of these checks — in this
/// order, before the row exists, never after:
///
/// 1. **The architecture exists in `llama-arch.cpp` at the tag we ship.**
///    Our engine is pinned to llama.cpp **b10950**; `curl` the raw
///    `src/llama-arch.cpp` at that tag and find the architecture string in
///    it before writing the row. A model whose architecture is missing does
///    not merely run slowly — `llama-server` refuses to load it at all.
///    (K2 Horizon 3.7B was discarded exactly this way: good model, absent
///    architecture.) Today's evidence, from the file fetched at b10950:
///    `deepseek2` line 79, `bailingmoe2` line 111.
/// 2. **The file answers with the numbers the row will carry.** `curl -sI`
///    the `resolve/<commit>/<file>` URL and read `x-linked-size` and
///    `x-linked-etag` — the size and the sha256 go into the row verbatim.
///    If a number comes back different from what the research noted, stop:
///    the file was re-uploaded, and a stale pin fails every download with
///    an error that looks like ours.
///
/// Adding a row to `CATALOG` without a file is still possible — that table
/// is the research record. Adding one HERE without a complete
/// [`GgufSource`] is a compile error, which is the whole point of the
/// split.
pub const DOWNLOADABLE: &[DownloadableEntry] = &[
    // ── verified against the Hugging Face API on 2026-09-14 ─────────────────
    DownloadableEntry {
        model: ModelEntry {
            repo: "LiquidAI/LFM2.5-8B-A1B",
            display_name: "Liquid LFM 2.5",
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
        source: GgufSource {
            repo: "liodon-ai/LFM2.5-8B-A1B-imatrix-GGUF",
            commit: "dc77c293fd6f9107db3c9cecfb19befe2ae49755",
            file: "LFM2.5-8B-A1B-IQ4_XS.gguf",
            bytes: 4_588_301_888,
            sha256: "2237675ffa1c2d5a277db4ef02b79e613fc172d4b63511ae8cbcb8c3d75d1148",
        },
    },
    DownloadableEntry {
        model: ModelEntry {
            repo: "microsoft/Phi-mini-MoE-instruct",
            display_name: "Microsoft Phi Mini",
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
        source: GgufSource {
            repo: "smarttasks/Phi-mini-MoE-instruct-GGUF",
            commit: "ba0df1bd60632b932002d3aaae14808de2c0d804",
            file: "Phi-mini-MoE-instruct-Q4_K_S.gguf",
            bytes: 4_616_170_016,
            sha256: "16e1824f25a890ead375fd7f6476ef0813128079796286319e5594e8ffa1aefa",
        },
    },
    DownloadableEntry {
        model: ModelEntry {
            repo: "ibm-granite/granite-4.0-h-tiny",
            display_name: "IBM Granite 4 Tiny",
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
        source: GgufSource {
            repo: "ibm-granite/granite-4.0-h-tiny-GGUF",
            commit: "08d5a8a9741dd5c1a95d2d39e25253226aa1464e",
            file: "granite-4.0-h-tiny-Q4_K_M.gguf",
            bytes: 4_230_976_352,
            sha256: "5a38b08c441ae1adbafb1d2b8a7167e0d48734d83af68b268cefea1eec553dcd",
        },
    },
    DownloadableEntry {
        model: ModelEntry {
            repo: "arcee-ai/Trinity-Nano-Preview",
            display_name: "Arcee Trinity Nano",
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
            }),
            stale: None,
        },
        source: GgufSource {
            repo: "arcee-ai/Trinity-Nano-Preview-GGUF",
            commit: "2aa08593b79242d224da0215fb36924dcc0f87ea",
            file: "Trinity-Nano-Preview-Q4_K_M.gguf",
            bytes: 3_786_957_088,
            sha256: "287562a3824ce2277e2c71cfcc70248b2d90f7fa342a4779979e0bf3e37ad546",
        },
    },
    // ── verified against Hugging Face on 2026-09-16: `curl -sI` on the
    // resolve URLs returned exactly these `x-linked-size` and
    // `x-linked-etag` values, and the base repos answered `lastModified`
    // and `license: mit` from the API. The first MoE rows that fit a
    // 12 GiB budget, both architectures confirmed in llama-arch.cpp at
    // b10950 (see the header above).
    DownloadableEntry {
        model: ModelEntry {
            repo: "inclusionAI/Ling-mini-2.0",
            display_name: "InclusionAI Ling Mini 2.0",
            last_modified: "2026-04-13T11:40:51.000Z",
            licence: Licence::Open("mit"),
            parameters: Parameters::mixture(16_260_000_000, 1_430_000_000),
            quant: "Q4_K_M",
            weights_bytes: 9_911_575_904,
            mmproj_bytes: None,
            kv_bytes_per_token: None,
            // Nothing published settles this row against a same-recipe dense
            // model: None is the honest value, and the chooser treats it as
            // expected-but-unmeasured, never as claimed capability.
            dense_equivalent: None,
            kv_assumption_undercounts: false,
            measured_decode: None,
            stale: None,
        },
        source: GgufSource {
            repo: "mradermacher/Ling-mini-2.0-GGUF",
            commit: "76f2da561c6519b8f70ceb868e6be78526c69b79",
            file: "Ling-mini-2.0.Q4_K_M.gguf",
            bytes: 9_911_575_904,
            sha256: "bbb4ef25c6aa7842a93fa999cc6638ba5a8330fb0bd46dc5d7bd85a0db80d74f",
        },
    },
    DownloadableEntry {
        model: ModelEntry {
            repo: "moonshotai/Moonlight-16B-A3B-Instruct",
            display_name: "Moonshot Moonlight 16B",
            last_modified: "2026-01-30T04:52:43.000Z",
            licence: Licence::Open("mit"),
            parameters: Parameters::mixture(15_290_000_000, 2_240_000_000),
            quant: "Q4_K_M",
            weights_bytes: 10_537_205_632,
            mmproj_bytes: None,
            kv_bytes_per_token: None,
            dense_equivalent: None,
            kv_assumption_undercounts: false,
            measured_decode: None,
            stale: None,
        },
        source: GgufSource {
            repo: "mmnga/Moonlight-16B-A3B-Instruct-gguf",
            commit: "eb4728b376af0f3e168dc96d23cd21818c5738f6",
            file: "Moonlight-16B-A3B-Instruct-Q4_K_M.gguf",
            bytes: 10_537_205_632,
            sha256: "42f6e4d55765811b5710dcb1b30e79b8315735f956363da4965e0471d5b7e2b7",
        },
    },
];

/// The rows the chooser may see: every downloadable row that passed the
/// licence and cache gates. Nothing else can build a `UsableEntry` — and a
/// `UsableEntry` cannot exist without its pinned file.
pub fn usable() -> impl Iterator<Item = UsableEntry<'static>> {
    DOWNLOADABLE
        .iter()
        .filter(|row| row.model.is_usable())
        .map(|row| UsableEntry {
            entry: &row.model,
            source: &row.source,
        })
}

/// Everything refused, with the reason, for the page that explains the
/// catalog — both tables: research rows without a file, and download rows
/// a gate turned down.
pub fn excluded() -> impl Iterator<Item = (&'static ModelEntry, &'static str)> {
    CATALOG
        .iter()
        .chain(DOWNLOADABLE.iter().map(|row| &row.model))
        .filter_map(|entry| match entry.standing() {
            Standing::Usable => None,
            Standing::Excluded { reason } => Some((entry, reason)),
        })
}

/// Every row in both tables — the research record and the download menu.
/// For pages and lookups that must see the whole catalog; nothing that
/// offers a model may come through here.
pub fn rows() -> impl Iterator<Item = &'static ModelEntry> {
    CATALOG
        .iter()
        .chain(DOWNLOADABLE.iter().map(|row| &row.model))
}

#[cfg(test)]
mod tests;
