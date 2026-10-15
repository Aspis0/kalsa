# PLAN — the NPU prefill lane: why it stopped, and what fixes it

**Date:** 2026-10-15
**Coordinator:** governor session `0dc81aaa`
**Status:** plan written. No coder dispatched — the fix lands in the app repo, which belongs to the
brain session, so it needs their coordination and the owner's OK.
**AMENDED 2026-10-15, minutes after first commit (`be630258`).** Version 1 of this document called the
problem a *code regression between APK `233486dd` and `aa789620`*. **That was wrong.** Same build,
different available memory. Section 1 records the correction so the next session does not inherit it.

**AMENDED AGAIN 2026-10-15 (`8a77a82f` -> this). The one-line gate fix in section 4 is a NO-OP, and
the coordinator was wrong.** The brain session reviewed the brief, re-read every cited line, and
refused it under the stop condition. The coordinator re-verified their objection and it holds. See
section 1bis: the NPU lane is priced as a strict *superset* of the GPU lane, so
`gpu_fit === NoFit` implies `npu_fit === NoFit` **always**, and no gate change can ever make the
lane rescue a GPU-NoFit load. The real defect is a ~2396 MiB phantom charge in `lanePrice`.

**Scope reports:** `npu-prefill-xiaomi-history/E1-SCOPE.md`, `one-model-production/E2-SCOPE.md`,
`gpu-layers-history/VERDICT.md`. Every citation below was re-opened by the coordinator after the
delegates reported it.

---

## 0. Owner policy, stated by the owner on 2026-10-15

> **No OOM. No reboot. Degrade gently.**

Degrading gently means **stepping down a leg** — GPU -> NPU -> CPU — while keeping the device safe.
It does not mean dropping to zero layers and letting the prefill take 109 seconds. It never means
letting an allocation fail and hoping the kernel copes.

The code does not do this today. Section 3 is exactly where it stops.

---

## 1. CORRECTION: this is not a regression

Version 1 of this plan asserted the lane "worked on 11/10 and stopped by 15/10, therefore hunt the
diff between two builds". That inference was wrong, and here is the evidence that killed it.

**Same APK, two different memory readings, today, same phone.**

At engine init, during the Stage 0 run (`raw/harness.log:63-64`, cell
`xiaomi-stage0-obs-aa789620`, device `23127PN0CG`, SM8650):

```json
{"gpu_fit":"Fit","npu_fit":"Fit","npu_device":"HTP0","npu_lane":"auto",
 "required_mib_without_repack":3385.06,"available_mib":5555.19,"available_src":"fresh", ...}
```

**`npu_fit: "Fit"`, `npu_device: "HTP0"`, 5555.19 MiB available.** The lane was live. The run then
completed 6 turns / 8 observation rows with 100 % NPU decode and no problem.

Later the same build, same device, same session:

```json
gpu_fit=NoFit available_mib=3004.93 required_mib_without_repack=3385.06
```

**Available memory fell by ~2550 MiB between the two moments.** That single fact explains everything:
there is no commit to hunt, because no code changed. The gate is behaving as written; the memory
underneath it moved.

The version-1 hypothesis list (`fitOk` false, `htpArch` null, `kindOk` false,
`htp_experts_readable` false) is **void**. At init, every one of them was healthy.

---

## 1bis. The gate fix is a no-op; the real defect is a phantom charge

Found by the brain session (`dab6be60`) reviewing the coordinator's brief, and re-verified by the
coordinator. Three independent lines of evidence, all coordinator-confirmed on disk:

**1. The lane is priced as a strict superset of the GPU lane, so the lane can never rescue a
GPU-NoFit load.** `src/engine/governorInputs.ts:199-205`:

```ts
  const requiredMiB =
    priced.nonEvictableMiB +
    800 +
    (1.05 * offloadedBytes) / MIB +
    priced.computeMiB +
    priced.kvMiB;
```

and `LlamaService.ts:2537` and `:2669` both set `offloadedBytes: modelInfo.sizeBytes`
**unconditionally** — the full model size, whether or not a GPU leg exists.

**2. The lane then adds the HTP copy on top of that.** `governorInputs.ts:38`
`NPU_PREFILL_EXTRA_MIB = 219`, applied at `:264` whenever the lane is requested.

**3. So lane-required >= gpu-required + 219.** Today's numbers, from `xiaomi-stage0-obs-aa789620/raw/harness.log:63-64` and
`governor-nofit-prefill/REPORT.md:16,22`:

