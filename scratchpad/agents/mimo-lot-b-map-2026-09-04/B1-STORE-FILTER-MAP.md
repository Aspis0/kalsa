# B1 Map: Memory Write Path + Storage + Sensitive Filter

**Repo**: `kalsa` (React Native / Expo)
**Date**: 2026-09-04
**Baseline**: `idea-scout-2026-09-02/LOT-B-memory-search-docs.md` §B1
**Scope**: Read-only. Every claim has file:line.

---

## 1. Schema, Keys, Caps

| Item | Value | File:Line |
|------|-------|-----------|
| Type | `MemoryFact = { id: string, text: string, createdAt: number }` | `src/memory/MemoryStore.ts:16-19` |
| `MAX_FACTS` | 40 | `src/memory/MemoryStore.ts:23` |
| `MAX_TEXT_LEN` | 200 chars | `src/memory/MemoryStore.ts:24` |
| AsyncStorage: facts | `kalsa.memory.facts` (JSON array) | `src/memory/MemoryStore.ts:26` |
| AsyncStorage: enabled | `kalsa.memory.enabled` (opt-in, default OFF) | `src/memory/MemoryStore.ts:27` |
| In-memory cache | `factsCache: MemoryFact[] \| null`, `enabledCache: boolean \| null` | `src/memory/MemoryStore.ts:31-32` |
| Dedup key | `normalizeKey()` = lowercase + whitespace-collapse + trim | `src/memory/MemoryStore.ts:148-150` |
| Parse add cap | max 3 items, each ≤120 chars (in `parseMemoryExtract`) | `src/engine/LlamaService.ts:3612-3621` |
| Parse remove cap | max 10 items | `src/engine/LlamaService.ts:3623-3629` |

**Baseline drift**: Scout said `MAX_TEXT_LEN` is 200. **Stale — confirmed 200 still correct.** But extraction caps add items at 120 chars (hardcoded in `parseMemoryExtract`), not 200. The 200 cap only applies to `addFact()` direct-call path (UI/manual). Effective extraction ceiling is 120.

---

## 2. How Facts Are Added/Removed

### Mutex

All mutations go through `withMutex(fn)` — promise-chain serialization:
```
const run = mutationChain.then(fn, fn);
mutationChain = run.then(() => undefined, () => undefined);
```
`src/memory/MemoryStore.ts:187-192`. Both resolve and reject advance the chain. No deadlocks possible from rejected promises.

### Epoch

- Bumped by `bumpEpoch()` on: `clearFacts()`, `removeFact()`, `removeFactByText()`, `setEnabled(false)`.
- `src/memory/MemoryStore.ts:194-196`
- Extraction jobs capture `startEpoch = MemoryStore.getEpoch()` before arming, then re-check before apply.
- `src/app/AppShell.tsx:4328,4380`

### `applyExtractResults(add[], remove[], expectedEpoch)`

- `src/memory/MemoryStore.ts:458-521`
- Checks `epoch === expectedEpoch` **twice**: once at mutex entry, once right before `writeFacts()`.
- Checks `enabledCache` (or reads from storage if null).
- Removes: filter by normalized key match.
- Adds: sensitive check on **raw** (pre-truncation) input, dedup by normalized key, cap at `MAX_FACTS`.
- Sensitive adds: **silently skipped** (not thrown). Counter incremented.
- `src/memory/MemoryStore.ts:498-500`: `telemetryAccum.factsRejectedSensitive++`

### `addFact(text)` (direct path)

- `src/memory/MemoryStore.ts:237-252`
- Checks `isSensitiveFact(text)` on **full untruncated input** — throws `SensitiveFactError`.
- Dedup by normalized key. Caps at `MAX_FACTS` (implicit via `writeFacts → dedupeAndCap`).

### `removeFact(id)` / `removeFactByText(text)`

- `src/memory/MemoryStore.ts:254-275`
- Both bump epoch after successful write.

### Races?

- **No race in writes**: mutex serializes everything.
- **Epoch guard on extraction**: double-check before apply prevents stale writes after toggle-off/clear.
- **Save-gate pattern**: extract job waits for `afterSessionSave` or 10s timeout before running.
  - `src/app/AppShell.tsx:4330-4347`
