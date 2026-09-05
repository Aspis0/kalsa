# REPORT — Cell S5: governor in the app, A/B on Qualcomm Device Cloud

## Identity

APK `ac4820d`, SHA-256 `1a1356ac1f15c3362d45d7a9a16c1c79789d52130f5b44b1b50ad28371e2e2bc`;
the raw package proof says `application-debuggable` and includes `DEBUGGABLE`
flags (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_A_t1_apk_sha.txt:1-6`).
Model: `/Users/marco/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf`, locked SHA-256
`a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`
(PREREG `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/PREREG.md:14-18`);
raw push evidence confirms the exact `1593894944`-byte file (raw
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/model_push.txt:1`).

Board: QRD8650 / SM8650, serial `7b5f6c52`, userdebug and debuggable (raw
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/recon.txt:1-12`).
Run 3: QDC session `799285`, job `sa803354`, tunnel `6037` (session/job from
PLAN `/Users/marco/Projects/kalsa-moe-experiments/PLAN.md:869-870`; tunnel raw
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/recon.txt:1-2`).
Turn anchors ran from `09-04 21:19:34.000` through `09-04 21:37:03.000` (raw
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_A_t1_anchor_stamp.txt:1`,
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t4_anchor_stamp.txt:1`).
That span is approximately `17.5` minutes; the QDC 8 Gen 3 budget before the
session was `822` minutes (raw anchors above; PLAN `/Users/marco/Projects/kalsa-moe-experiments/PLAN.md:875`).

## What ran

The fixed prompt was `Reply with one short sentence about mountains` (PREREG
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/PREREG.md:24-27`). A was flag-off, single-context CPU; B was flag-on, governor. The locked order was `ABABABAB`; Run 3 produced eight `status=0` rows on the
same board, APK, model, prompt, and sampler (raw
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/results.tsv:2-9`).
QRD8650 was run first; no second-device result is present.

| run_id | raw path | outcome |
|---|---|---|
| `sa803354` | `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/` | eight rows, driver `final_rc=0` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/driver-sa803354.log:17`) |
| `sa803304` | `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803304/` | A1 data, B1 VOID (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803304/results.tsv:1-3`) |
| `sa803287` | `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803287/` | A1 data, B1 VOID (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803287/results.tsv:1-3`) |

### Run 1 — VOID, five-line record

A1 completed at `42731.59` ms TTFT and `24.3348769635885` tok/s (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803287/results.tsv:2`). APK was `c5c55a4`, SHA `12ecb731…3284` (PREREG `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/PREREG.md:20-22`).
B1 entered governor mode, then prewarm skipped with `Governor mode does not support MTP or speculative decoding` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803287/QRD8650_B_t1_logcat_all.txt:2649-2656`).
The diary attributes this to `shouldUseMTP()` throwing whenever `hasGovernor()` was true (PLAN `/Users/marco/Projects/kalsa-moe-experiments/PLAN.md:707-720`).
The driver stopped B1 with final `rc=1` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/driver-sa803287.log:1-4`).
The separate crash capture records `END reason=exit_6`, the `set -u` local-expansion crash fixed before relaunch (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803287-VOID-crash-line90/END.txt:1`; PLAN `/Users/marco/Projects/kalsa-moe-experiments/PLAN.md:695-700`).

### Run 2 — VOID, five-line record

A1 completed at `45951.471` ms TTFT and `24.9396701933346` tok/s (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803304/results.tsv:2`). APK was `db1606c`, SHA `dd77516a…2b6a` (PREREG `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/PREREG.md:158-162`).
The fresh-board launch saw `DELETE_FAILED_INTERNAL_ERROR`, package count `0`, and the old gate stopped the turn (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803304-VOID-gate-freshboard/QRD8650_A_t1_uninstall_old.txt:1`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803304-VOID-gate-freshboard/QRD8650_A_t1_package_count.txt:1`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803304-VOID-gate-freshboard/END.txt:1`).
The rerun B path rejected the residual prefill and failed `n_eval: 305, n_past: 1024`, then emitted `tokensPredicted:0` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803304/QRD8650_B_t1_logcat_all.txt:4849-4854`).
Its governor line reported CPU/CPU and zero commit (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803304/QRD8650_B_t1_logcat_all.txt:4857-4858`).
The driver’s final `rc=1` is retained (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/driver-sa803304.log:1-6`; roots PLAN `/Users/marco/Projects/kalsa-moe-experiments/PLAN.md:764-806`).

