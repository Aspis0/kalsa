# S23 CPU/GPU prefill heat protocol

## Preregistration — Revision 2, before arms

Predictions are copied from `governor-archive-mining/SYNTHESIS.md` §4 Revision 2. GPU prefill will have lower baseline-corrected SoC heat per 1,000 new prompt tokens than CPU on LFM2.5-2.6B QAD-Q4_0; this is a directional hypothesis only, because the prior CPU/GPU heat comparison used another model. GPU may take longer. Battery temperature is expected to rise after compute. No absolute raw end-temperature parity is predicted.

The design is 512 and 1024 new-token prompts × CPU/GPU × 8 matched pairs (32 arms), with pair orders randomized ABBA/BAAB (four pairs per order). Each arm gets a 120-second, 1-Hz pre-arm baseline with model/KV resident; fit `T(t)=a+bt` by OLS. Record through completion plus 60 seconds. Pair start battery temperatures must be within ±2.0 °C; each arm starts at thermal status 0. Use identical fresh-chat prompts if same `nPast=K` cannot be restored; each arm's `nPast` is recorded and must match its frozen value. Prompt token counts must be target ±2. A missed route, join, token, state, unload, or safety condition invalidates that arm and pair; invalid rows remain visible.

Three preregistered heat metrics per sensor/arm:

1. `1000 × max(x) / new_prompt_tokens`, °C per 1,000 prompt tokens.
2. `x(turn_end) / prefill_ms × 1000`, °C per second of prefill compute.
3. Positive trapezoid AUC of `x(t)` over the fixed 60-second post-completion window, °C·s.

Here `x(t)=observed−(a+bt)` from that arm's baseline. Primary sensors are battery, CPU label-group maxima `cpu-0-*` and `cpu-1-*`, GPU max `gpuss-*`, NSP max `nspss-*`, and HAL `SKIN`; no CPU architecture identity is inferred. Latency remains separate.

Planning MDE uses `2.80×√2×SD/√n`, two-sided α=.05 and 80% power, independent arm errors. Prior idle-window SDs give n=8 rough raw MDEs: battery 0.532 °C (1.04 °C/1k for 512 tokens; 0.52 for 1024), skin 0.514 °C, GPU 0.717 °C, NSP 0.705 °C, CPU group 0 0.917 °C, CPU group 1 2.195 °C. These SDs include the observed +1.14 °C/10-min drift and are planning proxies, not residual SDs. Empirical residual SD and MDE will be computed from tonight's arm baselines. Eight pairs/cell are exploratory; effects below the empirical MDE cannot change routing and this study is not confirmatory.

This comparison can price only the tested model, device, app build, prompt lengths, and conditions. It does not establish a universal CPU/GPU heat ranking, energy efficiency, or a router policy change.

## Device/APK verification

