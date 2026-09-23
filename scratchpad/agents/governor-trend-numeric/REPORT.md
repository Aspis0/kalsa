# governor-trend: numeric review of `trendCPerMin` (second reviewer, critique only)

Scope: `src/engine/governorTrend.ts` (118 lines) at `7921719`, its suite, and the wiring in
`src/engine/governorInputs.ts`. Nothing was changed, nothing committed, no fix is proposed here.
Every number below is either [ran] against the compiled module, [derived] from the engine
constants at the pin, [corpus] from the archived governor observations, or explicitly marked
[unverified].

Verdict up front: the arithmetic is right. Sign, units, absence semantics, and the three producer
guards do what the report says. I could not produce a large fabricated slope: an endpoint chord
cannot exceed the true peak rate over its span, so the false-positive *amplitude* is bounded by
whatever the battery sensor really does inside 60 s. The attacks that survive are about the
*scale of the threshold*, not the sign of it:

- the reported value is the mean rate over the poll gap: a sustained ramp is reported at its own
  rate, but a 60 s burst needs 7.0 C/min to fire at a 280 s gap and 1.5 at the floor;
- the engine only consults the field inside a 1.0 C band, where the trend gate can beat the
  absolute gate by at most 40 s, against a >= 10 min cost for a wrong fire;
- the "15x below threshold" margin is a resolution-only claim and was never measured; the
  author's own comment admits a 0.9 C jiggle that would consume 60% of the threshold.

---

## 0. Facts used as the ruler (verified at the pin, not from the report)

Engine `1577495b`, `src/llama-governor-policy.cpp`:

| fact | line | value |
|---|---|---|
| `k_trend_c_per_min` | 13 | `1.5f` |
| `k_dwell_ms` | 8 | `10 * 60 * 1000` |
| `k_flip_window_ms` | 9 | `60 * 60 * 1000` |
| `k_kill_c` | 12 | `43.0f` |
| unplugged thresholds | 44 | `{38.0, 36.0, 39.5, 36.5, 42.0, 34.0}` = `{warm_enter, warm_exit, cool_enter, cool_exit, critical_enter, critical_exit}` |
| the only reader of the field | 141-142 | WARM branch: `temp >= limits.cool_enter \|\| (temp >= limits.warm_enter + 0.5f && profile.trend_c_per_min >= k_trend_c_per_min)` |
| COOLMODE exit | 136-138 + 83-88 | `temp <= cool_exit && now - state_since_ms_ >= 10 min` |
| dwell clock reset | 152-154 | `state_since_ms_ = now_ms` on every state change |

Consequences that fix the whole risk calculus:

1. `trend_c_per_min` has exactly one consumer. Nothing else in the engine reads it.
2. The field is consulted only while the state is WARM. Unplugged that is `T in [38.0, 39.5)`;
   the trend condition additionally needs `T >= 38.5`. Plugged the band is
   `[t_idle+3.5, t_idle+4.5)`, also exactly 1.0 C wide, capped at 42.
3. `temp >= cool_enter` is tested first in the same branch, so at the moment the trend is
   consulted `T < 39.5` always.
4. Therefore a trend-driven escalation can beat the absolute escalation by at most
   `(39.5 - T_now)/R <= 1.0/R` minutes: 40 s at `R = 1.5`, 20 s at 3, 10 s at 6 C/min.
5. A wrong fire costs `>= 10 min` before the state may leave COOLMODE (dwell restarts at the
   fire), plus the time to cool from 38.5-39.5 to `cool_exit = 36.5`.
6. `batt_level_pct < 25` is tested before the WARM branch, so the trend is unreachable there.
7. On V73+MoE, COOLMODE additionally selects `GPU_COOLMODE` (`prefill_engine`, policy cpp
   165-187) and can engage `GPU_COOLMODE` decode (policy cpp 238-262) with `requires_reload`;
   the decode engagement is gated by `k_flip_window_ms = 60 min`. On V75/V79 both WARM and
   COOLMODE return plain `GPU` for prefill, so a wrong fire there changes the label and the
   dwell bookkeeping, not the prefill route.

One corpus check to set the empirical base [corpus]: across 204 archived governor thermo
observations (`scratchpad/agents/qdc-governor-s*/raw/**/*_status.txt`), 8 had `T >= 38.5 C`, 4 had
`trend >= 1.5`, and **0 had both**. The two trend values that exceeded 1.5 (1.569, 1.939) carried
temperatures of 34.4 C and 32.9 C, i.e. 12.5 and 17.0 tenths below the gate that would have let
them act. In the archived corpus the engine's trend branch could never fire.

---

## 1. Attack: false-positive ceiling vs detection floor

### 1.1 What the module actually computes

`reported = (T_last - T_anchor)/10 / ((t_last - t_anchor)/60000)`, both temperatures integers in
tenths of a degree, span `s >= 60000 ms`. Fires at the engine when `reported >= 1.5`. Rearranged
[derived]:

