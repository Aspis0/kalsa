# CMDBUF recon Q2 — upstream llama.cpp command buffers / OpenCL dispatch overhead

Mandate: `mandates/cmdbuf-recon.md` question 2 only.

Question: does upstream `ggml-org/llama.cpp` have work/PRs/issues on command buffers or dispatch-overhead reduction in `ggml-opencl`?

Search date: 2026-08-13. PC/web only. No device, no GEMV kernel work.

## Method

GitHub issue/PR/discussion/commit search against `ggml-org/llama.cpp` (and `ggml-org/ggml` as a cross-check). Code search of `ggml-org/llama.cpp` requires login and was **not** available; issue/PR/commit/discussion search and the public API were.

Queries (all `repo:ggml-org/llama.cpp` unless noted):

| Query | Issues | PRs | Commits | Discussions |
|---|---:|---:|---:|---:|
| `cl_khr_command_buffer` | 2 | 0 | 0 | 0 |
| `command_buffer` + `OpenCL` (AND) | 0 | — | — | noisy (Metal "command buffer") |
| `recordable` | 0 | 0 | — | — |
| `"graph replay"` | 17 (CUDA/SYCL/HIP/RPC, **not** OpenCL) | — | — | — |
| `enqueue overhead` | 16 (CUDA/SYCL/sched, **not** OpenCL cmdbuf) | — | — | — |
| `label:OpenCL` + `command buffer` | 11 (includes the one real hit) | — | — | — |
| `author:jansol` | 1 (the real hit) | — | — | — |
| `clCreateCommandBuffer` / `"use command buffers"` | noisy (Metal/Vulkan) | — | — | — |
| `repo:ggml-org/ggml` `cl_khr_command_buffer` OR `command_buffer` `OpenCL` | no dedicated cmdbuf work | — | — | — |

Fork source (this repo): ripgrep of
`BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-opencl`
and the whole vendored `llama.cpp` tree.

## Table of hits

Relevance: **PRIMARY** = OpenCL `cl_khr_command_buffer` / graph-plan replay. **DISPATCH** = OpenCL launch/submit overhead reduction without cmdbuf. **FOUNDATION** = ggml plan API that a cmdbuf backend would hook. **ANALOG** = same problem solved on another backend. **INCIDENTAL** = string appears only in a clinfo dump. **LOW** = mentioned by a cmdbuf PR but not about cmdbuf.

