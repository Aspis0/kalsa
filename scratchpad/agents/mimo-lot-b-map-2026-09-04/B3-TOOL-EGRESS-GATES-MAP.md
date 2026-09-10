# B3 — Tool egress privacy gates (post B1-A′ / B6)

Repo: `/Users/marco/Projects/kalsa`
Predecessors: B1-A′ (privacy audit), B6 (round-trip map)

---

## 1. Full `runToolGate` path

### Entry point
`src/app/AppShell.tsx:1986-1997` — `executeTool` closure calls `runToolGate` when `getToolGateEnabled()` is true (default ON; `kalsa.bench.toolgate=0` disables for CI A/B).

### Resolver
`src/rules/runToolGate.ts:38` → `resolveToolGateTable(toolName, toolhelpOn)`.

`src/rules/toolGateRegistry.ts:29-34` — `resolveToolGateTable`:
- `expand=false` (toolhelp OFF): **only** `web_search` resolves.
- `expand=true` (toolhelp ON): all registered `gateTable` rows resolve.

### Registered gate tables (via `TOOL_ENTRIES` in `src/agent/toolRegistry.ts`)

| Tool | `gateTable` | File |
|---|---|---|
| `web_search` | `TOOL_GATE_TABLE` | `src/rules/toolGate.ts:29` |
| `web_fetch` | **`null`** | `src/agent/toolRegistry.ts:70` |
| `calendar_agenda` | `CALENDAR_GATE_TABLE` | `src/rules/calendarGate.ts:18` |
| `document_chat` | **`null`** | `src/agent/toolRegistry.ts:77` |
| `device_info` | **`null`** | `src/agent/toolRegistry.ts:83` |
| `device_calc` | **`null`** | `src/agent/toolRegistry.ts:89` |

### web_search gate rules (`src/rules/toolGate.ts:30-87`)

1. `empty-query` (prio 30) — blocks empty query.
2. `sensitive-pattern-in-query` (prio 25) — `containsSensitivePattern(query)`. Detects: credentials, IBAN, CF, card numbers (Luhn), emails, GPS coords, phone numbers, addresses, document IDs, personal-medical patterns.
3. `echo-of-context` (prio 20) — cosine(n-gram) of query vs `lastUserMessage` below threshold. Abstains when either is too short.
4. `echo-of-memory-fact` (prio 10) — `containsPrivateData(query, fact)` per fact. Detects distinctive tokens, token overlap ≥50%, consecutive content tokens.

### calendar_agenda gate rules (`src/rules/calendarGate.ts:18-37`)

1. `calendar-private-data` (prio 10, toolhelp ON only) — `containsPrivateData(textField, fact)` across all string fields in input + memory facts.

###udit path
`src/rules/runToolGate.ts:46-49` — when `toolhelpOn`, `appendGateAudit` writes `{turnId, toolName, ruleId, action, outcome}` to `gateAuditLog`. Audit entries contain zero user content (tested: `runToolGate.test.ts:57-65`).

---

## 2. web_fetch allowlist + what leaks

### Allowlist construction (`src/app/AppShell.tsx:1862-1874`)
- Fresh `FetchAllowlist` per send (`fetchAllowlistTurnSeq`).
- Seeded from: user message URLs (`URL_IN_TEXT_RE`) + `web_search` result URLs.
- `web_fetch` executor is recreated each turn, bound to the per-turn allowlist.

### What gates web_fetch (NOT runToolGate)
`src/app/AppShell.tsx:2010-2011` — `fetchExec(name, args, signal)` called **directly**; `runToolGate` is called for ALL tools but `web_fetch` resolves to `undefined` → `{ blocked: false }`.

Actual gates inside `makeWebFetchExecutor` (`src/agent/webFetchTool.ts`):
1. **URL allowlist** (line ~401): `allowlist.has(url)` — crafted URLs blocked.
2. **Public routable gate** (line ~395): `isPubliclyRoutableHttpUrl(url)` — blocks private IPs, non-HTTP, IPv6 literals, percent-encoding tricks, backslashes.
3. **Redirect validation** (line ~440): final URL must be allowlisted or same-host; https→http downgrade blocked.

