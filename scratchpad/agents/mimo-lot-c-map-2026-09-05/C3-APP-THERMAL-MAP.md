# C3 — App Thermal Map

**Branch:** `feat/moe-stream` @ 659a644  
**LOT-C status:** advisory-only (no hard gate)  
**Date:** 2026-09-05  

---

## 1. `useThermalMonitor` — Thresholds, Sources, Poll, Status

**File:** `src/hooks/useThermalMonitor.ts`

### Status enum (line 10)

```ts
export type ThermalStatus = "ok" | "warm" | "hot" | "unknown";
```

### State shape (lines 12–18)

```ts
export type ThermalMonitorState = {
  status: ThermalStatus;
  currentTempC: number | null;
  source: "sysfs" | "memory_proxy" | "none";
  sampledAt: number | null;
};
```

### Thresholds — `statusFromTempC` (lines 51–55)

| Temp °C | Status |
|---------|--------|
| ≥ 50    | `"hot"` |
| ≥ 42    | `"warm"` |
| < 42    | `"ok"` |

### Sources

| Source | Platform | Read path | Fallback |
|--------|----------|-----------|----------|
| `sysfs` | Android only (line 83) | `/sys/class/thermal/thermal_zone0/temp` via `expo-file-system` | parse as millidegree int → ÷1000 → °C; reject < −20 or > 120 (line 40) |
| `memory_proxy` | Any (line 116) | `getAvailableMemoryBytesUncached()` from `src/engine/monitor.ts:54` | `availMiB < 512 → "warm"`, else `"ok"` (line 126). No temp value. |
| `none` | iOS / read failure (line 133) | — | status = `"unknown"` |

### Poll interval (line 20, default 61)

```ts
const DEFAULT_INTERVAL_MS = 30_000;  // 30 seconds
```

Overridable via `opts.intervalMs` (line 62).

### iOS path — **missing**

Line 83: `if (Platform.OS === "android")` — iOS falls through to memory proxy or `"none"`.  
There is no `ProcessInfo.thermalState` or `os_log` path. iOS users see `"unknown"` unless memory proxy triggers.

---

## 2. Consumers — Prove No Hard-Blocks on Send/Load

### 2a. SettingsScreen banner (sole consumer of the hook)

**File:** `src/screens/SettingsScreen.tsx`

- **Import:** line 66  
- **Call:** line 963 — `const thermal = useThermalMonitor();`  
- **Render:** lines 2140–2150

```tsx
{thermal.status === "warm" || thermal.status === "hot" ? (
  <Text style={[typography.bodyXs, { color: colors.bad ?? colors.muted, ... }]}>
    {t("chat.thermalHot")}
    {thermal.currentTempC != null ? ` · ${Math.round(thermal.currentTempC)}°C` : ""}
  </Text>
) : null}
```

**Effect:** Text-only banner below memory info. No button, no gate, no `onPress` handler.  
**Confirmed:** `thermal` is never read in the model-select/download loop (lines 2156–2236+). `selectDisabled` depends on `modelBusy || hardBlocked || profilePending` — none reference thermal.

### 2b. deviceTuning.ts — thermal guard flag

**File:** `src/engine/deviceTuning.ts`

- `resolveThermal()` (lines 634–644): sets `{ maxDecodeSeconds: 60, guardSource: "measured:thermal-4b" }` only when `sizeClass === "4B"` AND `availableMiB < 2048`. Otherwise `{ guardSource: "none" }`.
- `TuningResult.thermal` (line 156): `{ maxDecodeSeconds?: number; guardSource: string }`
- Resolved in `resolveEngineTuningSync` (line 686) and returned in `TuningResult` (line 700).
- **Not consumed:** `LlamaService.ts` calls `resolveEngineTuning()` (line 1202) but never reads `tuning.thermal` or `maxDecodeSeconds`. Confirmed via grep — zero hits for `maxDecodeSeconds` or `tuning.thermal` outside `deviceTuning.ts` / its test.

### 2c. deviceTuning.test.ts

**File:** `src/engine/deviceTuning.test.ts`

- Lines 22–34: asserts `thermal` = `{ maxDecodeSeconds: 60, guardSource: "measured:thermal-4b" }` for 4B + low-mem.
- Lines 46: asserts `thermal` = `{ guardSource: "none" }` when `sizeClass !== "4B"`.

### 2d. AppShell, telemetry, device_info

- **AppShell** (`src/app/AppShell.tsx`): grep returns zero thermal/warm/hot hits. Not a consumer.
- **Telemetry** (`workers/telemetry/`): no thermal field in schema.
- **deviceTools** (`src/agent/deviceTools.ts`): no thermal reference.

### 2e. i18n

| Key | `en.ts:509` | `it.ts:507` |
|-----|-------------|-------------|
| `chat.thermalHot` | `"Device warm"` | `"Telefono caldo"` |

Single key. No `"hot"` variant. No separate warm vs hot copy.

---

## 3. Gaps vs Advisory-Only Product

### 3a. Summer / ambient false positives

- Android `thermal_zone0` is often the **skin/ambient sensor**, not the SoC junction. In summer or direct sunlight, 42–50 °C is reachable without the device throttling. The banner fires; no throttling follows.
- The 512 MiB memory proxy threshold is static — does not account for devices with 16+ GiB where 512 MiB free is normal operating headroom.

