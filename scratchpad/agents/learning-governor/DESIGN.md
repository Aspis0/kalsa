# Learning governor - DESIGN v0 (2026-10-12)

Author: Claude Fable 5.1 (architect, owner-granted exception). Design only: no code, no build, no phone.
Inputs: RECON.md, PRIOR-ART.md, engine `f1f612388` (kalsallama-upstream-b11514), binding `2581a9aa`
(llama.rn-kalsa-onecopy), app `df359450` (kalsa-wt-severe), lab PLAN/ALIVE and the cells named below.
Every `file:line` below was read in this session; "assumption" marks what was not measured.

## 0. For the owner, in short

Today's rule v3 (HEAT_RANK) puts each 32-token decode window on the coolest leg that is fit. On the
Xiaomi 14 that is the NPU at 15-16.5 tok/s, while the GPU does ~21 tok/s at ~3x the skin heat per
token. v0 adds one thing: **while the phone is cold enough that no pacing ramp is engaged, and the
next minute on the faster leg would still not engage it, take the faster leg.** Once the phone warms,
HEAT_RANK decides exactly as today. Speed per leg is learned in the engine every turn from counters
it already has. Heat per leg is learned in the app across sessions, seeded by the legs row, stored per
phone, and sent to the engine at the next model load through JSON keys that already exist. Stage 0
changes no decision: it only logs what the learner will read, so we can replay real sessions first.
Not in v0: reinforcement learning, prefill, unknown phones (no row = no one-copy load = nothing to
decide), active probing of a leg the rule would not otherwise use, charging phones.

## 1. v0 scope

v0 = rule + estimator. No RL: the state space is tiny (three legs, one scalar margin), the safety
envelope must be provable with unit tests, and the owner's goal ("spend the faster leg while there is
margin") is a constraint satisfaction question, not a reward one. Conservative bandits (PRIOR-ART 2)
is the right frame: the coolest proven leg is the baseline arm, a faster arm is played only while the
constraint provably holds.

IN v0: (a) a third decode weighting `SPEED_FIT` composed on top of HEAT_RANK's fit set; (b) in-engine
per-leg speed estimate, per turn; (c) app-side per-phone learned heat per leg, persisted, seeded by the
row, pushed at load; (d) a Stage 0 that only observes.
NOT in v0: prefill (GPU prefill on Adreno fails the strict logit oracle, PLAN "Open decisions": V81
R2 FAIL; V75 the same); exploration probes (section 4.4: v0.1, after the replay proves the heat
regression identifiable); mid-turn parameter setters (none needed, section 2.3); learning while
plugged; phones without a legs row; any change to pacing, thresholds, admission, or safety states.

## 2. What is learned, where, and how it persists

### 2.1 Speed per leg (engine, per session, not persisted)

Key: `speed_tps[leg]` for CPU/GPU/NPU, tok/s of compute time (llama_decode only, pacing sleep
excluded). Source: the engine already keeps per-leg tokens and microseconds,
`llama-governor.cpp:545-546` `stats_.decode_tokens_npu += batch.n_tokens; stats_.decode_us_npu +=
engine_us;` and the turn-local deltas are already computed at every turn latch in
`llama-governor-legs.cpp:282-283` `const uint64_t tokens = tokens_now[i] - floor_mark_tokens_[i]; const
uint64_t us = us_now[i] - floor_mark_us_[i];`. Update rule: at `refresh_decode_legs()` (called from
`reset_prefill_stats`, `llama-governor-runtime.cpp` "if (!legs.empty()) { refresh_decode_legs(); }"),
for each leg with >= 2 windows of evidence this turn (the same `tokens < 2ull * hop` warm-up rule,
`legs.cpp:284`), `speed = speed + 0.5 * (turn_tps - speed)`. Seed: a new param
`decode_speed_tps_{npu,gpu,cpu}` from the legs row (section 7). Confidence: the leg's evidence token
count this session; a leg with no evidence keeps its seed. Why in the engine: speed changes within a
session (Xiaomi in-app: 15.3 -> 4.5 tok/s with Android status 0 the whole run,
`xiaomi-g2-inapp-233486dd/REPORT.md:27,32`), so a persisted number would be wrong most of the time;
the engine sees the fresh deltas every turn. Reset: with the governor (model load).

