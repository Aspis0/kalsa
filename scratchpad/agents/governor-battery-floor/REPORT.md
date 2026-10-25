# Governor battery floor removal

Owner decision, 2026-09-24. Engine-only commit: `c0dad89c06f9745b72a421cc76fee26da8717c9e` (`kalsallama`, branch `kalsa-opencl-upload-oom-throw`, parent `b0d5dbd2c7d23830f9182e64f93f9c4286a8d9d2`). No push. Diff: 3 files, 27 insertions, 21 deletions.

## Engine change and remaining gates

- `src/llama-governor-policy.cpp:128-132`: `} else if (!profile.plugged && profile.batt_level_pct < 25) {`; `state_ = llama_governor_thermal_state::LOWBAT;`; `} else if (state_ == llama_governor_thermal_state::LOWBAT) {`; `if (profile.plugged || dwell_elapsed(now_ms)) {`; `state_ = classify(temp);`. LOWBAT only enters unplugged and exits immediately when plugged.
- `src/llama-governor-policy.cpp:57`: `if (profile.batt_level_pct < 0 || profile.batt_level_pct > 100) {` is input validation only.
- `src/llama-governor-policy.cpp:159-162`: `if (!valid_schema(params_) || !profile_valid_ || !have_profile_ ||`; `state_ == llama_governor_thermal_state::CRITICAL || state_ == llama_governor_thermal_state::Invalid ||`; `state_ == llama_governor_thermal_state::LOWBAT) {`; CPU is still selected for invalid/critical profiles and unplugged LOWBAT.
- `src/llama-governor-policy.cpp:247-251`: decode eligibility has no battery-percent predicate; the 45% gate was removed.
- `src/llama-ext.h:230`: `LOWBAT,`; `:272-273`: `int32_t batt_level_pct = 100;` and `bool plugged = false;`.
- `tests/test-governor-v02-router.cpp:69-93` has these assertions: `plugged_low.batt_level_pct = 20;`, `plugged_policy.prefill_engine() == llama_governor_engine::GPU`, `unplugged_low.batt_level_pct = 30;`, `unplugged_policy.prefill_engine() == llama_governor_engine::GPU`, `unplugged_lowbat.batt_level_pct = 20;`, `lowbat_policy.prefill_engine() == llama_governor_engine::CPU`, `lowbat_policy.update_thermal(plugged_lowbat, 1)`, and `lowbat_policy.prefill_engine() == llama_governor_engine::GPU`.
- `tests/test-governor-v02-router.cpp:128-133`: `low_battery.batt_level_pct = 40;` and `check(policy.select_decode(0).engine == llama_governor_engine::GPU_COOLMODE,` / `"battery above LOWBAT does not gate COOLMODE decode");`.
- `tests/test-governor-v02-router.cpp:192-201` keeps the unplugged LOWBAT recovery cases: `low_battery.batt_level_pct = 20;`, `recovered.batt_level_pct = 25;`, `"LOWBAT recovery respects dwell"`, and `"LOWBAT recovery reclassifies after dwell"`.
- `tests/test-governor-v0-turns.cpp:349` now uses `low.batt_level_pct = 20;`. Lines 373-378 state `// LOWBAT (<25%, unplugged) asks for CPU prefill; the batch must land on the CPU`, `const bool prompt_ok = prompt_rc == 0 && stats.prefill_engine == llama_governor_engine::CPU &&`, and positions the result in the decode context.

## Binding audit (reported only; unchanged)

- `cpp/rn-governor-params.cpp:81-88`: `llama_governor_thermo_profile result{};`; `result.batt_level_pct = value_or(thermo, "batt_level_pct", 100);`; `result.plugged = bool_or(thermo, "plugged", false);`; `result.sensor_valid = bool_or(thermo, "sensor_valid", false);`; it forwards these profile fields.
- `cpp/rn-governor-params.cpp:97-100`: `if (thermo.batt_level_pct < 0 || thermo.batt_level_pct > 100) {`, then `return false;` and `return true;`; range validation only.
- `src/types.ts:45-52`: `export type GovernorThermoProfile = {`, `batt_level_pct: number`, `plugged: boolean`, `sensor_valid: boolean`, with optional idle-temperature and trend fields.
- `cpp/jsi/RNLlamaJSI.cpp:64`: `case llama_governor_thermal_state::LOWBAT: return "LOWBAT";` is state serialization only.
- No `GovernorBatteryModule.kt` exists under this binding checkout's `android/` tree (`find android -type f -iname '*GovernorBatteryModule.kt'` returned no files).
- No binding 45% or LOWBAT routing threshold was found in `cpp/`, `android/`, or `src/`.

## App audit (reported only; unchanged)

- `src/engine/governorInputs.ts:28-34`: `batt_level_pct: number;` and `plugged: boolean;` are profile fields.
- `:226-233`: `const level = numberValue(input.batt_level_pct ?? input.battLevelPct, 100);`, `const plugged = input.plugged;`, `const sensor = input.sensor_valid ?? input.sensorValid;`, and `if (typeof plugged !== "boolean" || typeof sensor !== "boolean") return null;`.
- `:246-250`: `batt_level_pct: level,` and `plugged,` forward the profile to the engine. `:277-282` defaults an unavailable profile to `batt_level_pct: 0,`, `plugged: false,`, and `sensor_valid: false,`. No routing/admission/decode battery threshold is present in `src/engine/`.
- The only other nearby 45% text is unrelated temperature policy: `src/engine/thermalThresholds.ts:8` says `(45 / 48 / 52 °C)` and `:45` is `warmC: 45`; it governs advisory `thermal_zone0` banners, not battery routing.
- `src/engine/batteryEta.test.ts:41`: `it("returns charging when the battery rose >= 2 pp across the window", () => {` is charging estimation, not governor routing.

