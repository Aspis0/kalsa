# RECON — what to code next on the governor (read-only)

Date: 2026-09-23. Read-only pass: no edits outside this file, no builds, no git writes,
only `adb devices -l` on the device side.

Shipping pins verified this pass:

| repo | pin | proof |
|---|---|---|
| engine `kalsallama` | `1577495b9` (tag `kalsa-phone-v1-1-1`, branch `origin/kalsa-phone-v1-1-1`) | `git describe` → `kalsa-server-v1.1.1-6-g1577495b9`; pin is a descendant of engine `main` `833cde99b` (engine main tip is *in* the pin's history) |
| binding `llama.rn-kalsa` | `5b966218` (branch `kalsarn-governor-engine`) | `vendor/VERSIONS:9-10` → `LLAMA_CPP_REF/COMMIT=1577495b9…` |
| app `kalsa` | `origin/main` = `d69b4ce` | `package.json:49` → `github:Aspis0/kalsa.rn#5b966218…`; `native/kalsallama.pin` = `1577495b92096fca572f57a35b71607bacac85d5` |

Local `kalsa` `main` is `e5788cf`, **16 commits behind** `origin/main` (`git branch -avv`):
`e5788cf` is an ancestor of `d69b4ce` (`git merge-base --is-ancestor` → YES), so read the
app through `origin/main`, not through `main`.

Dirty trees noted and NOT touched: `~/Projects/kalsallama` carries an uncommitted
re-application of the pin's own GPU-probe patch (`git diff --stat` = exactly `cd213fff7`'s
7 files, +465/−13); `~/Projects/kalsa` carries someone else's diff per project rule.

Owner decisions read: `PLAN.md:544` ("bring the Governor forward"), `PLAN.md:566`
("defect 5.2 is fixed by SUPPLYING the data"); Part 9 order at
`analysis/GOVERNOR-DEVICE-PLAN.md:682-693`.

---

## 5.1 — CPU fallback above the threshold

**(a)** A heat refusal (`Wait`) made the runtime send the whole batch, unsplit, to the CPU
decode context — the fallback for "too hot" was the hottest engine
(`GOVERNOR-DEVICE-PLAN.md:474-476`, original site `llama-governor-runtime.cpp:55-63`).

**(b) DONE on the shipping engine pin.** Commit `f2073505e` "governor : pause hot
prefill instead of routing it to CPU (defect 5.1)", verified ancestor of `1577495b9`.
Fix lives at `kalsallama@1577495b9:src/llama-governor-runtime.cpp:53-58`: `Wait` now logs
"no safe prefill chunk under the thermal ceiling; pausing" and returns `-2`
(non-latching pause), with the comment at `:54-55` "Reducing tokens is the only allowed
fallback; never switch to another engine". The `CPUFallback` arm no longer switches
contexts: `:63-66` returns 0 on the already-chosen route. Commit evidence:
`run_hot_prefill_pause` in `tests/test-governor-v0-turns` (commit message of `f2073505e`).
App side: none needed (engine defect).

**(c)** Nothing to code. Open, not blocking: the pin's still-live sibling defect 5.6
(CRITICAL latches `failed`) is explicitly deferred to Part 9 step 8, absorbed by the
refactor (`GOVERNOR-DEVICE-PLAN.md:692`, `:706-711`).

## 5.2 — the charger poisons the governor

**(a)** The app sent `plugged`/`sensorValid` but no `t_idle_valid`; parser default false;
engine required it when plugged ⇒ profile `Invalid` → `Abort` → sticky `failed`
(`GOVERNOR-DEVICE-PLAN.md:481-490`). Owner 2026-09-21: fix by **supplying** `t_idle`
(`PLAN.md:566-576`).

**(b) DONE on all three shipping pins.**