## Governor evidence

| turn | native variant | prewarm `promptMs` | governor commit |
|---|---|---|---|
| B1 | prefill `99`, decode `0` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t1_logcat_all.txt:2605`) | `5156.717` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t1_logcat_all.txt:2758`) | `9206272` bytes, `10.476` ms (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t1_logcat_all.txt:6009`) |
| B2 | prefill `99`, decode `0` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t2_logcat_all.txt:2581`) | `5147.748` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t2_logcat_all.txt:2733`) | `9206272` bytes, `8.573` ms (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t2_logcat_all.txt:6010`) |
| B3 | prefill `99`, decode `0` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t3_logcat_all.txt:2636`) | `5155.171` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t3_logcat_all.txt:2835`) | `9206272` bytes, `9.731` ms (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t3_logcat_all.txt:6176`) |
| B4 | prefill `99`, decode `0` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t4_logcat_all.txt:2577`) | `5154.895` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t4_logcat_all.txt:2724`) | `9206272` bytes, `9.457` ms (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t4_logcat_all.txt:6055`) |

Every B governor line also says `engine_prefill=GPU`, `engine_decode=CPU`,
`thermal_state=FAST`, `thermo_source=bench-skin`, `fit=Fit`, and empty fallback
reason (raw B1/B2/B3/B4 governor lines in the table). The same bench thermo
override fed every turn with cached `batt_temp_tenths_c=314` and `t_idle_c=31.4`
(raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t1_status.txt:1`); live HAL skin ran `29.338–40.002` °C: A1-before `29.338`, B3-before `37.562`, B3-after `38.838`, and B4-after `40.002` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_A_t1_before_thermal.txt:45`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t3_before_thermal.txt:45`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t3_after_thermal.txt:45`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t4_after_thermal.txt:45`), so each FAST state was computed from stale input. The anchored app/pid
`lmkd|am_kill|lowmemorykiller` count, fallback count, and app-scoped lmkd count
are zero (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/results.tsv:3,5,7,9`).

## Endpoint verdicts against PREREG

### Endpoint 1 — greedy oracle: FAIL

All four A rows have `ids_sha=0f4b385a...`; the same A hash appears in runs 1
and 2, so A determinism spans three APK builds: `c5c55a4`, `db1606c`, and
`ac4820d` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/results.tsv:2,4,6,8`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803287/results.tsv:2`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803304/results.tsv:2`; APK identities PREREG `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/PREREG.md:20-22,158-162,179-182`). All four B rows have `ids_sha=ed228033...` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/results.tsv:3,5,7,9`).
The first divergence is position `14`: A=`20`, B=`5439`; the sequences match
through position `13` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_A_t1_logcat_all.txt:5728`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t1_logcat_all.txt:6010`).

The fork has `/Users/marco/Projects/kalsallama-wt-governor-v03/build/bin/llama-tokenize`; decoding the recorded IDs against the locked GGUF gives A: “The user wants a short sentence about mountains. This is a simple, general knowledge question that doesn't require web search. I can answer directly without any tool use”; B: “The user wants a short sentence about mountains. This is a simple request that doesn't require any tool use. I should write one short sentence about mountains, following” (IDs raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_A_t1_ids.txt:1-32`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t1_ids.txt:1-32`).

