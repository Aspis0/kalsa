# Cell `gemm-f32-ship` — the corrected Adreno kernel reaches the app

Opened 2026-09-07. First step of the governor phase.

## What is already banked (do not re-measure)

ALIVE 56/57/59, cells `adreno-precision-bisect` / `adreno-acc-type` / `adreno-operand-b`,
QRD8650 / Adreno 750:

- The Adreno OpenCL Q4_0 GEMM (prefill path, `ne1 > 1`) computes the **product** in
  half. That is the cause of the GPU/CPU divergence measured by KL-divergence.
- Fix = `float8` accumulators **and** `c0 += convert_float8(B) * (float)dq.sN`.
  Median KLD 0.4538 -> 0.004736, same-top 62.8% -> 94.8%, prefill cost **0.659x**.
- Refuted by measurement, not by argument: attention, `-cl-fast-relaxed-math`,
  the accumulator on its own, dequantisation precision, stored operand precision
  (`b=float` costs 0.509x and buys nothing — discarded).
- Decode is not exposed (batch-1 GEMV is already fp32) and stays on the CPU (ALIVE 58).

## THE TWO DEFECTS — do not conflate them

The app's gate at `src/engine/governorInputs.ts:16` reads

    V75: false, // Adreno 750 f16/bf16-batched MUL_MAT defect: S5 runs 3-5 deterministic divergence @token 14 (ALIVE 38/39/48)

It names ONE cause. There are two, and only one is fixed:

- **(A) the f16 multiply in `gemm_noshuffle_q4_0_f32.cl`** — common to every Adreno,
  measured by KLD on the 750 (ALIVE 56/57), **fixed on `kalsa/gemm-f32-mul`**.
- **(B) a 750-only driver/compiler defect** — `test-backend-ops` MUL_MAT 905/925 with
  all 20 FAILs in one family, `f16|bf16 x f32, m=128 n=1 k=1056 k_v=2112` batched
  (ALIVE 38). It does NOT reproduce on the 735 (ALIVE 39), so it is per-GPU, not per
  generation. **Untouched by this work.**

So flipping `V75: true` is NOT a consequence of the fix. It is a hypothesis that the
in-app divergence was (A) and not (B). Only the logit oracle can decide it.

## Topology verified on disk 2026-09-07

- App branch `feat/governor-in-app` pins `Aspis0/kalsallama`
  `kalsa/governor-v0.3-on-2f3b24dee` @ **3bec271fd** — the fork already carries the
  native tri-engine governor (v0.2/v0.3), a per-turn prefill route, thermal
  degradation to CPU prefill, and the `bench_force_gpu_prefill` lever.
- `main` of the app (and `feat/moe-stream`) still pins **a0cabca6b**, whose vendored
  kernel reads `half8 c0` at line 38 — the current shipped APK carries the infidel one.
- `gemm_noshuffle_q4_0_f32.cl` is **byte-identical** at a0cabca6b, 2f3b24dee and
  3bec271fd. So the one-file fix grafts onto the governor pin unchanged, and the A/B
  differs by one file and nothing else.
- `deviceTuning.ts:374` still returns `cpu-only` on both branches: whole-model
  offload stays off. The governor's GPU prefill is a separate, per-turn mechanism —
  it does not go through `n_gpu_layers`.

## Steps

1. **Ship branch**: one file, 17 code lines, no macros, no env vars.
   Cut on a worktree off a0cabca6b for convenience, then **cherry-picked onto a branch
   off 3bec271fd** (the governor pin lineage) — the file being identical, the graft is
   exact. The env-var machinery stays on `kalsa/gemm-acc-probe` (@eefa27e30, pushed),
   which remains the measurement instrument.
   Gate: preprocessor equivalence against the measured `KALSA_GEMM_PREC=2` variant.
2. Bump the pin on `feat/governor-in-app` + re-vendor via `scripts/sync-kalsallama.sh`.
3. APK from CI (`apk.yml`, workflow_dispatch, ~35-45 min). Never a local Android build.
4. **The decisive measurement — logit oracle on a 750, PREREG first.** Re-run the S5
   protocol (ALIVE 55) with the fixed kernel on QRD8650 and read the verdict:
   - oracle PASS -> the in-app divergence was (A). Then, and only then, V75 may flip,
     and the speed question below becomes live.
   - oracle still FAIL -> (B) is the operative cause on the 750; the fix is still
     correct but does not unlock V75, and the 735/732/830 become the interesting
     boards because they do not carry (B).

## The prediction step 4 must falsify (secondary, only if the oracle passes)

