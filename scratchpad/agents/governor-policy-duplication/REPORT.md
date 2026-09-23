# Governor idle-temperature baseline: policy duplication across app, binding, and engine

Read-only EXPLORER report. Evidence comes from three working trees, read on 2026-09-21:

- app: `/Users/marco/Projects/kalsa` (HEAD `e5788cfe`)
- engine: `/Users/marco/Projects/kalsallama` (ref `1068eb03d`, branch `kalsa-governor`-era fork of llama.cpp)
- binding: `/Users/marco/Projects/llama.rn-kalsa` (HEAD `0288dc27`) - the llama.rn fork the app links against. The JSI file is `cpp/jsi/RNLlamaJSI.cpp` in this repo, not in kalsallama.

The owner's proposed boundary is: app MEASURES, binding TRANSPORTS, engine DECIDES. This report tests that boundary against what the code does; it does not pick a consolidation option.

---

## 1. App side

### 1.1 `native/GovernorBatteryModule.kt` (the MEASURES side, with a latch)

Latch condition, exact code (`native/GovernorBatteryModule.kt:66-72`):

```kotlin
if (plugged) {
    if (idleBaselineTenthsC == null && present && temperature > 0) {
        idleBaselineTenthsC = temperature
    }
} else {
    idleBaselineTenthsC = null
}
```

The latch variable carries an explicit policy comment (`native/GovernorBatteryModule.kt:37-40`):

```kotlin
// Latched plugged baseline in tenths of a degree C: set on the plug-in edge,
// held for the whole plugged session, cleared on unplug. The engine offsets
// every plugged threshold from this value, so it must not track the live
// battery temperature.
private var idleBaselineTenthsC: Int? = null
```

Published fields (native unit = tenths of a degree C):

- `native/GovernorBatteryModule.kt:78` - `result.putBoolean("t_idle_valid", idleTenths != null)`
- `native/GovernorBatteryModule.kt:79-80` - `if (idleTenths != null) { result.putInt("t_idle_tenths_c", idleTenths) }`
- `native/GovernorBatteryModule.kt:55` - null-intent path: `result.putBoolean("t_idle_valid", false)`
- The module never emits a field named `t_idle_c`. This is pinned by test (see 1.3).

Note: a second copy exists at `android/app/src/main/java/com/kalsa/app/GovernorBatteryModule.kt` (11864 bytes, mtime 2026-09-16). It contains zero occurrences of `idleBaselineTenthsC` and zero occurrences of `t_idle_valid`: it is a stale pre-`e5788cf` duplicate, not a second live implementation. Whether anything still compiles that copy is unknown (see WHAT WE DO NOT KNOW).

### 1.2 `src/engine/governorInputs.ts` - applies a policy condition of its own

`profileFrom` (`src/engine/governorInputs.ts:118`) converts units AND gates:

```ts
// src/engine/governorInputs.ts:126-145
const idleValidRaw = Boolean(input.t_idle_valid);
const idleDegrees = numberValue(input.t_idle_c, Number.NaN);
const idleTenths = numberValue(input.t_idle_tenths_c, Number.NaN);
// t_idle_c reaches the engine in whole degrees C: the native latch reports
// tenths, the bench skin already reports degrees. Convert exactly once, and
// refuse a baseline the engine's own plugged rule would reject, so a
// tenths value can never become a plugged baseline.
const idle = Number.isFinite(idleDegrees)
  ? idleDegrees
  : Number.isFinite(idleTenths)
    ? idleTenths / 10
    : 0;
const idleValid = idleValidRaw && idle > 0 && idle + 1 < 42;
return {
  ...
  t_idle_valid: idleValid,
  t_idle_c: idle,
```

The condition `idle + 1 < 42` at `src/engine/governorInputs.ts:138` is a verbatim copy of the engine's plugged-validity rule (`profile.t_idle_c + 1.0f < 42.0f`, `src/llama-governor-policy.cpp:63`). The app is not only measuring; it is deciding whether a baseline is acceptable, under the same numeric condition the engine later re-checks. The tenths->degrees lift (`idleTenths / 10`) is unit conversion (transport), the `idle + 1 < 42` refusal is policy.

`readGovernorThermo` (`src/engine/governorInputs.ts:150-177`): bench-skin key `kalsa.bench.thermo` wins over `NativeModules.GovernorBattery.readThermo`; a missing native module falls back to an all-false profile with `sensor_valid: false`.

### 1.3 What the two test files actually assert

`src/engine/governorInputs.test.ts`:

