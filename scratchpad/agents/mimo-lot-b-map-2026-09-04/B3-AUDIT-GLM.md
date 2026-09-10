# B3 Audit — web_fetch privacy gate (MiMo replacement)

Audited files: `webFetchGate.ts`, `toolRegistry.ts`, `toolGateRegistry.ts`, `runToolGate.ts`, all three test files, `sensitivePatternGate.ts`, `AppShell.tsx` (executeTool path), `benchConfig.ts`.

---

## Findings

### F1 — `bench toolgate=0` silently disables the entire web_fetch gate

**Severity:** HIGH — must-fix  
**Verdict:** CONFIRMED

`AppShell.tsx:1987`:
```ts
const gate = (await getToolGateEnabled())
  ? await runToolGate({ ... })
  : { blocked: false };
```

`benchConfig.ts:468`:
```ts
if (raw === "0") return false;
```

When `kalsa.bench.toolgate` is `"0"`, **no gate runs at all** — web_fetch, web_search, calendar all pass. The B3 sensitive-pattern URL/query gate is entirely skipped. Any device with this AsyncStorage key set (debug menu, bench artifact left behind, OTA config) loses all privacy gating. The key defaults to "on" (`return true`) but there is **no expiry, no kill-switch, and no production guard** beyond the comment "CI A/B only."

**Action:** Gate the bench bypass behind `__DEV__` or remove it. At minimum, add an expiry/epoch check so stale bench keys cannot persist into production builds.

---

### F2 — `runToolGate` has no error boundary around `evaluateTurn`

**Severity:** MEDIUM — must-fix  
**Verdict:** CONFIRMED

`runToolGate.ts:72`:
```ts
const decision = evaluateTurn(
  { toolName: opts.toolName, input: snapshotInput(...) },
  table,
);
```

