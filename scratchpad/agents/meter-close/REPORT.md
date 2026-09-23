# Meter close — cell report (Jelly Star, 2026-09-21)

Scope: get the app's energy trace (`kalsa.bench.energy_trace`) to cover a turn that
COMPLETES on the Jelly Star, and answer whether the long prefill stall is the engine or
the phone. Build and device state below are as of the end of this cell.

Device: Jelly Star `192.168.1.82:5555`. Discharging throughout (AC/USB/Wireless false,
level 74 % → 54 %, battery 30.0 °C → 33.0 °C). No benchmark, no `--keepawake`
(`settings get system screen_off_timeout` = 7200000, read only, never changed).

---

## (a) The build

* Installed path on the Jelly right now:
  `/data/app/~~DeXzzJqpOSg2v2XKyM9rZg==/com.kalsa.app-UxC0xITqI0kpPL-dayUwRA==/base.apk`
* sha256 of the installed `base.apk` (streamed with `exec-out cat | shasum -a 256`,
  verified twice — before and after the ladder):
  **`d56abe5f87cd352ad2e4f826203d1060be3fa8aa93e07c6a950606f51f3f1342`**
  = `/Users/marco/kalsa-local-artifacts/s23-repack-timing-app-release.apk`
  = branch `app-integration-2026-09-20` tip `6a58ef5` (Meter commit) on top of `96eb9d9`
  (engine pin `kalsa.rn#0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2` = engine `4ccef2f85`).
  versionCode 1, versionName 0.1.0, debuggable.
* **Step C (Meter + OLD pin `llama.rn#0f313bab...`) was NEVER built and therefore never
  tested.** Reason: Step B (below) showed the known-good old-pin build stalling with the
  identical marker sequence, so the engine pin was no longer a live variable and the
  ~1 h build would have tested a dead hypothesis. Nothing binary for Step C exists on
  disk or on the device.
* Step B used the recovered known-good APK, pulled read-only from the S23:
  `/Users/marco/kalsa-local-artifacts/POLICY-OLD-pulled.apk`,
  sha256 **`245c514c32f46acc8b04a9ceb5576d9507a64b614f6b8aa1b314f95bbbcfff3c`** (159 214 430 B)
  = commit `964dd53`, engine pin `llama.rn#0f313bab464ef28a58a8b4b2a37a5d4c1968b54e`.
  It was installed on the Jelly with `adb install -r` for Step B and then replaced by the
  Meter build above (`adb install -r`; no uninstall, no data clear, at any point).

### Step B (the A/B that was actually run) — RESULT

Old build `245c514c`, same harness, turn inside the pre-existing warm conversation:

```
12:00:34.922 KALSA_SEND {"activeModel":"lfm2.5-2.6b"}
12:00:35.267 KALSA_PREFIX_FALLBACK {"tokens":2800,"reason":"measurement_not_persisted"}
12:00:35.410 KALSA_WINDOW {"kvHeld":false,"nPast":null,...,"textEst":8242}
12:01:02.162 KALSA_PREFIX_MEASURED {"tokens":2147} / KALSA_PREWARM op done promptMs=73195.556
12:01:02.309 KALSA_THINKING {"turnId":"1","budget":512,"decodeTokPerSec":null,"forceShort":true,"contextMode":"ciswire"}
~24 min, zero tokens -> Decoding Interrupted
persisted assistant text: "⚠️ La risposta non è iniziata entro 1355 s. ..."
```

The OLD pin stalls exactly where the new one does. **The regression is not the engine pin.**

---

## (b) The ladder — one send per rung, same build, same conversation

Conversation used for every rung: a **minimal 2-message fixture** written through the
repo's own `sql_write` helper (see the cleanup section for its exact keys), so that a turn
could be sent *inside a real chat* with a small context. The app renders an empty
conversation as the home page (`Buon pomeriggio.` / `Cosa vuoi approfondire oggi?`) and a
send from that state produces `KALSA_SEND` + `KALSA_SESSION {"reason":"kv_not_chat"}` and
NO turn — that path was hit once and is not part of the ladder below.

| rung | prompt chars | app textEst | prompt_n | tokensCached | tokensEvaluated | tokensPredicted | promptMs | predicted/s | answer | CSV | rows | span s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 `2+2` | 3 | 14 | 34 | 2230 | 2181 | 48 | 2 343.18 | 6.680 | **yes** (`4`) | 1790009150962-t1.csv | 24 | 23.2 |
| 1a sentence | 41 | 116 | 84 | 2384 | 2264 | 119 | 4 323.40 | 6.556 | **yes** | 1790009259536-t2.csv | 23 | 22.2 |
| 1b paragraph | 70 | 303 | 33 | 3279 | 2417 | 861 | 2 257.86 | 5.983 | **yes** (1 296 chars) | 1790009308944-t3.csv | 146 | 146.4 |
| 2a ~500 tok in | 2 074 | 1 968 | 1 488 | 4034 | 3872 | 161 | 108 413.59 | 3.878 | **yes** | 1790009504906-t4.csv | 149 | 150.1 |
| 2b ~2 000 tok in | 8 074 | 3 507 | 2 294 | 6470 | 6328 | 141 | 312 819.95 | 2.781 | **yes** | 1790009731571-t5.csv | 360 | 363.9 |
| 2c ~8 000 tok in | 32 074 | — | — | — | — | — | — | — | **NO** — never delivered | none | — | — |
| **2c2 ~4 000 tok in** | 16 074 | 5 031 | — | — | — | — | — | — | **NO — first failing rung** | none | — | — |

Per-rung markers (persistent logcat capture, `ReactNativeJS`):

