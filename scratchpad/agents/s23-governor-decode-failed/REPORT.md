# S23 “Governor decode failed” read-only diagnosis

## Result: event absent from current logcat; stopped

No device state was changed. All device commands used the pinned S23 serial. Preflight at 2026-09-25 02:26:25 UTC: unplugged (AC/USB/wireless false), battery 100%, 30.8 °C, thermal status 0, `mWakefulness=Awake`, and `com.kalsa.app/.MainActivity` resumed. Installed package reports `versionName=0.1.0`, `versionCode=1`, `lastUpdateTime=2026-09-24 12:24:41` (as printed by Android).

The first `top -b -n 1` at 02:26:24 UTC showed `adsprpcd` 100% and `cdsprpcd` 100%; a second at 02:26:44 UTC showed each at 109%. This establishes a current spin at diagnosis time, not its overlap with an absent failure timestamp.

The readable all-buffer dump was saved from `adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp logcat -b all -d -v threadtime`; it contains 381,221 lines, with its last timestamp at 09-24 22:26:55.791. Searches over the complete dump found **0** literal `Governor decode failed` occurrences, **0** `decode failed` occurrences, **0** `KALSA_GOVERNOR` occurrences, and **0** lines containing `governor`. Therefore there is no native error text after the reported prefix, no governor state/route/temperature for such an event, and no event timestamp to classify as flow-control `-2` versus a real OOM/OpenCL/alloc/abort failure or compare against DSP CPU.

The nearest relevant retained Kalsa marker is not a failure:

> `09-24 22:24:13.153 30370 30795 I ReactNativeJS: 'KALSA_PREWARM', '{"op":"skip","reason":"not_ready"}'`

Because the requested failure event is absent from the current buffer, I stopped here as instructed. CI-run/APK correlation was not attempted; version and install time above are the available package identity evidence. No reproduction, install, data operation, send, or inference was attempted.

## Raw evidence

- `raw/preflight-top.txt`, `raw/top-before-logcat.txt`: daemon CPU snapshots.
- `raw/preflight.txt`: battery, thermal, power, resumed activity, and package version/install time.
- `raw/logcat-all.txt`: complete readable all-buffer dump.
- `raw/logcat-dump-meta.txt`, `raw/logcat-stderr.txt`: host timestamp and command diagnostics.
- `raw/search-summary.txt`: exact search counts and retained Kalsa marker.
- `raw/evidence-inventory.txt`: directory listing and line counts.