```
reported >= 1.5   <=>   deltaTenths * 6000 / span_ms >= 1.5
                  <=>   deltaTenths >= span_ms / 4000
                  <=>   integer deltaTenths_min = ceil(span_ms / 4000)      (1)
```

`deltaTenths*6000/span_ms` is exactly what the module returns [ran]. What it returns is the **mean
rate over the span**, so the rate grid is `6000/span_ms` C/min (0.1 at the 60 s floor, 0.0984 at
61 s, 0.0214 at 280 s, 0.02 at the 305 s edge) and, because each endpoint reading is rounded to
0.1 C independently, a true sustained rate `R` is reported within `+/- 6000/span_ms` of `R`.

### 1.2 False-positive ceiling

Resolution-only model (the author's): the reading is the true temperature rounded to 0.1 C, so each
endpoint carries <= 0.05 C; two endpoints give <= 0.1 C. At the minimum span:

```
FP_ceiling = 0.1 C / 1.0 min = 0.1 C/min = 6.7 % of 1.5            [ran]
(0, 320), (60 000, 321) -> 0.1
```

That part of the justification holds. Note the qualifier: 0.1 C is the *resolution* of the field,
not the *noise* of the sensor. The ceiling is linear in the endpoint error, so if the battery gauge
dithers by `E` C inside 60 s the ceiling is `E` C/min. The author's own comment supplies a value:
"a plausible 0.9 C wiggle" at a 30 s span. A 0.9 C wiggle is a property of the sensor, not of the
span, so at the 60 s floor the same wiggle reports 0.9 C/min [ran], 60 % of the threshold, and with
one rounding code on top 1.0 C/min. The honest margin is `1.5/0.9 = 1.67x`, not 15x.

### 1.3 Smallest real excursion, the rounding grid, and shape dilution

From (1), the smallest chord that fires is `ceil(s/4000)` tenths: 1.5 C at the 60 s floor, 2.3 C at
a 92 s span, 7.0 C at 280 s, 7.5 C at the 305 s edge. Two consequences:

- **Sustained ramp.** A ramp held over the whole span is reported at its own rate `R`, so the
trigger is `R >= 1.5` and does *not* scale with the span. The span only sets the grid: the decision
boundary is smeared by the endpoint rounding over `[1.5 - 6000/s, 1.5 + 6000/s]`, i.e. [1.4, 1.6]
at the floor and [1.479, 1.521] at 280 s. The systematic part is one-sided conservative: (1) demands
`ceil(s/4000)` tenths, so the minimum reportable rate is `ceil(s/4000)*6000/s`, equal to 1.5 exactly
when `s` is a multiple of 4000 ms and up to `1.5 + 6000/s` otherwise [ran].
- **Transient.** A burst of rate `R` lasting `d` seconds inside a span `s` contributes only `R*d/s`
to the mean, so the peak rate that fires is `1.5*s/d` [derived]. This is the real blind region, and
it is a region of *shape*, not of rate.

Because the temperatures are integers the boundary is quantised into whole codes, and one
millisecond flips the requirement by a whole code [ran]:

| span (ms) | min deltaTenths to fire | reported | deltaTenths-1 reports |
|---|---|---|---|
| 60000 | 15 (1.5 C) | 1.50000 | 1.40000 |
| 60001 | 16 (1.6 C) | 1.59997 | 1.49998 (miss) |
| 61000 | 16 (1.6 C) | 1.57377 | 1.47541 (miss) |
| 72000 | 18 (1.8 C) | 1.50000 | 1.41667 |
| 90000 | 23 (2.3 C) | 1.53333 | 1.46667 |
| 120000 | 30 (3.0 C) | 1.50000 | 1.45000 |
| 280000 | 70 (7.0 C) | 1.50000 | 1.47857 |
| 285000 | 72 (7.2 C) | 1.51579 | 1.49474 |

Concretely, a true sustained 1.5 C/min ramp is a coin flip at the floor: `(0,380),(60000,395) ->
1.5` fires, `(0,380),(61000,395) -> 1.47541` does not, `(0,380),(61000,396) -> 1.57377` does; at a
92 s span a 60 s burst needs 2.3 C/min; at the measured 280 s span a 60 s burst needs 7.0 C/min and
a 30 s burst 14.0.

Trigger-happy direction, same arithmetic read backwards: an endpoint excursion of `q` C inside the
span with no real warming is reported as `60q/s` C/min, which at the 60 s floor is exactly `q`
C/min. With `q = 0.1` (resolution only) a non-warming series reports up to 0.1 C/min, 6.7 % of the
threshold. With `q = 0.5` (plausible gauge dither over a minute on a phone under load) it reports
0.5 C/min, 33 %. With `q = 1.5` it fires.

Falsifier: `(0, 380), (60000, 395) -> 1.5` (fires) vs `(0, 380), (60001, 395) -> 1.499975` and
`(0, 380), (60001, 396) -> 1.599973`. A test asserting both directions pins (1) and the rounding
smear.

### 1.4 Real data check [corpus]

`qdc-governor-s5`, device `sa803609`, native battery path. Poll times reconstructed from the app's
own `KALSA_TELEMETRY` lines (`poll = log_ts - (promptMs + predictedMs)/1000`); temperatures from the
driver's status snapshots of the same turns:

| poll | gap | deltaT | reported by this estimator |
|---|---|---|---|
| t2 | 280.65 s | 3.5 C | 0.750 |
| t3 | 292.33 s | 2.1 C | 0.432 |
| t4 | 274.77 s | 1.6 C | 0.349 |

The battery rose 7.2 C over the session (30.3 -> 37.5 C, a sustained ~0.5 C/min) and the estimator's
best report was 0.75, half the threshold, because the reported value is the mean rate over a whole
inter-turn gap: firing would have needed a sustained 1.5 C/min for the full 280 s (7.0 C from the
anchor to the last poll), or a 60 s burst inside that gap at 7.0 C/min, or a 7.0 C step.

---

## 2. Attack: endpoint fragility, and what least squares would buy

Cases [ran]:

| input | reported |
|---|---|
| single +0.3 C step, span 61 s: `(0,380),(61000,383)` | 0.295 |
| single +1.5 C step, span 61 s: `(0,380),(61000,395)` | 1.475 (miss) |
| single +1.5 C step, span 60 s: `(0,320),(60000,335)` | 1.500 (fires) |
| first sample of a new source (producer guard) | series reset -> 0 |
| +6.5 C across a 285 s idle gap: `(0,320),(285000,385)` | 1.368 (miss; fires at 7.2 C) |

The structural defence is exact: the endpoint slope is a chord, and the mean over an interval never
exceeds `max|dT/dt|` over that interval. The estimator cannot report a rate the phone did not
actually pass through, plus `q/span` of sensor error. That is why no large fabricated slope came out
of any probe: a fire needs the sensor to really move at least 1.5 C between the two polled endpoints
at the floor span, 2.3 C at a 92 s span, or 7.0 C at the measured 280 s span. The fragility is
therefore in the *amplitude of the sensor's excursion between two polls*, not in the endpoint
algebra.

Least squares, quantified. With per-sample quantisation noise `sigma = 0.1/sqrt(12) = 0.0289 C`, the
1-sigma slope error in C/min is [derived]:

| samples in span | span 60 s | span 300 s |
|---|---|---|
| n=2 (endpoint, the measured feed) | 0.0408 | 0.0082 |
| n=6 | 0.0345 | 0.0069 |
| n=11 | 0.0275 | 0.0055 |
| n=31 | 0.0174 | 0.0035 |
| n=61 | 0.0126 | 0.0025 |
| n=301 | - | 0.0011 |

A single +1 C outlier at the last sample shifts the fitted slope by 1.000 C/min for n=2 (the
endpoint), by 0.095 C/min for n=61 over 60 s, and by 0.019 C/min for n=61 over 300 s [derived].
So OLS is materially better only above roughly 30 samples per span, and at the measured feed it is
*identically* the endpoint: 275-292 s poll gaps put 2 samples in the 300 s window, and OLS through
2 points is the endpoint slope. Three caveats the coder should not skip:

- the 1 Hz native sampler cannot feed this today: its CSV columns are
  `t_s, elapsed_realtime_ms, wall_clock_ms, current_uA, charge_counter_uAh, voltage_mV, x3 status`
  (`native/GovernorBatteryModule.kt:258-275`) with no temperature column, and there is no JS
  callback on the loop; a dense feed needs a new native surface;
- OLS over 300 s answers a different question (mean rate over the window) and would keep reporting
  a live 1.5 after a burst stopped, which is the behaviour the endpoint form deliberately avoids;
- OLS over 60 s with n=61 (a 1 Hz feed) would have a 1-sigma noise floor of 0.0126 C/min, 3.2x
  better than the endpoint's 0.0408; with n=11 it is 0.0275, only 1.5x better. It does not remove
  the underlying question of the sensor's excursion between polls.

Verdict: the endpoint form is honest given the feed. The feed, not the estimator, is the limit.

---

## 3. Attack: boundary and degenerate cases (concrete inputs, actual outputs)

All run against the compiled module [ran].

| # | input | reported | note |
|---|---|---|---|
| C1 | `[(1000,320),(1000,340)]` | 0 | identical timestamps, span 0 |
| C2 | `[(0,320)]` | 0 | one sample |
| C3 | `[]` | 0 | empty |
| C4 | `[(0,320),(60000,335)]`, now=60000 | 1.5 | exact floor fires (`>=` both in module and engine) |
| C5 | `[(0,320),(60000,335)]`, now=120000 | 1.5 | newest sample exactly 60 s old is fine |
| C6 | `[(0,320),(300000,340)]`, now=300000 | 0.4 | sample exactly 300 s old is kept |
| C7 | same, now=300001 | 0 | one stale sample drops -> absence |
| C8/C9 | NaN / Infinity temperature | 0 | dropped by `finite()` |
| C10 | NaN `nowMs` | 0 | |
| C11 | `0,71k,142k,213k @ 320,330,340,350` | 0.845 | irregular cadence, chord over 71 s |
| C12 | unsorted: `(120s,350),(0s,320),(60s,330)`, now=120s | 1.0 | correct answer for that set is 2.0 |
| C13 | unsorted: `(120s,350),(60s,330),(0s,320)`, now=120s | 0 | correct answer 2.0; silent 100 % loss |
| C14 | `0,61k,119k @ 320,340,360` | 2.017 | anchor skips the 58 s sample and jumps to 0 s |
| C15 | `[(0,320),(0,400),(60000,400)]` | 0 | zero-span pair correctly ignored |
| C16 | `[(0,300),(300000,400)]` | 2.0 | 10 C over the full window |
| C17 | `[(0,400),(60000,391)]` | -0.9 | cooling is negative, never escalates |

Producer level:

| # | sequence | reported | note |
|---|---|---|---|
| E1 | observe 320@0, observe 335@60000 | 1.5 | |
| E2 | then observe 335@305000 | 0 | previous sample 245 s back, delta 0 |
| E3 | observe 320@0, observe 390@60000 | 7.0 | |
| E4 | battery 320@0, **bench-skin 0 invalid @30000**, battery 335@60000 | 0 | the invalid cross-source observation wiped the series; expected 1.5 |
| E5 | battery 320@1000000, 326@1059000, **326@1058999 (1 ms back)** | 0 | whole series discarded |
| E6 | then 332@1120000 | 0.590 | trend unavailable for 61 s after a 1 ms clock step |
| E7 | battery 320@0, 385@285000 | 1.368 | across an idle gap; fires only at +7.2 C |

Sensor restart wrapped by a valid-looking reading: the guard only resets on `thermo_source`, and
`readThermo` reports an invalid sensor as `sensor_valid = false`, which is skipped without a reset.
A restart that produces a *valid* jump cannot make the trend gate earlier than the absolute gate by
more than the 40 s bound in section 0: for the trend to fire below `cool_enter = 39.5` while the
anchor is at `T_now - 1.5`, the anchor must be below 38.0, and the absolute gate is 1.0 C away.

Float32 narrowing at the JSI boundary, checked and cleared [derived]: `trend_c_per_min` is a
`float` and the binding reads it with `value_or(thermo, "trend_c_per_min", 0.0f)`. Float32 spacing
just below 1.5 is `2^-23 * 2 = 1.19e-7`, so a JS slope in `[1.5 - 5.96e-8, 1.5)` would round up to
exactly 1.5 and fire. With integer-ms spans that interval in `span_ms` is
`2666.67 * deltaTenths * 5.96e-8 = 1.6e-4 * deltaTenths` ms wide, i.e. below the 1 ms timestamp
granularity, so no reachable slope lands in it.

---

## 4. Attack: cadence mismatch and latency

What actually drives the sample series: `readGovernorThermo` -> `servedProfile` ->
`trendProducer.observe` (`governorInputs.ts:203-224`), and that function is called at completion
boundaries only - `LlamaService.ts:1171` (prewarm), `:4806` (per tool round), `:5259` (fallback),
`:5786` (memory extraction), `:6020` (translate), `:6141` (auxiliary), plus once at engine load
(`:2312`). It is **not** on the 1 Hz sampler path: `governorBatterySampler` starts the native CSV
loop (`startGovernorBatterySampling(..., TRACE_INTERVAL_MS = 1000)`), which has no temperature
column and no JS callback.

Measured cadence [corpus], `sa803609` 8-Elite native run, poll times as in 1.4:

- inter-turn poll gaps: 280.65 s, 292.33 s, 274.77 s; the 300 s window holds 2 samples, with
  8-25 s of slack before the anchor falls out and the trend reads 0 permanently;
- intra-turn round gap, from the same run's telemetry (`promptMs` 41.1-43.7 s + `predictedMs`
  ~2.3 s): ~46 s. Rounds that close are *below* the 60 s floor, so in a multi-round turn the anchor
  has to skip a round: samples at 0/46/92/138 s, newest-enough anchor at 46 s -> span 92 s. By (1)
  the smallest chord that fires grows to 2.3 C, so a *sustained* ramp still needs 1.5 C/min but a
  60 s burst needs 2.3 C/min (53 % more) and a 30 s burst 4.6 C/min: the gate's sensitivity to short
  events depends on how slow the prefill is. No archived run has `round > 0` (64 telemetry rows, all
  round 0), so this is derived from the per-round durations, not observed.

