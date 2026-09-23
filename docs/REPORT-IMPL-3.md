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
- Help and Pro now use the v2 header/cards in `HelpScreen.tsx:87-122` and `ProScreen.tsx:36-79`; existing help content and Pro benefits/price/feedback remain.
- Documents list/detail skin is in `DocumentsScreen.tsx:229-347` and `documents/DocumentDetailView.tsx:145-276`; import flow moved to `documents/useDocumentImport.ts:42-350`, small helpers to `documents/documentImportUtils.ts:4-18`. Rows, empty state, and progress presentation are in `DocumentListItem.tsx:33-125`, `DocumentsEmptyState.tsx:14-76`, and `DocumentImportOverlay.tsx:18-63`.
- Notes list/search remains in `NotesScreen.tsx:159-293`; edit UI is now the shared sheet in `NoteEditorSheet.tsx:21-104`. `AttachSheet.tsx:54-68,126-201` supports its custom body.
- Personas persistence/actions remain in `PersonasScreen.tsx:39-169`; row controls moved to `PersonaRow.tsx:21-105`, editor to `PersonaEditorSheet.tsx:21-99` using `AttachSheet`.
- `HostOverlays.tsx:166-285` mounts all six surfaces; the mini-app sheet remains unchanged. The live Settings home passes Help/Pro handlers at `HostOverlays.tsx:180-181`, `SettingsScreen.tsx:1411-1415`, and `SettingsHomeScreen.tsx:273-289`; Pro records its return route in `hostOverlay.ts:20` and returns to Settings or Account at `HostOverlays.tsx:219-235`.
- The menu's fifth destination routes to Personas through `conversationActions.ts:266-324` and `DrawerContent.tsx:47-49,201-223`. New files remain below 350 lines; the pre-existing `SettingsScreen.tsx` remains 2,857 lines and forwards the optional Pro callback at `:169-170,201,1411-1415`. The legacy AppShell caller can omit it, retaining its prior Help and Account→Pro paths without displaying an unwired Pro row.

## Old-screen retirement inventory

- Account: **MOVED** signed-out form to `AccountSignInPanel.tsx`; **DEAD** old visual skin; **STILL MOUNTED** account loading, store detection, sign-in/out, errors, Pro navigation and hardware back in `AccountScreen.tsx:25-76,87-131`.
- Help: **DEAD** old visual skin; **STILL MOUNTED** intro, six topic sections, privacy voice copy and FAQ in `HelpScreen.tsx:16-72,97-122`.
- Pro: **DEAD** old visual skin; **STILL MOUNTED** benefit copy, price, CTA feedback and back behavior in `ProScreen.tsx:13-33,46-76`.
- Documents: **MOVED** import/extraction and the two inline helpers to `useDocumentImport.ts` / `documentImportUtils.ts`; **DEAD** the old inline importer and old visual skin; **STILL MOUNTED** the pre-existing, restyled `DocumentListItem.tsx`, `DocumentsEmptyState.tsx`, and `DocumentImportOverlay.tsx`, plus library routing/reorder/delete in `DocumentsScreen.tsx:102-224,246-347` and detail/cover/snippet/rebuild/delete in `DocumentDetailView.tsx:47-276`.
- Notes: **MOVED** editor fields/actions to `NoteEditorSheet.tsx`; **DEAD** inline editor; **STILL MOUNTED** load/focus, search, open/save/delete/share, list and back behavior in `NotesScreen.tsx:34-157,166-293`.
- Personas: **MOVED** row and editor UI to `PersonaRow.tsx` / `PersonaEditorSheet.tsx`; **DEAD** inline editor and old visual skin; **STILL MOUNTED** reload/persist, activation, builtin visibility, delete confirmation, validation and shared copy helpers in `PersonasScreen.tsx:39-169,281-308`.

## Verification

