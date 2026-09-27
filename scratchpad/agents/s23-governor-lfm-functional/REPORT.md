# S23 Governor / LFM functional check

Status: complete. This is a **functional check, on charger**. Battery/skin/thermal readings below were used only as stop gates; no thermal conclusion or benchmark comparison is made. No app/engine code was changed.

## Setup and safety

- Device: Galaxy S23 / SM-S911U / SM8550, TLS adb endpoint `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`; AC powered throughout, `persist.traced.enable=0`.
- Installed app: debuggable `com.kalsa.app`, versionName `0.1.0`, lastUpdateTime `2026-09-26 22:15:30`; `run-as com.kalsa.app id` succeeded. Model selected and loaded: `LFM2.5 2.6B · QAD-Q4_0`, at `files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf`.
- Governor was already ON in Settings → Advanced before the relaunch. It was not toggled during this session and remains ON, matching the original state.
- Screen was made Awake/unlocked with Kalsa foreground for the session. Brightness, timeout and `stay_on_while_plugged_in` were temporarily adjusted because the device started in Doze with brightness 0; all were restored to their recorded original values in `raw/session-20260927/display-restored.txt`.
- No `kalsa.bench.thermo` write occurred. A read-only AsyncStorage query found the key ABSENT, so the app selected the BatteryManager path.
- Before/after turn records show each stop gate below its limit (thermal status <3 and skin <43 C); no stop fired. These are gate records only.

## A — plugged profile / t_idle

**Verdict: constructed and accepted during the five plugged turns; exact load-time latch value is not observable in this APK’s logs.** The load plan emitted `gpu_fit=Fit`. Each turn emitted `thermo_source="battery"`, `thermal_state="FAST"`, `failed=false`, empty `failure_reason`, and an applied GPU route. There is no `KALSA_GOVERNOR_THERMO valid:false`, native `invalid thermal profile`, or `hot-plugged profile` warning in the capture. This is functional evidence the plugged profile was accepted, not a direct print of the latch.

Source reconstruction of the BatteryManager input from each immediately-pre-send `dumpsys battery` snapshot:

| Turn | BatteryManager temp | plugged | `t_idle_c` forwarded | `sensor_valid` / `t_idle_valid` |
|---:|---:|:---:|---:|:---:|
| 1 | 35.0 C | true | 35.0 C | true / true |
| 2 | 35.4 C | true | 35.4 C | true / true |
| 3 | 35.7 C | true | 35.7 C | true / true |
| 4 | 36.0 C | true | 36.0 C | true / true |
| 5 | 36.0 C | true | 36.0 C | true / true |

The five reconstructed inputs span 1.0 C, plausible for this battery idle sample. If the first per-turn sample is the actual latch, their maximum drift is 1.0 C, below the engine’s 1.5 C guard; the successful turn telemetry is consistent with acceptance but does not expose the latched baseline. `sensor_valid` is source-reconstructed: the native module sets it from `EXTRA_PRESENT && temperature > 0`; the captured battery state reports `present=true` and positive temperature. Exact per-call JSON and the engine’s numeric latched reference are not logged, so direct latch-value stability remains unverified.

The installed binding source (`github:Aspis0/kalsa.rn@88b2b57e`) uses plugged thresholds `{warm_enter=min(t_idle+3,42), warm_exit=t_idle+1, cool_enter=min(t_idle+4.5,42), cool_exit=t_idle+1.5, critical_enter=43, critical_exit=t_idle+1}`. With the first per-turn reconstructed input (35.0 C), that profile evaluates to 38.0 / 36.0 / 39.5 / 36.5 / 43.0 / 36.0 C respectively. The runtime only logs its selected state, not the numeric threshold tuple; all five turn records say FAST.

Source log shapes and exact session lines are in `raw/session-20260927/source-log-shapes.txt` and `governor-log-lines.txt`. Representative lines:

```text
09-27 09:12:04.640 ... ReactNativeJS: KALSA_GOVERNOR_PLAN {"gpu_fit":"Fit","decode_repack":false,"required_mib_with_repack":4518.12,"required_mib_without_repack":2998.06,"available_mib":4006.86,"bench_norepack_forced":null}
09-27 09:16:00.562 ... ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"GPU","engine_decode":"CPU","commit_bytes":12088320,"commit_ms":4.822,"prefill_ms":1117.262,"prefill_chunks":"102","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","fallback_reason":"","failed":false,"failure_reason":"","attempt":1,"turnId":"1","route_requested":"auto","route_mode":"auto","route_push":"applied","route_mismatch":null,"route_chunks":[{"index":0,"requested":"auto","actual":"gpu","tokens":102,"prefill_ms":1117,"forced":false}],"route_chunks_dropped":0,"route_chunks_truncated":false}
```

The source warning shapes, absent from this run, are `set_thermo_profile: invalid thermal profile; accelerator admission is closed` and `set_thermo_profile: hot-plugged profile is CPU-only with no cool mode`.

## B — GPU prefill / CPU decode

**Verdict: GPU prefill execution directly confirmed on turn 1; route telemetry reports GPU on all five turns. CPU decode is confirmed on all five.** The idle gpubusy tail was 34 samples over 5.6 s, all `0 0`. Sampling during prefill windows had median 0.120 s spacing (8.3 Hz). Turn 1 gpubusy rose during the prefill window to `611307 1012925` at uptime 146629.97–146630.42 s. The short cached 15-token prefills on turns 2–5 had no sampled rise (`0 0`); gpubusy is global and sampled, so these brief intervals are not independent per-process proof. Their `route_chunks.actual="gpu"` and `engine_prefill="GPU"` still report the GPU path.

All rows are **functional, on charger**; ms and tok/s are app diagnostic telemetry, not benchmark results.

| Turn | `route_requested` / push / mismatch | Prefill backend / ms | Decode backend / tok/s | gpubusy during prefill |
|---:|---|---:|---:|---|
| 1 | auto / applied / null | GPU / 1117.262 | CPU / 7.416 | rise: `611307 1012925` |
| 2 | auto / applied / null | GPU / 416.016 | CPU / 14.040 | no rise sampled |
| 3 | auto / applied / null | GPU / 407.617 | CPU / 11.927 | no rise sampled |
| 4 | auto / applied / null | GPU / 410.684 | CPU / 14.120 | no rise sampled |
| 5 | auto / applied / null | GPU / 407.294 | CPU / 13.758 | no rise sampled |

The exact `KALSA_TELEMETRY` and `KALSA_GOVERNOR` lines are retained in the full `logcat.txt`; derived prefill-window sample ranges are in `gpubusy-prefill-summary.txt`. User prompts were the short text `Say only: ok`.

## Open

- A valid unplug transition needs a physical unplug; it was not simulated. Unplug handling remains open.
- The installed app logs no valid thermo payload and no numeric latch value. A future instrumentation build is needed to directly capture exact load-time `t_idle_c` and the numeric plugged thresholds actually latched.
- Per-turn gpubusy rises were captured for turn 1 only; the other four short prefill windows were flat at the sampler’s resolution. The gpubusy node is global, not process-attributed.

Raw device states, UI proofs, full logcat, gpubusy samples, source-derived input table, and restoration records are under `raw/session-20260927/`.
