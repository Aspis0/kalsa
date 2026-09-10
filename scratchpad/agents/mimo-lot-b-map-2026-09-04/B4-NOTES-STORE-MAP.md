# B4 Map #1: NotesStore + Notes UI Write Path

**Repo**: `kalsa` · branch `feat/moe-stream`  
**Date**: 2026-09-04  
**Prior**: `LOT-B-memory-search-docs.md` §B4 (idea-scout, 2026-09-02)  
**Scope**: Read-only. Every claim has `file:line`.

---

## 1. NotesStore API

**File**: `src/notes/NotesStore.ts` (sole file in `src/notes/`)

### Exported Functions

| Function | Signature | Line | Purpose |
|---|---|---|---|
| `notesDir` | `(documentDirectory: string) → string` | :41 | Computes `<docDir>/kalsa-notes/` |
| `notesIndexPath` | `(documentDirectory: string) → string` | :47 | `<docDir>/kalsa-notes/kalsa.notes.index.json` |
| `sanitizeNoteId` | `(id: string) → string` | :50 | Strip to `[A-Za-z0-9._-]` → `_`; throw on empty |
| `notePath` | `(documentDirectory: string, id: string) → string` | :62 | Full `.md` file path |
| `nextNoteId` | `() → string` | :67 | `note-${Date.now()}-${8-char random}` |
| `titleFromNoteBody` | `(text: string) → string` | :71 | First line, trimmed, clipped to 48 chars |
| `sanitizeNoteBody` | `(raw: string\|null\|undefined) → string` | :79 | Strip NUL bytes, cap at `NOTE_BODY_CAP` (100,000 chars) |
| `searchBlobFromNoteBody` | `(text: string) → string` | :85 | Lowercased whitespace-collapsed, capped to 4,000 chars |
| `parseNotesIndex` | `(raw: string\|null\|undefined) → NoteMeta[]` | :91 | Parse index JSON (array or `{items:[]}` format) |
| `serializeNotesIndex` | `(items: NoteMeta[]) → string` | :121 | JSON.stringify the index |
| `filterNotes` | `(items: NoteMeta[], query: string) → NoteMeta[]` | :136 | Keyword AND via `filterByTokens` on title + searchBlob |
| `loadNotesIndex` | `async () → NoteMeta[]` | :148 | Read index file from disk, fallback `[]` |
| `readNote` | `async (id: string) → Note\|null` | :169 | Read body from `.md` file + merge meta from index |
| **`saveNote`** | `async (body: string, id?: string, nowMs?: number) → Note` | **:188** | **Core write** — see analysis below |
| `deleteNote` | `async (id: string) → Promise<void>` | :207 | Delete `.md` file + remove from index |

### `saveNote` Deep Dive (`:188-205`)

```
saveNote(body, id?, nowMs?)
```

1. **Enqueues** onto `notesWriteChain` — a promise chain serializing all index RMW operations (`:182-187`). Prevents concurrent index clobber.
2. If `id` provided → sanitize via `sanitizeNoteId` (reject path traversal chars). If no `id` → `nextNoteId()` generates `note-{timestamp}-{random8}`.
3. Body sanitized: NUL strip + cap at 100,000 chars (`sanitizeNoteBody :79`).
4. Title extracted from first line, capped at 48 chars (`titleFromNoteBody :71`).
5. SearchBlob built: lowercased, whitespace-collapsed, capped at 4,000 chars (`searchBlobFromNoteBody :85`).
6. **Writes `.md` file** via `expo-file-system` `writeAsStringAsync` (`:199`).
7. **Reads full index**, filters out existing entry with same id, pushes new entry, **writes index** (`:200-202`).
8. Returns `Note` object (`{id, title, updatedAt, body}`).

**Key constraint**: The idempotent overwrite pattern — existing entry with same `id` is replaced in index. The `.md` file is unconditionally overwritten. No merge, no conflict detection.

### Types

