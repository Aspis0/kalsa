# CMDBUF recon audit (Q1-Q4)

Hostile independent check of `results/cmdbuf/recon_q1_driver.md`,
`recon_q2_upstream.md`, `recon_q3_stream.md`, `recon_q4_fallback.md`.
Mandate: `mandates/cmdbuf-recon.md`. Search date claimed: 2026-08-13.

**This file is not Q5.** No FEASIBLE / FEASIBLE_PARTIAL / DEAD.

Every major claim below was re-opened from disk or from the live URL.
Verdicts: CONFIRMED / PLAUSIBLE / REFUTED. Findings are CONFIRMED or
PLAUSIBLE only. Ruled-out attacks are listed at the end, briefly.

---

## 0. Method

Opened locally (not trusted from the recon prose):

- `mandates/cmdbuf-recon.md`
- all four recon files
- `results/gdn_gpu_k2/s23/logs/support_gdn.txt`
- `results/gdn_gpu_750/driver_header.txt`
- `llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp` (Q1 cites)
- `BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp` (Q2-Q4 cite)
- `BigMoeOnEdge/third_party/llama.cpp/src/llama-kv-cache.cpp`
- `BigMoeOnEdge/third_party/llama.cpp/src/llama-graph.cpp`
- `BigMoeOnEdge/third_party/llama.cpp/src/models/qwen35moe.cpp`
- `BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml.c`
- `BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-impl.h`
- `BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-backend.cpp`
- `BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-cpu/ggml-cpu.c`
- `deps/opencl-android/OpenCL-Headers/CL/cl_ext.h`
- `results/k4split/n1/n1_sched_B_c1000.err` (full parse, not the cited window)
- `results/k4split/n3/runs/n3_ARM_CPU_fact_o1/combo.txt`
- `results/k4split/n3_final/runs/n3_ARM_CPU_fact_o1/stdout.txt`
- `reports/moe-k4-split.md`, `reports/moe-mld-m1.md`, `reports/research-adreno-opencl.md`

Fetched independently (HTTP 200, body inspected):

- https://www.iwocl.org/wp-content/uploads/IWOCL-2026-Wang-Llamacpp.pdf (569749 bytes)
- https://www.khronos.org/developers/linkto/machine-learning-on-mobile-with-opencl (IWOCL 2022 Calidas PDF)
- https://registry.khronos.org/OpenCL/specs/unified/refpages/man/html/cl_khr_command_buffer.html
- https://api.github.com/repos/Oblomov/clinfo/issues/comments/2629350597 (750 clinfo)
- https://api.github.com/repos/ggml-org/whisper.cpp/issues/3708 (830 clinfo)
- https://api.github.com/repos/termux-user-repository/tur/issues/comments/3138515728 (732 clinfo)
- https://gist.githubusercontent.com/woachk/9a0c542a946e4d2838564f104e0833d7/raw (730 clinfo)
- https://api.github.com/repos/ggml-org/llama.cpp/pulls/{22764,16548,26437,26431,26477,25537,25749,26802,22522,25089,26771,21310}
- https://raw.githubusercontent.com/jansol/llama.cpp/5b85b9bf77bfb4a971396fb95e6850c54097214d/ggml/src/ggml-opencl/ggml-opencl.cpp
- https://raw.githubusercontent.com/alibaba/MNN/master/source/backend/opencl/core/runtime/OpenCLRuntime.cpp
- https://raw.githubusercontent.com/alibaba/MNN/master/source/backend/opencl/core/runtime/OpenCLWrapper.cpp

Not fetched (recon already marked wall / snippet-only; I did not pretend):
PrimeGrid user-posts, QPM SDK PDF, Qualcomm support forum, CSDN, MNN
`OpenCLBackend.cpp` `enqeueRecord` (wrapper signature was enough),
PR `#22764` commit `0342381` message, `#22764` comment author.

---

## 1. Mandated attack vectors

### 1.1 Treating missing clinfo as "the driver has it"

