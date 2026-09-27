# NPU/GPU-prefill + CPU-decode prior art — for the Kalsa per-phase governor

Written 2026-09-27, read-only web research, no commit. llama.cpp quotes are `ggml-org/llama.cpp`
`master` fetched from raw.githubusercontent.com on 2026-09-27. Kalsa context: LFM2 2.6B q4_0,
prefill on OpenCL GPU + decode on CPU via two contexts + KV/state copy (`commit_side`), ~3 GB
of weights on an 8 GB Galaxy S23.

## 1. Systems that split prefill/decode across accelerators

### LiteRT-LM (Google AI Edge)
- Repo https://github.com/google-ai-edge/LiteRT-LM — Apache-2.0 (GitHub API).
- What runs where: whole model (prefill + decode) on ONE backend per run — CPU (XNNPACK), GPU,
  or NPU (QNN/Hexagon; MediaTek too). README: `--backend=gpu` (line 31), "GPU and NPU
  accelerators" (line 40). LiteRT↔QNN bridge: https://developers.google.com/edge/litert/next/qualcomm
- Weights: one copy, in the chosen backend. KV: runtime-managed; NPU path uses chunked prefill
  (128-token chunks toward 1024). **UNVERIFIED**: the public record does NOT show
  prefill-on-NPU + decode-on-CPU in one session — the owner's reading is not confirmed.
