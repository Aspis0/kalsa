# Slice 4 — retirement audit and persona row actions

## Phase A — retirement plan (analysis only)

The live device path is `App.tsx:56,197-200` → `HostRoot.tsx:211` → `HostLayout.tsx:113-125` → `HostFurniture.tsx:66-105` → `HostOverlays.tsx`. `hostOverlay.ts:17-25` lists the seven screen kinds and the mini-app. Every screen below is **LIVE**: the v2 modules have replaced parts of screens, not their mounts.

| File | LIVE / DEAD | Mount and overlay kind | What replaces it | What only it still has | Tests affected |
|---|---|---|---|---|---|
| `SettingsScreen.tsx` | LIVE | `HostOverlays.tsx:166-217`, `kind: settings`; receives settings props plus `onOpenHelp` and `onOpenPro`. | `SettingsHomeScreen` renders the first page (`:1409-1436`). | Settings state/adapters, dirty-draft Help guard (`:937-971`), complete Advanced page (`:1439-2857`): model gates/download UI, context/KV/thinking/governor/session controls, voice/embedder controls, diagnostics and report actions. | `settingsHome.test.ts:10,65-83` reads/pins the advanced screen; `overlayDoorRoutes.test.ts:6,67-80` mocks and exercises overlay callbacks. Retarget after extracting Advanced; retain behaviors. |
| `AccountScreen.tsx` | LIVE | `HostOverlays.tsx:219-225`, `kind: account`; receives `onBack` and `onOpenPro`. | `AccountSignInPanel` replaces only the signed-out form (`:117-129`). | Account loading/store detection, auth/sign-out requests and errors, signed-in profile/Pro route, busy/social feedback and hardware back (`:24-76,87-134`). | `overlayGrammar.test.ts:5,174-195`; `overlayDoorRoutes.test.ts:7,82-96` mocks it and tests Account→Pro. Rewrite screen behavior; keep `overlayModules.test.ts` panel coverage. |
| `ProScreen.tsx` | LIVE | `HostOverlays.tsx:227-235`, `kind: pro`; back returns to the recorded Settings or Account origin. | None; this remains the mounted Pro surface. | Whole Pro offer: benefits/price, coming-soon CTA feedback and hardware/back handling (`:19-79`). | `overlayGrammar.test.ts:15,200`; `overlayDoorRoutes.test.ts:8,82-96`. Rewrite for a replacement surface; keep route/return assertions. |
| `HelpScreen.tsx` | LIVE | `HostOverlays.tsx:277-284`, `kind: help`; back returns to Settings. | None; this remains the mounted Help surface. | Intro, six topics, privacy voice note and FAQ content (`:49-67,97-122`); the Kalsa row is only its door. | `overlayGrammar.test.ts:9,202,246-267` pins content; `overlayDoorRoutes.test.ts:12,67-80` mocks the mount and verifies the Help destination. Rewrite content and route coverage. |
| `DocumentsScreen.tsx` | LIVE | `HostOverlays.tsx:237-254`, `kind: documents`; receives library, import/delete/reorder/detail handlers and busy guards. | `documents/useDocumentImport.ts`, `DocumentListItem.tsx`, `DocumentDetailView.tsx`, `DocumentsEmptyState.tsx`, `DocumentImportOverlay.tsx` own importer, row/detail/empty/progress pieces. | Screen mode, list/detail navigation, reorder wiring, delete confirmation/busy checks, back handling and composition (`:79-196,198-346`). | `overlayGrammar.test.ts:7,204-226`; `overlayDoorRoutes.test.ts:9` mocks the mount. Rewrite orchestration tests; keep `overlayModules.test.ts` row coverage and `documents/useDocumentImport.test.ts` import/failure tests. |
| `NotesScreen.tsx` | LIVE | `HostOverlays.tsx:256-264`, `kind: notes`; passes optional `focusId` and back. | `NoteEditorSheet` replaces only editor controls (`:276-290`). | NotesStore load/focus/search/list, create/open/save, share/export, delete confirmation, editor state and back handling (`:36-157,179-275`). | `overlayGrammar.test.ts:11,228,313-330`; `overlayDoorRoutes.test.ts:10` mocks the mount. Rewrite integration coverage; keep `overlayModules.test.ts` editor tests. |
| `PersonasScreen.tsx` | LIVE | `HostOverlays.tsx:265-275`, `kind: personas`; receives back and active-persona update callbacks. | `PersonaRow` owns row controls/action sheet; `PersonaEditorSheet` owns edit fields (`:221-274`). | PersonasStore load/persist, create/edit/save/delete/activate/hide state and confirmation (`:39-166`). Exports `builtinCopyFromT` (`:279-298`), imported by live `engineTurnWindow.ts:27,119-123` and twin `AppShell.tsx:15,5895,7099`; move it first. | `overlayGrammar.test.ts:13,233,332-348`; `overlayDoorRoutes.test.ts:11` mocks the mount. `overlayModules.test.ts:179-256` tests the extracted row sheet and must stay. Rewrite screen integration; keep leaf tests. |

