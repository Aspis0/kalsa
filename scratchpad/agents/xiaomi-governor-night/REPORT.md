# Xiaomi 14 governor night — report

Status: fixed run 35961215542 APK verified and installed; new-APK X2 functional check completed for 20 turns. Old-APK X1 remains partial. Timing is stopped; X3 is postponed.

Preregistration: [PREREG.md](PREREG.md), timestamped 2026-09-24T02:11:41Z before measurement.

Marco's mandatory screen-on, per-turn Awake/foreground verification, battery-restriction recording, and timeout-restoration addendum is recorded in PREREG.md before any Xiaomi measurement.

The later owner decisions are also recorded in PREREG.md: battery floor 25%, per-cell Android plus available MIUI/HyperOS power-saver state (stop if active), unplugged thermal stop limits, and matched timing-cell starting conditions.

Marco's original shipping-APK bug addendum is recorded before measurement: X1 gets one same-chat turn-2 check; its turns 1–3 X2 cap applied to the old APK and was superseded by the fixed-run update below; X3 uses a fresh chat per prompt and arm. The corrected thermal gates are in PREREG.md: stop at status ≥3 or battery ≥44.0 °C; timing arms start at status 0 and, for comparisons, within 2 °C of the first arm's start, reached with screen on and Kalsa foregrounded, with a 3-minute idle period and no fixed target temperature.

## Materials verified on host

