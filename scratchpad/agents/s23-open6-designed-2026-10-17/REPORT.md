# S23 designed cell for OPEN 6 (cooling collinearity) — run of 2026-10-17

Status: **RUN LIVE AND FINISHED.** 20/20 turns completed, no stops, no holds, no pauses.

Device SM-S911U, serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`, app com.kalsa.app 0.1.0 (debuggable),
binding pin `df912b0e20275636817e1f4c66bb4bb9edc5a0ce`. Unplugged at 10:31:56, run started 10:48:56, finished
13:07:45 (8329 s = 2 h 19 min). Seed 20261017, schedule sha256 `3d617d298e2edf917e8cc8c226f2d3cda2c2a7d75beedeb7684d7ab7f851b24f`.

## 1. Rows collected

20 rows, all of this cell's, all entering the fit (20/20, 0 excluded), 613 windows over them.

| length | gap 0 | gap 2 | gap 5 | gap 10 | total |
|---|---|---|---|---|---|
| short | 3 | 3 | 2 | 3 | 11 |
| long | 3 | 2 | 2 | 2 | 9 |
| total | 6 | 5 | 4 | 5 | 20 |

This is exactly the designed grid: 2 replicates of each of the 8 cells plus the 4 seeded third replicates
(short/0, short/2, short/10, long/0).

Realised idle gaps (prev completion to send tap, includes the new-chat step): 81–106 s for target 0,
158–161 s for target 2, 338–341 s for target 5, 638–642 s for target 10. Every turn produced exactly one new
observation row; `new_rows` was 1 for all 20 turns.

### The filter used for the replay

Verbatim, from `replay.sh`:

```
filter: fp.pin == df912b0e AND line_index in the run's turn ranges (>= N0 86) AND row wall stamp within 120s of its own turn's completion epoch under one fitted constant offset (spread 9.579 s) AND plugged == 0 AND gap == 0
{"pre_run_lines": 86, "new_lines": 0, "other_pin": 0, "outside_index_window": 0, "outside_window": 0, "plugged": 0, "gap": 0, "clock_offset_s": -1791758366.784, "offset_spread_s": 9.579, "time_gate": true, "window_s": [1792248617, 1792256802]}
kept 20 rows
```

N0 = 86 is the line count of `files/governor/observations.jsonl` at run start, so rows from other days and other
pins are below the index window; the fitted-offset time gate then confirms each kept row's own completion stamp
lands within 120 s of its turn's completion epoch under one shared offset (spread 9.579 s over the 20 rows). The
pulled file has 106 lines in total; 86 of them are pre-run lines from other cells and all 86 were excluded. No
row from another pin entered the fit (`other_pin` 0 among rows at or after N0).

## 2. Stops, holds, pauses

**None.** Across 251 samples (`raw/samples.tsv`):

- battery level 100 % at start, minimum **66 %** — the < 30 % stop was never reached.
- battery temperature maximum **38.3 °C** — the 42 °C gate was never reached, so no hot hold and no stop.
- thermal status reached **1** and returned to 0; never 3.
- `plug=none` in every one of the 251 samples — no replug pause, no exit 12.
- `in_turn_flags` empty on all 20 turns in `raw/turns.jsonl`.

Screen-off timeout was read as **1800000** at start and restored to **1800000** by the EXIT trap; read back after
the run: `1800000`.

## 3. The fit, with and without the cooling term

From `OUTPUT-s23-open6-designed-2026-10-17.md`, section 7 (target `y = 30 x (h_last - h_wake)` in C):

| column | unit | coefficient | same fit without `cool` |
|---|---|---|---|
| npu_k | C per 1k NPU tokens | 9.720 | 12.262 |
| prompt_k | C per 1k prompt tokens | 0.005 | -0.079 |
| wall_min | C per completion minute | -1.520 | -5.150 |
| cool | C per (-h_wake x wall_min) | 3.190 | - |
| gpu_k / cpu_k / prefill_gpu_k | - | not identifiable | not identifiable |

- rank **5 of 5** columns over 20 rows, residual df **15**; dropped as identically zero: gpu_k, cpu_k, prefill_gpu_k.
- **condition number 460.5 with the cooling column, 388.1 without it** (2-norm condition number of the scaled
  design matrix, predictors scaled to unit L2 norm, intercept left at 1). Gram ratio, its square: 212055.1 and
  150610.1.
- residual sigma **0.2295 C**, max |residual| **0.4637 C**.

For reference, the numbers this cell was built to beat (README): the 26 Xiaomi normal-use rows give 154.8 with
cooling and 48.8 without.

## 4. Did the design separate the cooling term?

**Within-design correlations** (ANALYSIS.md, 20 fit rows):

```
corr(gap_actual, h_wake)    = -0.545
corr(wall_min, cool)        = -0.997
corr(gap_actual, wall_min)  =  0.100
corr(gap_actual, cool)      = -0.051
```

## 5. Verdict

**No. The designed data still does not separate the cooling term (OPEN 6).**

The design did what it was designed to do on the gap axis, and that part is new: randomising the idle gap against
turn length worked — `corr(gap_actual, wall_min)` is **0.100**, and the gap demonstrably moves the cooling input,
with `corr(gap_actual, h_wake)` = **-0.545** (t(18) = -2.76, p ~ 0.013). A longer idle really does wake the
completion with less headroom.

But that is not enough, and the reason is structural. `cool = -h_wake * wall_min` (perRow.mjs:126) is a PRODUCT
with `wall_min`, so it can only be separated from `wall_min` by varying `h_wake` widely at fixed `wall_min`. Over
this cell `h_wake` spans 0.697 to 0.797 (13.6 % spread) while `wall_min` spans 0.71 to 3.42 min (4.8x). Multiplying
a near-constant by the long column leaves the long column long: `corr(wall_min, cool)` is still **-0.997**, and
`corr(gap_actual, cool)` is -0.051.

The fit numbers agree. Adding the cooling column now costs only 460.5 / 388.1 = **1.19x** (against 154.8 / 48.8 =
3.17x on the normal-use Xiaomi rows), so the design did succeed at removing most of the *extra* penalty the
cooling term used to add — but it did not get the absolute condition number anywhere near the normal-use level.
Dropping `cool` still moves `wall_min` from -1.520 to -5.150 C/min (3.4x) and `npu_k` from 9.720 to 12.262
(+26 %): the cooling term and the token/time columns are still fighting over the same variance, so no individual
coefficient here should be read as a heat number.

The binding constraint is now visible and named: **within a narrow `h_wake` band, `cool` cannot be separated from
`wall_min` by any schedule of gaps.** Separating it needs the wake headroom itself to move by a large factor at a
fixed completion length — either a much wider thermal spread before the turn (a hotter starting state, or a much
longer/shorter cooldown), or `h_wake` entering the fit as its own regressor so the product is not fighting
`wall_min` for the same variance. This cell measured the first effect honestly (r = -0.545) and showed it is about
an order of magnitude too small to do the job.

## 6. Files

| file | what |
|---|---|
| `OUTPUT-s23-open6-designed-2026-10-17.md` | replay report: fit, condition numbers, per-row table |
| `ANALYSIS.md` | design table + within-design correlations |
| `raw/pulled-post-run.jsonl` | the pulled observations file (106 lines, all pins and days) |
| `raw/observations.jsonl` | this cell's 20 rows, the replay input |
| `raw/labels.tsv` | row -> turn design (length, gap target, gap actual) |
| `raw/turns.jsonl` | one line per completed turn |
| `raw/samples.tsv` | 251 sensor samples (battery, thermal, focus, keyguard, screen) |
| `raw/run-manifest.json`, `raw/run-status.txt`, `raw/device-before.txt` | run start N0=86, finish time, timeout before/after |
| `raw/aborted-attempt-1/`, `raw/aborted-attempt-2/` | the two aborted attempts, kept as evidence |

## 7. Fixes made before the run (each verified)

1. **`extract.py` filtered by pin only.** Rewritten to require pin AND the run's own window (line index in the
   run's recorded turn ranges, plus the fitted-offset time check), and to print the filter line used. Verified by
   planting a foreign row: it was rejected by the index window and blew the offset spread to 63267 s.
2. **No script was executable** (`-rw-r--r--`), so `cycle.sh` would have died on `Permission denied`.
   `chmod +x` on all `.sh`.
3. **`snapshot` read a key that does not exist on this Samsung.** `dumpsys window policy` has no `mIsScreenOn`
   here, so `scr` was always 0 and `turn.sh`'s `guard_screen` would have aborted every turn with "screen off".
   Now reads `dumpsys display | grep mScreenState=ON`; wake path verified (Dozing/kg=1 -> Awake/kg=0/scr=1).
4. **Wedged Hexagon session.** The first live turn failed with `Exception in HostFunction: Context is busy`;
   logcat showed `fastrpc_mmap failed ... Connection reset by peer` on domain 3, first appearing at 10:31:56 —
   the moment the phone was unplugged. Unplugging can leave the DSP session dead, and every generation then fails.
   Reproduced on a deliberate probe, then fixed by a cold start (`am force-stop` + relaunch) before turn 1;
   the turn right after it wrote a normal row.
5. **The schedule loop ate its own input.** `while read` reads the schedule on stdin and `cycle.sh`'s `adb`
   children inherited that fd, so the run consumed the remaining turns and reported `run finished` after turn 1
   while claiming success. Fixed with `< /dev/null` on the `cycle.sh` call; verified by watching the run pass
   turn 1 into turn 2.

Schedule, seed and prompts were not changed: 20 turns, seed 20261017, the same two fixed prompts, sha256 unchanged.