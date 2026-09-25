# Xiaomi 14 route-hook correctness run

**Status: NOT RUN — Xiaomi unavailable to adb.** No device commands were issued because the Xiaomi serial could not be identified. `adb devices -l` listed the Jelly Star and Galaxy S23 only; `adb mdns services` listed only the Galaxy S23 service (`adb-R3CW406P8CV-zyLM4b`, `SM_S911U`). No command was sent to the S23.

The APK SHA-256 was verified as `1b914f80dd697b73415013cf680f50aa309e61016ced6a2a5962599ec8707d6e`. Since no Xiaomi session began, package state was not recorded, no install or app interaction occurred, and no safety gates could be checked. Therefore the route checklist, model load, CPU/GPU comparison, idle reload, and final `/bench route auto` were not performed. No speed, heat, or energy values were collected.

There are no Xiaomi logcat lines or turn IDs to report. Discovery output is preserved in `raw/adb-discovery.txt`; it contains no chat content. The required correctness result and quoted governor/window/telemetry log evidence remain unavailable until the Xiaomi is visible through adb mDNS.

## Retry: Xiaomi appeared; stopped before correctness

Polling found the Xiaomi at serial `adb-625689a2-9xEOfw._adb-tls-connect._tcp` (`houji_global`, `23127PN0CG`). The newer APK hash matched: `633887432181f0ae7d0e3a525b346320dd5cdc022282ec28c950ede8b12e1bea`. Preflight showed the phone unplugged (`AC/USB/wireless/dock powered: false`), screen on and Awake, 100% battery, 298 GB available on `/data`, thermal status 0, and battery temperature 34.3 °C from `dumpsys battery` (thermalservice also reported a battery sensor at 38.6 °C). Kalsa was not installed and was not in the foreground; package dumps before and after both said `Unable to find package: com.kalsa.app`.

The only install attempted was `adb -s <Xiaomi> install -r <APK>`. Android rejected it with: `Failure [INSTALL_FAILED_USER_RESTRICTED: Install canceled by user]`. This was not a signature mismatch. I stopped without changing system settings or interacting with another package. The correctness checklist therefore did not pass or run: no model loaded, no route turns, no comparison, no idle-unload resend, and no final `bench:route auto`. The small heat/speed set was not run because it is conditional on a passed correctness checklist. There are no per-arm predictions or metrics; n=2 exploratory arms were not attempted. No speed, heat, or energy results were collected. No command was sent to the Galaxy S23.

`raw/logcat-install-attempt.txt` contains only filtered KALSA/governor matches and is empty (0 lines). `raw/package-before.txt` and `raw/package-after.txt` preserve the requested package snapshots; `raw/adb-discovery.txt` preserves device discovery. No chat content was collected.

## Owner-authorized fresh-install retry

The owner confirmed the prior removal was performed by MIUI Home and authorized one fresh `install -r` retry, with the owner handling the MIUI confirmation. Before the retry the Xiaomi screen was ON and `mWakefulness=Awake`. The single retry again failed with `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user` (recorded in `raw/install-retry.txt`). Per instruction I stopped: no further install, package, or app commands were sent. Kalsa remains unavailable; no model download/import inspection, correctness turns, or heat/speed arms were performed.