- CI APK run 35908860007: `raw/materials/app-release.apk` symlinks to the staged artifact; size 159,283,395 bytes; SHA-256 `37c36f3e44b5aae27268cc8a70872f3f8543a66c2adfd4d73f5bbf8432068ab4`.
- Model: `/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`; 1,593,894,944 bytes; SHA-256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`.

## Device wait

Initial `adb devices -l` at 2026-09-24T02:11Z showed only the S23 and Jelly Star. They are being left untouched. The raw polling log records `adb devices -l` every 120 seconds and checks for `model:23127PN0CG` or `product:houji`, for at most 10 hours. Device work will use `adb -s <Xiaomi serial>` explicitly.

## X1 — old shipping APK, partial runtime probe

The run used the exact CI APK specified in the original brief (SHA-256 verified). It was installed with `adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp install -r`; exit 0, signature matched, no uninstall or data clear. The existing sandbox model was verified at 1,593,894,944 bytes and left in place. Governor was enabled in Kalsa’s UI. Device was unplugged, awake, keyguard hidden, Kalsa foreground, status 0, power-saver settings 0, and 65% / 32.8 °C at the usable turn-1 start (`raw/x1-pre-send-gate.txt`, command exit 0). `screen_off_timeout` remained 86400000 throughout.

The first submitted prompt was synthetic repeated numeric content. Keyboard input truncated/corrupted earlier unsent drafts; those were never sent. The submitted composer held the instruction to repeat digit 7 plus 1,384 observed digit markers. It generated `prompt_n=2765`, so it exceeded the intended roughly-1,500-token prompt. It generated 2,047 tokens rather than 128. Thus the turn is useful runtime evidence but not a compliant 1,500/128 X1 timing sample. Prompt source: agent-generated synthetic numeric sequence; no personal/user text.

Verbatim turn-1 lines from `raw/x1-turn1-markers.txt`:

```text
09-24 01:31:50.180 19333 23669 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":6638,"tokensEvaluated":4591,"tokensPredicted":2047,"draftTokens":0,"draftAccepted":0,"promptMs":23209.106,"predictedMs":228027.345,"predictedPerSecond":8.976993526807059,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":2765,"ciswireFlags":1}
09-24 01:31:50.188 19333 23669 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":30918144,"commit_ms":21.85,"prefill_ms":23209.106,"prefill_chunks":"512+512+512+512+512+128+77","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
```

Governor engagement: **yes** (`fit=Fit`, `engine_prefill=GPU`, `prefill_ctx_ngl=99`). The full busy/idle verdict is **not established**: a host gpubusy sampler was started, but stopped before generation while investigating a non-responding tap. No gpubusy sample overlaps turn 1; do not infer activity from idle counters. `engine_decode=CPU`. Start temperature 32.8 °C; after turn 1 the phone remained Awake/unlocked with Kalsa in front, status 0, 59% / 35.9 °C (`raw/x1-turn1-after.txt`, exit 0). CPU6/CPU7 were 960000/672000 kHz at that read. The KGSL `cur_freq` and `gpuclk` nodes returned Permission denied; `gpubusy` was readable.

OpenCL evidence in `raw/x1-filtered-markers.txt`: kernels loaded; `compiling fa f32`, lazy flash-attention prepass for DK=64/DV=64, and `compiling fa prepass f16`. The compile-failure exit guard was not exercised because compilation succeeded. No `setGovernorThermo` or `readThermo` evidence appeared in the captured Kalsa lines; debt 5.2 remains.

One additional synthetic same-chat turn was run. The old APK did **not** reproduce the reported second-turn handoff failure: turn 2 finished with `engine_prefill=GPU`, `engine_decode=CPU`, `fit=Fit`, `failed=false`, `prefill_ctx_ngl=99`; telemetry reported `prompt_n=4832`, 36 generated tokens, `promptMs=42567.997`, `predictedMs=3349.989`, `predictedPerSecond=10.746303943087575`. Start was 60% / 36.9 °C, status 0; after it, awake/unlocked/foreground remained valid, status 0, 59% / 35.9 °C (`raw/x1-turn2-before-send.txt`, `raw/x1-turn2-after.txt`, each command exit 0). `RssAnon=308272 kB`, RSS 2,321,884 kB, and PSS 2,175,935 kB at the after-turn read. The known `commit_side` / `route Reject` strings were absent from captured Kalsa markers.

Commands and evidence: state and after-turn gates are in `raw/x1-pre-send-gate.txt`, `raw/x1-turn1-after.txt`, `raw/x1-turn2-before-send.txt`, and `raw/x1-turn2-after.txt`; each logged device command returned exit 0. Full raw logcat is `raw/x1-logcat.txt`; it may contain other apps’ lines and generated model text, so only the filtered Kalsa markers above are quoted. Host sampler attempt is `raw/x1-gpubusy.csv` and `raw/x1-gpubusy_sample.py`; it contains no generation interval. The screen stayed Awake and keyguard-hidden; timeout remained the owner's 86400000 value.

## Fixed APK, functional-only X2, and postponed timing

Run 35958095874 failed and was excluded. Run 35961215542 completed successfully with headSha 57eca6077bf4b850b0ad4484ab870f29a29a4184; the arm64 debuggable APK is at raw/ci-35961215542/kalsa-apk-arm64-v8a-debuggable-57eca6077bf4b850b0ad4484ab870f29a29a4184/app-release.apk, size 159,321,059 bytes, SHA-256 cbc3034ac7cc3baf93aa373efd9493a4de00de8a3f9befed785bfbf7161e1f81. It was installed with adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp install -r; success, matching installed signature, no uninstall/data clear. Evidence is in raw/ci-35961215542/, raw/09-install-r.txt, and raw/10-install-verify.txt through raw/11-installed-apk-hash.txt.

### X2 functional session — fixed APK, 20 turns, one chat

Charging was confirmed before the cell: AC powered true, USB and wireless false, battery 28%, thermal status 0, battery temperature 36.5 °C, global/MIUI saver 0. The screen was Awake, keyguard hidden, timeout stayed 86400000. Kalsa was foreground before every send and after each turn. The governor switch was checked in Kalsa settings and was on. Prompts were synthetic one-word instructions using the color sequence amber, cedar, cobalt, dahlia, ember, flint, glacier, harbor, indigo, juniper, kelp, lilac, marble, nectar, opal, pebble, quartz, river, silver, thistle.

Each answer matched its requested synthetic word with no visible error text. Turns 1–2 used CPU prefill; turns 3–20 used GPU prefill. All turns reported fit=Fit; global low_power and MIUI POWER_SAVE_MODE_OPEN were 0 in the per-turn state records. No KALSA_KVTRIM, KALSA_GOVERNOR_FALLBACK, or KALSA_GOVERNOR_RUNTIME_FALLBACK marker was captured; lmkd count was 0 per turn. Thermal status remained 0; final battery temperature was 36.6 °C and battery 48%. No throttling/pause was observed. The per-turn RssAnon, battery temperature, route, and functional verdicts are:

| Turn | GPU prefill | decode_repack | CPU_REPACK line | KVTRIM/fallback | Answer coherent | RssAnon (kB) | lmkd | Battery temp / thermal status | Battery |
| ---: |:---:|:---:|:---:|:---:|:---:|---:|---:|:---:|---:|
| 1 | CPU | not logged | absent from captured markers | none | yes | 169208 | 0 | 36.5 °C / status 0 | 36% |
| 2 | CPU | not logged | absent from captured markers | none | yes | 389372 | 0 | 36.2 °C / status 0 | 40% |
| 3 | GPU | not logged | absent from captured markers | none | yes | 360096 | 0 | 34.6 °C / status 0 | 45% |
| 4 | GPU | not logged | absent from captured markers | none | yes | 368988 | 0 | 35.2 °C / status 0 | 46% |
| 5 | GPU | not logged | absent from captured markers | none | yes | 379196 | 0 | 34.9 °C / status 0 | 46% |
| 6 | GPU | not logged | absent from captured markers | none | yes | 390672 | 0 | 35.0 °C / status 0 | 46% |
| 7 | GPU | not logged | absent from captured markers | none | yes | 391124 | 0 | 35.0 °C / status 0 | 46% |
| 8 | GPU | not logged | absent from captured markers | none | yes | 393860 | 0 | 35.0 °C / status 0 | 46% |
| 9 | GPU | not logged | absent from captured markers | none | yes | 356124 | 0 | 35.5 °C / status 0 | 47% |
| 10 | GPU | not logged | absent from captured markers | none | yes | 333100 | 0 | 35.5 °C / status 0 | 47% |
| 11 | GPU | not logged | absent from captured markers | none | yes | 331732 | 0 | 35.6 °C / status 0 | 47% |
| 12 | GPU | not logged | absent from captured markers | none | yes | 299132 | 0 | 35.6 °C / status 0 | 47% |
| 13 | GPU | not logged | absent from captured markers | none | yes | 259484 | 0 | 35.6 °C / status 0 | 47% |
| 14 | GPU | not logged | absent from captured markers | none | yes | 260716 | 0 | 36.0 °C / status 0 | 47% |
| 15 | GPU | not logged | absent from captured markers | none | yes | 262420 | 0 | 36.0 °C / status 0 | 47% |
| 16 | GPU | not logged | absent from captured markers | none | yes | 265384 | 0 | 36.3 °C / status 0 | 48% |
| 17 | GPU | not logged | absent from captured markers | none | yes | 266828 | 0 | 36.5 °C / status 0 | 48% |
| 18 | GPU | not logged | absent from captured markers | none | yes | 269964 | 0 | 36.5 °C / status 0 | 48% |
| 19 | GPU | not logged | absent from captured markers | none | yes | 273352 | 0 | 36.5 °C / status 0 | 48% |
| 20 | GPU | not logged | absent from captured markers | none | yes | 266364 | 0 | 36.6 °C / status 0 | 48% |

decode_repack was not logged in any per-turn KALSA_GOVERNOR object, and no CPU_REPACK-named engine buffer line appeared in the captured fixed-APK logs. The conditional-P1 repack decision therefore remains unverified from this session's instrumentation; no inference of true/false is made.

### Verbatim KALSA_GOVERNOR route lines

Each line retains the raw marker and explicitly labels its ms fields as charging — not a measurement:

    TURN 01: charging — not a measurement; 09-24 05:36:50.410   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"CPU","engine_decode":"CPU","commit_bytes":0,"commit_ms":0,"prefill_ms":689.507,"prefill_chunks":"cpu:18","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 02: charging — not a measurement; 09-24 05:44:55.517   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"CPU","engine_decode":"CPU","commit_bytes":0,"commit_ms":0,"prefill_ms":9357.102,"prefill_chunks":"cpu:128+128+58","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 03: charging — not a measurement; 09-24 05:54:27.067   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":15056896,"commit_ms":10.2,"prefill_ms":3142.116,"prefill_chunks":"128+128+126","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 04: charging — not a measurement; 09-24 05:55:11.962   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":16177152,"commit_ms":10.658,"prefill_ms":408.61,"prefill_chunks":"21","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 05: charging — not a measurement; 09-24 05:56:24.328   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":17363968,"commit_ms":11.122,"prefill_ms":413.886,"prefill_chunks":"20","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 06: charging — not a measurement; 09-24 05:56:41.531   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":18457600,"commit_ms":11.544,"prefill_ms":411.061,"prefill_chunks":"20","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 07: charging — not a measurement; 09-24 05:56:59.230   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":19571200,"commit_ms":12.054,"prefill_ms":423.001,"prefill_chunks":"19","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 08: charging — not a measurement; 09-24 05:57:17.084   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":20698112,"commit_ms":12.498,"prefill_ms":414.245,"prefill_chunks":"19","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 09: charging — not a measurement; 09-24 05:57:57.419   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":21825024,"commit_ms":13.938,"prefill_ms":416.257,"prefill_chunks":"20","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 10: charging — not a measurement; 09-24 05:58:15.001   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":22878720,"commit_ms":14.385,"prefill_ms":414.255,"prefill_chunks":"20","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 11: charging — not a measurement; 09-24 05:58:32.848   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":23992320,"commit_ms":14.829,"prefill_ms":413.217,"prefill_chunks":"20","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 12: charging — not a measurement; 09-24 05:58:50.480   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":25125888,"commit_ms":15.376,"prefill_ms":417.371,"prefill_chunks":"21","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 13: charging — not a measurement; 09-24 05:59:20.246   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":26246144,"commit_ms":15.857,"prefill_ms":415.665,"prefill_chunks":"19","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 14: charging — not a measurement; 09-24 05:59:38.370   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":27333120,"commit_ms":16.352,"prefill_ms":415.987,"prefill_chunks":"19","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 15: charging — not a measurement; 09-24 05:59:56.044   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":28466688,"commit_ms":16.93,"prefill_ms":435.478,"prefill_chunks":"20","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 16: charging — not a measurement; 09-24 06:00:13.785   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":29573632,"commit_ms":17.716,"prefill_ms":419.962,"prefill_chunks":"20","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 17: charging — not a measurement; 09-24 06:00:51.941   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":30693888,"commit_ms":18.271,"prefill_ms":425.237,"prefill_chunks":"19","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 18: charging — not a measurement; 09-24 06:01:08.948   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":31807488,"commit_ms":19.038,"prefill_ms":434.202,"prefill_chunks":"19","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 19: charging — not a measurement; 09-24 06:01:25.888   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":32854528,"commit_ms":19.618,"prefill_ms":431.368,"prefill_chunks":"19","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
    TURN 20: charging — not a measurement; 09-24 06:01:43.189   644 11712 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":33921536,"commit_ms":20.436,"prefill_ms":433.226,"prefill_chunks":"20","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":""}
 Generic CPU_Mapped/OpenCL model buffer and compute buffer lines, plus a memory pressure sample near 4519 MiB, are retained in raw/x2-functional-buffer-evidence.txt. Verbatim per-turn governor lines are in raw/x2-functional-governor-lines.txt; each marker line is prefixed “charging — not a measurement” because it includes ms fields. No decode throughput or sustained t/s result is reported from the charging functional run. The complete raw logcat is raw/x2-functional-logcat.txt; it can include other apps' lines and generated model text and remains unquoted.

Per-turn command evidence: raw/x2-functional-turn01-summary.txt through raw/x2-functional-turn20-summary.txt, with before/after device-state files and UI dumps beside them. Runner and send exit codes are indexed in raw/x2-functional-run-exits.txt. Every actual device command used adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp. All 20 accepted sends and post-turn gates exited 0. An initial turn-1 pre-send UI probe exited 2 due to shell quoting in the safety gate; it happened before typing/sending. The gate was corrected and the turn-1 prompt was sent once; see raw/x2-functional-turn01-before-ui.xml and the successful turn-1 summary for the retry.

### Prediction vs observed

The preregistered X1 prediction was Fit with more than 4,359 MiB available and an approximately 4,200–4,600 MiB requirement, plus an OpenCL compile attempt. Observed: Fit and GPU prefill, with OpenCL compile lines present. Exact required/available MiB were not emitted in the captured X1 markers. The predicted gpubusy busy-during-prefill / idle-during-decode condition was not established because the sampler did not overlap the turn.

The preregistered X2 expectation of 20–35 tokens/s was a timing prediction; the coordinator superseded it with a charging functional-only run. Any timing telemetry is charging — not a measurement, and no t/s number is reported as a measurement. Functionally, 18 of 20 turns used GPU prefill, all 20 answers matched the synthetic target, and there were no captured route errors, fallback/KVTRIM markers, or lmkd events.

The preregistered X3 ratios remain unobserved because X3 was postponed. No X4 prediction was exercised.

### X3 and other deferred work

X3 speed/energy A/B is postponed to a later unplugged session by the coordinator because battery was at 31% and the 25% floor left no safe timing margin. Do not treat any earlier partial calibration as a completed X3 result; no X3 ratios are reported. X4 was not run. X2 sustained t/s is not measured because the fixed-APK session was functional-only while charging.

### End state and cleanup

The post-cell sample at raw/final-device-state.txt exited 0: Awake, keyguard hidden, Kalsa foreground, AC powered, 49%, thermal status 0, battery temperature 36.5 °C (dumpsys battery), saver settings 0, and timeout still 86400000. After temporary-file cleanup, raw/cleanup-tmp.txt confirms Awake/unlocked/foreground, AC powered, 54%, thermal status 0, battery temperature 33.8 °C, saver settings 0, and timeout 86400000. The model remains in Kalsa’s app sandbox at 1,593,894,944 bytes. Battery-restriction state was recorded and left unchanged in raw/06-app-restrictions.txt: RUN_ANY_IN_BACKGROUND=allow, RUN_IN_BACKGROUND=No operations (default mode allow), standby bucket 40, and the recorded device-idle whitelist query exited 0. No other app was opened or altered, and no system setting was changed.

The temporary file listed above, /data/local/tmp/kalsa_xiaomi_ui.xml (60,064 bytes before cleanup), was removed successfully after the report listed it; see raw/cleanup-tmp.txt (command exit 0). No other /data/local/tmp file was created by this session.

See raw/ for artifacts and per-command captures. No commit or push was made.