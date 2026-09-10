# B4 Tool Wire Map: `write_note` via B6 Registry

**Date:** 2026-09-04  
**Branch:** feat/moe-stream  
**Checklist source:** `src/agent/toolRegistry.ts` lines 7–33 (B6 contributor checklist)

---

## 0. Proof: No Existing Note-Writing Tool

**`document_chat` is read-only.**  
Quote (`src/documents/documentChatTool.ts` ~L130):
> "Query a local PDF or TXT document from the user's library. Pass a specific question as query."

Its executor only calls `host.requestPdfText` and `host.readTxt` — never writes.

**`NotesStore.saveNote` exists but is UI-only.**  
Quote (`src/app/AppShell.tsx` L189):
> `import { saveNote } from "../notes/NotesStore";`  
Quote (`src/app/AppShell.tsx` L2914):
> `const note = await saveNote(text);`

This is the "Save to notes" button on assistant messages (AiChatPage.tsx L4223). **No agent tool wraps `saveNote`.** The LLM cannot create notes today.

---

## 1. Recommended Tool Name

**`write_note`** — not `create_note`. Rationale:
- Mirrors the verb-noun pattern already used: `web_search`, `web_fetch`, `device_calc`, `calendar_agenda`
- `write` is the operative verb; the LLM is *writing* content, not just *creating* a shell
- Avoids ambiguity with "create" (could mean create a file, open a UI, etc.)

---

## 2. JSON Schema (EngineTool shape)

Mirrors `calendarTool.ts` / `deviceTools.ts` — minimal, no optional fields.

```ts
// src/agent/writeNoteTool.ts

import type { EngineTool, EngineToolResult } from "../engine/LlamaService";

export const WRITE_NOTE_TOOL: EngineTool = {
  type: "function",
  function: {
    name: "write_note",
    description:
      "Create or update a local markdown note on this device. " +
      "Pass title (shown in the Notes list) and body (markdown content). " +
      "To update an existing note, also pass noteId. " +
      "Do not pass this output to web_search.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Note title, shown in the Notes list. Required.",
        },
        body: {
          type: "string",
          description: "Markdown content of the note. Required.",
        },
        noteId: {
          type: "string",
          description:
            "Existing note id to update. Omit to create a new note.",
        },
      },
      required: ["title", "body"],
    },
  },
};
```

**Why `title` is required (not optional):** `NotesStore.titleFromNoteBody` auto-extracts the first line, but an explicit `title` parameter gives the LLM control over how the note appears in the list. The executor can still fall back to `titleFromNoteBody(body)` if the LLM passes an empty string, but requiring it in the schema makes the tool contract clear.

**Return shape** (mirrors `calendarTool` / `deviceTools` — JSON string):
```ts
{
  text: JSON.stringify({ id: "note-1725400000-abc123", title: "My Note", ok: true }),
  kind: "write_note",
}
```
On error:
```ts
{
  text: getStrings(locale).errors.writeNoteFailed,
  kind: "write_note",
  error: "write_failed",
}
```

---

## 3. `toolNames.ts` / `ALL_TOOL_NAMES` Wire Order

**File:** `src/agent/toolNames.ts`

`write_note` should go **after `document_chat` and before `device_info`**, grouping document/note tools together.

```ts
export type ToolName =
  | "web_search"
  | "web_fetch"
  | "document_chat"
  | "write_note"          // ← NEW
  | "device_info"
  | "device_calc"
  | "calendar_agenda";

export const ALL_TOOL_NAMES = Object.freeze([
  "web_search",
  "web_fetch",
  "document_chat",
  "write_note",           // ← NEW
  "device_info",
  "device_calc",
  "calendar_agenda",
] as const satisfies readonly ToolName[]);
```

**Why this position:** The existing order groups web tools → local document tool → device tools → calendar. `write_note` is a local document-adjacent tool (writes to the same `kalsa-notes/` directory the Notes screen reads from), so it sits right after `document_chat`.

---

## 4. `TOOL_ENTRIES` Row

**File:** `src/agent/toolRegistry.ts`

```ts
import { WRITE_NOTE_TOOL } from "./writeNoteTool";
// No new toggleKey import needed — see argument below.

{
  name: "write_note",
  def: WRITE_NOTE_TOOL,
  toggleKey: null,        // ← always-on, no toggle
  defaultOn: true,
  gateTable: null,        // ← no privacy gate needed (see §4a)
}
```

### §4a: Why `toggleKey: null` and `gateTable: null`

