//! The start command as data, and the constants the command is built from.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Loopback only: the phone reaches the server through a tunnel, so the
/// server is never exposed on the LAN (plan, section 7).
pub(crate) const HOST: &str = "127.0.0.1";

/// The logical prompt batch, at the binary's own default (b10950 `--help`:
/// "batch-size N (default: 2048)"). Measured on the shipped build with the
/// shipped Trinity row: the first turn's prefill — the turn the phone
/// actually waits for — went from 1151 to 1883 tokens per second against
/// the old 512, with the thermal state unchanged.
pub(crate) const BATCH: u32 = 2048;

/// The micro-batch, also at the binary's own default ("ubatch-size N
/// (default: 512)"). Measured on the same run: 1883 tokens/s of prefill at
/// 512 against 1151 at the old 128, decode unchanged, and the allocator's
/// own compute buffers grew from 24 to 60 MiB — far inside the catalog's
/// 512 MiB forfait, which is kept for the dense rows that cost more (see
/// `kalsa_catalog::footprint::COMPUTE_BUFFER_BYTES`).
pub(crate) const UBATCH: u32 = 512;

/// The smallest logical batch the panel accepts. A guard rail, not a
/// measurement: below 64 a prompt is split into so many steps that per-step
/// overhead dominates prefill, and nothing measured a reason to go lower.
pub const MIN_BATCH: u32 = 64;

/// The largest logical batch the panel accepts. A guard rail, not a
/// measurement: the compute buffers follow the MICRO-batch, not the logical
/// batch — the measurement in `docs/COMPUTE-BUFFERS-DENSE.md` varied ubatch
/// at a fixed `-b 2048` — so this bound only keeps the logical batch from
/// drifting past anything a prompt fills.
pub const MAX_BATCH: u32 = 8192;

/// The smallest micro-batch the panel accepts. A guard rail, not a
/// measurement, for the same reason as [`MIN_BATCH`].
pub const MIN_UBATCH: u32 = 64;

/// The largest micro-batch this computer's forfait pays for. Measured on the
/// shipped b10950 with the dense Gemma 4 12B row
/// (`docs/COMPUTE-BUFFERS-DENSE.md`, "The answers", point 3): ubatch 1024
/// costs 346.6–414.0 MiB at 16k context, still under the 512 MiB
/// `kalsa_catalog::footprint::COMPUTE_BUFFER_BYTES` with at least 98 MiB of
/// margin; ubatch 2048 costs 602.7 MiB at 4096 context already, and its MTL0
/// line alone (561.35 MiB) exceeds the forfait. 1024 is the ceiling; 2048 is
/// refused with these numbers, never accepted.
pub const MAX_UBATCH: u32 = 1024;

/// How "every layer" is spelled to this build. b10950's `--help`, verbatim:
/// "-ngl, --gpu-layers, --n-gpu-layers N   max. number of layers to store in
/// VRAM, either an exact number, 'auto', or 'all' (default: auto)". `all` is
/// the build's own name for the decision and does not bet on the layer count
/// being smaller than a magic figure.
pub(crate) const ALL_LAYERS: &str = "all";

/// Unload the model *and the KV cache* after this many idle seconds; /health,
/// /props and /models do not reset the timer, so a polling phone does not
/// keep the machine warm (plan, section 7). 300 s matches the keep-alive
/// default the plan cites for ollama.
///
/// **The single owner of release timing.** This flag is the only unload
/// clock in the product: the model lives or dies by it. Nothing else —
/// least of all the sentinel, which must never run a second clock that can
/// only disagree — decides when an idle machine stops holding the model.
/// The sentinel learns of a release from the server's owner (its
/// `note_unload`); it never predicts one.
pub const DEFAULT_IDLE_UNLOAD_SECONDS: u32 = 300;

