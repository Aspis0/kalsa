# Xiaomi 14 normal-use observation cell (2026-10-17) — learning-governor Stage 0 / OPEN 6

**RESULT: 26 UNPLUGGED normal-use completion rows collected on the owner's Xiaomi 14 (SM8650,
LFM2.5 2.6B) across 22 turns and 7 chats, against the >= 20 target. The replay ran on that file
and OPEN 6 is now answered with 25 rows in the fit instead of 8. STOP was not reached: no stop
rule ever fired, because none came close.**

The headline for the cell's purpose: **OPEN 6 is still open, and 3x the rows made the
collinearity WORSE, not better** — condition number 154.8 with the cooling column against 48.8
without, where the 8-row scripted cell read 77.2 / 21.3. Two other OPEN items moved decisively,
one of them for the first time: **DESIGN 3.4 criterion 3 (speed attribution) became TESTABLE**
(normal use leaves unpaced rows; the old cell had none) and **OPEN 3's forecast noise dropped
below the 0.2 C floor** (median sigma 0.1281 C against 0.2933 C).

## What was collected

| item | value |
|---|---|
| Device | Xiaomi 14 `23127PN0CG`, `ro.soc.model=SM8650`, serial `adb-625689a2-9xEOfw._adb-tls-connect._tcp` (the duplicate `(2)` transport was never used) |
| App | `com.kalsa.app` 0.1.0, debuggable, installed 2026-10-15, **last updated 2026-10-15 20:06:17** |
| Binding pin | `d4754cb564d42d52381098e810396dcf88fa5d8e` — **NOT** the Oct-15 cell's `861a3cc3…` (see Anomaly 3) |
| Model | LFM2.5 2.6B on the phone (`LFM2.5 2.6B — Su questo telefono`), HTP0 NPU route |
| Battery over the cell | 96 % -> 83 %, `status: 3`, AC/USB/wireless powered false **for every row** |
| Thermal over the cell | skin 35.9-41.7 C, battery 34.9-38.7 C, **Android thermal status 0 on all 46 samples**, no wait ever triggered |
| Rows | 26 new rows, **all `plugged: 0`, all `gap: 0`**; states FAST (18 rows) then WARM (8 rows) |

Turn-level shape: 22 turns produced 26 rows. Twenty turns produced 1 row each; the two
web-search turns produced 3 rows each (one per tool round). Prompts are in `raw/turns.jsonl`,
varied and in both languages — Italian and English questions, a formal-rewrite, a mail, a
caption, a four-bullet summary, a one-paragraph summary, two search requests, a study plan, a
packing checklist, a formula explanation. Six chats were opened with "Nuova chat" during the
cell and the phone was left on a seventh, empty one.

The 26 rows, in order (`raw/observations.jsonl`):

```
 #   t round pred_n  wall_s   min  state  plug lvl  batt gap
 0   1   0     459  382480  0.50  FAST     0  96   349   0
 1   2   0     477  382575  0.59  FAST     0  95   357   0
 2   3   0     205  382656  0.26  FAST     0  95   357   0
 3   4   0     345  382711  0.45  FAST     0  95   357   0
 4   5   0     574  382804  0.71  FAST     0  94   352   0
 5   6   0     362  382902  0.45  FAST     0  94   352   0
 6   7   0     401  382983  0.52  FAST     0  93   355   0
 7   8   0     511  383061  0.71  FAST     0  93   360   0
 8   9   0     764  383179  1.03  FAST     0  92   364   0
 9  10   0     336  383297  0.44  FAST     0  92   361   0
10  11   0     701  383376  1.08  FAST     0  91   366   0
11  12   0     101  383498  0.14  FAST     0  91   366   0
12  13   0     149  383575  0.19  FAST     0  90   369   0
13  13   1      98  383586  0.13  FAST     0  90   369   0
14  13   2      64  383595  0.08  FAST     0  90   369   0
15  14   0     102  383662  0.12  FAST     0  90   371   0
16  14   1      67  383670  0.08  FAST     0  90   371   0
17  14   2      59  383675  0.08  FAST     0  90   371   0
18  15   0     384  383811  0.88  FAST     0  89   377   0
19  16   0     493  383905  1.05  WARM     0  88   386   0
20  17   0     535  384049  0.96  WARM     0  88   386   0
21  18   0    1317  384173  2.68  WARM     0  87   379   0
22  19   0     471  384398  0.98  WARM     0  86   383   0
23  20   0     584  384518  1.25  WARM     0  85   379   0
24  21   0     522  384658  0.97  WARM     0  85   381   0
25  22   0     624  384776  1.21  WARM     0  84   380   0
```

