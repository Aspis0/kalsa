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

## Slice 2 — Settings

Branch `ux-2026-09-21`, base HEAD `212816f`; no commit. Work stayed in `/Users/marco/Projects/kalsa-ux`.

### Changes

- Step 0: `src/host/HostDrawer.tsx:43-46` binds named sheet/drawer closers. `src/host/conversationRowActions.ts:49-81` gives actions conversation-specific accessible names and closes only the sheet for delete. `src/host/shareConversation.test.ts:120-169` drives active and older rows and asserts callback order and older-row ID.
- Step 1: `src/ui/shell/AttachSheet.tsx:56-62,156-180` adds the shared 36×4 grabber, title and optional subtitle; `:182-198` adds the full-width primary action used by settings sheets.
- Step 2: `src/screens/SettingsHeader.tsx:13-49` provides the centered title and back control. `src/screens/SettingsHomeScreen.tsx:229-285` builds the five ordered groups, model/theme/size/language/permissions sheets, toggles and Kalsa mark/version card. Cards have `flexGrow: 0`/`flexShrink: 0` at `:135-145`.
- `src/screens/SettingsScreen.tsx:1364-1431` routes Home/Advanced and shares the current memory/disk model gate with the Home picker; `:1447-2853` retains the Advanced surface and its engine controls. `src/host/HostFurniture.tsx:73-74` and `src/host/HostOverlays.tsx:169-170` pass the real Web flag and `toggleWebTools` handler.
- `src/i18n/en.ts:17,63-82` and `src/i18n/it.ts:18,62-81` add localized labels and the settings-sheet “Done” action.
- `src/screens/SettingsHomeScreen.tsx` is 289 lines; `SettingsHeader.tsx` 56; `settingsHome.test.ts` 94. `HostRoot.tsx` remains 241 lines; no ratchet was raised.

### SettingsScreen inventory

- The pre-slice file was 3,050 lines. Current `SettingsScreen.tsx` is 2,853 lines and remains mounted; it was not deleted.
- Still live: `SettingsScreen.tsx:199-1405` owns settings state, persistence, dirty handling, model fit/gating, and page routing. `:1456-2795` retains CisWire, context/KV, session pool, thinking, memory, provider keys, voice, embeddings, model downloads, governor/thermal details and diagnostics; `:2823-2848` retains Help.
- Superseded baseline markup: `HEAD:src/screens/SettingsScreen.tsx:1390-1498` (language/text size) moved to Home sheets; `HEAD:src/screens/SettingsScreen.tsx:2130-2185` (device/calendar tools) moved to Permissions; `HEAD:src/screens/SettingsScreen.tsx:2945-2981` (telemetry) moved to Home; `HEAD:src/screens/SettingsScreen.tsx:2983-3003` (report problem) moved under Advanced Diagnostics; `HEAD:src/screens/SettingsScreen.tsx:3032-3046` (About) moved to the Kalsa card.
- Next retirement seam: extract the remaining Advanced body and its state owner; the retained ranges above are still used by the new two-page screen.

### Tests

- No tests were deleted or weakened. `shareConversation.test.ts:120-169` replaces direct low-level action calls/source-order matching with row-built behavioral ordering, including export closing the drawer and delete leaving it open; existing byte-for-byte Markdown assertions remain untouched. `attachUi.test.ts:41-43` now accepts object-specific labels with a label fallback, and `:64-88` pins the grabber and primary action. `settingsHome.test.ts:23-92` pins group order, the Advanced boundary, model gate, Web wiring, Kalsa card and localized Done.

### Commands and results

- Mock render viewed before coding: `cd /Users/marco/Projects/kalsa-ux && "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --window-size=349,621 --force-device-scale-factor=3 --screenshot=/tmp/kalsa-settings-target-s2.png "file:///Users/marco/Projects/kalsa-ux/docs/design/kalsa-mock-v2.html?s=settings" > /tmp/kalsa-ux-s2-chrome.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-ux-s2-chrome.log` — EXIT=0; Chrome emitted macOS display/GPU warnings but wrote the image.
- Step 0 filtered Jest: `npx jest --runInBand --silent src/host/shareConversation.test.ts src/ui/shell/attachUi.test.ts src/theme/components/Drawer.test.ts` — EXIT=0, 3 suites / 40 tests. Step 1 filtered Jest: `npx jest --runInBand --silent src/ui/shell/attachUi.test.ts src/host/shareConversation.test.ts` — EXIT=0, 2 suites / 34 tests.
- Final focused Jest: `cd /Users/marco/Projects/kalsa-ux && npx jest --runInBand --silent src/screens/settingsHome.test.ts src/ui/shell/attachUi.test.ts src/host/shareConversation.test.ts > /tmp/kalsa-ux-s2-modelgate-jest.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/kalsa-ux-s2-modelgate-jest.log` — EXIT=0, 3 suites / 40 tests.
- Final TypeScript: `cd /Users/marco/Projects/kalsa-ux && test "$(git branch --show-current)" = ux-2026-09-21 && npx tsc --noEmit > /tmp/kalsa-ux-s2-final-tsc.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-ux-s2-final-tsc.log` — EXIT=0. Final Jest: `cd /Users/marco/Projects/kalsa-ux && test "$(git branch --show-current)" = ux-2026-09-21 && npx jest --silent > /tmp/kalsa-ux-s2-final-jest.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-ux-s2-final-jest.log` — EXIT=0, 168 suites / 2,062 tests.
- `git diff --check > /tmp/kalsa-ux-s2-diffcheck.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/kalsa-ux-s2-diffcheck.log` — EXIT=0. Combined code patch SHA-256 (tracked diff from `212816f` plus three new source/test files, excluding this report): `3cadfd161b7ce5761954366f5c308420567de72d9c2b005ba730b54300b4661e`; `shasum -a 256 /tmp/kalsa-ux-s2-code.patch` — EXIT=0.
- Interim failures, all corrected: checkpoint `npx tsc --noEmit` EXIT=2 for missing draft translations; next `npx tsc --noEmit` EXIT=2 because untouched `AppShell.tsx` constructed the screen without the new optional props; first focused settings Jest EXIT=1 because its helper double-joined an absolute path; first brief-block `diff -u` EXIT=1 for a line-wrap mismatch, corrected comparison EXIT=0. Corrected TSC/Jest runs passed; the Web handler remains optional only for the legacy `AppShell` caller and is supplied by the active Host path.
- Could not verify the requested mock|device captures in `docs/captures/2026-09-23/slice2/`; no app build, install or device capture was run, as required. The orchestrator must capture the device pair.
