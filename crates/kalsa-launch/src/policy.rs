//! The three decisions the start command is built from: how much context the
//! budget funds, how many threads the measurement earned, and what the GPU
//! gets.

use std::path::PathBuf;

use kalsa_catalog::footprint::{
    footprint_bytes, MemoryBudget, ASSUMED_KV_BYTES_PER_TOKEN, COMPUTE_BUFFER_BYTES, MIB,
};
use kalsa_catalog::manifest::{ModelEntry, SlotCache};
use kalsa_probe::plateau;
use kalsa_runtime::ServerBackend;

use crate::args::{KvCache, LaunchPlan, MemoryAssumption, Offload, ServerArgs, DEFAULT_CONTEXT_TOKENS};

/// Everything the decision needs, already decided upstream: the build that
/// won, the model that was chosen, the budget it was chosen against, and the
/// thread ramp the probe measured on this machine.
pub struct LaunchInput<'a> {
    pub backend: ServerBackend,
    pub model: &'a ModelEntry,
    pub budget: MemoryBudget,
    /// (threads, bytes per second) pairs, as measured. The plateau of this
    /// ramp is the thread count, capped to `physical_cores` when the
    /// machine's physical count is known: hyperthreading's extra logical
    /// threads can raise the plateau past the throughput peak — on the
    /// Lenovo (Core Ultra 9 185H, 16 physical / 22 logical) the plateau
    /// read 22 once in three runs, and at 22 decode was 26.5% slower than
    /// at 16, with complete separation (n=2 runs per arm; the two
    /// 22-thread runs were 29% apart). The Surface (4 physical, plateau 4)
    /// and the M1 Max (10 physical, plateau 8) are unaffected.
    pub thread_ramp: &'a [(usize, f64)],
    /// The machine's physical core count — `kalsa_probe::physical_cores()`'s
    /// answer — the ceiling under the thread count. `None` (unknown) leaves
    /// the plateau alone, the behavior before the cap existed.
    pub physical_cores: Option<usize>,
    pub model_path: PathBuf,
    pub port: u16,
    /// A user-selected lower context. `None` keeps the largest context the
    /// budget funds; a larger request is rejected rather than silently capped.
    pub context_limit: Option<u64>,
    /// The owner's logical prompt batch, carried into the rendered argv.
    pub batch_size: u32,
    /// The owner's micro-batch, carried into the rendered argv.
    pub ubatch_size: u32,
    /// The owner's KV cache precision: it scales the per-token figure the
    /// context is sized against, so the arithmetic follows the choice.
    pub kv_cache: KvCache,
    /// How many engine slots the total context is divided across, and
    /// therefore how many devices may talk at once. It is the same number
    /// `DEFAULT_PARALLEL` carries into `--parallel` and `src-tauri` hands to
    /// the door as its capacity. The plan divides the funded total by it,
    /// because the engine divides `--ctx-size` exactly so.
    pub parallel: u32,
    /// Where the engine may save a chat's KV state on disk, rendered as
    /// `--slot-save-path`. Resolved by the app (its data directory's
    /// `slots`), created and permissioned there; [`plan`] only carries it
    /// into the argv, so a launch without the folder is impossible by type.
    pub slot_save_path: PathBuf,
}

/// The thread count the engine gets: the plateau capped at the machine's
/// physical cores when that count is known (the rule and its evidence:
/// [`LaunchInput::thread_ramp`]). A physical count of zero — a read that
/// answered with nothing — is unknown: the plateau alone decides, and
/// `--threads 0` is never rendered. One function so the plan and the dev
/// path cannot drift.
pub fn thread_count(plateau: Option<usize>, physical: Option<usize>) -> Option<usize> {
    match physical {
        Some(physical) if physical > 0 => plateau.map(|threads| threads.min(physical)),
        // Zero and None are alike: unknown, the plateau alone decides.
        _ => plateau,
    }
}

/// The funded ceiling for one input, and the roof it was carved after: the
/// one copy of the arithmetic shared by [`plan`], which lowers the ceiling to
/// [`DEFAULT_CONTEXT_TOKENS`] on the automatic path, and [`funded_maximum`],
/// which reports the ceiling itself. Returns (per-slot ceiling, roof bytes,
/// slots).
fn funded_ceiling(input: &LaunchInput) -> Option<(u64, u64, u64)> {
    // One slot minimum, clamped once so the arithmetic and the rendered flag
    // cannot disagree: the engine clamps `n_seq_max` the same way
    // (`src/llama-context.cpp`: `std::max(1u, params.n_seq_max)`) and the door
    // refuses a capacity of zero, so a raw field holding 0 would otherwise
    // render `--parallel 0` beside a one-slot plan.
    let slots = u64::from(input.parallel.max(1));
    let (funded, prompt_cache_roof) = context_and_prompt_cache_roof(
        input.model,
        input.budget.usable_bytes,
        input.kv_cache,
        slots,
        u64::from(input.ubatch_size),
    )?;
    let ceiling = per_slot_ceiling(funded, input.model.trained_context_tokens, slots)?;
    Some((ceiling, prompt_cache_roof, slots))
}

/// The start command for this machine and model, with the memory it implies.
///
/// None when the machine cannot fund the model at all: the weights, mmproj
/// and compute buffers alone already exceed the budget, or the row's measured
/// per-token figure is garbage — a model that cannot be given even one token
/// of context must not be started smaller, it must not be started. None also
/// when the slots cannot each reach `MIN_CONTEXT_TOKENS_PER_SLOT`.
pub fn plan(input: &LaunchInput) -> Option<LaunchPlan> {
    let (ceiling, prompt_cache_roof, slots) = funded_ceiling(input)?;
    let parallel = input.parallel.max(1);
    let ubatch = u64::from(input.ubatch_size);
    // The owner's request is a TOTAL, the meaning the panel's bounds already
    // carry, so it is divided by the slots exactly as the engine will divide
    // the flag. With no request the answer is the chat default where the
    // machine funds it and the machine's own smaller ceiling where it does
    // not — never the funded maximum, which is not a conversation.
    let requested = match input.context_limit {
        Some(limit) if limit > 0 && limit <= ceiling.saturating_mul(slots) => limit / slots,
        Some(_) => return None,
        None => ceiling.min(DEFAULT_CONTEXT_TOKENS),
    };
    let per_slot = slot_context(requested, slots)?;
    let context_tokens = per_slot * slots;
    let plateau_threads = plateau(input.thread_ramp).map(|(threads, _rate)| threads);
    let threads = thread_count(plateau_threads, input.physical_cores);
    let args = ServerArgs {
        model_path: input.model_path.clone(),
        port: input.port,
        context_tokens,
        cache_ram_mib: prompt_cache_roof / MIB,
        threads,
        offload: offload(input),
        idle_unload_seconds: crate::args::DEFAULT_IDLE_UNLOAD_SECONDS,
        batch_size: input.batch_size,
        ubatch_size: input.ubatch_size,
        kv_cache: input.kv_cache,
        parallel,
        slot_save_path: input.slot_save_path.clone(),
    };
    let footprint = footprint_bytes(input.model, context_tokens);
    // The catalog's footprint is q8_0 arithmetic; the cache the server will
    // actually run is the owner's choice, so the reported cache cost — and the
    // total that carries it — is scaled here, where the choice is known.
    //
    // On top of that per-token cost sits the engine's per-slot allocation,
    // which no per-token figure can carry. The context was funded with this
    // term already subtracted, so the report has to carry it too — otherwise
    // `total_bytes` would understate the reservation by the whole per-slot
    // term while the plan silently spent it.
    let kv_bytes = footprint
        .kv_bytes
        .saturating_mul(input.kv_cache.bytes_per_element())
        .saturating_add(
            slot_cache_bytes(input.model, per_slot, input.kv_cache, ubatch).saturating_mul(slots),
        );
    let memory = MemoryAssumption {
        context_tokens,
        kv_cache_bytes: kv_bytes,
        kv_per_token_assumed: footprint.kv_is_assumed(input.model),
        total_bytes: footprint
            .weights_bytes
            .saturating_add(footprint.mmproj_bytes)
            .saturating_add(footprint.buffer_bytes)
            .saturating_add(kv_bytes),
        budget_bytes: input.budget.usable_bytes,
    };
    Some(LaunchPlan { args, memory })
}

