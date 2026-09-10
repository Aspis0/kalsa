# C7 — Battery Telemetry Map

> **Scout LOT-C §C7** · 2026-09-05 · branch `feat/moe-stream`
> Read-only recon. No production code edited.

---

## 1. Every battery read today

### `src/agent/deviceTools.ts:53–56` — the **only** battery read

```ts
const Battery = require("expo-battery") as {
  getBatteryLevelAsync?: () => Promise<number>;
};
const level = await Battery.getBatteryLevelAsync?.();
```

Called once, on-demand, by the `device_info` agent tool (`readDeviceInfo()`).

| API used | Available on expo-battery ~57 | Actually called? |
|---|---|---|
| `getBatteryLevelAsync()` | ✅ 0–1 float | ✅ in `deviceTools.ts:56` |
| `getBatteryStateAsync()` (charging/discharging) | ✅ | ❌ never |
| `getPowerStateAsync()` (lowPowerMode) | ✅ | ❌ never |
| `addBatteryLevelListener()` | ✅ push events | ❌ never |

**expo-battery is in `package.json:31`** (`"expo-battery": "~57.0.1"`) but imported only in `deviceTools.ts`.

---

## 2. turnTelemetry / RoundTelemetry — per-turn timings

### `src/engine/turnTelemetry.ts` (full module, 216 lines)

**`RoundTelemetry` shape** (line 111–136):

```ts
{
  round: number;
  tokensCached: number;      // result.tokens_cached
  tokensEvaluated: number;   // prompt tokens processed
  tokensPredicted: number;   // generation length
  draftTokens: number;       // MTP draft tokens
  draftAccepted: number;     // MTP acceptance count
  promptMs: number;          // timings.prompt_ms ?? -1
  predictedMs: number;       // timings.predicted_ms ?? -1
  predictedPerSecond: number; // timings.predicted_per_second ?? -1
  contextFull: boolean;
  interrupted: boolean;
  tool?: string;             // last successful tool name
  strategy?: ToolRetrievalStrategy;
  ciswireFlags?: number;
}
```

**Emission chain** — `src/engine/LlamaService.ts:844–878`:

1. `emitTurnTelemetry(turnId, round, result, attribution, model, onDecodeSample, ciswireFlags)` (line 844)
2. Calls `roundTelemetryFromResult(result, round)` (line 854, pure mapping from llama.rn `NativeCompletionResult`)
3. Calls `formatTelemetryLine(turnId, r)` → `console.log("KALSA_TELEMETRY " + JSON.stringify(...))` (line 868)
4. Also calls `onDecodeSample(model, { predictedPerSecond, tokensPredicted, interrupted })` for `deviceThroughput` calibration

**`deviceThroughput.ts`** (line 27–36) has `DecodeMeasurement` and `recordDeviceBandwidthSample()` — persists best tok/s per quant family for device speed advisory.

**Key**: `promptMs`, `predictedMs`, `predictedPerSecond` exist per-round but are **only** written to logcat (`KALSA_TELEMETRY` lines). They are **not** surfaced to the UI or stored in app state.

---

## 3. Settings / chat UI surfaces — where "~Xh remaining" could live

### Pattern A: Settings advisory banner — `src/screens/SettingsScreen.tsx`

**Thermal banner** (line 2140–2158) is the exact template:

```tsx
{thermal.status === "warm" || thermal.status === "hot" || thermal.status === "critical" ? (
  <Text style={[typography.bodyXs, { color: colors.bad ?? colors.muted, marginBottom: spacing.xs }]}>
    {t(thermal.status === "critical" ? "chat.thermalCritical" : ...)}
    {thermal.currentTempC != null ? ` · ${Math.round(thermal.currentTempC)}°C` : ""}
  </Text>
) : null}
```

This lives inside the **Models GlassPanel2** (`line 2092+`), after the `OrphanModelMigrationBanner` and `memoryUnknownBanner`.

**Hook**: `useThermalMonitor()` at line 963 — polls sysfs every 30s. Battery could follow the same shape: `useBatteryMonitor()` → `SettingsScreen` consumes state → conditional `<Text>` banner.

### Pattern B: Per-message status — `src/screens/AiChatPage.tsx`

Messages carry `statusLabel` (line 229) set by `callbacks.onStatus()` during streaming (line 2415). Could display a low-battery warning inline, but the Settings banner is the cleaner advisory-only surface.

### Pattern C: Memory banner — `SettingsScreen.tsx:2104`

```tsx
{memoryUnknownBanner ? (
  <Text style={[typography.bodyXs, { color: colors.bad ?? colors.muted, ...}]}>
    {t("model.memoryUnknown")}
  </Text>
) : null}
```