| rung | turnId | `KALSA_THINKING` | `KALSA_TELEMETRY` | interrupted | contextFull | truncated |
|---|---|---|---|---|---|---|
| 0 | 1 | 12:45:50.960 | 12:46:00.709 | false | false | false |
| 1a | 2 | 12:47:39.533 | 12:48:02.217 | false | false | false |
| 1b | 3 | 12:48:28.942 | 12:50:55.407 | false | false | false |
| 2a | 4 | 12:51:44.903 | 12:54:15.201 | false | false | false |
| 2b | 5 | 12:55:31.567 | 13:01:35.547 | false | false | false |
| 2c2 | (6) | **never emitted** | never emitted | — | — | — |

Raw telemetry lines (verbatim, one per successful rung):

```
t1 KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":2230,"tokensEvaluated":2181,"tokensPredicted":48,"draftTokens":0,"draftAccepted":0,"promptMs":2343.182,"predictedMs":7186.008,"predictedPerSecond":6.6796,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":34,"ciswireFlags":1}
t2 KALSA_TELEMETRY {"turnId":"2","round":0,"tokensCached":2384,"tokensEvaluated":2264,"tokensPredicted":119,"promptMs":4323.401,"predictedMs":18152.205,"predictedPerSecond":6.5557,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":84,"ciswireFlags":1}
t3 KALSA_TELEMETRY {"turnId":"3","round":0,"tokensCached":3279,"tokensEvaluated":2417,"tokensPredicted":861,"promptMs":2257.863,"predictedMs":143912.15,"predictedPerSecond":5.9828,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":33,"ciswireFlags":1}
t4 KALSA_TELEMETRY {"turnId":"4","round":0,"tokensCached":4034,"tokensEvaluated":3872,"tokensPredicted":161,"promptMs":108413.593,"predictedMs":41519.692,"predictedPerSecond":3.8777,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":1488,"ciswireFlags":1}
t5 KALSA_TELEMETRY {"turnId":"5","round":0,"tokensCached":6470,"tokensEvaluated":6328,"tokensPredicted":141,"promptMs":312819.948,"predictedMs":50702.125,"predictedPerSecond":2.7809,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":2294,"ciswireFlags":1}
```

### Rung 2c (32 074 chars) — not a model result
The share harness could not deliver the prompt at all: after ~10 min of retries the
composer stayed empty (`EditText` absent), **no `KALSA_SEND` was ever emitted**, no CSV.
This is a harness/URI size limit, not a model or engine result.

### Rung 2c2 (16 074 chars, ~4 k tokens) — FIRST FAILING RUNG
* Delivery succeeded (`[ci] share-send: submitted prev=6 count=7`), turn started:
  `KALSA_WINDOW {"kvHeld":true,"nPast":6470,"lastSaveTokens":6470,"loadedB":0,"hasDigest":false,"legacyWindowStart":0,"textEst":5031}` at **13:23:02.412**.
* **No `KALSA_THINKING`, no `KALSA_TELEMETRY`, no `KALSA_STALL`, no t6 CSV.** Waited ~10 min
  after the send; the app went idle (71 jiffies/5 s ≈ 0.15 core) and the engine was
  disposed (`Tocca per ricaricare`).
* The turn persisted one assistant message instead of an answer:
  `⚠️ Cannot read property 'thinkingText' of undefined`, and the UI showed
  `Generazione interrotta.`
* So the first failing rung fails **before generation starts**, with an app-level exception
  — not with the slow-prefill/`reason:"prefill"` shape of the original stall.

---

## (c) The Meter proof — rung 0 (turn 1), the completing turn

* File: `files/energy/1790009150962-t1.csv` (name = `<wall_clock_ms>-t<turnId>`), created
  while the rung-0 turn was in flight, pulled with
  `adb shell run-as com.kalsa.app cat files/energy/1790009150962-t1.csv`.
* Schema line (v2), verbatim:
  `# schema=kalsa-governor-battery-trace-v2; t_s=SystemClock.elapsedRealtime()/1000; voltage_mV=BatteryManager.EXTRA_VOLTAGE, millivolts; current_uA=property-documented unit, calibrate per device; INVALID=invalid reading`
* 9 columns:
  `t_s,elapsed_realtime_ms,wall_clock_ms,current_uA,charge_counter_uAh,voltage_mV,current_status,charge_counter_status,voltage_status`
* **24 data rows**, 1 Hz, span **23.2 s**: first row `wall_clock_ms 1790009150964` = **+80 ms
  after `KALSA_SEND`** (12:45:50.884); last row `1790009174202` = after
  `KALSA_TELEMETRY` (12:46:00.709) + turn cleanup.
* `voltage_mV` **3815 … 3922**; `current_uA` min **-1 121 000**, median **-1 045 000**,
  max **-260 000** (discharge throughout); `charge_counter_uAh` **1 590 840** (constant);
  status triplet **`ok,ok,ok` on every row** (no INVALID / unsupported / error).
* Platform cross-check, one `adb shell` invocation printing the CSV tail next to the
  platform in the same shell:

```
--- CSV tail
1057920.936,1057920936,1790009173192,-1056000,1590840,3815,ok,ok,ok
1057921.946,1057921946,1790009174202,-1120000,1590840,3815,ok,ok,ok
--- dumpsys battery
  AC powered: false / USB powered: false / Wireless powered: false / status: 3
  level: 54   voltage: 3815   temperature: 330
--- sysfs
-1153000          (current_now)
1590840           (charge_counter)
3815000           (voltage_now, µV)
```

  `voltage_mV 3815` = `dumpsys battery voltage 3815` = `voltage_now 3815000` µV;
  `charge_counter_uAh 1590840` = sysfs `charge_counter 1590840` exactly;
  `current_uA -1056000` vs live `current_now -1153000` (~1 s apart, same sign/magnitude).

