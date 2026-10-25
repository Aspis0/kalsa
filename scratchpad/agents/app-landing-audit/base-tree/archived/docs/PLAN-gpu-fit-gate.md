# Plan: teach the RAM fit gate about GPU memory

Status: proposal. Nothing implemented. This blocks every GPU path in the app.

---

## The defect, in one line

The gate's whole model rests on **"weights are evictable"**, and GPU offload makes that false.

`memoryEstimate.ts:69` declares the assumption in the type itself:

```ts
weightsMiB: number; // evictable (mmap / file-backed)
```

and `memoryEstimate.ts:132` states the rule it buys:

```
does_not_fit: nonEvictable > available — anonymous pages cannot be reclaimed
```

So `nonEvictableMiB` (`:115`) is `repack + compute + kv` — weights are excluded because the kernel
can drop file-backed pages under pressure. That is correct **on CPU**.

Offloaded weights are not file-backed. They become driver/CL allocations that are:

- **not reclaimable** — the kernel cannot drop them,
- **not accounted to the process** — `/proc/<pid>/status` does not see them,
- **still charged to the system** — `MemAvailable` falls by the full amount.

So under offload a weight byte moves from the *best* bucket to one **worse than non-evictable**:
unreclaimable *and* invisible. The gate scores it as free.

**Measured consequence (S23):** the app reads ~150 MB of RSS while system `MemAvailable` falls
4.02 GB → 583 MB, and lmkd kills it at `oom_score_adj 0`. A 6.4 GB model at full GPU rebooted the
kernel.

⛔ **lmkd is not an exception.** It kills the process; `initLlama` never throws. The
`KALSA_GPU_FALLBACK` retry at `LlamaService.ts:1379` cannot fire for this death. There is no
runtime net — the gate is the only defence.

## Second defect: the estimate cannot be told about the backend

⛔ **Correction — the first version of this section was wrong**, and a hostile review refuted it.
It claimed the fit runs *before* the backend is resolved. It does not: `resolveBackendPolicy` is
the **first line** of `resolveEngineTuningSync` (`deviceTuning.ts:649`). There is no ordering to
change and no circular dependency.

What is actually true is narrower and duller: `deviceTuning.ts:549-556` builds the estimate from
five fields — `fileBytes`, `contextTokens`, `kvBytesPerToken`, `ubatch`, `repack`. **There is no
backend field**, so the already-resolved policy is simply never passed down. This is plumbing, not
sequencing. The three `deviceProfile.ts` call sites (`:252`, `:350`, `:431`) are the harder half:
their signatures carry neither `profile` nor `platformHint`, so there is nothing to thread yet.

## Third defect: the two consumers disagree about what a bad verdict means

The verdict has two consumers and they respond differently. Both must be handled or the GPU term
lands in one and is wasted in the other.

- **The pre-send gate refuses.** `deviceProfile.ts:445` returns
  `{ allow: false, reasonKey: "model.tooLarge" }` on `does_not_fit`, and `AiChatPage.tsx:2094`
  blocks the send on it. A GPU term reaches this one and does the right thing.
- **The context budget degrades instead.** `resolveContextBudget` binary-searches n_ctx down and
  then loads anyway — `deviceTuning.ts:602`, verbatim:

  ```ts
  // Never below floor even if floor itself does not fit (conservative load attempt).
  const n_ctx = Math.max(CTX_FLOOR, best);
  ```

⛔ **Shrinking n_ctx is the wrong lever for offloaded weights.** The search shrinks the *KV* term;
offloaded weight bytes do not scale with context at all. Under offload the loop would grind n_ctx
to the floor, still not fit, and load regardless — turning a refusal into a slow crash. Deciding
what that path should do instead (refuse? fall back to CPU? offload fewer layers?) is a **product
decision, not a code change**, and this plan does not make it.

## Fourth defect: `repackMiB` is derived from the whole file

`memoryEstimate.ts:112` computes the repack term from the full weight bytes with a fraction
calibrated full-CPU. Splitting weights without splitting repack either double-counts the offloaded
share or invalidates the fraction. §7.44 also found repackability is **quant-dependent, not
uniform**, so a per-layer split cannot assume a constant fraction either. Unresolved; do not
implement the weight split without deciding this.

