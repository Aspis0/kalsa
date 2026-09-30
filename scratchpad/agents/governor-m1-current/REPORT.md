# Governor milestone 1 — in-app 1 Hz battery current vs backend on the S23

Date: 2026-09-30. Device: Galaxy S23 (SM-S911U, SM8550), serial
`adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. APK: CI build of app main
d33190d0 (run 36733967953), debuggable, governor enabled, model lfm2.5-2.6b.
Runner: device-run agent dispatched by coordinator session 3f035b4e.

## Verdict

**FAIL on the plan's separation criterion; PASS on the row-change criterion.**
Current changes on 99.7–100 % of 1 Hz rows (≥ 90 % required), but the
GPU-prefill vs CPU-prefill mean-current difference (242 mA, 1260 vs 1019 mA)
is below 3× the noise under every noise definition available: 3× between-turn
sd of the GPU arm = 730 mA, of the CPU arm = 380 mA, 3× pooled within-window sd
= 440 mA. The reason is thermal state, not absence of signal: within the decode
phase — the same CPU backend in every turn — the between-arm mean differs by
636 mA (1964 vs 1329), i.e. thermal history moves the per-phase mean current
more than the backend does. The energy *integral* does separate cleanly:
54 ± 3 vs 224 ± 3 J per 1k prefill tokens (4.1×, between-turn sd 3 J), because
prefill duration is backend-determined. The plan's fail-branch decision
("drop energy learning, rank on heat priors only") is the coordinator's to take;
this report only notes that the instantaneous-mean test fails while the
per-turn integral passes its own 3× test by two orders of magnitude.

NPU arm NOT run (recorded, not fixed): the installed CI APK was built CPU-only
("Hexagon SDK not found - building CPU-only", 0 hexagon symbols in
librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so — coordinator-verified, not
re-verified here). First-hand confirmation in the coordinator's gpu-t1 turn
(npu_lane on): `npu_device:"GPU"`, `npu_fallback:"htp-device-missing"`
(raw/t1-logcat.txt).

## Table

Per-turn (mean mA negative-discharge sign flipped; prefill tok/s =
4746 / prefill_s; decode tok/s from KALSA_TELEMETRY predictedPerSecond;
J/1k = mean_mA × mean_mV × prefill_s / 4746):

| turn | arm | changes | prefill n | prefill mA (sd) | prefill mV | decode n | decode mA (sd) | prefill tok/s | decode tok/s | J/1k prefill tok |
|---|---|---|---|---|---|---|---|---|---|---|
| gpu-t1 | gpu | 141/141 (100 %) | 45 | 1456 (384) | 4024 | 95 | 2024 (316) | 105.3 | 9.78 | 56 |
| cpu-t1 | cpu | 305/306 (99.7 %) | 230 | 1165 (173) | 3947 | 75 | 1465 (235) | 20.6 | 8.30 | 223 |
| gpu-t2 | gpu | 109/109 (100 %) | 50 | 1337 (392) | 3971 | 57 | 1923 (221) | 94.5 | 9.46 | 56 |
| cpu-t2 | cpu | 374/374 (100 %) | 289 | 945 (138) | 3929 | 84 | 1183 (170) | 16.4 | 6.94 | 227 |
| gpu-t3 | gpu | 151/151 (100 %) | 62 | 988 (349) | 3955 | 88 | 1946 (246) | 76.6 | 9.13 | 51 |
| cpu-t3 | cpu | 405/405 (100 %) | 287 | 945 (125) | 3861 | 117 | 1337 (148) | 16.5 | 7.11 | 222 |

Arm separation (sd = sample, n-1):

| phase | arm | per-turn means | mean | between-turn sd | pooled within-window sd |
|---|---|---|---|---|---|
| prefill | gpu | 1456, 1337, 988 | 1260 | 243 | ~375 |
| prefill | cpu | 1165, 945, 945 | 1019 | 127 | ~147 |
| decode | gpu-arm (CPU backend) | 2024, 1923, 1946 | 1964 | 53 | ~264 |
| decode | cpu-arm (CPU backend) | 1465, 1183, 1337 | 1329 | 142 | ~188 |

J/1k prefill tokens: gpu 56, 56, 51 (mean 54, sd 3); cpu 223, 227, 222
(mean 224, sd 3).

Telemetry per turn (KALSA_TELEMETRY): tokensEvaluated 4746 every turn;
prefill/predicted ms — gpu-t1 46064/96115, cpu-t1 231444/76840,
gpu-t2 51230/58348, cpu-t2 290965/85473, gpu-t3 62969/89468,
cpu-t3 289144/118249. Every turn: engine_prefill matched the requested route,
engine_decode CPU, route_mismatch false.

## Method

- 6 turns, one cold-launched chat turn each, prompt 4746 tokens (14,023-char
  English text + summarize instruction) shared via `kalsa://share?text=`.
  Order: gpu-t1 (coordinator, 12:07), then cpu-t1, gpu-t2, cpu-t2, gpu-t3,
  cpu-t3 in an ABABA cpu/gpu alternation, 90 s screen-on gaps.
