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
                reason: "its per-token cache has not been measured, and research knows it \
                         exceeds the shared 96 KiB assumption: a context sized on the \
                         assumption would be sized on a figure known to be too small for \
                         the cache the server will allocate. Measure the cache — the pinned \
                         file's GGUF header or the published config — and this gate no \
                         longer refuses it.",
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

/// The research record: rows sized on paper, none of them with an
/// identified file. This table is why the audit page can say
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
        // The growing half, read 2026-09-26 from Google's own QAT file
        // (`google/gemma-4-E2B-it-qat-q4_0-gguf@675cff42`, file
        // `gemma-4-E2B_q4_0-it.gguf`) — this row still carries no pinned file
        // of its own, which is why the window geometry stays `None`: the
        // pattern there is four windowed then one full (7 full of 35),
        // `shared_kv_layers 20` gives `n_layer_kv_from_start = 15`, so only
        // 3 of those full layers hold KV, `head_count_kv 1`,
        // `key/value_length 512`. Per tensor: 3 x 1 x 512 = 1536 elements =
        // 1632 bytes at q8_0 (34 per 32), K and V both: 3264 bytes a token.
        kv_bytes_per_token: Some(3_264),
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
    // Google Gemma 4 12B moved to DOWNLOADABLE (2026-09-17): its pinned file
    // was identified, verified against the response headers, downloaded and
    // hashed. See the download table.
    // Google Gemma 4 26B moved to DOWNLOADABLE (2026-09-18): its pinned file
    // was identified and verified. See the download table.
    // Qwen3.6-35B-A3B moved to DOWNLOADABLE (2026-09-16): its pinned file
    // was identified and verified. See the download table.
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
            // The growing half, from this file's own header (read by range
            // request 2026-09-26): `block_count 30`, `sliding_window_pattern`
            // five windowed layers then one full, repeated — 5 full layers,
            // all under `n_layer_kv_from_start = 30 - 0` (shared_kv_layers
            // 0, so every layer keeps its KV) — `head_count_kv 2` on those
            // full layers, `key/value_length 512`. Per tensor:
            // 5 x 2 x 512 = 5120 elements = 5440 bytes at the q8_0 the app
            // pins (34 bytes per 32), K and V both: 10_880 bytes a token.
            // The shared 96 KiB constant over-counts it by about nine times;
            // the fixed half (25 windowed x 8 x (256 + 256) = 102_400
            // elements a cell, 100 MiB at saturation) sits in `slot_cache`
            // below, so the two halves never double-charge each other.
            kv_bytes_per_token: Some(10_880),
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
            // The growing half, from THIS pinned file's header (read by
            // range request 2026-09-26): `shared_kv_layers 18` gives
            // `n_layer_kv_from_start = 24`, so layers 0..23 hold KV — among
            // them 4 full layers (the pattern is five windowed then one
            // full), `head_count_kv 2`, `key/value_length 512`. Per tensor:
            // 4 x 2 x 512 = 4096 elements = 4352 bytes at the q8_0 the app
            // pins (34 bytes per 32), K and V both: 8704 bytes a token. The
            // fixed SWA half is measured below, in `slot_cache`.
            kv_bytes_per_token: Some(8_704),
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
            // The GROWING half only: the fixed SWA half sits in
            // `slot_cache` below, so the two halves never double-charge
            // each other. From THIS pinned file's header (read by range
            // request 2026-09-26): `sliding_window_pattern` five windowed
            // then one full — 8 full layers of 48, `shared_kv_layers 0` so
            // every layer keeps its KV — `head_count_kv 1` on those full
            // layers, `key/value_length 512`. Per tensor: 8 x 1 x 512 = 4096
            // elements = 4352 bytes at the q8_0 the app pins (34 bytes per
            // 32), K and V both: 8704 bytes a token. The owner's own engine
            // log of this file agrees to the byte — `--ctx-size 65536
            // --cache-type-k q8_0 --cache-type-v q8_0` reported
            // "K (q8_0): 272.00 MiB, V (q8_0): 272.00 MiB" over 65536 cells,
            // which is 4352 bytes each.
            kv_bytes_per_token: Some(8_704),
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
    // ── LiquidAI LFM2.5-2.6B, verified against the Hugging Face API on 2026-09-26 ──
    // The same model the phone app ships, pinned at commit
    // `e7caca5d835a3901a8e0d63e94009429bafafdfc`, one file: Q8_0, the less
    // compressed quant the owner wants on PCs. At 2.87 GB of weights it still
    // fits the 8 GB tier with room to spare at the chooser's 65_536-token
    // window (about 3.95 GiB of footprint against a 5.0 GiB budget), so the
    // smaller compression earns no tier of its own.
    //
    // `general.architecture` was read from THIS pinned file's own GGUF
    // header by range-requesting its first bytes: `lfm2` — found in
    // llama-arch.cpp at b10950, quoting that file:
    // `{ LLM_ARCH_LFM2, "lfm2" }` line 127. `curl -sIL` on the resolve URL
    // returned exactly the `x-linked-size` and `x-linked-etag` below.
    //
    // Licence `lfm1.0` (read from this repo's own LICENSE), as a condition
    // and not a refusal: §1 Definitions — `"Threshold" shall mean annual
    // revenue of 10 million United States dollars ($10,000,000) or more` —
    // and §5 Commercial Use Limitation: (a) the rights for Commercial Use
    // are `conditioned upon You or Your Legal Entity not exceeding the
    // Threshold`, (b) commercial use by an entity that exceeds it `is not
    // licensed under this Agreement`, (c) the Threshold does not apply to a
    // Qualified Non-Profit's non-commercial or research use.
    // `curl -sIL` on the resolve URL returned exactly the `x-linked-size`
    // 2_874_779_648 and the `x-linked-etag` below. The licence, the
    // per-token cache and the per-slot term come from the header, derived
    // under the Q4_K_M row's comment above.
    DownloadableEntry {
        model: ModelEntry {
            repo: "LiquidAI/LFM2.5-2.6B",
            display_name: "Liquid LFM 2.5",
            last_modified: "2026-09-22T20:42:43.000Z",
            licence: Licence::Conditional {
                id: "lfm1.0",
                condition: "commercial use only for entities under $10M annual revenue",
            },
            parameters: Parameters::dense(2_697_198_592),
            quant: "Q8_0",
            weights_bytes: 2_874_779_648,
            mmproj_bytes: None,
            kv_bytes_per_token: Some(8_192),
            slot_cache: SlotCache::Recurrent {
                bytes_per_slot: 360_448,
            },
            dense_equivalent: None,
            kv_assumption_undercounts: false,
            measured_decode: None,
            trained_context_tokens: Some(131_072),
            stale: None,
        },
        source: GgufSource {
            repo: "LiquidAI/LFM2.5-2.6B-GGUF",
            commit: "e7caca5d835a3901a8e0d63e94009429bafafdfc",
            file: "LFM2.5-2.6B-Q8_0.gguf",
            bytes: 2_874_779_648,
            sha256: "1e22128dfa128bdfb684da167e74e072d0a056baa7d06d9f280291e2839b0fc9",
        },
    },
    // ── Alibaba Qwen 3.8-27B, verified against the Hugging Face API on 2026-09-26 ──
    // The dense 27B, at unsloth's UD-Q4_K_M — the file the research pinned:
    // 16_464_440_224 bytes, commit
    // `4ca720788d1e01f1bff70c033e0d0028fd02e502`. `curl -sIL` on the resolve
    // URL returned exactly the `x-linked-size` and `x-linked-etag` below.
    //
    // `general.architecture` was read from THIS pinned file's own header by
    // range request: `qwen35` — in llama-arch.cpp at b10950,
    // `{ LLM_ARCH_QWEN35, "qwen35" }` line 41, the same family as Qwen
    // 3.5/3.6, so the fork knows it.
    //
    // The header's own facts: `block_count 65` with `nextn_predict_layers 1`
    // (so `n_layer() = 64` — the MTP head is excluded, and the engine's
    // layer filters say so: `filter_attn`/`filter_recr` both test
    // `il < n_layer()`), `full_attention_interval 4`
    // (`src/models/qwen35.cpp:17-21`: recurrent unless `(i + 1) % 4 == 0`)
    // → 48 Gated-DeltaNet layers and 16 full-attention layers, and
    // `head_count_kv 4`, `key/value_length 256`, `ssm.conv_kernel 4`,
    // `ssm.state_size 128`, `ssm.group_count 16`, `ssm.inner_size 6144`,
    // `context_length 262144`.
    //
    // The growing half is the 16 attention layers at the q8_0 the app pins
    // (34 bytes per 32): 16 x 4 x 256 = 16_384 elements a tensor = 17_408
    // bytes, K and V both: 34_816 bytes a token. The GDN layers hold no
    // per-token KV; their state is per slot: R + S = (4 - 1) x (6144 +
    // 2 x 16 x 128) + 128 x 6144 = 817_152 F32 elements a layer
    // (`llama-hparams.cpp:229,257`), one row per sequence — 48 x 817_152 x 4
    // = 156_893_184 B per slot at every context. The vision projector ships
    // beside the weights and is not fetched: nothing here sends the model an
    // image.
    //
    // Apache-2.0 from the repo's card and the header's own `general.license`.
    // It reaches a page only where this machine can still drive it: the big
    // dense line in `choice.rs` keeps a row like this off a machine that
    // would decode it below 20 tok/s — the owner's M1 Max measures about 7.
    DownloadableEntry {
        model: ModelEntry {
            repo: "Qwen/Qwen3.8-27B",
            display_name: "Alibaba Qwen 3.8",
            last_modified: "2026-08-20T12:04:25.000Z",
            licence: Licence::Open("apache-2.0"),
            parameters: Parameters::dense(27_781_427_952),
            quant: "Q4_K_M",
            weights_bytes: 16_464_440_224,
            mmproj_bytes: None,
            kv_bytes_per_token: Some(34_816),
            slot_cache: SlotCache::Recurrent {
                bytes_per_slot: 156_893_184,
            },
            dense_equivalent: None,
            kv_assumption_undercounts: false,
            measured_decode: None,
            trained_context_tokens: Some(262_144),
            stale: None,
        },
        source: GgufSource {
            repo: "unsloth/Qwen3.8-27B-GGUF",
            commit: "4ca720788d1e01f1bff70c033e0d0028fd02e502",
            file: "Qwen3.8-27B-UD-Q4_K_M.gguf",
            bytes: 16_464_440_224,
            sha256: "322e194ff79741c7baa497c240f677f54b201b0efab44ca8e50f122b39123482",
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