### What can still leak
- **`query` parameter**: The `query` arg is sent to `fetchExec` as-is. No `containsSensitivePattern` check on it. The model could construct a query like `"find my password"` or embed PII in the query.
- **URL path/params**: URL must be on allowlist (search result or user-pasted), so a crafted URL can't be exfiltrated. But a legitimate allowlisted URL could have query params embedded by the model.
- **`containsSensitivePattern` never runs on web_fetch input**: The `TOOL_GATE_TABLE` is not registered for `web_fetch`. The sensitive-pattern gate only fires for `web_search`.

### Quote
> `src/agent/toolRegistry.ts:6` — *"Do not gate web_fetch here unless its separate follow-up is implemented."*
> `src/rules/toolGateRegistry.ts:33` — `web_fetch` returns `undefined` from `resolveToolGateTable` even with `expand=true`.

---

## 3. `privateSearchLatch` behavior

`src/app/AppShell.tsx:503` — `let privateSearchLatchSeq = -1`.

- When `device_info` or `calendar_agenda` executes (lines 2013, 2024): `privateSearchLatchSeq = fetchAllowlistTurnSeq`.
- On next `web_search` call (line 1982): if `privateSearchLatchSeq === fetchAllowlistTurnSeq`, return `searchSkippedPrivate` error.
- **Purpose**: Prevents web search after device/calendar in the same turn (those tools expose private context; searching afterward could echo it).
- **Scope**: Single-turn only. Resets on next send (new `fetchAllowlistTurnSeq`).
- **Not a general sensitive-data gate** — it's a structural sequence guard, not a content check.

---

## 4. Gaps vs product rule

**Product rule**: Sensitive data must not go online via tools.

### Confirmed gaps

| # | Gap | Severity | Location |
|---|---|---|---|
| G1 | `web_fetch` has no `containsSensitivePattern` gate on `query` arg | HIGH | `toolRegistry.ts:70` (`gateTable: null`), `webFetchTool.ts` (no content check) |
| G2 | `web_fetch` has no `containsSensitivePattern` gate on `url` (though allowlist mitigates) | MEDIUM | Allowlist blocks crafted URLs, but model-injected query params on legitimate URLs pass through |
| G3 | `document_chat` has no gate at all — query + doc content never checked | LOW (local-only) | `toolRegistry.ts:77` (`gateTable: null`); `document_chat` never reaches network |
| G4 | `device_info` / `device_calc` ungated — but they're local-only, no network egress | NONE | Correct by design |
| G5 | `calendar_agenda` gate only active with toolhelp ON (`expand=true`) | LOW | `toolGateRegistry.ts:32-33`; flag OFF → no calendar gate |
| G6 | `runToolGate` bypass when `getToolGateEnabled()` returns false (`kalsa.bench.toolgate=0`) | NONE (CI only) | `AppShell.tsx:1987-1988`; bench flag, not prod |

### Non-gaps (already solid)
- `web_search` sensitive-pattern gate: covers credentials, IBAN, CF, cards, emails, GPS, phones, addresses, document IDs, personal-medical.
- `web_search` echo-of-context + echo-of-memory-fact: blocks spurious queries and fact echoing.
- Allowlist: `web_fetch` cannot open arbitrary URLs.
- Public-routable gate: blocks private IPs, IPv6, backslashes, percent-encoding tricks.
- Audit log: contains zero user content.
- `privateSearchLatch`: structural guard for search-after-private-tool.

---

## 5. Minimal patch set for B3

### Patch A: Gate `web_fetch` query with `containsSensitivePattern`