- **App half** — `e5788cf` "governor : supply the real plugged idle baseline (defect 5.2,
  app)" is an ancestor of `origin/main d69b4ce`. It was then superseded in spirit (same
  direction) by `a855ab6` "governor : forward raw battery observations, drop the app-side
  idle policy", also on `d69b4ce`. Current state: `native/GovernorBatteryModule.kt:66-70`
  sends raw `t_idle_valid = sensor present and non-zero` and `t_idle_tenths_c` live;
  `src/engine/governorInputs.ts:166-184` converts tenths→degrees exactly once and applies
  no range gate (comment `:169-173`: "Validity is the engine's decision"). This matches
  the owner's "supply, don't drop" ruling: the app supplies honest raw readings, the
  engine latches and judges.
- **Engine half** — `61db879b8` "clear the plugged idle baseline on unplug (defect 5.2,
  engine)" ON-PIN; latch/drift/clear at `kalsallama@1577495b9:src/llama-governor-policy.cpp:100-114`
  (clear on unplug at `:111-114`), plugged validity gate at `:53-67` including
  `t_idle_c > 0.0f` from `a7d2cec79` (`:63-66`), plugged thresholds derived from
  `t_idle_c` at `:46-50`. Semantics of the field documented by `e3088932c` at
  `kalsallama@1577495b9:src/llama-ext.h:267,275-277`.
- **Binding half** — `cc804436` (drop the third copy of the plugged rule from the parse
  check) and its pinning test `b97c581d` are both ancestors of `5b966218`. Current state:
  `llama.rn-kalsa@5b966218:cpp/rn-governor-params.cpp:86-87` reads `t_idle_valid`/`t_idle_c`,
  `:92-101` `governor_thermo_profile_is_valid` holds payload sanity only; refusal of a dead
  plugged baseline is the engine's alone (`policy.cpp:63-66`).

**(c)** Nothing to code. Open verification debt (blocks nothing, costs step 3 honesty):
on hardware `setGovernorThermo` is only called when the governor attaches, so the engine
half of 5.2 has never run on a device — "NOT VERIFIED", `s23-governor-smoke/REPORT.md:414-416`
and verdict 2c at `:690`. Settle it during step 3; also suggested there: log `readThermo`
once per load (`s23-governor-smoke/REPORT.md:717`).

## 5.3 — the battery floor inverts the route

**(a)** `requested == CPU` (battery < 45% / LOWBAT) was admitted and landed on
`prefill_route_ = GPU`, so below 45% the prefill ran on GPU while telemetry said CPU
(`GOVERNOR-DEVICE-PLAN.md:496-500`, original site `llama-governor-runtime.cpp:65-68`).

**(b) DONE on the shipping engine pin.** Commit `2b1ee43ab` "governor : route prefill by
the requested engine (defect 5.3)", verified ancestor of `1577495b9`. Fix at
`kalsallama@1577495b9:src/llama-governor-runtime.cpp:59-62`:
`prefill_route_ = requested == CPU ? prefill_route::CPU : prefill_route::GPU`, with
`stats_.prefill_engine = requested` at `:61`. Commit evidence: `run_low_battery_prefill`
in `tests/test-governor-v0-turns` (commit message of `2b1ee43ab`).

**(c)** Nothing to code. Note the coupling: the floor's *admission* effects are part of
the Rule-3 two-selector refactor (step 7), not of 5.3.

## Step 2 — GPU probe: real compilation + clean degradation, no `exit(1)` in the app

**(a)** Compile the kernel set for real, record `ok | fail` keyed on device+driver, and
degrade to CPU instead of killing the process (`GOVERNOR-DEVICE-PLAN.md:150-170`, step
row at `:687`).

**(b) DONE engine-side on the shipping pin; app half does not exist by design yet.**

