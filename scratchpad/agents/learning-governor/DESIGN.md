# Learning governor - DESIGN v0.2 (2026-10-12)

Author: Claude Fable 5.1 (architect, owner-granted exception). Design only: no code, no build, no phone.
Revises v0 after AUDIT-1 (2 blockers, 5 high, 5 medium, 2 low) and the owner's decisions of 2026-10-12
(PLAN.md "Open decisions (owner)", "The learning governor"). Inputs re-read this session: RECON.md,
PRIOR-ART.md, engine `f1f612388` (kalsallama-upstream-b11514), binding `2581a9aa` (llama.rn-kalsa-onecopy),
app `df359450` (kalsa-wt-severe), lab cells 75, 76, `xiaomi-g2-inapp-233486dd`, `s23-g2-full099-233486dd`.
Every `file:line` below was read in this session and the line is quoted; "ASSUMPTION" marks what was not measured.

## 0. For the owner, in short

Today HEAT_RANK puts every 32-token decode window on the coolest fit leg. On the Xiaomi 14 that is the NPU
(15-16.5 tok/s); the GPU does ~21 tok/s at ~3x the skin heat per token. v0.2 adds one rule on top of
HEAT_RANK: **while the phone is cold, take the fastest fit leg; once warm, HEAT_RANK decides as today.**

"Cold" is read live at every window from two sources, both in degrees C: the per-component zone
temperatures (cpu/gpu/nsp, read every window) and Android's thermal forecast (read every 2 s). The forecast
reads 0 while the skin is 30 C below SEVERE (Xiaomi: below 36.5 C). A 0 is blind, not "at the limit": while
blind, the zones alone decide, with HEAT_RANK's own fit test. Once the forecast speaks, both must agree: the
zones must still fit the leg, and the forecast must have room for the next 20 s of that leg's heat, an upper
estimate, plus 0.5 C. This is not a plain minimum, because a blind source abstains instead of counting as zero.

Speed per leg is learned in the engine every completion from counters it already has. Heat per leg is
learned in the app across sessions, per phone, per completion, with an "everything else" term for heat our
legs did not cause, outlier rejection, and forgetting. The app sends an UPPER estimate to the engine at model
load, through new keys that only the speed rule reads: HEAT_RANK's own numbers and choices never change.
A surprise breaker in the engine compares the forecast's actual rise with the predicted one while on the
faster leg; if the phone heats faster than predicted, the faster leg is off until the next model load.

What it buys on the Xiaomi today: from a cold start (skin 33-34 C) about 45 s of GPU, ~950 tokens at +35 %,
until the forecast wakes at 36.5 C. The forecast band between waking (36.5 C) and the pacing line the app
sends today (38.1 C) is only 1.6 C wide, too narrow for the GPU's heat; with the Xiaomi pacing lines PLAN
already proposes (0.15 / 0.25, skin ~41 / ~44 C) the GPU runs on to skin ~37.5 C with the seeds and ~38.5 C
once learned, and the learner can see the GPU's heat on the forecast at all (question 1).

Stage 0 changes no decision: it logs one row per completion to a file on the phone during normal use, so the
replay runs on real life. Cut from v0: exploration probes, the `SPEED_FIT` enum value, "provably", the 60 s
lookahead, the per-turn observation, prefill, unknown phones, plugged learning, any change to pacing or safety.

## 1. Changes from v0