**Lands. WARNING. CONFIRMED.**

Q1 summary table (`recon_q1_driver.md:13-15`) prints **YES** for
`cl_qcom_recordable_queues` on **our exact** 740 (`0676.73` / `E031.41.03.62`)
and 750 (`0762.36.1` / `E031.45.02.25`).

What is actually on disk for those ICDs:

- 740: `results/gdn_gpu_k2/s23/logs/support_gdn.txt:5-19` prints driver
  string + `cl_qcom_subgroup_shuffle support: true`. No
  `CL_DEVICE_EXTENSIONS` dump.
- 750: `results/gdn_gpu_750/driver_header.txt:10-24` same class of log.
  No extension string.
- `ggml-opencl.cpp` reads `CL_DEVICE_EXTENSIONS` and never logs it
  (`llama.cpp` copy `5874-5901`; BigMoe copy `5471-5491`). It never
  probes `cl_qcom_recordable_queues` or `cl_khr_command_buffer*`.
- Ripgrep of `results/` for those tokens in campaign logs: recon's
  negative search is consistent with what I see.

The YES cells are inference:

- 750: public clinfo is Adreno 750 / **E031.45.02.06** (ahorek,
  https://github.com/Oblomov/clinfo/issues/92#issuecomment-2629350597,
  2025-02-02). I re-fetched the comment. Device Extensions contains
  `cl_qcom_recordable_queues 0x400001 (1.0.1)` and does **not** contain
  `cl_khr_command_buffer`. Our unit is `.02.25` / `0762.36.1`, not that
  build.
