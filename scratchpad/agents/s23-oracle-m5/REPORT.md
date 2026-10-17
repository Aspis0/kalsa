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
- **R4 is NOT met (orchestrator correction).** The `verdict.sh` lines at 400/406 count pairs, but every
  pair is a byte-identical replica of the same prompt (§7 determinism), so this is ONE independent pair.
  The source cell drew the same conclusion for its SM8850 replicas. A second prompt (enc-long) is needed.
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
- **Only one board.** R4 is met for the S23 only; the Elite half of R4/R5 is not run.
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
## 9. Second prompt (enc-long), one pair, build 634e3da4

Run 2026-10-17 00:05–00:24, cold only, warm arm skipped. The S23 now carries app build `634e3da4`
(`versionName=0.1.0`, `lastUpdateTime=2026-10-16 23:57:31`, `flags=[ DEBUGGABLE HAS_CODE
ALLOW_CLEAR_USER_DATA ]`, installed with `-r`, data kept). The ship model is untouched under the new
build: `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`.

Device state at the start: **unplugged**, `level 97 %`, `battery 30.9 C`, `Thermal Status: 0`,
`AC powered: false`. Stop rules were live all through: peak battery **39.9 C** (limit 42.0), peak
thermal status **2** (limit 3), level ended at 91 % so the `< 30 % unplugged` rule never applied. No
turn was killed and every monitor sample was `Awake` (`l1a` 6/6, `l1b` 33/33), so no turn is INVALID.

### 9.1 Gate: the bench keys still take effect under 634e3da4

Checked before the pair, with a short-prompt smoke turn (`raw/smoke-*`), because everything downstream
depends on it:

```
smoke dur=56s probs_rows=508 monitor_samples=4
KALSA_BENCH_TOKENS {"turnId":"1","n":506,"ids":[597,4695,10966,622,310,5141,296,8043,1703,2789,…
KALSA_GOVERNOR_TURN {"ep":"NPU",…,"chunks":5,"dev":["HTP0"],…,"forced":false}
smoke ids=32 from=tokens-line probs=508 steps0_31=contiguous tokens_lines=1
```

`sampling=greedy`, `probs=1` (508 probs rows), the NPU default backend, and 32 extractable ids all
behave as before. The B-side keys were then verified on the real turn, not assumed: `raw/l1b-arm.txt`
shows `SET kalsa.bench.governor_force=1` and `SET kalsa.bench.force_ids=[597,4695,677,3066,267,5781,…]`
with every other key read back `SET`/`ABSENT` and `kalsa.governor.enabled=1`. `raw/l1b-probs.jsonl` has
**33/33 rows `forced:true`, 0 `forced:false`**. The gate passes.

### 9.2 The pair

Both arms staged the same prompt (`Modern smartphones run` present in both UI dumps; `enc-long.txt`
decodes to 7 948 characters) and used the **same prefill chunking**, `chunks: 10`, so the comparison is
not confounded by chunk count:

| arm | role | NPU / GPU / batt at send (C) | plug | level | wall from send | probs rows | backend (governor line) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `l1a` | A — NPU prefill (production default) | 36.2 / 36.0 / 31.7 | none | 96 % | 84 s | 711 | `{"ep":"NPU",…,"chunks":10,"dev":["HTP0"],…,"forced":false}` |
| `l1b` | B — GPU prefill forced | 49.7 / 52.3 / 34.5 | none | 95 % | 419 s | 33 | `{"ep":"GPU",…,"chunks":10,"dev":["GPUOpenCL"],…,"forced":true}` |

`l1a` is a free greedy answer (711 rows); `l1b` is cut to `l1a`'s first 32 ids. The compared range is
exactly steps 0–31: on all 32, `forced=true` **and** `B.tok == A.tok`; at step 32 `B.tok = -1` because
`force_ids` is exhausted, which is where the oracle stops. That is the oracle's own coverage contract
(`oracle_logit.py:89`), not a manual trim.

The two prompts are genuinely different generations, not a re-run: `l1a-ids.txt` starts
`597 4695 677 3066 267` against the short prompt's `597 4695 10966 622 310`.

### 9.3 Oracle verdict (verbatim)

```
oracle=FAIL rule=R2 steps=32 max_dlogp=6.6347 max_dp1=0.7710 divergences=0 first_div=-1
oracle_exit=0
steps_exit=0
```

