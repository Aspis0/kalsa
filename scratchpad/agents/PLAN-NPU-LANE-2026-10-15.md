# PLAN — the NPU prefill lane on the Xiaomi: a regression hunt, not a research project

**Date:** 2026-10-15
**Coordinator:** governor session `0dc81aaa`
**Status:** plan written, nothing dispatched to a coder. Every claim below was re-verified by the
coordinator against the file on disk after the delegates reported it.
**Scope reports:** `scratchpad/agents/npu-prefill-xiaomi-history/E1-SCOPE.md` (85 L),
`scratchpad/agents/one-model-production/E2-SCOPE.md`,
`scratchpad/agents/gpu-layers-history/VERDICT.md`.

---

## 0. Owner policy, stated by the owner on 2026-10-15

> **No OOM. No reboot. Degrade gently.**

This is a policy, not an option in a menu. It forecloses "force the fit gate and see what happens".
The fallback ladder is written before it is needed, and the device is never asked to absorb a
surprise allocation.

**Degrade gently, concretely, means:** when the system cannot afford the best leg, it steps *down a
leg* (GPU -> NPU -> CPU) while keeping the device safe. It does **not** mean "drop to zero layers and
rely on the CPU", and it never means "let the allocation fail and hope".

---

## 1. The finding that changes the plan

**The NPU prefill lane on the Xiaomi 14 is already measured, already proved in-app, and worked four
days ago.** This session started as a search for missing evidence and ended with the opposite
conclusion.

| Fact | Citation | Verified |
|---|---|---|
| NPU prefill on Xiaomi 14 (SM8650 / 8 Gen 3, Hexagon v75, Adreno 750), 2026-09-29 | `xiaomi14-3way/REPORT.md:1,3` — *"first NPU v75 run"* | yes |
| Prefill times | `xiaomi14-3way/REPORT.md:18` — `A prefill NPU/HTP, ms \| 1447.97 \| 1558.10` | yes |
| The ratio | `xiaomi14-3way/REPORT.md:22` — *"NPU prefills **5.2x faster than CPU and 4.7x faster than OpenCL**"* | yes |
| **In-app, on the owner's phone, 2026-10-11** | `xiaomi-g2-inapp-233486dd/REPORT.md:3` — *"14 turns completed in-app on the owner's Xiaomi 14, unplugged, **prefill and decode on the NPU, no crash**"* | yes |
| The route that ran | same file `:26` — `engine_prefill NPU`, `engine_decode NPU`, `npu_device HTP0`, 0 CPU / 0 GPU decode tokens | yes |

The S23 figure (653.98 tok/s NPU vs 138.44 GPU, 4.72x, `s23-heat-arms-engine/REPORT.md:85-87`)
is the **same ratio** as the Xiaomi. Two SoCs, same result. This is a property of the legs on
Adreno + Hexagon, not a quirk of v73.

**Today (2026-10-15) the same phone loaded with `n_gpu_layers = 0` and prefilled 1760 tokens in
109.4 s.** The lane that was running on 2026-10-11 was not running today.

**Therefore this is a regression between two builds, not a gap in knowledge.** The plan is a hunt,
not an exploration.

---

## 2. Corrections to the coordinator's earlier statements (recorded deliberately)

Three premises from earlier today were wrong and inverted the plan. They are written down so the next
session does not repeat them.

| Claimed earlier | Actual | Citation |
|---|---|---|
| "the NPU prefill lane was not wired" | `npu_lane_enabled` is computed, not hardcoded; the app's own tests assert it is `true` for a dense load | `governorInputs.ts:362-365`; `rn-llama.cpp:444` |
| "only SM8550/V73 has NPU prefill data" | SM8650/V75 has three CLI cells **and** an in-app session | `xiaomi14-3way`, `q55-v75-npu-correctness`, `q67-c1-htp-v75-load`, `xiaomi-g2-inapp-233486dd` |
| "the one-model form is test-only, two-model is the shipped shape" | **inverted**: one-model/one-copy is the primary path; two-model is the fallback when no leg set is given | E2 Q2; `llama-model.cpp:1195-1199` |
| "two models exist because a tensor can only live on one backend" | they exist because two-copy is the *default*, not because placement forbids sharing | E2 Q2 |

The one-copy mechanism, quoted (`llama-model.cpp:1195-1199`):

> *"The weights HOST buft of a device in shared-weights mode: **the one-copy buffer the GPU leg
> imports** through the generic dma-buf accessor of the same registry. Null when no device offers
> both, which is **every device but Hexagon, and every device in two-copy mode**."*