This is deterministic divergence; leading hypothesis: GPU (Adreno 750, f16 path) vs
CPU numerics in the prefill KV; alternatives not excluded: decode-context KV restore
fidelity after the 9.2 MB commit, chunked-prefill boundary effects
(512+512+128+128+49), policy/context routing differences (raw governor lines
above; PLAN `/Users/marco/Projects/kalsa-moe-experiments/PLAN.md:820-832`). The greedy
contract is satisfied (`n=67` for A and `n=63` for B), but equality fails (raw
token lines cited above).

### Endpoint 2 — speed: TTFT not measurable; decode NOT ANALYZABLE under the locked rule

B telemetry has `promptMs=0` on every B turn (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t1_logcat_all.txt:6006`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t2_logcat_all.txt:6006`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t3_logcat_all.txt:6173`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t4_logcat_all.txt:6052`). The prior timer statement was an inference; it is now DIAGNOSED: `/Users/marco/Projects/kalsa-wt-governor/node_modules/llama.rn/cpp/jsi/JSICompletion.h:193` calls `llama_perf_context(ctx->active_ctx())`, which reads the decode context in governor mode; fork fix `6ed44f567` and app fix `64931c1` are in flight (PLAN `/Users/marco/Projects/kalsa-moe-experiments/PLAN.md:901-905`). Thus the TTFT ratio cannot be computed.
The only GPU-vs-CPU prefill comparison is prewarm-based: B is about `5157` ms,
while A ranges from `9308.16` to `9879.509` ms (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t1_logcat_all.txt:2758`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t4_logcat_all.txt:2724`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_A_t1_logcat_all.txt:1828`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_A_t4_logcat_all.txt:1659`). This is prewarm, not the endpoint; PREREG says both arms pay the same promptMs prefill artifact (PREREG `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/PREREG.md:98-104`).

| turn | A decode tok/s | B decode tok/s |
|---|---:|---:|
| `1` | `24.2413278458686` | `22.0780645317295` |
| `2` | `24.4669044947164` | `22.0670600441201` |
| `3` | `24.3977399681591` | `4.26032765977159` |
| `4` | `24.1045605468785` | `21.8946595797476` |

