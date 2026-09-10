# C6b — `create_miniapp` Tool Call: Tool Registry × Miniapp Pipeline Map

Date: 2026-09-05 · Branch: `feat/moe-stream` · Status: READ-ONLY audit

---

## 1. Tool Registry Table

Every on-device tool flows through a single **TOOL_ENTRIES** array.

**Definition site:** `src/agent/toolRegistry.ts:82–131`

```ts
// :82
export const TOOL_ENTRIES = [
  { name: "web_search",     def: WEB_SEARCH_TOOL,    toggleKey: WEB_TOOLS_ENABLED_KEY, defaultOn: true,  gateTable: TOOL_GATE_TABLE },
  { name: "web_fetch",      def: WEB_FETCH_TOOL,     toggleKey: WEB_TOOLS_ENABLED_KEY, defaultOn: true,  gateTable: WEB_FETCH_GATE_TABLE },
  { name: "document_chat",  def: DOCUMENT_CHAT_TOOL,  toggleKey: null,                  defaultOn: true,  gateTable: null },
  { name: "write_note",     def: WRITE_NOTE_TOOL,     toggleKey: null,                  defaultOn: true,  gateTable: null },
  { name: "device_info",    def: DEVICE_INFO_TOOL,    toggleKey: DEVICE_TOOLS_KEY,      defaultOn: true,  gateTable: null },
  { name: "device_calc",    def: DEVICE_CALC_TOOL,    toggleKey: DEVICE_TOOLS_KEY,      defaultOn: true,  gateTable: null },
  { name: "calendar_agenda",def: CALENDAR_AGENDA_TOOL,toggleKey: CALENDAR_TOOLS_KEY,    defaultOn: false, gateTable: CALENDAR_GATE_TABLE },
] as const satisfies readonly ToolEntry[];
```

**Each `EngineTool`** (`src/engine/LlamaService.ts:555–562`) has shape:

```ts
type EngineTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};
```

**`parameters` IS JSON Schema** — the native overlay reads `tool.function.parameters`, calls `builder.resolve_refs(schema)` (chat.cpp:1250–1260), and derives per-tool GBNF. `src/agent/webSearchTool.ts:24–42` is a representative example.

**Tool name source of truth:** `src/agent/toolNames.ts:6–16`

```ts
export type ToolName =
  | "web_search" | "web_fetch" | "document_chat"
  | "write_note" | "device_info" | "device_calc" | "calendar_agenda";
```

**Gate registry** (`src/rules/toolGateRegistry.ts:16–29`): reads `TOOL_ENTRIES[].gateTable` into a frozen map; `resolveToolGateTable(toolName, expand)` returns the privacy rule table.

---

## 2. Tool Loop

**Entry point:** `src/engine/LlamaService.ts` — `completeChat()` starting ~:2535.

**Round loop:** `:2894`

```ts
for (let round = 0; round < (hasTools ? MAX_TOOL_ROUNDS : 1); round += 1) {
  // MAX_TOOL_ROUNDS = 3  (:437)
  // MAX_TOOL_EXECUTIONS_PER_TURN = 3  (:439)
```

**Per-round flow:**

1. **Completion call** — `engine.completion({ messages, tools, tool_choice, n_predict, … })` (:2916–2928). `tool_choice` is resolved by `resolveCompletionToolChoice()` (benchConfig.ts:531–546): `"auto"` normally; `"required"` in bench arm-a; `"none"` on final round / forceTextOnly.

2. **Structured extraction** — `result.tool_calls` from llama.rn binding. If zero, **fallback dialect parser** (`src/engine/toolCallParser.ts`, imported :67–71) scans raw text for `<tool_call>...</tool_call>` or LFM `<|tool_call_start|>` markers and parses them (:2993–3010).

3. **Normalization** — IDs normalized (`call-${round}-${index}`) (:3024–3027). Max 2 executable calls per round (:3028–3029); rest get a "skipped" stub.

