# QDC governor ON vs OFF — app main 1d51f196 (WORK IN PROGRESS, per-board commits)

APK: CI run 37090151989, debuggable (device `pkgFlags=[ DEBUGGABLE ...]`), sha256 0f1c9b9c…c806 (raw/apk.sha256), 190,612,974 B.
Model LFM2.5-2.6B-QAD-Q4_0, sha256 a247afd6…0b03 verified on device. Boards are AC powered (`AC powered: true`).
Harness: `*.sh` here (adapted from the S23 option-a turn.sh: bounds from uiautomator, English labels, cold KV per turn by wiping files/sessions).

## SM8850 (Snapdragon 8 Elite Gen 5, Android 16, 23.8 GB RAM) — session 861987, 41:11→ended 00:23:15 (≈42 min)
- `KALSA_GOVERNOR_PLAN {"gpu_fit":"NoFit",…,"npu_device":null,"npu_lane":"auto","npu_fit":"NoFit","available_mib":~18900,"available_src":"fresh"}`
- `KALSA_GOVERNOR_FALLBACK {"stage":"correctness","reason":"gpu-prefill-incorrect-Unknown","forced":false}` → the governor never loads: the app's HTP-generation map does not know SM8850 (the v81 skel IS extracted and opened by fastrpc). ON == OFF by construction (CPU, `nGpuLayers:0`).
- ON-short: prefill 112.0 tok/s (prompt_n 1491), decode 23.9 tok/s, 3 sentences. ON-long: killed by the 48.0 °C hard stop mid-prefill. OFF-short: VOID hot (skin 45.6 after a 600 s cooldown).
