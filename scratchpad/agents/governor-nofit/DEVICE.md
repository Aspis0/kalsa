# DEVICE preregistration — P1 no-repack governor lane and quality sentinel

Written 2026-09-23 before any device measurement in this session.

## P1 predictions

Source: `AUDIT-P1-deepseek.md` and `AUDIT-P1-glm.md`; app workflow artifact `ca2dcc0b4907ce443148c9d772098775b3b6dbf5` is selected by the owner.

- With `kalsa.bench.norepack=1`, the app computes the memory requirement as **2998 MiB**.
- Fit is expected when `MemAvailable >= 2998 MiB`; otherwise NoFit, and the load is not forced.
- Expected engine buffers: **no `CPU_REPACK` buffer line for the decode model**.
- Expected decode-model `RssAnon` is about **1.5 GiB below** the repack lane.
- The load should survive its transient without an lmkd kill.
- In-lane CPU decode is expected to be about **1/1.41** of repack-lane decode throughput.
- Prefill is expected to run on the GPU.

Record the app's `KALSA_GOVERNOR` fit/nGpuLayers/engine_prefill marker, engine `load_tensors`/`llama_kv_cache`/`sched_reserve` lines, MemAvailable before/during/after, RssAnon/PSS, lmkd evidence, GPU kernel compile/cache evidence, `KALSA_TELEMETRY`, and compile-option evidence that `KALSA_COK_ACC_F16` is absent.

**Provenance note from the DeepSeek audit:** P1's decode-side `no_extra_bufts` behavior is in binding `ef901304`, while the requested CI artifact is built from app base `ca2dcc0b`, whose package pins binding `e437b1af`. Preserve and report the observed engine buffer lines; do not infer the repack behavior from the app key alone. If Fit is NoFit, stop Part B as instructed.

## CPU-only quality sentinel preregistration

Use the shipping engine binary, same S23 model file and corpus, `-ngl 0`, `-b 1`, and the same `cpu-q4km-b1.kld` reference for both arms. Repack-on is the default; repack-off uses the supported `--no-repack`/`-nr` option only if `--help` confirms it. One arm each, same seed/context/temperature and remaining argv. “Same” means an absolute difference in displayed median KLD of **at most 0.0005**; above 0.0005 is a detected quality change. No prior quality number exists for this path.

## Host-side preflight before the charge gate

The requested CI artifact `35908860007 / kalsa-apk-arm64-v8a-debuggable-ca2dcc0b4907ce443148c9d772098775b3b6dbf5` is staged at `raw/ci-apk/android/app/build/outputs/apk/release/app-release.apk`. Its bundled `kalsa-apk.sha256` summary verifies OK; SHA-256 is `37c36f3e44b5aae27268cc8a70872f3f8543a66c2adfd4d73f5bbf8432068ab4`. No device action has been taken in this session.

The host `llama-perplexity --help` exposes `--repack, -nr, --no-repack`; use the same flag only if the selected on-device shipping binary confirms it too.

SUPERSEDED — Coordinator amendment (2026-09-24T02:07:18Z): Coordinator 8dcbe6aa authorized Part B while charging because its requested verdict, memory, buffer, RSS, lmkd, and lane-engagement fields are memory/function evidence rather than timing measurements; Parts A and C remain gated on unplugged operation. Coordinator update at 2026-09-24T02:07Z voided this amendment and restored the unplugged protocol.

## Results

### Variant 1 — `kalsa.bench.norepack=1`, one short turn