### 2.2 Heat per leg (app, per phone, persisted)

Key: `heat[leg]`, unit "forecast C per 1k tokens" = the Android headroom delta per 1k tokens x 30
(AOSP scales 30 C between headroom 0 and 1, `declaredSevere.ts:16` `DEGREES_BETWEEN_ZERO_AND_ONE =
30`; the Xiaomi fit confirms the slope, 0.0327/C ~ 1/30, `xiaomi-g2-inapp-233486dd/REPORT.md:40`). On the
S23 this equals skin C per 1k (headroom = (skin - 12)/30, `policy.cpp:22-25`); on the Xiaomi it is the
forecast sensor's C, which may be cooler than the hottest HAL skin (report finding 1). That is the right
unit: the decision (section 4) is made in forecast units.
Observation per turn (section 3): `y = (h_end - h_start) * 30`, `x = tokens_{npu,gpu,cpu} / 1000`.
Update: Bayesian ridge per phone, prior mean = the seed row, prior weight n0 = 4 turns, closed form
over the stored sufficient statistics (3x3 `XtX`, 3-vector `Xty`, n). Accepted turns only: unplugged,
`decode_paced_tokens` delta = 0 (no sleep in the window, else the per-token rate is diluted), decode
time >= 60 s, no model reload inside, finite `h_start`/`h_end`. Assumption: the cooling term is
ignored for turns >= 60 s; the replay (Stage 0) measures the residual and decides whether a
first-order cooling term `-k (h_start - h_idle) * dt` is needed (PRIOR-ART 10 says an LTI model fits
phones to 0.3 C mean error).
Seed and confidence: the row values with n0; the learned row replaces the seed only after n >= 4
accepted turns for the leg's column (otherwise the seed is sent).
Staleness reset: the store is keyed by a fingerprint = `Build.MODEL` + `socModel`
(`GovernorBatteryModule.kt:96` `result.putString("socModel", Build.SOC_MODEL)`) + the app's binding
pin string (`package.json`) + the legs row values the app will send; a mismatch starts from the seed.
Persistence: AsyncStorage key `kalsa.governor.learned.v1` (JSON, one object per fingerprint). Today
nothing per-device is persisted (RECON 4); this is the first such key, bench keys aside.

### 2.3 Why no new engine entry point in v0

The row's decode keys are construction-only (RECON 4), but the binding already lets JSON override every
one of them per load and the row fills only what JS did not send: `rn-governor-params.cpp:366-370` `if
(!sent.heat_per_token) { merged.decode_heat_per_token_npu = row...` and the parser reads
`"decode_heat_per_token"` / `"decode_load_step"` (`:295,:298`). So learned heat reaches HEAT_RANK and
SPEED_FIT at the next load through `buildGovernorParams` (`governorInputs.ts:321`), which today sends
none of these keys. Speed is learned inside the engine (2.1). The only new wire fields are the seeds
and the switch (`decode_speed_tps_*`, `decode_speed_lookahead_s`), parsed and merged like the others.
A mid-turn setter is v1, if the replay shows load-time heat is too stale.

## 3. Observations per turn