- `:173` "bench thermo wins over BatteryManager" - a stored bench profile with `t_idle_valid: true, t_idle_c: 35` is returned unchanged and `readThermo` is never called.
- `:207` "lifts the latched plugged idle from tenths to degrees" - `t_idle_tenths_c: 350` must come out as `t_idle_c: 35`, with the in-test comment: "The engine reads t_idle_c in whole degrees C and offsets every plugged threshold from it; a tenths value here would read 350 \"degrees\"."
- `:227` "refuses a tenths value that leaks into the degrees field" - a bench profile with `t_idle_c: 350` must yield `t_idle_valid: false` (the `idle + 1 < 42` gate firing).
- `:245` "keeps an unplugged poll without an idle reference valid" - unplugged poll with no `t_idle_*` fields stays `sensor_valid: true`.

`src/engine/governorBatterySampler.test.ts` reads the Kotlin source as text and pins it (`:236-255`):

- `:241` "latches the idle baseline on the plug-in edge and clears it on unplug" - regex `if \(plugged\) \{[\s\S]*idleBaselineTenthsC = temperature[\s\S]*\} else \{[\s\S]*idleBaselineTenthsC = null`
- `:249` "reports the latch in tenths and leaves the degrees conversion to the app" - asserts the strings `putBoolean("t_idle_valid", idleTenths != null)`, `putInt("t_idle_tenths_c", idleTenths)`, and `expect(readThermo).not.toContain('"t_idle_c"')`, with comment "The tenths-to-degrees conversion happens exactly once, in profileFrom."

So the tests lock in: Kotlin latches (plug-in edge / clear on unplug), native emits only tenths, TS converts once, TS refuses out-of-range baselines.

---

## 2. Binding

The binding lives in the llama.rn fork, `/Users/marco/Projects/llama.rn-kalsa`.

### 2.1 Exact fields crossing the boundary, classified

JSI entry point (`cpp/jsi/RNLlamaJSI.cpp:42-45`):

```cpp
static llama_governor_thermo_profile governorThermoFromJsi(
        jsi::Runtime & runtime, const jsi::Value & value) {
    return rnllama::parse_governor_thermo(rnllama_jsi::toJson(runtime, value));
}
```

Installed as the global `llamaSetGovernorThermo` host function at `cpp/jsi/RNLlamaJSI.cpp:850`; invoked at `:835`.

Field-by-field copy, `cpp/rn-governor-params.cpp:75-90` (`parse_governor_thermo`):

```cpp
result.batt_temp_tenths_c = value_or(thermo, "batt_temp_tenths_c", 0);
result.batt_level_pct     = value_or(thermo, "batt_level_pct", 100);
result.plugged            = bool_or(thermo, "plugged", false);
result.sensor_valid       = bool_or(thermo, "sensor_valid", false);
result.t_idle_valid       = bool_or(thermo, "t_idle_valid", false);
result.t_idle_c           = value_or(thermo, "t_idle_c", 0.0f);
result.trend_c_per_min    = value_or(thermo, "trend_c_per_min", 0.0f);
```

TypeScript mirror `GovernorThermoProfile` (`src/types.ts:45-53` in llama.rn-kalsa):

```ts
export type GovernorThermoProfile = {
  batt_temp_tenths_c: number
  batt_level_pct: number
  plugged: boolean
  sensor_valid: boolean
  t_idle_valid?: boolean
  t_idle_c?: number
  trend_c_per_min?: number
}
```

Classification of each crossing field:

| field | origin | class |
|---|---|---|
| `batt_temp_tenths_c` | BatteryManager dumpsys, via Kotlin | RAW |
| `batt_level_pct` | BatteryManager | RAW |
| `plugged` | BatteryManager `EXTRA_PLUGGED` | RAW |
| `sensor_valid` | Kotlin `present && temperature > 0` | RAW (sensor presence, no policy) |
| `trend_c_per_min` | bench skin or app default `0` (`governorInputs.ts:146`) | RAW (defaulted) |
| `t_idle_valid` | Kotlin latch state, then AND-gated by `idle > 0 && idle + 1 < 42` in `governorInputs.ts:138` | DERIVED (policy-gated in the app before it reaches the binding) |
| `t_idle_c` | `t_idle_tenths_c / 10` unit lift in `governorInputs.ts:133-137` | DERIVED (unit conversion in the app) |

The binding itself is a pass-through for these fields: `parse_governor_thermo` copies JSON keys to struct members with defaults and applies no condition.

### 2.2 But the binding holds a third copy of the plugged rule

`cpp/rn-governor-params.cpp:92-105`:

```cpp
bool governor_thermo_profile_is_valid(const llama_governor_thermo_profile & thermo) {
    if (!thermo.sensor_valid || !std::isfinite(thermo.trend_c_per_min)) return false;
    if (thermo.batt_level_pct < 0 || thermo.batt_level_pct > 100) return false;
    if (!thermo.plugged) return true;
    return thermo.t_idle_valid && std::isfinite(thermo.t_idle_c) &&
           thermo.t_idle_c + 1.0f < 42.0f;
}
```

Callers: `cpp/rn-governor-params.cpp:155`, `cpp/rn-llama.cpp:81, 706, 718`, `cpp/jsi/RNLlamaJSI.cpp:678`. So `t_idle_valid && t_idle_c + 1.0f < 42.0f` exists in three places: `governorInputs.ts:138` (app), `rn-governor-params.cpp:103-104` (binding), `llama-governor-policy.cpp:63` (engine). The owner's boundary holds for field transport (binding TRANSPORTS) but not for the validity rule (binding also DECIDES, as a gate on load/parse).

App -> binding call sites: `src/engine/LlamaService.ts:1651` `nativeGovernorThermo` strips only `thermo_source` and forwards the rest; `LlamaService.ts:1724` (`setGovernorThermo`, wrapped in `withNativeCallTimeout`), and `LlamaService.ts:2329` (`thermo:` inside the governor params object).

---

## 3. Engine (`/Users/marco/Projects/kalsallama`)

Struct and doc, `src/llama-ext.h:266-276` (comment written by the same commit as the fix, see section 4):

```cpp
/** One successful battery poll. Temperature is the dumpsys tenths-of-°C value.
 *  t_idle_c is the plugged baseline in whole degrees C, latched on the plug-in
 *  edge; it is not the live temperature. */
struct llama_governor_thermo_profile {
    ...
    bool t_idle_valid = false;
    float t_idle_c = 0.0f;
```

State, `src/llama-governor-policy.h:70-71`:

```cpp
float t_idle_reference_c_ = 0.0f;
bool have_t_idle_reference_ = false;
```

Latch, clear-on-unplug, and the 1.5 C re-latch tolerance, `src/llama-governor-policy.cpp:97-111`:

```cpp
if (profile.plugged) {
    if (!have_t_idle_reference_) {
        t_idle_reference_c_ = profile.t_idle_c;      // latch first plugged sample
        have_t_idle_reference_ = true;
    } else if (std::fabs(profile.t_idle_c - t_idle_reference_c_) > 1.5f) {
        profile_valid_ = false;                      // drift > 1.5 C kills the profile
        have_profile_ = true;
        state_ = llama_governor_thermal_state::Invalid;
        state_since_ms_ = now_ms;
        return false;
    }
} else {
    // An unplug ends the plugged baseline; the next plug latches a fresh one.
    have_t_idle_reference_ = false;                  // clear-on-unplug (:110)
}
```

Gate on the incoming value, `src/llama-governor-policy.cpp:63`:

```cpp
return profile.t_idle_valid && std::isfinite(profile.t_idle_c) && profile.t_idle_c + 1.0f < 42.0f;
```

Thresholds derived from the latched reference, `src/llama-governor-policy.cpp:42-50`:

```cpp
if (!profile_.plugged) {
    return { 38.0f, 36.0f, 39.5f, 36.5f, 42.0f, 34.0f };
}
return {
    std::min(profile_.t_idle_c + 3.0f, 42.0f), profile_.t_idle_c + 1.0f,
    std::min(profile_.t_idle_c + 4.5f, 42.0f), profile_.t_idle_c + 1.5f,
    std::min(profile_.t_idle_c + 7.0f, 42.0f), profile_.t_idle_c + 1.0f,
};
```

Hot-plug classification, `src/llama-governor-policy.cpp:115`:

```cpp
hot_plugged_ = profile.plugged && profile.t_idle_c >= 37.5f;
```

### What consumes the value (the DECIDES chain)

1. `get_thresholds()` (`:42`) -> `classify()` (`:65`) -> thermal state machine in `update_thermal` (`:117-150`): state is `CRITICAL`/`COOLMODE`/`WARM`/`FAST` relative to thresholds offset from `t_idle_c`.
2. `hot_plugged_` gates routing: `prefill_engine()` refuses GPU_COOLMODE when hot (`src/llama-governor-policy.cpp:175`, `params_.cool_prefill_eligible && params_.gpu_fit == Fit && !hot_plugged_`), and gates cache-budget eligibility (`:244-245`). Consumed by the runtime announcer at `src/llama-governor-runtime.cpp:186-190`.
3. An invalid profile (drift trip or failed `profile_is_valid`) sets `state_ = Invalid`, which makes `admit_prefill` return `Abort` (`src/llama-governor-policy.cpp`, `admit_prefill` guard: `state_ == Invalid || state_ == CRITICAL -> Abort`). This is the "governor killed for the rest of the session" failure mode.