Answers to the cadence questions:

- Latency to a first report: 60 s of wall clock after the first sensor-valid sample of a source, and
  another 60 s after any source switch or backwards clock step. Zero forever when successive polls
  are more than 300 s apart, and zero for the first 60 s of every session including every engine
  reload that produces a fresh process.
- What the governor acts on at a turn boundary: the chord between the poll for the upcoming
  completion and the newest poll at least 60 s older - in practice the previous completion's poll,
  i.e. the *previous turn's average heating rate*, up to 5 min stale. Because the threshold is a
  fixed 1.5, the same physical behaviour passes or fails depending on the user's think time, the
  prefill duration, and tool latency (`web_fetch` 8-20 s, `document_chat` up to 190 s). That is a
  property of the design, not a coding error, but the report's claim that the estimator "tracks the
  recent rate" is only true when the polls are dense; at the measured cadence it tracks the previous
  turn.

---

## 5. Attack: the engine's own window makes the field nearly unreachable

This is the attack that decides whether any false positive is affordable [derived from section 0]:

- the field is consulted only in WARM, i.e. `T in [38.5, 39.5)` unplugged - exactly 1.0 C wide;
- `trend >= 1.5` with span `s >= 60 s` implies `T_anchor <= T_now - 1.5`, so the anchor sample is
  below `warm_enter = 38.0`: the phone crossed into WARM inside the span;