- **Abort signal**: releases the gate so extraction doesn't hang on clearChat/stop.
  - `src/app/AppShell.tsx:4334-4337`
- **Potential issue**: The `extractJob` races with next-turn send via `memoryExtractRef.current`. AppShell awaits `memoryExtractRef` before starting next send:
  - `src/app/AppShell.tsx:3437-3446` — `if (memoryExtractRef.current) { await memoryExtractRef.current; }`
  - This is correct — no concurrent extractions on same engine.

### `dedupeAndCap(facts)`

- `src/memory/MemoryStore.ts:283-300`
- Sorts by `createdAt` ascending, keeps newest duplicate, dedup by normalized key, truncates to `MAX_FACTS` (keeps oldest of remaining).

---

## 3. `isSensitiveFact` — What It Blocks

`src/memory/MemoryStore.ts:238-350`

| Pattern | What it catches | False-positive risk |
|---------|----------------|---------------------|
| Password/secret keywords (EN+IT) | `password`, `token`, `api_key`, `secret`, etc. | Low — keyword-gated |
| PIN/CVV labels | `pin`, `cvv`, `security code` | Low |
| Credit card: labeled 13-19 digits | `card 4111...` pattern + keyword | Low (keyword required) |
| Credit card: bare Luhn-valid 13-19 digits | `4111111111111111` without label | **Medium** — ISBN-13 rarely passes Luhn but some counters could |
| IBAN | `XX00AAAAAAAAAAAA` (2-letter + 2-digit + 10-30 alphanum) | **Medium** — product codes, license keys could match |
| Codice fiscale (labeled) | `codice fiscale` / `c.f.` keyword | Low |
| Codice fiscale (shape) | `RSSMRA85M01H501Z` (6 alpha + 2 digit + alpha + 2 digit + alpha + 3 digit + alpha) | **Low** — 16-char alphanumeric with specific structure |
| Email | `x@y.z` pattern | Low |
| Phone (labeled) | digit pattern + keyword (`tel`, `telefono`, `phone`, etc.) | Low (keyword required) |
| Phone (international prefix) | `+393331234567` — 9-13 digits after +/00 | **Medium** — version strings like `+1.2.3.4` rarely match |
| Phone (grouped, no keyword) | `333 123456` — 9-11 digits with space/dash separators | **Medium** — code fragments, product SKUs |
| Home address (labeled) | `via/strada/street` + name + house number | **Medium** — "via mail" etc. excluded by lookahead |
| GPS coordinates | Two decimals with 4+ decimal places | Low — very specific shape |
| Document/ID (labeled) | `documento/passport` + 5+ digits | Low (keyword required) |
| Health keywords (EN+IT) | `diagnosis`, `cancer`, `diabetes`, `depression`, etc. | **High for: `depression` (geological), `disorder` excluded, `treatment` excluded** |

### What Slips Through (Gaps)

| Category | Example | Why it slips |
|----------|---------|-------------|
| **IBAN without standard prefix** | Non-SEPA IBANs, crypto addresses (`bc1q...`) | Regex requires 2-letter country prefix |
| **SWIFT/BIC codes** | `DEUTDEFF` | Not pattern-matched |
| **Tax IDs (non-IT)** | US SSN `123-45-6789`, VAT numbers | Not covered (only codice fiscale) |
| **Financial amounts** | `my salary is 80000` | No amount/keyword pattern |
| **Crypto wallets** | `0x742d...`, `bc1q...` | Not matched |
| **Server/API credentials** | `sk-live-...`, `ghp_...`, `Bearer eyJ...` | Only `api_key`/`bearer` keywords catch these; raw token strings don't |
| **Passwords without keyword** | `my password is X` caught; `X` alone is not | By design — keyword-gated |
| **Health data in non-EN/IT** | French, German medical terms | Only EN+IT keywords covered |

---

## 4. Who Calls Extract / Apply — Trigger Conditions

### Call Chain

1. **User sends message** → `AppShell.tsx` starts turn.
2. **After completion** → `onDone` callback arms extraction.
3. **Save gate**: `afterSessionSave()` (from `AiChatPage`) releases gate, OR 10s timeout fires.
   - `src/app/AppShell.tsx:4330-4347`
