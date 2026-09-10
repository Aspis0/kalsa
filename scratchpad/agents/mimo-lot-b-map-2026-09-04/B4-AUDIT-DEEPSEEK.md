# B4 AUDIT — write_note tool (feat/moe-stream)

Auditor: DeepSeek (hostile). Read-only. Every finding quotes the line read.
Verdicts: CONFIRMED (verified in code) / PLAUSIBLE (reasoned from code) / REFUTED (claimed risk does not exist).
All line numbers verified against working tree.

## Security

1. **Path traversal via noteId — REFUTED (safe).** `src/notes/NotesStore.ts:44-45`: `const safe = id.replace(/[^A-Za-z0-9._-]/g, "_");` and `:53` `return \`${notesDir(documentDirectory)}${sanitizeNoteId(id)}.md\`;` — fixed dir prefix + `_` substitution + `.md` suffix; `"../x"` → `.._x`. `saveNote` applies it at `NotesStore.ts:228` `const safe = id ? sanitizeNoteId(id) : nextNoteId();`. No escape path exists. Severity: none.

2. **NUL-only body bypasses the empty-body guard — CONFIRMED. LOW.** `src/agent/writeNoteTool.ts:73` `if (!body.trim()) {` — JS `trim()` does not strip `\u0000` (not WhiteSpace per spec), so `body="\u0000"` passes; `NotesStore.ts:72` `return raw.replace(/\u0000/g, "").slice(0, NOTE_BODY_CAP);` then strips → an empty/garbage note (`title`-only if title given) is persisted despite the guard's contract ("requires a non-empty body"). No escape, just junk writes.

3. **>100K body silently truncated, no model-facing signal — CONFIRMED. LOW.** `NotesStore.ts:72` `.slice(0, NOTE_BODY_CAP)` drops the tail; `writeNoteTool.ts:47` `charCount: note.body.length` reports only the truncated length — the model cannot tell its content was amputated. Same behavior as UI save path, but the tool describes no limit.

4. **Path-like fields written elsewhere — REFUTED.** Schema is exactly three string props, all sandboxed: `writeNoteTool.ts:14-27` (`title`, `body`, `noteId`); asserted by `writeNoteTool.test.ts:77-79` `expect(Object.keys(properties)).toEqual(["title", "body", "noteId"]);`. `title` can inject `\n` into the body string, but the body is a note file in the notes dir only.

## Privacy

5. **Success JSON leaks nothing — CONFIRMED (good).** `writeNoteTool.ts:44-47` returns only `{ok, id, title, charCount}`; errors are fixed i18n strings (`:92` `text: strings.errors.writeNoteFailed`), no body echo anywhere.

6. **Always-on, gateTable null, zero audit — PLAUSIBLE. LOW.** `toolRegistry.ts:107-111` (`toggleKey: null, defaultOn: true, gateTable: null`); gate resolution `rules/runToolGate.ts:53-54` `const table = resolveToolGateTable(opts.toolName, opts.toolhelpOn); if (!table) return { blocked: false };`. The wire map's justifying claim — "the LLM can only write what the user typed" (B4-TOOL-WIRE-MAP.md §4a) — is **false**: the model composes `body` from its own generation, which can embed memory facts injected into context. The note persists silently with no gate, audit-log entry, or user notice (only a later, out-of-band chat confirmation if the model chooses to emit one). Local-only, so LOW, but the design rationale as written is wrong.

7. **web_search exfiltration warning — CONFIRMED (good).** `writeNoteTool.ts:11` "Do not pass this output to web_search."

## Bugs

8. **Update path is blind: no existence check; silently creates junk or clobbers — CONFIRMED. MEDIUM. MUST-FIX.** `writeNoteTool.ts:88` `const note = await write(bodyWithTitle(title, body), noteId);` forwards any `noteId`; `NotesStore.ts:228-238` overwrites unconditionally (`.filter((item) => item.id !== safe)` + `writeAsStringAsync`) with no `readNote`/index existence check. The model has no read/list tool, so `noteId` is a guess: unknown id → silently *creates* a note under that id (the "update" contract at `writeNoteTool.ts:25` "Existing note id to update" is a lie); a remembered id (from its own earlier result) → overwrites that note, including any edits the user made in the Notes UI afterwards. The map explicitly recommended the opposite: B4-NOTES-STORE-MAP.md §8 "AI tool should always omit id → always creates new. Provide update_note separately if needed." Deviation introduced knowingly.

9. **Double-title when body starts with a markdown heading — CONFIRMED. LOW-MED. SHOULD-FIX.** `writeNoteTool.ts:39-40` `const firstLine = body.replace(/\r\n/g, "\n").split("\n")[0]?.trim() ?? ""; return firstLine === title ? body : \`${title}\n${body}\`;` — body `"# Foo\n..."` with title `"Foo"` gives `# Foo !== Foo` → prepends → stored body `"Foo\n# Foo\n..."`, duplicate title text in the note. The dedupe test only covers exact plain-line match (`writeNoteTool.test.ts:44-50`).

10. **AbortSignal declared, then dropped — CONFIRMED. LOW.** `writeNoteTool.ts:61` `signal?: AbortSignal,` in the signature; `:65` `return async (name, args) => {` — never read. Sibling executors honor it: `documentChatTool.ts:360` `if (signal?.aborted) {`, `webSearchTool.ts:82` `searchWeb(query, { locale, numResults, signal })`. A cancelled turn still persists the note; behavior is inconsistent across tools.