4. **Per-call execution** — `options.executeTool(name, args, signal, lastUserMessage)` (:3123). Delegation chain:
   - `AppShell.tsx:2027` → toggle defense-in-depth guards → `runToolGate()` → dispatches to per-tool executor (`makeWebSearchExecutor`, `makeWebFetchExecutor`, `makeWriteNoteExecutor`, etc.).

5. **Tool result injection** — OpenAI-format `{ role: "assistant", tool_calls: [...] }` + `{ role: "tool", tool_call_id, content }` messages appended to `currentMessages` (:3212–3230). KV reproducibility marked non-reproducible (:3040).

6. **Force text-only synthesis** — after 2 successful web_search calls (:3132–3134) or on final round (:2903–2904).

**Streaming:** Tokens arrive via `onToken` callback (:2940–2951); `streamedText += delta` is streamed to UI via `callbacks.onDelta`. Tool rounds stream raw then strip `<tool_call>` markup via `createToolCallDeltaStripper()`.

---

## 3. Grammar / Constrained Decoding

**No custom grammar for tools.** Audit confirms:

> `LlamaService.ts:3463–3464`: "json_schema / grammar: llama.rn supports response_format json_schema, but small on-device models often fail grammar-constrained sampling; we rely on the balanced JSON parser instead"

**However**, the overlay already implements LFM2.5-dialect tool grammar:

> `AUDIT_MINIAPP_V2.md C2`: "The overlay already implements the LFM2.5-dialect tool grammar: `vendor/kalsallama-cpp/common/chat.cpp:1671–1776`"

**json_schema path exists but is used only for extractMemory, not tools:**

> `LlamaService.ts:3840–3841`: `response_format: { type: "json_schema", json_schema: { strict: true, schema: opts.jsonSchema } }` — used only in `completeOnce()` for memory extraction.

**Tool grammar is auto-derived:** Each `EngineTool.function.parameters` (JSON Schema) → chat.cpp `json-schema-to-grammar.h` → per-tool GBNF, fed through llama.rn's `nativeParams.grammar` / `grammar_lazy` / `grammar_triggers`. The LFM2.5 chat template wraps tool calls in `<|tool_call_start|>…<|tool_call_end|>`.

---

## 4. Miniapp Injection Path

### 4a. Current path: prose-parse (primary)