/// How many engine slots the server runs, and therefore how many devices the
/// door can serve at once. This is the ONE value the launcher and the door
/// share: [`ServerArgs::parallel`] is rendered into `--parallel`, and the
/// app passes the same number to `kalsa_door::Door::new` as the door's
/// capacity. There is deliberately no second constant for the door, so the
/// two can never drift apart.
///
/// **Raising this above 1 is gated on five things, and only point 2 is now
/// priced.** The value is one number, but it is not the whole change; read
/// all five before touching it, and read `docs/MULTI-DEVICE-SHAPE.md` §7 for
/// the measured numbers behind points 2 and 3.
///
/// 1. **The engine must consume the door's private headers.** At capacity
///    above 1 the door refuses to build unless `EnginePrivateHeaders` is
///    `Consumed` (`kalsa_door`'s `new_with_engine`, `CapacityWithoutHeaderSupport`).
///    That declaration is a runtime fact, never a constant here:
///    `kalsa-runtime`'s `engine_consumes_private_headers` streams the module
///    file for the lowercase `x-kalsa-slot` the engine matches, and
///    `kalsa-runtime::assets` pins the fork that carries it — so the macOS
///    arm64 rows are `Consumed`. An upstream archive, an Intel row, or any
///    future build that drops the inlet reads `NotConsumed`, and the app then
///    clamps BOTH its plan and the door to one device rather than refuse. The
///    clamp is the app's (`startup.rs`'s `planned_parallel` and `main.rs`'s
///    `door_capacity`), not this crate's: `plan` will split N slots for any row
///    it is handed, inlet or not, so an engine that cannot isolate must never
///    be handed more than one.
/// 2. **The sliding-window KV replicates per slot — now priced for every
///    pinned row.** §7 measured the 14 full-attention layers dividing their
///    pool by the slot count while the 42 sliding-window layers replicated:
///    55.78 MiB at np=1 against 223.12 MiB at np=4 — **+167 MiB** for the same
///    total context. `kalsa_catalog::manifest::SlotCache` carries each pinned
///    row's window geometry (or its recurrent state: Qwen 3.6, Granite 4
///    Tiny, LFM 2.5), and `plan` subtracts the per-slot term before it buys
///    context, so the funded total pays the replication. Two things stay
///    open here. The per-token half is not yet honest: the sliding-window
///    rows still price the conservative 96 KiB/token (too few tokens, never
///    too much memory), and that replacement must land together with the
///    per-slot term, which is in place. And Gemma 4 E2B, a `gemma4` row in
///    the research table, has no pinned file to read a geometry from, so it
///    is not priced at all.
/// 3. **The prompt-cache roof is sized for one warm conversation.** `--cache-ram`
///    is a single global limit (`docs/MULTI-DEVICE-SHAPE.md` §5, the eviction
///    at ~4k); with N slots the roof must hold N histories or the warm-start
///    promise stops holding. Reconsider `PROMPT_CACHE_CHAT_TOKENS` and its
///    share with the slot count in hand.
/// 4. **`funded_context` is a single-slot contract.** The panel previews
///    through it; it must take the slot count — and the callers must pass it —
///    before the preview and the plan can agree at N > 1.
/// 5. **The UI must quantise the total.** Two bounds are fixed, and both are
///    floors: `MIN_CONTEXT_TOKENS` for the knob and `MIN_CONTEXT_TOKENS_PER_SLOT`
///    in the plan. The ceiling is neither — it is the plan's funded maximum,
///    handed to the panel as `context_max`. The plan divides the total by N,
///    so at N > 1 the panel must step in multiples of the slot alignment
///    (256 × N) so the accepted boundary is visible rather than a one-token
///    cliff.
pub const DEFAULT_PARALLEL: u32 = 1;