4. **Extract job runs**:
   - Checks: `enabled`, `epoch === startEpoch`, `signal.aborted`.
   - Calls `extractMemory(userText, assistantText, locale)`.
   - `src/app/AppShell.tsx:4350-4409`
5. **`extractMemory()`** (`src/engine/LlamaService.ts:3466-3590`):
   - Serializes via `withEngineJob()` (FIFO with chat completion).
   - Inputs: first 2000 chars of user + assistant text.
   - Runs LLM completion with `extractPrompt` (temperature 0.1, 256 n_predict, 20s timeout).
   - KV checkpoint-restore to avoid corrupting chat session.
6. **`parseMemoryExtract()`** (`src/engine/LlamaService.ts:3597-3635`):
   - Strips think tags, fences. Finds balanced JSON `{...}`.
   - Parses `{ add: string[], remove: string[] }`.
   - Caps: add ≤3 items × 120 chars, remove ≤10 items.
7. **`applyExtractResults(add, remove, startEpoch)`** (`src/memory/MemoryStore.ts:458-521`):
   - Mutex-held, epoch-gated, enabled-gated.
   - Sensitive adds skipped, not thrown.
8. **`refreshMemoryFacts()`** if applied → `setMemoryFacts(facts)`.

### Trigger Conditions

- Memory must be enabled (`kalsa.memory.enabled = true`).
- Turn must not be calendar-only (`calendarExtractSkipSeq`).
- Engine must be alive (context exists).
- KV preservation must succeed (or fallback to clear-cache path).

### Direct Path (UI)

- `MemoryStore.addFact(text)` — called from Settings or UI add-fact.
- Throws `SensitiveFactError` (not skipped).

---

## 5. Persistence Failures / Corruption Handling

| Scenario | Behavior | File:Line |
|----------|----------|-----------|
| AsyncStorage read fails | `readFactsRaw()` catches → returns `[]`, sets `factsCache = []` | `MemoryStore.ts:213-215` |
| AsyncStorage write fails | `writeFacts()` throws `MemoryWriteError`, cache unchanged | `MemoryStore.ts:219-224` |
| `applyExtractResults` write fails | Throws `MemoryWriteError` up to extract job catch block → swallowed | `AppShell.tsx:4391` (catch), `MemoryStore.ts:490` |
| Migration rewrite fails (`listFacts`) | `migrationDirty = true`, in-memory view updated to filtered facts, disk retried next `listFacts()` | `MemoryStore.ts:228-235` |
| JSON parse corruption | `readFactsRaw()` returns `[]` (validates `Array.isArray` + shape) | `MemoryStore.ts:205-207` |
| Non-array in storage | Returns `[]` | `MemoryStore.ts:204-207` |
| `clearFacts` write failure | Throws `MemoryWriteError`, cache set to `[]` **before** write (bug?) | `MemoryStore.ts:259-264` |
| `setEnabled` write failure | Throws `MemoryWriteError`, but `enabledCache` set to new value **before** write attempt | `MemoryStore.ts:284-290` |

### Note on `clearFacts` and `setEnabled`

Both set their cache **before** the `AsyncStorage.setItem` call, then throw on failure. This means on write failure the in-memory cache diverges from disk. However, these are rare edge cases (disk full) and the mutation chain continues — subsequent reads will see the optimistic cache value. Not a data-loss risk (facts are gone in memory regardless), but disk may retain stale data.

---

## 6. Tests for MemoryStore / isSensitiveFact

| Test File | What It Tests | Coverage |
|-----------|--------------|----------|
| `src/memory/dnaBounding.test.ts` | `boundMemoryFacts()` token budgeting | ✅ Thorough — 10 tests |
| `src/memory/memoryTelemetryOrdering.test.ts` | Telemetry accumulator ordering | ✅ |
| `src/conversations/ConversationsStore.test.ts` | `filterByTokens` (search, not memory) | ✅ |
| `src/memory/MemoryStore.test.ts` | **Does not exist** | ❌ |
| `src/memory/isSensitiveFact.test.ts` | **Does not exist** | ❌ |
| `src/engine/LlamaService.test.ts` (extract/parse) | **Does not exist** | ❌ |

