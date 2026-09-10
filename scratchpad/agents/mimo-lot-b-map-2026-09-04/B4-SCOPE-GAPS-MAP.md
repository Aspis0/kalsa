# B4 — AI Creating MD/Doc/PDF: Scope & Gaps Map

**Scout §B4 · Map #3 · 2026-09-04**
**Repo:** `kalsa` feat/moe-stream · **File-level evidence only.**

---

## 1. PDF Generation: Is It Possible Without New Native Deps?

**No. Zero-dep PDF generation does not exist in this codebase.**

| Signal | Evidence |
|--------|----------|
| `pdfjs-dist` in `package.json` | `devDep` only — **extract**-only (render PDF → canvas/text). Not a PDF writer. |
| No `jspdf`, `pdf-lib`, `react-native-html-to-pdf`, `expo-print`, `puppeteer`, `wkhtmltopdf`, `weasyprint`, `pdfmake` | `grep package.json` for all known PDF-gen libs → **zero hits** (only `pdfjs-dist`). |
| No print-to-PDF path | `expo-print` is not in dependencies. `react-native-print` absent. |
| Existing export paths | Miniapp exports → `expo-sharing` (`Sharing.shareAsync`) for CSV/JPG/PNG/SVG/JSON. **No PDF target.** (`AskAssistantMiniappRenderer.tsx:593-3661`) |
| Notes export | `NotesScreen.tsx:163` → `Share.share({ message: body })` — **plain text only**, no file attachment, no PDF. |

**Verdict:** PDF generation requires adding a native-capable PDF library (`pdf-lib` ~300KB, or `expo-print` for print-sheets). Not viable for zero-dep B4 MVP.

---

## 2. Miniapp `EXPORT_*` Paths: Can AI Push Content to Share Sheet as md/txt?

**Partially — but not from an AI tool call today.**

- **Miniapp export pipeline** (`AskAssistantMiniappRenderer.tsx:593-3661`): Builds export files via `FileSystem.writeAsStringAsync` into `cacheDirectory`, then `Sharing.shareAsync`. Supports CSV, JPG, PNG, SVG, JSON. This is UI-driven (button press), not AI-tool-callable.
- **No AI-tool path to share sheet.** The tool registry (`toolRegistry.ts`) has 6 tools: `web_search`, `web_fetch`, `document_chat`, `device_info`, `device_calc`, `calendar_agenda`. **None write files or invoke sharing.**
- **"Save to notes"** is a user-initiated long-press action (`AiChatPage.tsx:4220-4225`) that passes raw text to `handleSaveToNotes` → `saveNote(text)`. It's **not an AI tool** — the AI cannot trigger it. It saves to the notes dir as `.md`, not share sheet.
- **`Share.share({ message })`** is used in chat export (`AiChatPage.tsx:2924`) and notes export (`NotesScreen.tsx:163`), both user-triggered.

**Verdict:** No mechanism exists for AI to push content to the share sheet. A `create_note` tool could write to the notes dir, and the user could then share from NotesScreen — but AI → share sheet directly is a gap.

---

## 3. Markdown Pipeline in Chat: Can Created Notes Be Rendered In-App Immediately?

**Yes — the rendering pipeline exists and is battle-tested.**

| Component | Evidence |
|-----------|----------|
| `parseMarkdownBlocks()` | `src/chat/markdown.ts:52` — dependency-free O(n) parser, handles headings, bold, italic, code, links, citations, lists, blockquotes, horizontal rules. |
| `<MarkdownText>` | `src/chat/MarkdownText.tsx:46` — React Native primitive renderer. Used in `AiChatPage.tsx:5299` for assistant messages. |
| Notes currently render as plain `TextInput` | `NotesScreen.tsx` uses `<TextInput multiline>` — **no markdown rendering in notes view.** |
| Can be reused | `MarkdownText` accepts `{ text: string, sources?: MarkdownSource[] }` — a note's `body` field maps directly. |

**Verdict:** `parseMarkdownBlocks` + `<MarkdownText>` can render note content as rich markdown with zero new deps. NotesScreen would need a view-mode toggle (edit vs. read) to use it. Already renders in chat; trivial to add to notes.

---

## 4. Security: If AI Can Write Files, What Sandbox? Risk of Writing Outside Notes Dir?

**Current state: AI has no file-write capability at all.**

- **Tool registry** (`toolRegistry.ts:67-107`): 6 tools, **none do file I/O.** `document_chat` reads documents but doesn't write. `web_fetch` fetches URLs.
- **`saveNote()`** (`NotesStore.ts:224`): Writes to `documentDirectory/kalsa-notes/<id>.md` via `expo-file-system`. The path is **hardcoded** — `notePath()` at line 53 computes `${notesDir(documentDirectory)}${sanitizeNoteId(id)}.md`.
- **Path traversal defense:** `sanitizeNoteId()` at line 40 strips all non-`[A-Za-z0-9._-]` characters. An id like `../../etc/passwd` becomes `____etc_passwd`. The directory prefix is fixed via `notesDir()`. **Cannot escape the notes dir.**
- **`NOTE_BODY_CAP = 100_000`** (line 17): Caps note body at 100KB. Prevents abuse.
- **Risk if we add `create_note` tool:** As long as the tool calls `saveNote(body, id?)` with the same NotesStore API, the sandbox is preserved. The tool itself must not accept arbitrary file paths.