**i18n precedent**: `src/i18n/en.ts:509–511` has `thermalWarm`, `thermalHot`, `thermalCritical`. Battery advisory keys would follow this pattern.

---

## 4. Gaps for a drain estimator

| Gap | Current state | What's needed |
|---|---|---|
| **Continuous battery sampling** | None — single on-demand read | `useBatteryMonitor` hook polling `getBatteryLevelAsync()` every 60–120s |
| **Charging detection** | `expo-battery` has `getBatteryStateAsync()` returning `.isCharging` | Wire into the poll; skip drain calculation when charging |
| **Session accumulator** | None | Ring buffer of `{timestamp, batteryLevel, isCharging}` samples in memory |
| **Drain rate calculation** | None | Linear regression or slope over last N non-charging samples; units: %/hour |
| **"Remaining" estimate** | None | `batteryLevel / drainRate` when drainRate > threshold; else "unknown" |
| **Sufficient samples gate** | None | Need ≥2 non-charging samples spanning ≥5 minutes for a meaningful estimate |
| **lowPowerMode awareness** | Never read | `getPowerStateAsync().lowPowerMode` — affects CPU scaling; useful as context tag |

---

## 5. Minimal MVP patch set

**No hard gate. Fail-open / "unknown" when charging or insufficient samples.**

### 5a. `src/hooks/useBatteryMonitor.ts` (new, ~80 lines)

Follows `useThermalMonitor` pattern exactly:

```ts
export type BatteryMonitorState = {
  level: number | null;           // 0–100
  isCharging: boolean | null;     // null = unknown
  lowPowerMode: boolean | null;   // null = unknown
  drainRatePercentPerHour: number | null; // null = insufficient data
  remainingMinutesEstimate: number | null; // null = unknown
  sampledAt: number | null;
};
```

- Polls `expo-battery` every 60s (configurable `intervalMs`)
- Maintains a session ring buffer (last 30 samples max = 30 min)
- Calculates slope from last ≥2 non-charging samples spanning ≥5 min
- Returns `drainRatePercentPerHour` and `remainingMinutesEstimate`
- Returns `null` (unknown) when: charging, <2 samples, <5 min span, or drain < 0.1%/hr (charger noise)

### 5b. `src/screens/SettingsScreen.tsx` — one advisory banner (~15 lines)

Inside Models `GlassPanel2`, after thermal banner (line ~2158):

```tsx
{battery.level != null && !battery.isCharging && battery.remainingMinutesEstimate != null ? (
  <Text style={[typography.bodyXs, { color: colors.muted, marginBottom: spacing.xs }]}>
    {t("chat.batteryRemaining", {
      time: battery.remainingMinutesEstimate < 60
        ? `${Math.round(battery.remainingMinutesEstimate)}m`
        : `${(battery.remainingMinutesEstimate / 60).toFixed(1)}h`,
    })}
  </Text>
) : null}
```

### 5c. i18n keys — `src/i18n/en.ts` + `src/i18n/it.ts` (2 lines each)

```ts
// en.ts
chat.batteryRemaining: "~{{time}} remaining"

// it.ts
chat.batteryRemaining: "~{{time}} rimanenti"
```

### 5d. What this does NOT do

- ❌ No hard gate on send/low battery — advisory only
- ❌ No new telemetry to the worker — stays on-device
- ❌ No continuous drain logging to logcat — only UI banner
- ❌ No `expo-battery` listener API (push) — poll is sufficient and lower energy
- ❌ No per-turn battery deltas (overkill for MVP)

---

## 6. Privacy: what stays on-device

| Data | Stays local? | Sent to telemetry worker? |
|---|---|---|
| Battery level (0–100) | ✅ | ❌ never |
| Timestamp of sample | ✅ | ❌ never |
| Charging state | ✅ | ❌ never |
| Drain rate estimate | ✅ | ❌ never |
| `lowPowerMode` flag | ✅ | ❌ never |
| `remainingMinutesEstimate` | ✅ | ❌ never |

The existing telemetry worker (`src/telemetry/telemetry.ts`) only sends error/crash codes (`ReasonCode`) via `reportTelemetry()`. Battery data would not be added to `TelemetryReport` or `TelemetryEnvelope`. The `useBatteryMonitor` hook exposes state only to the Settings UI — no `reportTelemetry()` call sites.

**expo-battery listener energy note**: Using polling (not push listener) at 60–120s is the lower-energy path. The listener fires on every OS battery tick which is more frequent and wakes the JS thread. Poll is sufficient for an advisory banner.
