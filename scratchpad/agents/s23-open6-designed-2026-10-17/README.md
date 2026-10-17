# S23 designed cell for OPEN 6 (cooling collinearity) — 2026-10-17

Status: **READY, NOT RUN.** Waiting for the owner's "go" after the phone is unplugged.

## Question

The heat fit regresses temperature rise on NPU tokens, wall minutes and the cooling term
`cool = -h_wake * wall_min` (perRow.mjs:126). On the 26 Xiaomi normal-use rows, `cool` is collinear with the other
columns (cond 154.8 with it, 48.8 without). Normal use cannot separate them, because long turns also start hot.
This cell designs the separation: the idle gap before each turn is randomised against turn length.

## Design

- Length: SHORT (~200 words, Italian) and LONG (~900 words, Italian). Two fixed prompts, ASCII only (`prompts.sh`).
- Gap before each turn: 0, 2, 5, 10 min, measured from the previous completion to the send tap (includes the new-chat step).
- Every turn is a NEW chat. Normal app turns: governor on, default routing, normal sampling. No `kalsa.bench.*` keys.
- Grid 2 x 4 = 8 cells, 2 replicates = 16 turns, plus 4 extra third replicates drawn by the seed = **20 turns**.
- Order: seeded shuffle, seed **20261017** (`schedule.py`). `raw/schedule.tsv`, `raw/schedule.json`, sha256 `3d617d298e2edf91…`.
  The seed drew the extras as SHORT 0, SHORT 2, SHORT 10 and LONG 0. That is what the seed gave; I did not hand-pick them.
  Result: LONG has 9 turns (gap 0 x3, 2 x2, 5 x2, 10 x2), SHORT has 11.
- Planned duration: **121 min** (schedule.py estimate: 25 s / 110 s generation, 60 s overhead per turn). Plus any hot holds.

## Safety envelope (device rules)

- Serial pinned to `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`; model SM-S911U checked on every script.
- Wake with `input keyevent 224; wm dismiss-keyguard` (no PIN). The guard runs AFTER a wake, never on a dozing screen.
  Keyguard still up after the wake = stop. Nothing is unlocked by any other means.
- `mCurrentFocus` must be com.kalsa.app before every tap; Kalsa is relaunched at most once per gap, twice = stop.
- Typed text is read back from the field; mismatch retried once, then cleared and aborted. Nothing half-typed is sent.
- Stops: battery level < 30 (stop). Battery temp >= 42 C or thermal status >= 3 holds up to 20 min, then stop.
  Battery temperature takes the hotter of `dumpsys battery` and the battery thermal zone.
- Plugged in during the run = pause (exit 12). A hot or low reading DURING a turn does not kill it; the run stops before the next.
- Nothing is written into app data. The app's observations file is only read (`exec-out run-as ... cat`).
- Screen-off timeout is raised to 30 min for the run and restored by an EXIT trap.
- No conversation is deleted. The run ends on an empty new chat.

## Files

| file | role |
|---|---|
| `env.sh` | serial guard, `snapshot` sensor line, `guard_code`, `keep_awake`, `rows_now` |
| `prompts.sh` | the two fixed prompts and the ASCII check |
| `schedule.py` | seeded randomised order; writes `raw/schedule.tsv` and `raw/schedule.json` |
| `newchat.sh`, `uidump.sh`, `turn.sh` | UI steps, copied from the Xiaomi cell's envelope, serial pinned |
| `gap.sh` | idle gap to a target epoch, 30 s samples, guards, hot hold |
| `cycle.sh` | one turn: new chat, gap, type, send, wait for the row, post-sample, JSON line in `raw/turns.jsonl` |
| `run_schedule.sh` | the whole run. Refuses to start without `RUN_GO=1` |
| `extract.py` | this cell's rows (lines >= N0, this pin, unplugged, not gap), labelled by turn |
| `replay.sh` | extract + learning-governor replay + `analyze.mjs` |
| `analyze.mjs` | per-row design table; corr(gap, h_wake), corr(wall_min, cool), corr(gap, wall_min) |

## Pre-run facts (2026-10-17, read-only checks)

- App: `com.kalsa.app` 0.1.0, **DEBUGGABLE**, last updated 2026-10-17 06:54:23.
- Binding pin on the phone's rows: `df912b0e20275636817e1f4c66bb4bb9edc5a0ce` is the new pin.
  **4 rows exist on this pin**, all unplugged, all gap 0 (`raw/pulled-pre-run.jsonl`, 0-based lines 79–82). The replay does not filter
  by pin, so the replay of the whole pool mixes 8 pins: `OUTPUT-dry-pre-run-pool-2026-10-17.md`, cond 298.8 with cooling,
  39.1 without, 83 rows. That number is NOT an S23 OPEN 6 answer. The cell's own rows are the answer.
- Phone state at check time: **plugged in (AC), level 40 and rising, 31 at 09:29**. Dozing, keyguard up, focus not Kalsa.
  The S23 wakes correctly with the rule above.
- `screen_off_timeout` reads **1800000** now. The oracle cell's `turn.sh` sets that value, so it is probably not the owner's
  default. `run_schedule.sh` records whatever it reads at start and restores it.

## Battery: the run needs a higher start than 31 %

The stop rule is level < 30 %. From 31 %, a 2-hour run that is mostly LONG generations will likely cross 30 % after
a few turns, and the run would stop early with a short cell. The 10-16 and 10-17 unplugged drain on this phone is about
10 % over 2.5 h of mixed use; a 2-hour cell with LONG turns is in the same range or higher.
**Recommendation: charge to at least 50 % before unplugging.** This is the owner's call.

## Go procedure (after the owner unplugs)

1. Check: `adb -s $SER shell dumpsys battery` shows AC/USB false; level >= 50.
2. `RUN_GO=1 ./run_schedule.sh` (in this directory). It prints nothing until it starts; progress is in `raw/turns.jsonl`
   and `raw/samples.tsv`.
3. When it finishes or stops: `adb ... exec-out run-as com.kalsa.app cat files/governor/observations.jsonl > raw/pulled-post-run.jsonl`
   then `./replay.sh raw/pulled-post-run.jsonl`.
4. Check `raw/run-status.txt` and `raw/device-before.txt` (timeout restored).

## Results

Not yet run.