| finding / correction | resolution | section |
|---|---|---|
| Blocker 1: Stage 3 never turned SPEED_FIT on | no enum value; the rule is on iff `decode_speed_lookahead_s > 0`, a row field the Stage 3 row sets to 20 (parser `rn-governor-params.cpp:85-86` untouched) | 4.1, 8 Stage 3 |
| Blocker 2: Xiaomi margin unreachable | two sources; blind forecast abstains; worked example from skin 33.4 C with every term | 4.3, 4.4 |
| High 3: learned heat leaks into HEAT_RANK | separate keys `decode_speed_heat`, `decode_speed_bg_c_per_min`; `decode_heat_per_token` never sent by the app | 4.5, 6 |
| High 4: arming inputs absent at hop_decide | exact read list; duty computed live with pace_decode's function; status via `state_`; forecast NaN disarms; plugged/battery staleness bounded and stated | 3, 4.2 |
| High 5: no GPU/CPU heat evidence without probes | GPU evidence = the rule's own windows; identifiable on the forecast only in the band; 0 sent for a column without evidence (= engine seed) | 5.2, 5.4 |
| High 6: observation window vs tokens | per COMPLETION, from the first decode step; prompt tokens a nuisance regressor; rounds are separate rows | 5.1 |
| High 7: "provably" | dropped; upper-confidence heat (mean + 2 sd, floor/cap) in the margin; breaker bounds the damage to one lookahead of the true rate | 4.3, 4.6, 5.3 |
| Medium 8: replay of old logs | rejected as a heat source (no start reading); old logs used for speed and the wake point only; Stage 0 produces real-life rows | 8 Stage 0 |
| Medium 9: "GPU only while headroom_first <= 0" unobservable | per-window counters `decode_speed_fit_windows` / `_blind_windows`, breaker flag, in stats and the line | 4.7, 8 |
| Medium 10: negative heat | posterior mean clamped at 0; UCB floored at 0.5 x seed; never below the parser's `valid_heat_knob` (`:95`) | 5.3 |
| Medium 11: no app-side seed vector | engine stats expose the applied row triple; the app reads it after load (precedent `decode_pacing_start_applied`, `llama-ext.h:633`) | 5.3, 6 |
| Medium 12: fingerprint misses OTA | `Build.FINGERPRINT` added via `readSoc` (`GovernorBatteryModule.kt:93-96`); a thermal firmware change without a build change stays undetectable: forgetting + breaker cover it | 5.5 |
| Low 13: citation | `(skin - 12) / 30` is `declaredSevere.ts:34-37` (`(skinC - (severeSkinC - DEGREES_BETWEEN_ZERO_AND_ONE)) / DEGREES_BETWEEN_ZERO_AND_ONE`); fixed | 2 |
| Low 14: 1,001-line test file | new focused `governorLearnedOverrides.test.ts` | 8 Stage 2 |
| Owner: both sources, not a plain minimum | one unit (C), blind abstains, both must pass when both speak | 4.3 |
| Owner: real life (a) live margin | every term read at the window; nothing carried from a prediction | 3, 4.2 |
| Owner: real life (b) everything-else term, outliers, forgetting | bg intercept per minute; residual gate; lambda 0.95 | 5.2 |
| Owner: real life (c) surprise breaker | in-engine, per session | 4.6 |
| Owner: real life (d) Stage 0 in daily use | JSONL file on the phone, pulled by adb; no decision change | 8 Stage 0 |
| Owner: approved shape | speed cold / heat warm; heat in app, speed in engine; no probes; Xiaomi first, S23 null control, row-less phones out | 2 |

## 2. Scope

