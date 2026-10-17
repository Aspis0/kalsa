# REPORT — logit-oracle R5 sanity, Snapdragon 8 Elite (QRD8750 / SM8750), QDC

Cell: `qdc-oracle-r5-8750`. Date 2026-10-16/17 (local board clock 10-16, portal 10-16 23:37 → 10-17 00:14).
PREREG: `scratchpad/agents/logit-oracle/PREREG.md`, rules R1–R6, thresholds 0.03 / 0.02 / 0.10 unchanged.

## VERDICT

**R5 is NOT met.**

- **PASS half — NOT MET.** The 8 Elite did **not** pass R1–R4 on ≥2 independent pairs. It passed
  **0 of 2**. Both pairs FAIL rule R2 (`|dp1| <= 0.02` at every one of 32 steps), with R1 clean
  and `divergences=0` in both.
- **FAIL half — LEFT OPEN.** No fault-injection runtime switch exists in this APK (evidence below).
  Nothing was built.

The CPU-vs-CPU control **PASSES at `max_dp1 = 0.0000`**, so the instrument is sound and the two
R2 failures are attributable to the GPU prefill path, not to measurement noise.

## SESSION / BOARD

| field | value |
|---|---|
| portal | qdc.qualcomm.com, account already logged in (no credential or 2FA prompt encountered) |
| session id | **899012**, name `oracle-r5-8elite`, wizard: Mobile → QRD8750 → SSH only |
| board | Snapdragon 8 Elite, Mobile Reference Design, **QRD8750 \| Android 16** (SDK 36) |
| adb serial | **57dd7911** |
| `ro.soc.model` | **SM8750** (`ro.product.device=sun`, `ro.board.platform=sun`) |
| cap | **120 min** (minimum fitting the ~120 min budget) |
| tunnel | `ssh -i /Users/marco/.ssh/qdc_ed25519 -L 6037:sa903081.sa.svc.cluster.local:5037 -N sshtunnel@ssh.qdc.qualcomm.com` |
| listener on 6037 | `ssh` (verified before every turn by `env.sh`; `lsof` showed `ssh … [::1]:6037` and `127.0.0.1:6037`) |
| started / ended | Submitted 10/16 23:37:47, Started **10/16 23:41:13**, Ended **10/17 00:14:30** |
| **Total Minutes Used** | **34m** of the 120 min cap (portal "Total Minutes Used: 34m") |

Portal-level device option **Screen Always On was enabled** (device configuration step) as the
first line of defence against the known QRD8750 doze trap; the in-turn `WAKEUP` keep-awake loop
was kept as well. No doze occurred (see validity table), so no re-run was needed.

## HASHES

| artifact | sha256 | verified |
|---|---|---|
| APK `app-release.apk` | `1e27ba67fcc18851c08123c6b4885aa72249cbaedb596521d6b98fa95cd9cab5` | on the Mac **before** install (`env.sh` refuses otherwise); install returned `Success` |
| model `LFM2.5-2.6B-QAD-Q4_0.gguf` | `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` | **on the board** (`sha256sum` on device: `device model sha OK`), size on device 1593894944 = expected |
| `prompt-short.txt` | `db9734d5be806607a3aba62d282b5c8981165cc6cef21e13009c71456bee7de5` | `shasum -c prompts.sha256` OK |
| `prompt-long.txt` | `9a85d11f36e9b567f970aaa618ea3e2c446d35f7100a66748fc0cc64ba66d3d0` | `shasum -c prompts.sha256` OK |
| `enc-short.txt` | `da04e3201c7e795d0c018432236cb5d6bdf31f98913947d4aa71addd53bd391b` | computed (not in `prompts.sha256`) |
| `enc-long.txt` | `81d91081ea87228576b8807a2a894ccb876d0e5b8c95f7779754abaecc04e0bc` | computed (not in `prompts.sha256`) |
| `oracle_logit.py` | `685c7a0878cceda2d2712397ee2ac5d6d61ea3e77e9ae3c77fc39adaddcd8909` | **UNMODIFIED** — byte-identical to the QDC cell copy; never edited |