- Commit `cd213fff7` "gpu: no exit(1) on the OpenCL compile path, verdict keyed on the
  kernel set, V73 GPU prefill lane" — ancestor of `1577495b9`. At the pin:
  `ggml/src/ggml-opencl/ggml-opencl.cpp:1443` builds with `/*fatal=*/false`; on null it
  sets `kernel_build_failed`, records the verdict and returns `nullptr` (`:1444-1449`);
  all 187 build sites are followed by `if (backend_ctx->kernel_build_failed) { return; }`
  (e.g. `:1618`, full grep ~180 sites), entry guard at `:1585`, `supports_op` gate at
  `:9559`; verdict record `ggml_opencl_record_verdict` at `:1407-1429`.
  Verdict cache keyed on device identity/driver: `cl-program-cache.cpp:174-187`,
  save/load at `:476-529` with fail-TTL "stale fail verdict ignored" at `:526-529`.
  The residual `exit(1)` at `:1371`/`:1397` sit behind `fatal`, which no in-app caller
  sets (`governor-gpu-probe/REPORT.md`, "grep 'fatal=*/true' -> 0 matches"); the binary
  path `:1466`/`:1477` and env-var sites `:1559`/`:1577` are listed as not-reachable-in-app
  (`governor-gpu-probe/REPORT.md` §a). Independent audit COMPLETE, claims A–I verified
  (`governor-gpu-probe-audit/REPORT.md` header).
- Commit `86f602f8a` "degrade weight-upload failures to a load error instead of abort"
  — ancestor of `1577495b9`; 30 abort sites in `ggml_backend_opencl_buffer_set_tensor`
  converted to `std::runtime_error` reaching the `KALSA_GOVERNOR_FALLBACK` load-error
  channel (commit message).
- The same commit opened the V73 GPU prefill lane in
  `kalsallama@1577495b9:src/llama-governor-policy.cpp` (`prefill_engine()`, V73 added
  alongside V75/V79; diff of `cd213fff7` on that file), mirrored app-side at
  `origin/main:src/engine/governorInputs.ts:136-137` (`V73 || V75 || V79`) and
  `:134-135` comment "V73 carries the owner's 2026-09-21 enablement decision".
- **App half:** `governorInputs.ts` at `origin/main` has **no** `kernels_compile`/probe
  field (216-line file, grep clean) — correct: the capability record (`DeviceCapabilities`)
  is Part 9 **step 5**, and the plan's step-2 outcome is only "no more exit(1) in-app"
  (`GOVERNOR-DEVICE-PLAN.md:687`).

**(c)** Nothing to code for step 2 itself. Evidence debt to collect during step 3: the
guard has never been exercised on a device — verdict 3c "was the no-exit(1) guard
exercised: **NO**, the compile path was never called" (`s23-governor-smoke/REPORT.md:696`),
because the governor refused on `fit:"NoFit"` before compiling (`:698-707`).

## Step 3 — runtime probe on the Xiaomi (M1.3) with `gpubusy`

**(a)** Run the repaired APK on the Xiaomi and watch `KALSA_GOVERNOR` + a `gpubusy`
sample across the prefill window to answer "does the governor engage, yes or no"
(`GOVERNOR-DEVICE-PLAN.md:688`; cell 1 spec at `:619-625`).

**(b) NOT DONE.** No artefact exists: grep for `M1.3` / `runtime probe` in the lab finds
only the plan and re-statements (`PLAN.md:556`, `GOVERNOR-DEVICE-PLAN.md:688,699`,
`governor-gpu-recon/REPORT.md:605`). The closest run is
`scratchpad/agents/s23-governor-smoke/` on **our S23**, with a build that already carries
all three fixes (engine ancestor checks in `REPORT.md:94`): ACTIVATION **PROVEN**,
engagement **REFUSED** on `fit:"NoFit"` (wants ~4.26 GiB free, S23 had 2.2–3.0 GiB),
GPU compile **NOT EXERCISED**, one turn **PROVEN**
(`s23-governor-smoke/REPORT.md:679-698`).

**(c) What to do, and what blocks it.**

- Code to change first: **none for the probe itself.** The near-term code item the S23
  run names is the fit-gate arithmetic, not the governor: `gpuReserveMiB` and the
  `computeMiB`/`kvMiB` double count at `origin/main:src/engine/governorInputs.ts:109-117`
  vs `memoryEstimate.ts:164`, itemised at `s23-governor-smoke/REPORT.md:701-710`
  (fixing it still leaves ~3.96 GiB required, so it is a bug but not *the* S23 blocker;
  the 2.4 GiB reserve at `governorInputs.ts:109` is the dominant term).