```typescript
NoteMeta = { id: string; title: string; updatedAt: number; searchBlob?: string }   // :21-26
Note = NoteMeta & { body: string }                                                  // :28
```

### Constants

| Constant | Value | Line |
|---|---|---|
| `NOTES_DIR_NAME` | `"kalsa-notes"` | :15 |
| `NOTES_INDEX_FILENAME` | `"kalsa.notes.index.json"` | :16 |
| `NOTE_TITLE_MAX` | `48` | :17 |
| `NOTE_BODY_CAP` | `100_000` | :18 |
| `NOTE_SEARCH_BLOB_CAP` | `4_000` | :20 |

### Concurrency Model

- **Serial index writes**: `enqueueNotesWrite()` chains promises (`:182-187`). All `saveNote` and `deleteNote` calls are serialized through `notesWriteChain`.
- **No file-level lock**: The `.md` write itself is not serialized — only the index RMW is. Two concurrent `saveNote` calls with different IDs could race on `.md` writes but this is safe because each ID maps to a unique file.
- **No atomic rename**: `writeAsStringAsync` directly overwrites. A crash mid-write could corrupt the file.

---

## 2. Directory Layout

```
<documentDirectory>/
  kalsa-notes/
    kalsa.notes.index.json          ← JSON array of NoteMeta
    note-1725446400000-a1b2c3d4.md  ← one file per note
    note-1725446400100-e5f6g7h8.md
    ...
```

- `documentDirectory` is Expo's `FileSystem.documentDirectory` — app-private sandbox on both iOS and Android.
- **No subdirectories** within `kalsa-notes/`. Flat structure.
- **No other files** in the `src/notes/` directory — just `NotesStore.ts`.

---

## 3. UI Call Sites — Who Can Create Notes Today

### 3a. NotesScreen (`src/screens/NotesScreen.tsx`)

- **Full CRUD overlay** — list, search, create, edit, delete, export.
- `openNew()` (`:127`) — creates blank `Note` with empty `id`, opens editor.
- `persistDraft()` (`:135`) — calls `saveNote(draft, editing.id || undefined)`. Empty string → new note (id generated). Existing id → overwrite.
- `confirmDelete()` (`:148`) — calls `deleteNote(id)` after Alert confirmation.
- `exportNote()` (`:166`) — uses React Native `Share.share()` (not expo-sharing) to share the draft body as text.
- `openNote()` (`:131`) — calls `readNote(id)`, loads into editor.

**NotesScreen is opened from**:
- Drawer menu item `"notes"` at `AppShell.tsx:2308-2315` → `setActiveOverlay({ kind: "notes" })`.
- Rendered at `AppShell.tsx:5398-5403` when `activeOverlay?.kind === "notes"`.

### 3b. AppShell — "Save to Notes" from chat message

**`handleSaveToNotes`** at `AppShell.tsx:2910-2920`:
```typescript
const handleSaveToNotes = useCallback(
  async (text: string) => {
    if (!text.trim()) return;              // ← empty body guard
    try {
      const note = await saveNote(text);   // ← no id → generates new
      showNotice(t("notes.saved"));
      return note.id;
    } catch {
      showNotice(t("notes.errorSave"));
      return undefined;
    }
  }, [showNotice, t],
);
```

- Passed as `onSaveToNotes` prop to `AiChatPage` at `AppShell.tsx:5237-5238`.
- Called from `AiChatPage.tsx:4220-4226` — a long-press message menu option "Save to notes" (icon: `ClipboardList`).
- **Source text**: `messageMenu.text` — the raw text of the assistant or user message.

### 3c. AiChatPage (`src/screens/AiChatPage.tsx`)

- **Props**: `onSaveToNotes?: (text: string) => void` (`:298`).
- **Only consumer**: long-press message context menu (`:4220-4226`).
- No other creation path in AiChatPage.

### 3d. Settings Screen