/// The context one chat gets when the owner has not chosen, in tokens, PER
/// SLOT — a slot is one conversation, and a conversation is what this figure
/// is about. The automatic path is `min(this, the machine's funded maximum)`
/// ([`crate::plan`]), so a machine that cannot fund it keeps its own smaller
/// figure: an 8 GiB machine's 3993 tokens stay 3993, never a promise of 64k.
/// An explicit owner choice still wins, up to the machine's maximum.
///
/// **A starting value, not a discovered one.** The panel used to cap the
/// context at a fixed 32 768, and the ceiling this replaces was the machine's
/// funded maximum — 262 144 tokens for the row on disk on a 64 GiB Mac, which
/// costs about 10 GiB of KV on top of 22 GiB of weights. Neither is a chat
/// figure: 32 768 is below what the trained length allows and the funded
/// maximum is above what a conversation reaches. A chatbot needs the
/// conversation plus the system prompt, and 65 536 is a round figure in that
/// range. Nothing measured it — a real chat's turn lengths would, and until
/// one is measured this number is stated here, once, instead of hidden in a
/// panel. The maximum stays available for whoever asks for it.
pub const DEFAULT_CONTEXT_TOKENS: u64 = 65_536;

/// The smallest context a slot may be given, in tokens. Below it a slot
/// refuses real conversations instead of serving a short one:
/// `docs/MULTI-DEVICE-SHAPE.md` §4 measured a 4096-token slot serving a
/// 3878-token conversation warm, and the same conversation one turn longer
/// was answered with **HTTP 400** ("request (4225 tokens) exceeds the
/// available context size (4096 tokens)"), never a truncation. A plan whose
/// per-slot share lands below this is refused outright.
pub const MIN_CONTEXT_TOKENS_PER_SLOT: u64 = 4096;

/// The user-facing idle range. Below a minute the model churns during normal
/// pauses; above an hour an unattended machine keeps the model resident for
/// no useful reason. Both bounds are deliberately conservative.
pub const MIN_IDLE_UNLOAD_SECONDS: u32 = 60;
pub const MAX_IDLE_UNLOAD_SECONDS: u32 = 3_600;

/// How the KV cache is stored: q8_0 for both tensors at one byte per
/// element, or f16 at two.
///
/// **q8_0 is the unit the catalog's arithmetic is stated in.**
/// `ASSUMED_KV_BYTES_PER_TOKEN` is "two tensors, eight KV heads of 128
/// dimensions, one byte each, forty-eight layers", and every measured row's
/// `kv_bytes_per_token` is its header geometry in q8_0 bytes too. f16 doubles
/// the per-token cost and therefore halves the funded context;
/// `policy::context_and_prompt_cache_roof` applies that multiplier, so the
/// memory arithmetic follows the owner's choice instead of ignoring it.
///
/// **Load-bearing across a crate boundary.** The catalog stores its measured
/// rows at this same precision — Apertus 70B's `kv_bytes_per_token` is its
/// header geometry in q8_0 bytes, not f16 — so choosing f16 doubles what
/// every measured cache will cost and halves every measured context. q8_0 is
/// the default for that reason, and it is the thermal trade too: half the
/// cache means half the memory traffic streamed per token, and streaming
/// memory is what a decode *is*.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum KvCache {
    /// One byte per element — the catalog's own unit, and the default.
    #[default]
    #[serde(rename = "q8_0")]
    Q8_0,
    /// Two bytes per element: twice the cache, half the funded context.
    #[serde(rename = "f16")]
    F16,
}

