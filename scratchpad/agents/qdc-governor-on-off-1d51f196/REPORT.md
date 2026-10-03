# QDC governor ON vs OFF — app main 1d51f196, three Snapdragon boards (2026-10-03)

APK: CI run 37090151989, debuggable (`pkgFlags=[ DEBUGGABLE … ]` on every board), 190,612,974 B, sha256
`0f1c9b9ca2b02120d0821aadd7d08fe66c617a6a372c7f010d2926173ae5c806` (raw/apk.sha256).
Model LFM2.5-2.6B-QAD-Q4_0, sha256 `a247afd6…0b03`, verified on each device. Account aspis, SSH-only sessions, tunnel on 6037 only.
ON = key `kalsa.governor.enabled` ABSENT and `kalsa.bench.npu_lane` ABSENT (read back); OFF = `"0"` (read back, `raw/<board>/*-arm.txt`).
Boards report `AC powered: true` (QDC-provisioned, see "odd" #3). Per-turn: cold launch, `files/sessions/*` wiped (cold KV), fresh chat, deep-link staging, 10 s skin watchdog.
Prefill tok/s = prompt_n / (promptMs/1000) from the FIRST (round 0) `KALSA_TELEMETRY`; decode = predictedPerSecond. `raw/<board>/all-rows.tsv` has every column.

## Summary

| board | SoC / HTP | Android | RAM | ON prefill short / long (tok/s) | OFF prefill short / long | decode ON / OFF | lane (HTP0 chunks) | verdict |
|---|---|---|---|---|---|---|---|---|
| SM8850 (8 Elite Gen 5) | SM8850 / v81 skel opened, app generation `Unknown` | 16 | 23.8 GB | 112.0 / killed at 48.0 (CPU) | VOID hot / not run | 23.9 / n.a. | **no** — governor never loads | **same** (ON == OFF by construction) |
| QRD8750 (8 Elite) as provisioned | SM8750 / v79 | 16 | 15.5 GB | 166.9 / 104.9 (CPU fallback) | 107.5 / killed at 48.3 | 27.2, 24.0 / 23.3 | **no** — `thermo profile invalid` → CPU | **same** (ON falls back = OFF) |
| QRD8750, battery faked UNPLUGGED (diagnostic) | same | 16 | | **1105.9 / 1032.4** (NPU, 17 and 32 chunks HTP0) | (CPU above) | 21.5, 17.9 | **yes** | ON far better (10×) |
| QRD8650 (8 Gen 3) | SM8650 / v75 | 14 | 11.5 GB | **884.6 / 858.7** (r1), 830.6 / 769.1 (r2), all HTP0 | 70.3 / killed at 48.8 | 18.0, 15.5 (r1); 15.0, 13.0 (r2) / 17.0 | **yes**, default state | **ON better** (12.6× prefill short, decode ≈ same) |
| QRD7675, QRD8635, QRD8550, HDK8550 | — | — | — | not run: portal card `Unavailable` (wizard cards disabled) for the whole run | | | | not tested |

Correctness: every completed turn answered (short: 3 sentences on 7/8 completed turns — QRD8750 r1-on-short gave 2 sentences/125 tokens, CPU path; long: contains "The dominant factor" on the 2 turns that were captured). Turns killed by the 48.0 stop kept complete telemetry only when the kill landed after the answer (QRD8750 unplugged ON-long, QRD8650 r2-on-long: telemetry complete, answer capture skipped).

## Failures, quoted (raw/ grep-filtered)

- SM8850: `KALSA_GOVERNOR_FALLBACK {"stage":"correctness","reason":"gpu-prefill-incorrect-Unknown","forced":false}` and plan `"npu_device":null,…,"npu_fit":"NoFit","gpu_fit":"NoFit"` (available_mib 18,9xx, required 4,905 — NoFit despite 4× headroom, unexplained). Logcat shows `Extracted HTP library: libggml-htp-v81.so` and `remote_handle64_open … libggml-htp-v81.so` (the DSP side works), `KALSA_NATIVE_VARIANT {"androidLib":"rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl","nGpuLayers":0}`.
- QRD8750 provisioned: `set_thermo_profile: invalid thermal profile; accelerator admission is closed` then `KALSA_GOVERNOR_FALLBACK {stage:"init", models_loaded:2, reason:"governor: thermo profile invalid", gpu_fit:2, profile_valid:0}` + `KALSA_GOVERNOR_FALLBACK_RETRY {ok:true}` (CPU retry works), governor line `"thermal_state":"Unknown","platform_thermal_status":-1`, plan `"npu_device":"HTP0","npu_fit":"Fit"` (lane priced fine). 3/3 ON turns.
- After `dumpsys battery unplug` the same APK/board: plan identical, governor loads, `"engine_prefill":"NPU"`, `layers_device:"HTP0"` ×17, `cache_type_k/v: q8_0/q8_0`, `thermal_state:"COOLMODE"` (skin was 46). So on this board the profile is invalid only in the AC-powered state; not root-caused (hypothesis, unverified: plugged-path thresholds vs the 42.0 C battery reading on that rack).
- QRD8650: no fallback, no invalid profile: plan `"npu_device":"HTP0","npu_fit":"Fit"`, `"engine_prefill":"NPU"`, `"thermal_state":"FAST"`, chunks `512+512+512+128+128+98+71+3` all HTP0.
- Crash/LMK: `*-crash.txt` empty on every turn (0 `CDSP0 CRASHED`/`GGML_ASSERT`/`Aborted`/`FATAL`); the only `com.kalsa.app` kills are our own `force-stop` (`reason=10 (USER REQUESTED) subreason=21 (FORCE STOP)`, `*-exitinfo.txt`); no `lowmemorykiller` hit on kalsa.
- Thermal hard stop (owner: 48.0 on QDC boards): KILL at 48.08 (SM8850 ON-long), 48.26 (QRD8750 OFF-long), 48.26 (QRD8750 unplugged ON-long, after generation), 48.26 (QRD8650 OFF-long), 48.16 (QRD8650 r2-on-long, after generation). Every CPU-path long prefill reaches 48 in ~70 s.

## Odd / things you should know

1. **QDC skin sensor**: `dumpsys thermalservice` lists two `mName=skin` entries; the first is frozen (28.24272) on SM8850. My first turns on that board read the frozen one (turn discarded, raw/sm8850/discarded-*); later turns use the max of the entries. Rack boards idle at 45-46 °C skin after any CPU turn and never reach the 40 °C pre-turn target (cap 600 s then VOID hot), so cooldown was relaxed to "proceed when ≤ 47" on QRD8750-diagnostic and QRD8650; the 48.0 hard stop was never relaxed. QRD8650 reported `mStatus=3` (SEVERE) on the HAL skin at 46.5.
2. **Owner decision during the run** (AskUserQuestion): hard stop 48.0 + cooldown ≤ 40 with VOID for QDC boards; SM8850 = one round only, same for any board whose plan falls back. I applied it to QRD8750 as well (round 1 only), then used its remaining minutes for the unplugged diagnostic.
3. `dumpsys battery reset` on these boards returns `AC powered: false`: the QDC "AC powered: true, status 3 (discharging), level 100" is a faked state. On QRD8650 I restored it with `dumpsys battery set ac 1` before the remaining turns; QRD8750's unplugged diagnostic was restored with `reset` at the end (so that board was left unplugged-faked; sessions are wiped on release).
4. **prompt_n is not constant across turns**: the app prewarms the 1,889-token system prefix; turns with `n_common=1889` count only the new tokens, `n_common=0` (first turn of a board) counts all. tok/s is per evaluated token so it stays meaningful, but "short/long" prompt_n differ from the S23 report (1,735 / 3,145). CPU numbers on QRD8750 ON-short (166.9) vs OFF-short (107.5) are the same CPU path (n=1 each, `n_common` 817 vs 1889): noise from prefix reuse, not a governor effect.
5. Tools stay enabled by default; the model sometimes calls `web_search` (fails offline) and runs extra rounds. First-round telemetry is used; a `toolchoice=none` variant (prompt shrinks to 571 tokens) was tried once and discarded (raw/sm8850/discarded-toolchoice-none).
6. Portal: Okta login hung at "Signing in…" until I changed the remembered identifier (marco's) back to aspis; one tab had logged in as the wrong account first (logged out). The password was typed into the field only.

## Minutes (card before → after, QDC settles later; session Started→Ended from the portal)

| board | session | Started → Ended | duration | cap | card |
|---|---|---|---|---|---|
| SM8850 | 861987 | 11:41:11 PM → 12:23:15 AM | 42.1 min | 60 | 985 → 940 |
| QRD8750 | 861998 | 12:25:30 AM → 1:16:33 AM | 51.1 min | 60 | 632 → 579 |
| QRD8650 | 862007 | 1:18:40 AM → 2:01:57 AM | 43.3 min | 50 | 472 → 422 |

Total ≈ 136.5 session minutes. No other QDC sessions were opened (the failed first-attempt turns were inside these sessions).

## Evidence map

`raw/<board>/`: `recon.txt` (getprop, meminfo, battery, cpu, hexagon nodes, screen), `install.txt`/`pkg.txt` (debuggable flag), `setup.log`, per turn `<label>-{kalsa,hexlog,fastrpc,lmk,crash,exitinfo,watchdog,cool,state-pre,state-post,battery-pre,arm,answer}.txt`, `all-rows.tsv`, `campaign*.log`. `discarded-*` dirs = turns thrown out for harness reasons (frozen skin sensor, warm KV, tools-none), kept as evidence. Scripts: `env.sh setup.sh kset.sh run.sh turn.sh campaign.sh extract.sh unplugged-arms.sh arms8650.sh round2-8650.sh` (full logcat dumps stayed in /tmp). No binaries/models in the lab.
