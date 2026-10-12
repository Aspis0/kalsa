# Learning governor - DESIGN v0.5 (2026-10-12)

Author: Claude Fable 5.1 (architect, owner-granted exception). Design only: no code, no build, no phone.
v0.5 revises only the Stage 0 / 0b sections after the re-audit of v0.4 (section 1a). v0.4 applied the coordinator's split after AUDIT-3: Stage 0 is frozen as pure observation and written as an
implementable spec (section 3); the Xiaomi pacing lines are their own step, Stage 0b (section 4); the speed rule
(Stages 2-3) keeps only the cheap paper fixes and lists the rest as OPEN items to close with Stage 0 data
(section 5). History: v0 -> v0.2 answered AUDIT-1; v0.3 answered AUDIT-2 (owner decisions 2026-10-12: lines
39.0 / 42.6 C = 0.083 / 0.203; blind abstains, zones decide, both must pass; private numeric Stage 0 file;
margins that actually fire). Inputs: engine `f1f612388`, binding `2581a9aa`, app `df359450`, lab cells 75, 76,
`xiaomi-g2-inapp-233486dd`. Every `file:line` was read this session and the line is quoted; ASSUMPTION marks what
was not measured.

## 0. For the owner, in short

Nothing decides differently until Stage 2. Stage 0 only records, on your phone and in a private numeric file,
what the future rule will read: per completion, the tokens and time on each leg, the forecast at the first and
last decode step and how old it was, the battery, and one sample per 32-token window with the forecast, the three
component temperatures and their trip points. Stage 0b moves the Xiaomi pacing lines to 39.0 / 42.6 C: that IS
a decision change, so it is its own step with its own check. The speed rule stays as approved (speed while cold,
HEAT_RANK once warm; blind forecast abstains, zones decide, both must pass when it speaks), with the arithmetic
and freshness holes AUDIT-3 found closed on paper, and nine numbers it needs measured listed as OPEN, each
with the Stage 0 field that measures it. Cut: everything the speed rule does not need before Stage 2.

## 1. Changes from v0.3 (AUDIT-3 and the coordinator's split)

| item | resolution | section |
|---|---|---|
| CRITICAL: Stage 0 moved the Xiaomi lines | Stage 0 frozen as observation only; the lines are Stage 0b, app-only, own check | 3, 4 |
| HIGH: absent status defeated by the binding's carry | profile stamp `status_read_ms` (from `platform_native_valid_us_`); arming needs status 0/1 AND age <= 10 s | 5.1 |
| HIGH: battery / plugged stale mid-completion | explicit disarm at app-profile age > 120 s; Stage 0 probes the battery sysfs path; OPEN 4 decides a native 5 s refresh | 5.1, 5.7 |
| HIGH: speed pass heats 2.91x / 3.82x | acknowledged as the design's point; bounded by the band and the blind budget | 5.2, 5.4 |
| HIGH: blind-path bound not a skin bound | restated in zone terms (guard 5 C under each trip) + wake point + 2,048 tokens per 10 min budget | 5.4 |
| HIGH: breaker timing overstated; blind heat missed | 9.9 s / 4.25 s at 2x / 3x after the wake latch, + 2 s read + 1 window; blind heat covered by 5.4, not the breaker | 5.5 |
| HIGH: arming inputs not at hop_decide; `now_ms` | listed as the Stage 2 plumbing; `now_ms` passed from `select_decode` | 5.1, 6 |
| headroom age gate vs early return `rn-governor.cpp:285-288` | push when the finite read time advanced, not only on value change | 5.1 |
| REFUTED: 0.5 C double-counted | formula fixed: overshoot 0.004 / 0.676 / 1.348 C at 2x / 3x / 4x; duty 0.878 at 3x | 5.3 |
| two skin/headroom maps | one map: skin = 36.5 + 30 h (AOSP); the cell fit is a cross-check (39.0 C: 0.087 vs 0.083) | 5.3 |
| ~20 rows is post-enable; Stage 0 has no GPU rows | stated; identification moves to Stage 3 Check B and the lab cell | 5.7 |
| REFUTED: Stage 0 cannot replay GPU overshoot | Stage 0 replay scope restricted to what today's decisions produce; lookahead is OPEN 7 | 3.5, 5.7 |
| cooling / background unvalidated | replay reports the fit and collinearity; OPEN 6 | 5.7 |
| firmware change; `Build.FINGERPRINT` absent today | Stage 1 work, unchanged | 6 |
| ring in its own file; rotation unverified | `cpp/rn-governor-samples.cpp`; rotation specified and tested | 3.1, 3.2 |

## 1a. Changes from v0.4 (re-audit of Stage 0 / 0b)

