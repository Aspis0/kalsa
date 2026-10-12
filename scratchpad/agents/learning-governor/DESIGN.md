# Learning governor - DESIGN v0.3 (2026-10-12)

Author: Claude Fable 5.1 (architect, owner-granted exception). Design only: no code, no build, no phone.
v0.3 revises v0.2 after AUDIT-2 and the owner's decisions of 2026-10-12 (Xiaomi pacing lines skin 39.0 / 42.6 C =
headroom 0.083 / 0.203; "blind abstains, zones decide, both must pass when it speaks" approved; Stage 0 private
numeric file approved; margins must not be so conservative that the rule never fires). v0 -> v0.2 answered all
14 AUDIT-1 findings; AUDIT-2 records their verdicts, and the ones it kept open are in the table of section 1.
Inputs: engine `f1f612388`, binding `2581a9aa`, app `df359450`, lab cells 75, 76, `xiaomi-g2-inapp-233486dd`,
`s23-g2-full099-233486dd`. Every `file:line` was read this session and the line is quoted; ASSUMPTION marks what
was not measured.

## 0. For the owner, in short

HEAT_RANK puts every 32-token window on the coolest fit leg. v0.3 adds one rule on top: **while the phone is
cold, take the fastest fit leg; once warm, HEAT_RANK decides as today.** Cold is read live at every window from
two sources in degrees C: the component zones (every window) and Android's forecast (every 2 s). The forecast
reads 0 below 36.5 C skin on the Xiaomi: a 0 is blind and abstains, the zones decide with HEAT_RANK's own fit
test. Once the forecast speaks, both must pass: the zones still fit the leg, and the forecast has room for the
next 10 s of that leg's heat plus 0.5 C.

How conservative, in numbers (section 4.4): the heat estimate in the margin is the mean plus one standard
deviation, seeded at 1.25x the lab row; the lookahead is the 10 s Android itself forecasts ahead. With your
39.0 C line the GPU then runs from a cold start until skin ~37.6 C, and the worst case if the true heat is
twice the estimate is a forecast crossing the 39.0 line by 0 C (the 0.5 C margin absorbs it); at three times,
0.7 C over the line, which means pacing at duty ~0.88 for a few seconds, then the breaker switches the GPU off
for the rest of the session and across model reloads. Pacing, the battery states and the Android status stay
the safety net, untouched.

Xiaomi 14 from skin 33.4 C: GPU at 21 tok/s for ~62 s, ~1,300 tokens, +31 % over the NPU seed (+36 % over the
measured 15.5), then NPU; from a 36 C start ~490 tokens. Learning in the app will barely widen that: the
margin and the lookahead dominate, not the heat estimate. The learner's job is to catch drift and a wrong seed,
and to feed the breaker. A lab repeat of cell 75 (three runs per arm, same start temperature) would calibrate
the seed faster than real-life rows can (section 5.5).

Real life: every input the rule reads carries its age and a stale one disarms; the observation uses wall time
and a cooling term; the breaker latch lives in the app and survives reloads; Stage 0 records one numeric row per
completion plus per-window samples, on your phone, no text. Cut to keep v0 small: section 2.

## 1. Changes from v0.2 (AUDIT-2)

| AUDIT-2 item | resolution | section |
|---|---|---|
| #4 finite is not fresh (10 s carry) | profile carries the finite read's time; `armed()` needs age <= 4 s; app profile age <= 120 s; status -1 disarms; status 2 lag bounded 0.34 C | 3 |
| battery / plugged per completion | `app_sample_ms` stamp; disarm past 120 s; numbers for what 120 s costs | 3 |
| #2 / Blocker: Xiaomi zone trips unmeasured | blind path bounded by the wake point (skin <= 36.5 C) and a 2,048-token blind cap per completion; Stage 0 logs trips and zone temperatures | 4.8, 8 |
| #5 rank-1 learnability | observation starts at the forecast's wake, from per-window samples: every cold completion that wakes is a mixed row; expected rows to identification; what the rule does meanwhile | 5.1, 5.5 |
| #7 UCB noise model unspecified; 4x cap no bound | posterior sd from the ridge with residual variance; cap declared a sanity bound, not a physical one; conservativeness decided by numbers | 4.4, 5.3 |
| #12 firmware without build change | accepted as undetectable; forgetting + breaker cover it | 5.6 |
| wall time vs `predicted_ms`; no cooling term | binding latches first/last decode step time; `wall_min` from it; first-order cooling regressor | 5.1, 5.2 |
| breaker lost at reload | app-side latch, persisted, 6 h expiry, sends `lookahead 0`; the column's prior widened | 4.7 |
| Stage 0 cannot replay overshoot | per-window ring in the binding (precedent `route_chunks[64]`, `llama-ext.h:610`), written into the row | 5.1, 8 |
| breaker bound under delay, blindness, reload | numbers in 4.4 and 4.7; blind path in 4.8 | 4.4, 4.7, 4.8 |
| arithmetic | auditor's values adopted (46.1 s / 968 tokens; +31 % / +36 %); every example recomputed with 0.083 / 0.203 | 4.5 |
| CMake registration missing | `src/CMakeLists.txt:37` and `tests/CMakeLists.txt:455-457` named in Stage 2 | 8 |
| "no pacing change" vs the lines | the Xiaomi lines are an app change, in scope, Stage 0 | 2, 8 |
| JSONL is device metadata | owner approved; numeric only, private dir, adb pull | 8 |
| Owner: 0.15 / 0.25 question | dropped; lines are 0.083 / 0.203 | 4.5 |