## Why this is the first block, not one of many

Any GPU work — the per-phase governor, an `-ngl` sweep, a device class rule — ends in the app
asking to offload. Today that means asking a gate whose central premise is inverted to approve it,
with no runtime net behind it. Fix the gate and `resolveBackendPolicy` becomes a one-word change
(it currently returns `cpu-only` with `reason: "gpu-fit-gate-blind"` for exactly this reason).

---

## Shape of the fix

**1. The estimate must take the backend.** Add an offload input to `estimateMemory` — the number
of layers offloaded and the layer count, or the offloaded fraction; not a boolean, because the
governor will want partial. Split the weight term:

- `weightsResidentMiB` — the CPU share, stays evictable,
- `weightsOffloadedMiB` — the GPU share, joins the non-evictable total.

Keep `nonEvictableMiB` as *the OOM-deciding number* so every existing caller keeps its meaning.

**2. Resolve the backend before the fit, not after.** Move backend resolution ahead of context
resolution in `resolveEngineTuning`, or thread the resolved policy into it. All four call sites
(`deviceProfile.ts:252,350,431`, `deviceTuning.ts:550`) must pass the same value — a gate that is
right in one path and blind in another is worse than uniformly blind, because it looks fixed.

**3. The budget side is right — but only because this is a pre-load decision.**
`profile.availableMemoryBytes` is `MemAvailable`, system-wide, and it *does* see driver
allocations. Only the estimate is wrong; do not touch the budget.

⚠️ **That holds strictly before a load.** §7.44 (`HARNESS_FINDINGS.md:2048`) withdrew a night's
worth of conclusions over this: `MemAvailable` counts reclaimable page cache, **and a mmapped
model's resident weights are that cache**, so with a model already loaded it reports the model's
own residency back as headroom. `HARNESS_FINDINGS.md:2013` states the split — pre-load availability
decides a *load*; `MemFree`/`RssAnon`/`RssFile`/`majflt` diagnose a *running process*. And
⛔ **never gate on `MemFree`**: the kernel keeps it near zero by design (0.08–0.53 GB on every
healthy arm here), so a gate on it refuses everything.

**Consequence for the governor:** a mid-session re-check happens *with a model resident*, which is
precisely where `MemAvailable` is invalid. The recurring check therefore cannot reuse this budget.
It needs a different one, and nobody has designed it. Flagged here so it is not discovered late.

**4. Headroom under offload is not the same 512 MiB.** `FIT_HEADROOM_MIB` is anchored to the
measured compute term on CPU. Whether it holds when the driver is allocating is unknown — treat it
as an open question with a named owner, not a constant to reuse silently.

## The shape of the estimate (settled) and the calibration (not)

**Linear in offloaded BYTES, stepped in offloaded LAYERS.** From the engine side, and it decides
the API: `-ngl N` moves *whole* layers including **all** their experts (routing is dynamic, so no
subset is knowable ahead), and on a KEXP the experts are ~86–96% of a layer's bytes.† LFM2.5 is a
hybrid conv/attn stack, so layers are heterogeneous — cost as a function of *layer count* is
non-constant by construction. As a function of bytes it should be ~linear.

⛔ **So the term must not be `layers × constant`.** Take bytes.

    fixed_overhead + Σ(offloaded_tensor_bytes) × k + KV(ctx, offloaded_attn_layers) × k′

- `fixed_overhead` — a one-time jump at the *first* offloaded layer: CL runtime, compute buffer,
  staging. Does not scale.
- `k` — driver padding/tiling. **The unknown.** Not our kernels: the engine side certifies the
  q2/q3 GPU storage as a bijection of the file format, so expect no inflation from them.†

† **Unsourced in this repo.** The three engine-side claims marked † — the ~86–96% expert share,
the storage "bijection", and the 6.4 GB full-GPU kernel reboot cited earlier — come from the
engine session's own message (2026-08-23), not from a file anyone here has read. They are the
reason to *expect* linearity in bytes; they are not evidence of it. If the estimate's shape turns
out to matter, get them confirmed against `kalsa-moe-experiments` before building on them.
- `k′`, kept separate because **KV is charged only for offloaded attention layers and scales with
  ctx** — folding it into `k` makes the factor drift with context length.