- This pass began on branch `ux-2026-09-21` at HEAD `9b6e32a`; the checked-out HEAD differed from the `12c3865` stated in the request. No commit was made.
- Rendered and inspected mock `?s=menu`, `?s=settings`, and `?s=switch` at the requested viewport. The same Chrome command with each selector returned **EXIT=0**; Chrome emitted non-fatal macOS `CVDisplayLinkCreateWithCGDisplay` stderr.
- Between ordered implementation stages, `npx tsc --noEmit` and `npx jest --silent` were **EXIT=0** after Account, Help+Pro, Documents+Notes, and Personas. The first typecheck after extracting document import was **EXIT=2** because `isDocumentOpInFlight` had not yet been imported; restored at `DocumentsScreen.tsx:22`, then both checks were **EXIT=0** before continuing.
- Behavioral coverage: `overlayModules.test.ts:67-210` exercises sign-in, note/persona sheet actions and fields, persona row actions, and opening the selected document row. `overlayGrammar.test.ts:169-350` checks Account's disabled first-render state and enabled state, one filled brand action per actionable screen, Help's full section/FAQ content, Help/Pro row presses, the legacy no-Pro-prop tree, and sheet primary actions. It expands nested Action/Row/Group/AttachSheet controls; this harness stubs `SettingsHeader`, `DraggableFlatList`, `DocumentListItem`, `DocumentImportOverlay`, and `DocumentDetailView`, so those subtrees are outside the screen-level count (the document row has its separate callback test). `documents/useDocumentImport.test.ts:98-177` covers successful metadata, cancel with a selected asset, no-asset result, storage failure, post-picker delete recheck, and busy refusal. `overlayDoorRoutes.test.ts:67-96` presses HostOverlays' Help/Pro routes and verifies Pro returns to Settings or Account; `personaDrawerDoor.test.ts:37-78` presses and orders the five rendered menu destinations, then verifies the Personas overlay.
- Reviewer follow-up: `useDocumentImport.test.ts:122-141` now uses `{ canceled: true, assets: [asset] }` and asserts no storage work, document add, alert, progress, or state residue. Temporarily replacing the guard with `if (!picked.assets) return` and running `npx jest --runInBand --silent src/screens/documents/useDocumentImport.test.ts` yielded **EXIT=1** at the no-resolve assertion; the production source was restored. The no-asset case remains separately covered. `SettingsScreen.tsx:1414` routes Help through the existing dirty-draft guard at `:937-971`. The Help/Pro source-text match was removed; behavioral endpoints are the pressed home rows at `overlayGrammar.test.ts:272-310` and HostOverlays destination callbacks at `overlayDoorRoutes.test.ts:67-96`. The legacy omitted-Pro branch is exercised at `overlayGrammar.test.ts:308-310`. `settingsHome.test.ts:32-48` now compares every home testID, including Help and Pro, with the complete expected list.
- `shareConversation.test.ts:118-120` updates the footer expectation to five; its route is exercised by `personaDrawerDoor.test.ts:37-78`.
- Targeted `npx jest --runInBand --silent src/screens/overlayGrammar.test.ts src/screens/documents/useDocumentImport.test.ts src/screens/settingsHome.test.ts src/host/overlayDoorRoutes.test.ts src/host/personaDrawerDoor.test.ts src/theme/components/Drawer.test.ts > /tmp/kalsa-s3-open-notes-targeted.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s3-open-notes-targeted.log` — **EXIT=0**, 6 suites / 25 tests.
- Final `npx tsc --noEmit > /tmp/kalsa-s3-open-notes-tsc.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s3-open-notes-tsc.log` — **EXIT=0**.
- Final `npx jest --silent > /tmp/kalsa-s3-open-notes-jest.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s3-open-notes-jest.log` — **EXIT=0**, 173 suites / 2,083 tests passed.
- `jest.config.js:5-9` discovers `.test.ts` and `.test.tsx`; the transform handles both `.ts` and `.tsx`. Jest tests remain outside `tsconfig.json`'s typecheck include.
- `git diff --check > /tmp/kalsa-s3-open-notes-diff-check.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/kalsa-s3-open-notes-diff-check.log` — **EXIT=0**. Original slice source SHA-256: `fbe02343c32d4a0c07407119520fc8863a5b4509239888bc7d5ff434b6659416`; earlier coverage delta from HEAD `4425194`: `e133d54b6153b901b87932899193fbce8099c0439fa0f2f04c18b7ef2cb92514`.
- Tests directly invoke component functions and exercise their element structure and callbacks; they do not verify native layout or OS gesture delivery. The owner confirmed the Settings ScrollView reaches MOTORE/Avanzate/KALSA after gestures that start away from Telemetria; no scroll change was made. No app build, install, or capture was run by this pass. The owner capture commit `661492b` added foreground-checked Account, Avanzate, and KALSA frames; this pass made no commit.
- This follow-up removed the source-text Help/Pro match in favor of the two behavioral route endpoints, added coverage for the optional Pro row, and preserved all test cases. No commit was made.
