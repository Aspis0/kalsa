# C7 — Battery Advisory UX Map

**Goal**: Find the best advisory surface for "~X h left while chatting" without clutter.

---

## Existing patterns (quoted)

### 1. Thermal banner in Settings (Models section)
`src/screens/SettingsScreen.tsx` ~L2140:
```tsx
{thermal.status === "warm" || thermal.status === "hot" || thermal.status === "critical" ? (
  <Text
    style={[
      typography.bodyXs,
      { color: colors.bad ?? colors.muted, marginBottom: spacing.xs },
    ]}
  >
    {t(
      thermal.status === "critical"
        ? "chat.thermalCritical"
        : thermal.status === "hot"
          ? "chat.thermalHot"
          : "chat.thermalWarm",
    )}
    {thermal.currentTempC != null
      ? ` · ${Math.round(thermal.currentTempC)}°C`
      : ""}
  </Text>
) : null}
```
**Pattern**: Inline `<Text>`, `bodyXs`, `colors.bad ?? colors.muted`, conditional on status, appended detail (`· 47°C`). Sits inside the Models `GlassPanel2`, between device-RAM info and model list.

### 2. Model bar in chat header
`src/app/AppShell.tsx` ~L5388:
```tsx
<Text style={[typography.bodyXs, { color: modelBarStatus.color }]}>
  {currentModel.name} · {currentModel.quant} · {modelBarStatus.label}
</Text>
```
**Pattern**: Single `<Text>` line under "Kalsa" title. Shows `Gemma 3 · Q4_K_M · Ready`. Pressable for download/retry. Color from `modelBarStatus.color` (muted / accent / good / bad).

### 3. Notice toast (ephemeral)
`src/app/AppShell.tsx` ~L5533:
```tsx
{notice ? (
  <View
    style={{
      position: "absolute",
      left: spacing.lg,
      right: spacing.lg,
      bottom: 96,
      backgroundColor: colors.panelSolid,
      borderRadius: 12,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderWidth: 1,
      borderColor: colors.line,
    }}
  >
    <Text style={[typography.bodyXs, { color: colors.ink }]}>{notice}</Text>
  </View>
) : null}
```
**Pattern**: Auto-dismissing floating pill, `panelSolid` bg, 4 s timeout. Used for "Download ready", share confirmations. Could host battery estimate transiently.

### 4. OrphanModelMigrationBanner
`src/components/OrphanModelMigrationBanner.tsx`:
```tsx
<GlassPanel2 opaque rounded="md" style={{ padding: spacing.md, gap: spacing.sm }}>
  <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
    {t("models.orphanNoticeTitle", { count: migration.orphans.length })}
  </Text>
  <Text style={[typography.bodyXs, { color: colors.muted }]}>
    {t("models.orphanNoticeBody", { count: migration.orphans.length })}{sizeLabel}
  </Text>
  …
</GlassPanel2>
```
**Pattern**: Dedicated component in Settings, `GlassPanel2`, title + body + action buttons. One-shot / conditional.

---

## Battery awareness already in codebase

| Location | What |
|---|---|
| `src/agent/deviceTools.ts` | `readDeviceInfo()` reads `expo-battery` → `batteryPercent` in `DeviceInfoPayload` |
| `src/agent/deviceTools.ts` | `DeviceInfoPayload.batteryPercent?: number` — optional dep, fail-closed |
| `src/engine/deviceProfile.ts` | `DeviceProfile` — brand, RAM tier, CPU cores, throughput. No battery fields. |
| `src/engine/deviceTuning.ts` | Engine knob resolution — thread count, n_ctx, thermal guard. No battery fields. |

**No existing battery-advisory UI surface.** Battery % is only read for the agent tool, never surfaced to the user.

---

## Recommendation: Chat header model bar (subtle, always-visible)

### Primary surface: model bar line in chat header

The model bar already shows `Name · Quant · Status`. Add a battery pill **only when a model is loaded and battery is below a threshold** (e.g. ≤ 50%), keeping it invisible most of the time.

**Why this beats alternatives:**