### 3b. iOS — no native path

`useThermalMonitor` line 83 skips iOS entirely. Memory proxy on iOS returns `null` (line 60 of `monitor.ts`: `if (Platform.OS !== "android") return null`). Result: `status = "unknown"`, banner never shown. Apple's `ProcessInfothermalState` (iOS 13+) is the obvious source but is not wired.

### 3c. No feed to governor

`deviceTuning.ts` `resolveThermal` produces a flag (`maxDecodeSeconds`) that is **not read** by any downstream consumer. The flag was designed for a future per-phase governor (see `deviceTuning.ts` line 9 comment: "thermal guard flag (boolean/seconds only; no behavior)") but today it is dead output.

### 3d. Thresholds are hardcoded

- `statusFromTempC` (line 51): 42 / 50 °C — no override, no per-device calibration.
- Memory proxy (line 126): 512 MiB — static, not tiered by total RAM.
- Poll interval: 30 s default — no adaptive rate (e.g., faster when warm).

### 3e. Single copy key

`chat.thermalHot` = `"Device warm"` is used for both `"warm"` and `"hot"` statuses. No differentiated messaging (e.g., "Device warm — inference may slow" vs "Device hot — consider pausing").

---

## 4. Minimal Patch Sketch — Raising/Adjusting Advisory Thresholds

> **Still no send gate.** Advisory-only.

### 4a. Configurable thresholds (no behavior change)

```ts
// src/hooks/useThermalMonitor.ts

export type ThermalThresholds = {
  /** °C — below this = "ok" */
  warmC: number;
  /** °C — below this = "warm", at or above = "hot" */
  hotC: number;
  /** MiB — memory proxy: below this = "warm" */
  memoryProxyWarmMiB: number;
};

const DEFAULT_THRESHOLDS: ThermalThresholds = {
  warmC: 44,   // raised from 42 — reduces ambient/summer false positives
  hotC: 52,    // raised from 50 — aligns with typical throttling onset
  memoryProxyWarmMiB: 512,
};
```

- Accept `thresholds?: Partial<ThermalThresholds>` in `opts`.
- `statusFromTempC` becomes `statusFromTempC(tempC, thresholds)`.
- Memory proxy uses `thresholds.memoryProxyWarmMiB` instead of hardcoded 512.

### 4b. Split i18n copy

```ts
// src/i18n/en.ts
chat: {
  thermalWarm: "Device warm — inference may be slower",
  thermalHot:  "Device hot — consider taking a break",
}
```

```tsx
// SettingsScreen.tsx — lines 2140+
{thermal.status === "warm" ? (
  <Text ...>{t("chat.thermalWarm")}{tempSuffix}</Text>
) : thermal.status === "hot" ? (
  <Text ...>{t("chat.thermalHot")}{tempSuffix}</Text>
) : null}
```

### 4c. What this does NOT do

- Does not gate `send`, `load`, `select`, or `download`.
- Does not read `deviceTuning.thermal.maxDecodeSeconds`.
- Does not wire iOS native thermal state.
- Does not feed governor.

---

## 5. Future `thermalHint` — Boundary Suggestion for Governor

### Problem

If a future governor needs thermal state to choose decode/GPU policy, it should not couple `AppShell` or `SettingsScreen` to a native governor API. The thermal signal should flow through the existing tuning layer.

### Suggested boundary

```
useThermalMonitor (React hook)
        │
        ▼
  ThermalMonitorState  ← current output (advisory banner)
        │
        ▼  (future)
  thermalHint: "ok" | "warm" | "hot"
        │
        ▼
  TuningInput.thermalHint   ← new optional field
        │
        ▼
  resolveEngineTuningSync() reads thermalHint
        │
        ▼
  TuningResult.thermal { maxDecodeSeconds, throttlePrefill, ... }
        │
        ▼
  LlamaService / governor reads TuningResult.thermal
```

### Key design constraints

1. **`useThermalMonitor` stays a React hook** — it owns the poll loop and platform read. It does not import governor APIs.
2. **`thermalHint` is a plain string** passed via `TuningInput` — no native module import in the pure resolver.
3. **`resolveEngineTuningSync` remains pure** — it maps `thermalHint` + model size + memory to a `TuningResult.thermal` policy. The governor reads that policy; it never calls sysfs directly.
4. **AppShell does not change** — it continues to pass `thermalHint` from the hook into the tuning call. No new coupling.
5. **iOS gets a path** — `useThermalMonitor` can map `ProcessInfo.thermalState` to the same `ThermalStatus` enum; the rest of the pipeline is platform-agnostic.

### Where `thermalHint` would be read (boundary, not implementation)

| Layer | Reads | Writes |
|-------|-------|--------|
| `useThermalMonitor` | sysfs / iOS thermal / memory proxy | `ThermalMonitorState` → `thermalHint` |
| `SettingsScreen` | `thermal.status` for banner (unchanged) | — |
| `TuningInput` | — | `thermalHint?: ThermalStatus` (new field) |
| `resolveEngineTuningSync` | `input.thermalHint` | `TuningResult.thermal` |
| `LlamaService` | `tuning.thermal` | Decode / GPU policy decisions |

No layer crosses the hook ↔ engine boundary directly. The hint is a value; the policy is a resolution. Governor logic lives in the engine layer, not the UI layer.

---

*End of C3 thermal map.*
