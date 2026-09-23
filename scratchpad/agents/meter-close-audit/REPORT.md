# Independent audit — cell `meter-close` (Jelly Star energy trace)

Auditor: independent reviewer, 2026-09-21. Did not do the work; the report under
audit is treated as a claim, not evidence. Default verdict per claim: UNSUPPORTED
until reproduced from raw artefacts.

- Under audit: `scratchpad/agents/meter-close/REPORT.md` (lab repo, 457 lines).
- Raw sources used: device re-pulls (adb read-only, Jelly Star 192.168.1.82:5555),
  `/tmp/kalsa-ab/` (coder's working dir, incl. `ladder.logcat` persistent capture),
  coordinator's `raw/coordinator-verify/`, app source `/Users/marco/Projects/kalsa`,
  T20C campaign logcat, `POLICY-OLD-pulled.apk`.
- The S23 was not touched. Nothing installed, nothing written to the device.

Audit in progress — sections are appended as they are completed.

---

## A. Meter covers a completing turn (rung 0) — CONFIRMED

Re-pulled `files/energy/1790009150962-t1.csv` from the device with
`adb -s 192.168.1.82:5555 shell run-as com.kalsa.app cat ...`:
sha256 `dd99c4f6...971b767`, byte-identical to the coordinator copy AND to
`/tmp/kalsa-ab/rung0-1790009150962-t1.csv`.

Recomputed from the re-pulled file:
- 24 data rows (+1 schema line, +1 header) — matches report.
- span 23.238 s (report: 23.2) — matches.
- voltage 3815..3922 mV — matches.
- current min/median/max −1121000/−1045000/−260000 µA — matches.
- charge_counter 1590840 constant on every row — matches.
- status triplet `ok,ok,ok` on all 24 rows — matches.
- first row `wall_clock_ms 1790009150964`; KALSA_SEND logged 12:45:50.884
  (= epoch 1790009150884, consistent with the last row's epoch → 12:46:14.202);
  delta = **+80 ms** — matches.
- CSV tail quoted in the report is verbatim identical to the device file.

Platform cross-check: the report's 12:46 dumpsys snapshot cannot be re-taken, but
the mechanism checks out live (2026-09-21 ~14:00): `dumpsys battery` voltage 3775 ==
`voltage_now` 3775000 µV / 1000 exactly; discharge sign convention confirmed
(`current_now` negative while discharging, status 3, AC/USB/Wireless all false).
Bonus consistency: charge_counter values on the device are exactly level×29460 µAh
(54 %→1590840 at the CSV's time per the report; 33 %→972180 now), so the CSV's
1590840 is the genuine fuel gauge. The one thing I accept on the strength of the
report's transcript alone is the 12:46 `dumpsys` output itself; everything
checkable about it checks out.

**Verdict: CONFIRMED.**

## D. The ladder — CONFIRMED for values, provenance caveat on rungs 0/1a

Raw-marker verification:
- `ladder.logcat` (the persistent capture) spans **12:48:12.573 → 13:26:10.479**.
  It contains turns 3/4/5 verbatim: KALSA_THINKING 12:48:28.942 / 12:51:44.903 /
  12:55:31.567; KALSA_TELEMETRY 12:50:55.407 / 12:54:15.201 / 13:01:35.547, with
  all five token/promptMs values byte-for-byte as quoted in the report (t3/t4/t5).
- Rungs 0 and 1a are NOT in the persistent capture (it starts too late). Their
  markers (12:45:50.884/.960; 12:47:39.533, telemetry t1/t2) come from the
  per-rung filtered files `rung0-markers.txt` / `r1a-markers.txt`, which are
  logcat-format excerpts containing KALSA_* lines only. Internal timestamps are
  self-consistent and the rung-0 CSV (device, hash-verified) independently
  brackets turn 1, but the report's phrase "per-rung markers (persistent logcat
  capture…)" overstates provenance for rungs 0/1a.
- One CSV per completed rung, all five re-pulled from the device and
  sha256-identical to both lab copies; recomputed rows/span match the report
  table: 24/23.2, 23/22.2, 146/146.4, 149/150.1, 360/363.9.
- Filename epochs land +2..6 ms after each rung's KALSA_THINKING — corroborates
  trace start at turn begin.

Rate recomputation (both readings, s = promptMs/1000), all match the report:

| turn | prompt_n | tokensEval | promptMs | prompt_n/s | evaluated/s |
|---|---|---|---|---|---|
| T20C t1 | 2430 | 2430 | 94 597 | 25.7 | 25.7 |
| 1 | 34 | 2181 | 2 343 | 14.5 | 930.8 |
| 2 | 84 | 2264 | 4 323 | 19.4 | 523.7 |
| 3 | 33 | 2417 | 2 258 | 14.6 | 1070.5 |
| 4 | 1488 | 3872 | 108 414 | 13.7 | 35.7 |
| 5 | 2294 | 6328 | 312 820 | 7.3 | 20.2 |

- T20C raw line re-verified from
  `local-artifacts/t20c-jelly-campaign/logcat.txt:1892` (round 0):
  tokensEvaluated 2430, promptMs 94596.999 → 25.6879 = 25.7 tok/s. Confirmed.
  (Minor: the report quotes the T20C telemetry line abridged — fields omitted,
  quoted values accurate.)

**Verdict: CONFIRMED** (values and CSVs fully reproduced; one provenance caveat —
rung 0/1a markers come from filtered per-rung captures, not the persistent one).

## E. "tokensEvaluated ≈ tokensCached every turn ⇒ per-turn prefill work grows" — CONFIRMED as stated, with two precision defects

Recomputed on all five turns from the raw telemetry values:
- ratio tokensEvaluated/tokensCached per turn: t1 0.978, t2 0.950, t3 0.737,
  t4 0.960, t5 0.978. "Close to" holds (≤2.2 % for four of five; t3 is the
  near-total-KV-reuse outlier the report itself flags).
- tokensEvaluated is monotone increasing: 2181→2264→2417→3872→6328. The
  conclusion "per-turn prompt work grows with the conversation, not with the new
  message" is supported (contrast prompt_n: 34→84→33→1488→2294, which does NOT
  track promptMs; te does).
- Defect 1: the report's accounting sentence
  `tokensCached = tokensEvaluated + tokensPredicted` is off by **exactly 1 on
  every turn** (e.g. 2181+48=2229 vs 2230; 6328+141=6469 vs 6470) — presumably a
  BOS slot. "Fits t1–t3 and t5" is imprecise: it fits nowhere exactly; it fits
  everywhere to ±1.
- Defect 2 (already disclosed by the report, verified): the stronger chain
  `tokensEvaluated − prompt_n == previous turn's tokensCached` breaks at t4:
  t4's te−pn = 3872−1488 = 2384 = tc(2), NOT tc(3)=3279. So turn 4 re-evaluated
  from the post-turn-2 KV state, i.e. the KV-reuse chain is not monotone. The
  report discloses exactly this in "not verified" #5.

**Verdict: CONFIRMED** as the report states it; the sentence survives its own
table (t3/t4 caveats are disclosed, not hidden). The two precision defects above
are recorded.

## F. Step B (old-pin build stalls identically) — PARTIAL

- `POLICY-OLD-pulled.apk` sha256 recomputed:
  `245c514c32f46acc8b04a9ceb5576d9507a64b614f6b8aa1b314f95bbbcfff3c`, 159 214 430 B —
  **matches the report exactly**.
- `stepB-markers.txt` is a **hand-filtered excerpt, not raw logcat**: 6 lines only
  (KALSA_STALL, Decoding Interrupted, four post-turn KALSA_SESSION lines). The
  report's quoted Step B sequence (KALSA_SEND 12:00:34.922, PREFIX_FALLBACK
  12:00:35.267, WINDOW 12:00:35.410, PREFIX_MEASURED 12:01:02.162, THINKING
  12:01:02.309, PREWARM promptMs=73195.556) is preserved in **no artefact** —
  `stepB-launch.logcat` (raw) ends at 12:00:18, before the send.
