# AUDIT — `governor-archive-mining/SYNTHESIS.md`

**Verdict: RUNNABLE-AFTER-FIXES.** The data sheet is largely faithful and the protocol is honest about
being exploratory, but §4 cannot run on the current APK as written (no per-turn route switch; the only
per-arm lever needs an app restart), and four citations are wrong.

## P1. §4 on the current APK — CONFIRMED gap: no per-turn route switch

- The engine selector has a **GPU-only** force and no CPU force:
  `llama-governor-policy.cpp:165-190` — `if (params_.bench_force_gpu_prefill && params_.gpu_fit == Fit) return GPU;`
  then the V73/V75/V79 + `gpu_prefill_measured` branch; the only CPU routes are the safety gates
  (CRITICAL/Invalid/LOWBAT) and a plan without a GPU generation. No `bench_force_cpu_prefill` exists
  (grep `force.*cpu`/`cpu.*force` in engine/binding/app → none).
- The app knobs: `governorInputs.ts:9 BENCH_GOVERNOR_FORCE_KEY = "kalsa.bench.governor_force"` read into
  the plan (`:206 bench_force_gpu_prefill: force`, `:191 enabled = force || GPU_PREFILL_CORRECT[...]`) —
  a **load-time** value (it enters `governorKey`); and `governorInputs.ts:8 BENCH_THERMO_KEY =
  "kalsa.bench.thermo"` read by `readGovernorThermo` (`:259`) which `refreshGovernorBeforeCompletion`
  pushes per completion (`LlamaService.ts:1745-1757 engine.setGovernorThermo(...)`) — the only per-turn
  lever: a `batt_level_pct < 25, plugged false` profile enters LOWBAT → `prefill_engine()` CPU.
- **Neither key has a writer in the app** (`grep BENCH_THERMO_KEY|BENCH_GOVERNOR_FORCE_KEY src/` →
  only `governorInputs.ts:216,259`); the `/bench` chat command supports
  thinking|format|speculative|engine|devmodels (`benchConfig.ts:6-17,588`), not thermo/governor. The only
  known writer is the lab's sqlite procedure:
  `qdc-governor-s5/d_run.sh:167 sqlite3 -bail "$dir/RKStorage" "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES (...,'kalsa.bench.thermo','$THERMO_JSON');"`
  followed by `adb push` + `run-as cp` + a force-stop/relaunch (`:169-177`, `:277`). AsyncStorage caches
  the DB, so a live flip is not seen: **each arm switch costs a restart**, which contradicts §4's
  "keep the model/context loaded" and "Do not include model load/prewarm".
- Minimal hook (pick one): (a) add `bench_force_cpu_prefill`/`bench_prefill_engine` to
  `llama_governor_params` + `parse_governor_params` + `prefill_engine()` (after the safety gates,
  before the generation branch) and a plan field read from a per-turn AsyncStorage key, driven by a new
  `/bench route cpu|gpu|auto` chat command (the command path already writes keys, `benchConfig.ts:588`);
  or (b) at minimum a chat command that writes `kalsa.bench.thermo`, accepting the level
  (20 vs 100) as the only arm difference.