### Engine tests pinning these semantics

`tests/test-governor-v02-router.cpp`:

- `:164` "hot plugged profile refuses acceleration" - `poll(380, true, 37.5f)` must route to CPU.
- `:166` "unsafe plugged baseline is refused" - `poll(380, true, 41.0f)` -> `update_thermal` returns false (`t_idle_c + 1 < 42` fails at `:63`).
- `:169` "drifting plugged baseline invalidates profile" - 35.0 C latched, then 36.6 C (`> 1.5f` drift) -> false.
- `:172` "unplug keeps the profile valid" and `:173` "replug latches a fresh idle baseline" - added by the engine-side fix commit (section 4).

Test fixture sets the fields directly (`tests/test-governor-v02-router.cpp:25-26`): `result.t_idle_valid = !plugged || idle != 0.0f; result.t_idle_c = idle;`.

---

## 4. The two "defect 5.2" commits: coordinated, not independent, but written twice

### Engine commit `61db879b8c49e3e5177d4adcd67ac9956922a466`

- author: Marco Gualtieri <66642624+Aspis0@users.noreply.github.com>
- date: Mon Sep 21 10:39:02 2026 -0400
- subject: `governor : clear the plugged idle baseline on unplug (defect 5.2, engine)`
- trailer: `Assisted-by: pi`
- diff: `src/llama-governor-policy.cpp` +3 (the `else { have_t_idle_reference_ = false; }` block at `:108-111`), `src/llama-ext.h` +4/-1 (the `t_idle_c is the plugged baseline...` doc comment), `tests/test-governor-v02-router.cpp` +4 (the replug assertions).
- body (verbatim excerpt): "The reference was never cleared, so an honest unplug-replug inside one session tripped the drift check and killed the profile. Reset it on the unplugging sample; the next plug latches a fresh one. Also state in llama-ext.h that t_idle_c is a latched plugged baseline in whole degrees C, not the live tenths temperature."

### App commit `e5788cfee46dd76dacd6893913d6c5f67b6ec762`

- author: Marco Gualtieri <66642624+Aspis0@users.noreply.github.com>
- date: Mon Sep 21 11:22:00 2026 -0400 (43 minutes after the engine commit)
- subject: `governor : supply the real plugged idle baseline (defect 5.2, app)`
- trailer: `Assisted-by: pi`
- diff: `native/GovernorBatteryModule.kt` +18, `src/engine/LlamaService.ts` +13, `src/engine/governorBatterySampler.test.ts` +21, `src/engine/governorInputs.ts` +15/-4, `src/engine/governorInputs.test.ts` +43/-4 (5 files, 106 insertions).
- body (verbatim excerpt): "GovernorBatteryModule now latches the battery temperature on the plug-in edge, holds it for the plugged session and clears it on unplug, reporting t_idle_valid / t_idle_tenths_c in its native unit (tenths). governorInputs converts tenths to whole degrees exactly once and refuses a baseline the engine's own plugged rule would reject, so a tenths value can never become a plugged baseline."

### Verdict on intent

Same author, same day, 43 minutes apart, same defect tag `defect 5.2`, both AI-assisted (`Assisted-by: pi`). This was one coordinated session, not two independent discoveries. But the coordination did not prevent duplication: both commits implement the same policy - latch on plug-in edge, hold, clear on unplug, reject out-of-range baselines - at two different observation points:

- engine clears `have_t_idle_reference_` on the first unplugged *sample it sees* (`llama-governor-policy.cpp:110`);
- app clears `idleBaselineTenthsC` on the first unplugged *sample the Kotlin module sees* (`GovernorBatteryModule.kt:71`).

The two conditions diverge whenever an unplug happens between two samples observed by only one side: `readThermo` is polled per JS call (`LlamaService.ts:1719`), while the engine only receives a profile when `setGovernorThermo` is invoked (`LlamaService.ts:1724`, gated by `activeGovernorActive && engine === context`) and inside governor params at `:2329`. An unplug+replug that the app observes between engine pushes updates the Kotlin latch but not `have_t_idle_reference_`, and vice versa if an engine push is dropped by the timeout wrapper. The 1.5 C drift check then judges the app's held reference against the engine's older reference.