- What the excerpt DOES establish: on some build running as pid 23816,
  `KALSA_STALL {"tokens":0,"reason":"prefill","tokPerSec":29.332381873}` at
  12:23:37.381, then `Decoding Interrupted` 12:24:54.316, then SESSION saves with
  messageCount 22→24. The ~24 min figure is consistent (THINKING→Interrupted
  would be ~23.9 min if THINKING was 12:01:02.309, but that timestamp itself is
  unpreserved).
- **Discrepancy found:** the report's comparison table (realconv section) gives
  the "original (Step B, old pin)" stall as `tokPerSec:26.95` at `~1520 s`. The
  preserved Step B artefact says **tokPerSec 29.332**, and 26.95 appears in **no**
  preserved artefact (searched /tmp/kalsa-ab, lab repo, handover RECON). The
  "~1520 s" belongs to the ORIGINAL pre-cell stall (handover RECON.md:88), a
  third, distinct run. Step B's own stall fired at +1355.07 s after its THINKING
  (12:01:02.309 → 12:23:37.381) — exactly the "entro 1355 s" its persisted notice
  names. The table conflates the original run with Step B and misquotes Step B's
  tokPerSec.
- That the old-pin build was actually installed at 12:00 is not independently
  verifiable (current installed build is the Meter build; the install event left
  no preserved trace). The stall-line evidence is real; its attribution to the
  old-pin build rests on the coder's transcript alone.

**Verdict: PARTIAL** — the stall artefact is genuine and its numbers are
internally consistent with the "entro 1355 s" notice; the quoted pre-stall
sequence, the 26.95 figure, and the install attribution are not reproducible
from artefacts.

## G. The real-conversation test — stall sequence CONFIRMED from preserved captures; "REPRODUCED" needs qualification

Preserved evidence (poll-based, 15 s `logcat -d` snapshots filtered by
`watch_real.sh` to KALSA_*/Decoding/Cannot-read lines — real capture content,
genuine logcat timestamps, but NOT a continuous raw stream; the grep pattern
does not include KALSA_SEND):

From `realconv.log` + `realconv-markers.txt`:
- `KALSA_WINDOW {"kvHeld":false,...,"legacyWindowStart":6,"textEst":8292}` at
  13:37:50.289 and `KALSA_THINKING {"turnId":"1","budget":512,"decodeTokPerSec":null,
  "forceShort":true,"contextMode":"ciswire"}` at 13:37:50.292 — verbatim as the
  report quotes.
