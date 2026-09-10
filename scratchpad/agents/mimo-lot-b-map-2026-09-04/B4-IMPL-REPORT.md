# B4 Implementation Report

Date: 2026-09-05
Repo: `/Users/marco/Projects/kalsa`
Branch: `feat/moe-stream`

## Implemented

- Added `write_note` to `ToolName` and `ALL_TOOL_NAMES` after `document_chat`.
- Added `src/agent/writeNoteTool.ts` with:
  - `WRITE_NOTE_TOOL` schema limited to `title` and `body`.
  - Injectable `saveNote` dependency for tests.
  - Empty-body validation, title first-line composition, compact JSON success output, and localized errors.
- Registered the tool as always-on with `toggleKey: null`, `defaultOn: true`, and `gateTable: null`.
- Wired the executor into the `AppShell` tool dispatcher.
- Added English and Italian `write_note` error strings.
- Updated registry ordering/assembly tests and added focused `writeNoteTool` tests.

## Verification

- Targeted Jest: `npx jest src/agent/toolRegistry.test.ts src/agent/writeNoteTool.test.ts --runInBand` — `EXIT:0` (2 suites, 12 tests passed). Log: `/tmp/b4.log`.
- Typecheck: `npm run typecheck` — `EXIT:0`. Log: `/tmp/b4-typecheck.log`.
- Diff check: `git diff --check` — `EXIT:0`.

## Skipped / out of scope

- No PDF, DOCX, share-sheet-from-AI, note reading/deleting, Settings toggle, markdown renderer, telemetry changes, or new dependencies.
- No NotesStore API changes or optional NotesStore unit tests.
- No commit or push.

Pre-existing unrelated worktree changes were preserved.

## DeepSeek audit follow-up

- Removed the blind update path completely: `write_note` always creates a new note through `saveNote(composedBody)`.
- Normalized ATX headings when deduplicating a provided title, and normalized/clipped titles with `titleFromNoteBody`.
- Added pre-write abort handling with localized English and Italian messages.
- Rejected bodies that become empty after NUL removal and reported `truncated: true` when the persisted body is shorter than the sanitized input.
- Updated the tool description to state that notes are local-only and content is model-composed, potentially including recalled context.
- Replaced the misleading identifier failure test, removed the duplicate registry assertion, and added edge-case coverage for NUL bodies, headings, title fallback/clipping, truncation, abort, and invalid body types.

Latest verification:

- Targeted Jest: `npx jest src/agent/toolRegistry.test.ts src/agent/writeNoteTool.test.ts --runInBand` — `EXIT:0` (2 suites, 16 tests passed). Log: `/tmp/b4-audit-jest.log`.
- Typecheck: `npm run typecheck` — `EXIT:0`. Log: `/tmp/b4-audit-typecheck.log`.
- Audit items #18 and #19 remain out of scope as requested; the safety name guard is retained.
