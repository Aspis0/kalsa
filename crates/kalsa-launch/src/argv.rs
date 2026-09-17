//! The one small function at the edge: the value rendered as a command line.
//!
//! The supervisor carries the rendered argv through untouched — it renders
//! nothing itself, so the flags cannot drift between the decision and the
//! process that runs it.

use crate::args::{
    ServerArgs, ServerSettings, ALL_LAYERS, BATCH, FLASH_ATTN, HOST, KV_CACHE_TYPE, UBATCH,
};

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
            // The same measured count for prefill: past the plateau extra
            // threads buy no throughput, so a bigger prefill burst is heat
            // for nothing.
            argv.extend([
                "--threads".to_string(),
                threads.to_string(),
                "--threads-batch".to_string(),
                threads.to_string(),
            ]);
        }
        argv.extend([
            "--batch-size".to_string(),
            BATCH.to_string(),
            "--ubatch-size".to_string(),
            UBATCH.to_string(),
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
        }
        // The cache the memory arithmetic counted: one byte per element, both
        // tensors, under flash attention — a quantized V cache is refused
        // without it, and f16 would make the reported cache size half the
        // truth. The flash-attn value must be rendered: a bare flag takes
        // the next argument as its value, and the server never starts.
        argv.extend([
            "--flash-attn".to_string(),
            FLASH_ATTN.to_string(),
            "--cache-type-k".to_string(),
            KV_CACHE_TYPE.to_string(),
            "--cache-type-v".to_string(),
            KV_CACHE_TYPE.to_string(),
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
        // The slot count is about to become a product decision (one PC
        // serving a family's phones): measured on the shipped build, four
        // people at once cost +23% wall each and 40 tok/s per head instead
        // of 72, an explicit `-np` keeps every chat's cache warm anyway,
        // and the context divides by the slot count — the arithmetic above
        // would carve per person. Not implemented; measured, so tomorrow
        // starts from numbers.
        argv.extend(["--parallel".to_string(), "1".to_string()]);
        // The roof travels from the policy: it was carved out of the
        // budget before the context was sized, so it cannot be re-derived
        // from a context that already excludes it. `--cache-ram 0` — on an
        // unbudgeted dev run, say — is the honest answer: no reserved RAM,
        // no sleeping chats.
        argv.extend([
            "--cache-ram".to_string(),
            self.cache_ram_mib.to_string(),
        ]);
        argv
    }

    /// The same values as `argv`, for the settings panel and no other owner.
    pub fn settings(&self) -> ServerSettings {
        let gpu_layers = match self.offload {
            crate::args::Offload::All => Some(ALL_LAYERS),
            crate::args::Offload::ForcedOff => Some("0"),
            crate::args::Offload::NoGpuBuild => None,
        };
        ServerSettings {
            batch_size: BATCH,
            ubatch_size: UBATCH,
            kv_cache_type: KV_CACHE_TYPE,
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
        }
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
}
