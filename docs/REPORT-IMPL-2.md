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

Slice baseline: 212816f. Work began at 7a3b5b6; capture-only HEAD 3810977 arrived during this turn. No commit by me.

### Slice changes

- Home/Advanced implementation remains in src/screens/SettingsHomeScreen.tsx:229-291 and SettingsScreen.tsx:1407-2853; Web toggle props are covered behaviorally at src/screens/settingsHome.test.ts:82-105.
- Row-scoped export/delete remain in src/host/HostDrawer.tsx:42-68 and src/host/conversationRowActions.ts:14-82; src/host/shareConversation.test.ts:137-208 exercises row identity and export.
- src/ui/shell/AttachSheet.tsx:53-63,135-190 owns the titled sheet; src/ui/shell/SheetGrabber.tsx:4-25 is shared. Copy is localized in src/i18n/en.ts:47-50 and src/i18n/it.ts:46-49.

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

### Open notes closed

- Note 1 — src/host/shareConversation.test.ts:210-229 checks HostDrawer's named callback mapping and exercises the binder with distinct events. It goes red if the mapping or callback order swaps.
- Note 2 — src/host/shareConversation.test.ts:232-249 directly exercises export and delete. It goes red if export stops closing the drawer or delete starts closing it.
- Note 3 — src/host/shareConversation.test.ts:118-134,167-173 checks labels/accessibility in English and Italian and the sheet's object-label forwarding (src/ui/shell/AttachSheet.tsx:88). It goes red if either locale loses “chat” or the object name stops reaching accessibility.
- Note 4 — src/theme/design.ts:168-169 names e3 as the existing calibrated e2 shadow; src/ui/shell/AttachSheet.tsx:155 reads it. src/theme/design.test.ts:215-217 and src/ui/shell/attachUi.test.ts:84-92 go red if the alias changes or the sheet drops ...e3.
- Note 5 — src/ui/shell/sheetTitleProps.ts:1-3, src/ui/shell/AttachSheet.tsx:136,160-167, and src/ui/shell/attachUi.test.ts:62-72 exercise a long title and pin the line limit on the heading block; it goes red if the limit is removed or no longer wired to the heading.
- Model-list check confirmed: src/screens/settingsHome.test.ts:71-76 locates modelChoices.map inside Advanced and checks size plus selection. It goes red if the rendered Advanced list disappears.
- Lesson retained: whenever a test pins source text, the same test exercises the behavior it protects.

### Commands and results

- Focused: npx tsc --noEmit > /tmp/kalsa-s2-open-notes-tsc.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s2-open-notes-tsc.log — EXIT=0. npx jest --runInBand --silent src/host/shareConversation.test.ts src/ui/shell/attachUi.test.ts src/theme/design.test.ts src/screens/settingsHome.test.ts > /tmp/kalsa-s2-open-notes-focused.log 2>&1; echo "EXIT=$?"; tail -50 /tmp/kalsa-s2-open-notes-focused.log — EXIT=0, 4 suites / 79 tests.
- Final: npx tsc --noEmit > /tmp/kalsa-s2-open-notes-final-tsc.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s2-open-notes-final-tsc.log — EXIT=0. npx jest --silent > /tmp/kalsa-s2-open-notes-final-jest.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s2-open-notes-final-jest.log — EXIT=0, 168 suites / 2,065 tests.
- git diff --check > /tmp/kalsa-s2-open-notes-diffcheck.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-s2-open-notes-diffcheck.log — EXIT=0. shasum -a 256 /tmp/kalsa-s2-open-notes-code.patch — EXIT=0; code patch SHA-256 (report excluded): ce62881c4ec5a5845322d2ce40e8772ec361b8182bd9febfd87e63280e2cfcf9.
- No build, install, or device capture was run.
