# PREREG — S5: governor in the app, A/B on Qualcomm Device Cloud

Date: 2026-09-04. Status: draft; no data are valid until the prerequisite below
is closed. QDC session names: `S5-QRD8650` and `S5-8Elite` (each ≤30 chars).

## Hypothesis and materials

On the same board, APK, model, prompt, and deterministic sampler, governor B
will produce the same first N token IDs as CPU-only A. After that correctness
gate passes, B will have TTFT ≤ one third of A, decode tok/s ≥ A, zero lmkd
kills, and will report GPU prefill plus CPU decode.

Model: app id `lfm2.5-2.6b`, `LFM2.5-2.6B-QAD-Q4_0.gguf`,
1,593,894,944 bytes, SHA-256
`a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`.
The driver pushes it once to `/data/local/tmp/kalsa-s5/` and copies it into
the app sandbox only with `run-as`.

APK: absolute CI artifact path to be filled at lock time, from branch
`feat/governor-in-app`; SHA-256: `<FILL_AT_LOCK>`. The locked artifact record
must show `application-debuggable=true`; the installed package proof must show
`DEBUGGABLE` in `dumpsys package com.kalsa.app` flags. No other APK is valid.

Prompt, exactly: `Reply with one short sentence about mountains`.
Each observation is a fresh install of this same APK and a fresh app data set,
so prior chat history cannot change the prompt. The model file is reused only
after its full device SHA-256 matches.

## Sampling prerequisite

The current app has no greedy bench key. Its completion path currently fixes
`temperature`, `top_k: 20`, and `top_p: 0.9`; the line read was
`top_k: 20,` (`/Users/marco/Projects/kalsa-wt-governor/src/engine/LlamaService.ts:3985`).
The `kalsa.bench` grep found engine, norepack, speculative, thermo, and
toolgate keys, but no sampling key or token-ID output. PREREQUISITE:
implement and verify the app-handled key named `kalsa.bench.sampling` with a
documented greedy mode and a machine-readable first-N token-ID artifact.
The driver is hard-gated and exits before device access until this is closed;
it does not invent or inject an unimplemented app contract.

N is 32 generated tokens. A paired observation with fewer than 32 tokens or
missing token IDs is invalid and cannot advance to speed analysis. Equality is
exact token-for-token, not decoded-text similarity. The oracle is evaluated
for every matched A/B pair; turn 1 is excluded only from the performance
plateau, per the repository rule.

## Arms and order

- A: `kalsa.governor.enabled="0"`; the ordinary single-context CPU path,
  `n_gpu_layers=0`.
- B: `kalsa.governor.enabled="1"`; the governor path in the same APK.

The effective turn order is `ABABABAB`: four A and four B observations,
interleaved on one board. Arm turns 2–4 are the plateau (≥3 turns per arm);
arm turn 1 is retained as warm-up evidence but excluded from the TTFT and
decode summaries. The driver injects the flag and current thermo JSON into
`catalystLocalStorage` before each experimental launch.

QDC order is fixed: QRD8650 / Snapdragon 8 Gen 3 first, then QRD8750 / 8
Elite. Use one QDC session per board, the names above, and the same locked APK
and model. Budget: 45 minutes per session, 90 minutes total; stop if a
session cannot complete its four cycles with evidence.

## Thermo and endpoints

QDC exposes no battery temperature; its `vbat` value is voltage, and the board
reports plugged. The bench override therefore deliberately writes
`kalsa.bench.thermo` with `batt_temp_tenths_c=round(skin*10)`,
`batt_level_pct=100`, `plugged=false`, `sensor_valid=true`,
`t_idle_valid=true`, and `t_idle_c` equal to the first session skin reading.
The policy's uncalibrated thresholds are 38.0, 39.5, and 42.0 °C, with a 43.0
°C kill threshold and a 25% battery floor; plugged profiles instead use
`t_idle_c` offsets. This is intentional: plugged without idle calibration
enters the CPU fallback path in `llama-governor-policy.cpp`; `plugged=false` lets
this declared bench profile exercise the governor. It is not production input.
The driver refreshes
the current skin value before every turn from `dumpsys thermalservice`, and B
telemetry must tag `thermo_source:"bench-skin"`.

Primary endpoint 1 is the greedy oracle above. Primary endpoint 2 uses the
app's `KALSA_TELEMETRY`: `promptMs` is TTFT and `predictedPerSecond` is decode
tok/s. Report paired rows and the median of plateau turns 2–4 per arm; pass
requires median B TTFT / median A TTFT ≤ 1/3 and median B decode ≥ median A.

Secondary evidence is one `KALSA_GOVERNOR` line per B turn, with
`engine_prefill=GPU`, `engine_decode=CPU`, `commit_bytes`, `commit_ms`,
`thermal_state`, and `thermo_source="bench-skin"`. B fallback-line count must
be zero. In each post-launch logcat, case-insensitive matches for `lmkd`,
`am_kill`, or `lowmemorykiller` must be zero. Record skin before and after
every turn, plus all adb exit codes.

## Abort, void, and validity

Abort the current session on a missing/mismatched APK or model, absent
`DEBUGGABLE`, run-as refusal, device disconnect, missing loader/prewarm proof,
invalid skin/thermo data, missing UI composer/Send, process crash, any lmkd
match, B fallback, or skin ≥42 °C (governor critical; 43 °C is the hard kill
threshold). Preserve partial raw evidence. Never retry with root in the app
data path; `/data` mode 771 is maintained only by the outside-data holder.

The cell is VOID if the sampling prerequisite is not met, the locked APK SHA
or debuggable identity is absent, the model hash differs, turns are not
ABABABAB, fewer than three plateau turns per arm are completed, or A/B are
run on different board/APK/model conditions. A QDC board has no battery, USB
power and the synthetic thermo profile are declared confounds; `bench-skin` is
not a production sensor or a battery result.

Threats to validity are the batteryless board, USB/rack power state, QDC
transport/session variance, display/UI timing, fresh-install load cost, and
the thermo override itself. The result is an app integration cell, not a
consumer-phone battery or thermal claim.