/// The machine's funded maximum as a TOTAL, for the guards that refuse a
/// request above it and for the panel's ceiling. This is the figure the
/// automatic launch used before the chat default lowered it: [`plan`] with no
/// owner request answers `min(`[`DEFAULT_CONTEXT_TOKENS`]`, this)` per slot,
/// so a caller that wants the ceiling rather than the default asks here.
/// Shares its arithmetic with [`plan`] — one copy, never a second.
pub fn funded_maximum(input: &LaunchInput) -> Option<u64> {
    let (ceiling, _roof, slots) = funded_ceiling(input)?;
    Some(slot_context(ceiling, slots)?.saturating_mul(slots))
}

/// What one slot may be given before the engine's own alignment: the
/// funded total divided by the slots, capped by the length the model was
/// trained for. That cap bounds ONE sequence — what a slot is — so it is
/// applied per slot, never to the total: a 4096-trained model serves four
/// slots of 4096 if the memory funds them, and its total is 16384, which is
/// not a figure the training length ever enters.
fn per_slot_ceiling(funded_total: u64, trained: Option<u64>, slots: u64) -> Option<u64> {
    let shared = funded_total / slots;
    match trained {
        // A header that was there and read as zero is broken data about the
        // model, not a model with no context: refused, as before.
        Some(0) => None,
        Some(trained) => Some(shared.min(trained)),
        None => Some(shared),
    }
}

/// The engine pads a slot's context up to this multiple
/// (`src/llama-context.cpp`: `GGML_PAD(cparams.n_ctx_seq, 256)`), so a
/// per-slot figure that is not a multiple inflates the KV allocation by up
/// to 255 tokens per slot without the budget ever paying for it.
const SLOT_CONTEXT_ALIGNMENT: u64 = 256;

/// The per-slot size the server is given, or `None` below the floor. With
/// one slot this is the pre-slot arithmetic untouched: the engine's division
/// by one is exact, so alignment has nothing to fix, and rounding down would
/// trade tokens the engine pads back anyway (`GGML_PAD(n_ctx, 256)`) for no
/// memory saved — a change to today's argv that buys nothing. Above one slot
/// the total is aligned per slot so the division and the padding are exact.
fn slot_context(requested: u64, slots: u64) -> Option<u64> {
    if slots == 1 {
        return (requested > 0).then_some(requested);
    }
    let aligned = requested - requested % SLOT_CONTEXT_ALIGNMENT;
    (aligned >= crate::args::MIN_CONTEXT_TOKENS_PER_SLOT).then_some(aligned)
}

/// The machine's funded MAXIMUM per slot at `parallel` slots — the ceiling
/// the guards refuse a larger request against, and the figure the panel shows
/// as the top of the range — or `None` when it cannot fund even one token.
/// This is NOT the automatic launch: [`plan`] lowers the ceiling to
/// [`DEFAULT_CONTEXT_TOKENS`] when the owner has not chosen, and that smaller
/// answer is `min` of this and the chat default. The narrow question a caller
/// asks before any plan exists (a preview has no downloaded file to point at
/// and no port), answered from the one copy of the arithmetic rather than a
/// recomputation beside it. It previews under the automatic q8_0 cache at the
/// caller's slot count, and its answer is PER SLOT: the engine divides
/// `--ctx-size` by `--parallel`, so a preview that kept one slot's figure
/// while the plan ran N would promise one device the window of N. The owner's
/// f16 choice scales the per-token figure and travels through [`plan`].
pub fn funded_context(model: &ModelEntry, usable_bytes: u64, parallel: u32) -> Option<u64> {
    // The shipped micro-batch: the preview carries no owner override, and the
    // default is what the plan is built with when the panel has not asked for
    // another. The per-slot term is included through the same arithmetic
    // `plan` funds with, so a preview cannot offer a window the launch would
    // refuse. One slot is clamped once, as [`funded_ceiling`] does, so a raw
    // zero cannot ask the arithmetic about no slots.
    let slots = u64::from(parallel.max(1));
    let (funded, _roof) = context_and_prompt_cache_roof(
        model,
        usable_bytes,
        KvCache::Q8_0,
        slots,
        u64::from(crate::args::UBATCH),
    )?;
    let ceiling = per_slot_ceiling(funded, model.trained_context_tokens, slots)?;
    slot_context(ceiling, slots)
}

/// THE BUDGET ARITHMETIC, AMENDED — this function now splits what is left
/// after the fixed footprint into the live context and the prompt cache
/// that keeps yesterday's chat warm. Before the amendment the context spent
/// the whole leftover, and the cache roof — computed from the context,
/// then — grew with the machine: on a 64 GiB row the roof reached 90 GiB,
/// above the 8192 MiB binary default it was meant to cap. Now the roof is
/// carved first and the context takes the rest.
///
/// Per shipped row, context before → after the amendment (Metal, measured
/// through `plan`): Trinity-Nano 16 GiB 87 087 → 65 315; Qwen 3.5 16 GiB
/// 94 917 → 71 188; Granite 4 Tiny 32 GiB 213 642 → 160 232; Qwen 3.5
/// 64 GiB 488 133 → 422 597. The lost tokens were never usable: a context
/// ten times the model's training length is funded arithmetic, not memory
/// anyone's conversation reaches. The roof itself is bounded by the chats
/// it serves, never by the machine's size (see
/// [`prompt_cache_roof_bytes`]).
///
/// The catalog's arithmetic is otherwise unchanged:
/// `weights + mmproj + compute buffers + KV + roof + margin <= usable
/// RAM`, solved for KV's term after the roof. Whole tokens: the floor is
/// the answer, never a rounding up that the budget did not pay for.
///
/// On the assumed per-token figure the choice is conservative by direction:
/// 96 KiB is "above every dense model in this catalog", so an unmeasured
/// dense row's true cache is cheaper than budgeted and the context is
/// *smaller* than the machine could fund — wasted tokens, never memory. The
/// exposure is a row whose real cost exceeds the assumption: the server
/// allocates from the GGUF, not from this arithmetic, and the excess lands
/// on the machine unannounced — which is what
/// [`crate::MemoryAssumption::kv_per_token_assumed`] exists to name, and
/// what a row measurement retires. Defending by inflating the assumption
/// would halve every dense row's context to insure against a direction the
/// constant already guards; the honest fix for the rows above it is a
/// measurement, not a bigger guess.
/// The catalog's per-token figures are stated in q8_0 bytes — the catalog's
/// chosen unit, whose conservative relationship to the real q8_0 block
/// layout is spelled out on [`KvCache::bytes_per_element`] — so the owner's
/// choice is applied here: f16 costs two bytes per element and therefore
/// halves the funded context. The multiplier is what makes the arithmetic
/// follow the knob; without it the plan would fund a context the machine
/// cannot hold at f16.
fn context_and_prompt_cache_roof(
    model: &ModelEntry,
    usable_bytes: u64,
    kv_cache: KvCache,
    slots: u64,
    ubatch_size: u64,
) -> Option<(u64, u64)> {
    let per_token = match model.kv_bytes_per_token {
        // A zero measurement is broken data: refuse it rather than silently
        // substituting the assumption and calling the result measured.
        Some(0) => return None,
        Some(per_token) => per_token,
        None => ASSUMED_KV_BYTES_PER_TOKEN,
    }
    .saturating_mul(kv_cache.bytes_per_element());
    let fixed = model
        .weights_bytes
        .saturating_add(model.mmproj_bytes.unwrap_or(0))
        .saturating_add(COMPUTE_BUFFER_BYTES);
    let leftover = usable_bytes.checked_sub(fixed)?;
    let prompt_cache_roof = prompt_cache_roof_bytes(leftover, kv_cache);
    let kv_budget = leftover.checked_sub(prompt_cache_roof)?;
    let funded = funded_cache_tokens(model, kv_budget, per_token, slots, kv_cache, ubatch_size)?;
    // The memory-funded ceiling, before the length the model was trained for
    // is applied: that cap bounds one sequence, so it belongs to the per-slot
    // arithmetic ([`per_slot_ceiling`]), not here where only the total is
    // known. A row with no header read keeps the memory figure, because a
    // guessed limit is worse than none.
    (funded > 0).then_some((funded, prompt_cache_roof))
}