| re-audit item | resolution | section |
|---|---|---|
| 1 hook delays stop / next round | after `bailIfStopped()` and the pause check; stats read awaited with a 2 s bound (not 15 s); file I/O fire-and-forget on a promise chain; stop/pause/timeout -> `gap:1` | 3.2 |
| 2 no status / app-sample ages per window | 11-cell window sample with status, status age, app age; five atomics in `rn_governor` | 3.1 |
| 3 trips have no route to JSI | `trip_range_c` accessor on the legs reader; one-shot `set_trips` at `init_hop_reader`; `decode_zone_trips` on the wire | 3.1 |
| 4 one combined sysfs snapshot | `struct headroom` gains the hot temps; `sample()` fills both in one loop | 3.1 |
| 5 tok/us vs tok/s; leg-mix baseline | `decode_us_*` in microseconds; `tok x 1e6 / us` vs `pps` on unpaced rows; control arm on `df359450`, per-leg deltas within 32 tokens | 3.1, 3.4 |
| 6 0b check not forecast-specific | windows constrained to battery < 39.5 C and status <= 1; `duty_last(k)` aligned with `h(k-1)`; expected `headroom_duty` from the lines | 4 |
| 7 battery probe unspecified | `rn-battery-sysfs.{h,cpp}`, fields, failure values, own tag, per-completion read, test; OPEN 4 decided by the 3.3 comparison | 3.1, 3.3 |
| 8 nullable cells, thermo source, run_tests, schema, "no engine call" | `number \| null` cells and replay rules; the round keeps the whole snapshot (`:1824`); run block in `run_tests.sh`; tags registered in `config.mjs` / `selftest.mjs`; wording corrected | 3.1-3.3, 7 |

## 2. Scope of v0.4

IN: Stage 0 (3), Stage 0b (4), the speed rule as approved with paper fixes (5), Stages 1-3 outline (6). OUT, cut:
prefill; exploration; a mid-turn setter; plugged learning or arming; row-less phones (`rn-legs-table.cpp:202`
`return {};`); the battery as a margin source; zone-scale heat model or any blend; in-engine skin; zone breaker;
per-window native log line; any engine change in Stage 0; any pacing change in Stage 0.

## 3. Stage 0 - observation only (binding + app; no engine change, no decision change)

### 3.1 Binding (`llama.rn-kalsa-onecopy`, from `2581a9aa`)

