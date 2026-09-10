# B6 — tool call round-trip + parser + results

## 1. LlamaService tool loop: emit → parse → execute → inject role:tool

The entire loop lives in `streamAssistantTurn` inside a single `withEngineJob`:

```
src/engine/LlamaService.ts:2767   toolExecState init
src/engine/LlamaService.ts:2813   for round 0..MAX_TOOL_ROUNDS(3):
src/engine/LlamaService.ts:2818     engine.completion() fires TokenData → cleanStreamDelta(raw)
                                     ↑ createThinkStreamCleaner + createToolCallDeltaStripper (fresh per round)
src/engine/LlamaService.ts:2987     structuredCalls = result.tool_calls?.length ?? 0
src/engine/LlamaService.ts:2996     if (!toolCalls.length && executeTool):
                                       rawText = extractRawResultText(result)
                                       parseFallbackToolCalls(rawText) → toolCalls[]
src/engine/LlamaService.ts:3030     if (!toolCalls.length || !executeTool): emitFinalText; return
src/engine/LlamaService.ts:3044     normalizedCalls = toolCalls.map(assign id)
src/engine/LlamaService.ts:3047     executableCalls = normalizedCalls.slice(0, 2)   ← per-round cap
src/engine/LlamaService.ts:3048     skippedCalls = normalizedCalls.slice(2)
src/engine/LlamaService.ts:3055     for each executableCall:
src/engine/LlamaService.ts:3063       parseToolArguments(raw) → { args, parseFailed, raw }
src/engine/LlamaService.ts:3080       decideToolExecution(toolExecState, MAX_TOOL_EXECUTIONS_PER_TURN=3, ...)
                                        → { action: execute | skip_cap | skip_dup | skip_failed_repeat, key }
src/engine/LlamaService.ts:3122       outcome = await executeTool(name, args, signal, lastUserMessage)
src/engine/LlamaService.ts:3137       recordToolSuccess(toolExecState, decision.key)
src/engine/LlamaService.ts:3171       bodyWithCite = text + buildCiteInstructionSuffix(...)
src/engine/LlamaService.ts:3189       toolContent = formatToolResultContent(bodyWithCite, { webProvenance, documentProvenance })
src/engine/LlamaService.ts:3217     append assistant { tool_calls: [...executed, ...skipped] } + tool { tool_call_id, content }
                                     ↑ next round starts synthesis over these role:tool results
src/engine/LlamaService.ts:3230   if streamedText empty after loop → shouldFireToolRoundFallback
                                     → one extra text-only completion (tool_choice: "none")
                                     → if still empty → localized canned message
```

Key constants:
- `MAX_TOOL_ROUNDS = 3` (search → fetch → answer)
- `MAX_TOOL_EXECUTIONS_PER_TURN = 3` (hard cap across all rounds)
- Per-round slice: `normalizedCalls.slice(0, 2)` — at most 2 calls/round
- `TOOL_RESULT_MAX_CHARS = 2500` (body + trunc marker + provenance + rule)
- Dedup key: `makeToolCallKey(name, canonicalizeArgs(args))` — success-only dedup (F10)
- Failed keys: 2 fails → `skip_failed_repeat` → force text-only

## 2. toolCallParser fallback dialects

```
src/engine/toolCallParser.ts
```

Three dialects, tried in order:

| Dialect | Markers | Emit pattern | Parser |
|---|---|---|---|
| **LFM2.5** (LiquidAI) | `<\|tool_call_start\|>` … `<\|tool_call_end\|>` | Python-call: `[web_search(query="…")]` | `tryParsePythonCallList()` → `parseOnePythonCall()` → `splitTopLevel()` + `parseArgValue()` |
| **LFM2.5 JSON** | same markers | JSON array: `[{"name":"…","arguments":{…}}]` | fallback inside `parseLfmToolCalls()` |
| **Qwen XML** | `[TOOL_CALL_OPEN]…[TOOL_CALL_CLOSE]` | `[FN]NAME[FN][PARAM]KEY[PARAM]VALUE[PARAM][FN]` or JSON body `{…}` | `parseQwenFallbackToolCall()` → `FUNCTION_TAG_RE` + `PARAMETER_TAG_RE` |

Ordering: LFM marker wins when present (`parseLfmToolCalls` returns non-null) → Qwen fallback.

Streaming stripper: `createToolCallDeltaStripper()` — stateful, cross-delta partial tag carry. Fresh instance per round.

Final stripper: `stripToolCallTagsFinal()` — closed pairs + trailing unclosed block.

## 3. EngineToolResult shape + toolSourceLedger citation coupling

```
src/engine/LlamaService.ts:542   EngineToolResult
```