/// The per-stream cell count of a sliding-window pool holding
/// `per_slot_tokens` of context: `PAD(min(per_slot_tokens, n_swa + ubatch),
/// 256)`, the engine's own expression (`src/llama-kv-cache-iswa.cpp:84`) with
/// `unified` false — the explicit `-np N` shape this product ships. The
/// `+ ubatch` is headroom for a micro-batch that runs past the window; the
/// pad is the alignment the engine always applies. `u64::MAX` asks for the
/// pool at its saturating size.
fn sliding_window_cells(window_tokens: u64, ubatch_size: u64, per_slot_tokens: u64) -> u64 {
    let want = per_slot_tokens.min(window_tokens.saturating_add(ubatch_size));
    want.div_ceil(SLOT_CONTEXT_ALIGNMENT) * SLOT_CONTEXT_ALIGNMENT
}

/// Bytes the engine gives this row's PER-SLOT cache at a per-slot context of
/// `per_slot_tokens`: the sliding-window pool replicated for one stream
/// (`llama-kv-cache.cpp:88`: `n_stream = n_seq_max` when not unified), or the
/// recurrent state, or nothing. [`SlotCache::None`] rows have one pool divided
/// by the slot count and pay nothing extra (`docs/MULTI-DEVICE-SHAPE.md` §7).
///
/// The two variants are sized in the currency their tensor is made of: the
/// window pool is q8_0/f16 cache elements, so [`KvCache::geometry_bytes`]
/// gives the real block cost; the recurrent state is F32 whatever the cache
/// knob says (`src/llama-model.cpp:2679-2680`), so it is already bytes.
fn slot_cache_bytes(
    model: &ModelEntry,
    per_slot_tokens: u64,
    kv_cache: KvCache,
    ubatch_size: u64,
) -> u64 {
    match model.slot_cache {
        SlotCache::None => 0,
        SlotCache::SlidingWindow {
            window_tokens,
            width_per_cell,
        } => {
            let cells = sliding_window_cells(window_tokens, ubatch_size, per_slot_tokens);
            kv_cache.geometry_bytes(width_per_cell.saturating_mul(cells))
        }
        SlotCache::Recurrent { bytes_per_slot } => bytes_per_slot,
    }
}

/// What a context costs in KV cache, as the panel can price any length the
/// owner types without doing the cache arithmetic itself. The two terms are
/// the ones the engine actually charges: `bytes_per_token` is the
/// context-wide pool's price under the chosen cache type, and `bytes_fixed`
/// is every slot's own allocation — a sliding-window pool at its saturated
/// size, or a recurrent state — summed over the slots.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContextPrice {
    pub bytes_per_token: u64,
    pub bytes_fixed: u64,
}

impl ContextPrice {
    /// The cache the engine allocates for `context_tokens` (a TOTAL, the
    /// meaning the panel's bounds carry). Exact at and above the window's
    /// saturation, which is where every context the app offers sits; below
    /// it the real pool is smaller, so the figure errs high — the safe
    /// direction for a number shown before a choice is made.
    pub fn at(self, context_tokens: u64) -> u64 {
        self.bytes_per_token
            .saturating_mul(context_tokens)
            .saturating_add(self.bytes_fixed)
    }
}

/// The price of a context for this row under `kv_cache`, with `slots` streams
/// of `ubatch_size`. Built from the same two terms [`plan`]'s solve and
/// report use — the per-token figure and [`slot_cache_bytes`] — so the panel's
/// number is the launcher's arithmetic and not a second one. `None` for a row
/// whose per-token figure is broken data, which [`plan`] refuses outright.
pub fn context_price(
    model: &ModelEntry,
    kv_cache: KvCache,
    ubatch_size: u64,
    parallel: u32,
) -> Option<ContextPrice> {
    let per_token = match model.kv_bytes_per_token {
        Some(0) => return None,
        Some(per_token) => per_token,
        None => ASSUMED_KV_BYTES_PER_TOKEN,
    };
    let slots = u64::from(parallel.max(1));
    Some(ContextPrice {
        bytes_per_token: per_token.saturating_mul(kv_cache.bytes_per_element()),
        bytes_fixed: slot_cache_bytes(model, u64::MAX, kv_cache, ubatch_size).saturating_mul(slots),
    })
}

/// The largest total context whose KV fits `kv_budget_bytes` across `slots`
/// streams. The engine's explicit-`-np` shape is
/// `kv_total = per_token * ctx + slots * per_slot_term(ctx / slots)`:
/// the context-wide pool divides with the slot count, the sliding-window pool
/// and the recurrent state do not (`src/llama-kv-cache-iswa.cpp:84,104-118`;
/// `src/llama-kv-cache.cpp:88`). The money solve has two sides of one kink:
///
/// * **saturated** — pay `slots` saturated per-slot terms first, then buy the
///   rest with the per-token figure. This is what "subtract N x the per-slot
///   constant, then divide by N" means, and it is the whole story once
///   `ctx / slots` reaches the pool's saturating size;
/// * **growing** — below that size the window pool has NOT saturated, so
///   every windowed layer holds the whole per-slot context and the per-token
///   cost is the context-wide figure plus the windowed width. The saturated
///   side priced cells the engine would not allocate.
///
/// The curve is continuous at the kink and the sides are the only two exact
/// regimes, so the answer is the side the kink selects — never a blend. A
/// hybrid (recurrent) row has no growing side: its per-slot term is constant
/// from the first token.
fn funded_cache_tokens(
    model: &ModelEntry,
    kv_budget_bytes: u64,
    per_token: u64,
    slots: u64,
    kv_cache: KvCache,
    ubatch_size: u64,
) -> Option<u64> {
    debug_assert!(per_token > 0);
    let per_slot_constant = slot_cache_bytes(model, u64::MAX, kv_cache, ubatch_size);
    let after_constant = kv_budget_bytes.checked_sub(per_slot_constant.checked_mul(slots)?)?;
    let saturated = after_constant / per_token;
    if let SlotCache::SlidingWindow {
        window_tokens,
        width_per_cell,
    } = model.slot_cache
    {
        let saturating_cells = sliding_window_cells(window_tokens, ubatch_size, u64::MAX);
        if saturated < slots.saturating_mul(saturating_cells) {
            let growing_per_token =
                per_token.saturating_add(kv_cache.geometry_bytes(width_per_cell));
            // The window cell count is the per-slot context itself, so the
            // solve is exact only on the engine's own 256 grid; a total off
            // the grid would hand the engine padding cells the budget never
            // paid for.
            let raw = kv_budget_bytes / growing_per_token;
            return Some(raw - raw % (SLOT_CONTEXT_ALIGNMENT.saturating_mul(slots)));
        }
    }
    Some(saturated)
}

/// Is this row's trained context a header we could not read? `None` on the
/// field means it was never in the file, and the memory figure stands;
/// `Some(0)` means it was there and is nonsense — this model's context
/// length could not be read, which is a fact about the file, not about the
/// computer. [`plan`] refuses both with a bare `None`, so the start path
/// asks here first, before the arithmetic, and never blames the machine for
/// a header it read wrong.
pub fn trained_context_unreadable(model: &ModelEntry) -> bool {
    model.trained_context_tokens == Some(0)
}

