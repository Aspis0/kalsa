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

- Base: `4c781a4178b58a793ed4442ab3999c3dc0b480b9`; review branch `ux-2026-09-21` at `6a8cc1e` (capture commit atop `3a23639`); no commit created.
- Reviewer source diff SHA-256 (`git diff 3a23639 -- . ':(exclude)docs/REPORT-IMPL-1.md' | shasum -a 256`, EXIT=0): `c4b0712e06ee4f8f988cd860a44368e7044905e376fb409faa8fa1693c51571b`; untracked helper SHA-256: `e6955371725b4bf8de3f0d73a5e22dafdd9b0159a03e1d455ec8227c260a3932` (separate because `git diff` omits untracked files).
- Changes: v2 roles/type/space/radius in `src/theme/design.ts:40,100,103,133`; tests in `src/theme/design.test.ts`.
- Strip: 56 dp band and 44 dp model pill in `src/ui/shell/shellGeometry.ts:26-30`; extracted `ShellStrip.tsx:17` and status sheet; `Shell.tsx:153` mounts it.
- Composer: one 56 dp capsule in `src/ui/shell/ShellComposer.tsx:46` / `shellStyles.ts`; actions now live in `AttachSheet.tsx` and `HostAttachSheet.tsx`; removed permanent toolbar.
- Menu: rebuilt `src/theme/components/Drawer.tsx:43` and `DrawerContent.tsx:32`; five destinations, 56 dp rows; removed unused leaf-fold files. Search clear target is 48 dp at `DrawerContent.tsx:134`.
- Empty state: photo-only `welcomeBlock.tsx:17`, history gate `welcomeGate.ts:2`, mounted at `HostChatSurface.tsx:204`.
- Icons: nude glyphs in real targets; added `shellIconAcceptance.test.ts`; strip/jump localized label and drawer search clear target covered.
- Replaced `stripWebSwitch.test.ts`: removes old Web/new-chat strip controls and checks v2 menu/model pill.
- Replaced `composerToolbar.test.ts`: toolbar actions moved into the attach sheet; checks the single capsule and sheet rows.
- Replaced `composerToolbarWidth.test.ts`: no permanent toolbar remains to size; checks the 48 dp composer targets.
- Replaced `Drawer.test.ts:88-113`: leaf-fold interaction was removed; checks v2 menu structure and rows.
- Replaced `shareConversation.test.ts:103,127,133`: the earlier negative export-row contract is now positive coverage for the restored fifth row and root handler.
- Replaced `keyboardFocus.test.ts:11`: removed persona-pill route; checks close/back and template-to-field focus.
- Replaced `welcomeBlock.test.ts`: old greeting/card state is now a photo-only empty surface with fallback.
- Replaced `welcomeCopy.test.ts`: removed greeting/suggestion copy; retained history-loaded/message-count gate coverage.
- Replaced `stripTextBudget.test.ts`: checks the one-line v2 model pill budget instead of the old wide strip controls.
- Replaced `shellGeometry.test.ts`: checks the 56 dp strip, 44 dp pill and v2 composer geometry.
- Adapted `attachUi`, `composerArms`, `messageActions`, `modelBarRetry`, and `transcriptLayout` tests to the new sheet/overlay/geometry seams.
- Reviewer Fix 1: `ShellComposer.tsx:68,137-143` uses brand/onBrand for the enabled send circle and spinner; the two-scheme assertion is at `design.test.ts:258`.
- Reviewer Fix 2: `HostChatSurface.tsx:111,215` passes `pillWhereLabel` through `Shell.tsx:42,160` to `ShellStrip.tsx:40`; refusal uses the existing tint/ink3 treatment. `modelFailureState.test.ts:83-110` pins the refusal and phone-only boundary. Monitor/Kalsa Brain is unreachable until backend location state arrives from `src/engine/` on `remote-brain`; this answers the blocker with an honest boundary, not a fabricated literal.
- Reviewer Fix 3: `HostLayout.tsx:44,75,110` forwards the root callback; `HostDrawer.tsx:21-38` appends Esporta chat; `DrawerContent.tsx:47` orders it fifth; `exportDrawerItem.ts:3` builds the row; `shareConversation.test.ts:92-130` proves the row and handler.
- Preview binding text corrected at `ShellPreview.tsx:11,147`.
- Reviewer checks: `cd /Users/marco/Projects/kalsa-ux && npx tsc --noEmit > /tmp/kalsa-ux-review-tsc.log 2>&1; code=$?; echo "EXIT=$code"; tail -30 /tmp/kalsa-ux-review-tsc.log; exit "$code"` EXIT=0; `cd /Users/marco/Projects/kalsa-ux && npx jest --silent > /tmp/kalsa-ux-review-jest.log 2>&1; code=$?; echo "EXIT=$code"; tail -30 /tmp/kalsa-ux-review-jest.log; exit "$code"` EXIT=0 (167 suites / 2055 tests). Targeted `npx jest --runInBand --silent src/theme/design.test.ts src/host/modelFailureState.test.ts src/host/shareConversation.test.ts src/theme/components/Drawer.test.ts src/ui/shell/shellIconAcceptance.test.ts` EXIT=0 (5 suites / 71 tests).
- Stage checks: `npx tsc --noEmit` EXIT=0 after tokens, strip, composer, menu, empty state, and final icons. `npx jest --silent` EXIT=0 at those stages: 166 suites / 2059, 2049, 2054, 2056, 2044 tests, respectively; final icons: 167 suites / 2052 tests.
- Icon corrections: first tsc EXIT=2 / Jest EXIT=1 (jump label type and source assertion); next tsc EXIT=0 / Jest EXIT=1 (locale import shadowed Jest `it`); corrected runs tsc EXIT=0 / Jest EXIT=0 (167 suites / 2050), then final tsc EXIT=0 / Jest EXIT=0 (167 / 2052).
- Final audits: `git branch --show-current` EXIT=0 (`ux-2026-09-21`); `git diff --check` EXIT=0; ratchets are Shell 203/342, HostChat 303/350, HostRoot 241/241. Headless Chrome mock renders for `conv/menu/settings/stream/switch`: EXIT=0; worktree remains uncommitted.
- Could not verify: device build/install and before/after device captures; the orchestrator will run those. No engine, governor, pins, Meter, `AppShell.tsx`, `AiChatPage.tsx`, or `HostRoot.tsx` changes.
