# Slice 3 — six overlays

## Standing instructions (verbatim from `docs/CODER-BRIEF.md`)

Write clean code. Never create a God file: a file may hold one responsibility, and the test of it is
that you can name that responsibility in one phrase. Line count is a smell, not the rule — ~250 is
indicative, ~350 is fine, and if you notice you are moving lines only to make a number work, stop and
leave the file alone. No new file beyond ~350. No file, new or existing, that mixes responsibilities
until it stops being readable. Test files follow the same logic: if a test file becomes an
indistinguishable list of cases, split it by topic, not by line count. Pre-existing excess is
declared, not refactored. Minimal imports: no globs, no preventive pub, no convenience re-exports. No
types or APIs nobody constructs yet. Comments only for WHY or a trap, never restating the code — and
if a comment declares an invariant, that invariant must be true. No secret values. Tests: targeted
filters while working, one full run at the end, and never report a piped command's status:
`cmd > /tmp/out.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/out.log`, quoting the exit code. `git add` by
name, `git branch --show-current` printed before every commit, no push, no tag, no new branch, and
the commit message names repo, branch and HEAD. Report file:line, commands with exit codes, hashes,
and what you could not verify.

## Changes

- Account uses the centered header and v2 cards in `AccountScreen.tsx:87-131`; sign-in form moved to `AccountSignInPanel.tsx:26-164`. Account/session behavior remains in `AccountScreen.tsx:25-76`.
- Help and Pro now use the v2 header/cards in `HelpScreen.tsx:87-122` and `ProScreen.tsx:36-76`; existing help content and Pro benefits/price/feedback remain.
- Documents list/detail skin is in `DocumentsScreen.tsx:229-345` and `documents/DocumentDetailView.tsx:145-276`; import flow moved to `documents/useDocumentImport.ts:42-348`, small helpers to `documents/documentImportUtils.ts:4-18`. Rows, empty state, and progress presentation are in `DocumentListItem.tsx:33-125`, `DocumentsEmptyState.tsx:14-76`, and `DocumentImportOverlay.tsx:18-63`.
- Notes list/search remains in `NotesScreen.tsx:159-275`; edit UI is now the shared sheet in `NoteEditorSheet.tsx:21-103`. `AttachSheet.tsx:54-68,126-197` supports its custom body.
- Personas persistence/actions remain in `PersonasScreen.tsx:41-169`; row controls moved to `PersonaRow.tsx:21-105`, editor to `PersonaEditorSheet.tsx:21-98` using `AttachSheet`.
- `HostOverlays.tsx:220-272` still mounts all six surfaces; Settings and the mini-app sheet were not changed. Changed/new source files are at most 350 lines (`useDocumentImport.ts` is exactly 350).

## Old-screen retirement inventory

- Account: **MOVED** signed-out form to `AccountSignInPanel.tsx`; **DEAD** old visual skin; **STILL MOUNTED** account loading, store detection, sign-in/out, errors, Pro navigation and hardware back in `AccountScreen.tsx:25-76,87-131`.
- Help: **DEAD** old visual skin; **STILL MOUNTED** intro, six topic sections, privacy voice copy and FAQ in `HelpScreen.tsx:16-72,97-122`.
- Pro: **DEAD** old visual skin; **STILL MOUNTED** benefit copy, price, CTA feedback and back behavior in `ProScreen.tsx:13-33,46-76`.
- Documents: **MOVED** import/extraction and the two inline helpers to `useDocumentImport.ts` / `documentImportUtils.ts`; **DEAD** the old inline importer and old visual skin; **STILL MOUNTED** the pre-existing, restyled `DocumentListItem.tsx`, `DocumentsEmptyState.tsx`, and `DocumentImportOverlay.tsx`, plus library routing/reorder/delete in `DocumentsScreen.tsx:102-224,246-345` and detail/cover/snippet/rebuild/delete in `DocumentDetailView.tsx:47-276`.
- Notes: **MOVED** editor fields/actions to `NoteEditorSheet.tsx`; **DEAD** inline editor; **STILL MOUNTED** load/focus, search, open/save/delete/share, list and back behavior in `NotesScreen.tsx:34-157,166-290`.
- Personas: **MOVED** row and editor UI to `PersonaRow.tsx` / `PersonaEditorSheet.tsx`; **DEAD** inline editor and old visual skin; **STILL MOUNTED** reload/persist, activation, builtin visibility, delete confirmation, validation and shared copy helpers in `PersonasScreen.tsx:41-169,281-310`.

## Verification

- Rendered and inspected mock `?s=menu`, `?s=settings`, and `?s=switch` at the requested viewport. The same Chrome command with each selector returned **EXIT=0**; Chrome emitted non-fatal macOS `CVDisplayLinkCreateWithCGDisplay` stderr.
- Between ordered implementation stages, `npx tsc --noEmit` and `npx jest --silent` were **EXIT=0** after Account, Help+Pro, Documents+Notes, and Personas. The first typecheck after extracting document import was **EXIT=2** because `isDocumentOpInFlight` had not yet been imported; restored at `DocumentsScreen.tsx:22`, then both checks were **EXIT=0** before continuing.
- Behavioral coverage: `overlayModules.test.ts:67-210` exercises sign-in, note/persona sheet actions and fields, persona row actions, and opening the selected document row. `overlayGrammar.test.ts:150-232` invokes all six screens, checks one brand primary on the five action surfaces (both Documents list states), treats informational Help as zero-action, and presses note/persona edit rows to verify their fields render inside `AttachSheet`. `documents/useDocumentImport.test.ts:98-134` tests a successful text import, storage failure cleanup/alert/no-commit, and delete-in-flight refusal.
- Targeted `npx jest --runInBand --silent src/screens/overlayModules.test.ts src/screens/overlayGrammar.test.ts src/screens/documents/useDocumentImport.test.ts > /tmp/kalsa-s3-overlay-targeted-jest.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s3-overlay-targeted-jest.log` — **EXIT=0**, 3 suites / 10 tests.
- Final `npx tsc --noEmit > /tmp/kalsa-s3-final-tsc.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s3-final-tsc.log` — **EXIT=0**.
- Final `npx jest --silent > /tmp/kalsa-s3-final-jest.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s3-final-jest.log` — **EXIT=0**, 171 suites / 2,075 tests passed.
- `git diff --check > /tmp/kalsa-s3-final-diff-check.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/kalsa-s3-final-diff-check.log` — **EXIT=0**. Original slice source SHA-256: `fbe02343c32d4a0c07407119520fc8863a5b4509239888bc7d5ff434b6659416`; coverage delta from HEAD `4425194` SHA-256: `e133d54b6153b901b87932899193fbce8099c0439fa0f2f04c18b7ef2cb92514` (`shasum -a 256 /tmp/kalsa-s3-coverage.patch`, **EXIT=0**).
- Node tests directly invoke components and exercise their element structure and callbacks; they do not verify native layout or OS gesture delivery. No native app/device capture, build, or install was run. The corrected capture directory has only the two Settings frames and no Account frame; Account’s native appearance remains for the owner’s foreground-checked capture.
- No tests were removed or weakened. No commit was made.