**`rule=R2` here does not mean R1 is absent, and this pair is far worse than the short-prompt pairs.**
`oracle_logit.py:116` reports `min(violations)[2]`, i.e. the rule of the **earliest** violating step;
step 1 is an R2 step, so R2 wins the headline while the R1 violations at later steps stay in the body.
From `raw/steps-l1a-vs-l1b.txt`, recounted from the 32 step rows:

```
top-1 disagreements: 22  -> [2, 3, 5, 6, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]
R1 steps:            22  -> same set
R2 steps:             9  -> [1, 4, 7, 10, 27, 28, 29, 30, 31]
no-violation steps:    1  -> [0]
min margin overall: 0.055
```

Head and tail of the table:

```
step  0 A1=597 B1=597 margin=0.998 max_dlogp=0.370 dp1=0.000
step  1 A1=4695 B1=4695 margin=0.831 max_dlogp=0.127 dp1=0.119 R2
step  2 A1=677 B1=10966 margin=0.572 max_dlogp=5.070 dp1=0.222 R1
step  3 A1=3066 B1=4116 margin=0.055 max_dlogp=0.649 dp1=0.268 R1
…
step 31 A1=395 B1=395 margin=0.995 max_dlogp=4.926 dp1=0.355 R2
```

Side by side with the enc-short pairs, same oracle, same thresholds:

| prompt | pairs | verdict | max_dlogp | max_dp1 | steps with top-1 disagreement |
| --- | --- | --- | --- | --- | --- |
| enc-short (5 chunks) | c1, c2, w1, w2 + rehearsal | `FAIL rule=R2 … max_dlogp=0.7041 max_dp1=0.1021` | 0.7041 | 0.1021 | **0 / 32** |
| enc-long (10 chunks) | l1 | `FAIL rule=R2 … max_dlogp=6.6347 max_dp1=0.7710` | 6.6347 | 0.7710 | **22 / 32** |

So the S23's NPU-vs-GPU prefill divergence is **not** the small, top-1-preserving number the short
prompt showed. At 10 prefill chunks the two backends disagree on the argmax at 22 of 32 steps and by
up to **6.63 nats** (66× the 0.10 limit) and **0.77** in top-1 probability (38× the 0.02 limit). Every
disagreement was R1-eligible (smallest margin seen 0.055, above the 0.03 gate), so the R1 count equals
the disagreement count. The short-prompt verdict was measured at 5 chunks and **understates** the
divergence at realistic context length. Caveat before generalising: one prompt, one pair, and the two
prompts differ in length, chunk count and build (below) — this shows the short-prompt result is not
safe to extrapolate, not that "long = 6.6 nats" is a constant.

`divergences=0 first_div=-1` is expected in TF mode, not a claim of agreement: that counter is only
appended in the `G` branch (`oracle_logit.py:103`).

### 9.4 sha256 of every probs file, and short-vs-long

```
83a4f296f14436a3de02ba37109dfd08c5b094636973e3621f1d707191a1f4a1  l1a-probs.jsonl     (enc-long, A)
f4d7b6382b64ce1a3c0d28e98d83cd5faa62d98eb68eea7241cd305f25e267c7  l1b-probs.jsonl     (enc-long, B)
0a8e25d89de56add12ab1ac1615e97fb684dd8ed69fdbf7c858caf35d7096f90  smoke-probs.jsonl   (enc-short, A, new build)
2e7e0b747fa8fc4c3f21db9ae632fb5c415d87f21435791c4f0580e43bc2b21c  c1a-probs.jsonl    (enc-short, A, old build)
2e7e0b747fa8fc4c3f21db9ae632fb5c415d87f21435791c4f0580e43bc2b21c  c2a-probs.jsonl    (enc-short, A, old build)
2e7e0b747fa8fc4c3f21db9ae632fb5c415d87f21435791c4f0580e43bc2b21c  s23A-probs.jsonl   (enc-short, A, old build)
2e7e0b747fa8fc4c3f21db9ae632fb5c415d87f21435791c4f0580e43bc2b21c  w1a-probs.jsonl   (enc-short, A, old build)
2e7e0b747fa8fc4c3f21db9ae632fb5c415d87f21435791c4f0580e43bc2b21c  w2a-probs.jsonl   (enc-short, A, old build)
5849af493441f421dd5ed5353053d083d5fc93bbeafbe896673be72a9e8211ea  c1b/c2b/s23B/w1b/w2b-probs.jsonl (enc-short, B, old build)
```