impl KvCache {
    /// How the choice is spelled to this build's `--cache-type-k/-v`.
    pub fn flag(self) -> &'static str {
        match self {
            Self::Q8_0 => "q8_0",
            Self::F16 => "f16",
        }
    }

    /// Bytes per KV element. The catalog's per-token figures are q8_0 bytes,
    /// so this is the multiplier from a row's figure to what the chosen
    /// cache actually costs.
    ///
    /// **The 2 is a deliberate over-count, not the measured ratio.**
    /// llama.cpp's q8_0 cache is not one byte per element: `block_q8_0` is a
    /// 2-byte scale plus 32 int8 values (`ggml/src/ggml-common.h:251-255`),
    /// so it costs 34 bytes per 32 elements — 1.0625 bytes per element
    /// against f16's 2, an exact ratio of 64/34 = 1.8824. Measured on the
    /// shipped b10950 with Trinity-Nano at context 2048 through
    /// `tests/real_server.rs` (2026-09-18): the KV total was 119.00 MiB at
    /// q8_0 against 224.00 MiB at f16, and 224 / 119 = 1.8824. Multiplying a
    /// q8_0 figure by 2 therefore over-counts f16 by 6.25 %, which funds a
    /// slightly *smaller* context than the machine could hold. That is the
    /// safe direction — it can never oversubscribe — and it is deliberate:
    /// refining 6 % on top of the catalog's deliberately pessimistic
    /// per-token figure would be false precision, so the arithmetic stays
    /// 1 and 2.
    pub fn bytes_per_element(self) -> u64 {
        match self {
            Self::Q8_0 => 1,
            Self::F16 => 2,
        }
    }

    /// The bytes the engine's own block layout gives `elements` cache
    /// elements, for arithmetic derived from a GGUF header's shape — the
    /// per-slot sliding-window pool and recurrent state. This is NOT
    /// [`Self::bytes_per_element`]: the catalogue's per-token figures are
    /// stated in that one-byte-per-element unit, so scaling them here would
    /// move every measured row. For geometry the real block cost is exact:
    /// q8_0 is `block_q8_0` at 34 bytes per 32 elements
    /// (`ggml/src/ggml-common.h:251-255`), and f16 is two bytes.
    ///
    /// `elements` is `width x cells`, and the tensor's first dimension is
    /// the cache width, so it is a multiple of 32 whenever the engine can
    /// build the tensor at all.
    pub fn geometry_bytes(self, elements: u64) -> u64 {
        match self {
            Self::Q8_0 => elements.saturating_mul(34) / 32,
            Self::F16 => elements.saturating_mul(2),
        }
    }

    /// Reads a rendered flag or a stored name back. `None` for anything this
    /// build has no cache type for, so a bad string never becomes a guess.
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "q8_0" => Some(Self::Q8_0),
            "f16" => Some(Self::F16),
            _ => None,
        }
    }
}

/// Flash attention, stated, never defaulted. In this build the flag takes a
/// value (b10950 `--help`, verbatim: "-fa, --flash-attn [on|off|auto]   set
/// Flash Attention use ('on', 'off', or 'auto', default: 'auto')"), so a
/// bare `--flash-attn` swallows the next argument — which is exactly how an
/// argv that parses in every test failed to start a real server. The
/// quantized V cache is refused without flash attention, so `auto` — the
/// server's default — would turn the memory arithmetic into a bet on what
/// some future build defaults to. `on` is the one value the q8_0 cache is
/// legal under, so it is the value rendered.
pub(crate) const FLASH_ATTN: &str = "on";

/// How many layers go to the GPU. Three states, because the rendered
/// arguments differ in kind, not degree:
///
/// * on a build with GPU code, `--n-gpu-layers` defaults to `auto` — the
///   server's own guess about how many layers the card will take — so
///   leaving the flag out is a bet on someone else's default, and the wrong
///   one whenever the card was never sized for the model;
/// * on a CPU build the flag has no GPU code behind it at all.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Offload {
    /// The whole model was budgeted against the memory it decodes from, so
    /// every layer goes to the GPU.
    All,
    /// CPU decode, stated explicitly with `--n-gpu-layers 0`. Used whenever
    /// the budget was not sized for the card — including an unreadable VRAM
    /// size — because a partial offload measured 2.15× slower than plain CPU
    /// (5.68 against 12.19 tok/s), and a full offload of an unsized model is
    /// how a card OOMs. Never a fraction of the layers.
    ForcedOff,
    /// The CPU build: no GPU code in it, so no GPU flag is rendered at all.
    NoGpuBuild,
}

