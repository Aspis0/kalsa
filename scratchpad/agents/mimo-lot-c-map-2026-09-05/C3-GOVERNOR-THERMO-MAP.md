# C3 — Governor ↔ Thermo Map (2026-09-05)

Recon scope: governor worktree `kalsallama-wt-governor` (branch `kalsa/governor-v0.2`) + production app `kalsa` (main).

---

## 1. Structs, file:line, units

### `llama_governor_thermo_profile` — `src/llama-ext.h:~L260`

```cpp
struct llama_governor_thermo_profile {
    int32_t batt_temp_tenths_c = 0;   // battery temp in tenths °C (e.g. 380 = 38.0 °C)
    int32_t batt_level_pct = 100;     // battery %
    bool plugged = false;
    bool sensor_valid = false;
    bool t_idle_valid = false;
    float t_idle_c = 0.0f;           // idle baseline °C (plugged thermal calibration)
    float trend_c_per_min = 0.0f;    // °C/min rate of change
};
```

**Conversion** in `src/llama-governor-policy.cpp:22`:
```cpp
float temperature_c(const llama_governor_thermo_profile & profile) {
    return profile.batt_temp_tenths_c / 10.0f;
}
```

So `batt_temp_tenths_c` is **tenths of °C**, converted to °C by dividing by 10.

### `llama_governor_thermal_state` — `src/llama-ext.h:~L205`

```cpp
enum class llama_governor_thermal_state {
    Unknown, FAST, WARM, COOLMODE, CRITICAL, LOWBAT, Invalid,
};
```

### `llama_governor_engine` — `src/llama-ext.h:~L190`

```cpp
enum class llama_governor_engine { CPU, GPU, NPU, GPU_COOLMODE };
```

### `llama_governor_params` — `src/llama-ext.h:~L225`

The v0.2 config struct. Key thermo-relevant fields:
- `generation` (V73/V75) — determines GPU_COOLMODE eligibility
- `gpu_fit` — Fit/NotFit/Unknown
- `cool_prefill_eligible`, `cool_delta_measured`, `kexp_cool_scope`, `cool_pays` — COOLMODE decode gate booleans
- `admission_margin_c` — must be exactly `0.5f` (schema validation)

### API entry point — `src/llama-governor-runtime.cpp:125,201`

```cpp
bool llama_governor::set_thermo_profile(const llama_governor_thermo_profile & profile, int64_t now_ms);
bool llama_governor_set_thermo_profile(llama_governor *, llama_governor_thermo_profile, int64_t now_ms);
```

---

## 2. Policy: thermal states → engine routing

### Thresholds (`src/llama-governor-policy.cpp:37-49`)

**Unplugged (hardcoded):**
| State enter | °C |
|---|---|
| WARM | ≥ 38.0 |
| COOLMODE | ≥ 39.5 |
| CRITICAL | ≥ 42.0 |
| Kill backstop | ≥ 43.0 |

**Plugged (dynamic, from `t_idle_c`):**
| State enter | formula |
|---|---|
| WARM | `min(t_idle + 3.0, 42.0)` |
| COOLMODE | `min(t_idle + 4.5, 42.0)` |
| CRITICAL | `min(t_idle + 7.0, 42.0)` |

Hysteresis exit temps are lower (2–8 °C below entry). All transitions require a **10-minute dwell** (`k_dwell_ms`).

### State machine (`src/llama-governor-policy.cpp:66-143`)

```
FAST → WARM (≥ warm_enter)
FAST → COOLMODE (≥ cool_enter)
WARM → COOLMODE (≥ cool_enter OR trend ≥ 1.5 °C/min at warm+0.5)
WARM → FAST (≤ warm_exit AND dwell elapsed)
COOLMODE → FAST (≤ cool_exit AND dwell elapsed)
* → CRITICAL (≥ critical_enter OR ≥ 43.0)
CRITICAL → FAST (≤ critical_exit AND dwell elapsed)
* → LOWBAT (battery < 25%)
LOWBAT → classify(temp) (after dwell)
```

### How states affect prefill engine (`src/llama-governor-policy.cpp:148-165`)

```
prefill_engine():
  CRITICAL / Invalid / LowBat / battery < 45%  →  CPU (always)
  V75 + gpu_fit + gpu_prefill_measured          →  GPU
  V73 + MoE + cool_prefill_eligible + gpu_fit + !hot_plugged  →  GPU_COOLMODE
  else                                          →  CPU
```

### How states affect decode engine (`src/llama-governor-policy.cpp:217-240`)

```
select_decode():
  Unknown / Invalid / CRITICAL  →  wait (blocks decode)
  COOLMODE + all gates met     →  GPU_COOLMODE (reload required)
  else                          →  CPU
```

Gate conditions for COOLMODE decode:
1. `batt_level_pct >= 45`
2. `state == COOLMODE`
3. `!hot_plugged`
4. `generation == V73`
5. `gpu_fit == Fit`
6. `cool_delta_measured && kexp_cool_scope`
7. `cool_pays != No`
8. `reload_budget_available`
9. Flip budget: ≥ 60 min since last CPU→GPU engagement

### Prefill admission chunking (`src/llama-governor-policy.cpp:167-199`)

Token chunk table: `{128, 512, 1024, 2048}` with CPU-delta °C costs `{1.9, 3.25, 3.25, 5.15}`. Governor rejects chunks that would push temp above `k_limit_c = 39.5 °C`. Returns `Chunk` decision with reduced token count, or `Wait` if even 128 tokens would overheat.

---

## 3. Production app (main) does NOT include governor