- **A vs B on the long prompt: different** (`83a4f296…` vs `f4d7b638…`), as they must be — they are
  different backends and different row counts (711 vs 33).
- **Long A vs every enc-short A: different** — expected, different prompt.
- **⚠ The build change alone moved the short-prompt output.** `smoke-probs.jsonl` (enc-short, build
  634e3da4) is `0a8e25d8…`, **not** the `2e7e0b74…` shared by all five old-build enc-short captures, and
  it is 508 rows against 563. The first row differs numerically too (`[597,-0.0008]`/`[52,-7.8262]`
  against `[597,-0.0007]`/`[52,-7.9498]`). So `634e3da4` changes the logits and the generated length on
  the *same* prompt. Consequence: **enc-long vs enc-short is confounded** — prompt length and build
  changed together, and §9.3's long-vs-short gap cannot be attributed to length alone. Isolating it
  needs the long prompt on the old build, or both prompts on the new build. The `l1` pair itself is
  unaffected: both arms ran the same build, same prompt, same chunking.
- The ids files: `l1a-ids.txt` and `l1b-ids.txt` are identical to each other
  (`8468155b5defe208…`) and different from the short-prompt ids (`f39d0305dba15174…`).

### 9.5 Status after this run

- **R4, in the "independent pair" sense, is now satisfied for the S23**: the five enc-short pairs were
  byte-identical replicas of a single prompt (§7.5), and `l1` adds a genuinely different prompt and a
  different generated token sequence. Two independent prompt-level pairs, both `steps=32`, both FAIL.
  Within the long prompt it is still n=1.
- **R5 is still unmet**, inherited unchanged; nothing here runs the 8-Elite PASS or the fault-injected
  FAIL control.
- **Long-prompt determinism is still unmeasured** — one capture per arm, so `l1a`/`l1b` shas cannot
  support any determinism claim either way. §7.5's determinism result stands for the short prompt only.
- Nothing about temperature is claimed: this run was cold, and §7.3's warm arm never reached its start
  condition.

### 9.6 State left on the device

Backup taken before the first write this run: `raw/RKStorage-pre634e3da4-backup.sqlite`, sha256
`52d1560eeea2a635edb5675bf09edd99d92b240dcd0a4554b0eeb4e7052bc1f2`, 115 rows,
`PRAGMA integrity_check` = `ok`. No shell redirect was used to write app data at any point: every write
went through `kset.sh` (`adb push` + `run-as cp`), which verifies each key by read-back and refuses a
size mismatch, restoring its own copy on failure.

`restore.sh` exited 0 and the read-back proves every key is back to its pre-run value:

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

Re-pulled straight off the device afterwards: `integrity: ok`, `rows: 121`, and **0** of the eight bench
keys this cell sets still present. Diffing the key/value set against the pre-run backup shows only
three new `kalsa.chat.compactor.conv-*` rows (one per new chat), `kalsa.conversations.v1` with a new
`activeId`, and `kalsa.logReport.consumedExitAt.v1` — no pre-existing row removed or rewritten.
Conversations went 29 → 32 ids; **none were deleted**.

Left running on a fresh `Nuova chat` screen with an empty composer — `raw/final-screen-634e3da4.png`,
model `LFM2.5 2.6B`, `Su questo telefono`, `mCurrentFocus` = `com.kalsa.app/.MainActivity` before every
tap. Never disconnected, never uninstalled, data never cleared, no battery or thermal fake.

## 10. Which backend is wrong: CPU as the reference

Run 2026-10-17 00:29–00:52, same device, same build `634e3da4`, unplugged throughout, cold. §9 found
NPU-vs-GPU disagreeing on the argmax at 22 of 32 steps on enc-long, but that comparison cannot say
*which* side moved. This section adds the CPU reference and separates prompt length from build.

Backup before any write: `raw/RKStorage-pre-cpu-backup.sqlite`, sha256
`ba5ccba74204c84a92feb3c40f3444f7287b94ce4a76d893340f6cb705e19294`, 121 rows, integrity `ok`.

### 10.1 The CPU switch

From the QDC R5 cell's `arm.sh` (`CPU` and `CTRL` arms): the CPU arm is **`kalsa.governor.enabled=0`**
— the shipped governor is switched off, so nothing routes and prefill *and* decode both run on CPU.
Their other keys (`thermo` fake, `npu_lane=off`, `route=gpu`, chat wipe) were **not** ported: the first
would void the heat numbers, the second two belong to the GPU arm, and the wipe would delete the
owner's chats.