1. **Model emits** miniapp_v1 JSON inline in assistant text (inside ` ```json ` fence or as balanced `{...}`).

2. **Post-completion extraction** in `AiChatPage.tsx:2640`:
   ```ts
   const extracted = parseMiniappFromText(base.text || "");
   if (miniappStripMakesKvNonReproducible(Boolean(extracted.miniapp))) {
     miniappStripped = true;
     return { ...base, text: extracted.text, miniapp: extracted.miniapp };
   }
   ```

3. **`parseMiniappFromText()`** (`src/domain/askAssistant.js:479–532`):
   - Strategy 1: Scan ` ```json/miniapp ``` ` fenced blocks, JSON.parse, `looksLikeMiniapp()`.
   - Strategy 2: Balanced-brace scanner (`findAllMiniappSpans`) — first valid wins.
   - Strips all matched ranges from prose, returns `{ miniapp, text }`.

4. **`normalizeMiniapp()`** (`askAssistant.js:334–380`): accepts `schema: "miniapp_v1" | "aspis_miniapp_v1"` or bare `{kind, title, blocks}`. Caps: MAX_MINIAPP_BLOCKS, MAX_KIND=128, MAX_TITLE=128, MAX_MINIAPP_ACTIONS=12.

### 4b. `onMiniapp` callback (dead for local path)

> `AUDIT_MINIAPP_V2.md C12`: "LlamaService exposes onMiniapp but never emits it"

Declared at `LlamaService.ts:577`, wired at `AiChatPage.tsx:2470`:
```ts
onMiniapp: (miniapp) => {
  const normalized = normalizeMiniapp(miniapp);
  if (!normalized) return;
  updateMessage(assistantId, { miniapp: normalized }, myGen, runId);
},
```

Also wired through `AppShell.tsx:5194`:
```ts
onMiniapp: (miniapp) => callbacks.onMiniapp?.(miniapp),
```

**LlamaService never calls it.** Cloud/unified clients may. This is the cleanest hook point for C6b — a new `create_miniapp` tool executor can call `onMiniapp` directly (see §7).

### 4c. MiniappCard rendering

`AiChatPage.tsx:5450–5453`:
```tsx
<MiniappCard
  miniapp={m.miniapp}
  colors={colors}
  onOpen={onOpenMiniapp ? () => onOpenMiniapp(m.miniapp!) : undefined}
/>
```

`MiniappCard` (:5817–5875): renders icon + title + "interactive" chip + "Open" chevron. Tap calls `onOpenMiniapp` which opens the full `AskAssistantMiniappRenderer` overlay.

---

## 5. Templates Today

**`src/domain/miniappTemplates.ts`** — 3 templates, purely prompt-prefill:

```ts
export type MiniappTemplateId = "compare_data" | "quick_calculator" | "reading_quiz";

export const MINIAPP_TEMPLATES: MiniappTemplate[] = [
  { id: "compare_data",     labelKey: "quickActions.compareData",     subKey: "quickActions.compareDataSub",     promptKey: "quickActions.compareDataPrompt" },
  { id: "quick_calculator", labelKey: "quickActions.quickCalculator", subKey: "quickActions.quickCalculatorSub", promptKey: "quickActions.quickCalculatorPrompt" },
  { id: "reading_quiz",     labelKey: "quickActions.readingQuiz",     subKey: "quickActions.readingQuizSub",     promptKey: "quickActions.readingQuizPrompt" },
];
```

**Flow:** `QuickActionSheet` (templates mode) → `handleChooseTemplate` → `setDraft(t(template.promptKey))` → user sends prompt → model generates miniapp JSON in prose.

**No programmatic builder exists.** Templates are purely human-readable prompt strings. There is no code that converts a template id + slot values → `miniapp_v1` JSON.

---

## 6. Gaps for C6b `create_miniapp` Tool

### 6a. Missing pieces

| Gap | Detail |
|-----|--------|
| **No tool definition** | `create_miniapp` does not appear anywhere in the codebase (`grep` returns zero hits). |
| **No tool registry entry** | TOOL_ENTRIES, toolNames.ts, ALL_TOOL_NAMES, assembleTools — all need a new row. |
| **No tool executor** | No `createMiniappTool.ts` / `makeCreateMiniappExecutor`. |
| **No builder function** | Template id + slots → `miniapp_v1` JSON does not exist. All current miniapp generation is via model prose. |
| **No i18n prompt instruction** | System prompts (`en.ts:1040, 1072, 1109`) don't mention `create_miniapp` tool. |
| **`onMiniapp` never called by local path** | The callback exists and is wired but never emitted. A tool executor must call it or write to message state. |
| **toolGate** | Needs a `RuleTable` if gated (likely ungated for MVP, like `write_note`). |

### 6b. Files to touch

| File | Change |
|------|--------|
| `src/agent/toolNames.ts` | Add `"create_miniapp"` to `ToolName` union + `ALL_TOOL_NAMES`. |
| `src/agent/toolRegistry.ts` | Add `TOOL_ENTRIES` row (toggleKey: `null`, defaultOn: `true`, gateTable: `null`). |
| `src/agent/createMiniappTool.ts` | **NEW** — `CREATE_MINIAPP_TOOL` definition + `makeCreateMiniappExecutor`. |
| `src/app/AppShell.tsx` | Add `executeTool` branch for `"create_miniapp"` (~:2027). |
| `src/domain/miniappTemplates.ts` | Add builder: `buildMiniappV1(templateId, slots) → miniapp_v1`. |
| `src/i18n/en.ts` + `it.ts` | Add tool description string + `quickActions.*` keys if new templates. |
| `src/rules/toolGateRegistry.ts` | No change needed if ungated (like write_note). |
| Tests: `toolRegistry.test.ts`, `miniappActions.smoke.test.ts` | Invariant check for new name, builder smoke test. |

---

## 7. Recommended C6b MVP (≤1 PR)

### Tool args schema

```ts
{
  type: "object",
  properties: {
    template: {
      type: "string",
      enum: ["compare_data", "quick_calculator", "reading_quiz"],
      description: "Which miniapp template to build.",
    },
    slots: {
      type: "object",
      description: "Template-specific key-value slots (e.g. {title, columns, formula}).",
      additionalProperties: true,
    },
  },
  required: ["template"],
}
```

**Rationale:** Enum of known template ids keeps grammar tight (5-token vocab for the template field). `slots` is a free object — small models can fill it; validation happens in the builder, not the grammar. The model chooses template + provides data in one call.

### Client builder location

**`src/domain/miniappTemplates.ts`** — add `buildMiniappV1(id, slots): AskAssistantMiniapp | null`:

- `compare_data`: slots `{title?, columns: string[], rows: Record<string,unknown>[]}`
- `quick_calculator`: slots `{title?, fields: {id,label,value}[], formula}`
- `reading_quiz`: slots `{title?, question, options: string[], answerIndex, explanation?}`

Returns `null` on invalid slots → executor returns an error message, not a broken miniapp.

### Where the tool result goes

Two options; **recommend Option A** for MVP:

**Option A — Direct onMiniapp callback (stateless):**
- `makeCreateMiniappExecutor` receives `onMiniapp` callback.
- On success: calls `onMiniapp(miniapp)` AND returns `{ text: "Miniapp created: {title}" }`.
- `AiChatPage.tsx:2470` already wires `onMiniapp` → `normalizeMiniapp` → `updateMessage`.
- Result text goes into the tool message for the model's synthesis round.
- **No new state, no new renderer path.**

**Option B — Attach to message as miniapp field during tool execution:**
- More complex; needs message mutation inside executor.
- Skip for MVP.

### Keep prose-parse as fallback?

**Yes.** `parseMiniappFromText` at `AiChatPage.tsx:2640` runs unconditionally on final assistant text. If the model emits miniapp JSON in prose (old path), it still works. The `create_miniapp` tool is a *preferred* path, not a replacement. The prose fallback handles:
- Models that haven't learned the tool
- Edge cases where template enum doesn't cover the need
- Legacy behavior during rollout

### Minimal PR surface

1. `toolNames.ts` + `toolRegistry.ts` — 2 lines + 7 lines
2. `createMiniappTool.ts` — ~80 lines (definition + executor with `buildMiniappV1` inline or imported)
3. `AppShell.tsx` — ~15 lines (executeTool branch)
4. `miniappTemplates.ts` — ~60 lines (3 builder functions)
5. `en.ts` + `it.ts` — ~6 lines (tool description)
6. Tests — ~40 lines

**Total: ~200 lines.** Single PR, no schema migration, no new UI components.

---

## 8. Summary: Data Flow for C6b

```
User sends message
  → LlamaService completion loop (MAX_TOOL_ROUNDS=3)
    → Model emits: tool_call { name: "create_miniapp", arguments: { template: "quick_calculator", slots: {...} } }
    → AppShell.executeTool dispatches to makeCreateMiniappExecutor
      → buildMiniappV1("quick_calculator", slots) → miniapp_v1 JSON
      → onMiniapp(miniapp) → normalizeMiniapp → updateMessage({ miniapp })
      → returns { text: "Miniapp created: Quick Calculator" }
    → Tool result injected into transcript
    → Next round: model synthesizes text response
  → AiChatPage renders message
    → message.miniapp exists → MiniappCard shown inline
    → Tap "Open" → onOpenMiniapp → AskAssistantMiniappRenderer overlay
```

Prose-parse fallback still runs on the final assistant text (`AiChatPage.tsx:2640`) but `base.miniapp` guard (:2639: `if (base.miniapp) return base;`) prevents double-extraction.
