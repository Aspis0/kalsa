# B6 Tool-call infrastructure — registry & wiring

Baseline: LOT-B §B6 (file not in repo; map is ground-truth from source).

---

## 1. EngineTool type + where tools[] is assembled

**Type definition** — `src/engine/LlamaService.ts:533-541`
```ts
export type EngineTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};
```

**EngineTurnOptions** — `src/engine/LlamaService.ts:562-569`
```ts
tools?: EngineTool[];
executeTool?: (name, args, signal?, lastUserMessage?) => Promise<EngineToolResult>;
```

**Assembly site** — `src/app/AppShell.tsx:1948-1952`
```ts
const tools = [
  ...(webToolsEnabled ? [WEB_SEARCH_TOOL, WEB_FETCH_TOOL] : []),
  DOCUMENT_CHAT_TOOL,
  ...(deviceToolsEnabled ? [DEVICE_INFO_TOOL, DEVICE_CALC_TOOL] : []),
  ...(calendarToolsEnabled ? [CALENDAR_AGENDA_TOOL] : []),
];
```

Returned in `useMemo` at line 1948, consumed by LlamaService via `agentOptionsRef`.

---

## 2. Every registered tool + toggle flags

| Tool constant | `name` | Source file | Toggle | Default |
|---|---|---|---|---|
| `WEB_SEARCH_TOOL` | `web_search` | `src/agent/webSearchTool.ts:22` | `webToolsEnabled` | **ON** |
| `WEB_FETCH_TOOL` | `web_fetch` | `src/agent/webFetchTool.ts:148` | `webToolsEnabled` | **ON** |
| `DOCUMENT_CHAT_TOOL` | `document_chat` | `src/documents/documentChatTool.ts:222` | *(none — always on)* | — |
| `DEVICE_INFO_TOOL` | `device_info` | `src/agent/deviceTools.ts:7` | `deviceToolsEnabled` | **ON** |
| `DEVICE_CALC_TOOL` | `device_calc` | `src/agent/deviceTools.ts:20` | `deviceToolsEnabled` | **ON** |
| `CALENDAR_AGENDA_TOOL` | `calendar_agenda` | `src/agent/calendarTool.ts:16` | `calendarToolsEnabled` | **OFF** |

**Toggle persistence** — `src/agent/toolToggles.ts` (entire file, 15 lines). Keys:
- `kalsa.tools.device` → `parseToolToggle(raw, true)`
- `kalsa.tools.calendar` → `parseToolToggle(raw, false)`

Web tools toggle: loaded inline at `src/app/AppShell.tsx:690` via AsyncStorage key (not in `toolToggles.ts`).

**Tool gate registry** — `src/rules/toolGateRegistry.ts:13-15`
```ts
const TOOL_GATE_REGISTRY = {
  web_search: TOOL_GATE_TABLE,
  calendar_agenda: CALENDAR_GATE_TABLE,
};
```
Only `web_search` is ungated; `calendar_agenda` is gated behind `expand` (toolhelp flag). Other tools are exempt by construction.

---

## 3. executeTool dispatch switch

All in `src/app/AppShell.tsx`, inside `useMemo` closure (~lines 1962-2070).

**Defense-in-depth toggle guards** (lines 1969-1988):
- `!webToolsEnabledRef.current && (web_search | web_fetch)` → `unknownTool`
- `!deviceToolsEnabledRef.current && (device_info | device_calc)` → `unknownTool`
- `!calendarToolsEnabledRef.current && calendar_agenda` → `unknownTool`
- `web_search && privateSearchLatchSeq === fetchAllowlistTurnSeq` → `searchSkippedPrivate`

**Tool gate** (lines 1996-2005): `runToolGate()` called for every tool when gate enabled; short-circuits if `kalsa.bench.toolgate=0`.

**Dispatch chain** (lines 2009-2067):
```
if web_search       → searchExec(...)     + seed allowlist from sources
else if web_fetch   → fetchExec(...)
else if device_info → readDeviceInfo()    + formatDeviceInfoResult()
else if device_calc → runDeviceCalc()     (pure, no I/O)
else if calendar_agenda → runCalendarAgenda()
else if document_chat  → documentExec()  + vision_fallback normalization
else                 → unknownTool error
```

**No fallthrough.** Each branch assigns `outcome` and breaks. Final: `applyWarnToResult(outcome, gate.warnNote)`.

**Engine-side loop** — `src/engine/LlamaService.ts:2795-3122`: model emits tool_calls → LlamaService calls `options.executeTool(name, args, signal, lastUserMessage)` in a loop until no more tool_calls. Error propagation: tool exceptions bubble to the engine which surfaces them as user-visible text.

---

## 4. How a NEW tool is added today (exact steps)

1. **Create tool file** — `src/agent/myNewTool.ts` (or `src/documents/` for doc-adjacent). Export `MY_NEW_TOOL: EngineTool` constant with `type:"function"`, `function.name`, description, JSON Schema parameters.

2. **Create executor** — either inline in the same file (`makeMyNewExecutor(locale)`) or a standalone function. Must return `Promise<EngineToolResult>`.

3. **Add toggle** (if gated) — add AsyncStorage key to `src/agent/toolToggles.ts`, add `useState`/`useRef` pair in AppShell (~line 690), wire into `parseToolToggle` read at mount.

4. **Import in AppShell** — `src/app/AppShell.tsx` top imports.

5. **Add to `tools` array** — line ~1948, conditional spread if togglable.

6. **Add to dispatch switch** — lines ~2009-2067, add `else if (name === "my_new_tool")` branch.

7. **Add toggle guard** — defense-in-depth block at lines ~1969-1988 (even if tool is in the schema, refuse if toggle flipped).

