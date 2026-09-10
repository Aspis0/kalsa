# B6 — Developer Experience Gaps for Adding Tools

Repo: `kalsa` · Branch: `feat/moe-stream`  
Date: 2026-09-04

---

## 1. Current state

**Five tools exist.** Every one was added by manually touching 3–5 files with no centralised checklist:

| Touchpoint | Files | What happens |
|---|---|---|
| Tool definition | `src/agent/deviceTools.ts`, `webSearchTool.ts`, `calendarTool.ts`, `webFetchTool.ts`, `src/documents/documentChatTool.ts` | `export const FOO_TOOL: EngineTool` — all structurally identical shape, but two use local `WebFetchToolDef` / `DocumentChatToolDef` aliases instead of importing `EngineTool` from LlamaService |
| Assembly | `src/app/AppShell.tsx:1948` | Inline spread: `...(toggle ? [FOO_TOOL] : [])` |
| Dispatch | `src/app/AppShell.tsx:2000–2080` | `if (name === "foo") { ... }` chain, ~80 lines, mixed side-effects |
| Toggle guard | `src/app/AppShell.tsx:2003` | Hardcoded `name === "foo"` inside defence-in-depth block |
| AsyncStorage key | `src/agent/toolToggles.ts` | `kalsa.tools.device`, `kalsa.tools.calendar` — only for opt-in tools |
| Gate table | `src/rules/toolGateRegistry.ts` | `TOOL_GATE_REGISTRY[name] = TABLE` — only 2 of 5 tools registered |
| i18n errors | `src/i18n/en.ts:668–685`, `it.ts` | Tool-specific error strings (`emptySearchQuery`, `calendarDenied`, …) |

**There is no contributor doc, no name union, no registration function, no test that exercises the "add a tool" path.**

### Quotes

> `"// HIGH-5: omit web tools when the user toggled Web off. document_chat always stays available so library attachments keep working offline."`  
> — AppShell.tsx:1946. Inline comment that is the only "design rationale" for the toggle assembly.

> `"/** Per-tool rule tables. Resolution is the only extension point: add an entry to register a new gated tool. Unregistered names (miniapps, document_chat, …) are exempt by construction. */"`  
> — toolGateRegistry.ts:1. Closest thing to contributor guidance. Does not mention how to add a tool, only how to add a gate.

> `"/** Structural match for EngineTool (avoid importing LlamaService in the harness). */"`  
> — webFetchTool.ts:53, documentChatTool.ts:43. Two tools duplicate the type because the canonical `EngineTool` lives in a 3300-line engine file with React Native deps.

---

## 2. Gaps identified

### G2.1 — No single source of truth for tool names
Tool names (`"device_info"`, `"web_search"`, …) are bare strings in 6+ locations. A typo in `executeTool`'s `if` chain silently falls through to `unknownTool`.

### G2.2 — No name-to-executor mapping
Dispatch is an 80-line `if/else if` chain with side-effects (`privateSearchLatchSeq`, `calendarExtractSkipSeq`) woven in. Adding a new tool means reading this chain to find where to splice.

### G2.3 — No type narrowing on tool arguments
`executeTool` receives `Record<string, unknown>` for every tool. Each tool module manually guards `typeof args.expression === "string"`. No per-tool input type.

### G2.4 — Toggle logic is ad-hoc
Each opt-in tool invents its own `kalsa.tools.X` key + `parseToolToggle` call. Guard clauses are duplicated in AppShell's defence-in-depth block. A new tool that needs a toggle must replicate 3 code sites.

### G2.5 — Gate registry is sparse
Only `web_search` and `calendar_agenda` have `RuleTable`s. Other tools are exempt by omission. No documentation on when/why a tool should have a gate.

### G2.6 — No "adding a tool" checklist
A new contributor must reverse-engineer the pattern from existing tools. The 3300-line `LlamaService.ts` is not the right doc surface.

---

## 3. Proposal: `src/agent/toolRegistry.ts`

**Smallest diff that eliminates G2.1 + G2.2 + G2.4.** Does NOT move executors or rewrite dispatch — creates a data layer that AppShell reads.

### What it contains

```ts
// src/agent/toolRegistry.ts

import type { EngineTool } from "../engine/LlamaService";

export type ToolName =
  | "device_info"
  | "device_calc"
  | "web_search"
  | "web_fetch"
  | "calendar_agenda"
  | "document_chat";

export type ToolEntry = {
  name: ToolName;
  def: EngineTool;
  /** AsyncStorage key for opt-in toggle, or null if always-on. */
  toggleKey: string | null;
  /** Default state when no AsyncStorage value. false = off-by-default. */
  defaultOn: boolean;
  /** Gate table name (key in toolGateRegistry) or null if ungated. */
  gateTable: string | null;
};

export const TOOL_ENTRIES: readonly ToolEntry[] = [
  { name: "device_info",    def: DEVICE_INFO_TOOL,    toggleKey: "kalsa.tools.device",    defaultOn: true,  gateTable: null },
  { name: "device_calc",    def: DEVICE_CALC_TOOL,    toggleKey: "kalsa.tools.device",    defaultOn: true,  gateTable: null },
  { name: "web_search",     def: WEB_SEARCH_TOOL,     toggleKey: "kalsa.tools.web",       defaultOn: true,  gateTable: "web_search" },
  { name: "web_fetch",      def: WEB_FETCH_TOOL,      toggleKey: "kalsa.tools.web",       defaultOn: true,  gateTable: null },
  { name: "calendar_agenda",def: CALENDAR_AGENDA_TOOL, toggleKey: "kalsa.tools.calendar",  defaultOn: false, gateTable: "calendar_agenda" },
  { name: "document_chat",  def: DOCUMENT_CHAT_TOOL,   toggleKey: null,                    defaultOn: true,  gateTable: null },
] as const;

/** Unique toggle keys for AsyncStorage reads. */
export const UNIQUE_TOGGLE_KEYS = [...new Set(TOOL_ENTRIES.map(t => t.toggleKey).filter(Boolean))];

/** Name set for quick membership checks. */
export const TOOL_NAME_SET: ReadonlySet<ToolName> = new Set(TOOL_ENTRIES.map(t => t.name));
```