## 2. Scope

IN: (a) the speed pass inside HEAT_RANK's branch, on iff `decode_speed_lookahead_s > 0`; (b) in-engine speed EWMA
per completion; (c) app-side heat regression per phone, sent as an upper estimate through speed-only keys;
(d) the breaker, engine + app latch; (e) Stage 0 rows and per-window samples in daily use; (f) the Xiaomi lines
0.083 / 0.203 in `declaredSevere.ts`. OUT (cut, with the reason): prefill (GPU prefill fails the oracle, PLAN
"V81 ... logit oracle FAIL R2 again"); exploration probes (v0.1); a mid-turn setter (the breaker needs none: the
engine flag is per session, the app latch covers reloads); learning or arming while plugged; row-less phones
(`rn_legs_for` returns `{}`, `rn-legs-table.cpp:202` `return {};`); the battery as a third margin source (per-
completion stale, already inside the duty); a zone-scale heat model and any blend of the two sources (no measured
zone-to-skin conversion); an in-engine skin sensor (none exists in-app); a zone-based breaker (unmeasured
trips); a per-window native log line (the ring replaces it, logcat floods evict lines); a 2-sd UCB and the 20 s
lookahead of v0.2 (they can never pass the Xiaomi band, section 4.4); any change to pacing, thresholds,
admission or safety states beyond the two Xiaomi lines.
Units: both rows are skin C per 1k tokens (`xiaomi-legheat-76/REPORT.md:51`; ALIVE:101); the engine comment
`llama-ext.h:363-364` "battery C*s/token from the lab" is stale, rewritten in Stage 2 (comment only). The learner's
unit is forecast C per 1k tokens = headroom delta x 30 (`declaredSevere.ts:16` `DEGREES_BETWEEN_ZERO_AND_ONE = 30`).

## 3. What hop_decide reads, and when a stale input disarms

`hop_decide()` (`policy-hop.cpp:159`) runs at window boundaries (`policy.cpp:573-577` `if (window !=
decode_hop_window_) { ... hop_decide(window, tokens_since_prefill);`). v0.3 passes `now_ms` through from
`select_decode(int64_t now_ms, ...)` (`policy.cpp:544-545`; the runtime calls it with `ggml_time_us() / 1000`,
`llama-governor-runtime.cpp:196`). Two stamps are added to `llama_governor_thermo_profile`, both in that clock,
0 = unknown: `headroom_read_ms` (the time of the last FINITE forecast read, from the binding's
`platform_headroom_state_.read_us`, `rn-platform-thermal.cpp:39` `if (state.read_us > 0 && now_us - state.read_us
<= k_platform_thermal_carry_us)`; so a carried value shows its real age) and `app_sample_ms` (stamped by the
binding when the APP pushes a profile, `rn-governor.cpp:199` `set_thermo_profile`, and copied forward by the
native refresh, `:290` `llama_governor_thermo_profile updated = thermo_profile_;`).