- **Prediction:** requirement 2998 MiB; Fit if available ≥2998 MiB; no decode `CPU_REPACK` buffer; RssAnon about 1.5 GiB below the repack lane; survive load; GPU prefill plus CPU decode; in-lane decode about 1/1.41 of repack speed.
- **Fit / memory:** `model.fit` was `fits` at `availableMb:4179`; `/proc/meminfo` bracket before load was 4,408,232 kB (4,305 MiB). App `pressure.transition` after load reported `availableMb:2401`; `/proc/meminfo` at turn start/end was 2,312,676/2,356,516 kB. The separate pre-turn warm-up load had also reported Fit (3203 MiB); it is recorded as setup in `raw/setup-logcat.txt`.
- **Buffers / lane:** prefill `CPU_Mapped=205.08 MiB`, `OpenCL model buffer=1307.20 MiB`; decode `CPU_Mapped=1512.20 MiB`; no `CPU_REPACK model buffer` line. `KALSA_SESSION` reported `no_extra_bufts:1`; `KALSA_NATIVE_VARIANT` reported `nGpuLayers: {prefill:99, decode:0}`. GPU prefill and CPU decode lane: **engaged**. The expected `KALSA_GOVERNOR` line was absent; the observed native variant and `model.fit` lines are quoted in the raw log.
- **Turn:** `KALSA_TELEMETRY` reported 252 predicted tokens, `interrupted:false`, `predictedPerSecond=7.824308505777833` (**7.824 t/s**). This is the one-turn in-lane decode result. A `KALSA_GOVERNOR_FALLBACK` line reported `stage:"route_reject"`, `models_loaded:2`, `gpu_fit:2`, `profile_valid:1`.
- **Survival / lmkd:** app PID 5099 remained alive through completion. **lmkd: yes** — during load it reported `0(delay), 37(swap), 50(freelimit), 0(reentrymode) memory pressure events were skipped after a kill`; the log does not identify that killed process. I did not stop any other app.
- **RSS/PSS:** peak RssAnon was **not captured**: the archived sampler emitted zero-valued fields because its parser did not handle `/proc/<pid>/status` spacing. Post-turn sample was `RssAnon=194,540 kB`, `VmRSS=2,079,360 kB`; `dumpsys meminfo` reported `TOTAL PSS=3,802,887 kB`. Treat the peak as unknown, not zero.
- **Brackets:** start 02:22:24Z: unplugged, 100%, 30.5°C, thermal 0, Awake. Before turn 02:26:51Z: unplugged, 98%, 32.8°C, thermal 0, Awake. End 02:31:28Z: unplugged, 96%, 36.6°C, thermal 0, Awake. Battery stayed above the 22% floor; the end temperature is above the next-arm cooldown limit, so Variant 2 waits for status 0 and ≤34.0°C.
- **Raw files:** `raw/B1-start-bracket.txt`, `raw/B1-turn-start-bracket.txt`, `raw/B1-end-bracket.txt`, `raw/B1-logcat-dump.txt`, `raw/B1-turn-logcat-live.txt`, `raw/B1-rss.csv`, `raw/B1-meminfo.txt`, `raw/B1-final-type-ui.xml`, `raw/B1-turn1-send.log`, `raw/B1-rss-sampler.out`.

#### Variant 1 raw-file inventory (`ls -la`, then `wc -l`)
-rw-r--r--  1 marco  staff  1245 Sep 23 22:22 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-start-bracket.txt
      30 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-start-bracket.txt
-rw-r--r--  1 marco  staff  1318 Sep 23 22:26 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-turn-start-bracket.txt
      32 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-turn-start-bracket.txt
-rw-r--r--  1 marco  staff  1330 Sep 23 22:31 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-end-bracket.txt
      32 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-end-bracket.txt
-rw-r--r--  1 marco  staff  46348424 Sep 23 22:25 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-logcat-dump.txt
  369892 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-logcat-dump.txt
-rw-r--r--  1 marco  staff  3713693 Sep 23 22:32 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-turn-logcat-live.txt
   29640 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-turn-logcat-live.txt
-rw-r--r--  1 marco  staff  16222 Sep 23 22:31 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-rss.csv
     479 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-rss.csv
-rw-r--r--  1 marco  staff  4023 Sep 23 22:32 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-meminfo.txt
      78 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-meminfo.txt
-rw-r--r--  1 marco  staff  43684 Sep 23 22:29 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-final-type-ui.xml
       0 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-final-type-ui.xml
