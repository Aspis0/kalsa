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
    /// The longest context the publisher trained this model for, read from
    /// its own GGUF header (`<arch>.context_length`). The budget arithmetic is
    /// memory-only and will happily fund a window several times this — 547,503
    /// tokens for a row trained at 262,144, measured 2026-09-18 — and a model
    /// asked to attend past what it was trained on does not answer better for
    /// the memory, it answers worse. `None` on a research row: with no file
    /// there is no header to read, and guessing a limit is how a wrong one
    /// gets shipped.
    pub trained_context_tokens: Option<u64>,
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
        // Dense, despite Google reporting 2.3B "effective" against 5.1B
        // physical: the effective count is Gemma's per-layer embeddings, not
        // a router. See the E4B row in the download table.
        parameters: Parameters::dense(5_100_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(3, 22),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        trained_context_tokens: None,
        stale: None,
    },
    // Google Gemma 4 E4B moved to DOWNLOADABLE (2026-09-18): its pinned file
    // was identified and verified. See the download table.
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
        trained_context_tokens: None,
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
        trained_context_tokens: None,
        stale: None,
    },
    // Google Gemma 4 12B moved to DOWNLOADABLE (2026-09-17): its pinned file
    // was identified, verified against the response headers, downloaded and
    // hashed. See the download table.
    // Google Gemma 4 26B moved to DOWNLOADABLE (2026-09-18): its pinned file
    // was identified and verified. See the download table.
    // Qwen3.6-35B-A3B moved to DOWNLOADABLE (2026-09-16): its pinned file
    // was identified and verified. See the download table.
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
        trained_context_tokens: None,
        stale: None,
    },
    // Apertus-v1.5-70B moved to DOWNLOADABLE (2026-09-16): its pinned file
    // was identified, its measured cache re-read from that file's header.
    // See the download table.
    // ── refused, kept for the record ────────────────────────────────────────
    ModelEntry {
        repo: "amd/Instella-MoE-16B-A3B-Think",
        display_name: "AMD Instella",
        last_modified: "2026-09-02",
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
        trained_context_tokens: None,
        stale: None,
    },
    ModelEntry {
        repo: "openai/gpt-oss-20b",
        display_name: "OpenAI GPT-OSS",
        last_modified: "2025-08-26",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(21_000_000_000, 3_600_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(11, 60),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        trained_context_tokens: None,
        stale: Some("2025 model, superseded in its tier by the 2026 MoE rows"),
    },
    ModelEntry {
        repo: "Qwen/Qwen3-30B-A3B",
        display_name: "Alibaba Qwen 3",
        last_modified: "2025-07-26",
        licence: Licence::Open("apache-2.0"),
        parameters: Parameters::mixture(30_500_000_000, 3_300_000_000),
        quant: "Q4_K_M",
        weights_bytes: gigabytes(17, 30),
        mmproj_bytes: None,
        kv_bytes_per_token: None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        trained_context_tokens: None,
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
            trained_context_tokens: Some(128_000),
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
            trained_context_tokens: Some(4_096),
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
            trained_context_tokens: Some(1_048_576),
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
            trained_context_tokens: Some(131_072),
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
            trained_context_tokens: Some(32_768),
            stale: Some(
                "thin for its tier: at ~9.9 GB on disk it competes with Google Gemma 4 12B, \
                       which is smaller, and with Qwen3.6-35B-A3B one tier up. Kept for \
                       the record, off the menu since 2026-09-18.",
            ),
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
            trained_context_tokens: Some(4_096),
            stale: Some(
                "thin for its tier: ~10.5 GB on disk buys less than Google Gemma 4 12B at \
                       7.7 GB. Kept for the record, off the menu since 2026-09-18.",
            ),
        },
        source: GgufSource {
            repo: "mmnga/Moonlight-16B-A3B-Instruct-gguf",
            commit: "eb4728b376af0f3e168dc96d23cd21818c5738f6",
            file: "Moonlight-16B-A3B-Instruct-Q4_K_M.gguf",
            bytes: 10_537_205_632,
            sha256: "42f6e4d55765811b5710dcb1b30e79b8315735f956363da4965e0471d5b7e2b7",
        },
    },
    // ── Google Gemma 4 26B-A4B, verified 2026-09-18 ────────────────────────
    // Google's own quantisation-aware training build, not a post-training
    // quantisation of it: `google/gemma-4-26B-A4B-it-qat-q4_0-gguf`, apache-2.0
    // and `gated: false` from the repo's API record. `general.architecture`
    // read from the pinned file's own header is `gemma4`, found in
    // llama-arch.cpp at b10950 — quoting that file, `{ LLM_ARCH_GEMMA4,
    // "gemma4" }` line 59. `curl -sIL` on the resolve URL returned
    // x-linked-size 14439363584 and x-linked-etag 3eca3b8f…eca51d, the two
    // numbers below.
    //
    // THE ROW THIS TABLE WAS MISSING. Against Gemma 4 12B, which it replaces
    // above 24 GiB: twice the total parameters, and a token reads 4.54 GB
    // against the dense row's 7.66, so it is the bigger model AND the faster
    // one. That is the whole point of the two axes — total weights decide
    // what fits, active weights decide the speed — and the table could not
    // show it until this file was pinned.
    DownloadableEntry {
        model: ModelEntry {
            repo: "google/gemma-4-26B-A4B-it",
            display_name: "Google Gemma 4 26B",
            last_modified: "2026-07-20T16:42:12.000Z",
            licence: Licence::Open("apache-2.0"),
            parameters: Parameters::mixture(25_200_000_000, 3_800_000_000),
            quant: "Q4_0",
            weights_bytes: 14_439_363_584,
            // The vision projector ships beside it (1.11 GiB) and is not
            // fetched: nothing here sends the model an image.
            mmproj_bytes: None,
            // Hybrid attention, so no single per-token figure is honest —
            // the same shape as Gemma 4 12B. From this file's own header:
            // `block_count 30`, `sliding_window_pattern` five windowed layers
            // then one full, repeated, `head_count_kv [8,…,2,…]`,
            // `key/value_length 512` full and 256 windowed, `sliding_window
            // 1024`. So the cache is 5 x 2 x (512+512) = 10 KiB per token that
            // grows, plus 25 x 8 x 512 x 1024 = 100 MiB that never does. The
            // shared 96 KiB constant therefore over-counts the growing term by
            // about ten times. It does NOT cover the fixed 100 MiB: 96 KiB x n
            // passes 100 MiB + 10 KiB x n only at n = 1191, and the chooser
            // prices at a single token, so below that the assumption is short.
            // The flag stays false because the shortfall is capped at that
            // 100 MiB while the budget's margin is never below 3 GiB
            // (`footprint::MARGIN_FLOOR_BYTES`), thirty times the gap. Said
            // out loud: "it over-counts, so it is safe" was true of the
            // growing half and silent about the other one.
            kv_bytes_per_token: None,
            dense_equivalent: None,
            kv_assumption_undercounts: false,
            measured_decode: None,
            trained_context_tokens: Some(262_144),
            stale: None,
        },
        source: GgufSource {
            repo: "google/gemma-4-26B-A4B-it-qat-q4_0-gguf",
            commit: "d1c082be9cf3c8a514acf63b8761f4b41935842e",
            file: "gemma-4-26B_q4_0-it.gguf",
            bytes: 14_439_363_584,
            sha256: "3eca3b8f6d7baf218a7dd6bba5fb59a56ee25fe2d567b6f5f589b4f697eca51d",
        },
    },
    // ── Google Gemma 4 E4B, verified 2026-09-18 ────────────────────────────
    // In this order: `general.architecture` was read from the pinned file's
    // own GGUF header by range-requesting its first kilobytes — `gemma4` —
    // and found in llama-arch.cpp at b10950, quoting that file:
    // `{ LLM_ARCH_GEMMA4, "gemma4" }` line 59. `curl -sIL` on the resolve URL
    // then returned x-linked-size 4977171584 and x-linked-etag
    // 85a896a0…1fab87, which are the two numbers below. Licence apache-2.0
    // and `gated: false` from both repos' own API records.
    //
    // Dense, not a mixture, even though Google reports 4.5B "effective"
    // against 8B physical: the effective count is Gemma's per-layer
    // embeddings, not a router, so neither the MoE traffic correction nor the
    // "only N of M parameters are read per token" sentence may be applied to
    // it. Modelling it dense charges every byte once, which is the safe
    // direction and the one no unpublished routing claim is needed for.
    DownloadableEntry {
        model: ModelEntry {
            repo: "google/gemma-4-E4B-it",
            display_name: "Google Gemma 4 E4B",
            last_modified: "2026-07-20T16:42:03.000Z",
            licence: Licence::Open("apache-2.0"),
            parameters: Parameters::dense(8_000_000_000),
            quant: "Q4_K_M",
            weights_bytes: 4_977_171_584,
            mmproj_bytes: None,
            kv_bytes_per_token: None,
            dense_equivalent: None,
            kv_assumption_undercounts: false,
            measured_decode: None,
            trained_context_tokens: Some(131_072),
            stale: None,
        },
        source: GgufSource {
            repo: "unsloth/gemma-4-E4B-it-GGUF",
            commit: "bfc15c382204943c3a8fff0c750b94ae2364d7a3",
            file: "gemma-4-E4B-it-Q4_K_M.gguf",
            bytes: 4_977_171_584,
            sha256: "85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87",
        },
    },
    // ── verified on 2026-09-16, filling the upper tiers ─────────────────────
    // For each row: the architecture string was read from the pinned file's
    // own GGUF header (`general.architecture`) and found in llama-arch.cpp
    // at b10950 (quote from that file): `qwen35moe` line 42, `qwen3next`
    // line 38, `apertus` line 135. `curl -sI` on the resolve URL returned
    // exactly the `x-linked-size` / `x-linked-etag` recorded below.
    DownloadableEntry {
        model: ModelEntry {
            repo: "Qwen/Qwen3.6-35B-A3B",
            display_name: "Alibaba Qwen 3.6",
            last_modified: "2026-04-24T02:53:42.000Z",
            licence: Licence::Open("apache-2.0"),
            parameters: Parameters::mixture(35_000_000_000, 3_000_000_000),
            quant: "Q4_K_M",
            weights_bytes: 22_134_528_992,
            mmproj_bytes: None,
            // Measured 2026-09-18 from THIS pinned file's GGUF header, by
            // range-requesting its first 64 KiB: `qwen35moe.block_count 40`,
            // `attention.head_count_kv 2`, `attention.key_length 256`,
            // `attention.value_length 256` — 40 x 2 x (256 + 256) = 40,960
            // elements per token, one byte each at the q8_0 cache the
            // launcher pins. The shared 96 KiB constant over-counts this row
            // by 2.4x, which at a long context is most of its predicted
            // traffic: the owner measures 25-30 tok/s at 150k context where
            // the constant predicts 10.4.
            kv_bytes_per_token: Some(40_960),
            dense_equivalent: None,
            kv_assumption_undercounts: false,
            measured_decode: None,
            trained_context_tokens: Some(262_144),
            stale: None,
        },
        source: GgufSource {
            repo: "unsloth/Qwen3.6-35B-A3B-GGUF",
            commit: "a483e9e6cbd595906af30beda3187c2663a1118c",
            file: "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
            bytes: 22_134_528_992,
            sha256: "ac0e2c1189e055faa36eff361580e79c5bd6f8e76bffb4ce547f167d53e31a61",
        },
    },
    DownloadableEntry {
        model: ModelEntry {
            repo: "Qwen/Qwen3-Next-80B-A3B-Instruct",
            display_name: "Alibaba Qwen 3 Next 80B",
            last_modified: "2025-09-17T06:57:40.000Z",
            licence: Licence::Open("apache-2.0"),
            parameters: Parameters::mixture(80_000_000_000, 3_000_000_000),
            quant: "Q4_K_M",
            weights_bytes: 48_410_988_384,
            mmproj_bytes: None,
            kv_bytes_per_token: None,
            dense_equivalent: None,
            kv_assumption_undercounts: false,
            measured_decode: None,
            trained_context_tokens: Some(262_144),
            stale: Some(
                "2025 base. Qwen3.6-35B-A3B, in this same table, is less than half the \
                       bytes for the same 3B active and is the better model on this \
                       project's own comparison, so the 48 GB buys nothing.",
            ),
        },
        source: GgufSource {
            repo: "Qwen/Qwen3-Next-80B-A3B-Instruct-GGUF",
            commit: "4c8630cf7af926a9c5095cb4bbbbc65d36e20f77",
            file: "Qwen3-Next-80B-A3B-Instruct-Q4_K_M.gguf",
            bytes: 48_410_988_384,
            sha256: "d103b2733ec1012a52d01edda66b7e5c24ae50508c9f99f5297ea459ef3c061a",
        },
    },
    DownloadableEntry {
        model: ModelEntry {
            repo: "swiss-ai/Apertus-v1.5-70B",
            display_name: "Swiss AI Apertus 1.5",
            last_modified: "2026-09-17T21:37:50.000Z",
            // The API reports `apache-2.0` and `gated: "auto"`; the card
            // itself answers 401 without a token, so the `+AUP` here could
            // not be re-checked on 2026-09-18 and is kept as the researcher
            // recorded it. The base repo being gated costs nothing — the
            // pinned GGUF comes from an ungated mirror — but a future row
            // that fetched from the base would stall on it.
            licence: Licence::Open("apache-2.0+AUP"),
            parameters: Parameters::dense(70_000_000_000),
            quant: "Q4_K_M",
            weights_bytes: 43_721_600_512,
            mmproj_bytes: None,
            // Re-measured 2026-09-16 from THIS pinned file's GGUF header, by
            // range-requesting its first kilobytes: `apertus.block_count 80`,
            // `apertus.attention.head_count_kv 8`,
            // `apertus.rope.dimension_count 128` — 80 × 8 × 128 × 2 tensors =
            // 163,840 elements per token, one byte each at the q8_0 cache
            // the launcher pins. The under-count flag stays true as the
            // record of why a measurement was required.
            kv_bytes_per_token: Some(163_840),
            dense_equivalent: None,
            kv_assumption_undercounts: true,
            measured_decode: None,
            trained_context_tokens: Some(262_144),
            stale: Some(
                "dense 70B: every token reads all 43.7 GB, which even on the fastest \
                       machine that could hold it is about 3 to 4 tokens a second — not a \
                       usable speed. The MoE rows reach the same memory for a tenth of \
                       the traffic.",
            ),
        },
        source: GgufSource {
            repo: "katya228/Apertus-v1.5-70B-text-GGUF",
            commit: "602f2f01c1e3ed4f8e3da4c56fb52c7b593f43ab",
            file: "apertus-70b-Q4_K_M.gguf",
            bytes: 43_721_600_512,
            sha256: "8507a6c4ef21a41848db84cdc8cd687b10a90fb9e7edbe94d08e05b228265de2",
        },
    },
    // Google Gemma 4 12B (2026-09-17): the table's only dense-parameter row
    // (dense FFN, n_expert 0 — but hybrid attention: 8 full layers of 48,
    // the rest sliding-window; measured, see docs/COMPUTE-BUFFERS-DENSE.md
    // §6). Pinned from the response headers at this commit — x-linked-size
    // 7662533088, x-linked-etag the sha256 below — licence apache-2.0 read
    // from the repo's own README, repo not gated. Downloaded and hashed
    // 2026-09-17: the digest matched.
    DownloadableEntry {
        model: ModelEntry {
            repo: "google/gemma-4-12B-it",
            display_name: "Google Gemma 4 12B",
            last_modified: "2026-07-20T16:42:08.000Z",
            licence: Licence::Open("apache-2.0"),
            parameters: Parameters::dense(11_950_000_000),
            quant: "Q4_K_M",
            weights_bytes: 7_662_533_088,
            mmproj_bytes: None,
            // Measured 2026-09-17 on the machine this catalog is developed
            // on: the cache is iswa and NOT flat per token — 34+255 MiB at
            // context 4096, 136+255 MiB at 16384 (q8_0) — so no single
            // per-token figure is honest; see the doc above. 255 MiB of
            // that is fixed and the rest grows, so 96 KiB per token
            // over-counts the growing half from the first token and covers
            // the fixed half only past a context of about 2985. The chooser
            // prices at ONE token, so there the assumption is short — by at
            // most 255 MiB, against a margin never below 3 GiB
            // (`footprint::MARGIN_FLOOR_BYTES`). That is why the flag is
            // false. "At the contexts the chooser funds (>= 4096)" was the
            // wrong reason: the chooser funds none of them.
            kv_bytes_per_token: None,
            dense_equivalent: None,
            kv_assumption_undercounts: false,
            measured_decode: Some(MeasuredDecode {
                tokens_per_second: 20.44,
                backend: Backend::Metal,
                measured_on: "M1 Max (Metal, q8_0 KV cache, flash-attention, all layers \
                              on GPU, context 512), 2026-09-17",
            }),
            trained_context_tokens: Some(131_072),
            stale: None,
        },
        source: GgufSource {
            repo: "bartowski/gemma-4-12B-it-GGUF",
            commit: "2ae7d41be21ca62de00a2d320ee9cec50daa3aa6",
            file: "gemma-4-12B-it-Q4_K_M.gguf",
            bytes: 7_662_533_088,
            sha256: "3962624dcd25b947d889dc9ae1bf275b61db6cd4dbe694057f34fffef1671509",
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
