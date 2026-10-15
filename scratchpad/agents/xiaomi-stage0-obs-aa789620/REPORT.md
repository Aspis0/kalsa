# Xiaomi 14 learning-governor Stage 0, APK aa789620 (2026-10-15)

**RESULT: PASS on DESIGN 3.4 criteria 1, 2, 4, 5, 6 (8 observation rows, 6 turns). Criterion 3 not
testable (the phone paced from the first completion); criterion 8 not observable (pre-existing).
OPEN 1 CLOSED (Xiaomi passive trips finite for all three legs). OPEN 4 CLOSED, negatively (the
battery sysfs is not readable by the app on this phone, exactly as on the S23).**

Setup, provenance and preflight record below are final and verified on disk / on the device.
The device criteria (DESIGN 3.4) are written after the pull.

## Why this run exists

DESIGN v0.5 section 3.4 wants the Xiaomi half of the Stage 0 device check. Two OPEN items cannot
be closed on the S23 and only this phone can close them:

- **OPEN 1** - passive trip points of all three legs. The S23 produced finite `trips` but the
  cross-check against the native zone count was impossible (criterion 8, no native line reaches
  logcat), and the engine's TILE32 gate plus the speed rule's GPU seed both need the Xiaomi's GPU
  trip (the design wanted GPU >= 56.3 C for a cold fit).
- **OPEN 4** - whether `/sys/class/power_supply/battery/{temp,status}` is readable in-process.
  On the S23 both the shell and the app are denied (`bsys:[0,null,0,null]` on every row), so the
  question is genuinely open and phone-specific.

## Setup (all verified before the run)

| item | value | verification |
|---|---|---|
| Device | Xiaomi 14 `23127PN0CG`, `ro.soc.model=SM8650`, HyperOS `Xiaomi/houji_global/houji:16/BP2A.250605.031.A3/OS3.0.303.0.WNCMIXM` | `getprop` |
| adb | wireless TLS, `adb-625689a2-9xEOfw._adb-tls-connect._tcp`; it also appears a second time as transport_id 8, so every command uses an explicit `-s` | `adb devices -l` |
| APK | `aa789620` (binding `861a3cc3`, engine `f1f612388`), CI run `38277368560`, debuggable | installed by the owner before this session |
| APK sha256 | `0784913fe473febec96689da816338b79a762f336598dcfbb56b29f69a4b177e` - **local file and the installed `/data/app/.../base.apk` streamed and hashed: byte-identical** | this session |
| Model | `files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf`, 1593894944 B, sha256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` (= the PLAN's ship model) | copied in-device from `/data/local/tmp/govhtp-xiaomi/model/ship.gguf`, hash computed on the phone with `run-as ... sha256sum` |
| Campaign | `campaigns/t20c-xiaomi-s0.json`: copy of `t20c-g2.json` (anchored compaction, memory off, tools off, governor ON, 20 turns declared, `thermalMaxC` 43), `deviceModel` = `23127PN0CG` | `raw/s0-xiaomi.json` is the archived copy |
| Start state | 79 % battery, `status: 3`, AC/USB/wireless powered all false, skin 33.5 C, Android status 0 | `dumpsys battery`, side sampler |

Safety envelope: unplugged only; harness pause 43 C; hard abort 44 C; battery floor 30 % (the
harness preflight floor overridden to 55 %, the default 85 % cannot pass at 79 %); device-side
guard + two Mac watchers; `persist.traced.enable` 1 -> 0 for the session only; `screen_off_timeout`
60000 -> 12 h (owner request; the runner then pins it to `2147483647` and states **no restore at
exit**, so the coordinator restores it by hand); app force-stopped at the end.

## Preflight record: three runner refusals before any device work (kept, they are evidence)

**Provenance of these quotes, stated plainly:** `run-arm.sh` truncates `raw/harness.log` at every
launch, so the two refusal lines below come from the console of those launches and are **not**
archived on disk - they are transcript quotes, not artefacts. What survived on disk is
`raw/preflight-final-launch.txt` (the final, successful launch's preflight lines). The three
refused launches died at preflight, before any app launch, so they left no device state. The
lesson for the next cell: give each launch its own log file.

1. `refuse: conversation script not found: .../raw/t20c/script.json` - the runner resolves the
   conversation script relative to the CONFIG's directory, so the config must live in the
   worktree's `campaigns/` dir (where `t20c/script.json` sits), not in the cell folder.
2. `FATAL: device identity mismatch: campaigns/t20c-xiaomi-s0.json declares deviceModel 'Xiaomi
   14', got '23127PN0CG'` - `deviceModel` must be the model code the device reports.