Also duplicated, in the same session: the validity rule `t_idle_valid && t_idle_c + 1 < 42` in three files (section 2.2).

---

## 5. Minimal consolidation - options, no recommendation

Goal as stated: app forwards RAW, binding transports unchanged, engine alone owns latch / clear / 1.5 C tolerance. The binding transport itself (`GovernorThermoProfile` fields, `parse_governor_thermo`) is already field-for-field and would not change in any option.

### Option A - keep the app-side condition; engine stops latching

Files/lines to change:

- `kalsallama/src/llama-governor-policy.cpp:97-111` - delete the latch/drift/clear block; keep `profile_is_valid` if the engine still wants a sanity check on the incoming value, but drop `t_idle_reference_c_` re-derivation.
- `kalsallama/src/llama-governor-policy.h:70-71` - remove `t_idle_reference_c_`, `have_t_idle_reference_`.
- `kalsallama/tests/test-governor-v02-router.cpp:167-173` - "drifting plugged baseline invalidates profile", "unplug keeps the profile valid", "replug latches a fresh idle baseline" all become meaningless; must be rewritten or removed.
- `kalsa/native/GovernorBatteryModule.kt:37-41, 66-73` - unchanged (stays owner of the latch).
- `kalsa/src/engine/governorInputs.ts:138` - unchanged (stays owner of the pre-gate).
- `llama.rn-kalsa` - unchanged except `rn-governor-params.cpp:92-105` becomes a redundant third gate (could stay or go).

Regressions: the engine loses its independent drift defense; any app (or bench skin, or future second client) that sends a stale `t_idle_c` is trusted, and `hot_plugged_ >= 37.5f` thresholds derive from a value the engine never cross-checks. Engine-only test binaries and future non-app clients must replicate the app's latch to keep `test-governor-v02-router` semantics. Improvement: single owner, latch divergence becomes impossible.

### Option B - keep the engine-side condition; app forwards RAW

Files/lines to change:

- `kalsa/native/GovernorBatteryModule.kt:37-41` - remove `idleBaselineTenthsC`; `:66-72` - remove the latch block (always report the live plugged state); `:78-81` - either keep emitting `t_idle_tenths_c` as the live reading or stop emitting `t_idle_*` entirely and let the engine latch from `batt_temp_tenths_c`.
- `kalsa/src/engine/governorInputs.ts:126-145` - keep only the tenths->degrees lift (unit conversion is legitimately transport); remove the `idle + 1 < 42` refusal so `t_idle_valid` is `idleValidRaw` passed through.
- `kalsa/src/engine/governorBatterySampler.test.ts:241-247` - the Kotlin-latch source assertion must be deleted or inverted; `:249-255` keeps only the "no `t_idle_c` from native" half.
- `kalsa/src/engine/governorInputs.test.ts:227-243` - "refuses a tenths value that leaks into the degrees field" asserts the app gate; must be rewritten (refusal now happens in the engine at `llama-governor-policy.cpp:63`).
- `kalsallama` - no change (latch, clear, 1.5 C tolerance already correct and tested).
- `llama.rn-kalsa` - no change, or optionally delete `governor_thermo_profile_is_valid` (`rn-governor-params.cpp:92-105`) to complete the "engine alone decides" property.