- Also requested before rerunning: a failure marker naming the failing conjunct, and one
  `readThermo` log per load (`s23-governor-smoke/REPORT.md:711-717`).
- **Blocker 1 — the device:** the Xiaomi is not connected (see (d)).
- **Blocker 2 — an APK from the pins** (see (d)).
- **Blocker 3 — a decision**: whether step 3 runs on the physical Xiaomi (as written) or
  on a QDC proxy board (coordinator addendum below). Owner's call; both are viable.

**(d) The device, reachability, and the artefact needed.**

- **"The Xiaomi" = Xiaomi 14 (`houji`, `23127PN0CG`, SM8650, Adreno 750, Hexagon v75)**
  — `GOVERNOR-DEVICE-PLAN.md:330` (Part 3.1); identity `q16-xiaomi/REPORT.md:4,26`.
- **Not reachable now.** `adb devices -l` (this pass) returns only
  `192.168.1.82:5555 … model:Jelly_Star` and
  `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp … model:SM_S911U`. No other adb command
  was sent.
- **Artefact needed:** an APK built from the shipping chain — app `d69b4ce` (package
  `com.kalsa.app`) via `.github/workflows/apk.yml` ("APK (device build)",
  `workflow_dispatch`, debug-keystore-signed, sideloadable; header comment lines 1-20 of
  that file), which pins binding `5b966218` (`package.json:49`) and engine `1577495b9`
  (`native/kalsallama.pin`); plus the ship model `LFM2.5-2.6B-QAD-Q4_0.gguf`
  (1,593,894,944 bytes, `qdc-governor-s5/PREREG.md:14-18`); plus host-side `gpubusy`
  sampling — `adb shell cat /sys/class/kgsl/kgsl-3d0/gpubusy` is readable on the S23
  (`energy-instrumentation/REPORT.md:350`, → `0 0` idle), while **in-app** readability is
  UNVERIFIED and likely no (mode 0400 root; `governor-gpu-recon/REPORT.md:555,636`).
  Baseline stays UNSOURCED: plan `~7.5%`, corpus `~49%` hand-transcribed
  (`GOVERNOR-DEVICE-PLAN.md:605-611`; `n10-kexp-audit/REPORT.md:42,79`).
- Provenance gate for any such APK: `scripts/assert-engine-provenance.sh` must pass
  (project rule; header comment of that file at `origin/main`).

---

## Coordinator addendum — remote devices for step 3 and beyond

### Who can host the step-3 probe

| candidate | fit for step 3 | notes |
|---|---|---|
| **QDC QRD8650 (8 Gen 3, Adreno 750, Hexagon v75)** | **best proxy for the Xiaomi** — same SoC class and GPU as `houji` | governor already engaged in-app there: `KALSA_GOVERNOR {"engine_prefill":"GPU",… "thermal_state":"FAST"}` (`qdc-governor-s5b/REPORT.md:56`, run on 8 Elite; QRD8650 B1 record at `:179` with `prefill_ctx_ngl:99`). Board is root/userdebug (`qdc-apk-smoke-63/REPORT.md:2-4`: `id` → `uid=0(root)`), so `gpubusy` is expected readable — **no report records a gpubusy read on any QRD; first read is unsourced**. |
| QDC QRD8750 (8 Elite) | possible, budget-exhausted | governor ran (`qdc-governor-s5b/REPORT.md:21,56`); budget "esaurito", 89 min vs ~120 needed (`:299`) |
| QDC QRD8635 / QRD7675 | marginal | governor ran in s5b run 10 / runs 7e-9 (`qdc-governor-s5b/REPORT.md:274,165,294`); Adreno 735/732 = V73 class, GPU lane only opened by `cd213fff7` |
| **Samsung RTL S23 SM-S911U (Adreno 740)** | yes for a same-model rerun of the S23 smoke | RTL gives a real adb tunnel via RDB, but custom native ELF execution and root are NOT proven (`samsung-rtl-recon/REPORT.md`, §2 "Not proven … must be probed"); shell-user assumed |
| Samsung RTL S25 (8 Elite) | possible | Adreno class OK (`samsung-rtl-recon/REPORT.md` §1) |
| Samsung RTL S24 base (Exynos) | **no `gpubusy`** | no Adreno → no `/sys/class/kgsl` node |
| our physical S23 (attached) | ready today | but produces only the `NoFit` refusal until the fit gate is addressed (`s23-governor-smoke/REPORT.md:698`) |

