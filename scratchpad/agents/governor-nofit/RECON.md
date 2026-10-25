# RECON — the governor GPU lane and the `NoFit` gate (S23, LFM2.5 2.6B)

**Task:** explain where `gpuReserve = 800 + 1.05 × size` came from, what the governor lane really
allocates, whether the double footprint is necessary, what has been measured, and what the smallest
real measurement on the S23 would be.

**Repo states read (read-only; no build, no adb, no edit outside this file):**

| tree | state |
|---|---|
| app | `~/Projects/kalsa-wt-bench-apk`, detached at `d69b4ce` ("remote : a busy rebuild only blocks the remote boot flip…") |
| binding | `~/Projects/llama.rn-kalsa`, HEAD `e437b1af`; `cpp/` is **byte-identical** to the app's pin `5b966218` (`git diff --stat 5b966218..HEAD -- cpp/` empty), so `cpp/rn-*.cpp` lines below are the shipping lines |
| engine | `~/Projects/kalsallama` at pin `1577495b9`; all engine line numbers below were re-read from `git show 1577495b9:<path>` so they hold at that pin. The checkout's current HEAD `833cde99b` carries later changes (OpenCL kernels/cache, `llama-governor-policy.cpp`, tests), so OpenCL numbers are given as pin numbers explicitly |
| lab | `~/Projects/kalsa-moe-experiments` |

**Label convention:** every claim is tagged **[MEASURED]** (a number or fact produced by a device
run present on disk), **[CODE-READ]** (read off source at the stated revision, including arithmetic
from constants in that source), or **[INFERENCE]** (a conclusion I draw; not directly observed).

The report under audit is `scratchpad/agents/s23-governor-smoke/REPORT.md`; its §2.5 lines 422-470
and §5.1 lines 679-698 reproduce the gate arithmetic correctly. This document does not repeat that
reconstruction; it answers the six questions around it.

---

## 0. Answers in one table

