//! The three decisions the start command is built from: how much context the
//! budget funds, how many threads the measurement earned, and what the GPU
//! gets.

use std::path::PathBuf;

use kalsa_catalog::footprint::{
    footprint_bytes, MemoryBudget, ASSUMED_KV_BYTES_PER_TOKEN, COMPUTE_BUFFER_BYTES,
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
    let maximum_context = context_tokens(input.model, input.budget.usable_bytes)?;
    let context_tokens = match input.context_limit {
        Some(limit) if limit > 0 && limit <= maximum_context => limit,
        Some(_) => return None,
        None => maximum_context,
    };
    let args = ServerArgs {
        model_path: input.model_path.clone(),
        port: input.port,
        context_tokens,
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

/// The largest context whose KV cache fits what is left of the budget after
/// the fixed footprint — the catalog's arithmetic
/// `weights + mmproj + compute buffers + KV + margin <= usable RAM`, solved
/// for KV's term. Whole tokens: the floor is the answer, never a rounding up
/// that the budget did not pay for.
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
fn context_tokens(model: &ModelEntry, usable_bytes: u64) -> Option<u64> {
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
    let kv_budget = usable_bytes.checked_sub(fixed)?;
    let tokens = kv_budget / per_token;
    (tokens > 0).then_some(tokens)
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
    use kalsa_catalog::footprint::{fits, memory_budget, GIB, KIB};
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
            dense_equivalent: None,
            stale: None,
        }
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
    fn the_context_is_the_biggest_that_fits_and_not_one_token_more() {
        // Granite 4 Tiny (4_230_976_352 bytes) on an 8 GiB CPU machine:
        // 5 GiB usable, minus the weights and 512 MiB of compute buffers,
        // leaves 600_861_856 bytes of cache at 96 KiB/token = 6112 whole
        // tokens. 6113 would need memory the machine does not have.
        let model = shipped_row(GRANITE);
        let budget = memory_budget(Backend::Cpu, 8 * GIB);
        let launched = plan(&input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP))
            .expect("the model is fundable");
        assert_eq!(launched.args.context_tokens, 6112);
        assert!(fits(model, launched.args.context_tokens, &budget));
        assert!(
            !fits(model, launched.args.context_tokens + 1, &budget),
            "one more token would not be paid for"
        );
        assert_eq!(launched.memory.kv_cache_bytes, 6112 * 96 * KIB);
        assert!(
            launched.memory.kv_per_token_assumed,
            "no shipped row carries a measured KV figure"
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
        // quantized V cache is refused) and the ubatch the 512 MiB compute
        // buffer was computed for.
        let line = launched.args.argv().join(" ");
        assert!(line.contains("--cache-type-k q8_0"), "{line}");
        assert!(line.contains("--cache-type-v q8_0"), "{line}");
        assert!(line.contains("--flash-attn on"), "{line}");
        assert!(line.contains("--ubatch-size 128"), "{line}");
    }

#[test]
fn the_measured_cache_figure_sizes_the_context_where_the_assumption_undercounted() {
    // Apertus 70B is the row the 96 KiB assumption under-counted; its
    // measured cache is 163_840 bytes per token at the q8_0 this crate
    // pins. On 64 GiB (48 GiB usable), 43_721_600_512 bytes of weights
    // (the pinned file's exact size) and 512 MiB of buffers leave
    // 7_281_136_128 bytes of cache: 44_440 whole tokens. A usable server
    // context, not a floor-division artefact.
        let model = shipped_row(APERTUS);
        let budget = memory_budget(Backend::Cpu, 64 * GIB);
        let launched = plan(&input(ServerBackend::Cpu, budget, model, M1_MAX_RAMP))
            .expect("the model is fundable");
        assert_eq!(launched.args.context_tokens, 44_440);
        assert!(fits(model, launched.args.context_tokens, &budget));
        assert!(
            !fits(model, launched.args.context_tokens + 1, &budget),
            "one more token would not be paid for"
        );
        assert_eq!(launched.memory.kv_cache_bytes, 44_440 * 163_840);
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
}
