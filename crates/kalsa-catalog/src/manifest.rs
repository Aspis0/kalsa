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

/// What the engine allocates PER SLOT, over and above the context-wide pool.
///
/// With an explicit `-np N` the context-wide pool divides by the slot count,
/// but these do not: a sliding-window pool is replicated once per stream
/// (`src/llama-kv-cache-iswa.cpp:84,104-118` sizes it at `min(ctx/N, n_swa +
/// ubatch)` cells and `src/llama-kv-cache.cpp:88` sets `n_stream = n_seq_max`
/// for the 3-D `[dims, cells, n_stream]` tensors), and a recurrent state is
/// one row per sequence (the hybrid constructors feed
/// `recurrent_kv_size = max(1, n_seq_max)` — `src/llama-model.cpp:2681` — and
/// `src/llama-memory-recurrent.cpp:101` allocates `mem_size * (1 + n_rs_seq)`
/// rows). A per-token figure alone therefore
/// under-counts the machine at more than one slot by the whole replication —
/// measured `docs/MULTI-DEVICE-SHAPE.md` §7: 55.78 MiB at `np=1` against
/// 223.12 MiB at `np=4` for the same 16384-token context.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlotCache {
    /// One context-wide pool; nothing replicates with the slot count.
    None,
    /// A sliding-window pool, sized per stream to
    /// `PAD(min(ctx/N, window_tokens + ubatch), 256)` cells, each holding
    /// `width_per_cell` K+V elements.
    SlidingWindow {
        /// `<arch>.attention.sliding_window` (`n_swa`), in tokens.
        window_tokens: u64,
        /// Summed K+V element width of this architecture's sliding-window
        /// layers, per cell.
        width_per_cell: u64,
    },
    /// A recurrent state that does not grow with the context at all: the
    /// engine's F32 R+S tensors, one row per sequence.
    Recurrent {
        /// Bytes per slot, from the header's `ssm.*` keys and the recurrent
        /// layer count.
        bytes_per_slot: u64,
    },
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
    /// What the engine allocates PER SLOT, over and above the context-wide
    /// pool the per-token figure prices. [`SlotCache::None`] on a row whose
    /// cache is one pool divided by the slot count; the plan pays this
    /// before it sizes the context, so a row that copies at load time is not
    /// funded as if it did not.
    pub slot_cache: SlotCache,
    /// The publisher's own same-recipe dense comparison, where one exists.
    /// None on every row to which it does not apply.
    pub dense_equivalent: Option<DenseEquivalent>,
    /// Set by research where the shared 96 KiB cache assumption is known to
    /// under-count this row: the row's real per-token cache is above the
    /// constant, so a context sized from the assumption would understate
    /// what the server will allocate. Such a row is not offered on the
    /// assumption: the measured figure goes into `kv_bytes_per_token` and
    /// the door reopens — and it is that measured figure, not the
    /// constant, that funds the context. The flag stays true as the record
    /// of why the measurement was needed — and so that removing the
    /// measurement closes the door again. No row in either table carries
    /// it today; the gate in [`ModelEntry::standing`] still reads it.
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