## Replay: the OPEN 6 headline

`OUTPUT-xiaomi-obs-20-2026-10-17.md` (in this cell and copied into `learning-governor/replay/`).
Input: 26 rows, 26 used, 0 gap rows dropped, 348 window samples; fit on 25 rows.

**OPEN 6 — `bg` / cooling collinearity: STILL OPEN, and worse-conditioned than before.**

- rank 5 of 5 columns over 25 rows, residual df 20 (the 8-row cell had residual df 3)
- condition number **154.8** with the cooling column, **48.8** without it (Gram 23969.3 / 2382.7)
- dropping the cooling column moves `npu_k` 6.534 -> 7.409 C per 1k tokens and `wall_min`
  -2.052 -> -2.710 C per minute
- `gpu_k`, `cpu_k`, `prefill_gpu_k` carry no variance: not identifiable, and no Stage 0 row set
  can fix that

**The point of this cell, stated plainly: more normal-use rows did not resolve OPEN 6.** The
conditioning ratio worsened from 77.2/21.3 on 8 scripted rows to 154.8/48.8 on 26 normal-use rows.
Normal use supplies far more rows and much more residual freedom (df 3 -> 20) and still the
cooling term and the token/time columns fight over the same variance. The individual
coefficients remain unstable estimates and none of them should be read as a heat number. Note
also the `wall_min` sign flip against the old cell (+1.188 C/min there, -2.052 here): the two row
sets do not agree on the sign of the time term either, which is what instability looks like.

Other OPEN verdicts from these rows, with what moved:

| OPEN | this cell | 8-row cell (2026-10-15) |
|---|---|---|
| 2 forecast read age | max window `h_age` 3094 ms over 348 windows, 0 above the 4 s gate — gate holds | 2654 ms over 324 windows, 0 above — holds |
| 3 forecast noise vs the 0.2 C floor | **median detrended sigma 0.1281 C, worst row 0.2927 C — at/under the floor** | median 0.2933 C, worst 0.4290 C — above the floor |
| 4 battery sysfs in-process | probe read neither value on 26/26 rows — negative again | negative, 0/8 rows |
| 5 wake skin and the (0, 0.083) band | 2/26 rows carry 28 windows inside the band; wake skin p50 38.7 C (36.5-40.5) | 1/8 rows, 7 windows; wake skin p50 40.0 C |
| 6 cooling collinearity | full rank 5/5, df 20, cond **154.8** (48.8 without cooling) — open | df 3, cond 77.2 (21.3) — open |

**DESIGN 3.4 criterion 3 is now TESTABLE and PASSES with one exception** — the single most
useful thing this cell bought. Normal use leaves unpaced rows: 7/26 are unpaced 100 % NPU rows
(the old cell had 0/8, so the criterion was untestable there). On those 7, NPU tok/s against
`pps` is within 10 % on 6, with the largest |delta| **+13.7 %** on row 12 (14.94 vs 13.14 tok/s).
So: 6/7 within tolerance, 1/7 outside.

Two more things normal use changed, both worth keeping:

- **App-sample age collapsed**: window `app_age` p50 22.3 s, max 163.7 s, against p50 106.7 s /
  max 503.3 s in the 8-row cell. 11/348 windows exceed the old 120 s gate (was 148/324); 0/348
  exceed the 1200 s backstop. Shorter completions in normal use mean the freshness gate is far
  less exposed than a long scripted completion was.
- **Leg mix unchanged**: 10144 NPU tokens from the wake across all rows, 0 GPU, 0 CPU, 0
  coolmode. Window coverage 92.5-99.5 % except the four shortest paced rows.

## Stop reason

**None — the cell ran to its target, not to a limit.** No stop rule fired at any point:
battery never went below 83 % (floor 30), battery temperature peaked at 38.7 C (gate 42 C, and
the hotter of the two OS probes was used, see Method), Android thermal status was 0 on all 46
samples (gate >= 3), and the 20-minute thermal-wait loop was entered zero times. The run ended
because the target of >= 20 UNPLUGGED normal-use completions was met with margin at 26.

## Method, and the safety envelope actually held

The scripts are in `raw/` and every turn ran the identical, auditable path: `cycle.sh` (stop-rule
gate -> optional new chat -> `turn.sh` -> wait for the row count to move -> per-turn sample),
`turn.sh` (focus/keyguard checks, type, read back, send), `newchat.sh`, `uidump.sh`, `sample.sh`,
`extract.py`.

- **Stop rules, checked before every one of the 23 turn slots**: battery < 30 % stops; battery
  temp >= 42 C or thermal status >= 3 waits 60 s and re-polls up to 20 min, then stops. The
  battery gate deliberately takes the **hotter** of `dumpsys battery` and the live HAL `battery`
  sensor, so the gate is the conservative one. Never triggered.
- **Never unlocked, never typed a PIN, never sent keyevent 26.** Before every tap both scripts
  check `mCurrentFocus` shows `com.kalsa.app` (relaunching Kalsa exactly once with `monkey` if
  not) and that `showing=false` and `mIsScreenOn = true`; on a locked or dark screen they stop.
  The keyguard was up exactly once in this whole session — never: `showing=false` throughout.
- **Only com.kalsa.app was ever touched.** No other app, notification, setting or file. Nothing
  installed or uninstalled. No shell redirect into app data: the app's private dir was read
  only, via `exec-out run-as ... cat`, and the one temp file the tooling needs is written to the
  adb shell temp dir and deleted in the same command (verified absent at the end).
- **Typed text was always verified.** `input text` drops characters while the keyboard opens, so
  every prompt was read back from the field and compared to the intent before sending; a
  mismatch was retried once, then the field was cleared and nothing was sent. Every send in this
  cell typed exactly what was intended (all 22 verified matches are in `raw/turns.jsonl`).
- **Screen timeout was NOT touched**: `screen_off_timeout` reads 14400000 at the end, the value
  the coordinator had already set. The original 60000 in `/tmp/xiaomi-screen-timeout.orig` is the
  coordinator's to restore.
- **Left as found**: Kalsa is in the foreground on an **empty new chat** (verified: 0 transcript
  message nodes, empty composer), no conversations deleted, no helper process left running, the
  36 rows still in the app's private dir.

## Anomalies — read these before using the rows

1. **`web_search` does not work on this build.** The app said so on screen in Italian: *"Mi
   dispiace, ma il tool di ricerca web (web_search) non è attualmente funzionante"*. The two
   search turns still produced their 3 rows each, but they are **tool-failure rounds**
   ("Salvo una nota… / Cerco sul web… / the refusal"), with `pred_n` of 59-149 against 384-1317
   for the real answers. They are genuine governor rows and are included, but they are a
   different, much shorter regime; if the heat fit is sensitive to completion length, those six
   rows are the ones to drop. Cause not investigated — out of scope.