/// The exact arguments the server is started with, as data: a test asserts
/// "the context is N" here, and the sentinel hands back a reduced
/// configuration by writing fields, not by editing strings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServerArgs {
    pub model_path: PathBuf,
    pub port: u16,
    /// The largest context whose KV cache fits the budget that is left after
    /// the weights and the prompt-cache roof. Also in [`MemoryAssumption`],
    /// where the memory it implies travels with it.
    pub context_tokens: u64,
    /// The prompt-cache roof in MiB, decided where the context is sized: it
    /// is carved out of the budget before the context, so it travels here
    /// instead of being re-derived from a context that already excludes it.
    pub cache_ram_mib: u64,
    /// The measured plateau of the probe's thread ramp. None when nothing
    /// measurable came back: the flag is then omitted and the server picks
    /// its own default, which is stated in the assumption rather than
    /// disguised as our number.
    pub threads: Option<usize>,
    pub offload: Offload,
    /// How long the server keeps an unused model resident.
    pub idle_unload_seconds: u32,
    /// The logical prompt batch. A decided value now, not a constant: the
    /// panel's owner may lower or raise it within [`MIN_BATCH`]–[`MAX_BATCH`],
    /// and `plan` copies whichever value was decided here.
    pub batch_size: u32,
    /// The micro-batch. A decided value now, not a constant: it follows the
    /// compute buffers, so [`MAX_UBATCH`] is a measured ceiling, not a
    /// preference.
    pub ubatch_size: u32,
    /// The KV cache precision. A decided value now, not a constant: it sets
    /// what the cache costs per token, and the arithmetic is told.
    pub kv_cache: KvCache,
    /// The engine's slot count, rendered as `--parallel`. The same value is
    /// the door's capacity: a device beyond this many has no engine slot,
    /// and the door refuses it rather than let the engine wrap `id_slot`
    /// onto somebody else's cache.
    pub parallel: u32,
}

/// The settings the UI may show after the command line has been built.
/// Values here are the renderer's values, not a second set of defaults.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ServerSettings {
    pub batch_size: u32,
    pub ubatch_size: u32,
    pub kv_cache_type: &'static str,
    pub flash_attention: &'static str,
    pub idle_unload_seconds: u32,
    pub gpu_layers: Option<&'static str>,
    pub threads: Option<usize>,
    pub threads_batch: Option<usize>,
}

impl ServerSettings {
    /// The values known before a backend measurement. GPU layers and thread
    /// counts stay absent until the real launch decision supplies them.
    pub fn defaults(idle_unload_seconds: u32) -> Self {
        Self {
            batch_size: BATCH,
            ubatch_size: UBATCH,
            kv_cache_type: KvCache::default().flag(),
            flash_attention: FLASH_ATTN,
            idle_unload_seconds,
            gpu_layers: None,
            threads: None,
            threads_batch: None,
        }
    }
}

/// What the arguments cost, for the user-facing copy. The catalog says the
/// cache size is still an assumption; this is where the assumption became a
/// number, and `kv_per_token_assumed` says whether it still is one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MemoryAssumption {
    pub context_tokens: u64,
    /// The KV cache at the chosen context, under the cache type the server
    /// will actually run: the catalog's per-token figure scaled by
    /// [`KvCache::bytes_per_element`] over the total context, PLUS the
    /// engine's per-slot allocation (a sliding-window pool or a recurrent
    /// state) at the funded per-slot context. The per-slot half is what the
    /// per-token figure cannot carry and what makes this the cache the
    /// server will actually allocate rather than a per-token prediction of
    /// it. When
    /// `kv_per_token_assumed` is true this is the *budget* the context was
    /// sized against, not a prediction of the allocation: the server sizes
    /// its cache from the GGUF's own geometry and never consults this
    /// arithmetic, so a row whose real per-token cost exceeds the assumption
    /// oversubscribes the machine by exactly the excess. Only a measured row
    /// makes this number the truth — which is why the plan requires the
    /// measurement per model, and why this flag must reach the copy.
    pub kv_cache_bytes: u64,
    /// True when the per-token figure behind `kv_cache_bytes` is the
    /// catalog's pessimistic assumption, not a measurement of this row.
    pub kv_per_token_assumed: bool,
    /// Weights + mmproj + compute buffers + KV at the chosen context — the
    /// whole footprint, which fits the budget below by construction.
    pub total_bytes: u64,
    /// The budget it was sized against: VRAM on a card that decodes, system
    /// RAM otherwise, always after the OS/browser margin.
    pub budget_bytes: u64,
}

/// What [`plan`] produced: the command, and the honest cost of running it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LaunchPlan {
    pub args: ServerArgs,
    pub memory: MemoryAssumption,
}
