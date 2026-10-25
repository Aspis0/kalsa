# S23 single-APK session — preregistration

Written 2026-09-24T15:29:30Z before any device command or measurement. Predictions are locked once a device result is recorded.

## Artifact target

Wait for CI run `36020315876` (`apk.yml`) to succeed. Expected app commit: `67ade7a88e2fc1887b05e355d9c1ee648e0a3878`, arm64-v8a, debuggable. Before installation, record `headSha`, artifact SHA-256 and APK identity/provenance. Install only with `adb install -r`; any signature mismatch ends the session.

Expected included engine is `8eac584bb` or its verified descendant. The artifact should include conditional decode repack (governor plan reports `decode_repack:false` at about 2998 MiB), runtime CPU fallback on “Governor decode failed,” the watermark trim fix, OOM fixes, and the battery-policy change removing the old 45% floor. At unplugged battery ≥25%, GPU prefill should remain eligible at any battery level; only LOWBAT below 25% should force CPU, while plugged power must not remove GPU eligibility.

## S1 — 20-turn functional run

Run 20 synthetic turns in one chat with governor enabled and the shipping model. Prediction: all 20 turns complete with coherent answers, GPU prefill on every turn, one `KALSA_GOVERNOR_PLAN` reporting `decode_repack:false`, and no governor/runtime fallback markers. KV trim/commit activity, if emitted, should complete without corrupting the following turn or surfacing a route error. No error text is expected in the visible answer or persisted history. Record per-turn wakefulness, resumed activity, battery/temperature/thermal/low-power/power state, `KALSA_GOVERNOR_PLAN`, route, `KALSA_KVTRIM`, commit timing, answer/error and persisted-history evidence, RssAnon, and lmkd events. If charging, correctness remains valid but every printed time or throughput value is labeled “charging — not a measurement.”

## S2 — X3 governor vs CPU-only timing design

Run paired governor-on and CPU-only cells at short, approximately 1.5k-token, and approximately 4k-token prompt lengths. Every prompt/arm uses a fresh chat, so each measured prompt is that chat’s first turn. Use the same prompt within each pair. Keep the screen on with Kalsa foregrounded, idle for 3 minutes before each cell, and record a start temperature at thermal status 0; each timing cell must start within ±2 °C of the first cell’s temperature. Record battery temperature, battery level/power source, thermal status, and `low_power` beside each timing result. S2 requires unplugged battery ≥25%; if S1 ends plugged, do not start S2.

Prediction from `xiaomi-governor-night/PREREG.md` X3: governor/CPU-only decode-speed ratio 0.85–1.15 for each prompt length; CPU/GPU prefill-time ratio 1.2–2.5 for approximately 1.5k and 4k prompts, and 0.8–1.8 for the short prompt. These are cross-device expectations; each ratio outside its band refutes that prompt’s prediction. No energy prediction.

## Stop and validity rules

S1 and S2 stop at thermal status ≥3, battery temperature ≥44.0 °C, battery ≤25%, or `low_power` becoming active. Never measure timing while charging. Keep the display on throughout: wake the S23, save its current `screen_off_timeout`, set it to 2147483647, and keep Kalsa foregrounded. Record `mWakefulness` and resumed activity immediately before and after every turn; any turn without both Awake and `com.kalsa.app` foreground is INVALID and must be redone. Restore the original screen timeout at the end. All device commands use only serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`; never uninstall or clear app data. Clean only this session’s files from `/data/local/tmp`.

## Results

No device measurements exist at preregistration time. Append results without changing the predictions above.
