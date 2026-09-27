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

## Follow-up: one-copy feasibility

Written 2026-09-27 (same day, second pass). Fork = `/Users/marco/Projects/kalsallama`
(`833cde99b`). "Fork N:M" means fork `ggml/src/ggml-backend.cpp` line N. Upstream `master`
re-fetched from raw.githubusercontent.com on 2026-09-27; the fork's `ggml-backend.cpp` matches
upstream within a few lines throughout (970/972, 1400/1417, 1671/1693/1792), so quotes below
hold for both. The question under test: can the governor keep **one** weights copy for
HTP-prefill + CPU-decode instead of two full contexts + `commit_side` KV/state copying?

### 1. What op_offload actually does to a CPU-resident weight

The decision (fork 970-977 = upstream 970-977; the task's line 972 is the `offload_op` call):

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

What happens next, exactly:

1. **A copy tensor is created at split time.** `ggml_backend_sched_split_graph` re-runs on every
   `ggml_backend_sched_alloc_graph` — and in llama.cpp that is **once per ubatch during prefill**
   (fork `src/llama-context.cpp:1344` `process_ubatch` → `:1388` `ggml_backend_sched_alloc_graph`;
   decode = once per token, `:2556` `ggml_backend_sched_graph_compute_async`). Each run frees and
   re-inits `sched->ctx` (fork 1078-1083) and, for every input of the split whose source lives on
   another (non-supported) buffer type, creates a fresh `ggml_dup_tensor_layout` copy and records
   the source in `split->inputs` — fork 1399-1420 (`// create a copy of the input in the split's
   backend`), upstream 1400/1417. The copy is skipped only if
   `ggml_backend_sched_buffer_supported()` says the split backend can use the source buffer
   directly (fork 1037-1056, gate at 1399) — this is the zero-copy escape hatch, see §3.
2. **The bytes are copied on every compute.** `ggml_backend_sched_compute_splits` runs once per
   `ggml_backend_sched_graph_compute_async` and copies every split input: fork 1668-1690
   (`// copy the input tensors to the split backend`), general path 1779-1790
   (`if (!split_backend->iface.cpy_tensor_async || !...cpy_tensor_async(...)) { ...
   ggml_backend_tensor_copy(input, input_cpy); }` at 1789), upstream 1671/1782/1792.
   `ggml_backend_tensor_copy` from a host buffer is `ggml_backend_tensor_set(dst, src->data, 0,
   ggml_nbytes(src))` (fork 488-509, host branch 495-496) — i.e. the destination backend's
   `set_tensor`.
3. **Nothing is cached.** No persistent weight cache exists anywhere in the sched: the copy
   tensors are recreated per graph (1), the bytes re-transferred per compute call (2). The gallocr
   keeps the *addresses* stable across ubatches (reserve-once), but the data movement repeats.
   The only cost reduction upstream ever added is the MUL_MAT_ID "copy only the experts that are
   used" filter (fork 1690-1778, comment at 1690: "when offloading MoE weights, we can reduce the
   amount of data copied by copying only the experts that are used"; upstream 1693+). Plain
   MUL_MAT — i.e. every dense LFM2 layer — gets the full-tensor copy. So: **copy per ubatch, not
   cached across ubatches or across calls.**
4. **Upstream knows and documents the cost.** Issue #13241 "Allow disabling `offload_op`"
   (https://github.com/ggml-org/llama.cpp/issues/13241): with `-ot exps=CPU`, "prompt processing
   performance is extremely poor when -ub is set to 512 (default)" and "not fully on par with
   -ub 512 w/ `offload_op` disabled" — that is precisely the per-ubatch full-weight copy of §1
   items 1-2. Fix = PR #13386 `--no-op-offload` (https://github.com/ggml-org/llama.cpp/pull/13386,
   merged 2025-05-11), which introduced `sched->op_offload` as a parameter (verified via
   `git log -S "sched->op_offload"` in our fork's upstream history: single hit `7f323a589`).
   The upstream-intended way to avoid the copies for weights is different: place weights in the
   device's **host buffer type** at load time — src/llama-model.cpp:1090-1104 (master):
   "add a host buffer type / storing the tensors in a host buffer is useful when the processing of
   large batches is offloaded to a GPU device, since it reduces the time spent on data transfers
   … a better approach would be to handle this on a weight-by-weight basis using the offload_op
   function of the device". With weights in a host buft the device's `supports_buft` accepts them
   (§3), `buffer_supported` returns true, and **no per-ubatch copy happens at all**.

History of the mechanism: `offload_op` enters ggml-backend.cpp with the device-interface rework
#9707 (2024-10-03, verified `git log -S "offload_op" -- ggml/src/ggml-backend.cpp`: oldest hit
`c83ad6d01`); per-backend implementations CUDA/Vulkan/SYCL/CANN as in §2 of the main report;
batch threshold env `GGML_OP_OFFLOAD_MIN_BATCH` added by #18535
(https://github.com/ggml-org/llama.cpp/pull/18535, 2026-01-08). Note the sched-side precondition
`src_backend_id == sched->n_backends - 1`: it fires only for weights in a **plain CPU-malloc**
buffer (`ggml_backend_buffer_is_host` AND mapped to the last/CPU backend via
`ggml_backend_sched_backend_from_buffer`, fork 888-908). Weights already placed in a device host
buft map to that *device's* backend (highest-prio match at fork 895-900), so the `1.off` gating
never fires for them — they run on the device unconditionally. This asymmetry is the single
missing piece for our governor (see Verdict).

### 2. The hexagon stub: origin, and whether HTP can eat host-layout q4_0

- The stub was **born with the backend**. Upstream PR #16547 "Add experimental ggml-hexagon
  backend for the Hexagon NPU" (https://github.com/ggml-org/llama.cpp/pull/16547, commit
  `63d2fc46e`, author Max Krasnyansky / max-krasnyansky — Qualcomm, merged 2025-10-22) adds,
  verbatim:
  `+    /* .offload_op           = */ NULL,  // ggml_backend_hexagon_device_offload_op,`
  (patch hunk; fork `ggml/src/ggml-hexagon/ggml-hexagon.cpp:6839`, upstream :7834). There is **no
  discussion of offload_op anywhere in the PR thread** — the commented name is just the unfilled
  iface slot. No upstream PR implements it since (searched commit history 2026-09-27; absence
  UNVERIFIED beyond that).
- **Can HTP consume host-layout q4_0 without repack? YES — via the "flat" HVX kernels.** The
  fork's matmul selection ladder is `opt_mm_select = 3 // HMX -> Tiled -> Flat -> CPU`
  (ggml-hexagon.cpp:95; upstream master ships `= 2 // HMX -> HVX -> CPU` at :102), env
  `GGML_HEXAGON_MM_SELECT` (fork :7206, upstream :8203). When the tiled path is disabled or its
  VTCM layout doesn't fit, the code selects `HTP_MM_KERNEL_HVX_QUANT_ROW_FLAT`
  (fork 4463 "falling back to HVX flat", 4466-4482). The DSP-side flat kernels DMAs the weight
  **with native row-major strides straight from `src0->data`**: `MATMUL_2D_REPACKED_IMPL` computes
  `tile_row_stride = n_k_tiles_w * tile_size` — for q4_0, `tile_size` = 576 B = a 32×32 block
  slab, `(ne0/32)*576` = exactly the byte size of a 32-row band of a standard row-major q4_0
  matrix — and issues 2-D DMAs of contiguous 576 B slabs into VTCM
  (`ggml/src/ggml-hexagon/htp/matmul-ops.c:334-436`; flat vec_dot variants for q4_0/q4_1/q8_0/
  q6_k/iq4nl/mxfp4 at :645-650; the dot kernel consumes the VTCM slab,
  `htp/hvx-mm-kernels-flat.h:259`). Layout is a per-tensor descriptor, not a global mode: the
  host-side `add_tensor` sets `HTP_TENSOR_REPACK` and tiled strides **only** when the tensor's
  extra carries `GGML_HEXAGON_TENSOR_REPACK` (fork 2263-2288; flag defined
  `htp/htp-ops.h:129` "Tensor is in repacked tiled format"). So a host-layout weight is
  representable and consumable; the tiled layout is an optimization, not a requirement.
- **The repack path exists and is CPU-side, at `set_tensor` time.** Weights flagged
  `GGML_BACKEND_BUFFER_USAGE_WEIGHTS` in an HTP buffer get `GGML_HEXAGON_TENSOR_REPACK`
  (fork 1734-1738); `set_tensor` then runs `repack_tensor_tiled` (fork 1725-1766), with a
  full-size host `shadow_buf` staging for partial writes (fork 1754-1765). `repack_q4_0_tiled`
  is scalar C — nibble unpack into a 32×32 staging buffer, transpose-repack, scales at +512
  (fork 809-862, helpers 745-764). `supports_op` pre-flags not-yet-allocated q4_0 weights into
  `sess->needs_repack` during reserve (fork 4973-4975, 5035-5037 → consumed at 733-738). So the
  naive `offload_op` enablement (weights in plain CPU memory) would repack **through this path,
  once per ubatch** — see §4.
- **Zero-copy HTP facts in the fork:** every hexagon buffer — both the device buft and the
  `-HOST` buft — is `rpcmem_alloc2(RPCMEM_HEAP_ID_SYSTEM, …)` + `rpcmem_to_fd` +
  `fastrpc_mmap(FASTRPC_MAP_FD)` (fork 533-551, 572-587): ordinary CPU-readable userspace pages
  that are simultaneously DSP-visible by dmabuf fd. The `-HOST` buffer type reports
  `is_host = true` (fork 2078-2081) and its `set_tensor` is a **plain memcpy — no repack**
  (fork 1986-1993). The device's `supports_buft` accepts both bufts (fork 6818-6825), and the
  CPU backend accepts any host buft (`ggml_backend_cpu_device_supports_buft` →
  `ggml_backend_buft_is_host`, fork `ggml/src/ggml-cpu/ggml-cpu.cpp:482-485`). Consequence: a weight in
  the `-HOST` buft satisfies `buffer_supported` for **both** the HTP split and the CPU split →
  the sched inserts zero copies for it, in either phase. The graph-compute side registers op
  tensors by `shared_buffer` fd (fork 2189-2198, 2254-2258) — it unconditionally casts
  `t->buffer->context` to a hexagon shared buffer (fork 2313), so op tensors must live in
  rpcmem-backed (hexagon or hexagon-HOST) buffers; plain malloc memory cannot be handed to the
  DSP by this code path.
- **Qualcomm's own words** (all from #16547 thread,
  https://github.com/ggml-org/llama.cpp/pull/16547):
  - slaren 2025-10-14: "If the weights were stored in a buffer type that's compatible with the
    CPU backend, it would be possible to use the CPU backend for generation, and the hexagon
    backend for batch processing. Repacking will make that difficult, unless it uses the same
    repacking format than the CPU backend. Would it be possible to use the same repacking as the
    CPU backend?" — upstream's ggml maintainer describing **exactly our one-copy governor**.
  - max-krasnyansky 2025-10-14: "That's what I started with (ie no-repack buffers) but that
    makes it tricky to do partial offloads and **introduces lots of copies because the scheduler
    thinks the buffers are not shareable/reusable**." And on bandwidth: "In the previous SOC
    generations (Gen3, Gen4, X-Elite) **the CPU does technically have more memory BW** (a lot more
    in the X-Elite). In Gen5 and X2-Elite the BW is about the same. For Gen3/4 it might still
    makes sense to offload to the NPU for **power saving** and/or simply to free up the CPU … the
    NPU has a really nice DMA engine (one per HW thread) that can bring in the chunks, optionally
    bypassing the L2 … we're using that in MUL_MAT ops."
  - slaren 2025-10-22: "a fairly simple change … would be to make the `is_host` function take a
    type parameter, rather than blanket applying it to the entire buffer type … This will be
    useful for the OpenCL backend as well, **all the buffers there are from unified memory as
    well**"; and the same day, on doing it per-tensor: "may require significant changes to the
    scheduler".
- HMX (the `-> HMX` head of the ladder, `HTP_MM_KERNEL_HMX_2D`, fork 4589-4594) accepts q4_0 as
  an "HMX weight type" (fork 270-272) but pairs with the tiled/HMX layouts; the flat tier is
  HVX-only. Our two known edges remain #24201 (garbage logits for ubatch ≥ 32, Q4_0, HTP v79)
  and #24963 (HMX hang on small remainder batches).

### 3. Zero-copy paths on Snapdragon, surveyed

- **rpcmem/ION readable by CPU — YES, and it is already the hexagon backend's memory model.**
  Both hexagon bufts allocate `rpcmem_alloc2(RPCMEM_HEAP_ID_SYSTEM, RPCMEM_DEFAULT_FLAGS, …)`
  and map it into the DSP by fd (fork 533-551, 572-587); the `-HOST` variant is `is_host=true`
  with memcpy-only `set_tensor` (fork 2078-2081, 1986-1993). CPU `mul_mat` reads such memory
  like any pointer (CPU backend accepts any host buft: `ggml_backend_cpu_device_supports_buft`,
  fork `ggml/src/ggml-cpu/ggml-cpu.cpp:482-485`).
  This is the one true zero-copy substrate on the SoC.
- **CPU `mul_mat` reading the HTP-repacked (tiled) layout — NO.** No ggml CPU kernel exists for
  the tiled format; the only consumer of `repack_tiled_q4_0` (fork 1785+) is `get_tensor`
  read-back. The workable direction is the reverse (keep host layout, HTP reads flat, §2).
  UNVERIFIED whether a tiled CPU kernel would even be bandwidth-competitive given the scalar
  nibble unpacking involved.
- **Adreno / ggml-opencl — NO usable zero-copy path today.** `offload_op = NULL`
  (fork `ggml/src/ggml-opencl/ggml-opencl.cpp:14461` — the task brief's :14621 lands in a debug
  dump helper; the iface NULL is at 14461); `get_host_buffer_type = NULL` (:14457);
  `buffer_from_host_ptr` is a stub returning `nullptr`; `supports_buft` returns false for any
  non-OpenCL buffer type (name check, `ggml_backend_opencl_device_supports_buft`). At
  `set_tensor`, q4_0 weights are split SoA (separate q/d subbuffers) and — under
  `GGML_OPENCL_USE_ADRENO_KERNELS` — transposed **on the GPU** into the Adreno GEMM layout
  (`transpose_2d_as_32b`/`transpose_2d_as_16b`, fork 11018-11031; SoA split 11035-11065+); the
  CPU has no kernel for that layout and the data lives in cl_mem objects. Our own Kalsa note in
  the backend documents the host-pointer reality: "CL_MEM_USE_HOST_PTR is NOT zero-copy on
  Adreno: the driver triggers an internal copy because arbitrary host pages aren't guaranteed
  mappable/coherent" (fork 10856-10861). HeteroLLM's `CL_MEM_USE_HOST_PTR` GPU-NPU sharing
  (arXiv:2501.14794, §1 of this report) shows the *hardware* path exists, but that is a custom
  runtime co-designing with the driver, not something ggml-opencl can express today. slaren's
  remark that OpenCL buffers "are from unified memory as well" (#16547, 2025-10-22) says the
  substrate is fine and the backend plumbing is what's missing.

### 4. Cost of staging/repacking ~1.5 GB of q4_0 per prefill on SM8550

- **Naive path (weights in plain CPU memory + `offload_op` enabled, CUDA-style):** every ubatch
  re-copies every dense weight through `set_tensor` (§1), which for an HTP buffer means a
  1.5 GB memcpy **plus** the scalar tiled repack (~2× memory traffic: 576 B read + 576 B written
  per 32×32 tile, plus a 32-byte-per-row staging pass; fork 809-862) — single-threaded, no
  NEON/HVX. DRAM ceiling on SM8550 is ~67.2 GB/s theoretical (LPDDR5X-8533 on a 64-bit bus;
  https://www.91mobiles.com/processor/qualcomm-snapdragon-8-gen-2-pdp,
  https://www.cpu-monkey.com/en/cpu-qualcomm_snapdragon_8_gen_2_for_galaxy); realistic
  CPU memcpy is a fraction of that — UNVERIFIED, no measured 8 Gen 2 memcpy figure found
  (plausibly ~20-45 GB/s multithreaded). Pure copy ≈ 35-75 ms/ubatch; the scalar repack likely
  dominates at roughly 0.5-1.5 s per 1.5 GB pass — UNVERIFIED (no published benchmark; it is a
  byte-loop, not a memcpy). Per ubatch: **prohibitive at any prefill length**. Once at model
  load: ~1-2 s, acceptable. This matches the upshot of #13241/#13386 for CUDA.
- **Zero-copy path (weights once in the hexagon `-HOST` rpcmem buffer, host layout):** 0 weight
  bytes move per ubatch; only activations (KB-MB) cross. The remaining cost is kernel
  efficiency: the host-layout constraint pushes matmul to the HVX **flat** tier
  (`GGML_HEXAGON_MM_SELECT=1`), giving up the tiled/HMX tiers. No public flat-vs-tiled numbers
  exist (UNVERIFIED); given the Qualcomm engineer's note that per-thread DMA engines "do some
  transformations (alignment, etc; we're using that in MUL_MAT ops)", the flat path is designed
  for exactly this and the gap is expected to be moderate, not catastrophic — UNVERIFIED.

### Verdict

- **Hexagon: one copy is feasible, and ~90% of it already exists in our fork — this is
  engineering, not research.** Recipe: load all weights once into the hexagon `-HOST` rpcmem
  buffer type (is_host=true, memcpy set_tensor → host q4_0 layout); CPU decode reads the same
  pages with zero copies; HTP prefill consumes the same memory zero-copy via the flat HVX
  kernels. Missing pieces: (a) implement
  `ggml_backend_hexagon_device_offload_op` (slot exists at fork ggml-hexagon.cpp:6839) with a
  `GGML_OP_OFFLOAD_MIN_BATCH`-style threshold ≥ 32 (below that #24201 garbage; guard small
  remainder ubatches, #24963), ANDed with `ggml_hexagon_supported_mul_mat`; (b) a small sched
  patch so `1.off` gating also applies to weights sitting in a device's *host* buft (today the
  check requires the plain-CPU backend at fork ggml-backend.cpp:970, and host-buft weights map to
  the device backend at :895-900 — the exact friction max-krasnyansky reported in #16547, for
  which slaren proposed the `is_host(type)` refactor). Probable cost: prefill runs on the flat
  HVX tier instead of tiled/HMX (efficiency gap unquantified — UNVERIFIED, measure first); in
  exchange we drop ~1.5 GB of duplicate weights, all per-ubatch weight copies, and the entire
  `commit_side` KV/state handover, with a documented power-saving angle on Gen3
  (max-krasnyansky, #16547). If flat is too slow, the fallback is repack-at-load into an HTP
  device buffer **plus** the host copy — two copies again, but still one context and no KV copy.
- **Adreno: not feasible today in ggml-opencl.** The backend rejects foreign buffer types
  (`supports_buft`), has no `offload_op`, no host buffer type, a stubbed `buffer_from_host_ptr`,
  consumes weights only as GPU-transposed SoA, and our own measurements say `CL_MEM_USE_HOST_PTR`
  is not zero-copy on Adreno (fork ggml-opencl.cpp:10856-10861). A one-copy Adreno governor
  needs a host-layout AOS kernel path plus unified-memory buffer plumbing — a driver-co-design
  project (cf. HeteroLLM), or upstream's `is_host(type)` refactor first. Until then the Adreno
  side keeps the two-context design; the one-copy experiment belongs on Hexagon.