- the absolute gate fires at 39.5, at most `(39.5 - T_now)/R` later: 40 s at 1.5 C/min, 20 s at 3,
  10 s at 6. A trend-driven fire is never more than 40 s ahead of a fire the temperature alone
  would have caused, and for any `T_now >= 39.5` the absolute gate has already won;
- with a poll gap `g`, the chance that a poll lands inside that 1.0 C band during a 1.5 C/min ramp
  is `40 s / g`. At the measured 280.65 s gap that is 14.3 %; the mean lead inside the band is
  ~20 s, so the expected benefit is ~2.9 s per ramp;
- a fire that should not have happened costs at least 600 s of COOLMODE (dwell restart plus cooling
  to 36.5), i.e. ~200:1 against the expected benefit, and on V73 it can also burn the one-per-hour
  decode engagement budget and force a reload.

Therefore the estimator must be wrong less than roughly 1 time in 200 decisions for this to be
net-positive in time terms, and the corpus contains no measurement of that rate (0 fires in 204
observations, so also no evidence of benefit). This is the number the owner should demand before
merging, and it is not in the report.

---

## 6. Attack: producer-guard defects

1. E4, cross-source invalid wipe (`governorTrend.ts:92-97`): `observe` resets the series on a
   source change *before* checking `sensorValid`, so an invalid observation from the other source
   destroys a good series although nothing from it entered. Reachable when the bench key flips
   between polls and the native read fails in the same window. Cost: 60 s of absence (reported 0
   where 1.5 was available). Falsifier: the E4 sequence must report 1.5, not 0.