| what | source today | gap |
|---|---|---|
| per-leg tokens | `KALSA_GOVERNOR` `decode_tokens_{cpu,npu,gpu}` (`LlamaService.ts:1886-1888`), cumulative since clear | diff consecutive lines (RECON 5) |
| per-leg time | engine `decode_us_*` (`llama-ext.h:564-566`) | NOT in JSI: `RNLlamaJSI.cpp:953-963` sets tokens, never `decode_us_*`; not in types.ts; not in the line |
| forecast headroom | `decode_pacing_headroom_last` (`LlamaService.ts:1901`) | last only; `h_start` missing (the carry is 10 s, `rn-platform-thermal.h:25`, so the previous turn's last is stale after a pause) |
| battery temp/level/plugged | the profile the app pushed per completion (`LlamaService.ts:1785-1790`) | value not logged in `KALSA_GOVERNOR` |
| pacing | `decode_paced_tokens`, `duty_last` (`:1898-1900`) | fine |
| per-leg zone headroom | binding `rn_thermal_legs::sample()` every 32 tokens (`rn-governor.cpp:181-183`) | never reaches JS or logcat; the engine's hop line (`policy-hop.cpp:292`) goes to the JS tail but is mirrored to logcat only for WARN/ERROR or with the bench mirror flag (`nativeLogTail.ts:70-72`) |
| skin (hottest HAL) | lab side sampler (dumpsys) only | not readable in-app; replay joins it by timestamp |

Heat attribution with a leg that changes every 32 tokens and a skin that lags minutes: do NOT
attribute per window. Attribute per turn by the regression of 2.2, where the leg mix is the regressor.
With HEAT_RANK most turns are 100 % NPU, so the GPU and CPU columns are identifiable only on turns the
rule actually mixed (SPEED_FIT's cold turns give GPU evidence by construction; CPU evidence comes from
safety-state turns). Columns without evidence keep the seed: the learner never invents a number.

## 4. Decision rule

### 4.1 Where it sits

`hop_decide()` (`policy-hop.cpp:159`) at window boundaries only (`policy.cpp:573-577`), after
HEAT_RANK's `heat_rank_fit` (`policy-hop.cpp:227-231`). Fit stays HEAT_RANK's: current leg holds while
`headroom >= guard`, an idle candidate needs `headroom - load_step >= guard + hysteresis`
(`policy-hop.cpp:78-80`). SPEED_FIT only changes WHICH fit leg takes the window:

```
if weighting == SPEED_FIT and speed_rule_armed():
    fit = { legs that pass heat_rank_fit's own test }
    best = argmax speed_tps over fit, taken only if speed_tps[best] >= 1.15 * speed_tps[cheapest_fit]
    leg = best if margin_ok(best) else cheapest_fit     # cheapest_fit = HEAT_RANK's answer
else: HEAT_RANK as today
```

### 4.2 Predicted margin

`margin_ok(L)`: `h_now + heat[L] * speed_tps[L] * lookahead_s / 1000 / 30 <= pacing_start - margin`,
with `h_now` the policy's platform headroom (`policy.h:134`), `pacing_start` the per-phone line already
sent (`declaredSevere.ts:46-57`), `lookahead_s` = `decode_speed_lookahead_s` (row/JSON; 0 = rule off),
`margin` = 0.03 (~1 C) and the re-entry hysteresis = another 0.03. The lookahead in seconds, not
tokens, is the skin-lag guard: the skin needs about a minute to show a leg's heat (Xiaomi GPU: +6.3 C
in the first 100 s, `xiaomi-endur-npu-gpu-75/REPORT.md:30`); 60 s is an assumption to be checked in the
Stage 0 replay. Worked example, Xiaomi, GPU: 3.2 x 21 x 60 / 1000 / 30 = 0.134 (~4 C), start line
0.053 (skin 38.1): the GPU is taken only while the forecast reads <= -0.08, i.e. the phone is cold
(AOSP floors at 0; in practice skin under ~34 C). That is the intended v0 behaviour: speed in the cold
first turn(s), then HEAT_RANK. The learned heat and speed move that boundary per phone.

### 4.3 Arming: when a hotter-but-faster leg is allowed at all

