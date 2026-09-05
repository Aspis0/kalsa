# PREREG — S5: governor in the app, A/B on Qualcomm Device Cloud

Date: 2026-09-04. **LOCKED 2026-09-05**: sampling contract closed by app commit `826fe50`,
APK identity verified below; no numbers were collected before this lock. QDC sessions: `S5-QRD8650` and `S5-8Elite`;
both names are under 30 characters.

## Hypothesis and fixed materials

On one board, APK, model, prompt, and sampler, governor B will produce the
same first 32 generated token IDs as single-context CPU A. After that oracle
passes, B will have median TTFT no greater than one third of A, decode tok/s
at least A, zero lmkd kills, GPU prefill, and CPU decode.

Model: id `lfm2.5-2.6b`; file `LFM2.5-2.6B-QAD-Q4_0.gguf`; size
1,593,894,944 bytes; SHA-256
`a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`.
The driver pushes this exact file to `/data/local/tmp/kalsa-s5/`, verifies the
device SHA, and copies it into the app sandbox only with `run-as`.

APK: `/Users/marco/kalsa-qdc/apk/apk-gov-c5c55a4/kalsa-apk-arm64-v8a-debuggable-c5c55a4897f96398c707987e65afce97274e08d9/app-release.apk`,
branch `feat/governor-in-app` @ `c5c55a4`, CI run 33932740946 (debuggable=true), 142,751,510 bytes,
SHA-256 `12ecb73145ca3ea161c9a259424926523b085caa8b51d683ec6abd0f46c33284`, aapt2 badging shows
`application-debuggable`; vendor = fork `e131345b7`. The QDC job id / tunnel host is per session and is
recorded by the driver in `raw/`. The locked artifact record
must show `application-debuggable=true`, and installed-package evidence must
show `DEBUGGABLE` in `dumpsys package com.kalsa.app` flags. No other APK is
valid. Prompt: `Reply with one short sentence about mountains`.

Each observation gets a fresh install of this APK and fresh app data. The
driver maintains `/data` mode 771 with an outside-data holder loop; it uses
`run-as` for app data and never root in the app data path.

## Sampling prerequisite and oracle

The inspected app source exposes the greedy key at
`/Users/marco/Projects/kalsa-wt-governor/src/engine/benchSampling.ts:3`:
`export const BENCH_SAMPLING_KEY = "kalsa.bench.sampling";`. The locked APK
must implement the exact contract below; the driver injects and runtime-checks
it rather than guessing.

For both arms, AsyncStorage key `kalsa.bench.sampling` with value `"greedy"`
makes the app run the turn with temperature 0, top_k 1, top_p 1, min_p 0,
repeat/presence/frequency penalties off, fixed seed 42, and `n_predict` ≥ 48.
At the end of each completed chat turn the app logs exactly one line:
`KALSA_BENCH_TOKENS {"turnId":"<id>","n":<generated token count>,"ids":[<first 32 generated token ids as integers>]}`.
Fewer than 32 ids are allowed only when EOS came first; then `n` < 32.