**Read the requirement as the LANE's, not the GPU's.** `buildGovernorPlanLog` already folds the
+219 into what it prints (`governorInputs.ts:273-274`,
`required_mib_without_repack: roundMiB((withoutRepack?.requiredMiB ?? 0) + extraMiB)`), and it is
keyed on the **pref**, not on the fit: `npu_lane` is documented as *"the effective pref ASKED for,
not the resolved lane"* (`governorInputs.ts:279-282`). The init line prints `"npu_lane":"auto"`, the
pref is a user setting and did not change between 11:06 and 14:35, so `extraMiB = 219` at both
moments. `lanePrice` does not read available memory at all. **An earlier version of this table
counted the 219 a second time; that was wrong and is corrected here.**

| quantity | value | derivation |
|---|---:|---|
| `required_mib_with_repack` | 4905.12 | harness.log:63 |
| `required_mib_without_repack` | 3385.06 | harness.log:63 — **this is the lane, 219 included** |
| implied `weightsMiB` | **1520.06** | 4905.12 - 3385.06; extraMiB and KV cancel |
| `available_mib` at refusal | 3004.93 | `governor-nofit-prefill/REPORT.md:22` |
| **lane shortfall** | **380.13** | 3385.06 - 3004.93 |
| GPU required | **<= 3166.06** | 3385.06 - 219, and less again if the lane KV went q4 -> q8 |
| GPU shortfall | **<= 161.13** | 3166.06 - 3004.93 |
| GPU weight term charged to the lane | **2396.06** | 800 + 1.05 x 1520.06 |
| lane required with that term removed | **989.00** | 3385.06 - 2396.06 |
| **headroom the lane would then have** | **+2015.93** | 3004.93 - 989.00 |

**The lane is today charged ~2396 MiB of GPU weight upload it does not have, and is refused for
missing 380 MiB.** That is the bug, and it is not a gate problem.

**Do not mix in the S23 numbers.** The `4358.70 / 2998.06` pair that appears in a `gpuFit` code
comment (and `required_mib_with_repack 4518.12 / without 2998.06` in `governor-npu-prefill/DESIGN.md:28`)
belong to a Galaxy S23 run, not this phone. They are a different device, a different model and a
different date. They are not comparable to any row above.

**Why the term should not apply.** The `800 + 1.05 x offloadedBytes` term prices the **Adreno**
weight buffer. On a lane-only Hexagon load there is no GPU leg, so no such buffer is allocated —
the engine says so: `llama-model.cpp:1195-1199`, *"the one-copy buffer the GPU leg imports ... Null
when no device offers both, which is every device but Hexagon, and every device in two-copy mode"*.
The one-copy comment is about the GPU leg *importing* the shared buffer; with no GPU leg, nothing
imports it and nothing allocates it.

**So the fix is a pricing change, in the engine/governor, not a one-line app gate.** And it is
exactly the OOM-protection tension the owner named: lowering that charge weakens a guard, so it must
be scoped to the case where the buffer genuinely does not exist, and must keep charging it when a
GPU leg IS present.

### 1ter. The phantom charge, corrected like for like — and a second, larger defect

Raised by the brain session (`dab6be60`) and verified here. Three corrections to the 870.19 figure,
which was wrong because it compared unlike things.

**1.1 The 870.19 is not a like-for-like comparison.** It set `800 + 1.05 x W` = 2396.06 (a term
that **excludes** the 219) against a measured total of 1525.87 MiB (which **includes** the HOST
219.75). Compared properly:

| | MiB |
|---|---:|
| weight-side charge: `1.05 x 1520.06` + 219 | 1815.06 |
| measured weights (TILE32 + HOST) | 1525.87 |
| **weight overcharge** | **289.19** |
| the `800` | **unknown** — not a weight term, and a lane-only load still pays FastRPC, the HTP session, the skel and rpcmem, so it is not zero |

**So the real phantom is somewhere between 289 and 1089 MiB. The weights audit line cannot place it.**

**1.2 HOST is not a prefill copy.** `legs_report.grep:10`, the line before the audit, reads
`shared weights: token_embd.weight reused for output.weight from HTP0-HOST-W`. HOST is the **tied
embedding/output table**. The 219 matches numerically and its origin is confirmed, but the code's
explanation of what it buys is wrong.

**1.3 A second and larger defect: compute and KV are counted twice.** This one applies to the
**GPU fit as well as the lane**, so it is OOM-guard territory.

- `memoryEstimate.ts:164` — `const nonEvictableMiB = anonWeightsMiB + repackMiB + computeMiB + kvMiB;`
- `governorInputs.ts:199-205` — `requiredMiB = priced.nonEvictableMiB + 800 + 1.05*offloadedBytes + priced.computeMiB + priced.kvMiB`