**Verdict:** NotesStore is sandboxed by design. A `create_note` AI tool that wraps `saveNote()` is safe. The risk is if someone adds a raw `FileSystem.writeAsStringAsync` path in the tool — but the NotesStore API already provides the only write surface needed.

---

## 5. Recommended B4 MVP

**create_note AI tool → NotesStore `.md` only. PDF deferred.**

### What to build

A new `create_note` tool in the AI tool registry that lets the assistant save structured content as a note.

### Why this scope

| Argument | Evidence |
|----------|----------|
| NotesStore already exists | `NotesStore.ts:224` — `saveNote(body, id?)` handles create + update, writes `.md`, updates index, caps at 100KB. Battle-tested. |
| Tool registry has clear extension point | `toolRegistry.ts:67-107` — `TOOL_ENTRIES` array + `ALL_TOOL_NAMES` union in `toolNames.ts`. Adding one row is mechanical. |
| AI currently cannot write anything | 6 tools, zero file-write capability. `create_note` is the minimum viable write tool. |
| Markdown rendering available | `MarkdownText.tsx` + `markdown.ts` — zero-dep, already in chat. Notes can render rich content immediately. |
| Share/export already works | `NotesScreen.tsx:163` — `Share.share({ message: body })` on any saved note. User flow: AI creates note → user opens Notes → shares as text. |
| PDF is a follow-up | Requires `pdf-lib` or `expo-print` (new deps). The B4 parent leans `.md`-only. Defer to B4.1 when a zero-dep print-to-PDF path or willingness to add `pdf-lib` exists. |

### Key design constraints

1. **Tool wraps `saveNote()`** — no raw `FileSystem` calls in the tool. Sandbox preserved.
2. **Body capped at `NOTE_BODY_CAP`** (100KB) — already enforced by `sanitizeNoteBody()`.
3. **Title auto-derived** from first line — `titleFromNoteBody()` at `NotesStore.ts:67`.
4. **Tool input schema:** `{ body: string, id?: string }` — id optional for create vs. update.
5. **No file-path parameter** — tool must not accept arbitrary paths.

---

## 6. Explicit Non-Goals for This Slice

| Non-Goal | Reason |
|----------|--------|
| PDF generation | Requires new native dep (`pdf-lib` / `expo-print`). Not zero-dep. B4.1 follow-up. |
| DOCX/HTML export | Same dep issue. Notes are markdown; export as text/share is sufficient for MVP. |
| AI reading existing notes | Separate tool (`read_note`). Different privacy surface. B4.1. |
| AI deleting notes | Destructive action. Separate tool with confirmation. B4.2. |
| AI editing existing notes | Requires conflict resolution UX. B4.2. |
| Notes rendering UI changes | `NotesScreen` stays as plain TextInput for MVP. Markdown rendering is a polish follow-up. |
| Share sheet from AI | AI creates note; user shares from NotesScreen. No AI→share-sheet direct path. |
| Notes in chat context | Notes are not surfaced in `retriever.ts` / `compactor.ts` context pipeline. Separate feature. |

---

## 7. Minimal Patch Set Table

| File | Change | Effort |
|------|--------|--------|
| `src/agent/toolNames.ts` | Add `"create_note"` to `ToolName` union and `ALL_TOOL_NAMES` | **S** — 2 lines |
| `src/agent/toolRegistry.ts` | Add `CREATE_NOTE_TOOL` entry to `TOOL_ENTRIES` with `toggleKey: null, defaultOn: true, gateTable: null` | **S** — 10 lines |
| `src/agent/createNoteTool.ts` | **New file.** Define `CREATE_NOTE_TOOL: EngineTool` — schema `{ body: string, id?: string }`, handler calls `saveNote(body, id)` | **M** — ~40 lines |
| `src/app/AppShell.tsx` | Add `case "create_note":` branch in `executeTool` dispatcher (follows `toolRegistry.ts` contributor checklist item 3) | **S** — ~10 lines |
| `src/i18n/en.ts` | Add `"create_note"` tool description string | **S** — 1 line |
| `src/i18n/it.ts` | Add `"create_note"` tool description string | **S** — 1 line |

**Total: ~65 lines across 6 files. Zero new dependencies.**

### Wire-order dependency

1. `toolNames.ts` first (type source)
2. `createNoteTool.ts` (new, imports from `NotesStore`)
3. `toolRegistry.ts` (imports tool + name)
4. `AppShell.tsx` (execute branch)
5. `en.ts` / `it.ts` (i18n strings)

---

## Appendix: File References

- `NotesStore.ts:14-17` — constants (`NOTES_DIR_NAME`, `NOTE_BODY_CAP`)
- `NotesStore.ts:40` — `sanitizeNoteId()` (path traversal defense)
- `NotesStore.ts:53` — `notePath()` (fixed directory prefix)
- `NotesStore.ts:224` — `saveNote()` (the API the tool must call)
- `toolNames.ts:4-10` — `ToolName` union type
- `toolRegistry.ts:67-107` — `TOOL_ENTRIES` array
- `AppShell.tsx:2910-2922` — `handleSaveToNotes` (existing user-only path, for reference)
- `MarkdownText.tsx:46` — markdown renderer (available for future notes UI)
- `markdown.ts:52` — `parseMarkdownBlocks()` (zero-dep parser)