| URL | Date (created / last update) | Status | Relevance |
|---|---|---|---|
| https://github.com/ggml-org/llama.cpp/pull/22764 | 2026-05-06 / 2026-05-06 | **open draft**, not merged, 1 bot comment, 0 human reviews | **PRIMARY** — only OpenCL command-buffer implementation. Title: "Draft: ggml-opencl: Early proof-of-concept implementation of plans via command buffers". Author `jansol`. Implements ggml graph-plan API on top of `cl_khr_command_buffer`. Tested only `gemma-3-1b-it-f16.gguf` on **PoCL-CUDA and ROCm**. **Not tested on Adreno.** Author reports "nice performance improvements" on PoCL-Remote (extreme host↔device latency) and "slightly improved performance or no meaningful change" elsewhere — no published tok/s table. Commit `0342381` message: `opencl: use command buffers when available`. Head: `jansol/llama.cpp@5b85b9bf` (`experimental`). `graph_plan_update` is **NULL** (no `cl_khr_command_buffer_mutable_dispatch`). Open question in the PR: temporary/sub-buffer lifetime vs recorded commands. Large-PR bot asked for an RFC; none exists. |
| https://github.com/ggml-org/llama.cpp/pull/16548 | 2025-10-13 / 2025-12-02 | **open**, not merged, not draft; requested reviewers `ggerganov`, `slaren` | **FOUNDATION** — "Implement and use cuda graph plans". Author `wishstudio`. Adds `ggml_backend_supports_graph_plan` / `graph_plan_update` and scheduler reuse of per-split plans. This is the shared plan code `#22764` cherry-picks. **CUDA only.** Claimed hybrid-inference TG speedup "up to 30%" on the author's Win11/WDDM box; Linux testers reported mixed/neutral/regression. ORippler review (2025-10-21): CUDA graphs eliminate kernel-launch overhead on the GPU slice; CPU slice of hybrid graphs does not benefit. |
| https://github.com/ggml-org/llama.cpp/pull/26437 | 2026-08-02 / 2026-08-08 | **open draft**, not merged | **DISPATCH** — "opencl: keep the GPU driver's submission threads off the little cores for Adreno A6x and A7x". Author `wanghqc`. Diagnosis: decode is **driver-submit bound**, not kernel-bound. On Adreno 642L: "duty cycle 52% busy, ~48 stalls per token of 200 us - 5 ms"; in 1538/1580 stalls the host had already enqueued — "queued -> submit sat at p50 1.4 ms". Fix: pin driver threads + graph-walk thread away from little cores. Author numbers: 642L tg **7.63 → 16.73 (+119%)**; 740 **6.23 → 6.71 (+7.7%)**; 840/850 inert by construction; pp unchanged (large dispatches hide submit latency). This is the closest upstream admission that Adreno decode pays enqueue/submit tax. **Not** command buffers. |
| https://github.com/ggml-org/llama.cpp/pull/26431 | 2026-08-02 / 2026-08-08 | **open draft**, not merged | **DISPATCH** — "opencl: fold the gpt-oss MoE per-expert bias adds into the epilogue (op/kernel fusion)". Folds three in-place `ADD_ID` launches into `swiglu_oai` + MoE-combine. Author: "Both matmuls keep their own dispatches. Only the epilogue collapses." Adreno X2-90 gpt-oss-20b: pp512 **+3.36% / +3.52%**; tg32 **+0.58% / +0.19%**. Launch-count reduction, not graph replay. |
| https://github.com/ggml-org/llama.cpp/pull/26477 | 2026-08-02 / 2026-08-08 | **open draft**, not merged | **DISPATCH** — "opencl: quant lm_head / decode GEMV and medium-batch GEMM optimizations". Includes `q4_K MUL_MAT+GLU decode fusion` and a `RMS_NORM_MUL_ROPE` fusion precondition. Launch reduction via fusion, not cmdbuf. Adreno 840 Qwen3-4B-Q4_K_M: author tg128 **+16.99%** (16.91 vs 14.45 t/s). |
| https://github.com/ggml-org/llama.cpp/pull/25537 | 2026-07-10 / 2026-07-11 | **merged** 2026-07-11 | **DISPATCH** — "opencl: add int8 dp4 dense and MoE prefill optimization". Includes "MoE-combine fusion" (fewer launches on the MoE epilogue). Prefill-focused; "Token generation neutral". |
| https://github.com/ggml-org/llama.cpp/issues/20702 | 2026-03-17 / (stale) | **open**, labels `bug-unconfirmed` `stale` | **INCIDENTAL** — SYCL compile bug (`-fsycl`). Body/comments dump Intel Arc OpenCL extensions including `cl_khr_command_buffer` and `cl_khr_command_buffer_mutable_dispatch`. No request to use them. |
| https://github.com/ggml-org/llama.cpp/issues/2636 | 2023-08-16 | **open**, `stale` | **INCIDENTAL** — Android Pixel 7 FORTIFY crash. clinfo dump lists `cl_khr_command_buffer` (ARM Mali). No request to use it. |
| https://github.com/ggml-org/llama.cpp/pull/21310 | 2026-04-02 / 2026-06-26 | **closed, not merged** (draft) | **LOW** — mentioned by `#22764` as the expected cleanup for ROCm/PoCL kernel compile hacks. Compat framework for devices without subgroups. Not cmdbuf. |
| https://github.com/ggml-org/llama.cpp/pull/25749 | 2026-07-16 / 2026-07-28 | **merged** 2026-07-16 | **ANALOG** — CUDA graphs already exist in master (`USE_GRAPHS = 1`). This PR only extends them to Volta/Turing. Same *class* of solution (record once, replay) as `cl_khr_command_buffer`, different API, different backend. |
| https://github.com/ggml-org/llama.cpp/pull/26802 | 2026-08-09 / 2026-08-11 | **merged** 2026-08-11 | **ANALOG** — restore CUDA graphs on `MUL_MAT_ID` paths that do not need a stream sync. Author: LFM2-8B-A1B BF16 tg128 **357.17 → 374.34**; with `GGML_CUDA_DISABLE_GRAPHS=1` returns to 357.29 — "the whole gain is the graphs restoration." |
| https://github.com/ggml-org/llama.cpp/pull/22522 | 2026-04-29 / 2026-05-27 | **merged** 2026-05-20 | **ANALOG** — CUDA Programmatic Dependent Launch. "Like CUDA graphs, it reduces kernel launch overhead on the device. The benefits of both are additive (PDL + CG > CG > PDL)." NVIDIA Hopper+ only. |
| https://github.com/ggml-org/llama.cpp/pull/25089 | 2026-06-28 / 2026-07-28 | **open** | **ANALOG** — SYCL command-graph capture for MoE decode. Mentions "addresses are stable across graph replays". Not OpenCL. |
| https://github.com/ggml-org/llama.cpp/issues/26738 + https://github.com/ggml-org/llama.cpp/pull/26771 | 2026-08-07 / 2026-08-09 | issue open; PR open | **ANALOG** — HIP/CUDA graph replay UAF after pool flush. Proves graph-replay is live on CUDA/HIP and has lifetime bugs. Not OpenCL. |