**One combined sysfs snapshot per window.** `cpp/rn-thermal-legs.h` `struct headroom` (`:32-38`) gains three
fields `cpu_hot_c, npu_hot_c, gpu_hot_c` (the max temp over the leg's zones); `sample()` (`rn-thermal-legs.cpp:102`)
fills headroom and hot temp from the same loop, one `read_long` per zone per window, and the existing dark-zone
rule (`:108` "One dark zone makes the whole leg unknown") makes both NaN. `feed_decode_headroom` (`rn-governor.cpp:
187-196`) keeps passing the three headrooms to the engine unchanged and hands the whole struct to the record below.
New public accessor `trip_range trip_range_c(leg)` = min and max `passive_trip_mc` (`rn-thermal-legs.h:13`) over
the leg's zones, NaN for an empty leg. Tests: `tests/thermal_legs_test.cpp` + 3 cases (hot = max, dark zone NaN
for both fields, trip range).
**New `cpp/rn-governor-samples.h` / `.cpp` (~150 lines).** Responsibility: the per-completion observation record of
the decode hop.
```
struct rn_window_sample { uint32_t tokens; int8_t leg_prev;            // 0 cpu 1 gpu 2 npu, -1 none
    float headroom; int32_t headroom_age_ms; int32_t status; int32_t status_age_ms; int32_t app_age_ms;
    float cpu_hot_c, npu_hot_c, gpu_hot_c; float duty_last; };          // 11 cells; NaN/-1 = unknown
struct rn_leg_trips { float cpu_min_c, cpu_max_c, npu_min_c, npu_max_c, gpu_min_c, gpu_max_c; };
struct rn_battery_sysfs { bool temp_ok; int32_t temp_tenths_c; bool status_ok; int8_t status; };  // 3.1 probe
class rn_governor_samples {           // decode-thread only, under rn_governor::engine_mutex_
  void set_trips(const rn_leg_trips &);                // once, at init_hop_reader
  void reset(int64_t now_ms);                          // completion start: ring empty, stamps 0, latch open
  void first_step(int64_t now_ms, const rn_window_sample & snapshot, const rn_battery_sysfs &);  // once
  void last_step(int64_t now_ms);
  void record(const rn_window_sample &);               // ring of 256, overflow flag
  // getters: trips, first_step_ms, last_step_ms, first (the first_step sample), battery, count, overflow, samples()
};
```
Precedent for a bounded per-completion record with an overflow flag: `llama-ext.h:610` `llama_governor_route_chunk
route_chunks[64] = {};`.
**Freshness snapshot.** `rn_governor` gains five atomics written wherever a profile is accepted under
`profile_mutex_` (`rn-governor.cpp:199` `set_thermo_profile`, which also stamps a new `app_sample_us_`; the native
refresh `:309` `thermo_profile_ = updated;`): forecast value and read time (`platform_headroom_state_.read_us`,
`rn-governor.h:107`), status and its read time (`platform_native_valid_us_`, `:110`), `app_sample_us_`. The decode
thread reads them lock-free in `before_decode_batch`, which holds `engine_mutex_` and must not take
`profile_mutex_` (lock order, `rn-governor.h:95-97`). Five independent atomics can tear between fields; for a log
that is harmless and is stated in the header comment. Ages are `now - stamp` in ms, -1 when the stamp is 0.
**Hooks in `rn-governor.cpp`.** `before_decode_batch` (`:164-185`): at `n_tokens == 1` and mirror 0, `first_step`
with the snapshot and one battery sysfs read; at every multiple of the hop (`:181`) `record` a sample whose
`leg_prev` is the engine's current decode engine read with `llama_governor_get_stats` on the held lock
(`decode_engine` = the leg that ran the last step, `RNLlamaJSI.cpp:944` `governorEngineName(stats.decode_engine)`),
plus the snapshot, the combined zone reading and `decode_pacing_duty_last`; every 1-token batch calls
`last_step`. `reset_prefill_stats` (`:156-162`) calls `samples_.reset`. `init_hop_reader` (`:61-74`) calls
`set_trips` from `trip_range_c`. New accessor `rn_governor_samples samples() const` (copy under `engine_mutex_`,
like `stats()` `:328-333`).
**Battery sysfs probe (OPEN 4), fully specified.** New `cpp/rn-battery-sysfs.h` / `.cpp` (~70 lines):
`rn_battery_sysfs rn_battery_sysfs_read(const std::string & root)` reads `root + "/battery/temp"` (integer, tenths
of C on Qualcomm Android: ASSUMPTION, the cross-check below is the test) and `root + "/battery/status"` (text:
"Charging" 1, "Discharging" 2, "Not charging" 3, "Full" 4, anything else 0). Failure values: a missing or
non-numeric temp -> `temp_ok false, temp_tenths_c -1`; a missing status -> `status_ok false, status 0`. Never
throws. Production root `/sys/class/power_supply`. Called once at `rn_governor` construction, logged on its own
tag (`KALSA_GOVERNOR_PLATFORM` stays status-only by contract, `rn-governor.cpp:80`):
`KALSA_GOVERNOR_BATTERY_SYSFS {temp_ok:%d, temp_tenths_c:%d, status_ok:%d, status:%d}`; and once per completion
at `first_step`, recorded in the samples. Test `tests/battery_sysfs_test.cpp` over a temp dir: both files present,
garbage temp, unknown status string, directory absent.
**`cpp/rn-llama.h/.cpp`**: `rn_governor_samples governorSamples() const` beside `governorStats()` (`rn-llama.h:225`,
`rn-llama.cpp:1390-1392`).
**`cpp/jsi/RNLlamaJSI.cpp`** `getGovernorStats` (`:913`): read `ctx->governorSamples()` in the same task as
`ctx->governorStats()` (`:921`); after `state_source` (`:980`) add `decode_us_cpu/npu/gpu` (microseconds, as the
engine names them, `llama-ext.h:564-566`), `decode_first_step_ms`, `decode_last_step_ms`, `decode_first_sample`
(the 11 cells of the first_step sample), `decode_batt_sysfs` (`[temp_ok, temp_tenths_c, status_ok, status]`),
`decode_zone_trips` (the 6 trip cells), `decode_window_samples` (a `jsi::Array` of 11-cell arrays in struct order),
`decode_window_samples_overflow`. **Every NaN or -1-coded cell crosses as `null`** (the `:965-968` pattern), so a
cell is `number | null`.
**`src/types.ts`** `GovernorStats` (`:298`): the fields above, `decode_window_samples: Array<Array<number | null>>`
with the 11-column order in the doc comment. **`src/__tests__/nativeSourceGuards.test.ts`**: one test pinning the
adjacency of `decode_us_cpu` / `_npu` / `_gpu` on the wire, same shape as `:136-141`.
**Build and tests**: `cmake/rnllama-sources.cmake:152` lists `rn-thermal-legs.cpp`; add `rn-governor-samples.cpp`
and `rn-battery-sysfs.cpp` beside it (`scripts/assert-rnllama-sources.sh` checks the manifest). New
`tests/governor_samples_test.cpp` (ring order, overflow flag, reset clears, first-step latch once, last-step
advances, trips set once) and `tests/battery_sysfs_test.cpp`, each registered in `tests/CMakeLists.txt` after
`platform_thermal_test` (`:167-172` shape) and in `tests/run_tests.sh` twice: the executable check (`:55-59`
shape) and the run block (`:135-136` shape `echo "--- Running Platform Thermal Tests ---"; if
./platform_thermal_test; then`). Host run: `tests/build_and_test.sh > /tmp/out.log 2>&1; echo "EXIT=$?"; tail -30
/tmp/out.log`.
**No engine change**: `vendor/VERSIONS` keeps `LLAMA_CPP_REF=f1f612388e6869f6f6444a3619b6da39ddcbf2f0`; no skel
rebuild; `scripts/assert-htp-skels.sh` must still pass (its gates read the vendored engine and the skel stamps,
`:25-36`, not `cpp/`). Commit on `main`, no push; the commit names repo, branch, HEAD.

### 3.2 App (`kalsa`, from `df359450`)