- Each turn: `/tmp/m1/turn.sh ROUTE LABEL` — force-stop, bench keys
  (kalsa.bench.route, npu_lane off, nativelog off) via sql_write, plug check,
  wake + launch, drawer → new chat → deep link → Send (944,2071), wait for
  KALSA_TELEMETRY (max 450 s), save state/logcat/CSV.
- CSV: app's own 1 Hz sampler
  (`kalsa.bench.energy_trace`, schema kalsa-governor-battery-trace-v2), latest
  file under files/energy via run-as. Samsung fuel gauge reports mA in the
  current_uA column (sign negative = discharge); not calibrated against an
  external meter. Windows: prefill = [t0+1 s, t0+prefill_ms), decode =
  [t0+prefill_ms+1 s, +predictedMs), rows with current_status ok only
  (split.py convention, unchanged).
- turn.sh was read before running; no bug found; nothing changed.
- Preflight before AND after every turn (verified each time): mWakefulness=Awake,
  topResumedActivity com.kalsa.app/.MainActivity, AC/USB/Wireless powered all
  false, battery level ≥ 30 % (74 % start → 57 % end; per-turn end levels 71,
  68, 64, 62, 58), persist.traced.enable = 0. Post-turn end temperatures:
  41.9, 43.6, 44.2, 45.6, 44.4 °C.
- Noise statement, as directed: **the noise used for the pass test is the
  between-turn sd of per-turn means within an arm** (thermal drift included);
  I used the larger arm's (GPU, 243 mA) → 3× = 730 mA > 242 mA diff. Also
  reported: CPU-arm between-turn sd (127 → 3×380) and pooled within-window sd
  (147 → 3×440); the diff fails all three, so the verdict does not depend on
  the choice. There is no in-app idle window (the sampler runs only during a
  turn), so true idle noise is unmeasurable on this device today.
- Confound quantification: decode is CPU in every turn, so decode backend
  separation is untestable; but decode means differ 636 mA between arms
  (GPU-arm turns decode at 9.1–9.8 tok/s, CPU-arm at 6.9–8.3 tok/s) — the same
  backend, at different clocks/thermal states, moves the mean current 2.6×
  more than the prefill backend does.

## Commands and exit codes

Exit codes captured for all state-changing and analysis commands. Pure reads
(adb dumpsys/getprop/logcat -d greps) are verified by their outputs in the
session transcript; their exit codes were not separately recorded.

| command | exit |
|---|---|
| `adb devices` (S23 + Jelly Star visible; only S23 addressed, always `-s`) | 0 |
| preflight reads before each of the 6 turns (wakefulness/activity/plug/level/traced) | all pass (outputs above) |
| `bash /tmp/m1/turn.sh cpu cpu-t1` | 0 |
| `bash /tmp/m1/turn.sh gpu gpu-t2` | 0 |
| `bash /tmp/m1/turn.sh cpu cpu-t2` | 0 |
| `bash /tmp/m1/turn.sh gpu gpu-t3` | 0 |
| `bash /tmp/m1/turn.sh cpu cpu-t3` | 0 |
| split loop, first attempt (zsh `set --` does not word-split; no device I/O, no data affected) | 1 |
| split loop, bash rerun over the 6 CSVs → raw/splits.txt | 0 |
| `python3 table.py` → raw/table.out | 0 |
| bench-key read via `sql`, first attempt (env helper needs bash BASH_SOURCE; no device I/O) | 127 |
| bench-key read via `sql` under bash → raw/bench-keys.txt | 0 |
| `mkdir -p raw` + `cp` of 6 CSVs, 6 logcats, 5 state files, 3 derived outputs | 0 |

## Bench keys left on the phone

Read at the end with `sql "SELECT key,value FROM catalystLocalStorage WHERE
key LIKE 'kalsa.bench%' ORDER BY key;"` (exit 0); none deleted:

```
kalsa.bench.energy_trace|1
kalsa.bench.kvtranscript|1
kalsa.bench.nativelog|off
kalsa.bench.npu_lane|off
kalsa.bench.route|cpu
```

`kalsa.bench.thermo` was never written. End state left as instructed: app in
foreground (MainActivity), screen Awake, unplugged, level 57 %, traced 0.

## What could not be verified

- NPU-prefill arm: impossible with the installed APK (CPU-only CI build);
  coordinator-verified facts recorded above, not re-verified (no APK pull,
  no install, per rules).
- Decode backend separation: decode is CPU in every turn; no contrast exists.
- Idle noise: the in-app sampler produces no rows outside a turn; between-turn
  spread and within-window sd are proxies only.
- Absolute current accuracy: Samsung-reported mA taken at face value; the
  column is named current_uA by the app schema but carries mA on this device
  (coordinator's convention, consistent with all six traces); no external
  calibration.
- gpu-t1 pre-turn preflight (coordinator's turn, run before this session): not
  captured by me; its logcat/CSV are internally consistent (route gpu, mismatch
  false, 4746 tokens, CSV span 141.8 s ≈ 46 + 96 s).
- Older unrecorded trace /tmp/s23-old-energy.csv (2026-09-23, 33 changes /
  34 rows) has no per-phase timings, so it could not be phase-split; not used.

Raw artifacts in raw/: six turn CSVs, six KALSA_TELEMETRY/GOVERNOR logcat
extracts (t1-logcat.txt is gpu-t1's), five state files, splits.txt, table.out,
bench-keys.txt.