IN v0.2: (a) a speed pass inside HEAT_RANK's branch, gated by `decode_speed_lookahead_s > 0`; (b) in-engine
per-leg speed EWMA per completion; (c) app-side per-phone heat regression, persisted, seeded from the applied
row, sent at load through new speed-only keys; (d) the surprise breaker; (e) Stage 0 observation rows in
daily use. OUT: prefill (GPU prefill fails the strict oracle, PLAN "SM8850 GPU prefill (V81)": "logit oracle
FAIL R2 again"); exploration probes (v0.1, after the replay); a mid-turn setter; learning or arming while
plugged; phones without a legs row (`rn_legs_for` returns `{}`, `rn-legs-table.cpp:202` `return {};`, so no
one-copy load and no GPU leg); the battery as a third margin source (per-completion stale, section 3, and
already inside the computed duty); a zone-scale heat model (no measured zone-to-skin conversion); a weighted
blend of the two sources (same reason); any change to pacing, thresholds, admission, safety states.
Units: both rows are skin C per 1k tokens (`xiaomi-legheat-76/REPORT.md:51` "Heat per token (skin C per 1k
tokens, the S23 row's unit)"; ALIVE:101 "heat 2.8 / 3.2 / 4.7 C per 1k"); the engine comment
`llama-ext.h:363-364` "battery C*s/token from the lab" is stale and is rewritten in Stage 2 (comment only).
The learner's unit is "forecast C per 1k tokens" = headroom delta x 30 (`declaredSevere.ts:16`
`const DEGREES_BETWEEN_ZERO_AND_ONE = 30;`): skin C on the S23, the forecast sensor's C on the Xiaomi.

## 3. What hop_decide reads (High 4, owner a)

`hop_decide()` (`policy-hop.cpp:159`) runs at window boundaries only (`policy.cpp:573-577` `if (window !=
decode_hop_window_) { ... result.hop_rule = hop_decide(window, tokens_since_prefill);`). Every speed-pass input
is a policy member at that moment:

| input | member | freshness at the window |
|---|---|---|
| thermal state and its source | `state_`, `state_from_platform_` (`policy.h:178`) | last profile accepted: the app pushes one per completion round (`LlamaService.ts:5243` `await refreshGovernorBeforeCompletion(engine, thermoLogState)`); the binding pushes a native status change (5 s debounce, `rn-platform-thermal.h:23`) and every forecast change before each decode step (`rn-governor.cpp:116` `refresh_platform_thermal();`) |
| forecast `h_now` | `profile_.platform_thermal_headroom` (`policy.h:134`) | <= 2 s (`rn-platform-thermal.h:28`), 10 s carry (`:25`); normalized so finite means >= 0 (`policy.cpp:136` `return headroom >= 0.0f ? headroom : ...quiet_NaN();`) |
| per-leg zone headroom | `present_headroom[]` from `headroom_of` (`policy-hop.cpp:182-197`) | this window: `before_decode_batch` feeds at every multiple of the hop (`rn-governor.cpp:181-183` `if (decode_tokens_since_prefill_ % decode_hop_tokens_ == 0) { feed_decode_headroom(); }`) |
| duty | computed: `llama_governor_decode_pacing_duty(platform_thermal_headroom(), current_temperature_c(), decode_battery_lines(), state_, profile_.platform_thermal_status, params_)` - the call pace_decode makes (`pacing.cpp:30-33`) | same inputs as the pacing; replaces v0's `duty_last`, which is a post-pacing statistic (`pacing.cpp:48`) |
| plugged, battery C, level | `profile_.plugged`, `batt_temp_tenths_c`, `batt_level_pct` | per completion round (above). Stale by at most one completion: a phone plugged mid-completion runs the faster leg until the next round. Accepted: plugged is a learning exclusion, the battery machine handles charging heat (`policy.cpp:191-199` plugged thresholds), and v0 arms only in FAST |
| speed per leg | `speed_tps_[3]` (new) | updated at the completion latch (section 5.4) |
| upper heat per leg, bg | `params_.decode_speed_heat_*`, `decode_speed_bg_c_per_min` (new) | per load |
| breaker | `speed_breaker_tripped_` (new) | per session |

Absent status is -1 (`llama-ext.h:447`), which `apply_platform_floor` treats as no vote (`policy.cpp:51`
`if (platform_status < 2) { // absent (-1), NONE (0), LIGHT (1): no escalation`). v0.2 never tests the status
itself: it tests `state_` and the computed duty, both of which the floor and `status_duty` already feed. The
5 s debounce bounds the lag to 5 s x 4 C/min = 0.3 C of skin on the GPU; the Xiaomi never left status 0 at
skin 44.9 C (`xiaomi-g2-inapp-233486dd/REPORT.md:32` "Android status | 0 for the whole run (1027 samples)").

## 4. The decision

### 4.1 Where it sits

Inside `hop_decide`, in the `ranked >= 0` branch (`policy-hop.cpp:232-234` `if (ranked >= 0) {
decode_hop_leg_ = present[ranked]; hop_rule = "heat_rank";`). HEAT_RANK's pick stands unless the speed pass
replaces it by a faster leg that is ALSO fit by HEAT_RANK's own test (`:78-80`: current leg `>= guard_c`,
idle candidate `- load_step >= guard_c + k_hop_hysteresis_c`); the per-leg predicate is factored out of
`heat_rank_fit` so both read the same lines. `hop_rule` becomes `"speed_fit"` when the pass replaced the
pick. `decode_speed_lookahead_s == 0` (every row today, the engine default) skips the pass: byte-identical to
HEAT_RANK, tested. The pass never runs when zones are unknown (`all_known` false, `:274-278` alternation).

```
pick = present[ranked]                                   # HEAT_RANK's answer, cheapest fit leg
if lookahead_s > 0 and armed() and not breaker:
    fit  = { L in present : leg_fit(L) }                 # HEAT_RANK's own test, per leg
    fast = argmax speed_tps over fit
    if speed_tps[fast] >= 1.15 * speed_tps[pick] and forecast_ok(fast): pick = fast; rule = "speed_fit"
```

### 4.2 Arming (owner a: all read live, section 3)