Regressions: a tenths leak or absurd baseline is no longer caught at the JS layer; it surfaces later as an engine `Invalid` state -> `admit_prefill` Abort (harder failure, different UX than today's clean `t_idle_valid: false`). The bench-skin path (`kalsa.bench.thermo`) loses its early refusal too. Improvement: matches the owner's boundary exactly; engine becomes the only decider; app tests shrink.

### Option C - keep both conditions, make the contract explicit

Files/lines to change (documentation + tests only, no behavior):

- `llama.rn-kalsa/src/types.ts:45-53` - document `t_idle_c` as "app-latched plugged baseline, whole C" and `t_idle_valid` as "app-gated per engine rule `+1 < 42`".
- `kalsa/src/engine/governorInputs.ts:138` and `kalsallama/src/llama-governor-policy.cpp:63` - add cross-references so the two copies of the rule are visibly one rule.
- Add a shared test vector (e.g. 35.0/35.5/36.6/41.0 plugged inputs) asserted identically in `governorInputs.test.ts` and `test-governor-v02-router.cpp`.

Regressions: duplication remains in three files (`governorInputs.ts:138`, `rn-governor-params.cpp:103`, `llama-governor-policy.cpp:63`) and two latches remain with conditions that can still diverge (section 4); any future threshold edit must be made three times. Improvement: zero behavioral risk, cheapest to ship, keeps the engine's independent drift defense.

### Option D (combination, sketched only) - app forwards RAW for the latch but keeps a fail-fast mirror

App drops the Kotlin latch (as in B) but keeps the `+1 < 42` mirror purely as an early-warning flag that never mutates `t_idle_valid` (e.g. telemetry-only). Regression: still two numeric constants to keep in sync; improvement: fail-fast UX without a second decider. Files: `governorInputs.ts:138` becomes a log-only expression; `governorInputs.test.ts:227` changes to assert `t_idle_valid` stays true while a warning fires.

The owner decides. This report does not pick.

---

## 6. Any other reader of `t_idle_valid` in the app

Exhaustive grep over `src/`, `native/`, `android/` (`*.ts`, `*.tsx`, `*.kt`, `*.java`):

| file | lines | role |
|---|---|---|
| `native/GovernorBatteryModule.kt` | 55, 78 | producer (native module) |
| `src/engine/governorInputs.ts` | 31 (type decl), 32 (type decl), 126 (`idleValidRaw` read), 144 (re-emit gated) | converter + gate |
| `src/engine/governorInputs.test.ts` | 180, 181, 187, 188, 213, 221, 234, 240 | test fixtures/assertions |
| `src/engine/governorBatterySampler.test.ts` | 250 | source-text assertion on the Kotlin |
| `android/app/src/main/java/com/kalsa/app/GovernorBatteryModule.kt` | none | stale duplicate, pre-dates the field |

No other app-side reader. Indirect consumers go through `readGovernorThermo()` -> `LlamaService.ts:1651 nativeGovernorThermo` -> `setGovernorThermo`, which treat the whole profile as opaque. Outside the app: `llama-rn-kalsa/cpp/rn-governor-params.cpp:86,103` and `kalsallama/src/llama-governor-policy.cpp:63` plus `tests/test-governor-v02-router.cpp:25`.

---

## 7. Inventory of `src/engine/` (bounded: all 136 files at HEAD `e5788cfe`)

Classes: MEASUREMENT/TRANSPORT (samples, converts, forwards, persists, reports) vs POLICY (chooses gates, budgets, routing, validity).

| file | lines | class |
|---|---|---|
| LlamaService.ts | 6253 | MEASUREMENT/TRANSPORT (orchestration; forwards thermo, no idle policy of its own) |
| sessionPersistence.ts | 1085 | MEASUREMENT/TRANSPORT |
| sessionPool.test.ts | 1036 | test |
| EmbeddingService.ts | 864 | MEASUREMENT/TRANSPORT |
| deviceTuning.ts | 859 | POLICY (tuning selection) |
| modelEmittedText.test.ts | 803 | test |
| sessionPool.ts | 789 | MEASUREMENT/TRANSPORT |
| windowKvInvariant.test.ts | 777 | test |
| deviceProfile.ts | 713 | MEASUREMENT/TRANSPORT |
| sessionPersistence.test.ts | 707 | test |
| ModelDownloader.ts | 690 | MEASUREMENT/TRANSPORT |
| prefixPrewarm.ts | 542 | POLICY (prewarm decision) |
| engineIdentity.test.ts | 525 | test |
| toolCallParser.ts | 518 | MEASUREMENT/TRANSPORT |
| llamaContextGate.ts | 485 | POLICY |
| staticPrefixSnapshot.test.ts | 471 | test |
| loadGate.test.ts | 409 | test |
| ModelRegistry.ts | 404 | MEASUREMENT/TRANSPORT |
| thinkStream.ts | 393 | MEASUREMENT/TRANSPORT |
| prefixPrewarm.test.ts | 384 | test |
| sessionDiskCalibration.test.ts | 380 | test |
| memoryFactsTail.ts | 376 | MEASUREMENT/TRANSPORT |
| modelEmittedText.ts | 326 | MEASUREMENT/TRANSPORT |
| staticPrefixSnapshot.ts | 322 | MEASUREMENT/TRANSPORT |
| memoryEstimate.ts | 319 | MEASUREMENT/TRANSPORT |
| sessionDiskSpaceDecision.test.ts | 317 | test |
| threadProfile.ts | 312 | MEASUREMENT/TRANSPORT |
| windowKvInvariant.ts | 305 | MEASUREMENT/TRANSPORT |
| modelGateRAM.ts | 277 | POLICY |
| ModelDownloader.orphan.test.ts | 272 | test |
| sessionDiskCalibration.ts | 267 | MEASUREMENT/TRANSPORT |
| governorInputs.test.ts | 258 | test (pins POLICY gate) |
| loadMarker.test.ts | 257 | test |
| governorBatterySampler.test.ts | 255 | test (pins native latch) |
| engineLiveness.ts | 252 | MEASUREMENT/TRANSPORT |
| turnTelemetry.ts | 249 | MEASUREMENT/TRANSPORT |
| loadGate.ts | 245 | POLICY |
| thinkStream.test.ts | 240 | test |
| ModelDownloader.orphanMigration.ts | 232 | MEASUREMENT/TRANSPORT |
| ModelDownloader.test.ts | 229 | test |
| modelGateRAM.test.ts | 226 | test |
| contextProfile.ts | 208 | POLICY (n_ctx/KV profile choice) |
| loadPolicy.test.ts | 198 | test |
| monitor.ts | 194 | MEASUREMENT/TRANSPORT |
| toolCallParser.test.ts | 192 | test |
| sessionKey.ts | 191 | MEASUREMENT/TRANSPORT |
| thermalThresholds.ts | 188 | POLICY (threshold tables) |
| contextSizePref.ts | 188 | POLICY |
| governorInputs.ts | 177 | POLICY (applies `idle+1<42` gate) + MEASUREMENT/TRANSPORT (unit lift) |
| embeddingPure.ts | 175 | MEASUREMENT/TRANSPORT |
| contextSizePref.test.ts | 172 | test |
| batteryEta.test.ts | 172 | test |
| engineParams.test.ts | 159 | test |
| devModelCatalog.ts | 155 | MEASUREMENT/TRANSPORT |
| memoryPressure.ts | 153 | MEASUREMENT/TRANSPORT |
| stallWatchdog.test.ts | 152 | test |
| engineParams.ts | 149 | MEASUREMENT/TRANSPORT |
| thinkingBudgets.ts | 147 | POLICY (budget choice) |
| deviceTuning.test.ts | 147 | test |
| batteryEta.ts | 144 | MEASUREMENT/TRANSPORT |
| memoryFactsTail.test.ts | 141 | test |
| thinkingBudgets.test.ts | 139 | test |
| deviceThroughput.ts | 132 | MEASUREMENT/TRANSPORT |
| expertStreaming.ts | 130 | MEASUREMENT/TRANSPORT |
| loadMarker.ts | 127 | MEASUREMENT/TRANSPORT |
| benchSampling.test.ts | 126 | test |
| ttftFlags.ts | 125 | MEASUREMENT/TRANSPORT |
| thermalThresholds.test.ts | 125 | test |
| expertStreaming.test.ts | 118 | test |
| ciswireFlagsTelemetry.test.ts | 116 | test |
| toolCallTelemetry.ts | 115 | MEASUREMENT/TRANSPORT |
| governorRuntime.test.ts | 109 | test |
| sessionKey.test.ts | 107 | test |
| loadPolicy.ts | 105 | POLICY |
| governorBatterySampler.ts | 101 | MEASUREMENT/TRANSPORT |
| sessionBudget.ts | 100 | POLICY |
| regenState.ts | 99 | MEASUREMENT/TRANSPORT |
| kvReproducibility.ts | 99 | MEASUREMENT/TRANSPORT |
| sessionDiskSpaceDecision.ts | 97 | POLICY |
| benchSampling.ts | 94 | MEASUREMENT/TRANSPORT |
| embeddingPure.test.ts | 93 | test |
| turnTelemetry.test.ts | 91 | test |
| sessionPromptEnv.test.ts | 91 | test |
| kvQuantCost.ts | 91 | MEASUREMENT/TRANSPORT |
| historyPersistable.ts | 87 | MEASUREMENT/TRANSPORT |
| deviceThroughput.test.ts | 87 | test |
| platformThermalStatus.ts | 82 | MEASUREMENT/TRANSPORT |
| governorRuntime.ts | 81 | POLICY |
| prefillSpeed.ts | 80 | MEASUREMENT/TRANSPORT |
| sessionEvictMarker.test.ts | 77 | test |
| kvReproducibility.test.ts | 77 | test |
| stallWatchdog.ts | 75 | POLICY |
| extractBudget.test.ts | 75 | test |
| sessionEvictMarker.ts | 74 | MEASUREMENT/TRANSPORT |
| thermalHardGate.test.ts | 73 | test |
| streamCoalescer.ts | 73 | MEASUREMENT/TRANSPORT |
| promptEnvHash.test.ts | 73 | test |
| llamaContextGate.test.ts | 72 | test |
| truncatedTurnText.test.ts | 67 | test |
| platformThermalStatus.test.ts | 67 | test |
| decodeSpeed.ts | 66 | MEASUREMENT/TRANSPORT |
| decodeSpeed.test.ts | 66 | test |
| qwenHistoryFields.ts | 64 | MEASUREMENT/TRANSPORT |
| engineIdentity.ts | 64 | MEASUREMENT/TRANSPORT |
| prefillSpeed.test.ts | 62 | test |
| kvCachePref.ts | 62 | POLICY |
| sessionMarkerPrivacy.test.ts | 59 | test |
| sessionBudget.test.ts | 58 | test |
| ModelRegistry.test.ts | 57 | test |
| kvCachePref.test.ts | 55 | test |
| sessionDiskCalibrationStore.ts | 54 | MEASUREMENT/TRANSPORT |
| sessionDiskFallback.ts | 49 | POLICY |
| toolRoundCeiling.test.ts | 47 | test |
| contextProfile.test.ts | 45 | test |
| sessionPromptEnv.ts | 44 | MEASUREMENT/TRANSPORT |
| kvQuantCost.test.ts | 44 | test |
| modelHost.ts | 43 | MEASUREMENT/TRANSPORT |
| extractBudget.ts | 43 | POLICY |
| modelHost.test.ts | 41 | test |
| prefillDeadline.ts | 40 | POLICY (watchdog deadline) |
| personaTail.ts | 39 | MEASUREMENT/TRANSPORT |
| digestTelemetry.ts | 39 | MEASUREMENT/TRANSPORT |
| deviceThroughputStore.ts | 39 | MEASUREMENT/TRANSPORT |
| prefillDeadline.test.ts | 36 | test |
| toolRoundCeiling.ts | 33 | POLICY |
| kvShiftRefuse.test.ts | 32 | test |
| admissionModel.test.ts | 28 | test |
| truncatedTurnText.ts | 27 | MEASUREMENT/TRANSPORT |
| toolRoundFallback.ts | 24 | POLICY |
| ttftFlags.test.ts | 23 | test |
| sessionDiskMath.ts | 18 | MEASUREMENT/TRANSPORT |
| historyMessagePositions.ts | 16 | MEASUREMENT/TRANSPORT |
| admissionModel.ts | 14 | POLICY |
| kvCacheProfile.ts | 13 | MEASUREMENT/TRANSPORT |
| sessionDiskMath.test.ts | 10 | test |

Totals: 136 files, 33297 lines. POLICY files: 24. `governorInputs.ts` is the only file in the directory that both transports and applies a thermal-validity condition; the idle-latch condition itself lives one layer below, in `native/GovernorBatteryModule.kt`.

---

## WHAT WE DO NOT KNOW

- Whether `android/app/src/main/java/com/kalsa/app/GovernorBatteryModule.kt` (stale duplicate, no latch, no `t_idle_*` fields) is compiled into any shipped APK, or is dead. If it is live, the app has a second native implementation that never supplies the baseline and would reproduce the original defect on that build path.
- Whether the app-side latch (`GovernorBatteryModule.kt:66`) and the engine-side latch (`llama-governor-policy.cpp:97`) have ever held different references in a real session; we have the code paths that allow divergence (section 4) but no runtime trace confirming it happens at measurable frequency.
- Why `trend_c_per_min` defaults to 0 on the battery path (no native producer found in `GovernorBatteryModule.kt`); whether the engine's trend-based WARM escalation (`llama-governor-policy.cpp:139`) is therefore dead code in production, or fed only by the bench skin.
- Whether the binding-side gate `governor_thermo_profile_is_valid` (`rn-governor-params.cpp:92`) is intended as a permanent contract or is scaffolding left from before the engine gate existed; no test in `llama.rn-kalsa` asserts its plugged branch specifically.
- The owner's intent behind defect 5.2: whether the app-side latch was meant as a permanent design ("app MEASURES" including the latch) or as a stopgap for the missing-native-baseline defect, to be retired later. The commit message argues necessity at the time; it does not state the final boundary.
- Whether any non-kalsa client of `llama.rn-kalsa` also calls `setGovernorThermo`; consolidation options assume the kalsa app is the only producer, which we did not verify across all forks of the binding.
- Exact runtime cadence of `setGovernorThermo` relative to battery polls under load (poll interval at turn boundaries vs `readThermo` per call); needed to quantify how often the two latch conditions can actually disagree.