-rw-r--r--  1 marco  staff  56 Sep 23 22:30 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-turn1-send.log
       2 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-turn1-send.log
-rw-r--r--  1 marco  staff  0 Sep 23 22:31 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-rss-sampler.out
       0 /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/B1-rss-sampler.out

### Variant 2 — `kalsa.bench.norepack=1`, five turns in one session

- Prediction: requirement 2998 MiB; Fit at available ≥2998 MiB; decode model has no `CPU_REPACK` buffer; RssAnon about 1.5 GiB below repack lane; load survives transient; GPU prefill and CPU decode engage; five turns should complete in one session. Binding provenance is `e437b1af`; report observed engine lines without inferring from the preference key.
- Start bracket: 2026-09-24T02:39:27Z, AC/USB false, 95%, 32.5 °C, thermal 0, Awake, MemAvailable 4,100,672 kB. Background: `adsprpcd` ~100% at bracket; `suspend-service` also recorded.
- Verdict: Fit (`KALSA_SEND phase=fit availableMb=3916`; decision requirement 2998 MiB). Load survived; prefill OpenCL and `nGpuLayers` prefill 99/decode 0. Engine logged prefill `CPU_Mapped` 205.08 MiB and OpenCL model buffer 1307.20 MiB; decode `CPU_Mapped` 1512.20 MiB and no decode `CPU_REPACK` line. `KALSA_SESSION no_extra_bufts=1`. `ggml_opencl` compiled `fa f32` and `fa prepass f16`.
- One turn completed: `predictedPerSecond=5.542320466290537` t/s (turn 1, 88 tokens, not interrupted). Turn 2 failed during prompt evaluation with `failed to eval` after a route-reject decode failure; no second telemetry. The requested five-turn observation is incomplete; turns 3–5 were not run because the app was stuck in the failed generation state. The route-fallback/failed decode means the planned CPU decode lane did not successfully engage; GPU prefill did engage. `KALSA_GOVERNOR` marker absent; fallback said `route Reject during phase handoff`.
- RssAnon sampler peak: 285,968 kB. End sample: 181,132 kB; end meminfo RssAnon 181,128 kB, PSS 3,817,231 kB, MemAvailable 2,429,140 kB. lmkd: yes; log recorded `24(swap), 50(freelimit) ... after a kill`; setup/B1 log also showed system cached-process reclaim. No other app was manually stopped.
- End bracket: 2026-09-24T02:45:39Z, AC/USB false, 93%, 36.1 °C, thermal 0, Awake, MemAvailable 2,455,712 kB. Background `adsprpcd` ~96.5% at end `top` snapshot.
- Raw files: `raw/B2-start-bracket.txt`, `raw/B2-end-bracket.txt`, `raw/B2-logcat-live.txt`, `raw/B2-rss.csv`, `raw/B2-end-meminfo-meminfo.txt`, `raw/B2-thermal-watchdog.log`, `raw/B2-newchat-ui.xml`, `raw/B2-turn1b-type-ui.xml`, `raw/B2-turn1-send-send.log`, `raw/B2-turn2-type-ui.xml`, `raw/B2-turn2-send-send.log`, `raw/B2-turn2-current-ui.xml`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  1242 Sep 23 22:39 raw/B2-start-bracket.txt
      30 raw/B2-start-bracket.txt
-rw-r--r--  1 marco  staff  1331 Sep 23 22:45 raw/B2-end-bracket.txt
      32 raw/B2-end-bracket.txt
-rw-r--r--  1 marco  staff  3180554 Sep 23 22:45 raw/B2-logcat-live.txt
   24564 raw/B2-logcat-live.txt
-rw-r--r--  1 marco  staff  18204 Sep 23 22:45 raw/B2-rss.csv
     336 raw/B2-rss.csv
-rw-r--r--  1 marco  staff  4025 Sep 23 22:45 raw/B2-end-meminfo-meminfo.txt
      78 raw/B2-end-meminfo-meminfo.txt