11. **Title metadata mismatch — CONFIRMED. LOW.** Title passes through `writeNoteTool.ts:81` `.trim()` only; a title with embedded `\n`/`\r\n` or >48 chars gets stored/reported as the first-line clip: `NotesStore.ts:62-67` (`clipChars(trimmed, NOTE_TITLE_MAX)`), while the body's first line keeps the full string. Success JSON at `writeNoteTool.ts:46` `title: note.title` reports the clipped value — model believes its full title was saved.

12. **Empty/whitespace title fallback — CONFIRMED fine.** `writeNoteTool.ts:38` `if (!title) return body;` → title derived from body first line; schema-required-but-empty is handled sanely. NIT: untested.

## Races

13. **Concurrent write_note + NotesScreen.persistDraft — REFUTED.** Both go through the same chain: `NotesStore.ts:188-189` `function enqueueNotesWrite<T>(run: () => Promise<T>): Promise<T> {` with the entire save — file write included — inside it (`:224-240`, `:234` `await fs.writeAsStringAsync(...)`). `NotesScreen.tsx:124` `const saved = await saveNote(draft, editing.id || undefined);` queues on the identical chain. No index clobber, no file race. (The map's "file write not serialized" claim in §1 is stale — current code serializes it.)

## Edge / arg handling

14. **Non-string args, whitespace noteId, missing args — CONFIRMED guarded.** `writeNoteTool.ts:71-84`: `typeof` checks on all three fields; whitespace `noteId` → `undefined` → new note. No tests for any of these branches.

## Test hygiene

15. **Redundant overclaiming test — CONFIRMED.** `toolRegistry.test.ts:117-125` "always assembles write_note regardless of toggle flags" asserts exactly `["document_chat", "write_note"]` — identical to the all-false combo in the adjacent test (`:104-107`). The name promises more than it tests (though the full matrix *is* covered by the neighbor). Dead duplicate.

16. **Misleading failure test — CONFIRMED.** `writeNoteTool.test.ts:63-66`: `jest.fn().mockRejectedValue(new Error("invalid id"))` rejects unconditionally — `"bad/id"` never reaches `sanitizeNoteId`; the test proves only the catch-all at `writeNoteTool.ts:90-93`. Traversal/id sanitization is asserted nowhere at executor level. Also untested: NUL-only body (finding 2), markdown-heading dedupe (9), CRLF/>48-char title (11), non-string args (14), the `name !== "write_note"` branch (20), abort behavior (10).

17. **Mock restore — REFUTED concern.** No spies or global mocks in `writeNoteTool.test.ts`; `jest.fn()` per-test, DI via `deps.saveNote`; the registry suite's `jest.mock("expo-secure-store")` (`toolRegistry.test.ts:1-7`) is pre-existing and harmless. Nothing to restore.

18. **No AppShell integration test — PLAUSIBLE. NIT.** Branch is `AppShell.tsx:2062-2063` `} else if (name === "write_note") { outcome = await writeNoteExec(name, args, signal);` — nothing tests the routing itself. Given zero other executeTool branch tests exist, consistent gap; acceptable.

## Dead code

19. **`name !== "write_note"` guard unreachable — CONFIRMED.** `writeNoteTool.ts:67-69` `if (name !== "write_note") {` — the sole call site routes by exact name (`AppShell.tsx:2062`), so the branch can never fire in the app; it only guards hypothetical test misuse. Harmless dead code.

## Wiring (requested verifications)

20. **assembleTools flag matrix — CONFIRMED.** `write_note` present in all six combos (`toolRegistry.test.ts:51-115`), including all-off `["document_chat", "write_note"]`. Invariant checker enforces length/order/dup at module load (`toolRegistry.ts:139-141`).
21. **ALL_TOOL_NAMES order — CONFIRMED.** 7 entries, `write_note` after `document_chat` before `device_info`: `toolNames.ts:7,16`; mirrors TOOL_ENTRIES (`toolRegistry.ts:106-112`).
22. **Checklist comment — CONFIRMED accurate.** `toolRegistry.ts:4-16` — no stale "six tools" reference; matches B6 checklist.
23. **No half-wired Settings toggle — CONFIRMED.** Zero hits for `write_note`/`notesTool` in `src/screens/Settings*.tsx` and `src/agent/toolToggles.ts`.
24. **i18n parity — CONFIRMED.** `src/i18n/en.ts:810-811`, `src/i18n/it.ts:784-785` both carry the two keys.
25. **Report claims — CONFIRMED repro.** Ran `npx jest src/agent/toolRegistry.test.ts src/agent/writeNoteTool.test.ts --runInBand` → 2 suites, 12/12 pass; `npm run typecheck` → clean.

---

## MUST-FIX
- **#8** Blind update path (`noteId`) — drop `noteId` from the schema (per map recommendation) or verify existence via `loadNotesIndex()`/`readNote` before overwrite. Current contract "update an existing note" is unverifiable and can silently clobber user-edited notes or create junk.
- **#9** `bodyWithTitle` double-title on markdown-heading first lines — normalize `#`/markdown-prefixed first line before comparing, and add the test.

## SHOULD-FIX
- **#10** Honor `signal` (check `signal?.aborted` before/after write) for cancel consistency with `document_chat`/`web_search`.
- **#11** Clip/normalize title the same way NotesStore does, and report what is actually stored.

## NITS
- **#2** NUL-only body defeats the empty guard (trim `\u0000` explicitly or let sanitize run first).
- **#3** Truncation at 100K is silent to the model.
- **#6** "LLM can only write what the user typed" rationale is false — decide consciously whether always-on-without-gate is intended.
- **#12, #14** Untested edge branches; **#15** duplicate test; **#16** failure test proves only the catch-all; **#18** no branch-level integration test; **#19** dead name guard.