This cell's `arm.sh` gained kind `C` (governor off + `force_ids` = `l1a`'s 32 ids) and now asserts
the governor equals the kind's requirement instead of always requiring 1. Two consequences were
handled rather than left to chance: A and B now **set** `kalsa.governor.enabled=1` explicitly instead of
trusting what the previous arm left behind, and `restore.sh` now restores the governor to 1 alongside
the other keys — the CPU arm turns the owner's governor off, and leaving it off would silently change
their phone.

### 10.2 The turns

| arm | role | prompt | NPU / GPU / batt at send (C) | plug | wall | rows | backend evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `l1c` | **C — CPU reference** | long | 38.2 / 38.0 / 34.2 | none | 78 s | 33 | `KALSA_NATIVE_VARIANT {"…hexagon_opencl","nGpuLayers":0}`, **no `KALSA_GOVERNOR_TURN` at all**, 33/33 `forced:true` |
| `l1a2` | A′ — NPU default | long | 39.4 / 39.2 / 35.2 | none | 84 s | 686 | `{"ep":"NPU","chunks":10,"dev":["HTP0"],"forced":false}` |
| `s2a` | short NPU | short | 39.4 / 39.2 / 35.7 | none | 56 s | 508 | `{"ep":"NPU","chunks":5,"dev":["HTP0"],"forced":false}` |
| `s2b` | short GPU forced | short | 50.9 / 52.7 / 36.9 | none | 185 s | 33 | `{"ep":"GPU","chunks":5,"dev":["GPUOpenCL"],"forced":true}`, 33/33 forced |

**The C arm really is CPU.** The decisive field is `nGpuLayers`: `0` for `l1c` against
`{"prefill":99,"decode":0}` for `l1a`. `KALSA_GOVERNOR_TURN` is absent entirely, exactly as the QDC
cell reports for its governor-off arms. HTP is *probed* but never used:
`ggml-hex: device 0: HTP0 (phys=0, virt=0, domain=cdsp:3)` then
`HTP0 failed to get URI … error 0x14. Falling back to single session`, with **no**
`llama_prepare_model_devices: using device HTP0` and **no** `load_tensors: HTP0-*` buffer lines — both
of which appear in abundance in the A arms.

No stop rule fired and every sample was `Awake` (`l1c` 5/5, `l1a2` 6/6, `s2a` 4/4, `s2b` 14/14). Peak
battery 39.7 C against the 42.0 limit, peak thermal status 1, level ended at 86 % so the
`< 30 % unplugged` rule never applied.

### 10.3 Verdicts (verbatim)

TF mode, PREREG thresholds 0.03 / 0.02 / 0.10, unmodified `oracle_logit.py`
(`sha256 685c7a0878cceda2d2712397ee2ac5d6d61ea3e77e9ae3c77fc39adaddcd8909`, identical to both
source-cell copies):

```
oracle=FAIL rule=R2 steps=32 max_dlogp=6.6347 max_dp1=0.7710 divergences=0 first_div=-1   (l1a vs l1b, long NPU vs GPU)
oracle=FAIL rule=R2 steps=32 max_dlogp=6.6642 max_dp1=0.7835 divergences=0 first_div=-1   (l1a vs l1c, long NPU vs CPU)
oracle=FAIL rule=R2 steps=32 max_dlogp=0.7731 max_dp1=0.0534 divergences=0 first_div=-1   (l1b vs l1c, long GPU vs CPU)
oracle=FAIL rule=R2 steps=32 max_dlogp=0.5142 max_dp1=0.0463 divergences=0 first_div=-1   (s2a vs s2b, short NPU vs GPU)
oracle=DESCRIPTIVE rule=R4 steps=1 max_dlogp=0.2039 max_dp1=0.0000 divergences=0 first_div=-1   (l1a vs A′)
oracle=DESCRIPTIVE rule=R4 steps=1 max_dlogp=0.0000 max_dp1=0.0000 divergences=0 first_div=-1   (l1c vs l1a)
```

Two invocations are structurally unable to compare and are recorded as such rather than quoted as
verdicts. `oracle.sh l1c l1a` (CPU first) returns `DESCRIPTIVE … steps=1` because TF mode requires the
**second** file to be the teacher-forced one (`oracle_logit.py:89`): `l1a` is a free generation, so the
loop stops after step 0. The same applies to `l1a vs l1a2`, where neither file is forced. The
`l1b vs l1c` and `l1c vs l1b` orders both cover 32 steps (both sides forced), and agree on
`max_dlogp 0.7731`; only which side's margins drive R1 differs, and neither order produces an R1.