### What has already run on the remote devices for the governor

- **`qdc-governor-s5`** — governor A/B in-app, QRD8650 session `sa803354` (8 rows,
  `final_rc=0`), APK `ac4820d` sha `1a1356ac…`, model LFM2.5-2.6B Q4_0
  (`qdc-governor-s5/REPORT.md:3-14`); two earlier VOID APKs `c5c55a4`, `db1606c`
  (`:36-44`). Primary endpoint NOT MET (`:24`).
- **`qdc-governor-s5b`** — runs 4-6 on 8 Elite (`sa805734`, APK sha `272f4547…59946`,
  `REPORT.md:21`), later runs with APKs `19b67b6` / `e54f529` / `8269aa2` / fault
  `5243755` (`:293-326`), plus QRD8650 (`sa812023`, APK `19b67b6`, `:300-304`), QRD8635
  run 10 (`:274`), QRD7675 runs 7e/9 (`:165,294`). Locked speed endpoint NOT MET
  (`:24`).
- **`gemm-f32-ship`** — QRD8650 2026-09-07, APK `6fc14d1` = app `8269aa2` + engine pin
  `67c73d26c` (`gemm-f32-ship/REPORT.md:3-5`). **Newest on-device build recorded anywhere
  — and it predates the shipping pins (2026-09-21/23).**
- **govbench cells** `qdc-7pg3-govbench-52`, `qdc-8g3-govbench-55`, `qdc-8s3-govbench-56`
  — tier points on QRD7675/8650/8635 (bench harness, not the in-app governor path),
  2026-09-03 (`REPORT.md:4-7` respectively).
- **APK smokes** `qdc-apk-smoke-61/63` — app install/load/turn on QRD8650, APK-A
  `main c513f00` engine `a0cabca6b`, APK-B `09bdfe9` engine `12f6d9b6d`
  (`qdc-apk-smoke-61/REPORT.md:11-13`; `qdc-apk-smoke-63/REPORT.md:15-17`).
- None of the above carry the shipping pin chain; a step-3 run needs a **fresh APK**.

### QDC minutes as last recorded on disk (portal check needed for current values)