**Pin**: `package.json:54` `"llama.rn": "github:Aspis0/kalsa.rn#2581a9aa..."` -> the new binding commit, lockfile
regenerated, `bash scripts/assert-engine-provenance.sh` green (`:2`). CI `apk.yml` runs it (`:86`) and
`assert-htp-skels-installed.sh` (`:95`).
**New `src/engine/governorObservation.ts` (~120 lines, pure)**: `buildObservationRow(prev, stats, completion, thermo,
ids, gap)` -> one row from two `GovernorStats` snapshots (deltas of `decode_tokens_*`, `decode_us_*`, `decode_hops`,
`decode_paced_tokens`, `decode_paced_ms`; `prev` null -> cumulative values and `first_row:1`), the completion
timings (`prompt_n`, `predicted_n`, `predicted_ms`, `predicted_per_second`, binding `src/types.ts:624-629`), the
thermo profile this round pushed (the object `nativeGovernorThermo(snapshot)` builds, `LlamaService.ts:1790`:
`batt_temp_tenths_c`, `batt_level_pct`, `plugged`, `platform_thermal_status`), and the stats' `thermal_state`,
`state_source`, `decode_pacing_duty_last`, `decode_pacing_headroom_last`, first/last step, first sample, battery
sysfs, trips, window samples, overflow, `decode_hop_rule`. Raw facts only; `null` cells are kept as `null`.
Row shape (one JSON line; numbers, nulls and ids only, no text):
`{v:1,t,turnId,round,attempt,gap,fp:{model,soc,pin},first_row,state,src,status,batt,level,plugged,prompt_n,pred_n,
pred_ms,pps,wall:[first_ms,last_ms],first:[11 cells],bsys:[4],hl,duty,paced:[tok,ms],tok:[cpu,gpu,npu],
us:[cpu,gpu,npu],hops,rule,trips:[6],win:[[11 cells],...],win_ovf}`.
**New `src/engine/governorObservationLog.ts` (~90 lines)**: `appendObservation(row)` appends one line to
`${FileSystem.documentDirectory}governor/observations.jsonl` (expo-file-system, the API `ModelDownloader.ts:19`
uses); writes are chained on one module-level promise so lines never interleave; before appending, a file over
4 MB is renamed to `observations.1.jsonl` (replacing any previous one), so at most 8 MB live on the phone; errors
are caught and logged once per process. Nothing awaits it.
**Hook in `LlamaService.ts`, off the critical path.** The loop keeps only `thermo_source` today (`:5241-5244`
`governorThermoSource = (await refreshGovernorBeforeCompletion(...)).thermo_source;`): keep the whole snapshot
(`refreshGovernorBeforeCompletion` returns it, `:1824` `return snapshot;`) in a round-scoped `governorThermo`. The
hook runs AFTER the stop and pause checks (`:5378` `if (bailIfStopped()) return;`, `:5379-5383`
`endOnGovernorPause`), right after `recordBenchCompletion(result)` (`:5384`), guarded by `activeGovernorAttempted`
(`:1834`): `const row = await readGovernorObservation(engine, ids, result, governorThermo)` with its own
`OBSERVATION_STATS_TIMEOUT_MS = 2_000` (not the 15 s `ENGINE_AUX_CALL_TIMEOUT_MS`, `:1770`), then `void
appendObservation(row)`. WHY the stats read is awaited, bounded, here: the next completion's `beginCompletion`
resets the ring (`rn-completion.cpp:807` `parent_ctx->resetGovernorPrefillStats();`), so a lazy read would see
the next completion; the read is one in-memory copy over a JSI promise (milliseconds), and the 2 s bound caps the
delay to the next tool round. On the stop path, the pause path, a timeout or a throw: no read, `observationGap =
true`, and the next row carries `gap:1` (its deltas span two completions; the replay drops it). The previous
snapshot lives in a module variable cleared on load and clear. Log `KALSA_GOVERNOR_COMPLETION` with the row minus
`win` (the ring goes only to the file).
**Tests**: `governorObservation.test.ts` (deltas, first row, gap row, null cells preserved, a schema test that no
key ever holds a string other than ids), `governorObservationLog.test.ts` (append, chaining order, rotate at the
cap, error swallowed once) with the file system mocked; a shape guard pinning the hook after `bailIfStopped()` in
the style of `governorPlanEmission.test.ts:8-12` (Jest never loads llama.rn). Pre-existing excess declared:
`LlamaService.ts` 6868 lines; the hook is ~15 lines.
**Log-report schema**: register `{ prefix: "KALSA_GOVERNOR_COMPLETION" }` and `{ prefix:
"KALSA_GOVERNOR_BATTERY_SYSFS" }` in `EXTRA_TELEMETRY` (`scripts/campaign/config.mjs:20-33`) and add the tags to the
selftest list (`scripts/campaign/selftest.mjs:217`), so campaign reports do not reject the new lines.
**Privacy (owner approved)**: numbers, nulls and ids only (turn, device, build, pin), private app directory, read by
`adb shell run-as com.kalsa.app cat files/governor/observations.jsonl` on the debuggable APK; nothing leaves the
phone otherwise.

### 3.3 Lab replay (`scratchpad/agents/learning-governor/replay/`)

