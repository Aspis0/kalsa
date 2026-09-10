# B1A — Privacy Egress Map

**Date:** 2026-09-04  
**Owner:** Local AI app  
**Principle:** Memory store MUST accept sensitive facts (no isSensitiveFact on write/storage). Privacy gate belongs on network egress only.

---

## 1. Memory Write — every call site of isSensitiveFact / SensitiveFactError

### `isSensitiveFact` definition
- **File:** `src/memory/MemoryStore.ts:229`
- Regex-heavy matcher: credit cards (Luhn), IBAN, codice fiscale, emails, phones, addresses, GPS, medical keywords, passwords/tokens/keys
- **Used at 4 sites:**

| # | File:line | Function | Behavior |
|---|-----------|----------|----------|
| 1 | `src/memory/MemoryStore.ts:458` | `listFacts()` | Filters existing facts on migration read — drops pre-existing sensitive entries silently |
| 2 | `src/memory/MemoryStore.ts:486` | `addFact()` | **Throws `SensitiveFactError`** — caller in SettingsScreen catches it |
| 3 | `src/memory/MemoryStore.ts:617` | `applyExtractResults()` | **Skips (continue)** — counts `factsRejectedSensitive` for telemetry, never throws |

### `SensitiveFactError` usage
- **Thrown:** `addFact()` at `MemoryStore.ts:487`
- **Caught:** `SettingsScreen.tsx:553` — shows `t("memory.sensitive")` notice
- **Never thrown from `applyExtractResults`** — silent skip

### Telemetry counter
- `telemetryAccum.factsRejectedSensitive` incremented at `MemoryStore.ts:618`
- `factsRejectedSensitive` reported in `memoryTelemetry.ts:21` and `formatMemoryLine()`

### i18n keys to remove
| Key | en.ts:911 | it.ts:881 |
|-----|-----------|-----------|
| `memory.sensitive` | `"This fact contains sensitive data and was not saved."` | `"Il fatto contiene dati sensibili e non è stato salvato."` |

### What to **remove** from memory write
1. **`isSensitiveFact` function** (`MemoryStore.ts:229-406`) — entire function body
2. **`SensitiveFactError` class** (`MemoryStore.ts:22-28`) — export and class
3. **`addFact` sensitive check** (`MemoryStore.ts:485-488`) — remove the `if (isSensitiveFact(text))` block + throw
4. **`applyExtractResults` sensitive check** (`MemoryStore.ts:616-619`) — remove the `if (isSensitiveFact(rawAdd))` block + continue + telemetry increment
5. **`listFacts` migration filter** (`MemoryStore.ts:458`) — remove `const withoutSensitive = current.filter(...)`; use `current` directly
6. **SettingsScreen catch** (`SettingsScreen.tsx:553-554`) — remove `SensitiveFactError` instanceof branch
7. **i18n `memory.sensitive`** — remove from `en.ts` and `it.ts`
8. **`factsRejectedSensitive` telemetry field** — remove from `MemoryTelemetry` interface (`memoryTelemetry.ts:21`), `telemetryAccum` reset object, `formatMemoryLine`, and `benchAggregate.mjs` aggregate display

### What to **keep** (still useful for egress)
- `luhnCheck()` — reusable for egress credit-card detection (move to `entityContainment.js` or a shared util)
- The regex patterns inside `isSensitiveFact` — extract into a new `containsSensitivePattern(query: string): boolean` for egress scanning (regexes are already egress-quality: credit card, IBAN, CF, email, phone, address, medical)

### Tests to remove/repurpose
- **No unit tests exist** for `isSensitiveFact` directly (confirmed: `grep -rn` finds zero `.test.ts` hits)
- `memoryTelemetryHarness.mjs:254-275` — Test 5 asserts fact text doesn't leak into telemetry; the "rejected as sensitive" assertion becomes irrelevant. Repurpose: verify `factsRejectedSensitive` field is removed from `formatMemoryLine` output, or delete test if the field is gone.

---

## 2. Egress Gates Today

### Gate path: `runToolGate`
- **File:** `src/rules/runToolGate.ts`
- Called from `AppShell.tsx:1998-2007` inside `executeTool`
- Gated tools: **web_search** (always), **calendar_agenda** (toolhelp flag on)
- `web_fetch` — **NOT GATED** (confirmed `toolGateRegistry.test.ts:23`: `resolveToolGateTable("web_search", true)` undefined)

### Tool gate registry
- **File:** `src/rules/toolGateRegistry.ts:14-15`
```ts
export const TOOL_GATE_REGISTRY = {
  web_search: TOOL_GATE_TABLE,
  calendar_agenda: CALENDAR_GATE_TABLE,
};
```
- Unregistered tools (web_fetch, document_chat, miniapps, device_info, device_calc) are **exempt by construction**