| # | question | short answer | labels |
|---|---|---|---|
| 1 | where `800 + 1.05×size` came from | app commit **`81bcaf2`** ("wire governor runtime and thermo inputs", 2026-09-04) wrote the line; it inherits a **post-hoc affine fit** of a 5-point llama-bench sweep on the S23 (`q44`, 24/08), not a two-model lane measurement; the constants were never calibrated for the shipping model or the two-model lane | MEASURED (q44), CODE-READ (commits), INFERENCE (calibration status) |
| 2 | what the lane allocates | **two full models**: prefill model `n_gpu_layers=99` gets an **OpenCL device copy** of the weights (1512.28 MiB for LFM 2.6B), decode model `n_gpu_layers=0` gets the **anon CPU_REPACK** copy (1511.20 MiB) **at the same time**; two contexts → two KV caches and two compute buffers. OpenCL cannot alias the mmap | MEASURED (engine load log), CODE-READ |
| 3 | is the double footprint necessary | the CPU repack is not needed by GPU prefill but is needed by CPU decode for speed; the native code has **no per-model repack switch** and the OpenCL backend has **no working host-pointer path** (`caps.buffer_from_host_ptr=false`, device callback returns `nullptr`, and the fork's own comment says `CL_MEM_USE_HOST_PTR` is not zero-copy on Adreno) | CODE-READ (today), PROPOSAL flagged |
| 4 | measured real footprint | **never measured on the S23 for the lane** (it has never loaded). Measured adjacent things: app GPU path S23 (`HARNESS_FINDINGS` §7.18, `q44`), CPU repack cost S23 (`s23-repack-timing`), and the **live two-model lane on QDC QRD8650/QRD8750** (engine buffer log + per-turn `MemAvailable` + partial `dumpsys meminfo`) | MEASURED |
| 5 | smallest S23 experiment | **no `kalsa.bench.*` key bypasses `gpu_fit`.** `kalsa.bench.norepack=1` changes the gate inputs (required 4358.7 → 2998.1 MiB) and is the only no-build lever; the shipping config needs a one-line patch in a `KALSA_DEBUGGABLE=1` build. The engine's own load log already gives the exact allocation sizes | CODE-READ, PROPOSAL |
| 6 | which phones pass | S23-class 8 GB with repack on: **no, at every observed availability (2.2-3.6 GiB vs 4.26 GiB required)**; Jelly: no (generation `Unknown`); Xiaomi 14: only when ~5 GB free; QRD8650/QRD8750: yes (measured). The shipping lane is effectively dead on 8 GB phones, and it is the **repack term that decides it** at S23-class memory | MEASURED + CODE-READ, INFERENCE for the generalisation |

---

## 1. Where `gpuReserve = 800 + 1.05 × offloadedBytes` came from

### 1.1 The commit

**[CODE-READ]** `git log -S "1.05"` / `git log -S "gpuReserveMiB"` over all refs of the app returns
exactly two commits, the second being the `remote-brain` duplicate of the first:

```
81bcaf2  wire governor runtime and thermo inputs      (2026-09-04 18:47:16, Marco Gualtieri)
4443f71  wire governor runtime and thermo inputs      (same date/message; on branch remote-brain, not an ancestor of HEAD)
```

`81bcaf2` created `src/engine/governorInputs.ts` whole; the line is at `:89` of that revision:

```ts
const gpuReserveMiB = 800 + (1.05 * offloadedBytes) / MIB;   // governorInputs.ts:89 @ 81bcaf2
const requiredMiB = estimate.nonEvictableMiB + gpuReserveMiB;
```

The same day, `1c4b142` ("fix governor device probes and fit gate", 19:33) added the second
`computeMiB + kvMiB` pair and the plan comment (`git log -L 109,117:src/engine/governorInputs.ts`
returns only `1c4b142` and `81bcaf2`):

```ts
// Plan §4 bounds the two-context resident budget at 3.46–3.94 GiB.
const requiredMiB =
  estimate.nonEvictableMiB + gpuReserveMiB + estimate.computeMiB + estimate.kvMiB;
```

**[CODE-READ]** `18d4e33` ("app: drop the total-RAM gate from gpuFit, enable V73", 2026-09-21)
removed the `total <= EIGHT_GIB` refusal; it did not touch the reserve arithmetic.
No later commit changes the constants — the gate has never been calibrated in the app.

### 1.2 The source is a lab measurement — a different model, a different regime

**[MEASURED]** The plan that introduced the number is
`archived/docs/PLAN-governor-in-app.md:83`:

> "The initial GPU reserve is `800 MiB + 1.05*1,520.06 = 2,396.1 MiB` (`2.34 GiB`) …
> This is a gate charge, not proof of additive resident RSS."

and `:81` gives the method's intent: "**Assumption:** two clean mmap views share file-backed pages
and the GPU owns approximately one full `W` copy." Step **S6** of the same plan says:
"Implement the `800 MiB + 1.05*offloaded bytes` reserve, **calibrate per device**".

The number itself is traced to `ALIVE` row 12 (`archived/ALIVE-2026-09-full.md:449`),
which points at cell **`scratchpad/agents/q44-ngl-sweep-mem/`** (24/08/2026):

| element | q44 value | source |
|---|---|---|
| device | S23 SM-S911U, unplugged | `q44/REPORT.md:9` |
| model | **LFM2.5-8B-A1B-KEXP**, 3,326,160,384 B (3.10 GiB), 25 layers | `q44/REPORT.md:22`, `q44/PREREG.md:14-16` |
| harness | `llama-bench`, one process, **`-nr` (no repack)**, `GGML_OPENCL_LOG_ALLOC=1` | `q44/REPORT.md:24-27` |
| full-offload point (ngl 99) | ΔMemAvailable **3346.1 MiB**, OpenCL set-tensor **3179.8 MiB**, k_set **1.05** | `q44/REPORT.md:54` |
| partial points (ngl 7/13/19) | excess ΔMA − set_tensor = **750.0 / 787.0 / 694.1 MiB** vs the ~754 MiB Adreno prealloc at ngl 0 | `q44/REPORT.md:77-79` |
| the fit | "[…] described almost exactly by **cost ≈ fixed ~750 MiB + 1.0 × offloaded bytes** […] A conservative affine gate `predicted = 800 MiB + 1.05 × offloaded_bytes` over-predicts (safe direction) on all five measured points" | `q44/REPORT.md:79-83` |
| the report's own caveat | header: "**Post-hoc affine reading (orchestrator fit, NOT pre-registered — n=1 sweep, single model/device)**"; status: "candidate estimator for the app, **to be validated on a second model/device before trusting the constants**" | `q44/REPORT.md:75, 84-85` |

**[MEASURED]** `ALIVE` row 12's own wording is the same: "partial offload ≈ ~750 MiB fixed
(Adreno prealloc, present even at ngl 0) + ~1.0× offloaded bytes; candidate conservative gate for
the app `800 MiB + 1.05×bytes` (safe on all 5 measured points) […]
**Constants need a second model/device before shipping**."

**[INFERENCE]** So, precisely: **the functional form is measured; the two constants are rounded
safety choices, and neither the shipping model nor the two-model lane has ever been used to check
them.** The `800` is a round-up of a measured ~750 MiB driver prealloc; the `1.05` is a round-up of
a measured slope of ~1.0 (the per-step incremental k was 1.70 → 1.05 → 0.88 → 0.09, so a single
slope was already known to be a poor model, see `q44/REPORT.md:66-73`). The q44 measurement was
made with **repack off**, single context, on the 8B-A1B MoE — three differences from the shipping
situation (2.6B hybrid, repack on, two models/two contexts).

### 1.3 The formula in force today (for reference)

**[CODE-READ + arithmetic]** `governorInputs.ts:108-117` (app `d69b4ce`):

```ts
const offloadedBytes = memory.offloadedBytes ?? model.sizeBytes;      // :108
const gpuReserveMiB = 800 + (1.05 * offloadedBytes) / MIB;            // :109
const requiredMiB =                                                   // :111-115
  estimate.nonEvictableMiB + gpuReserveMiB + estimate.computeMiB + estimate.kvMiB;
const availableMiB = (memory.availableMemoryBytes ?? 0) / MIB;        // :116
return requiredMiB <= availableMiB ? "Fit" : "NoFit";                 // :117
```

`offloadedBytes` is the **whole file size**, not the measured offload:
`offloadedBytes: modelInfo.sizeBytes` at `LlamaService.ts:2323`.
`nonEvictableMiB = anonWeights + repack + compute + kv` at `memoryEstimate.ts:164`, with
`repack = W × REPACK_FRACTION`, `REPACK_FRACTION = (1333 − 249)/1211 = 0.89512882…`
(`memoryEstimate.ts:35,51`), `compute@ubatch256 = 249` (`:35,149`), `kv = ctx × 6656` bytes
(`ModelRegistry.ts:293`).

For LFM2.5 2.6B (`sizeBytes 1_593_894_944`, `engineCtx 8192`, `kvBytesPerToken 6656`):

| term | ctx 8192 | ctx 16384 |
|---|---:|---:|
| weights W (evictable, not in `requiredMiB`) | 1520.06 MiB | 1520.06 MiB |
| repack anon (priced at 0.895×) | 1360.65 MiB | 1360.65 MiB |
| compute (priced, per context) | 249.00 MiB | 249.00 MiB |
| KV (priced, per context) | 52.00 MiB | 104.00 MiB |
| gpuReserve `800 + 1.05 W` | 2396.06 MiB | 2396.06 MiB |
| **requiredMiB** (repack ×1, compute ×2, KV ×2 — see the paragraph below) | **4358.70 MiB = 4.257 GiB** | **4462.70 MiB = 4.358 GiB** |
| required with `norepack=1` | 2998.06 MiB = 2.928 GiB | 3102.06 MiB = 3.029 GiB |

The S23 smoke report's 4358.7 MiB / 4.26 GiB and 2229–3009 MiB availability are reproduced exactly.
**[CODE-READ]** The "double count" flagged in `s23-governor-smoke/REPORT.md:702-704` is real
arithmetic, but the lane has exactly two contexts, one of which `nonEvictableMiB` (a
single-context estimator) does not cover: the extra `computeMiB + kvMiB` is the second context's
term. **[INFERENCE]** It is better read as "two contexts are priced, one repack and one GPU copy
are priced" than as a bug — though the code never says so.

---

## 2. What the governor lane really allocates

### 2.1 Two models, two contexts, by structure

**[CODE-READ]** The binding loads **two complete models from the same GGUF path**:

`cpp/rn-llama.cpp:74-77` (identical at binding pin `5b966218`):

```cpp
common_params prefill_params = owner.params;
common_params decode_params  = owner.params;
prefill_params.n_gpu_layers = 99;
decode_params.n_gpu_layers  = 0;
```

then `owner.governor_prefill_init = common_init_from_params(prefill_params, true);` (`:98`) and
`owner.governor_decode_init = common_init_from_params(decode_params, true);` (`:107`). The second
argument `true` is `model_only` (`common/common.h:949`), so each call builds a full `llama_model`.
Both owners stay resident for the session (`cpp/rn-llama.h:129-130`:
`common_init_result_ptr governor_prefill_init; common_init_result_ptr governor_decode_init;`),
and the governor builds **one context per model** (`src/llama-governor.cpp:38,42`):

```cpp
ctx_prefill = llama_init_from_model(model_prefill, params_prefill);
ctx_decode  = llama_init_from_model(model_decode,  params_decode);
```

`params_prefill.ctx_other`/`params_decode.ctx_other` are rejected (`llama-governor.cpp:33-36`), so
the two contexts have independent KV caches by construction. **[INFERENCE]** Everything below
follows from this structure: two model allocations and two context allocations coexist.

### 2.2 The GPU prefill model gets a device copy; the CPU decode model gets the anon repack copy

**[CODE-READ]** Why the GPU weights are a copy and not an alias — all at engine `1577495b9`:

- `src/llama-model.cpp:1768,1776`: the mmap-backed backend buffer path is
  ```cpp
  bool buffer_from_host_ptr_supported = props.caps.buffer_from_host_ptr;
  if ((ml.use_mmap || is_lazy_mapped) && use_mmap_buffer && buffer_from_host_ptr_supported && is_default_buft) {
      ... ggml_backend_dev_buffer_from_host_ptr(dev, (char *) addr + first, last - first, max_size);
  } else {
      ... buf = ggml_backend_alloc_ctx_tensors_from_buft(ctx, buft); // real buffer   (:1805)
  }
  ```
- `ggml/src/ggml-opencl/ggml-opencl.cpp:14517-14524` (pin): the OpenCL device caps are
  `host_buffer=false`, **`buffer_from_host_ptr=false`**, `mmap_support=false`.
- `ggml-opencl.cpp:14557-14562` (pin): the device callback is a stub —
  `ggml_backend_opencl_device_buffer_from_ptr(...) { … return nullptr; }`.
- Therefore the `else` branch at `llama-model.cpp:1805` always runs for OpenCL: one
  `ggml_backend_alloc_ctx_tensors_from_buft` pool per model, allocated in
  `ggml_backend_opencl_buffer_type_alloc_buffer` (`ggml-opencl.cpp:14357` pin) with
  `clCreateBuffer(context, CL_MEM_READ_WRITE, size, NULL, &err)` (`:14370` pin);
  `CL_MEM_ALLOC_HOST_PTR` appears only as the last-resort fallback when the device pool fails
  (`:14398` pin).
- The upload is a genuine copy:
  `llama_model_loader::load_all_data` (`src/llama-model-loader.cpp:1486`) calls
  `ggml_backend_tensor_set(cur, data, 0, n_size)` on the mmap path (`:1663`) →
  `ggml_backend_opencl_buffer_set_tensor` (`ggml-opencl.cpp:11003` pin) → for Q4_0, the branch at
  `:11109` allocates a temporary upload buffer with
  `ggml_cl_create_temp_upload_buffer(...)` (`:10921`, writing with
  `clEnqueueWriteBuffer(queue, buf, CL_TRUE, …)` at `:10933`) and writes scales/quants into
  sub-buffers **of the preallocated pool** (`clCreateSubBuffer(extra_orig->data_device, …)`,
  `:11135 ff`). The pool is `ctx->buffer[0]`, set in `init_tensor`
  (`extra->data_device = ctx->buffer[0]`).
- The CPU decode model's repack: `use_extra_bufts = !params.no_extra_bufts`
  (`common/common.cpp:1706`), the extra buft is added in `make_cpu_buft_list`
  (`src/llama-model.cpp:1061,1093-1106`), and its buffer is a plain host allocation:
  `ggml_backend_cpu_repack_buffer_type_alloc_buffer` calls
  `ggml_backend_buft_alloc_buffer(ggml_backend_cpu_buffer_type(), size)`
  (`ggml/src/ggml-cpu/repack.cpp:5374-5375`), filled by
  `ggml_backend_cpu_repack_buffer_set_tensor` → `tensor_traits->repack(...)` (`:5340-5362`).
  With `no_extra_bufts = 0` (the shipping LFM policy is the default `{mmap:true, repack:true}`,
  `loadPolicy.ts:37`; LFM's registry entry has no `loadPolicy` override, `ModelRegistry.ts:272-305`),
  this anon buffer is created.

### 2.3 The measurement (engine's own load log, shipping model, two boards)

**[MEASURED]** The governor lane loaded in the app on QDC in cell `qdc-governor-s5`, same model
`LFM2.5-2.6B-QAD-Q4_0.gguf` (1,593,894,944 B) and `n_ctx=16384`, `n_ubatch=256`,
`no_extra_bufts:0` (`KALSA_SESSION {"op":"init","no_extra_bufts":0}`). The engine's own buffer
lines, identical on QRD8650 (Adreno 750, V75) and QRD8750 (8 Elite, Adreno 830, V79):

| allocation | MiB | QRD8750 line | QRD8650 line |
|---|---:|---|---|
| prefill model (GPU) `CPU_Mapped` | 205.08 | `8-Elite_B_t1_load.txt:1492` | `QRD8650_B_t1_load.txt:1270` |
| prefill model (GPU) **`OpenCL model buffer`** | **1512.28** | `:1493` | `:1271` |
| decode model (CPU) `CPU_Mapped` | 1503.20 | `:2320` | `:2073` |
| decode model (CPU) **`CPU_REPACK model buffer`** | **1511.20** | `:2321` | `:2074` |
| prefill ctx `OpenCL KV buffer` | 104.01 | `:2635` | `:2390` |
| prefill ctx `OpenCL RS buffer` | 0.34 | `:2669` | `:2424` |
| prefill ctx `OpenCL compute buffer` | 129.00 | `:2688` | `:2484` |
| prefill ctx `CPU compute buffer` | 12.04 | `:2689` | `:2485` |
| context `CPU output buffer` (both ctxs) | 0.49 each | `:2604`, `:2725` (prefill / decode) | `:2359`, `:2521` |
| decode ctx `CPU KV buffer` | 104.00 | `:2756` | `:2552` |
| decode ctx `CPU compute buffer` | 129.00 | `:2808` | `:2613` |

**[CODE-READ + arithmetic]** Summing the device-side terms (weights + KV + RS + compute) gives
**1745.63 MiB of OpenCL device memory**; the host-side terms (repack + CPU KV/RS/compute + output)
give **1757.56 MiB of anonymous memory**; total **3503.19 MiB = 3.42 GiB** at `n_ctx=16384`.
At the S23's `n_ctx=8192` the KV halves (52.00 MiB per context) and the same sum is
**3399.19 MiB = 3.32 GiB**. Neither figure includes the Adreno driver prealloc that q44 measured
(~754 MiB created, ~377 MiB live at `ngl 0`, `q44/REPORT.md:49,94` anomaly 2) — that memory is not in
the engine's buffer accounting.

**Answer to the question as posed:** yes — the GPU prefill context uploads a **second full copy**
of the weights into OpenCL buffers (`OpenCL model buffer = 1512.28 MiB`) **while** the CPU repack
copy exists (`CPU_REPACK = 1511.20 MiB`). The mmap (`CPU_Mapped` 205.08 + 1503.20 MiB, two VMAs
over the same file) is a third, file-backed and evictable, presence. **[MEASURED + INFERENCE]**
The two `CPU_Mapped` regions map the same inode, so the page cache holds those bytes once; the
decoder's 1503.20 MiB map already covers the prefill model's 205.08 MiB range.
**[INFERENCE]** The steady-state unreclaimable + device cost of the lane for this model is
therefore roughly `OpenCL copy ≈ W` + `repack ≈ W` + `2×KV + 2×compute + RS` + driver prealloc,
i.e. about **3.4-4.2 GiB**, against a 1.52 GiB file.

### 2.4 On Adreno's unified memory: could the OpenCL buffer alias the mmap?

**[CODE-READ]** Today: no.
`caps.buffer_from_host_ptr = false` and `caps.mmap_support = false` (pin `14520`, `14522`), and
the device callback returns `nullptr` (pin `14557-14562`), so `llama-model.cpp:1776` can never be
taken for OpenCL and the weights are copied into a device pool. The fork also documents the
driver behaviour explicitly — `ggml-opencl.cpp:10914` (pin):

> "(CL_MEM_USE_HOST_PTR is NOT zero-copy on Adreno: the driver triggers an internal copy because
> arbitrary host pages aren't guaranteed mappable/coherent, AND it draws from the same exhausted
> device pool — so it doesn't solve the problem.)"

**[MEASURED]** The copy is real DRAM, not a shadow: on a GPU load the process shows
`RssFile 26-33 MB`, `RssAnon 121-183 MB` while system `MemAvailable` falls 3.4 GB
(`HARNESS_FINDINGS.md:4009-4010`, §7.18), and q44 saw `RssAnon` flat at 80-110 MiB while
`MemAvailable` dropped (`q44/REPORT.md:88-90`; `archived/ALIVE-2026-09-full.md:449`).
Adreno's memory is physically unified, but the OpenCL buffer object is an opaque driver
allocation; it is not host-mapped into the process and it cannot be /proc-accounted.

---

## 3. Is the double footprint necessary?

**[CODE-READ] What the code does today:**

1. The CPU repack is created for the **decode** model, because `decode_params` copies
   `owner.params` (`rn-llama.cpp:74-77`) and `owner.params.no_extra_bufts` comes from the app's
   resolved load policy (`LlamaService.ts:2397`: `no_extra_bufts: load.noExtraBufts`).
   There is **no code path that turns repack off for the CPU model while leaving the GPU model
   alone**, and none that turns it off only when prefill is on the GPU.
2. The GPU weights copy cannot be avoided by any flag in the app or binding: it is the only
   allocation path the OpenCL backend offers (see §2.4). `mmap` keeps the file pages, but the
   backend pool is a second copy.
3. Both models are complete `llama_model`s loaded from the same file; the engine API
   (`llama_governor_init*`) takes two model pointers and rejects a missing one
   (`llama-governor.cpp:33-36`), so the design itself fixes the two-model shape.

**Why the CPU repack is there:** **[MEASURED]** on the S23 CPU-only path, repack ON costs
+~1497 MiB peak `RssAnon` for LFM 2.6B and buys 2.6× prefill and 1.4× decode
(`s23-repack-timing/REPORT.md:23, 114-118, 170-176`). It is the decode path's performance feature,
not a prefill requirement.

**Proposals (all PROPOSAL, none of this is in the code today):**

- **P1 — per-model repack.** In `load_governor_models` (`rn-llama.cpp:74-77`), set
  `decode_params.no_extra_bufts = true` (or make it a policy input) when the governor lane is
  active. Saving: ~1511 MiB anon for this model. Cost: decode throughput on CPU, bounded by the
  measured CPU-only ~1.4× (`s23-repack-timing/REPORT.md:23`); in the governor lane the GPU does
  prefill, so the 2.6× prefill cost does not apply. This is the single largest lever that would
  move the S23 from 4.26 GiB required to 2.93 GiB.
- **P2 — host-pointer OpenCL buffers.** Implement `buffer_from_host_ptr` for OpenCL
  (`ggml-opencl.cpp` device i-face) so `llama-model.cpp:1776` can take the mmap path. The fork's
  own comment (`:10914`) says Adreno would internally copy anyway; expected saving is uncertain to
  zero on this driver. Do not budget for it without a device measurement.
- **P3 — one model, two contexts.** Share a single `llama_model` across the two contexts instead of
  loading it twice. Not supported by the current governor API and not expressible from the app;
  an engine design change, not a config change.
- **P4 — shipping-config decision.** Teach LFM2.5 2.6B `loadPolicy: { repack: false }` like Qwen 4B
  already has (`ModelRegistry.ts:239`). This is the no-code-change path and is the only one that
  lets the gate pass on an S23 today (§5, option A). It is an owner trade, not an engine fix.

---

## 4. Has anyone measured the real footprint?

### 4.1 The governor lane on the S23: no

**[MEASURED]** `s23-governor-smoke/REPORT.md` §5.1: the governor **activated** (the total-RAM gate
is gone) and then **refused on `fit:"NoFit"`**; `nGpuLayers: 0`, `engine_prefill: "CPU"`,
`prefill_ctx_ngl: 0`. The lane never loaded, so no PSS/RSS/`dumpsys meminfo`/MemAvailable sample of
it exists for the S23. The 4358.7 MiB in §2.5 is explicitly a **host reconstruction** of the
gate's arithmetic, not a measurement.

**[MEASURED]** The only process-level memory record of the S23 smoke is the surrounding system
state: `pressure.transition {"availableMb":2229}` and `model.fit {"availableMb":3009}`
(`s23-governor-smoke/REPORT.md:430-431`). No `dumpsys meminfo` of the app during that run is cited.

### 4.2 Adjacent measurements that do exist

| what | device | numbers | source |
|---|---|---|---|
| **App GPU path** (single context, Qwen 4B Q4_K_M 2.83 GB + F16 mmproj 672 MB, `NGL=99`) | S23 | system `MemAvailable` **4.02 GB → 583 MB**; app `RssFile` 26-33 MB; `RssAnon` 121-183 MB; `VmSwap` 1.02 GB; lmkd killed the foreground app (`oom_score_adj 0`); "the weights live in driver/CL allocations that `/proc/<pid>/status` does not account for" | `HARNESS_FINDINGS.md:4004-4030` (archived copy in the app worktree and in the lab) |
| **GPU offload k sweep** (llama-bench, `-nr`, LFM2.5-8B-A1B-KEXP 3.10 GiB, 5 points) | S23 | ngl 0: Adreno prealloc ~754 MiB created / ~377 live. ngl 99: ΔMemAvailable 3346.1 MiB for OpenCL set-tensor 3179.8 MiB (k=1.05); `RssAnon` flat 80-110 MiB; `RssFile` peak 3.1 GiB with ΔMA only 35.5 MiB at ngl 0 | `q44-ngl-sweep-mem/REPORT.md:48-56, 88-90` |
| **CPU repack A/B** (app, LFM 2.6B on S23) | S23 | repack ON: peak `RssAnon` 1760 [1704-1771] vs 263 [262-267] MiB off (+1497); prefill 47.7 vs 18.1 t/s; decode 13.99 vs 9.88 t/s; `MemAvailable` at arm start 1217 MiB lower with repack on | `s23-repack-timing/REPORT.md:114-122, 170-176` |
| **Live governor lane in-app**, A (CPU single-context) vs B (governor) | QRD8650 (Adreno 750, 11.0 GiB) and QRD8750 (Adreno 830, 14.8 GiB) | per-turn MemAvailable deltas: A1 8.50→6.29 GiB vs B1 8.43→4.41 GiB on QRD8650; A1 11.79→9.58 GiB vs B1 11.76→7.67 GiB on QRD8750. Engine buffer log (§2.3) gives the exact split. `lmkd_count=0` in every row | `qdc-governor-s5/REPORT.md:155-165, 191-241`; raw `raw/sa803609/results.tsv`, `raw/driver-sa803609.log:1-16` |
| **`dumpsys meminfo` of the app with the lane live** (captured after each turn) | QRD8750 | A (single CPU model): `Native Heap` Pss 1,803,692 kB; B (two models + OpenCL pool): `Native Heap` Pss 1,846,540 kB; `Other mmap` identical (1,542,235 vs 1,542,241 kB); `Gfx dev` 5,172 vs 17,404 kB; `EGL mtrack` 37,000 kB both. **The 1.5 GB OpenCL weights pool appears nowhere in PSS/RSS** | `raw/sa803609/8-Elite_A_t1_appmem_after.txt:8,22`, `8-Elite_B_t1_appmem_after.txt:8,22`; same shape on QRD8650 `raw/sa803304/QRD8650_{A,B}_t1_appmem_after.txt` |

**[INFERENCE]** The comparison the question asks for: the gate's 4358.7 MiB (ctx 8192) sits
**above** the engine-log sum for the same model (~3399 MiB at ctx 8192) plus the driver prealloc
(~377-754 MiB), i.e. ~3.8-4.2 GiB real. The gate is conservative by roughly 0.2-1.0 GiB, and its
`REPACK_FRACTION 0.895` **under**-prices the measured repack (1511.20 / 1520.06 = 0.994); those two
errors push in opposite directions. Either way, the S23's observed 2.2-3.0 GiB is not near the real
requirement.

### 4.3 What has *not* been measured anywhere

- The shipping (repack-on) governor lane on any **8 GB** phone; only 11 GiB+ QDC boards.
- The two-model lane with the **shipping model on the S23**; and with **Jelly** at all
  (Helio G99 → generation `Unknown` → the gate never lets it through, `governorInputs.ts:90`).
- The transient peak during the lane's load (temp upload buffers + the second model load) — the
  q44 `OPENCL_ALLOC` created sum reached 13,432 MiB at ngl 99, but those are created-and-released
  staging allocations, not live memory (`q44/REPORT.md:47,54`); the peak is unmeasured.

---

## 5. Smallest experiment that measures the real footprint on the S23

### 5.1 No existing bench key bypasses `gpu_fit`

**[CODE-READ]** `kalsa.bench.*` keys are enumerable from `src/`:
`devmodels, digestcadence, energy_trace, engine, force_ids, format, governor_force, legacywindow,
nctx, norepack, probs, ranking, sampling, speculative, thermo, thinking, toolchoice, toolgate,
winbudget`. Of these:

- `kalsa.bench.governor_force` only sets `enabled = force || GPU_PREFILL_CORRECT[generation]`
  (`governorInputs.ts:127`); `gpu_fit` is computed independently at `:133` and takes no `force`
  argument. The load still requires `governorBase.gpu_fit !== "NoFit"`
  (`LlamaService.ts:2326-2331`). On V73 `enabled` is already `true` anyway
  (`governorInputs.ts:24`), so the key changes nothing here.
- `kalsa.bench.norepack` (tri-state, `benchConfig.ts:64`, resolved in `loadPolicy.ts:44-51,75-81`)
  **does** change the gate's inputs: `repack: !load.noExtraBufts` is passed to `gpuFit` at
  `LlamaService.ts:2321-2322`, and the same resolved policy drives the load itself.
- `kalsa.bench.nctx` shrinks the KV term only (needed Δ ≈ 1350 MiB would require a negative
  context; not a lever).
- `kalsa.bench.engine.useMmap=false` makes the estimate *worse* (anonymous weights ×1.32 with no
  repack term, `memoryEstimate.ts:159-163`).
- No key overrides `availableMemoryBytes` or `gpu_fit`; there is no `kalsa.bench.fit`.

### 5.2 Option A — no build, existing key (measures the repack-OFF lane)

**[CODE-READ + proposal]** `kalsa.bench.norepack=1` drops `requiredMiB` from 4358.7 to
**2998.1 MiB** at ctx 8192 (§1.3). The S23 hit 3009 MiB available in the smoke run, so this is a
knife-edge but reachable; a fresh force-stop should free more. Recipe (proposal, not run here):

1. Force-stop the app (`adb shell am force-stop com.kalsa.app`) so `getCachedDeviceProfile()`
   rebuilds its process-lifetime cache (`deviceProfile.ts:685`, the available-memory value is read
   once per process at `:653-654`) and so the page cache/other apps have drained.
2. Confirm `/proc/meminfo` `MemAvailable` ≥ ~2998 MiB (`Fit` requires
   `requiredMiB <= availableMiB`, `governorInputs.ts:117`).
3. Write the pref with the existing mechanism — `scripts/ci-bench.sh:27,389` writes exactly this
   key into `catalystLocalStorage` (`sql_write "INSERT OR REPLACE … 'kalsa.bench.norepack'"`).
4. Enable the governor (`kalsa.governor.enabled=1`) and load LFM2.5 2.6B.
5. Capture, at idle / post-load / post-first-turn:
   - `adb logcat` filtered on `KALSA_NATIVE` (the `load_tensors:`, `llama_kv_cache:`,
     `sched_reserve:` lines are the exact allocation sizes — see §2.3, no instrumentation needed),
     plus `KALSA_GOVERNOR` / `KALSA_NATIVE_VARIANT` for `fit` and `prefill_ctx_ngl`;
   - `/proc/meminfo` and `dumpsys meminfo com.kalsa.app` — the harness already has
     `capture_sysprobe_snapshot()` (`scripts/ci-lib.sh:269`, emits `RssAnon/RssFile/VmSwap` +
     `MemAvailable`), `emit_meminfo()` (`:398`), and `capture_death_evidence()` (`:214`, which saves
     `dumpsys meminfo` + `/proc/meminfo` when the app is killed).
6. Failure mode to watch: lmkd kill during load; the AGENTS rule and the preflight gates apply
   (unplugged for energy, but this is a memory test — the report's own run was plugged; keep the
   project's charging rule in mind and label it).

**What it measures:** the lane with repack **off** — i.e. the configuration that would actually
ship on an S23 if P4 were taken. **What it does not measure:** the shipping repack-on config.
**Prediction (INFERENCE):** device+anon ≈ 3399 MiB minus the 1511 MiB repack ≈ **~1.85 GiB**
plus driver prealloc; if that survives at ~3.0 GiB available, the gate's 4.26 GiB figure is
confirmed to be padding for repack-on, not for the lane's irreducible cost.

### 5.3 Option B — one-line patch, debuggable build (measures the shipping lane)

**[CODE-READ + proposal]** The shipping config (repack on, required 4358.7 MiB) needs the refusal
conjunct removed, e.g. drop `governorBase.gpu_fit !== "NoFit"` at `LlamaService.ts:2331`, or force
`governorInputs.ts:117` to return `"Fit"` behind a build-time constant. Build with
`KALSA_DEBUGGABLE=1` (`app.config.js:72`, the gate used by the `bench-apk` cell and by
`s23-repack-timing`'s build; the `s23-repack-timing/REPORT.md:42-45` records the exact
`expo prebuild` + `gradlew assembleRelease` recipe, APK sha `245c514c…`) and repeat option A's
capture. **Prediction (INFERENCE):** on 2.2-3.0 GiB available the load should die under lmkd —
and that kill, captured by `capture_death_evidence`, *is* the measurement the gate claims to be
making. If it survives with real usage near the engine-log sum, the gate is over-conservative and
the 4.26 GiB figure is wrong by roughly the prealloc + repack-fraction errors (§4.2).

**Cheapest alternative to both:** the engine ships `tools/governor-bench/` (two-model init without
the app), but it needs a device build/push — more work than A and not obviously less than B.

**[MEASURED / CODE-READ]** Whichever route is taken, the engine's own load log is the ground truth
and is already emitted: `load_tensors`, `llama_kv_cache`, `sched_reserve` in `KALSA_NATIVE` logcat
(the same lines used in §2.3). `/proc` sampling of the app adds `RssAnon/RssFile/VmSwap` and
`Pss` — but §4.2 shows those are blind to the OpenCL pool, so the system `MemAvailable` delta
plus the engine's buffer log, not PSS, is the measurement that answers the question.

---

## 6. Which phones pass this gate with LFM2.5 2.6B, and is the lane dead on 8 GB?

**[CODE-READ + arithmetic]** Required `MemAvailable` before the load, from §1.3:

| device class | ctx | repack on | repack off |
|---|---:|---:|---:|
| 8 GB V73 phone (S23 uses `engineCtx 8192`) | 8192 | **4358.7 MiB (4.26 GiB)** | 2998.1 MiB (2.93 GiB) |
| 12/16 GB phone (Xiaomi/QDC use ctx 16384 via the total-RAM rule) | 16384 | **4462.7 MiB (4.36 GiB)** | 3102.1 MiB (3.03 GiB) |

| phone | SoC / generation | total | availability on record | pass? | label |
|---|---|---|---:|---|---|
| Samsung S23 SM-S911U | SM8550 / V73, Adreno 740 | 7,243,748 kB = 6.91 GiB | 2229–3009 MiB in the smoke run; arm starts 2145–2364 MiB with repack on / 3148–3641 MiB with repack off in the repack A/B | **No** with repack on at every observed value; **borderline** with `norepack=1` (needs ≥ 2998 MiB) | MEASURED (availability, refusal), CODE-READ (arithmetic) |
| Jelly Star | Helio G99, Mali-G57 | 8 GB class | n/a | **No** — generation `Unknown` → `gpuFit` returns `NoFit` at `governorInputs.ts:90` before any memory test; also no Adreno/OpenCL lane | CODE-READ |
| Xiaomi 14 `houji` | SM8650 / V75, Adreno 750 | 11,436,476 kB = 10.91 GiB | 3,727,652 kB = 3640 MiB app-idle; ~5 GB after force-stop (record) | **No** at 3640 MiB; **would pass** on paper at ~5 GB after force-stop (needs 4462.7 MiB at ctx 16384) | MEASURED (availability), INFERENCE (pass) |
| QDC QRD8650 | SM8650 / V75, Adreno 750 | 11,544,332 kB = 11.01 GiB | 8,736,428 kB = 8532 MiB before the run | **Yes** — measured: the lane loaded and ran | MEASURED |
| QDC QRD8750 | SM8750 / V79, Adreno 830 | 15,519,768 kB = 14.80 GiB | 12,331,760 kB = 12,043 MiB before the run | **Yes** — measured: the lane loaded and ran | MEASURED |

**[INFERENCE]** The question "is the lane effectively dead on 8 GB phones?" has a yes-with-a-cause:
under the shipping `{mmap:true, repack:true}` policy the gate demands **4.26 GiB of available
memory on a 6.91 GiB device** — 62% of total RAM free before the load — and 2.4 GiB of that demand
is the GPU reserve while a further 1.36 GiB is the CPU repack of the same 1.52 GiB file. At the
S23's observed 2.2-3.0 GiB the refusal is the correct outcome, not a false negative: the real lane
(sum of engine buffers ≈ 3.4 GiB at ctx 16384, less at 8192, plus the unreported Adreno prealloc)
also does not fit there. The S23 is not intrinsically excluded — V73 is enabled in the table
(`governorInputs.ts:24`) and the lane would become reachable at repack-off requirements — but the
shipping policy, not the SoC, is what makes it unreachable today.

---

## Source index (paths as used above)

App (`~/Projects/kalsa-wt-bench-apk` @ `d69b4ce`):
`src/engine/governorInputs.ts` · `src/engine/memoryEstimate.ts` · `src/engine/loadPolicy.ts` ·
`src/engine/LlamaService.ts` · `src/engine/deviceProfile.ts` · `src/engine/ModelRegistry.ts` ·
`src/engine/deviceTuning.ts` · `src/bench/benchConfig.ts` · `app.config.js` · `scripts/ci-lib.sh` ·
`scripts/ci-bench.sh` · `archived/docs/PLAN-governor-in-app.md` · `archived/docs/HARNESS_FINDINGS.md`

Binding (`~/Projects/llama.rn-kalsa`, `cpp/` at pin `5b966218`): `cpp/rn-llama.cpp` ·
`cpp/rn-llama.h` · `cpp/rn-governor.cpp`

Engine (`~/Projects/kalsallama` @ `1577495b9`): `src/llama-governor.cpp` ·
`src/llama-governor-runtime.cpp` · `src/llama-model.cpp` · `src/llama-model-loader.cpp` ·
`common/common.cpp` · `common/common.h` · `ggml/src/ggml-cpu/repack.cpp` ·
`ggml/src/ggml-opencl/ggml-opencl.cpp`

Lab (`~/Projects/kalsa-moe-experiments`): `scratchpad/agents/q44-ngl-sweep-mem/` ·
`scratchpad/agents/s23-governor-smoke/REPORT.md` · `scratchpad/agents/s23-repack-timing/` ·
`scratchpad/agents/qdc-governor-s5/` (REPORT + `raw/sa803304`, `raw/sa803354`, `raw/sa803609`) ·
`scratchpad/agents/xiaomi-ram-zram-investigation/REPORT.md` ·
`analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md` ·
`archived/ALIVE-2026-09-full.md` (row 12) · `docs/ALIVE.md`