`prompts.sha256` as inherited lists only `prompt-short.txt` / `prompt-long.txt`; the `enc-*`
deep-link payloads are not covered by it, so their hashes are recorded above.

## PER-TURN

Skin is the **live HAL entry #2** (`skin-index.txt` = 2). Evidence it is the right one —
`skin-samples.txt`: `entries=2`, `sample1=[45.57 38.595] sample2=[45.57 38.442] sample3=[45.57 38.3]`.
Entry #1 is frozen at 45.57 C; entry #2 moves. `max()` would have read the frozen 45.57 and
falsely aborted every cooldown. Never used.

| turn | arm | prompt (tokens) | skin start | skin max | skin last | wall | probs rows | ids |
|---|---|---|---|---|---|---|---|---|
| A1short | A = CPU, governor off | short, 595 | 38.522 | 43.206 | 42.804 | 52 s | 512 | 32 (tokens-line) |
| B1short | B = GPU prefill forced, TF to A1's ids | short, 595 | 39.882 | 41.553 | 41.553 | 37 s | 33 | 32 (tokens-line) |
| A2long | A = CPU, governor off | long, 2005 | 39.857 | **46.754** | 46.035 | 81 s | 661 | 32 (tokens-line) |
| B2long | B = GPU prefill forced, TF to A2's ids | long, 2005 | 39.950 | 42.791 | 42.227 | 52 s | 33 | 32 (tokens-line) |
| C1short | control: CPU, forced to A1's ids | short, 595 | 39.913 | 41.195 | 41.195 | 36 s | 33 | 32 (tokens-line) |

The two pairs are **independent**: different prompts (595 vs 2005 tokens, different
`KALSA_TELEMETRY prompt_n`), different forced-id sets (A1 vs A2). Per the S23 finding, repeated
pairs on one prompt would be replicas, so this cell does not use any.

Note: `<turn>-state-post.txt` records only the **first** `mName=skin` line (the frozen 45.57 one),
so end-of-turn skin above is taken from the watchdog series, which reads the live entry.

### Stops and validity

| turn | wake at send | watchdog KILL | crash lines |
|---|---|---|---|
| all five | `mWakefulness=Awake` | 0 | 0 |

No doze → no turn is INVALID, no re-run was required. Peak skin 46.754 C (A2long), below the
48.0 C KILL line. Cooldown to <= 40 C ran before every turn (`cool_wait_s` 1–257 s). Battery
faked unplugged at 30.0 C for every turn (`batt=30.0` in every `-cool.txt`).

### Backend lines, quoted

Arms A (CPU) and C (control) — no governor turn line is emitted with the governor off; the
native variant line is the backend evidence:

```
A1short: KALSA_NATIVE_VARIANT {"androidLib":"rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl","nGpuLayers":0}
C1short: KALSA_NATIVE_VARIANT {"androidLib":"rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl","nGpuLayers":0}
```

Arms B (GPU) — `KALSA_GOVERNOR_TURN` is not emitted by this build; the board's equivalent is the
`KALSA_GOVERNOR` line, plus a `nGpuLayers` split in the variant line:

```
B1short: KALSA_NATIVE_VARIANT {"androidLib":"rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl","nGpuLayers":{"prefill":99,"decode":0}}
B1short: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":4320768,"commit_ms":4.625,"prefill_ms":2197.327,"prefill_chunks":"128+128+128+126+82+3","prefill_ctx_ngl":99,"forced":true,"thermal_state":"FAST","thermo_source":"bench-skin","fit":"Fit","npu_device":null,"npu_fallback":null,"cache_type_k":"q8_0","cache_type_v":"q4_0","prefill_kv":"device","decode_hops":0,"decode_tokens_cpu":32,"decode_tokens_npu":0,"decode_tokens_gpu":0,…}
B2long:  KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":13705728,"commit_ms":14.165,"prefill_ms":7109.948,"prefill_chunks":"128+128+128+126+512+512+128+128+128+84+3","prefill_ctx_ngl":99,"forced":true,"thermal_state":"FAST","thermo_source":"bench-skin","fit":"Fit","npu_device":null,"npu_fallback":null,"cache_type_k":"q8_0","cache_type_v":"q4_0","prefill_kv":"device","decode_hops":0,"decode_tokens_cpu":32,"decode_tokens_npu":0,…}
```