Deleting any of these now would break direct imports/source reads in `overlayGrammar.test.ts` or `settingsHome.test.ts`; `overlayDoorRoutes.test.ts` must keep its route assertions while its old-screen doubles are retargeted. These suites need rewrites around full replacements and extracted logic, not deletion.

The previous controller is the inactive twin today: `App.tsx:56` sets `NEW_SHELL = true`, so `:197-198` renders `HostRoot`; `AppShell` is the false branch at `:199-200`. Its direct screen mounts remain at `AppShell.tsx:7111-7212`, with static imports at `:8-15`; they still prevent deleting those module paths while that twin remains in the TypeScript/module graph. Specifically, the reviewer’s omitted-Pro Settings caller is `AppShell.tsx:7111-7123`; it has no `onOpenPro`, so `SettingsHomeScreen.tsx:283-288` hides Pro there. That route is reachable only when running the twin controller, not on the current device path.

No screen is DEAD and none is safe to remove now. After full replacements and logic extraction are mounted, I would retire Help, Pro, Account, Notes, Documents, Personas (after moving `builtinCopyFromT`), then Settings last (after separating Advanced and its state/wiring). This orders the small informational surfaces before screens with storage, orchestration or engine dependencies.

## Phase B — persona row actions

- `PersonaRow.tsx:48-132` keeps the row at 56 dp, leaves the name flexible, and shows Use plus an accessible, row-named actions button. It opens the existing `AttachSheet` with a heading for that persona. Built-ins offer Duplicate and Hide/Show; custom personas offer Edit and Delete. No new surface or taller row was needed.
- `en.ts:1063` and `it.ts:1032` add the localized, contextual “Actions for {name}” / “Azioni per {name}” heading and button name.
- `overlayModules.test.ts:179-256` presses the visible control and each sheet action, checking Use remains the only row action, the row stays 56 dp, and handlers reach the selected row. `overlayGrammar.test.ts:332-348` exercises opening the existing persona editor through the new sheet.

## Verification

- `npx tsc --noEmit > /tmp/kalsa-s4-final-tsc.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s4-final-tsc.log` — **EXIT=0**.
- `npx jest --runInBand --silent src/screens/overlayModules.test.ts src/screens/overlayGrammar.test.ts src/screens/settingsHome.test.ts src/host/overlayDoorRoutes.test.ts > /tmp/kalsa-s4-persona-targeted.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/kalsa-s4-persona-targeted.log` — **EXIT=0**, 4 suites / 17 tests.
- `npx jest --silent > /tmp/kalsa-s4-final-jest.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s4-final-jest.log` — **EXIT=0**, 173 suites / 2,084 tests.
- `git diff --check > /tmp/kalsa-s4-diff-check.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/kalsa-s4-diff-check.log` — **EXIT=0**. Two initial focused runs were **EXIT=1** while correcting test selectors; the final targeted and complete runs pass.
- Starting state was branch `ux-2026-09-21`, HEAD `27beec5`; no ratchet changed, no test was deleted or weakened, no retirement was performed, no commit/build/device capture was run.

## Follow-up — composer, conversations and document-report copy

- `src/ui/shell/ShellComposer.tsx:100-107` removes visible placeholder text while retaining the non-empty `shell.a11y.field` accessible name. `shell.composer.placeholder` was removed from both catalogs because no caller remains. `ShellComposer.test.ts:39-58` checks editable and non-editable rendered fields; `composerState.test.ts:259-264` pins the exact remaining 21 unique live keys.
- `src/theme/components/DrawerContent.tsx:127-147` replaces the compressed inline chat list with one compact “Your chats” entry; the five footer destinations remain in order at `:32-34,149-171`. Search stays in the drawer, and submitting it opens the list while preserving the query.
- `src/host/HostDrawer.tsx:18-39` closes the drawer and keeps search state; `HostLayout.tsx:105-125` routes to the `conversations` overlay; `HostOverlays.tsx:270-279` mounts `HostConversations`. `src/screens/ConversationListScreen.tsx:19-165` provides the full-screen scroll list, search, selection and separate row action buttons. `src/host/HostConversations.tsx:22-64` wires row selection, export and delete through the existing conversation action set and AttachSheet.
- `conversationListRoute.test.ts:68-204` drives the real drawer entry through HostLayout, checks drawer close and overlay routing, then exercises search, row selection and the visible accessible action control. Existing drawer/accessibility/export assertions were repointed to the new list owner; no test files were deleted.
- `src/i18n/it.ts:640-657` and `src/i18n/en.ts:646-663` rename visible research copy to **“Report dai documenti” / “Report from documents”**. Both retain the internal `deepResearch*` keys with a comment explaining the local-document source. Planning, query progress, no-result, partial, question, image, writer-failure and interrupted statuses now speak about documents or the report; writing and empty-library messages stay close to their existing wording. `HostAttachSheet.tsx:69-81` keeps the row a switch and changes its label to the active-state copy; `deepResearchCopy.test.ts:53-99` asserts all catalog text and both switch states in Italian and English. I agree with the chosen name.
- The English drawer observation came from the app language being set to English; the locale-provider hypothesis was wrong, and no locale or attach-sheet localization fix was needed.
- `npx tsc --noEmit > /tmp/kalsa-tsc-final.log 2>&1; echo "EXIT=$?"; tail -25 /tmp/kalsa-tsc-final.log` — **EXIT=0**.
- `npx jest --silent > /tmp/kalsa-jest-final.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-jest-final.log` — **EXIT=0**, 228 suites / 2,426 tests.
- The 59 scripts from `/tmp/pairing-harness-list.txt` were run individually with per-script status capture — **EXIT=0**, 59/59 passed. `git diff --check > /tmp/kalsa-diff-check.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/kalsa-diff-check.log` — **EXIT=0**.
- No device build, install or capture was run; the list’s appearance and scrolling remain for the owner’s phone check. No commit was created.