/// The research record: rows sized on paper, one of them refused, none of
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
        // Same `gemma4` family as E4B, so its cache is a sliding-window pool
        // with a shared-KV pattern too — but this row has no pinned file, so
        // there is no header to read `sliding_window`, the pattern or
        // `shared_kv_layers` from. A guessed geometry is how a wrong
        // allocation gets funded, so it stays `None`; the menu's "priced"
        // claims are scoped to the pinned download rows for exactly this row.
        slot_cache: SlotCache::None,
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
        slot_cache: SlotCache::None,
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
        slot_cache: SlotCache::None,
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
        slot_cache: SlotCache::None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        trained_context_tokens: None,
        stale: None,
    },
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
        slot_cache: SlotCache::None,
        dense_equivalent: None,
        kv_assumption_undercounts: false,
        measured_decode: None,
        trained_context_tokens: None,
        stale: None,
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
            // `lfm2moe` is a hybrid: `head_count_kv` is an array with six
            // non-zero entries (layers 2, 6, 10, 14, 18, 21), so 18 of the 24
            // blocks are shortconv-recurrent (`lfm2moe.cpp:13` marks a layer
            // recurrent when `n_head_kv == 0`; confirmed on THIS pinned
            // file's header). The cached state is the conv history only:
            // `n_embd_r() = n_embd x (l_cache - 1)` (`llama-hparams.cpp:216`),
            // read as `embedding_length 2048` and `shortconv.l_cache 3`, and
            // there is no S state (no `ssm.*` keys, so `n_embd_s()` is 0).
            // F32 and one row per sequence (`llama-model.cpp:2681`):
            // 18 x 4_096 x 4 = 294_912 B = 0.28 MiB per slot.
            slot_cache: SlotCache::Recurrent {
                bytes_per_slot: 294_912,
            },
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
            slot_cache: SlotCache::None,
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
            // `granitehybrid`, not a plain transformer: `head_count_kv` is an
            // array whose four non-zero entries are layers 5, 15, 25, 35 of
            // 40 (read from THIS pinned file's header on 2026-09-21), so 36
            // blocks are Mamba-style recurrent (`granite-hybrid.cpp:24` marks
            // a layer recurrent when `n_head_kv == 0`). Per recurrent layer
            // the cached state is R+S = (conv_kernel - 1) x (inner + 2 x
            // group x state) + state x inner (`llama-hparams.cpp:229,257`),
            // header values `ssm.conv_kernel 4`, `ssm.inner_size 3072`,
            // `ssm.group_count 1`, `ssm.state_size 128` — 3 x 3328 + 393_216
            // = 403_200 F32 elements. One row per sequence
            // (`llama-model.cpp:2681`): 36 x 403_200 x 4 = 58_060_800 B =
            // 55.371 MiB per slot at every context.
            slot_cache: SlotCache::Recurrent {
                bytes_per_slot: 58_060_800,
            },
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
            // Header, read from THIS pinned file on 2026-09-21:
            // `afmoe.block_count 56`, `afmoe.attention.head_count_kv 2`,
            // `afmoe.attention.key_length 128`,
            // `afmoe.attention.value_length 128`,
            // `afmoe.attention.sliding_window 2048`. The 42 sliding-window
            // layers are NOT a header key: `afmoe.cpp` defaults
            // `swa_period = 4` and `llama-hparams.cpp:15` marks
            // `il % 4 < 3` windowed, so 42 of 56. Per cell:
            // 42 x 2 x (128 + 128) = 21_504 K+V elements — the engine's own
            // "42 layers" SWA pool: 55.78 MiB at 2560 cells, q8_0
            // (`docs/MULTI-DEVICE-SHAPE.md` §7, A np=1).
            slot_cache: SlotCache::SlidingWindow {
                window_tokens: 2048,
                width_per_cell: 21_504,
            },
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
            // The windowed pool this arithmetic prices, from the header read
            // recorded in the comment above: 25 windowed layers x 8 KV heads
            // x (256 + 256) = 102_400 K+V elements per cell, window 1024.
            // The engine sizes it at `PAD(1024 + ubatch, 256)` = 1536 cells
            // once the context saturates it, which at the real q8_0 block
            // cost (34/32) is 159.4 MiB per slot — the fixed half the comment
            // above estimates at 100 MiB using the window only (1024 cells)
            // and one byte per element.
            slot_cache: SlotCache::SlidingWindow {
                window_tokens: 1024,
                width_per_cell: 102_400,
            },
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
            // A FOURTH sliding-window row, and the one the header alone gets
            // wrong. Header (`unsloth/gemma-4-E4B-it-GGUF@bfc15c38`, read
            // 2026-09-21): `gemma4.block_count 42`,
            // `sliding_window_pattern` five windowed then one full (35
            // windowed, 7 full), `head_count_kv 2`, `key_length_swa 256`,
            // `value_length_swa 256`, `sliding_window 512`. But it also
            // carries `shared_kv_layers 18`, and `gemma4.cpp:10` sets
            // `n_layer_kv_from_start = 42 - 18 = 24`: only layers 0..23 hold
            // their own KV (`llama-kv-cache.cpp:189` skips the rest), which
            // is 20 windowed and 4 full. MEASURED on the v1.1.0 engine, THIS
            // pinned file, ctx 16384, ubatch 512, q8_0, `--parallel 1`:
            // "creating SWA KV cache, size = 1024 cells" and
            // "size = 21.25 MiB (1024 cells, 20 layers, 1/1 seqs)" — twenty
            // layers, not thirty-five. Per cell: 20 x 2 x (256 + 256) =
            // 20_480 K+V elements; the saturated pool is
            // PAD(512 + 512, 256) = 1024 cells. The un-shared 35-layer figure
            // (37.19 MiB) would over-charge this row by 75%.
            slot_cache: SlotCache::SlidingWindow {
                window_tokens: 512,
                width_per_cell: 20_480,
            },
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
    // ── Alibaba Qwen 3.6, verified against Hugging Face on 2026-09-16 ───────
    // The architecture string was read from this pinned file's own GGUF
    // header (`general.architecture`) and found in llama-arch.cpp at b10950
    // (quote from that file): `qwen35moe` line 42. `curl -sI` on the resolve
    // URL returned exactly the `x-linked-size` / `x-linked-etag` below.
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
            // The engine also allocates a recurrent state PER SLOT, which no
            // per-token figure can carry. Read from THIS pinned file's header
            // on 2026-09-21: `qwen35moe.ssm.conv_kernel 4`,
            // `ssm.inner_size 4096`, `ssm.group_count 16`,
            // `ssm.state_size 128`, `full_attention_interval 4`. The
            // interval makes every fourth of the 40 blocks an attention
            // layer, so 30 are gated-delta-net (`qwen35moe.cpp:21-29`), each
            // with R+S = (conv_kernel - 1) x (inner + 2 x group x state) +
            // state x inner = 24_576 + 524_288 F32 elements
            // (`llama-hparams.cpp:229,257`). One row per sequence
            // (`llama-model.cpp:2681` feeds `max(1, n_seq_max)` rows):
            // 30 x 548_864 x 4 = 65_863_680 bytes = 62.8 MiB per slot at
            // every context.
            //
            // LEFT UNCORRECTED, said out loud: `kv_bytes_per_token` above
            // still bills all 40 layers as attention KV where only the 10
            // attention layers hold a context (10 x 2 x (256 + 256) =
            // 10_240), a 4x over-count of the attention half. That figure is
            // also this row's measured decode-traffic calibration (25-30
            // tok/s at 150k context), so re-deriving it belongs with a fresh
            // measurement, not with this change. The over-count errs safe for
            // memory; the state term is added because it was missing entirely.
            slot_cache: SlotCache::Recurrent {
                bytes_per_slot: 65_863_680,
            },
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
            // The windowed pool this arithmetic prices, from THIS pinned
            // file's header (read 2026-09-21): `gemma4.block_count 48`,
            // `gemma4.attention.sliding_window_pattern` five windowed then
            // one full (40 windowed, 8 full), `head_count_kv 8` on the
            // windowed layers, `key_length_swa 256` / `value_length_swa 256`,
            // `sliding_window 1024` — 40 x 8 x (256 + 256) = 163_840 K+V
            // elements per cell. The engine's 1536-cell saturated pool at
            // the real q8_0 block cost is 255 MiB, which is the fixed half
            // of the measured "136+255 MiB at 16384" above.
            slot_cache: SlotCache::SlidingWindow {
                window_tokens: 1024,
                width_per_cell: 163_840,
            },
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
    usable_in(DOWNLOADABLE)
}

/// The gate itself, over any table, so a test can run the menu's exact
/// filter over rows the test wrote: [`usable`] is this fed the real table.
fn usable_in(rows: &[DownloadableEntry]) -> impl Iterator<Item = UsableEntry<'_>> {
    rows.iter()
        .filter(|row| row.model.is_usable())
        .map(|row| UsableEntry {
            entry: &row.model,
            source: &row.source,
        })
}

/// Everything refused, with the reason, for the page that explains the
/// catalog — every row of either table whose [`ModelEntry::standing`] is
/// [`Standing::Excluded`] (a licence, the unmeasured-cache gate,
/// staleness), and only those.
pub fn excluded() -> impl Iterator<Item = (&'static ModelEntry, &'static str)> {
    excluded_in(rows())
}

/// The refusal pass over any rows, so a test can run it over rows the test
/// wrote: [`excluded`] is this fed both real tables.
fn excluded_in<'a>(
    rows: impl Iterator<Item = &'a ModelEntry>,
) -> impl Iterator<Item = (&'a ModelEntry, &'static str)> {
    rows.filter_map(|entry| match entry.standing() {
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