`armed()` = `state_ == FAST` (not WARM/COOLMODE/LOWBAT; the hop itself runs in COOLMODE, `policy.cpp:571`
`not_a_safety_state()`, but v0.2 spends no heat there) AND `!state_from_platform_` AND `!profile_.plugged`
AND `h_now` finite (NaN = no forecast at all: disarm, the forecast is the breaker's only sensor) AND
duty == 1.0 (no forecast, battery or status ramp engaged). A WARM battery, a platform-raised COOLMODE, a
plugged profile, a NaN forecast, and a forecast at or past `decode_pacing_headroom_start` each disarm:
one test per input.

### 4.3 The margin: one unit, two sources (owner, Blocker 2, High 7)

Unit: degrees C. Both sources answer "how many C before a line", for the faster leg L.

**Zone source** (always speaks while zones are known): `leg_fit(L)` above, i.e. L's own block has
`load_step(L) + guard + hysteresis` C to its first passive trip when idle (`rn-thermal-legs.cpp:112`
`headroom_c = (zone.passive_trip_mc - temp_mc) / 1000`), `guard` once running. Xiaomi row: GPU 11 + 5 + 4 =
20 C (`rn-legs-table.cpp:90-91` `5.0f, 11.0f, 26.0f, 5.0f`). This is HEAT_RANK's test unchanged; v0.2 adds
no zone number.

**Forecast source** (speaks iff `h_now > 0`; `h_now == 0` is blind and abstains):
```
m_f        = (pacing_start - h_now) * 30                               # C to the ramp
rise_f(L)  = (heat_ucb[L] * speed_tps[L] / 1000 + bg_ucb / 60) * lookahead_s   # C in the next lookahead
forecast_ok(L) = m_f >= rise_f(L) + margin_c            (+ hyst_c to re-enter after leaving on this term)
```
`pacing_start` = `params_.decode_pacing_headroom_start` (the per-phone line the app sends,
`declaredSevere.ts:46-57`); `lookahead_s` = `decode_speed_lookahead_s` (row, 20 s; ASSUMPTION, the Stage 0
replay measures the forecast overshoot after a speed_fit -> heat_rank hop and moves it); `margin_c` = 0.5,
`hyst_c` = 0.5 (constants in the speed file). `heat_ucb[L]` = the app's upper estimate when sent, else
`2 x decode_heat_per_token[L]` (k_speed_prior_inflation = 2: an unproven one-run seed, `xiaomi-endur-npu-gpu-75/
REPORT.md:50` "one run per arm ... indicative, not a calibration"). `bg_ucb` = the sent upper background
rate, else 1.0 C/min (prior 0 +- 0.5, ASSUMPTION).

**Combination**: `take L iff leg_fit(L) and (blind or forecast_ok(L))`. Not a minimum: a blind forecast would
read as 1.6 C of margin on the Xiaomi and veto forever; here it abstains and the zones decide, which is the
owner's reading of 0. When both speak, both must pass. A blend was cut: nothing measured converts a zone C
into a forecast C.

### 4.4 Worked example, Xiaomi 14, seeds, from cold

Seeds: heat 1.1 / 3.2 / 7.3 C per 1k (npu/gpu/cpu), speeds 16.0 / 21.0 / 14.7 tok/s, lines 0.053 / 0.173
(skin 38.1 / 41.7 C, PLAN "Xiaomi 14 `23127PN0CG` 66.5 (HAL dump) -> 0.053 / 0.173"), forecast ~ 0.0327 x
skin - 1.187 (`xiaomi-g2-inapp-233486dd/REPORT.md:40`), so 0 below 36.5 C.

1. Start: skin 33.4 C (cell 75 NPU arm start), battery 31 C -> FAST, unplugged, status 0, forecast 0
   (blind), duty 1 (0 <= 0.053; battery 31 < cool_enter 39.5). Zones cold: nsp 34.9, gpu 36.3, cpu 40.0 C
   (`xiaomi-legheat-76/raw/legheat_cpu.csv` row 1). `leg_fit(GPU)` needs its trip >= 36.3 + 20 = 56.3 C:
   ASSUMPTION, the Xiaomi passive trips are not in the lab (no in-app hop line exists for it); Stage 0 logs
   them (section 8). Armed.
2. Window 0: HEAT_RANK's pick = NPU. fit = {NPU, GPU, CPU}; fast = GPU; 21.0 >= 1.15 x 16.0 = 18.4; blind ->
   GPU, rule "speed_fit". `speed_fit_blind_windows` += 1.
3. GPU skin rate = 3.2 x 21 / 1000 = 0.067 C/s = 4.0 C/min (cell 75 measured +6.3 C in the first 100 s =
   3.8 C/min, `REPORT.md:30`). 33.4 -> 36.5 C in ~46 s, ~970 tokens at +35 % over the NPU.
4. The forecast wakes at h = 0.01: m_f = (0.053 - 0.01) x 30 = 1.3 C. rise_f(GPU) = (6.4 x 21 / 1000 +
   1.0 / 60) x 20 = 2.69 + 0.33 = 3.0 C; needed 3.5 C > 1.3 -> `forecast_ok` false -> HEAT_RANK's NPU. The
   whole band is 1.6 C, so with today's lines the GPU never runs while the forecast speaks: the gain is the
   blind band, ~0 s from a 36 C start (the in-app run) to ~46 s from 33.4 C.
5. With PLAN's proposed Xiaomi lines (0.15 / 0.25): m_f = (0.15 - h) x 30; seeded GPU allowed while
   h <= 0.15 - 3.5 / 30 = 0.033 (skin ~37.5 C); learned (n >= 4, ucb ~4.2, bg_ucb ~0.7): rise 1.76 + 0.23
   + 0.5 = 2.5 C -> h <= 0.067 (skin ~38.5 C). Re-entry needs 0.5 C more. The NPU then carries decode until
   skin 41 C starts the ramp; from there everything is today's pacing.
6. Zone path throughout: if the GPU block's headroom drops under guard (5 C) while running, HEAT_RANK's
   `leg_fit(GPU)` is false, the pass has no faster fit leg, the pick is HEAT_RANK's. No new mechanism.

S23 null control: NPU is the fastest leg (17.1 vs 15.0 tok/s, ALIVE:101), so `fast == pick` and the pass
never fires even if armed; and the S23 row keeps `lookahead 0`, so the pass does not even run.

### 4.5 HEAT_RANK isolation (High 3)

The app never sends `decode_heat_per_token`. HEAT_RANK keeps the row's triple for its ranking
(`policy-hop.cpp:70-71`) and its no-fit fallback (`:206` `return headroom_of(engine) -
params_.decode_heat_weight * heat - step_c;`). The learned values travel in `decode_speed_heat` {npu, gpu,
cpu} and `decode_speed_bg_c_per_min`, read only by `forecast_ok`. The audit's example (a stale low GPU
estimate winning the fallback at weight 7) cannot happen. Intended and tested: `decode_speed_heat` set to
extreme values changes no decision while `lookahead == 0`, and none while armed is false.

