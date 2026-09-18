//! The three decisions the start command is built from: how much context the
//! budget funds, how many threads the measurement earned, and what the GPU
//! gets.

use std::path::PathBuf;

use kalsa_catalog::footprint::{
    footprint_bytes, MemoryBudget, ASSUMED_KV_BYTES_PER_TOKEN, COMPUTE_BUFFER_BYTES, MIB,
};
use kalsa_catalog::manifest::ModelEntry;
use kalsa_probe::plateau;
use kalsa_runtime::ServerBackend;

use crate::args::{LaunchPlan, MemoryAssumption, Offload, ServerArgs};

/// Everything the decision needs, already decided upstream: the build that
/// won, the model that was chosen, the budget it was chosen against, and the
/// thread ramp the probe measured on this machine.
pub struct LaunchInput<'a> {
    pub backend: ServerBackend,
    pub model: &'a ModelEntry,
    pub budget: MemoryBudget,
    /// (threads, bytes per second) pairs, as measured. The plateau of this
    /// ramp is the thread count; nothing here is derived from core counts.
    pub thread_ramp: &'a [(usize, f64)],
    pub model_path: PathBuf,
    pub port: u16,
    /// A user-selected lower context. `None` keeps the largest context the
    /// budget funds; a larger request is rejected rather than silently capped.
    pub context_limit: Option<u64>,
}

/// The start command for this machine and model, with the memory it implies.
///
/// None when the machine cannot fund the model at all: the weights, mmproj
/// and compute buffers alone already exceed the budget, or the row's measured
/// per-token figure is garbage — a model that cannot be given even one token
/// of context must not be started smaller, it must not be started.
pub fn plan(input: &LaunchInput) -> Option<LaunchPlan> {
    let (maximum_context, prompt_cache_roof) =
        context_and_prompt_cache_roof(input.model, input.budget.usable_bytes)?;
    let context_tokens = match input.context_limit {
        Some(limit) if limit > 0 && limit <= maximum_context => limit,
        Some(_) => return None,
        None => maximum_context,
    };
    let args = ServerArgs {
        model_path: input.model_path.clone(),
        port: input.port,
        context_tokens,
        cache_ram_mib: prompt_cache_roof / MIB,
        threads: plateau(input.thread_ramp).map(|(threads, _rate)| threads),
        offload: offload(input),
        idle_unload_seconds: crate::args::DEFAULT_IDLE_UNLOAD_SECONDS,
    };
    let footprint = footprint_bytes(input.model, context_tokens);
    let memory = MemoryAssumption {
        context_tokens,
        kv_cache_bytes: footprint.kv_bytes,
        kv_per_token_assumed: footprint.kv_is_assumed(input.model),
        total_bytes: footprint.total_bytes(),
        budget_bytes: input.budget.usable_bytes,
    };
    Some(LaunchPlan { args, memory })
}