That single comment explains the 2026-10-11 run. Hexagon + shared-weights mode = one weight set,
shared with the GPU leg by dma-buf import. `rn-llama.cpp:444` confirms the gate:
`onecopy_requested = leg_set.one_copy && governor_params.npu_lane_enabled`.

---

## 3. The switch: where the lane is decided today

`src/engine/governorInputs.ts:355-370` (app repo, verified):

```ts
const androidOk = npu?.android ?? false;
const visionOk  = !npu?.hasMmproj;
const arch      = npu?.htpArch ?? null;
const kindOk    = modelKind(modelEntry) !== "MoE";
const fitOk     = npuLane.fit === "Fit";
const autoOk    = androidOk && visionOk && arch !== null && arch >= 73 && kindOk && fitOk;
const laneEnabled = lanePref === "auto" ? autoOk : lanePref === "on" ? (androidOk && visionOk && fitOk) : false;
const enabled  = force || GPU_PREFILL_CORRECT[generation] || laneEnabled;
```

and the comment the owner of that code left on `:366-369`:

> *"The governor also loads lane-only: a generation whose GPU prefill is not qualified (Unknown) still
> runs prefill on HTP0 with decode on CPU... when both are false the Android-only `n_gpu_layers` guard
> lands the load on CPU."*

That comment describes the 2026-10-11 configuration working. **Today `enabled` came out false and the
load landed on the CPU guard.** Candidates, in order of suspicion:

1. **`fitOk` false** — `npuLane.fit !== "Fit"`. The lane has its own fit estimate and its own
   availability number, separate from `gpu_fit`. A `gpu_fit=NoFit` does **not** imply
   `npu_fit=NoFit`, and today the observed log carried only `gpu_fit=NoFit`.
2. **`arch`** — if `npu.htpArch` came back null or < 73 on this device, `arch !== null && arch >= 73`
   fails and the whole lane is off regardless of everything else.
3. **`kindOk`** — only if the ship model is classified MoE. The Stage 0 ship model is
   LFM2.5-2.6B, expected dense.
4. **`htp_experts_readable: false`** hardcoded at `:403` — relevant to MoE only, but it is a hardcoded
   false with no app-side signal behind it, and it is the one thing E2 could not find a producer for
   anywhere in the tree.

**Step 1 below exists to turn this list into one known value instead of four suspects.**

---

## 4. The steps

Ordered. Each is cheap before it is expensive; each says what it decides and what it costs.

### Step 1 — Get today's `npu_fit` and `htpArch`. **Decides the whole hunt. Zero code.**

One line of evidence. Two routes, in order of cost:

- **1a. Read it from the app's own log** if a `KALSA_GOVERNOR_PLAN` / governor stats line with `npu_fit`
  or `npu_device` survived in the logcat ring from today's session. Free, no phone, no risk.
- **1b. If not**, a single short run on the Xiaomi with the marker-fixed build, capturing the governor
  plan line. Requires the phone: unplugged, battery >= 30 %, not charging, guard running.

**Pass:** `npu_fit=Fit` and `htpArch=75`. Then the regression is *not* in the lane gate and steps 3-5
are wrong — go straight to step 2.
**Fail:** we learn which of the four candidates fired. That is the whole point.

### Step 2 — Diff `233486dd` (working, 2026-10-11) against `aa789620` (broken, today). **Read-only.**

A `git log` / `git diff` over the governor path between the two builds: `governorInputs.ts`,
`LlamaService.ts` load path, the binding's `rn-llama.cpp` onecopy/lane handling, the vendored
`llama-model.cpp` / `llama-governor*.cpp`. No device, no edits, pure archaeology.

**Pass criterion:** name the commit that changed lane eligibility or one-copy admission. If no such
commit exists in the range, the regression is state-dependent (memory pressure on the day), not
code-dependent — which would make it a fit-estimation problem after all.

### Step 3 — Check the TILE32 trap. **Do not skip; it is a live hazard, not a theoretical one.**

`ggml/src/ggml-backend.cpp:1554-1562` (verified):

```cpp
if (ggml_backend_tensor_weight_layout(src) != GGML_WEIGHT_LAYOUT_NATIVE) {
    GGML_LOG_ERROR("%s: weight %s (%s) has no backend for %s in this scheduler and cannot be copied", ...);
    sched->split_failed = true;
```

A **non-native TILE32 weight with no matching backend is refused outright**, and the scheduler sets
`split_failed`. HTP weights are exactly the kind this fires on. It worked on 2026-10-11, so the
condition is *reachable but not always taken* — which means any change to device lists, scheduler
composition, or lane membership can flip it from silent to fatal.