### `TOOL_GATE_TABLE` rules (web_search)
- **File:** `src/rules/toolGate.ts:42-99`
- Rule `echo-of-memory-fact` (priority 10): calls `containsPrivateData(query, fact)` for each injected memory fact
- Rule `echo-of-context` (priority 20): cosine similarity check against `lastUserMessage`
- Rule `empty-query` (priority 30): blocks empty queries

### `CALENDAR_GATE_TABLE` rules
- **File:** `src/rules/calendarGate.ts:16-43`
- Rule `calendar-private-data` (priority 10): `containsPrivateData()` on every string field against memory facts

### `containsPrivateData` — the shared primitive
- **File:** `src/rules/entityContainment.js:106-163`
- Three signals: distinctive token (digit/@/capital), ≥50% token overlap, 2+ consecutive tokens
- Language-independent, case-insensitive normalization

### What does the gate scan?
| Input | Memory facts | User text | Query/args |
|-------|-------------|-----------|------------|
| `web_search` | ✅ `memoryFacts: injectedFactsRef.current` (AppShell:2002) | ✅ `lastUserMessage: rawUserText` (AppShell:2001) | ✅ `args.query` |
| `calendar_agenda` | ✅ same | ✅ same | ✅ all string fields |

### `privateSearchLatch` — secondary gate
- **File:** `AppShell.tsx:1992-1994`
- If a turn already used `calendar_agenda` or `device_info`/`device_calc`, `web_search` is blocked for that same turn (`searchSkippedPrivate`)
- This prevents the model from re-querying what it just learned from private tools

### Gaps: can sensitive data reach external APIs without gate?

| Risk | Status | Detail |
|------|--------|--------|
| **Credit card in web_search query** | ⚠️ Partially blocked | `echo-of-memory-fact` blocks if the CC appears verbatim in a memory fact. But CC typed by user in chat → model puts it in query → **no direct regex scan of query text** against sensitive patterns. Only `containsPrivateData` vs memory facts. |
| **IBAN in user message → web_search query** | ⚠️ Same gap | If user types IBAN and model echoes it into query, no sensitive-pattern gate fires (only memory-fact containment) |
| **web_fetch URL** | ❌ No gate | `web_fetch` is unregistered in `TOOL_GATE_REGISTRY`. URL allowlist blocks unauthorized hosts but does NOT scan the URL for sensitive data. A model could put an IBAN in a query param. |
| **web_fetch query param** | ❌ No gate | `web_fetch` passes `query` string to the page; no privacy scan. |
| **Telemetry/reports** | ✅ Safe | `memoryTelemetry.ts` is counters-only by design; fact text is never included. |
| **External search providers (Exa, Brave, Tavily)** | ⚠️ Indirect | Providers receive whatever `searchWeb()` sends. The gate runs BEFORE `searchWeb()` in `AppShell.executeTool`. But only `web_search` is gated — not `web_fetch`. |

**Critical gap:** A user types "my IBAN is DE89370400440532013000" → model calls `web_search(query="DE89370400440532013000 bic code")` → `echo-of-memory-fact` only fires if that IBAN is in a memory fact. If it's only in the current conversation, it passes.

**Recommended minimal gap fix for A′:** Add a `sensitivePatternScan` rule to `TOOL_GATE_TABLE` that runs `containsSensitivePattern(query)` (the extracted regex patterns from `isSensitiveFact`) against `query` directly, independent of memory facts.

---

## 3. Recommended Minimal Patch Set for A′

| File | Change | Effort |
|------|--------|--------|
| `src/memory/MemoryStore.ts` | Remove `isSensitiveFact`, `SensitiveFactError`, sensitive checks in `addFact`/`applyExtractResults`/`listFacts`. Extract `luhnCheck` and regex patterns to a shared util. | M |
| `src/screens/SettingsScreen.tsx` | Remove `SensitiveFactError` catch branch (line 553-554) | S |
| `src/i18n/en.ts` | Remove `memory.sensitive` key (line 911) | S |
| `src/i18n/it.ts` | Remove `memory.sensitive` key (line 881) | S |
| `src/memory/memoryTelemetry.ts` | Remove `factsRejectedSensitive` field from interface, `formatMemoryLine`, and docs | S |
| `src/memory/MemoryStore.ts` (telemetry) | Remove `factsRejectedSensitive` increment (line 618) and reset | S |
| **NEW: `src/rules/sensitivePatternGate.ts`** | Extract `isSensitiveFact` regexes into `containsSensitivePattern(text: string): boolean` — pure function, no side effects | M |
| `src/rules/toolGate.ts` | Add new rule `sensitive-pattern-in-query` (priority 5, above echo rules): `containsSensitivePattern(query)` → block | S |
| `src/rules/toolGateRegistry.test.ts` | Add test: web_search blocked when query contains bare credit card | S |
| `src/rules/runToolGate.test.ts` | Add test: sensitive pattern blocks query even if memory fact absent | S |
| `scripts/benchAggregate.mjs` | Remove `factsRejectedSensitive` from aggregate display (lines ~1849, 1872, 2271) | S |
| `scripts/memoryTelemetryHarness.mjs` | Update Test 5: remove sensitive-rejection assertion; test that `factsRejectedSensitive` field no longer exists in telemetry | S |