-rw-r--r--  1 marco  staff  1520 Sep 23 22:45 raw/B2-thermal-watchdog.log
      19 raw/B2-thermal-watchdog.log
-rw-r--r--  1 marco  staff  43763 Sep 23 22:41 raw/B2-newchat-ui.xml
       0 raw/B2-newchat-ui.xml
-rw-r--r--  1 marco  staff  43684 Sep 23 22:42 raw/B2-turn1b-type-ui.xml
       0 raw/B2-turn1b-type-ui.xml
-rw-r--r--  1 marco  staff  56 Sep 23 22:42 raw/B2-turn1-send-send.log
       2 raw/B2-turn1-send-send.log
-rw-r--r--  1 marco  staff  26502 Sep 23 22:43 raw/B2-turn2-type-ui.xml
       0 raw/B2-turn2-type-ui.xml
-rw-r--r--  1 marco  staff  56 Sep 23 22:43 raw/B2-turn2-send-send.log
       2 raw/B2-turn2-send-send.log
-rw-r--r--  1 marco  staff  52063 Sep 23 22:44 raw/B2-turn2-current-ui.xml
       0 raw/B2-turn2-current-ui.xml

### Variant 3 — `kalsa.bench.norepack` absent (control)

- Prediction: requirement 2998 MiB; report only the control verdict and decision-time MemAvailable. Start gate: 2026-09-24T02:50:15Z, unplugged, 92%, 33.6 °C, thermal 0, Dozing; start bracket 33.5 °C, thermal 0, Awake, MemAvailable 4,179,072 kB. Background at bracket: `adsprpcd` about 103%, SystemUI about 21%.
- Result: Fit, `availableMb=3984` (threshold 2998 MiB); `/proc/meminfo` MemAvailable at end bracket 2,257,600 kB. No turn was run. The app's normal launch path loaded the model automatically; no load was forced. lmkd reclaimed cached apps during this automatic load; no apps were manually stopped.
- End bracket: unplugged, 92%, 33.5 °C, thermal 0, Awake. End `top` showed app 455% CPU and `adsprpcd` 100%.
- Raw files: `raw/B3-cooldown-poll.txt`, `raw/B3-start-bracket.txt`, `raw/B3-end-bracket.txt`, `raw/B3-logcat.txt`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  232 Sep 23 22:50 raw/B3-cooldown-poll.txt
      12 raw/B3-cooldown-poll.txt
-rw-r--r--  1 marco  staff  1232 Sep 23 22:50 raw/B3-start-bracket.txt
      30 raw/B3-start-bracket.txt
-rw-r--r--  1 marco  staff  1321 Sep 23 22:50 raw/B3-end-bracket.txt
      32 raw/B3-end-bracket.txt
-rw-r--r--  1 marco  staff  744139 Sep 23 22:51 raw/B3-logcat.txt
    5448 raw/B3-logcat.txt

## Screen-attestation review (coordinator update 2026-09-24)

Kalsa is now foreground, `mWakefulness=Awake`, and `screen_off_timeout=2147483647`; the originally saved timeout was 1800000 ms and must be restored at session end. The earlier bracket files record `Awake` but do not capture `ResumedActivity`, so they do not prove both required conditions (`Awake` and `com.kalsa.app`) at every cell boundary. The affected Part B cells are **INVALID** and require redo: Variant 1 (turn), Variant 2 (five-turn cell; only one completed turn before route-reject failure), and Variant 3 (control verdict). Part A and C had not started and have no measured cells to invalidate. Redos start only after the per-arm temperature/thermal gate passes, with Kalsa foreground and Awake attested before and after each arm/turn.

- Attestation log: `raw/wake-foreground-keepawake.log`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  705 Sep 23 23:32 raw/wake-foreground-keepawake.log
      28 raw/wake-foreground-keepawake.log

## Coordinator correction and B facts (2026-09-24T03:45:07Z)