```ts
type EngineToolResult = {
  text: string;
  sources?: unknown[];          // search results / fetch source cards
  passages?: RetrievedPassage[]; // document_chat passages
  kind?: string;                 // "document_chat" → post-trunc provenance
  strategy?: ToolRetrievalStrategy; // "hybrid" | "bm25_only" | etc.
  error?: string;                // structured failure (no throw)
};
```

Citation pipeline (all in `toolSourceLedger.ts`):
```
src/agent/toolSourceLedger.ts:39   accumulateToolSources(acc, incoming)
                                     → dedup by normalizeFetchUrl(url), keep first occurrence
                                     → assigned[] = 1-based absolute citation indices
src/agent/toolSourceLedger.ts:76   buildCiteInstructionSuffix(assigned, strings, kind)
                                     → "sources" (web_search) or "passages" (web_fetch)
                                     → pdfPages → "p. 7" label
src/agent/toolSourceLedger.ts:119  pdfPagesFromSources(sources)
                                     → collects pdfPages from fetch source cards
src/agent/toolSourceLedger.ts:133  canonicalizeArgs(value)
                                     → recursive key sort for stable dedup
src/agent/toolSourceLedger.ts:147  makeToolCallKey(name, args)
                                     → name:JSON.stringify(canonicalizeArgs(args))
                                     → parseFailed → name:raw:rawArguments
src/agent/toolSourceLedger.ts:165  decideToolExecution(state, maxExecutions, name, args)
                                     → skip_cap → skip_dup → skip_failed_repeat → execute
src/agent/toolSourceLedger.ts:195  recordToolSuccess / recordToolFailure
                                     → executions++, successfulKeys.add / failedKeys.inc
```

Provenance appending in LlamaService (NOT in the tool executor):
```
src/engine/LlamaService.ts:493   formatToolResultContent(raw, { webProvenance?, documentProvenance? })
                                   → appends TOOL_RESULT_USE_RULE
                                   → appends WEB_TOOL_RESULT_PROVENANCE or DOCUMENT_TOOL_RESULT_PROVENANCE
                                   → truncates body to fit TOOL_RESULT_MAX_CHARS budget
```

## 4. runToolGate choke point — which tools gated

```
src/rules/runToolGate.ts
src/rules/toolGateRegistry.ts
src/rules/toolGate.ts
src/rules/calendarGate.ts
```

Registry:
```ts
TOOL_GATE_REGISTRY = {
  web_search: TOOL_GATE_TABLE,      // always gated
  calendar_agenda: CALENDAR_GATE_TABLE, // gated only when expand=true (toolhelp flag)
};
```

Resolution (`resolveToolGateTable`):
- `web_search` → always returns `TOOL_GATE_TABLE`
- `toolhelpOn=false` → anything else → `undefined` (exempt)
- `toolhelpOn=true` → looks up `TOOL_GATE_REGISTRY[name]`

Ungated tools (no registry entry): `web_fetch`, `device_info`, `device_calc`, `document_chat`, all miniapps.

Gate path in AppShell executeTool:
```
src/app/AppShell.tsx:1997   if (getToolGateEnabled()):
                               runToolGate({ toolName, args, lastUserMessage, memoryFacts, toolhelpOn, locale })
                             if (gate.blocked) return { text: gate.text }
```

TOOL_GATE_TABLE rules (web_search): sensitive-pattern-in-query → echo-of-context (n-gram cosine) → echo-of-memory-fact → empty-query. Block wins over warn.

## 5. Tests covering parser/gate/registry — what's missing

**Covered:**
- `toolCallParser.test.ts` — LFM2 JSON, LFM2.5 Python-call (single, multi, escaped quotes, trunc, garbage), Qwen XML, strippers (closed, unclosed, cross-delta split)
- `runToolGate.test.ts` — web_search blocked (flag on/off), calendar blocked (flag on), unregistered exempt, bare card number, warn prepend
- `toolGateRegistry.test.ts` — resolution: web_search always, calendar expand, unregistered exempt
- `evaluate.test.ts` — rule engine: priority sort, block shadow, rewrite, etc.
- `gateAuditLog.test.ts` — audit append/read/clear
- `calendarGate.test.ts` — range validation rules
- `sensitivePatternGate.test.ts` — pattern detection

**Missing (zero coverage):**
- `toolSourceLedger.ts` — `decideToolExecution`, `recordToolSuccess`, `recordToolFailure`, `accumulateToolSources`, `buildCiteInstructionSuffix`, `makeToolCallKey`, `canonicalizeArgs`, `formatToolResultContent` — **no test file exists**
- `parseToolArguments` — internal to LlamaService.ts, not exported, not tested
- `emittedCallShape` — internal to LlamaService.ts, not exported, not tested
- `shouldFireToolRoundFallback` — pure function, trivial, no dedicated test
- The entire executeTool dispatch chain in AppShell (the if/else cascade) — integration only
- Tool-result truncation logic (`formatToolResultContent` budget math) — untested