- Numbers (Gemma3-1B-IT, https://huggingface.co/litert-community/Gemma3-1B-IT): NPU 5836
  prefill / 85 decode tok/s (S25 Ultra, a16w4 QAT); GPU 2585/56 (S24 Ultra); CPU 379/55.

### llm.npu / mllm — "Fast On-device LLM Inference with NPUs" (ASPLOS'25)
- Paper https://arxiv.org/abs/2407.05858 (HTML https://arxiv.org/html/2407.05858v2), ACM
  https://dl.acm.org/doi/10.1145/3669940.3707239, author PDF
  https://xumengwei.github.io/files/ASPLOS25-NPU.pdf, code https://github.com/UbiquitousLearning/mllm — MIT (GitHub API).
- Where: prefill INT8 linear layers (QKV/O/FFN) on Hexagon via QNN — fixed-size prompt chunks,
  outliers (0.1–0.3% of channels) extracted to CPU/GPU "shadow" matmul, out-of-order block
  scheduling; **decode entirely on CPU** ("utilizes the MLLM CPU backend for decoding stage").
  Tested on Redmi K60 Pro = Snapdragon 8 Gen 2 (our SoC) and K70 Pro (8 Gen 3).
- Weights: **DUPLICATED** — "llm.npu has to keep another copy of each MatMul weights on CPU's
  memory space"; CPU keeps only "hot channels" (−34.3% memory overhead).
- KV: attention never leaves the CPU, so the KV cache never crosses devices — no handover.
  Cross-processor intermediates go through shared buffers.
- Speedups: 22.4x prefill, 30.7x energy, up to 32.8x end-to-end; >1000 tok/s prefill (1B).
- NPU code in mllm: QNN AOT examples `examples/llama_qnn_aot/` (aot_run.cpp, compile.cpp),
  `examples/qwen2_qnn_aot/`, `examples/qwen3_qnn_aot/` (GitHub tree API).

### HeteroLLM — arXiv:2501.14794
- https://arxiv.org/abs/2501.14794 (https://arxiv.org/html/2501.14794v1). Public code: none found (UNVERIFIED).
- Where: layer- AND tensor-level partitioning, not a clean phase split — "In the prefill phase,
  the NPU exhibits superior computational capability, making it NPU-dominant"; decode is
  "GPU-dominant" with NPU row-cutting to saturate bandwidth. Snapdragon 8 Gen 3 (Adreno 750 +
  Hexagon, PPL + QNN).
- Weights: ONE copy — W4A16 in the SoC unified memory; "mobile SoCs can share a unified
  physical memory, which is significantly different from discrete heterogeneous systems".
- KV: shared memory pool for operator I/O mapped into host and device spaces; GPU–NPU sharing
  via `CL_MEM_USE_HOST_PTR`. The cleanest published recipe for a handover.
- Speedups: 1.34–6.02x end-to-end vs GPU-only/NPU-only engines; 9.99x/4.36x prefill vs MLC/MNN;
  25.1x vs llama.cpp (layer-level prefill); 23.4% more decode tokens than GPU-only.

### PowerInfer-2 — arXiv:2406.06282
- https://arxiv.org/abs/2406.06282, repo https://github.com/SJTU-IPADS/PowerInfer.
- Where: CPU+GPU+NPU pipeline ("NeuroSplit"); prefill delegated to NPU, outlier/dynamic
  computation on CPU/GPU; segmented neuron cache; flash offload for models > RAM.
- Weights/KV: split across memory tiers by sparsity; details paper-only.
- Speedups: up to 25x vs SOTA frameworks; first 47B on a smartphone, 11.68 tok/s decode.
- Licence: GitHub API reports NO license file; v2 smartphone code release UNVERIFIED.

### Qualcomm Genie / QNN / AI Hub
- Genie = LLM runtime over QNN (tokenizer + QNN engine + KV-cache management), everything on
  Hexagon HTP: https://docs.qualcomm.com/doc/80-80022-15B/topic/use-genai-model-with-genie.html;
  catalog https://aihub.qualcomm.com. Licence: proprietary (QNN SDK terms).
- Weights: one copy inside compiled QNN context binaries on HTP; prefill and decode are
  separate graphs in the binary.
- The closest public clone of OUR architecture — qualcomm/ai-hub-models issue #319
  (https://github.com/qualcomm/ai-hub-models/issues/319): "hybrid inference architecture that
  uses AI Hub's compiled context binaries for prefill" (~640 tok/s via Genie) + "an external
  decoder runtime (llama.cpp) for the autoregressive decode loop" (CPU/GPU, "llama.cpp+OpenCL").
  Their blocker is exactly our commit_side problem: QAIRT dead-code-eliminates KV outputs, only
  28/36 layers expose KV at the part boundary, forcing duplicated prefill work; they request a
  `preserve_all_kv` flag. Device: Snapdragon 8 Elite Gen 5 (HTP v79), Qwen3-4B in 4 parts.

### MNN / MNN-LLM
- https://github.com/alibaba/MNN — Apache-2.0 (GitHub API). Paper https://arxiv.org/abs/2506.10443:
  "up to a 8.6x speed increase compared to current mainstream LLM-specific frameworks".
- CPU-first engine with optional OpenCL/Vulkan GPU backends; no per-phase GPU-prefill/CPU-decode
  assignment described. UNVERIFIED that MNN does the phase split at all.

### ExecuTorch + QNN
- https://github.com/pytorch/executorch — BSD ("BSD License", LICENSE line 1).
- LLM compiled AOT for QNN HTP; unsupported parts fall back (README lists "QNN HTP" line 30,
  partition tree "gpu / htp" line 54 — `backends/qualcomm/README.md`). Prefill and decode both
  go through the HTP graphs. No public tok/s verified (UNVERIFIED).

### MLC-LLM
- https://github.com/mlc-ai/mlc-llm — Apache-2.0 (GitHub API).
- Whole graph (prefill + decode) on ONE GPU backend (Adreno via OpenCL/Vulkan), one weight copy
  by construction; no phase split, no NPU. Public S23 numbers: UNVERIFIED.

## 2. llama.cpp upstream: one-context hybrid scheduling — YES, it already exists

The mechanism "weights in host memory, large batches offloaded to an accelerator, small batches
stay on CPU" lives in ONE context, inside `ggml_backend_sched`. In
`ggml_backend_sched_backend_from_buffer()` (ggml/src/ggml-backend.cpp:888), for ops whose source
is a weights buffer sitting in host memory on the last (lowest-priority = CPU) backend,
ggml-backend.cpp:969-977:

```c
                // check if a backend with higher prio wants to offload the op
                if (sched->op_offload && src_backend_id == sched->n_backends - 1 && ggml_backend_buffer_is_host(src->buffer)) {
                    for (int b = 0; b < src_backend_id; b++) {
                        if (ggml_backend_supports_op(sched->backends[b], tensor) && ggml_backend_offload_op(sched->backends[b], tensor)) {
                            SET_CAUSE(tensor, "1.off");
                            return b;
                        }
                    }
                }
```

- Flag: `--op-offload` / `--no-op-offload`, default ON — common/arg.cpp:2943-2947:
  `{"--op-offload"}, {"--no-op-offload"}, "whether to offload host tensor operations to device
  (default: true)"`; common/common.h:582; plumbed into `ggml_backend_sched_new` from
  src/llama-context.cpp:643 (`cparams.op_offload`). `ggml_backend_offload_op` itself:
  ggml-backend.cpp:476-479 → device iface at 644-651.
- The threshold is backend-defined. CUDA, ggml/src/ggml-cuda/ggml-cuda.cu:5630-5634:

```c
static bool ggml_backend_cuda_device_offload_op(ggml_backend_dev_t dev, const ggml_tensor * op) {
    ggml_backend_cuda_device_context * dev_ctx = (ggml_backend_cuda_device_context *) dev->context;
    return get_op_batch_size(op) >= dev_ctx->op_offload_min_batch_size;
}
```
  `get_op_batch_size` (defined just above, ggml-cuda.cu:~5611-5628) returns `op->ne[1]` for
  GGML_OP_MUL_MAT — i.e. n_tokens — and the default threshold is 32, env-overridable:
  ggml-cuda.cu:5804 `const int min_batch_size = getenv("GGML_OP_OFFLOAD_MIN_BATCH") ? atoi(...) : 32;`.
  So batch >= 32 -> GPU, decode batch of 1 -> CPU. Same pattern: Vulkan ggml-vulkan.cpp:15902-15906,
  SYCL ggml-sycl.cpp:6863, CANN ggml-cann.cpp:2881.
- Backends implementing `offload_op`: CUDA (iface :5679), Vulkan (:16015), SYCL (:6927), CANN
  (:2951). **OpenCL does NOT**: `/* .offload_op = */ NULL` ggml-opencl.cpp:13010 (the "Op
  offloading" section at :29587 is the legacy `ggml_cl_compute_forward` fallback, not sched
  offload). **Hexagon does NOT**: ggml-hexagon.cpp:7834 `/* .offload_op = */ NULL,  //
  ggml_backend_hexagon_device_offload_op,` — a commented-out stub. CPU (:503) and RPC (:2262): NULL.
- OpenCL `supports_op`: `ggml_opencl_supports_op` ggml-opencl.cpp:8836 — opfilter regex, then
  per-op switch (e.g. GET_ROWS Q4_0 rejected unless `GGML_OPENCL_SOA_Q`, :8848-8857).
- Hexagon `supports_op`: `ggml_backend_hexagon_device_supports_op` ggml-hexagon.cpp:7620 —
  reshape/view/permute/transpose true; MUL/ADD/SUB/DIV via `ggml_hexagon_supported_binary`;
  `case GGML_OP_MUL_MAT: supp = ggml_hexagon_supported_mul_mat(sess, op);`.
- Upstream traffic on Hexagon prefill / hybrid Snapdragon scheduling (people already run NPU
  prefill + CPU decode): #24201 "Hexagon (HTP) backend: prefill produces garbage logits for
  ubatch >= 32" https://github.com/ggml-org/llama.cpp/issues/24201 ; #24963 "Hexagon HMX matmul
  hangs on small remainder batch during prefill" https://github.com/ggml-org/llama.cpp/issues/24963 ;
  QNN lineage #6869/#11844/#12049 (closed), #12063 (open WIP); hexagon work #12326, #26748,
  #17907 (WIP Q4_0 matmul opt), #25166 "allow dflash lm-head offload experiment", #26373/#26501
  (closed alt. implementations); the Adreno OpenCL backend itself began as #10693. No dedicated
  upstream PR implements NPU-prefill+CPU-decode scheduling beyond the generic offload_op
  machinery (absence UNVERIFIED beyond these searches).

## 3. Hybrid / recurrent models across the device switch

- LFM2 (shortconv + attention) is merged upstream: #14620 "llama : support LiquidAI LFM2 hybrid
  model family" (merged) https://github.com/ggml-org/llama.cpp/pull/14620; its recurrent state
  is ordinary ggml graph state — see open #29085 "reserve graph nodes for LFM2 recurrent
  rollback" https://github.com/ggml-org/llama.cpp/pull/29085.
- Recurrent/SSM ops already run on accelerators under the sched: Mamba-2 fused ssm_scan ported
  to OpenCL — #26439 (merged) https://github.com/ggml-org/llama.cpp/pull/26439 ; Metal chunked
  SSD MMA for Mamba-2 prefill — #26647 (merged); RWKV v6 — #8980 (merged).
- The external systems (llm.npu, HeteroLLM, PowerInfer-2, LiteRT-LM, Genie) are transformer-only
  on the public record. Nothing found that moves conv/SSM state across an NPU<->CPU boundary
  (UNVERIFIED absence; academic pointers like QuantNPU mention SSMs on mobile NPUs but describe
  no cross-device state handover).

## What to borrow for Kalsa

1. **Kill the double load.** Upstream already does one-context hybrid: `ggml_backend_sched` +
   `offload_op` + `--no-op-offload` (default ON) = weights in one host arena, ubatch >=
   threshold on the accelerator, decode on CPU. Our per-phase governor re-implements, worse,
   what `sched->op_offload` does per ubatch; the ~3 GB duplicate weights and `commit_side`
   KV/state copy both disappear — one weights arena, one KV buffer, reserved by the sched.
2. **The threshold IS the governor**: one number per backend (CUDA: `GGML_OP_OFFLOAD_MIN_BATCH`,
   default 32; criterion = `ne[1]` of mul_mat = n_tokens). Make our phase split a tunable
   threshold, not two contexts.
3. **Hexagon spike**: the stub name already exists (ggml-hexagon.cpp:7834). Implement
   `ggml_backend_hexagon_device_offload_op` exactly like CUDA's — batch-size threshold ANDed
   with `ggml_hexagon_supported_mul_mat` — starting conservative (32–64): #24201/#24963 are HMX
   failures exactly at ubatch >= 32 and on small remainder batches, the two edges a threshold
   must avoid.
4. **Keep attention + KV on the CPU even in NPU-prefill phase** (llm.npu's ASPLOS'25 design):
   NPU-prefill works with a CPU-resident KV cache and needs no handover at all. Our commit_side
   copy only exists because we split contexts — the hardware doesn't force it.
5. **When tensors must cross** (hexagon spike), copy HeteroLLM's shared operator I/O memory
   pool mapped into both address spaces (`CL_MEM_USE_HOST_PTR` for GPU↔NPU) instead of memcpy.
   And note issue #319's warning: with graph-owning toolchains (QNN), the KV handover at the
   part boundary is the killer — DCE ate 8/36 layers' KV. ggml's graph transparency is our
   advantage; don't give it up.
6. **Don't duplicate weights like llm.npu** — they needed a CPU shadow copy because QNN graphs
   own their weights. The sched keeps weights in one host buffer; our current two-context setup
   has llm.npu's disease without their excuse.
7. **LFM2 specifics**: Mamba-2 ssm_scan already runs on OpenCL upstream (#26439), so the OpenCL
   prefill path can absorb LFM2's hybrid layers; conv state is KB-sized, so even if the hexagon
   spike keeps a separate path, only attention KV (the big tensor) ever crosses — and only
   because we split contexts today.