A node script over the JSONL: drops `gap:1` rows; per row the per-leg tok/s (`tok x 1e6 / us`), the derived wake
start (first window sample with `h > 0`; `h == null` is "forecast absent", distinct from 0 = blind, and such
windows are excluded from the heat fit), tokens per leg from the wake (`leg` x hop), `h_first/h_last` and ages,
wall minutes from the stamps, the zone hot-temperature rise per leg per window (`null` temps = dark zone, window
excluded from zone statistics), the trip ranges; the battery sysfs vs BatteryManager comparison (OPEN 4: both
within 0.5 C and status agreeing with `plugged` on >= 95 % of rows); then the heat fit of 5.6 on the non-censored
rows and its residuals, the `bg` / cooling collinearity (condition number), the forecast's wake skin per phone,
and the distributions of `hf_age`, window `h_age`, `status_age`, `app_age` (OPEN 2, 3). It cannot measure GPU
overshoot: no GPU windows exist before Stage 3 (AUDIT-3), and it says so in its output.

### 3.4 Device checks and pass criteria

Baseline first: the same G2 5-turn script on the S23 with the current APK `df359450` (control arm), keeping its
`KALSA_GOVERNOR` per-turn deltas of `decode_tokens_cpu/npu/gpu`. Then the Stage 0 APK, S23, 5 turns, unplugged,
screen on: (1) one row per completion, every tool round included, no `gap:1` on an unstopped turn; (2) every delta
>= 0 and `tok` sums to `pred_n` within 2 tokens; (3) on an unpaced 100 % NPU row (`paced.tok` delta 0),
`tok.npu x 1e6 / us.npu` within 10 % of `pps`; (4) `win` length = ceil(`pred_n` / 32) without overflow; (5)
`trips` finite for the legs whose zones the device log counted (`rn-governor.cpp:69-71` "decode hop thermal legs
cpu=%d npu=%d gpu=%d zones"); (6) `first[headroom_age] <= 3000` ms and every window `h_age <= 3000` on every row;
(7) identical leg mix: per turn, the `decode_tokens_cpu`, `_npu`, `_gpu` deltas equal the control arm's within 32
tokens (one window) each; (8) `KALSA_GOVERNOR_BATTERY_SYSFS` logged once per load. Xiaomi (owner's daily use, dev
APK): >= 20 completions pulled; (1)-(6) and (8) hold; the trips for all three legs are finite (closes OPEN 1); the
sysfs comparison of 3.3 decides OPEN 4. Refuted by a missing row, a negative delta, a ring overflow on a normal
completion, a stop that took longer than before by more than 2 s, or any change in the S23 leg mix.

### 3.5 Binding notes added by the coordinator after the final scoped re-audit (2026-10-12)

The last re-audit of v0.5 (same auditor) left seven implementation details. They are binding for the coder and
override anything above that contradicts them; the per-step code audit checks them.

1. Per window, also record the forecast headroom and the platform status that the engine APPLIED for the decode step
   whose realized duty is `duty_last` (two more cells next to `duty_last`), so the Stage 0b check pairs duty with
   the inputs that produced it, not with the boundary sample.
2. The 2 s bound on the stats read uses the existing `nativeCallTimeout.ts` helper, whose JS timer is suspended while
   Android pauses the activity and which does not cancel the native call. Accept that: a late stats result after the
   timeout is dropped (never written), the row carries `gap:1`, and nothing waits on it.
3. The write queue is capped: at most 32 pending rows; on overflow the oldest pending row is dropped and the next
   written row carries `dropped:<n>`. A failed append is caught and the next append must still succeed (test it).
4. The five freshness atomics may come from different generations: the logged ages are approximate (say so in the
   field comment), and no Stage 0 check treats an age as exact.
5. `passive_trip_mc` is milli-C: trip fields are exposed in C (`/ 1000.0`), like the zone headroom
   (`rn-thermal-legs.cpp:112`).
6. Register every new tag in the app's closed log-report schema (`src/logReport/tagSchemas.ts`, `schema.ts:61`,
   collector `collector.ts:68`) as well as the campaign `EXTRA_TELEMETRY`; otherwise the app report drops them.
7. The JSONL allows fixed labels besides ids: `state`, `src`, `rule` take only values from the binding's closed sets
   (`RNLlamaJSI.cpp:978`); the schema test checks membership, not "no strings".

App base: start from app main `8a8d74cf` (the H9 harness fix), not `df359450`; the binding base stays `2581a9aa`.

## 4. Stage 0b - the Xiaomi pacing lines (app only; owner decision 2026-10-12)