2. Unsorted input (C12/C13): `trendCPerMin` assumes array order == timestamp order
   (`:60` takes `fresh[fresh.length-1]` as "last"), enforces nothing, and is exported. Probes show
   -50 % and -100 % silently. Not reachable through `observe` today, which is the only production
   caller, but it is an undocumented contract on a public function. Falsifier: C12 must report 2.0
   or the function must sort.
3. Singleton with no session boundary (`:118`): `reset()` is called only from tests. Samples
   survive engine reloads, app background, and bench toggles. Fabricating a fire across such a gap
   needs +7.2 C at a 285 s span, and the <= 40 s bound of section 0 still applies, so this is a
   rate risk, not an amplitude risk. Falsifier: the first poll of a new session after a background
   gap must be shown to report >= 1.5 for a temperature delta the platform can actually produce
   while backgrounded; at a 285 s gap that is +7.2 C (E7 reports 1.516), and +6.5 C reports 1.368.
4. `Date.now()` wall clock. Backwards steps are handled by clearing everything (`:99-102`), which
   costs 60 s; a 1 ms step leaves 0 for 61 s (E5/E6). Forwards steps larger than 5 min empty the
   window (safe), smaller ones inflate the span and *under*-report (safe). If backward steps occur
   more often than once per minute the trend is permanently 0; frequency is unmeasured.
5. Bench payload with `"trend_c_per_min": 0` pins the field to 0 for the whole run
   (`governorInputs.ts:219`, `??` semantics), because 0 is finite and therefore "injected". The
   historical driver writes 0.000 on its first turn of every run (`d_run.sh` `make_thermo`), and 12
   archived status rows carry 0.000. Harmless on turn 1 (one sample would report 0 anyway), but any
   stored bench JSON with a literal 0 silently disables the estimator; the app cannot distinguish
   "injected 0" from "no data".

---

## 7. Attack: evidence gaps behind the central claim

1. The 0.1 C/min quantisation ceiling assumes the reported value is the true temperature rounded to
   0.1 C. The Meter cannot test this: the 1 Hz trace has no temperature column, so no 1 Hz
   battery-temperature series exists anywhere in the archive. The distinct values in the corpus
   (280, 282, 286, 287, 288, 290, 291, 293, 296, 301, 303, 304, 305, 306, 307, 309, 312, 323, ...)
   are consistent with 0.1 C resolution but come from different devices and turns, and do not prove
   that consecutive readings on one device dither by a full code. [unverified]
2. The internal-inconsistency check in 1.2: a 0.9 C jiggle is cited as plausible for the rejection
   of the 30 s span; the same jiggle at the accepted 60 s floor is 0.9 C/min, 60 % of the threshold.
   The stated 15x margin is only valid for a 0.1 C excursion.