- 740: **no public clinfo at all**. Sandwich is 730 E031.38.11.14
  (gist woachk; I fetched it; recordable 1.0.1 present, KHR cmdbuf
  absent) + 732 E031.45.02.09 (tur#1866 comment; same) + 750/830 +
  Qualcomm "shipping".

Q1 writes the caveats (`recon_q1_driver.md:17-20`). The table still
answers the mandate question ("specifically our 740 / 750") with YES.
Anyone quoting the table without the caveats will ship a vendor-API
plan against an unprinted string. The honest cell is **UNKNOWN
(inferred YES)** until one `clinfo` / `GGML_LOG_INFO(ext_buffer)` on
the phone.

KHR = NO is a different inference and is stronger (see 1.4). Do not
conflate the two columns.

### 1.2 Mixing 830 / desktop Adreno with 740 / 750

**Mostly REFUTED as a performance mix. PLAUSIBLE as sandwich fuel for the 740 YES.**

What Q1 actually did with 830 (whisper.cpp#3708, guranu, 2026-03-15;
I fetched the issue): Adreno 830 / `0800.56.1` / `E031.47.18.42` still
advertises `cl_qcom_recordable_queues 1.0.1` and still lacks
`cl_khr_command_buffer`. Used as "newer than 750, still no KHR".
That is a valid sandwich for KHR=NO. It is **not** a 740/750 clinfo.

No desktop Adreno dump is cited (no X Elite / PC Adreno). The 730 /
732 / 750 / 830 dumps are all mobile.

Q2 `#26431` numbers are Adreno **X2-90**, correctly attributed, not
relabeled as 740/750. `#26437` 740 pin numbers (6.23 -> 6.71) are
author numbers on a 740, not our campaign.

The remaining sin: 830-has-recordable is used as one of the four
adjacent dumps that license the **740 YES**. An 8-series ICD does not
prove a 0676.73 7-series ICD. That is the 1.1 finding again, not a
silent GPU-name swap.

### 1.3 Calling ~1000 launches/token "measured"

**Lands on the mandate. Does not land on Q3/Q4 as a fake measurement.
WARNING for leftover leakage.**

Mandate `mandates/cmdbuf-recon.md:3-4` (emphasis mine):

> **Measured** enemy (K4 N3 + M1 diagnosis): ~60-150ms/token of
> dispatch/glue overhead — ~1000 kernel launches + 82 synchronous
> graph splits per token.

Independent count on `results/k4split/n1/n1_sched_B_c1000.err`
(first `n_tokens=1` reserve, lines 1208-3676):

- `## SPLIT` headers: **82**
- printed `node #` lines: **2305**
- backends: **2144 OpenCL + 161 CPU**
- last node: `#3616 MUL_MAT`
- `sched_reserve: graph nodes = 3617` / `graph splits = 82` at
  `:13560-13561` (same numbers at
  `results/k4split/s23_logs/logs/n1/n1_c4096_B_c1000.err:1215-1216`)

There is **no** `GGML_OPENCL_PROFILING` / `cl_trace.json` / enqueue
counter in-tree. 2305 is a sched-debug listing, not
`clEnqueueNDRangeKernel`.

Q3 (`recon_q3_stream.md:74-78`) marks 82 and 3617 MEASURED, ~2300
COUNTED from dump, **~1000 ESTIMATED in the mandate only**, 60-150 ms
NOT MEASURED. Correct.

Q4 (`recon_q4_fallback.md:19-23`) says the listed-compute budget after
empty skips + existing RMS_NORM+MUL fuse is **~2080 / ~2100**, not
1000, and that 149 ms is `1/2.025 - 1/2.901` from
`reports/moe-k4-split.md:311` (whole split vs CPU, GEMV included).
Arithmetic: 1/2.025 - 1/2.901 = 0.1491 s. CONFIRMED. They correctly
refuse to spend 149 ms as a glue budget.

Leakage still in the recon set:

- Q2 synthesis (`recon_q2_upstream.md:119`) repeats "~1000
  launches/token" with no ESTIMATED tag.
- Q3 then rebuilds a ~900-1000 **2B** guess (`recon_q3_stream.md:77`:
  24 layers x ~40 ops from a K4 skeleton minus MoE). That is a
  different model (`reports/moe-mld-m1.md:73-82`: 24 / 18 GDN / 6 FA).
  The mandate attributed ~1000 to "K4 N3 + M1 diagnosis". Q3 names the
  mix; it does not stop a later reader from putting 1000 back on 35B.

Honest 35B decode figure from the dump I counted: **~2300 listed
compute nodes / token**, ~2100 after the empty+RMS adjustments Q4
describes. ~1000 is not that number.

### 1.4 Claiming `mutable_dispatch` without the extension string

**REFUTED as a false positive in these four files.**

Nobody writes that Adreno 740/750 advertise
`cl_khr_command_buffer_mutable_dispatch`.

- Q1 table: **NO** / **NO** (`recon_q1_driver.md:13-15`).
- IWOCL 2026 slide 29 (PDF page 28, independently read) lists
  `cl_khr_command_buffer` as "shipping / Not available on Adreno".
  It does **not** mention `mutable_dispatch` at all.
- Public dumps I re-fetched (730, 732, 750, 830): string absent.
- Local headers (`deps/opencl-android/OpenCL-Headers/CL/cl_ext.h:48-54`
  and `:622-628`) are Khronos spec, `#if CL_ENABLE_BETA_EXTENSIONS`.
  Q1/Q3 label them as such.
- Fork never probes the token (BigMoe `ggml-opencl.cpp:5471-5491`).
- `#22764` vtable `graph_plan_update = NULL` (jansol
  `ggml-opencl.cpp:4574`, fetched).

Q1's mutable NO is an inference: layered extension on a base Qualcomm
says is not on Adreno, plus no dump has the string. That is not "we
saw the string". Do not promote it to a verbatim ICD fact. Do not
promote it to YES either.

---

## 2. Findings (ranked)

### F1. WARNING / CONFIRMED — Q1 table YES for recordable on our ICDs

See 1.1. The failure scenario: week-1 vendor-API implementation on
740 assumes `clCreateCommandQueue(..., CL_QUEUE_RECORDABLE_QCOM)`
succeeds because the table said YES; 0676.73 never printed the token.
Fix: change the cells to UNKNOWN (inferred) until a phone clinfo
exists. Keep Qualcomm "shipping" and the 730-830 sandwich in the
prose, not in the boolean.

### F2. WARNING / CONFIRMED — Q4 claims one KHR enqueue can cover 82 islands

`recon_q4_fallback.md:300-302`:

> `cl_khr_command_buffer` (Q1-Q3) is the only bounded way to keep 82
> islands and still pay one enqueue/token.

This contradicts Q3 (`recon_q3_stream.md:23-24, 105`) and the API:

- A `cl_command_buffer_khr` is recorded against OpenCL queues
  (`clCreateCommandBufferKHR` in jansol `:4242`, replay
  `clEnqueueCommandBufferKHR` `:4267`).
- 41 of 82 splits are CPU (`n1_sched_B_c1000.err` pattern
  `#0 CPU embd`, `#2,#4,...#80 CPU MUL_MAT_ID`, confirmed by parse:
  161 CPU nodes, 40 x (3x MUL_MAT_ID + SWIGLU) + embd GET_ROWS).
- OpenCL `graph_plan_*` cannot record `ggml-cpu.c` `mul_mat_id`.
- Even the GPU side is ~41 separate `graph_compute` islands, not one
  tape. One enqueue/token would require collapsing residency first
  (GPU `MUL_MAT_ID`), which Q4 itself marks out of scope
  (`recon_q4_fallback.md:217`, hook at `ggml-cpu.c:1665-1669`).

Failure scenario: Q5 (not written here) quotes Q4 §5 and plans "record
the 82-split graph once". That plan is impossible on this residency.
Fix: delete or rewrite §5. The bounded vendor/KHR object records
**one OpenCL island**, not the hybrid token.

### F3. WARNING / CONFIRMED — Q3 says `n_expert_used` is 8; the dump Q3 cites says 6

`recon_q3_stream.md:60`: "GWS follows `n_expert_used` (fixed 8)".
Same file `:107`: "~5 ADDs to fold 8 experts".

Same dump, same file they cite:

- `n1_sched_B_c1000.err:134` `n_expert_used = 6`
- `:1261` `ffn_moe_weighted-0 use=6`
- `:1262-1266` **five** ADDs (6-1)
- `results/k4split/n3/runs/n3_ARM_CPU_fact_o1/combo.txt:141-142`
  `n_expert = 256`, `n_expert_used = 6`

Q4 got this right (`recon_q4_fallback.md:56-60`) and even warned
"6 here, not 8" (`:271`). Q3 did not.

Failure scenario: a fuse kernel sized for 8-way reduce, or a GWS
built from stock-Qwen top-8, runs on this pack. Fix: 6. Stock card
is not this GGUF.

### F4. WARNING / CONFIRMED — KHR=NO is Qualcomm May 2026 + sandwich, not our ICD string

Q1 (`recon_q1_driver.md:20, 61, 282`) treats IWOCL 2026 slide 29
"Not available on Adreno" as strong enough to mark **our exact ICDs**
NO.

I read the slide (PDF page 28). Quote is real. "Used by" cell is
"Not available on Adreno"; "Status" shipping is the Khronos spec,
matching how every other shipping-but-used row is written. Q1's
reading of the table is CONFIRMED.

What it is not: a `CL_DEVICE_EXTENSIONS` dump of `0676.73` or
`0762.36.1`. Qualcomm in May 2026 is talking about Adreno as a
family, after our campaign drivers. Directionally this makes KHR
**less** likely on older ICDs, not more. Still not a verbatim
string. The 730-830 dumps I re-fetched all lack the token. That
is the right evidence class: sandwich + vendor, same as recordable
YES, except here Qualcomm is explicit.

Do not let Q5 say "we measured KHR missing on 740". We did not.

### F5. WARNING / PLAUSIBLE — Q1 overstates MNN as proof of our ICD symbols

`recon_q1_driver.md:246`: MNN is "proof the vendor entry points exist
as exported ICD symbols on shipping Adreno `libOpenCL.so`".

What I actually opened:

- `OpenCLRuntime.cpp:297-304` (fetched): if `!isQcomError()` AND
  extension string contains `cl_qcom_recordable_queues`, create a
  queue with `CL_QUEUE_RECORDABLE_QCOM`.
- `OpenCLWrapper.cpp:306-311, 780-787` (fetched): loads
  `clNewRecordingQCOM` / `clEndRecordingQCOM` /
  `clEnqueueRecordingQCOM` / … from `libOpenCL.so`. The enqueue
  signature has `num_global_workgroups` + `num_local_workgroups`
  (GWS/LWS updates). That part of Q1 is CONFIRMED.

MNN taking a runtime branch on **some** Adreno does not prove
`0676.73` exports those pointers. If the extension is missing,
MNN just does not take the path. Production use is real. Our ICD
export is still the missing clinfo.

### F6. WARNING / CONFIRMED — Q3/Q4 launch math is not an enqueue counter

See 1.3. Additional cracks:

- Q3 ~2300 = line-count heuristic; my parse is **2305**. Close.
- Q4 ~2080 = 30 x ~53 + 10 x ~49 + ~4. Layer-0 table vs dump
  `:13570-13633` is consistent (~56 listed, ~53 after 3x RMS fuse
  and 4 empty 0K GET_ROWS/CPY). Whole-token product is an estimate,
  not a full-dump recount. My 2305 - ~120 empty - ~131 RMS pairs
  is ~2050. Same order.
- Both miss that `ggml_backend_opencl_graph_compute`
  (`ggml-opencl.cpp:6387-6389`) also skips
  `GGML_TENSOR_FLAG_COMPUTE == 0`. The sched dump already prints
  `c=1` on every listed node, so this does not change the 2305.
  It would matter if someone counted `graph nodes = 3617` as
  launches (3617 includes VIEW/RESHAPE). Q3/Q4 already subtract
  those. Fine.
- 0K in the dump is KiB rounding, not `ggml_is_empty`. Q4 only
  treats the unused GDN rollback GET_ROWS/CPY as empty (nodes 9,
  11, 24, 26), not alpha MUL_MAT node 34 (also printed 0K, 32
  floats). That distinction is correct. A sloppy reader will
  skip every 0K op.

### F7. WARNING / PLAUSIBLE — 60-150 ms glue is still in the air as a number

Q3/Q4 refuse to treat it as isolated. Good.

The mandate still calls it Measured. K4 N3 CPU stdout I opened
(`n3_ARM_CPU_fact_o1/stdout.txt:15`) is **0.343 s/token total**.
Split median 2.025 t/s (`moe-k4-split.md:311`) is **0.494 s/token
total**. Neither is enqueue tax. `#26437` (fetched) is the only
Adreno document that isolates submit stalls, and it is 642L
(p50 1.4 ms x ~48 stalls) plus a 740 **+7.7%** from pinning,
not 60-150 ms.

Failure scenario: Q5 spends a week of cmdbuf to chase a 60-150 ms
budget that has no profiler split. Q4 already says this
(`recon_q4_fallback.md:23, 195-199`). Keep that sentence; do not
let the mandate number come back.

### F8. NITPICK / CONFIRMED — Q2 is the cleanest of the four, with two leaks

Independently confirmed:

- `#22764` open draft, not merged, created/updated 2026-05-06,
  author jansol, head `5b85b9bf`, tested gemma-3-1b-it-f16 on
  PoCL-CUDA and ROCm only, body does not mention Adreno,
  `graph_plan_update = NULL` at `:4574`, detect string
  `cl_khr_command_buffer` at `:3485`. CONFIRMED.
- `#16548` open, not draft, not merged, wishstudio, reviewers
  ggerganov + slaren, last update 2025-12-02, CUDA plans, "up to
  30%" in the body. CONFIRMED.
- `#26437` open draft, wanghqc, 2026-08-02 / 2026-08-08, 642L
  7.63->16.73, 740 6.23->6.71, 840/850 inert, submit-bound
  diagnosis. CONFIRMED.
- `#26431` open draft, X2-90 pp512 +3.36%/+3.52%, tg32
  +0.58%/+0.19%, "Both matmuls keep their own dispatches".
  CONFIRMED.
- Fork vtable `graph_plan_* = NULL` at
  `ggml-opencl.cpp:6877-6880`. Fusion at `:6391-6405`.
  `cpy_tensor_async` vtable NULL at `:6875` (stub at `:6251-6256`
  returns false). CONFIRMED.
- GitHub PR search for the literal `cl_khr_command_buffer`
  returning 0 is consistent with `#22764`'s body never containing
  that token. They found the PR via `label:OpenCL`. Honest.

Leaks: `:119` ~1000 untagged; `:121` implication names only
`cl_khr_command_buffer` / mutable as "whatever Adreno exposes"
and forgets the vendor door Q1 spent the whole file on.

Unverified by me: commit `0342381` message; "1 bot comment"
author; `#26477` 16.91 vs 14.45 t/s (PR exists, title matches,
body not fully extracted).

### F9. NITPICK / CONFIRMED — Q3 FA temp `clCreateBuffer` line range is sloppy, claim is real

`recon_q3_stream.md:58` says temps at `14183-14305`. Actual
`clCreateBuffer` for `temp_partial` is
`ggml-opencl.cpp:14298-14303`. `n_splits` at `:14287-14289`,
`n_kv` arg at `:14349`, GWS `n_splits * n_q` at `:14385`.
The allocation is per enqueue, not pooled (unlike `kq_img_pool`).
That part is CONFIRMED and is a real cmdbuf footgun if `-fa on`.
K4/M1 used `-fa off` (`moe-k4-split.md:205-208`). Irrelevant to
the measured 35B path.

### F10. NITPICK / CONFIRMED — IWOCL / Khronos / MNN quotes are real

Independently read, not paraphrased from memory:

- IWOCL 2026 p.24 (slide 25): `cl_qcom_recordable_queue` (singular)
  "enables replay of per-layer launches"; `cl_khr_command_buffer`
  "expected to replace the vendor extension once it is available
  on Adreno"; "~10% … on selected large models (MoE models)".
- IWOCL 2026 p.27 (slide 28): "Pre-recorded cmd buffers" OpenCL =
  partial, closure = "`cl_khr_command_buffer` adoption."
- IWOCL 2026 p.28 (slide 29): table rows match Q1's transcription.
- IWOCL 2022 slide 5 (11 May 2022, Calidas): recordable_queues
  records EnqueueNDRangeKernel, replay with optional kernel-arg
  updates. Slide 6: `cl_khr_command_buffer` /
  `cl_khr_mutable_dispatch` "Upcoming … (provisional)".
- Khronos man page: Ratified; experimental header; Last Modified
  Date **2025-07-10**; revision **0.9.8**; contributors include
  Balaji Calidas and Joshua Kelly (Qualcomm).
- Local header version `CL_MAKE_VERSION(0, 9, 8)` at
  `cl_ext.h:57`.

Q1's "slide typo, plural is the real string" is CONFIRMED (every
clinfo + MNN use `cl_qcom_recordable_queues`).

