# S23 logit-oracle M5: port, cool rehearsal, cool group, warm-arm attempt

Date 2026-10-16. Device: Samsung S23 (SM8550, `SM-S911U`, Android 16 / SDK 36), wireless adb serial
`adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. App `com.kalsa.app` 0.1.0, `lastUpdateTime=2026-10-16
19:53:14`, `pkgFlags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]`. APK
`/tmp/apk-38975826380/.../app-release.apk` sha256 `1e27ba67fcc18851c08123c6b4885aa72249cbaedb596521d6b98fa95cd9cab5`
— already installed, **not reinstalled**.

Model on device, read with `run-as` (this is the ship model, so the run continues):

```
$ adb -s $SER shell "run-as com.kalsa.app sha256sum files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf"
a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03  files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf
$ adb -s $SER shell "run-as com.kalsa.app find files/models -name '*.gguf' -exec ls -l {} \;"
-rw-rw-rw- 1 u0_a347 u0_a347 1593894944 2026-09-26 15:01 files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf
```

## 1. What was ported

Source cell `qdc-oracle-onoff-41dc728f` (unmodified; `git status --porcelain` on it is empty).
Copied verbatim: `oracle_logit.py` (**unmodified, the verdict tool**), `steps.py`, `enc-short.txt`,
`enc-long.txt`, `prompts.sha256`, `oparse.sh`. Rewritten for this transport: `env.sh`, `turn.sh`,
`kset.sh`, plus new `arm.sh`, `restore.sh`, `skin-id.sh`.

| Source-cell mechanism | S23 port |
| --- | --- |
| `adb root` + raw `/data/data` pull/push | not rooted, no device `sqlite3`. `adb exec-out run-as com.kalsa.app cat databases/RKStorage` to pull, edit locally with `sqlite3`, write back with `adb push` + `run-as cp` |
| SSH tunnel, `SER=$(adb devices \| head -1)` | serial pinned in `env.sh`, plus a `ro.product.model == SM-S911U` guard so the cell cannot ever grab a wrong device |
| English UI labels `Menu` / `New chat` / `Send` | app locale is `it`: `Apri il menu` / `Nuova chat` / `Invia` |
| `dumpsys battery unplug; set temp 300` | **not ported.** The S23 has a real thermistor; faking it would void the heat numbers M5 exists to measure |
| `kalsa.bench.thermo` synthetic thermo profile | not set — real reads only |
| QDC `arm.sh` P1A (`governor.enabled=0`, CPU arm) | A arm is the **production** governor (`kalsa.governor.enabled` left at its shipped `1`, asserted at arm time) |
| `wipe-chats.sh` (delete every conversation) | **not ported.** It would delete the owner's four real chats. The driver makes a new chat per turn instead (`turn.sh` Menu → `Nuova chat`), and records the pre-turn activeId so comparability stays auditable |
| skin-temp-only watchdog | 10 s monitor: wake + `mWakefulness` + skin + NPU + GPU + battery + level + plug + thermal status; task stop rules |

### Defect found and fixed during the port

The first `kset.sh` wrote the DB back with
`adb exec-out run-as com.kalsa.app sh -c "cat > databases/RKStorage" < local.db`. adb joins its
arguments into one remote shell string, so the `>` was parsed by the **outer** shell and the write
truncated `databases/RKStorage` to **0 bytes**. Restored immediately from the pre-write pull;
`PRAGMA integrity_check` = `ok`, 64 rows, all 4 original conversations and 25 `kalsa.session.*` rows
present, `kalsa.locale`, `kalsa.web.enabled`, `kalsa.model.id` unchanged. `exec-out` also never
closes stdin, so that form cannot be used for a push at all. `kset.sh` now pushes via
`adb push` + `run-as cp`, keeps a `backup` copy, and refuses a write whose read-back size differs
from the edited local file.

## 2. Zones found

`skin-id.sh` (never `max()`). The S23 has **two** `mName=SKIN` entries and, unlike the QDC, **both
move** — they are one physical sensor exposed by both HALs:

```
entries=2
sample1=[34.9 34.9 ] sample2=[34.7 34.7 ] sample3=[34.5 34.5 ]
moved_entries=[ 1 2]
all entries [ 1 2] move together to 34.5 : one physical sensor via 2 HAL entries; pinned index 1
```

There is **no skin kernel zone** on this phone; skin comes from the HAL list only. The engine legs
are kernel zones and are shell-readable (`/sys/class/thermal/thermal_zone*`, 95 zones total):

- **NPU: `nspss-0..3`** (Hexagon/HTP), e.g. `nspss-0 38600  nspss-1 37800  nspss-2 37800  nspss-3 38200`
- **GPU: `gpuss-0..7`**, e.g. `gpuss-0 39200 … gpuss-7 38800`
- `battery` zone present (`battery 35100`), unused — `dumpsys battery` is the battery thermistor.

`npu_c()` / `gpu_c()` take **min()** over their group, the same choice the app's own headroom rule
makes (`s23-fix2-heat-2026-10-16/REPORT.md`: "NPU zones (nspss-0..3) passive trips 95/115/115/125 C;
the reader uses the lowest, 95 C").

## 3. The two turns

Bench keys, identical for both arms except the two B keys (read back and verified on device):
`kalsa.bench.sampling=greedy`, `kalsa.bench.probs=1`, `kalsa.bench.toolchoice=none`,
`kalsa.web.enabled=false`, `kalsa.tools.device=false`, `kalsa.tools.calendar=false`;
B adds `kalsa.bench.governor_force=1` and `kalsa.bench.force_ids=[<A's 32 ids>]`.
`npu_lane` / `route` / `thermo` explicitly absent in both, so `governor_force` itself is what is
under test.

Stop rules were live the whole time and **never fired**: max thermal status observed 2 (limit 3),
max battery 41.1 C (limit 42.0), level rose 53 → 64 % while on AC so the `< 30 % unplugged` rule
never applied. Charging was `plug=AC` on every sample of both turns.

| | arm **A** (production NPU) | arm **B** (`governor_force=1`) |
| --- | --- | --- |
| pre-turn | `wake=Awake skin=34.3 npu=36.6 gpu=37.2 batt=34.7 lvl=53 tstat=0 plug=AC` | `wake=Awake skin=35.8 npu=38.6 gpu=39.2 batt=36.4 lvl=60 tstat=0 plug=AC` |
| post-turn | `wake=Awake skin=37.3 npu=43 gpu=43.2 batt=37.8 lvl=56 tstat=0 plug=AC` | `wake=Awake skin=40.4 npu=46.1 gpu=45.9 batt=40.8 lvl=64 tstat=2 plug=AC` |
| wall time from send | **62 s** (settle 3 s, cold launch ~30 s) | **202 s** (settle 5 s, cold launch ~30 s) |
| monitor samples / Awake | 4 / **4 = 100 %** | 15 / **15 = 100 %** |
| battery temp start → end | 34.7 → 37.8 C (peak 38.0) | 36.4 → 40.8 C (peak 41.1) |
| peak NPU / GPU | 65.7 / 58.6 C | 58.5 / 56.3 C |

No non-Awake sample in either turn, so **no turn is INVALID** on the wakefulness rule.

### Prefill backend actually used — the line that decides it

```
KALSA_GOVERNOR_TURN {"ep":"NPU","ed":"NPU","rr":2,"th":true,"hn":54.000003814697266,"hg":53.80000305175781,"npu":"HTP0","npuf":null,"ck":"q8_0","cv":"q8_0","kv":"device","chunks":5,"dev":["HTP0"],"therm":"FAST","forced":false}
KALSA_GOVERNOR_TURN {"ep":"GPU","ed":"NPU","rr":5,"th":true,"hn":38.900001525878906,"hg":36.80000305175781,"npu":"HTP0","npuf":null,"ck":"q8_0","cv":"q8_0","kv":"device","chunks":5,"dev":["GPUOpenCL"],"therm":"FAST","forced":true}
```

A is NPU prefill, B is **GPU prefill** with `dev:["GPUOpenCL"]` and `forced:true`. `governor_force`
was **not** inert. The reason it had a GPU leg to act on, from the plan line of each turn:

```
KALSA_GOVERNOR_PLAN {… "npu_price":"with_gpu","gpu_leg":true}      # arm A
KALSA_GOVERNOR_PLAN {… "npu_price":"with_gpu","gpu_leg":true}      # arm B
```

So on this S23 the shipped governor already prices with the GPU leg; `governorInputs.ts:481`'s
`bench_force_gpu_prefill: force && gpuLeg` was satisfied without any `npu_lane`/`route` override.

### Parsed `KALSA_BENCH_PROBS` rows

```
s23A ids=32 from=tokens-line probs=563 steps0_31=contiguous tokens_lines=1
s23B ids=32 from=tokens-line probs=33  steps0_31=contiguous tokens_lines=1
```

A emits 563 rows (steps 0–562, free greedy, the whole answer); B emits exactly 33 because
`force_ids` ends generation at A's 32 tokens. Both have a `KALSA_BENCH_TOKENS` line, so B's 32 ids
came from A's token line, not from a fallback. All 33 B rows carry `"forced":true`, which is what
`oracle_logit.py:89` requires for mode TF. A is cold-started with `files/sessions/*` removed, so no
saved prefix leaked in.

## 4. Oracle verdict — rehearsal only

`bash oracle.sh s23A s23B`, unmodified `oracle_logit.py`, TF mode, pre-registered thresholds
0.03 / 0.02 / 0.10 (`logit-oracle/PREREG.md:20`-`:31`). Verbatim:

```
oracle=FAIL rule=R2 steps=32 max_dlogp=0.7041 max_dp1=0.1021 divergences=0 first_div=-1
oracle_exit=0
steps_exit=0
```

Per-step table (`raw/steps-s23A-vs-s23B.txt`), head and tail:

```
step  0 A1=597 B1=597 margin=0.999 max_dlogp=0.704 dp1=0.000
step  1 A1=4695 B1=4695 margin=1.000 max_dlogp=0.270 dp1=0.000
step  2 A1=10966 B1=10966 margin=0.142 max_dlogp=0.155 dp1=0.001
step  3 A1=622 B1=622 margin=0.909 max_dlogp=0.143 dp1=0.007 R2
…
step 31 A1=998 B1=998 margin=1.000 max_dlogp=0.481 dp1=0.000
R1 steps: []
R2-first steps: [3, 5, 6, 11, 12, 16]
```

Top-1 agrees on **32/32** steps; there is no R1 violation anywhere. The failure is distribution
shape: max |Δlogp| 0.7041 nats against a 0.10 limit, max |Δp₁| 0.1021 against 0.02.

**This is n=1 and is not a verdict.** `PREREG.md:26` (R4) requires 32 comparable steps on **≥ 2
same-turn pairs per board**, and the oracle itself prints `steps=32` for one pair only. (Discharged
for this board in §7: four pairs, two per condition, all `steps=32`.) The R5
sanity control (8 Elite known-good GPU must PASS, a fault-injected build must FAIL) is still unmet
by the registry and is inherited unchanged from the source cell. Directionally it matches the
plan's pre-registered expectation of FAIL R2 with high same-top (§4.5), and the source cell's
SM8850 pair (`max_dlogp 0.5236`, `max_dp1 0.1075`) is the same shape, but "how often and by how
much on the S23's own kernel" is exactly what the full run still has to answer.

## 5. Hot-NPU arm: how to make one, and the time budget

The cell's thermal rig is a cool-down rig; nothing in it makes the NPU hot while leaving skin
survivable. What this rehearsal shows about the levers:

- Arm A's **single** short prefill only reached 65.7 C NPU. The heat report's 73–78 C is what a
  *sustained* session reaches, so a warm arm needs back-to-back prefill, not a hotter prompt.
- The stop rules are a battery rule, not an NPU rule, and they bind first: arm B's battery went
  36.4 → 41.1 C in one 202 s turn. **A hot-NPU arm is a battery-budget problem.**
- The FIX 2 handoff still cannot be made to fire by heating alone — `s23-fix2-heat-2026-10-16/REPORT.md`
  records the guard needs the NPU near 90 C while the 43 C battery stop comes first, and the owner
  already accepted "keep it on as is, no forced test". So the hot arm must be produced by the
  harness's own start condition, not by trying to trip the rule.

Proposed hot arm:

> **Outcome:** built and run as `campaign.sh warm`; the start condition in point 1 does not work on
> this rig. §7.3 has the measured reason — an idle NPU gate never sees the 70 C that only occurs
> *during* a turn — and §7.7 what it left behind.

1. **Start condition on the NPU zone**, as the task asks: begin the measured turn only when
   `min(nspss-*) >= NPU_WARM_C` (start at 70 C — squarely inside the 73–78 C band normal generation
   produces, and ~25 C below the 95 C passive trip). `npu_c()` already exists in `env.sh`; add the
   same gate that `COOL_TARGET`/`COOL_BATT` now provide, and **stop watching battery 42 C and
   thermal status 3**, which stay the kill switches.
2. **Warm-up turns**: run 3–4 normal NPU-prefill turns back-to-back with the settle gates disabled
   (`COOL_TARGET=99 COOL_BATT=99`), then start the measured pair. The heat loop did this and moved
   the battery 29.8 → 39.3 C in ~18 min of long turns, so budget ~15–20 min of warm-up per hot arm.
3. Then run A and B **hot**, each forced to the other's ids as before, and compare against this cool
   pair — the interesting output is whether R2's step set moves, not whether the verdict flips.

Time for the full 8-turn run (R4: 2 pairs × {A, B} × {cool, hot}):

- measured turns: ~2.5 min (NPU) + ~4.5 min (GPU) from this rehearsal, + ~1.5 min cold launch each
- cooldown between cool arms: battery 41 → 38 C took ~4 min here; the cool arm may want a deeper
  settle, say 10–15 min
- warm-up before each hot arm: ~15–20 min
- **≈ 8 × 4 + 4 × 12 + 2 × 20 ≈ 2.5 h of device time**, versus the plan's ~3–4 h estimate. It can
  run unattended; the monitor is a single background loop and the stop rules are self-enforcing.

## 6. State left on the device

> This section records the state after the **rehearsal** only. §7.7 records the state after the full
> run, which supersedes it.

`restore.sh` ran clean (exit 0). Every key this cell touches is back to its pre-run value:

```
ABSENT kalsa.bench.sampling / probs / toolchoice / governor_force / force_ids / npu_lane / route / thermo
SET kalsa.web.enabled=1     (pre-run value 1)
SET kalsa.tools.device=0    (pre-run value 0)
SET kalsa.tools.calendar=0  (pre-run value 0)
--- final state
kalsa.bench.energy_trace=1  kalsa.bench.kvtranscript=1  kalsa.bench.nativelog=1   (pre-existing, untouched)
kalsa.tools.calendar=0  kalsa.tools.device=0  kalsa.web.enabled=1
```

`PRAGMA integrity_check` = `ok`. Diffing the key set against the pre-run snapshot shows only four
added rows — the two conversations the two turns created
(`conv-1792195586505-zc2ob8rh` = A, `conv-1792195877859-roz0bu6v` = B) with their compactor rows.
Nothing pre-existing was changed or removed. B's conversation preview reads "Generazione
interrotta." because `force_ids` ends generation at 32 tokens — expected, not a failure. The owner
may delete those two chats; the cell does not.

Device left: never disconnected, never uninstalled, app data never cleared, airplane mode never
enabled, no PIN, no battery fake. Screen timeout was raised to 1800000 by the driver
(`settings put system screen_off_timeout`), matching the source cell.

## 7. Full run: cool group (c1, c2), warm group (w1, w2)

### 7.1 Pre-flight

```
$ adb devices -l
adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp  device product:dm1qsqw model:SM_S911U device:dm1q
$ adb -s $SER shell getprop ro.product.model
SM-S911U
$ pgrep -fl "campaign.sh|turn.sh|arm.sh"        # empty, rc=1: no second campaign
$ adb -s $SER shell "pm list packages com.kalsa.app; dumpsys package com.kalsa.app | grep versionName"
package:com.kalsa.app
    versionName=0.1.0
    lastUpdateTime=2026-10-16 19:53:14        # unchanged: not reinstalled
wake=Awake skin=36.8 npu=38.6 gpu=38.8 batt=37.5 lvl=95 tstat=1 plug=AC
```

Full DB backup before anything: `raw/RKStorage-preM5full-backup.sqlite`,
sha256 `26d81f38428c2acae4c77f18bcf100a51ee38264a49c22905d73af345b1e8995`.

### 7.2 The measured turns

`NPU/GPU/batt` are the `wake/NPU/GPU/battery` leg of the snapshot taken at the last moment before the
send tap (`raw/<arm>-send-pre.txt`); `wall` is seconds from send (`raw/<arm>-run.log`);
`rows` is `KALSA_BENCH_PROBS` rows. `plug` is the value on **every** monitor sample of that turn —
all 8 turns sampled `plug=AC` exclusively, all samples `wake=Awake`.

| pair | arm | NPU / GPU / batt at send (C) | plug | wall | rows | oracle line (verbatim) |
| --- | --- | --- | --- | --- | --- | --- |
| c1 | A | 42.6 / 42.8 / 38.0 | AC | 62 s | 563 | `oracle=FAIL rule=R2 steps=32 max_dlogp=0.7041 max_dp1=0.1021 divergences=0 first_div=-1` |
| c1 | B | 52.1 / 54.3 / 39.5 | AC | 201 s | 33 | `oracle=FAIL rule=R2 steps=32 max_dlogp=0.7041 max_dp1=0.1021 divergences=0 first_div=-1` |
| c2 | A | 42.6 / 42.8 / 38.1 | AC | 63 s | 563 | `oracle=FAIL rule=R2 steps=32 max_dlogp=0.7041 max_dp1=0.1021 divergences=0 first_div=-1` |
| c2 | B | 52.1 / 53.9 / 39.3 | AC | 198 s | 33 | `oracle=FAIL rule=R2 steps=32 max_dlogp=0.7041 max_dp1=0.1021 divergences=0 first_div=-1` |
| w1 | A | 37.8 / 37.6 / 33.8 | AC | 62 s | 563 | `oracle=FAIL rule=R2 steps=32 max_dlogp=0.7041 max_dp1=0.1021 divergences=0 first_div=-1` |
| w1 | B | 50.1 / 53.1 / 35.8 | AC | 181 s | 33 | `oracle=FAIL rule=R2 steps=32 max_dlogp=0.7041 max_dp1=0.1021 divergences=0 first_div=-1` |
| w2 | A | 40.6 / 40.8 / 36.6 | AC | 62 s | 563 | `oracle=FAIL rule=R2 steps=32 max_dlogp=0.7041 max_dp1=0.1021 divergences=0 first_div=-1` |
| w2 | B | 52.1 / 54.3 / 37.9 | AC | 191 s | 33 | `oracle=FAIL rule=R2 steps=32 max_dlogp=0.7041 max_dp1=0.1021 divergences=0 first_div=-1` |

The B arms really were GPU-prefill in the warm group too, from the governor line of each turn:

```
w1a … KALSA_GOVERNOR_TURN {"ep":"NPU","ed":"NPU","rr":2,…,"npu":"HTP0",…}
w1b … KALSA_GOVERNOR_TURN {"ep":"GPU","ed":"NPU","rr":5,…,"dev":["GPUOpen…
w2a … KALSA_GOVERNOR_TURN {"ep":"NPU","ed":"NPU","rr":2,…,"npu":"HTP0",…}
w2b … KALSA_GOVERNOR_TURN {"ep":"GPU","ed":"NPU","rr":5,…,"dev":["GPUOpen…
```

No stop rule fired in the warm group (`raw/w*-stopped.txt` do not exist) and no monitor sample was
non-Awake, so **no warm turn is INVALID**. Peak battery over the warm group was 40.0 C against the
42.0 C rule and peak thermal status 2 against the limit 3.

### 7.3 The warm start condition was never reached — this arm is not warm

`NPU_WARM_C=70`, but the gate is evaluated **between** turns while the app is idle. The NPU reaches
70 C only *during* a turn, so the reading the gate sees falls back every time:

```
[20:54:36] warm-up warm1 rc=0 …     (run 1, real peaks from the monitor files below)
[21:18:43] WARM-UP CAP HIT after 1617s, npu=45.3 batt=40.0
[21:18:43] warm-up 1 ended early; running w1 at whatever NPU it reached
```

Warm-up long turns did heat the NPU inside the turn, well into the intended band
(`raw/warm*-monitor.txt`, peaks by file): warm3 78.4 C, warm4 78.0 C, warm5 74.4 C, warm8 75.2 C,
warm6 65.3 C, warm7 64.9 C — but the between-turn reading never exceeded 45.7 C. Per-arm gate
records (`raw/<arm>-cool.txt`):

```
w1a  warm_s=104  npu_gate=70.0 npu_start=36.2 batt=33.7 give_up=no
w1b  warm_s=105  npu_gate=70.0 npu_start=36.2 batt=33.9 give_up=no
w2a  warm_s=101  npu_gate=70.0 npu_start=39.0  batt=36.8 give_up=no
w2b  warm_s=104  npu_gate=70.0 npu_start=37.8 batt=35.9 give_up=no
```

An earlier invocation of w1a with the default 1500 s cap gave the same answer after 25 minutes of
idling — `warm_s=1520 npu_gate=70.0 npu_start=33 batt=31.4 give_up=no` — which is the evidence that
the gate cannot fire on this rig rather than merely having been short on time. (That file was
overwritten by the re-run; the line is quoted from the read at 21:44 during this session.)

**Consequence: the w1/w2 pairs are a second cool group, not a hot one.** Their NPU at send is
37.8–52.1 C against 42.6–52.1 C for c1/c2, i.e. slightly *below* the cool group. Any cool-vs-warm
difference below is therefore unmeasurable with this rig and no such difference should be read into
the results. The task's instruction — "if warm-up cannot reach NPU 70 C, the script runs the arm at
what it reached: record it" — is what happened, and this is the record.

### 7.4 The campaign was killed once and re-run once

The first `campaign.sh warm` invocation was terminated by the harness, not by a script failure: the
background task was ended at 21:51:41, exactly 60 minutes after it started at 20:51:41, while w1b sat
in its 25-minute NPU gate. No `EXIT=` line was ever written and `pgrep` found no campaign process
afterwards. The DB was checked immediately and was intact: `PRAGMA integrity_check` = `ok`, and
`raw/w1b-arm.txt` shows the whole arm write completed and read back **before** the kill — every key
`SET` or `ABSENT`, no `VERIFY FAIL`, `kalsa.governor.enabled=1`. The kill landed in the gate, after
the arm and before the send, and w1b left no partial measured artifacts.

The remaining part was re-run once. Since the gate is provably unreachable, its wait was bounded for
the re-run by environment only — `WARMUP_CAP=300 NPU_WARM_CAP=90 bash campaign.sh warm` — with **no
file edited**. The 70 C target and every stop rule are unchanged; only the time spent waiting for an
impossible condition was cut. The re-run is a complete second pass: it redid the warm-up, redid
`w1a`, and produced `w1b`, `w2a`, `w2b`:

```
[21:59:22] WARM-UP CAP HIT after 343s, npu=41.4 batt=36.3
[22:03:22] w1a attempt 1 OK | send_pre: wake=Awake skin=34.0 npu=37.8 gpu=37.6 batt=33.8 lvl=100 tstat=0 plug=AC
[22:09:19] w1b attempt 1 OK | send_pre: wake=Awake skin=36.5 npu=50.1 gpu=53.1 batt=35.8 lvl=100 tstat=0 plug=AC
[22:09:19] ORACLE w1: oracle=FAIL rule=R2 steps=32 max_dlogp=0.7041 max_dp1=0.1021 divergences=0 first_div=-1
[22:19:25] w2a attempt 1 OK | send_pre: wake=Awake skin=36.2 npu=40.6 gpu=40.8 batt=36.6 lvl=100 tstat=1 plug=AC
[22:25:32] w2b attempt 1 OK | send_pre: wake=Awake skin=37.7 npu=52.1 gpu=54.3 batt=37.9 lvl=100 tstat=0 plug=AC
[22:25:32] ORACLE w2: oracle=FAIL rule=R2 steps=32 max_dlogp=0.7041 max_dp1=0.1021 divergences=0 first_div=-1
[22:25:32] === warm GROUP COMPLETE
EXIT=0
```

### 7.5 Determinism: 10 captures, 2 byte-identical classes

Every A capture and every B capture is byte-identical to the others of its arm, across five captures
per arm, four distinct logcat dumps, and 1 h 19 min of wall time:

```
2e7e0b747fa8fc4c3f21db9ae632fb5c415d87f21435791c4f0580e43bc2b21c  c1a-probs.jsonl
2e7e0b747fa8fc4c3f21db9ae632fb5c415d87f21435791c4f0580e43bc2b21c  c2a-probs.jsonl
2e7e0b747fa8fc4c3f21db9ae632fb5c415d87f21435791c4f0580e43bc2b21c  s23A-probs.jsonl
2e7e0b747fa8fc4c3f21db9ae632fb5c415d87f21435791c4f0580e43bc2b21c  w1a-probs.jsonl
2e7e0b747fa8fc4c3f21db9ae632fb5c415d87f21435791c4f0580e43bc2b21c  w2a-probs.jsonl
5849af493441f421dd5ed5353053d083d5fc93bbeafbe896673be72a9e8211ea  c1b-probs.jsonl
5849af493441f421dd5ed5353053d083d5fc93bbeafbe896673be72a9e8211ea  c2b-probs.jsonl
5849af493441f421dd5ed5353053d083d5fc93bbeafbe896673be72a9e8211ea  s23B-probs.jsonl
5849af493441f421dd5ed5353053d083d5fc93bbeafbe896673be72a9e8211ea  w1b-probs.jsonl
5849af493441f421dd5ed5353053d083d5fc93bbeafbe896673be72a9e8211ea  w2b-probs.jsonl
```

The A ids file is also identical across all five (`f39d0305dba15174…`), so B's forced grammar was
bit-for-bit the same input every time. First `KALSA_BENCH_PROBS` line of each capture, with the
governor's NPU headroom `hn` that differs between them:

```
s23A  10-16 20:06:43.679  hn=54.000003814697266
c1a   10-16 20:20:54.732  hn=51.20000076293945
c2a   10-16 20:32:39.149  hn=51.20000076293945
w1a   10-16 22:02:21.750  hn=55.60000228881836
w2a   10-16 22:18:25.478  hn=53.20000076293945
s23B  10-16 20:14:22.850  hn=38.900001525878906
c1b   10-16 20:27:29.484  hn=38.5
c2b   10-16 20:48:17.678  hn=38.10000228881836
w1b   10-16 22:08:49.699  hn=36.5
w2b   10-16 22:25:00.341  hn=36.10000228881836
```

So on this S23 kernel the HTP NPU prefill and the GPUOpenCL prefill are **bit-deterministic under
greedy decoding**: the same prompt at a different temperature state produces the same logits, not
merely the same top-1 token. This is why the four oracle lines below are identical.

Two qualifications. The handoff's `9d6fc503842e…` / `92bfb217c2e4…` are the SHA-1 digests of the same
files (`shasum` default); the SHA-256 values are `2e7e0b747fa8…` / `5849af493441…` as printed above.
Both agree on byte identity. Second, determinism is demonstrated for the short-prompt measured turns only. The warm-up long turns do have
four different hashes (`35cb6f01dd54…`, `e43bf5eb881a…`, `d30c7c7f4e28…`, `124e687000c7…`) but that
is a different generated length per turn (699, 669, 665, 687, 665 rows), not kernel
non-determinism — they are free-running long generations, and only their first 32 steps would be
comparable.

### 7.6 Cool vs warm, and the pre-registered status

`bash verdict.sh` over the stored verdicts:

```
--- cool group
pair c1  oracle=FAIL rule=R2 steps=32 max_dlogp=0.7041 max_dp1=0.1021 divergences=0 first_div=-1
   R1 steps []   R2-first steps [3, 5, 6, 11, 12, 16]
pair c2  oracle=FAIL rule=R2 steps=32 max_dlogp=0.7041 max_dp1=0.1021 divergences=0 first_div=-1
   R1 steps []   R2-first steps [3, 5, 6, 11, 12, 16]
R4(cool): MET — 2 pairs with 32 comparable steps (>= 2)
--- warm group
pair w1  oracle=FAIL rule=R2 steps=32 max_dlogp=0.7041 max_dp1=0.1021 divergences=0 first_div=-1
   R1 steps []   R2-first steps [3, 5, 6, 11, 12, 16]
pair w2  oracle=FAIL rule=R2 steps=32 max_dlogp=0.7041 max_dp1=0.1021 divergences=0 first_div=-1
   R1 steps []   R2-first steps [3, 5, 6, 11, 12, 16]
R4(warm): MET — 2 pairs with 32 comparable steps (>= 2)
--- does the R2 step set move?
cool c1 R2 [3, 5, 6, 11, 12, 16]
cool c2 R2 [3, 5, 6, 11, 12, 16]
warm w1 R2 [3, 5, 6, 11, 12, 16]
warm w2 R2 [3, 5, 6, 11, 12, 16]
cool c1 R2 set == warm w1 R2 set: NO MOVEMENT between those pairs
R5 sanity (8 Elite known-good PASS + fault-injected FAIL): STILL UNMET — inherited, not run here
```

- **R2 step set cool vs warm: identical.** `[3, 5, 6, 11, 12, 16]` in all four pairs, and no R1
  violation anywhere (top-1 agrees 32/32 in every pair). Because the warm arm was never actually warm
  (§7.3), this shows the step set is stable across ~1 h of thermal drift but says **nothing** about
  temperature dependence — that question is still open, not answered.
- **R4 is now MET for the S23 board**: `steps=32` on ≥2 same-turn pairs per condition. The n=1
  caveat of §4 is discharged for the cool condition.
- **R5 is still unmet**, inherited unchanged from the source cell and the registry: 8 Elite
  known-good must PASS and a fault-injected build must FAIL. Nothing in this cell runs either.
- **The headline result is unchanged and now better supported:** on the S23's own kernel, NPU vs GPU
  prefill fails the TF logit oracle with **R2 only, no R1**, at `max_dlogp` 0.7041 against the
  0.10 limit and `max_dp1` 0.1021 against 0.02, on four independent pairs in two conditions. The
  same shape as the source cell's SM8850 pair (0.5236 / 0.1075) and as the pre-registered
  expectation of FAIL R2 with high same-top (§4.5).

### 7.7 State left on the device

`restore.sh` exited 0. The read-back proving every key this cell touches is back:

```
ABSENT kalsa.bench.sampling / probs / toolchoice / governor_force / force_ids / npu_lane / route / thermo
SET kalsa.web.enabled=1
SET kalsa.tools.device=0
SET kalsa.tools.calendar=0
--- final state of every kalsa.bench.* / web / tools key
kalsa.bench.energy_trace=1
kalsa.bench.kvtranscript=1
kalsa.bench.nativelog=1
kalsa.tools.calendar=0
kalsa.tools.device=0
kalsa.web.enabled=1
```

Re-pulled straight off the device after relaunching the app and force-stopping it, so the restore is
shown to survive a real app start, not just the write:

```
integrity: ok      rows: 112      session rows: 25
kalsa.tools.calendar=0  kalsa.tools.device=0  kalsa.web.enabled=1
kalsa.governor.enabled=1  kalsa.locale=it  kalsa.model.id=lfm2.5-2.6b
kalsa.bench.energy_trace=1  kalsa.bench.kvtranscript=1  kalsa.bench.nativelog=1
```

No conversation was deleted. `kalsa.conversations.v1` grew from 28 859 bytes / 6 `conv-` ids in the
pre-run backup to 144 406 bytes / 29 ids, i.e. 23 conversations added: the 4 cool-group turns, the 9
sent turns of the killed first warm attempt (8 warm-up + `w1a`), the 6 of the re-run, and `Nuova chat`
screens opened without a send. The owner may delete them; the cell does not. The app is left on a
fresh `Nuova chat` screen with an empty composer — `raw/final-screen.png`, model `LFM2.5 2.6B`,
`Su questo telefono`, nothing typed and nothing sent. Screen timeout is still 1800000, as the driver
set it, matching §6 and the source cell.

## 8. What this did not verify

- **The warm condition was never actually produced** (§7.3). The 70 C NPU start gate cannot fire
  between turns on this rig, so w1/w2 are a second cool group and no temperature dependence has
  been measured. Making a real hot arm needs the heat to be held *through* the start of the measured
  turn — e.g. a sustained load running up to the send — not a gate that idles.
- **R5 sanity** (8 Elite PASS + fault-injected FAIL) is still unmet; inherited unchanged.
- **Long-prompt determinism is untested.** The measured turns are short-prompt; §7.5 shows free-running
  long generations stop at different step counts, so their first-32 comparability is unexamined.
- **Only one board.** R4 is met for the S23 only; the Elite half of R4/R5 is not run.
- **Unplugged behaviour untested**: every turn of this run was on AC.
- **The kill path is only half-exercised.** A stop rule fired correctly once (`c2b` attempt 1,
  battery 42.0 C) and attempt 2 passed, but that was a harness kill of the campaign *between* turns,
  not a mid-turn stop-rule kill.
- A cosmetic reporting bug in `campaign.sh:59` is left in place: the `peak_npu=` it prints takes the
  max over *every* `key=value` in the sample, so it reports the battery level (`peak_npu=100`) rather
  than the NPU peak. It changes no measurement — all peaks in §7.2 and §7.3 are recomputed from the
  monitor files with a key-guarded `awk` — so it was not fixed mid-run.
- The `Failed to write while dumping service activity: Broken pipe` lines during each cold launch are
  adb noise from the foreground check; `fg()` retried and the app did reach foreground (each turn
  logged its full governor line). Cosmetic, not investigated.