* The trace also brackets the other completed rungs (CSV `span s` vs the telemetry's
  `(promptMs + predictedMs)/1000`): t4 **150.1 s** vs 150.0 s; t5 **363.9 s** vs 363.5 s.

---

## (d) Prefill: today against the last known-good Jelly run

Reference (T20C, Jelly, 2026-09-19, same model `LFM2.5-2.6B-QAD-Q4_0`, the only completed
turn in that campaign directory):

```
KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":2689,"tokensEvaluated":2430,
 "tokensPredicted":258,"promptMs":94596.999,"predictedPerSecond":6.284,"interrupted":false}
-> 2430 / 94.597 s = 25.7 tok/s
```

Today, turn 5 (rung 2b, the largest completed input):
`promptMs 312819.948`, `tokensEvaluated 6328`, `tokensCached 6470`, `prompt_n 2294`,
`tokensPredicted 141`, `interrupted:false`.

* 6328 / 312.820 s = **20.2 tok/s** if the denominator is `tokensEvaluated`
* 2294 / 312.820 s = **7.3 tok/s** if the denominator is `prompt_n` (the newly arrived text)

Same two readings for every completed turn (measured, seconds from `promptMs`):

| turn | prompt_n | tokensEvaluated | tokensCached | promptMs | prompt_n/s | evaluated/s |
|---|---|---|---|---|---|---|
| 1 (T20C, 2026-09-19) | 2430 | 2430 | 2689 | 94 597 | 25.7 | 25.7 |
| 1 (today, rung 0) | 34 | 2181 | 2230 | 2 343 | 14.5 | 930.9 |
| 2 (today, rung 1a) | 84 | 2264 | 2384 | 4 323 | 19.4 | 523.7 |
| 3 (today, rung 1b) | 33 | 2417 | 3279 | 2 258 | 14.6 | 1 070.5 |
| 4 (today, rung 2a) | 1488 | 3872 | 4034 | 108 414 | 13.7 | 35.7 |
| 5 (today, rung 2b) | 2294 | 6328 | 6470 | 312 820 | 7.3 | 20.2 |

Observed accounting (fits t1–t3 and t5; see "not verified" for t4):
`tokensCached = tokensEvaluated + tokensPredicted` and
`tokensEvaluated ≈ tokensCached(previous) + prompt_n`, i.e. **`tokensEvaluated` is close to
`tokensCached` every turn** — the per-turn prompt work grows with the conversation, not with
the new message. The only turn where the KV was clearly reused for almost everything is
turn 3 (36 words out, `prompt_n 33`, `promptMs 2 258`), which is why its `evaluated/s`
is ~1 000 and is not a prefill measurement.

Prefix prewarm for reference (separate from the chat prompt):
`KALSA_PREWARM op done promptMs=73195.556 promptN=2147` (29.3 tok/s, 2026-09-21 12:01) and
`promptMs=120714.99 promptN=2147` (17.8 tok/s, 12:29); later runs restored it from the
snapshot (`op restore ok:true tokens:2147`) instead of recomputing it.

**The prefill-deadline BRANCH BINDING is measured; the estimate input is not preserved.** `src/engine/prefillDeadline.ts`
(sha256 `da82ba727816374a319a7ecb73daaa114b7ad65650987422b8159bdb2ca99d22`, byte-identical at
`6a58ef5`, `964dd53` and the worktree), with `MIN_PREFILL_DEADLINE_MS = 180_000`,
`NO_EMA_PREFILL_TOK_PER_SEC = 10`, `MAX_NO_EMA_PREFILL_DEADLINE_MS = 900_000`, has two branches:

* no EMA (`prefillTokPerSec` null / non-finite / <= 0):
  `min(900_000, max(minMs, ceil(promptTokensEstimate / 10) * 1000))`;
* EMA present: `max(minMs, 5 * ceil(promptTokensEstimate / prefillTokPerSec) * 1000)`.

Each preserved `KALSA_STALL` line carries its own `tokPerSec` — `29.332381873019724` in Step B,
`null` today — so **which branch ran is observed, not inferred**. The two deadlines bind to
those two branches:

* today's **739 s** = the no-EMA branch -> `ceil(est/10) = 739` -> estimate **7 381–7 390**
  tokens, and the persisted notice says `entro 739 s`;
* Step B's **1 355 s** = the EMA branch with `prefillTokPerSec = 29.332381873019724`
  (the prefix-measured 2147 / 73.196) -> `ceil(est / 29.332381873019724) = 271` -> estimate
  **7 920–7 949** tokens (`5 * 271 = 1355`), and its persisted notice says `entro 1355 s`.

**But the estimate input that feeds the branch (`promptTokensEstimate`) is NOT preserved** and
is not reconstructible from the surviving store: the audit projected the current store and got
**7 222–7 630** tokens, i.e. **1 235–1 305 s** at that rate, which does not reach the observed
1 355 s. The two ranges above are therefore **arithmetic on a reconstruction of an unpreserved
input**, not measurements; the measured half of this claim is only the branch binding.

So the differing deadlines are the expected behaviour of ONE watchdog with two branches: which
branch ran is evidence, the estimate ranges are reconstruction.

**INFERENCE (not measurement):** that the Step B stall and this per-turn prefill degradation
are the same phenomenon. The ladder shows a monotone degradation of prefill rate with context
size and shows rung 2c2 failing *before* generation, but no rung reproduced the zero-token
prefill.