Per-tensor and per-layer byte counts are exact from the GGUF. The engine side's v1.5 accounting API
(queued, #29 residue) will expose per-layer bytes for this gate — **a dependency, not an
assumption**: until it lands, derive from the GGUF directly or the term cannot be computed.

**The single calibration point we have, and what it is worth.** §7.18 (`HARNESS_FINDINGS.md:3880`,
measured 2026-08-19) is the source of the −3.44 GB observation, and it is attributed there:

| | |
|---|---|
| model | dense **Qwen3.5-4B Q4_K_M**, 2.83 GB, **+ 672 MB F16 vision projector** (multimodal entry) |
| offload | `NGL=99` |
| `MemAvailable` | 4.02 GB → **583 MB** (−3.437 GB) |
| app `RssFile` | 136 MB → **26–33 MB** |
| app `RssAnon` | 95 MB → 121–183 MB |
| `VmSwap` | 26 MB → **1.02 GB** |

File bytes 2.83 + 0.672 = **3.502 GB** against a 3.437 GB fall → **k ≈ 0.98**, i.e. ~1:1.

⚠️ **That ratio is unit-dependent and the units are undeclared.** It assumes §7.18's figures are
SI GB. Read as GiB the same numbers give **k ≈ 1.05**. And if the ~1 GB of swap growth is counted
as memory the system actually had to find, the gross draw is ~4.4 GB and **k ≈ 1.27**. Three
defensible readings between 0.98 and 1.27 — which is another way of saying this is not a
calibration.

⚠️ **The vision projector may not even have been offloaded.** `use_gpu` is false on Android for
the multimodal context (`LlamaService.ts:1448`), so the 672 MB F16 projector plausibly stayed on
CPU. If so the offloaded bytes were 2.83 GB, not 3.502 — and k jumps again. **Unverified**: it
needs the run's actual config, which §7.18 does not record.

⚠️ Three further reasons this is a sanity check and not a calibration:
1. **`VmSwap` grew by ~1 GB.** Part of the pressure was absorbed by swap, so the `MemAvailable`
   delta is not a clean read of what the driver took.
2. **ctx is not recorded**, so the KV share cannot be separated from the weight share — exactly the
   split `k′` exists for.
3. **The model is dense and multimodal.** It says nothing about expert behaviour, which is the
   whole reason the MoE case might differ. One point, wrong family.

⛔ **Correct a plausible-but-wrong attribution before it spreads:** the arithmetic also fits
LFM2.5-8B-A1B-KEXP (3.10 GiB + ~0.34 GB ⇒ k ≈ 1.11), and that guess was made. It is wrong — §7.18
names the model. Do not use k ≈ 1.11.

## ✅ Superseded 2026-08-24: the sweep ran, and it gives real constants

The engine side ran the `-ngl` sweep on the S23 (q44 / #31, math audit clean, raw in
`results/ngl_sweep_s23/`). **The shape above is confirmed; the single-point k is not.**

| ngl | offload | k over the set | k incremental |
|---:|---:|---:|---:|
| 7 | 7/25 | 1.74 | 1.70 |
| 13 | 13/25 | 1.43 | 1.05 |
| 19 | 19/25 | 1.27 | 0.88 |
| 99 | 25/25 | 1.05 | 0.09 |

**k is not a constant — and that is the point.** It falls as offload grows, which is exactly what a
fixed overhead amortised over more bytes looks like. Their fit:

    cost ≈ ~750 MiB fixed (Adreno prealloc) + ~1.0 × offloaded bytes

**Gate constant to implement:** `800 MiB + 1.05 × offloaded_bytes` — conservative, safe on all five
measured points, and **~2.3 GB tighter at full offload** than the multiplicative 1.7–2.0 that a
naive reading of the low-ngl k values would have produced. ⚠️ Their own caveat stands: validate on
a second model and a second device before trusting the constants.

⛔ **The ~750 MiB is present at `ngl 0` too** — Adreno driver prealloc, not a cost of offloading.
**Answered for our build, and the answer is device-dependent:**

`rnllama/CMakeLists.txt:119-121` turns OpenCL on only for targets whose name ends in `_opencl`:

```cmake
set(ENABLE_OPENCL OFF)
if (${target_name} MATCHES ".*_opencl$")
    set(ENABLE_OPENCL ON)
endif ()
```

so exactly one variant — `librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so` — carries the backend.
Which variant loads is decided by CPU features at runtime (`RNLlama.java:201`), so:

- **i8mm-capable phones (S23 class)** load the `_opencl` variant → the backend is present → they
  plausibly pay the ~750 MiB **even at `n_gpu_layers=0`**.
- **Phones without i8mm (the Jelly, Helio G99)** load `librnllama_v8_2_dotprod.so`, verified to
  contain no OpenCL → they pay nothing.

⚠️ **So the fixed term is not a fleet constant: it is a property of the loaded `.so`.** A gate that
adds 750 MiB everywhere overcharges half the fleet; one that adds it nowhere undercharges the other
half on the CPU path. The estimate needs to know which variant loaded — which is the same fact
audit finding F3 says the app currently cannot observe, because `tryLoadLibrary` swallows the
failure silently. **Fixing that observability is a prerequisite, not a nice-to-have.**

Still unmeasured: whether the S23's 750 MiB is paid on *registration* or only on first offload. One
`ngl 0` run on an `_opencl` build answers it.

**Both blindnesses are now measured, not argued:**
- mmap weights **do not touch `MemAvailable`** — ΔMA 35 MiB while `RssFile` was 3.1 GiB at ngl 0.
- GPU copies **do not touch RSS** — `RssAnon` flat at ~80–110 MiB across every point.

So the §7.44 split is confirmed from the other direction: **`MemAvailable` is the right metric for
the driver cliff, `RssFile` for residency.** That is the division `memoryPressure.ts` already
implements.

**Retire the §7.18 single point as a calibration.** Its 0.98 / 1.05 / 1.27 spread came from having
no fixed term to attribute the overhead to; with ~750 MiB fixed the ambiguity mostly dissolves.
Keep it only as a sanity check.

The arm-464s protocol with per-turn `MemAvailable` is pushed
(`scratchpad/agents/q45-arm464-acceptance/PROTOCOL.md`) — that is the validation series for
`residentHeadroomBytes`, free of a dedicated session.

## What the governor will additionally need (not in scope here)

The eventual design moves work between CPU, GPU and NPU **mid-session** on thermal state. That
makes fit a **recurring** check, not a load-time one: an offload transition changes the memory
picture while a model is resident. This plan does not build that. It only ensures the number the
governor will consult is not structurally wrong. Flagging it so the estimate is not designed as
load-time-only and then rewritten.

## Out of scope

- The per-phase governor and any thermal policy.
- The `-ngl {¼, ½, ¾, full}` sweep — a device session under protocol #18, owned by the engine side.
- Turning the GPU on. That is the *next* change, gated on this one plus the calibration.
- iOS/Metal. `gpu-metal` already offloads 99 layers today and is unaffected by this defect only
  because nobody has measured it there either — worth a separate look, not a silent extension.

## Verification that must be able to fail

1. A model that fits on CPU and **does not** fit under full offload returns `does_not_fit` for the
   offloaded case and `fits` for the CPU case, from the **same** inputs but different offload.
   Today both return `fits`; if the new test passes before the change, it is not testing anything.
2. All four call sites agree: same model, same device, same verdict, whichever path asks.
3. On-device: load the configuration that killed the app on the S23 and confirm the gate now
   refuses it **before** load. A green unit test is not this.

   ⛔ **As written this criterion cannot pass or fail today, and that is itself a finding.** The
   §7.18 kill came through a bench `engineOverride` with `NGL=99`, and that path does not consult
   the pre-send gate at all — `applyEngineOverride` (`engineParams.ts:92-108`) writes
   `n_gpu_layers` straight into the params. So there is no refusal for the estimate to trigger.
   Either the criterion is restated against a path the gate actually guards, or the bench override
   is made to consult it. Do not "fix" this by weakening the criterion until it passes.
4. CPU-only behaviour is byte-identical to today — same verdicts, same `n_ctx` chosen, existing
   tests unchanged and still passing without edits. If a CPU test needed editing, the split leaked.