/// The prompt cache keeps yesterday's chat warm; its roof is carved out of
/// the leftover before the context is sized, because the context otherwise
/// spends every byte that is left and the roof would grow with the machine
/// instead of with the chats it serves.
///
/// Measured on the shipped build with four 4.5k-token conversations, about
/// 100 MiB stored each: with the roof at 768 MiB only the most recent chat
/// stayed warm, at 1536 MiB all four did. That measurement is where
/// PROMPT_CACHE_CHAT_TOKENS and PROMPT_CACHE_KEPT_CHATS come from — two
/// long chats at the budget's own KV assumption, one alive and one asleep.
///
/// The figure is a hard CAP, not a reservation: `--cache-ram` becomes
/// `limit_size` (`tools/server/server-task.h:613`), and the allocator skips
/// any state larger than the cap outright — "prompt state size ...". MiB
/// exceeds cache size limit ..., skipping" (`tools/server/server-task.cpp`,
/// `server_prompt_cache::alloc`) — so this arithmetic cannot oversubscribe
/// the machine. What the cap governs is the warm start, and that is why it
/// follows the cache type: the two long chats are priced in q8_0 bytes, so
/// at f16 the same two chats cost `KvCache::bytes_per_element()` times more,
/// and an unscaled cap would hold roughly one of them — a long f16 chat
/// would be skipped rather than kept warm. Scaling makes the funded context
/// smaller at f16 (the roof is carved first), which is the safe direction:
/// fewer tokens, the warm chat kept.
///
/// The quarter-of-the-leftover share is a rule, not a measurement: no
/// experiment chose it. It is the brake that keeps a big machine from
/// turning its whole advance into sleeping chats — hoarding the advance
/// would be the "gentle on the PC" rule broken from the other side.
const PROMPT_CACHE_CHAT_TOKENS: u64 = 32 * 1024;
/// One chat alive, one asleep — at the cache type in force.
const PROMPT_CACHE_KEPT_CHATS: u64 = 2;
/// A rule, not a measurement: the roof takes at most this share of the
/// leftover after the fixed footprint.
const PROMPT_CACHE_ROOF_SHARE: u64 = 4;

fn prompt_cache_roof_bytes(leftover_bytes: u64, kv_cache: KvCache) -> u64 {
    let two_long_chats = ASSUMED_KV_BYTES_PER_TOKEN
        .saturating_mul(PROMPT_CACHE_CHAT_TOKENS)
        .saturating_mul(PROMPT_CACHE_KEPT_CHATS)
        .saturating_mul(kv_cache.bytes_per_element());
    (leftover_bytes / PROMPT_CACHE_ROOF_SHARE).min(two_long_chats)
}

/// What the GPU gets: everything, or nothing — never a share of the layers.
///
/// Measured upstream (plan 4c): 18.49 tok/s fully on the GPU, 12.19 on CPU,
/// 5.68 split across both — the split is 2.15x slower than plain CPU, and no
/// `-ngl` sweep exists to turn that into a formula. That is why the fallback
/// here is CPU decode rather than "offload what fits", which would look like
/// the sensible middle and measure as the worst option.
fn offload(input: &LaunchInput) -> Offload {
    match input.backend {
        // The CPU build has no GPU code in it: a GPU flag there is not a
        // decision, it is noise on the command line.
        ServerBackend::Cpu => Offload::NoGpuBuild,
        // Every GPU-capable build offloads all layers by default, so the
        // decision is stated explicitly either way. "All" is only honest when
        // the budget was actually sized for the memory the model decodes
        // from — the card's own VRAM, or unified memory. When it was not
        // (unreadable VRAM, undetected hardware), the default must be
        // overridden: a model sized against system RAM, handed unasked to a
        // card of unknown size, is how VRAM OOMs happen.
        _ if input.budget.gpu_accounted_for => Offload::All,
        _ => Offload::ForcedOff,
    }
}

#[cfg(test)]
mod menu;

#[cfg(test)]
mod slot_cache;

#[cfg(test)]
mod slots;

#[cfg(test)]
mod solve;

#[cfg(test)]
mod tests {
    use super::*;
    use kalsa_catalog::footprint::{fits, memory_budget, GIB, KIB, MIB};
    use kalsa_catalog::rows;
    use kalsa_probe::Backend;

    /// The row most of these tests ride on: small enough to be fundable on
    /// every budget in the suite, shipped and usable.
    const GRANITE: &str = "IBM Granite 4 Tiny";