### Why this is enough

1. **G2.1 solved**: `ToolName` union is the single source of truth. TypeScript catches misspelled tool names at compile time.
2. **G2.2 partially solved**: `TOOL_ENTRIES` provides the name→def mapping. The `if/else` chain in AppShell can be replaced by `TOOL_ENTRIES.find(e => e.name === name)?.def` for the schema array — no executor change needed.
3. **G2.4 solved**: `toggleKey` + `defaultOn` replaces the ad-hoc `parseToolToggle` calls. AppShell reads one `UNIQUE_TOGGLE_KEYS` set, not three individual AsyncStorage keys.
4. **G2.5 documented**: `gateTable` field makes the gate registration explicit per tool.
5. **Zero behaviour change**: The actual executor `if/else` chain stays. The toggle reads can be migrated one-by-one. The i18n strings are untouched.

### AppShell changes (minimal)

```diff
// AppShell.tsx ~line 1948 — tools array
- const tools = [
-   ...(webToolsEnabled ? [WEB_SEARCH_TOOL, WEB_FETCH_TOOL] : []),
-   DOCUMENT_CHAT_TOOL,
-   ...(deviceToolsEnabled ? [DEVICE_INFO_TOOL, DEVICE_CALC_TOOL] : []),
-   ...(calendarToolsEnabled ? [CALENDAR_AGENDA_TOOL] : []),
- ];
+ const tools = TOOL_ENTRIES
+   .filter(e => !e.toggleKey || resolveToggle(e.toggleKey, e.defaultOn))
+   .map(e => e.def);
```

This replaces the manual spread with a single declarative line. The executor `if/else` chain stays unchanged for now.

---

## 4. What NOT to rewrite

| Area | Why |
|---|---|
| `LlamaService.ts` (3300 lines) | Too risky. The engine job lock, tool loop, and prewarm logic are load-bearing. Don't touch in B6. |
| Executor `if/else` chain | Migrating to a dispatch table requires unwinding side-effects (`privateSearchLatchSeq`, `calendarExtractSkipSeq`). That's a separate slice (B7?). |
| `EngineTool` type location | Moving it out of LlamaService would break every tool file. Add an `src/agent/engineToolType.ts` re-export in B6 only if the harness dependency is the blocker. |
| Gate tables (`toolGate.ts`, `calendarGate.ts`) | Working. Leave them. |
| Tool-specific executors | Each tool's `run*` / `make*Executor` is self-contained and well-factored. Don't touch. |

---

## 5. Luna checklist — B6 slice

### Must-have

- [ ] Create `src/agent/toolRegistry.ts` with `ToolName` union, `TOOL_ENTRIES` array, `TOOL_NAME_SET`
- [ ] Import `TOOL_ENTRIES` in AppShell, replace manual `tools` array spread
- [ ] Compile check: `tsc --noEmit` passes with no new errors
- [ ] Existing test suite passes (no behaviour change)

### Nice-to-have (if time permits)

- [ ] Add `TOOL_ENTRIES.find(e => e.name === name)` guard in defence-in-depth block (replaces three `if` clauses)
- [ ] Add `resolveToolGateTable` to read from `TOOL_ENTRIES[].gateTable` instead of the manual switch
- [ ] One sentence in `ARCHITECTURE.md`: "To add a tool: define in src/agent/, register in toolRegistry.ts, add executor branch in AppShell"
- [ ] Re-export `EngineTool` from `src/agent/engineToolType.ts` so harness-compatible tools don't import from LlamaService

### Do NOT do in B6

- Rewrite the executor dispatch to a data-driven table
- Move `EngineTool` type out of LlamaService
- Add a plugin/dynamic-loading mechanism
- Touch any tool's internal implementation

---

## 6. Files to touch

| File | Change |
|---|---|
| `src/agent/toolRegistry.ts` | **New** — registry + types |
| `src/app/AppShell.tsx` | Import registry, replace `tools` array (~10 lines) |
| `ARCHITECTURE.md` | One-paragraph "Adding a tool" note (nice-to-have) |

## 7. Risk

**Zero.** The `TOOL_ENTRIES` array is pure data. AppShell reads it the same way it read the manual spread. No executor path changes. No engine changes. If the registry is wrong (e.g. a tool is missing), `tsc` catches it because `ToolName` is a union checked against `TOOL_ENTRIES` keys.

---

## Summary

| Question | Answer |
|---|---|
| Is there a registry? | No. Five tools, five manual touch points, no centralisation. |
| Contributor docs? | None. Closest is a comment in `toolGateRegistry.ts`. |
| Can a `toolRegistry.ts` help? | Yes — `ToolName` union + `TOOL_ENTRIES` array solves G2.1/G2.2/G2.4 with ~40 lines. |
| What NOT to rewrite? | LlamaService, executor chain, gate tables, tool internals. |
| Luna checklist | 4 must-have items (registry file, AppShell import, tsc pass, tests pass). |
