# B1 — Memory UI, Settings Opt-In, User-Visible Gaps

Scope: Memory toggle, fact list, i18n, telemetry, first-run, product gaps, A1 coupling.

## Already solid

- **Default OFF confirmed.** `MemoryStore.getEnabled()` returns `false` when key is unset (`raw === null → false`). No first-run prompt, no silent enable. Clean opt-in.
- **Sensitive-fact filter.** `isSensitiveFact()` rejects passwords, cards, IBANs, codice fiscale, emails, phones, addresses, GPS, medical keywords — both EN and IT. Broad and false-positive-biased by design. `/src/memory/MemoryStore.ts:237–330`.
- **Fact list + delete visible even when OFF.** SettingsScreen renders the list and trash icon regardless of `memoryEnabled`. Users can always purge. `/src/screens/SettingsScreen.tsx:1319–1370`.
- **Clear-all exists.** `handleClearMemory` with destructive confirmation alert. `MemoryStore.clearFacts()`. `/src/screens/SettingsScreen.tsx:574–595`.
- **Telemetry is counters-only, never leaves device via envelope.** `formatMemoryLine()` → `console.log()` only. Fact TEXT is never included — `MemoryTelemetry` interface is pure numbers. `/src/memory/memoryTelemetry.ts:1–70`. The opt-in telemetry envelope (`telemetry.ts`) has no memory-fact field.
- **No first-run onboarding — but also no landmine.** There's no setup wizard at all (no `firstRun` / `INITIALIZED` key anywhere). User lands in chat; memory is off; no pressure to enable. Neutral.
- **Refresh on return.** `AppShell.onBack` calls `refreshMemoryFacts()` after closing Settings. `/src/app/AppShell.tsx:5343`.
- **i18n complete for EN/IT.** Full `memory.*` key set in both locales with Italian translations. `/src/i18n/en.ts:895–921`, `/src/i18n/it.ts:870–893`.

## Gaps (product + tech), ordered by user value

1. **No fact editing.** User can add and delete, but not correct a fact. Delete + re-add is the only path. Missing `MemoryStore.updateFact()` and UI tap-to-edit. User value: high — one typo forces a delete cycle.

2. **Facts are a flat list with no structure.** No categories, tags, source indicators, or timestamps in the UI. User can't tell which facts are auto-extracted vs manually added. When store is at 40/40, user has no visibility into what's old or why new facts are rejected (`factsRejectedFull` is a silent counter).

3. **Memory toggle is buried in the CisWire sub-panel.** The Switch is labeled `settings.ciswireMemory` ("CisWire Memory") — a power-user feature name, not a consumer feature name. No standalone "Memory" section in Settings; it's grouped under compaction mode selection. The separate `memory.title` / `memory.enabled` i18n keys exist but `memory.enabled` ("Remember information about me") is **never rendered** — the toggle uses `ciswireMemory` instead. `/src/screens/SettingsScreen.tsx:1185`.

4. **No export / backup.** Facts are AsyncStorage-only. No share sheet, no file export, no iCloud sync. Factory reset or app reinstall loses everything. No way to inspect the raw JSON.

5. **No indication in chat that memory is active.** No badge, toast, or subtle indicator during conversation that facts are being injected or extracted. User enables memory and gets zero feedback that it's working until they check Settings.

6. **Store cap (40) is invisible.** Max 40 facts, max 120 chars injected per fact, max 10 facts per prompt — none of these limits are surfaced in the UI. User has no idea why older facts silently vanish (dedup + cap are silent). `MAX_FACTS = 40`, `MAX_PROMPT_FACTS = 10`, `MAX_PROMPT_FACT_CHARS = 120`.

7. **"disabledNote" text is misleading when fact list is non-empty.** When memory is OFF, the note says "facts are not used or updated" — but the list + add-form are hidden (add-form gated by `memoryEnabled`). User who disabled memory sees their old facts but can't add new ones manually. The note says "you can still view and delete" which is correct, but the add-form disappearing is the actual UX break.

8. **Extraction prompt is baked into i18n strings, not separately configurable.** The extract prompt is a single i18n string (`memory.extractPrompt`). User can't tune what gets extracted. LLM-powered extraction runs silently after each turn — no user control over extraction aggressiveness.

9. **No per-conversation memory scoping.** Memory is global across all conversations. No way to say "remember this for this thread only" or "forget everything from this conversation."

10. **Sensitive filter is aggressive and non-tunable.** Italian words like "cura" (care) and "disturbo" (trouble) are explicitly excluded from medical keyword filter, but "depressione", "ansia", "diabete" are all rejected. A user with diabetes who wants to remember "ho il diabete tipo 2" gets rejected with a generic "sensitive data" error. No explanation of *what* was flagged.