- `KALSA_STALL {"gapMs":0,"tokens":0,"turnId":"1","reason":"prefill","tokPerSec":null}`
  at **13:50:09.334** — verbatim.
- `Decoding Interrupted` (I/RNLlama) at **13:51:00.336** — verbatim.
- No `KALSA_PREFIX_FALLBACK` and no `KALSA_TELEMETRY` in any snapshot — consistent
  with the report ("zero tokens", "no PREFIX_FALLBACK this time"); the watcher's
  grep would have caught both.
- Watcher annotations: CSV `1790012270294-t1.csv` first seen 13:37:54, growing
  5→779 rows, final stats computed live from the device (rows=779 span=789.7s,
  voltage 3662..3802, current −1323000/−727000/−217000) — matching the report's
  failing-turn numbers exactly. No DISPOSE signature line, consistent with
  "never saw `Tocca per ricaricare`".

Deltas recomputed: THINKING 13:37:50.292 → STALL 13:50:09.334 = **739.042 s**
(report: 739.0 ✓); THINKING → Interrupted 13:51:00.336 = **790.044 s**
(report: 790.0 ✓).

**NOT supported by any preserved artefact:** the two `KALSA_SEND` lines at
13:37:50.208/.216 quoted in the report's raw-markers block. The watcher grep
excludes KALSA_SEND, no other capture covers 13:37, and `grep -rn "13:37:50"
/tmp/kalsa-ab` finds them nowhere. The send's existence is corroborated only
indirectly (the turn happened, the CSV appeared, the store gained messages).
Likewise the "~13:43 CPU 7155 jiffies/10 s" sample and the UI-dump claims are
not preserved as artefacts.

**Same phenomenon as the original 1520 s stall?** What the evidence establishes:
both are `reason:"prefill"` stalls with tokens:0 on the same conversation with
similar textEst (8242 vs 8292), ending in Decoding Interrupted, engine busy.
What it does NOT establish: that they share a mechanism. The two observed
deadlines differ (1355 s @ tokPerSec 29.33; 739 s @ tokPerSec null), and the
original's own numbers (1520 s, 26.95) are not reproducible from any artefact —
they rest on the handover's and coder's prose. Whether the differing deadlines
are two expressions of one formula (see H) or two different behaviors is exactly
what is not settled. Same shape: proven. Same phenomenon: plausible, not
demonstrated.

**Verdict: PARTIAL** — the 13:37→13:51 sequence, the 739 s/790 s deltas, the
STALL content and the failing-turn CSV are confirmed from preserved captures;
the KALSA_SEND timestamps, the CPU sample, and the identity-of-phenomenon claim
are not.

## B. Schema and writer — CONFIRMED (writer file is `native/`, not the stale `android/` copy)

- Device CSV schema line, byte-for-byte:
  `# schema=kalsa-governor-battery-trace-v2; t_s=SystemClock.elapsedRealtime()/1000;
  voltage_mV=BatteryManager.EXTRA_VOLTAGE, millivolts; current_uA=property-documented
  unit, calibrate per device; INVALID=invalid reading`
- Column order recomputed from the file header:
  `t_s,elapsed_realtime_ms,wall_clock_ms,current_uA,charge_counter_uAh,voltage_mV,
  current_status,charge_counter_status,voltage_status` — exactly the report's 9 columns.
- The writer: `native/GovernorBatteryModule.kt` contains the v2 schema header and
  9-column order **as Kotlin string constants that concatenate to the byte-identical
  text**, reads current/charge_counter via `BatteryManager.getIntProperty`
  (`BATTERY_PROPERTY_CURRENT_NOW` / `..._CHARGE_COUNTER`) and voltage via
  `EXTRA_VOLTAGE`, writes `INVALID` for a null reading, and status values
  `ok/unsupported/unavailable/error`. So: current_uA's unit is property-documented
  and UNCALIBRATED (the schema line itself says "calibrate per device") ✓, and
  INVALID is a possible value ✓.
- Nuance the report does not spell out: there are TWO `GovernorBatteryModule.kt`
  files in the working tree. `android/app/src/main/java/com/kalsa/app/…` is an
  UNTRACKED, STALE prebuild leftover writing **v1 with 7 columns (no voltage)**;
  the live source of truth is `native/GovernorBatteryModule.kt`, copied into the
  build by `plugins/withGovernorBattery.js` during `expo prebuild`. At the Meter
  build commit `6a58ef5`, `native/` carries v2 — matching the device files. The
  old-pin commit `964dd53` has no v2 module (no Step B CSVs exist, consistent —
  the trace key was off then anyway).

**Verdict: CONFIRMED.**

## C. Bracketing in LlamaService.ts — CONFIRMED

- `startGovernorBatteryTrace` at **src/engine/LlamaService.ts:4592** (report cited
  ~4592 ✓), immediately BEFORE the `try` block that runs the turn — before the
  engine call and its prefill. `KALSA_THINKING` (line 4233) is logged ~4 ms before
  the trace's first row on the failing turn — coherent with the code order
  (THINKING log → trace start → prefill).
- `stopGovernorBatteryTrace` at **LlamaService.ts:5420** (report cited ~5420 ✓) in
  the `finally` of the same try — runs after completion, error, OR abort, i.e.
  after the turn ends. This is exactly why the failing turn's CSV runs to the
  Decoding-Interrupted moment: the prefill-deadline abort unwinds through that
  `finally`.