## Negative searches (empty on purpose)

| Query | Result |
|---|---|
| `cl_khr_command_buffer` PRs | **0** (https://github.com/search?q=repo%3Aggml-org%2Fllama.cpp+cl_khr_command_buffer&type=pullrequests) |
| `cl_khr_command_buffer` commits | **0** (https://github.com/search?q=repo%3Aggml-org%2Fllama.cpp+cl_khr_command_buffer&type=commits) |
| `cl_khr_command_buffer` discussions | **0** (https://github.com/search?q=repo%3Aggml-org%2Fllama.cpp+cl_khr_command_buffer&type=discussions) |
| `recordable` issues | **0** (`https://api.github.com/search/issues?q=repo:ggml-org/llama.cpp+recordable`) |
| `command_buffer` + `OpenCL` AND issues | **0** (https://github.com/search?q=repo%3Aggml-org%2Fllama.cpp+command_buffer+OpenCL&type=issues) — the real PR is titled "command buffers" (plural) and is found via `label:OpenCL` + `command buffer` |
| Discussions `command buffer OpenCL` | 11 hits, all false positives (`command`/`buffer`/`OpenCL` as separate tokens: Hexagon, SYCL, Vulkan, Metal). No discussion of `cl_khr_command_buffer`. |
| `ggml-org/ggml` dedicated cmdbuf | none. ggml README/PR template says OpenCL work belongs in llama.cpp. |

No RFC/issue exists whose *subject* is "use `cl_khr_command_buffer` in ggml-opencl". The only artifact is draft PR `#22764`.

## Our fork (`BigMoeOnEdge/third_party/llama.cpp`)

Ripgrep of `ggml/src/ggml-opencl` for
`command_buffer|recordable|enqueue overhead|graph replay|cl_khr_command_buffer|ggml_graph`:
**no matches.**

Broader tree: `command_buffer` exists only as **Metal** (`ggml-metal-context.m` `GGML_METAL_MAX_COMMAND_BUFFERS`) and **Vulkan** (`ggml-vulkan.cpp` `struct vk_command_buffer`). Those are native API objects, not `cl_khr_command_buffer`.

`ggml-opencl.cpp` dispatch is per-op `clEnqueueNDRangeKernel` (e.g. lines 960, 969, 5649, 7415, …). Extension checks are `cl_khr_fp16` / `cl_khr_subgroups` / `cl_khr_subgroup_shuffle` (lines 5387–5490). No `cl_khr_command_buffer` string.

Backend vtable (file:line):

```6877:6880:BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp
    /* .graph_plan_create       = */ NULL,
    /* .graph_plan_free         = */ NULL,
    /* .graph_plan_update       = */ NULL,
    /* .graph_plan_compute      = */ NULL,
```

Master already does **some** launch reduction via fusion (not graph replay):

```6391:6402:BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp
        if (!backend_ctx->disable_fusion && ggml_opencl_can_fuse(cgraph, i, { GGML_OP_NORM, GGML_OP_MUL, GGML_OP_ADD })) {
            ggml_opencl_op_norm_fused(backend, node, cgraph->nodes[i+1], cgraph->nodes[i+2]);
        ...
        if (!backend_ctx->disable_fusion && ggml_opencl_can_fuse(cgraph, i, { GGML_OP_RMS_NORM, GGML_OP_MUL })) {
            ggml_opencl_op_rms_norm_fused(backend, node, cgraph->nodes[i+1]);
```

Helpers: `ggml_opencl_can_fuse` at 6301, `ggml_opencl_op_rms_norm_fused` at 12041.

One Metal comment mentions "dispatch overhead" (`ggml-metal-ops.cpp:1422`); nothing equivalent in OpenCL.

## What `#22764` actually implements (from the PR head, not from our fork)

Source: `https://raw.githubusercontent.com/jansol/llama.cpp/5b85b9bf77bfb4a971396fb95e6850c54097214d/ggml/src/ggml-opencl/ggml-opencl.cpp`

- Detect: `backend_ctx->cmdbuf_support = strstr(ext_buffer, "cl_khr_command_buffer");` (line 3485).
- Load KHR entry points via `clGetExtensionFunctionAddressForPlatform` (`clCreateCommandBufferKHR`, `clCommandNDRangeKernelKHR`, `clFinalizeCommandBufferKHR`, `clEnqueueCommandBufferKHR`, …) (lines 3487–3496).
- Record: `ggml_backend_opencl_graph_plan_create` builds one `cl_command_buffer_khr` and walks the graph with `recording != NULL` (lines 4234–4250).
- Replay: `ggml_backend_opencl_graph_plan_compute` is a single `clEnqueueCommandBufferKHR(1, &queue, plan, …)` (line 4267).
- Update: vtable `graph_plan_update = NULL` (line 4574). Args that change per token cannot be patched in-place; a new buffer must be re-recorded (or the plan API must grow mutable dispatch).
- Every op takes `cl_command_buffer_khr recording` and routes through `enqueue_ndrange_kernel` which calls `clCommandNDRangeKernelKHR` when recording (lines 746–748).

This is exactly the "record once, enqueue once per token" shape the mandate describes. It is **not** in master and **not** in our fork.

## Synthesis (Q2 only — no Q5 verdict)

1. **Upstream has one OpenCL command-buffer attempt:** draft PR `#22764` (2026-05-06). Incomplete, unreviewed, unmerged, not Adreno-tested, no mutable dispatch, stalled the day it was opened.
2. **The ggml hook it needs (`graph_plan_*` used by the scheduler) is itself unmerged** (`#16548`, CUDA-first, last push 2025-12-02).
3. **Master OpenCL has no cmdbuf / graph-plan path.** Fusion of a few elementwise chains is the only in-tree launch reduction.
4. **Upstream *does* treat kernel-launch overhead as real — on CUDA/SYCL/HIP** (graphs in master, PDL, SYCL command graphs). OpenCL is the backend that never landed the equivalent.
5. **The most concrete Adreno dispatch-overhead work is `#26437`** (pin driver submit threads). That is a host-scheduler workaround, not a recorded command buffer. Author explicitly says decode on A6x/A7x is submit-bound and that 840/850 do not need the pin.
6. **Fusion PRs (`#26431`, `#26477`, merged `#25537`) cut a handful of epilogue launches.** They do not collapse ~1000 launches/token into one enqueue.

Implication for later questions (not answered here): anyone implementing cmdbuf on our fork cannot pull a ready-made master path. The only starting point is `#22764` + the still-open `#16548` plan API, plus whatever Adreno actually exposes (`cl_khr_command_buffer` / mutable dispatch — Q1/Q3).