**Observation (no fix):** that file's docstring still says *"A missing EMA still arms the min
deadline (90 s)"* while `MIN_PREFILL_DEADLINE_MS` is `180_000` ms — a stale comment.

---

## (e) Explicitly NOT verified

1. That the r2c2 failure (`Cannot read property 'thinkingText' of undefined`) has the same
   root cause as the slow-prefill stall. It is a different observed failure mode.
2. The exact breakpoint: the last passing rung had `prompt_n 2294`; the next deliverable
   rung (16 074 chars, `textEst 5031`) failed. Nothing between them was tried.
3. Whether a turn completes at ~8–11 k context with this build (the original failure
   condition, `nPast 11363`). Step B ran that state with the OLD build and it stalled; it
   was not re-run with the Meter build.
4. The `KALSA_STALL` rate/gap watchdog thresholds outside the prefill deadline. The prefill
   deadline itself is now read and verified — see section (d).
5. The precise `tokensEvaluated` accounting for turn 4 (its `evaluated - prompt_n` equals
   turn 2's cached count, not turn 3's). No single formula was established across all turns.
6. Whether the fixture's synthetic assistant message (which has no `thinkingText` field) is
   what triggered the r2c2 exception. Not investigated, by instruction.
7. Step C (Meter + old engine pin) — never built, so untested **by construction**.
8. Thermal/time dependence: battery 30.0 → 33.0 °C, `Thermal Status: 0 (NONE)` throughout,
   device discharging; no thermal gate ever fired, and temperature was not varied.

---

## Observation (recorded as observed, NO diagnosis, not investigated further)

At ~13:23:02 (the r2c2 attempt) one persisted message carried the text
`⚠️ Cannot read property 'thinkingText' of undefined` (surfaced as a delta by
`AppShell.tsx:5400`); the UI showed `Generazione interrotta.`

Scope check performed (the only check made):
* It appears **once, only in my injected fixture conversation**
  `conv-1790009052954-coder001` (assistant message `createdAt 1790011382341` = 13:23:02).
* It does **not** appear anywhere in the pre-existing 24-message conversation
  `conv-1789854932144-696fm3wu` (0 hits for the error text; the `thinkingText` field name is
  of course present there as normal message metadata).
* It does not appear in the empty conversation `conv-1790008052825-bfpxorm3`.

Not fixed. Not investigated past this check.

---

## (f) Cleanup — exactly what was left

**Bench keys.** `kalsa.bench.energy_trace` was **ABSENT when found** (first bench-key read
11:37, before any write) and was ARMED to `1` only for the ladder; it was **deleted at the
end** through the repo's own `sql_write` (app force-stopped first, helper's own read-back
plus an independent read-back). Bench keys now on the device:

```
kalsa.bench.thinking|default        kalsa.bench.format|none      kalsa.bench.toolgate|1
kalsa.bench.winbudget|6451          kalsa.bench.devmodels|1
kalsa.bench.engine|{"useMmap":false} kalsa.bench.kvtranscript|1
```

`kalsa.bench.kvtranscript = 1` **predates this cell** — it was already `1` in the first
bench-key read at 11:37, and I never wrote it. Every key above is exactly as found.

**Fixture conversation (removed).** Keys handled:
* `kalsa.messages.conv-1790009052954-coder001` → deleted (verified `__ABSENT__`).
* `kalsa.conversations.v1` → rewritten without the fixture item; `activeId` set back to
  `conv-1790008052825-bfpxorm3`. Content preserved as evidence:
  `scratchpad/agents/meter-close/fixture-conversation-removed.json` (14 messages) and
  `.../index-after-cleanup.json`. Removal was safe and reversible without clearing app
  data (targeted DELETE + index rewrite only).

**Left in place, deliberately, named:** `conv-1790008052825-bfpxorm3` — an empty
conversation created by the app's own `Nuova chat` control at 12:27 during this cell. It has
no `kalsa.messages.*` key of its own and exists only as an item inside
`kalsa.conversations.v1`. Not removed because it is the app's own artefact rather than an
injected store write; it can be removed on request.

Pre-existing `conv-1789854932144-696fm3wu` and its messages are untouched.

**Orphans killed:** `run_rung.sh r2c2` (still polling), the `adb logcat` capture (pid 14666),
`watch_rung.sh`; nothing remained (`0` harness procs, `0` logcat captures). No `device-env.sh`
keep-awake was ever used, so no screen-timeout setting was touched
(`screen_off_timeout` still 7200000).

**Installed build (final):** unchanged, Meter build, `adb install -r` only, never uninstalled,
never cleared app data:

```
/data/app/~~DeXzzJqpOSg2v2XKyM9rZg==/com.kalsa.app-UxC0xITqI0kpPL-dayUwRA==/base.apk
sha256 d56abe5f87cd352ad2e4f826203d1060be3fa8aa93e07c6a950606f51f3f1342
```

App left **STOPPED** (as found). Step C has no binary anywhere.

**files/energy/ left untouched (7 files, the evidence):**

```
102632 B  10:46  1790000424688-t1.csv   (previous session, Meter proof)
  3228 B  11:12  1790003511815-t1.csv   (previous session)
  1974 B  12:46  1790009150962-t1.csv   <- rung 0  (the completing-turn proof)
  1909 B  12:48  1790009259536-t2.csv   <- rung 1a
 10231 B  12:50  1790009308944-t3.csv   <- rung 1b
 10357 B  12:54  1790009504906-t4.csv   <- rung 2a
 24481 B  13:01  1790009731571-t5.csv   <- rung 2b
```