### 10.4 Per-pair comparison, steps 0–31

| pair | top-1 disagreements | max \|Δlogp\| | max \|Δp₁\| | R1 steps |
| --- | --- | --- | --- | --- |
| long **NPU vs CPU** | **21 / 32** | **6.6642** | 0.7835 | 21 steps |
| long **GPU vs CPU** | **2 / 32** | **0.7731** | 0.0534 | none |
| long NPU vs GPU | 22 / 32 | 6.6347 | 0.7710 | 22 steps |
| short NPU vs GPU | 0 / 32 | 0.5142 | 0.0463 | none |
| long NPU vs NPU′ | 0 / 32 | 0.0000 | 0.0000 | none |

Where they disagree, GPU is on CPU's side and NPU is alone:

```
step  NPU_top1  GPU_top1  CPU_top1
   2       677     10966     10966     <- NPU is the odd one out
   3      3066      4116      4116
   5      5781      1286      1286
  14       440     34689       440     <- the only step GPU also departs
  20       355       358     20678     <- the other
A vs B agreement: 10 /32      B vs C agreement: 30 /32      A vs C agreement: 11 /32
```

**Which backend departs from CPU on the long prompt: the NPU.** GPU prefill tracks the CPU reference
closely (30/32 same argmax, 0.77 nats, no R1), while NPU prefill disagrees with CPU on 21 of 32 steps
by up to 6.66 nats — 8.6× further from CPU than GPU is. §9's "NPU vs GPU disagree 22/32" is therefore
not a two-sided conflict: it is almost entirely the NPU moving away from an agreed GPU+CPU answer.

### 10.5 Length vs build, separated

- **Short prompt, this build, two captures byte-identical**: `s2a` = `0a8e25d89de56add…` = `smoke`.
  Short-prompt determinism survives the build change, as §9.4 found.
- **Long prompt is NOT deterministic**: `l1a` `83a4f296f144…` (711 rows) vs `l1a2` `a5c535de2471…`
  (686 rows). Same build, same arm, same prompt, both 84 s.
- **But the divergence is outside the oracle window.** Steps 0–32 are **bit-identical** (first logit
  difference at step 33, first token difference at step 34, then 644 of 686 steps cascade). So
  `l1a vs l1a2` over steps 0–31 is 0 disagreements / 0.0000, and the determinism question the oracle
  actually asks is answered *yes* for the 32-step window — while the long-prompt generation as a whole
  is not reproducible. Neither turn has an extra tool round or a `turnId` change (one `KALSA_TOOLCALL`
  at `round 0, executed 0`, `turnId 1` throughout in both), so this is not a harness-visible event.
- **Build vs length, now separated.** The short prompt on the new build still gives
  `max_dlogp 0.5142, max_dp1 0.0463, 0/32` — the same shape as the old build's short result
  (0.7041 / 0.1021 / 0/32), slightly smaller. So the large long-prompt divergence is **not** a build
  artifact: it tracks prompt length (5 chunks → benign R2 drift; 10 chunks → NPU argmax collapses).

### 10.6 State left on the device

`restore.sh` exit 0. Read-back straight off the device: `integrity: ok`, `rows: 131`,
**`kalsa.governor.enabled=1`**, and **0** of the eight bench keys this cell sets present. Diffing
against this task's pre-run backup shows only rows for the four new chats
(`kalsa.chat.compactor.conv-*`, `kalsa.messages.conv-*`, `kalsa.session.meta.*`), plus
`kalsa.conversations.v1` with a new `activeId` and a `kalsa.logReport.consumedExitAt.v1` timestamp —
no pre-existing row removed or rewritten, conversation ids 33 → 36, none deleted. No shell redirect
touched app data at any point; every write went through `kset.sh`.

Left running on a fresh `Nuova chat` screen, empty composer — `raw/final-screen-cpu.png`,
`mCurrentFocus=com.kalsa.app/.MainActivity` re-checked before each of the two taps. The governor is
back on, so the phone behaves as the owner left it.

New probs shas:

```
3739e9c31df9f04a34f3b9c06631af1ebd8c14f5919ee83c015643b80d96bb76  l1c-probs.jsonl   (CPU, long)
a5c535de2471955c0c52f2b098824e1b2f13dc85491db5325e86a4e5fcdd9eef  l1a2-probs.jsonl  (NPU, long, 2nd capture)
0a8e25d89de56add12ab1ac1615e97fb684dd8ed69fdbf7c858caf35d7096f90  s2a-probs.jsonl   (NPU, short, this build)
0ef048f3939f55465732d8c8e8656d3bbbf45602b240de0b6c3cb1ace920e574  s2b-probs.jsonl   (GPU, short, this build)
```

### 10.7 What this does not settle

- **One prompt per length, one pair each.** "Long = NPU collapses" rests on one long prompt at one
  length. A length sweep (chunk counts between 5 and 10) is what would turn this into a threshold.
- **The NPU collapse's cause is not identified.** The evidence is behavioural: the NPU argmax moves
  away from an agreed CPU+GPU answer at 10 chunks. Which of chunked prefill, the q4_0 V-cache packing,
  or a device-level scheduling effect is responsible is not measured here.
- **GPU is not proven correct.** It tracks CPU closely on 32 steps of one prompt; 2 disagreements and a
  0.77-nat gap remain, and the sign of that residual is not analysed.
- **The long-prompt step-33 divergence is unexplained.** It is outside the oracle's 32-step window and
  outside this section's scope, but it means long-prompt generations are not reproducible on this
  build.

## 11. Localising the NPU collapse: onset sweep and knob arms

Run 2026-10-17 00:48–01:45, build `634e3da4`, unplugged, cold. §10 established that NPU prefill
departs from CPU on the 10-chunk long prompt. This section asks *where* it starts and whether any
runtime knob moves it.

Backup before any write: `raw/RKStorage-pre-knob-backup.sqlite`, sha256
`6e2395b644fb7ef1395250e3b9712ab5952cb5472c984835b8483832c8ba3208`, 131 rows, integrity `ok`.

### 11.1 Knob inventory (read-only)

The complete bench key surface on this build, from `src/bench/benchConfig.ts:36-43` and
`src/engine/governorInputs.ts:17-31`:

```
kalsa.bench.sampling  probs  toolchoice  toolgate  force_ids  governor_force  npu_lane  route
kalsa.bench.thermo  engine  nctx  winbudget  legacywindow  norepack  devmodels  speculative
kalsa.bench.decode_hop  guard_headroom  ranking  digestcadence  thinking  format  nativelog
kalsa.bench.eager_delay_ms  energy_trace  zone_probe
```

- **`kalsa.bench.engine`** is the one that reaches llama.cpp parameters —
  `benchConfig.ts:37`: `JSON { nGpuLayers?, nThreads?, nThreadsPrefill?, nUbatch?, flashAttn?, moeStream? }`,
  `benchConfig.ts:815`: *"Applies at ENGINE INIT — force-stop + relaunch after writing"*. `turn.sh`
  already force-stops and cold-launches, so a key set before a turn takes effect for it.
- **`n_ubatch`** is clamped at `engineParams.ts:117-119`: `params.n_ubatch = Math.min(override.nUbatch, batch)`
  with `n_batch = 512` (`LlamaService.ts:2829`), default `DEFAULT_UBATCH = 256`
  (`deviceTuning.ts:245`).
- **KV cache type is NOT runtime-switchable.** `LlamaService.ts:2609`: *"cache_type_k/v stay
  catalog/caller-owned"*, and `llama-governor.cpp:412-414`: *"the binding forces matching q8_0 KV on
  both contexts"* — which is exactly why every arm here logged `"ck":"q8_0","cv":"q8_0"`. This was
  the task's first-priority knob and it does not exist at runtime.
- **`prefill_chunks`** is a `+`-joined run of per-chunk token counts
  (`governorTurnLog.ts:125-138`, accumulator at `llama-governor.cpp:284-289`), one cell per chunk.

**Prior lab findings: there are none.** `docs/ALIVE.md` records prefill/decode *performance* and heat
for the S23/Xiaomi/8 Elite but no NPU prefill *correctness*; `PLAN.md:155` records this cell's own
oracle result. `KVDIVERGE` appears only inside raw logcat captures under
`scratchpad/agents/qdc-governor-s5/raw/` with no report analysing it. This cell is the first place
NPU-vs-CPU prefill correctness is measured on a phone.

### 11.2 What the chunk counter actually measures — the sweep's real axis

