# B1B — Memory UX clarity map (product)

Scope: toggle label, cap surfacing, char-limit alignment. No edit-fact, no drawer entry, no export.

## 1 · Toggle label — consumer copy

**Current state:** `settings.ciswireMemory` renders `"CisWire Memory"` / `"Memoria CisWire"`.
The consumer key `memory.enabled` — `"Remember information about me"` / `"Ricorda informazioni su di me"` — exists in i18n but is **never rendered anywhere**.

| Location | What renders |
|---|---|
| `src/screens/SettingsScreen.tsx:1181` | `{t("settings.ciswireMemory")}` — the Switch label |
| `src/screens/SettingsScreen.tsx:1188` | `accessibilityLabel={t("settings.ciswireMemory")}` |
| `src/i18n/en.ts:897` | `enabled: "Remember information about me"` — unused |
| `src/i18n/it.ts:872` | `enabled: "Ricorda informazioni su di me"` — unused |

The toggle lives inside the **CisWire GlassPanel2** (line 1120–1210), not the Memory GlassPanel2 (line 1306–1447). The Memory panel has its own `memory.title` header but no toggle — it only shows the fact list, add-form, and clear button.

**Fix:** Replace `t("settings.ciswireMemory")` with `t("memory.enabled")` on lines 1181 and 1188. Optionally keep `settings.ciswireMemory` as a tooltip or subtitle in the CisWire panel, or remove it from i18n entirely.

## 2 · Cap surfacing — what the user cannot see

Four hardcoded limits exist, all invisible in the UI:

| Constant | Value | Where | User sees |
|---|---|---|---|
| `MAX_FACTS` | 40 | `src/memory/MemoryStore.ts:32` | Nothing. Silent reject at `MemoryStore.ts:438` (`factsRejectedFull++`) |
| `MAX_PROMPT_FACTS` | 10 | `src/engine/memoryPrompt.ts:9` | Nothing. Newest-10 injected silently |
| `MAX_PROMPT_FACT_CHARS` | 120 | `src/engine/memoryPrompt.ts:11` | Nothing. Fact silently truncated at injection |
| `MAX_TEXT_LEN` | 200 | `src/memory/MemoryStore.ts:33` | TextInput `maxLength={200}` at `SettingsScreen.tsx:1386` — only hard limit the user can see |

Additional injection-level truncation:
- `src/engine/LlamaService.ts:3616` — `parseMemoryExtract` slices each extracted fact to 120 chars
- `src/memory/dnaBounding.ts:23` — `PROMPT_FACT_CHARS = 120` slices at bounding time

**What to surface in the Memory panel (below the title, above the fact list):**

```
{facts.length} / 40 facts saved — up to 10 used per reply (120 chars each)
```

or localized equivalent. Suggested new i18n keys:

```
memory.capHint: "{{count}} / 40 facts saved — up to 10 used per reply (120 chars each)"
memory.capHintIt: "{{count}} / 40 fatti salvati — fino a 10 usati per risposta (120 caratteri ciascuno)"
```

## 3 · Char limit alignment: 120 vs 200

Three different limits coexist:

| Layer | Limit | File:line | Purpose |
|---|---|---|---|
| **Store** (normalizeText) | 200 | `MemoryStore.ts:33,191` | Max chars persisted per fact. Also the TextInput `maxLength` |
| **Injection** (sanitizeFactForPrompt) | 120 | `memoryPrompt.ts:11,22` | Max chars sent to the model in the system prompt |
| **Extraction** (parseMemoryExtract) | 120 | `LlamaService.ts:3616` | Max chars the LLM can emit per extracted fact |
| **Bounding** (PROMPT_FACT_CHARS) | 120 | `dnaBounding.ts:23,50` | Max chars at bounding time for the user-prefix path |
| **i18n extractPrompt** | ≤120 | `en.ts:920`, `it.ts:890` | Instructions to the LLM: "each ≤ 120 chars" |

**The split is intentional but undocumented:** Store allows 200 chars so users can type/see longer facts; injection truncates to 120 to fit the 1200-token DNA budget (`40 × (120 + 16) ≈ 5440 chars ≈ 1360 tokens`, bounded at 1200). The comment at `dnaBounding.ts:13–15` explains this.

**Policy recommendation: keep both, document clearly.**

- **200 = storage ceiling.** User types a fact, sees the full text in the list. Satisfying, complete.
- **120 = injection ceiling.** Model only sees 120 chars per fact. Keeps the token budget predictable. Truncation is silent — the user's fact is stored at full length but the model gets a prefix.
- **Risk:** User types 150 chars, sees it in the list, expects the model to "know" the full fact. Model only sees the first 120. No indication of this in the UI.