The coordinator's 03:44 UTC amendment setting A/C to status ≤1 and temperature ≤40 °C is superseded before use. Correct A/C safety gate: stop at thermal status ≥3 or battery temperature ≥44.0 °C; record battery temperature beside every arm. The existing battery floor (stop at ≤22%), unplugged requirement, and Awake + `com.kalsa.app` foreground attestations before/after every arm and turn remain in force. This correction was recorded at 2026-09-24T03:45:07Z.

- B1 (`norepack=1`, one turn): Fit at 4,179 MiB; prefill OpenCL 1307.20 MiB plus CPU_Mapped 205.08 MiB; decode CPU_Mapped 1512.20 MiB, no CPU_REPACK line; peak RssAnon unknown (sampler parser failure); lmkd yes; turn 1 succeeded, 7.824 t/s, GPU prefill yes. Stored brackets say Awake, but foreground activity was not recorded at the arm/turn boundaries: **INVALID**.
- B2 (`norepack=1`, five-turn session): Fit at 3,916 MiB; same observed no-CPU_REPACK buffers and GPU prefill; peak RssAnon 285,968 kB; lmkd yes; turn 1 succeeded, 5.542 t/s, GPU prefill yes; turn 2 failed with coordinator-identified `commit_side: decode-to-prefill watermark is invalid` → `route Reject during phase handoff`; turns 3–5 not run. Awake appears in stored brackets, but foreground activity was not recorded at turn boundaries: **INVALID**.
- B3 (key absent): Fit at 3,984 MiB (decision MemAvailable); automatic repack load logged CPU_REPACK 1511.20 MiB; peak RssAnon not sampled; lmkd yes; no turn, GPU/timing not measured. Stored start/end brackets say Awake, but foreground activity was not recorded at arm boundaries: **INVALID**.
- Attestation source: `raw/B1-start-bracket.txt`, `raw/B1-turn-start-bracket.txt`, `raw/B1-end-bracket.txt`, `raw/B2-start-bracket.txt`, `raw/B2-end-bracket.txt`, `raw/B2-logcat-live.txt`, `raw/B2-rss.csv`, `raw/B3-start-bracket.txt`, `raw/B3-end-bracket.txt`, `raw/B3-logcat.txt`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  1245 Sep 23 22:22 raw/B1-start-bracket.txt
      30 raw/B1-start-bracket.txt
-rw-r--r--  1 marco  staff  1318 Sep 23 22:26 raw/B1-turn-start-bracket.txt
      32 raw/B1-turn-start-bracket.txt
-rw-r--r--  1 marco  staff  1330 Sep 23 22:31 raw/B1-end-bracket.txt
      32 raw/B1-end-bracket.txt
-rw-r--r--  1 marco  staff  1242 Sep 23 22:39 raw/B2-start-bracket.txt
      30 raw/B2-start-bracket.txt
-rw-r--r--  1 marco  staff  1331 Sep 23 22:45 raw/B2-end-bracket.txt
      32 raw/B2-end-bracket.txt
-rw-r--r--  1 marco  staff  3180554 Sep 23 22:45 raw/B2-logcat-live.txt
   24564 raw/B2-logcat-live.txt
-rw-r--r--  1 marco  staff  18204 Sep 23 22:45 raw/B2-rss.csv
     336 raw/B2-rss.csv
-rw-r--r--  1 marco  staff  1232 Sep 23 22:50 raw/B3-start-bracket.txt
      30 raw/B3-start-bracket.txt
-rw-r--r--  1 marco  staff  1321 Sep 23 22:50 raw/B3-end-bracket.txt
      32 raw/B3-end-bracket.txt
-rw-r--r--  1 marco  staff  10364733 Sep 23 23:45 raw/B3-logcat.txt
   81560 raw/B3-logcat.txt