`src/engine/declaredSevere.ts`: today one shared pair of skin lines, `:8-9` `const PACING_START_SKIN_C = 38.1;
const PACING_FULL_SKIN_C = 41.7;`, converted per model by `headroomAt` (`:34-37`). Add optional per-row
`startSkinC` / `fullSkinC` to `DECLARED_SEVERE` (`:18-29`), defaulting to the shared pair; the Xiaomi row
(`:28` `{ model: /^23127PN0CG$/, severeSkinC: 66.5 }`) gets 39.0 / 42.6 -> `headroomAt` 0.083 / 0.203 (the S23's
3.6 C ramp). `declaredSevere.test.ts` (`:7-8` pins 0.053 / 0.173 today) updated; S23 lines unchanged.
**Device check that isolates the forecast component.** The duty is the minimum of three ramps
(`pacing-duty.cpp:75-86` `std::min({ headroom_duty(headroom, params), battery, cap })`), and `duty_last` is the
realized duty of the previous step (`llama-ext.h:619-624`). The replay therefore (a) keeps only windows whose
completion has `batt < 395` tenths (unplugged `cool_enter` 39.5 C, `policy.cpp:191-192` `if (!profile_.plugged)
{ return { 38.0f, 36.0f, 39.5f, 36.5f, ...`, so the battery ramp is 1.0) and whose window `status <= 1` (status cap
1.0), (b) aligns sample k's `duty_last` with sample k-1's `h` (the step before the boundary ran on that forecast,
read at most 2 s earlier), and (c) computes the expected `headroom_duty` from the lines. Pass, Xiaomi, one session
after Stage 0b: `KALSA_GOVERNOR_PLAN` prints `pacing_start 0.083`, `pacing_full 0.203`; on the constrained
windows, `h(k-1) <= 0.083` -> `duty_last(k) == 1` on every window, and `h(k-1) >= 0.10` -> `duty_last(k) <= 0.95`
on >= 95 % of windows (the 250 ms cap can raise a realized duty); S23 rows show 0.87 / 0.99 and the same pass.
Refuted by a paced window under the start line with a cool battery and status <= 1. Fallback 41 / 44 C only if
Stage 3 shows the GPU learns too little (owner).

## 5. The speed rule (Stages 2-3): what AUDIT-3 fixed on paper, and what stays OPEN

The rule as approved: inside `hop_decide`'s HEAT_RANK branch (`policy-hop.cpp:232-234` `if (ranked >= 0) {
decode_hop_leg_ = present[ranked]; hop_rule = "heat_rank";`), on iff `decode_speed_lookahead_s > 0`:
```
pick = present[ranked]
if armed(now_ms) and not breaker and blind_budget_ok(now_ms):
    fit = { L : leg_fit(L) }                    # HEAT_RANK's own test, policy-hop.cpp:78-80
    fast = argmax speed_tps over fit
    if speed_tps[fast] >= 1.15 * speed_tps[pick] and (blind or forecast_ok(fast)): pick = fast; rule = "speed_fit"
