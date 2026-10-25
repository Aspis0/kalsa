# CODER-BRIEF — the owner's standing instructions for every coder

Paste this block **verbatim** into every coder brief. It is the owner's own text, kept word for
word on purpose: paraphrasing it is how a rule loses its teeth. The orchestrator's own additions to
a brief (the slice, the traps, the acceptance criteria) come *after* it.

---

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

---

# Slice 1 implementation report

- Base: `4c781a4178b58a793ed4442ab3999c3dc0b480b9`; review branch `ux-2026-09-21` at `6a8cc1e` (capture atop `3a23639`); owner follow-up base `a7ea2c7`; no commit created.
- Follow-up diff SHA-256 (`git diff a7ea2c7 -- . ':(exclude)docs/REPORT-IMPL-1.md' | shasum -a 256`, EXIT=0; includes owner's `DESIGN-V2.md` edit): `8e46609fa80d9f8619b27a5615784d345d6980f2f9819d0de6ad7364877debe9`; untracked `conversationRowActions.ts` SHA-256: `3dc97b347ed96dc6d28fb4e60111576ab78401dcde54be6a4f096d81565cd4ce`.
- Changes: v2 roles/type/space/radius in `src/theme/design.ts:40,100,103,133`; tests in `src/theme/design.test.ts`.
- Strip: 56 dp band and 44 dp model pill in `src/ui/shell/shellGeometry.ts:26-30`; extracted `ShellStrip.tsx:17` and status sheet; `Shell.tsx:153` mounts it.
- Composer: one 56 dp capsule in `src/ui/shell/ShellComposer.tsx:46` / `shellStyles.ts`; actions now live in `AttachSheet.tsx` and `HostAttachSheet.tsx`; removed permanent toolbar.
- Menu: four global destinations in `src/theme/components/DrawerContent.tsx:47`; conversation long press opens the existing shell `AttachSheet` from `HostDrawer.tsx:63-65`.
- Empty state: photo-only `welcomeBlock.tsx:17`, history gate `welcomeGate.ts:2`, mounted at `HostChatSurface.tsx:204`.
- Icons: nude glyphs in real targets; added `shellIconAcceptance.test.ts`; strip/jump localized label and drawer search clear target covered.
- Replaced `stripWebSwitch.test.ts`: removes old Web/new-chat strip controls and checks v2 menu/model pill.
- Replaced `composerToolbar.test.ts`: toolbar actions moved into the attach sheet; checks the single capsule and sheet rows.
- Replaced `composerToolbarWidth.test.ts`: no permanent toolbar remains to size; checks the 48 dp composer targets.
- Replaced `Drawer.test.ts:88-113`: leaf-fold interaction was removed; checks v2 menu structure and rows.
- Replaced the incorrect global-export assertions in `shareConversation.test.ts:99-150` with four-foot coverage and a row-id-bound action test; Markdown byte assertions at `:40-57` are unchanged.
- Replaced `keyboardFocus.test.ts:11`: removed persona-pill route; checks close/back and template-to-field focus.
- Replaced `welcomeBlock.test.ts`: old greeting/card state is now a photo-only empty surface with fallback.
- Replaced `welcomeCopy.test.ts`: removed greeting/suggestion copy; retained history-loaded/message-count gate coverage.
- Replaced `stripTextBudget.test.ts`: checks the one-line v2 model pill budget instead of the old wide strip controls.
- Replaced `shellGeometry.test.ts`: checks the 56 dp strip, 44 dp pill and v2 composer geometry.
- Adapted `attachUi`, `composerArms`, `messageActions`, `modelBarRetry`, and `transcriptLayout` tests to the new sheet/overlay/geometry seams.
- Reviewer Fix 1: `ShellComposer.tsx:68,137-143` uses brand/onBrand for the enabled send circle and spinner; the two-scheme assertion is at `design.test.ts:258`.
- Reviewer Fix 2: `HostChatSurface.tsx:111,215` passes `pillWhereLabel` through `Shell.tsx:42,160` to `ShellStrip.tsx:40`; refusal uses the existing tint/ink3 treatment. `modelFailureState.test.ts:83-110` pins the refusal and phone-only boundary. Monitor/Kalsa Brain is unreachable until backend location state arrives from `src/engine/` on `remote-brain`; this answers the blocker with an honest boundary, not a fabricated literal.
- Row-id behavior: `conversationActions.ts:253-262` passes the real conversation state to `conversationRowActions.ts:11-29`; `shareConversation.test.ts:108-167` builds active and older rows, exports the older row, checks the active ID is never sent, and reads that row's history. The Markdown byte assertions at `shareConversation.test.ts:40-57` remain unchanged.
- Export dismissal: `HostDrawer.tsx:42-49` uses `runConversationRowAction` from `conversationRowActions.ts:59-67`; `shareConversation.test.ts:144-150` verifies sheet-close, drawer-close, export order.
- Sheet heading: `HostDrawer.tsx:65-70` passes the selected title to `AttachSheet.tsx:51-57,119-151`; `attachUi.test.ts:58-63` pins the accessible heading.
- Accessibility: `DrawerContent.tsx:166-171` exposes a named custom accessibility action and hint that open the same sheet; `Drawer.test.ts:44-48` pins the route. Both locales define the action copy in `i18n/en.ts` and `i18n/it.ts`.
- No rename implementation exists in `src`; the row sheet presents Esporta and Elimina. Preview binding text was corrected at `ShellPreview.tsx:11,147`.
- Focused command: `npx jest --runInBand --silent src/host/shareConversation.test.ts src/theme/components/Drawer.test.ts src/ui/shell/attachUi.test.ts > /tmp/kalsa-ux-review-focused-jest.log 2>&1; code=$?; echo "EXIT=$code"; tail -30 /tmp/kalsa-ux-review-focused-jest.log; exit "$code"` EXIT=0 (3 suites / 40 tests).
- Final type check: `npx tsc --noEmit > /tmp/kalsa-ux-review-final-tsc.log 2>&1; code=$?; echo "EXIT=$code"; tail -30 /tmp/kalsa-ux-review-final-tsc.log; exit "$code"` EXIT=0.
- Final suite: `npx jest --silent > /tmp/kalsa-ux-review-final-jest.log 2>&1; code=$?; echo "EXIT=$code"; tail -30 /tmp/kalsa-ux-review-final-jest.log; exit "$code"` EXIT=0 (167 suites / 2055 tests).
- Earlier stage checks: `npx tsc --noEmit` EXIT=0 after tokens, strip, composer, menu, empty state, and final icons. `npx jest --silent` EXIT=0 at those stages: 166 suites / 2059, 2049, 2054, 2056, 2044 tests; final icons 167 suites / 2052 tests. Earlier icon attempts: tsc EXIT=2 / Jest EXIT=1, then tsc EXIT=0 / Jest EXIT=1; corrected runs passed (167 / 2050, then 167 / 2052).
- Final audit: branch `ux-2026-09-21`, HEAD `0872378`; `git diff --check` EXIT=0; ratchets remain Shell 203/342, HostChat 303/350, HostRoot 241/241; no commit. Source diff excluding this report: `git diff 0872378 -- . ':!docs/REPORT-IMPL-1.md' | shasum -a 256` EXIT=0, `350a5bb4a637cc24751d09fecf3525de04b3b01ab99a8dd3297a8a844dc16a45`.
- Could not verify: device build/install and captures; the orchestrator will run them. No engine, governor, pins, Meter, `AppShell.tsx`, or `AiChatPage.tsx` changes; `HostRoot.tsx:231` remains the row-id export handler.
