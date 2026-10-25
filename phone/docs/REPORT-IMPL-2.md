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

## Slice 2 — Settings and reviewer closeout

Slice baseline: 212816f. This closeout starts at owner commit 74c3d7d. No commit by me.

### Slice changes

- Home Web state is derived at src/screens/SettingsHomeScreen.tsx:176 and reaches the Privacy row at :252-255; behavior is covered in src/screens/settingsHome.test.ts:82-105. Advanced model list is behaviorally scoped in src/screens/settingsHome.test.ts:71-76.
- Row-scoped export/delete remain in src/host/HostDrawer.tsx:42-68 and src/host/conversationRowActions.ts:14-82; src/host/shareConversation.test.ts:137-208 exercises row identity and export.
- src/ui/shell/AttachSheet.tsx:53-63,135-190 owns the titled sheet; shared grabber calls are at AttachSheet.tsx:159 and ModelPillSheet.tsx:55. Their distinct IDs are required by SheetGrabber.tsx:4-26. Copy is localized in src/i18n/en.ts:47-50 and src/i18n/it.ts:46-49.

### SettingsScreen inventory

Baseline ranges below are from 212816f (3,050 lines); current lines refer to this tree. Every old rendered block is classified.
- 1390-1435 Language: MOVED locale choices to Home language sheet (SettingsHomeScreen.tsx:214-219); old hint 1394-1397 DEAD.
- 1437-1498 Appearance/text size: MOVED size choices to Home (SettingsHomeScreen.tsx:246,211-213); old hint and preview DEAD.
- 1500-1572 CisWire flags STILL MOUNTED Advanced (SettingsScreen.tsx:1456-1527); 1573-1668 Context STILL MOUNTED (:1529-1623).
- 1669-1764 KV cache STILL MOUNTED Advanced (:1625-1719); 1765-1811 Instant chat reopen STILL MOUNTED (:1721-1766).
- 1812-1858 Thinking STILL MOUNTED Advanced (:1768-1813); 1859-2129 Memory STILL MOUNTED (:1815-2084).
- 2130-2185 On-device tools MOVED to Home Permissions sheet (SettingsHomeScreen.tsx:220-226).
- 2186-2344 Web search STILL MOUNTED Advanced (SettingsScreen.tsx:2086-2243).
- 2345-2460 Voice STILL MOUNTED Advanced (:2245-2359); 2461-2547 Embedding STILL MOUNTED (:2361-2446).
- 2548-2944 Models STILL MOUNTED Advanced (:2448-2795), including model sizes/actions.
- 2945-2952 Privacy heading/body DEAD; 2954-2981 Telemetry MOVED Home (SettingsHomeScreen.tsx:258).
- 2983-3003 Report Problem MOVED to Advanced Diagnostics (SettingsScreen.tsx:2797-2821); 3005-3031 Help STILL MOUNTED (:2823-2849).
- 3032-3046 About: version line 3040-3042 MOVED to the Kalsa card (SettingsHomeScreen.tsx:267-272); title, app-name, body DEAD.
- Page router and Advanced state remain needed (SettingsScreen.tsx:199-1405,1407-2853); the About block as a whole did not move.

### Open notes and closeout

- Note 1 — src/host/shareConversation.test.ts:210-229 checks HostDrawer's named callback mapping and exercises the binder with distinct events. It goes red if the mapping or callback order swaps.
- Note 2 — src/host/shareConversation.test.ts:232-249 directly exercises export and delete. It goes red if export stops closing the drawer or delete starts closing it.
- Note 3 — src/host/shareConversation.test.ts:118-134,167-173 checks labels/accessibility in English and Italian and the sheet's object-label forwarding (src/ui/shell/AttachSheet.tsx:88). It goes red if either locale loses “chat” or the object name stops reaching accessibility.
- Note 4 — src/theme/design.ts:168-169 names e3 as the existing calibrated e2 shadow; src/ui/shell/AttachSheet.tsx:155 reads it. src/theme/design.test.ts:215-217 and src/ui/shell/attachUi.test.ts:91-92 go red if the alias changes or the sheet drops ...e3.
- Note 5 — src/ui/shell/sheetTitleProps.ts:1-3, src/ui/shell/AttachSheet.tsx:136,160-167, and src/ui/shell/attachUi.test.ts:62-72 exercise a long title and pin the line limit on the heading block; it goes red if the limit is removed or no longer wired to the heading. The separate grabber ordering guard is restored at :98-102; moving it below the heading makes that test fail.
- Model-list check confirmed: src/screens/settingsHome.test.ts:71-76 locates modelChoices.map inside Advanced and checks size plus selection. It goes red if the rendered Advanced list disappears.
- Correction to the prior “No tests were deleted or weakened” claim: it was false because the grabber-before-heading assertion had been dropped. The guard is restored. Distinct grabber IDs are pinned at attachUi.test.ts:90,93-95; settingsWebToggle.ts:1 now keeps its module-local type private. The lesson remains: source-text checks must exercise the behavior they protect.

### Commands and results

- Focused: `npx tsc --noEmit > /tmp/kalsa-s2-closeout-tsc.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s2-closeout-tsc.log` — EXIT=0; `npx jest --runInBand --silent src/ui/shell/attachUi.test.ts > /tmp/kalsa-s2-closeout-focused-final-jest.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s2-closeout-focused-final-jest.log` — EXIT=0, 1 suite / 25 tests.
- Final: `npx tsc --noEmit > /tmp/kalsa-s2-closeout-final-tsc.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s2-closeout-final-tsc.log` — EXIT=0; `npx jest --silent > /tmp/kalsa-s2-closeout-final-jest.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s2-closeout-final-jest.log` — EXIT=0, 168 suites / 2,065 tests.
- `git diff --check > /tmp/kalsa-s2-closeout-report-diffcheck.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s2-closeout-report-diffcheck.log` — EXIT=0. Hash: `git diff --binary 74c3d7d -- src/ui/shell/SheetGrabber.tsx src/ui/shell/AttachSheet.tsx src/ui/shell/ModelPillSheet.tsx src/ui/shell/attachUi.test.ts src/screens/settingsWebToggle.ts > /tmp/kalsa-s2-closeout-code.patch; echo "EXIT=$?"` — EXIT=0; `shasum -a 256 /tmp/kalsa-s2-closeout-code.patch > /tmp/kalsa-s2-closeout-hash.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s2-closeout-hash.log` — EXIT=0; SHA-256 c9d907c3f46f9fbead3b7c73e6a892f78aad53b1a82d6b9e784762d90dcbeb60.
- No build, install, or device capture was run.