**Pass:** confirm from the 2026-10-11 raw logs that the one-copy path was genuinely taken (not merely
permitted), and identify what would make `split_failed` fire on the same device.

### Step 4 — The three-rung ladder. **This is the owner's "degrade gently", already specified.**

`governor-plan-fable/PLAN.md:64-66`, milestone 3, never implemented:

> MODERATE = prefer the cooler backend · SEVERE = coolest only + no prewarm · CRITICAL unchanged ·
> drop the CPU fallback for LOWBAT prefill when an accelerator qualifies.

Today's code does the **opposite** (`llama-governor-policy.cpp:379-383`, verified):

```cpp
if (!valid_schema(params_) || !profile_valid_ || !have_profile_ ||
    state_ == CRITICAL || state_ == Invalid ||
    state_ == LOWBAT) {
    return llama_governor_engine::CPU; // safety preempts
}
```

LOWBAT sends prefill to **the hottest backend**. And the ladder itself is shorter than it looks: the
states are FAST / WARM / CRITICAL / Invalid / LOWBAT — MODERATE and SEVERE were collapsed into a
single COOLMODE (Fable contradiction a). So today there is no ramp to degrade along; there is a
switch.

**This is the step that encodes the owner's policy in the code, and it is worth doing independently
of the regression**, because it is a standing requirement, not a bug fix.

### Step 5 — Decide the one-copy / platform-status merge order. **Owner's call, blocking.**

Fable contradiction (f), still open:

> `feat/governor-platform-status` (the one on the phone) is not in fork main;
> `feat/governor-onecopy` lacks the platform-status commits.

Any one-copy work needs both lines together. Which goes first is an owner decision with a
tradeoff (phone behaviour vs engine cleanliness) that is not mine to make.

---

## 5. What this plan explicitly does NOT do

- **No partial offload.** Settled by `gpu-layers-history/VERDICT.md`: on this phone ngl 8 is
  approximately CPU speed (`gpu_prefill_recheck_xiaomi/report.md:178`). It is a dominated
  configuration. The choice is full offload or the NPU lane, not an intermediate layer count.
- **No loosening of the fit gate.** Owner policy forbids the OOM risk, and the q44 constants
  (`800 MiB + 1.05×bytes`) are single-device, single-model, and their own report says they need a
  second model/device before shipping. Re-deriving them from the S23 again would repeat a warning
  the lab already wrote down.
- **No swap-aware gate.** Closed by product decision on 2026-09-20
  (`analysis/XIAOMI-QWEN-FITGATE-…md:82-83`): compressed RAM counted as free buys thrashing.
- **No coder dispatched before step 1 and step 2 report.** If the lane was merely switched off by a
  fit estimate, the fix is an estimate and a gate — not the load shape. Dispatching a coder now would
  be writing code for a cause we have not identified.

---

## 6. Open owner decisions

| # | Decision | Why it is the owner's |
|---|---|---|
| 1 | Merge order of `feat/governor-onecopy` vs `feat/governor-platform-status` | phone behaviour vs engine cleanliness; a real tradeoff |
| 2 | Whether the cold-process re-run is worth a phone session *before* step 2 | step 2 may answer it for free |
| 3 | Whether step 4 ships on its own, decoupled from the regression fix | it is a standing policy requirement, but it touches the engine |
| 4 | `htp_experts_readable` — produce a real signal, or keep it false and gate on `kindOk` alone | only relevant for MoE, and MoE is parked |

---

## 7. Verification ledger

Every citation in this plan was opened by the coordinator after the delegates reported, with exit
codes. Delegated claims are not evidence until re-read.

| Claim | Command | Result |
|---|---|---|
| Xiaomi NPU prefill arms | `sed -n '1,3p;18p;22p' scratchpad/agents/xiaomi14-3way/REPORT.md` | 0 |
| In-app NPU prefill+decode, 14 turns | `sed -n '1,8p;26p' …/xiaomi-g2-inapp-233486dd/REPORT.md` | 0 |
| One-copy = Hexagon dma-buf import | `sed -n '1174,1180p;1195,1201p' …/llama-model.cpp` | 0 |
| One-copy gated on the lane | `sed -n '444p' …/rn-llama.cpp` | 0 |
| TILE32 non-native -> `split_failed` | `sed -n '1554,1562p' ggml/src/ggml-backend.cpp` | 0 |
| Lane gates today | `sed -n '355,370p' src/engine/governorInputs.ts` | 0 |
| LOWBAT -> CPU prefill | `sed -n '379,383p' …/llama-governor-policy.cpp` | 0 |
| Fable milestone 3 = the gentle ladder | `sed -n '64,66p' …/governor-plan-fable/PLAN.md` | 0 |