`speed_rule_armed()` is true only when ALL hold: state == FAST (not WARM/COOLMODE: the hop runs in
COOLMODE today, `policy.cpp:571` `not_a_safety_state()`, but v0 never spends heat there); no platform
floor (`state_from_platform_` false); platform status <= 1; last pacing duty == 1.0; profile unplugged;
`h_now` finite (NaN forecast = no margin = HEAT_RANK). Everything else (safety states, lane down,
CRITICAL, LOWBAT) never reaches hop_decide, unchanged.

### 4.4 Exploration

v0: none. The rule observes the speed of whatever leg it runs; a leg it never runs keeps its seed.
v0.1 (owner question 3): one bounded probe window per turn, only when armed, only for a leg whose
speed evidence this session is < 2 windows, at most 3 per session, never GPU_COOLMODE. Bounded by the
same `margin_ok`.

### 4.5 Composition with pacing and safety

Pacing (`llama-governor-pacing-duty.cpp:68-87`) is untouched and runs underneath: if the forecast,
battery or status ramp engages, duty < 1 disarms the speed rule at the next window and HEAT_RANK takes
over; the ramps keep slowing whatever leg runs. The rule never touches `GPU_COOLMODE`, reloads,
admission, or `prefill_engine()`.

### 4.6 Invariants (RECON 6) and how v0 keeps them

1. Safety states force CPU (`policy.cpp:381-382,415,571`): v0 lives inside the hop, reached only when
   `hop_active`; unchanged. Test: existing safety tests + `test_speed_fit_off_in_safety_states`.
2. CPU never excludable (`policy-hop.cpp:153-156`): untouched.
3. One leg change per window, at boundaries (`policy.cpp:573-577`): SPEED_FIT decides in hop_decide only.
4. No reload inside a hop: SPEED_FIT picks among `present[]` legs only.
5. Platform-raised COOLMODE never buys GPU decode (`test_platform_coolmode_never_buys_gpu_decode`):
   stricter in v0, the speed rule is disarmed in every COOLMODE. New test
   `test_speed_fit_disarmed_by_platform_floor`.
6. Status >= 2 floors at COOLMODE, status 5 never kills: untouched.
7. HEAT_RANK hysteresis 4 C, return needs guard + hysteresis: the fit set is HEAT_RANK's; the speed
   choice adds its own 15 % speed hysteresis and the 0.03 margin hysteresis. Test
   `test_speed_fit_no_flip_on_equal_speeds`.
8. Pacing sanitizers: new params sanitized at construction like the load steps
   (`policy.cpp:180-187`): speed seeds finite and >= 0 else 0 (= no evidence); lookahead finite and >= 0
   else 0 (= off). `decode_speed_lookahead_s = 0` keeps every decision byte-identical to HEAT_RANK:
   test `test_speed_fit_off_is_heat_rank`.
9. Binding row gating (`legs_table_test.cpp` `test_no_match_tuning_is_zero`, `test_row_returns_tuning`):
   the new row fields ride in `rn_leg_set`; no row = zeros = off.
10. App: `governorInputs.test.ts` extended (learned keys sent only when the store has n >= 4 and the
    fingerprint matches); hard gate `thermalHardGate.ts` untouched.

## 5. The units conflict