### 4.6 Surprise breaker (owner c, High 7)

Per session, in the policy, forecast-based. When the pass puts the work on a leg other than HEAT_RANK's
pick, latch `entry_h` = `h_now` and `entry_us`; if `entry_h` is 0 (blind), re-latch at the first window
where `h_now > 0`. At every later window on that leg with `h_now > 0`:
`actual = (h_now - entry_h) x 30`, `predicted = rise_f(L)` scaled to the elapsed time; if `actual >
predicted + margin_c` -> `speed_breaker_tripped_ = true`, one hop line ("governor: speed breaker: actual
%.2f C, predicted %.2f C over %.0f s, faster leg off"), stat `decode_speed_breaker = 1`. The pass is off
until the policy is reconstructed (model load). Damage bound when the model is wrong by a factor k: the
forecast crosses `pacing_start` by at most `(k - 1) x rise_f` over one lookahead plus the skin lag, and
crossing the start line means pacing, not a thermal event: on the Xiaomi SEVERE is 66.5 C and the battery
pause 43 C, both far above the 38.1 C line. While blind the breaker has no sensor; the bound there is the
blind region itself (>= 30 C below SEVERE, >= 1.6 C below the ramp) plus the in-flight heat of one window.

### 4.7 Observability

Stats (engine, JSI, `KALSA_GOVERNOR`): `decode_speed_tps_{cpu,npu,gpu}`, `decode_speed_fit_windows`,
`decode_speed_fit_blind_windows`, `decode_speed_breaker`, `decode_heat_per_token_{npu,gpu,cpu}_applied`.
The hop line (`policy-hop.cpp:292`) already names when and why the leg moved; the label gains `speed_fit`.

## 5. Learning

### 5.1 Observation = one completion (High 6)

The binding resets the engine's per-completion latch at every `beginCompletion` (`rn-completion.cpp:807`
`parent_ctx->resetGovernorPrefillStats();`), while the counters are cumulative since clear_cache
(`llama-ext.h:567-569`). The app therefore builds one row per completion from two `getGovernorStats` reads
(`LlamaService.ts:1837`): deltas of `decode_tokens_*`, `decode_us_*`, `decode_paced_tokens`,
`decode_speed_fit_windows`; plus `headroom_first` (new binding latch: the forecast at the first 1-token
batch of the completion, taken in `before_decode_batch` when the mirror is 0, cleared by
`reset_prefill_stats`), `decode_pacing_headroom_last`, `decode_zone_headroom_{cpu,npu,gpu}_last` (new,
the last zone sample), `prompt_n` and `predicted_ms` from the completion timings
(`turnTelemetry.ts:200-202`), `batt_temp_tenths_c`, `plugged`, `thermal_state`, breaker. Tool rounds are
separate completions and separate rows (the loop pushes a profile per round, `LlamaService.ts:5243`); the
prompt's heat is a regressor, not a contaminant. A row is `censored` when `headroom_first == 0` or
`headroom_last == 0`: it carries speed, not heat.