The GPU prefill advantages recorded in-app were measured with the **infidel** kernel:
750 **1.78x** on the very pair that failed the oracle (ALIVE 55: 4.105 s vs 7.294 s),
735 1.72x, 732 1.63x. If the 0.659x cost transfers, they become ~1.16x / 1.13x / 1.07x
— near parity. If that holds, on V73/V75-class parts the GPU earns its place for
**thermals and for freeing the CPU**, not for speed, and the governor's policy changes
accordingly. A prediction to falsify, not a banked number.

## Traps to respect in step 4

- `LlamaService.ts:1438` retries at `n_gpu_layers = 0` after an init failure and logs
  `KALSA_GPU_FALLBACK`; the governor path has its own CPU degradation
  (`admit_prefill ... waiting for a safe tabled chunk` -> CPU). Either can publish a
  CPU number under a GPU label — check the route facts in the log, every turn.
- Thermal: on the 750 only the FIRST pair of a session fits under the 900 s cooldown
  ceiling (ALIVE 55). Budget one pair per session, or plan the cooldown explicitly.
- Two comments (`LlamaService.ts:1296`, `:1437`) claim "production now offloads on
  Android too (deviceTuning -> gpu-opencl)". They contradict line 374. Stale.

## Pre-registered reading of the oracle — fix this BEFORE the run

The oracle's binary verdict is the wrong instrument for this question, and reading it
naively would bank a false headline.

- The ALIVE 55 protocol forces **32 steps** and calls FAIL if the raw top-1 differs at
  any one of them. After the fix, same-top on the 750 is **94.8%**, not 100%. Expected
  flips over 32 independent-ish positions: **~1.7**. So a strict `oracle=FAIL` is the
  *likely* outcome even if the fix works exactly as measured, and it means nothing on
  its own.
- What must be read instead are the continuous metrics, whose pre-fix values are known
  from the very same board and protocol (ALIVE 55):
  - median |dp1| **0.0861** -> expect a collapse toward the CPU-vs-CPU floor (0.0000);
  - median max|dlogp| **3.444** -> expect a collapse;
  - steps beyond 0.02: **21/32** -> expect single digits;
  - top-1 flips where the CPU is confident: **8/32** -> expect 0-2.
- The CPU-vs-CPU control is already banked as an instrument check: 936/936 steps
  identical bit for bit, `max_dlogp = 0.0000`. Re-run it, it is free.

Decision rule, registered now: the fix is judged on the continuous metrics collapsing
to near the fp32 reference, NOT on the binary verdict. A flip count of 0-2 with the
medians collapsed = the in-app divergence was (A). Medians unchanged = (B) dominates
on the 750, and the interesting boards become 735/732/830, which do not carry (B).

## Competing readings of the existing evidence, stated before the run

Two facts pull in opposite directions and the run must arbitrate them:

- *Toward (B)*: on the 830 the oracle PASSED 4/4 with the SAME infidel kernel and the
  same ~15-token prefill chunk ("2+13"), while three different 750 boards failed
  deterministically at token 14. `use_adreno_kernels`
  (`ggml-opencl.cpp:7190` @3bec271fd) gates on the weight tensor's ne0/ne1 and the
  compiler version, not on the GPU model, so a 2.6B's matrices take the same
  `kernel_gemm_noshuffle_q4_0_f32` on both parts.
- *Toward (A)*: on the 750 the KLD went 0.4538 -> 0.004736 purely by changing the
  multiply's precision. If (B) dominated the numerical error on that board, changing
  the multiply could not have removed ~99% of it.

Both can be true at once: (A) dominates the bulk numerical error, (B) adds a 750-only
term. That is precisely why the verdict must come from the continuous metrics.

## Coverage gap found while shipping (verified 2026-09-07) — and it is worse than it looked

The fix started as ONE kernel. Eighteen sibling kernels still multiply in half:

- `gemm_noshuffle_*` (eight left after q4_K was fixed):
  `iq4_nl:55`, `q1_0:32`, `q4_1:35`, `q5_0:32`, `q5_1:33`, `q5_k:55`, `q6_k:37`, `q8_0:35`
- `gemm_moe_*_ns.cl` (ten, ours, from the KEXP campaign), all `half8 acc8`:
  `q2_k:156`, `q3_k:157`, `q4_0:240`, `q4_1:236`, `q4_k:277`, `q5_0:238`, `q5_1:240`,
  `q5_k:285`, `q6_k:253`, `mxfp4:283`