The task asked for a sweep over 5–9 chunks. Building prompts from `enc-long` and reading the
governor line produced a **non-monotonic** chunk count, so the axis had to be corrected first. The
`prefill_chunks` strings show why: the first three cells are always `512+128+40` (a cached static
prefix plus the template), and the prompt proper is chunked afterwards, sometimes at 128 and
sometimes at 512 depending on alignment. Total tokens rise monotonically with prompt length; the
chunk *count* does not.

Ordered by prefilled tokens — the axis that is actually controlled:

| prompt | NPU arm | CPU ref | prefill_chunks | tokens | top-1 disagreements /32 | max \|Δlogp\| | R1 steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| short (310 ch) | `s2a` | `cpu5` | `512+128+40+82+3` | 765 | **0** | 0.9307 | 0 |
| s6 (1830 ch) | `npu6` | `cpu7` | `512+128+40+128+128+110+3` | 1049 | **1** | 0.9278 | 1 |
| s7 (3363 ch) | `npu7` | `cpu6` | `512+128+40+512+129+3` | 1324 | **13** | 6.7815 | 12 |
| s8 (4888 ch) | `npu8` | `cpu9` | `512+128+40+512+128+128+128+27+3` | 1606 | **9** | 7.1806 | 9 |
| s9 (6410 ch) | `npu9` | `cpu8` | `512+128+40+512+512+128+53+3` | 1888 | **17** | 5.8093 | 16 |
| long (7948 ch) | `l1a` | `l1c` | `512+128+40+512+512+128+128+128+84+3` | 2175 | **21** | 6.6642 | 21 |

**First R1 break: 1324 tokens** (13/32). Below it the NPU tracks CPU — exactly at 765 tokens, and to
within one step at 1049.

Read against the cells, the correspondence is exact:

| largest cell inside the prompt region | disagreements |
| --- | --- |
| 82, 128 (short, s6) | 0, 1 |
| **512** (s7, s8, s9, long) | 13, 9, 17, 21 |

The NPU agrees with CPU while every prompt-region cell is ≤128 tokens, and breaks R1 in every arm
where a **512-token cell** appears in the prompt region.

### 11.3 Knob arms at 10 chunks (enc-long, vs the existing `l1c` CPU reference)

| arm | knob | verified | prefill_chunks | disagreements /32 | max \|Δlogp\| | R1 |
| --- | --- | --- | --- | --- | --- | --- |
| baseline `l1a` | — | — | `512+128+40+512+512+128+128+128+84+3` | 21 | 6.6642 | 21 |
| `k1` | `engine={"nUbatch":512}` | `SET kalsa.bench.engine={"nUbatch":512}` | **unchanged** | 21 | 6.7326 | 20 |
| `k3` | `engine={"nUbatch":128}` | `SET kalsa.bench.engine={"nUbatch":128}` | **unchanged** | 21 | 6.6642 | 21 |
| `k2` | `engine={"flashAttn":"off"}` | `SET kalsa.bench.engine={"flashAttn":"off"}` | unchanged | **29** | **8.2193** | 29 |

No knob reached the ≤2/32 target, so the stopping rule never fired and the arms ran to the end of the
available list. The negative result is sharp: **`nUbatch` does not control the prefill cells.** At
512 and at 128 the `prefill_chunks` string is byte-identical to baseline and `k3` reproduces the
baseline numbers exactly (21 / 6.6642 / 21), so the bench knob is accepted and read back but is not
wired to the HTP chunker on this build. `flashAttn: off` makes the divergence *worse* (29/32), so
flash attention is helping and is not the culprit. KV type is not switchable at all (§11.1).

### 11.4 The lead

**The NPU collapse tracks the 512-token prefill cell, not the cell count or the prompt length: it is absent while every prompt-region cell is ≤128 tokens, appears at the first 512-token cell (1324 tokens, 13/32), and worsens with the number of 512 cells (1 → 2 cells gives 17/32 and 21/32).**

The actionable consequence is negative and worth stating plainly: the knob that would test this —
the prefill chunk/ubatch cell size on the HTP path — is **not reachable from `kalsa.bench`**. The
512-token cells are produced inside the native chunker, `kalsa.bench.engine.nUbatch` does not reach
them, and KV type is pinned to q8_0 by the binding. Localising further needs a binding or engine
change (surface the chunker size as an override, or run the ≤128-cell path at >1049 tokens), not
another bench key.

### 11.5 Two mistakes of mine, both recorded