m_f = (pacing_start - h_now) * 30;  rise_f(L) = (heat_ucb[L] * speed_tps[L] / 1000 + bg_ucb / 60) * lookahead_s
forecast_ok(L) = m_f >= rise_f(L) + 0.5    (+ 0.5 to re-enter after leaving on this term)
```
Heat ucb = mean + 1 sd, prior sd 25 % of the seed (seed x 1.25 until the app sends a value); lookahead 10 s (the
horizon Android forecasts, `rn-platform-thermal.h:29` `k_platform_thermal_headroom_forecast_s = 10`); both are
OPEN 7 / 8 until Check B.

### 5.1 Inputs and freshness (fixed on paper)

`select_decode(int64_t now_ms, ...)` (`policy.cpp:544-545`) receives `ggml_time_us() / 1000`
(`llama-governor-runtime.cpp:196`); `hop_decide` (`policy.h:167` `hop_decide(uint32_t window, uint32_t
tokens_since_prefill)`) gains `now_ms`. Three stamps join `llama_governor_thermo_profile` (`llama-ext.h:428-456`),
all in that clock, binding-set, 0 = unknown: `headroom_read_ms` (last FINITE read, `platform_headroom_state_
.read_us`), `status_read_ms` (last native read that returned a status, `rn-governor.h:110` `platform_native_
valid_us_`), `app_sample_ms` (stamped when the app pushes, `rn-governor.cpp:199`, copied by the native refresh
`:290` `llama_governor_thermo_profile updated = thermo_profile_;`).

| input | disarms when | why it is enough |
|---|---|---|
| `state_`, `state_from_platform_` (`policy.h:178`) | `!= FAST` or from platform | battery machine and floor unchanged |
| forecast | NaN, or `now_ms - headroom_read_ms > 4000` | binding fix: push when `read_us` advanced, not only on a value change (`rn-governor.cpp:285-288` `if (!decision.send && !headroom_changed) { return; }` gains `&& !read_advanced`), so a constant healthy forecast re-stamps every 2 s |
| status | `< 0`, `> 1`, or `now_ms - status_read_ms > 10000` | the carry (`rn-governor.cpp:211-214`, remembered status while native is <= 10 s old) is now visible as age; escalation lag 5 s = 0.34 C of GPU skin |
| battery, level, plugged | `now_ms - app_sample_ms > 120000` | app pushes per round (`LlamaService.ts:5243`); 120 s = 0.2 C of Xiaomi battery (8 C in 90 min, `REPORT.md:31`); OPEN 4 may replace this with a native 5 s refresh |
| duty | `< 1`, computed with pace_decode's call (`pacing.cpp:30-33`) | same inputs as the pacing |
| zones | any NaN (`policy-hop.cpp:274-278` alternation) | no pass without zones |

### 5.2 What the pass spends

GPU vs NPU on the Xiaomi: 2.91x heat per token (3.2 / 1.1), 3.82x per second at 21 vs 16 tok/s. That is the
design's purpose, bounded by: the band (2.49 C under the 39.0 line), the blind budget (5.4), the breaker (5.5),
and the untouched net under it (pacing from 39.0 C, battery WARM 38 / COOLMODE 39.5 / pause 43 / kill 44 C,
status floor). The S23 never fires: NPU fastest (17.1 vs 15.0, ALIVE:101) and row `lookahead 0`.

### 5.3 Arithmetic (one map, fixed formula)

Map: `skin = 36.5 + 30 h` (AOSP, `declaredSevere.ts:34-37`); the cell fit `h = 0.0327 skin - 1.187`
(`xiaomi-g2-inapp-233486dd/REPORT.md:40`) is a measurement cross-check (39.0 C: 0.087 vs 0.083, 0.13 C). Seeds
3.2 C/1k, 21 tok/s: rate 0.0672 C/s; required `rise_f + 0.5` = (4.0 x 21 / 1000 + 0.5 / 60) x 10 + 0.5 = 1.423 C.
Cutoff `h = 0.083 - 1.423 / 30 = 0.0356`, skin 37.57 C. Overshoot past the 39.0 line when the true heat is k
times the seed, in the 10 s after the last pass decision: `(k x 0.672 + 0.083) - 1.423` C = 0.004 (k 2), 0.676
(k 3, skin 39.7, h 0.106, duty `1 - 0.19 x 0.65 = 0.878`), 1.348 (k 4, duty 0.76). None reaches the full line
(42.6), the pause (43) or SEVERE (66.5). Worked cold start (33.4 C): blind 46.1 s / 968 tokens, band 15.9 s /
333 tokens, ~1,301 tokens at +31 % over 16 tok/s; from 36 C ~490 tokens.

### 5.4 Blind path, in zone terms

While the forecast is 0 the engine has no skin bound. What it has: (a) the current leg's block stays >= guard
(5 C) under its first passive trip, every idle block >= guard + hysteresis + load step (`policy-hop.cpp:78-80`);
with the Xiaomi GPU trip unmeasured (OPEN 1) the GPU block may reach trip - 5 C; (b) the forecast wakes at skin
36.5 C and the pass re-decides within one read (2 s) plus one window (1.5 s): ~0.25 C of GPU skin past the wake;
(c) a blind budget of 2,048 GPU tokens per 10 minutes of wall time (`k_speed_blind_budget_tokens`,
`k_speed_blind_budget_ms`, counted in the policy, shared across completions and tool rounds): 6.6 C of seed GPU
heat per 10 min at most, i.e. the widest blind band of a room-temperature phone (30 -> 36.5 C).

### 5.5 Breaker

Engine, per session: latch `entry_h`, `entry_ms` when the pass takes a leg other than HEAT_RANK's; if blind,
re-latch at the first window with `h_now > 0`; trip when `(h_now - entry_h) x 30 > rise_f x elapsed /
lookahead + 0.5`. Timing at 2x / 3x true heat (surplus 0.0504 / 0.1176 C/s over the predicted 0.0923): 9.9 s /
4.25 s after the latch, plus <= 2 s read and <= 1 window. Heat spent blind is not compared: 5.4 bounds it. The
policy is rebuilt at load (`llama-governor.cpp:38-39` `: policy_(governor_params)`), so the app persists the trip
(`kalsa.governor.speedBreaker.v1`, 6 h, OPEN 9) and sends `decode_speed_lookahead_s: 0` while latched.

### 5.6 Learning (summary; detail unchanged from v0.3 where not listed)

Speed: in-engine EWMA per completion at `refresh_decode_legs` (`llama-governor-legs.cpp:282-284` deltas, `>= 2
x hop` rule), seeds in the row (S23 17.1 / 15.0 / 13.0, Xiaomi 16.0 / 21.0 / 14.7). Heat: app-side ridge per phone
over `[npu_k, gpu_k, cpu_k, prompt_k, pre_gpu_k, wall_min, -h_first x wall_min]`, observation from the wake
sample, `y = 30 (h_last - h_first)`, prior = the applied row (stats expose it), n0 = 4, sd 25 %, residual sigma
with a 0.2 C floor, outlier `max(1.0 C, 3 sd)`, forgetting 0.95, sent as `ucb = clamp(max(mean,0) + sd, 0.75,
3) x seed` through `decode_speed_heat` (0 = engine seed) and `decode_speed_bg_c_per_min`; HEAT_RANK's
`decode_heat_per_token` never sent (`policy-hop.cpp:70-71`, `:206` untouched). Store keyed by `Build.MODEL` +
`socModel` (`GovernorBatteryModule.kt:96`) + `Build.FINGERPRINT` (new) + pin + row.

### 5.7 OPEN items, closed with Stage 0 data before Stage 2 starts

| # | open | closed by |
|---|---|---|
| 1 | Xiaomi zone passive trips (GPU >= 56.3 C needed for a cold fit) | Stage 0 `trips` on the Xiaomi rows |
| 2 | forecast read age in practice (the 4 s gate) | distribution of `hf_age` and window `h_age` |
| 3 | forecast noise / resolution (the 0.2 C sigma floor) | window `h` jitter on NPU-only rows |
| 4 | battery refresh mid-completion: native sysfs (`/sys/class/power_supply/battery/temp`, `status`) readable in-process? | a one-time probe logged in `KALSA_GOVERNOR_PLATFORM` (Stage 0, ~15 lines in the binding) |
| 5 | the wake skin per phone, and whether the Xiaomi forecast ever reads between 0 and 0.083 while cold | rows with `hf == 0` and `hl > 0` |
| 6 | `bg` / cooling collinearity; whether the cooling column is needed | replay condition number and residuals |
| 7 | lookahead 10 s (the overshoot after a `speed_fit -> heat_rank` hop) | not Stage 0: Check B (Stage 3) and a lab cell-75 repeat |
| 8 | GPU heat identification (~20 band rows, post-enable) | Check B; the lab repeat sets the seed first |
| 9 | breaker latch 6 h; blind budget 2,048 / 10 min | starting values; Check B |

## 6. Stages 1-3 (outline, unchanged in substance)

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
hostile audit -> fix -> next. Stage 2 does not start until OPEN 1-6 are closed.

**Stage 1** (app, no decision change): `governorLearned.ts` (store, fingerprint, breaker latch), `governorLearnedFit.ts`
(ridge, outlier, forgetting, ucb), `GovernorBatteryModule.kt` `readSoc` + `Build.FINGERPRINT` (`:93-96`), tests;
`KALSA_GOVERNOR_LEARNED` line.
**Stage 2** (engine, default off; vendoring + HTP skel rebuild + pin + provenance): `llama-ext.h` params
(`decode_speed_lookahead_s`, `_tps`, `_heat`, `_bg_c_per_min`), the three stamps, stats (`decode_speed_tps_*`,
`_fit_windows`, `_fit_blind_windows`, `_breaker`, `decode_heat_per_token_*_applied`), the rewritten unit comment
(`:363-364`); new `src/llama-governor-policy-speed.cpp` registered in `src/CMakeLists.txt:37` after
`llama-governor-policy-hop.cpp`; `leg_fit` factored out of `heat_rank_fit`; `now_ms` into `hop_decide`; sanitizers
(`policy.cpp:180-187`); tests `tests/test-governor-v02-hop-speed-fit-arming.cpp` and `-margin.cpp` registered like
`tests/CMakeLists.txt:455-457`. Binding: row fields (both rows `lookahead 0`), parser keys beside
`decode_headroom_tau_s` (`rn-governor-params.cpp:303-304`), merge (`:353`), stamps, the `read_advanced` push,
`KALSA_LEGS_TABLE` (`rn-llama.cpp:463`), JSI; `vendor/VERSIONS`, skels + `assert-htp-skels.sh`. App: pin,
provenance, `buildGovernorParams` overrides (`governorInputs.ts:321`), `governorLearnedOverrides.test.ts`, bench
key `kalsa.bench.speed_fit = "off"`. Check: S23 G2, `speed_fit_windows 0`.
**Stage 3**: SM8650 row `lookahead 10`; app sends ucb / bg. Check A: S23 unchanged. Check B: Xiaomi from skin
< 35 C, side sampler, A/B via the bench key: GPU windows while blind and up to h ~ 0.036, none after the ramp,
breaker 0, status never >= 2, overshoot past 0.083 while on the GPU <= 0.017 (0.5 C), skin max <= the HEAT_RANK
arm's + 0.5 C, battery max <= 42.5 C, first completion >= 25 % faster. Refuted by a breaker trip on a healthy
phone, status 3, or a hot-state median below 5.0 tok/s.

## 7. Invariants kept (RECON 6) and risks

Safety states force CPU (`policy.cpp:571`); CPU never excludable (`policy-hop.cpp:153-155`); one leg change per
window; no reload in a hop; platform-raised COOLMODE never buys GPU decode (stricter: every non-FAST state
disarms); status >= 2 floors, 5 never kills; HEAT_RANK's 4 C hysteresis (plus 15 % speed and 0.5 C forecast);
sanitizers at construction; no row = off; `thermalHardGate.ts` untouched. Stage 0 adds no decision input, no engine change and no new engine entry point; it adds one read-only
`getGovernorStats` per completion, a 256-entry ring, and one battery sysfs read per completion (zones were already read per window).

| risk | guard | refuted by |
|---|---|---|
| Stage 0 changes behaviour | no engine change, no new engine call, S23 leg mix identical | any `decode_tokens_gpu` delta on the S23 |
| overshoot (Stage 3) | FAST, duty 1, fresh inputs, zone fit, 10 s ucb + 0.5 C, breaker | status 3, skin > HEAT_RANK's max + 1 C |
| blind path | wake point, zone guard, 2,048 / 10 min | GPU never fit while cold (trip low: gain 0) |
| stale input | stamps, 4 s / 10 s / 120 s | a pass window with an older stamp |
| memory | ring 256 x 8 numbers; JSONL 8 MB cap | S23 MemAvailable < 1.0 GB (today 1.08-1.37, `s23-g2-full099-233486dd/REPORT.md:31,70`) |

## 8. Open questions for the owner

1. A lab repeat of cell 75 (three runs per arm, same start skin, side sampler) before Stage 3: it sets the GPU seed
   the rule actually runs on and is the only way to measure the lookahead (OPEN 7) before enabling. Yes / no.
2. Stage 0 on your Xiaomi needs a dev APK install and one adb pull when lent; ~20 completions of normal use.