3. Test coverage of the numeric core misses every case in 1.3 and section 3: no span at 60 001 ms or
   61 000 ms, no span near the window edge with a fixed anchor, no unsorted input, no cross-source
   invalid observation, no wall-clock step smaller than the minimum span. The suite's examples all
   use exact multiples of 60 s, i.e. exactly the spans at which the rounding smear vanishes.

---

## 8. Attacks ranked by whether they can make the governor act wrongly

Ranked by "can a wrong escalation to COOLMODE happen, and how bad", using section 0 as the ruler
(<= 40 s of benefit vs >= 600 s of cost, so any nonzero wrong-fire rate is expensive):

1. **Unmeasured 60 s sensor excursion (7.1).** Decides the false-positive rate outright and is
   currently an assumption, not a measurement. The amplitude needed is real: 1.5 C inside 60 s, or
   7.0-7.5 C across the measured 280-300 s gap. Every other attack is bounded by this unknown.
2. **The author's own 0.9 C jiggle (1.2).** If that number is real, the false-positive ceiling at
   the 60 s floor is 0.9-1.0 C/min, the margin is 1.67x, and a slightly worse excursion fires.
   Contradicts the 15x claim in the code comment.
3. **Shape dilution and the rounding grid (1.3, 4).** A sustained ramp is reported honestly at its
   own rate, but a 60 s burst needs 1.525 C/min at a 61 s span, 2.3 at a multi-round 92 s span, and
   7.0 at the measured 280 s inter-turn span (a 30 s burst, 14.0). The boundary around 1.5 is
   smeared by +/-6000/s (6.7 % at the floor, 2.1 % at 280 s) with a one-sided conservative bias of
   up to 6000/s. The engine acts on a quantity whose meaning for short events changes by 4.6x with
   the poll shape. No fabricated fire, but no calibration either.
4. **Cross-source invalid wipe (6.1, E4).** Real, reachable, costs 60 s of absence. Reported 0
   instead of 1.5. Only an inert failure.
5. **Singleton with no session boundary (6.3, E7).** Can present an inter-session chord as a live
   trend; needs +7.2 C at a 285 s gap, so a fast-charge warm-up while backgrounded is the only
   plausible route, and the section 0 bound still caps the lead at 40 s.
6. **Unsorted input (6.2, C12/C13).** Silently wrong by up to 100 %, but only through a caller that
   does not exist yet; both probes err toward no escalation.
7. **Wall-clock backward steps (6.4).** Fail-safe in every direction; can only make the feature
   inert. Frequency unmeasured.
8. **Bench payload pinning with 0 (6.5).** Bench only, first turn only, inert.
9. **Float32 promotion of 1.4999999 to 1.5 (section 3).** Checked and cleared: unreachable at 1 ms
   timestamp granularity.

Nothing in the sign, the units, the absence semantics, or the endpoint algebra is wrong. The
merge-blocking question is item 1, and the merge-blocking *number* is section 5: a wrong fire is
worth ~200 times what a correct fire buys, so the estimator needs a measured wrong-fire rate below
about 0.5 %, and no such measurement exists.

---

# R2. Re-attack on the fixes: `ed55f7d` (3 files, +141/-26)

Method: the new module was compiled to a scratch dir and the round-1 probe set replayed against both
revisions side by side. Regression first: of the 27 round-1 unit probes, **25 are byte-identical**;
the only two that changed are exactly C12/C13 (unsorted, 1.0 -> 2.0 and 0 -> 2.0), i.e. the intended
fix. Nothing else moved.

The "five tests fail before the source was touched" claim, checked rather than trusted. Replaying the
new tests' own inputs against the round-1 module [ran]: sort test old 1 vs new 2 (fails before);
gap-bridge producer old 0.6 vs asserted 0 (fails before); cross-source invalid old 0 vs asserted 1.5
(fails before); wiring gap-bridge old 0.24 vs asserted 0 (fails before); the source assertion cannot
pass against a file containing "far below" and no "1.67" (fails before). The margin *arithmetic*
test passes at 7921719 (0.1 / 0.9 / 1.667 that day too), which the coder states. So the claim is
substantiated: 5 fail-before tests, one of which is a comment assertion; the count is honest.

## R2.1 Fix 1 (gap anchoring) - CLOSED for its own path, claim too broad, two bridges remain

Closed: the resolved-invalid path now clears (`governorTrend.ts:128-132`). Probes: the exact
new-test sequence 320@0, invalid@90 s, 326@150 s returns **0** (round-1: 0.24), and rebuilds to
**0.6** at 240 s; the wiring-level sequence returns 0 where the old test expected 0.24.

Still open, two paths:

1. **The unobserved interval, i.e. the normal case.** A gap with no poll at all is not cleared by
   anything: +6.5 C across 285 s still reports **1.368**, +7.2 C **1.516** (round-1 E7, unchanged).
   At the measured 275-292 s cadence *every* reported value is a chord over an interval in which the
   sensor was never observed. So the comment's claim that "a later poll can never anchor a slope
   across an interval that was not observed" (`:129-130`) is true only for the sub-case where the
   app polled and the platform answered invalid; it is false for the dominant case.