### 5.2 Heat model (owner b)

`y = 30 x (h_last - h_first)` C. Regressors `x = [npu_k, gpu_k, cpu_k, prompt_k, wall_min]`: decode tokens
per leg / 1000, prompt tokens / 1000 (nuisance: in-flight prefill heat; prior S23 NPU 6.5 C/1k, weak), and
`predicted_ms / 60000` for the **everything-else term `bg`** (C per minute the phone would have gained
anyway: other apps, radio, screen). Bayesian ridge over sufficient statistics (5x5 `XtX`, `Xty`, `n`), prior
mean = the applied row triple from stats (6.5 / 0 for the two extra columns), prior weight n0 = 4, prior sd =
0.5 x seed per heat column (ASSUMPTION), 0.5 C/min for `bg`. Accepted rows: not censored, unplugged, paced
delta 0, `predicted_ms >= 30 s`, finite everything, no breaker in the session. **Outlier rejection**:
`|y - x.mean| > max(1.0 C, 3 sd_pred)` -> rejected and counted. **Forgetting**: the statistics are multiplied
by lambda = 0.95 before each accepted row (effective memory ~20 completions). No cooling term in v0.2: `bg`
absorbs ambient drift at the per-completion scale; a first-order term is v0.1 if the replay residual
correlates with `h_first`.

### 5.3 What the engine receives (Medium 10, 11, High 7)

Per column: `ucb = clamp(max(mean, 0) + 2 sd, 0.5 x seed, 4 x seed)`; sent only when that column's evidence
tokens >= 4 completions with >= 2 windows of that leg; a column without evidence is sent as **0**, which the
engine reads as "use 2 x the row heat" (0 is the engine's "unset" convention: floors, load steps, lookahead).
The parser needs all three leaves (`rn-governor-params.cpp:133` "All three legs are required", `:154` `" is
required"`) and refuses negatives (`:95` `valid_heat_knob`); the clamp above makes both impossible to hit.
`bg_ucb` = `max(bg_mean, 0) + 2 sd_bg`, sent when n >= 4.

### 5.4 Speed (engine, per session; High 5)

At `refresh_decode_legs()` (`llama-governor-legs.cpp:271`), which already computes this completion's
deltas (`:282-283` `const uint64_t tokens = tokens_now[i] - floor_mark_tokens_[i]; const uint64_t us = us_now[i]
- floor_mark_us_[i];`) and is called at every completion start (`llama-governor-runtime.cpp:307` and the
prefill-entry latch `llama-governor.cpp:393`): for each leg with `tokens >= 2 x hop` (the existing warm-up
rule, `:284`), `speed = speed + 0.5 x (tokens x 1e6 / us - speed)`. Seeds: new row fields
`decode_speed_tps_*` (S23 17.1 / 15.0 / 13.0; Xiaomi 16.0 / 21.0 / 14.7; ALIVE:101-102 ranges). A leg
without evidence keeps its seed. GPU evidence comes from the rule's own cold windows (by construction every
cold completion is a mixed row, so the design matrix leaves rank 1 after the first cold session); CPU
evidence only from safety-state turns, and the CPU is never the fastest leg on either phone, so its column
staying at the seed costs nothing. The Xiaomi's warm NPU slowdown (15.3 -> 4.5 tok/s at status 0,
`xiaomi-g2-inapp-233486dd/REPORT.md:27`) is tracked per completion and is moot while warm (disarmed).

### 5.5 Persistence and reset (Medium 12)

AsyncStorage `kalsa.governor.learned.v1`: one object per fingerprint = `Build.MODEL` + `socModel`
(`GovernorBatteryModule.kt:96` `result.putString("socModel", Build.SOC_MODEL)`) + `Build.FINGERPRINT` (new
field in `readSoc`, `:93`) + the binding pin (`package.json:54` `"llama.rn": "github:Aspis0/kalsa.rn#2581a9aa..."`)
+ the applied row triple. Mismatch -> seed, logged `reset:"fingerprint"`. Corrupt JSON -> seed. Today no
per-device state is persisted (RECON 4); this is the first such key.

## 6. Wire and files

New JSON keys (parsed like `decode_headroom_tau_s`, `rn-governor-params.cpp:303-304`; sent flags; merged
from the row when absent, `:353`): `decode_speed_lookahead_s` (nonneg float), `decode_speed_tps` {npu, gpu,
cpu}, `decode_speed_heat` {npu, gpu, cpu} (0 allowed = unset), `decode_speed_bg_c_per_min`. The app sends
only the last two, and only from Stage 3, through `buildGovernorParams` (`governorInputs.ts:321`), which
today sends none of the v3 keys. New row fields ride in `rn_leg_set` and print in `KALSA_LEGS_TABLE`
(`rn-llama.cpp:463`). Bench override `kalsa.bench.speed_fit = "off"` sends `decode_speed_lookahead_s: 0`
(the A/B on one APK; pattern `BENCH_DECODE_HOP_KEY`, `governorInputs.ts:23`).

