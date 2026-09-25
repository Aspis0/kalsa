//! The one small function at the edge: the value rendered as a command line.
//!
//! The supervisor carries the rendered argv through untouched — it renders
//! nothing itself, so the flags cannot drift between the decision and the
//! process that runs it.

use crate::args::{ServerArgs, ServerSettings, ALL_LAYERS, CTX_CHECKPOINTS, FLASH_ATTN, HOST};

impl ServerArgs {
    /// The argv for `llama-server`, in the supervisor's order.
    pub fn argv(&self) -> Vec<String> {
        let mut argv = vec![
            "--host".to_string(),
            HOST.to_string(),
            "--port".to_string(),
            self.port.to_string(),
            "--model".to_string(),
            self.model_path.display().to_string(),
        ];
        if let Some(threads) = self.threads {
            // The same count as `--threads` for prefill: past the plateau
            // extra threads buy no throughput, so a bigger prefill burst is
            // heat for nothing.
            argv.extend([
                "--threads".to_string(),
                threads.to_string(),
                "--threads-batch".to_string(),
                threads.to_string(),
            ]);
        }
        argv.extend([
            "--batch-size".to_string(),
            self.batch_size.to_string(),
            "--ubatch-size".to_string(),
            self.ubatch_size.to_string(),
            "--ctx-size".to_string(),
            self.context_tokens.to_string(),
        ]);
        match self.offload {
            crate::args::Offload::All => {
                argv.extend(["--n-gpu-layers".to_string(), ALL_LAYERS.to_string()]);
            }
            // The build would offload every layer by default, so CPU decode
            // has to be stated, not implied.
            crate::args::Offload::ForcedOff => {
                argv.extend(["--n-gpu-layers".to_string(), "0".to_string()]);
            }
            crate::args::Offload::NoGpuBuild => {}
            // No flag: the engine's default (auto) plus `fit` decides the
            // layers against free device memory — see the variant.
            crate::args::Offload::EngineFitted => {}
        }
        // The cache the memory arithmetic counted: the owner's choice (q8_0
        // by default, one byte per element) under flash attention — a
        // quantized V cache is refused without it. The flash-attn value must
        // be rendered: a bare flag takes the next argument as its value, and
        // the server never starts.
        argv.extend([
            "--flash-attn".to_string(),
            FLASH_ATTN.to_string(),
            "--cache-type-k".to_string(),
            self.kv_cache.flag().to_string(),
            "--cache-type-v".to_string(),
            self.kv_cache.flag().to_string(),
        ]);
        argv.extend([
            "--sleep-idle-seconds".to_string(),
            self.idle_unload_seconds.to_string(),
            "--no-webui".to_string(),
        ]);
        // One classic slot, so yesterday's chat starts warm. With the
        // default slot count this build runs a unified KV buffer and clears
        // idle slots on every new task ("--cache-idle-slots"), measured on
        // the shipped build: an alternating conversation paid the whole
        // prefill every turn (cache_n 0, ~4.0 s at 4.5k tokens). One slot
        // keeps the prompt cache in the game and the chat comes back at
        // ~0.2 s — at the price of one generation at a time, which one
        // phone does not exceed.
        //
        // The slot count is a product decision now (one PC serving a
        // family's phones): measured on the shipped build, four people at
        // once cost +23% wall each and 40 tok/s per head instead of 72, an
        // explicit `-np` keeps every chat's cache warm anyway, and the
        // context divides by the slot count — the arithmetic above would
        // carve per person (a separate step, not this one). The value
        // travels as data: `--parallel` is rendered from `self.parallel`,
        // and the same number is the door's capacity, so the engine's slot
        // count and the door's refusal cannot disagree.
        argv.extend(["--parallel".to_string(), self.parallel.to_string()]);
        // The roof travels from the policy: it was carved out of the
        // budget before the context was sized, so it cannot be re-derived
        // from a context that already excludes it. `--cache-ram 0` — on an
        // unbudgeted dev run, say — is the honest answer: no reserved RAM,
        // no sleeping chats.
        argv.extend([
            "--cache-ram".to_string(),
            self.cache_ram_mib.to_string(),
        ]);
        // The disk tier. The folder is created by the app before this argv is
        // built (see `ServerArgs::slot_save_path`); the engine refuses a path
        // that is not a directory, so rendering it is what makes the save and
        // restore routes exist at all. The checkpoint count is the size of a
        // saved chat: the engine's default is 32, and one record is what a
        // restore reads. `--swa-full` is deliberately absent — the committed
        // round-trip (`dev/results/slot-restore-swa/summary.md`) shows it
        // moves the file's size, not whether a restore comes back warm.
        argv.extend([
            "--slot-save-path".to_string(),
            self.slot_save_path.display().to_string(),
            "--ctx-checkpoints".to_string(),
            CTX_CHECKPOINTS.to_string(),
        ]);
        argv
    }