### F11. NITPICK / CONFIRMED — per-token stream map is mostly right

Checked:

- `ggml_rope_impl` hardcodes `n_past = 0` (`ggml.c:4183`).
  OpenCL still `clSetKernelArg(..., 24, ..., &n_past)` at
  `:21827`. STABLE=0 is correct.
- `get_n_kv` pads to `max(n_pad, 256)` (`llama-kv-cache.cpp:1227-1240`).
  `can_reuse_kq_mask` requires `kq_mask->ne[0] == n_kv`
  (`llama-graph.cpp:45-61`). Graph rebuild on pad jump: CONFIRMED.
- Host writes are blocking `clEnqueueWriteBuffer` `:8809-8811`.
- Queue props 0 / profiling only (`:5570-5574`). No
  `CL_QUEUE_RECORDABLE_QCOM`.
- Scheduler fallback when `cpy_tensor_async` is NULL:
  `synchronize(input)` + `synchronize(split)` + `tensor_copy`
  (`ggml-backend.cpp:1664-1671`). OpenCL sync is
  `clEnqueueBarrierWithWaitList` + `clWaitForEvents`
  (`:6258-6264`). 81 splits with inputs: CONFIRMED pattern.
- Layer mix: `hparams.is_recr(il)` (`qwen35moe.cpp:192-198`).
  Dump layers 0-2 GDN, layer 3 `Qcur_full` (`:1407`). 30 GDN +
  10 FA on 40 layers: CONFIRMED.