`engine_prefill:"GPU"` with `prefill_ctx_ngl:99` and `forced:true`: **prefill really ran on the
GPU**, decode on CPU (the governor's two-context design), with `npu_lane=off`. This is the
board's equivalent of the `dev:["GPUOpenCL"]` evidence the task asked for.

## ORACLE OUTPUT (verbatim, unmodified `oracle_logit.py`, TF 0.03 0.02 0.10)

```
oracle=FAIL rule=R2 steps=32 max_dlogp=0.7283 max_dp1=0.0656 divergences=0 first_div=-1     (pair 1, A1short vs B1short)
oracle=FAIL rule=R2 steps=32 max_dlogp=0.6984 max_dp1=0.0708 divergences=0 first_div=-1     (pair 2, A2long  vs B2long)
oracle=PASS rule=none steps=32 max_dlogp=0.0000 max_dp1=0.0000 divergences=0 first_div=-1     (control, A1short vs C1short)
```

`oracle_exit=0` and `steps_exit=0` for all three (the oracle returns 0; the verdict is in the line).

Per-rule breakdown (`steps-*.txt`):

| pair | R1 steps | R2-first steps | worst step |
|---|---|---|---|
| 1 (short) | `[]` | `[3, 5, 6, 9, 15, 16]` | step 16, margin 0.400, dp1 0.066 |
| 2 (long) | `[]` | `[5, 8, 10, 16, 18, 21, 23]` | max_dp1 0.0708 |
| control | `[]` | `[]` | — |

R1 is clean on every pair (no confident-CPU top-1 flip); both failures are pure R2 breaches —
probability drift with the top-1 unchanged. `divergences=0` everywhere is expected: B is forced
to A's ids in TF mode, so tokens cannot diverge.

## THE CONTROL IS THE LOAD-BEARING RESULT

CPU vs CPU on the same prompt, same forced ids, gives `max_dlogp = 0.0000` and `max_dp1 = 0.0000`
over all 32 steps — bit-identical, exactly as the S23 M5 cell found for the engine under greedy.
So the R2 breaches in pairs 1 and 2 come from the GPU prefill numerics, not from the harness,
the prompt staging, the forced-id mechanism, or run-to-run drift.

## FAIL HALF — no such switch exists in this APK (left open)

Searched, nothing built:

1. **The lab's own negative control is not in this build.** `agents/archive-gpu-repo-history/REPORT.md:571`
   — commit `33ebbd210`, 2026-09-06, *"bench: fault-injected Adreno f16 GEMM
   (KALSA_BENCH_FAULT_INJECT, off by default) — oracle negative control, never merge.
   **Branch-only, not in any pin.**"*
2. **That switch is absent from the shipped APK.** `KALSA_BENCH_FAULT_INJECT` and the whole
   `KALSA_BENCH_` prefix appear in **0 of the 41** `lib/arm64-v8a/*.so` shipped in this APK
   (`strings` over every `.so`), and `FAULT_INJECT` / `faultInject` / `fault_inject` /
   `injectFault` / `perturb` / `sabotage` all match **0** in `assets/index.android.bundle`
   (`corrupt`/`poison` match twice, both unrelated app strings).
3. **The app's shipped bench keys are all routing/routing-adjacent, none corrupts numerics.**
   Enumerated from the bundle: `sampling, probs, force_ids, toolchoice, toolgate, route,
   governor_force, npu_lane, thermo, engine, norepack, devmodels, nativelog, decode_hop,
   guard_headroom, zone_probe, energy_trace, speculative, nctx, winbudget, legacywindow,
   ranking, digestcadence, thinking, format, eager_delay_ms` (+ `kalsa.governor.enabled`,
   `kalsa.web.enabled`, `kalsa.tools.*`). `decode_hop` and `guard_headroom` are decode-cadence /
   pacing levers (`LlamaService.ts:2525-2560`); `norepack` / `engine.useMmap` are load-mode
   levers (`engine/loadPolicy.ts`). None deliberately corrupts a kernel.
4. **The known-bad GPU paths are kernel-build properties, not runtime switches.** The f16-product
   GEMM (`agents/adreno-acc-type/`) and the 20-FAIL batched GEMV are reachable only by building a
   variant — which this task forbids. `agents/gpu-divergence-verdict/REPORT.md:43-45` independently
   records that the fault-injected negative control "never produced a pair" and that R5's sanity
   control was never completed.

**Left open.** Closing it needs either the branch-only fault-injected engine (a build) or an
owner-approved numerical-corruption lever added to the app. Neither was available or permitted here.

## WHAT COULD NOT BE VERIFIED

- **`KALSA_GOVERNOR_TURN` is not emitted by this build.** I used `KALSA_GOVERNOR`
  (`engine_prefill:"GPU"`, `prefill_ctx_ngl:99`, `forced:true`) plus the
  `KALSA_NATIVE_VARIANT` `nGpuLayers` split as the GPU evidence. I did not see the literal
  `dev:["GPUOpenCL"]` field the task quoted; the board's Adreno path is exposed as
  `prefill nGpuLayers=99` on the `…_hexagon_opencl` variant instead.
- **No `dev` array was observed at all** in any `KALSA_*` line of the five turns; if the portal
  build names the GPU backend some other way, that field was not in the captured logs.
- **n = 2 pairs.** Both failed, so the verdict "not ≥2 passing pairs" is safe at this n; but this
  cell cannot say how often the 8 Elite would pass, only that it did not pass here.
- **`kalsa.model.id` was left set** to `lfm2.5-2.6b`. It is app configuration, not a bench key;
  every bench key was removed and read back absent.
- The board's `Skin` HAL entry #1 stayed frozen at 45.57 C for the whole session; the live entry
  (max 46.754 C) is the one all stops were applied to.

## CLEANUP PERFORMED

- All 12 bench keys deleted and **read back absent**: `kalsa.bench.sampling`, `probs`,
  `toolchoice`, `force_ids`, `governor_force`, `npu_lane`, `route`, `thermo`,
  `kalsa.governor.enabled`, `kalsa.web.enabled`, `kalsa.tools.device`, `kalsa.tools.calendar`.
- Battery fake **reset and read back**: before `temperature: 300, AC powered: false` → after
  `dumpsys battery reset`: `temperature: 510, status: 3` (the board's real pre-fake reading from
  `recon.txt`). `svc power stayon false`.
- Chat store wiped before every turn (`chat_rows before=… after=0`, memory/persona rows 0).
- QDC session **899012 ended in the portal** (Status: Completed, 34m used — no minutes left running).
- SSH tunnel **closed**; `lsof -nP -iTCP:6037 -sTCP:LISTEN` → none, no `ssh.qdc.qualcomm.com`
  processes, `adb devices` on 6037 → empty.

## FILES

- oracle + step tables: `raw/sa903081/oracle-*.txt`, `raw/sa903081/steps-*.txt`
- per-turn probs/ids: `raw/sa903081/<TURN>-probs.jsonl`, `<TURN>-ids.txt`
- per-turn logs: `raw/sa903081/<TURN>-kalsa.txt`, `-hexlog.txt`, `-crash.txt`, `-lmk.txt`,
  `-watchdog.txt`, `-cool.txt`, `-state-pre.txt`, `-state-post.txt`, `-arm.txt`
- recon/skin: `raw/sa903081/recon.txt`, `skin-samples.txt`, `skin-index.txt`, `battery-faked.txt`,
  `install.txt`, `pkg.txt`
- full logcats were kept out of the repo (atomically under `/tmp/qdcr5/sa903081/`), per the cell's
  collection rule; only the filtered `KALSA_*` / hex / crash / lmk extracts are committed here.