`computeMiB` and `kvMiB` are inside `nonEvictableMiB` and are then added again. With mmap on,
`memoryEstimate.ts:158-162` sets `anonWeightsMiB = 0` and the without-repack path leaves
`repackMiB = 0`, so `nonEvictableMiB = compute + kv` and

```
requiredMiB = 2*(compute+kv) + 800 + 1.05*offloadedBytes
```

Solving from today's numbers: `3166.06 - 800 - 1596.06 = 770.00 = 2*(compute+kv)`, so
**`compute + kv = 385.00 MiB`, of which 385.00 MiB is the duplicate.**

| | MiB |
|---|---:|
| `compute + kv`, counted twice | **385.00** |
| today's lane shortfall | **380.13** |
| **margin if the duplicate alone were removed** | **+4.87** |

**The entire refusal is numerically explained by a duplicated term.** And note the second-order
finding: a **+4.87 MiB** margin is not headroom, it is a coin flip. Even if the double count is
removed, this lane has no comfortable margin on the Xiaomi at 3.0 GB available. That, not the fix,
is the thing worth knowing.

`gpuFit` (`:298-319`) calls `laneFit` -> `lanePrice`, and it is used for **both** the GPU lane
(`:331`) and the NPU lane (`:337`), so the double count is shared.

**The counter-hypothesis, which is not yet refuted.** The q44 calibration derived
`~750 MiB fixed + ~1.0 x offloaded bytes` as an affine reading. If that 750 was tuned to *absorb*
compute and KV, then the explicit `+ compute + kv` is redundant by design, not a bug. The q44 raw
data that settles it is present and needs no device:
`results/ngl_sweep_s23/device/kalsa_q44/points/{ngl0,ngl7,ngl13,ngl19,ngl99}/sampler.csv`
(columns `MemAvailable_kB, VmRSS_kB, RssAnon_kB, RssFile_kB, VmSwap_kB`).

**The ngl0 row argues against the counter-hypothesis.** At ngl0 the sampler shows
`RssFile 2801644 kB` with `RssAnon 640 kB` — weights file-backed, anon ~0 — and at ngl0 there is **no
Adreno buffer at all**. So the "750 MiB fixed, present even at ngl 0" cannot be Adreno prealloc; it
is the cost of the process being resident, which is where compute and KV live. If so, the code adds
them a second time. **This is an argument from one row, not a derivation** — the q44 per-point
re-read is the work that settles it, and it is offline.

### What the measurement cell must read

Because of 1.1 and 1.3, the weights audit line alone cannot decide the patch. The cell reads, before
and after a **lane-only** load of `a247afd6`:

- `shared weights: TILE32 ... HOST ... CPU ...` (weights only)
- **MemAvailable** — this is the number that decides it, because the fit compares against MemAvailable
- process PSS / RSS / RssAnon / RssFile, to separate file-backed from anon
- dmabuf / rpcmem totals if readable (`/sys/kernel/dmabuf/buffers`, `dmabuf_dump`); TILE32 rpcmem
  probably does not show in RSS but does lower MemAvailable

Cell 74 had a **GPU leg**; the pure lane-only case is still unmeasured, and that is the
configuration a fix would enable. It ran in-app on 2026-10-11 (14 turns, prefill and decode on the
NPU, no crash), so it is not a new risk on the daily driver.

**Until the MemAvailable delta and the q44 re-read are in, do not change `lanePrice`, and do not
touch the GPU fit.**

---


| Fact | Citation | Verified |
|---|---|---|
| NPU prefill on Xiaomi 14 (SM8650 / 8 Gen 3, Hexagon v75, Adreno 750), 2026-09-29 | `xiaomi14-3way/REPORT.md:1,3` — *"first NPU v75 run"* | yes |
| Prefill arm | same `:18` — `A prefill NPU/HTP, ms \| 1447.97 \| 1558.10` | yes |
| The ratio | same `:22` — *"NPU prefills **5.2x faster than CPU and 4.7x faster than OpenCL**"* | yes |
| **In-app on the owner's phone, 2026-10-11** | `xiaomi-g2-inapp-233486dd/REPORT.md:3` — *"14 turns completed in-app ... prefill and decode on the NPU, no crash"* | yes |
| Route that ran | same `:26` — `engine_prefill NPU`, `engine_decode NPU`, `npu_device HTP0`, 0 CPU / 0 GPU decode tokens | yes |
| Same ratio on the S23 | `s23-heat-arms-engine/REPORT.md:85-87` — NPU 653.98 vs GPU 138.44 tok/s | yes |
| One-copy is the primary path | `llama-model.cpp:1195-1199` — *"the one-copy buffer the GPU leg imports ... Null when no device offers both, which is **every device but Hexagon, and every device in two-copy mode**"* | yes |
| One-copy gated on the lane | `rn-llama.cpp:444` — `onecopy_requested = leg_set.one_copy && governor_params.npu_lane_enabled` | yes |