Coordinator amendment recorded 2026-09-24T03:46:20Z: the battery stop floor for all remaining arms is **25%** (supersedes the prior 22% floor). Record `settings get global low_power` in every arm bracket; if it is on at the gate or turns on during an arm, stop the arm/queue and report. A/C continue under the corrected safety stop rules: thermal status ≥3 or battery temperature ≥44.0 °C, with temperature recorded beside each arm. Unplugged and Awake + `com.kalsa.app` foreground checks remain required.

## Session close

The owner’s 25% battery floor and `settings get global low_power` requirement were applied to all remaining A/C arms; every recorded arm bracket showed `low_power=0`, and no arm reached the 25% floor. Start battery was 100% unplugged; final battery was 54% unplugged. Part C is VOID (repack-on hit thermal status 3 twice; repack-off not run). Part A is VOID for both batch sizes (each control and treatment arm hit thermal status 3 twice before completion); no KLD number or pair verdict. Screen timeout was restored to 1800000 ms at 2026-09-24T04:46:09Z. Final state in that restore log: unplugged, 54%, 42.8 °C, thermal 3, `low_power=0`, `mWakefulness=Dozing`, Kalsa resumed.

- Closing evidence: `raw/s23-preflight.txt`, `raw/screen-timeout-restore.log`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  24299 Sep 23 22:08 raw/s23-preflight.txt
     454 raw/s23-preflight.txt
-rw-r--r--  1 marco  staff    348 Sep 24 00:46 raw/screen-timeout-restore.log
      13 raw/screen-timeout-restore.log

## Coordinator update — Mac CPU C and A parking (2026-09-24T04:49:39Z)

Confound for the two S23 C attempts: the B end bracket showed Kalsa still holding the model at 455% CPU, and during C retry 1 MemAvailable fell to 715,792 kB; this resident app load/background pressure may have affected those native-binary attempts. Part A is **parked by coordinator: S23 thermal budget; needs a chunk-resumable protocol**.

### Mac CPU C preregistration

Prediction before running: on the Mac CPU, repack-on versus `--no-repack` will have **|ΔKLD mean| < 0.0005** and **|ΔKLD p99| < 0.0005** over the same 14 corpus chunks, using the same LFM2.5 2.6B Q4_K_M model, `corpus.txt`, `cpu-q4km-b1.kld` reference and `-ngl 0 -b 1 -c 256 -fa off -s 42 --temp 0 --kl-divergence` protocol as the S23 C arms. Set `-t 8` to match the S23 run's logged effective `n_threads = 8`. Repack-on is the default; repack-off adds only `--no-repack`. Report each arm's KLD mean and p99, their differences, and the selected ggml-cpu kernel variant from the runtime log. The host CPU may select a different kernel variant from the S23; this is recorded separately from the numeric prediction. Source must be shipping engine `319b539` or a ref with an empty `ggml/src/ggml-cpu` diff against it. No host result exists yet.

### Mac C arm 1 — repack-on

- Prediction: repack-on vs repack-off has |ΔKLD mean| <0.0005 and |ΔKLD p99| <0.0005. Result: **Mean KLD 0.005132**; **p99 KLD 0.034106** (14 chunks, n_ctx=256, batch_size=1). Exit code 0.
- Selected host ggml-cpu variant, verbatim: `system_info: n_threads = 8 (n_threads_batch = 8) / 10 | CPU : NEON = 1 | ARM_FMA = 1 | FP16_VA = 1 | DOTPROD = 1 | LLAMAFILE = 1 | ACCELERATE = 1 | REPACK = 1 |`. This is the Mac arm64 CPU dispatch line; the S23 arm used its own ARM NEON/ARM_FMA CPU path.
- Raw files: `raw/c-mac-repack-on.log`, `raw/c-mac-repack-on.status`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  3833 Sep 24 00:55 raw/c-mac-repack-on.log
      66 raw/c-mac-repack-on.log
-rw-r--r--  1 marco  staff    12 Sep 24 00:55 raw/c-mac-repack-on.status
       1 raw/c-mac-repack-on.status

### C repack-on attempt 1 — INVALID (thermal stop)

