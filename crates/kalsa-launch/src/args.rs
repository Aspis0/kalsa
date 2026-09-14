//! The start command as data, and the constants the command is built from.

use std::path::PathBuf;

/// Loopback only: the phone reaches the server through a tunnel, so the
/// server is never exposed on the LAN (plan, section 7).
pub(crate) const HOST: &str = "127.0.0.1";

/// The logical prompt batch. The supervisor ships the same figure today; a
/// smaller batch is a gentler prefill burst on a machine whose thermal paste
/// is a decade old, and prefill speed is not the axis the product wins on.
pub(crate) const BATCH: u32 = 512;

/// The micro-batch. Load-bearing for the memory story: the catalog's
/// `COMPUTE_BUFFER_BYTES` (512 MiB) is computed for ubatch 128 — "they follow
/// the batch, not the model" — so the server must be *told* 128 or the
/// reported footprint is a number the arguments do not produce.
pub(crate) const UBATCH: u32 = 128;

/// Any figure at or above the model's layer count offloads everything; the
/// count itself is read from the GGUF at load time, so 999 is the idiom.
pub(crate) const ALL_LAYERS: u32 = 999;

/// Unload the model *and the KV cache* after this many idle seconds; /health,
/// /props and /models do not reset the timer, so a polling phone does not
/// keep the machine warm (plan, section 7). 300 s matches the keep-alive
/// default the plan cites for ollama.
pub(crate) const IDLE_UNLOAD_SECONDS: u32 = 300;

/// How the KV cache is stored: q8_0 for both tensors, one byte per element.
/// That is exactly what the catalog's per-token arithmetic counts
/// (`ASSUMED_KV_BYTES_PER_TOKEN` is "two tensors, eight KV heads of 128
/// dimensions, one byte each, forty-eight layers"), so these flags are what
/// make the reported cache size true rather than half of it. It is also the
/// thermal trade: half the cache means half the memory traffic streamed per
/// token, and streaming memory is what a decode *is*.
///
/// **Load-bearing across a crate boundary.** The catalog stores its measured
/// rows at this same precision — Apertus 70B's `kv_bytes_per_token` is its
/// header geometry in q8_0 bytes, not f16 — so changing this value does not
/// retune this crate: it invalidates every row's memory arithmetic, doubles
/// what every measured cache will cost, and halves every measured context.
/// It is not a knob.
pub(crate) const KV_CACHE_TYPE: &str = "q8_0";

/// How many layers go to the GPU. Three states, because the rendered
/// arguments differ in kind, not degree:
///
/// * on a build with GPU code, the default is "offload every layer" — so
///   leaving the flag out is itself a decision, and the wrong one whenever
///   the card was never sized for the model;
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
    /// the weights. Also in [`MemoryAssumption`], where the memory it implies
    /// travels with it.
    pub context_tokens: u64,
    /// The measured plateau of the probe's thread ramp. None when nothing
    /// measurable came back: the flag is then omitted and the server picks
    /// its own default, which is stated in the assumption rather than
    /// disguised as our number.
    pub threads: Option<usize>,
    pub offload: Offload,
}

/// What the arguments cost, for the user-facing copy. The catalog says the
/// cache size is still an assumption; this is where the assumption became a
/// number, and `kv_per_token_assumed` says whether it still is one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MemoryAssumption {
    pub context_tokens: u64,
    /// The KV cache at the chosen context, under the cache type the server
    /// will actually run (q8_0, one byte per element). When
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