The 4.7x appears on **two different SoCs** (SM8550/v73 and SM8650/v75). It is a property of the legs
on Adreno + Hexagon, not a v73 quirk. That makes it safe to reason from.

---

## 3. ROOT CAUSE — one line, and `npu_fit` is not in it

`src/engine/LlamaService.ts:2558-2572` (app repo, verified):

```ts
const governorLoad =
  Platform.OS === "android" &&
  governorBase != null &&
  governorBase.enabled &&
  governorThermo != null &&
  governorThermo.sensor_valid &&
  governorBase.gpu_fit !== "NoFit" &&      // <-- line 2564
  !options.mmprojPath &&
  !streamExperts
    ? { ...governorBase, enabled: true as const, thermo: nativeGovernorThermo(governorThermo) }
    : null;
```

**`npu_fit` does not appear anywhere in that condition.** Verified by grepping the block: the only fit
term present is `gpu_fit`.

The consequence chain, all verified:

1. `gpu_fit === "NoFit"` (available memory fell to 3004.93 < 3385.06).
2. → `governorLoad = null` — **the entire governor is discarded**, and with it the NPU lane, which
   was Fit and available.
3. → at `:2725`, `...(governorLoad ? { governor: governorLoad } : {})` — no governor in the params.
4. → `n_gpu_layers: nGpuLayersForBackend(tuning.backend)` at `:2718`; the code's own comment at
   `:2717` reads *"metal→99 on iOS; cpu-only→0 on Android (HTP0 fatal)"* → **0**.
5. → prefill on the CPU: **1760 tokens in 109.4 s** instead of 2.0 s.

**A GPU memory shortfall took down a NPU lane that did not need GPU memory at all.** The lane
prefills 4.7x faster than the GPU on this phone, it needs ~219 MiB more than the OpenCL buffer
rather than a full second weight set (`governor-npu-prefill/DESIGN.md:29`), and it had already run 14
in-app turns without a crash.

And the intent was already correct in the code that builds the params —
`governorInputs.ts:366-369`, on this exact topic:

> *"The governor also loads lane-only: a generation whose GPU prefill is not qualified (Unknown) still
> runs prefill on HTP0 with decode on CPU ... when both are false the Android-only `n_gpu_layers`
> guard lands the load on CPU."*

**The design says "step down to the lane". The app gate at `:2564` says "throw everything away".**
That contradiction is the bug, and it is one boolean.

---

## 4. The fix, in shape

Not written. Dispatched to nobody. Stated here so the shape is reviewable first.

The gate should treat the **lane** as a separate, sufficient outcome from the **GPU**:

- when `gpu_fit !== "NoFit"` → current behaviour (GPU qualified, lane optional).
- when `gpu_fit === "NoFit"` **but** `npu_fit === "Fit"` and the lane's own gates hold (android,
  no mmproj, `arch >= 73`, non-MoE, `htp_trunk_readable`) → **load the governor with the lane**, no
  GPU prefill. This is the lane-only path `governorInputs.ts:366-369` already describes.
- when neither qualifies → today's fallback, unchanged.

Owner policy check: does this risk an OOM? **No, and that is the argument.** The lane-only path is
the one already measured in-app on this phone on 2026-10-11 (`npu_fit: "Fit"`, `npu_device: "HTP0"`,
14 turns, no crash). We are not inventing a risky configuration; we are restoring a configuration
that has run. The lane's fit is estimated by `npuLane.fit`, and the gate at `:2564` simply never
asked it.

**Two conditions must be enforced, or this is unsafe:**
1. The lane's fit must be `Fit`, not merely present. `:2564` must not become "always load".
2. The `htp_trunk_readable` / `arch >= 73` gates must be honoured — a lane on an unsupported arch is
   worse than no lane.

---

## 5. Standing work, independent of this bug

### 5.1 The three-rung ladder — Fable milestone 3, still unimplemented

`governor-plan-fable/PLAN.md:64-66`:

> MODERATE = prefer the cooler backend · SEVERE = coolest only + no prewarm · CRITICAL unchanged ·
> drop the CPU fallback for LOWBAT prefill when an accelerator qualifies.

Today (`llama-governor-policy.cpp:379-383`, verified):