## 6. Gaps that make adding tools error-prone

### Silent misses

**KNOWN_TOOL_NAMES is hardcoded and diverges from reality.**
`toolCallTelemetry.ts:36`: `KNOWN_TOOL_NAMES = ["web_search", "web_fetch", "document_chat"]` — missing `device_info`, `device_calc`, `calendar_agenda`. Any model-emitted call to a device/calendar tool shows up as `"other"` in telemetry. Adding a tool requires updating this frozen list, but nothing enforces it.

**Tool name → executor dispatch is an if/else chain in AppShell.tsx.**
`AppShell.tsx:2010-2070`: `if (name === "web_search") ... else if (name === "web_fetch") ... else if (name === "device_info") ... else if (name === "device_calc") ... else if (name === "calendar_agenda") ... else if (name === "document_chat") ...`. A new tool name added to the `tools` array but missed in the if/else falls through silently — no error, no "unknown tool" response, just an undefined `outcome`.

**No assert: tool name in tools[] is registered in the executor.**
There is no compile-time or runtime check that every `EngineTool.function.name` has a corresponding branch in executeTool. The `emittedCallShape` function checks `namesValid` against the tools array, but that only logs to telemetry — it doesn't prevent execution or warn.

**Gate registry is a plain object with no exhaustiveness check.**
`toolGateRegistry.ts`: adding a new gated tool means adding to `TOOL_GATE_REGISTRY` AND updating `resolveToolGateTable`'s manual if-chains. Nothing fails if you add to the registry but forget the resolver (or vice versa).

### Parser fragility

**parseToolArguments is JSON.parse only.**
`LlamaService.ts:2327`: if a model emits Python-call args through the OpenAI structured path (the binding returns `function.arguments` as a JSON string), and the model actually produced `key=value` style, `JSON.parse` fails → `parseFailed=true` → args become `{}` → tool runs with empty args → usually a confusing user-facing error.

**Fallback parser silently returns `[]` on malformed payloads.**
`toolCallParser.ts:parseLfmToolCalls` — a mixed valid+malformed Python call list returns `[]` (not the valid calls). This is documented as intentional (don't mask the bug), but means one bad call in a multi-call payload silently drops ALL calls.

### Missing assertions

**No runtime check that `role: "tool"` messages have matching `tool_calls`.**
The transcript is built by appending `executed` + `skipped` arrays — if the mapping between assistant `tool_calls[].id` and tool `tool_call_id` drifts, the model gets orphaned tool results with no caller. This is only caught if the model produces incoherent output.

**No assert on tool result `kind` consistency.**
`formatToolResultContent` reads `webProvenance`/`documentProvenance` flags, which are determined by string comparison on tool name. A renamed tool loses provenance silently.

**`toolExecState.executions` counts both successes and failures toward the budget.**
A failing tool still consumes one of the 3-per-turn slots. Three consecutive failures (e.g. network down) → no tools run, no synthesis, fallback to empty text. This is by design (F3) but means a transient outage kills tool use for the entire turn.

### Patch set (minimal)

| # | What | File:line | Risk |
|---|---|---|---|
| P1 | Add missing names to `KNOWN_TOOL_NAMES` | `toolCallTelemetry.ts:36` | Telemetry only; no runtime effect |
| P2 | Add `default` branch to executeTool if/else that returns `unknownTool` | `AppShell.tsx:~2065` | Prevents silent fall-through |
| P3 | Export `parseToolArguments` + write tests for parseFailed/empty/malformed | `LlamaService.ts:2327` | Low risk; pure function |
| P4 | Add `toolSourceLedger.test.ts` covering `decideToolExecution` (all 4 paths), `makeToolCallKey` (canonicalize, parseFailed), `accumulateToolSource` (dedup, urlless) | new file | Zero runtime change |
| P5 | Add compile-time or runtime assert: every tool name in `tools[]` has a handler in executeTool | `AppShell.tsx:1957` | Prevents orphaned tools |

## Quotes

> `KNOWN_TOOL_NAMES = Object.freeze(["web_search", "web_fetch", "document_chat"])` — hardcoded, missing device/calendar tools.

> `if (toolCalls.length > 2) skippedCalls = toolCalls.slice(2)` — per-round cap, skipped calls get a "skipped" tool result in the transcript.

> `recordToolFailure(toolExecState, decision.key)` — failures consume budget; 2 fails on same key → `skip_failed_repeat`.

> `formatToolResultContent(bodyWithCite, { webProvenance: name === "web_search" || name === "web_fetch" })` — provenance tied to string name comparison.

> No `test` or `describe` block touches `toolSourceLedger.ts` — the dedup/budget/cite pipeline is entirely untested.

> The if/else dispatch (`if (name === "web_search") ... else if ... else if ... else if`) is the only thing between a model-emitted tool name and its executor. No registry, no map, no compile-time check.
