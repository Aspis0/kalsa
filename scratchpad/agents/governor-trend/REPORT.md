# governor-trend: produce `trend_c_per_min`, carry the raw platform thermal state

Date: 2026-09-23 (overnight). Task: recon ranking #1
(`scratchpad/agents/governor-meter-recon/REPORT.md`, "THE RANKING" item 1), coder pass.

| item | value |
|---|---|
| repo | `~/Projects/kalsa` (app) |
| worktree | `/Users/marco/Projects/kalsa-wt-gov-trend` |
| branch | `kalsa-governor-trend`, based on `kalsa-app-landing` = `e206a94` (the landing line: 94 suites / 1214 tests green at baseline) |
| commit | `7921719` "governor : produce trend_c_per_min, carry the raw platform thermal state" |
| push | NOT RUN (command in section 6; owner holds push, and the repo rule requires Marco's approval + audit first) |
| devices | untouched (both phones left to the measurement agent) |
| engine / binding | untouched (pins stand: engine `1577495b`, binding `5b966218`) |

## 1. Consumer side read first (what the engine actually expects)

Read at the pinned revisions, not at HEAD:

- Struct `llama_governor_thermo_profile` (`kalsallama` at pin `1577495b`,
  `src/llama-ext.h:269-277`): `float trend_c_per_min = 0.0f`.
- Consumer: `src/llama-governor-policy.cpp:137-141` (pin `1577495b`): WARM escalates to COOLMODE
  when `temp >= warm_enter + 0.5 && profile.trend_c_per_min >= k_trend_c_per_min`, with
  `k_trend_c_per_min = 1.5f` at `:13`. Therefore: **unit is degrees Celsius per minute of battery
  temperature, positive = warming.** The sign is "delta over delta-t of the same quantity the
  profile carries as `batt_temp_tenths_c`".
- Validity gates, unchanged by this work:
  - `profile_is_valid` (`:53-64` pin): refuses `!sensor_valid`, **non-finite trend**, level outside
    0..100, and on the plugged branch its own `t_idle` rules. A non-finite trend invalidates the
    *whole* profile (engine falls to `Invalid` -> prefill CPU, admit Abort, decode wait).
  - drift rule (`:97-111` pin): latches/judges/clears `t_idle_c` itself. The app sends `t_idle`
    raw (landing line `a855ab6` already deleted the app-side latch and range gate); this change
    touches neither `t_idle_valid` nor `t_idle_c`.
- Transport: binding at `5b966218`, `cpp/rn-governor-params.cpp:75-91` - `parse_governor_thermo`
  reads the seven known keys (`value_or(..., "trend_c_per_min", 0.0f)`) and **silently drops any
  other key**; structural check `governor_thermo_profile_is_valid` (`:93-101`) also refuses
  non-finite trend.

### The invalid / stale contract this producer obeys

- A reading the app cannot honestly produce reports **exactly 0**, the engine's own struct default
  and the binding's `value_or` default. Zero is finite, so `profile_is_valid` keeps refusing on
  *its* facts (`sensor_valid`, level, `t_idle`) and is never handed an excuse to nuke a good
  profile over an app-side data gap. That would be the app making policy by other means - the same
  defect class as the deleted latch.
- **Never NaN/Infinity.** Non-finite would flip the entire profile to `Invalid` -> Abort, turning
  "the app has no trend yet" into "the governor refuses everything". Zero fails safe (no
  escalation: `0 >= 1.5` is false); a falsified or NaN trend fails dangerous.
- The `isfinite` gate still receives only finite numbers and keeps doing its corruption job; the
  sensor/drift gates are untouched and still the only refusers.

## 2. The producer (app-only, one new module)

`src/engine/governorTrend.ts` (new, 118 lines):

- Samples are real `readGovernorThermo` poll observations only: `{tMs, tempTenthsC}`.
  **No interpolation, no smoothing, no derived charge math** (see section 4).
- `trendCPerMin(samples, nowMs)`: filters to the **5 min window**
  (`TREND_WINDOW_MS = 5*60_000`), takes the newest sample at least **60 s** old
  (`TREND_MIN_SPAN_MS = 60_000`) as the anchor, returns endpoint slope in C/min.
  - Why the 60 s floor: battery temperature is quantised to 0.1 C; over a 60 s span that step
    contributes at most 0.1 C/min of slope, 15x below the engine's 1.5 C/min threshold. At a 30 s
    span a plausible 0.9 C wiggle would read 1.8 C/min and escalate the engine off a quantisation
    artefact. Below the floor the answer is 0 (absence), not a confident small number.
  - Why the newest-old-enough anchor rather than the oldest in window: it tracks the *recent*
    rate (early-warning semantics) with the same noise bound; a session-long anchor would report a
    stale average minutes after the rise stopped.
- `createTrendProducer()` owns the series with three honesty guards, each failing toward 0:
  - **source switch** (battery <-> bench-skin) resets - two different sensors must not produce a
    delta against each other;
  - **wall clock regression** resets - old timestamps cannot anchor a rate;
  - **invalid sensor** observations never enter the series (garbage temp never becomes a slope).
- `readGovernorThermo` wiring (`governorInputs.ts`): one `observe()` per served profile, then
  `trend_c_per_min = profile.trend_c_per_min ?? trendProducer.trend(nowMs)` for sensor-valid
  profiles, `0` for sensor-invalid ones, `0` on the failed-native fallback (with the comment
  "nothing honest to report"). A bench JSON that carries an explicit `trend_c_per_min` is still
  forwarded untouched - that is the bench injection channel for exercising the engine's escalation
  on-device.

Presence semantics to expect on the phone: first poll reads 0 (one sample), and the trend becomes
nonzero only once two sensor-valid polls of the same source land within the 5 min window at least
60 s apart. Sparse sessions (> 5 min between polls) read 0 persistently - that is the honest
absence, not a bug; the engine's absolute temperature thresholds still work there.

## 3. SEVERE: forwarded raw, and the honest stop line

- What the app did with it: `readToHardGate` (`platformThermalStatus.ts`) collapses everything
  below Android `CRITICAL` (=4) to `false`; `SEVERE` (=3) arrived in JS on the
  `KalsaThermal` listener and was dropped. That collapse stays for the *hard gate* - it is the
  established app policy (overlay at CRITICAL) and changing it would be exactly the
  reintroduced app-side policy the task forbids.
- What was added: `readPlatformThermalState()` in `platformThermalStatus.ts` - raw read, no
  threshold, fail-open to `null`, never a fabricated state. `readGovernorThermo` now attaches it
  to every snapshot as `platform_thermal` (so the 69x `ThrottlingStatus: SEVERE` at 47 C skin is
  now present, as measured, in each governor observation the app produces), and
  `nativeGovernorThermo` passes it into the `setGovernorThermo` push and the load-time
  `governor.thermo` payload unchanged.
- **Honest stop line:** the pinned binding's `parse_governor_thermo` (`rn-governor-params.cpp:75-91`)
  copies known fields only - `platform_thermal` dies at the JSI boundary today, and the pinned
  engine struct (`llama-ext.h:269-277`) has no field for it either (verified at pin `1577495b`,
  at engine HEAD, and on local ref `kalsallama-governor-sole-decider`: no platform-thermal field
  exists anywhere in the engine). **SEVERE cannot reach an engine decision app-only.** Making the
  engine decide on it needs one struct field + one binding line + the five-step pin chain - i.e.
  recon Option 3 travel, three repos, which this task scoped out. The app half is done and carries
  no policy: measure, attach, transport as far as the contract reaches.
- Test pin: `forwards the raw platform thermal state without deciding on it` asserts
  `androidStatus: 3` survives as the number 3, not a boolean.

## 4. Units and layering (task item 3)

- `trend_c_per_min` is a **temperature** rate: battery `EXTRA_TEMPERATURE` tenths over wall-clock
  minutes. `CURRENT_NOW` / `CHARGE_COUNTER` (`GovernorBatteryModule.kt:180-181`) are not read,
  not differenced, not converted - their per-device units stay uncalibrated and untouched.
- No charge-counter rate was computed, so no uncertainty figure is owed for one. For the record:
  a mAh/min from the counter could only be honest at the counter's own tick granularity
  (measured: 29460 uAh Jelly, 33750 uAh S23 per step, minutes apart), never at the 1 s poll
  rate - so none was invented. Nothing in this diff smooths a coarse quantity into a confident
  number.
- Layering held: the app measures (raw polls) and transports (snapshot -> JSI); every refusal
  decision stays in `profile_is_valid` / the drift rule; no new threshold was born app-side
  (`k_trend_c_per_min = 1.5` remains engine-only). The app latch stays deleted.

## 5. Tests

Baseline measured in this worktree before any edit (landing line, symlinked `node_modules`):

```
Test Suites: 94 passed, 94 total
Tests:       1214 passed, 1214 total
```

After the change, full suite + typecheck:

```
$ npx tsc --noEmit        # clean (exit 0)
$ npx jest
Test Suites: 95 passed, 95 total
Tests:       1234 passed, 1234 total
```

Touched suites only: `3 suites, 37 tests, all passing`
(`governorTrend.test.ts` 13 new, `governorInputs.test.ts` 17 = 11 old + 6 new,
`platformThermalStatus.test.ts` 7 = 6 old + 1 new; +20 tests total, matching 1214 -> 1234).

New cases:

- synthetic series: rising -> 0.6 C/min positive, falling -> -0.6, flat -> exactly 0;
- absence: empty series -> 0, single sample -> 0, all samples outside the 5 min window -> 0,
  fresh sample with no old-enough anchor -> 0;
- invalid: sub-floor span (0.9 C in 30 s, would read 1.8 C/min) -> 0; NaN/Infinity inputs ->
  0 (never non-finite out); invalid-sensor observation excluded (asserted by the 0.24 vs 32.6
  discriminator); source switch resets; backwards clock resets and the series rebuilds;
- wiring in `readGovernorThermo`: first poll -> 0; two polls 90 s apart at +0.6 C -> 0.4 C/min;
  invalid poll reports 0 and does not poison the series; failed native read leaves engine
  defaults standing (trend 0, platform null); bench-injected 2.5 forwarded untouched;
  raw `SEVERE` (androidStatus 3) forwarded uncollapsed;
- raw reader fails open to `null` (no fabricated state).

## 6. Push command - UNRUN

```
git -C /Users/marco/Projects/kalsa-wt-gov-trend push -u origin kalsa-governor-trend
```

Not executed. Per the repo rule it additionally needs Marco's explicit approval and an audit
before any push; the owner said he holds push/upstream/tag.

## 7. Diff scope (against `e206a94`, commit `7921719`)

```
 src/engine/governorInputs.test.ts        | 117 +++++++++++++++++++++++++++++++
 src/engine/governorInputs.ts             |  49 ++++++++++++-
 src/engine/governorTrend.test.ts         | 108 ++++++++++++++++++++++++++++
 src/engine/governorTrend.ts              | 118 +++++++++++++++++++++++++++++++
 src/engine/platformThermalStatus.test.ts |   5 ++
 src/engine/platformThermalStatus.ts      |  17 +++++
 6 files changed, 411 insertions(+), 3 deletions(-)
```

No Kotlin, no binding, no engine, no `package.json`/lockfile, no new test file outside
`src/engine/` (the one new file is the producer's own suite; the repo already had 94).

Worktree note: `node_modules` in the worktree is a symlink to the main checkout's
(untracked, not staged, not committed) - jest and tsc resolve through it normally.

## 8. What I could not do honestly

1. **SEVERE -> engine decision:** impossible app-only; the pinned binding and engine have no field
   (section 3). The raw state is now carried up to that boundary and stops there.
2. **A nonzero trend on sparse sessions:** cannot be produced from what the app samples at that
   cadence; 0 is reported instead of extrapolated (section 2).
3. **Any charge/current-based rate:** not computed, deliberately (section 4); the recon's
   Option 4 wall (per-turn energy below one counter step) stands unfixed and unre-litigated here.

---

# Round 2 - review fixes (same branch, same worktree)

Date: 2026-09-23. Reviews read before touching anything:
`scratchpad/agents/governor-trend-audit/REPORT.md` (42 lines) and
`scratchpad/agents/governor-trend-numeric/REPORT.md` (412 lines).

| item | value |
|---|---|
| commit | `ed55f7d` "governor : close the trend producer's gap, order and margin findings" (on top of `7921719`) |
| diff scope | 3 files, **+141 / -26**: `governorTrend.ts`, `governorTrend.test.ts`, `governorInputs.test.ts` |
| push | NOT RUN (command in section R2.6) |

## R2.1 Failing-before evidence (recorded, then fixed)

Tests were written first, run against the unfixed code at `7921719`:

```
Test Suites: 2 failed, 2 total
Tests:       5 failed, 30 passed, 35 total

  ● createTrendProducer › does not anchor a slope across an interval the sensor reported invalid
  ● createTrendProducer › keeps a valid series when the other source reports an invalid observation
  ● governor inputs › an invalid poll breaks the series instead of being bridged
  ● trendCPerMin › documents the true floor margin and cites the numeric report
  ● trendCPerMin › sorts unsorted input before anchoring (exported contract)
```

After the fix, all five pass and the full suite is green.

## R2.2 The four findings

1. **No slope across an unobserved interval.** Choice: **clear the series** on an invalid
   same-source observation (`governorTrend.ts`, `observe`). The invalid poll is the sensor saying
   "nothing here"; every older sample would otherwise let the next poll anchor a chord over that
   gap (measured by the audit: the old test expected exactly that bridge, 0.24 C/min over
   t0..t0+150 s with a blind 90 s middle). Now: invalid poll -> series empty -> next valid poll
   stands alone (trend 0) -> rebuild from observed samples only. Pinned twice: producer level
   (`does not anchor a slope across an interval the sensor reported invalid`) and wiring level
   (`an invalid poll breaks the series instead of being bridged`, read3 `0`, read4 rebuilds to
   0.6 = 0.9 C over 1.5 min).
2. **Cross-source invalid no longer wipes a valid series.** Order of checks in `observe` changed:
   foreign **and** invalid -> not applicable, return without touching state (numeric probe E4:
   battery 320@0, bench-skin invalid@30 s, battery 335@60 s now reports **1.5**, used to report
   0). Foreign **valid** still switches the series - two sensors must never form one chord - and
   that direction got its own pin (`still switches the series on a valid observation from the
   other source`) so fix 2 cannot be misread as "foreign never resets".
3. **Unsorted input sorted defensively.** `trendCPerMin` filters then sorts by `tMs` before
   anchoring, with the contract stated in the doc comment ("input order is not trusted"). Numeric
   probes C12/C13 (1.0 and 0 where the answer is 2.0) are now both 2.0, pinned in both orders.
   Sorting over refusing: an exported estimator that returns the right number for any order is
   more useful than one that throws, and both satisfy "not silently wrong".
4. **The margin comment corrected.** The old "far below the engine's 1.5 C/min threshold" is gone.
   What is true, now in the code at `TREND_MIN_SPAN_MS`: 0.1 C/min at the 60 s floor is a
   **resolution** margin (15x against 1.5); the 0.9 C sensor excursion this file itself cites gives
   0.9 C/min at the same floor, so the margin against a real excursion is **1.67x**
   (`1.5/0.9`). Derivations cited at `scratchpad/agents/governor-trend-numeric/REPORT.md`
   (section 1.2). Pinned by a source assertion (`documents the true floor margin and cites the
   numeric report`: requires `1.67` + the report path, forbids `far below`) - following the
   repo's existing source-assertion precedent in `governorBatterySampler.test.ts` - plus an
   executable arithmetic test (`reports the floor margins the numeric review states`:
   0.1 -> 0.1 C/min, 0.9 -> 0.9 C/min, `1.5/0.9 -> 1.67`). Honest note: the source assertion is
   the test that fails before; the arithmetic was always right - the comment was wrong.

## R2.3 Cadence note (added in code, not fixed)

A standing comment block now sits with the constants in `governorTrend.ts`, carrying the measured
numbers: poll gaps **280.65 / 292.33 / 274.77 s**, so the 300 s window holds ~2 samples with
**8-25 s of slack** before the anchor falls out; a sustained ramp is reported at its own rate
over the gap; a short burst is diluted by the span - a 60 s burst needs `1.5 * span / 60` C/min,
i.e. **4.7x** the threshold at a 280 s span; therefore **at the current cadence the field is
effectively inert, which fails safe - a note, not a bug**. The note forbids the wrong fix
shrinking window or floor: 60 s is the floor that keeps the 0.1 C resolution honest) and names
the real lever (the sampler's cadence), which was not touched tonight.

## R2.4 What this round does to the change's worth

The numeric review's numbers, not mine: the estimator's floor margin against a real sensor
excursion is 1.67x (was advertised as 15x); at the measured cadence the field is inert (0 fires in
204 archived observations - and 0 in-band temperatures); a wrong fire costs >= 600 s of COOLMODE
against <= 40 s of benefit, so the merge-blocking number remains a **measured wrong-fire rate,
which no archive contains** (numeric report sections 5, 7.1, 8). What this round bought: the three
defects that could have made the value wrong (bridge, wipe, order) now fail safe or correct, and
the file no longer overstates its own margin.

## R2.5 Tests, counts

```
$ npx tsc --noEmit        # clean (exit 0)
$ npx jest
Test Suites: 95 passed, 95 total
Tests:       1239 passed, 1239 total
```

Before this round: 95 suites / 1234 tests. Delta: **+5 tests** (the 5 failing-before tests above;
two older tests that pinned the buggy bridge were rewritten to the corrected semantics, so the
touched suites went 37 -> **42 tests**, 3 suites, all passing). Full suite green, 95 suites.

## R2.6 Push command - UNRUN

```
git -C /Users/marco/Projects/kalsa-wt-gov-trend push -u origin kalsa-governor-trend
```

Not executed. Owner holds push/upstream/tag; repo rule additionally requires Marco's approval and
audit before any push.

## R2.7 Standing limits (unchanged from round 1)

- Engine threshold, app policy and field units untouched: no engine/binding file in either
  round's diff; the app still only measures and transports.
- SEVERE still stops at the JSI boundary (binding copies known fields only) - round 1 section 3.

---

# Round 3 - re-attack fixes (last round on this file)

Date: 2026-09-23. Read first: appended section of
`scratchpad/agents/governor-trend-numeric/REPORT.md` (R2, lines 413-586 of 586) - its replay of my
five round-2 fail-before tests substantiated them (25/27 round-1 probes byte-identical, the two
changed being exactly C12/C13), so the earlier evidence stands.

| item | value |
|---|---|
| commit | `8e7ed2c` "governor : chord semantics, unified no-data, measured trend margins" (on top of `ed55f7d`) |
| diff scope (round 3) | 4 files, **+180 / -32**: `governorTrend.ts`, `governorTrend.test.ts`, `governorInputs.ts`, `governorInputs.test.ts` |
| branch total vs landing `e206a94` | 6 files, **+674 / -3** |
| push | NOT RUN (command in R3.6) |

## R3.0 Failing-before evidence (recorded first, at `ed55f7d`)

```
Tests:  5 failed, 34 passed, 39 total   (the two trend suites, at ed55f7d)
  ● trendCPerMin › describes the estimate as a chord over observed endpoints
  ● trendCPerMin › states measured jiggle with the files it was measured from
  ● trendCPerMin › names the true lever: a temperature feed on the poll path
  ● createTrendProducer › keeps the chord across a foreign invalid period, with the judgement pinned
  ● governor inputs › treats a rejected read and a resolved sensor_valid:false the same way
```

Composition, stated plainly: item 2's test fails on **behaviour** (the rejected-read path reported
0.24); items 1, 3, 4, 5 fail on their **source assertions** (the comments they pin did not exist /
the old wording did), and each of items 1 and 3 also carries a behaviour assertion that passes on
both revisions - for item 1 that is the point, because the behaviour was to be kept.

## R3.1 Header claim narrowed to what the code does (claim fixed, behaviour kept)

The claim "a later poll can never anchor a slope across an interval that was not observed" is gone.
Nothing could make it true: with no poll there is nothing to clear, and the +7.2 C / 285 s ->
1.516 chord is the arithmetically honest mean rate over the endpoints. What the code now says
(`trendCPerMin` doc): the estimate is **a chord between two observed endpoints - the mean rate
between them, which says nothing about the path between the polls** - and the one-line consequence:
at the measured cadence a single chord can carry the field over the threshold, which is the
intended safety direction (early escalation), not a defect. The `observe` clear-branch comment was
narrowed to its real scope ("starts a fresh chord instead of pairing across this rejected
reading") and points at the chord semantics for the no-poll case. The +7.2 C / 285 s -> 1.516
probe is pinned in the test so the kept behaviour cannot silently change later.

## R3.2 The two presentations of "no data" unified (defect closed in code)

Rejected read (`governorInputs.ts` fallback, no `observe` -> series survived -> next valid poll
reported the pre-rejection slope, 0.24) vs resolved `sensor_valid: false` (cleared -> 0). The
fallback now presents the rejection to the producer
(`trendProducer.observe("battery", 0, false, Date.now())`) before returning the defaults, so both
paths clear. Test `treats a rejected read and a resolved sensor_valid:false the same way` runs
both presentations side by side over the same timeline and requires both successors to report 0 -
fails before on the rejected path's 0.24. Source-state check: in a leftover bench-source state
both presentations are foreign-invalid and both leave the series alone, so the two paths agree in
every series state, not only the common one.

## R3.3 The bridge round 2 opened: closed by judgement, pinned with its argument

Declared plainly: **this item was not closed in code; it was judged correct, the sanctioned
alternative.** The two-line argument, now pinned in the source at the early return
(`governorTrend.ts`, asserted by the test via `as if it never happened`):

1. "Not applicable" must mean "as if it never happened" - otherwise round 2's E4 fix was a lie,
   and the old clear-on-any-source-change rule (which this replaced) let a reading carrying no
   information about *this* sensor destroy a valid series: **0 reported where 1.5 was true**.
2. With the foreign period skipped, the surviving chord (battery 32.0@0 s -> 38.0@240 s = 1.5,
   +7.2 C = 1.8) is *identical* to the accepted no-poll chord of R3.1 - same honest endpoint mean
   rate, same 300 s window cap, same fail-safe sign discipline. Closing it would require either
   clearing on foreign invalid (breaks E4, re-measured 0 vs 1.5) or an age/count threshold - a
   policy born in the app, forbidden.

Reachability stays bench-only (a bench payload parsing with `sensor_valid: false`; production
native path never presents a foreign source) and bench can inject `trend_c_per_min` directly
anyway. Test pins both rows (1.5 and 1.8) plus the source argument.

## R3.4 The margin number measured from disk (hypothetical retired)

The 0.9 C figure had no antecedent in the source - provenance was a round-1 *test comment*. The
archived Meter CSVs were checked first as instructed: `kalsa-governor-battery-trace-v2` carries
**no temperature column** (schema line read from
`scratchpad/agents/meter-close/raw/coordinator-verify/1790009150962-t1.csv`), so the reviewer's
"no 1 Hz temperature series" stands for the Meter. The q62/q64 `raw/*.csv` grep hits are `# temp=`
= **LLM sampling temperature**, excluded. What *does* carry battery temperature on disk, measured
(`python3` over the three files, commands below):

| file (in app repo `out/`, see caveat) | cadence | span | sample-to-sample | 60 s endpoint max up | max down | chords >= 1.5 C, still climbing |
|---|---|---|---|---|---|---|
| `out/jelly-energy-baseline-20260916/idle-floor.csv` | 1 s on-device | 61 s | **0.0 C** (flat 22.0 C) | **0.0 C** | 0.0 C | 0 |
| `out/jelly-energy-baseline-20260916/phase-data/LFM2.5-2.6B-Q4_K_M_control_p1_none.csv` | 1 s on-device | 268 s | max step **1.0 C** (22.0->27.0 ramp) | **+2.0 C** | 0.0 C | **9/9** |
| `out/t20c-gate-20260916/energy-trace.csv` | 10 s host | 5601 s | max step 2.1 C (27.8->41.2 ramp) | **+3.7 C** | **0.9 C** | **18/21** (3 held at -0.1 C over the next 120 s, rise not undone) |

Commands: `awk`/`python3` endpoint pairing with windows [55 s, 65 s] per file, `batt_temp_deciC`
column (0.1 C units - the same quantisation the estimator sees), `ok=true` rows only for the host
trace. Full script in the shell log of this round.

**What went into the comment** (`TREND_MIN_SPAN_MS`, `governorTrend.ts`): the resolution number
(0.1 C across 60 s = 0.1 C/min, 15x, labelled *quantisation only, not a sensor guarantee*), the
measured idle 0.0 C / load +2.0 C / host +3.7 C, the ramp-backing 9/9 and 18/21, the largest
downward endpoint 0.9 C (negative sign, never fires), both file citations, the numeric report
still cited for derivations, and an explicit line that the round-2 0.9 C margin was a
test-comment hypothetical, never a measurement - retired. Conclusion in code: **the floor bounds
resolution, not real ramps; a real ramp crossing the threshold fires by design.**

Caveat recorded rather than hidden: `out/` is gitignored (`.gitignore:96`, `git ls-files out/` =
0), so the measured files exist on this disk and in archived copies, not in a fresh app-repo
clone - the same followability class the reviewer flagged for the lab-repo path. Both paths are
cited with their repo labelled.

Test `states measured jiggle with the files it was measured from` asserts both file paths, `3.7`,
the derivations citation, and forbids `this file cites` / `sensor excursion` / `far below` in the
source. The arithmetic test keeps 0.1 -> 15x as resolution, adds the measured +2.0 / +3.7 chords,
and relabels the 0.9 row as a scaling demo that was never a measurement.

## R3.5 Lever sentence corrected

Cadence note now reads: the real lever is **a temperature feed on the poll path** (the map's dead
high-rate native reader is the pattern: an in-process reader with no caller yet), *not* the trace
interval - the 1 Hz trace CSV has **no temperature column** at all. Pinned by
`names the true lever: a temperature feed on the poll path` (forbids the old sentence).

## R3.6 Tests, counts, push

```
$ npx tsc --noEmit        # clean (exit 0)
$ npx jest
Test Suites: 95 passed, 95 total
Tests:       1243 passed, 1243 total
```

Before this round: 95 suites / 1239 tests. Delta **+4 tests** (items 1, 2, 3, 5; item 4's test is
the rewritten round-2 source assertion, net 0; the arithmetic test was relabelled, net 0). Touched
suites 42 -> **46 tests**, 3 suites, all passing. Fail-before captured in R3.0.

Push command - **UNRUN**:

```
git -C /Users/marco/Projects/kalsa-wt-gov-trend push -u origin kalsa-governor-trend
```

Owner holds push/upstream/tag; repo rule requires Marco's approval and audit first.

## R3.7 Declared "I could not"

Nothing in items 1-5 was skipped. Two honest sub-answers inside them: (a) item 3 was resolved as
judgement + pin, not a code close, because every code close either re-breaks E4 or needs an app
threshold - both forbidden (R3.3); (b) the measured margin is bounded by three archived sessions
on two devices, and `out/` is untracked - the comment says "measured from the archived traces",
not "the sensor's guarantee", and the merge-blocking wrong-fire-rate measurement the numeric
report asks for (R2.6) still does not exist on disk.

---

# Round 4 - the wrong-fire rate, measured offline

Date: 2026-09-23. Task: measure, from archived data only, the number the numeric report called
missing (R2.6): how often the trend-driven escalation would be **wrong**, against the reviewer's
**200:1** asymmetry bar (a trend fire gains <= 40 s inside the 1.0 C band; a wrong fire costs
>= 600 s of COOLMODE, so the estimator must be wrong less than about 1 time in 200 decisions).

| item | value |
|---|---|
| app repo diff | **none** - this round changes no app file (worktree clean, only the node_modules symlink untracked) |
| artifacts added | `scratchpad/agents/governor-trend/replay-wrongfire.cjs` (harness, declarations in its header) and `replay-out.txt` (raw output) |
| estimator under test | the REAL `governorTrend.ts`, compiled from the worktree at `8e7ed2c`, sha256 `2769fc2c11c948ab0775c52619862c08a90a07f33fdb3d8f63e551f943afab63` |
| tsc / jest | `npx tsc --noEmit` clean; `npx jest` **95 suites / 1243 tests** (unchanged - no code touched) |
| push | NOT RUN (command in R4.7) |

## R4.1 Declarations (the trap, named first)

1. **The engine never ran.** The decision side is a **re-implementation of one rule**, written
   from source at engine pin `1577495b` and cited there: `k_trend_c_per_min = 1.5f`
   (`src/llama-governor-policy.cpp` L13); thresholds struct field order
   (`src/llama-governor-policy.h` L45-52); unplugged `{38.0, 36.0, 39.5, 36.5, 42.0, 34.0}`
   (policy.cpp L44) so the trend line in WARM escalates when `temp >= warm_enter + 0.5` (38.5)
   and `trend >= 1.5`, and only when `temp < cool_enter` (39.5) can the trend change the decision
   (policy.cpp L140-143); plugged band `[t_idle+3.5, t_idle+4.5)` via L46-51;
   `batt_level_pct < 25` preempts to LOWBAT (L128). No dwell, no prior-state residency, no
   closed-loop trajectory is simulated - each poll is judged open-loop, escalations counted once
   per contiguous episode.
2. **The estimator is the real code**, not a re-implementation: `governorTrend.ts` compiled with
   `npx tsc src/engine/governorTrend.ts --ignoreConfig --outDir /tmp/govtrend-replay --module
   commonjs --target ES2020 --strict`, required by the harness; sha256 printed at startup.
3. **The true/false yardstick is mine, not the engine's.** TRUE = temperature reached cool_enter
   within 120 s after the flip (absolute gate imminent; the trend only front-ran it). FALSE =
   fell back below warm_enter within 120 s without reaching cool_enter. Otherwise UNRESOLVED.
   Raw numbers are reported per flip regardless.

## R4.2 Corpus (what is actually on disk)

Loaders: qdc status snapshots, energy-sample CSVs, the host dumpsys trace, s23 gpu-bench CSVs,
the s23 plugged reference, and per-turn sysprobe snapshots. Inventory result:

| source | files | rows | note |
|---|---|---|---|
| qdc `*_status.txt` (`qdc-governor-s5*`) | 116 found, 102 parsed | 102 | one line per turn, `anchor_epoch` as poll time; **driver `trend_c_per_min` fields ignored and recomputed** by the real estimator |
| energy-sample CSVs (kalsa + lab base-tree) | 68 found, **31 unique**, 37 duplicate copies skipped | 7221 | `batt_temp_deciC`, ~1 s cadence |
| host trace `out/t20c-gate-20260916/energy-trace.csv` | 1 | 552 | 10 s poll, level + plugged in file |
| s23 gpu-bench `raw/q2/*.csv` | 1 of 4 usable (others < 60 s or covered) | 637 | `batt_temp_dC`, ~1.5 s; plugged from current sign |
| s23 `plugged_idle_reference.csv` | 1 | 25 | plugged; `t_idle` latched from first plugged sample (engine rule) |
| per-turn sysprobe pre/post (`out/bench`, `out/device/kill-campaign/*`) | 367 stamped | 367 | **file mtimes are dead - all 1789052062, one bulk copy**; in-file `epoch=` stamps used; `thermal.txt` dropped (no stamp) |

Explicitly excluded with reason: Meter CSVs (no temperature column, round 3); q62/q64 `# temp=`
(LLM sampling temperature); logcat/`.slice` matches (HAL-error text only); root
`device-kill-campaign/` (duplicate of `out/device/kill-campaign/`, same 167 turns);
`jelly-energy-baseline/results.txt` (flat idle, same session as `idle-floor.csv`); **4 files
skipped as having no sensor-valid temperature at all** (`kalsa:device-s23-out/run1/*.csv` -
temperature cells empty in every row - these appear in the output as
"sessions skipped (no sensor-valid sample)").

**Totals loaded: 75 sessions / 8871 rows; 71 sessions replayed.** Assumptions declared in the
output: plugged-unknown treated as unplugged (project rule: never benchmark while charging),
level-unknown treated as >= 25, plugged sessions without a latched `t_idle` get no band.

## R4.3 Replay totals

Two cadences per session: **native** (every archived sample - the density a poll-path temperature
feed would have) and **grid-280s** (the measured production inter-turn gap, numeric report 1.4).

| cadence | polls | in-band opportunities (38.5-39.5, level OK) | flip episodes | TRUE | FALSE | UNRESOLVED |
|---|---|---|---|---|---|---|
| native | 8268 | **122** | **2** | 0 | 1 | 1 |
| grid-280s (production) | 235 | **15** | **0** | 0 | 0 | 0 |

Context: 13 of 71 sessions ever entered the band; 8 ever reached cool_enter (39.5); band polls
carrying a near-miss trend (1.0 to <1.5): 5. Corpus-wide maximum trends in band: 2.16 and 1.98 -
the two flips themselves.

## R4.4 The two flips, in full

**Flip 1 - UNRESOLVED (truncated).**
`s23-native-gpu-bench/raw/q2/gpu4.csv`, native cadence, t+264 s of a 266 s session:
temp 38.6 C, trend **2.1615**, unplugged (current -2758 mA). The file stops ~2.5 s after the
flip sample, still at 38.6 C: no fall below warm_enter and no reach of cool_enter is recorded
before the series ends, so the verdict is UNRESOLVED - counted neither true nor false. The
session context: 29.2 -> 38.6 C over 266 s (a fast ramp), recording ends at the top of it.

**Flip 2 - FALSE.**
`out/device/kill-campaign/armD-qwen35-2b-cold`, native cadence, t+321 s:
`battery_deci_c=386` (38.6 C), trend **1.9811**, `battery_level_pct=43`,
`battery_ac_powered=false` - every gate genuinely passes. Trajectory from the stamped series:

```
t+215s  35.1   turn3 pre
t+321s  38.6   turn3 post   <- flip fires here (anchor t+215: +3.5 C / 1.77 min = 1.98)
t+333s  37.1   turn4 pre    <- 12 s later: below warm_enter (38.0)
t+426s  37.2   turn4 post
...
t+1537s 39.7   session max  <- the absolute gate came +1216 s later
```

Verdict **FALSE** by the declared yardstick (fell below warm_enter within 120 s, never reached
39.5 in the window). And by the reviewer's own arithmetic the realized benefit is zero, not just
small: the absolute gate still fired 1216 s later, ~30x the <= 40 s lead the trend can ever buy,
while the COOLMODE dwell would have restarted at the fire for a spike that collapsed in 12 s.

gpu4 (flip 1) stays UNRESOLVED: the file stops ~2.5 s after the flip sample at the same 38.6 C -
no fall and no reach is recorded on disk. It is neither counted as true nor as false.

## R4.5 The ratio, stated the way it closes

- **At the production cadence the count is zero: 0 flips in 235 polls, 15 in-band opportunities,
  71 sessions. On the archived corpus the feature is inert - and therefore unproven, NOT safe.**
  Zero decisions means zero measurements: no wrong-fire rate exists at the cadence the app
  actually polls.
- At dense cadence the count is **2 flips, of which 1 is classifiable and that one was FALSE, 1
  is truncated.** Against the 200:1 bar this corpus is not "a bit thin" - it is orders of
  magnitude short. Even zero wrongs among n classifiable flips only bounds the wrong-rate below
  0.5% once n >= ~600 (rule of three); the corpus has **n = 1**, and that one was wrong. A single
  data point cannot distinguish 0.5% from 50%, in either direction.
- **Corpus size, honestly:** 71 sessions and 8871 rows is the file count, not the sample. The
  decision-relevant sample is **122 in-band opportunities (15 at production cadence) producing
  2 flips with 1 recorded outcome.** A corpus this size that agreed with the hypothesis would not
  be evidence for it either - and this one does not even agree: its only classifiable flip is a
  false fire.
- The missing quantity is named: **in-band time at poll cadence with a recorded outcome.** The 8
  sessions that reached cool_enter contribute 15 band polls at production cadence between them.
  Until a session records poll-cadence temperatures inside the band with what happened next, the
  wrong-fire rate stays unmeasurable from disk, and the branch stays unproven.

## R4.6 Limits of this replay

Open-loop (no dwell/prior-COOLMODE simulation - a real with-trend fire would change later
states); verdict yardstick is mine; turn-session timestamps are in-file `epoch=` stamps (mtimes
dead); qdc provenance is driver status snapshots; plugged-unknown/level-unknown assumptions as
declared in R4.2; one-sided corpus (bench/campaign sessions, mostly Jelly + S23, no session
designed to sit in the band). Nothing here ran the engine, touched a phone, or changed an app
file.

## R4.7 Push command - UNRUN

```
git -C /Users/marco/Projects/kalsa-wt-gov-trend push -u origin kalsa-governor-trend
```

Not executed (unchanged from prior rounds; owner holds push/upstream/tag; repo rule requires
Marco's approval and audit first).