```cpp
if (!valid_schema(params_) || !profile_valid_ || !have_profile_ ||
    state_ == CRITICAL || state_ == Invalid ||
    state_ == LOWBAT) {
    return llama_governor_engine::CPU; // safety preempts
}
```

LOWBAT sends prefill to **the hottest backend**, and the states are only
FAST / WARM / CRITICAL / Invalid / LOWBAT — MODERATE and SEVERE were collapsed into one COOLMODE
(Fable contradiction a). There is no ramp to degrade along. Worth doing on its own merits: it is a
standing requirement, not a side effect of this bug.

### 5.2 The TILE32 hazard — do not regress it

`ggml/src/ggml-backend.cpp:1554-1562` (verified): a weight whose layout is not
`GGML_WEIGHT_LAYOUT_NATIVE`, with no backend to take it, is **refused outright** with
`sched->split_failed`. HTP weights are of that kind. The one-copy path worked on 2026-10-11, so the
condition is reachable but not always taken. Any change to device lists, scheduler composition, or
lane membership can flip it from silent to fatal. Whoever writes the fix must not widen the lane's
device set.

### 5.3 Merge order — owner's call, blocking for one-copy work

Fable contradiction (f), still open: `feat/governor-platform-status` (the one on the phone) is not in
fork main; `feat/governor-onecopy` lacks the platform-status commits. Any one-copy work needs both.

---

## 6. What this plan refuses to do

- **No partial offload.** `gpu-layers-history/VERDICT.md`: on this phone ngl 8 ≈ CPU speed
  (`gpu_prefill_recheck_xiaomi/report.md:178`, *"Full offload is the right product setting"*). It is
  a dominated configuration. The choice is the NPU lane, not an intermediate layer count.
- **No loosening of the fit gate.** Owner policy forbids the OOM risk, and the q44 constants
  (`800 MiB + 1.05×bytes`) are single-device, single-model, with the q44 row itself saying they need
  a second model/device before shipping. Re-deriving them from the S23 again repeats a warning the
  lab already wrote down.
- **No swap-aware gate.** Closed by product decision, 2026-09-20
  (`analysis/XIAOMI-QWEN-FITGATE-…md:82-83`): compressed RAM counted as free buys thrashing.

---

## 7. Open owner decisions

| # | Decision | Why it is the owner's |
|---|---|---|
| 1 | Ship the `:2564` lane-only fix, and who writes it (the brain session owns the app repo) | touches the daily driver's load path |
| 2 | Merge order of `feat/governor-onecopy` vs `feat/governor-platform-status` | phone behaviour vs engine cleanliness |
| 3 | Whether the three-rung ladder ships in the same change or separately | it is a bigger engine change than the one-line fix |
| 4 | Whether to spend a phone session confirming the fix | it needs the marker-fixed build anyway |

---

## 8. Verification ledger

Delegated claims are not evidence until re-read by the coordinator. All exit 0.

| Claim | Command | Result |
|---|---|---|
| NPU prefill arms on Xiaomi | `sed -n '1,3p;18p;22p' xiaomi14-3way/REPORT.md` | 0 |
| In-app NPU prefill+decode, 14 turns | `sed -n '1,8p;26p' xiaomi-g2-inapp-233486dd/REPORT.md` | 0 |
| **`npu_fit: Fit` at engine init today** | `sed -n '63,64p' raw/harness.log` | 0 |
| One-copy = Hexagon dma-buf import | `sed -n '1195,1201p' llama-model.cpp` | 0 |
| One-copy gated on the lane | `sed -n '444p' rn-llama.cpp` | 0 |
| **The NoFit gate drops the whole governor** | `sed -n '2558,2572p' LlamaService.ts` | 0 |
| **`npu_fit` absent from that gate** | `sed -n '2558,2572p' LlamaService.ts \| grep npu_fit` | 1 (absent, as expected) |
| `n_gpu_layers` sourced from the backend | `sed -n '2717,2718p' LlamaService.ts` | 0 |
| TILE32 non-native -> `split_failed` | `sed -n '1554,1562p' ggml/src/ggml-backend.cpp` | 0 |
| LOWBAT -> CPU prefill | `sed -n '379,383p' llama-governor-policy.cpp` | 0 |
| Fable milestone 3 = the gentle ladder | `sed -n '64,66p' governor-plan-fable/PLAN.md` | 0 |

**Not verified:** the current value of `npu_fit` at the moment `gpu_fit` went NoFit. The logcat ring
rotated past it (it now begins at 14:35; the failure was earlier) and the app's own log line carries
`gpu_fit` but no `npu_fit` field. This is stated as an open item rather than assumed — though note
that `available_mib` moving by 2550 MiB is enough on its own to explain the outcome without it.