# Xiaomi 14 governor night — preregistration

Written and timestamped 2026-09-24T02:11:41Z, before any measurement on the Xiaomi 14 in this session. Predictions are locked once an observed number is recorded.

## Mandatory screen and foreground gates — Marco addendum

Added 2026-09-24 before any Xiaomi measurement, per Marco. These are hard preflight and per-turn validity gates for every cell:

1. Before X1, send `input keyevent KEYCODE_WAKEUP` to the explicitly selected Xiaomi serial. Save the current value from `settings get system screen_off_timeout`, then set it to `2147483647`. Unlock the phone and keep Kalsa in the foreground for the entire session. Record both commands and exit codes.
2. Immediately before and after every generated turn, record `dumpsys power | grep mWakefulness=` and the resumed/foreground activity. A turn is valid only when the phone is `Awake` and `com.kalsa.app` is in front both before and after. Otherwise mark it INVALID, wake the phone, bring Kalsa back to the foreground, and redo that turn; do not include the invalid attempt in cell results.
3. Before the first cell, record the app's battery-restriction state (Android app standby/battery optimization and any visible Xiaomi/HyperOS battery saver restriction that can be read without changing it). Do not change this state. If an intervention becomes necessary, describe it and its time in the report before proceeding.
4. At session end, restore `screen_off_timeout` to the exact value saved before changing it and verify the restored value. Record the command and exit code.

All commands, including wake, screen timeout, activity, power, and restriction checks, must use `adb -s <Xiaomi serial>`. Never query an unqualified target device.

## Mandatory shipping-APK governor-failure and timing gates — Marco addendum

Added 2026-09-24 before any Xiaomi measurement, per Marco. Do not debug or modify the governor failure described here; record the observed behavior only.

1. X1 remains a one-turn runtime probe. After recording the X1 first-turn result, send one additional turn in the same chat and record whether it fails with `commit_side: decode-to-prefill watermark is invalid` / `Governor decode failed: route Reject during phase handoff`. This one extra turn is sufficient; do not investigate the cause.
2. X2 is limited to turns 1–3 in one chat on this APK. Record per-turn evidence and the exact failure mode, inspect whether the error text appears in the chat history that is sent to the model, then stop X2. Do not attempt turns 4–20; this cell will rerun on a fixed APK.
3. For X3, create a fresh chat for every prompt in both arms. Every measured prompt must therefore be that chat's first turn.
4. **Thermal stop rule (unplugged phone):** stop the current cell if Android thermal status reaches 3 or higher, or battery temperature reaches 44.0 °C or higher. Record the triggering reading and stop time.
5. **Timing-cell start comparability:** each timing arm/cell must start at thermal status 0. For an A/B comparison, its starting battery temperature must be within 2 °C of the first arm's starting temperature. Reach that condition with the screen on and Kalsa in the foreground; do not wait for or impose any fixed target temperature. Keep the 3-minute idle period with screen on and Kalsa foregrounded before a timing cell, then check and record status and battery temperature. Record battery temperature beside every timing result. The per-turn Awake/foreground validity gate still applies.
6. **Battery floor:** stop all device work when battery reaches 25% or lower. This owner decision supersedes the earlier 22% floor.
7. **Power-saver state:** record `settings get global low_power` beside every cell. On MIUI/HyperOS, also record `settings get system POWER_SAVE_MODE_OPEN` if that setting exists. If either indicates that power saving is on, stop and report; do not turn it off.

## Predictions (recorded first)

Prior evidence: the same model requires 4,358.7 MiB by the governor fit arithmetic, and the S23 had only 2,229–3,536 MiB available, so it refused with `NoFit` (`s23-governor-smoke/REPORT.md:429-457`). The Xiaomi 14 has 12 GB RAM; prior Xiaomi inspection identified its Adreno 750 and thermal behavior (`results/gpu_xiaomi/S0_REPORT.md:1-5,78-87`). I expect more than 4,359 MiB available before model load and therefore `Fit`, with reported required memory near 4,359 MiB (band 4,200–4,600 MiB). This is refuted by `NoFit`, available memory below the reported required amount, or a required figure outside that band.

Prior evidence: the S23 smoke never compiled OpenCL kernels because its `NoFit` prevented attachment (`s23-governor-smoke/REPORT.md:694-699`). The Xiaomi's older standalone OpenCL build documents backend gaps, including Q4_0 support, but is a different pin (`results/gpu_xiaomi/S0_REPORT.md:89-109`). I predict X1 will reach the governor and attempt OpenCL compilation; compilation may fail on a Q4_0 kernel gap. For `gpubusy`, I predict the host-side path is readable, but this is low confidence because prior Xiaomi evidence does not establish this sysfs read. A positive engage verdict requires a GPU prefill route, measurable busy samples during prefill (at least 20% for a sustained portion), and idle samples under 5% during decode. Any missing kernel compile evidence, refusal/fallback, unreadable counter, or no busy/idle separation refutes the full X1 prediction.