**Which kernel runs is decided by the PHONE, not by a default model.** (Owner correction,
2026-09-07; my two earlier framings — "q4_0 is the shipping model, covered" and then "the
default model is Q4_K_M" — were both wrong.) Verified on disk:

- `recommendedModelId(tier)` (`contextProfile.ts:89-99`) returns the first listed entry
  whose `recommendForTiers` includes the tier. `lfm2.5-2.6b` declares
  `recommendForTiers: ["low", "mid"]` (`ModelRegistry.ts:244`, quant `QAD-Q4_0`);
  `qwen3.5-4b` declares `["high"]` (`:212`, quant `Q4_K_M`). Tier thresholds:
  high >= 6.9 GB, mid >= 5.4 GB (`contextProfile.ts:60-62`).
- `default: true` is NOT "the default model". `getDefaultModel()` has exactly one
  non-test caller, `AppShell.tsx:2541`, where it only picks the **starting index of the
  model carousel**. The tier recommendation is explicitly advisory — the module docstring
  says "NEVER auto-switches the user's chosen model" and it drives a Settings badge
  (`SettingsScreen.tsx:936`).

So the mapping that matters is:

| phone | recommended model | prefill GEMM kernel | measured? |
|---|---|---|---|
| low / mid (< 6.9 GB) | `lfm2.5-2.6b` QAD-Q4_0 | `gemm_noshuffle_q4_0_f32.cl` | yes — 0.4538 -> 0.004736, cost 0.659x |
| high (>= 6.9 GB) | `qwen3.5-4b` Q4_K_M | `gemm_noshuffle_q4_k_f32.cl` | **no** |

This raises the q4_K arm from a footnote to the measurement that covers the whole
high-RAM half of the fleet — and the QDC boards we measure on (12+ GB) are themselves
high-tier, so the model they would recommend is the one whose kernel is unmeasured.

Decision taken: q4_K is fixed too (fork `kalsa/gemm-f32-mul-q4k` @67c73d26c). The
mechanism is identical (half product accumulated over K) so the edit transfers; the
MEASUREMENT does not — neither the fidelity gain nor the 0.659x cost is known for q4_K,
and nothing in the code or the commit messages may claim otherwise. The other eighteen
stay as they are: no catalogue model reaches the `gemm_moe_*` family (that is the MoE/
KEXP line, out since the 2.6B decision) nor the remaining noshuffle quants.

## The two APKs (2026-09-07)

- **`bench/gemm-f32-apk` @6fc14d1** — arm B of the A/B. App commit unchanged from
  `8269aa2` (the already-built arm A, the very APK behind ALIVE 55); only the pin moves.
  Vendored diff, as pre-registered: pin + `VENDOR_SHA` + `build-info.cpp` + exactly two
  `.cl` files, nothing else.
- **`feat/governor-ux` @c4c5280** — the APK to actually use: `feat/moe-stream` merged
  into `feat/governor-in-app` (one conflict, `ModelRegistry.ts`, both sides kept) plus
  the same pin. CI typecheck+jest green on the merge before the pin landed.

Both dispatched to `apk.yml` (arm64-v8a, debuggable) on 2026-09-07, runs 34148006630 and
34148008166.

## Harness cost of one A/B pair on the QRD8650, measured 2026-09-07 (session 808521)

The first attempt was lost to a deadline I chose without measuring what a turn costs.
`qdc-governor-s5b/d_run.sh` was launched with `DEADLINE_MINUTES=40`; it killed arm B1
mid-typing at 39:42 with `END reason=deadline_40_min`, leaving only A1.

What a single observation actually costs on this board, from the run's own artefacts:

- fresh APK install + **1.6 GB model copy** + DB bootstrap — done **per turn**, not once;
- prompt entry in chunks: ~9 min (chunks `a1_c1`..`a2_c47`);
- cooldown to target before every turn: **390 s** measured (37.09 -> 36.93 °C, target 37.0);
- one turn raises skin from 29.6 to **42.6 °C**.

So a full A/B pair needs **~50 minutes**, and a 40-minute deadline cannot produce one.
Relaunched as `sa812590b` with `DEADLINE_MINUTES=60`.

Two things worth keeping:

- `deadline_check` fires **inside** a turn (`d_run.sh:306`, `:329`), not only between turns,
  so an undersized deadline destroys the turn in progress rather than stopping cleanly
  after the last complete one.
- The "no cooldown before the first bench step" defect (cell `adreno-operand-b`) does
  **not** apply here: `run_observation` calls `cool_target_for_arm` + `cooldown_to_target`
  for every turn including the first A (`d_run.sh:375-377`).

Salvaged from the lost run: A1 = TTFT 7348.9 ms, decode 21.91 tok/s, skin 29.601 -> 42.573,
ids_sha `1a006db3…`.

## The q4_K arm did not run — three attempts, 2026-09-08 night

Nothing measured. What was learned is about the harness and about QDC billing, and both are
worth more than the attempts cost.

### Attempt 1 — QRD8635 (Adreno 735), session 808596
`Completed with Error` after 8 minutes in Setup, `Started On: N/A`. The device pool is busy:
the catalogue shows the 8635 as **Unavailable** while still holding 889 minutes, i.e. the
queue is pool-side, not quota-side (the same pattern recorded on 2026-08-30). **Cost: zero
minutes** — verified on the catalogue afterwards, which also proves billing does not start
before `Started On`.

### Attempt 2 — QRD7675 (Adreno 732), session 808600
Substituted for the 8635 with the owner's reasoning preserved: ALIVE 39 established that the
735 and the 732 are twins ("una sola classe di performance mid-tier"), both clean of the
750-only f16-batched defect, and the 732 had 625 minutes and was available. Device
`f6d5d957`, SM7675, 11.6 GB.

The driver died at the first turn with `END reason=exit_1`, `status=1`, `telemetry_rc=1`,
skin 29.3 -> 30.6 (so it failed before doing any real work). Diagnosis from the artefacts:

- The APK installed (`Success`) and the model copied correctly (2 834 975 040 bytes on the
  device, sha gate passed).
- The app launched and was alive — it emitted `pressure.transition` telemetry throughout.
- **It never loaded a model**: zero `llama_model_loader` lines and zero `KALSA_PREWARM` in
  the full logcat.

Two distinct problems, both mine to fix before the next attempt:

1. **A sixth hardcoded model constant that I missed.** `d_run.sh:295`
   `MODEL_LOAD_PATTERN='llama_model_loader: loaded meta data with .* from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf'`
   pins the LFM path *and* filename. PREREG Amendment 3 said "five constants"; there are six.
   Even a successful Qwen load would have been reported as a failure.
2. **The app-side precondition for loading a non-default model is not understood.** Setting
   `kalsa.model.id` and copying the file is enough for the LFM and was not enough here. The
   open suspects, in order: the Qwen entry declares an **mmproj** (672 423 616 bytes) that
   the driver never copies, whereas the LFM entry is text-only; and the ModelDownloader's
   "downloaded" bookkeeping may not consider the model present. **To be settled by reading
   the app, not by another session.**

### QDC billing — measured, and it corrects me twice

Session 808600 requested `maxTestMinsPerDevice = 70`, ran ~15 minutes of wall clock, and was
charged **70**: QRD7675 went 625 -> 555 on the catalogue. So **the requested cap is charged
whether or not it is used**. Earlier in this campaign I asserted first that minutes are
consumed by active use, then that they are consumed by wall-clock duration; both were wrong.

Operating rule from now on: **request the minimum cap that can hold the run, never a safety
margin** — and open the session only when driver, APK and model are ready.

Budget after tonight: QRD8650 35, QRD8750 89, QRD7675 555, HDK8550 854, QRD8635 889.

## 2026-09-08, 04:33 EDT — fourth attempt at the q4_K arm, launched

Both causes of the third failure are fixed in the driver (`1712bdbf`) and registered in
PREREG Amendment 4: the mmproj is copied when configured, and `MODEL_LOAD_PATTERN` is now
derived from `MODEL_DIR`/`MODEL_FILE` instead of pinning the LFM path. An uncommitted
driver refactor that arrived after that commit was **discarded** rather than run — the tool
does not change on the way into a paid session.

Session **808791**, QRD8635 / 8s Gen 3, cap 75 min, found `Running` with 67m 40s left
(≈7 minutes had already burned before the driver started: the session was opened at the end
of the previous working block). Tunnel on local **6037**, job host `sa812860`.

Pre-run device state, read before launching:

- `MemTotal 11 530 632 kB` → the driver's `gpu_fit_ram_gate` (voids at ≤ 8 GiB) passes.
- `ro.soc.model SM8635`, `device_tag=8s-Gen-3`, `ro.debuggable=1`, serial `7da1a203`.
- **Cold board**: skin **28.7 °C**, `Thermal Status: 0`, max HAL temp 42.0 (battery).
  The best starting point of the whole campaign — the 8650 runs started around 36-37 °C.

Launched `./d_run.sh sa812860 <armB 6fc14d1> ABABAB 58` with `ORACLE_MODE=logit` and the six
Qwen overrides. One APK serves both arms: app commit `6fc14d1` is
`build: bump kalsallama pin to 67c73d26c (f32 product in the Adreno q4_0 and q4_K GEMMs)`,
verified on disk — the same binary that produced ALIVE 60 already carries the q4_K fix.
Arm B reaches the GPU through `kalsa.bench.governor_force=1` (`d_run.sh:279`), as registered,
because `GPU_PREFILL_CORRECT.V73` is `false` and this run does not change production policy.

Deadline set to **58** and not the planned 70, for the session time actually left. The
registered risk is the 3.5 GB push (model + vision head); if it eats the budget the driver
hits its deadline mid-order and only a complete A/B pair counts.

## 2026-09-08, 05:11 EDT — the q4_K arm is UNMEASURABLE in-app with Qwen 3.5 4B

Session 808791 ended at `05:11:12` (`Completed`, 47 min of a 75 cap). Two rows came out and
they answer a different question than the one registered.

```
A 1 ttft=27524ms  new_tokens=915 decode=8.227 skin 32.888 -> 46.209  status=0
B 1 ttft=28221ms  prefill_ms=0   decode=8.942 skin 36.913 -> 43.756  row_void=1  oracle=VOID R4
```

Arm B ran **on the CPU**. The device said why, in one line of its own telemetry:

```
KALSA_GOVERNOR {"engine_prefill":"CPU","engine_decode":"CPU","commit_bytes":0,"commit_ms":0,
"prefill_ms":0,"prefill_chunks":"","prefill_ctx_ngl":0,"forced":true,"thermal_state":"Unknown",
"thermo_source":"bench-skin","fit":"NoFit","fallback_reason":"governor not eligible"}
```

`forced: true` — the bench lever `kalsa.bench.governor_force` **was** applied and was not
enough. The cause is not the board, not the thermals (skin 36.9 °C, target 37.0, cooldown
succeeded in 465 s), not the kernel. It is two static gates in the app, either of which
alone is fatal, and **both were readable on the Mac before the session was opened**:

1. `src/engine/governorInputs.ts:82-83` — the first executable lines of `gpuFit()`:
   ```ts
   const kv = model.kvBytesPerToken;
   if (typeof kv !== "number" || !Number.isFinite(kv) || kv <= 0) return "NoFit" as const;
   ```
   and the `qwen3.5-4b` entry in `ModelRegistry.ts:187` says, in a comment:
   `// kvBytesPerToken intentionally omitted: no on-device measurement for the 4B`.
   So `gpu_fit` is **NoFit for this model on every device, always** — before any memory
   arithmetic, before the generation check. The `availableMb: 4381` in the app's own
   `KALSA_SEND {"phase":"fit"}` line is a red herring: that is the *download/load* gate,
   which allowed the load (`allow: true`), not the governor's.
2. `src/engine/LlamaService.ts:1387-1389` — the governor is only wired when
   ```ts
   governorBase.gpu_fit !== "NoFit" &&
   !options.mmprojPath &&
   !streamExperts
   ```
   `!options.mmprojPath` means **any model with a vision head disables the governor**,
   independently of point 1.

The board itself was classified correctly: `ro.soc.model=SM8635` → `generationFor()`
returns `V73` (`governorInputs.ts:56`), exactly as Amendment 3 registered.

### What this costs and what it is worth

Cost: one session, and the q4_K fidelity question is **still unanswered** — the fixed GPU
kernel never executed. I registered a measurement of "q4_K GPU prefill in the app on the
high-tier model" without first checking whether the app can route that model to the GPU at
all. It cannot, and two greps would have said so.

Worth: the finding is real and it is a product gap, not a lab artefact. **The high tier —
the tier where prefill hurts most — never gets the governor**, for a reason that has nothing
to do with whether the GPU would win: one missing catalogue field and one blanket exclusion
of multimodal models. The owner had already suspected the vision head mattered; it does, and
more than expected — the app does not merely account for it, it switches the governor off.

### Where the q4_K measurement can actually go

Any vehicle must satisfy, simultaneously: q4_K weights, **no mmproj**, and a non-null
`kvBytesPerToken` in the registry. No shipping entry does today. The cheapest honest path is
a registry entry for `LFM2.5-2.6B-Q4_K_M.gguf` (already on the Mac, 1 674 455 040 bytes) with
`listed: false` and a measured `kvBytesPerToken`, plus a CI APK — the same route Amendment 4
considered and rejected as more expensive than downloading the vision head. That trade-off
has now inverted.