If `evaluateTurn` throws (e.g. a future rule's `condition` callback throws), the exception propagates uncaught through `runToolGate` into `AppShell.executeTool`, which would crash the tool call mid-turn. The `evaluateTurn` function has a per-rule try/catch inside (`evaluate.ts:81-85`), but the sort, frozenInput spread, and outer loop are unprotected.

**Action:** Wrap the `evaluateTurn` call in `runToolGate` with a try/catch that defaults to `{ blocked: false }` (fail-open for availability) or `{ blocked: true }` (fail-closed for security). Given this is a privacy gate, fail-closed is safer.

---

### F3 — `snapshotInput` coerces non-string `url` to `String()` — bypass for objects

**Severity:** LOW — nit  
**Verdict:** PLAUSIBLE

`runToolGate.ts:28`:
```ts
url: typeof args.url === "string" ? args.url : String(args.url ?? ""),
```

If `args.url` is an object (e.g. `{toString(){return "https://evil.com?token=X"}}`), `String()` calls `toString()`, producing a string that passes the sensitive-pattern gate but may be interpreted differently by `fetchImpl`. In practice the LLM produces JSON strings, so `args.url` is always a string from the model output. But if a crafted tool call passes an object, the gate sees the `toString()` result while the fetch executor sees `String(rawUrl)` from `webFetchTool.ts:595`.

`webFetchTool.ts:595`:
```ts
const rawUrl = String((rawArgs as { url?: unknown }).url ?? "").trim();
```

Both coerce via `String()`, so behavior is consistent. The risk is theoretical: a `toString()` override could produce different values at gate time vs. fetch time if the object is mutated between calls. Not exploitable with current LLM output but represents a fragile assumption.

**Action:** Accept as nit. Add a comment that `snapshotInput` trusts JSON-serializable args from the model.

---

### F4 — `web_fetch` URL sensitive pattern: no dedicated `expand=off` URL block test

**Severity:** LOW — nit  
**Verdict:** CONFIRMED (test gap)

`runToolGate.test.ts:183-199`:
```ts
test("web_fetch blocks sensitive input when expand is off", async () => {
  // only tests: query="email me at alex@example.com"
  // url is clean: "https://example.com/article"
```

There is a test for sensitive **URL** with `expand=on` (line 133), and a test for sensitive **query** with `expand=off` (line 183). There is **no test** for sensitive **URL** with `expand=off`. The code path works (the table is resolved regardless of expand), but it's untested.

**Action:** Add a test case: `web_fetch` with `toolhelpOn: false` and `url: "https://example.com/pay?iban=DE89370400440532013000"` → blocked.

---

### F5 — Both `WEB_FETCH_GATE_TABLE` rules share priority 25 — only first fires in trace

**Severity:** LOW — nit  
**Verdict:** CONFIRMED (design, not bug)

`webFetchGate.ts:11-20`:
```ts
{ id: "sensitive-pattern-in-url", priority: 25, ... },
{ id: "sensitive-pattern-in-query", priority: 25, ... },
```

`evaluate.ts:78-80`:
```ts
const dp = b.rule.priority - a.rule.priority;
if (dp !== 0) return dp;
return a.declarationOrder - b.declarationOrder;
```

When both URL and query are sensitive, `evaluateTurn` fires both, but only the **first declared** block (`sensitive-pattern-in-url`) wins. The second is marked shadowed. This is correct behavior (both block, only one reported), but the audit trace will only show one rule fired as the winner. The shadowed rule is visible in the trace rows, so this is transparent — just not obvious.

**Action:** Accept as nit. Consider different priorities (e.g. url=26, query=25) if you want the audit trace to clearly distinguish the winner.

---

### F6 — `empty-query` rule is in `TOOL_GATE_TABLE`, not `WEB_FETCH_GATE_TABLE`

**Severity:** INFO — n/a  
**Verdict:** REFUTED (non-issue)

`toolGate.ts:57-60`:
```ts
{ id: "empty-query", priority: 30, condition: (input) => asString(input.query).trim() === "", ... }
```

The `empty-query` rule is in the web_search gate table (`TOOL_GATE_TABLE`), not the web_fetch gate table (`WEB_FETCH_GATE_TABLE`). For web_fetch, an empty query is handled by `webFetchTool.ts:598`:
```ts
if (!query) return { text: errors.webFetchEmptyQuery };
```

This is correct — the tool definition requires `query`, and the executor rejects it before any gate runs. The gate doesn't need an `empty-query` rule for web_fetch.

**Action:** None.

---

### F7 — `pure.test.ts` imports real functions, no mocks — correct but fragile

**Severity:** INFO — nit  
**Verdict:** CONFIRMED (correct behavior)

`pure.test.ts:1-5`:
```ts
import {
  acceptSignal,
  classifyHttpStatus,
  classifyNetworkFailure,
  extractSignal,
  sanitizeReport,
} from "./pure";
```

The test imports directly from `./pure` with no mocks. This is correct — `pure.ts` is a pure utility module with no React Native / AsyncStorage dependencies. The `runToolGate.test.ts` and `toolGateRegistry.test.ts` both mock `expo-secure-store` because they transitively import `toolRegistry.ts` which touches native modules. The `pure.test.ts` correctly avoids this by importing only from the pure module.

**Action:** None. Correct as-is.

---

### F8 — `containsSensitivePattern` correctly rejects non-strings

**Severity:** INFO — n/a  
**Verdict:** REFUTED (non-issue)

`sensitivePatternGate.ts:105`:
```ts
if (typeof text !== "string") return false;
```

`runToolGate.ts:17`:
```ts
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
```

Non-string values are handled at both layers: `asString` converts to `""` before calling `containsSensitivePattern`, and `containsSensitivePattern` rejects non-strings. Empty strings return `false` (line 107: `if (!raw) return false`). No bypass possible.

**Action:** None.

---

### F9 — Audit log writes only when `toolhelpOn` is true — correct by design

**Severity:** INFO — n/a  
**Verdict:** REFUTED (non-issue)

`runToolGate.ts:80`:
```ts
if (opts.toolhelpOn) {
  await appendGateAudit({ ... });
}
```

When toolhelp is off, no audit is written. This is intentional — the gate still runs and blocks, but audit storage is skipped. The test at `runToolGate.test.ts:66` confirms: `expect(await readGateAudit()).toEqual([])` when `toolhelpOn: false`.

**Action:** None.

---

### F10 — `web_fetch` gate table has no `rewrite` or `warn` actions — pure block

**Severity:** INFO — design note  
**Verdict:** CONFIRMED (by design)

`webFetchGate.ts:11-20`: Both rules use `{ kind: "block", ... }`. Unlike `TOOL_GATE_TABLE` which has warn and echo rules, `WEB_FETCH_GATE_TABLE` is block-only. This means `web_fetch` never gets a `warnNote` from the privacy gate. The `runToolGate` function returns `{ blocked: false, warnNote: undefined }` for any clean pass. This is correct — web_fetch is either blocked or clean, no partial mitigation.

**Action:** None.

---

### F11 — `TOOL_ENTRIES` web_fetch `gateTable` is correctly wired

**Severity:** INFO — verified  
**Verdict:** CONFIRMED

`toolRegistry.ts:81-87`:
```ts
{
  name: "web_fetch",
  def: WEB_FETCH_TOOL,
  toggleKey: WEB_TOOLS_ENABLED_KEY,
  defaultOn: true,
  gateTable: WEB_FETCH_GATE_TABLE,
},
```

`toolGateRegistry.ts:11-14`:
```ts
for (const entry of TOOL_ENTRIES) {
  if (entry.gateTable) gateRegistry[entry.name] = entry.gateTable;
}
```

The gate table is correctly registered. `resolveToolGateTable("web_fetch", false)` returns `WEB_FETCH_GATE_TABLE` (always resolved). `resolveToolGateTable("web_fetch", true)` also returns it. Verified by `toolGateRegistry.test.ts:27-30`.

**Action:** None.

---

### F12 — No `webFetchGate.test.ts` — covered through integration tests

**Severity:** INFO — nit  
**Verdict:** CONFIRMED

The impl report notes: "Separate `webFetchGate.test.ts`; the new table is covered through the registry and `runToolGate` tests." The `WEB_FETCH_GATE_TABLE` is tested indirectly via `runToolGate.test.ts` (which calls through the full stack: `runToolGate` → `resolveToolGateTable` → `evaluateTurn` → `containsSensitivePattern`). No dedicated unit test for the table's condition callbacks.

**Action:** Accept as nit. A direct `webFetchGate.test.ts` would test the condition callbacks in isolation (cheaper, faster, catches wiring errors earlier).

---

### F13 — `snapshotInput` for `web_search` doesn't include `url` field

**Severity:** INFO — correct  
**Verdict:** REFUTED (non-issue)

`runToolGate.ts:23-27`:
```ts
if (toolName === "web_search" || toolName === "web_fetch") {
  return {
    ...(toolName === "web_fetch" ? { url: ... } : {}),
    query: ...,
    ...
  };
}
```

`web_search` gets only `query`, `lastUserMessage`, `memoryFacts`. The `TOOL_GATE_TABLE` rules only reference `input.query`, `input.lastUserMessage`, `input.memoryFacts`. No `url` is needed for web_search. Correct.

**Action:** None.

---

## Summary

| # | Finding | Severity | Verdict | Action |
|---|---------|----------|---------|--------|
| F1 | `bench toolgate=0` disables all gates | **HIGH** | CONFIRMED | Guard behind `__DEV__` or add expiry |
| F2 | No error boundary in `runToolGate` around `evaluateTurn` | **MEDIUM** | CONFIRMED | Add try/catch, fail-closed |
| F3 | `snapshotInput` coercion for non-string url | LOW | PLAUSIBLE | Nit; add comment |
| F4 | No `expand=off` + sensitive URL test | LOW | CONFIRMED | Add test case |
| F5 | Duplicate priority 25 in web_fetch gate | LOW | CONFIRMED | Design nit; optional priority split |
| F6 | `empty-query` not in web_fetch gate | INFO | REFUTED | None |
| F7 | `pure.test.ts` real imports | INFO | CONFIRMED | None (correct) |
| F8 | Non-string rejection in sensitivePattern | INFO | REFUTED | None |
| F9 | Audit writes only when toolhelp on | INFO | REFUTED | None |
| F10 | web_fetch gate is block-only | INFO | CONFIRMED | None (by design) |
| F11 | TOOL_ENTRIES wiring correct | INFO | CONFIRMED | None |
| F12 | No dedicated webFetchGate.test.ts | INFO | CONFIRMED | Nit |
| F13 | web_search snapshotInput no url | INFO | REFUTED | None |

### Must-fix (2)

1. **F1** — `bench toolgate=0` bypass has no production guard. Gate behind `__DEV__` or add an epoch/expiry.
2. **F2** — `runToolGate` lacks error boundary around `evaluateTurn`. Add try/catch → fail-closed.

### Nits (3)

3. **F3** — `snapshotInput` coercion is safe in practice but fragile. Document the assumption.
4. **F4** — Add one test: `expand=off` + sensitive URL → blocked.
5. **F5** — Consider splitting priorities (url=26, query=25) for clearer audit traces.

### Clean

F6–F13: No issues found. Gate wiring, tests, imports, edge cases all verified correct.