Prior performance evidence: Xiaomi S0 was an unplugged device session, but it measured OpenCL build conditions rather than app throughput (`results/gpu_xiaomi/S0_REPORT.md:9-16,89-109`). The same 2.6B model on a different Qualcomm board produced about 28.3 tok/s governor decode and 28.5 tok/s CPU decode (`qdc-governor-s5/REPORT.md:235`); its comparable 1024-token GPU prefill was 4.06 s versus 6.69 s CPU, a 1.65x ratio (`qdc-governor-s5/REPORT.md:239`). I predict X2 will sustain 20–35 tok/s across 20 turns, with a late-run decline no greater than 25% from the median of turns 1–3 unless direct frequency caps or temperature rise show throttling. This is a weak cross-device estimate; refute if the 20-turn median lies outside the band, throughput falls more than 25%, or a throttle/pause/reroute appears.

Prior paired decode values were near parity: B/A = 0.993 on the other board (`qdc-governor-s5/REPORT.md:235`). For X3 I predict governor-on / CPU-only decode ratio 0.85–1.15 on each prompt length, and CPU-prefill time / GPU-prefill time ratio 1.2–2.5 for the ~1.5k and ~4k prompts, with the short prompt ratio 0.8–1.8 because fixed overhead may dominate. These are cross-device expectations; each prompt's ratio outside its band refutes that prompt prediction. Energy is not predicted unless a clean battery-counter window is obtained. 

X4 is conditional on X1–X3 completion and battery at least 40%. Adreno 750 GPU-prefill token correctness is uncertain: prior Adreno 750 QDC tests recorded deterministic divergence for GPU-prefilled turns, while a different GPU generation passed (`qdc-governor-s5/REPORT.md:208,231`). I predict a first-64-token mismatch may occur, band: first divergence token 1–64; exact identity is the competing outcome. Token identity refutes the mismatch prediction; any divergence confirms it. No X4 run is predicted if its gate is not met.

## Fixed materials

- Device: Xiaomi 14, `23127PN0CG` / `houji`, SM8650, Adreno 750, Hexagon v75.
- APK run 35908860007, app `ca2dcc0`, binding `e437b1af`, engine `319b539`:
  `~/Projects/kalsa-moe-experiments/scratchpad/agents/governor-nofit/raw/ci-apk/android/app/build/outputs/apk/release/app-release.apk`
  SHA-256 `37c36f3e44b5aae27268cc8a70872f3f8543a66c2adfd4d73f5bbf8432068ab4` (verified before device work).
- Model `/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`, 1,593,894,944 bytes, SHA-256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` (verified before device work).
- No personal or real user text. Prompts will be synthetic and their source stated in the report. Raw logcat may contain generated model text and stays under `raw/`.

## Measurements

No Xiaomi device measurements have been taken at the time of this preregistration. Add results below without changing the predictions above.


## Daily-driver screen rule — superseding owner correction

Added 2026-09-24 before X1 measurement. Marco states the current `screen_off_timeout` is his own value, `86400000` (24 hours), and it is sufficient. Do not lower or otherwise change it. Before each device step, check Awake and that keyguard is not showing; send `KEYCODE_WAKEUP` only while Awake and unlocked. Never press power or send `KEYCODE_SLEEP`. If keyguard ever appears, the session ends because the owner PIN is unavailable. Restore exactly `86400000` only if this session changes it; this session intends to leave it unchanged. This correction supersedes the earlier instruction in this file to set it to `2147483647`.


## CI run 35961215542 and P1 decision — owner update

Added 2026-09-24 before any measurement on this artifact. Do not use run 35958095874: it failed. Wait for run 35961215542 to complete successfully, verify the bundled APK SHA-256, and verify `gh run view 35961215542 --json headSha` equals `57eca6077bf4b850b0ad4484ab870f29a29a4184`. Only then use `adb -s <Xiaomi serial> install -r`; stop on signature mismatch.

On success, run X2 as 20 turns in one chat with the governor enabled and record each turn's governor route, `KALSA_KVTRIM`, `KALSA_GOVERNOR_FALLBACK`, `KALSA_GOVERNOR_RUNTIME_FALLBACK`, prefill and decode telemetry, and thermal readings. Record every decode throughput value as **P1 conditional (repack on 12 GB)** and verify `decode_repack:true`, the approximately 4518 MiB requirement, and the engine CPU_REPACK buffer lines. X3 runs after X2 with fresh chats for each prompt and arm. The coordinator says decode throughput on this conditional-P1 APK is representative; X3 is restored to the sequence.

## Coordinator battery and functional-only update

Added 2026-09-24 before any X2 functional checks on the fixed APK. Stop all timing work. X3 is postponed to a later unplugged session; do not produce X3 ratios tonight. At 31% battery there is no room for timing cells under the 25% floor. Correctness checks may run while AC or USB power is active. Once run 35961215542 was verified and installed with `install -r`, the required X2 is a 20-turn functional check in one chat, recording per turn: governor route and GPU-prefill yes/no; `decode_repack` and CPU_REPACK buffer presence; KVTRIM and governor fallback markers; answer coherence/error-text classification; RssAnon and lmkd. Any ms or tokens/s appearing in captured telemetry must be labeled **charging — not a measurement**. Charging does not waive the heat stops: thermal status ≥3 or battery temperature ≥44.0 °C stops the cell. If charging does not begin, stop at 25%, restore any changed setting, clean this session's `/data/local/tmp` files, and report the X2 functional check as not run. Existing predictions above are unchanged and must not be edited.