## Follow-up — conversation-list gesture and Help copy

- `src/screens/ConversationListScreen.tsx:100-159` separates the conversation selection button from a visible 48 dp ⋮ action button. Its accessible name is localized and includes the conversation title (`drawer.conversationActionsFor`). The row has no long-press handler, delay, or accessibility gesture action.
- `src/host/conversationRowActions.ts:22-32` keeps the existing per-row action sheet route and binds its visible button to that row's ID. `DrawerConversationItem` in `src/theme/components/Drawer.tsx:24-34` now exposes `onActionsPress` instead of `onLongPress`.
- The measured symptom is consistent with the old `delayLongPress={380}` competing for a slow drag, but code inspection cannot prove that caused the device behavior. The row no longer registers that gesture, and `conversationListRoute.test.ts:133-163,165-204` presses the accessible action control and row selection behavior. Only a slow swipe on the phone can verify scrolling is fixed.
- `src/i18n/en.ts:482-495` and `src/i18n/it.ts:477-490` now say computer mode is available, the top pill identifies where answers come from, and the conversation disclosure applies when computer mode is used. The stale future condition was also removed from the Help “Using your computer” section. `copyTruth.test.ts:198-233` renders and checks both catalog versions, including the canonical disclosure, active-mode wording and pill reference.
- `conversationListRoute.test.ts`, `Drawer.test.ts`, `keyboardFocus.test.ts` and `shareConversation.test.ts` were updated to protect the visible control and the existing action route; `copyTruth.test.ts` protects the corrected Help copy.

### Verification

- `npx jest --runInBand --silent src/host/conversationListRoute.test.ts src/theme/components/Drawer.test.ts src/host/keyboardFocus.test.ts src/host/shareConversation.test.ts src/screens/copyTruth.test.ts` — **EXIT=0**, 5 suites / 42 tests.
- `npx tsc --noEmit > /tmp/kalsa-gesture-tsc.log 2>&1` — **EXIT=0**.
- `npx jest --silent > /tmp/kalsa-gesture-full-jest.log 2>&1` — **EXIT=0**, 228 suites / 2,426 tests.
- All 59 script paths in `/tmp/pairing-harness-list.txt` were run individually with `node "$script"` — **EXIT=0**, 59/59 passed; per-script results are in `/tmp/kalsa-gesture-harness-status.log`.
- `git diff --check > /tmp/kalsa-gesture-diff-check.log 2>&1` — **EXIT=0**.
- Starting HEAD was `dc392594`. No commit, build, install or device swipe was run. The slow-swipe result is the remaining verification required from the owner.

## Follow-up — behavioral row-sheet coverage

- `src/host/conversationListRoute.test.ts:180-245` now drives the list button through its actual `onActionsPress` callback, updates the host's selected-row state, rerenders `HostConversations`, and asserts the mounted `AttachSheet` title and export/delete rows belong to `older-chat` while `active-chat` is also present. It invokes export and checks the root handler receives `older-chat`.
- Mutation check: changing `ConversationListScreen.tsx:147` to `onPress={() => {}}` makes the focused route suite **EXIT=1** (3 tests run, 2 failed). Both the direct control callback assertion and the host sheet-opening assertion fail. The production handler was restored before final verification.
- `npx jest --runInBand --silent src/host/conversationListRoute.test.ts` — **EXIT=0**, 1 suite / 3 tests after restore. `npx tsc --noEmit` — **EXIT=0**. `npx jest --silent` — **EXIT=0**, 228 suites / 2,426 tests. `git diff --check` — **EXIT=0**.
- Starting HEAD was `a08acec6`; only the behavioral test and this report are uncommitted. No build, install or phone verification was run.