**No tests for**:
- `isSensitiveFact()` — zero unit coverage for the sensitive filter.
- `applyExtractResults()` — no test for the batch apply logic.
- `addFact()` / `removeFact()` / `clearFacts()` — no mutation tests.
- `parseMemoryExtract()` — no parser tests.
- `dedupeAndCap()` — no dedup tests.
- Epoch guard behavior — no race/epoch test.

---

## Already Solid

- **Mutex serialization**: promise-chain with `.then(fn, fn)` ensures both resolve/reject advance. No deadlock possible.
- **Epoch double-check**: extraction jobs check epoch at entry AND before write, preventing stale writes after toggle-off/clear.
- **Save-gate pattern**: prevents extraction from running before session save, with 10s safety timeout.
- **Sensitive filter on raw input**: `applyExtractResults` checks `isSensitiveFact(rawAdd)` on pre-truncation text (not the 120-char slice), preventing keyword hiding past cutoff.
- **Fail-closed parser**: `parseMemoryExtract` returns empty arrays on any parse failure (no crash, no partial writes).
- **KV checkpoint-restore**: `extractMemory` snapshots and restores native session to avoid corrupting chat context.
- **Dedup**: normalized key dedup prevents duplicate facts from accumulation.
- **Migration**: `listFacts` auto-migrates old datasets (drops sensitive, dedup, cap, rewrite).
- **In-memory cache updated only after successful write** (for `writeFacts` path).

## Gaps / Bugs (Ordered)

1. **No unit tests for `isSensitiveFact()`** — the most critical privacy function has zero test coverage. Any regex change could silently regress. This is the single highest-risk gap.
2. **No unit tests for `applyExtractResults()`** — epoch guard, enabled check, batch logic all untested.
3. **No tests for `parseMemoryExtract()`** — JSON parsing, balanced-brace finder, think-tag stripping untested.
4. **`clearFacts()` cache-before-write divergence**: `factsCache = []` set before `AsyncStorage.setItem`. On write failure, cache says empty but disk has data. Subsequent reads return `[]` from cache, so user sees empty store, but disk retains facts. Low risk (disk full scenario).
5. **`setEnabled()` cache-before-write**: Same pattern — `enabledCache` set before `setItem`. On failure, memory says enabled but disk says disabled. Next cold start reverts. Low risk.
6. **No tests for `dedupeAndCap()`** — sort stability, cap behavior, dedup logic untested.
7. **`isSensitiveFact` gaps**: crypto wallets, SWIFT/BIC, non-IT tax IDs, financial amounts slip through. Acceptable for current scope but worth noting.
8. **`migrationDirty` flag is module-global**: concurrent `listFacts()` calls could see stale flag state, but mutex prevents this in practice.
9. **Extraction prompt instructs model to not extract secrets, but `isSensitiveFact` is the real guard**: the LLM instruction is defense-in-depth, not primary security. The filter is the actual boundary.
10. **`MAX_TEXT_LEN=200` vs extraction cap `120`**: inconsistent caps — extraction silently truncates to 120, direct `addFact` allows 200. Not a bug, but confusing.

## Must NOT Rewrite

- `withMutex()` — battle-tested serialization, don't touch.
- Epoch guard in `applyExtractResults` — the double-check pattern is correct and essential.
- Save-gate + timeout pattern in `AppShell.tsx:4330-4347` — prevents deadlock and stale extraction.
- `parseMemoryExtract` balanced-brace finder — handles edge cases (braces in strings, trailing prose).
- KV checkpoint-restore in `extractMemory` — prevents chat session corruption.
- Cache-after-write in `writeFacts` — the correct pattern (cache updated only after `setItem` succeeds).

## Quotes

### Schema + Caps
```
src/memory/MemoryStore.ts:16-19
export type MemoryFact = {
  id: string;
  text: string;
  createdAt: number;
};

src/memory/MemoryStore.ts:23-24
const MAX_FACTS = 40;
const MAX_TEXT_LEN = 200;
```

### Keys + Cache
```
src/memory/MemoryStore.ts:26-32
const FACTS_KEY = "kalsa.memory.facts";
const ENABLED_KEY = "kalsa.memory.enabled";
...
let factsCache: MemoryFact[] | null = null;
let enabledCache: boolean | null = null;
```

