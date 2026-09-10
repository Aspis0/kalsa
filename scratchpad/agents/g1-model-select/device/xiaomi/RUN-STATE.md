# Xiaomi 14 G1 full-run state — 2026-09-09

## Run header

- Phone: Xiaomi 14 (23127PN0CG), wireless adb `192.168.1.193:35049`; S23/Jelly are out of scope.
- APK: `main@4b29466`, `com.kalsa.app` debuggable.
- Models: `lfm2.5-2.6b` and `dev-minicpm5-2b`; GGUF sha256 prefix `ec2d5801…` verified.
- Charge state at start: unplugged; battery and temperature recorded in the preflight line below.

## Supervisor diffs from `jelly/supervise_g1.sh`

- Substituted Xiaomi output directory and serial; retained LFM first, cool gate, then MiniCPM5, runner commands, timeouts, and row watcher.
- Added a `<30%` battery-level floor checked during arm watches and the cooling gate; it force-stops the app, interrupts the arm, and exits.

## Start preflight

- 2026-09-09 preflight: connected; unplugged, 79%, battery temperature 30.9 °C, Thermal Status 0; app force-stopped; no case smoke test run.

- Supervisor PID 39583; first row at 2026-09-09 21:30:26 EDT: `C01`, `ok`, `duration_s=97`; end battery temperature 32.1 °C, level 78%, Thermal Status 0.

- 2026-09-09 21:58 EDT: LFM rows=15, last_status=ok; MiniCPM5 rows=0; battery=66%, temperature=40.2 °C, Thermal Status 0.

- 2026-09-09 22:28 EDT: LFM rows=22, last_status=ok; MiniCPM5 rows=0; battery=56%, temperature=40.2 °C, Thermal Status 0.

- 2026-09-09 22:34 EDT: cool gate observed Xiaomi's `Thermal Status: 0` spelling, which the Jelly-only matcher treated as unknown while battery cooled from 37.1 °C; patched the Xiaomi copy to accept both spellings. No row failure occurred.

- 2026-09-09 22:36 EDT: killed supervisor PID 94737 before MiniCPM5; no phone app/file action was taken. Added the exact case-tolerant thermal-status matcher with first-integer extraction, a 30-minute cool timeout (`COOL-TIMEOUT`, exit 4), and `START_AT=minicpm` guarded by an in-script check for exactly 24 LFM rows with status `ok`; this avoids rerunning the completed LFM arm and prevents an unbounded gate.

- Relaunched detached with `START_AT=minicpm`: supervisor PID 96687; gate passed at 22:37:45 with battery 35.4 °C, Thermal Status 0, level 54%; MiniCPM5 runner PID 96845 started with one Xiaomi runner process.

- 2026-09-09 22:51 EDT: MiniCPM5 C01 first row was `not_run` after `ready_timeout` (738 s; turn status `not_run`). Stopped the arm/supervisor and force-stopped `com.kalsa.app` per the Jelly rule; no phone fix, file deletion, or C02 run. LFM remains 24/24 `ok`.

## Post-mortem: 2026-09-09 22:36–22:58

- 22:36: killing supervisor PID 94737 ran its EXIT trap, restored/deleted `screen_off_timeout`, and the phone slept and re-locked (`mLastSleepReason=timeout`; lock event 1).
- 22:36–22:58: `START_AT=minicpm` correctly verified 24 LFM `ok` rows, but the preserved C01 `not_run` row remained in `minicpm.out.jsonl`.
- 22:58:18: `watch_arm` read that stale pre-arm C01 row as the MiniCPM5 arm's first row and stopped 40 seconds after launch; this was not a new C01 result.
- The runner EXIT trap then deleted `screen_off_timeout`; the phone slept and re-locked behind the secure keyguard (`mLastSleepReason=timeout`; lock event 2).
- Before tomorrow: (a) capture the arm-start line count/timestamp and inspect only rows written after it; stale rows must never trigger `first_non_ok`.
- (b) Minimal no-runner-edit change: add a supervisor-owned pending-arm marker; device-env cleanup skips timeout restore while it exists, and the supervisor clears it/restores only after the final arm.
- (c) `START_AT=minicpm` must verify the 24 LFM `ok` rows and jump directly to MiniCPM5 without checking stale MiniCPM5 rows.