3. (passes, archived) `[ci] JavaScript provenance gate passed`, `[ci] battery preflight
   floor=enforced level=78 temp=31.2C charging=false`, `[ci] screen: timeout pinned to
   2147483647 (saved: 86400000), keyguard dismissed - no restore at exit`. Note the runner
   reports having saved `86400000`, not the `43200000` I had set: whatever it read, the restore
   target is the value observed at session start (`60000`), which is what the coordinator put back.

**Evidence hygiene note.** The results dir was not cleaned between the three launches, so it also
contains `fatal_*.txt` written at 11:11 by the refused attempt. Those are NOT a crash of this run:
`fatal_logcat_crash.txt` holds a crashpad minidump dated `10-11 12:16` (the phone's own logcat
ring buffer from the 2026-10-11 session), and the app of this run never restarted (PID 14662 for
the whole arm). Anyone reading this cell must not cite those files as this run's crash evidence.

## Watchdog stack (all three proven alive, not assumed)

| id | where | period | action |
|---|---|---|---|
| W1 | on the phone, PID 15110 `sh /data/local/tmp/kalsa-g2-guard.sh` | 10 s | HAL skin >= 44 C or level < 30 % -> `am force-stop com.kalsa.app`, logged to `/data/local/tmp/kalsa-g2/guard.log` |
| W1b | on the phone, PID 15128 `sh /data/local/tmp/kalsa-g2-sampler-xiaomi.sh` | 5 s | MemAvailable, app RssAnon, hottest skin, battery temp/level, thermal status -> `g2-side.csv` |
| W2 | Mac, `run-arm.sh` watch loop (PID 70347) | 20 s | skin >= 44 C or level < 30 % -> kill the harness; **also the primary stop path**: the harness's own stop flag after 6 turns |
| W3 | Mac, stop-decider (`raw/arm.stop.log`) | 30 s | stop flag when a 7th turn starts or at 14 rows (backstop); skin >= 44 C or level < 30 % -> kill the harness |

Two counter bugs found and fixed while the run was live, both mine, recorded because the lesson
generalises: the first stop-decider counted distinct `turnId`, but the real row key is **`t`** (a
string), so it read 0 turns forever; the original `run-arm.sh` counter uses
`acceptanceStats.py` and was fine, it had simply reported 0 while turn 1 was still in progress -
I diagnosed that as a bug before checking the real field names.

## Live state at the time of writing

Turn 2 of 6 in flight; 4 observation rows written; app PID 14662 since the launch (no restart);
skin 40.5 C (plateau), battery 72 %, Android status 0, MemAvailable ~2.7 GB.

## Results (run closed 11:57:46 by the harness's own stop flag, 6 turns)

Pulled: `raw/observations.jsonl` (8 rows, 50953 B), `raw/g2-side.csv` (519 samples, 5 s period),
`raw/guard.log`. Checker: `raw/check.py`, verdict output reproduced with the numbers below.

| criterion | verdict | evidence |
|---|---|---|
| 1 one row per completion, no `gap:1` on an unstopped turn | **PASS** | 8 rows, 0 gaps (turn 1 had three completions, turns 2-6 one each) |
| 2 every delta >= 0, `tok` sums to `pred_n` within 2 | **PASS** | no negative delta; `sum - pred_n = +1` on every row |
| 3 unpaced 100 % NPU row within 10 % of `pps` | **NOT TESTABLE** | the phone was already paced on the first completion (pps 17.86 vs NPU 19.35 tok/s), so no row satisfies `paced.delta = 0` |
| 4 `win` length = ceil(`pred_n`/32), no overflow | **PASS** | 0 wrong lengths, `win_ovf` 0 on all 8 rows |
| 5 `trips` finite for cpu, npu, gpu | **PASS** | `[60.0, 115.0, 100.0, 100.0, 95.0, 95.0]` C on 8/8 rows |
| 6 `first[headroom_age]` and every window `h_age` <= 3000 ms | **PASS** | max 2654 ms over 324 windows |
| 8 `KALSA_GOVERNOR_BATTERY_SYSFS` in logcat | **NOT OBSERVABLE** | as pre-declared: no native binding line reaches logcat in this build |

