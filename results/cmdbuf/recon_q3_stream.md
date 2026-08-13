# CMDBUF recon Q3 — per-token OpenCL command stream stability (this fork)

Mandate: `mandates/cmdbuf-recon.md` question 3 only.

Question: in `BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp`, is the per-token command stream stable across tokens (same kernels/args except buffer offsets / KV positions)? Which `set_arg` sites change? Typical launches/token? Does code or any dumped clinfo mention `cl_khr_command_buffer_mutable_dispatch`?

PC/source only. No device, no GEMV kernel work. Every number below is either a file:line or explicitly marked ESTIMATED.

Checkout: `BigMoeOnEdge/third_party/llama.cpp` (same tree as `reports/moe-gdn-k0-op-inventory.md`).

---

## Verdict (stream only)

**Piecewise-stable topology, not a replayable tape.**

For decode (`n_tokens=1`, graph reuse) the **op sequence and kernel identities are the same every token**. Almost all per-token change is **buffer contents** (host `set_tensor` of tokens / positions / mask / KV idxs / `s_copy`, plus activations and MoE top-k ids). Kernel *scalar* args that track time (`n_past` on RoPE) are **not** live for this model.

What is **not** globally stable across a whole session:

1. **KV length is padded and steps.** `get_n_kv` pads `used_max_p1` to `max(n_pad, 256)` (`llama-kv-cache.cpp:1227-1240`). When that pad jumps (256→512→…), `can_reuse_kq_mask` fails (`llama-graph.cpp:45-61`, `ne[0] == n_kv`) and the graph is rebuilt. GWS for `MUL_MAT` KQ / `SOFT_MAX` / (if on) `FLASH_ATTN` then changes.
2. **Flash-attn decode (if `-fa on`) rebuilds temps and can switch kernels** when `n_kv` crosses split thresholds (`ggml-opencl.cpp:13741-14747`, `n_splits` at 14287-14289, `clCreateBuffer` temps 14283-14305). K4 N3 / M1 greedy used **non-flash** (`MUL_MAT`+`SOFT_MAX` in the sched dump).
3. **Every token re-walks the graph** and re-`clSetKernelArg` + `clEnqueueNDRangeKernel`. There is **no** recorded command buffer. `graph_plan_*` are all `NULL` (`ggml-opencl.cpp:6878-6880`).
4. **K4 35B ARM_SPLIT is two backends.** The stream is 82 synchronous splits, not one OpenCL queue. CPU `MUL_MAT_ID` experts sit in every other split. A single `cl_command_buffer` cannot cover those CPU splits.

Mutable dispatch would be needed for: `n_kv` / GWS on full-attn, any `view_offs` that move, FA `n_splits` / temp `cl_mem`s (those temps are worse than mutable args — they are **new buffers per enqueue**), and GDN `K` if rollback (`K>1`). It is **not** required for positions/masks/KV write indices/`s_copy`/MoE ids if those stay the same `cl_mem` and only contents change.

---

## How the backend actually submits

`ggml_backend_opencl_graph_compute` (`ggml-opencl.cpp:6372-6414`) loops `cgraph->n_nodes` every compute:

- skips empty / `RESHAPE` / `TRANSPOSE` / `VIEW` / `PERMUTE` / `NONE` (6383-6385)
- optional fusion: `NORM+MUL+ADD`, `GROUP_NORM+MUL+ADD`, `RMS_NORM+MUL` (6391-6405)
- else `ggml_cl_compute_forward` (6407)

Each real op ends in `backend_ctx->enqueue_ndrange_kernel` (`957-971`), which is a bare `clEnqueueNDRangeKernel` on an in-order queue created with props `0` (or `CL_QUEUE_PROFILING_ENABLE` if `GGML_OPENCL_PROFILING`; `5570-5574`). No `clCreateCommandBufferKHR`, no recordable queue.

`set_tensor_async` / `cpy_tensor_async` are registered **NULL** (`6871-6875`). Host inputs go through blocking `clEnqueueWriteBuffer` (`8809-8811`). Boundary copies across the 82 splits are therefore synchronous (K0 Q5, `reports/moe-gdn-k0-op-inventory.md:205-206`: `.cpy_tensor_async = NULL`).

`sync_with_other_backends` is called **per node** (`6377-6381`); on a single Adreno it returns immediately (`6271-6272`).

---

## Per-token `clSetKernelArg` map

Convention: **CONTENTS** = same `cl_mem` / same GWS, host or previous op rewrites bytes. **ARG** = a `clSetKernelArg` scalar/`cl_mem`/GWS that can differ token-to-token. **STABLE** = decode `n_tokens=1` inside one `n_kv` pad window.