**Left on the Mac (evidence):** `/Users/marco/kalsa-local-artifacts/POLICY-OLD-pulled.apk`
sha256 `245c514c32f46acc8b04a9ceb5576d9507a64b614f6b8aa1b314f95bbbcfff3c` — the known-good
old-pin APK recovered read-only from the S23 for Step B.

**S23:** touched read-only only (`pm path` + `exec-out cat` of its installed `base.apk` at
Step A). No install, no write, no benchmark.

**Not committed, not pushed, no tag, no PR.** Report written to
`scratchpad/agents/meter-close/REPORT.md` in the lab repo; the `raw/coordinator-verify/`
directory there is the coordinator's own.

---

# The real-conversation test (2026-09-21 13:29–13:51)

One send of the rung-0 prompt into the REAL conversation `conv-1789854932144-696fm3wu`,
same build, trace ON. Only intended variable against rung 0: the CONTEXT SIZE.

**VERDICT — BRANCH A.** Prefill stall, zero tokens, `KALSA_STALL` with
`reason:"prefill"`: the original failure is **REPRODUCED with this build**, and the Meter
**covered the failing turn**.

## Pre-flight (all of it, before the send)

* Installed APK hash: **`d56abe5f87cd352ad2e4f826203d1060be3fa8aa93e07c6a950606f51f3f1342`**
  (`/data/app/~~DeXzzJqpOSg2v2XKyM9rZg==/com.kalsa.app-UxC0xITqI0kpPL-dayUwRA==/base.apk`).
* Battery: **not charging** (`AC/USB/Wireless powered: false`, `status: 3`), level **42 %**
  (≥ 30 required), 31.0 °C.
* `am force-stop` → `kalsa.bench.energy_trace = 1` written with the repo's `sql_write`
  (helper read-back plus independent read-back: `kalsa.bench.energy_trace|1`).
* Launched, opened `conv-1789854932144-696fm3wu` through the app's own Menu; store confirms
  `activeId = conv-1789854932144-696fm3wu`; the home page markers
  (`Buon pomeriggio.` / `Cosa vuoi approfondire oggi?`) are **absent** from the dump, the
  composer is present, and per-message action nodes (`Copia`, `Leggi ad alta voce`, `Altro`)
  are rendered. (Message bubble *text* does not appear in this build's a11y dump, so the
  in-chat proof is the store id + absence of the home markers.)
* Conversation position before the send: 3rd row of the drawer, after the `Nuova chat`
  button row and the (then-present) `Senza titolo` item.
* **Message count before the send: 24** (15 user / 9 assistant). It already contains our own
  artefacts from today: the last messages are user `Quanto fa due piu due?` and assistant
  `La risposta non e iniziata entro 1355 s ...` (`createdAt 1790006434960` = 12:00:34, the
  Step B stall). Left in place as instructed; not deleted.

## Delivery method (reported exactly, including one deviation)

1. **Composer, as instructed.** Tapped the composer; `adb shell input text '2+2'`; verified
   from the UI dump that the EditText text is **`2+2`**; tapped `Invia` at its live bounds.
   Result: **no `KALSA_SEND`** — the documented harness hole (native EditText receives the
   characters, React's `draft` does not, so `canSend` is false and the Pressable is inert).
   `input keyevent KEYCODE_ENTER` also produced no `KALSA_SEND`.
2. **Root cause of the inert taps (found here, worth recording):** the **IME was open**
   (`dumpsys input_method`: `mCurMethodId=...latinIME`, `mInputShown=true`). With the IME up,
   the app window is resized and the composer row sits at y≈455–505, where taps do nothing;
   the same applies to the harness's own `Invia` taps. After
   `input keyevent KEYCODE_BACK` (`mInputShown=false`) the layout returns to y≈712–830 and
   the composer retained `2+2`.
3. **Deviation, declared:** the `2+2` in the composer had been placed there by the share
   harness's earlier attempts (`am start` sets the draft programmatically — the only working
   way to populate `draft` on this build). After closing the IME, **one tap on `Invia` at
   (426,805)** submitted it (KALSA_SEND at 13:37:50.208). The composer path alone could not
   submit on this build; the send itself was a **composer Send tap**.
4. **`am start` after the turn started: NONE.** The harness's last `am start` was at
   ~13:37:09 (41 s before KALSA_SEND); after 13:37:50.208 only input taps were issued.
   The engine was resident and warm at turn start (`alreadyResident:true`,
   `KALSA_PREWARM op skip already_warm`, `lostRecovery:false`), and the watcher checked the
   status chip every ~2 min for the whole 790 s and **never saw the dispose signature**
   (`Tocca per ricaricare`) — so the `am start` dispose confound the method was designed to
   avoid did not occur here.

## Raw markers, in order (verbatim)