### OPEN 1 - CLOSED

The Xiaomi's passive trips are finite for all three legs: **cpu 60-115 C, npu 100 C, gpu 95 C**
(field order `[cpu_min, cpu_max, npu_min, npu_max, gpu_min, gpu_max]`, read from
`RNLlamaJSI.cpp:1039-1043`). Two consequences, both for the Stage 2 speed rule:

- The design asked for GPU >= 56.3 C to allow a cold fit. At 95 C the GPU block ceiling becomes
  `trip - guard(5 C) = 90 C`, so **the zone guard will not bind** while the blind path runs and
  the expected gain is not clipped. The observed GPU zone temps (46.9-58.0 C over the arm) agree
  from the other side.
- The zone temperatures observed per window: cpu 47.1-65.2 C, npu 46.7-71.1 C, gpu 46.9-58.0 C.

### OPEN 4 - CLOSED, negatively

`bsys:[0,null,0,null]` on every row: `/sys/class/power_supply/battery/{temp,status}` is not
readable by the app on this phone either, exactly as on the S23. The probe fails cleanly. The
app-side push stays the battery source, and DESIGN 5.1's native 5 s refresh branch is dead - it
would need a HAL/binder call, not that file.

### The Stage 2 freshness gate, now measured on both phones

The app thermo sample age inside a completion (window cell 6, 324 windows): min 0.58 s, median
108.8 s, **max 503 s** (Xiaomi); **max 350 s** on the S23. A 120 s wall-clock gate therefore
disarms the speed pass for most of every long paced completion, on a healthy phone, with fresh
data - a false disarm. The age grows with the completion's own duration (the last row: 1588
predicted tokens at 3.17 tok/s is a ~500 s completion and its last window carries age 503 s), so
no fixed small number can be right in general. Decision and the corrected backstop value:
`DESIGN-ADDENDUM-2026-10-15.md`, Item B (ownership first, backstop 1200 s).

### Thermal and speed (single arm, no control: no claim)

| | |
|---|---|
| Turns / rows | 6 turns, 8 completion rows, all `gap:0` |
| Route | 100 % NPU decode: 10229 NPU tokens, 0 GPU, 0 CPU (HEAT_RANK on SM8650, as measured before) |
| Speed per completion | 17.86, 11.53, 7.27, 6.05, 4.68, 3.86, 3.66, 3.17 tok/s (pacing from the first completion) |
| Forecast `h` | 324 windows, 11 blind (exactly 0), min 0, max 0.196 |
| Skin (hottest HAL sensor) | 33.5 C at start, peak 42.2 C, plateau ~41.4 C |
| Battery | 79 -> 63 %, battery temp max 39.3 C, unplugged throughout |
| Android status | 0 for the whole arm (1027+ samples): this SoC's headroom scale never asks for COOLMODE, the battery ramp did the pacing - same as the 2026-10-11 night run |
| App PID | 14662 for the whole arm, no restart, no crash |
| Watchdogs | none fired: the device guard log holds only start/stop lines, the harness pause at battery 43 C never triggered, no kill |

### Restored (verified by read-back)

`persist.traced.enable` 0 -> **1** (as found); `screen_off_timeout` 2147483647 (left by the
harness, which states it does not restore it) -> **60000** (as found); Kalsa force-stopped; the
device-side guard/sampler scripts removed and no helper process left running. The Stage 0 rows
remain in the app's private dir (`files/governor/observations.jsonl`) for a later >= 20 completion
batch from normal use; a copy is in `raw/`. The kalsa-brain session was told the phone is free.

### Not done / not claimed

- The >= 20 completions of DESIGN 3.3 (replay statistics, OPEN 6 background/cooling collinearity):
  this arm was deliberately a bounded 6-turn smoke on the owner's daily driver. The app stays
  installed, so the batch can be collected from normal use instead of another heated session.
- No control arm on this phone (APK `df359450`), so DESIGN 3.4 criterion 7 is not judgeable here
  either - as on the S23.
- No speed, heat or endurance claim: one arm, no control, stopped well before the limits.
- Stage 0b's own device check (DESIGN 4) still needs an APK built from `54c36105`.