| Site | What is set | Changes per token? |
|---|---|---|
| Generic every op | `cl_mem` + `offset = extra->offset + view_offs` (every kernel) | **STABLE** if gallocr reuses the graph (same extras). **ARG** if the graph is rebuilt or a view origin moves. |
| `ggml_cl_rope` `n_past` | `clSetKernelArg(..., 24, ..., &n_past)` `21827`; read from `op_params[0]` `21721` | **STABLE = 0.** `ggml_rope_impl` hardcodes `/*n_past*/ 0` (`ggml.c:4183`). Live positions are `src1` = `inp_pos`. |
| RoPE positions | args 2-3 = `extra1` + `offset1` (`21805-21806`); GWS from `ne01,ne02,ne03` (`21845-21846`) | **CONTENTS.** `llm_graph_input_pos::set_input` writes `inp_pos` each token (`llama-graph.cpp:124-144`) via `ggml_backend_tensor_set` → `8809-8811`. Qwen IM-RoPE: `qwen35moe.cpp:326-336`. |
| `ggml_cl_diag_mask_inf` `n_past` | args 6 = `n_past` (`21443`, `21468`, `21483`) | **ARG if used.** Qwen decode does **not** emit `GGML_OP_DIAG_MASK_INF` (`ggrep ggml_diag_mask` under `src/` is empty). Mask is fused into softmax. |
| `ggml_cl_soft_max` mask | args 2-3 = mask `cl_mem`+offset (`21636-21639`); GWS `ne01*nth, ne02, ne03` (`21662`) | **CONTENTS** for mask bytes (`set_input_kq_mask`, `llama-graph.cpp:473-474`). **ARG/GWS** when `n_kv` pad jumps (`kq` `ne[0]` = padded `n_kv`; dump `kq-3` is 32K at `-c 512`, `n1_sched_B_c1000.err:1417-1418`). |
| `ggml_cl_set_rows` (KV write) | args 2-3 = index buffer (`10632-10635`); GWS from `ne01/ne02/ne03` (`10714-10718`) | **CONTENTS.** Indices are `self_k_idxs` / `self_v_idxs` (`llama-graph.cpp:468-469`). Dump: `SET_ROWS cache_k_l3` + `OpenCL#leaf_74` (`n1_sched_B_c1000.err:1415-1416`). |
| `ggml_cl_flash_attn` | `n_kv` arg (`14349`, `14440`); `n_splits`/`kv_per_split` (`14374-14375`); GWS `n_splits*n_q` (`14385`); **new** `clCreateBuffer` temps (`14183-14305`) | **ARG + possibly different kernel** if `-fa on` and `n_kv` crosses `*_split_nkv_threshold` (`13741-14747`). Not the K4/M1 path (`-fa off` → `MUL_MAT` KQ). |
| `ggml_cl_gated_delta_net` | buffers + `off_state` (`22421-22443`); shapes; `K` (`22460`); GWS from `H_v,n_seqs,S_v` (`22503-22505`) | **STABLE at decode.** `n_tokens==1` → `tgpp=0` kernel (`22388`, `22393`). State is `src[5]` view + `GET_ROWS`/`CPY` using host `s_copy` (`llama-graph.cpp:326-337`, `3149-3153`; dump `GET_ROWS conv_states` `n1_sched_B_c1000.err:1215-1216`). `K` is rollback snapshots; fused decode is `K=1` (K0 Q1, `delta-net-base.cpp` fused path). |
| `ggml_cl_mul_mat_id` | `src2` = expert ids, `offset2` (`19421-19435`) | **CONTENTS.** Ids come from GPU `ARGSORT`/`GET_ROWS` (`n1_sched_B_c1000.err:1248-1249`). GWS follows `n_expert_used` (fixed 8). On K4 ARM_SPLIT these three ops run on **CPU**, not OpenCL (`err:1254-1258`). |
| `ggml_cl_ssm_conv` / GEMV `MUL_MAT` | shapes + offsets | **STABLE** at `n=1`. |
| Host inputs | `clEnqueueWriteBuffer` `8809-8811` | **CONTENTS** every token: tokens, `inp_pos`, K/V idxs, `kq_mask`, `s_copy` (if copied to GPU), `out_ids`. |

Topology is intentionally kept constant: `build_inp_out_ids` comment (`llama-graph.cpp:2269-2272`) and `get_n_kv` comment (`llama-kv-cache.cpp:1230-1231`).

---

## Typical launches / token — measured vs estimated

**Neither K0 nor M1 measures kernel launches.**

