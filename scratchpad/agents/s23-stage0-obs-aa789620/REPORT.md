# S23 learning-governor Stage 0 device check, APK aa789620 vs control df359450 (2026-10-12)

**Stage 0 observation works on the S23: one row per completion, no gap, counters consistent, windows complete, forecast
age under 3 s. Criterion (7) "identical leg mix" could not be judged as specified (the two conversations differ);
criterion (8) is not observable in this build. The battery sysfs probe is denied on the S23 (OPEN 4 answered for this
phone).**

## Setup

| | |
|---|---|
| Control APK | CI run `38172857932`, app `df359450` (binding `2581a9aa`), debuggable |
| Stage 0 APK | CI run `38277368560`, app `aa789620` (binding `861a3cc3`, engine `f1f612388`), debuggable |
| Device | S23 (SM-S911U), unplugged, screen on, `persist.traced.enable=0` |
| Start | control 12:28, skin 28.7 C, battery 28.1 C, 85 %; Stage 0 13:49, skin 29.9 C, battery 29.4 C, 68 % |
| Harness | app `aa789620` worktree `scripts/campaign/run-t20c.sh`, `raw/s0-*.json` (t20c script, anchored, memory off), stopped by its stop flag after 5 turns (both ran 6) via `raw/run-arm.sh`; Stage 0 arm with `CAMPAIGN_MIN_BATTERY_LEVEL=40` |
| Safety | Mac watch and device-side guard: skin >= 44 C or battery < 30 % -> stop; harness pause at 43 C. Never triggered |

Two earlier attempts per arm stopped before any device work: the conversation script path, the JS provenance gate (the
APK must be installed first: the runner installs nothing), and the harness's default 85 % battery floor.

## Thermal and speed (both arms, 6 turns)

- Control: status 1 from turn 1, 2 from turn 3; skin peak 40.6 C; 85 -> 71 %. Stage 0: status 2 from turn 2; skin
  peak ~40.7 C; 68 -> 56 %. Both COOLMODE-paced to ~6 tok/s from turn 3 on. No pause, no crash, no kill.
- Per-completion decode speed follows the same trajectory (`raw/*-turn-telemetry.jsonl`): 15.8 / 14.8 tok/s on the
  first completion, ~6 tok/s once paced. One run per arm; no speed claim.

## DESIGN 3.4 criteria (Stage 0 arm, `raw/stage0-observations.jsonl`, 7 rows)

1. One row per completion, tool rounds included, no `gap:1`: **pass** (6 turns, turn 1 had two rounds; 7 rows, all
   `gap:0`, one `KALSA_GOVERNOR_COMPLETION` line each).
2. Every delta >= 0 and `tok` sums to `pred_n` within 2: **pass** (sum - pred_n = 0 or +1 on every row).
3. Unpaced 100 % NPU row, `tok.npu x 1e6 / us.npu` within 10 % of `pps`: **pass** on the only such row (turn 1
   round 0: 15.80 vs 14.81 tok/s, +6.7 %).
4. `win` length = ceil(`pred_n` / 32), no overflow: **pass** on all 7 rows (56, 38, 59, 64, 34, 64, 64).
5. `trips` finite: **pass** (cpu 108-115 C, npu 95 C, gpu 95 C). The cross-check against the native "decode hop thermal
   legs" line is not possible: see 8.
6. `first[headroom_age]` and every window `h_age` <= 3000 ms: **pass** (max 2318 ms).
7. Identical leg mix vs control within 32 tokens per turn: **not judgeable as specified.** The two conversations
   differ (control turn 1 took 4 completions, Stage 0 2; output lengths differ), so per-turn counters are not
   comparable. What does match: from turn 2 on, every completion in both arms has exactly one 32-token GPU window and
   the rest on the NPU, CPU 0 (`raw/*-governor.grep`); turn 1: control 192 GPU tokens over 4 completions, Stage 0 64
   over 2. Stage 0 code is observation-only by audit; this run neither confirms nor refutes the leg mix beyond that.
8. `KALSA_GOVERNOR_BATTERY_SYSFS` logged once per load: **not observable**. No native binding log line reaches logcat
   in either APK (no `KALSA_GOVERNOR_PLATFORM` or "decode hop thermal legs" either).

## Findings

- **Battery sysfs on the S23 is denied** to the shell and to the app (`cat /sys/class/power_supply/battery/temp`:
  Permission denied). The probe fails cleanly: every row has `bsys:[0,null,0,null]`. OPEN 4 on the S23: unusable;
  BatteryManager stays the battery source. Xiaomi still to check.
- **App sample age inside a completion reaches 350 s** (window cell 6 at the last window of a paced 2048-token
  completion): the app pushes thermo once per completion. A Stage 2 120 s freshness gate on it would disarm the speed
  pass for most of every long paced completion. Input to DESIGN 5.1.
- **Headroom forecast**: 0.65 at the first window (skin 28-30 C), 0.86-0.97 later; every window age <= 2.3 s.
- **Pre-existing, not Stage 0**: the `KALSA_GOVERNOR` logcat line is truncated at 4101 characters from turn 4 on in
  BOTH arms, so fields after the cut (e.g. `platform_thermal_status`) are missing in those lines.
- `first_row:1` recurs at turns 3-6: the baseline resets on the per-turn KV clear; the cumulative counters then equal
  that completion's own counts, so the rows stay correct.

## Not done

- No stop-latency measurement (DESIGN 3.4 refutation clause "a stop that took longer by more than 2 s").
- Xiaomi: >= 20 completions of normal use with the dev APK (owner's phone), to close OPEN 1 (all three trips) and OPEN 4.
