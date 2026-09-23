# archive-gpu-cells — MEASUREMENT RECORD of the GPU/OpenCL work in the lab

Cell: `scratchpad/agents/archive-gpu-cells`. Role: EXPLORER, read-only.
Mission: map the *existing* per-cell and campaign evidence about Adreno GPUs, so a
zero-copy / host-pinned shared-weights decision does not redo finished work.

All dates are as written in the source. Labelling:
**MEASURED** = raw artifact in the repo; **ESTIMATE** = derived/rounded by an agent;
**FAILED-RUN** = the run itself aborted; **UNVERIFIED** = claim carries no raw file.

Planned sections (written incrementally, one section per response) — **all six now delivered**:
1. Adreno 732 FLASH_ATTN compile failure + alloc failure + segfault (the known item).
2. Observed Adreno device strings, driver/compiler versions, OpenCL memory limits.
3. **Zero-copy / host-pinned / shared-weights / RSS-on-GPU hunt** — the mission core.
4. GPU/OpenCL performance measurements per Adreno tier (prefill/decode, kernels).
5. Phone-side llama-bench / llama-cli / test-backend-ops runs: flags, push paths,
   LD_LIBRARY_PATH, SELinux, which libOpenCL.
6. Dated findings list (newest first) + raw-evidence INDEX + WHAT WE DO NOT KNOW.

**Two predecessor cells cover a large part of this mission and must be read with it:**
`scratchpad/agents/archive-gpu-docs/REPORT.md` (2026-09-21, docs/plans side; carries its own
INDEX and a 13-item WHAT WE DO NOT KNOW) and
`scratchpad/agents/archive-gpu-repo-history/REPORT.md` (git-history side; carries its own
"WHAT WE DO NOT KNOW" grouped by decision). This report adds the cell-level and `results/`
evidence those two did not sweep.

---

## SECTION 1 — The Adreno 732 failure: FA kernels do not compile, then a 1.68 GiB alloc failure and a segfault

**Source cell:** `scratchpad/agents/qdc-7pg3-govbench-52/` — "REPORT — Cell #52: Snapdragon
7+ Gen 3 (QRD7675) first contact". Date **2026-09-03**. QDC job 797795, host `sa801864`,
device id `f6d5d957`, session 05:22–05:57 CEST.

**Device:** SoC `SM7675` (getprop `ro.soc.model`, `raw/recon_sa801864.txt:2`), platform
`pineapple`, Android 14 userdebug, GPU **Adreno 732**, RAM 11,594,996 kB (~11.1 GiB of 12 GB).
`/vendor/lib64/libOpenCL.so` present (`raw/recon_sa801864.txt`, `OPENCL_LIB_PRESENT`).

**The raw run that produced it:** `scratchpad/agents/qdc-7pg3-govbench-52/raw/loadprobe_FAcrash_sa801864.out`,
preserved deliberately ("found via the first (crashed) load probe ... preserved"). 25 lines.
**FAILED-RUN** (exit 139).

Exact text, with line numbers in that raw file:

- `loadprobe_FAcrash_sa801864.out:4` —
  `0.10.897.846 E ggml_opencl: kernel compile error (err=-11) building fa f32_f16:`
- `loadprobe_FAcrash_sa801864.out:5` — `BC-src-code:2010:22: error: implicit declaration of
  function 'sub_group_shuffle_xor' is invalid in C99 [-Werror,-Wimplicit-function-declaration]`
- `:6` — `s += sub_group_shuffle_xor(s, step);`
- `:9` — `m_c = max(m_c, sub_group_shuffle_xor(m_c, step));`
- `:19` — `0.18.374.316 E ggml_gallocr_reserve_n_impl: failed to allocate OpenCL buffer of size 1804626176`
- `:20` — `0.18.374.330 E graph_reserve: failed to allocate compute buffers`
- `:21` — `0.18.397.057 E llama_init_from_model: failed to initialize the context: failed to allocate compute pp buffers`
- `:24` — `|Segmentation fault `
- `:25` — `nproc=8 cpu_mask=0xf0 exit=139`

**The tensor and its size.** The allocation failure names a flat size, not a tensor name:
**1804626176 bytes = 1.68 GiB (binary) = 1.80 GB (decimal)**. The cell's own audit flags the
ambiguity: `AUDIT-REPORT.md:41` says the report's "1.8 GB" is "MISLEADING but not wrong" if
GB = 10^9, and `AUDIT-REPORT.md:271` requires the wording be changed to "1.68 GiB" or
"~1.8 GB (decimal)". **The tensor identity is NOT recorded** — the log gives size only.

**Driver string at the failure point:** the FA-crash file does not print a driver line. The
same cell's `test-backend-ops` runs do: `raw/tbo_mm_sa801864.out:6` and
`raw/tbo_mmid_sa801864.out:6` —
`ggml_opencl: OpenCL driver: OpenCL 3.0 QUALCOMM build: commit unknown Compiler E031.45.02.16`.
Device description line: `raw/tbo_mm_sa801864.out:3` —
`ggml_opencl: device: 'QUALCOMM Adreno(TM) 732 (OpenCL 3.0 Adreno(TM) 732)'`.
So the 732's compiler is **E031.45.02.16** with build "commit unknown".

**The cell's interpretation, verbatim (`qdc-7pg3-govbench-52/REPORT.md:38-42`):** "The 732's
OpenCL 3.0 driver lacks `sub_group_shuffle_xor` (or the required subgroup-shuffle extension).
Every FA-enabled context init then fell into an OpenCL buffer alloc failure
(1,804,626,176 bytes ≈ 1.68 GiB) and a segfault. **Router consequence: the FA lane must be
capability-probed per GPU, not assumed per-vendor** — fa=0 is mandatory on this tier with the
current kernels."

**This is the source of the summary line in `governor-gpu-recon/REPORT.md:520`:** "Adreno 732 |
prefill | FA kernels do not compile: missing `sub_group_shuffle_xor`, then a 1.68 GiB alloc
failure and segfault | same report, Q1 exception".

**Same cell, the measurement that succeeded (for contrast with the crash):**
`qdc-7pg3-govbench-52/REPORT.md:17-27` — MUL_MAT **925/925 PASS**, MUL_MAT_ID **407/407 PASS**
on Adreno 732 (gov-kit `5c3979438`, binary sha `36ddd5ae…`); raw
`raw/tbo_mm_sa801864.out`, `raw/tbo_mmid_sa801864.out`, all exit=0. Bench, LFM2.5-2.6B
QAD-Q4_0 (sha `a247afd6…`), llama-bench 3 reps, `-t 4`, taskset `f0`, thermal-gated,
`REPORT.md:44-55`: GPU `-ngl 99 -fa 0` pp512 **151.78 ± 1.12 t/s**, tg128 **17.26 ± 0.02 t/s**
(`raw/bench_gpu_sa801864.out`); CPU pure `-dev none -ngl 0` pp512 13.77 ± 0.23, tg128
10.27 ± 0.09 (`raw/bench_cpu_pure_sa801864.out`). **MEASURED** (board plugged by nature; the
cell itself states "comparative numbers only per the RTL/QDC convention", `REPORT.md:49`).