## Verification

- `cmake --build build --target test-governor-v02-router test-governor-v0-turns -j 3`: exit 0.
- With `KALSA_HYBRID_GGUF=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`, `ctest --test-dir build -L router --output-on-failure`: exit 0 (1/1).
- With that same environment, `build/bin/test-governor-v0-turns -m /Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`: exit 0; `governor_low_battery_prefill=PASS` and `governor_v0_turns=PASS`.
- Sabotage 1, temporarily reinstated `(profile_.batt_level_pct < 45 && !profile_.plugged)`: rebuild exit 0; governor router test exit 1 at `unplugged 30 percent battery permits fitted GPU prefill`.
- Sabotage 2, temporarily allowed LOWBAT for plugged profiles by removing `!profile.plugged`: rebuild exit 0; governor router test exit 1 at both plugged-20%-GPU assertions.
- Restored intended code; final build exit 0, final router CTest exit 0, model-backed test exit 0. All builds used `-j 3` maximum. The `77` skip condition did not occur.
- Not verified on a physical phone/GPU; these are host policy and model-backed tests.

## Binding bump

- Committed `de7cdc45174d4cc0318c0353dc8ddd0f7e1865fa` on `kalsarn-governor-engine`, parent `e1b98a8cf7252f94fa0b4fe06afe11b6fbbb78d4`; stat: 9 files, 18 insertions, 19 deletions. `vendor/VERSIONS` pins `c0dad89c06f9745b72a421cc76fee26da8717c9e`; `src/version.ts` and generated `lib/` version files report `11220/c0dad89`.
- Used `scripts/sync-vendor.sh`; seeded its local cache by fetching the engine commit from the engine worktree. The only c0dad engine source file in the vendor export is `src/llama-governor-policy.cpp`, byte-identical to the engine file (`cmp` exit 0, SHA-256 `60397d19d5e0a2a81b95fa222a0a05aeb33f5b5959a04d0fe666af5906e3bb47`). `tests/test-governor-v02-router.cpp` and `tests/test-governor-v0-turns.cpp` are not vendored. Sync also regenerated three engine version identity files.
- Exit codes: local cache fetch 0; `npm ci` 0 (real `node_modules` copy); first sync 1 at the expected stale generated-version assertion; `npm run build` 0; final sync and its vendor/source assertions 0; `git diff --check` 0; commit hooks lint/types/commitlint passed. No Jest or native/Gradle/CMake build was run; the prior bump procedure used vendor sync and generated JS build, and no native build was allowed here.
- Left untracked `pnpm-lock.yaml` and `pnpm-workspace.yaml` untouched. Binding worktree has no tracked changes after commit.

## Fix round F1

- Engine `8eac584bb3411840b3639a06f96ca75301f4f8d6` on `kalsa-opencl-upload-oom-throw` (parent `c0dad89c06f9745b72a421cc76fee26da8717c9e`): `src/llama-governor-policy.cpp:124-128` now recovers CRITICAL to LOWBAT only below 25% while unplugged; otherwise FAST. Router assertions at `tests/test-governor-v02-router.cpp:171-195` cover unplugged/plugged recovery and GPU/CPU routing; `:135-141` asserts LOWBAT decode is CPU without wait.
- Sabotage checks: unconditional FAST recovery (a) build 0, router 1; omit plugged guard (b) build 0, router 1; permit LOWBAT in GPU decode eligibility (c) build 0, router 1. Restored implementation: affected-target build (`-j 3`) 0; router 0; model-backed `test-governor-v0-turns -m ...LFM2.5-2.6B-QAD-Q4_0.gguf` 0; `test-governor-v0-hybrid` with the same `KALSA_HYBRID_GGUF` 0. No 77 skips.
- Binding `463f11f9` (`llama.rn-kalsa`, `kalsarn-governor-engine`, parent `de7cdc45174d4cc0318c0353dc8ddd0f7e1865fa`) vendors engine `8eac584bb3411840b3639a06f96ca75301f4f8d6`; stat 9 files, 17 insertions, 15 deletions. `npm ci` 0 (real `node_modules`); first `sync:vendor` 1 at the expected generated-version check; JS `npm run build` 0; final `sync:vendor` 0; `git diff --check` 0; commit hooks lint/types/commitlint passed. Vendored policy `cmp` 0, SHA-256 `1262e37b9267d204753418005e88224a7f10a834908636e7232759360785645c`; the router test source is not in the vendor export. Left `pnpm-lock.yaml` and `pnpm-workspace.yaml` untracked and untouched.
- No device verification or native/Gradle/CMake build; no binding Jest run.

## App pin

- Committed `67ade7a8` (`kalsa`, detached on `origin/main` at `71aa25c4709fc5fe36407deec804712a9aed4ff1`): `package.json` and `package-lock.json` pin binding `463f11f9f47ff0b235267e3bb29136ad8cbbbb13`; `native/kalsallama.pin` records engine `8eac584bb3411840b3639a06f96ca75301f4f8d6`.
- `npm install --package-lock-only` exit 0; lock diff contains only the root llama.rn spec and its resolved/integrity record. `npm ci` 0; `node_modules/llama.rn` is a real directory (not a symlink). Provenance 0 (1,119 files match); `npx tsc --noEmit` 0; targeted `npx jest 'src/engine/governor*' --runInBand` 0 (5 suites, 53 tests); diff check 0.
- No full Jest suite or native build run.