| Claim | Status | Evidence |
|---|---|---|
| **82 synchronous graph splits / token** | **MEASURED** | `sched_reserve: graph splits = 82` — `results/k4split/s23_logs/logs/n1/n1_c4096_B_c1000.err:1216`, same in `n1_sched_B_c1000.err` dump `## SPLIT #0`…`#81` (`1208-3656`). Decode `n_tokens=1` (`1206`). 35B Qwen3.5 MoE, ARM_SPLIT, OpenCL trunk + CPU `MUL_MAT_ID`. Pattern: CPU experts every layer + OpenCL rest; first split is CPU `GET_ROWS` embd. |
| **3617 graph nodes** | **MEASURED** | `sched_reserve: graph nodes = 3617` (`n1_c4096_B_c1000.err:1215`). Includes `VIEW`/`RESHAPE`/… that `graph_compute` skips (`6383`). Last printed compute node is `#3616` (`n1_sched_B_c1000.err:3675`). |
| **~2300 compute nodes / decode token (35B split)** | **COUNTED from dump, not a profiler** | First `GGML_SCHED_DEBUG=2` graph occupies `n1_sched_B_c1000.err:1208-3676` (2469 lines) with 82 `## SPLIT` headers and ~81 blank separators → **~2300 printed `node #` lines**. Each is one sched-visible compute op (OpenCL or CPU). `RMS_NORM+MUL` fusion (`6401-6404`) collapses some pairs into one enqueue (dump still lists both, e.g. `1212-1213`). **Not** a `clEnqueueNDRangeKernel` counter. No `GGML_OPENCL_PROFILING` / `cl_trace.json` artifact in-tree. |
| **~1000 kernel launches / token** | **ESTIMATED in the mandate only** | `mandates/cmdbuf-recon.md:3-4` attributes this to “K4 N3 + M1 diagnosis”. **Not in** `reports/moe-gdn-k0-op-inventory.md` (op vocabulary + supports_op; no launch count). **Not in** `reports/moe-mld-m1.md` (“dispatch” there means GEMV convert/dispatch correctness, lines 7 and 61). Plausible origin: 2B dense (M1: 24 layers, 18 GDN + 6 full, `moe-mld-m1.md:73-82`) × ~40 compute ops/layer from the K4 layer-0 skeleton minus MoE tree ≈ **~900-1000** ESTIMATED OpenCL enqueues if the whole 2B graph ran on GPU. For the **measured 35B split graph**, ~2300 compute nodes is the better figure. |
| **60-150 ms/token dispatch/glue** | **NOT MEASURED here** | Mandate text only. K4 N3 wall times are ~0.33-0.35 s/token generation (`results/k4split/n3_final/runs/n3_ARM_CPU_fact_o1/stdout.txt:15`) — that is **total** eval, not isolated enqueue tax. Do not treat 60-150 ms as a file:line fact. |

K0 Q1 (`reports/moe-gdn-k0-op-inventory.md:19-73`) lists the **op vocabulary** that becomes those nodes: GDN fused decode is one `GATED_DELTA_NET` plus conv/state `CPY`/`GET_ROWS`/`SSM_CONV`/`L2_NORM`/projections; full-attn is `ROPE`+`FLASH_ATTN_EXT` or `MUL_MAT`+`SOFT_MAX`+`MUL_MAT`; MoE is `MUL_MAT`+`SOFT_MAX`+`ARGSORT`+`GET_ROWS`+two `MUL_MAT_ID`+`GLU`+reduce. That is an inventory, not a launch measurement.

OpenCL comments that mention launch **shape**, not count: GDN `tgpp`/`cpl`/`spw` (`22373-22391`); FA MQ split GWS (`14377-14385`). No “N launches per token” log.

---

## `cl_khr_command_buffer_mutable_dispatch`

| Place | Hit? |
|---|---|
| `ggml-opencl.cpp` | **NO.** `rg command_buffer\|mutable_dispatch\|cl_khr_command` → 0 lines. |
| Backend iface | `graph_plan_create/free/update/compute = NULL` (`6878-6880`). |
| Extension probe at init | Only `cl_khr_fp16`, `cl_khr_subgroups` / `cl_intel_subgroups`, `cl_qcom_subgroup_shuffle`, `cl_khr_subgroup_shuffle`, `cl_qcom_large_buffer` (`5387-5491`). **Not** command_buffer. |
| Device logs in-repo | `ggml_opencl:` lines list device + driver + shuffle flags (`reports/moe-gdn-k2-e2e.md:55-60` 740 `0676.73`/`E031.41`; `reports/moe-gdn-750.md:51-56` 750 `0762.36`/`E031.45`). **No extension dump.** |
| Dumped `clinfo` in this repo | **NONE** containing `cl_khr_command_buffer` or `mutable_dispatch` (`rg` over `*.txt,*.log,*.md`). |
| Vendored Khronos headers | **YES (generic spec, not a device dump):** `deps/opencl-android/OpenCL-Headers/CL/cl_ext.h:48-54` (`cl_khr_command_buffer`), `622-628` (`cl_khr_command_buffer_mutable_dispatch`). |
| Related Qcom name (not in this cpp) | `cl_qcom_recordable_queue` cited in `reports/research-adreno-opencl.md:151` (IWOCL 2026 talk). Not queried by this backend. |

Whether Adreno 740/750 **expose** the KHR extension is Q1, not answered by this fork or any in-tree clinfo.

---

## Implications for a cmdbuf bet (Q3 only)

- **Record once / replay every token is feasible only inside one `n_kv` pad window, on a single-backend (all-GPU) graph, and only if temps like FA `clCreateBuffer` are hoisted out of the record.**
- **K4 35B as run today cannot be one command buffer:** 82 splits, CPU `MUL_MAT_ID` in 40 of them (`n1_sched_B_c1000.err` `SPLIT #2,#4,…#80`).
- **Mutable dispatch is the right hammer for `n_kv`/GWS**, not for positions/masks (those are CONTENTS). This fork never asks the driver for it.
- Existing fusion already eats `RMS_NORM+MUL` (`6401-6404`). Remaining launch pile is real GEMV + elementwise + MoE reduce ADDs (~5 ADDs to fold 8 experts, dump `1262-1266`).

DONE
