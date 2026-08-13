# CMDBUF research — can `cl_khr_command_buffer` kill K4 dispatch overhead?

Date: 2026-08-13. Mandate: `mandates/cmdbuf-recon.md`. PC/web + this repo only.
No phones, no GEMV kernels, no PLAN.md, no git push, no GGUF writes.

Inputs (read, then independently re-opened for the claims this file uses):

- recon: `results/cmdbuf/recon_q1_driver.md`, `recon_q2_upstream.md`,
  `recon_q3_stream.md`, `recon_q4_fallback.md`
- hostile audit: `results/cmdbuf/audit_recon.md` (not a Q5; its
  CONFIRMED/REFUTED ledger is binding)
- K4/M1: `reports/moe-k4-split.md`, `reports/moe-mld-m1.md`,
  `reports/moe-gdn-k0-op-inventory.md`
- dump: `results/k4split/n1/n1_sched_B_c1000.err`
- fork: `BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp`
- campaign ICD logs: `results/gdn_gpu_k2/s23/logs/support_gdn.txt`,
  `results/gdn_gpu_750/driver_header.txt`

Legend: **MEASURED** = file:line or URL body inspected this session.
**INFERRED** = sandwich / vendor statement, not our ICD string.
**ESTIMATED** = arithmetic on a dump, not a profiler.
**NOT MEASURED** = mandate prose with no supporting artifact.

---

## Q1 — Do Adreno 740/750 expose `cl_khr_command_buffer` or a QCOM equivalent?

| Device (our campaign) | `cl_khr_command_buffer` | `cl_khr_command_buffer_mutable_dispatch` | `cl_qcom_recordable_queues` |
|---|---|---|---|
| Adreno **740**, driver `0676.73`, compiler `E031.41.03.62` | **NO** (family, not a dump) | **NO** (layered on KHR; no dump has it) | **UNKNOWN (inferred YES)** |
| Adreno **750**, driver `0762.36.1`, compiler `E031.45.02.25` | **NO** (family, not a dump) | **NO** | **UNKNOWN (inferred YES)** — closer than 740: same E031.45 family as a public clinfo |

Do **not** quote the YES cells without the UNKNOWN tag. Neither campaign
ICD ever printed `CL_DEVICE_EXTENSIONS`.

### What our ICDs actually print (MEASURED)

740 (`results/gdn_gpu_k2/s23/logs/support_gdn.txt:5-19`):

```
ggml_opencl: OpenCL driver: OpenCL 3.0 QUALCOMM build: 0676.73 Compiler E031.41.03.62
ggml_opencl: cl_qcom_subgroup_shuffle support: true
```

750 (`results/gdn_gpu_750/driver_header.txt:10-24`):

```
ggml_opencl: OpenCL driver: OpenCL 3.0 QUALCOMM build: 0762.36.1 Compiler E031.45.02.25
ggml_opencl: cl_qcom_subgroup_shuffle support: true
```

`ggml_opencl_print_backend_info` (`llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp:5673-5710`)
logs driver string + shuffle/SVM/FP16 flags. It never logs `ext_buffer`.
The probe reads `CL_DEVICE_EXTENSIONS` and only looks for
`cl_qcom_subgroup_shuffle`, `cl_khr_fp16`, `cl_qcom_large_buffer`,
`cl_khr_subgroup_shuffle`, `cl_khr_integer_dot_product`
(`llama.cpp` copy `5874-5901`; BigMoe copy `5471-5491`).
**Not** probed: `cl_khr_command_buffer`,
`cl_khr_command_buffer_mutable_dispatch`, `cl_qcom_recordable_queues`.

Queue is created with props `0` (or `CL_QUEUE_PROFILING_ENABLE`).
No `CL_QUEUE_RECORDABLE_QCOM` (BigMoe `ggml-opencl.cpp:5570-5574`).

### KHR command buffer — NO on Adreno as a family (INFERRED, strong)