### What NOT to rewrite
- **Mutex/epoch/injection** — untouched. `withMutex`, `bumpEpoch`, `epoch` checks in `applyExtractResults` are orthogonal to privacy.
- **`containsPrivateData`** — the entity-containment primitive stays as-is for memory-fact containment checks
- **`TOOL_GATE_TABLE` echo rules** — keep `echo-of-context` and `echo-of-memory-fact` as-is
- **`privateSearchLatch`** — stays; prevents cross-tool data leakage within a turn
- **web_fetch allowlist** — stays; host-level gate is separate concern

---

## 4. Tests to Add/Move

### Remove
- None to remove — no existing tests assert memory rejects sensitive facts (confirmed: zero `.test.ts` hits for `isSensitiveFact` or `SensitiveFactError`)

### Repurpose
- `scripts/memoryTelemetryHarness.mjs:254-275` (Test 5) — currently asserts `factText` field is ignored by `formatMemoryLine`. After removing `factsRejectedSensitive`, update to verify the field is gone from the interface.

### Add
| Test | File | Assert |
|------|------|--------|
| `sensitivePatternGate blocks credit card in query` | `src/rules/toolGateRegistry.test.ts` or new `sensitivePatternGate.test.ts` | `runToolGate({query: "4111111111111111 visa"}).blocked === true` |
| `sensitivePatternGate blocks IBAN in query` | same | `runToolGate({query: "DE89370400440532013000 bic"}).blocked === true` |
| `sensitivePatternGate blocks medical keyword in query` | same | `runToolGate({query: "my hiv status results"}).blocked === true` |
| `sensitivePatternGate does NOT block innocent query` | same | `runToolGate({query: "weather in milano"}).blocked === false` |
| `memory.addFact accepts credit card (no rejection)` | `MemoryStore.test.ts` (new) | `addFact("my card is 4111111111111111")` resolves without throw |
| `memory.applyExtractResults stores sensitive fact` | `MemoryStore.test.ts` (new) | `applyExtractResults(["IBAN DE89370400440532013000"], [], 0)` stores it |
| `memory.listFacts no longer filters sensitive` | `MemoryStore.test.ts` (new) | Pre-existing sensitive fact survives `listFacts()` |

---

## 5. Quotes (exact file:line)

### Memory write — sensitive gate sites
```
src/memory/MemoryStore.ts:22-28    — SensitiveFactError class
src/memory/MemoryStore.ts:229      — export function isSensitiveFact(text: string): boolean
src/memory/MemoryStore.ts:458      — const withoutSensitive = current.filter((fact) => !isSensitiveFact(fact.text));
src/memory/MemoryStore.ts:486-488  — if (isSensitiveFact(text)) { throw new SensitiveFactError(); }
src/memory/MemoryStore.ts:617-619  — if (isSensitiveFact(rawAdd)) { telemetryAccum.factsRejectedSensitive++; continue; }
src/screens/SettingsScreen.tsx:553-554 — if (error instanceof MemoryStore.SensitiveFactError) { setMemoryNotice(t("memory.sensitive")); }
src/i18n/en.ts:911                 — sensitive: "This fact contains sensitive data and was not saved."
src/i18n/it.ts:881                 — sensitive: "Il fatto contiene dati sensibili e non è stato salvato."
src/memory/memoryTelemetry.ts:21   — factsRejectedSensitive: number;
```

### Egress gate sites
```
src/rules/runToolGate.ts:66-77     — snapshotInput() — packs query + lastUserMessage + memoryFacts
src/rules/runToolGate.ts:86-109    — runToolGate() — main entry, calls evaluateTurn
src/rules/toolGate.ts:80-88        — echo-of-memory-fact rule — containsPrivateData(query, fact)
src/rules/toolGate.ts:55-77        — echo-of-context rule — cosine similarity
src/rules/toolGateRegistry.ts:14-15 — TOOL_GATE_REGISTRY = { web_search, calendar_agenda }
src/rules/toolGateRegistry.ts:24-28 — resolveToolGateTable — web_fetch returns undefined
src/rules/calendarGate.ts:36-42    — calendar-private-data rule — containsPrivateData on all string fields
src/rules/entityContainment.js:106 — function containsPrivateData(query, fact)
src/app/AppShell.tsx:1992-1994     — privateSearchLatch blocks web_search after private tools
src/app/AppShell.tsx:1998-2007     — runToolGate call site with memoryFacts injection
```

### Gap evidence
```
src/rules/toolGateRegistry.test.ts:23 — expect(resolveToolGateTable("web_fetch", true)).toBeUndefined()
src/agent/webSearchTool.ts:58        — // Privacy gate lives at executeTool (runToolGate / registry).
src/agent/webFetchTool.ts:605-616    — no containsPrivateData / isSensitiveFact scan on query or URL
```