- Existing fuse `RMS_NORM+MUL` / `NORM+MUL+ADD` /
  `GROUP_NORM+MUL+ADD` (`:6391-6405`). `ggml_can_fuse_ext`
  requires `use==1` and `ggml_are_same_shape` (`ggml-impl.h:682-692`).
  Q4's "broadcast shexp SIGMOID+MUL will not pass" is CONFIRMED.
- Expert reduce is a loop over `hparams.n_expert_used`
  (`llama-graph.cpp:2128-2138`).

Q4 (a)/(b) ceilings (200-450 launches, **0 of 82 splits**) are
count-estimates, labeled as such. I did not re-derive every fuse
week-cost. The split ceiling of 0 follows from residency and is
CONFIRMED.

---

## 3. Claim ledger (major claims only)

### Q1 `recon_q1_driver.md`

| claim | verdict | note |
|---|---|---|
| Our 740 driver string `0676.73` / `E031.41.03.62` | CONFIRMED | `support_gdn.txt:5` |
| Our 750 driver string `0762.36.1` / `E031.45.02.25` | CONFIRMED | `driver_header.txt:10` |
| Fork / campaign logs do not print `CL_DEVICE_EXTENSIONS` | CONFIRMED | probe at `ggml-opencl.cpp:5874-5901` (llama.cpp) / `5471-5491` (BigMoe); print at `5673-5710` has no ext list |
| 750 public clinfo E031.45.02.06 has recordable 1.0.1, no KHR cmdbuf | CONFIRMED | clinfo#92 comment re-fetched |
| 830 0800.56.1 E031.47.18.42 same | CONFIRMED | whisper.cpp#3708 re-fetched |
| 732 E031.45.02.09 same | CONFIRMED | tur#1866 comment re-fetched |
| 730 E031.38.11.14 same | CONFIRMED | gist woachk re-fetched |
| IWOCL 2026 quotes (slides 25/28/29) | CONFIRMED | PDF pages 24/27/28 |
| IWOCL 2022 slide 5/6 quotes | CONFIRMED | Calidas PDF |
| Khronos spec date 2025-07-10, rev 0.9.8, Calidas/Kelly | CONFIRMED | registry page |
| KHR cmdbuf **NO** on Adreno as a family (May 2026) | CONFIRMED as Qualcomm's words | not a 0676.73 dump |
| recordable **YES** on our 740 | **PLAUSIBLE, over-claimed as YES** | F1 |
| recordable **YES** on our 750 | **PLAUSIBLE, closer than 740** | same-family clinfo + shipping |
| mutable **NO** on both | PLAUSIBLE inference | no string anywhere; not a dump |
| MNN uses the vendor API | CONFIRMED | fetched runtime + wrapper |
| MNN proves *our* `libOpenCL.so` exports | PLAUSIBLE at best | F5 |
| `#22764` not Adreno-tested | CONFIRMED | PR body |
| PrimeGrid `0762.39` snippet | left as supporting by Q1 | I did not fetch; they already downgraded it |