All values are raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/results.tsv:2-9`. Decode verdict: **NOT ANALYZABLE under the locked rule (zero oracle-PASS pairs); descriptive plateau medians turns 2-4: A 24.4, B 21.9 tok/s (direction B < A)** (same raw rows). B3 is the `4.26` tok/s descriptive outlier.
B3 all-process lmkd evidence has `76` lines and one kill: `com.android.dynsystem:dynsystem` PID `6063` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t3_lmkd_all.txt:1-76`). MemAvailable fell from `8641760` to `4411844` kB in B3, versus A3 `8709648` to `6396284` kB (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/driver-sa803354.log:9-12`). The app-scoped lmkd criterion is zero; the stronger global no-kill claim is not clean.

### Thermals

The TSV records skin `31.4` before and after every turn, with FAST on every B
turn (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/results.tsv:2-9`). The same stale cached value fed the app-side override on every turn: `batt_temp_tenths_c=314` and `t_idle_c=31.4` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t1_status.txt:1`). Live HAL skin ran `29.338–40.002` °C: A1-before `29.338`, B3-before `37.562`, B3-after `38.838`, and B4-after `40.002` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_A_t1_before_thermal.txt:36,45`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t3_before_thermal.txt:36,45`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t3_after_thermal.txt:36,45`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t4_after_thermal.txt:36,45`). Some B after-readings therefore exceeded the declared `39.5` °C warning threshold (PREREG `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/PREREG.md:89-96`). The thermal dimension is not interpretable; the driver is fixed for Run 4 to use the HAL value.

## Deviations

Run 3 used driver commits `874e326b`, `7fe207ca`, `0c004018`, `6bbb67b6`, and
`df07c616` (git history for `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/d_run.sh`). These cover the fresh-board gate, `set -u` local fixes, D1–D5 timing/counting fixes, memory snapshots, and all-process lmkd evidence. Delta audit 3 established that `gpu_prefill_measured` is a telemetry label, not the routing decision (PLAN `/Users/marco/Projects/kalsa-moe-experiments/PLAN.md:820-832`; PREREG `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/PREREG.md:174-175`).

## Diagnosis

The native variant, GPU prewarm, and non-zero KV commits establish the first
governor turns in this APP integration (the fork’s own QDC governor cell is
prior art on-device). The deterministic token-14 split is the corresponding
correctness failure; B3 shows the memory cost of the second context.

## Threats to validity

The batteryless board reports plugged in the injected BatteryManager profile,
but the bench override sets `plugged:false`; this is synthetic, not production
thermal input. The two-context memory pressure, cached skin extraction, QDC
transport, UI timing, and one-board result limit generalization.

## Verdict

**G1-REFUTED on this APK; governor mechanism PROVEN.** The S5 hypothesis is
refuted: oracle FAIL, decode is NOT ANALYZABLE under the locked rule, and TTFT
is not measurable. The first
end-to-end governor turns prove device-side GPU prefill, KV commit, and CPU
decode on this APK. No claim is made for the unrun second device.

## Next action, ranked

1. Make governor prefill feed app `promptMs`, or add native `KALSA_GOVERNOR prefill_ms` telemetry.
2. Explain token-14 divergence by comparing logits/KV on-device with a short prompt, or run the fork cross-backend test on a Mac GPU if available.
3. Measure memory headroom with two contexts and characterize the B3 pressure path before treating decode speed as stable.
4. Add the V79 policy GPU branch before any 8 Elite S5 rerun.

## Run 4 (6/09) — descriptive addendum

Run 4 used APK `e8c2b1f` (SHA begins `e16cf0b6`; raw
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_A_t1_apk_sha.txt:1`), QDC session `799321`, job
`sa803390`, and QRD8650 serial `72c4dabb` (raw
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/recon.txt:1-4`). Three turns completed (A1, B1, A2); the fourth, B2, aborted (raw
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/results.tsv:1-5`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/driver-sa803390.log:7-9`).

| turn | TTFT ms | decode tok/s | HAL skin °C | injected thermo: temp/t_idle/trend | MemAvailable kB |
|---|---:|---:|---:|---|---:|
| A1 | 334.86 | 24.43 | 30.35→33.409 | 304/29.521/+0.363 | 8914548→6590964 |
| B1 | 454.259 | 20.71 | 34.378→35.448 | 344/29.521/+1.569 | 8838288→4626560 |
| A2 | 323.599 | 23.47 | 35.726→38.078 | 357/29.521/+0.539 | 8892920→6586488 |
| B2 | — | — | 38.14→36.913 | 381/29.521/+0.917 | 8834808→not captured |

Table evidence: results `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/results.tsv:2-5`; thermo status `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_A_t1_status.txt:1`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_B_t1_status.txt:1`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_A_t2_status.txt:1`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_B_t2_status.txt:1`; memory files `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_A_t1_meminfo_before.txt:3`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_A_t1_meminfo_after.txt:3`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_B_t1_meminfo_before.txt:3`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_B_t1_meminfo_after.txt:3`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_A_t2_meminfo_before.txt:3`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_A_t2_meminfo_after.txt:3`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_B_t2_meminfo_before.txt:3`.

B1 logged `promptMs 454.259`, `prefill_ms 454.259`, `prefill_chunks "2+13"`,
`prefill_ctx_ngl 99`, commit `9206272` bytes / `6.181` ms, `thermal_state FAST`,
and decode `20.71` tok/s; it also logged exactly
`KALSA_SESSION {"op":"save","ok":false,"reason":"governor-mode"}` (raw
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_B_t1_logcat_all.txt:5847,5850,5852`).

The oracle failed again: A=`0f4b385a…`, B=`ed228033…`, the same hashes as Run 3
(raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/results.tsv:2-4`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/results.tsv:2-9`). This is deterministic across boards, not sampling noise (serials raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/recon.txt:1`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/recon.txt:1`).

TTFT semantics: A1/A2 report `tokensCached 1397` with `tokensEvaluated 1329`
(raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_A_t1_logcat_all.txt:7095`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_A_t2_logcat_all.txt:5922`); the system prompt was served from prewarm KV and the turn reuses `1314/1329` prompt tokens after prewarm (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_A_t1_logcat_all.txt:7017`) and B1 records `prefill_chunks "2+13"` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_B_t1_logcat_all.txt:5850`). Thus this-turn TTFT is a roughly `15`-token prefill: B `454.259` versus A `334.86` ms, consistent with (not proving) GPU chunking overhead on tiny batches—not the `1024`-token comparison. The latter remains prewarm-based: Run 3 GPU about `5.16` s versus CPU `9.3–9.9` s (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_B_t1_logcat_all.txt:2758`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_A_t1_logcat_all.txt:1828`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_A_t4_logcat_all.txt:1659`).