The driver injects `kalsa.bench.sampling`=`greedy` before launching every A
and B turn. It parses the last `KALSA_BENCH_TOKENS` line after that launch,
requires `n >= 32`, writes the 32 IDs to the turn's absolute
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/<job_id>/*_ids.txt`, and puts
their SHA-256 in `ids_sha`. Adjacent A/B rows are paired (A turn 1 with B turn
1, etc.): equal lists are oracle `PASS`, otherwise `FAIL`, recorded on B.
Missing or short token evidence is oracle `VOID`; that pair is excluded from
the speed medians. The first turn must produce the line or the driver writes
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/<job_id>/PREREQUISITE.txt` and exits 3.
The telemetry completion poll requires only the first completed
`KALSA_TELEMETRY` line with `tokensPredicted >= 1`; the `n >= 32` requirement
belongs only to the oracle. A short EOS turn therefore records `oracle=VOID`,
`ids_sha=na`, is excluded from speed medians, and does not timeout or set
status 1. After that telemetry match, the driver waits at least two seconds
and takes one extra logcat dump before parsing turn evidence.

## Arms, order, and budget

- A: `kalsa.governor.enabled="0"`; single-context CPU, `n_gpu_layers=0`.
- B: `kalsa.governor.enabled="1"`; governor path in the same APK.

Run exactly `ABABABAB` on each board: four observations per arm, interleaved.
Arm turn 1 is retained as warm-up evidence and excluded from performance
summaries per the repository rule “measure the plateau”; turns 2–4 are the
plateau, giving at least three turns per arm.
The driver injects the flag and thermo JSON into SQLite
`catalystLocalStorage` before each launch.

Device order is QRD8650 (Snapdragon 8 Gen 3) first, then QRD8750 (8 Elite),
one QDC session per board, same locked APK and model. Budget is 45 minutes per
session, 90 minutes total. The driver has a 40-minute wall-clock deadline,
preserves evidence, writes `END.txt`, and exits so the operator can end the
QDC session within its cap.

## Thermo and endpoints

The #63 REPORT says the board is NOT USB-powered as far as `svc power stayon`
is concerned. The governor-relevant state is the BatteryManager plugged
report; QDC reports plugged, and this bench override sets `plugged:false`
anyway. QDC has no battery temperature; `vbat` is voltage.

Before every turn, refresh `kalsa.bench.thermo` from the current skin value
from `dumpsys thermalservice`, with
`batt_temp_tenths_c=round(skin*10)`, `batt_level_pct=100`, `plugged=false`,
`sensor_valid=true`, `t_idle_valid=true`, `t_idle_c` equal to the first skin
reading, and `trend_c_per_min` from successive readings. This is required
because plugged without idle calibration falls back to CPU mode. Policy
thresholds are 38/39.5/42 °C, critical cutoff 43 °C, battery floor 25%.
`thermo_source` must be `"bench-skin"`; this override is not production input.

Primary endpoint 1 is the oracle above: greedy token-for-token equality of the
first 32 generated tokens between B and CPU A on the fixed prompt. Primary
endpoint 2 is analyzed only after the oracle: app `KALSA_TELEMETRY`
`promptMs` is TTFT and `predictedPerSecond` is decode tok/s. `promptMs` includes
the prefill artifact, and both arms pay the same prefill. Report median plateau
turns 2–4 using only oracle-PASS pairs; pass requires median B/A TTFT ≤ 1/3
and median B decode ≥ median A.

The promised TSV header is:
`arm turn ttft_ms decode_tps engine_prefill engine_decode thermal_state skin_c_before skin_c_after fallback_count lmkd_count ids_sha oracle`.
Secondary checks require exactly one `KALSA_GOVERNOR` line per B turn after
a second anchor taken immediately before Send, with `engine_prefill=GPU`, `engine_decode=CPU`, numeric
`commit_bytes` and `commit_ms`, `thermal_state`, and
`thermo_source="bench-skin"`. B `KALSA_GOVERNOR_FALLBACK*` count must be 0.
Telemetry completion must have `tokensPredicted >= 1`; oracle rows separately
require `n >= 32`. Anchored logcat matches for
`lmkd|am_kill|lowmemorykiller` that also mention `com.kalsa.app` or its PID
must be 0. Record skin before and after every turn and every adb exit code.

## Abort, VOID, and threats to validity

Abort on identity/hash/run-as/device/load/prewarm/UI failures, disconnect,
invalid thermo data, process crash, any counted kill, B fallback, or skin ≥42
°C. Preserve partial raw evidence. A turn with a non-clean uninstall, missing
package cleanup before install, or failed wake re-check has status 1.

The cell is VOID if the sampling contract is absent, APK SHA/debuggable proof
is absent, model hash differs, order is not `ABABABAB`, fewer than three
plateau turns per arm complete, or board/APK/model conditions differ. The #63
REPORT also establishes that `am_kill` can survive `logcat -c`; therefore the
driver clears all buffers, records a device-time anchor, and counts only
anchored app-specific lines.

Threats are the batteryless board, the BatteryManager plugged state versus
unobserved rack power, QDC transport variance, display/UI timing,
fresh-install load cost, shared thermal drift, and the synthetic thermo
override. The result is an app
integration cell, not a consumer-phone battery or production thermal claim.

## Amendment 5/09 (pre-lock, from the S3+S4 delta audit)

- The app's `ids` list excludes the end-of-generation token (native `generated_token_ids` is filled
  only for sampled tokens with `tok != -1`; the EOG return path leaves `tok = -1`). Both arms share
  this behaviour, so the oracle compares the same first-32 window in A and B. A turn that ends by
  EOS before 32 tokens is `oracle=VOID` per the contract, never a failure.
- The bench-skin JSON MUST carry `plugged:false`, `t_idle_valid:true`, `t_idle_c` (driver line
  `THERMO_JSON=` does): the native policy treats plugged-without-idle as CPU mode, and JS no longer
  pre-validates the profile.
- `n_probs:1` is enabled in both arms by the greedy key; its cost is symmetric and it does not
  change the chosen token (probabilities are read after sampling).

## Amendment 5/09 — run 2 APK (pre-data, after run 1 VOID)

Run 1 (QDC session 799218, job sa803287, APK `c5c55a4`, sha `12ecb731…3284`) is **VOID for every
endpoint**: arm A turn 1 completed (TTFT 42.7 s, 24.3 tok/s, `KALSA_BENCH_TOKENS` present, 0
fallback, 0 kalsa lmkd) but arm B turn 1 could not complete any generation because
`shouldUseMTP()` threw in governor mode on every completion (root cause fixed in app commit
`db1606c`). Run 1 evidence stays in `raw/sa803287/`; the first driver crash is in
`raw/sa803287-VOID-crash-line90/`.

Run 2 uses APK
`/Users/marco/kalsa-qdc/apk/apk-gov-db1606c/kalsa-apk-arm64-v8a-debuggable-db1606ceb75fdbadf6577573e4fa1a2c75e3e545/app-release.apk`,
branch `feat/governor-in-app` @ `db1606c`, CI run 33936537090 (debuggable=true), 142,751,510
bytes, SHA-256 `dd77516ac3d8a2508985fad9b3e2a1e2c85a5ddfc7dc3f3fdca0d2b4703f2b6a`, aapt2 badging
shows `application-debuggable`. Driver at commit 6bbb67b6 (set -u fixes, MemAvailable snapshots,
all-process lmkd evidence file). Everything else in this PREREG is unchanged; QDC session name for
run 2: `S5-QRD8650-r2`.