- Target: Galaxy S23 only, serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`; Xiaomi receives no commands.
- APK path: `/Users/marco/kalsa-apks/a19f5acd/app-release.apk`.
- Expected and locally verified SHA-256: `1b914f80dd697b73415013cf680f50aa309e61016ced6a2a5962599ec8707d6e`.
- Claimed provenance: CI 36093214162, app `a19f5acd`, engine `kalsa-phone-v1-1-6` / `60a5b9db5`, binding `f9aee4ec`. Device install remains gated on S23 preflight and signature-safe `install -r`.
- Original `screen_off_timeout` was unset; current override is `2147483647`. Restore at session end with `settings delete system screen_off_timeout`.

## Smoke gate — FAILED; stop before heat arms

Before the first smoke turn, the S23 was unplugged at 84%, battery 28.8 °C, thermal status 0, Awake, with `com.kalsa.app/.MainActivity` resumed. The timeout was `2147483647` ms. App startup auto-loaded LFM2.5-2.6B and completed `KALSA_PREWARM` (`promptN=1812`, about 16.1 s); no send was used to load it. APK install via `adb -s <S23> install -r` returned `Success` (no signature failure). Package remains `versionName=0.1.0`, `versionCode=1`, debuggable; `lastUpdateTime=2026-09-25 01:03:52`.

### CPU smoke — route checks passed

The `/bench route cpu` control returned `bench: route=cpu (next turn, no reload)`. Before `Reply READY.`, the bracket was 05:10:42 UTC, Awake, Kalsa resumed, unplugged, 84%, 28.8 °C, thermal 0. Joined evidence has `turnId="1"`: `KALSA_WINDOW` reports `kvHeld:false`, `nPast:null`; `KALSA_TELEMETRY` reports `attempt:1`, `prompt_n:92`; `KALSA_GOVERNOR` reports `route_requested:"cpu"`, `route_mode:"cpu"`, `route_push:"applied"`, `route_mismatch:false`, with one chunk `{requested:"cpu",actual:"cpu",tokens:92,forced:true}`. The top-level `forced:false` is recorded; the per-chunk forced route meets the smoke check. After the turn, 05:11:25 UTC: Awake, Kalsa resumed, unplugged, 84%, 29.8 °C, thermal 0. This was a short smoke turn, not a heat arm.

### GPU smoke — invalid; route rejection and runtime fallback

The `/bench route gpu` control returned `bench: route=gpu (next turn, no reload)`. Before `Reply READY.`, the bracket was 05:12:24 UTC, Awake, Kalsa resumed, unplugged, 83%, 29.7 °C, thermal 0. `KALSA_WINDOW` for `turnId="2"` reported `kvHeld:true`, `nPast:1942`. The engine then logged `KALSA_GOVERNOR_FALLBACK {stage:"route_reject", models_loaded:2, reason:"route Reject during phase handoff", gpu_fit:2, profile_valid:1}` and the app logged `KALSA_GOVERNOR_RUNTIME_FALLBACK` for the same turn, `attempt:2`. The retry's telemetry joined on `turnId="2"` but was `attempt:2`; its governor record has `route_push:"skipped"`, null route fields and null `route_chunks`. It does not satisfy the required applied/forced GPU route. The post-turn bracket at 05:14:13 UTC found `mWakefulness=Dozing` (Kalsa activity still resumed), unplugged, 83%, 31.1 °C, thermal 0. Thus this turn is also invalid under the screen-state rule. Per the smoke gate, stop here; no heat arms were run.

### Arm table

No 120-second baseline was collected and no heat metric was computed. “Not run” cells were not started, not invalid measurements. The planned 8 pairs per length require both backends; the GPU smoke failure stops the complete experiment.

| Prompt length | Backend | Planned arms | Valid arms | Metric 1: °C/1k tokens | Metric 2: °C/s prefill | Metric 3: °C·s post-tail | nPast | Status |
|---:|---|---:|---:|---:|---:|---:|---|---|
| 512 | CPU | 8 | 0 | — | — | — | — | Not run; GPU smoke gate failed |
| 512 | GPU | 8 | 0 | — | — | — | — | Not run; GPU smoke gate failed |
| 1024 | CPU | 8 | 0 | — | — | — | — | Not run; GPU smoke gate failed |
| 1024 | GPU | 8 | 0 | — | — | — | — | Not run; GPU smoke gate failed |

Invalid smoke row: GPU `turnId=2`, attempt 1 route rejection/runtime fallback; the retry is attempt 2 with route skipped, and its post-turn screen-state bracket was Dozing. The CPU smoke passed the route hook check but is not a matched heat result. No 512- or 1024-token arm has an invalid measurement row because none began.

### Residual variation, MDE, and scope

Empirical residual SD is **not estimable**: the required per-arm 120-second baselines were not collected. Empirical MDE is likewise **not estimable**. The preregistered idle-SD planning proxy remains unchanged (battery raw MDE 0.532 °C at n=8; approximate GPU/NSP/skin/CPU label-group values are listed above); it is not substituted for tonight's residual estimate.

This session establishes that the CPU force hook can produce a joined forced-CPU chunk on this APK and that the GPU route currently rejects during phase handoff and enters runtime fallback. It licenses no CPU-vs-GPU heat comparison, no per-token heat price, and no routing-policy change.

## Device restoration and raw evidence

The screen timeout was restored to its original unset state with `settings delete system screen_off_timeout`; command exit was 0 and the subsequent `settings get system screen_off_timeout` returned `null`. At that final check the device was unplugged, 83%, 31.1 °C, thermal status 0. The timeout was not changed again.

The session logcat was captured with `adb -s <S23> logcat -b all -v threadtime` and stopped after the smoke failure. Raw artifacts under `raw/` include the APK SHA verification, preflight, install/package result, launch/startup, CPU/GPU route controls and turn brackets, UI captures, extracted smoke markers, timeout restoration and full logcat. No command was sent to the Xiaomi. No heat arm was run; the only retry was the APK's automatic fallback within the GPU smoke turn.

### File inventory

`ls -la` and `wc -l` are recorded in `raw/evidence-inventory.txt` after this report was written.