2. **The rejected-read path.** `readGovernorThermo`'s catch (`governorInputs.ts:245-250`) returns the
   default profile without calling `servedProfile`, so `observe` is never invoked and the series
   survives; the next resolved read anchors across the no-data interval. Two presentations of "the
   sensor reported nothing" - rejected promise vs resolved `sensor_valid: false` - get opposite
   treatment. Falsifier: a rejected read followed 60 s later by a valid one reports the pre-rejection
   slope, where a resolved-invalid poll in the same position reports 0.

Cost of the clear, quantified (the question in attack 5). At the measured cadence the cost is
**0 s**: the sparse probe is identical old and new at 285/570/855/1140 s, because the last pre-clear
sample is already 570 s old at the next valid poll, i.e. outside the 300 s window with or without the
clear. At a dense 46 s round cadence the cost is **+92 s** (two round cycles): old reports 0.1304
from 138 s, new only from 230 s, because after the clear the anchor needs a >= 60 s span, i.e. two
more rounds. General: extra absence = the smallest cadence multiple >= 60 s after the first
post-clear valid poll; ~one cycle for g <= 240 s, zero for g >= 275 s. With invalid polls on every
cycle both revisions read 0 (the wiring gates the field on `sensor_valid`), so the clear adds nothing
there. Direction is safe: 0 never escalates at the engine.

## R2.2 Fix 2 (cross-source invalid) - NEW HOLE INTRODUCED

The two named cases are closed. Foreign invalid no longer wipes: 320@0, bench-invalid@30 s, 335@60 s
returns **1.5** (old: 0). Foreign valid still switches: 320@0, 335@60 s, bench-valid@60 s returns
**0** (unchanged). Alternating valid sources cannot form a chord because every switch clears first.

But the early return (`:118-121`) leaves the old series alive across the foreign period, so the next
same-source valid read anchors across it whenever the period is shorter than the window [ran]:

| sequence | round-1 | after fix |
|---|---|---|
| battery 32.0@0, bench-invalid @60/120/180 s, battery 38.0@240 s | 0 | **1.5** |
| same, battery 39.2@240 s (+7.2 C) | 0 | **1.8** |

The old code cleared on any source change *before* checking validity, so it could not bridge; the new
rule pair can. Trigger thresholds at a foreign period of 240 s: 6.0 C (fires), at 180 s: 4.5 C, at
60 s: 1.5 C - the window bound `1.5*span/60`. Reachability: bench only (the native path never
presents a foreign source), and requires a bench payload that parses with `sensor_valid: false` and
a boolean `plugged` so `profileFrom` returns a profile and `servedProfile("bench-skin",
false)` is reached. Production impact today: none. But it is a strict regression against the fix's
own safety claim, and it hands a bench build a way to fire a stale chord. Falsifier: the two rows
above must both read 0, or the foreign-invalid return must also clear.

Unreachable wrinkle in the same block: a foreign *valid* observation carrying a non-finite `nowMs`
clears the series and sets `source` without pushing a sample (`:122-127` then `:128-132`). Cannot
happen through `Date.now()` or `numberValue`; noted for completeness.

## R2.3 Fix 3 (unsorted input) - CLOSED, one contract residual

Closed: filter-then-sort means non-finite entries are removed *before* the comparator (NaN and
Infinity in the array return 1 and 0 with no throw [ran]); `.filter()` copies before `.sort()` so the
caller's array is not mutated (checked); and the 25/27 regression above proves the sort does not move
the anchor for already-sorted input.

Residual: duplicate timestamps are still order-dependent. `Array.prototype.sort` is stable, so ties
keep input order, and `fresh[fresh.length - 1]` (`:85`) then picks whichever tie the caller listed
last [ran]:

| input (same multiset) | reported |
|---|---|
| `(0,320),(60k,330),(60k,340)` | 2.0 |
| `(60k,340),(60k,330),(0,320)` | 1.0 |
| `(0,320),(60k,340),(60k,330)` | 1.0 |

So "input order is not trusted" (`:63-64`) holds for distinct timestamps only. Unreachable from
`observe`, where two samples in the same millisecond carry the same temperature, so this is a
contract residual, not a live defect. Falsifier: the three rows above. The sort itself costs
O(n log n) on <= 300 samples once per completion; no measurable cost.

## R2.4 Fix 4 (margin comment) - CLOSED on the numbers, one dangling provenance pointer

Both numbers rechecked against the module and my own arithmetic [ran]: one 0.1 C step across the
60 s floor reports **0.1** exactly, `1.5/0.1 = 15x`; a 0.9 C excursion reports **0.9** exactly,
`1.5/0.9 = 1.6667 -> 1.67x`. The cited section is the right one: my report section 1.2 is where the
0.1 C/min ceiling and the re-use of the 0.9 C figure are derived.