    /// A real, usable catalog row, so the compiler — not this file — notices
    /// when the row's shape changes, and the tests exercise something the
    /// product actually ships.
    pub(super) fn shipped_row(name: &str) -> &'static ModelEntry {
        rows()
            .find(|entry| entry.display_name == name)
            .unwrap_or_else(|| {
                panic!("{name} left the catalog: re-point these tests at a shipped row")
            })
    }

    /// Hand-built, and it has to be: a broken zero measurement, the one
    /// shape no shipped row may ever carry. Everything else here runs on
    /// real rows.
    fn broken_row(weights_bytes: u64) -> ModelEntry {
        ModelEntry {
            repo: "test/broken",
            display_name: "Broken Row",
            last_modified: "2026-01-01",
            licence: kalsa_catalog::Licence::Open("apache-2.0"),
            parameters: kalsa_catalog::Parameters::dense(8_000_000_000),
            quant: "Q4_K_M",
            weights_bytes,
            mmproj_bytes: None,
            kv_bytes_per_token: Some(0),
            slot_cache: SlotCache::None,
            kv_assumption_undercounts: false,
            measured_decode: None,
            // The fixture's limit is the memory's, so the trained cap never binds.
            trained_context_tokens: None,
            dense_equivalent: None,
            stale: None,
        }
    }

    /// A row research flagged as under-counted by the shared 96 KiB
    /// assumption, carrying its measured 163 840 bytes-per-token in the
    /// q8_0 this crate pins. Hand-built because no shipped row carries the
    /// flag or a figure above the assumption any more — the same reason
    /// `broken_row` exists.
    fn undercounted_row(weights_bytes: u64) -> ModelEntry {
        ModelEntry {
            repo: "test/undercounted",
            display_name: "Undercounted Fixture",
            last_modified: "2026-01-01",
            licence: kalsa_catalog::Licence::Open("apache-2.0"),
            parameters: kalsa_catalog::Parameters::dense(70_000_000_000),
            quant: "Q4_K_M",
            weights_bytes,
            mmproj_bytes: None,
            kv_bytes_per_token: Some(163_840),
            slot_cache: SlotCache::None,
            kv_assumption_undercounts: true,
            measured_decode: None,
            // The fixture's limit is the memory's, so the trained cap never binds.
            trained_context_tokens: None,
            dense_equivalent: None,
            stale: None,
        }
    }

    /// The roof as the production argv states it, MiB.
    fn cache_ram_mib(line: &str) -> u64 {
        let words: Vec<&str> = line.split_whitespace().collect();
        words
            .iter()
            .position(|word| *word == "--cache-ram")
            .and_then(|index| words.get(index + 1))
            .and_then(|value| value.parse().ok())
            .unwrap_or_else(|| panic!("the plan must always state a cache roof: {line}"))
    }

    pub(super) fn input<'a>(
        backend: ServerBackend,
        budget: MemoryBudget,
        model: &'a ModelEntry,
        ramp: &'a [(usize, f64)],
    ) -> LaunchInput<'a> {
        LaunchInput {
            backend,
            model,
            budget,
            thread_ramp: ramp,
            physical_cores: None,
            model_path: PathBuf::from("/models/chosen.gguf"),
            port: 8123,
            context_limit: None,
            batch_size: 2048,
            ubatch_size: 512,
            kv_cache: KvCache::Q8_0,
            parallel: crate::args::DEFAULT_PARALLEL,
            slot_save_path: PathBuf::from("/slots"),
        }
    }

    /// The ramp the plan measured on the M1 Max: flat after eight threads,
    /// and five threads (cores / 2) was 21% short of the ceiling.
    pub(super) const M1_MAX_RAMP: &[(usize, f64)] =
        &[(1, 55.8), (4, 88.0), (8, 112.2), (12, 105.1)];
    /// A four-core machine whose plateau is two threads.
    const QUAD_CORE_RAMP: &[(usize, f64)] = &[(1, 20.0), (2, 35.0), (4, 36.0)];
    /// A ramp whose plateau is 22 — the Lenovo's overshoot shape (fixture
    /// numbers, not measurements): the tail climbs onto logical threads the
    /// machine's 16 physical cores cannot feed.
    const LENOVO_RAMP: &[(usize, f64)] =
        &[(1, 10.0), (2, 20.0), (4, 40.0), (8, 80.0), (16, 160.0), (22, 170.0)];

    #[test]
    fn the_context_fits_after_the_chat_reserve_and_never_one_token_into_it() {
        // Granite 4 Tiny (4_230_976_352 bytes) on an 8 GiB CPU machine:
        // 5 GiB usable, minus the weights and 512 MiB of compute buffers,
        // leaves 600_861_856 bytes. The sleeping-chat reserve takes a
        // quarter — 150_215_464 bytes — and the row's own per-slot state
        // (58_060_800 bytes of recurrent R+S, charged before a single token)
        // comes out next: 392_585_592 bytes at 96 KiB/token = 3993 whole
        // tokens. The machine could fund a 3994th; the reserve PLUS the state
        // is what stops it, and that boundary is what the last assertions
        // pin. `fits` prices only the flat per-token cache, so it cannot show
        // this boundary; it is left as a weak sanity check only.
        let model = shipped_row(GRANITE);
        let budget = memory_budget(Backend::Cpu, 8 * GIB);
        let launched = plan(&input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP))
            .expect("the model is fundable");
        assert_eq!(launched.args.context_tokens, 3_993);
        assert!(fits(model, launched.args.context_tokens, &budget));
        let state = slot_cache_bytes(
            model,
            launched.args.context_tokens,
            KvCache::Q8_0,
            u64::from(crate::args::UBATCH),
        );
        assert_eq!(state, 58_060_800, "Granite's recurrent state, per slot");
        let leftover = budget.usable_bytes
            - model
                .weights_bytes
                .saturating_add(model.mmproj_bytes.unwrap_or(0))
                .saturating_add(COMPUTE_BUFFER_BYTES);
        let roof = leftover / PROMPT_CACHE_ROOF_SHARE;
        assert!(
            roof + state + (launched.args.context_tokens + 1) * ASSUMED_KV_BYTES_PER_TOKEN
                > leftover,
            "one more token would be taken from the sleeping chats' reserve"
        );
        assert!(
            roof + state + launched.args.context_tokens * ASSUMED_KV_BYTES_PER_TOKEN <= leftover,
            "the funded context never reaches into the reserve"
        );
        assert_eq!(launched.memory.kv_cache_bytes, 3_993 * 96 * KIB + state);
        assert!(
            launched.memory.kv_per_token_assumed,
            "Granite still prices its context on the assumption"
        );
        // The roof the plan carries is the reserve, in whole MiB.
        assert_eq!(
            launched.args.cache_ram_mib,
            (leftover / PROMPT_CACHE_ROOF_SHARE) / MIB
        );
    }

    #[test]
    fn a_model_the_machine_cannot_fund_is_not_started() {
        let budget = memory_budget(Backend::Cpu, 8 * GIB);
        // Gemma 4 E4B ships in the catalog and an 8 GiB machine cannot fund
        // it: 5.03 GiB of weights plus 512 MiB of buffers already exceed the
        // 5 GiB budget. Starting it small is how an OOM kill happens.
        let too_big = shipped_row("Google Gemma 4 E4B");
        assert!(plan(&input(ServerBackend::Cpu, budget, too_big, M1_MAX_RAMP)).is_none());
        // A zero per-token measurement is broken data, not a free cache.
        let garbage = broken_row(4 * GIB);
        assert!(plan(&input(ServerBackend::Cpu, budget, &garbage, M1_MAX_RAMP)).is_none());
    }

    #[test]
    fn the_cpu_build_gets_no_gpu_flags() {
        let model = shipped_row(GRANITE);
        let budget = memory_budget(Backend::Cpu, 16 * GIB);
        let launched = plan(&input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP))
            .expect("the model is fundable");
        assert_eq!(launched.args.offload, Offload::NoGpuBuild);
        let line = launched.args.argv().join(" ");
        assert!(!line.contains("n-gpu-layers"), "{line}");
    }

    #[test]
    fn a_gpu_that_cannot_hold_the_model_is_not_asked_to_hold_part_of_it() {
        // VRAM could not be read honestly, so the budget is system RAM and
        // says the card was not accounted for: CPU decode, forced explicitly,
        // because a GPU build would otherwise offload every layer by default.
        let model = shipped_row(GRANITE);
        let unreadable = memory_budget(Backend::DiscreteGpu { vram_bytes: None }, 32 * GIB);
        assert!(!unreadable.gpu_accounted_for);
        let launched = plan(&input(
            ServerBackend::Vulkan,
            unreadable,
            model,
            M1_MAX_RAMP,
        ))
        .expect("the model fits the RAM budget");
        assert_eq!(launched.args.offload, Offload::ForcedOff);
        let line = launched.args.argv().join(" ");
        assert!(line.contains("--n-gpu-layers 0"), "{line}");
        // An Intel Mac runs the same Metal archive and its hardware reads as
        // Unknown: same answer, for the same reason.
        let intel_mac = memory_budget(Backend::Unknown, 16 * GIB);
        let launched = plan(&input(ServerBackend::Metal, intel_mac, model, M1_MAX_RAMP))
            .expect("the model fits the RAM budget");
        assert_eq!(launched.args.offload, Offload::ForcedOff);
    }

    #[test]
    fn a_gpu_the_budget_was_sized_for_gets_every_layer() {
        let model = shipped_row(GRANITE);
        // The card's own memory is the budget: usable(8 GiB) = 5 GiB, and the
        // 4 GiB model was chosen against it, so full offload is what the
        // catalog already promised.
        let card = memory_budget(
            Backend::DiscreteGpu {
                vram_bytes: Some(8 * GIB),
            },
            32 * GIB,
        );
        let launched = plan(&input(ServerBackend::Cuda12, card, model, M1_MAX_RAMP))
            .expect("the model fits the VRAM budget");
        assert_eq!(launched.args.offload, Offload::All);
        let line = launched.args.argv().join(" ");
        assert!(line.contains("--n-gpu-layers all"), "{line}");
        // Apple Silicon: unified memory, Metal always.
        let mac = memory_budget(Backend::Metal, 16 * GIB);
        let launched = plan(&input(ServerBackend::Metal, mac, model, M1_MAX_RAMP))
            .expect("the model fits unified memory");
        assert_eq!(launched.args.offload, Offload::All);
    }

    #[test]
    fn the_thread_count_is_the_measured_plateau_not_a_fraction() {
        let model = shipped_row(GRANITE);
        let budget = memory_budget(Backend::Cpu, 16 * GIB);
        let launched = plan(&input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP))
            .expect("the model is fundable");
        assert_eq!(
            launched.args.threads,
            Some(8),
            "cores / 2 = 6 would be the old defect"
        );
        let line = launched.args.argv().join(" ");
        assert!(line.contains("--threads 8"), "{line}");
        assert!(line.contains("--threads-batch 8"), "{line}");

        // A different measurement gives a different answer: the count follows
        // the ramp, not a constant.
        let launched = plan(&input(ServerBackend::Cpu, budget, model, QUAD_CORE_RAMP))
            .expect("the model is fundable");
        assert_eq!(launched.args.threads, Some(2));

        // Nothing measurable: no flag, and the omission is on the record.
        let dead = [(1, 0.0), (2, 0.0)];
        let launched =
            plan(&input(ServerBackend::Cpu, budget, model, &dead)).expect("the model is fundable");
        assert_eq!(launched.args.threads, None);
        let line = launched.args.argv().join(" ");
        assert!(!line.contains("--threads"), "{line}");
    }

    /// The thread rule: min(plateau, physical cores), and the plateau alone
    /// when the physical count is unknown.
    #[test]
    fn the_thread_count_is_capped_by_the_physical_cores() {
        let model = shipped_row(GRANITE);
        let budget = memory_budget(Backend::Cpu, 16 * GIB);

        // The Lenovo (16 physical / 22 logical): the plateau read 22, and
        // at 22 decode was 26.5% slower than at 16 — the cap wins (n=2 per
        // arm; the two 22-thread runs were 29% apart).
        let mut lenovo = input(ServerBackend::Cpu, budget, model, LENOVO_RAMP);
        lenovo.physical_cores = Some(16);
        let launched = plan(&lenovo).expect("the model is fundable");
        assert_eq!(launched.args.threads, Some(16));
        let line = launched.args.argv().join(" ");
        assert!(line.contains("--threads 16"), "{line}");
        assert!(line.contains("--threads-batch 16"), "{line}");

        // The M1 Max: plateau 8, physical 10 — the cap does not bite.
        let mut m1_known = input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP);
        m1_known.physical_cores = Some(10);
        let launched = plan(&m1_known).expect("the model is fundable");
        assert_eq!(launched.args.threads, Some(8));

        // Unknown physical count: the plateau alone decides, as before.
        let mut m1_unknown = input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP);
        m1_unknown.physical_cores = None;
        let launched = plan(&m1_unknown).expect("the model is fundable");
        assert_eq!(launched.args.threads, Some(8));
    }

    /// A physical count of zero is a failed read that answered anyway, not
    /// eight fewer threads: unknown, so the plateau alone decides and
    /// `--threads 0` can never be rendered.
    #[test]
    fn a_physical_count_of_zero_is_unknown_not_zero_threads() {
        assert_eq!(thread_count(Some(8), Some(0)), Some(8));
        assert_eq!(thread_count(Some(8), Some(4)), Some(4));
        assert_eq!(thread_count(Some(8), None), Some(8));
        assert_eq!(thread_count(None, Some(4)), None);
    }

    #[test]
    fn the_memory_report_is_the_cost_of_the_arguments_actually_produced() {
        // The row on disk carries a measured cache figure, so the report is
        // checked against the row's own number rather than the assumption.
        let model = shipped_row("Alibaba Qwen 3.6");
        let budget = memory_budget(Backend::Metal, 64 * GIB);
        let launched = plan(&input(ServerBackend::Metal, budget, model, M1_MAX_RAMP))
            .expect("the model is fundable");

        // The report is the footprint of exactly the context the arguments
        // carry — recomputed here from the catalog, not copied from the plan.
        // The row is recurrent: beside the per-token half (the catalog's
        // measurement × the context) the plan charges the F32 state the
        // engine allocates per slot, so the report carries both terms.
        let footprint = footprint_bytes(model, launched.args.context_tokens);
        let slots = u64::from(launched.args.parallel);
        let state = slot_cache_bytes(
            model,
            launched.args.context_tokens / slots,
            KvCache::Q8_0,
            u64::from(crate::args::UBATCH),
        );
        assert_eq!(launched.memory.context_tokens, launched.args.context_tokens);
        assert_eq!(
            launched.memory.kv_cache_bytes,
            footprint.kv_bytes + state * slots
        );
        assert_eq!(
            launched.memory.total_bytes,
            footprint
                .weights_bytes
                .saturating_add(footprint.mmproj_bytes)
                .saturating_add(footprint.buffer_bytes)
                .saturating_add(launched.memory.kv_cache_bytes)
        );
        assert_eq!(launched.memory.budget_bytes, budget.usable_bytes);
        assert!(!launched.memory.kv_per_token_assumed);
        assert!(launched.memory.total_bytes <= budget.usable_bytes);

        // And the arguments produce the cache the arithmetic counted: one
        // byte per element (q8_0, with flash attention, without which a
        // quantized V cache is refused) and the binary's own default
        // micro-batch, whose compute buffers measured 60 MiB — inside the
        // 512 MiB forfait this arithmetic carries.
        let line = launched.args.argv().join(" ");
        assert!(line.contains("--cache-type-k q8_0"), "{line}");
        assert!(line.contains("--cache-type-v q8_0"), "{line}");
        assert!(line.contains("--flash-attn on"), "{line}");
        assert!(line.contains("--ubatch-size 512"), "{line}");
        assert!(line.contains("--batch-size 2048"), "{line}");
    }

    #[test]
    fn yesterdays_chat_starts_warm_because_the_server_runs_one_classic_slot() {
        // With the default slot count this build runs a unified KV buffer
        // and clears idle slots on every new task, measured on the shipped
        // build: an alternating conversation paid the whole prefill every
        // turn (cache_n 0, ~4.0 s at 4.5k tokens). One classic slot keeps
        // the prompt cache in the game — the same turn measured 187 ms —
        // which is why the flag says 1 and not the default.
        let model = shipped_row(GRANITE);
        let budget = memory_budget(Backend::Metal, 64 * GIB);
        let launched = plan(&input(ServerBackend::Metal, budget, model, M1_MAX_RAMP))
            .expect("the model is fundable");
        let line = launched.args.argv().join(" ");
        // The argv carries the args' own value, not a literal: if the field
        // and the rendered flag ever drift, this assertion names the drift.
        assert_eq!(
            launched.args.parallel,
            crate::args::DEFAULT_PARALLEL,
            "the planned slot count is not the shared default"
        );
        assert!(
            line.contains(&format!("--parallel {}", launched.args.parallel)),
            "{line}"
        );
    }

    #[test]
    fn every_shipped_plan_keeps_the_whole_reservation_inside_the_budget() {
        // A property, not a formula: whatever the roof arithmetic says, the
        // whole reservation — weights, mmproj, compute buffers, the live
        // context, and the sleeping chats — must fit inside what the
        // machine can give, for every shipped row on every machine size.
        // And the roof never exceeds the binary's own 8192 MiB default: a
        // limit wider than the default it replaces is not a limit. The
        // first cut of the roof ("two KV reservations", computed from a
        // context that had already spent the whole leftover) failed both
        // here: 90 GiB of cache on a 64 GiB machine.
        for model in rows() {
            for gib in [8u64, 16, 32, 64] {
                let budget = memory_budget(Backend::Metal, gib * GIB);
                let Some(launched) = plan(&input(ServerBackend::Metal, budget, model, M1_MAX_RAMP))
                else {
                    continue; // not fundable on this machine: nothing is promised
                };
                let line = launched.args.argv().join(" ");
                let roof_mib = cache_ram_mib(&line);
                // The plan's own total, not `footprint_bytes`: the latter is
                // the flat per-token product and would leave a sliding-window
                // row's per-slot replication out of the reservation it is
                // checking.
                let reserved = launched.memory.total_bytes + roof_mib * MIB;
                assert!(
                    reserved <= budget.usable_bytes,
                    "{} on {gib} GiB: context {} tokens, roof {roof_mib} MiB, \
                     reserved {reserved} over usable {}",
                    model.display_name,
                    launched.args.context_tokens,
                    budget.usable_bytes
                );
                assert!(
                    roof_mib <= 8192,
                    "{} on {gib} GiB: roof {roof_mib} MiB is wider than the \
                     binary default it replaces",
                    model.display_name
                );
                eprintln!(
                    "{:<26} {:>3} GiB | ctx {:>7} | roof {:>5} MiB",
                    model.display_name, gib, launched.args.context_tokens, roof_mib
                );
            }
        }
    }

    #[test]
    fn the_measured_cache_figure_sizes_the_context_where_the_assumption_undercounted() {
        // A row research flagged as under-counted by the 96 KiB assumption,
        // carrying its measured 163_840 bytes per token at the q8_0 this
        // crate pins — hand-built, because no shipped row carries the flag
        // or a figure above the assumption any more. On 64 GiB (48 GiB
        // usable = 51_539_607_552 bytes), 40 GiB of weights and 512 MiB of
        // buffers leave 8_053_063_680 bytes; the sleeping-chat reserve takes
        // a quarter — 2_013_265_920 — and the context funds the rest:
        // 6_039_797_760 / 163_840 = 36_864 whole tokens. The assumption
        // would have funded 61_440 tokens against a cache the server sizes
        // 1.7x dearer — oversubscribing the machine unannounced, which is
        // exactly what the flag exists to stop. The flag's own door is
        // `standing()` in the catalog; this test holds the sizing
        // arithmetic.
        let model = undercounted_row(40 * GIB);
        let budget = memory_budget(Backend::Cpu, 64 * GIB);
        let launched = plan(&input(ServerBackend::Cpu, budget, &model, M1_MAX_RAMP))
            .expect("the model is fundable");
        assert_eq!(launched.args.context_tokens, 36_864);
        assert!(fits(&model, launched.args.context_tokens, &budget));
        // The machine would pay for another token: the sleeping-chat
        // reserve is what stops it, which is the whole point of carving
        // the roof before the context rather than after.
        assert!(fits(&model, launched.args.context_tokens + 1, &budget));
        assert_eq!(launched.memory.kv_cache_bytes, 36_864 * 163_840);
        assert!(
            !launched.memory.kv_per_token_assumed,
            "this row carries a measurement, not the assumption"
        );
        // The same row on 8 GiB cannot be funded at all: weights and buffers
        // alone exceed the budget, so the answer is no context, not a
        // context that does not fit.
        let small = memory_budget(Backend::Cpu, 8 * GIB);
        assert!(plan(&input(ServerBackend::Cpu, small, &model, M1_MAX_RAMP)).is_none());
    }

    /// The two knobs interact: f16 costs two bytes per element where the
    /// catalog's figures are stated in q8_0 bytes, so the context funded
    /// under f16 is exactly half — floored — the one funded under q8_0. If
    /// the cache type stopped reaching the arithmetic, both plans would
    /// carry the same context and this goes RED.
    ///
    /// Row and budget: Granite 4 Tiny on 8 GiB of CPU. The memory funds 3993
    /// tokens at q8_0, four orders of magnitude below its 1_048_576-token
    /// trained cap, so the cap does not bind and the halving is visible. At
    /// f16 the same leftover buys 1996, which is `3993 / 2`. The row's F32
    /// per-slot state is charged first and does NOT double with the cache
    /// type, so the equality is the floored one the assertion states.
    #[test]
    fn the_cache_type_halves_the_context_the_budget_funds() {
        let model = shipped_row(GRANITE);
        let budget = memory_budget(Backend::Cpu, 8 * GIB);
        let q8_0 = plan(&input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP))
            .expect("the model is fundable");
        let f16 = plan(&LaunchInput {
            kv_cache: KvCache::F16,
            ..input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP)
        })
        .expect("the model is fundable");
        assert_eq!(q8_0.args.kv_cache, KvCache::Q8_0);
        assert_eq!(f16.args.kv_cache, KvCache::F16);
        assert_eq!(q8_0.args.context_tokens, 3_993);
        assert_eq!(f16.args.context_tokens, 1_996);
        assert_eq!(
            f16.args.context_tokens,
            q8_0.args.context_tokens / 2,
            "the f16 funded context must be half the q8_0 one"
        );
    }

    /// The prompt-cache roof is "one chat alive, one asleep" priced in q8_0
    /// bytes, and it must keep that promise at f16: the cap is hard, so an
    /// f16 long chat larger than the cap is skipped by the server and the
    /// warm start is lost. The roof must therefore follow the cache type the
    /// same way the context arithmetic does.
    ///
    /// Granite 4 Tiny on 64 GiB of CPU: at q8_0 the two-long-chats term binds
    /// (6144 MiB); at f16 the same two chats are priced twice and the
    /// quarter-of-the-leftover rule caps them (11_151 MiB). The context the
    /// budget funds, carved after the roof and after the row's 55.371 MiB
    /// per-slot recurrent state, drops from 409_660 tokens to 178_124. Both
    /// automatic contexts are the 65 536 chat default, so the
    /// roof's effect is read from the FUNDED MAXIMA, where it still decides.
    #[test]
    fn the_prompt_cache_roof_keeps_its_two_chat_promise_at_f16() {
        let model = shipped_row(GRANITE);
        let budget = memory_budget(Backend::Cpu, 64 * GIB);
        let q8_0_input = input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP);
        let f16_input = LaunchInput {
            kv_cache: KvCache::F16,
            ..input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP)
        };
        let q8_0 = plan(&q8_0_input).expect("the model is fundable");
        let f16 = plan(&f16_input).expect("the model is fundable");

        assert_eq!(q8_0.args.cache_ram_mib, 6144);
        assert!(
            f16.args.cache_ram_mib > q8_0.args.cache_ram_mib,
            "the roof did not follow the cache type: f16 {} MiB, q8_0 {} MiB",
            f16.args.cache_ram_mib,
            q8_0.args.cache_ram_mib,
        );
        assert_eq!(q8_0.args.context_tokens, DEFAULT_CONTEXT_TOKENS);
        assert_eq!(f16.args.context_tokens, DEFAULT_CONTEXT_TOKENS);
        let q8_0_funded = funded_maximum(&q8_0_input).expect("a funded maximum");
        let f16_funded = funded_maximum(&f16_input).expect("a funded maximum");
        assert_eq!(q8_0_funded, 409_660);
        assert_eq!(f16_funded, 178_124);
        assert!(
            f16_funded < q8_0_funded / 2,
            "the bigger roof must make the f16 funded maximum smaller than half the q8_0 one"
        );
    }

    /// `MemoryAssumption::kv_cache_bytes` is the cost of the cache the server
    /// will actually run, so an f16 plan reports twice the q8_0 figure and a
    /// total that includes the difference. The catalog's `footprint_bytes`
    /// stays q8_0-only; the multiplier belongs here, where the choice is known.
    #[test]
    fn the_memory_report_is_true_for_the_chosen_cache() {
        let model = shipped_row(GRANITE);
        let budget = memory_budget(Backend::Cpu, 64 * GIB);
        let q8_0 = plan(&input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP))
            .expect("the model is fundable");
        let f16 = plan(&LaunchInput {
            kv_cache: KvCache::F16,
            ..input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP)
        })
        .expect("the model is fundable");

        let state = slot_cache_bytes(
            model,
            f16.memory.context_tokens,
            KvCache::F16,
            u64::from(crate::args::UBATCH),
        );
        assert_eq!(
            state, 58_060_800,
            "the recurrent state is F32: the cache type does not scale it"
        );
        assert_eq!(
            q8_0.memory.kv_cache_bytes,
            q8_0.memory.context_tokens * ASSUMED_KV_BYTES_PER_TOKEN + state
        );
        assert_eq!(
            f16.memory.kv_cache_bytes,
            f16.memory.context_tokens * ASSUMED_KV_BYTES_PER_TOKEN * 2 + state,
            "the f16 per-token half doubles; the F32 per-slot state does not"
        );
        assert_eq!(
            f16.memory.total_bytes,
            model.weights_bytes
                + model.mmproj_bytes.unwrap_or(0)
                + COMPUTE_BUFFER_BYTES
                + f16.memory.kv_cache_bytes,
            "the total must carry the cache the plan reports"
        );
    }
    
    /// The panel's price is the launcher's own two terms — the per-token
    /// figure the solve uses and the per-slot term at its saturated size — so
    /// it must equal the plan's report at the context the plan carries, for a
    /// recurrent row and for a sliding-window one alike. If it drifted, the
    /// number beside the control would be a second arithmetic.
    #[test]
    fn the_panels_price_is_the_launchers_own_kv_arithmetic() {
        for name in ["Alibaba Qwen 3.6", "Arcee Trinity Nano", GRANITE] {
            let model = shipped_row(name);
            let budget = memory_budget(Backend::Metal, 64 * GIB);
            let launched = plan(&input(ServerBackend::Metal, budget, model, M1_MAX_RAMP))
                .unwrap_or_else(|| panic!("{name} must be fundable here"));
            let price = context_price(
                model,
                KvCache::Q8_0,
                u64::from(crate::args::UBATCH),
                crate::args::DEFAULT_PARALLEL,
            )
            .unwrap_or_else(|| panic!("{name} must have a price"));
            assert_eq!(
                price.at(launched.args.context_tokens),
                launched.memory.kv_cache_bytes,
                "{name}: the panel's number must be the launcher's own report"
            );
            // And the broken row the plan refuses has no price to show.
        }
        assert_eq!(
            context_price(&broken_row(4 * GIB), KvCache::Q8_0, 512, 1),
            None
        );
    }

    #[test]
    fn the_server_stays_on_loopback_and_goes_cold_when_idle() {
        let model = shipped_row(GRANITE);
        let budget = memory_budget(Backend::Cpu, 16 * GIB);
        let launched = plan(&input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP))
            .expect("the model is fundable");
        let line = launched.args.argv().join(" ");
        assert!(line.contains("--host 127.0.0.1"), "{line}");
        assert!(line.contains("--port 8123"), "{line}");
        assert!(line.contains("--model /models/chosen.gguf"), "{line}");
        assert!(line.contains("--sleep-idle-seconds 300"), "{line}");
        assert!(line.contains("--no-webui"), "{line}");
        assert!(!line.contains("0.0.0.0"), "{line}");
    }

    /// The disk tier's inactivity timer has to fire before the engine releases
    /// the slot, and the clock it has to beat is the owner's: the panel can set
    /// any value from [`MIN_IDLE_UNLOAD_SECONDS`] up. Pinning the shipped pair
    /// (300 / 100) would leave the shortest clock — 60 s — uncovered, and that
    /// is exactly where a fixed interval loses the turn this timer exists to
    /// save.
    #[test]
    fn the_save_cadence_stays_inside_the_unload_clock_for_every_clock_the_panel_can_set() {
        use crate::{
            idle_save_seconds, DEFAULT_IDLE_UNLOAD_SECONDS, MAX_IDLE_UNLOAD_SECONDS,
            MIN_IDLE_UNLOAD_SECONDS,
        };
        for clock in MIN_IDLE_UNLOAD_SECONDS..=MAX_IDLE_UNLOAD_SECONDS {
            let quiet = idle_save_seconds(clock);
            assert!(
                quiet < clock,
                "an unload clock of {clock} s releases the slot before a save after {quiet} s of quiet"
            );
            assert!(quiet > 0, "an unload clock of {clock} s saves on every tick");
            // And the *retry* is still inside the clock. A save can fail and
            // still be owed: a save issued while the slot is generating is
            // deferred by the engine and answered when the turn ends, so one
            // that outlasts the door's patience reads as a failure while the
            // engine is writing the file, and the retry is what persists the
            // turn. The door waits one interval after a failure, so the first
            // retry is two intervals after the last activity — and this is the
            // line that says asking for a longer backoff than that would cost
            // the turn the backoff exists to protect.
            assert!(
                2 * quiet < clock,
                "an unload clock of {clock} s releases the slot before a failed save's first retry, {retry} s after the last activity",
                retry = 2 * quiet
            );
        }
        // The two ends, named, because they are the numbers the plan and the
        // door's builders talk about.
        assert_eq!(idle_save_seconds(DEFAULT_IDLE_UNLOAD_SECONDS), 100);
        assert_eq!(idle_save_seconds(MIN_IDLE_UNLOAD_SECONDS), 20);
    }

    /// What a flag renders is the element that follows it, compared whole,
    /// and the flag is rendered exactly once: `contains("--ctx-checkpoints
    /// 1")` is true of `--ctx-checkpoints 12` too, and a saved chat twelve
    /// times the size is the failure this guards. Reading the first of two
    /// occurrences would let the second through in silence, so two are a
    /// fault in the renderer, not a value to pick between.
    fn rendered_value<'a>(argv: &'a [String], flag: &str) -> &'a str {
        let mut hits = argv.iter().enumerate().filter(|(_, arg)| *arg == flag);
        let (at, _) = hits
            .next()
            .unwrap_or_else(|| panic!("{flag} is not rendered: {argv:?}"));
        assert!(
            hits.next().is_none(),
            "{flag} is rendered more than once: {argv:?}"
        );
        argv.get(at + 1)
            .map(String::as_str)
            .unwrap_or_else(|| panic!("{flag} is rendered with no value: {argv:?}"))
    }

    /// The disk tier's two launch flags, pinned the way the unload clock
    /// above is, and the one flag the measurement kept out.
    ///
    /// `--slot-save-path` is the folder the app created before this launch.
    /// Without it the engine answers every slot save with `not supported`,
    /// so a plan that drops it loses the tier in silence.
    /// `--ctx-checkpoints 1` is the size of a saved chat, not a preference:
    /// the engine's default is 32 (`common/common.h:630`) and one chat under
    /// it grew to roughly 2.7 GB.
    ///
    /// `--swa-full` is the negative that matters. The committed round-trip
    /// (`dev/results/slot-restore-swa/summary.md`) runs it off and on and
    /// finds the restored file warm exactly when the caller drops its salt,
    /// in both settings: the flag moves the file's size, not the warmth, and
    /// it would take the SWA cache 25.6×. If someone renders it, this is the
    /// test that goes red.
    #[test]
    fn the_disk_tier_flags_reach_the_line_and_swa_full_stays_out() {
        let model = shipped_row(GRANITE);
        let budget = memory_budget(Backend::Cpu, 16 * GIB);
        let launched = plan(&input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP))
            .expect("the model is fundable");
        let argv = launched.args.argv();
        let line = argv.join(" ");
        assert_eq!(
            rendered_value(&argv, "--slot-save-path"),
            "/slots",
            "{argv:?}"
        );
        // The literal `"1"`, not the constant: the pair is what the plan
        // pins, and asserting the constant would follow it into `"12"`.
        assert_eq!(rendered_value(&argv, "--ctx-checkpoints"), "1", "{argv:?}");
        assert!(
            !line.contains("--swa-full"),
            "the measurement took this flag out; see dev/results/slot-restore-swa/summary.md: {line}"
        );
    }

    /// A machine with memory to spare, so only the trained cap can bind.
    const ROOMY_BYTES: u64 = 64 * GIB;

    #[test]
    fn the_context_stops_where_the_model_was_trained() {
        let mut model = *shipped_row(GRANITE);
        model.trained_context_tokens = Some(8_192);
        assert_eq!(
            funded_context(&model, ROOMY_BYTES, 1),
            Some(8_192),
            "the memory funded a window past what the model was trained for"
        );
    }

    #[test]
    fn a_small_machine_is_still_limited_by_its_memory() {
        // The cap is a ceiling, not a floor: where the memory funds less than
        // the model was trained for, the memory still decides.
        let mut model = *shipped_row(GRANITE);
        model.trained_context_tokens = Some(1_000_000);
        let funded = funded_context(&model, ROOMY_BYTES, 1).expect("a window");
        assert!(
            funded < 1_000_000,
            "the trained figure became a promise the memory cannot keep: {funded}"
        );
    }

    #[test]
    fn a_row_with_no_header_read_keeps_the_memory_figure() {
        let mut model = *shipped_row(GRANITE);
        model.trained_context_tokens = None;
        let uncapped = funded_context(&model, ROOMY_BYTES, 1).expect("a window");
        model.trained_context_tokens = Some(u64::MAX);
        assert_eq!(uncapped, funded_context(&model, ROOMY_BYTES, 1).expect("a window"));
    }

    #[test]
    fn a_zero_trained_length_is_not_the_same_as_no_header_read() {
        // Absent, the memory figure stands; zero, the length is unreadable
        // and nothing may be started from it. Collapsing the two would blame
        // the machine for a header we read wrong.
        let mut model = *shipped_row(GRANITE);
        model.trained_context_tokens = None;
        assert!(!trained_context_unreadable(&model));
        assert!(funded_context(&model, ROOMY_BYTES, 1).is_some());
        model.trained_context_tokens = Some(0);
        assert!(trained_context_unreadable(&model));
        assert_eq!(funded_context(&model, ROOMY_BYTES, 1), None);
    }
}