8. **Wire prefix prewarm** — the `useEffect` at ~line 2090 already depends on `[locale, webToolsEnabled, deviceToolsEnabled, calendarToolsEnabled]`. Must add new toggle dep.

9. **(Optional) Tool gate** — add entry to `src/rules/toolGateRegistry.ts` + define gate table.

10. **(Optional) Telemetry** — add kind tag in `src/engine/turnTelemetry.ts` `ToolRetrievalStrategy` union if tool has retrieval semantics.

**Pain points:**
- 3 separate locations must stay in sync: `tools[]` array, `executeTool` switch, toggle guard block.
- Toggle boilerplate is copy-paste (useState + useRef + ref.current sync + AsyncStorage read + SettingsScreen UI).
- No tool registry abstraction — each tool is a free-standing export; the "registry" is the array literal in a useMemo.
- `toolToggles.ts` only covers device/calendar; web toggle is handled differently (inline state).

---

## 5. Gaps

### Duplication
| Gap | Location | Impact |
|---|---|---|
| `DocumentChatToolDef` and `WebFetchToolDef` are identical structural copies of `EngineTool` | `documentChatTool.ts:44`, `webFetchTool.ts:54` | Unnecessary type divergence; both are `{type:"function", function:{name,description,parameters}}` |
| `mapExaSourcesToChat` is a deprecated alias for `mapSearchSourcesToChat` | `webSearchTool.ts:166` | Dead export, zero callers in src/ |

### Missing types
| Gap | Location | Impact |
|---|---|---|
| `EngineToolResult.kind` is `string \| undefined` — no union | `LlamaService.ts:549` | No compile-time exhaustiveness when switching on tool kind |
| `EngineToolResult.strategy` uses `Exclude<ToolRetrievalStrategy, null>` but `kind` has no equivalent typed union | `LlamaService.ts:548` | Inconsistent provenance tagging |

### Hard-to-extend patterns
| Gap | Location | Impact |
|---|---|---|
| `tools[]` array + `executeTool` switch + toggle guard are 3 manually-synced sites | `AppShell.tsx:1948, 2009-2067, 1969-1988` | Adding a tool requires touching 3 places; easy to miss the guard or switch case |
| Web toggle lives outside `toolToggles.ts` (inline useState at line 690) | `AppShell.tsx:690` | Inconsistent toggle pattern — 2 tools use `toolToggles.ts`, web uses raw state |
| `privateSearchLatchSeq` / `calendarExtractSkipSeq` are module-level mutable lets | `AppShell.tsx:509-511` | Hidden state coupling between web_search and calendar_agenda; not testable in isolation |
| `resolveToolGateTable` hardcodes tool names as if/else | `toolGateRegistry.ts:21-25` | Registry is a Record but resolver ignores it for `web_search`; dead pattern |

### Dead code
| Item | Location | Status |
|---|---|---|
| `mapExaSourcesToChat` | `webSearchTool.ts:166` | `@deprecated`, zero callers in src/ |
| `DocumentChatToolDef` type | `documentChatTool.ts:44` | Structurally identical to `EngineTool`; used only once (line 222) |
| `WebFetchToolDef` type | `webFetchTool.ts:54` | Same — structurally identical to `EngineTool`; used only once (line 148) |

---

## 6. Verdict

**Already solid:**
- Pure executor pattern for web_fetch, document_chat, device tools (host-injected, testable).
- Defense-in-depth toggle guards (schema + runtime refusal).
- Tool gate registry with per-tool rule tables and audit log.
- Allowlist-based fetch privacy (per-turn, seeded from search + user message).
- Engine loop handles tool_calls with abort propagation.

**Gaps ordered by value:**

1. **Three-site sync for add-tool** (tools[] + switch + guard) — highest friction, highest bug surface.
2. **Inconsistent toggle infrastructure** — web toggle outside `toolToggles.ts`, device/calendar inside.
3. **Duplicate type aliases** (`DocumentChatToolDef`, `WebFetchToolDef`) — cosmetic but confusing.
4. **Module-level mutable state** (`privateSearchLatchSeq`, `calendarExtractSkipSeq`) — hidden coupling.
5. **`resolveToolGateTable` hardcodes** — registry Record exists but resolver bypasses it.
6. **Dead `mapExaSourcesToChat`** — trivial cleanup.

---

## 7. Minimal patch set (cleaner add-tool DX, no engine rewrite)

| Patch | Files touched | Risk |
|---|---|---|
| **P1: Tool descriptor record** — create `src/agent/toolRegistry.ts` exporting `ALL_TOOLS: Record<string, { def: EngineTool, toggle?: string, gateTable?: RuleTable }>` | New file + `AppShell.tsx` (replace 3 sites with single lookup) | Low — mechanical refactor |
| **P2: Unify toggle infra** — move web toggle into `toolToggles.ts` with a `WEB_TOOLS_KEY`; AppShell reads via `parseToolToggle` like device/calendar | `toolToggles.ts`, `AppShell.tsx` | Low |
| **P3: Kill duplicate types** — replace `DocumentChatToolDef` and `WebFetchToolDef` with `EngineTool` | `documentChatTool.ts`, `webFetchTool.ts` | Zero-risk |
| **P4: Delete `mapExaSourcesToChat`** | `webSearchTool.ts` | Zero-risk |
| **P5: Fix `resolveToolGateTable`** — remove hardcoded if/else, use Record lookup directly | `toolGateRegistry.ts` | Low |

**Out of scope:**
- Typed `EngineToolResult.kind` union (requires touching every tool + telemetry; value is marginal for 6 tools).
- Moving `privateSearchLatchSeq`/`calendarExtractSkipSeq` into a state machine (would require refactoring AppShell module scope; high blast radius for low payoff).
- Engine-side tool registration API (LlamaService pass-through is fine as-is).