| Option | Verdict | Reason |
|---|---|---|
| **Settings (near thermal banner)** | No | Low discoverability — user must navigate to Settings. Thermal banner works there because heat is a device-wide concern; battery drain is a chatting concern. |
| **Chat chrome (subtle)** | **Yes** | Already has model status line. Battery context matters most while actively chatting. Subtle enough when hidden; useful when shown. |
| **Only while generating** | No | Generating is bursty — estimate appears/disappears every few seconds. Worse UX than a stable indicator. |
| **Notice toast** | No | Auto-dismisses in 4 s. Battery is not a transient event — it's a slow drain. Toast would need re-triggering or feel broken. |

### Design spec

**Visibility rule**: Show battery indicator only when all of:
1. A model is loaded (`modelState === "ready"`)
2. Battery ≤ 50% (or user has opted in)
3. `expo-battery` is available (fail-closed)

When visible, render as a **separate `<Text>` line** below the model bar (not appended to it), using the same `bodyXs` + `colors.muted` pattern:

```
Kalsa
Gemma 3 · Q4_K_M · Ready
⚡ ~2 h 15 min left at this pace
```

Or when battery is OK:

```
Kalsa
Gemma 3 · Q4_K_M · Ready
```
*(battery line absent — no clutter)*

**Estimation approach**:
- Read `batteryPercent` at model-load time and at a 60 s interval while `streaming === true`
- Compute drain rate from the delta: `drainPerMin = (startPercent - currentPercent) / elapsedMinutes`
- Project: `hoursLeft = currentPercent / (drainPerMin * 60)`
- Clamp: show `> 4 h` as "> 4 h" (unreliable at low drain), show `< 15 min` in `colors.bad`
- Reset baseline on each new session / model reload

**Style tokens** (matching thermal banner pattern):
```tsx
<Text style={[typography.bodyXs, { color: colors.muted, marginBottom: spacing.xs }]}>
  {t("chat.batteryEstimate", { time: "~2 h 15 min" })}
</Text>
```

---

## i18n keys

### EN
```ts
// chat section
batteryEstimate: "~{time} left at this pace",
batteryEstimateShort: "~{time} left",
batteryLowWarning: "Battery low — generation may stop soon",
```

### IT
```ts
// chat section
batteryEstimate: "~{time} rimanenti a questo ritmo",
batteryEstimateShort: "~{time} rimanenti",
batteryLowWarning: "Batteria bassa — la generazione potrebbe interrompersi presto",
```

**Shape notes**:
- `{time}` is a pre-formatted string from a helper (e.g. `"2 h 15 min"`, `"45 min"`, `"> 4 h"`). Not a pluralizable count — avoids CLDR complexity for a rough estimate.
- IT mirrors EN structure. "a questo ritmo" = "at this pace" (natural Italian phrasing).
- `batteryLowWarning` is for ≤ 15% — used as a stronger advisory, shown in `colors.bad`.

---

## Non-goals (explicit)

1. **No OS battery widget replacement** — this is advisory only, shown inside Kalsa's chat chrome. The OS battery indicator remains the authority.
2. **No hard stop on low battery** — advisory text only. The user can continue chatting if they want. (If a hard-stop already existed for thermal critical, it would be a different mechanism — but it doesn't exist for battery.)
3. **No background drain estimation** — only estimates drain during active chatting (model loaded + generating or recently generated). Idle drain is irrelevant to the "while chatting" use case.
4. **No per-turn cost estimation** — that's a different feature (token economics). This is purely time-until-empty.

---

## Implementation touchpoints

| File | Change |
|---|---|
| `src/hooks/useBatteryEstimate.ts` | **New hook** — reads `expo-battery` at interval, computes drain rate, returns `{ hoursLeft, batteryPercent, isLow }` |
| `src/app/AppShell.tsx` | Wire `useBatteryEstimate()` conditionally (only when `modelState === "ready"`). Pass to model bar render. |
| `src/app/AppShell.tsx` ~L5388 | Add conditional `<Text>` below model bar line when estimate is available |
| `src/i18n/en.ts` | Add `chat.batteryEstimate`, `chat.batteryEstimateShort`, `chat.batteryLowWarning` |
| `src/i18n/it.ts` | Mirror EN keys |
| `src/screens/SettingsScreen.tsx` | Optional: show battery % in Models section (near thermal banner) as a static info line |