- Prediction: repack-on baseline; compare displayed median KLD with repack-off, with “same” defined as absolute difference ≤0.0005. No completed KLD number.
- Start bracket 2026-09-24T03:49:37Z: unplugged, 77%, 37.2 °C, thermal 0, low_power 0, Awake, `com.kalsa.app/.MainActivity` resumed; MemAvailable 3,849,280 kB. Device binary SHA matched `b0728b2f…5306152`; on-device help confirmed `--no-repack`.
- The CPU run reached chunk 5/14, then was interrupted when the watchdog read thermal status 3 at 41.6 °C. End bracket 03:54:27Z: unplugged, 74%, 40.8 °C, thermal 3, low_power 0, Awake but the launcher was resumed, not Kalsa. **INVALID** by thermal stop and foreground rule; partial chunk values are not a KLD result. Retry C only when thermal status is below 3; no C arm ran to completion.
- Raw files: `raw/C-repack-on-start-attested-bracket.txt`, `raw/C-repack-on-end-attested-bracket.txt`, `raw/C-repack-on.log`, `raw/C-watchdog.log`, `raw/C-watchdog.trigger`, `raw/c-binary-stage.log`, `raw/c-binary-help.txt`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  1470 Sep 23 23:49 raw/C-repack-on-start-attested-bracket.txt
      34 raw/C-repack-on-start-attested-bracket.txt
-rw-r--r--  1 marco  staff  1463 Sep 23 23:54 raw/C-repack-on-end-attested-bracket.txt
      33 raw/C-repack-on-end-attested-bracket.txt
-rw-r--r--  1 marco  staff  1987 Sep 23 23:53 raw/C-repack-on.log
      18 raw/C-repack-on.log
-rw-r--r--  1 marco  staff  1104 Sep 23 23:53 raw/C-watchdog.log
      12 raw/C-watchdog.log
-rw-r--r--  1 marco  staff  88 Sep 23 23:53 raw/C-watchdog.trigger
       1 raw/C-watchdog.trigger
-rw-r--r--  1 marco  staff  1394 Sep 23 23:47 raw/c-binary-stage.log
      19 raw/c-binary-stage.log
-rw-r--r--  1 marco  staff  25888 Sep 23 23:47 raw/c-binary-help.txt
     331 raw/c-binary-help.txt

### C repack-on attempt 2 — INVALID; arm VOID after repeat thermal stop

- Prediction: repack-on baseline; pair “same” if absolute median KLD difference ≤0.0005. No completed KLD number.
- Start bracket 2026-09-24T03:57:01Z: unplugged, 74%, 39.8 °C, thermal 2, low_power 0, Awake, `com.kalsa.app/.MainActivity` resumed. During run: MemAvailable fell to 715,792 kB; thermal status reached 3 at 42.2 °C. End bracket 03:59:54Z: unplugged, 72%, 41.3 °C, thermal 3, low_power 0, Awake, Kalsa resumed.
- This same repack-on arm has now hit thermal status 3 twice; mark the arm **VOID** and do not repeat it. Its partial output reached only chunk 2/14 and is not a KLD result. Repack-off was not run; the C pair is VOID and cannot decide shipping quality.
- Raw files: `raw/C-repack-on-retry1-start-attested-bracket.txt`, `raw/C-retry1-midpoint-attested-bracket.txt`, `raw/C-repack-on-retry1-end-attested-bracket.txt`, `raw/C-repack-on-retry1.log`, `raw/C-retry1-watchdog.log`, `raw/C-retry1-watchdog.trigger`.
- Inventory (`ls -la`; `wc -l`):
-rw-r--r--  1 marco  staff  1482 Sep 23 23:57 raw/C-repack-on-retry1-start-attested-bracket.txt
      34 raw/C-repack-on-retry1-start-attested-bracket.txt
-rw-r--r--  1 marco  staff  1824 Sep 23 23:58 raw/C-retry1-midpoint-attested-bracket.txt
      35 raw/C-retry1-midpoint-attested-bracket.txt
