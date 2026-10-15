# PLAN — the NPU prefill lane: why it stopped, and what fixes it

**Date:** 2026-10-15
**Coordinator:** governor session `0dc81aaa`
**Status:** plan written. No coder dispatched — the fix lands in the app repo, which belongs to the
brain session, so it needs their coordination and the owner's OK.
**AMENDED 2026-10-15, minutes after first commit (`be630258`).** Version 1 of this document called the
problem a *code regression between APK `233486dd` and `aa789620`*. **That was wrong.** Same build,
different available memory. Section 1 records the correction so the next session does not inherit it.

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

## 2. What is genuinely proven, and it is a lot

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