    /// The same values as `argv`, for the settings panel and no other owner.
    pub fn settings(&self) -> ServerSettings {
        let gpu_layers = match self.offload {
            crate::args::Offload::All => Some(ALL_LAYERS),
            crate::args::Offload::ForcedOff => Some("0"),
            crate::args::Offload::NoGpuBuild => None,
            // The engine decides the count; the panel says so as itself.
            crate::args::Offload::EngineFitted => None,
        };
        ServerSettings {
            batch_size: self.batch_size,
            ubatch_size: self.ubatch_size,
            kv_cache_type: self.kv_cache.flag(),
            flash_attention: FLASH_ATTN,
            idle_unload_seconds: self.idle_unload_seconds,
            gpu_layers,
            threads: self.threads,
            threads_batch: self.threads,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Flags that make `llama-server` print what people asked it.
    ///
    /// At raised verbosity the server logs the prompt one token at a time,
    /// as text — `server-context.cpp:3138`:
    ///
    /// ```text
    /// SLT_DBG(slot, "prompt token %3d: %6d '%s'\n", i, input_tokens[i], …)
    /// ```
    ///
    /// Our stderr pipe keeps the last lines to explain an unexpected exit
    /// (`kalsa-supervisor`), so raising verbosity would put fragments of
    /// somebody's question into a buffer meant for crash diagnostics, and
    /// from there into whatever shows the crash.
    const LOUD: [&str; 6] = ["-v", "--verbose", "--verbosity", "--log-verbose", "-lv", "--verbose-prompt"];

    fn some_args() -> ServerArgs {
        ServerArgs {
            model_path: PathBuf::from("/models/whatever.gguf"),
            port: 8131,
            context_tokens: 8192,
            cache_ram_mib: 4096,
            threads: Some(4),
            offload: crate::args::Offload::All,
            idle_unload_seconds: crate::args::DEFAULT_IDLE_UNLOAD_SECONDS,
            batch_size: 2048,
            ubatch_size: 512,
            kv_cache: crate::args::KvCache::Q8_0,
            parallel: crate::args::DEFAULT_PARALLEL,
            slot_save_path: PathBuf::from("/slots"),
        }
    }

    /// EngineFitted renders NO `--n-gpu-layers`: the engine's default (auto)
    /// stands, so `fit` picks the layers against the memory that is free at
    /// this start — the variant's doc carries the engine sources. The
    /// settings the panel reads say the same in their own word: no pinned
    /// count. The plan's own `All` still states its flag: two rules.
    #[test]
    fn engine_fitted_renders_no_gpu_layers_flag() {
        let mut fitted = some_args();
        fitted.offload = crate::args::Offload::EngineFitted;
        let argv = fitted.argv();
        assert!(
            !argv.contains(&"--n-gpu-layers".to_string()),
            "the tune's graphics launch carries no flag: {argv:?}"
        );
        assert_eq!(fitted.settings().gpu_layers, None, "the panel says automatic");
        let all = some_args();
        assert!(all.argv().contains(&"--n-gpu-layers".to_string()));
    }

    /// What a person asks is the one thing that must never leave the
    /// machine's memory, not even into a log file on their own disk. This
    /// holds today by absence; the test is here so it keeps holding on the
    /// day someone adds a debug switch.
    #[test]
    fn the_argv_never_asks_the_server_to_log_prompts() {
        let argv = some_args().argv();
        for flag in LOUD {
            assert!(
                !argv.iter().any(|arg| arg == flag),
                "{flag} makes llama-server log prompt tokens as text: {argv:?}"
            );
        }
    }

    /// The guard above is worthless if `argv()` returns nothing, so this
    /// test pins that it really does render the flags we expect to see.
    #[test]
    fn the_argv_is_not_empty_when_it_claims_to_be_quiet() {
        let argv = some_args().argv();
        assert!(argv.iter().any(|arg| arg == "--model"), "{argv:?}");
        assert!(argv.iter().any(|arg| arg == "--ctx-size"), "{argv:?}");
    }

    /// The three launch values the owner may change must reach the command
    /// line as the decided values, not as the crate's defaults. This goes
    /// RED the moment someone re-renders `BATCH`/`UBATCH`/`KV_CACHE_TYPE`:
    /// it asks for a batch, a micro-batch and a cache type none of those
    /// constants carry.
    #[test]
    fn the_owners_batch_microbatch_and_cache_choice_reach_the_command_line() {
        let args = ServerArgs {
            batch_size: 1024,
            ubatch_size: 256,
            kv_cache: crate::args::KvCache::F16,
            ..some_args()
        };
        let line = args.argv().join(" ");
        assert!(line.contains("--batch-size 1024"), "{line}");
        assert!(line.contains("--ubatch-size 256"), "{line}");
        assert!(line.contains("--cache-type-k f16"), "{line}");
        assert!(line.contains("--cache-type-v f16"), "{line}");
        let settings = args.settings();
        assert_eq!(settings.batch_size, 1024);
        assert_eq!(settings.ubatch_size, 256);
        assert_eq!(settings.kv_cache_type, "f16");
    }

    /// `--swa-full` is not this tier's flag. The committed round-trip
    /// (`dev/results/slot-restore-swa/summary.md`) shows it moves a save
    /// file's size and not whether a restore comes back warm, and it would
    /// take the SWA cache 25.6×. Rendering it here is the mistake this
    /// refuses.
    #[test]
    fn the_argv_never_asks_for_the_full_sliding_window_cache() {
        let argv = some_args().argv();
        assert!(
            !argv.iter().any(|arg| arg == "--swa-full"),
            "--swa-full is not the disk tier's flag: {argv:?}"
        );
    }

    /// What a flag renders is the whole element that follows it, and the
    /// flag is rendered exactly once. The joined line is not the artifact to
    /// assert on: `contains("--ctx-checkpoints 1")` is also true of
    /// `--ctx-checkpoints 12`, and a saved chat twelve times the size is
    /// exactly what the constant exists to prevent. `position` alone is not
    /// enough either: it reads the first of two renderings and the second
    /// passes in silence, so two occurrences are a fault in the renderer,
    /// not a value to pick between.
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

    /// The save folder is data, not a literal: whatever the app resolved is
    /// what reaches the engine, and the checkpoint count rides the named
    /// constant under the spelling the engine registers.
    #[test]
    fn the_disk_tier_path_renders_from_the_field() {
        let args = ServerArgs {
            slot_save_path: PathBuf::from("/somewhere/private/slots"),
            ..some_args()
        };
        let argv = args.argv();
        assert_eq!(
            rendered_value(&argv, "--slot-save-path"),
            "/somewhere/private/slots",
            "{argv:?}"
        );
        // The literal `"1"`, not `CTX_CHECKPOINTS`: asserting the constant
        // is a tautology that stays green when it becomes `"12"`.
        assert_eq!(rendered_value(&argv, "--ctx-checkpoints"), "1", "{argv:?}");
    }

    /// The slot count is data now: whatever the field holds is what the
    /// command line renders. A literal `"1"` left behind makes this red the
    /// moment the door's capacity and the engine's slots are asked to be
    /// the same number.
    #[test]
    fn the_slot_count_renders_from_the_field_not_a_literal() {
        let args = ServerArgs {
            parallel: 4,
            ..some_args()
        };
        let argv = args.argv();
        assert_eq!(rendered_value(&argv, "--parallel"), "4", "{argv:?}");
    }

    /// A duplicated flag is a fault in the renderer, not a value to pick
    /// between: reading the first occurrence and asserting on it lets the
    /// second — `44` where the field said `4` — through in silence, which is
    /// the same silence the substring assertions were removed for.
    #[test]
    #[should_panic(expected = "is rendered more than once")]
    fn a_duplicated_flag_is_a_fault_not_the_first_occurrence() {
        let argv = vec![
            "--parallel".to_string(),
            "4".to_string(),
            "--parallel".to_string(),
            "44".to_string(),
        ];
        let _ = rendered_value(&argv, "--parallel");
    }
}
