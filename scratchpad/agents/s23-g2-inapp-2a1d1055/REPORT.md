# S23 G2 in-app long session, APK 2a1d1055 (native platform thermal + COOLMODE pacing) - 2026-10-10

**Attempt 1: G2 not met. The harness stopped at turn 15. The app and the governor did what they were built to do.**

## Build and setup

| | |
|---|---|
| APK | CI run `38022468371`, app `2a1d1055`, debuggable, arm64 |
| Binding | kalsa.rn `a9bf7a26` |
| Engine | `0012f97f2` |
| Device | S23 (SM-S911U), unplugged; 89 % and skin 30.9 C at start; `persist.traced.enable=0` |
| Harness | `scripts/campaign/run-t20c.sh`, `campaigns/t20c-g2.json` |
| Session settings | anchored context, memory off, `BENCH_TARGET=device` |
| Side sampler | Every 5 s, in `raw/g2-side-attempt1.csv`: MemAvailable, the app's RssAnon, HAL SKIN, battery temperature and Android status |

## Versus 2026-10-09 (APK `1f0e967b`, cell `s23-g2-inapp-1f0e967b`)

| | 1f0e967b | 2a1d1055 |
|---|---|---|
| Turns before the stop | 3 (aborted in turn 4) | 15 completed in-app |
| Max Android status | 3 (SEVERE) | 2 (MODERATE) |
| Governor state | FAST throughout | COOLMODE from the end of turn 1 |
| Why it stopped | Harness thermal hard abort at SEVERE | Harness: one unreadable pulled DB copy, fatal by design (fixed below) |

## What the side sampler and logcat show

- **Native platform feed** (`raw/attempt1-native-governor.grep`): `KALSA_GOVERNOR_PLATFORM {status:1, prev:0, source:"native", sent:1}` at 09:49:01. Status 2 was pending at 09:50:20 and sent at 09:50:25, exactly the 5 s escalation debounce.
- **Pacing in-app** (`raw/attempt1-telemetry-speed.csv`, `predictedPerSecond` per completion): 15.2 and 13.3 tok/s before COOLMODE, then 5.6-7.6 tok/s for the rest of the session. The governor line reports `thermal_state COOLMODE`, `state_source battery`, `platform_thermal_status 2`.
- **Thermal, over 76 min:**
  - status 2 from minute 8.5 to the end (780 of 878 samples);
  - never 3;
  - skin 40-41.4 C; battery peak 42.3 C.
  - One harness thermal pause at turn 11 (battery 42.2 C, above the harness's 42 C bar). The app was not stopped. The session resumed after 180 s with no duplicate send (`already-landed-skip-send`).
- **Memory:** MemAvailable never below 1.24 GB; the app's RssAnon peaked at 494 MB. No hard reset.
- **Crashes:** none. One app PID (2367) from 09:45:57, before turn 1, to the harness stop. The earlier PIDs (31167, 31933) are the harness's own setup launches, and the later ones (25251, 25446) are its teardown relaunch.
- **Battery:** 89 % -> 61 % over 15 turns.

## Why it stopped, and the fix

- **The failure:** at turn 15 the harness pulled RKStorage while the app was rewriting it, and the count read returned `err`. Commit `bae85098` (2026-10-09 audit F4) had made a single unreadable count fatal (`FATAL: assistant count unreadable turn 15; aborting without force-stop`). The turn itself completed in-app at 10:55.
- **The fix:** app `0c8a711d` (pushed) retries an unreadable count for 5 consecutive rounds, which on the device is about 50-100 s, before `db-read-error`.
  - Selftest: `passed=111 failed=0`.
  - Hostile audit (deepseek): no P0/P1. P2: during the retry rounds, up to 4 rounds skip the turn-timeout and thermal checks, so they are delayed but stay bounded.
- **Teardown force-stops the app:** the harness's EXIT trap force-stopped the app at teardown (backlog H4), and the screen finalizer relaunched it.

## Gaps

- **The app's `KALSA_GOVERNOR` line does not carry `decode_paced_*`.** The binding exposes the fields to JS (`a9bf7a26`), but the app's emit does not print them. In-app pacing is shown here by tok/s only.
- **The harness logcat filter drops the binding's `RNLlama` lines.** `KALSA_GOVERNOR_PLATFORM` was read from `adb logcat -d`, not from `results/.../logcat.txt`.
- **Duty 0.5 holds the skin at about 40-41 C under continuous load, not below.** Battery 42 C is still reachable in a long unbroken session, so the harness pause fired once.

## Next

Repeat on a charged (about 90 %), cold phone with `0c8a711d`. Then run the shorter tools-ON session as shipped.
