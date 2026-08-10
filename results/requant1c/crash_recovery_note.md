# Crash recovery note (2026-08-10) — CAUSA CHIUSA

## Root cause (event log, coordinator)
Bugcheck `0x19C` = WIN32K_POWER_WATCHDOG_TIMEOUT (win32k failed to re-light display
in time): power-management / display driver, NOT load.

Quantize ASSOLTA by timeline:
- clean EXIT logged 11:23:11
- files written until 11:32:46 (machine alive 9+ min after quantize)
- last event = enter Modern Standby 11:33:11
- crash inside standby window
- "11:23:15" 6008 = stale dirty-shutdown checkpoint (known red herring)
- zero WHEA (no hardware)
- event log: repeated Modern Standby churn (ScreenOffTimeout → wake) before crash

## Mitigation (mandatory for unattended long jobs)
- Record originals then: `powercfg /change standby-timeout-ac 0` and
  `powercfg /change monitor-timeout-ac 0` (this PC already had standby-ac=0;
  monitor-ac was 30 min — that was the thrash vector).
- See `results/requant1c/powercfg_mitigation.txt` for ORIGINAL values and RESTORE.
- Restore at end of campaign (same lesson as phone screen_off_timeout).

## Resume protocol (unchanged)
- Single curl -C - for Q8; hard size+sha gate; quantize alone; then N2.
- Lost in crash: nothing measured — only partial download time + premature quantize
  attempt on incomplete file (no KEXP left).