| input | member | refreshed | disarms when |
|---|---|---|---|
| state, source | `state_`, `state_from_platform_` (`policy.h:178`) | every profile push | `state_ != FAST` or from platform |
| forecast | `profile_.platform_thermal_headroom` | <= 2 s (`rn-platform-thermal.h:28`), carried 10 s (`:25`), before every decode step (`rn-governor.cpp:116` `refresh_platform_thermal();`) | NaN, or `now_ms - headroom_read_ms > 4000` (one missed 2 s read) |
| status | `profile_.platform_thermal_status` | native 1 s, sent on change, escalation debounced 5 s (`rn-platform-thermal.h:22-23`) | `< 0` (absent is no vote for the floor, `policy.cpp:51`, and duty 1, `pacing-duty.cpp:50-56`: v0.3 requires a present 0 or 1); the 5 s lag costs 5 x 0.0672 = 0.34 C of GPU skin |
| battery C, level, plugged | `profile_.*` | app push per completion round (`LlamaService.ts:5243`) | `now_ms - app_sample_ms > 120000`; cost of 120 s: the Xiaomi battery rose 8 C in 90 min (`xiaomi-g2-inapp-233486dd/REPORT.md:31`), 0.2 C per 120 s; a plug-in mid-completion heats slower than that |
| duty | computed: `llama_governor_decode_pacing_duty(platform_thermal_headroom(), current_temperature_c(), decode_battery_lines(), state_, status, params_)`, the call pace_decode makes (`pacing.cpp:30-33`) | same inputs | `< 1.0` |
| zones | `present_headroom[]` (`policy-hop.cpp:182-197`) | every window (`rn-governor.cpp:181-183`) | any NaN: `all_known` false, alternation (`:274-278`), no pass |
| speed, heat ucb, bg | `speed_tps_[3]`, `params_.decode_speed_*` | completion latch / load | - |
| breaker | `speed_breaker_tripped_` | session | true |

## 4. The decision

### 4.1 Where

In `hop_decide`'s `ranked >= 0` branch (`policy-hop.cpp:232-234` `if (ranked >= 0) { decode_hop_leg_ =
present[ranked]; hop_rule = "heat_rank";`). The per-leg fit predicate is factored out of `heat_rank_fit`
(`:78-80`: current leg `>= guard_c`, idle `- load_step >= guard_c + k_hop_hysteresis_c`) and reused unchanged.

```
pick = present[ranked]                                  # HEAT_RANK's answer
if lookahead_s > 0 and armed(now_ms) and not breaker and blind_tokens < k_speed_blind_cap_tokens:
    fit  = { L in present : leg_fit(L) }
    fast = argmax speed_tps over fit
    if speed_tps[fast] >= 1.15 * speed_tps[pick] and forecast_ok(fast): pick = fast; rule = "speed_fit"