```
09-21 13:34:56.693 I/ReactNativeJS( 3538): KALSA_SESSION {"op":"save","ms":0,"ok":false,"estimatedBytes":0,"usedTokens":-1,"reason":"kv_not_chat"}
09-21 13:34:56.699 I/ReactNativeJS( 3538): KALSA_SESSION {"op":"save","ms":0,"ok":false,"estimatedBytes":0,"usedTokens":-1,"reason":"kv_not_chat"}
09-21 13:34:56.745 I/ReactNativeJS( 3538): 'KALSA_PREWARM', '{"op":"skip","reason":"already_warm","hash":"167625676"}'
09-21 13:37:50.208 I/ReactNativeJS( 3538): KALSA_SEND {"empty":false,"sendClaim":false,"sending":false,"translation":false,"voiceBusy":false,"regen":false,"regenPass":false,"pdf":false,"historyLoaded":true,"jsReady":true,"lostRecovery":false,"activeModel":"lfm2.5-2.6b"}
09-21 13:37:50.216 I/ReactNativeJS( 3538): KALSA_SEND {"phase":"fit","liveness":"alive","alreadyResident":true,"recoverLost":false,"allow":true,"reasonKey":null,"availableMb":3746}
09-21 13:37:50.245 I/ReactNativeJS( 3538): 'KALSA_PREWARM', '{"op":"skip","reason":"already_warm","hash":"167625676"}'
09-21 13:37:50.289 I/ReactNativeJS( 3538): KALSA_WINDOW {"kvHeld":false,"nPast":null,"lastSaveTokens":null,"loadedB":null,"hasDigest":true,"legacyWindowStart":6,"textEst":8292}
09-21 13:37:50.292 I/ReactNativeJS( 3538): KALSA_THINKING {"turnId":"1","budget":512,"decodeTokPerSec":null,"forceShort":true,"contextMode":"ciswire"}
09-21 13:50:09.334 I/ReactNativeJS( 3538): KALSA_STALL {"gapMs":0,"tokens":0,"turnId":"1","reason":"prefill","tokPerSec":null}
09-21 13:51:00.336 I/RNLlama ( 3538): nextToken:1792 Decoding Interrupted
```

* `KALSA_STALL` at **+739.0 s** after `KALSA_THINKING`; `Decoding Interrupted` at **+790.0 s**.
* **Zero tokens** the whole turn; no `KALSA_PREFIX_FALLBACK` line this time (the Step B run
  had `{"tokens":2800,"reason":"measurement_not_persisted"}`).
* Engine load during the stall: app CPU **7155 jiffies / 10 s ≈ 7.15 cores** (sampled at
  ~13:43) — the original stall's signature was 5.7–7.25 cores.
* The persisted turn result (left in the conversation, as instructed):
  user `2+2` + assistant `La risposta non e iniziata entro 739 s. ...`
  (`createdAt 1790012270217`); conversation now **26 messages**. The app's own notice names
  the same 739 s the stall fired at.
* No `Cannot read property 'thinkingText'` and no other JS exception this time.

## The Meter covered the FAILING turn

`files/energy/1790012270294-t1.csv` (left on the device):

* 9 columns as before; **779 data rows**, span **789.7 s**, `wall_clock_ms` 1790012270296 →
  1790013060027. First row is **+4 ms after `KALSA_THINKING`**; last row is **0.3 s before**
  the `Decoding Interrupted` log.
* `voltage_mV` **3662 … 3802**; `current_uA` min **-1 323 000**, median **-727 000**,
  max **-217 000**; `charge_counter_uAh` **1 207 860 → 1 031 100** (heavy-load drain over
  the 13 min); status triplet **`ok,ok,ok` on every row**.
* First data row `1061018.04,1061018040,1790012270296,-217000,1207860,3802,ok,ok,ok`;
  last data row `1061807.771,1061807771,1790013060027,-537000,1031100,3715,ok,ok,ok`.

## Comparison with the original (same conversation)

| | Step B (old pin) | today (Meter build, new pin) |
|---|---|---|
| `textEst` | 8242 | 8292 |
| prompt | `Quanto fa due piu due?` | `2+2` |
| `KALSA_THINKING` | budget 512, `decodeTokPerSec:null`, `forceShort:true`, ciswire | identical |
| `KALSA_STALL` | `reason:"prefill"`, `tokens:0`, `tokPerSec:29.332381873019724` at **+1355 s** (artefact `stepB-markers.txt` 12:23:37.381) | `reason:"prefill"`, `tokens:0`, `tokPerSec:null` at **+739 s** (artefact `realconv-markers.txt` 13:50:09.334) |
| outcome | `Decoding Interrupted`, notice "entro 1355 s" | `Decoding Interrupted`, notice "entro 739 s" |

The `1520 s` and `tokPerSec:26.95` figures that appear in the pre-cell handover record have
**no artefact in this cell** (the only two raw `KALSA_STALL` lines that exist here are the two
in the table above). They are recorded as **UNSOURCED, inherited from the handover**, not as
measurements.

**INFERENCE (not measurement):** that the two stalls are the same phenomenon. Both are
`reason:"prefill"`, zero tokens, heavy multi-core CPU, same conversation, comparable
`textEst`; the differing deadlines are now explained as the two branches of one watchdog
(section (d)).
**INFERENCE (not measurement):** any arithmetic linking the stall to the per-turn prefill
rates in section (d) — e.g. a 8292-token context at turn 5's 7.3 tok/s (`prompt_n` basis)
implies ~1136 s > the 739 s deadline, while at 20.2 tok/s (`tokensEvaluated` basis) it implies
~410 s < the deadline. The deadline value (739 s) is measured; the estimate behind it and the
rate attribution inside that arithmetic are not.

## Cleanup for this test

* `kalsa.bench.energy_trace` **deleted** (verified absent); all other bench keys exactly as
  found (`kvtranscript=1` predates this cell).
* Removed the empty app-created conversation `conv-1790008052825-bfpxorm3` with a targeted
  index rewrite; it had **no** `kalsa.messages.*` key (checked before deleting). Index
  before/after saved as `index-before-realconv-cleanup.json` /
  `index-after-realconv-cleanup.json`. **Surviving index:** `activeId =
  conv-1789854932144-696fm3wu`, `items = ['conv-1789854932144-696fm3wu']`; conversation keys
  now: `kalsa.conversations.v1` + `kalsa.messages.conv-1789854932144-696fm3wu` only.