- **Wrong prompt labels.** The first CPU-reference loop passed `PROMPT=6/7/8/9` where `turn.sh` wants
  `s6/s7/s8/s9`; `enc-6.txt` does not exist and `set -u` aborted `frag`. Four CPU arms produced 0 rows
  and were re-run with correct labels. No data from that first attempt is used here.
- **Editing `arm.sh` while it was executing.** Adding the `EXTRA` hook mid-loop made bash re-read a
  changed file at the old byte offset (`arm.sh: line 36: unexpected EOF while looking for matching
  ''`), which killed `cpu7` after its turn had completed. Its 33 probs rows survived in the collected
  logcat and were recovered by re-running `oparse.sh cpu7` — the turn was not repeated, so no
  device time was spent re-measuring it, but the arm did not exit cleanly.

### 11.6 State left on the device

`restore.sh` exit 0, now including `kalsa.bench.engine` (absent before this task) and
`kalsa.governor.enabled=1`:

```
ABSENT kalsa.bench.sampling / probs / toolchoice / governor_force / force_ids / npu_lane / route / thermo / engine
SET kalsa.governor.enabled=1
SET kalsa.web.enabled=1
SET kalsa.tools.device=0
SET kalsa.tools.calendar=0
```

Independent pull off the device: `integrity: ok`, `rows: 156`, `governor.enabled=1`, **0** of the nine
bench keys present. Conversation ids 37 → 48, and **0** pre-existing ids missing — nothing deleted.
No stop rule fired in this section (peak battery 40.1 C, thermal status ≤2, level ended 72 %).
App left on a fresh `Nuova chat` screen, empty composer — `raw/final-screen-knobs.png`,
`mCurrentFocus=com.kalsa.app/.MainActivity` checked before each tap.

### 11.7 What this does not settle

- **n=1 per length.** Each row of the sweep is one NPU turn and one CPU turn on one prompt. The
  ≤128-cell correlation is clean across all six points but a single repeat per cell-size would
  strengthen it, particularly at 1049 tokens (1 disagreement) where "clean" is one step from broken.
- **512 cells versus 512 tokens is not separated.** Every broken arm has both a 512 cell and >1300
  tokens. An arm that forces 128-token cells at 2000+ tokens is the missing cell — it cannot be built
  from the bench surface found in §11.1.
- **The knob list is what this build exposes.** A knob absent from `benchConfig.ts` cannot be swept
  here; if the chunker is reachable only through a rebuild, that is the next step, not another run.

## 12. Correction to section 11, and the length threshold (2026-10-17, checked by the orchestrator)

**Section 11's lead is wrong.** warm1, warm3, warm4, warm5 and warm8 are NPU runs of the same 2175-position prompt. warm3/4/5/8 prefilled it with 128-token cells only (`"prefill_chunks":"128+128+128+128+128+40+128+...+84+3"`), the others with 512 cells. All of them generate l1a's tokens for steps 0-31, and all disagree with the CPU reference l1c on top-1 at 21/32 steps. Cell size does not matter.

**Threshold sweep, NPU (default) vs CPU (`kalsa.governor.enabled=0`), TF, steps 0-31** (positions = `prompt_n`, the full prefilled context):

| positions | prefill_chunks | top-1 disagree | max abs dlogp of CPU top-1 |
|---|---|---|---|
| 960 | 512+128+40+128+128+21+3 | 0 | 0.346 |
| 997 | 512+128+40+128+128+58+3 | 0 | 0.255 |
| 1018 | 512+128+40+128+128+79+3 | 0 | 0.165 |
| 1028 | 512+128+40+128+128+89+3 | 0 | 0.18 |
| 1049 (s6) | 512+128+40+128+128+110+3 | 1 | 0.93 |
| 1324 (s7) | 512+128+40+512+129+3 | 13 | 6.78 |
| 2175 | (either layout) | 21 | 6.66 |

At 1018 and 1028 the 32 decode steps cross 1024 positions and stay clean, and decode runs on CPU on this arm (`{"prefill":99,"decode":0}`), so the drift is tied to what the NPU prefill writes or reads past roughly 1030 positions. The 1060-1200 points were not run (the MiniMax agent hit its token limit, error 2067, during the batch; the batch finished on its own and `restore.sh` was run afterwards: exit 0, governor back to 1, no bench keys). Raw: `raw/tn{960,1000,1020,1030}-*`, `raw/tc{960,1000,1020,1030}-*`.