## 7. Invariants kept (RECON 6)

1. Safety states force CPU (`policy.cpp:571` hop gate): the pass lives inside the hop; unchanged.
2. CPU never excludable (`policy-hop.cpp:153-155`): untouched; the pass picks among `present[]`.
3. One leg change per window at boundaries: the pass runs inside `hop_decide` only.
4. No reload in a hop: present legs only. 5. Platform-raised COOLMODE never buys GPU decode: stricter, the
   pass is disarmed in every non-FAST state (`test_speed_fit_disarmed_by_platform_floor`).
6. Status >= 2 floors, 5 never kills: untouched. 7. HEAT_RANK hysteresis 4 C: the fit set is HEAT_RANK's;
   the pass adds 15 % speed hysteresis and 0.5 C forecast hysteresis (`test_speed_fit_no_flip`).
8. Sanitizers at construction next to the load steps (`policy.cpp:180-187`): speeds finite >= 0 else 0;
   lookahead finite >= 0 else 0; heat/bg finite >= 0 else 0. `lookahead 0` => byte-identical
   (`test_speed_fit_off_is_heat_rank`). 9. Row gating: no row = zeros = off (`legs_table_test.cpp`).
10. App: learned keys sent only with n >= 4 and a matching fingerprint; `thermalHardGate.ts` untouched.

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
`rn-governor-params.cpp` 435, `governorInputs.test.ts` 1001. Additions stay small; new logic in new files.
Each stage: implement -> verify on disk -> one hostile audit -> fix -> next.

**Stage 0 - observe only, in daily use (owner d; no engine change, no decision change).**
Binding: `RNLlamaJSI.cpp` adds `decode_us_{cpu,npu,gpu}` next to the token counters (`:953-956`),
`decode_headroom_first`, `decode_zone_headroom_{cpu,npu,gpu}_last`; `rn-governor.cpp` latches the first
forecast in `before_decode_batch` and keeps the last zone sample; `types.ts`; `nativeSourceGuards.test.ts`
regex; `platform_thermal_test.cpp` + one latch case. App: `src/engine/governorObservation.ts` (pure: two
stats snapshots + timings + thermo -> one row, censored flag; ~120 lines) and `governorObservationLog.ts`
(append JSONL to `files/governor-observations.jsonl`, rotate at 1 MB to `.1`; ~80 lines), tests for both;
`LlamaService.ts` appends one row after every completion in the round loop and logs it as
`KALSA_GOVERNOR_COMPLETION`. Lab: `learning-governor/replay/` node script: reads the JSONL, fits 5.2, prints
seed vs learned, residuals, the wake point, the overshoot after each hop (sets `lookahead_s`), and the
Xiaomi zone trips (from `zone_last` vs cell-76 temps). Device check: S23, 5 turns G2, unplugged: every
completion has a row; a 100 % NPU row's `npu_tps` within 10 % of `predicted_per_second / duty`; the Xiaomi
runs in the owner's daily use (dev APK), pulled by adb before Stage 2. Refuted by negative deltas or > 25 %
disagreement. Old logs (Medium 8): speed and wake point only; they have no `h_first`.

**Stage 1 - learned store in the app (no decision change).** `governorLearned.ts` (store, fingerprint, reset;
~150) and `governorLearnedFit.ts` (ridge, outlier, forgetting, UCB; ~150); tests: fingerprint reset, plugged
skip, censored skip, corrupt JSON -> seed, convergence on synthetic rows, GPU column still at seed after
NPU-only rows, negative mean clamped. Log `KALSA_GOVERNOR_LEARNED {n, ucb_npu, ucb_gpu, ucb_cpu, bg_ucb,
rejected, sent:0, reset}`. Device check: Xiaomi daily use: `n` grows only on accepted rows.

