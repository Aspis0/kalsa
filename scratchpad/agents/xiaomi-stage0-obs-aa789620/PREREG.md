# Pre-registration: learning-governor Stage 0 on the Xiaomi 14 (owner's daily driver)

Written before the run, 2026-10-15, coordinator session (Paseo agent `0dc81aaa`).

## Purpose

DESIGN v0.5 section 3.4 asks for the Xiaomi half of the Stage 0 device check. It is the phone
that closes two OPEN items that the S23 cannot:

- **OPEN 1** - the passive trip points of all three legs (`trips` finite for cpu / npu / gpu).
  The engine's TILE32 gate and the speed rule's GPU seed both need them; the design wanted
  GPU >= 56.3 C for a cold fit.
- **OPEN 4** - whether `/sys/class/power_supply/battery/{temp,status}` is readable in-process.
  On the S23 the shell AND the app are denied (`bsys:[0,null,0,null]` on every row), so the
  phone answers OPEN 4 only if the sysfs path is open on this SoC.

Secondary, feeding the Stage 0 replay (DESIGN 3.3): the app-sample age distribution on a second
phone, the per-leg tok/s on SM8650, the zone hot-temperature rise per window, and the leg mix.

## Fixed inputs (verified on disk and on the device before the run)

| item | value | how verified |
|---|---|---|
| Device | Xiaomi 14, `23127PN0CG`, `ro.soc.model=SM8650`, `Xiaomi/houji_global/houji:16/BP2A.250605.031.A3/OS3.0.303.0.WNCMIXM` | `getprop`, 2026-10-15 |
| adb serial | `adb-625689a2-9xEOfw._adb-tls-connect._tcp` (it also appears a second time as transport_id 8; every command uses an explicit `-s`) | `adb devices -l` |
| APK | `~/kalsa-apks/aa789620-debuggable/kalsa-apk-arm64-v8a-debuggable-aa789620ca7f1e8b9a034da5d265c20ce4b75598/app-release.apk` | CI run `38277368560`, app main `aa789620`, binding `861a3cc3`, engine `f1f612388` |
| APK sha256 | `0784913fe473febec96689da816338b79a762f336598dcfbb56b29f69a4b177e` | local file AND the installed `/data/app/.../base.apk` streamed and hashed: byte-identical |
| Debuggable | `flags=[ DEBUGGABLE ...]` on the installed package (needed for `run-as`) | `dumpsys package` |
| Model | `files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf`, sha256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`, 1593894944 B | copied in-device from `/data/local/tmp/govhtp-xiaomi/model/ship.gguf`; hash computed on the phone with `run-as ... sha256sum` |
| Start state | 79 % battery, `status: 3` (not charging), AC/USB/wireless powered all false | `dumpsys battery` |

## Safety envelope (this is the owner's daily driver)

- Unplugged only. No benchmark and no session while charging, at any point.
- Battery floor 30 %: the device-side guard force-stops the app below it, and the Mac watch
  kills the harness below it. The harness preflight floor is overridden to 55 % for this run
  (the default 85 % cannot pass at 79 %).
- Harness thermal pause 43 C (`recovery.thermalMaxC`), hard abort 44 C.
- Device-side guard (`raw/guard.sh`) + Mac watch (`raw/run-arm.sh`): independent of each other.
- `persist.traced.enable` was found at **1** on this phone and is set to **0** for our session
  only (the S23 rule); it is restored to 1 afterwards.
- `screen_off_timeout` was found at **60000**; raised for the session so the screen does not
  lock and doze the app mid-run; restored to 60000 afterwards.
- The app is force-stopped at the end. The phone is left as found.
- One session on this phone. The other live session (kalsa-brain `0ebb6a06`) was told in
  advance that the Xiaomi is taken and that the S23 is not.

## Phases

**Phase A (this run, bounded).** Install verified, model verified, then one arm of
`scripts/campaign/run-t20c.sh` on the campaign config `raw/s0-xiaomi.json` (anchored
compaction, memory off, tools off, governor ON, 20 turns declared, stopped by the runner's own
stop flag after N turns). Phase A answers OPEN 1 and OPEN 4 on a handful of rows: it does NOT
need the full >= 20 completions.

**Phase B (after reading Phase A).** The remaining completions, if they are still wanted, either
in the same sitting (the 2026-10-11 night run cost 62 -> 29 % in 90 min) or from normal daily
use of the installed dev build, pulled the same way. DESIGN 3.4's >= 20 completions and the
DESIGN 3.3 replay statistics need that, and normal use is also what exercises OPEN 6
(background load / cooling collinearity).

## Pass criteria for Phase A (DESIGN 3.4, Xiaomi arm)

1. one row per completion, every tool round included, no `gap:1` on an unstopped turn;
2. every delta >= 0, `tok` sums to `pred_n` within 2 tokens;
3. on an unpaced 100 % NPU row, `tok.npu x 1e6 / us.npu` within 10 % of `pps`;
4. `win` length = ceil(`pred_n` / 32) with no overflow;
5. `trips` finite for cpu, npu AND gpu (this is the one the S23 could only do for cpu/npu/gpu
   without a cross-check - here it is the point of the run);
6. `first[headroom_age]` <= 3000 ms and every window `h_age` <= 3000 ms;
8. `KALSA_GOVERNOR_BATTERY_SYSFS` logged once per load - expected NOT to reach logcat in this
   build (pre-existing: no native binding line reaches logcat, S23 cell finding).

Plus the replay comparison of DESIGN 3.3 for OPEN 4: battery sysfs vs BatteryManager within
0.5 C, and sysfs `status` agreeing with `plugged` on >= 95 % of rows.

Refuted by: a missing row, a negative delta, a ring overflow on a normal completion, or any
`trips` cell non-finite for a leg whose zones the device counted.

## Not claimed by this run

- No speed claim: one arm, no control, natural conversation mix.
- No leg-mix equivalence claim: there is no `df359450` control arm on this phone in this cell
  (DESIGN 3.4 criterion 7 needs one and it was not judgeable on the S23 either).
- No heat or endurance claim: the run stops at the pause/abort thresholds, it is not an
  endurance cell.