### Mutex
```
src/memory/MemoryStore.ts:187-192
function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(fn, fn);
  mutationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
```

### Epoch
```
src/memory/MemoryStore.ts:194-196
function bumpEpoch(): void {
  epoch += 1;
}
```

### applyExtractResults — epoch guard + sensitive skip
```
src/memory/MemoryStore.ts:458-465
export async function applyExtractResults(
  add: string[],
  remove: string[],
  expectedEpoch: number,
): Promise<boolean> {
  telemetryAccum.factsExtracted += add.length;
  return withMutex(async () => {
    if (epoch !== expectedEpoch) return false;
```

```
src/memory/MemoryStore.ts:496-501
      if (isSensitiveFact(rawAdd)) {
        telemetryAccum.factsRejectedSensitive++;
        continue;
      }
```

### isSensitiveFact — credential keywords
```
src/memory/MemoryStore.ts:239-249
  if (
    /\b(password|passwd|pwd|passphrase|secret|segreto|token|api[_\s-]?key|apikey|bearer|authorization|auth[_\s-]?code|private[_\s-]?key|chiave\s+privata|otp)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
```

### isSensitiveFact — health keywords
```
src/memory/MemoryStore.ts:333-345
  if (
    /\b(diagnosi|diagnosis|patologia|pathology|malattia|disease|terapia|therapy|farmaco|medication|prescrizione|prescription|hiv|cancer|cancro|tumore|diabete|diabetes|insulina|insulin|depressione|depression|ansia|anxiety|allerg\w*|disorder|sintomo|symptom)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
```

### addFact — sensitive check on raw input
```
src/memory/MemoryStore.ts:245-249
    if (isSensitiveFact(text)) {
      throw new SensitiveFactError();
    }
```

### Cache-after-write (correct pattern)
```
src/memory/MemoryStore.ts:219-224
async function writeFacts(facts: MemoryFact[]): Promise<void> {
  const capped = dedupeAndCap(facts);
  try {
    await AsyncStorage.setItem(FACTS_KEY, JSON.stringify(capped));
  } catch (error) {
    throw new MemoryWriteError(error);
  }
  factsCache = capped;
```

### Save-gate + epoch capture
```
src/app/AppShell.tsx:4328-4331
            const startEpoch = MemoryStore.getEpoch();
            const saveGate = new Promise<void>((resolve) => {
              releaseSaveGate = resolve;
            });
```

### Gate safety timeout
```
src/app/AppShell.tsx:4346-4349
            const gateTimeoutId = setTimeout(() => {
              if (releaseSaveGate && extractGateSource === 0) extractGateSource = 2;
              releaseSaveGate?.();
            }, 10_000);
```

### extractMemory — 20s timeout
```
src/engine/LlamaService.ts:387
const EXTRACT_MEMORY_TIMEOUT_MS = 20_000;
```

### parseMemoryExtract — add cap 3×120, remove cap 10
```
src/engine/LlamaService.ts:3612-3629
      const add = Array.isArray(obj.add)
        ? obj.add
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.replace(/\s+/g, " ").trim().slice(0, 120))
            .filter((item) => item.length > 0)
            .slice(0, 3)
        : [];
      const remove = Array.isArray(obj.remove)
        ? obj.remove
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.replace(/\s+/g, " ").trim())
            .filter((item) => item.length > 0)
            .slice(0, 10)
        : [];
```

### Extraction prompt
```
src/i18n/en.ts:918-925
    extractPrompt:
      "You are a memory extractor. From the conversation below, extract short durable facts about the USER " +
      "(name, preferences, interests, job, language...). Return ONLY JSON: {\"add\": [\"...\"], \"remove\": [\"...\"]} " +
      "where add = new facts (max 3, each ≤ 120 chars, in the user's language) and remove = exact facts to forget " +
      "(empty if none). Facts must be about the user, not about your answers. Never extract passwords, tokens, " +
      "API keys, card numbers, emails, phone numbers, IBAN, tax IDs, or medical details. " +
      "If nothing to extract: {\"add\": [], \"remove\": []}.\n\n" +
      "Conversation:\nUSER: {user}\nASSISTANT: {assistant}",
```