### Q2 `recon_q2_upstream.md`

| claim | verdict | note |
|---|---|---|
| Only OpenCL cmdbuf artifact is draft `#22764` | CONFIRMED | PR + source fetched |
| Not in master / not in our fork | CONFIRMED | vtable NULL |
| `#16548` unmerged CUDA plan API | CONFIRMED | |
| `#26437` Adreno submit-bound, not cmdbuf | CONFIRMED | |
| Fusion PRs are launch reduction, not replay | CONFIRMED | |
| CUDA/SYCL/HIP already have the class of solution | CONFIRMED | `#25749` `#26802` `#22522` `#25089` exist |
| ~1000 launches in the synthesis line | **untagged estimate** | F8 / 1.3 |

### Q3 `recon_q3_stream.md`

| claim | verdict | note |
|---|---|---|
| Piecewise-stable topology inside one n_kv pad | CONFIRMED | `get_n_kv` + `can_reuse_kq_mask` |
| No recorded command buffer in this fork | CONFIRMED | |
| 82 splits MEASURED | CONFIRMED | 82 headers + sched_reserve |
| 3617 graph nodes MEASURED | CONFIRMED | includes views |
| ~2300 listed compute nodes | CONFIRMED | I count 2305 |
| ~1000 launches ESTIMATED | CONFIRMED as their label | origin is 2B guess + mandate |
| 60-150 ms not measured | CONFIRMED | |
| `n_past` RoPE is 0 | CONFIRMED | `ggml.c:4183` |
| FA temps are new `clCreateBuffer` | CONFIRMED | `:14298` (line range in Q3 is off) |
| K4 path is `-fa off` | CONFIRMED | `moe-k4-split.md:205` |
| `n_expert_used` fixed 8 | **REFUTED** | dump `:134` = 6; F3 |
| mutable not in fork / not in logs | CONFIRMED | |