**No notes-related code in Settings.** Grep of `src/screens/Settings*.tsx` for `notes` returned empty. Notes are not configurable.

---

## 4. Existing AI→Note Path

**There is none.** Proved by exhaustiveness:

- `toolNames.ts:1-15` — `ToolName` type lists exactly 6 tools: `web_search`, `web_fetch`, `document_chat`, `device_info`, `device_calc`, `calendar_agenda`. No `create_note`, `write_note`, `save_note`, or any notes tool.
- `toolRegistry.ts:126` — `TOOL_ENTRIES` array contains exactly 6 entries, none notes-related.
- `grep -rn 'note.*tool\|tool.*note' src/agent/` — zero hits for note tools (only unrelated `webSearchTool.ts:121` "Model-facing note").
- The model cannot create, read, list, or delete notes in the current build.

---

## 5. Sharing / Export of Notes

### 5a. NotesScreen Export (`:166-170`)

```typescript
const exportNote = useCallback(() => {
  const body = editing ? draft : "";
  if (!body.trim()) return;
  void Share.share({
    message: body,
    title: editing?.title || t("notes.title"),
  }).catch(() => undefined);
}, [draft, editing, t]);
```

- Uses **React Native `Share`** (from `react-native`), **not** `expo-sharing`.
- Exports as **plain text** — the raw markdown body. No PDF, no HTML conversion.
- User chooses destination via OS share sheet.
- Button labeled `t("notes.export")` in the header trailing area (`:115-120`).

### 5b. Miniapp Export (separate path)

- `AskAssistantMiniappRenderer.tsx:269-273` supports PNG/JPEG/SVG/JSON/CSV export via `expo-sharing`.
- This is for miniapp chart data, **not** notes.
- `expo-sharing` is in `package.json` (`:46`) but only used by miniapps, not by notes.

---

## 6. i18n Keys for Notes

**File**: `src/i18n/en.ts:972-986`

```typescript
notes: {
  title: "Notes",                          // :973
  search: "Search notes",                  // :974
  empty: "No notes yet",                   // :975
  emptyBody: "Save a message from chat, or write a new note.",  // :976
  new: "New note",                         // :977
  edit: "Edit note",                       // :978
  delete: "Delete note",                   // :979
  deleteConfirm: "Delete this note?",      // :980
  export: "Export note",                   // :981
  untitled: "Untitled",                    // :982
  saved: "Saved to notes",                 // :983
  saveToNotes: "Save to notes",            // :984
  bodyPlaceholder: "Write a note…",        // :985
  errorSave: "Could not save the note.",   // :986
  errorLoad: "Could not open the note.",   // :987
},
```

Also referenced in chat context menu:
- `en.ts:500` — `saveToNotes: "Save to notes"` (under `chat` namespace for the long-press menu).

**Unused for notes but adjacent**:
- `en.ts:601` — `noEvidenceNotes: "No evidence notes available."` — belongs to miniapp renderer, unrelated.
- `en.ts:1046` — `digest: "Earlier notes: {digest}"` — belongs to compactor/context system, unrelated.

---

## 7. Tests Covering NotesStore

**None.** Exhaustive search:

- `find src -name '*.test.*' | xargs grep -l 'NotesStore\|saveNote\|loadNotesIndex\|deleteNote\|readNote'` → zero results.
- No file matching `NotesStore.test.ts`, `notes.test.ts`, or `notes.spec.ts` exists anywhere in the repo.
- `src/notes/` contains only `NotesStore.ts`.

**Test gap confirmed.** MemoryStore has `MemoryStore.test.ts`; NotesStore has nothing.

---

## 8. Constraints for a Future `create_note` Tool

### Overwrite Policy

- `saveNote(body, id?)` at `:188` **silently overwrites** if `id` matches existing note — index entry replaced, `.md` file overwritten.
- No merge, no conflict detection, no "note already exists" error.
- **For AI tool**: The model generates new IDs via `nextNoteId()` (random), so overwrite is unlikely unless the model deliberately reuses an ID. **Recommendation**: AI tool should always omit `id` → always creates new. Provide `update_note` separately if needed.