The `44`-second Run 3 A1 `promptMs` versus Run 4 A1 `334.86` ms (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_A_t1_logcat_all.txt:5725`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_A_t1_logcat_all.txt:7095`) is **not
determinable from logs**: both say `reusing 1314/1329 prompt tokens` (raw
`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_A_t1_logcat_all.txt:5378`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_A_t1_logcat_all.txt:7017`). Both also show session save `ok=true` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/QRD8650_A_t1_logcat_all.txt:5736`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_A_t1_logcat_all.txt:7105`); no clearCache/timer-reset line is emitted. Most likely is stale cross-phase prompt timing around the prewarm/session boundary, not actual new-token evaluation; the settling evidence would be one native per-turn prefill start/end line with the perf-counter reset. Run 3→4 also changes `64931c1` (governor-only prompt timing), `e8c2b1f` (both-KV clear and governor session save/load skip), and board serial `7b5f6c52→72c4dabb` (raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803354/recon.txt:1`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/recon.txt:1`; APK/run-4 log `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_A_t1_apk_sha.txt:1`).

Thermal gate: B2 live HAL skin was `38.14` °C and injected trend `+0.917` °C/min
(raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_B_t2_before_thermal.txt:45`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_B_t2_status.txt:1`). The governor logged exactly `admit_prefill: prefill admission is waiting for a safe tabled chunk`, then prewarm truthfully logged `skip eval-failed`; no telemetry/governor line followed (`governor_count=0`, `telemetry_rc=1`, raw `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_B_t2_logcat_all.txt:2589,2592`, `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-governor-s5/raw/sa803390/QRD8650_B_t2_status.txt:1`). This is the first observation in this evidence base of the policy's thermal gate on a device: the unplugged threshold is `38.0` °C (policy `/Users/marco/Projects/kalsallama-wt-governor-v03/src/llama-governor-policy.cpp:42-45`). Product finding only: policy Wait must degrade to CPU prefill instead of stalling; admission’s `engine=CPUFallback` is not consumed by runtime (delta audit `/Users/marco/Projects/kalsa-moe-experiments/docs/AUDIT-S3S4-governor-app.md:154-160`).

The anchor sequence ran from `09-04 23:25:07.000` (A1) to `09-04 23:32:49.000` (B2 anchor), i.e. ≈ 8 min of turns; the QDC portal showed Started 2:21:40 AM / Ended 2:40:44 AM (≈ 19 min billed), and the pre-session 8 Gen 3 budget was 797 min per the portal card at session creation (both operator-observed in the browser, recorded in PLAN.md diary 6/09; not present in raw/).

Descriptive medians promised by the run-4 amendment: with only A1/A2 (n=2) and B1 (n=1) completed, no plateau median (turns 2–4) can be formed; the per-turn values above are the whole descriptive record. TTFT A 334.86/323.599 ms (this-turn, ~15 new tokens), B 454.259 ms; decode A 24.43/23.47, B 20.71 tok/s; skin 30.35 → 38.14 °C across the four turns.