Both rows are **skin C per 1k tokens**: cell 76 says so in the heading `xiaomi-legheat-76/REPORT.md:51`
"Heat per token (skin C per 1k tokens, the S23 row's unit)", and ALIVE's proven table reads "S23
decode heat per 1k tokens NPU 2.8 / GPU 3.2 / CPU 4.7 C skin". The S23 row comment "per-token heat
2.8/3.2/4.7 skin C" (`rn-legs-table.cpp:78-79`) is shorthand for the same number; the engine comment
`llama-ext.h:363-364` "battery C*s/token from the lab; NPU 0.15-0.17, CPU 0.30, GPU 0.35-0.42" is stale
(an older battery-based unit) and must be rewritten in Stage 2 (comment only). Consequences: HEAT_RANK
uses the value ordinally (`heat_rank_fit` compares, `policy-hop.cpp:70-71`), so the unit never
mattered there; NPU_FIRST's `effective_of` multiplies it by weight 7 (`:206`) as a C penalty, which with
"per 1k" values is 19.6 C for the S23 NPU: a magnitude nobody measured, reached only when no leg is
fit. v0 assumes "per 1k tokens, forecast C" (section 2.2) everywhere, seeds from the rows as they are,
and the learner's estimate replaces them in the same unit. Known weakness of the seed itself: a rise
integrated over an arm, confounded by start temperature and run length (the NPU's 8k-token run was at
a plateau, the GPU's 2k run on the steep part, `xiaomi-endur-npu-gpu-75/REPORT.md:31,49`); the
regression corrects that over turns.

## 6. Risks and how each is measured

| risk | guard in v0 | measurement / what refutes |
|---|---|---|
| thermal overshoot | armed only in FAST, duty 1, status <= 1, with a 60 s lookahead and 1 C margin; disarms at the first paced window | G2 run with SPEED_FIT vs HEAT_RANK on the same phone: skin max within +0.5 C, Android status 3 samples = 0, tokens-to-43 C not worse by > 10 %. Refuted by any status 3 or skin > HEAT_RANK's max + 1 C |
| oscillation | window granularity, HEAT_RANK's 4 C, 15 % speed hysteresis, 0.03 re-entry hysteresis | hops per turn <= HEAT_RANK's + 2 (from `decode_hops` deltas) |
| stale learned state | fingerprint reset; n0 prior; seed sent until n >= 4 | `KALSA_GOVERNOR_LEARNED {reset:"fingerprint"}` on every reset; a run after an engine bump must log it |
| charging phone | no update and no arming while `plugged`; QDC boards are plugged | a plugged session must log `learned_skipped:"plugged"` every turn |
| quality | decode-only; prefill untouched; decode legs correct (KL <= 1.2e-4, ALIVE proven table) | the in-app answers of the device check on topic; no oracle needed for decode |
| memory | no new context, no reload; learner state is a few floats; speed EWMA in-engine | MemAvailable min >= 1.0 GB on the S23 run (today 1.08-1.35 GB, `s23-g2-full099-233486dd/REPORT.md:31,70`) |
| unknown phones | no row -> two-model load, hop on CPU/NPU only, GPU absent (`rn_legs_for` returns `{}`, `rn-legs-table.cpp:202`) | by construction; one load on the Jelly logs `one_copy:0` and no SPEED_FIT fields |
| NPU slows while "cool" (Xiaomi hidden caps) | speed is re-estimated every turn, so a throttled NPU loses to the GPU only if margin_ok, which it is not when warm | replay: per-turn speed trace vs the EWMA |

## 7. Staged plan

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

Declared pre-existing excess: `llama-ext.h` 826 lines, `llama-governor-policy.cpp` 663,
`LlamaService.ts` 6868, `rn-governor-params.cpp` 435. Nothing below refactors them; additions stay
small and the new logic goes in new files.

### Stage 0 - observe only (no engine change, no decision change)

Binding (`llama.rn-kalsa-onecopy`): `cpp/jsi/RNLlamaJSI.cpp` add `decode_us_cpu/npu/gpu` next to the
token counters (`:953-956`) and `decode_pacing_headroom_first`; `cpp/rn-governor.cpp` records the first
finite forecast of each completion (`reset_prefill_stats` clears it, `refresh_platform_thermal` sets it
once) and exposes it in `stats()`; `src/types.ts` fields. Tests: `src/__tests__/nativeSourceGuards.test.ts`
regex extended; `tests/platform_thermal_test.cpp` + one case for the first-forecast latch.
App (`kalsa`): `src/engine/governorTurnLegs.ts` (new, pure: per-turn deltas of tokens/us per leg ->
tok/s, `h_start`/`h_end`, accepted-turn predicate of 2.2; ~120 lines) and its test
`governorTurnLegs.test.ts`; `LlamaService.ts` adds to `KALSA_GOVERNOR` the fields `decode_us_*`,
`headroom_first`, `batt_temp_tenths_c`, `plugged`, and a `legs:{npu:{tok,tps},...}` object computed by the
new module (`governorPlanEmission.test.ts` pattern). Lab: `scratchpad/agents/learning-governor/replay/`
a node script that joins `KALSA_GOVERNOR` lines with the side sampler CSV and fits section 2.2; prints
seed vs learned row and residuals. Device check: S23, 5 turns of the G2 script, unplugged. Pass: every
turn has the new fields; a 100 % NPU turn's `legs.npu.tps` within 10 % of `predictedPerSecond` x
(1 / duty_last); replay residual reported. Refuted by negative deltas or > 25 % disagreement.
Then: replay the existing Xiaomi and S23 G2 logs where the sampler CSVs exist (the per-leg time is
missing there, so only the heat fit) and decide the cooling term (2.2 assumption) before Stage 2.

### Stage 1 - learned store in the app (no decision change)

App: `src/engine/governorLearned.ts` (store: fingerprint, read/write, reset, ~150 lines) and
`governorLearnedUpdate.ts` (ridge update over sufficient statistics, ~120 lines); tests
`governorLearned.test.ts` (fingerprint reset, plugged skip, corrupt JSON -> seed) and
`governorLearnedUpdate.test.ts` (seed-only, converges on synthetic turns, rejects paced turns).
`LlamaService.ts`: after each `KALSA_GOVERNOR` line, update the store; log `KALSA_GOVERNOR_LEARNED
{n, heat_npu, heat_gpu, heat_cpu, sent:0, reset}`. Nothing is sent to the engine yet. Device check:
Xiaomi, one session (when lent): `n` grows only on accepted turns; a plugged turn logs the skip. Refuted
if the learned GPU column moves while no GPU tokens were decoded.

### Stage 2 - engine rule, default off (engine -> binding vendoring + HTP skel rebuild)

Engine: `src/llama-ext.h` adds `SPEED_FIT` to `llama_governor_leg_weighting`, params
`decode_speed_tps_{npu,gpu,cpu}` and `decode_speed_lookahead_s` (default 0), stats
`decode_speed_tps_{npu,gpu,cpu}`, and rewrites the stale unit comment (`:363-364`).
`src/llama-governor-policy.h`: `set_decode_speed()` (internal, called by the governor at the turn
latch) and the three speed fields. New `src/llama-governor-policy-speed.cpp` (~120 lines: the EWMA
setter, `speed_rule_armed`, `margin_ok`, `speed_fit_pick`); `policy-hop.cpp` calls it in the
`ranked >= 0` branch (one call, ~8 lines, keeps the file under 350). `llama-governor-legs.cpp`
`refresh_decode_legs` pushes the turn deltas it already computes (~6 lines). Sanitizers next to the
load-step ones (`policy.cpp:180-187`). Tests: new `tests/test-governor-v02-hop-speed-fit.cpp`
(`test_speed_fit_off_is_heat_rank`, `test_speed_fit_takes_faster_fit_leg_when_cold`,
`test_speed_fit_disarmed_when_paced`, `test_speed_fit_disarmed_by_platform_floor`,
`test_speed_fit_off_in_safety_states`, `test_speed_fit_no_flip_on_equal_speeds`,
`test_speed_seed_used_without_evidence`, `test_speed_ewma_follows_turn_deltas`). Existing
`test-governor-v02-hop-heat-rank.cpp` and `test-governor-platform-thermal.cpp` must pass unchanged.
Binding: `cpp/rn-legs-table.cpp` row fields (`decode_speed_tps_*`, `decode_speed_lookahead_s`; S23 row
17.1/15.0/13.0 tok/s, lookahead 0; SM8650 row 16.0/21.0/14.7, lookahead 0 until Stage 3);
`rn-governor-params.cpp` parses `"decode_speed_tps"`, `"decode_speed_lookahead_s"`, sent flags, merge;
`rn-llama.cpp` `KALSA_LEGS_TABLE` prints them; JSI exposes the speed stats; `vendor/VERSIONS`, HTP skels
rebuilt and `assert-htp-skels.sh` green. Tests: `tests/governor_params_test.cpp` (parse, invalid ->
0), `legs_table_test.cpp` (`test_row_returns_tuning` extended), `nativeSourceGuards.test.ts`.
App: pin bump + `scripts/assert-engine-provenance.sh`; `buildGovernorParams` accepts optional learned
overrides (`governorInputs.test.ts`: absent -> byte-identical params). Device check: S23 (lookahead 0
everywhere): the G2 5-turn script shows `weighting:"heat_rank"` behaviour and identical leg mix
(`decode_tokens_gpu` delta 0 on every turn). Refuted by any GPU window.

### Stage 3 - enable on the Xiaomi row, send learned heat

Binding: SM8650 row `decode_speed_lookahead_s = 60`. App: send `decode_heat_per_token` from the store
when `n >= 4` and the fingerprint matches, else nothing; `KALSA_GOVERNOR_LEARNED {sent:1}`. Device
check A (null control): S23 unchanged (NPU is fastest and coolest there: 17.1 vs 14.5-15.7 tok/s,
ALIVE kit table), expect zero GPU windows. Device check B: Xiaomi 14, G2 script from a cold phone,
unplugged, owner's phone when lent, side sampler on. Pass: turn 1-2 completions faster than the
HEAT_RANK run's (15.3/15.1 tok/s, `xiaomi-g2-inapp-233486dd/REPORT.md:27`) by >= 15 %, GPU windows only
while `headroom_first <= 0.0`, status never >= 2, skin max <= 45.4 C (HEAT_RANK's 44.9 + 0.5), battery
max <= 42.5 C, hot-state median not worse than 5.5 tok/s. Refuted by: GPU windows after the first
paced window, status 3, or a hot-state median below 5.0 tok/s.

### Stage 4 (v0.1, after owner question 3) - bounded probes

Engine only (`policy-speed.cpp`, +~40 lines, test file split by topic if it passes ~250). Device
check on the Xiaomi: at most 3 probe windows per session logged; heat regression `n` for the probed
column grows.

## 8. Open questions for the owner (max 5)

1. **Objective when cold.** v0 maximizes speed only while no ramp is engaged and the next minute would
   not engage one; once warm, heat wins as today. Alternative: always heat (today). Recommendation:
   v0 as designed; it is the smallest rule that spends the GPU on the Xiaomi at all.
2. **Margin source.** Android's forecast headroom (per-phone SEVERE offset already declared in the app)
   vs the hottest HAL skin (not readable in-app; the Xiaomi forecast reads a cooler sensor, finding 1
   of the in-app cell). Recommendation: the forecast, with the lab sampler as the audit; if the Xiaomi
   skin exceeds 45.4 C in Stage 3 the margin constant moves, not the source.
3. **Exploration.** None in v0 (a leg never run keeps its seed) vs one bounded probe window per turn
   in FAST (v0.1). Recommendation: none until the Stage 0 replay shows the heat regression converges
   on real turns; probes are cheap to add later and expensive to debug now.
4. **Where the learned heat lives.** App storage per phone fingerprint, applied at the next load (this
   design) vs a native file plus a mid-turn setter (new engine entry point). Recommendation: app
   storage; heat per leg is a slow per-phone constant, speed is the fast one and is learned in-engine.
5. **Which phone enables first, and the row-less phones.** Recommendation: Xiaomi 14 first (the only
   phone where the GPU is faster), S23 as the null control; 8 Elite / 8 Elite Gen 5 stay off (no row,
   and QDC boards are plugged so nothing is learnable there); phones without a row get nothing in v0,
   because they never load one-copy - confirm that unknown-phone learning is v1, not v0.