**Minimal fix:** In the Memory panel, show a one-line note when any fact exceeds 120 chars:

```
memory.truncNote: "Facts over 120 chars are shortened in replies."
memory.truncNoteIt: "I fatti superiori a 120 caratteri vengono accorciati nelle risposte."
```

Or show `({text.length}/120 →)` inline next to the char count if you want to be precise.

## 4 · SettingsScreen memory panel structure (file:line)

```
SettingsScreen.tsx
├── GlassPanel2 "CisWire" (line 1120–1210)
│   ├── title: t("settings.ciswire") — line 1123
│   ├── hint: t("settings.ciswireHint") — line 1126
│   ├── Compaction mode selector — line 1129–1175
│   ├── Switch: t("settings.ciswireMemory") ← THE TOGGLE (line 1181)
│   └── Switch: t("settings.ciswireToolHelp") — line 1197
│
├── GlassPanel2 "Session pool" (line 1212–1257)
│
├── GlassPanel2 (line 1260–1304) — model settings
│
├── GlassPanel2 "Memory" (line 1306–1447)
│   ├── title: t("memory.title") — line 1309
│   ├── note: t("memory.note") — line 1312
│   ├── disabledNote (when OFF) — line 1315
│   ├── "Saved facts" label — line 1323
│   ├── fact list + trash icons — line 1335–1370
│   ├── TextInput + Add button (when ON) — line 1371–1427
│   └── Clear memory button — line 1429–1447
```

**Gap:** The toggle is in the CisWire panel; the fact list is in the Memory panel. They're separated by ~90 lines and two other GlassPanel2s. User must scroll up to toggle, scroll down to manage facts.

**B-scope fix (no new screens):** Move the Switch from CisWire panel into the Memory panel, directly under the `memory.title` header. Replace label with `t("memory.enabled")`.

## 5 · i18n key inventory

### Existing keys (used)

| Key | EN | IT | Used at |
|---|---|---|---|
| `settings.ciswireMemory` | "CisWire Memory" | "Memoria CisWire" | SettingsScreen:1181,1188 |
| `memory.title` | "Memory" | "Memoria" | SettingsScreen:1309 |
| `memory.enabled` | "Remember information about me" | "Ricorda informazioni su di me" | **UNUSED** |
| `memory.disabled` | "Memory is off" | "Memoria disattivata" | **UNUSED** (disabledNote is used instead) |
| `memory.disabledNote` | "Memory is off: facts are not used or updated…" | "La memoria è disattivata…" | SettingsScreen:1317 |
| `memory.facts` | "Saved facts" | "Fatti salvati" | SettingsScreen:1323 |
| `memory.addFact` | "Add fact" | "Aggiungi fatto" | SettingsScreen:1419 |
| `memory.addPlaceholder` | "e.g. My name is Alex" | "es. Mi chiamo Alex" | SettingsScreen:1380 |
| `memory.empty` | "No facts saved yet." | "Nessun fatto salvato." | SettingsScreen:1332 |
| `memory.clear` | "Clear memory" | "Svuota memoria" | SettingsScreen:584,587 |
| `memory.clearConfirm` | "Delete all saved facts…" | "Eliminare tutti i fatti salvati…" | SettingsScreen:584 |
| `memory.clearDone` | "Memory cleared" | "Memoria svuotata" | SettingsScreen:595 |
| `memory.addDone` | "Fact saved" | "Fatto salvato" | SettingsScreen:550 |
| `memory.deleteFact` | "Delete fact" | "Elimina fatto" | SettingsScreen:563,1362 |
| `memory.saveError` | "Could not save memory. Try again." | "Impossibile salvare la memoria. Riprova." | SettingsScreen:532,553,573,598 |
| `memory.note` | "Facts stay on this device…" | "I fatti restano su questo dispositivo…" | SettingsScreen:1312 |
| `memory.promptSection` | (system prompt template) | (same) | memoryPrompt.ts:42, memoryFactsTail.ts:44 |
| `memory.extractPrompt` | (extraction instruction to LLM) | (same) | LlamaService.ts (via getStrings) |

### Keys to add for B

| Key | EN (draft) | IT (draft) |
|---|---|---|
| `memory.capHint` | `"{{count}} / 40 facts saved — up to 10 used per reply"` | `"{{count}} / 40 fatti salvati — fino a 10 usati per risposta"` |
| `memory.truncNote` | `"Facts over 120 chars are shortened in replies."` | `"I fatti superiori a 120 caratteri vengono accorciati nelle risposte."` |