Qualcomm, IWOCL 2026 (May 2026), Heilbronn. PDF fetched this session
(569749 bytes): https://www.iwocl.org/wp-content/uploads/IWOCL-2026-Wang-Llamacpp.pdf

- Slide 25: "`cl_khr_command_buffer` is expected to replace the vendor
  extension **once it is available on Adreno**."
- Slide 28: "Pre-recorded cmd buffers" OpenCL = **partial**, closure path
  = "`cl_khr_command_buffer` adoption."
- Slide 29: `cl_khr_command_buffer` Status = shipping (the **Khronos
  spec**), Used by = **"Not available on Adreno"**.

That is Qualcomm talking about Adreno as a family, after our campaign
drivers. It is **not** a `0676.73` / `0762.36.1` extension dump. Direction
makes KHR *less* likely on those older ICDs, not more. Do not write
"we measured KHR missing on 740."

Khronos spec (generic, not a device dump):
https://registry.khronos.org/OpenCL/specs/unified/refpages/man/html/cl_khr_command_buffer.html
Local beta header: `deps/opencl-android/OpenCL-Headers/CL/cl_ext.h:48-57`
(`"cl_khr_command_buffer"`, `CL_MAKE_VERSION(0, 9, 8)`);
mutable dispatch at `:622-628`.

### QCOM recordable queues — the vendor door (INFERRED)

Same IWOCL 2026 slide 25: "`cl_qcom_recordable_queue` enables replay of
**per-layer** launches with minimal CPU overhead" and "Up to **~10%**
performance uplift observed on selected large models (MoE models)."
That ~10% is **Qualcomm's number, not ours**. Note *per-layer*, not
one-enqueue-per-token. Slide 29 lists `cl_qcom_recordable_queues` as
**shipping** / "Latency-critical loops" / "Pre-built command-stream replay."

IWOCL 2022 Calidas (11 May 2022):
https://www.khronos.org/developers/linkto/machine-learning-on-mobile-with-opencl
— record `EnqueueNDRangeKernel`, replay with optional kernel-arg updates.
That is the vendor analog of mutable dispatch (`clEnqueueRecordingQCOM`
+ `cl_array_arg_qcom` in MNN; see below).

Public clinfo (none is our exact build):

| GPU | Compiler | recordable 1.0.1 | KHR cmdbuf | Source |
|---|---|---|---|---|
| 730 | E031.38.11.14 | yes | absent | https://gist.github.com/woachk/9a0c542a946e4d2838564f104e0833d7 |
| **740 (ours)** | **E031.41.03.62 / 0676.73** | **no verbatim dump** | **no verbatim dump** | `support_gdn.txt:5` |
| 732 | E031.45.02.09 | yes | absent | https://github.com/termux-user-repository/tur/issues/1866#issuecomment-3138515728 |
| 750 public | E031.45.02.06 | yes | absent | https://github.com/Oblomov/clinfo/issues/92#issuecomment-2629350597 (re-fetched) |
| **750 (ours)** | **E031.45.02.25 / 0762.36.1** | **no verbatim dump** | **no verbatim dump** | `driver_header.txt:10` |
| 830 | E031.47.18.42 / 0800.56.1 | yes | absent | https://github.com/ggml-org/whisper.cpp/issues/3708 |

The 750 public dump (ahorek, 2025-02-02) was re-fetched this session.
Device Extensions contains `cl_qcom_recordable_queues 0x400001 (1.0.1)`
and does **not** contain `cl_khr_command_buffer`. Our unit is the same
E031.45 line, newer micro (`.02.25` vs `.02.06`).

No public clinfo of Adreno 740 / `0676.73` was found (Q1 query table).
740 YES is sandwich (730 E031.38 already had recordable; 732/750/830
still have it) + Qualcomm "shipping". An 8-series dump does not prove
a 0676.73 7-series ICD.

### Production user of the vendor API (not our ICD)