- Log lines that do exist, per turn: `KALSA_GOVERNOR {engine_prefill, engine_decode, commit_bytes,
  commit_ms, prefill_ms, prefill_chunks, prefill_ctx_ngl, forced, thermal_state, thermo_source, fit,
  failed, failure_reason}` (`LlamaService.ts:1808-1829`, emitted at `:5192/:5611`) — route and prefill
  time; `KALSA_TELEMETRY {..., tokensEvaluated, draftTokens, promptMs, promptN, ...}`
  (`turnTelemetry.ts:186-205,220-229`) — new-prefill count + time; `KALSA_WINDOW {kvHeld, nPast,
  lastSaveTokens, ...}` (`engineTurnStream.ts:122-135`) — warm-KV start; `KALSA_NATIVE <level> <text>`
  (`LlamaService.ts:545`) mirrors the engine's `admit_prefill: ... pausing (now_c=%.1f state=%s)`
  (`llama-governor-runtime.cpp:80-83`) and the binding's `KALSA_KVREUSE checkpoint n_past=... prompt=...
  n_common=...`. §4 should name these fields instead of "app telemetry" generically.

## P2. Data-sheet citations — four mismatches

- **M1 CONFIRMED.** The S23 CPU/GPU **decode** rows cite `PLAN-archive.md:149-154`; that range is the
  Xiaomi prefill rerun table (`GPU pp128 ... media 186.6`, `CPU pp128 ... 58.7`, `Rapporto vero ... 3.18×`).
  The S23 decode table is `ALIVE-2026-09-full.md:153-155` (`C — all CPU ... 17.55 ... 27.69`; `A — all GPU
  | 14.25 ... 20.03 | KEXP −2.75 °C ... OLMoE −0.45 °C`), prose at `ALIVE:126-140`. Right numbers, wrong file.
- **M2 CONFIRMED.** The K-G 1.29× refutation cites `PLAN-archive.md:328`; the quote is
  `ALIVE-2026-09-full.md:328` ("K-G's 1.29× was a 740 cold-outlier artifact, honest 1.12 %").
- **M3 PLAUSIBLE.** The sustained `17.5→14.8` refutation cites `GOVERNOR-DEVICE-PLAN-2026-09-audited.md:957`;
  line 955-957 is "CONFIRMED — the S23 cell" (`A 14.252 / C 17.553`), and no "not in any artifact"
  phrase exists in that file (the 12.2→10.2 / 8.2→8.2 numbers are there, at the same section). The
  refutation's real line was not located.
- **M4 CONFIRMED (fidelity).** Archive rows use comma decimals; the sheet quotes them with periods
  (`+19,3`/`+1,1` → `+19.3`/`+1.1` in §1 and §2). Not a number error, but the sheet claims verbatim quotes.
- Verified OK (sampled every distinct datum): the q58 deltas/speeds (`PLAN:9003`), the Xiaomi pp128 speed
  (`PLAN:6007-6013`), the Xiaomi heat table (`audited:467-478`, `+19.3` as `+19,3`), the NPU
  165.4/51.9/0.561/0.652 (`PLAN:9002-9003`), the NPU decode 4.09/11.94 (`PLAN:9004`), the Xiaomi decode
  24.47/24.28/0.992 (`PLAN:8873-8888`), the Jelly rows (`ALIVE:5557-5561`, `PLAN:9426`, `PLAN:8999`), the
  8 Elite rows (`ALIVE:460-463`), the 92 °C die note (`PLAN:2935-2948`), the audit refutations
  (`audited:898-924`, `905-910`, `1041-1042`), the thermal-zone inventory (`PLAN:3730-3731`), the
  typeahead line (`PLAN:9425`), the binding loader (`rn-llama.cpp:77-78`), the selector
  (`policy.cpp:165-190`), the dwell (`policy.cpp:8`). Note the archive's giant single lines make a
  "line" a coarse anchor (e.g. `PLAN:9003` holds the whole q58 paragraph).

## P3. Protocol soundness

- **Duration confound — CONFIRMED.** Xiaomi CPU 58.7 vs GPU 186.6 tok/s pp128 (`PLAN:6007-6013`) means a
  512-token arm runs ~3× longer on CPU; the end-of-chunk ΔT compares different run lengths (more
  dissipation during the longer CPU run), and the acceptance (`paired GPU-minus-CPU ΔT negative`) does
  not pre-register that bias. The archive's own lesson quoted in §2 ("gradi per prompt, non gradi al
  secondo") is not applied to §4's analysis. Pre-register ΔT per 1k new tokens (and/or the post-arm
  slope) alongside the per-chunk number.
- **Per-token vs per-chunk — CONFIRMED.** The audited plan's own °C/1k-token series
  (14.844/6.348/3.174/2.515 over 128→2048) shows the per-token heat falls ~5.9× with size; a per-chunk
  comparison across the three sizes will misprice the chunk size. §4's acceptance should normalize.
- **n=4 and noise — PLAUSIBLE (exploratory only).** With the pre-registered rule "sign agrees in ≥3 of 4
  pairs", the one-sided sign-test p is 0.3125; the doc labels it exploratory and gates on ">3× the
  same-session idle noise", which is itself a PLACEHOLDER. Adequate as exploration, not as a router input.
- **Cool-down/order — PLAUSIBLE (minor).** The battery's lag and the rising baseline across a pair make
  "back within ±2 °C of the first arm" potentially unreachable after a warm arm; the doc allows a deferral
  but the ABBA/BAAB design does not randomize the *temperature* order. Record both arm start temps.
- **Warm-KV / "exactly 128/512/1024 new tokens" — CONFIRMED gap.** How the warm-KV state is rebuilt per
  arm (checkpoint, number of warmup turns) is unspecified, and with the per-arm restart (P1) the KV is
  cold. The "log the counts from telemetry and invalidate a mismatch" loop is the right check but the
  setup procedure is missing.
- **Thermal zones — CONFIRMED for the S23-class.** `PLAN-archive.md:3730-3731`: "il sysfs termico
  Qualcomm **sì**, senza permessi speciali: 45+ zone in `/sys/class/thermal/thermal_zone*/{type,temp}`
  (milli-°C), fra cui `cpu-0-0..2` e `cpu-1-0..10` (per-core), `gpuss-0..7` (GPU), `ddr`, `nspss-0..3`
  (DSP/NPU), `aoss`, `video`." The Xiaomi indices are correctly marked unverified; the 1 Hz SoC capture
  claim should state the milli-°C unit and the per-zone read cost.
- **Prediction 1 — CONFIRMED inconsistency.** It predicts the Xiaomi 512/1024 direction from the archived
  pp2048 cell, but that cell is a **Qwen3.5-2B** measurement (`audited:467-478`, "2B") while §4 freezes
  **LFM2.5-2.6B**; the sheet's own preamble says speed/heat rows "are not transferable between models or
  devices". Relabel P1 as a hypothesis or drop the transfer. P2 is explicitly flagged as a decode→prefill
  hypothesis; acceptable.
- **S23 GPU arm is the default, not a special case:** `governorInputs.ts:13-24` sets `V73: true` and
  `:204-205 gpu_prefill_measured: generation === "V73" || "V75" || "V79"` → with a cool real thermo and a
  fitting lane the S23 prefills on GPU; the CPU arm needs the LOWBAT bench thermo (P1). The comment on
  `:24` ("never measured in-app") refers to the correctness oracle, not to the flag — do not read it as
  "GPU prefill is off on the S23".

## P4. Router sketch

- No NPU arm is correct for the current APK (binding `rn-llama.cpp:77-78` `prefill_params.n_gpu_layers=99`,
  `decode_params.n_gpu_layers=0`; selector returns CPU/GPU/GPU_COOLMODE, `policy.cpp:165-190`); the sketch
  says so and defers the NPU to a new APK. Not a contradiction with the owner's tri-engine goal, only a
  scope statement.
- "CPU is not the automatic hot fallback" matches today's code: at/above the warn line the runtime logs
  and returns `-2` (`llama-governor-runtime.cpp:77-84`); CPU is only the requested engine or the
  LOWBAT/CPU route.
- "Resume the same turn after measured recovery" has no current vehicle: the `-2` pause ends the turn
  (the runtime returns -2, the binding treats it as flow control), and the doc itself says the resume
  behaviour must be measured. Consistent.
- "Cool while the user types": the archive's 180 s idle dispose vs 300-360 s cooldowns
  (`ALIVE:6060-6074`) is cited, and the sketch defers the decision to a measurement. Consistent.
- The sketch's "pick the fastest correct route under the heat budget" cannot be implemented from the
  current table (no per-device×backend×cell heat); the sketch is design-only and says the cells are
  unavailable rather than extrapolated. Consistent with §1-§3.
- One wording risk: the calibration table's "Δbattery °C/chunk" plus "no generic defaults presented as
  data" is right, but the acceptance in §4 must then also forbid using the S23 q58 deltas as the budget —
  the sheet's Threshold ledger already labels them "invalid universal use" ✓.

## P5. What is solid

- The "never cite as live" list is faithful for every item I checked (the 5.77× artifact `PLAN:6003`, the
  4B contaminated file `audited:912-917`, the ten-reps correction `audited:919-924`, the status census
  `audited:905-910`, the cpu7/gpubusy unverifiable `audited:1041-1042`, the energy withdrawal
  `ALIVE:448`/`PLAN:955-958`), except the two anchors in M2/M3.
- The energy-coverage statement (no valid per-device×model×backend×phase J/token grid) matches the
  archive: the S23 1.0-1.4 J/token is a whole-system estimate (`PLAN:3553-3560`) and the charge-counter
  spread was withdrawn (`ALIVE:448`).
- The gaps list is grounded (isolated Xiaomi per-engine ΔT missing `audited:725-726`; no equal-work
  plugged/unplugged pair `audited:728`; handover cost NOT FOUND `PLAN:6157-6158`; `mWakefulness`/idle
  numbers `ALIVE:6060-6074`).

## Fix list before the protocol runs (RUNNABLE-AFTER-FIXES)

1. Route override: engine `bench_force_cpu_prefill` (or a `bench_prefill_engine` tri-state) + app plan
   field + `/bench route cpu|gpu|auto`, or at minimum a chat-command writer for `kalsa.bench.thermo`;
   otherwise re-preregister per-arm restarts and drop "keep the model/context loaded".
2. Fix M1 (S23 decode → `ALIVE:153-155`), M2 (`ALIVE:328`), M3 (locate the real sustained refutation),
   and keep the archive's comma decimals inside verbatim quotes.
3. Pre-register the duration confound + the per-1k-token normalization, and relabel P1 as a
   cross-model hypothesis or drop it.
4. Specify the warm-KV rebuild per arm and the exact-token calibration loop (which checkpoint, how many
   warmup turns, the acceptance on `KALSA_TELEMETRY.tokensEvaluated`).
5. Name the exact log fields in §4 (`KALSA_GOVERNOR.engine_prefill/prefill_ms`,
   `KALSA_TELEMETRY.tokensEvaluated/promptMs`, `KALSA_WINDOW.nPast`, `KALSA_NATIVE` admission warn,
   `KALSA_KVREUSE`).

**Not verified:** no device run; the app/binding/engine were read at their current working trees
(app `9bb7a1cb`, engine `6581c7a7b`+); the Xiaomi thermal-zone indices and the sysfs read permissions
on the Xiaomi are not established by the archive (the sheet says so).