### Keys to deprecate (or keep as secondary)

| Key | Why |
|---|---|
| `settings.ciswireMemory` | Replaced by `memory.enabled` for the toggle label. Keep if CisWire panel still needs a label. |
| `memory.disabled` | Never rendered; `memory.disabledNote` is used instead. Dead key. |

## 6 · Minimal patch file list

| File | Change |
|---|---|
| `src/screens/SettingsScreen.tsx` | Move Switch from CisWire panel (line 1181) to Memory panel (under line 1309). Replace label `t("settings.ciswireMemory")` → `t("memory.enabled")`. Add cap hint Text below `memory.title`. Add truncNote when any fact > 120 chars. |
| `src/i18n/en.ts` | Add `memory.capHint`, `memory.truncNote`. Optionally deprecate `settings.ciswireMemory`. |
| `src/i18n/it.ts` | Add `memory.capHint`, `memory.truncNote`. Optionally deprecate `settings.ciswireMemory`. |

No changes to MemoryStore.ts, memoryPrompt.ts, dnaBounding.ts, LlamaService.ts, or any engine file.

## 7 · Quotes

**Toggle uses ciswireMemory, not memory.enabled:**
`src/screens/SettingsScreen.tsx:1181–1188`
```tsx
<Text style={[typography.bodySm, { color: colors.ink, flex: 1 }]}>
  {t("settings.ciswireMemory")}
</Text>
<Switch
  value={memoryEnabled}
  onValueChange={handleToggleMemory}
  trackColor={{ false: colors.line, true: `${colors.accent}88` }}
  thumbColor={memoryEnabled ? colors.accent : colors.muted}
  accessibilityLabel={t("settings.ciswireMemory")}
/>
```

**memory.enabled exists but is unused:**
`src/i18n/en.ts:897`
```ts
enabled: "Remember information about me",
```

**TextInput capped at 200 (store limit):**
`src/screens/SettingsScreen.tsx:1386`
```tsx
maxLength={200}
```

**Store normalizes to 200:**
`src/memory/MemoryStore.ts:33,191`
```ts
const MAX_TEXT_LEN = 200;
// ...
return text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LEN);
```

**Injection truncates to 120:**
`src/engine/memoryPrompt.ts:11,22`
```ts
const MAX_PROMPT_FACT_CHARS = 120;
// ...
.slice(0, MAX_PROMPT_FACT_CHARS);
```

**Extraction truncates to 120:**
`src/engine/LlamaService.ts:3616`
```ts
.map((item) => item.replace(/\s+/g, " ").trim().slice(0, 120))
```

**Bounding duplicates the 120 cap:**
`src/memory/dnaBounding.ts:23,50`
```ts
const PROMPT_FACT_CHARS = 120;
// ...
.slice(0, PROMPT_FACT_CHARS);
```

**Bounding budget comment explains the split:**
`src/memory/dnaBounding.ts:13–15`
```ts
 * Injection caps each fact at 120 chars; worst case
 * 40 × (120 + 16 label) = 5440 chars ≈ 1360 est tokens, so 1200 defers overflow.
 * (Store allows 200 chars/fact; 40 × 200 / 4 = 2000 — that is not the injection cost.)
```

**MAX_FACTS = 40, silent reject:**
`src/memory/MemoryStore.ts:32,438`
```ts
const MAX_FACTS = 40;
// ...
if (facts.length >= MAX_FACTS) {
  telemetryAccum.factsRejectedFull++;
  continue;
}
```

**MAX_PROMPT_FACTS = 10, silent newest-10:**
`src/engine/memoryPrompt.ts:9,39`
```ts
const MAX_PROMPT_FACTS = 10;
// ...
.slice(-MAX_PROMPT_FACTS);
```

**extractPrompt tells LLM "≤ 120 chars" (i18n):**
`src/i18n/en.ts:920`
```
"where add = new facts (max 3, each ≤ 120 chars, in the user's language)..."
```

**Fact list visible even when OFF, add-form hidden:**
`src/screens/SettingsScreen.tsx:1315,1371`
```tsx
{!memoryEnabled ? (
  <Text ...>{t("memory.disabledNote")}</Text>
) : null}
// ...fact list always renders...
{memoryEnabled ? (
  <View ...>{/* TextInput + Add button */}</View>
) : null}
```
