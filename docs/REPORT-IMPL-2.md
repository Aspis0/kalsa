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

Base: `212816f`; branch `ux-2026-09-21`. No commit, build, or device install.

### Changes

- `src/host/HostDrawer.tsx:43-46` preserves action ordering; `src/host/conversationRowActions.ts:49-81` binds row IDs. `src/ui/shell/AttachSheet.tsx:53-63,156-190` provides titled/primary actions; `src/ui/shell/SheetGrabber.tsx:4-25` is shared.
- `src/screens/SettingsHomeScreen.tsx:229-291` builds the home groups/sheets; `src/screens/SettingsHeader.tsx:13-49` navigates pages. `src/screens/SettingsScreen.tsx:1407-1447` routes Home/Advanced; `:1447-2853` keeps Advanced mounted.
- Web fix: `src/screens/settingsWebToggle.ts:1-12` maps state/callback; Home `:174,252-255` spreads its props; `src/screens/settingsHome.test.ts:82-105` tests both states and presses.
- Model/copy fixes: `src/screens/SettingsScreen.tsx:1412-1417` sends quant only to Home, while Advanced retains size at `:2548-2592`; `src/i18n/it.ts:63`/`src/i18n/en.ts:64` name context, KV cache, governor, thresholds.
- `src/ui/shell/ModelPillSheet.tsx:47-50` uses shared grabber; `src/ui/shell/attachUi.test.ts:76-85` pins both sheets. `src/screens/settingsHome.test.ts:70-79` now checks the Advanced list's size and selection.

### SettingsScreen inventory — baseline ranges from `212816f` (3,050 lines); current lines refer to this tree. Each old rendered block is classified.
- 1390-1435 Language: MOVED locale choices to Home language sheet (`src/screens/SettingsHomeScreen.tsx:214-219`); old hint 1394-1397 DEAD.
- 1437-1498 Appearance/text size: MOVED size choices to Home (`src/screens/SettingsHomeScreen.tsx:246,211-213`); old hint and preview DEAD.
- 1500-1572 CisWire flags STILL MOUNTED Advanced (`src/screens/SettingsScreen.tsx:1456-1527`); 1573-1668 Context STILL MOUNTED (`:1529-1623`).
- 1669-1764 KV cache STILL MOUNTED Advanced (`:1625-1719`); 1765-1811 Instant chat reopen STILL MOUNTED (`:1721-1766`).
- 1812-1858 Thinking STILL MOUNTED Advanced (`:1768-1813`); 1859-2129 Memory STILL MOUNTED (`:1815-2084`).
- 2130-2185 On-device tools: MOVED to Home Permissions sheet (`src/screens/SettingsHomeScreen.tsx:220-226`).
- 2186-2344 Web search: STILL MOUNTED Advanced (`src/screens/SettingsScreen.tsx:2086-2243`).
- 2345-2460 Voice: STILL MOUNTED Advanced (`:2245-2359`); 2461-2547 Embedding: STILL MOUNTED Advanced (`:2361-2446`).
- 2548-2944 Models: STILL MOUNTED Advanced (`:2448-2795`), including download sizes and model actions.
- 2945-2952 Privacy heading/body: DEAD; 2954-2981 telemetry: MOVED to Home (`src/screens/SettingsHomeScreen.tsx:258`).
- 2983-3003 Report Problem: MOVED to Advanced Diagnostics (`src/screens/SettingsScreen.tsx:2797-2821`).
- 3005-3031 Help: STILL MOUNTED Advanced (`:2823-2849`).
- 3032-3046 About: version line 3040-3042 MOVED as the Kalsa card version (`src/screens/SettingsHomeScreen.tsx:267-272`); title, app-name, and body lines 3032-3039, 3043-3046 DEAD.
- The SettingsScreen page router and Advanced state remain required (`src/screens/SettingsScreen.tsx:199-1405,1407-2853`); the About block as a whole did not move.

### Tests and lesson

- No tests were deleted or weakened. `src/host/shareConversation.test.ts:120-169` drives row actions with another active ID and guards close-before-export; `attachUi.test.ts:41-43` keeps object-specific accessible names with a row-label fallback, and `:76-85` pins shared grabbers.
- Jest has no React Native renderer (Node environment; no `react-test-renderer`), so Web tests exercise the production props function and pin its spread into the row.
- Lesson: a source-text assertion can catch a rename while missing a dropped state leg. Keep a behavioral assertion for the behavior the source check is meant to protect.

### Commands and results

- Mock render command: `cd /Users/marco/Projects/kalsa-ux && "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --window-size=349,621 --force-device-scale-factor=3 --screenshot=/tmp/kalsa-settings-target-s2.png "file:///Users/marco/Projects/kalsa-ux/docs/design/kalsa-mock-v2.html?s=settings" > /tmp/kalsa-ux-s2-chrome.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-ux-s2-chrome.log` EXIT=0.
- Focused: `npx tsc --noEmit > /tmp/kalsa-s2-review-tsc.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s2-review-tsc.log` EXIT=0; `npx jest --runInBand --silent src/screens/settingsHome.test.ts src/ui/shell/attachUi.test.ts > /tmp/kalsa-s2-review-focused.log 2>&1; echo "EXIT=$?"; tail -40 /tmp/kalsa-s2-review-focused.log` EXIT=0, 2 suites / 30 tests.
- Final: `npx tsc --noEmit > /tmp/kalsa-s2-review-final-tsc.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s2-review-final-tsc.log` EXIT=0; `npx jest --silent > /tmp/kalsa-s2-review-final-jest.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s2-review-final-jest.log` EXIT=0, 168 suites / 2,062 tests.
- Diff check: `git diff --check > /tmp/kalsa-s2-review-final-diffcheck.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s2-review-final-diffcheck.log` EXIT=0. Review code patch SHA-256: `d98dc5d3b1b68fc76fb574fca227fcbe3d737726a5dddfbbbab66cca079fbb5a` (tracked/new code; report excluded).
- Earlier corrected interim failures: TSC EXIT=2 for draft translations/legacy caller props; focused Jest EXIT=1 for a test helper path, then corrected; report brief comparison EXIT=1 for wrapping, then corrected.

Could not verify: no device capture, app build, or install was run; the orchestrator must capture the screen pair.