| device | last recorded balance | source |
|---|---|---|
| QRD8750 (8 Elite) | **exhausted** — 89 min left vs ~120 needed | `qdc-governor-s5b/REPORT.md:299` (2026-09-05+) |
| QRD8650 (8 Gen 3) | **35 min left of 249** (earlier same pool: 968 → ~913 of 1000 on 09-04; older portal records 822/797/623/600) | `gemm-f32-ship/PREREG.md:185` (2026-09-07); `qdc-apk-smoke-61/REPORT.md:98`; `qdc-governor-s5/REPORT.md:22-23,183,265` |
| QRD8635 (8s Gen 3) | ~986 of 1000 unlocked (13.5 billed 09-03; s5b run 10 spent more, unrecorded) | `qdc-8s3-govbench-56/REPORT.md:5` |
| QRD7675 (7+ Gen 3) | ~964 of 1000 unlocked (36 billed 09-03; s5b runs 7e/9 spent more, unrecorded) | `qdc-7pg3-govbench-52/REPORT.md:4` |
| (8 Gen 2 HDK, not in the coordinator's list) | ~935 (944 → ~935, cell 60) | `qdc-8g2-npu-mmapbudget-60/REPORT.md:5` |

QDC access facts: SSH + adb tunnel on **local port 6037, never 5037**
(`qdc-governor-s5/REPORT.md:11-13`, tunnel raw `recon.txt:1-2`); minutes counted from
session start, user sets a max-minutes cap (`q29-qdc-recon/REPORT.md:70` and §3).

**Samsung RTL credits:** 20 credits/day on daily sign-in, 1 credit = 15 min, 30-min
minimum reservation, free grant = 5 h/day (`samsung-rtl-recon/REPORT.md:46,87`). No
balance record exists on disk; the grant refreshes daily.

---

## Governor work coded but never landed on the pins

| what | where | status |
|---|---|---|
| **`governor-trend` cell** — `trend_c_per_min` producer, chord semantics, raw platform thermal state: commits `7921719`, `ed55f7d`, `8e7ed2c` | app worktree `~/Projects/kalsa-wt-gov-trend` @ `8e7ed2c` (detached; branch `kalsa-governor-trend` no longer exists); lab cell `scratchpad/agents/governor-trend/` (`REPORT.md:8-9`: push "NOT RUN") | **exists, not landed** — `git cherry d69b4ce 8e7ed2c` returns all three as `+` |
| **`kalsa-governor-desktop-net`** (engine) — test commit `b74ea113a` "pin the desktop validity-gate matrix in the governor router test" | engine branch + worktree `~/Projects/kalsallama-wt-gov-desktop-net` | **exists, not landed** — `git cherry 1577495b9 kalsa-governor-desktop-net` → `+ b74ea113a`; based directly on pin ancestors `a7d2cec79`/`e3088932c` |
| **`kalsallama-governor-sole-decider`** (engine) — `942bc938c`, `35eeeae34` | engine branch + worktree `~/Projects/kalsallama-wt-gov-sole` | **content landed** under rebased SHAs `e3088932c` + `a7d2cec79` (both `git cherry` = `-`, i.e. patch-equivalents on the pin); only the branch ref itself is off-pin |
| **`governor-policy-consolidate` cell** — app/binding/engine idle-baseline consolidation | lab cell `scratchpad/agents/governor-policy-consolidate/`; worktrees `kalsa-wt-gov-policy` @ `0db9dc6`, `llama.rn-kalsa-wt-gov-transport` @ `b97c581d` | **landed**: app `0db9dc6` ≡ `a855ab6` on `origin/main` (`git cherry` = `-`); binding `b97c581d` on pin `5b966218`; engine via the rebased pair above. Its desktop-net test follow-up is the one item **exists, not landed** (row above) |
| **`governor-gpu-probe` cell** (step 2 engine half) | lab cell `scratchpad/agents/governor-gpu-probe/` + audit | **landed** as `cd213fff7` + `86f602f8a` on the pin; note the engine `main` working tree still holds an uncommitted duplicate of that patch (dirty, not ours, do not touch) |
| app worktrees `kalsa-wt-landing` (`08670fb`), `kalsa-wt-landing-check` (`b1fe88b`), `kalsa-wt-build-fixes` (`e5788cf`), `kalsa-wt-bench-apk` (`d69b4ce`) | local worktrees | landed / on `origin/main` (`08670fb` named in `docs/ALIVE.md:62` as part of `d69b4ce`; `e5788cf` ancestor of `d69b4ce`) — nothing to rescue |
| lab cells `governor-gpu-recon`, `governor-policy-duplication`, `governor-audit`, `governor-audit-recheck`, `governor-meter-recon`, `governor-plan-review`, `governor-trend-audit`, `governor-trend-numeric` | `scratchpad/agents/` | reconnaissance/audit documents, no code |

## The coding order this recon implies

1. Nothing for 5.1/5.2/5.3 — **step 1 of Part 9 is complete on the pins** (verify with
   the three tests named above if a re-run is wanted).
2. Step 2 is complete engine-side; its device-side evidence collects during step 3.
3. Next actual code: small step-3 enablers from `s23-governor-smoke/REPORT.md:711-717`
   (failure-conjunct marker, `readThermo` log) + optionally the fit-gate arithmetic
   (`governorInputs.ts:109-117`), **then** the step-3 run itself — needs an `apk.yml`
   build from `d69b4ce` and either the physical Xiaomi (not attached) or an owner
   decision to proxy on QDC QRD8650 (minutes: last record 35/249, portal check first).
4. Hold: `governor-trend` (3 commits) and engine `b74ea113a` are ready-ish work sitting
   unlanded — landing either needs Marco's approval + audit per project rule.