**Stage 2 - engine rule, default off (engine -> binding vendoring + HTP skel rebuild + pin).**
Engine: `llama-ext.h` params `decode_speed_lookahead_s`, `decode_speed_tps_*`, `decode_speed_heat_*`,
`decode_speed_bg_c_per_min`, the stats of 4.7, the rewritten unit comment (`:363-364`). New
`src/llama-governor-policy-speed.cpp` (~180 lines: EWMA setter, `armed`, `forecast_ok`, breaker, pick);
`policy-hop.cpp`: `leg_fit` factored from `heat_rank_fit`, one call in the `ranked >= 0` branch (~10 lines,
file stays under 350); `legs.cpp` pushes the deltas (~6 lines); sanitizers (`policy.cpp:180-187`). Tests
`tests/test-governor-v02-hop-speed-fit.cpp`, split by topic if past ~250: arming (FAST only, platform floor,
plugged, NaN forecast, duty < 1 via forecast and via battery), margin (blind takes GPU; band rejects with
seeds; band accepts with a learned ucb; re-entry hysteresis; S23 seeds never fire), breaker (trips and stays
tripped), isolation (`decode_speed_heat` extreme with lookahead 0 and with armed false: identical),
`test_speed_fit_off_is_heat_rank`, `test_speed_ewma_follows_deltas`. Existing hop and platform tests pass
unchanged. Binding: row fields (both rows `lookahead 0`), parser + sent flags + merge, `KALSA_LEGS_TABLE`,
JSI stats, `vendor/VERSIONS`, HTP skels + `assert-htp-skels.sh`; `governor_params_test.cpp` (parse, 0 heat
leaf allowed, negative refused), `legs_table_test.cpp`. App: pin bump + `assert-engine-provenance.sh`;
`buildGovernorParams` optional learned overrides; new `governorLearnedOverrides.test.ts` (absent ->
byte-identical). Device check: S23 G2 5 turns: zero GPU windows, `speed_fit_windows 0`.

**Stage 3 - enable on the Xiaomi row, send learned heat.** Binding: SM8650 row `decode_speed_lookahead_s =
20`. App: send `decode_speed_heat` / `bg` per 5.3; `KALSA_GOVERNOR_LEARNED {sent:1}`. Check A (null): S23
unchanged, zero GPU windows. Check B: Xiaomi, cold phone (skin < 35 C), unplugged, side sampler on, A/B via
the bench key. Pass with today's lines: `speed_fit_windows == speed_fit_blind_windows` (GPU only while blind),
breaker 0, status never >= 2, skin max <= HEAT_RANK arm + 0.5 C, battery max <= 42.5 C, the first
completion faster than the HEAT_RANK arm's by >= 15 % when the start skin is < 35 C. Pass with the proposed
lines (if adopted, question 1): in-band GPU windows exist, the forecast never exceeds `pacing_start` by more
than 0.017 (0.5 C) while on the GPU, the GPU heat column reaches n >= 4 within two sessions. Refuted by a
breaker trip on a healthy phone, status 3, or a hot-state median below 5.0 tok/s.

## 9. Risks

| risk | guard | refuted by |
|---|---|---|
| overshoot | FAST only, duty 1, zone fit, 20 s upper-heat lookahead + 0.5 C, breaker | status 3, skin > HEAT_RANK's max + 1 C |
| oscillation | window granularity, HEAT_RANK 4 C, 15 % speed, 0.5 C forecast hysteresis | hops per completion > HEAT_RANK's + 2 |
| wrong learned heat | UCB, floor 0.5 x seed, cap 4 x seed, n >= 4, forgetting, breaker | breaker trips on a healthy phone |
| stale store | fingerprint incl. OS build + pin + row | missing `reset` after an engine bump |
| background heat blamed on a leg | `bg` term, outlier gate, censored rows excluded | learned GPU moves on NPU-only sessions |
| Xiaomi trips unknown | zone path is HEAT_RANK's existing test; Stage 0 logs `zone_last` | GPU never fit while cold (then the trip is low and the design's gain is 0 on this phone) |
| memory | a few floats in the policy; app store < 2 KB; JSONL capped 1 MB | S23 MemAvailable min < 1.0 GB (today 1.08-1.37, `s23-g2-full099-233486dd/REPORT.md:31,70`) |

## 10. Open questions for the owner

1. **Pacing lines before Stage 3.** With today's Xiaomi lines (0.053 / 0.173) the forecast band is 1.6 C: the
   GPU runs only while the forecast is blind, and the learner cannot see the GPU's heat on the forecast at
   all. PLAN already proposes 0.15 / 0.25 after one more run. Recommendation: adopt them before Stage 3.
2. **Combination.** "Zone-fit AND forecast-pass-when-speaking, blind abstains" is my reading of "combine them
   prudently". A weighted blend was cut for lack of a measured zone-to-skin conversion. Confirm or redirect.
3. **Stage 0 on the daily driver.** The rows go to a file in the app's private directory, pulled by adb when
   you lend the phone; nothing leaves the phone. Confirm that is acceptable for your Xiaomi.
