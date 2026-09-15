//! The one small function at the edge: the value rendered as a command line.
//!
//! The supervisor carries the rendered argv through untouched — it renders
//! nothing itself, so the flags cannot drift between the decision and the
//! process that runs it.

use crate::args::{
    ServerArgs, ALL_LAYERS, BATCH, FLASH_ATTN, HOST, IDLE_UNLOAD_SECONDS, KV_CACHE_TYPE, UBATCH,
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
            IDLE_UNLOAD_SECONDS.to_string(),
            "--no-webui".to_string(),
        ]);
        argv
    }
}