### Q4 `recon_q4_fallback.md`

| claim | verdict | note |
|---|---|---|
| 82 splits structural (GPU trunk / CPU experts x 40) | CONFIRMED | |
| ~2080 enqueues after empty+RMS | PLAUSIBLE count | my recount ~2050 |
| `n_expert_used=6`, 5 ADDs | CONFIRMED | |
| 30 GDN + 10 FA | CONFIRMED | |
| Existing RMS fuse already on | CONFIRMED | |
| (a) 200-450 launches if fuses land | PLAUSIBLE count | not time |
| (b) 0 of 82 splits | CONFIRMED | residency |
| N3 0.698x / 0.59x | CONFIRMED | `moe-k4-split.md:311-317` |
| 149 ms is split-vs-CPU, not glue | CONFIRMED | |
| KHR cmdbuf => one enqueue / 82 islands | **REFUTED** | F2 |
| token_embd 333 MiB host | CONFIRMED | `moe-k4-split.md:280` |

---

## 4. Ruled out (brief)

- **Q1/Q3 claiming mutable_dispatch is on Adreno:** they do not.
  Table is NO; headers are labeled spec-only.
- **Q1 mixing desktop Adreno into 740/750 performance:** no desktop
  dump, no 830 tok/s pasted onto 740.
- **Q3/Q4 calling ~1000 a measured enqueue count:** they explicitly
  un-measure it. The mandate still does. Q2 leaks the number.
- **Q1 treating missing clinfo as KHR present:** opposite. They
  treat Qualcomm "not available" as KHR absent. The over-read is
  the recordable YES column.
- **Fabricated IWOCL / Khronos / clinfo quotes:** the ones I
  re-opened match. PrimeGrid was already marked unquoted.

---

## 5. What this audit does not decide

No Q5. In particular this file does **not** choose
FEASIBLE / FEASIBLE_PARTIAL / DEAD, does not pick an entry point,
and does not bless a week-estimate.

What a later verdict is not allowed to pretend, given the above:

1. That `0676.73` or `0762.36.1` printed `cl_qcom_recordable_queues`
   or `cl_khr_command_buffer*`.
2. That ~1000 launches/token or 60-150 ms glue were measured on
   K4 N3 / M1.
3. That `n_expert_used` is 8 on this pack.
4. That a KHR/vendor command buffer records the 82-split hybrid
   token as one enqueue.
5. That `#22764` is an Adreno path.

DONE