- Failing-turn edges recomputed from epochs: CSV first row 1790012270296 =
  13:37:50.296 = **+4 ms after KALSA_THINKING (13:37:50.292)** ✓ exactly as the
  report claims; CSV last row 1790013060027 = 13:51:00.027 = **0.309 s before**
  `Decoding Interrupted` (13:51:00.336) ✓. Same +2..6 ms relation holds on all
  five ladder CSVs.

**Verdict: CONFIRMED.**

## H. The prefill-deadline formula — the report's "not verified" is TOO WEAK; the formula is readable and both observed deadlines are its outputs

The report labels the deadline "not read or verified" (INFERENCE at line 199-200;
NOT-verified #4, #3). **The formula is in the app source the cell was run from:**

`src/engine/prefillDeadline.ts` (byte-identical at the working tree, at the Meter
build commit `6a58ef5`, AND at the old-pin commit `964dd53`):

```
MIN_PREFILL_DEADLINE_MS       = 180_000
NO_EMA_PREFILL_TOK_PER_SEC    = 10
MAX_NO_EMA_PREFILL_DEADLINE_MS = 900_000
no-EMA branch (prefillTokPerSec null/invalid/<=0):
    deadline = min(900_000, max(180_000, ceil(est/10)*1000))   [ms]
EMA branch:
    deadline = max(180_000, 5 * ceil(est / prefillTokPerSec) * 1000)
```

Call site `LlamaService.ts:4152-4197` (`armPrefillDeadline`):
`est = max(ceil(JSON.stringify(currentMessages).length/4), getLastPromptTokens(modelId) ?? 0)`;
on firing it emits `KALSA_STALL {gapMs:0, tokens, reason:"prefill",
tokPerSec: prefillTokPerSec}` — **the STALL line's tokPerSec IS the formula's
rate input** — then aborts with "…entro {round(deadlineMs/1000)} s". So the
persisted notices are exact readings of the formula's output.

Consistency of the observations:
- **739 s (Meter build):** STALL tokPerSec = null → no-EMA branch →
  `ceil(est/10) = 739` ⇒ **est ∈ (7380, 7390]** prompt-token estimate. Achievable:
  a `role,text` projection of the preserved 24-message store state gives
  est = 7439 → deadline 744 s (within 0.7 %); the full store shape gives 11013 →
  900 s (capped), so the actual `currentMessages` projection is lighter than the
  store shape. Consistent; exact est not pinned (shape not preserved).
- **1355 s (Step B, old pin):** STALL tokPerSec = 29.332 = exactly
  2147/73.1956 — the PREFIX_MEASURED prefill rate quoted for that run, i.e. the
  EMA input. EMA branch ⇒ `5*ceil(est/29.332) = 1355` ⇒ **est ∈ (7919.6, 7949]**.
  All text-based projections of the preserved 22-message state give est 7222–7630
  (deadlines 1235–1305 s), so 1355 s additionally requires the est to have come
  from a slightly heavier projection or from a persisted `lastPromptTokens` of
  ~7920–7949. Consistent with the formula, not derivable from preserved data.
- **The same formula therefore explains BOTH observed deadlines**: the 739 s vs
  1355 s difference is the formula reacting to different rate inputs (null vs
  29.33), not evidence of two behaviors. This materially STRENGTHENS the
  report's "same phenomenon" conjecture — both turns died in the same watchdog
  at their own computed deadlines. The original 1520 s notice (preserved in the
  conversation store, createdAt 1790000380868) is NOT reachable via the no-EMA
  branch (cap 900 s), so the original must have run the EMA branch (est/rate ≈
  304) on a possibly older formula build — not pinnable.

**Verdict: the formula is CONFIRMED READABLE AND APPLICABLE. The report's "not
verified" label is TOO WEAK** — verifiability was one `grep` away in the repo the
cell ran from, and reading it would have (a) turned the 739/1355 difference from
a puzzle into an expected formula output and (b) tightened the same-phenomenon
inference. The report's factual statements about the deadline remain correct.

## I. Failing-turn Meter numbers — CONFIRMED (0.806 A arithmetic checks out)

Re-pulled `files/energy/1790012270294-t1.csv` from the device
(sha256 `be90e8ac…bda01b`, identical to `/tmp/kalsa-ab/realconv-t1.csv`):
- 779 data rows, span 789.7 s, wall 1790012270296 → 1790013060027 ✓
- voltage 3662..3802 ✓; current min/median/max −1323000/−727000/−217000 ✓
- charge_counter 1207860 → 1031100, delta **−176760 µAh** ✓
- Derived average current over the trace window: 176760 µAh ÷ (789.7 s/3600) =
  **805 763 µA = 0.8058 A ≈ 0.806 A** — the coordinator's figure reproduces.
  (Cross-check: mean of the 779 current samples = 801 661 µA = 0.802 A,
  consistent.)
- status triplets `ok,ok,ok` on every row; first/last rows verbatim as quoted.
- The watcher's live growth snapshots (rows 5→779) independently corroborate
  that this CSV grew DURING the 13:37–13:51 turn.

**Verdict: CONFIRMED.**

## J. thinkingText scope — CONFIRMED

- Preserved fixture evidence (`fixture-conversation-removed.json`, 14 messages):
  the text `Cannot read property 'thinkingText' of undefined` occurs **exactly
  once**, on the assistant message `createdAt 1790011382341` (= 13:23:02) —
  matching the report. That message has NO `thinkingText` field (2 of the
  fixture's 7 assistant messages lack it; both synthetic/error messages).
- Device store now: `kalsa.messages.conv-1789854932144-696fm3wu` (26 messages,
  ending user `2+2` + assistant `entro 739 s`, `createdAt 1790012270217` —
  matching the report): **0 hits** for the error text. The fixture messages key
  is absent from the device. Not diagnosed, per scope.

**Verdict: CONFIRMED.**

## K. Device state as of now — CONFIRMED on every listed item; ONE cleanup gap found

Verified live (2026-09-21 ~14:15–14:25):
- `kalsa.bench.energy_trace`: **ABSENT** ✓ (full key dump queried).
- Other bench keys exactly as the report lists: thinking=default, format=none,
  toolgate=1, winbudget=6451, devmodels=1, engine={"useMmap":false},
  kvtranscript=1 ✓ (kvtranscript predates the cell per report — accepted).
- `kalsa.conversations.v1`: activeId = `conv-1789854932144-696fm3wu`, items =
  [that one] ✓ (and its 12 395 B size equals the preserved
  `index-after-realconv-cleanup.json`).
- Installed base.apk streamed hash = **d56abe5f…f1342** ✓, path as reported.
- `files/energy/`: exactly **8 CSVs**, sizes and mtimes matching the report's
  listing ✓.
- App **STOPPED** ✓ (`pidof` empty); `screen_off_timeout` still 7200000 ✓.
- Mac: no `run_rung`, `watch_*`, or logcat capture processes ✓.
- **Cleanup gap (not in the report):** the fixture conversation left THREE
  surviving store keys — `kalsa.chat.compactor.conv-1790009052954-coder001`
  (116 B), `kalsa.chat.summary.conv-1790009052954-coder001` (0 B), and
  `kalsa.session.meta.lfm2_002e5-2_002e6b__conv-1790009052954-coder001__4223925939`
  (**17 075 B** of KV session metadata). The report's cleanup claim
  "conversation keys now: `kalsa.conversations.v1` +
  `kalsa.messages.conv-…-696fm3wu` only" is literally true for those two key
  families but false as a description of the store: fixture-derived state
  survived, and the report's accounting does not mention it.

**Verdict: PARTIAL** — every listed item checks out; the store is not fully
returned to its pre-cell state (fixture compactor/summary/session-meta keys
remain, undisclosed).

## L. Integrity — report is in the LAB repo; labels present; several sentences state inferences as facts

- The report lives at
  `~/Projects/kalsa-moe-experiments/scratchpad/agents/meter-close/REPORT.md` —
  the lab repo proper (`.git` is a directory, not a worktree pointer), untracked
  as expected (no commit was allowed). NOT in a Paseo worktree, NOT in /tmp. ✓
- All four `**INFERENCE (not measurement):**` labels are present where claimed
  (two in section (d), two in the realconv section), plus the 8-item
  "Explicitly NOT verified" and 7-item "Updated NOT verified" lists. ✓
- Sentences that present an inference as if it were a measurement (quoted):
  1. "**The regression is not the engine pin.**" (line 50) — a one-point A/B
     whose build-attribution left no preserved trace, stated as a settled result.
  2. "This is a harness/URI size limit, not a model or engine result." (line 97)
     — the URI-size attribution was never isolated (any share-path failure looks
     identical from outside).
  3. Table row: "`KALSA_STALL` | … `tokPerSec:26.95` at ~1520 s" attributed to
     "original (Step B, old pin)" — conflates the original run with Step B and
     quotes a figure (26.95) that exists in no preserved artefact; Step B's
     preserved value is 29.332 at +1355 s.
  4. "the app went idle (71 jiffies/5 s ≈ 0.15 core)" and "app CPU 7155 jiffies /
     10 s ≈ 7.15 cores (sampled at ~13:43)" — single samples preserved nowhere,
     presented as measurements. Plausible, unverifiable.
  5. Minor: "(t4) 150.1 s vs 150.0 s" — the arithmetic gives 149.93 s, which
     rounds to 149.9, not 150.0.

---

# SEPARATE SECTION — methodology objections

**(i) The SQL-injected fixture as the ladder's conversation.**
`make_fixture.sh` wrote a 2-message conversation ("Ciao" / "Ciao! Come posso
aiutarti?") straight into `RKStorage` and put it at the top of the index with
`activeId` switched to it. Objections: the message shape (`id/role/text/createdAt`
only) is NOT the shape the app itself produces — real assistant messages also
carry `modelEmittedText`/`emissionSource`/`thinkingText`. Any code that reads
those fields can behave differently on this history, and it plausibly did: the
2c2 exception is `Cannot read property 'thinkingText' of undefined`, and 2 of the
fixture's 7 assistant messages lack that field. The ladder's token accounting and
textEst values are therefore measured on a synthetic history that no real user
conversation replicates. Mitigations the coder did make: transparent naming
(`coder001`), minimal seed, preserving the removed content as evidence, and
closing with the REAL-conversation test — which is exactly why the realconv run
matters. A careful experimenter would have flagged the shape mismatch BEFORE the
2c2 surprise, since it was knowable from the fixture design.

**(ii) Prompt delivery and the IME problem.**
The composer path cannot work on this build (typed characters reach the native
EditText but not React's `draft`, so `canSend` stays false — visible in the
preserved dumps: `ui-ime.xml` shows `2+2` in the EditText with no send). The coder
hit this mid-run, diagnosed the open-IME layout shift (dumps show the composer at
y≈386–447 with IME up vs y≈712–773 after close, matching the report's
account), and fell back to: draft set programmatically by the share harness,
IME closed, ONE composer `Invia` tap. Objections: the send method is not uniform
across the cell (share harness for the ladder; harness-draft + tap for realconv);
the realconv KALSA_SEND timestamps and the "no `am start` after 13:37:50" claim
are preserved NOWHERE, so the central "only variable changed was context size"
argument rests on unpreserved behaviour for its confound-control. The declared
deviation is to the coder's credit; the retention of evidence is not.

**(iii) "FIRST FAILING RUNG" as a description of rung 2c2.**
Not a fair headline. What failed at 2c2 was an app-level JS exception before
generation, in the injected fixture conversation, whose synthetic message shape
is a credible cause (or contributor); no model or engine limit was shown to be
involved, and no KALSA_THINKING was ever emitted. The report's own body says
this ("fails before generation starts… not with the slow-prefill shape", and
NOT-verified #6 declines to investigate the fixture's role "by instruction") —
but the rung label and the "last passing rung had prompt_n 2294; the next
deliverable rung failed" framing invite an input-size reading the evidence does
not support. "First rung that did not complete (app exception, possibly
fixture-induced)" is what was shown.

**(iv) Evidence retention (added by audit).**
The persistent raw capture (`ladder.logcat`) misses rungs 0/1a and stops at
13:26 — everything after (2c2 aftermath excepted, Step B excepted, the whole
realconv test) survives only as grep-filtered excerpts or not at all. For a cell
whose headline claim is a reproduced stall, the raw logcat of the reproduced
stall is the one artefact that had to be kept; it was not.

---

# Per-claim verdict ledger

| Claim | Verdict | Key evidence |
|---|---|---|
| A completing-turn coverage | **CONFIRMED** | Device re-pull byte-identical; 24 rows/23.2 s; +80 ms after KALSA_SEND; live platform mechanism verified |
| B schema + writer | **CONFIRMED** | v2 schema/columns byte-identical to `native/GovernorBatteryModule.kt` at `6a58ef5`; INVALID + uncalibrated-unit wording verbatim |
| C bracketing | **CONFIRMED** | Start `LlamaService.ts:4592` before turn try-block; stop `:5420` in `finally`; failing CSV +4 ms after THINKING, 0.309 s before Interrupted |
| D ladder + rates | **CONFIRMED** | t3/t4/t5 verbatim in raw capture; all 5 CSVs re-pulled; both rate readings recomputed; T20C 25.7 tok/s verified (caveat: rung 0/1a markers from filtered per-rung files) |
| E te≈tc growth claim | **CONFIRMED** | Ratios 0.74–0.98, te monotone; report's own table survives; defects: tc=te+tp+1 everywhere (off-by-one), t4 chain break (disclosed) |
| F Step B | **PARTIAL** | APK hash exact match; stall artefact genuine (tokPerSec 29.332, +1355 s); quoted pre-stall sequence, 26.95 figure, install attribution unverifiable; report table conflates Step B with the original run |
| G realconv reproduction | **PARTIAL** | STALL/THINKING/Interrupted + 739.04/790.04 s deltas confirmed from preserved captures; CSV growth live-corroborated; KALSA_SEND lines and CPU sample unpreserved; same-phenomenon = same shape, not proven identity |
| H deadline formula | **Report label TOO WEAK** — formula readable (`prefillDeadline.ts`, identical at both build commits); 739 s = no-EMA branch (est≈7385), 1355 s = EMA branch (rate 29.332 = 2147/73.1956, est≈7920–7949); both are outputs of the same watchdog |
| I failing-turn numbers | **CONFIRMED** | 779 rows/789.7 s; all ranges match; avg 805 763 µA = 0.806 A ✓ |
| J thinkingText scope | **CONFIRMED** | Exactly 1 hit in preserved fixture (createdAt 1790011382341), 0 in real conv (26 msgs) |
| K device state | **PARTIAL** | Every listed item verified; 3 undisclosed fixture-derived keys survive (compactor/summary/session.meta, 17 KB) |
| L integrity | **CONFIRMED** | Lab repo, not a worktree; all INFERENCE/NOT-verified labels present; inference-as-fact sentences quoted in section L |

# What I could NOT verify, and why

1. `tokPerSec 26.95` and the "~1520 s" STALL timing for the "original" run — no
   preserved artefact contains either (the 1520 s *notice* text IS preserved in
   the conversation store; the run's rate and identity are not).
2. That Step B ran the old-pin APK — the install event left no trace; only the
   on-disk APK hash (verified) and the coder's transcript support it.
3. Step B's quoted pre-stall marker sequence (SEND/PREFIX_FALLBACK/WINDOW/
   PREFIX_MEASURED/THINKING/PREWARM 73195.556) — `stepB-launch.logcat` ends
   before the send; preserved nowhere.
4. The realconv `KALSA_SEND` lines (13:37:50.208/.216), "last `am start`
   ~13:37:09", "no `am start` after the turn started", and both CPU jiffie
   samples (71/5 s; 7155/10 s) — no preserved artefacts.
5. The exact deadline-formula inputs (the `currentMessages` projection and any
   persisted `lastPromptTokens`) — the observable windows are consistent with
   the formula, but the inputs themselves are not recoverable.
6. Rung 2c's "composer stayed empty ~10 min" detail — no KALSA_SEND in the raw
   capture confirms non-delivery; the composer description is unpreserved.
7. 2c2's "engine was disposed (`Tocca per ricaricare`)" — no preserved UI dump.
8. Step B's `textEst 8242` (quoted, unpreserved; the realconv 8292 IS preserved).
9. Whether the two stalls share a root CAUSE inside prefill — no engine-side
   instrumentation existed; out of scope for both coder and auditor.

# Bottom line

**Is the Meter PROVEN to cover a completing turn? YES.** The rung-0 CSV, re-pulled
from the device and byte-identical across three copies, has 24 one-second rows
spanning 23.2 s from +80 ms after KALSA_SEND to past the turn's telemetry, all
statuses ok, a fuel-gauge-consistent charge counter, and a writer in the build's
own source that produces exactly this file and schema; the same bracketing holds
on the 150 s and 364 s completing rungs. This is proven, not plausible.

**Is the stall REPRODUCED? YES — as a recurrence; NO as a proven identity with
the original.** The zero-token prefill stall was reproduced on demand in the real
conversation with the current build, from preserved captures: KALSA_STALL
`reason:"prefill"`, tokens 0, at +739.04 s after KALSA_THINKING, Decoding
Interrupted at +790.04 s, with the Meter covering the failing turn (CSV grown
live from 5 to 779 rows). The report's stronger claim — that this is the SAME
phenomenon as the original 1520 s stall — remains an inference: the original's
own parameters survive only as a store notice and handover prose. The inference
is, however, materially stronger than the report knew: the deadline formula it
declared "not read" is readable in the repo, is identical in both tested builds,
and produces both observed deadlines (739 s via the no-EMA branch, 1355 s via the
EMA branch at the measured 29.33 tok/s) from the same watchdog — so the differing
deadlines are expected behaviour of one mechanism, not evidence of two.

*Audit closed. Every section above was completed; nothing was left untested that
the artefacts could decide. Read-only throughout: no install, no store write, no
S23 contact, no commits.*

---

# ROUND 2 — narrow confirmation of the four corrections (2026-09-21, ~14:45)

Method: coder's corrected REPORT.md read in full (596 lines, mtime 14:31, not edited
by me); every check below re-run from raw sources. Read-only on the device; app
verified STOPPED (`pidof` empty) before and during my pulls.

## 1. Deadline formula — PARTIALLY CORRECTED (core verified; two precision defects)

Verified: `src/engine/prefillDeadline.ts` sha256 =
`da82ba727816374a319a7ecb73daaa114b7ad65650987422b8159bdb2ca99d22` (recomputed; file
is committed-clean). Constants match the report. Both branch formulas match the code.
The old sentence "The formula was not read or verified" is gone; section (d) now says
"READ AND VERIFIED, not inferred"; section (e) item 4 and Updated-NOT-verified item 3
are re-scoped to the rate/gap watchdog thresholds outside the prefill deadline, not
merely deleted. Bonus: the newly recorded stale-docstring observation (docstring says
"90 s", constant is 180_000) is accurate.

Range recomputation:
- 739 s, branch 1: `ceil(est/10) = 739` → est ∈ {7381..7390}. Report's "7 381–7 390"
  is **right**.
- 1355 s, branch 2, rate 29.332381873019724 (which is EXACTLY 2147/73.195556 to all
  printed digits — the prefix-measured identification is confirmed): `ceil(est/rate)=271`
  → est ∈ (7919.743106, 7949.075488] → integers **{7920..7949}**. The report's
  "7 921–7 949" is **off by one**: est = 7920 gives ceil = 271 → 1355 s and is wrongly
  excluded.

On the brief's exact question: the branch BINDING is measured (each preserved STALL
line carries its own `tokPerSec`, null vs 29.332…, so "exactly those two branches" is
artefact-backed). But the estimate ranges beside it are reconstructions of an
UNPRESERVED input, and the report does not say so: no preserved artefact evidences
that Step B's est fell in 7 920–7 949, and my round-1 finding stands — every
text-based projection of the preserved 22-message store state gives est 7 222–7 630
(deadlines 1 235–1 305 s), so the real est must have come from a heavier projection
or a persisted `lastPromptTokens`, neither preserved. Line 212's "the differing
deadlines are the measured, expected behaviour of ONE watchdog … **not an inference**"
therefore over-reaches by one step: branch membership is measured; the est that made
the branch produce 1355 is not.

## 2. The 26.95 conflation — CORRECTED-VERIFIED

Table row now reads Step B = `tokPerSec:29.332381873019724` at **+1355 s** and today =
`tokPerSec:null` at **+739 s**, each citing its artefact and absolute timestamp — both
verified against `stepB-markers.txt` / `realconv-markers.txt` (preserved copies
hash-identical to the originals). `1520 s` / `26.95` now appear only in the UNSOURCED
paragraph (lines 441–444) and the corrections' own description; no table or sentence
attributes either figure to a measured run. Exactly two raw KALSA_STALL lines exist
across all preserved artefacts (grep-verified; the watch_real-out.log hits are watcher
annotations, not logcat lines). Two nits: the table column header still says
"original (Step B, old pin)" — every figure is now Step B's, but the word "original"
remains a conflation remnant; and "the literal `26.95` appears nowhere in this cell's
artefacts" is true only in intent — the substring occurs once inside a timestamp
(13:08:**26.95**7, ladder.logcat).

## 3. Cleanup gap — CORRECTED-VERIFIED

Pulled the store myself (run-as cat, app stopped) and diffed against my round-1 key
list: the diff is EXACTLY the three fixture keys removed
(`kalsa.chat.compactor…coder001` 116 B, `kalsa.chat.summary…coder001` 0 B,
`kalsa.session.meta…coder001…` 17075 B as I measured it); every other `kalsa.*` key
survives with an IDENTICAL value length, including
`kalsa.session.meta…conv-1789854932144-696fm3wu…` (486 B) and all six other
session.meta keys. `LIKE '%conv-1790009052954-coder001%'` returns 0 rows. Bench keys
are exactly the 7 with no `kalsa.bench.energy_trace`. 8 CSVs still on device; rung-0
and failing-turn CSVs re-pulled and byte-identical to the preserved copies. The
report's before/after table is honest and even quotes my round-1 length (17 075 B)
correctly. One wording defect: "the session-meta value evidently grew between the
review's read and mine" is conjecture — the app was verified stopped at both audits;
a WAL/checkpoint read-state difference between DB pulls is at least as plausible, and
the cause is not established. K is resolved: the store is back to its pre-cell state.

## 4. Raw artefacts — CORRECTED-VERIFIED

`raw/coder-artifacts/` exists with EXACTLY 27 files (8 CSVs in `device-energy/` +
19 others), list matching the report's enumeration. All 19 non-CSV files are
sha256-identical to the /tmp originals; all spot-checked CSVs are byte-identical to
the DEVICE files as of now. Coverage claim verified from the preserved copy:
`ladder.logcat` runs 12:48:12.573 → 13:26:10.479 with 0 occurrences of 12:45:50
(rung 0), 12:47:39 (rung 1a) and 13:37:50 (realconv), while rung 1b (12:48:28, 29
occurrences) is inside. `KALSA_SEND` count in realconv-markers.txt = 0. The report
now states the realconv KALSA_SEND lines, the CPU samples, and the rung-0 platform
cross-check text are transcript-only — all three statements are true.

Load-bearing stall numbers — artefact backing after the corrections:
THINKING 13:37:50.292, STALL 13:50:09.334 (prefill/0/null), Decoding Interrupted
13:51:00.336, both deltas, textEst 8292, and the 779-row CSV: PRESERVED. Step B STALL
12:23:37.381 @ 29.332: PRESERVED. "entro 739 s" / "entro 1355 s" notices: on-device
store (verified again this round). Still transcript-only: the realconv KALSA_SEND
lines (now disclosed), the CPU samples (now disclosed), the rung-0 cross-check text
(now disclosed) — and, NOT disclosed as such, Step B's quoted pre-stall block
including the `KALSA_THINKING 12:01:02.309` that anchors the "+1355 s" delta (the
delta itself is independently corroborated by the preserved STALL absolute time plus
the persisted notice).

## Round-2 status per item

1. Deadline formula — **PARTIALLY CORRECTED** (core verified: hash, constants,
   branches, label replacement, re-scoping; defects: 7 921 off-by-one → should be
   7 920; "not an inference" over-reaches while the est inputs are unpreserved).
2. 26.95 conflation — **CORRECTED-VERIFIED** (nits: "original" column header remnant;
   pedantic literal-substring match in a timestamp).
3. Cleanup gap — **CORRECTED-VERIFIED** (device diff exact; "evidently grew" is
   unsupported conjecture about the cause).
4. Raw artefacts — **CORRECTED-VERIFIED** (residual: Step B's quoted pre-stall block
   and its THINKING anchor are still transcript-only and absent from the new
   provenance-limits list).

Round-1 PARTIAL verdicts: **K resolved** (store back to pre-cell state, verified by
diff). **G resolved** — every claim now matches its evidence; same-phenomenon remains
an INFERENCE, and the corrected text labels it one. **F still partial, improved** —
the misquote is fixed, but the Step B quoted pre-stall sequence and the build-install
attribution remain transcript-only, now only partially covered by the new provenance
notes.

No corrected assertion was found to refute any round-1 finding; the two new defects
are the off-by-one and the "measured/not an inference"/"evidently grew" wording.

**Bottom line: both load-bearing conclusions stand unchanged.** The Meter covers a
completing turn — re-verified this round against the device and the preserved copies
(byte-identical). The stall is reproduced — the preserved marker chain
(THINKING 13:37:50.292 → STALL 13:50:09.334 `reason:"prefill"`, tokens 0 → Decoding
Interrupted 13:51:00.336, 739.04/790.04 s) is intact in the newly preserved
artefacts. Nothing in the corrections weakens either conclusion; round 2 closed with
no incomplete checks.