**No toggle (always-on).** Argument:
- `document_chat` is always-on (`toggleKey: null, defaultOn: true` — toolRegistry.ts L93–97). `write_note` is the write-side companion to the same local notes subsystem.
- Notes are purely local (`documentDirectory/kalsa-notes/<id>.md` — NotesStore.ts L14). No network, no cloud sync, no privacy escalation.
- The user already has a "Save to notes" button in the chat UI (AiChatPage.tsx L4223). Exposing it as a tool doesn't change the privacy surface — the LLM can only write what the user typed.

**No gate table.** Argument:
- `CALENDAR_GATE_TABLE` exists because calendar events can contain private names/locations that could leak via `web_search`. `write_note` writes locally only — the output goes into a local file, not to the model or network.
- `TOOL_GATE_TABLE` (web_search) and `WEB_FETCH_GATE_TABLE` gate cross-network exfiltration. `write_note` has no network path.
- `document_chat` has `gateTable: null` for the same reason — local read only. `write_note` is local write only.

---

## 5. AppShell Changes

**File:** `src/app/AppShell.tsx`

### 5a. Import the tool def

```ts
import { WRITE_NOTE_TOOL } from "../agent/writeNoteTool";
```

### 5b. `assembleTools` — no change needed

`assembleTools` reads from `TOOL_ENTRIES` and the `flags` object. Since `toggleKey: null` and `defaultOn: true`, `write_note` is always included. **No new flag needed.**

The existing `flags` type in `assembleTools` (`{ web: boolean; device: boolean; calendar: boolean }`) does not need a `notes` field — `write_note` has no toggle.

### 5c. `executeTool` branch

Add after the `document_chat` branch (inside the `else if` chain, ~L2010):

```ts
} else if (name === "write_note") {
  const raw = args && typeof args === "object" ? args : {};
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  const noteId = typeof raw.noteId === "string" ? raw.noteId.trim() : undefined;

  if (!body) {
    outcome = {
      text: getStrings(locale).errors.writeNoteEmptyBody,
      kind: "write_note",
      error: "empty_body",
    };
  } else {
    try {
      const saved = await saveNote(body, noteId || undefined);
      // Use provided title, or fall back to the title NotesStore derived.
      const finalTitle = title || saved.title;
      outcome = {
        text: JSON.stringify({ id: saved.id, title: finalTitle, ok: true }),
        kind: "write_note",
      };
    } catch {
      outcome = {
        text: getStrings(locale).errors.writeNoteFailed,
        kind: "write_note",
        error: "write_failed",
      };
    }
  }
```

### 5d. Defense-in-depth guard

**Not needed.** `write_note` has no toggle (`toggleKey: null`). The defense-in-depth pattern (AppShell.tsx ~L1967–1983) only applies to toggled tools where a stale tool schema could still be in the context:

```ts
// These guards exist because web/device/calendar tools have toggles:
if (!webToolsEnabledRef.current && (name === "web_search" || name === "web_fetch")) { ... }
if (!deviceToolsEnabledRef.current && (name === "device_info" || name === "device_calc")) { ... }
if (!calendarToolsEnabledRef.current && name === "calendar_agenda") { ... }
```

Since `write_note` is always-on, no guard is needed. The tool is always in the schema and always allowed to execute.

---

## 6. Settings UI Toggle

**Recommendation: No toggle. Always-on.**

Rationale:
- `document_chat` is always-on (`toggleKey: null`). `write_note` is its write-side counterpart in the same local subsystem.
- Notes are already fully accessible via the Notes screen (drawer → Notes). Making the tool toggleable adds UI complexity for zero privacy benefit — the user can already create notes manually.
- Every toggle requires: a new `ToolToggleKey` in `toolToggles.ts`, AsyncStorage read/write in AppShell, a Settings switch, defense-in-depth guard, i18n strings for the toggle label/hint, and a test for the off-state assembly. That's ~40 lines of boilerplate for a local-only tool.

If the team later decides to add a toggle (e.g., to prevent the LLM from writing notes without explicit permission), the checklist items would be:
- `src/agent/toolToggles.ts`: add `NOTES_TOOLS_KEY = "kalsa.tools.notes"` and extend `ToolToggleKey`
- `src/screens/SettingsScreen.tsx`: add a Switch + label/hint (mirror calendar toggle pattern at L1706–1717)
- `src/app/AppShell.tsx`: add `notesToolsEnabled` state, `refreshToolFlags` read, defense-in-depth guard

---

## 7. i18n Errors

**File:** `src/i18n/en.ts` (and mirror in `src/i18n/it.ts`)

Add under `errors`:

```ts
writeNoteEmptyBody: "write_note requires a non-empty body.",
writeNoteFailed: "Could not save the note.",
```

Optionally under `settings` (only if adding a toggle — see §6):

```ts
notesTools: "Notes tool",
notesToolsHint: "Let the assistant create and update local markdown notes.",
```