2. **A UI-automation failure cost one turn and forced one chat merge.** `uiautomator` refuses to
   dump while the app is streaming tokens ("ERROR: could not get idle state.") and returns exit
   code 0 with an empty hierarchy, which looks exactly like a blank screen. This aborted turn 15's
   new chat and then turn 16's typing. Fixed by making `uidump.sh` retry until the hierarchy is
   real (up to 8 attempts, 3 s apart) and by reading every control coordinate from the dump
   instead of hardcoding it — the composer moves when the keyboard opens (field y 2436 closed /
   1402 open), so a fixed tap lands on the keyboard once the keyboard is up. Turn 15 was re-run
   successfully in its own chat; **turn 16 was dropped, nothing sent, nothing half-typed**. Turns
   17 and 18 consequently landed in the previous chat, so one chat holds four turns instead of
   the planned three.
3. **The rows are from a DIFFERENT BUILD than the 8-row cell.** This cell's pin is
   `d4754cb5…`, the Oct-15 cell's is `861a3cc3…`, and the installed app's `lastUpdateTime` is
   2026-10-15 20:06:17 — after the previous session finished at 11:57. **The two row sets must
   not be merged into one replay**; the comparison in the tables above is a comparison between
   two producers, not a time series of one.
4. **The background load is this harness, not the phone's owner.** At session start `sh.paseo`
   (the agent host running these turns) was at 83 % CPU with load average 6-7, which is what
   heated the phone to a cached skin reading of 46.7 C before the cell started; it cooled to
   ~36 C once the session went quiet. This is a real confound for OPEN 6 in particular, which
   is the item about background load collinearity: every row in this cell carries a
   harness-driven background load that ordinary use would not have. It cannot be removed — the
   same process is the transport — but it should be declared before the condition numbers are
   compared against anything else.
5. **`dumpsys thermalservice`'s "Cached temperatures" block is frozen on this phone.** It read
   byte-identical values (skin 46.704, battery 42.4, CPU 82.1) across five consecutive polls
   spanning five minutes, and disagreed with sysfs by ~10 C. `sample.sh` therefore reads the
   "Current temperatures from HAL" block, which tracks `/sys/class/thermal` exactly. Anything
   that reads the cached block on this device will get stale numbers. Whether this is a HyperOS
   bug is UNVERIFIED — not investigated.
6. **`wall` is `SystemClock.uptimeMillis()`, not epoch, and not `/proc/uptime`.** It excludes
   deep sleep, so after the overnight doze it lags `/proc/uptime` by hours (row `wall` 382479 s
   against `/proc/uptime` 736900 s at the same moment). It is a perfectly reliable ORDERING key
   and a reliable session boundary — which is how `extract.py` separates this cell's rows from
   the 10 pre-existing ones — but it must never be converted to a wall-clock time. Also note
   that the row field `t` counts turns across the whole app session, not per chat, so `t` does
   not identify a conversation.
7. The 10 pre-existing rows were **left in the app's file and are excluded** from this cell's
   replay input by the wall-clock boundary: 8 from the Oct-15 scripted campaign, 1 normal-use
   unplugged row, and **1 row with `plugged: 1` that was charging** (a good reminder that the
   unplugged filter has teeth). `raw/observations-pulled-36.jsonl` is the raw pull;
   `raw/observations-baseline-10rows.jsonl` is the pre-cell state; `extract.py` is the filter.

## Not claimed

- **No speed claim**: one arm on the owner's daily driver, no control build, natural prompt mix.
- **No heat claim, and no endurance claim**: the cell stopped at its row target while the phone
  was at 83 % and 38.5 C, nowhere near its limits.
- **No leg-mix equivalence claim**: no `df359450` control arm on this phone, so DESIGN 3.4
  criterion 7 remains unjudgeable here, exactly as on the S23 and as in the Oct-15 cell.
- **OPEN 6 is not closed.** This cell bounds it better and shows more rows do not fix it; the
  collinearity needs a design change (drop or restructure the cooling column, or stage the
  predictors), not a longer run.
- Whether the 6 tool-failure rows belong in the heat fit is a judgement I did not make; they are
  included as collected.
- Answer quality was not assessed.