Alibaba MNN takes the recordable path when the extension string is
present (`OpenCLRuntime.cpp` on
https://raw.githubusercontent.com/alibaba/MNN/master/source/backend/opencl/core/runtime/OpenCLRuntime.cpp)
and loads `clNewRecordingQCOM` / `clEndRecordingQCOM` /
`clEnqueueRecordingQCOM` from `libOpenCL.so`
(`OpenCLWrapper.cpp`). That proves the symbols exist on **some**
shipping Adreno `libOpenCL.so`. It does **not** prove `0676.73`
exports them (audit F5). If the string is missing, MNN just skips.

QPM Adreno OpenCL SDK PDF is behind a login wall
(https://qpm.qualcomm.com/#/main/tools/details/Adreno_OpenCL_SDK).

### Q1 bottom line

- Do **not** plan a `cl_khr_command_buffer` / mutable-dispatch path on
  740 or 750. Qualcomm, May 2026: not available on Adreno. Dumps from
  730 through 830 agree.
- The driver door that *may* exist is `cl_qcom_recordable_queues`, with
  replay-time arg / NDRange updates. Our campaign ICDs have never
  printed the string. Honest cell: **UNKNOWN (inferred YES)** until a
  one-line `clinfo` / `GGML_LOG_INFO(ext_buffer)` on the phone.
- This recon is no-phone. That dump does not exist in this lane.

---

## Q2 — Upstream llama.cpp command-buffer / OpenCL dispatch work

GitHub search date claimed by Q2: 2026-08-13. This session re-fetched
the two PRs that matter.

### PRIMARY — the only OpenCL command-buffer attempt

https://github.com/ggml-org/llama.cpp/pull/22764
(API re-fetched: `draft: true`, `state: open`, `merged: false`,
created/updated 2026-05-06, author `jansol`, head `5b85b9bf`,
1 issue comment, 0 review comments).

Title: "Draft: ggml-opencl: Early proof-of-concept implementation of
plans via command buffers." Body (quoted): "only tested
gemma-3-1b-it-f16.gguf and only on the PoCL-CUDA and ROCm drivers."
**Not Adreno.** Built on the still-unmerged CUDA plan API
https://github.com/ggml-org/llama.cpp/pull/16548 (open, not draft,
last update 2025-12-02). Author reports "nice" gains on PoCL-Remote
(extreme host↔device latency) and "slightly improved or no meaningful
change" elsewhere — no published tok/s table. `graph_plan_update` is
NULL in that tree (jansol `ggml-opencl.cpp:4574`, fetched by the
audit): no mutable dispatch. Stalled the day it opened.

This is the mandate's "record once, enqueue once" shape. It is **not**
in master and **not** in our fork.

### DISPATCH — Adreno submit tax, not cmdbuf

https://github.com/ggml-org/llama.cpp/pull/26437
(API re-fetched: draft, open, author `wanghqc`, 2026-08-02 / 2026-08-08).
Diagnosis: decode on A6x/A7x is **driver-submit bound**. On Adreno 642L:
"duty cycle 52% busy, ~48 stalls per token of 200 us - 5 ms";
"queued -> submit sat at p50 1.4 ms." Fix: pin driver + graph-walk
threads off little cores. Author numbers: 642L tg **7.63 → 16.73
(+119%)**; **740 6.23 → 6.71 (+7.7%)**; 840/850 inert; pp unchanged.
This is the only upstream document that isolates Adreno enqueue/submit
tax. It is **not** a command buffer, and the 740 win is **+7.7%**, not
60–150 ms.

Fusion PRs cut a handful of epilogue launches, not a graph replay:
`#26431` (gpt-oss bias-add fold; "Both matmuls keep their own
dispatches"; tg32 +0.58%/+0.19% on X2-90), `#26477` (Q4_K
MUL_MAT+GLU decode fusion), merged `#25537` (MoE-combine fusion;
"Token generation neutral").

### ANALOG — other backends already have the class of solution

CUDA graphs in master (`#25749`, `#26802`). SYCL command-graph capture
(`#25089`). Programmatic Dependent Launch (`#22522`). OpenCL is the
backend that never landed the equivalent.

### This fork

`graph_plan_create/free/update/compute = NULL`
(`BigMoeOnEdge/.../ggml-opencl.cpp:6877-6880`). Dispatch is per-op
`clEnqueueNDRangeKernel` (`:957-971`). Existing fusion only:
`NORM+MUL+ADD`, `GROUP_NORM+MUL+ADD`, `RMS_NORM+MUL` (`:6391-6405`).
No `cl_khr_command_buffer` / `cl_qcom_recordable` string in this cpp.

Implication: anyone implementing cmdbuf on our fork cannot pull a
ready-made master path. The only starting point is stalled `#22764`
(KHR, not Adreno) plus whatever this ICD actually exposes (Q1).

---

## Q3 — Is our per-token OpenCL stream stable enough to record?

**Piecewise-stable topology, not a replayable tape. A single command
buffer cannot cover the K4 35B token.**

### How this backend submits (MEASURED)

`ggml_backend_opencl_graph_compute` (`ggml-opencl.cpp:6372-6414`)
re-walks `cgraph->n_nodes` every compute: skip empty / `RESHAPE` /
`TRANSPOSE` / `VIEW` / `PERMUTE` / `NONE` / `COMPUTE==0`; optional
RMS/NORM fusion; else `ggml_cl_compute_forward` →
`clEnqueueNDRangeKernel`. No record. No graph plan.

`set_tensor_async` / `cpy_tensor_async` are NULL (`:6871-6875`; stub
`:6251-6256` returns false). Host inputs are blocking
`clEnqueueWriteBuffer` (`:8809-8811`). Cross-backend copies therefore
hit `synchronize(input)` + `synchronize(split)` + `tensor_copy`
(`ggml-backend.cpp:1664-1671`). OpenCL sync is
`clEnqueueBarrierWithWaitList` + `clWaitForEvents` (`:6258-6264`).

### What changes per token (MEASURED source)

| Thing | Per-token? | Evidence |
|---|---|---|
| Op sequence / kernel identities at decode `n_tokens=1` inside one `n_kv` pad | **STABLE** | `get_n_kv` pads to `max(n_pad, 256)` so "the graph remains constant" (`llama-kv-cache.cpp:1227-1240`) |
| RoPE `n_past` scalar | **STABLE = 0** | `ggml_rope_impl` hardcodes `/*n_past*/ 0` (`ggml.c:4183`) |
| Positions / KQ mask / KV idxs / `s_copy` | **CONTENTS** (same `cl_mem`, host rewrite) | `llm_graph_input_pos::set_input` (`llama-graph.cpp:124-144`); mask `set_input_kq_mask`; write `8809-8811` |
| GWS / `n_kv` on full-attn | **ARG when pad jumps** | `can_reuse_kq_mask` requires `kq_mask->ne[0] == n_kv` (`llama-graph.cpp:45-61`). Graph rebuild at 256→512→… |
| Flash-attn temps | **new `clCreateBuffer` per enqueue** if `-fa on` | `ggml-opencl.cpp:14298-14303`. K4/M1 used **`-fa off`** (`moe-k4-split.md:205-208, 274`) |
| MoE expert ids | **CONTENTS** | `n_expert_used = 6` on this pack (`n1_sched_B_c1000.err:134`; `combo.txt:141-142`). **Not 8.** Q3 recon said 8; audit F3 REFUTED it. 6 views + 5 ADD (`err:13619-13624`; builder `llama-graph.cpp:2128-2138`) |
| K4 residency | **82 hybrid islands, not one queue** | see below |

Mutable dispatch (KHR) is **not** exposed on Adreno (Q1). The vendor
equivalent is `clEnqueueRecordingQCOM` arg/GWS updates — **if**
recordable queues exist on this ICD. Positions/masks do not need
mutable args if the `cl_mem` is stable and only contents change.
`n_kv`/GWS on full-attn **do**. FA temps are worse than mutable args
(new buffers). Irrelevant to the measured 35B path (`-fa off`).

### Launches / splits — measured vs guessed

First `n_tokens=1` reserve in `results/k4split/n1/n1_sched_B_c1000.err`
(`graph_reserve` at `:1206`; `## SPLIT #0`…`#81` at `:1208-3656`;
second copy of the same 82 at `:13566+`):

| Claim | Status | Evidence |
|---|---|---|
| **82 synchronous graph splits / token** | **MEASURED** | `sched_reserve: graph splits = 82` (`err:13561`). 82 `## SPLIT` headers in the first dump. Same 82 on N1 ARM_B c512/c4096 (`moe-k4-split.md:182-184`). Pattern: CPU embd + 40×(OpenCL trunk \| CPU `3×MUL_MAT_ID+SWIGLU`) + last OpenCL island. |
| **3617 graph nodes** | **MEASURED** | `sched_reserve: graph nodes = 3617` (`err:13560`). Includes VIEW/RESHAPE skipped at `:6383`. |
| **~2300 listed compute nodes / decode token** | **COUNTED from dump** | Audit parse of first dump: **2305** printed `node #` lines, 2144 OpenCL + 161 CPU (`audit_recon.md:141-147`). Not a `clEnqueueNDRangeKernel` counter. No `GGML_OPENCL_PROFILING` / `cl_trace.json` in-tree. |
| **~2080 enqueues after empty+existing RMS fuse** | **ESTIMATED** | Q4 product: 30 GDN × ~53 + 10 FA × ~49 + ~4 (`recon_q4_fallback.md:135-142`). Audit recount ~2050. Same order. GPU ≈ ~1920; ~160 are CPU (`40 × (3 MUL_MAT_ID + SWIGLU)`). |
| **~1000 kernel launches / token** | **ESTIMATED in the mandate only** | `mandates/cmdbuf-recon.md:3-4`. Not in K0 (op vocabulary). Not in M1 ("dispatch" there means GEMV convert/dispatch correctness, `moe-mld-m1.md:7,61`). Plausible 2B guess (24 layers × ~40 ops). **Not the 35B number.** |
| **60–150 ms/token dispatch/glue** | **NOT MEASURED** | Mandate prose only. See Q5. |

Layer mix on this 40-layer pack: `hparams.is_recr(il)`
(`qwen35moe.cpp:192-198`). Dump: layers 0–2 GDN (`GATED_DELT` at
`:13593`), layer 3 full-attn (`Qcur_full` at `:1407`). 30 GDN + 10 FA.

### Why one command buffer cannot cover this token

A `cl_command_buffer_khr` / `clEnqueueRecordingQCOM` records **OpenCL
queues**. 41 of 82 splits are CPU (`#0` embd `GET_ROWS`, then
`#2,#4,…#80` = `MUL_MAT_ID`+`SWIGLU`). The expert-ready hook that
makes flash-streaming real lives only in CPU `mul_mat_id`
(`ggml-cpu.c:1665-1669`; `moe-k4-split.md:275-276`). Moving
`MUL_MAT_ID` to GPU would kill that hook (K0 G2 / Q4 `:217`). Even
the GPU side is ~41 separate `graph_compute` islands, not one tape.

Q4 §5's "KHR cmdbuf is the only bounded way to keep 82 islands and
still pay one enqueue/token" is **REFUTED** (audit F2). The bounded
object records **one OpenCL island**, not the hybrid token.

Record-once / replay is feasible only: inside one `n_kv` pad window,
on a **single-backend (all-GPU)** graph, with FA temps hoisted out of
the record. That is not the K4 35B ARM_SPLIT graph.

---

## Q4 — Fallback if no driver cmdbuf

This is a **launch/split count**, not a speed claim. µs/launch on
Adreno is **not measured** in K4/M1.

### (a) Fuse elementwise chains

Existing fusion already eats `RMS_NORM+MUL` (`ggml-opencl.cpp:6401-6404`).
`ggml_can_fuse_ext` requires consecutive nodes, `use==1` on
intermediates, **same shape** (`ggml-impl.h:669-695`). Broadcast
(shexp `SIGMOID` × 8K hidden) fails `ggml_are_same_shape`.
~130 launches/token already removed (30×3 + 10×4 RMS pairs). Do not
recount that as a win.

Realistic same-shape fuses (from K0 emit + the N1 dump; `n_expert_used=6`):

| chain | emit | saved / token | weeks | risk |
|---|---|---:|---|---|
| `ADD+SOFTPLUS+MUL` (α) | `qwen35moe.cpp:396-401`; dump 36–38 | 50–60 | 0.5–1 | low |
| `SILU+MUL` gated-norm | `qwen35moe.cpp:270-278`; dump 53–54 | 25–30 | 0.5 | low |
| `SUM_ROWS+CLAMP` (not `DIV`) | `llama-graph.cpp:1943-1948`; dump 68–69 | 0–40 (n/a after N2 router pin) | 0.5 | low |
| 6-expert `ADD` reduce → 1 kernel | `llama-graph.cpp:2132-2138`; dump 84–88 | 120–160 | 1 | med — must follow `hparams.n_expert_used` (**6 here, not 8**) |
| FA `SIGMOID+MUL` gate | `qwen35moe.cpp:350-353` | 8–10 | 0.5 | low |
| residual `ADD+ADD` | dump 96–97 | 30–40 | 0.5 | low |
| **(a) realistic** | | **200–340** | **2–3** | low–med |
| + stretch (`SSM_CONV+SILU`, broadcast shexp `SIGMOID+MUL`) | | **200–450** | **3–4** | med |

Do **not** count: already-fused RMS; recurrent `SCALE`/`GET_ROWS`/`CPY`
(correctness-critical, K0 `:92-97`); `SOFT_MAX`+`ARGSORT`; anything
across the CPU expert split; `MUL_MAT` epilogues (GEMV — mandate
closed).

~200–340 is **~10–16%** of ~2080 listed enqueues, **~11–18%** of
~1920 GPU launches. It does **not** touch the 82 splits. It does
**not** move the N3 0.698× decode (GEMV-bound,
`moe-k4-split.md:323`, `moe-mld-m1.md:119-121,184-187`).

### (b) Pin small glue CPU-side to cut splits

**Ceiling: 0 of 82 splits.** The 82 are `GPU trunk ↔ CPU routed
experts` × 40 layers, plus embd and the last OpenCL island. Pinning
more glue cannot merge those two backends. N1 already has no extra
glue-caused splits (layer 3 FA does not add one). N2 product pin
(`-ot ffn_gate_inp.weight=CPU`, `moe-k4-split.md:208,214`) moves the
router chain onto the CPU island that already exists — **~280 GPU
launches** become CPU, **0 splits saved**. Pinning the whole FFN tail
+ shexp is **~400–600 GPU launches**, still 82 splits, and shexp GEMV
on CPU may regress.

GPU `GET_ROWS` for quantized `token_embd` (K0 G4,
`moe-gdn-k0-op-inventory.md:167`) would drop **split 0 only**
(82→81). Needs a new kernel; `token_embd` is 333 MiB host
(`moe-k4-split.md:280`). Wiring `cpy_tensor_async` would make the 82
splits *cheaper*, not fewer (2–3 weeks, Adreno events unproven here).

### Combined honest ceiling (no driver cmdbuf, no GEMV, no GPU experts)

**~200–450 fewer launches/token, still 82 splits. ~3 weeks of fuse
kernels + `test-backend-ops` + one unplugged greedy A/B. Not a
decode-gate program.**

---

## Q5 — VERDICT

**VERDICT: FEASIBLE_PARTIAL(fusion only)**

Not `FEASIBLE(driver+scope)`:

- The mandate's named API (`cl_khr_command_buffer`) is **not available
  on Adreno** (IWOCL 2026 slide 29, fetched). `#22764` is a PoCL/ROCm
  draft, not an Adreno path.
- The vendor equivalent is **UNKNOWN on our exact ICDs**. Shipping on
  the family + a same-compiler 750 clinfo is not a `0676.73` string.
  Week-1 `CL_QUEUE_RECORDABLE_QCOM` against an unprinted extension is
  the failure the audit named (F1).
- Even if recordable queues exist, **scope fails the mandate's
  thesis**. "Record the per-token command sequence ONCE, replay with
  one enqueue per token" (`mandates/cmdbuf-recon.md:6-7`) cannot
  describe an 82-split hybrid graph. Qualcomm themselves describe
  the vendor API as **per-layer** replay (slide 25). CPU
  `MUL_MAT_ID` is not an OpenCL command. Collapsing residency to get
  one tape would kill the expert-ready hook (`ggml-cpu.c:1665-1669`).

Not `DEAD`: same-shape elementwise fusion is real, already patterned
in-tree (`RMS_NORM+MUL` at `ggml-opencl.cpp:6401-6404`), and has a
counted 200–340 launch cut. That is a bounded leftover, not a K4
revival.

### Single best entry point

`ggml_backend_opencl_graph_compute` in
`BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp:6372-6414`
(and the matching `llama.cpp/` copy if that is the K4 binary).

Clone the existing `ggml_opencl_can_fuse` / `ggml_opencl_op_*_fused`
path and land **one** new fuse first:

**6-expert `ADD` reduce → one kernel** (`llama-graph.cpp:2132-2138`;
dump `n1_sched_B_c1000.err:13620-13624`). Largest realistic cut
(120–160 launches/token). Must size from `hparams.n_expert_used`
(**6 on this pack**, `err:134` / `combo.txt:142` — not stock-Qwen 8).

Second, same week if the first is green: `ADD+SOFTPLUS+MUL` α-chain
(`qwen35moe.cpp:396-401`; dump 36–38; 50–60 launches; lowest risk).

Do **not** start a `cl_qcom_recordable_queues` implementation in this
lane. The next phone session (out of scope here) can print
`ext_buffer`; until that string is on disk the vendor door stays
UNKNOWN.

### Honest week-estimate

| work | weeks | what it buys |
|---|---:|---|
| 6-expert ADD reduce + `test-backend-ops` | 1 | 120–160 launches |
| remaining realistic same-shape fuses | +1–2 | 200–340 total |
| stretch fuses | +1 | 200–450 |
| vendor-cmdbuf spike | **blocked** | needs a phone clinfo this mandate forbids |
| KHR cmdbuf (`#22764` port) | n/a | Qualcomm: not on Adreno |
| N3 1.10× decode revival | **not this lane** | GEMV wall |

**2–3 weeks** for the realistic fuse set. That is the whole
implementable program.

### Measured vs guessed

| item | class | number | source |
|---|---|---|---|
| 740 driver / compiler | MEASURED | `0676.73` / `E031.41.03.62` | `support_gdn.txt:5` |
| 750 driver / compiler | MEASURED | `0762.36.1` / `E031.45.02.25` | `driver_header.txt:10` |
| KHR cmdbuf on Adreno | INFERRED (vendor, May 2026) | not available | IWOCL 2026 slide 29 |
| recordable on *our* 740/750 | INFERRED | UNKNOWN (family YES) | no dump of these ICDs |
| 82 splits / token | MEASURED | 82 | `n1_sched_B_c1000.err:13561` |
| graph nodes | MEASURED | 3617 | `err:13560` |
| listed compute nodes | COUNTED | 2305 | audit parse of first dump |
| enqueues after empty+RMS | ESTIMATED | ~2050–2080 | Q4 product / audit recount |
| ~1000 launches | ESTIMATED (mandate / 2B guess) | not 35B | `mandates/cmdbuf-recon.md:3-4` |
| `n_expert_used` | MEASURED | **6** | `err:134`, `combo.txt:142` |
| N3 CPU / split decode median | MEASURED | 2.901 / 2.025 t/s (0.698×) | `moe-k4-split.md:311`; raw `results/k4split/n3_final/runs_speed.csv` (CPU 2.853/2.888/2.914/2.977, split 1.936/1.942/2.107/2.547) |
| split-vs-CPU extra | ARITHMETIC on those medians | **149 ms/token** = 1/2.025 − 1/2.901 | whole eval, GEMV included |
| CPU one-run wall | MEASURED | 0.343 s/token | `n3_final/.../n3_ARM_CPU_fact_o1/stdout.txt:15` |
| 60–150 ms glue | NOT MEASURED | — | mandate only |
| Qualcomm recordable win | VENDOR, not us | ~10% on selected MoE | IWOCL 2026 slide 25 |
| 740 submit-pin win | AUTHOR, not us | +7.7% (6.23→6.71 t/s) | https://github.com/ggml-org/llama.cpp/pull/26437 |
| fusion launch cut | ESTIMATED count | 200–340 realistic | Q4 table |
| µs/launch on 740/750 | NOT MEASURED | — | no `GGML_OPENCL_PROFILING` artifact |

### Why this is not the answer to K4 “60–150 ms/token dispatch overhead”

The mandate called that number **Measured** (`mandates/cmdbuf-recon.md:3-4`).
It is not.

1. **No profiler split exists.** K4 N3 reports wall decode
   (`moe-k4-split.md:311-317`). M1 microbenched Q4_K GEMV
   (`moe-mld-m1.md:136-158`). Nobody isolated enqueue / `clWait` /
   GEMV / flash I/O on the 35B split token.
2. **The 149 ms that *is* on disk is the entire split-vs-CPU delta**,
   including the thing K4 itself named as the wall: "decode 0.70×
   (**A7X GEMV wall**)" (`moe-k4-split.md:323`). Spending 149 ms as a
   glue budget spends the GEMV regression as if it were `clEnqueue`.
3. **M1 already put Q4_K GEMV at the 740 DRAM roof** (~34 GB/s on
   FFN gate/up; a 1.4× GEMV win would need ~48 GB/s,
   `moe-mld-m1.md:119-121,184-187`). Custom subgroup-free dequant
   was numerically wrong (NMSE ≈ 0.67–0.90). GEMV is closed. Glue
   fusion of 8K–48K F32 chains cannot outrun that roof.
4. **The only isolated Adreno dispatch numbers we have are small.**
   Qualcomm's own recordable-queue win is **~10%** on selected MoE
   (slide 25). Upstream `#26437` got **+7.7%** on a 740 by pinning
   submit threads — and that PR is about host scheduling, not
   cmdbuf. Neither is 60–150 ms of a ~494 ms split token
   (1/2.025 s). 10% of 494 ms is ~49 ms, and that 10% is not
   measured on *this* hybrid graph.
5. **Cmdbuf cannot collapse the 82 waits.** Each GPU↔CPU expert
   boundary is a full-device `clWaitForEvents` (`ggml-opencl.cpp:6258-6264`)
   on an 8K / 48K copy (`err:13613,13618`). The tax is the wait, not
   the memcpy. Fusion does not touch it. A recorded OpenCL island
   does not touch it. One enqueue/token would require GPU
   `MUL_MAT_ID`, which this product pin forbids.
6. **Fusion's 200–340 launch cut is real and small.** It is the
   leftover this verdict keeps. It is not a 1.10× N3 gate
   (failed at 0.698× / 0.59× TTFT, `moe-k4-split.md:317`). K4's
   own close: "Speed lane on A7X: CLOSED"
   (`moe-k4-split.md:328-330`). Cmdbuf is not the parked
   fused-executor rebuild (months). It is not a reason to reopen
   GEMV.

So: **this lane is not the answer to the 60–150 ms number**, because
that number is unisolated, the hybrid graph is not one command
buffer, KHR is not on Adreno, and the N3 loss is GEMV. The only
honest leftover is a 2–3 week fuse pass that cuts launch *count*
and will not revive the split.

DONE