/// The context this budget funds for this row — the same arithmetic `plan`
/// sizes the server with, roof carved out first — or `None` when it cannot
/// fund even one token. The narrow question a caller asks before any plan
/// exists (a preview has no downloaded file to point at and no port), answered
/// from the one copy of the arithmetic rather than a recomputation beside it.
pub fn funded_context(model: &ModelEntry, usable_bytes: u64) -> Option<u64> {
    context_and_prompt_cache_roof(model, usable_bytes).map(|(tokens, _roof)| tokens)
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
fn context_and_prompt_cache_roof(model: &ModelEntry, usable_bytes: u64) -> Option<(u64, u64)> {
    let per_token = match model.kv_bytes_per_token {
        // A zero measurement is broken data: refuse it rather than silently
        // substituting the assumption and calling the result measured.
        Some(0) => return None,
        Some(per_token) => per_token,
        None => ASSUMED_KV_BYTES_PER_TOKEN,
    };
    let fixed = model
        .weights_bytes
        .saturating_add(model.mmproj_bytes.unwrap_or(0))
        .saturating_add(COMPUTE_BUFFER_BYTES);
    let leftover = usable_bytes.checked_sub(fixed)?;
    let prompt_cache_roof = prompt_cache_roof_bytes(leftover);
    let funded = (leftover - prompt_cache_roof) / per_token;
    // The memory is not the only limit, and it is not the binding one on a
    // large machine: a model attends over the positions it was trained for,
    // and past them it answers worse, not better. A 48 GiB budget funds
    // 547,503 tokens for a row whose header says 262,144 (measured
    // 2026-09-18), so the smaller of the two is the answer. A row with no
    // header read — the research rows — keeps the memory figure, because a
    // guessed limit is worse than none.
    let tokens = match model.trained_context_tokens {
        Some(trained) => funded.min(trained),
        None => funded,
    };
    (tokens > 0).then_some((tokens, prompt_cache_roof))
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
/// The quarter-of-the-leftover share is a rule, not a measurement: no
/// experiment chose it. It is the brake that keeps a big machine from
/// turning its whole advance into sleeping chats — hoarding the advance
/// would be the "gentle on the PC" rule broken from the other side.
const PROMPT_CACHE_CHAT_TOKENS: u64 = 32 * 1024;
/// One chat alive, one asleep.
const PROMPT_CACHE_KEPT_CHATS: u64 = 2;
/// A rule, not a measurement: the roof takes at most this share of the
/// leftover after the fixed footprint.
const PROMPT_CACHE_ROOF_SHARE: u64 = 4;

fn prompt_cache_roof_bytes(leftover_bytes: u64) -> u64 {
    let two_long_chats =
        ASSUMED_KV_BYTES_PER_TOKEN * PROMPT_CACHE_CHAT_TOKENS * PROMPT_CACHE_KEPT_CHATS;
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
mod tests {
    use super::*;
    use kalsa_catalog::footprint::{fits, memory_budget, GIB, KIB, MIB};
    use kalsa_catalog::rows;
    use kalsa_probe::Backend;

    /// The row most of these tests ride on: small enough to be fundable on
    /// every budget in the suite, shipped and usable.
    const GRANITE: &str = "IBM Granite 4 Tiny";
    /// The row the 96 KiB assumption under-counted, now carrying its
    /// measured 160 KiB-per-token figure.
    const APERTUS: &str = "Swiss AI Apertus 1.5";

    /// A real, usable catalog row, so the compiler — not this file — notices
    /// when the row's shape changes, and the tests exercise something the
    /// product actually ships.
    fn shipped_row(name: &str) -> &'static ModelEntry {
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
            kv_assumption_undercounts: false,
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

    fn input<'a>(
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
            model_path: PathBuf::from("/models/chosen.gguf"),
            port: 8123,
            context_limit: None,
        }
    }

    /// The ramp the plan measured on the M1 Max: flat after eight threads,
    /// and five threads (cores / 2) was 21% short of the ceiling.
    const M1_MAX_RAMP: &[(usize, f64)] = &[(1, 55.8), (4, 88.0), (8, 112.2), (12, 105.1)];
    /// A four-core machine whose plateau is two threads.
    const QUAD_CORE_RAMP: &[(usize, f64)] = &[(1, 20.0), (2, 35.0), (4, 36.0)];

    #[test]
    fn the_context_fits_after_the_chat_reserve_and_never_one_token_into_it() {
        // Granite 4 Tiny (4_230_976_352 bytes) on an 8 GiB CPU machine:
        // 5 GiB usable, minus the weights and 512 MiB of compute buffers,
        // leaves 600_861_856 bytes. The sleeping-chat reserve takes a
        // quarter — 150_215_464 bytes — and the context funds the rest:
        // 450_646_392 bytes at 96 KiB/token = 4584 whole tokens. The
        // machine could fund a 4585th; the reserve is what stops it, and
        // that boundary is what the last assertions pin.
        let model = shipped_row(GRANITE);
        let budget = memory_budget(Backend::Cpu, 8 * GIB);
        let launched = plan(&input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP))
            .expect("the model is fundable");
        assert_eq!(launched.args.context_tokens, 4584);
        assert!(fits(model, launched.args.context_tokens, &budget));
        assert!(
            fits(model, launched.args.context_tokens + 1, &budget),
            "the machine could fund one more token: the reserve is what stops it"
        );
        let leftover = budget.usable_bytes
            - model
                .weights_bytes
                .saturating_add(model.mmproj_bytes.unwrap_or(0))
                .saturating_add(COMPUTE_BUFFER_BYTES);
        let roof = leftover / PROMPT_CACHE_ROOF_SHARE;
        assert!(
            roof + (launched.args.context_tokens + 1) * ASSUMED_KV_BYTES_PER_TOKEN > leftover,
            "one more token would be taken from the sleeping chats' reserve"
        );
        assert!(
            roof + launched.args.context_tokens * ASSUMED_KV_BYTES_PER_TOKEN <= leftover,
            "the funded context never reaches into the reserve"
        );
        assert_eq!(launched.memory.kv_cache_bytes, 4584 * 96 * KIB);
        assert!(
            launched.memory.kv_per_token_assumed,
            "no shipped row carries a measured KV figure"
        );
        // The roof the plan carries is the reserve, in whole MiB.
        assert_eq!(launched.args.cache_ram_mib, (leftover / PROMPT_CACHE_ROOF_SHARE) / MIB);
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

    #[test]
    fn the_memory_report_is_the_cost_of_the_arguments_actually_produced() {
        // Apertus carries a measured cache figure, so the report is checked
        // against the row's own number rather than the assumption.
        let model = shipped_row(APERTUS);
        let budget = memory_budget(Backend::Metal, 64 * GIB);
        let launched = plan(&input(ServerBackend::Metal, budget, model, M1_MAX_RAMP))
            .expect("the model is fundable");

        // The report is the footprint of exactly the context the arguments
        // carry — recomputed here from the catalog, not copied from the plan.
        let footprint = footprint_bytes(model, launched.args.context_tokens);
        assert_eq!(launched.memory.context_tokens, launched.args.context_tokens);
        assert_eq!(launched.memory.kv_cache_bytes, footprint.kv_bytes);
        assert_eq!(launched.memory.total_bytes, footprint.total_bytes());
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
        assert!(line.contains("--parallel 1"), "{line}");
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
                let footprint = footprint_bytes(model, launched.args.context_tokens);
                let reserved = footprint.total_bytes() + roof_mib * MIB;
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
        // Apertus 70B is the row the 96 KiB assumption under-counted; its
        // measured cache is 163_840 bytes per token at the q8_0 this crate
        // pins. On 64 GiB (48 GiB usable), 43_721_600_512 bytes of weights
        // (the pinned file's exact size) and 512 MiB of buffers leave
        // 7_281_136_128 bytes; the sleeping-chat reserve takes a quarter,
        // and the context funds the rest.
        let model = shipped_row(APERTUS);
        let budget = memory_budget(Backend::Cpu, 64 * GIB);
        let launched = plan(&input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP))
            .expect("the model is fundable");
        assert_eq!(launched.args.context_tokens, 33_330);
        assert!(fits(model, launched.args.context_tokens, &budget));
        // The machine would pay for another token: the sleeping-chat
        // reserve is what stops it, which is the whole point of carving
        // the roof before the context rather than after.
        assert!(fits(model, launched.args.context_tokens + 1, &budget));
        assert_eq!(launched.memory.kv_cache_bytes, 33_330 * 163_840);
        assert!(
            !launched.memory.kv_per_token_assumed,
            "this row carries a measurement, not the assumption"
        );
        // The same row on 8 GiB cannot be funded at all: weights and buffers
        // alone exceed the budget, so the answer is no context, not a
        // context that does not fit.
        let small = memory_budget(Backend::Cpu, 8 * GIB);
        assert!(plan(&input(ServerBackend::Cpu, small, model, M1_MAX_RAMP)).is_none());
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

    /// A machine with memory to spare, so only the trained cap can bind.
    const ROOMY_BYTES: u64 = 64 * GIB;

    #[test]
    fn the_context_stops_where_the_model_was_trained() {
        let mut model = *shipped_row(GRANITE);
        model.trained_context_tokens = Some(8_192);
        assert_eq!(
            funded_context(&model, ROOMY_BYTES),
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
        let funded = funded_context(&model, ROOMY_BYTES).expect("a window");
        assert!(
            funded < 1_000_000,
            "the trained figure became a promise the memory cannot keep: {funded}"
        );
    }

    #[test]
    fn a_row_with_no_header_read_keeps_the_memory_figure() {
        let mut model = *shipped_row(GRANITE);
        model.trained_context_tokens = None;
        let uncapped = funded_context(&model, ROOMY_BYTES).expect("a window");
        model.trained_context_tokens = Some(u64::MAX);
        assert_eq!(uncapped, funded_context(&model, ROOMY_BYTES).expect("a window"));
    }
}