One defect, and it is a small honesty regression: the phrase "the 0.9 C sensor excursion **this
file** cites" (`governorTrend.ts:37`) has no antecedent. `0.9` occurs exactly once in that file
(grep count 1, that line). The figure's real provenance is the round-1 test comment "0.9 C in 30 s
would read 1.8 C/min" (`governorTrend.test.ts:32`), i.e. a hypothetical, or my report section 1.2.
The new test comment (`governorTrend.test.ts:82`) says "this file cites" and *is* accurate there,
which makes the source-file phrasing look copied from the test. The source assertion pins "1.67" and
the report path but not the provenance, so nothing catches it. The label also hardened from a
hypothetical ("would read") to a fact ("the 0.9 C sensor excursion"), which is the direction fix 4
was supposed to repair. Falsifier: grep `0.9` in `governorTrend.ts` and show the only hit is the
sentence that claims the file cites it.

Second observation, not numeric: the cited path is in the lab repo
(`kalsa-moe-experiments/scratchpad/...`), not the app repo; the file header acknowledges it. A
reviewer of the app repo cannot follow it. Owner's call.

## R2.5 Fix 5 (cadence note) - CLOSED, conclusion still true, two caveats

Numbers rechecked: 280.65 / 292.33 / 274.77 s (my measurements); ~2 samples per 300 s window;
slack 7.67 and 25.23 s, written as 8-25 s; `1.5*280/60 = 7.0 = 4.67x`; sustained ramps report at
their own rate; inert at today's cadence (0 in-band opportunities in the 204-row corpus).

Is the conclusion still true after the other fixes? Yes. The clear-on-invalid adds **0 s** of absence
at the measured cadence (R2.1), and the cross-source change adds a rare over-report path, not
availability. The field is not made inert more often in the measured regime; it is made inert for one
extra cycle at dense cadences (+92 s at 46 s rounds). Two caveats for the note:

1. it does not record that cost, which is the one availability change this round introduced;
2. "the real lever is the sampler's cadence" is misleading. The 1 Hz sampler's CSV has no
temperature column and no JS callback (round-1 section 2), and the cadence that matters for this
field is the `readGovernorThermo` poll cadence at completion boundaries. Changing `TRACE_INTERVAL_MS`
would not feed the estimator; the lever is a temperature reading on the poll path, i.e. a new native
surface. As written the note invites a future coder to touch the wrong knob.

## R2.6 The two questions

**Is the field now trustworthy as an input?** For everything that routes through `observe`, yes in
the sense of never lying upward without the sensor having moved: the value is a mean rate over a
polled interval, non-finite is impossible, the three reporting defects are closed, and the two
remaining bridges (bench-invalid window, rejected read) either need a bench payload or a native
exception, both capped by the same 300 s window and the 1.0 C engine band. Not yet *verified* as an
input: the 1.67x excursion margin rests on a 0.9 C figure that is itself an assumption with no
measurement behind it (round-1 section 7.1, and the fix has now promoted it to a factual label).
Honesty of the code: good. Honesty of the value: conditional on a sensor-noise measurement nobody
has.

**Is it useful as an escalation trigger at the measured cadence?** No. At 275-292 s polls the
engine's 1.5 C/min means 7.0 C of chord between two polls; the trend gate can beat the absolute gate
by at most 40 s inside a 1.0 C band and costs >= 600 s when wrong (200:1); the corpus shows 0
in-band opportunities in 204 observations; the field is 0 for the first 60 s of every session and
after any clear. The fixes made the field easier to defend and no more useful. Its value stays ~0
until a temperature feed at poll cadence exists, which this change does not add.

## R2.7 Verdict table

| # | attack | verdict | number |
|---|---|---|---|
| 1 | gap anchoring, resolved-invalid path | CLOSED | old 0.6/0.24 -> new 0; rebuild 0.6 |
| 1 | gap anchoring, unobserved interval | STILL OPEN (claim too broad) | +7.2 C/285 s -> 1.516 |
| 1 | gap anchoring, rejected-read path | STILL OPEN | no `observe` on throw (`governorInputs.ts:245-250`) |
| 1 | cost of clearing the series | acceptable, safe direction | 0 s at 285 s cadence; +92 s at 46 s rounds |
| 2 | cross-source invalid | CLOSED | old 0 -> new 1.5 |
| 2 | foreign-invalid window between same-source reads | NEW HOLE INTRODUCED | old 0 -> new 1.5 / 1.8 |
| 2 | foreign-valid switch | CLOSED | 0, unchanged |
| 3 | unsorted input | CLOSED | 1.0/0 -> 2.0/2.0; 25/27 probes unchanged |
| 3 | duplicate-timestamp ties | STILL OPEN (contract residual) | 2.0 / 1.0 / 1.0 for one multiset |
| 4 | margin numbers | CLOSED | 0.1 -> 15x; 0.9 -> 1.67x, both exact |
| 4 | "this file cites" provenance | STILL OPEN (comment only) | `0.9` grep count in source = 1, that line |
| 5 | cadence conclusion after the fixes | CLOSED | 0 s availability delta at 285 s |
| 5 | "lever is the sampler's cadence" | STILL OPEN (wording) | trace CSV has no temperature column |