**Cross-tier confirmation that the FA compile failure is 732-specific** (not vendor-wide):
`qdc-8g2-oclpicks-53/REPORT.md:40-42` (2026-09-03, Adreno 740) — "**Bonus observation ... FA
compiles and passes on the Adreno 740** — the 732's `sub_group_shuffle_xor` compile failure
(cell #52) is tier-specific, confirming the router needs a per-GPU FA capability probe, not a
per-vendor assumption." Raw for that: `qdc-8g2-oclpicks-53/raw/tbo_{base,picks}_fa_sa801919.out`,
FLASH_ATTN_EXT 229/229 PASS.

**INDEX for Section 1 (raw evidence):**
- `scratchpad/agents/qdc-7pg3-govbench-52/raw/loadprobe_FAcrash_sa801864.out:4-25` (compile error, alloc size, segfault, exit 139)
- `scratchpad/agents/qdc-7pg3-govbench-52/raw/tbo_mm_sa801864.out:3,6` and `raw/tbo_mmid_sa801864.out:3,6` (driver string, compiler E031.45.02.16)
- `scratchpad/agents/qdc-7pg3-govbench-52/raw/recon_sa801864.txt` (SM7675, RAM, libOpenCL present)
- `scratchpad/agents/qdc-7pg3-govbench-52/raw/bench_gpu_sa801864.out`, `raw/bench_cpu_pure_sa801864.out` (perf arms)
- `scratchpad/agents/qdc-7pg3-govbench-52/AUDIT-REPORT.md:33,41,271` (raw-vs-report adjudication of the 1.68 GiB wording)
- `scratchpad/agents/governor-gpu-recon/REPORT.md:520` (the summary line that is the known quote)

## SECTION 2 — Observed Adreno device strings, driver/compiler versions, OpenCL memory limits

### 2.1 The device-string quirk that will break naive parsing

On the **Adreno 740 phones the marketing number is NOT in the device-name field**. The exact
observed string is:

- S23 / Adreno 740: `ggml_opencl: device: 'QUALCOMM Adreno(TM) (OpenCL 3.0 Adreno(TM) 740)'`
  — `results/barrier_verify_s23/mmid.err:3`, `results/qk23_s23/roundtrip_s1.log:3`,
  `results/oracle_consumer_s23/k2_phase1/*.err:3`. **MEASURED.**
- Every other tier puts the number in both fields: `'QUALCOMM Adreno(TM) 732 (OpenCL 3.0
  Adreno(TM) 732)'` (`qdc-7pg3-govbench-52/raw/tbo_mm_sa801864.out:3`),
  `'… Adreno(TM) 750 (…) 750)'` (`results/xiaomi_ab/task_a_4b_clean/bench_4b_gpu_pp512.err:3`),
  `'… Adreno(TM) 830 (…) 830)'` (`qdc-governor-s5/raw/sa803609/8-Elite_B_t2_logcat_all.txt:791`).

**Consequence:** any capability probe that reads the GPU model from the name field gets an
empty string on the S23 and must fall back to the `OpenCL 3.0 Adreno(TM) 740` field.

### 2.2 Driver / compiler matrix actually observed

| device (provenance) | OpenCL version + QUALCOMM build | Compiler | source (raw) |
|---|---|---|---|
| **S23 / Adreno 740** (our phone, SM-S911U, kalama) | `OpenCL 3.0 QUALCOMM build: 0676.73` | **E031.41.03.62** | `results/oracle_consumer_s23/k2_phase1/e3b_q4.err:6`, `results/barrier_verify_s23/mmid.err:6`, `scratchpad/agents/s23-governor-smoke/REPORT.md:502` |
| **HDK8550 / Adreno 740** (QDC job 797850, sa801919, 2026-09-03) | `build: commit unknown` | **E031.41.03.56** | `scratchpad/agents/qdc-8g2-oclpicks-53/raw/tbo_picks_mm_sa801919.out:6`, `raw/tbo_base_mmid_sa801919.out:6` |
| **QRD8650 / Adreno 750** (QDC, cell #55/#58 and governor s5 job sa803304) | `build: commit unknown` / `0800.x` lineage | **E031.45.02.06** | `scratchpad/agents/qdc-750-mulmat-view/raw/sa811910/12f6d9b_tbo_mm.out:6`; `qdc-governor-s5/raw/sa803304/QRD8650_A_t1_filtered.txt` |
| **Xiaomi 14 / Adreno 750** (houji, SM8650) | `build: 0762.36.1` | **E031.45.02.25** | `scratchpad/agents/q16-xiaomi/REPORT.md:63`, `q16-xiaomi-audit/REPORT.md:27`; raw `q16-xiaomi/raw/a/MUL_MAT.err:3-6` |
| **QRD7675 / Adreno 732** (7+ Gen 3, QDC cell #52) | `build: commit unknown` | **E031.45.02.16** | `qdc-7pg3-govbench-52/raw/tbo_mm_sa801864.out:6`, `raw/tbo_mmid_sa801864.out:6` |
| **QRD8635 / Adreno 735** (8s Gen 3, QDC cell #56) | `build: commit unknown` | **E031.45.02.04** | `qdc-8s3-govbench-56/raw/tbo_mm_sa802025.out:6`, `raw/tbo_mmid_sa802025.out:6` |
| **QRD8750 / Adreno 830** (8 Elite, QDC, cell #39) | `build: 0800.70` | **E031.47.18.47** | `qdc-8elite-opencl-e031/AUDIT.md:76` (points at `cert_mm_ocl2.out:5`), `qdc-8elite-opencl-e031/REPORT.md:23` |
| **Adreno 830** (physical 8 Elite governor run, job sa803609) | device string only in logcat | — | `qdc-governor-s5/raw/sa803609/8-Elite_B_t2_logcat_all.txt:791` |
| **Mali-G57 MC2** (Jelly Star, our phone, Helio G99) | `Mali-G57 MC2 r0p1 (OpenCL 3.0 v1.r32p1-01eac0.…)` | — | `qdc-… / q26-mali-gate/REPORT.md:169`; Vulkan banner `q26-mali-gate/REPORT.md:69` |

Counts over the whole lab (grep, binary-safe): `E031.41.03.62` 347 hits, `E031.45.02.06` 169,
`E031.47.18.47` 137, `E031.45.02.25` 57, `E031.45.02.16` 36, `E031.45.02.04` 11,
`E031.41.03.56` 6. Builds: `0676.73` 345, `0800.70` 133, `0762.36.1` 56.
**UNVERIFIED** strings that appear only in research notes about other people's hardware (not
our phones): `0800.46 / E031.47.18.36`, `0800.71 / E031.47.18.49`, `0800.56.1 / E031.47.18.42`,
`E031.45.02.09`, `E031.38.11.14` (`reports/research-adreno750.md:143,299,301`,
`results/cmdbuf/recon_q1_driver.md:113,119`).

**Two different strings for the same 740 silicon** is real and is the answer to hunt item 4:
the S23 reports `0676.73 / E031.41.03.62`, the QDC HDK8550 board reports `build: commit unknown
/ E031.41.03.56` (`qdc-8g2-oclpicks-53/raw/tbo_picks_mm_sa801919.out:6`). Same generation,
different driver build + compiler patch level.

### 2.3 A documented FALSE driver-string claim (do not propagate it)

`qdc-750-mulmat-view/AUDIT.md:24` (F3) asserts: "The `qdc-7pg3-govbench-52` raws contain BOTH
`Compiler E031.45.02.06` and `Compiler E031.45.02.16` lines — the 732 also ran with .02.06".
**Refuted by direct grep:** `grep -rn 'E031' scratchpad/agents/qdc-7pg3-govbench-52/` returns only
`.02.16` (in `raw/tbo_mm_sa801864.out:6` and `raw/tbo_mmid_sa801864.out:6`). The `.02.06` string
in the lab belongs to the **QRD8650 / Adreno 750** runs (`qdc-governor-s5/raw/sa803304/…`,
`qdc-750-mulmat-view/raw/sa811910/…`). The audit's conclusion (do not version-gate the f16
batched-view defect) may still stand, but its cited evidence for the 732 does not exist.
**UNVERIFIED / audit error.**

### 2.4 OpenCL memory limits on each tier — the numbers a zero-copy design must respect

These are printed by the backend at init and are **MEASURED**:

| tier | `global mem size` | `max mem alloc size` | source |
|---|---|---|---|
| **S23 / Adreno 740** | **3536 MB** | **884 MB** | `scratchpad/agents/s23-governor-smoke/REPORT.md:504-505`; `results/barrier_verify_s23/mmid.err:11-12`; `results/gdn_gpu_k2/s23/logs/*.err:10-11` |
| **Xiaomi 14 / Adreno 750** | 5584 MB | 1024 MB | `scratchpad/agents/q16-xiaomi/REPORT.md:69` (banner quote); `results/gdn_gpu_750/driver_header.txt:15-16` |
| **Adreno 830 / 8 Elite** (governor, QDC) | — | — (reports `6554 MiB free`) | `qdc-governor-s5/raw/sa803609/8-Elite_B_t3_filtered.txt:51`, `:819` |

Other Adreno-740 flag lines from the same S23 banner (`s23-governor-smoke/REPORT.md:506-510`,
full line-numbered copy at `scratchpad/agents/s23-governor-smoke/REPORT.md:500-510`):
`device FP16 support: true`, `khr dot product support: true`, `GGML_OPENCL_SOA_Q` flattening on,
`GGML_OPENCL_USE_ADRENO_KERNELS` on. 750 banner adds: `subgroup shuffle true`,
**`vector subgroup broadcast false`**, `SVM coarse+fine buffer true`, `program_cvt variant=bytewise`
(`q16-xiaomi/REPORT.md:71-74`). 830 adds `vector subgroup broadcast: true`
(`reports/research-adreno750.md:299,322`).

**Why 2.4 matters for the host-pinned question:** the S23's hard per-allocation cap is **884 MB**
while the whole GPU buffer pool is **3536 MB**. The 732's fatal allocation was 1,684,626,176
bytes-class (1.68 GiB) — 1.9× the S23's per-alloc cap. A single shared-weights buffer larger
than 884 MB cannot be allocated on the S23 by the normal `clCreateBuffer` path, whatever the
total pool is.

**INDEX for Section 2:** banners are in `results/*/**.err` and `results/*/**.log` (backend init
header, lines 3-12 of most files); QDC banners in `scratchpad/agents/qdc-*/raw/*.out` lines 3-6;
app-side (React Native) banners in `scratchpad/agents/qdc-governor-s5/raw/sa803609/*_logcat_all.txt`
and `scratchpad/agents/*/REPORT.md` quoted blocks.

---

## SECTION 3 — Zero-copy / host-pinned / shared-weights / RSS-on-GPU: the prior work

This is the mission core. **The question was already asked on 2026-08-09 (K4) and again on
2026-09-21 (docs archive). The answer both times: there is no zero-copy path in the shipped
llama.cpp OpenCL backend, and none of it was ever device-probed on the Adreno 740.**

### 3.1 The K4 answer — 2026-08-09, code-reading only, verdict GIALLO

Source: `reports/research-adreno-opencl.md` (Italian body; date `:3`). Mandate question at
`archived/mandates/research-adreno-opencl.md:39-42`. **MEASURED (code reading) / ESTIMATE (RAM).**

- Weight allocation is `clCreateBuffer(context, CL_MEM_READ_WRITE, size, NULL, …)` — a standard
  **device buffer**. No `CL_MEM_ALLOC_HOST_PTR` / `CL_MEM_USE_HOST_PTR` in the main path.
  `reports/research-adreno-opencl.md:146`.
- Upload is `clEnqueueWriteBuffer(...)` in `ggml_backend_opencl_buffer_set_tensor` — an explicit
  host→device copy. Same file, `:147`.
- SVM is **queried and logged** (`CL_DEVICE_SVM_*`: coarse/fine/system/atomics) but weights are
  not mapped zero-copy through it in the `set_tensor` path. `:148`.
- Qualcomm's shipping Adreno features (image-backed weights, large buffer, xmem GEMM prepack)
  are **layout/copy optimisations, not elimination of GPU residency**. `:149`.
- `cl_qcom_ext_host_ptr` / ION / dmabuf for llama.cpp weights: **NOT FOUND** in the backend.
  `:151, :153`.
- RAM verdict, on the 8 GB S23 (process already ~3.9 GiB resident, ~1.75 GiB dense to offload):
  dense-only-on-OpenCL with the host mapping dropped ≈ +1.75 GiB net ~0; **dense on GPU *and*
  still pinned/mmap on host = +1.75–2.0 GiB double residency = "OOM death" on 8 GB with an
  expert cache**. Staging + image SoA views add tens-to-hundreds of MB at load.
  `:155-168`.
- **Conclusion, verbatim sense (`:168-170`):** "it is not magic zero-copy. It is UMA with a load
  copy and a device buffer". Moving 1.5–2 GiB of dense to GPU is feasible **only if** the
  corresponding host residency is released and the expert cache is kept tight. Verdict
  **GIALLO**. Recommendation was **NO-GO** on the full fork+OpenCL+stream integration spike,
  replaced by a 1–3 day kill sequence S1–S4 (`:339-381`).

**Critical caveat, stated by the 2026-09-21 cell (`archive-gpu-docs/REPORT.md:686-691`):** the K4
answer is a code reading of the shipped backend. It answers *what the backend does*, not *what
the driver could do if we wrote the path*. Keep those claims separate.

### 3.2 No document in the corpus ever proposed host-pinned shared weights

`archive-gpu-docs/REPORT.md:587-595` — **MEASURED (document search):** no document in scope
proposes a host-pinned / `CL_MEM_ALLOC_HOST_PTR` weight buffer, a **shared-weights buffer between
two contexts**, or a reload-on-flip budget as a product feature. `CL_MEM_ALLOC_HOST_PTR` appears
once, as the K4 *question*, and is answered no. "zero-copy" appears in the plan history once, in
an `AHardwareBuffer` note (`archived/PLAN-archive.md:4436`, CLAIM-UNVERIFIED / plan-only).

This mission's premise is therefore **new work on top of a closed question** — which is exactly
why the mission says "we must not redo work already done".

### 3.3 The entire host-memory story in the OpenCL backend is ONE upstream commit (not ours)

Source: `scratchpad/agents/archive-gpu-repo-history/REPORT.md` SECTION 3, from `git log --all -S`
across 16,230 commits of `~/Projects/kalsallama`. Date of the cell: 2026-09-21.

| needle | commits found |
|---|---|
| `CL_MEM_ALLOC_HOST_PTR` | **2**, both in `ggml-opencl`: `8a56aedd6`, `60081bb2b` (`:223`) |
| `CL_MEM_USE_HOST_PTR` | **1** in `ggml-opencl`: `8a56aedd6` (`:223`) |
| `pinned` / `host-pinned` | CUDA/SYCL commits only — **none in `ggml-opencl`** (`:225`) |
| `shared weight` | **none anywhere** (`:227`) |

**The retry commit, in full (`archive-gpu-repo-history/REPORT.md:275-356`):**
`8a56aedd6143a014e25ec9f4295164f2f66ce30f`, **2026-09-11 22:11:12 -0700**, author
**`Hongqiang Wang <wangh@qti.qualcomm.com>`** — a Qualcomm engineer, **upstream** commit
(`git merge-base --is-ancestor 8a56aedd6 upstream/master` succeeds), subject
`opencl: fix several bugs where the backend aborts (#27630)`, **in all four pins**. It is the
first commit in the tree to introduce any host-pinned allocation.

Its added comment (`ggml-opencl.cpp:10604-10618` at HEAD) is the origin of every zero-copy claim
we hold, and it is about a **laptop part, not our phone** (`:318-352`):

```
// Allocate a temporary upload buffer of `nbytes` and populate it with `data`
// from host. On Adreno X1-85 the device-only pool intermittently fails to
// allocate at hundreds of MB once model weights fragment the heap (observed
// on Qwen3.5-9B output.weight Q6_K at 834 MB). Three-step retry:
//   1. CL_MEM_READ_WRITE alloc + clEnqueueWriteBuffer (normal fast path).
//   2. clFinish + retry (drains in-flight allocs that may be holding heap;
//      mirrors the proven pattern at the FD-split partial buffer alloc).
//   3. CL_MEM_ALLOC_HOST_PTR + map(WRITE_INVALIDATE) + memcpy + unmap -
//      different memory pool (host-pinned); true zero-copy on Adreno per
//      QCOM guidance. (CL_MEM_USE_HOST_PTR is NOT zero-copy on Adreno: the
//      driver triggers an internal copy because arbitrary host pages aren't
//      guaranteed mappable/coherent, AND it draws from the same exhausted
//      device pool - so it doesn't solve the problem.)
// Returns the ready-to-read buffer (caller must clReleaseMemObject) or NULL
// if all three strategies fail. The buffer is opaque to the caller - it can
// be passed as a kernel argument like any normal cl_mem.
```

Four things to take from it, all **MEASURED (code, not device)**:

1. **The X1-85 fragmentation observation is the only fragmentation datum in the repo**, and it
   is about `ADRENO_GPU_GEN::X1E` (Snapdragon X Elite), **not** `A7X`/740. Tensor: `Qwen3.5-9B
   output.weight Q6_K at 834 MB`.
2. The mechanism is a **last-resort fallback to avoid an abort**, not a performance path. The
   author's own message says the host-pinned pool means **degraded runtime perf**; it exists to
   avoid a *failure*, and the `"true zero-copy, therefore fast"` reading is a misreading
   (`archive-gpu-repo-history/REPORT.md:352-358`).
3. The `"true zero-copy on Adreno per QCOM guidance"` claim has **no URL, no citation**
   (`:304`) — and the companion claim `"CL_MEM_USE_HOST_PTR is NOT zero-copy on Adreno"` is
   likewise unsourced (`:311`).
4. The same three-step retry is **already in our shipped buffer type**: 4th fallback
   `CL_MEM_READ_WRITE | CL_MEM_ALLOC_HOST_PTR` at `ggml-opencl.cpp:14018` / `:14262`
   (`archive-gpu-repo-history/REPORT.md:705`, [F]); the temp-buffer helpers are
   `ggml_cl_create_temp_upload_buffer` `:10620-10663` (10 call sites) and
   `ggml_cl_create_temp_download_buffer` `:10668-10691`... (`:706-707`, [G]/[H]).

**Attach points for a host-pinned/shared-weights design, with exact `file:line`** are tabulated
at `archive-gpu-repo-history/REPORT.md:693-712` (rows A–M). The two that matter most:

- **[A]** `ggml_backend_opencl_device_buffer_from_ptr` (`:14177-14183`) is a **pure stub** —
  `GGML_UNUSED` on all four args, `return nullptr;`. This is the function the ggml device
  interface calls to wrap an existing host pointer as a backend buffer; implementing it is the
  most direct route to shared weights.
- **[D]/[E]** `/* .get_host_buffer_type = */ NULL` (`:14213`) and `iface.is_host = NULL`
  (`:14096`) — never implemented. `ggml_backend_buffer_is_host()`
  (`ggml/src/ggml-backend.cpp:183-184`) is what the scheduler branches on; a host-pinned
  OpenCL buft without `is_host` set will **not** be treated as host memory.

The cell's own reading of the tension is worth quoting (`:715-720`): a design would use
`CL_MEM_ALLOC_HOST_PTR` (a driver-owned host-pinned pool) rather than `CL_MEM_USE_HOST_PTR`
(importing arbitrary pages) — "which is precisely what the existing fallback already does, only
for a private copy rather than a shared one."

### 3.4 Allocation-failure semantics on the Adreno path (code analysis, NO device run)

Source: `scratchpad/agents/gpufit-drop-memory-gate/REPORT.md` (223 lines). **MEASURED (code) /
NOT VERIFIED on device** — the cell states explicitly "No device run was made" (`:96`).

- Mid-load OpenCL allocation failure: the OpenCL buffer type returns `nullptr` at
  `ggml/src/ggml-opencl/ggml-opencl.cpp:14033` — **no abort**; the allocator logs
  `"failed to allocate … buffer of size …"` and returns false (`ggml-alloc.c:1133-1137`).
  `gpufit-drop-memory-gate/REPORT.md:53-54`.
- The three real retries inside the buffer type are: `clFinish`+retry (`:14003`),
  `cl_qcom_large_buffer` (`:14013`), `CL_MEM_ALLOC_HOST_PTR` (`:14020`). The last is the
  **host-pinned pool**, reached only when the device pool is exhausted.
- **The one path that can `abort()`** is the **per-tensor weight-upload staging buffer** in the
  SoA conversion (`ggml-opencl.cpp:10620-10660`), because `set_tensor` branches allocate with raw
  `clCreateBuffer` / `clCreateSubBuffer` / `clCreateImage` under `CL_CHECK`
  (`:10700-10703` Q1_0, `:12475-12476` Q2_K, per `REPORT.md:61-68, :77`).
- Also flagged, **NOT VERIFIED** (`:221-223`): the unchecked `ggml_gallocr_reserve_n` at
  `ggml/src/ggml-backend.cpp:1633` plus the re-call at `:1634` can turn a failed *late*
  compute-buffer reallocation into a NULL-vbuffer dereference.

**Why this matters for zero-copy:** the fallback chain proves the driver pool *is* expected to
fail under fragmentation, and the pre-existing answer is "copy into a host-pinned pool", not
"map the GGUF".

### 3.5 The only MEASURED RSS-under-GPU-numbers on our phones: cell q44

Source: `scratchpad/agents/q44-ngl-sweep-mem/REPORT.md` (227 lines), raw
`results/ngl_sweep_s23/`. Device **S23 / Adreno 740**, unplugged, `adb shell` (never Termux),
model LFM2.5-8B-A1B-KEXP (3326160384 B), flags `-nr -fa off -t 4 -p 512 -n 128 -r 1 -o jsonl`,
env `GGML_OPENCL_LOG_ALLOC=1`, 1 Hz sampler on the llama-bench pid, N=25 layers.
**MEASURED** (speed marked exploratory by the cell).

| ngl req | offloaded | pp512 t/s | tg128 t/s | MApre | MAmin | peak RssAnon kB | peak RssFile kB | peak VmSwap kB |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0/25 | 24.961 | 13.290 | 3276416 | 3240032 | 82608 | 3220144 | 47844 |
| 7 | 7/25 | 20.067 | 7.985 | 4170764 | 2363496 | 113140 | 2599696 | 83756 |
| 13 | 13/25 | 21.203 | 6.247 | 4326084 | 1665804 | 85592 | 3141788 | 75420 |
| 19 | 19/25 | 40.493 | 11.635 | 4258468 | 883008 | 81120 | 3053792 | 96424 |
| 99 | 25/25 | 68.512 | 13.218 | 4035088 | 608732 | 78172 | 2733868 | 73180 |

(Table reproduced from `q44-ngl-sweep-mem/REPORT.md:22-29`; MemAvailable in kB.)

The three facts this cell establishes and that no other cell in the lab has:

1. **GPU weight copies do NOT appear in process RSS.** "RssAnon stays ~80–110 MiB at every
   point: GPU weight copies are **not** in RssAnon." (`:89-90`; the five sampled values are
   82608 / 113140 / 85592 / 81120 / 78172 kB, i.e. **76.3–110.5 MiB**). Consequence: any future
   shared-weights accounting that reads `/proc/<pid>/smaps` will **miss the entire GPU
   residency**. The metric the cell says to use is `MemAvailable`.
2. **The cost is affine, not multiplicative.** Excess `ΔMA − set_tensor_bytes` per GPU point was
   `750.0 / 787.0 / 694.1 / 166.3 MiB` (ngl 7/13/19/99). The first three sit within ±47 MiB of
   the **~754 MiB OpenCL preallocation that exists even at ngl 0** (`:66-84, :93`). The cell's
   candidate estimator: **`cost ≈ 800 MiB + 1.05 × offloaded_bytes`**, and it over-predicts
   (safe direction) on all five points. The same constant is the app's
   `gpuReserveMiB = 800 + 1.05 × offloadedBytes`.
3. **Allocation churn is ~4× the live bytes.** `OPENCL_ALLOC sum_mib` at ngl99 = **13432.17 MiB
   created** against **3179.8 MiB** of `OPENCL_SET_TENSOR` live tensor bytes (`:42-52`). At ngl 0
   alone the created total is 753.69 MiB. The cell notes the created total double-counts `try.*`
   staging and is therefore "created, not live" (`:51`). **This is the closest thing in the lab
   to a fragmentation datum on the 740** — the pool sees ~4× the tensor bytes flow through it.

**A hard instrument limit, recorded honestly (`:93`, anomaly 3):**
`ls /sys/class/kgsl/kgsl-3d0/proc/<pid>/ → No such file or directory` on **every** point, so the
sampler's `gpumem` column is `NA`. **We cannot read the Adreno driver pool per process on this
phone.** That is a standing gap for any zero-copy accounting.

### 3.6 The 8 GB wall that a shared-weights design must survive

`scratchpad/agents/oomwall/REPORT.md`, 2026-08-20/21, S23 Adreno 740, logs `results/oomwall_s23/`.
**MEASURED / FAILED-RUN** (device power-off + auto-reboot).

- The wall is **llama-bench's default ARM `CPU_REPACK`** (`use_extra_bufts=true`), not the GPU:
  W1 `-ngl 2 -ncmoe 99` stock → **POWER OFF**, MemAvailable cliff **5.01 → 0.45 GB in 13 s**,
  `weights_pool` 189.46 MiB OK, **zero SET_TENSOR**. **GPU is innocent.**
- W4 `-ngl 0` (no GPU at all) stock extra_bufts → power-off/auto-reboot. W4c same config with
  `use_extra_bufts=false` → **LOAD LIVES**, floor 3895 MiB, no 4 GB cliff. Single-variable pair.
- Production is structurally immune: `session.cpp` hard-sets `use_extra_bufts=false`.
- Corroborating budget datum (`q44-ngl-sweep-mem/REPORT.md`, Phase 2): the Q8_0-trunk HTP split
  that "OOMed the S23 8 GB phone" needed CPU 5995.65 + CPU_REPACK 157.65 + HTP 28.25 +
  HTP-REPACK 178.50 MiB ≈ 6360 MiB of model buffers, and the process vanished mid-load with no
  stderr footer (SIGKILL/LMK, not a clean rc≠0).

### 3.7 What this section means for the decision

- No cell has ever allocated a `CL_MEM_ALLOC_HOST_PTR` weights buffer on the Adreno 740, and no
  cell has ever mapped a GGUF page into an OpenCL buffer.
- The one unsourced claim that would justify the path (`CL_MEM_USE_HOST_PTR` is not zero-copy on
  Adreno; `CL_MEM_ALLOC_HOST_PTR` is) was written by a Qualcomm engineer about the **X1-85**, and
  has never been tested in any commit in either repo
  (`archive-gpu-repo-history/REPORT.md:726-741`, its unknowns 1–4).
- The S23's per-allocation cap is **884 MB** (Section 2.4) and RSS does not see GPU residency
  (Section 3.5), so the only way to answer "what does a host-pinned dense buffer cost on this
  phone" is a device probe that measures `MemAvailable` and total pool behaviour — exactly the
  instrument `q44` already built (`GGML_OPENCL_LOG_ALLOC=1` + 1 Hz `MemAvailable` sampler).

**INDEX for Section 3:**
- K4 answer (code reading, 2026-08-09): `reports/research-adreno-opencl.md:140-170, :289`; mandate `archived/mandates/research-adreno-opencl.md:39-42`
- Docs-side sweep + its 13 unknowns: `scratchpad/agents/archive-gpu-docs/REPORT.md:56-71, :489-533, :587-595, :686-710, :750-767`
- Git-history sweep + attach-point table: `scratchpad/agents/archive-gpu-repo-history/REPORT.md:213-230, :275-360, :693-745`
- Allocation-failure semantics (code only): `scratchpad/agents/gpufit-drop-memory-gate/REPORT.md:31-96, :206-223`
- RSS-under-GPU numbers (S23/740): `scratchpad/agents/q44-ngl-sweep-mem/REPORT.md:1-100`; raw `results/ngl_sweep_s23/`
- 8 GB REPACK wall: `scratchpad/agents/oomwall/REPORT.md:1-80`; raw `results/oomwall_s23/`

---

## SECTION 4 — GPU/OpenCL performance measurements per Adreno tier

Every row below names the device, the workload, the number, and the source. `ngl` = GPU layers,
`-fa off` unless stated. **MEASURED** unless marked otherwise. Units are tokens/s unless stated.

### 4.1 The one-day cross-tier map (all 2026-09-03, QDC, one kit `5c3979438`, one model LFM2.5-2.6B)

| tier (QDC job / host) | workload | pp512 | tg128 | correctness | source |
|---|---|---:|---:|---|---|
| **Adreno 732** (7+ Gen 3, job 797795 sa801864) | QAD-Q4_0, `-ngl 99 -fa 0 -t 4` taskset f0, r=3 | **151.78 ± 1.12** | **17.26 ± 0.02** | MM 925/925, MMID 407/407; **FA does not compile** | `qdc-7pg3-govbench-52/REPORT.md:44-55`; raw `raw/bench_gpu_sa801864.out` |
| **Adreno 735** (8s Gen 3, job 797956 sa802025) | QAD-Q4_0, same flags | **154.82 ± 1.34** | **16.49 ± 0.01** | MM 925/925, MMID 407/407 (20-FAIL family does NOT reproduce) | `qdc-8s3-govbench-56/REPORT.md:22-42` |
| **Adreno 740** (HDK8550, job 797850 sa801919) | **Q4_K_M**, `-ngl 99 -fa 0 -t 4` taskset f0, r=3, ABBA | base **84.09** / picks **84.64** (Δ +0.65%) | base **16.04** / picks **16.02** (Δ −0.12%) | MM 925/925, MMID 407/407, **FA 229/229 PASS** | `qdc-8g2-oclpicks-53/REPORT.md:1-45`; raw `raw/bench_{base,picks}_{1,2}_sa801919.out` |
| **Adreno 750** (QRD8650, job 797935 sa802004) | QAD-Q4_0, same flags | **284.18** | **23.42** | MM **905/925 (20 FAIL**, f16/bf16 batched view-K); MMID 407/407 | `qdc-8g3-govbench-55/REPORT.md:22-46, :71-73` |
| **Adreno 750** re-run (job 798429 sa802498) | QAD-Q4_0, same flags | **291.11 ± 0.56** (+2.4%) | **23.02 ± 0.04** (−1.7%) | 20-FAIL family reproduced, `diff` of failing-case lines vs #55 = **IDENTICAL** | `qdc-8g3-rerun-58/REPORT.md:20-40` |
| **Adreno 750** tuned CPU comparator | QAD-Q4_0, `-t 4`, `GGML_OPENCL=OFF`, armv8.7-a+dotprod+i8mm+fp16 | CPU pp512 **98.97 ± 12.78** | CPU tg128 **28.58 ± 0.32** | — | `qdc-cpu-tuned-57/REPORT.md:26-33` |
| **Adreno 830** (8 Elite, jobs 792778/792790) | KEXP 17.25B Q4_K_M, `-p 512 -n 128 -r 3`, ABBA (A GPU / C CPU) | A **274.24 ± 0.72** / **274.83 ± 0.45**; C 107.84 / 107.00 → **GPU 2.56×** | A **48.83 ± 0.23** / **48.88 ± 0.04**; C **61.16 / 60.26** → **decode CPU wins** | correctness from cell #39 (q2/q3 MoE PASS) | `qdc-8elite-speed-kexp/REPORT.md:32-45`; raw `raw/bench_*_792790.out` |

**Same-tier spread to respect:** the 740's own QDC number (84 pp512) is on **Q4_K_M**, the other
tiers on **Q4_0**; cell #55/#56 both print the caveat "740 numbers are Q4_K_M … NOT comparable to
the Q4_0 rows; the 740 ship-config numbers live in the S23 campaigns"
(`qdc-8s3-govbench-56/REPORT.md:44-46`, `qdc-8g3-govbench-55/REPORT.md:71-73`).

### 4.2 Galaxy S23 / Adreno 740 (our phone) — dense model

| date | model / workload | GPU | CPU | ratio | source |
|---|---|---:|---:|---|---|
| 2026-08-12 | Qwen3.5-2B Q4_K_M, `-t 4 -p 128 -n 256 -r 2`, unplugged | pp 128 **82.26** / tg 256 **5.06** | pp 128 **63.62** / tg 256 **12.37** | prefill **1.29×**, decode **0.41×** | `reports/moe-gdn-k22-fix.md:157-175`; raw `results/gdn_gpu_k2/s23/logs/` |
| 2026-08-12, sustained 15 min/arm, unplugged | Qwen3.5-2B Q4_K_M, `-t 4`, long generation segments | seg 8.2 / 8.2 → **0% degradation**, plateau 38.5 °C | 12.2 → 10.9 → 10.2 → **−16%**, 42.3 °C still rising | final-third CPU 10.2 vs GPU 8.2; energy proxy CPU ~0.61%, GPU ~0.79% batt%/1k tok | `reports/moe-gpu-sustained.md:137-155`; raw `results/gpu_sustained/` |
| 2026-08-13, same harness | Qwen3.5-4B | 4.2 → **4.0** (−5%), 40.9 °C | 5.8 → **5.0** (−14%), 42.4 °C | GPU **0.80×** sustained at both 2B and 4B | `reports/moe-gpu-sustained.md:162-175`; raw `results/gpu_sustained_4b/` |
| 2026-08-11/12, LiteRT/ML Drift (foreign stack, NOT llama) | Gemma-4-E2B, UI wall-timed | **~26.8 tok/s (ESTIMATE)** | 9.70 tok/s (Llama-3.2-3B) | **~2.76× est.** | `reports/moe-litert-f0-f1.md:73-97` |

### 4.3 Galaxy S23 / Adreno 740 (our phone) — MoE experts-on-GPU (the one place GPU wins on this phone)

Model OLMoE-1B-7B Q4_K_M, ngl=16, `-fa off`, unplugged, ABBA. Cell `results/olmoe_gpu_moe_s23/`;
internal name W5. **Exploratory** in its own words (`RESULT.md:1-3`).

| measurement | GPU experts (A) | CPU experts (B) | ratio | source |
|---|---:|---:|---|---|
| ngl probe 4→8→12→16, tg16 | 13.86 / 17.51 / 22.42 / **27.30** | — | all rc=0, no 4 GB cliff | `results/olmoe_gpu_moe_s23/RESULT.md:12-19` |
| burst pp128+tg128, ABBA×2, n=4 (A8 tg dropped for Dozing) | pp **63.09**, tg **27.50** | pp **40.91**, tg **12.69** | prefill **1.54×**, decode **2.17×** | `RESULT.md:21-42` |
| sustained 4×tg512/arm | **15.28** (38–39 °C) | **10.26** (→40.2 °C) | **~1.49×** | `RESULT.md:44-53` |
| pre-registered confirmatory, N=5 ABBA, median tg512 | **16.356** | **10.530** | **1.553×** (gate ≥1.30) — verdict **SHIP** | `scratchpad/agents/n10-kexp-session/REPORT.md:14-40`; raw `results/olmoe_gpu_moe_s23/n10/runs.csv` |

**The counter-result that retires "GPU default":** same device, full-offload vs all-CPU on the
same models — KEXP A(GPU) 14.252 vs C(CPU) **17.553**; OLMoE A(GPU) 20.034 vs C(CPU) **27.685**.
Pure CPU wins by 19–28% in every cell of every block; hybrid (trunk GPU / experts CPU) is the
worst arm. `scratchpad/QDC-GPU-GOVERNOR-MAP-2026-09-16.md:97-117` citing `docs/ALIVE.md:86-117`.
**MEASURED** and preregistered.

### 4.4 Xiaomi 14 / Adreno 750 (our phone) — dense model, the strongest GPU-prefill case we own

Qwen3.5-2B Q4_K_M, `-t 6 -r 2`, **unplugged whole window** (batt 69→37%, 31.6→42.8→37.8 °C),
cold `fadvise` between cells. Source `results/gpu_prefill_recheck_xiaomi/report.md` (2026-08-18).

| pp | CPU t/s | GPU t/s | GPU/CPU |
|---:|---:|---:|---:|
| 128 | 31.459 | 181.652 | 5.77× (the book number) |
| 512 | 35.937 | 214.485 | 5.97× |
| 1024 | 38.449 | 216.292 | 5.63× |
| 2048 | 51.103 | 211.613 | 4.14× |

**The same cell RETRACTS the 5.77× as a headline** (`report.md:15-40`): interleaved r=1×5,
all 10 interleaved CPU mean **58.676** (range 57.187–62.239, none near 31.46), all 10 GPU mean
**186.567** → **3.18×**. Order-A 3.10×, order-B 3.27×. "The GPU number is real. The 5.77× is
not." Decode pair: GPU 17.46 / CPU 26.50 = **0.66×** (`report.md:42-53`). The 750's 181.65 pp128
book value also lives in `reports/moe-gdn-750.md:196-202` with `tg 7.07` and the 0.44× verdict.

The 750's 4B extension (`results/xiaomi_ab/curve_table.md`): 4B GPU **85.4 (pp512) / 86.2
(pp2048)** vs CPU 18.4 / 11.9 → 4.64× / 7.25×, **with the caveat that the ratio grows because
CPU falls (RSS ~11 GiB / 11.4 GiB), not because the GPU scales**.

### 4.5 Adreno 830 (QDC 8 Elite, SM8750, Android 16) — governor cells

| cell | workload | result | source |
|---|---|---|---|
| 8B MoE governor (LFM2.5-8B-A1B Q4_K_M, job 793164, unit `b4bd0901`) | 3 turns × 512 prompt + 128 gen, r=3 | A(GPU) ttft **2517.7 / 2518.8 ms**, decode **28.20 / 28.37**; C(CPU) ttft **25122.6 / 26134.1 ms**, decode **13.95 / 13.46**; G(gov, GPU prefill + CPU decode) ttft 2495.8 / 2496.1, decode 13.32 / 13.33 | `qdc-8elite-governor-8b/REPORT.md:30-60` |
| cross-backend governor, ship 2.6B QAD-Q4_0, `-t 8`, r=3 (job 788862) | 3 turns × (512+128) greedy seed 1234 | A(GPU) ttft 1396.5/1394.3, decode 23.72/23.85; C(CPU) ttft 16476.2/14412.2, decode 21.59/23.25; **G ttft 1434.3/1469.8, decode 25.28/24.22, commit 25.76/29.07 ms** | `qdc-8elite-governor-crossbackend/REPORT.md:12-35` |

**Caveat on 4.5 row 1 that the report itself prints:** "`n_threads=1` as printed by the binary —
identical method to cell #38" (`qdc-8elite-governor-8b/REPORT.md:29-31`). The 13.5 t/s CPU arm is
a **single-thread** CPU number, so the 28.2-vs-13.9 decode comparison is not a tuned-CPU
comparison. **MEASURED but not comparable** to the tuned-CPU numbers of Section 4.1.

### 4.6 Tiers with no tok/s at all

- **Adreno 732 / 735**: `qdc-7pg3-govbench-52` and `qdc-8s3-govbench-56` did measure (Section 4.1,
  151.78/154.82 pp512). What is missing is any *product-size* or *sustained* run on those tiers.
- **Mali-G57 MC2 (Jelly Star, our phone)**: **no `llama-bench` number exists.** The quantised
  path aborts (`archive-gpu-docs/REPORT.md` unknown 9; `analysis/GOVERNOR-DEVICE-PLAN.md:516`),
  Vulkan dies on first buffer alloc (`q26-mali-gate/REPORT.md:11`). **NOT MEASURED.**
- **Adreno 840**: never held. Web figures only (`reports/research-adreno750.md:107-118`).

### 4.7 Correctness findings that constrain every performance row above

- **740**: four separately reproduced compiler-failure sites/workarounds (`k2-fix/REPORT.md:20,
  :451`); q4_K/q5_K MoE `MUL_MAT_ID` 0/80 + 0/4 → 80/80 + 4/4 after the mask-as-argument change;
  MUL_MAT_ID 391/391.
- **750**: 20 deterministic FAILs in the f16/bf16 batched view-K `MUL_MAT` family, reproduced in
  **three independent runs** (#16 physical Xiaomi, #55, #58) — `qdc-8g3-rerun-58/REPORT.md:44-48`.
  The fix `2f3b24dee` takes 905/20-FAIL → **925/0** (`qdc-750-mulmat-view/REPORT.md`, per
  `commit-map-engine/REPORT.md:376`).
- **750 in-app divergence**: GPU-prefilled governor turns B1/B2 diverge from CPU at token 14;
  confined to the 750 across three 750 boards vs one 830 board
  (`qdc-governor-s5/REPORT.md:208-231`; raw `qdc-governor-s5/raw/sa803609/*_logcat_all.txt`).
- **830**: q2_K/q3_K MoE kernels correct on the third GPU/compiler generation — MUL_MAT 925/925
  executed + 545 capability skips, MUL_MAT_ID 407/407 + 405 skips, 0 FAIL
  (`archived/ALIVE-2026-09-full.md:459`).

**INDEX for Section 4:**
- QDC 2026-09-03 campaign: `scratchpad/agents/qdc-{7pg3-govbench-52,8s3-govbench-56,8g2-oclpicks-53,8g3-govbench-55,8g3-rerun-58,cpu-tuned-57}/` (each with `raw/`)
- S23 dense + sustained: `reports/moe-gdn-k22-fix.md`, `reports/moe-gpu-sustained.md`, raw `results/gdn_gpu_k2/s23/`, `results/gpu_sustained/`, `results/gpu_sustained_4b/`
- S23 MoE experts-on-GPU: `results/olmoe_gpu_moe_s23/{RESULT.md,runs.csv,n10/runs.csv,ab_*.stdout.txt,sus_*.stdout.txt}`, `scratchpad/agents/n10-kexp-session/REPORT.md`
- Xiaomi 750 prefill: `results/gpu_prefill_recheck_xiaomi/{report.md,cells/}`, `results/xiaomi_ab/curve_table.md`, `reports/moe-gdn-750.md`
- 830: `scratchpad/agents/qdc-8elite-speed-kexp/`, `qdc-8elite-governor-8b/`, `qdc-8elite-governor-crossbackend/`
- Cross-cutting: `scratchpad/QDC-GPU-GOVERNOR-MAP-2026-09-16.md:34-152`

---

## SECTION 5 — Phone-side `test-backend-ops` / `llama-bench` / `llama-cli`: the reusable recipe

**Answer to hunt item 5: yes — all three tools have run on phones, many times, on the S23 (740),
the Xiaomi 14 (750), the Jelly Star (Mali) and every QDC board. Nothing here is new ground.**
The accumulated operational knowledge is below.

### 5.1 Which binary is the instrument: the `.so`, not the exe

From `scratchpad/agents/oracle-consumer/REPORT.md:120-134` — **MEASURED, load-bearing:**

> "**The oracle is in `libggml-opencl.so`.** `test-backend-ops` is a dynamically linked stub; its
> sha did not change across the last rebuilds of the `.so`. Do not cite the exe sha as proof of
> which oracle ran."

Same pattern in the bench harness: `/data/local/tmp/s3oracle` holds a **stub
`libllama-bench.so`** (`b2ae0fa6…`) plus a swappable **`libllama-bench-impl.so`**
(`8adc148c…` for the #18 bin, `d2030f23…` for the noextra bin). Cells re-pin the impl sha per
run and never rebuild (`kexp-n5-session/REPORT.md:5`, `q44-ngl-sweep-mem/REPORT.md:11-19`).
**Consequence for us: pin and verify `libggml-opencl.so`, `libllama-bench-impl.so`, the stub and
the GGUF by sha on device, not the launcher.**

### 5.2 The S23 (Adreno 740) device-run recipe, verbatim-usable

`oracle-consumer/REPORT.md:150-200`. Host build:
`build-android-opencl-s3oracle/`, Ninja + **NDK 27.1.12297006**, `ANDROID_ABI=arm64-v8a`,
`ANDROID_PLATFORM=android-29`, `ANDROID_STL=c++_shared`, Release, `GGML_OPENCL=ON`,
`GGML_OPENCL_EMBED_KERNELS=ON`, `GGML_OPENCL_USE_ADRENO_KERNELS=ON`, `GGML_NATIVE=OFF`,
`GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16`, `LLAMA_BUILD_TESTS=ON`, OpenCL headers from
`deps/opencl-android/`.

Push set (target `/data/local/tmp/s3oracle`) — **all of these, or the loader fails**:
`test-backend-ops`, `libggml-opencl.so`, `libggml.so`, `libggml-base.so`, `libggml-cpu.so`,
`libllama.so`, `libllama-common.so`, NDK `libc++_shared.so` (`e69496a4…`), NDK `libomp.so`
(`ea27efff…`). Then:

```sh
cd /data/local/tmp/s3oracle && sha256sum <all nine files>   # verify on device, do not trust the push
chmod +x test-backend-ops
LD_LIBRARY_PATH=/data/local/tmp/s3oracle ./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID -p 'type_a=q4_0'
```

**`LD_LIBRARY_PATH` is mandatory and its absence is a documented failure mode:**
`q66-app-lifecycle-s23/PHASE3_STATUS.md:531` — "the wrapper set `LD_LIBRARY_PATH` to the run
**after the loader-only first attempt**". QDC kits export `LD_LIBRARY_PATH=<kit dir>` and
**only** the kit dir (`qdc-8elite-governor-8b/REPORT.md:31`, `PREREG.md:40`).

### 5.3 `libOpenCL.so` — the single most likely way to waste a session

`oracle-consumer/REPORT.md:196`, emphatic: **"`libOpenCL.so` is the device ICD; do not push the
Windows-built `deps/opencl-android/icd-build-android/libOpenCL.so`."**

- The binding links a **link-only stub** at `bin/arm64-v8a/libOpenCL.so` (308544 bytes), built by
  `scripts/build-opencl.sh` from the vendored `vendor/OpenCL-ICD-Loader` at
  `ANDROID_PLATFORM=android-21` / NDK 27.3.13750724; its own header says
  *"the result is only used as a link stub"*. The real driver resolves on-device
  (`archive-gpu-repo-history/REPORT.md:511-530`).
- On-device the real ICD is `/vendor/lib64/libOpenCL.so` — confirmed present on the S23
  (`S23` campaigns) and on the QRD7675 (`qdc-7pg3-govbench-52/raw/recon_sa801864.txt`,
  `OPENCL_LIB_PRESENT`).
- `libggml-opencl.so` NEEDED list includes `libOpenCL.so` (device vendor) + `libc++_shared.so`
  (`oracle-consumer/REPORT.md:140`).

### 5.4 `test-backend-ops` on a phone: the flags, and two traps

Confirmed on-phone runs and their invocations:

| device | invocation | result | source |
|---|---|---|---|
| S23 / 740 | `./test-backend-ops -o MUL_MAT_ID` | see `k2-fix/REPORT.md:254` onward (0/80 → 80/80 workaround) | `scratchpad/agents/k2-fix/REPORT.md:254, :441` |
| S23 / 740 | full-suite `mmid` + `dense` | 407/407, 925/925 | `results/barrier_verify_s23/{mmid,dense}.err` |
| S23 / 740 | `-o PAD` | rc=0 PASS, isolates PAD | `k2-fix/REPORT.md:441` |
| Xiaomi 14 / 750 | `test-backend-ops -o MUL_MAT`, `-o MUL_MAT_ID` | 905/925 (20 FAIL), 407/407 rc=0 wall 277 s | `q16-xiaomi/REPORT.md:34-81, :260-268` |
| QDC all tiers | kit `test-backend-ops` `-o MUL_MAT`, `-o MUL_MAT_ID`, `-o FLASH_ATTN_EXT` | 925/925, 407/407, 229/229 (740); 905/20-FAIL (750) | `qdc-8g2-oclpicks-53/REPORT.md:28-42`, `qdc-7pg3-govbench-52/REPORT.md:20-46` |

**Trap 1 — the backend filter name.** `qdc-8elite-opencl-e031/REPORT.md:58-63`: the first runs
used `-b OpenCL`; "the backend registers as **`GPUOpenCL`**, so the filter" matched nothing and
the run reported OK with **zero cases executed**. The cell calls it a **VACUOUS SKIP** and keeps
it in `raw/` as a negative exhibit. The human-readable summary line prints `Backend OpenCL: OK`
(`q16-xiaomi/REPORT.md:262`), which makes the empty run look plausible. **Always confirm the
case count, not the OK.**

**Trap 2 — the build.** A full `ninja -C build-android-opencl-s3oracle` **FAILED** at
`[50/237] tests/test-chat.cpp: #include "mtmd.h" not found`; the targeted
`ninja test-backend-ops llama-bench` **succeeded** `[7/7]` after the OpenCL re-link
(`q16-xiaomi/REPORT.md:24`). Build only the two targets you need.

### 5.5 `llama-bench` on a phone: the flags actually used

| context | command | source |
|---|---|---|
| q44 memory sweep (S23/740) | `-nr -fa off -t 4 -p 512 -n 128 -r 1 -o jsonl`, env `GGML_OPENCL_LOG_ALLOC=1`, `-v` when ngl>0 | `q44-ngl-sweep-mem/REPORT.md:11-20` |
| kexp N5 arms (S23/740) | A `-ngl 99`, B `-ngl 99 -ncmoe 99`, C `-ngl 0`; all `-nr -fa off -t 4`; tg512 `-p 0 -n 512 -r 1 -o jsonl` | `kexp-n5-session/REPORT.md:5` |
| QDC tier benches | `-ngl 99 -fa 0 -t 4`, `taskset f0`, `-r 3`; CPU arms `-dev none -ngl 0` | `qdc-7pg3-govbench-52/REPORT.md:44-55` |
| Xiaomi 750 prefill | `-t 6 -r 2`, `-ngl 99 -fa off` vs `-ngl 0`, cold `fadvise` between cells | `results/gpu_prefill_recheck_xiaomi/report.md:1-25` |

**Trap 3 — `llama-bench` defaults to `-ngl 99`.** A "CPU bench" without explicit `-dev none` or
`-ngl 0` is a **GPU bench** (`qdc-7pg3-govbench-52/REPORT.md:96-97`, ops lesson 6).

**Trap 4 — `use_extra_bufts`.** On the 8 GB S23, stock `llama-bench` (`use_extra_bufts=true`,
ARM `CPU_REPACK`) power-cycled the phone at Mellum2 scale (`oomwall/REPORT.md:11-19`). Every
counted S23 arm in the MoE campaign uses the **noextra** impl (`d2030f23…`) precisely so the
repack never runs (`results/olmoe_gpu_moe_s23/RESULT.md:5-7`). The proven dodge patch is archived
at `results/oomwall_s23/llama-bench-noextra.diff` and is described as upstream-worthy
(`oomwall/REPORT.md:23-25`).

### 5.6 `llama-cli` on a phone: it works, but not as a load probe

`qdc-7pg3-govbench-52/REPORT.md:93-95`, ops lesson 3 — **MEASURED:**

> "**llama-cli is not a load probe**: with `-p/-n 1/-no-cnv` and stdin at `/dev/null` it looped on
> the interactive prompt and wrote **106 MB of `"> "`** (`raw/loadprobe_interactive-loop_evidence.txt`).
> **llama-bench is the probe.**"

The 40-line excerpt is the pulled evidence; the 106 MB file was device-side
(`qdc-7pg3-govbench-52/AUDIT-REPORT.md:42-46` adjudicates this exact wording). Where `llama-cli`
*was* used usefully: real TTFT with a fixed ~4.3 KB prompt, n=16, temp 0, `--no-warmup --perf`,
reading the compact `[ Prompt: X t/s | Generation: Y t/s ]` line
(`results/xiaomi_ab/curve_table.md`).

### 5.7 SELinux and privilege: what actually works

- **Working context: `adb shell`, uid=2000, `u:r:shell:s0`, under `/data/local/tmp/<dir>`.**
  Verbatim from `reports/moe-gdn-750.md:40`: "`adb shell` uid=2000 / `u:r:shell:s0` under
  `/data/local/tmp/gdn_750`. **`run-as com.termux` cannot write `/data/local/tmp` (SELinux) and
  cannot init OpenCL (S0).**" Also `q66-app-lifecycle-s23/PHASE3_STATUS.md:389-390`
  (`context=u:r:shell:s0`, `run-as: package not debuggable: com.kalsa.app`).
- **Root is not available and is not needed** for the /data/local/tmp path. `chmod 755` on the
  extracted binaries (tar extraction idempotent) is the whole ceremony —
  `qdc-7pg3-govbench-52/AUDIT-PRERUN.md:107`.
- **App-private model slots** (only needed for in-app runs) use the pattern
  mkdir → `cp` → `chown` → `restorecon -RF` **in that order**
  (`qdc-apk-smoke-61/AUDIT-PRERUN.md:190`), or `adb push` → `run-as cp`
  (`qdc-governor-s5/PREREG.md:18, :31`).
- **Energy nodes are denied to shell**: `/sys/class/power_supply/battery/{charge_counter,
  voltage_now,temp}` = **EACCES**; `dumpsys battery` "Charge counter" is the fallback, and it is
  too coarse for ~33 s runs (`q44-ngl-sweep-mem/REPORT.md`, Phase 2 energy block;
  `discharge-recon/REPORT.md:176, :466`).

### 5.8 Process and transport tricks the QDC cells banked (all still applicable)

From `qdc-7pg3-govbench-52/REPORT.md:80-104` (ops lessons 1–7) and `q44`'s harness section:

1. **Background launch over adb:** `adb shell "A && B && nohup sh -c '...' ... &"` **hangs** (the
   subshell holds the adb socket). Working form: `adb shell "nohup sh -c '...' </dev/null >/dev/null
   2>&1 & echo OK"` — nohup as the *only* backgrounded word, `cd` inside the `sh -c`.
2. **No `timeout` binary** on the QDC Android images **nor on the Mac**; the portable cap is a
   perl `alarm`+`exec` wrapper.
3. **toybox `taskset` wants bare hex** (`taskset: bad mask '0xf0'`) — no `0x` prefix.
4. **`pkill -f` self-matches its own adb shell** (exit 143); bracket the pattern (`'slee[p] 20'`).
5. **`nproc` lies** (6–8) while `Cpus_allowed_list` is `0-7`; gate on the cpuset, not `nproc`
   (`q44-ngl-sweep-mem/REPORT.md:93`, anomaly 4).
6. **CR/LF:** scripts are pushed then `tr -d '\r'`'d and the driver asserts CR=0
   (`q46-lfm-bprime-smoke/SESSION_LOG.md:48`).

### 5.9 In-app GPU probing (if the zero-copy work goes into the app, not the CLI)

Two cells already built the in-app half:

- `scratchpad/agents/governor-gpu-recon/REPORT.md` §4 is the **contract** for a real GPU probe;
  `scratchpad/agents/governor-gpu-probe/REPORT.md` implements the engine half: the bulk compile
  path no longer passes `fatal=true` (`ggml-opencl.cpp:1440` →
  `build_program_from_source_ex(..., /*fatal=*/false)`), setting
  `backend_ctx->kernel_build_failed = true` instead of `exit(1)`; null-program guards added after
  all 187 `build_program_from_source` call sites. Audit: `governor-gpu-probe-audit/REPORT.md`.
- Build knobs baked into the app: `GGML_USE_OPENCL`, `GGML_OPENCL_USE_ADRENO_KERNELS`,
  `GGML_OPENCL_EMBED_KERNELS`, `GGML_OPENCL_SOA_Q`, `GGML_OPENCL_TARGET_VERSION=300`
  (`governor-gpu-recon/REPORT.md:334`).

**INDEX for Section 5:**
- Full push/verify/run recipe: `scratchpad/agents/oracle-consumer/REPORT.md:120-200`
- libOpenCL stub: `scratchpad/agents/archive-gpu-repo-history/REPORT.md:511-530`
- Trap `-b OpenCL`: `scratchpad/agents/qdc-8elite-opencl-e031/REPORT.md:58-63`
- Ops lessons: `scratchpad/agents/qdc-7pg3-govbench-52/REPORT.md:80-104`; `q44-ngl-sweep-mem/REPORT.md` harness+anomalies
- SELinux: `reports/moe-gdn-750.md:40`; `q66-app-lifecycle-s23/PHASE3_STATUS.md:389-392, :531`
- noextra patch + oomwall: `results/oomwall_s23/llama-bench-noextra.diff`; `scratchpad/agents/oomwall/REPORT.md`

---

## SECTION 6 — Dated findings list (newest first), raw-evidence INDEX, WHAT WE DO NOT KNOW

### 6.1 Findings, newest first

Format: **date — device — finding — label — source `path:line`**.

**2026-09-21**
- S23 / Adreno 740 — in-app OpenCL banner captured from logcat: `device: 'QUALCOMM Adreno(TM) (OpenCL 3.0 Adreno(TM) 740)'`, `OpenCL 3.0 QUALCOMM build: 0676.73 Compiler E031.41.03.62`, **`global mem size: 3536 MB`, `max mem alloc size: 884 MB`**, FP16 true, khr dot product true, SOA_Q on, Adreno kernels on. **MEASURED** — `scratchpad/agents/s23-governor-smoke/REPORT.md:500-510` (logcat stamp `09-21 16:09:46`).
- Docs-side recon — no document in the corpus ever proposed a host-pinned / `CL_MEM_ALLOC_HOST_PTR` weight buffer or a shared-weights buffer between two contexts; `CL_MEM_ALLOC_HOST_PTR` appears exactly once, as the K4 question, answered no. **MEASURED (document search)** — `archive-gpu-docs/REPORT.md:587-595`.
- Docs-side recon — the zero-copy answer is a **code reading**, not a driver probe; keep "what the backend does" separate from "what the driver could do". **CLAIM-STRUCTURE** — `archive-gpu-docs/REPORT.md:686-691`.
- Git-history recon — the WHOLE host-memory story in the OpenCL backend is one upstream commit, `8a56aedd6`, by Qualcomm's Hongqiang Wang; its fragmentation datum is **Adreno X1-85, Qwen3.5-9B output.weight Q6_K at 834 MB**, not our phone; its "true zero-copy on Adreno per QCOM guidance" has no citation. **MEASURED (code)** — `archive-gpu-repo-history/REPORT.md:213-230, :275-360`.
- Git-history recon — `ggml_backend_opencl_device_buffer_from_ptr` is a **pure stub** (`return nullptr`), `get_host_buffer_type` is `NULL`, `iface.is_host` is `NULL`; the fourth fallback of the single OpenCL buffer type already allocates `CL_MEM_ALLOC_HOST_PTR` when the device pool is exhausted. **MEASURED (code)** — `archive-gpu-repo-history/REPORT.md:693-712`.
- Allocation-path analysis — mid-load OpenCL alloc failure returns `nullptr`, **no abort**; the abort risk is the per-tensor SoA **staging buffer** in `set_tensor` (`ggml-opencl.cpp:10620-10660`); no device run was made. **MEASURED (code) / NOT VERIFIED on device** — `gpufit-drop-memory-gate/REPORT.md:31-96, :206-223`.
- Governor — owner decision enables `V73: true` in production (`s23-governor-smoke/REPORT.md:116`); governor plan unchanged in substance (`governor-gpu-recon/REPORT.md:106, :540`). **DECISION**.

**2026-09-16** — cross-cutting recon map: pure CPU beats full GPU on every cell of every block on the S23 (KEXP 17.553 vs 14.252; OLMoE 27.685 vs 20.034); hybrid worst. **MEASURED, preregistered** — `scratchpad/QDC-GPU-GOVERNOR-MAP-2026-09-16.md:86-117`.

**2026-09-11** — upstream commit `8a56aedd6143a014e25ec9f4295164f2f66ce30f` (Qualcomm, PR #27630) introduces the 3-step retry with a host-pinned fallback; in all four pins. **MEASURED (code)** — `archive-gpu-repo-history/REPORT.md:275-356`.

**2026-09-07** — QRD8650 / Adreno 750, QDC session 808196: `gemm_noshuffle_q4_0_f32.cl` half-product substitution moves median KLD **0.453822 → 0.004736**, same-top 62.823% → 94.826%, PPL delta 8.400806 → 0.349474, at pp512 **286.30 → 189.73 t/s (0.66×)**. **MEASURED** — `adreno-acc-type/REPORT.md:16-26`; caveat on the 0.659× cost figure failing its own validity gate at `scratchpad/QDC-GPU-GOVERNOR-MAP-2026-09-16.md:322`.

**2026-09-05** — 750 in-app divergence: GPU-prefilled governor turns B1/B2 diverge from CPU at token 14; confined to the 750 (three 750 boards vs one 830 board). **MEASURED** — `qdc-governor-s5/REPORT.md:208-231`; raw `qdc-governor-s5/raw/sa803609/*_logcat_all.txt`.

**2026-09-03 (the QDC tier day)**
- Adreno 732 (QRD7675, job 797795): MUL_MAT 925/925, MUL_MAT_ID 407/407; **FA does not compile** (`sub_group_shuffle_xor`, `err=-11`), then **`failed to allocate OpenCL buffer of size 1804626176` (1.68 GiB)** and **exit 139**. **FAILED-RUN / MEASURED** — `qdc-7pg3-govbench-52/REPORT.md:17-46`; raw `raw/loadprobe_FAcrash_sa801864.out:4-25`.
- Adreno 732 perf: GPU pp512 **151.78 ± 1.12**, tg128 **17.26 ± 0.02** (QAD-Q4_0, `-ngl 99 -fa 0`); compiler **E031.45.02.16**. **MEASURED** — `qdc-7pg3-govbench-52/REPORT.md:44-55`, `raw/tbo_mm_sa801864.out:6`.
- Adreno 735 (QRD8635, job 797956): pp512 **154.82 ± 1.34**, tg128 **16.49 ± 0.01**; compiler **E031.45.02.04**; the 750's 20-FAIL family does NOT reproduce. **MEASURED** — `qdc-8s3-govbench-56/REPORT.md:8-42`, `raw/tbo_mm_sa802025.out:6`.
- Adreno 740 (HDK8550, job 797850): pp512 **84.09** / picks **84.64**, tg128 **16.04** / **16.02** (Q4_K_M); MUL_MAT 925/925, MUL_MAT_ID 407/407, **FA 229/229 PASS**; compiler **E031.41.03.56**. **MEASURED** — `qdc-8g2-oclpicks-53/REPORT.md:1-45`.
- Adreno 750 (QRD8650, jobs 797935 / 798429): pp512 **284.18** then **291.11 ± 0.56**, tg128 **23.42** then **23.02 ± 0.04**; MUL_MAT **905/925 with 20 FAIL** (f16/bf16 batched view-K, m=128 n=1 k=1056 k_v=2112), IDENTICAL failing-case lines in both runs. **MEASURED** — `qdc-8g3-govbench-55/REPORT.md:22-46`, `qdc-8g3-rerun-58/REPORT.md:20-48`.
- Tuned-CPU comparators for the same day: 7675 pp512 95.21 / tg128 20.02; 8635 97.14 / 20.49; 8650 98.97 / 28.58. GPU decode is **0.80–0.86× CPU** on all three tiers. **MEASURED** — `qdc-cpu-tuned-57/REPORT.md:26-33, :44-50`.
- Adreno 830 (8 Elite, QRD8750): KEXP 17.25B Q4_K_M GPU pp512 **274.24/274.83**, tg128 **48.83/48.88** vs CPU pp 107.84/107.00, tg 61.16/60.26 → prefill **2.56×**, decode **CPU wins**. **MEASURED** — `qdc-8elite-speed-kexp/REPORT.md:32-45`.

**2026-08-27** — S23 / Adreno 740, 25-layer `-ngl` sweep with 1 Hz RSS sampler: **peak RssAnon stays within 76.3–110.5 MiB at every ngl from 0 to 99** (GPU weight copies are NOT in process RSS); the cost is affine, **`≈ 800 MiB + 1.05 × offloaded_bytes`**, with a **~754 MiB OpenCL preallocation even at ngl 0**; `OPENCL_ALLOC` created **13432.17 MiB** at ngl99 for **3179.8 MiB** of live set-tensor bytes; `/sys/class/kgsl/kgsl-3d0/proc/<pid>/` unreadable → `gpumem` NA. **MEASURED** — `q44-ngl-sweep-mem/REPORT.md:22-100`; raw `results/ngl_sweep_s23/`.

**2026-08-22** (file mtimes; these cells carry no inline date)
- Vulkan vs OpenCL on the S23/740: Vulkan enumerates as `Adreno (TM) 740 … uma: 1 | fp16: 1 | bf16: 0 | warp size: 64 | shared memory: 32768 | int dot: 0 | matrix cores: none`, then `supports_op` over-claims and every quantised MUL_MAT / MUL_MAT_ID **aborts rc=134** (`createComputePipeline: ErrorUnknown`). **FAILED-RUN / MEASURED** — `vk-vs-cl-s15/REPORT.md:20-40`; raw `results/vulkan_vs_opencl_s23/`.
- S23/740 q2_K/q3_K MoE kernels: storage/convert/restore roundtrip work (mask ABI as kernel args, no numeric literals in `.cl`). **MEASURED (correctness)** — `qk23-kernels/REPORT.md:1-30`; raw `results/qk23_s23/`.
- OLMoE confirmatory N=5 ABBA on S23/740: median tg512 **A 16.356 vs B 10.530 = 1.553×** (gate ≥1.30), GPU arm cooler (38.4 vs 38.95 °C) — **SHIP**, scope one device/one model/ngl=16/noextra. **MEASURED** — `n10-kexp-session/REPORT.md:14-40`; raw `results/olmoe_gpu_moe_s23/n10/runs.csv`.
- Mali-G57 MC2 (Jelly Star): Vulkan enumerates (`warp size: 16`, no matrix cores, 32768 shmem) but every execute path SIGSEGVs rc=139 on the first GPU buffer alloc (`vkGetBufferDeviceAddress` pfn = NULL); OpenCL drops the device as `unsupported GPU`. **FAILED-RUN / MEASURED** — `q26-mali-gate/REPORT.md:11, :69, :86, :169`.

**2026-08-21** — S23 / Adreno 740 MoE experts-on-GPU vs CPU experts at ngl=16, unplugged: burst **pp 63.09 / tg 27.50 vs 40.91 / 12.69 = 1.54× / 2.17×**; sustained **15.28 vs 10.26 ≈ 1.49×**. **MEASURED (exploratory)** — `results/olmoe_gpu_moe_s23/RESULT.md:1-53`; raw `runs.csv`, `ab_*.stdout.txt`, `sus_*.stdout.txt`.
- 4B sustained on S23/740: CPU 5.0 vs GPU 4.0 (**0.80×**); 2B: CPU 10.2 vs GPU 8.2 with GPU at **0% degradation, plateau 38.5 °C** vs CPU −16%, 42.3 °C still rising. **MEASURED** — `reports/moe-gpu-sustained.md:137-175`.

**2026-08-20** — S23 8 GB: the GPU-MoE load power-off wall is llama-bench's default **`CPU_REPACK` (`use_extra_bufts=true`)**, not the GPU; W1 `-ngl 2 -ncmoe 99` cliff **5.01 → 0.45 GB in 13 s** with **zero SET_TENSOR**; W4 `-ngl 0` also dies; W4c with `use_extra_bufts=false` lives (floor 3895 MiB). **MEASURED / FAILED-RUN** — `oomwall/REPORT.md:1-25, :60-80`; raw `results/oomwall_s23/`.
- Same cell, code fact: `clSVMAlloc` — **none in the file** (SVM is queried, never used for weights). **MEASURED (code)** — `oomwall/REPORT.md:137`.

**2026-08-19** — S23/740 oracle sample run: on-device sha256 matched PC for every pushed file; `libggml-opencl.so` = `3f3df26af2375d3bf88fbb1b718bd2ceb26004e0fd56b9d83c40433007530bac`; compile opts logged `'-cl-std=CL3.0 -cl-mad-enable  -cl-fast-relaxed-math'`; driver 0676.73 / E031.41.03.62. **MEASURED** — `oracle-consumer/REPORT.md:244-252`; logs `results/oracle_consumer_s23/run1/run1.log`, `run2/run2.log` (4116 B each, byte-identical).

**2026-08-18** — Xiaomi 14 / Adreno 750, unplugged, interleaved r=1×5: GPU prefill **186.567 vs 58.676 CPU = 3.18×** (not the book 5.77×); decode **17.46 vs 26.50 = 0.66×**. **MEASURED** — `results/gpu_prefill_recheck_xiaomi/report.md:15-53`; raw `results/gpu_prefill_recheck_xiaomi/cells/`.

**2026-08-12**
- S23 / 740 dense Qwen3.5-2B: GPU pp128 **82.26** / tg256 **5.06** vs CPU **63.62** / **12.37** → prefill **1.29×**, decode **0.41×**. **MEASURED** — `reports/moe-gdn-k22-fix.md:157-175`; raw `results/gdn_gpu_k2/s23/logs/bench_{cpu,gpu_faoff}.json`.
- Xiaomi 14 / 750 FA: `sub_group_shuffle_xor` missing, `clBuildProgram` **err=-11**, **abort 134**; driver `OpenCL 3.0 QUALCOMM build: 0762.36.1 Compiler E031.45.02.25`; `vector subgroup broadcast support: false`. **FAILED-RUN / MEASURED** — `reports/moe-gdn-750.md:18-26, :40, :51-52`; raw `results/gdn_gpu_750/`.
- S23 / 740 LiteRT (foreign stack): decode **~26.8 tok/s (ESTIMATE)** vs 9.70 llama-CPU ⇒ ~2.76×, heavy caveats. **ESTIMATE** — `reports/moe-litert-f0-f1.md:73-97`; raw `results/litert_f1/`.

**2026-08-09** — K4 zero-copy answer: `clCreateBuffer(…, NULL, …)` device buffer + `clEnqueueWriteBuffer` copy; SVM queried not used; `cl_qcom_ext_host_ptr` / ION / dmabuf NOT FOUND; +1.75–2.0 GiB double residency kills 8 GB; verdict GIALLO; NO-GO on the full spike. **MEASURED (code reading) / ESTIMATE (RAM)** — `reports/research-adreno-opencl.md:140-170, :289, :339-381`.

**Undated / standing device facts**
- S23 / 740 driver **0676.73 / E031.41.03.62** with device string `'QUALCOMM Adreno(TM) (OpenCL 3.0 Adreno(TM) 740)'` — **the 740's marketing name is empty in the device-name field.** **MEASURED** — `results/barrier_verify_s23/mmid.err:3,6`, `results/qk23_s23/roundtrip_s1.log:3`.
- 750 driver **0762.36.1 / E031.45.02.25**, `global mem 5584 MB / max alloc 1024 MB`, `subgroup shuffle true`, `vector subgroup broadcast false`, SVM coarse+fine true. **MEASURED** — `q16-xiaomi/REPORT.md:63-74`.
- 830 driver **0800.70 / E031.47.18.47**, reports `6554 MiB free`; `vector subgroup broadcast: true` (web, issue #16217 at 0800.46 — **UNVERIFIED for our unit**). **MEASURED / UNVERIFIED split** — `qdc-8elite-opencl-e031/AUDIT.md:76, REPORT.md:23`; `qdc-governor-s5/raw/sa803609/8-Elite_B_t3_filtered.txt:51`.
- No `cl_khr_command_buffer` on the Adreno drivers we hold (recordable queues recon). **MEASURED (published + local)** — `results/cmdbuf/recon_q1_driver.md`; `reports/research-cmdbuf.md:30-42, :107`.

### 6.2 INDEX — where the raw evidence for each finding lives

| finding family | raw evidence root |
|---|---|
| Adreno 732 FA compile / 1.68 GiB / segfault | `scratchpad/agents/qdc-7pg3-govbench-52/raw/loadprobe_FAcrash_sa801864.out` (+ `AUDIT-REPORT.md:33-46,271`) |
| QDC tier benches + correctness | `scratchpad/agents/qdc-{7pg3-govbench-52,8s3-govbench-56,8g2-oclpicks-53,8g3-govbench-55,8g3-rerun-58,cpu-tuned-57}/raw/` |
| 830 speed / governor | `scratchpad/agents/qdc-8elite-speed-kexp/raw/`, `qdc-8elite-governor-8b/raw/`, `qdc-8elite-governor-crossbackend/raw/` |
| S23 / 740 banner + memory limits | `scratchpad/agents/s23-governor-smoke/REPORT.md:500-510`; `results/barrier_verify_s23/*.err:1-12` |
| S23 / 740 RSS-under-GPU | `results/ngl_sweep_s23/` (+ `q44-ngl-sweep-mem/REPORT.md:22-100`) |
| S23 / 740 MoE experts-on-GPU | `results/olmoe_gpu_moe_s23/{runs.csv,n10/runs.csv,ab_*.stdout.txt,sus_*.stdout.txt}` |
| S23 / 740 dense + sustained | `results/gdn_gpu_k2/s23/logs/`, `results/gpu_sustained/`, `results/gpu_sustained_4b/` |
| 8 GB REPACK wall | `results/oomwall_s23/` (+ `llama-bench-noextra.diff`) |
| Xiaomi 750 prefill/decode | `results/gpu_prefill_recheck_xiaomi/cells/`, `results/xiaomi_ab/curve_table.md`, `results/gdn_gpu_750/` |
| Vulkan-vs-OpenCL dead end | `results/vulkan_vs_opencl_s23/` |
| Mali-G57 gates | `results/mali_gate_jelly/{raw,raw2,raw3,raw4}/` |
| Driver / command-buffer recon | `results/cmdbuf/recon_q1_driver.md`, `reports/research-cmdbuf.md` |
| Zero-copy / host-pinned code history | `scratchpad/agents/archive-gpu-repo-history/REPORT.md:213-745` (git objects in `~/Projects/kalsallama`) |
| Zero-copy / host-pinned documents | `scratchpad/agents/archive-gpu-docs/REPORT.md:489-533, :587-595, :686-710` |
| Allocation-failure semantics | `scratchpad/agents/gpufit-drop-memory-gate/REPORT.md:31-96, :206-223` |
| K4 answer (2026-08-09) | `reports/research-adreno-opencl.md:140-170, :289, :339-381` |
| Phone-run harness recipe | `scratchpad/agents/oracle-consumer/REPORT.md:120-200`; `scratchpad/agents/qdc-7pg3-govbench-52/REPORT.md:80-104` |

### 6.3 WHAT WE DO NOT KNOW

Superset of the two predecessor lists; items marked **(new)** come from this sweep.

**Blocks the zero-copy / host-pinned premise**

1. **Whether `CL_MEM_USE_HOST_PTR` or `CL_MEM_ALLOC_HOST_PTR` is actually zero-copy on an Adreno 740.** The claim is unsourced, written by a Qualcomm engineer about the **X1-85**, and never tested in any commit in either repo (`archive-gpu-repo-history/REPORT.md:726-733`). [CITATION NEEDED: Qualcomm Adreno OpenCL driver behaviour for `CL_MEM_USE_HOST_PTR` / `CL_MEM_ALLOC_HOST_PTR` on A7X]
2. **Whether `CL_MEM_ALLOC_HOST_PTR` returns the same physical pages the CPU already mapped from the GGUF** on a UMA SoC. Asserted "true zero-copy"; never verified; no commit measures a saving (`archive-gpu-repo-history/REPORT.md:736-739`).
3. **Whether the S23's Adreno 740 device pool fragments the way the X1-85 does.** The retry machinery exists because of a **laptop part** and a 9B Q6_K tensor at 834 MB; nothing records the 740 behaving that way. If the phone does not fragment, the motivation largely evaporates (`archive-gpu-repo-history/REPORT.md:734-735`).
4. **What a host-pinned dense buffer actually costs in RAM on the 8 GB S23 with two contexts.** No measurement. The app's `gpuReserveMiB = 800 + 1.05 × offloadedBytes` is an estimator fitted on **one model/one device/one sweep** (`q44-ngl-sweep-mem/REPORT.md:74-84`; `archive-gpu-docs/REPORT.md:698-700`).
5. **(new) How to see the Adreno driver pool at all.** `/sys/class/kgsl/kgsl-3d0/proc/<pid>/` is unreadable from `adb shell` on the S23; the `gpumem` sampler column is NA on every point (`q44-ngl-sweep-mem/REPORT.md:93`). Without it, "host-pinned buffer cost" cannot be separated from "driver pool behaviour".
6. **(new) Whether the ~4× allocation churn q44 observed (13432 MiB created for 3179.8 MiB live) fragments the 740 pool.** The number exists; the fragmentation consequence was never measured (`q44-ngl-sweep-mem/REPORT.md:42-52`).
7. **Whether host residency can be released after upload in the fork's `DenseWeights` design.** The K4 conclusion requires it; no experiment was run (`reports/research-adreno-opencl.md:168`).

**Blocks the mechanism choice**

8. **Why OpenCL never got `get_host_buffer_type` while CUDA did** (`archive-gpu-repo-history/REPORT.md:741+`).
9. **Whether `is_host` / `device_buffer_from_ptr` can be implemented without breaking the single-buffer-type design** — weights and graph compute share one `ggml_backend_opencl_buffer_type_interface` (`archive-gpu-repo-history/REPORT.md:705`, [F]).
10. **(new) Whether the 884 MB per-allocation cap on the S23 is a hard ICD limit or a `CL_DEVICE_MAX_MEM_ALLOC_SIZE` that can be raised** by `cl_qcom_large_buffer` (a retry step already in the buffer type at `:14013`). Not probed.

**Blocks any performance claim on the 740 in-app**

11. **In-app GPU prefill on the 740 has never been measured.** Governor off **by table** (`GPU_PREFILL_CORRECT.V73: false`), not by measurement (`archive-gpu-docs/REPORT.md:692-695`). (The table was set to `V73: true` by owner decision on 2026-09-21 — `s23-governor-smoke/REPORT.md:116` — but the measurement still does not exist.)
12. **Why FA compiles on the QDC 740 (`.56`) and not on the S23 740 (`.62`)**; no clinfo-level diff between the two is archived (`archive-gpu-docs/REPORT.md:709-711`).
13. **Sustained 740 GPU decode beyond 4B** — the sustained campaign closed at 2B and 4B (`reports/moe-gpu-sustained.md:174`).
14. **The real cost of one engine flip (context reload) on the S23** — estimate only (`archive-gpu-docs/REPORT.md:712-714`).
15. **`gpubusy` baseline** — the corpus's only value is `~49%`, flagged `PLAUSIBLE (unevidenced)` (`archive-gpu-docs/REPORT.md:715-717`).
16. **Any tok/s at all on the Mali-G57 lane** (`archive-gpu-docs/REPORT.md:718-719`) and **Adreno 840 as hardware** — web figures only (`reports/research-adreno750.md:107-118`).
17. **Whether the 750's dense f16/bf16-batched 20-FAIL root cause is fixed or merely gated** — `ADRENO && !ggml_is_contiguous(src0)` is a workaround; the cause is "still unexplained" (`archive-gpu-docs/REPORT.md:722-724`).

**Documentation-quality defects this sweep found (do not propagate)**

18. **`qdc-750-mulmat-view/AUDIT.md:24` (F3) cites evidence that does not exist** — it claims the `qdc-7pg3-govbench-52` raws contain both `Compiler E031.45.02.06` and `E031.45.02.16`. Direct grep returns only `.02.16` in that directory; `.02.06` belongs to the QRD8650/750 runs. **UNVERIFIED / audit error.**
19. **`tooling caveat (new): `rg` without `--no-ignore` silently skips `scratchpad/agents/*/raw/`** in this repo (the lab `.gitignore` excludes `raw/`). Every grep behind this report that touches raw evidence used `grep -rn` or `rg --no-ignore -a`. Anyone re-searching the lab with plain `rg` will under-count raw evidence — this is the most likely way the next session redoes work.

---

*End of report. Read-only exploration: no edits outside this file, no commits, no push, no phone.*

---