**File**: `src/rules/toolGate.ts` — add a new `WEB_FETCH_GATE_TABLE`:
```ts
export const WEB_FETCH_GATE_TABLE: RuleTable = {
  rules: [
    {
      id: "sensitive-pattern-in-query",
      priority: 25,
      condition: (input) => containsSensitivePattern(asString(input.query)),
      action: { kind: "block", reason: "sensitive-pattern-in-query" },
    },
  ],
};
```

**File**: `src/agent/toolRegistry.ts` — change `web_fetch` entry:
```ts
gateTable: WEB_FETCH_GATE_TABLE,  // was: null
```

**Rationale**: web_fetch sends `query` to a remote server. If the model embeds PII in the query, it leaks. The allowlist gates the URL, not the content.

### Patch B: Gate `web_fetch` URL with `containsSensitivePattern`

Same `WEB_FETCH_GATE_TABLE` — add a second rule:
```ts
{
  id: "sensitive-pattern-in-url",
  priority: 25,
  condition: (input) => containsSensitivePattern(asString(input.url)),
  action: { kind: "block", reason: "sensitive-pattern-in-url" },
},
```

**Rationale**: Defense in depth. Allowlist blocks crafted URLs, but a legitimate search result URL could contain tokens that look like PII (e.g., `?user=RSSMRA85M01A001R`). Low probability but zero cost to gate.

### Patch C: Expose `web_fetch` gate in toolhelp expand path

**File**: `src/rules/toolGateRegistry.ts` — no change needed if Patch A sets `gateTable` on the entry. `resolveToolGateTable("web_fetch", true)` will now resolve.

**File**: `src/app/AppShell.tsx:2010` — `web_fetch` already goes through `runToolGate` (line 1988 gates ALL tools). The gate result is checked. No change needed.

### Patches NOT proposed
- ~~Rewriting memory store~~ — out of scope.
- ~~Gating `document_chat`~~ — it's local-only; no network egress.
- ~~Gating `device_info`/`device_calc`~~ — local-only; no network egress.

---

## 6. Tests to add

### `src/rules/toolGateRegistry.test.ts` — add:
```ts
test("web_fetch resolves a gate table after Patch A", () => {
  expect(resolveToolGateTable("web_fetch", false)).toBeDefined();
  expect(resolveToolGateTable("web_fetch", true)).toBeDefined();
});
```

### `src/rules/sensitivePatternGate.test.ts` — add web_fetch query cases:
```ts
test.each([
  "find my password hunter2",
  "what is my credit card 4111111111111111",
  "search for my IBAN DE89370400440532013000",
])("blocks sensitive web_fetch query: %s", (query) => {
  expect(containsSensitivePattern(query)).toBe(true);
});
```

### `src/rules/runToolGate.test.ts` — add:
```ts
test("web_fetch with sensitive query is blocked when gate table registered", async () => {
  const result = await runToolGate({
    toolName: "web_fetch",
    args: { url: "https://example.com", query: "my password is hunter2" },
    lastUserMessage: "search for my password",
    memoryFacts: [],
    toolhelpOn: false,
    locale: "en",
  });
  expect(result.blocked).toBe(true);
  expect(result.decision?.ruleId).toBe("sensitive-pattern-in-query");
});
```

### Integration test (AppShell or harness):
- Model calls `web_fetch` with a query containing a card number → blocked, no network call.
- Model calls `web_fetch` with a clean query → passes.

---

## Summary

| Area | Status |
|---|---|
| `web_search` sensitive gate | ✅ Solid |
| `web_search` echo gates | ✅ Solid |
| `web_fetch` URL allowlist | ✅ Solid |
| `web_fetch` query content gate | ❌ **Gap G1 — no gate** |
| `web_search` privateSearchLatch | ✅ Solid |
| `calendar_agenda` gate | ✅ Solid (toolhelp ON) |
| `document_chat` / device tools | ✅ N/A (local-only) |
| Audit log zero-content | ✅ Solid |

**One real hole**: `web_fetch` `query` parameter can carry sensitive data to a remote server without any content check. Patch A closes it. Patch B adds defense-in-depth on URL tokens.