### Empty Body

- `sanitizeNoteBody("")` returns `""` (`:79-80`). `saveNote("")` succeeds and writes an empty file.
- `AppShell.handleSaveToNotes` guards: `if (!text.trim()) return` (`:2912`).
- `NotesScreen.persistDraft` has **no empty guard** — user can save blank notes via the UI.
- **For AI tool**: Should reject empty/whitespace-only body. Return validation error to model.

### Huge Body

- `NOTE_BODY_CAP = 100_000` (`:18`). `sanitizeNoteBody` slices to this limit (`:80`).
- 100K chars ≈ ~200KB on disk (UTF-8). Index JSON grows with each note (id + title + 4KB searchBlob).
- **For AI tool**: Enforce a tighter cap for AI-generated notes (e.g. 50K chars). 100K is generous for a note but could be used to bloat storage.

### Path Traversal

- `sanitizeNoteId` at `:50-60`: replaces all chars not in `[A-Za-z0-9._-]` with `_`. 
- This neutralizes `../`, `/`, `\`, null bytes, spaces, unicode tricks.
- `readNote` at `:170-172` also checks `safe !== id` — if sanitization changed the id, returns `null`.
- **Safe for AI tool**. The model-supplied id (if any) goes through `sanitizeNoteId`.

### Concurrent Writes

- Index RMW is serialized via `enqueueNotesWrite` promise chain (`:182-187`).
- Two concurrent `saveNote` calls are safe — they queue sequentially for index updates.
- `.md` file writes are **not** serialized but target different files (different IDs), so no conflict.
- **Safe for AI tool**. No additional locking needed.

### Other Constraints

| Concern | Current State | Recommendation |
|---|---|---|
| **Encoding** | UTF-8 (expo-file-system default) | No change needed |
| **Title extraction** | First line, 48 chars max (`:71-77`) | Model should put a meaningful first line |
| **SearchBlob** | Auto-generated from body, 4K chars (`:85-89`) | Transparent to tool caller |
| **Index integrity** | JSON file, no checksum | Acceptable for local-only storage |
| **Filesystem errors** | Caught and swallowed in `loadNotesIndex` (`:155`); `saveNote` lets errors propagate | Tool should catch and return error message to model |

---

## 9. Recommended Minimal Surface for AI `create_note` Tool

### Functions to Call

| Step | Function | Args | Notes |
|---|---|---|---|
| Create | `saveNote(body)` | No `id` → auto-generated | Always new note |
| Read back | `readNote(id)` | From returned `Note.id` | Verify + return to model |
| List (if needed) | `loadNotesIndex()` | None | Returns `NoteMeta[]` |

### Proposed Tool Schema

```typescript
{
  name: "create_note",
  description: "Save a markdown note to local storage.",
  parameters: {
    body: string,        // Required. Markdown content. First line becomes title.
  },
  returns: {
    id: string,          // e.g. "note-1725446400000-a1b2c3d4"
    title: string,       // First line, max 48 chars
    charCount: number,   // Post-sanitization length
  }
}
```

### Guardrails to Add

1. **Empty body rejection**: `if (!body.trim()) return error("Note body cannot be empty.")`.
2. **AI-specific body cap**: Consider 50K chars for AI-created notes (half the store max).
3. **Return minimal info to model**: `id` + `title` + `charCount`. Don't echo full body back (wastes context).
4. **No id parameter for AI**: Always auto-generate. Prevents accidental overwrite.
5. **Error translation**: Wrap `saveNote` in try/catch, return structured error to model.

### What NOT to Expose

- `deleteNote` — destructive, should remain UI-only or gated.
- `saveNote(body, id)` with explicit id — overwrite risk.
- `serializeNotesIndex` / `parseNotesIndex` — internal.
- Index path / file system details — implementation detail.