## Out of scope for B1 (point to B3/B5 if relevant)

- **Dedicated Memory screen (B3?).** Currently memory UI lives only inside SettingsScreen's CisWire panel. A standalone `MemoryScreen` overlay accessible from the drawer (like Documents/Notes) would be B3 territory.
- **Fact categories / smart grouping (B5?).** The flat list is a data model change (adding `category?: string` to `MemoryFact`).
- **Export / backup / sync (B3?).** Would require a new overlay or share-sheet integration.
- **Extraction tuning UI (B3?).** User-facing controls for extraction aggressiveness, forget-list management.
- **Chat-inline memory indicator (B3?).** A subtle badge or "🧠" in the message bar when memory is active.
- **Onboarding for memory enablement (B3?).** A first-use prompt or educational screen when user first opens memory.

## Quotes

**Default OFF — `MemoryStore.getEnabled()`**
`/src/memory/MemoryStore.ts:539–546`
```ts
const raw = await AsyncStorage.getItem(ENABLED_KEY);
enabledCache = raw === null ? false : raw === "1" || raw === "true";
```

**Toggle renders as "CisWire Memory", not "memory.enabled"**
`/src/screens/SettingsScreen.tsx:1185–1192`
```tsx
<Text style={[typography.bodySm, { color: colors.ink, flex: 1 }]}>
  {t("settings.ciswireMemory")}
</Text>
<Switch value={memoryEnabled} onValueChange={handleToggleMemory} ... />
```

**Fact list + delete visible even when OFF**
`/src/screens/SettingsScreen.tsx:1319–1322`
```tsx
{!memoryEnabled ? (
  <Text style={[typography.bodyXs, { color: colors.muted }]}>
    {t("memory.disabledNote")}
  </Text>
) : null}
{/* List + clear stay visible even when memory is off so deletion is always possible. */}
```

**Clear-all with confirmation**
`/src/screens/SettingsScreen.tsx:574–595` → `MemoryStore.clearFacts()`
```ts
Alert.alert(t("memory.clear"), t("memory.clearConfirm"), [
  { text: t("common.cancel"), style: "cancel" },
  { text: t("memory.clear"), style: "destructive", onPress: () => { ... clearFacts() } },
]);
```

**Telemetry: counters only, console.log only**
`/src/memory/memoryTelemetry.ts:65–69`
```ts
export function formatMemoryLine(t: MemoryTelemetry, prefix = "KALSA_MEMORY"): string {
  return `${prefix} ${JSON.stringify({ memoryEnabled: t.memoryEnabled, factsExtracted: t.factsExtracted, ... })}`;
}
```
`/src/app/AppShell.tsx:4937`
```ts
console.log(formatMemoryTelemetry(memTelemetry));
```

**Fact text never enters telemetry envelope**
`/src/telemetry/telemetry.ts` — `MemoryTelemetry` interface has zero string fields. The `formatMemoryLine` output goes to `console.log()` only. The opt-in telemetry `TelemetryReport` / `TelemetryEnvelope` in `pure.ts` has no memory-fact field.

**Sensitive filter — EN+IT keywords**
`/src/memory/MemoryStore.ts:248–256`
```ts
if (/\b(password|passwd|pwd|passphrase|secret|segreto|token|api[_\s-]?key|apikey|bearer|authorization|auth[_\s-]?code|private[_\s-]?key|chiave\s+privata|otp)\b/i.test(lower)) {
  return true;
}
```

**Store cap: 40 facts, silent**
`/src/memory/MemoryStore.ts:41`
```ts
const MAX_FACTS = 40;
```

**Injection cap: 10 facts, 120 chars each, silent**
`/src/engine/memoryPrompt.ts:9–10`
```ts
const MAX_PROMPT_FACTS = 10;
const MAX_PROMPT_FACT_CHARS = 120;
```

**DNA bounding: 1200 token sub-budget, newest-first eviction**
`/src/memory/dnaBounding.ts:22`
```ts
export const MEMORY_SUB_BUDGET_TOKENS = 1200;
```

**No drawer entry for memory**
`/src/app/AppShell.tsx:2281–2335` — drawer items: settings, account, documents, notes. No `memory` item.

**No overlay kind for memory**
`/src/app/AppShell.tsx:298–306`
```ts
type ActiveOverlay =
  | { kind: "settings" }
  | { kind: "help" }
  | { kind: "account" }
  ...
```
No `{ kind: "memory" }`.

**Refresh on settings close**
`/src/app/AppShell.tsx:5343`
```ts
onBack={() => {
  setActiveOverlay(null);
  // Settings may have edited memory — refresh facts for the next turn.
  void refreshMemoryFacts();
}}
```