* Processes: watcher exited on the terminal marker; 0 harness procs, 0 logcat captures.
* Meter build still installed (`-r` only, never uninstalled, never cleared app data), hash
  unchanged; app left **STOPPED** (as found).
* `files/energy/` untouched — now **8** CSVs (the 7 previous + `1790012270294-t1.csv`).

## Updated NOT verified

1. The mechanism behind the prefill-rate collapse with context size — no engine-side
   instrumentation, not investigated.
2. The origin of the `thinkingText` exception: it did **not** occur in this real-conversation
   run, but that does not settle what caused it in the fixture run. Not investigated further.
3. The `KALSA_STALL` rate/gap watchdog thresholds outside the prefill deadline. The prefill
   deadline formula itself is now read and verified (section (d)).
4. Whether the turn would complete just below the window/context threshold in the real
   conversation — no intermediate context sizes were tested there.
5. Whether a warm chat KV changes the outcome: at this turn's start `kvHeld:false` and
   `nPast:null` (Step B was also `kvHeld:false`), so the whole windowed context had to be
   evaluated; the `kvHeld:true` state was not tested here.
6. Battery temperature during the stall (only 31.0 °C at pre-flight; the CSV carries no
   temperature column and it was not polled during the 790 s).
7. Step C (Meter + old pin) — still never built, untested by construction.

---

# CORRECTIONS AFTER INDEPENDENT AUDIT

Four residuals from the independent review (separate cell `meter-close-audit/REPORT.md`),
all closed here. No rebuild, no new experiment.

## 1. The prefill-deadline formula — read and verified (was mislabelled "not read")

The label was too weak. The file is readable and was read:

* `src/engine/prefillDeadline.ts`, sha256
  **`da82ba727816374a319a7ecb73daaa114b7ad65650987422b8159bdb2ca99d22`**,
  **byte-identical** at `6a58ef5` (Meter build), `964dd53` (Step B build) and the worktree.
* Constants: `MIN_PREFILL_DEADLINE_MS = 180_000`;
  `NO_EMA_PREFILL_TOK_PER_SEC = 10`; `MAX_NO_EMA_PREFILL_DEADLINE_MS = 900_000`.
* Branch 1 (no EMA: `prefillTokPerSec` null / non-finite / <= 0):
  `min(900_000, max(minMs, ceil(promptTokensEstimate / 10) * 1000))`.
* Branch 2 (EMA present):
  `max(minMs, 5 * ceil(promptTokensEstimate / prefillTokPerSec) * 1000)`.

Both deadlines in this cell **bind** to those two branches — measured through each
`KALSA_STALL` line's own `tokPerSec` (`29.332381873019724` vs `null`) — while the estimate
inputs are **not** preserved and the ranges are reconstructions of that unpreserved input
(see the addendum below):

* **today 739 s** — branch 1: `ceil(est / 10) = 739` → `est` in **7 381–7 390**;
  persisted notice says `entro 739 s`.
* **Step B 1 355 s** — branch 2 with `prefillTokPerSec = 29.332381873019724`
  (the prefix-measured `2147 / 73.196`): `ceil(est / 29.332381873019724) = 271` →
  `est` in **7 920–7 949**; `5 * 271 = 1355`; persisted notice says `entro 1355 s`.

Report amendments made: section (d) now states the formula as read, the branch binding as
measured, and the estimate ranges as reconstructions of an unpreserved input, and quotes both
branches and both arithmetics, the sentence "The formula was not read or verified" is
replaced, section (e) item 4 and the real-conversation "Updated NOT verified" item 3 now
scope the open question to the `KALSA_STALL` rate/gap watchdog thresholds outside the prefill
deadline.

**Observation recorded, no fix:** the docstring of that same file still says *"A missing EMA
still arms the min deadline (90 s)"* while `MIN_PREFILL_DEADLINE_MS` is `180_000` ms — a stale
comment.

## 2. The `26.95` / `1520 s` conflation — corrected, marked unsourced

Grepping every artefact of this cell, exactly **two** raw `KALSA_STALL` lines exist:

```
stepB-markers.txt    09-21 12:23:37.381 I/ReactNativeJS(23816): KALSA_STALL {"gapMs":0,"tokens":0,"turnId":"1","reason":"prefill","tokPerSec":29.332381873019724}
realconv-markers.txt 09-21 13:50:09.334 I/ReactNativeJS( 3538): KALSA_STALL {"gapMs":0,"tokens":0,"turnId":"1","reason":"prefill","tokPerSec":null}
```

The literal `26.95` appears nowhere in this cell's artefacts **as a `tokPerSec` value**, and `1520 s` belongs to the
pre-cell handover record, which has no artefact here. The comparison table row was corrected
to **Step B = `tokPerSec:29.332381873019724` at +1355 s** (vs `KALSA_THINKING` 12:01:02.309),
and the report now states explicitly that `1520 s` / `26.95` are **UNSOURCED, inherited from
the handover**, not measurements.

## 3. Cleanup gap — the three surviving fixture keys, now deleted

Three keys derived from the deleted fixture conversation `conv-1790009052954-coder001`
survived the earlier cleanup and were undisclosed. App force-stopped first; each deleted with
the repo's own `sql_write` (helper read-back `__ABSENT__`) and then read back independently:

| key | before (value length) | after (independent read-back) |
|---|---|---|
| `kalsa.chat.compactor.conv-1790009052954-coder001` | 116 B | `<ABSENT>` |
| `kalsa.chat.summary.conv-1790009052954-coder001` | 0 B | `<ABSENT>` |
| `kalsa.session.meta.lfm2_002e5-2_002e6b__conv-1790009052954-coder001__4223925939` | 17 132 B (review's own read: 17 075 B) | `<ABSENT>` |

(`before` lengths are from my read-back. Two readings of that key exist: **17 075 B** (the
review's read) and **17 132 B** (mine). The app was force-stopped at both audits, so growth is
not evident from those two reads; a WAL / checkpoint read-state difference is at least as
plausible. No cause is asserted. The key is absent now either way.)

After the deletes, `SELECT key ... WHERE key LIKE '%conv-1790009052954-coder001%'` returns
**no rows**. Nothing else was touched: every `kalsa.session.meta.*` for a still-existing
conversation survives verbatim, including
`kalsa.session.meta.lfm2_002e5-2_002e6b__conv-1789854932144-696fm3wu__4223925939`, and the
only surviving `kalsa.chat.compactor` / `kalsa.chat.summary` keys are that same real
conversation's.

## 4. Raw artefacts preserved out of /tmp

Copied to `scratchpad/agents/meter-close/raw/coder-artifacts/` (27 files):

* requested: `realconv.log`, `realconv-markers.txt`, `realconv-t1.csv`, `stepB-markers.txt`,
  `stepB-launch.logcat`, `ladder.logcat`, and the 8 device CSVs re-pulled into
  `device-energy/` (`1790000424688-t1`, `1790003511815-t1`, `1790009150962-t1`,
  `1790009259536-t2`, `1790009308944-t3`, `1790009504906-t4`, `1790009731571-t5`,
  `1790012270294-t1`);
* additionally, because they carry evidence that exists nowhere else: `rung0-markers.txt`,
  `r1a-markers.txt`, `r1b-markers.txt`, `r2a-markers.txt`, `r2b-markers.txt`,
  `r2c2-markers.txt`, `stepC-markers.txt`, `r2c.log`, `r2c2.log`, `watch_real-out.log`,
  `watch-rung0.log`, `watch_stepC.log`, `reload-wait.txt`.

**Provenance limits, stated explicitly:**

* `ladder.logcat` covers **12:48:12 → 13:26:10** only (measured). Therefore **rung 0
  (12:45:50) and rung 1a (12:47:39) fall outside it** (0 occurrences of their timestamps),
  and so does **the whole real-conversation test** (13:37:50 → 13:51:00, after the capture
  stopped). Rung 1b's `KALSA_THINKING` (12:48:28) is inside; rung 1b's telemetry (12:50:55)
  is inside.
* **The real-conversation `KALSA_SEND` lines exist in no preserved artefact** —
  `realconv-markers.txt` was filtered without `SEND` (`rg -c KALSA_SEND` = 0), and the live
  `adb logcat -d` output that contained them went only to the session transcript.
* **The CPU samples** (e.g. 7155 jiffies / 10 s ≈ 7.15 cores during the stall) exist only in
  the session transcript.
* The **rung-0 live platform cross-check text** (CSV tail next to `dumpsys battery` and the
  sysfs reads) likewise exists only in the session transcript; the underlying CSV is
  preserved at `device-energy/1790009150962-t1.csv`.
* No raw `adb logcat` capture was ever started for the real-conversation test, so the
  reproduced stall has a filtered marker snapshot (`realconv-markers.txt`, which does contain
  the `KALSA_WINDOW`, `KALSA_THINKING`, `KALSA_STALL` and `Decoding Interrupted` lines) plus
  the watcher log, not a full logcat.

## Addendum (round 2 of the independent audit)

1. **Step B estimate range — off-by-one, corrected to 7 920–7 949.**
   Arithmetic: `7920 / 29.332381873019724 = 270.0117 -> ceil = 271`;
   `7949 / 29.332381873019724 = 270.996 -> ceil = 271`;
   `7950 / 29.332381873019724 = 271.03 -> ceil = 272`.
   So the integers satisfying `ceil(est / rate) = 271` are `7920…7949`, not `7921…7949`;
   `7920` does belong. Corrected in section (d) and in corrections item 1. Today's branch-1
   range stays `7 381–7 390` (`ceil(est / 10) = 739` <=> `est ∈ (7380, 7390]`).
2. **Branch binding vs estimate input — over-claim scoped, finding kept.**
   *Measured:* which branch ran — each preserved `KALSA_STALL` line carries its own
   `tokPerSec` (`29.332381873019724` vs `null`).
   *Not preserved:* the `promptTokensEstimate` that fed the branch, and it is not
   reconstructible from the surviving store. The audit's projection of the current store gives
   `7 222–7 630` tokens -> `ceil(7222 / rate) = 247 -> 1 235 s`, `ceil(7630 / rate) = 261 ->
   1 305 s`, which does not reach the observed `1 355 s` (that needs `est >= 7920`). The ranges
   are therefore **arithmetic on a reconstruction of an unpreserved input**. Section (d) now
   states this immediately after the branch binding; nothing in the finding was deleted.
3. **Two nits.** The comparison table columns are now named by run — **`Step B (old pin)`** and
   **`today (Meter build, new pin)`** — so the header no longer re-invites the conflation with
   the artefact-less pre-cell original. And "`26.95` appears nowhere in this cell's artefacts"
   now reads "**nowhere … as a `tokPerSec` value**", because it does occur once inside the
   timestamp `13:08:26.957`.
4. **Session-meta length difference — causal claim removed.** Both readings are stated —
   **17 075 B** (the review's read) and **17 132 B** (mine) — with no growth asserted (the app
   was force-stopped at both audits); a WAL / checkpoint read-state difference is recorded as
   an equally plausible candidate. No cause is claimed; the key is absent either way.