The `notes.*` keys already exist (en.ts L972–987) for the Notes screen UI. The tool errors go in `errors.*` following the `documentChat*` pattern.

---

## 8. Tests That Must Flip/Add After B6 Invariants

**File:** `src/agent/toolRegistry.test.ts`

### 8a. Update the "lists all six live tool names" test

The existing test (L32–39) asserts exact order:
```ts
test("lists all six live tool names", () => {
  expect(ALL_TOOL_NAMES).toEqual([
    "web_search", "web_fetch", "document_chat",
    "device_info", "device_calc", "calendar_agenda",
  ]);
  expect(TOOL_ENTRIES.map((entry) => entry.name)).toEqual(ALL_TOOL_NAMES);
});
```

Must become seven:
```ts
expect(ALL_TOOL_NAMES).toEqual([
  "web_search", "web_fetch", "document_chat", "write_note",
  "device_info", "device_calc", "calendar_agenda",
]);
```

### 8b. Update assembly tests

Every `names()` assertion must include `"write_note"` in the expected output (it's always-on, so it appears in every combination):
- L43: default set → add `"write_note"` after `"document_chat"`
- L50: web-off set → add `"write_note"` after `"document_chat"`
- L55–L78: every `assembleTools` expectation must include `"write_note"` in the correct position

### 8c. Add a dedicated write_note test

```ts
test("write_note is always assembled regardless of toggle flags", () => {
  expect(names({ web: false, device: false, calendar: false })).toContain("write_note");
  expect(names({ web: true, device: true, calendar: true })).toContain("write_note");
});
```

### 8d. `assertRegistryInvariants` — automatic

The invariant checker (L44–65) validates length, order, name match, definition match, and no duplicates. Adding the entry to `TOOL_ENTRIES` and `ALL_TOOL_NAMES` in the same position is sufficient — the test will catch mismatches automatically.

---

## 9. Telemetry

**`ALL_TOOL_NAMES` is not directly used in `turnTelemetry.ts`.** The telemetry system tracks tool calls by name string (from the engine's tool-call payload), not by iterating `ALL_TOOL_NAMES`.

No telemetry changes are needed for the tool itself. If the team later adds a "tools available" telemetry event that enumerates the registry, the new entry will be included automatically via `TOOL_ENTRIES`.

---

## 10. Summary: File-by-File Checklist

| # | File | Change |
|---|------|--------|
| 1 | `src/agent/toolNames.ts` | Add `"write_note"` to `ToolName` union and `ALL_TOOL_NAMES` array (position 4, after `document_chat`) |
| 2 | `src/agent/writeNoteTool.ts` | **New file.** `WRITE_NOTE_TOOL` def + `runWriteNote` executor (imports `saveNote` from `NotesStore`) |
| 3 | `src/agent/toolRegistry.ts` | Import `WRITE_NOTE_TOOL`. Add `TOOL_ENTRIES` row: `{ name: "write_note", def: WRITE_NOTE_TOOL, toggleKey: null, defaultOn: true, gateTable: null }` |
| 4 | `src/app/AppShell.tsx` | Import `WRITE_NOTE_TOOL` (for type reference). Add `else if (name === "write_note")` branch in `executeTool` (~L2010). No toggle guard needed. |
| 5 | `src/i18n/en.ts` | Add `errors.writeNoteEmptyBody` and `errors.writeNoteFailed` |
| 6 | `src/i18n/it.ts` | Mirror the two new `errors.*` keys |
| 7 | `src/agent/toolRegistry.test.ts` | Update all `ALL_TOOL_NAMES` assertions (six → seven). Add `write_note` to every `names()` expectation. Add dedicated always-on test. |
| 8 | `src/agent/toolToggles.ts` | **No change** (no toggle) |
| 9 | `src/screens/SettingsScreen.tsx` | **No change** (always-on) |
| 10 | `src/rules/toolGateRegistry.ts` | **No change** (gateTable is null — auto-exempt) |

---

## 11. Dependency Note: `saveNote` import path

`writeNoteTool.ts` must import from `../notes/NotesStore` (not from `AppShell`). This follows the same pattern as `documentChatTool.ts` which imports from `../documents/DocumentLibrary` — tool executors are host-function-injected or import pure store functions directly.

`NotesStore.saveNote` is already async, already serialized via `enqueueNotesWrite`, and already handles index RMW atomically (NotesStore.ts L185–237). No concurrency issues.

**Important:** `NotesStore` imports `expo-file-system` at runtime via `getFs()`. This is fine — `documentChatTool.ts` also imports RN-ecosystem modules (`expo-file-system` via `host.requestPdfText`). The tool runs in the same JS context as the app.