```
`lookahead_s == 0` (both rows today, engine default) skips everything: byte-identical, tested.

### 4.2 Arming

`armed(now_ms)` = every "disarms when" of section 3 is false. One test per input: WARM battery, platform-raised
COOLMODE, plugged, NaN forecast, forecast older than 4 s, app profile older than 120 s, absent status, status 2
via the floor, duty < 1 via the forecast, duty < 1 via the battery.

### 4.3 The margin: one unit, two sources (approved)

**Zone source**: `leg_fit(L)`, i.e. L's block has `load_step + guard + hysteresis` C to its first passive trip
when idle (`rn-thermal-legs.cpp:112` `headroom_c = static_cast<float>(zone.passive_trip_mc - temp_mc) / 1000.0f`),
`guard` once running. Xiaomi GPU: 11 + 5 + 4 = 20 C (`rn-legs-table.cpp:91` `5.0f, 11.0f, 26.0f, 5.0f`).

**Forecast source** (speaks iff `h_now > 0`; 0 is blind and abstains):
```
m_f       = (pacing_start - h_now) * 30
rise_f(L) = (heat_ucb[L] * speed_tps[L] / 1000 + bg_ucb / 60) * lookahead_s
forecast_ok(L) = m_f >= rise_f(L) + margin_c            (+ hyst_c to re-enter after leaving on this term)
```
`pacing_start` = `params_.decode_pacing_headroom_start` (Xiaomi 0.083, `declaredSevere.ts:46-57`);
`lookahead_s` = row, 10 s; `margin_c` = `hyst_c` = 0.5 C; `heat_ucb[L]` = the app's value when sent, else
`k_speed_prior_inflation x decode_heat_per_token[L]` = 1.25x (section 4.4); `bg_ucb` = sent, else 0.5 C/min.
**Combination**: `take L iff leg_fit(L) and (blind or forecast_ok(L))`.

### 4.4 How conservative (owner: "the minimum is too conservative")

The band the forecast can speak in on the Xiaomi is `0.083 x 30 = 2.49 C` (skin 36.5 -> 39.0). GPU seed rate
`3.2 x 21 / 1000 = 0.0672 C/s`. Required C = `rise_f + 0.5`:

| estimate | lookahead | rise_f | required | GPU allowed up to skin |
|---|---|---|---|---|
| v0.2: mean + 2 sd, sd 50 % (6.4), bg 1.0 | 20 s | 2.69 + 0.33 | 3.52 | never (band 2.49) |
| mean + 2 sd, sd 50 % (6.4), bg 1.0 | 10 s | 1.34 + 0.17 | 2.01 | 37.0 C |
| **v0.3: mean + 1 sd, sd 25 % (4.0), bg 0.5** | **10 s** | **0.84 + 0.08** | **1.42** | **37.6 C** |
| point estimate (3.2), bg 0 | 10 s | 0.67 | 1.17 | 37.8 C |

Decision: **mean + 1 sd, prior sd 25 % of the seed, lookahead 10 s.** Why it is safe enough: the lookahead equals
the horizon Android itself forecasts (`rn-platform-thermal.h:29` `k_platform_thermal_headroom_forecast_s = 10`),
so the 10 s already cover the sensor's own projection (ASSUMPTION: the thermistor lag is within it; Stage 0
measures the overshoot after every `speed_fit -> heat_rank` hop from the per-window samples and moves the
lookahead if the overshoot exceeds 0.5 C). If the true GPU heat is k times the estimate, the forecast crosses the
39.0 line by at most `(k x 0.67 + 0.08) - 1.42 + 0.5` C in the 10 s after the last pass decision: k = 2 -> 0 C
(absorbed), k = 3 -> 0.68 C (skin 39.7, h 0.106, duty `1 - 0.19 x 0.65 = 0.88` for seconds), k = 4 -> 1.35 C
(skin 40.3, duty 0.76). None reaches the full line (42.6), the battery pause (43) or SEVERE (66.5). Each case
trips the breaker (4.7) at the first window where actual exceeds predicted + 0.5 C. Why not the point estimate:
the row is one run that started 2.4 C warm (`xiaomi-endur-npu-gpu-75/REPORT.md:48-50`); 25 % is the width of the
cell's own range (19.7-22.2 tok/s, 3.2 "about"). The 0.5 C margin is kept: it is what absorbs k = 2.

### 4.5 Worked example, Xiaomi 14, seeds, lines 0.083 / 0.203

Seeds 1.1 / 3.2 / 7.3 C per 1k, speeds 16.0 / 21.0 / 14.7, forecast ~ 0.0327 x skin - 1.187 (`xiaomi-g2-inapp-
233486dd/REPORT.md:40`), skin(h) = 36.5 + 30 h.
1. Start skin 33.4 C (cell 75), battery 31 C: FAST, unplugged, status 0 present, forecast 0 read 1 s ago, app
   profile 0 s old, duty 1. Zones cold (`xiaomi-legheat-76/raw/legheat_cpu.csv` row 1: nsp 34.9, gpu 36.3, cpu
   40.0 C); `leg_fit(GPU)` needs a GPU passive trip >= 56.3 C (ASSUMPTION, section 4.8). Armed.
2. Window 0: HEAT_RANK pick NPU; fit {NPU, GPU, CPU}; fast GPU; 21.0 >= 18.4; blind -> GPU, "speed_fit",
   `blind_windows` += 1, `blind_tokens` += 32.
3. Blind band 3.1 C at 0.0672 C/s: 46.1 s, 968 tokens (cell 75 measured 6.3 C / 100 s, `REPORT.md:30`: 49 s).
4. Wake at h ~ 0.003 (skin 36.6): `m_f = 2.40 C >= 1.42` -> GPU stays. Cutoff `m_f = 1.42` -> `h = 0.0356`, skin
   37.57 C: another 1.07 C / 0.0672 = 15.9 s, 334 tokens. Then "heat_rank", NPU. Re-entry needs `m_f >= 1.92`
   (h <= 0.019, skin 37.1): only after real cooling.
5. Total GPU ~62 s, ~1,300 tokens at 21 vs 16.0 (+31 %) / 15.46 (+36 %). From a 36 C start (the in-app run):
   7.4 s blind + 15.9 s band = ~490 tokens. NPU then carries decode to 39.0 C, the ramp paces from there.
6. With a learned posterior at mean 3.2, sd 0.4 (ucb 3.6; a possibility, not a derivation): required 1.34,
   cutoff 37.65 C. The learner does not widen the band materially (section 0).
7. Zone path throughout: if the GPU block drops under the guard while running, `leg_fit(GPU)` is false and the
   pick is HEAT_RANK's. No new mechanism.
S23 null control: NPU fastest (17.1 vs 15.0, ALIVE:101), `fast == pick`; and the S23 row keeps `lookahead 0`.

### 4.6 HEAT_RANK isolation

The app never sends `decode_heat_per_token`. HEAT_RANK's ranking (`policy-hop.cpp:70-71`) and no-fit fallback
(`:206` `return headroom_of(engine) - params_.decode_heat_weight * heat - step_c;`) read only the row's triple;
`decode_speed_heat` / `decode_speed_bg_c_per_min` are read only by `forecast_ok`. Tested with extreme values.

### 4.7 Surprise breaker, engine + app (survives reloads)

Engine, per session: when the pass puts the work on a leg other than HEAT_RANK's pick, latch `entry_h = h_now`,
`entry_ms`; if blind, re-latch at the first window with `h_now > 0`. At every later window on that leg with
`h_now > 0`: `actual = (h_now - entry_h) x 30`, `predicted = rise_f(L) x (now - entry) / lookahead`; `actual >
predicted + margin_c` -> `speed_breaker_tripped_ = true`, one hop line ("governor: speed breaker: actual %.2f C,
predicted %.2f C over %.0f s, faster leg off"), stat `decode_speed_breaker = 1`. Bound: with the model wrong by
k, the trip comes at the first window after the surplus exceeds 0.5 C, i.e. within `0.5 / ((k - 1) x 0.067)` s
of GPU: k = 2 -> 7.5 s, k = 3 -> 3.7 s; the sensor's 10 s projection and the 2 s read cadence add at most one
window plus one read. The policy is rebuilt at every load (`llama-governor.cpp:38-39` `llama_governor::
llama_governor(llama_governor_params governor_params) : policy_(governor_params)`), so the engine flag alone dies
with a reload. App: the completion row carries `breaker`; on 1 the app persists `kalsa.governor.speedBreaker.v1
{trippedAt, fingerprint}` and, while it is less than 6 h old (ASSUMPTION) and the fingerprint matches, every load
sends `decode_speed_lookahead_s: 0` and `KALSA_GOVERNOR_LEARNED {breaker_latched:1}`. The learner resets the
faster leg's column to its seed with the prior sd doubled (ucb 1.5x seed) and rejects that session's later rows.

### 4.8 The blind path and the unmeasured Xiaomi trips

While blind the forecast gives no bound, and the Xiaomi zone passive trips are not in the lab (no in-app hop line
with headrooms exists for it; cell 76 has zone temperatures only). What bounds the GPU there: (a) by definition
the skin is >= 30 C below SEVERE (<= 36.5 C) and >= 2.49 C below the ramp; the next decision is one window (32
tokens, 1.5 s) after the forecast wakes; (b) the GPU block is protected by its own passive trip through
`leg_fit`, whatever its value: a low trip refuses the GPU (safe side), a high trip lets the kernel's own throttle
act first; (c) `k_speed_blind_cap_tokens = 2048` blind-path tokens per completion (6.6 C of seed GPU heat, the
widest blind band of a room-temperature phone, 30 -> 36.5 C): past it the pass stops until the next completion.
Stage 0 logs the per-leg minimum trip (`rn_thermal_legs` knows `passive_trip_mc`, `rn-thermal-legs.h:13`) and
the zone temperatures per window, so the trips are known before Stage 2 ships.

### 4.9 Observability

Stats (engine, JSI, `KALSA_GOVERNOR`): `decode_speed_tps_{cpu,npu,gpu}`, `decode_speed_fit_windows`,
`decode_speed_fit_blind_windows`, `decode_speed_breaker`, `decode_heat_per_token_{npu,gpu,cpu}_applied`. The hop
line (`policy-hop.cpp:292`) gains the label `speed_fit`.

## 5. Learning

### 5.1 Observation = one completion, from per-window samples

The binding resets the engine's per-completion latch at every `beginCompletion` (`rn-completion.cpp:807`
`parent_ctx->resetGovernorPrefillStats();`). New in the binding, per completion: a ring of up to 256 window
samples `{tokens, leg_of_previous_window, h, zone_cpu, zone_npu, zone_gpu, duty_last}` taken in
`before_decode_batch` at every multiple of the hop (`rn-governor.cpp:181-183`), where the zones are already
sampled (precedent: `route_chunks[64]` with an overflow flag, `llama-ext.h:610`); `decode_first_step_ms` /
`decode_last_step_ms` (monotonic, first and last 1-token batch); the per-leg minimum trip. JSI exposes them with
the stats (`RNLlamaJSI.cpp:953-956` neighbourhood); `types.ts`; the source guards.
The app builds one row per completion (tool rounds are separate completions: the loop pushes a profile per
round, `LlamaService.ts:5243`): deltas of `decode_tokens_*`, `decode_us_*`, `decode_paced_tokens`, the speed
counters; `wall_min = (last_step_ms - first_step_ms) / 60000` (NOT `predicted_ms`, which is token-generation
time, `rn-slot.cpp:729` `timings.predicted_ms = t_token_generation * 1e3;`); `prompt_n`; battery, plugged, state,
breaker; the ring. **Observation start** = the first sample with `h > 0` (the wake), not the first step: the
tokens per leg from there are derived from the ring (leg x hop tokens), `h_first` is that sample's forecast,
and `pre_gpu_k` = GPU tokens in the 10 s before the start (in-flight heat). A row with no sample at `h > 0` is
`censored`: speed only.

### 5.2 Heat model (everything else, cooling, outliers, forgetting)

`y = 30 x (h_last - h_first)` C. Regressors `x = [npu_k, gpu_k, cpu_k, prompt_k, pre_gpu_k, wall_min,
-h_first x wall_min]`: tokens per leg / 1000 from the observation start; prompt tokens / 1000 (prefill heat in
flight; prior 6.5 C/1k from the S23 NPU prefill arm, weak); `pre_gpu_k` (prior = the GPU seed); `bg` C per
minute of wall time the phone gains anyway (other apps, radio, screen; prior 0, sd 0.5); a first-order cooling
coefficient c >= 0 per minute toward the forecast's zero (prior 0, sd 0.1; UCSD's online LTI fit reaches 0.3 C
mean error, PRIOR-ART 10). The margin ignores c (cooling only helps: conservative by construction). Bayesian
ridge over sufficient statistics (7x7 `XtX`, `Xty`, `n`, `yty`), prior mean = the applied row triple from stats,
prior weight n0 = 4, prior sd 25 % of the seed per heat column. Noise: `sigma^2 = max(0.04, RSS / max(n - 7, 1))`
C^2 (floor 0.2 C: thermistor resolution, ASSUMPTION); posterior covariance `sigma^2 (XtX + prior)^-1`. Accepted
rows: not censored, unplugged, paced delta 0, `wall_min >= 0.5`, finite, no breaker latched. **Outlier**:
`|y - x.mean| > max(1.0 C, 3 sd_pred)` -> rejected, counted. **Forgetting**: statistics x 0.95 before each
accepted row (13.5-row half-life).

### 5.3 What the engine receives

Per leg: `ucb = clamp(max(mean, 0) + sd, 0.75 x seed, 3 x seed)`, sent when the column has >= 4 accepted rows
with >= 2 windows of that leg, else **0** (= engine seed x 1.25; 0 is the engine's "unset" convention). The cap is
a sanity bound on a runaway fit, not a bound on true heat: the breaker is. Parser: all three leaves required
(`rn-governor-params.cpp:133`, `:154`), negatives refused (`:95` `valid_heat_knob`); the clamp makes both
unreachable. `bg_ucb = max(bg, 0) + sd_bg`, sent with n >= 4.

### 5.4 Speed (engine, per session)

At `refresh_decode_legs()` (`llama-governor-legs.cpp:271`), which computes this completion's deltas (`:282-283`
`tokens = tokens_now[i] - floor_mark_tokens_[i]; us = us_now[i] - floor_mark_us_[i];`) at every completion start
(`llama-governor-runtime.cpp:307`, `llama-governor.cpp:393`): for each leg with `tokens >= 2 x hop` (`:284`),
`speed += 0.5 x (tokens x 1e6 / us - speed)`. Seeds in the row: S23 17.1 / 15.0 / 13.0, Xiaomi 16.0 / 21.0 /
14.7 (ALIVE:101-102). A leg without evidence keeps its seed.

### 5.5 Where GPU evidence comes from, and what the rule does meanwhile

Under HEAT_RANK alone Xiaomi rows are NPU-only (cell REPORT:26). Under v0.3 every cold completion that wakes
mid-way is a mixed row from the wake: ~334 GPU tokens then NPU (4.5 step 4). The GPU slice contributes ~1.07 C
against a row noise of ~0.2 C and a shared `bg` term, so one row gives a GPU standard error of ~0.6 C/1k;
~20 such rows bring it to ~0.15 C/1k (ASSUMPTION on noise; collinearity with `pre_gpu_k` slows it). Until
then the rule runs on the seed ucb (4.0), which section 4.4 showed is already the operating point: learning
changes the cutoff by tenths of a degree. The CPU column never identifies and never matters (slowest leg on both
phones). Recommendation to the owner: a lab repeat of cell 75 (three runs per arm from the same start skin,
side sampler) calibrates the GPU seed in one evening; the in-app learner then tracks drift and feeds the breaker.

### 5.6 Persistence and reset

AsyncStorage `kalsa.governor.learned.v1`, one object per fingerprint = `Build.MODEL` + `socModel`
(`GovernorBatteryModule.kt:96`) + `Build.FINGERPRINT` (new in `readSoc`, `:93`) + binding pin (`package.json:54`)
+ the applied row triple; mismatch or corrupt JSON -> seed, `reset:"fingerprint"`. A thermal firmware change
with the same build is undetectable: forgetting (13.5 rows) and the breaker cover it. First per-device key.

## 6. Wire

New JSON keys (parsed like `decode_headroom_tau_s`, `rn-governor-params.cpp:303-304`, sent flags, row merge
`:353`): `decode_speed_lookahead_s`, `decode_speed_tps` {npu, gpu, cpu}, `decode_speed_heat` {npu, gpu, cpu}
(0 = unset), `decode_speed_bg_c_per_min`. Profile stamps `headroom_read_ms`, `app_sample_ms` (binding-set, never
from JSON). The app sends only the speed heat, bg, and `lookahead 0` for the breaker latch or the bench key
`kalsa.bench.speed_fit = "off"` (pattern `BENCH_DECODE_HOP_KEY`, `governorInputs.ts:23`), through
`buildGovernorParams` (`governorInputs.ts:321`). Row fields ride in `rn_leg_set`, printed by `KALSA_LEGS_TABLE`
(`rn-llama.cpp:463`).

## 7. Invariants kept (RECON 6)

1. Safety states force CPU (`policy.cpp:571` hop gate): the pass lives inside the hop. 2. CPU never excludable
(`policy-hop.cpp:153-155`). 3. One leg change per window at boundaries. 4. No reload in a hop. 5. Platform-raised
COOLMODE never buys GPU decode: stricter, every non-FAST state disarms. 6. Status >= 2 floors, 5 never kills:
untouched. 7. HEAT_RANK hysteresis 4 C: the fit set is HEAT_RANK's; the pass adds 15 % speed and 0.5 C forecast
hysteresis. 8. Sanitizers at construction (`policy.cpp:180-187`): speeds, heat, bg, lookahead finite >= 0 else 0;
stamps are int64, 0 = unknown. 9. Row gating: no row = zeros = off. 10. App: learned keys only with n >= 4 and a
matching fingerprint; `thermalHardGate.ts` untouched.

## 8. Staged plan

Constraints the implementation must respect (quoted from the brief):

```
Write clean code. Never create a God file: a file may hold one responsibility, and the test of it is
that you can name that responsibility in one phrase. Line count is a smell, not the rule — ~250 is
indicative, ~350 is fine, and if you notice you are moving lines only to make a number work, stop and
leave the file alone. No new file beyond ~350. No file, new or existing, that mixes responsibilities
until it stops being readable. Test files follow the same logic: if a test file becomes an
indistinguishable list of cases, split it by topic, not by line count. Pre-existing excess is
declared, not refactored. Minimal imports: no globs, no preventive pub, no convenience re-exports. No
types or APIs nobody constructs yet. Comments only for WHY or a trap, never restating the code — and
if a comment declares an invariant, that invariant must be true. No secret values. Tests: targeted
filters while working, one full run at the end, and never report a piped command's status:
`cmd > /tmp/out.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/out.log`, quoting the exit code. `git add` by
name, `git branch --show-current` printed before every commit, no push, no tag, no new branch, and
the commit message names repo, branch and HEAD. Report file:line, commands with exit codes, hashes,
and what you could not verify.
```

Declared pre-existing excess: `llama-ext.h` 826, `llama-governor-policy.cpp` 663, `LlamaService.ts` 6868,
`rn-governor-params.cpp` 435, `governorInputs.test.ts` 1001. Each stage: implement -> verify on disk -> one
hostile audit -> fix -> next.

**Stage 0 - observe only, in daily use (no engine change, no decision change).**
App first: `declaredSevere.ts` Xiaomi lines (`PACING_START_SKIN_C` is a shared constant, `:8-9`; the row needs
its own start/full skin: 39.0 / 42.6 -> 0.083 / 0.203), `declaredSevere.test.ts`. Binding: `rn-governor.cpp`
window ring (new `cpp/rn-governor-samples.cpp`, ~120 lines: ring, first/last step stamps, min trips), JSI fields
`decode_us_*`, `decode_wall_ms`, `decode_zone_trip_*`, `decode_window_samples`; `types.ts`;
`nativeSourceGuards.test.ts`; `platform_thermal_test.cpp` + one ring case. App: `governorObservation.ts` (pure:
two stats snapshots + ring -> one row, wake start, `pre_gpu_k`, censored; ~150) and `governorObservationLog.ts`
(JSONL append to `files/governor-observations.jsonl`, rotate at 4 MB; numeric only; ~80), tests;
`LlamaService.ts` appends one row per completion and logs `KALSA_GOVERNOR_COMPLETION` without the ring. Lab:
`learning-governor/replay/` node script: fits 5.2, prints seed vs learned, residuals, the wake point, the
overshoot after every `speed_fit -> heat_rank` hop (for Stage 3: today none, so the lookahead check uses NPU ->
pacing transitions as a proxy), the Xiaomi trips. Device checks: S23 5 turns: rows complete, `npu_tps` within
10 % of `predicted_per_second / duty`; Xiaomi: the owner's daily use, pulled by adb (approved). Refuted by
negative deltas, > 25 % disagreement, or a ring overflow on a normal completion.

**Stage 1 - learned store (no decision change).** `governorLearned.ts` (store, fingerprint, breaker latch;
~160), `governorLearnedFit.ts` (ridge, noise, outlier, forgetting, ucb; ~170); tests: fingerprint reset, plugged
and censored skips, corrupt JSON, convergence on synthetic rows, GPU column unchanged on NPU-only rows, clamp,
breaker latch expiry. Log `KALSA_GOVERNOR_LEARNED {n, ucb_*, bg_ucb, rejected, sent:0, reset, breaker_latched}`.

**Stage 2 - engine rule, default off (engine -> vendoring + HTP skel rebuild + pin).** Engine: `llama-ext.h`
params, stamps, stats, the rewritten comment; new `src/llama-governor-policy-speed.cpp` (~200 lines: EWMA,
`armed`, `forecast_ok`, breaker, blind cap, pick) registered in `src/CMakeLists.txt:37` after
`llama-governor-policy-hop.cpp`; `policy-hop.cpp` `leg_fit` factored + one call (~10 lines); `policy.h` `hop_decide`
gains `now_ms` (`:167`); `legs.cpp` pushes deltas (~6); sanitizers. Tests `tests/test-governor-v02-hop-speed-fit-
arming.cpp` and `-margin.cpp` (split by topic from the start; registered like `tests/CMakeLists.txt:455-457`
`llama_build(test-governor-v02-hop-heat-rank.cpp) ... llama_test(... LABEL "router")`): the ten arming cases of
4.2; blind takes GPU; blind cap; band rejects at 2.01 and accepts at 1.42 required; re-entry hysteresis; S23 seeds
never fire; breaker trips, stays tripped, bound of 4.7 on synthetic rises; isolation; off-is-heat-rank; EWMA.
Existing hop and platform tests unchanged. Binding: row fields (both `lookahead 0`), parser, stamps, merge,
`KALSA_LEGS_TABLE`, JSI, `vendor/VERSIONS`, skels + `assert-htp-skels.sh`; `governor_params_test.cpp`,
`legs_table_test.cpp`. App: pin + `assert-engine-provenance.sh`; `buildGovernorParams` overrides; new
`governorLearnedOverrides.test.ts`. Device check: S23 G2 5 turns, `speed_fit_windows 0`.

**Stage 3 - enable on the Xiaomi row.** SM8650 row `decode_speed_lookahead_s = 10`. App sends ucb / bg per 5.3.
Check A: S23 unchanged. Check B: Xiaomi, start skin < 35 C, unplugged, side sampler, A/B via the bench key. Pass:
GPU windows while blind and up to h ~ 0.036 (`speed_fit_windows > blind_windows`), none after the ramp
engages, breaker 0, status never >= 2, forecast overshoot past 0.083 while on the GPU <= 0.017 (0.5 C), skin max
<= the HEAT_RANK arm's + 0.5 C, battery max <= 42.5 C, first completion >= 25 % faster than the HEAT_RANK arm's.
Refuted by a breaker trip on a healthy phone, status 3, or a hot-state median below 5.0 tok/s. Fallback lines
41 / 44 only if Stage 0 shows the GPU learns too little (owner).

## 9. Risks

| risk | guard | refuted by |
|---|---|---|
| overshoot | FAST, duty 1, fresh inputs, zone fit, 10 s ucb lookahead + 0.5 C, breaker | status 3, skin > HEAT_RANK's max + 1 C |
| stale input | age stamps, 4 s / 120 s | a pass window with an older stamp in the ring |
| wrong seed | ucb 1.25x, breaker within 3.7-7.5 s of GPU, app latch 6 h | breaker trips on a healthy phone |
| blind path | wake point, zone trip, 2,048-token cap | GPU never fit while cold (trip low: gain 0 on this phone) |
| background heat blamed on a leg | `bg`, cooling, `pre_gpu_k`, outlier gate | learned GPU moves on NPU-only sessions |
| oscillation | window granularity, 4 C, 15 %, 0.5 C | hops per completion > HEAT_RANK's + 2 |
| memory | policy floats; ring 256 x 7 floats; JSONL 4 MB | S23 MemAvailable < 1.0 GB (today 1.08-1.37, `s23-g2-full099-233486dd/REPORT.md:31,70`) |

## 10. Open questions for the owner

1. Cell-75 repeat (three runs per arm, same start skin, side sampler) before Stage 3: it sets the GPU seed the
   rule will actually run on; the in-app learner alone needs ~20 band rows. Yes / no.
2. Breaker latch expiry 6 h, blind cap 2,048 tokens, lookahead 10 s: three assumptions Stage 0's replay can check
   only partly (no GPU windows exist before Stage 3). Accept them as starting values, to be moved by Check B.