The production app (`kalsa` main branch) does **not** import or call any governor APIs:
- No `governor` import in `LlamaService.ts`, `AppShell.tsx`, or anywhere in `src/`.
- `LlamaService.ts` uses `llama.rn`'s `initLlama()` directly (single context, no dual-context governor).
- Grep hits for "governor" in `src/` are only **comments** in `ModelRegistry.ts:234-235` and `deviceTuning.ts:341,358` — forward-looking notes, not code paths.
- The governor worktree (`kalsallama-wt-governor`) has **no llama.rn JSI bindings** for governor APIs — no Java/Kotlin bridge, no TS declarations. The governor is C++ only (with bench harness + tests).

**Divergence note:** The governor exists as pure C++ in the worktree. The production app feeds a single `initLlama` context. The bridge (JSI → governor C API) does not exist yet.

---

## 4. App TS path that pushes battery/temp into native: NONE

### Existing thermal path: `src/hooks/useThermalMonitor.ts`

- Reads `/sys/class/thermal/thermal_zone0/temp` (Android sysfs, millidegrees → °C).
- Fallback: memory-pressure heuristic (< 512 MiB free → "warm").
- Type: `ThermalStatus = "ok" | "warm" | "hot" | "unknown"`.
- Thresholds: ≥ 50 °C → "hot", ≥ 42 °C → "ok" (sic — this is advisory-only).
- **Used only in `SettingsScreen.tsx:963`** for a banner display.
- **Never pushed to native / llama.rn / governor.**

### Thermal data in the engine path: NONE

`LlamaService.ts` (3942 lines) has zero references to `thermal`, `thermo`, `governor`, or `temperature`. The engine init does not receive thermal samples. The engine does not read thermal state.

---

## 5. Recommended app-side C3 slice (advisory, no native switch)

### Goal

Expose a stable thermal status + °C for Settings UI, and a typed hint object the future governor bridge can consume — without implementing the native switch in this lot.

### A. Canonical thermal types (`src/engine/thermalTypes.ts` — new file)

```typescript
/** Governor-aligned thermal state (mirrors llama_governor_thermal_state). */
export type GovernorThermalState =
  | "unknown"
  | "fast"
  | "warm"
  | "coolmode"
  | "critical"
  | "lowbat"
  | "invalid";

/** One thermal sample, typed to match llama_governor_thermo_profile. */
export type ThermalSample = {
  /** Battery temperature in tenths °C (e.g. 380 = 38.0 °C). */
  battTempTenthsC: number;
  /** Battery level 0-100. */
  battLevelPct: number;
  /** Charging cable connected. */
  plugged: boolean;
  /** Sensor reading is valid. */
  sensorValid: boolean;
  /** Idle baseline valid (plugged calibration). */
  tIdleValid: boolean;
  /** Idle baseline temperature °C. */
  tIdleC: number;
  /** Temperature trend °C/min. */
  trendCPerMin: number;
};

/** Advisory hint for the future governor bridge. */
export type ThermalGovernorHint = {
  /** Derived governor state from app-side classification. */
  state: GovernorThermalState;
  /** Current temperature °C (battTempTenthsC / 10). */
  temperatureC: number;
  /** When this sample was taken (epoch ms). */
  sampledAtMs: number;
  /** Raw sample for native bridge. */
  sample: ThermalSample;
};
```

### B. Upgrade `useThermalMonitor` (`src/hooks/useThermalMonitor.ts`)

Extend the existing hook to:
1. Map sysfs millidegrees → `ThermalSample` (tenths °C for native compat).
2. Classify into `GovernorThermalState` using the same thresholds as `llama-governor-policy.cpp:66-77` (unplugged: WARM ≥ 38, COOLMODE ≥ 39.5, CRITICAL ≥ 42).
3. Return `ThermalGovernorHint` alongside the existing `ThermalMonitorState`.

This keeps the app-side advisory classification **aligned** with the governor without calling native. The governor will reclassify from its own `update_thermal()` — the app hint is for UI display + future bridge readiness.

### C. SettingsScreen integration

Replace the current `thermal.status === "warm" || thermal.status === "hot"` banner with the richer `GovernorThermalState` display (e.g., "CPU-only mode · 39.5 °C" for COOLMODE). No behavior change — still advisory.

### D. What NOT to do in this lot

- Do not add JSI bindings for `llama_governor_set_thermo_profile`.
- Do not modify `LlamaService.ts` to pass thermal samples to native.
- Do not implement the GPU_COOLMODE decode switch in the app.
- Do not change `initLlama` params based on thermal state.

The native bridge (JSI → `llama_governor_set_thermo_profile`) is a separate lot. The app-side work here ensures the data is ready and typed when that bridge lands.

---

## Summary table

| Component | Exists? | Location | Notes |
|---|---|---|---|
| `llama_governor_thermo_profile` struct | ✅ C++ | `llama-ext.h:~L260` | `batt_temp_tenths_c` in tenths °C |
| `set_thermo_profile()` API | ✅ C++ | `llama-governor-runtime.cpp:125,201` | Decode-thread only |
| Thermal state machine | ✅ C++ | `llama-governor-policy.cpp:66-143` | FAST→WARM→COOLMODE→CRITICAL |
| GPU_COOLMODE routing | ✅ C++ | `llama-governor-policy.cpp:148-240` | V73 MoE only, many gates |
| Prefill admission chunking | ✅ C++ | `llama-governor-policy.cpp:167-199` | Token table + °C budget |
| JSI bridge (TS → native governor) | ❌ | — | Does not exist yet |
| App calls governor | ❌ | — | Main branch uses single `initLlama` |
| App thermal → native | ❌ | — | `useThermalMonitor` is UI-only |
| App thermal types | ⚠️ partial | `useThermalMonitor.ts` | `ok/warm/hot/unknown` (advisory) |
| Governor-aligned types in TS | ❌ | — | **Proposed in §5A** |