-rw-r--r--  1 marco  staff  1470 Sep 23 23:59 raw/C-repack-on-retry1-end-attested-bracket.txt
      34 raw/C-repack-on-retry1-end-attested-bracket.txt
-rw-r--r--  1 marco  staff  1597 Sep 23 23:58 raw/C-repack-on-retry1.log
      15 raw/C-repack-on-retry1.log
-rw-r--r--  1 marco  staff  552 Sep 23 23:58 raw/C-retry1-watchdog.log
      6 raw/C-retry1-watchdog.log
-rw-r--r--  1 marco  staff  88 Sep 23 23:58 raw/C-retry1-watchdog.trigger
       1 raw/C-retry1-watchdog.trigger

### Mac C arm 2 — repack-off and pair result

- Prediction: |ΔKLD mean| <0.0005 and |ΔKLD p99| <0.0005. Repack-off (`--no-repack`) result: **Mean KLD 0.005517**; **p99 KLD 0.042153** (14 chunks, n_ctx=256, batch_size=1); exit code 0. Pair deltas, off minus on: **mean +0.000385** (within prediction) and **p99 +0.008047** (outside prediction). Verdict: means are within the preregistered bound, but the upper-tail KLD changes materially; the “same” prediction fails on p99.
- Host CPU dispatch line, verbatim in both arms: `system_info: n_threads = 8 (n_threads_batch = 8) / 10 | CPU : NEON = 1 | ARM_FMA = 1 | FP16_VA = 1 | DOTPROD = 1 | LLAMAFILE = 1 | ACCELERATE = 1 | REPACK = 1 |`. The Mac build advertises NEON/ARM_FMA/FP16_VA/DOTPROD plus Accelerate and CPU_REPACK support; `REPACK=1` is compiled capability, while each arm's argv selected default repack-on or `--no-repack`.
- Inputs: model `/Users/marco/kalsa-models/LFM2.5-2.6B-Q4_K_M.gguf` (1,674,454,848 bytes, SHA-256 `79fdf00351b46cf26f020aead28d01889886be87c55fa0eb907e6f9b00bfee14`); corpus `../adreno-precision-bisect/corpus.txt` (18,233 bytes, MD5 `1d037601b756c2cdc94292273b8bce34`); reference `../s23-kld-740-q4-0/raw/cpu-q4km-b1.kld` (455,196,580 bytes, SHA-256 `6edb6c21c9d373f9b46c80936c66a2b5b58b6633c01a1e531120e66362157e8d`). Host binary `/Users/marco/Projects/kalsallama-wt-oom/build/bin/llama-perplexity` already existed, arm64, built from OOM worktree HEAD `9875acabef87af4eeeb17dc5577c352d26d3aa0d`; no build was needed. `git diff 319b539 HEAD -- ggml/src/ggml-cpu` was empty (exit 0).
- Raw files: `raw/run-scripts/c-mac-cpu-pair.sh`, `raw/c-mac-repack-on.log`, `raw/c-mac-repack-on.status`, `raw/c-mac-repack-off.log`, `raw/c-mac-repack-off.status`.
- Inventory (`ls -la`; `wc -l`):
-rwxr-xr-x  1 marco  staff   936 Sep 24 00:54 raw/run-scripts/c-mac-cpu-pair.sh
      18 raw/run-scripts/c-mac-cpu-pair.sh
-rw-r--r--  1 marco  staff  3833 Sep 24 00:55 raw/c-mac-repack-on.log
      66 raw/c-mac-repack-on.log
-rw-r--r--  1 marco  staff    12 Sep 24 00:55 raw/c-mac-repack-on.status
       1 raw/c-mac-repack-on.status
-rw-r--r--  1 marco  staff  3833 Sep 24 00:57 raw/c-mac-repack-off.log
      66 raw/c-mac-repack-off.log
-rw-r--r--  1 marco  staff    12 Sep 24 00:57 raw/c-mac-repack-off.status
       1 raw/c-mac-repack-off.status
