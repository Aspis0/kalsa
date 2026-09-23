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

- Baseline/HEAD: `ux-2026-09-21`, `4c781a4178b58a793ed4442ab3999c3dc0b480b9`; no commit.
- Tracked diff SHA-256: `69476ee757a9010bfbaf6e8bd4465e7ef0b57dc63c783f1a15aa8574b5040ef3` (untracked files excluded).
- Changes: v2 roles/type/space/radius in `src/theme/design.ts:40,100,103,133`; tests in `src/theme/design.test.ts`.
- Strip: 56 dp band and 44 dp model pill in `src/ui/shell/shellGeometry.ts:26-30`; extracted `ShellStrip.tsx:17` and status sheet; `Shell.tsx:153` mounts it.
- Composer: one 56 dp capsule in `src/ui/shell/ShellComposer.tsx:46` / `shellStyles.ts`; actions now live in `AttachSheet.tsx` and `HostAttachSheet.tsx`; removed permanent toolbar.
- Menu: rebuilt `src/theme/components/Drawer.tsx:43` and `DrawerContent.tsx:32`; four destinations, 56 dp rows; removed unused leaf-fold files. Search clear target is 48 dp at `DrawerContent.tsx:134`.
- Empty state: photo-only `welcomeBlock.tsx:17`, history gate `welcomeGate.ts:2`, mounted at `HostChatSurface.tsx:204`.
- Icons: nude glyphs in real targets; added `shellIconAcceptance.test.ts`; strip/jump localized label and drawer search clear target covered.
- Replaced `stripWebSwitch.test.ts`: removes old Web/new-chat strip controls and checks v2 menu/model pill.
- Replaced `composerToolbar.test.ts`: toolbar actions moved into the attach sheet; checks the single capsule and sheet rows.
- Replaced `composerToolbarWidth.test.ts`: no permanent toolbar remains to size; checks the 48 dp composer targets.
- Replaced `Drawer.test.ts:88-113`: leaf-fold interaction was removed; checks v2 menu structure and rows.
- Replaced `shareConversation.test.ts:103,127,133`: export-row placement was removed; v2 menu has four fixed footer destinations.
- Replaced `keyboardFocus.test.ts:11`: removed persona-pill route; checks close/back and template-to-field focus.
- Replaced `welcomeBlock.test.ts`: old greeting/card state is now a photo-only empty surface with fallback.
- Replaced `welcomeCopy.test.ts`: removed greeting/suggestion copy; retained history-loaded/message-count gate coverage.
- Replaced `stripTextBudget.test.ts`: checks the one-line v2 model pill budget instead of the old wide strip controls.
- Replaced `shellGeometry.test.ts`: checks the 56 dp strip, 44 dp pill and v2 composer geometry.
- Adapted `attachUi`, `composerArms`, `messageActions`, `modelBarRetry`, and `transcriptLayout` tests to the new sheet/overlay/geometry seams.
- Stage checks: `npx tsc --noEmit` EXIT=0 after tokens, strip, composer, menu, empty state, and final icons. `npx jest --silent` EXIT=0 at those stages: 166 suites / 2059, 2049, 2054, 2056, 2044 tests, respectively; final icons: 167 suites / 2052 tests.
- Icon corrections: first tsc EXIT=2 / Jest EXIT=1 (jump label type and source assertion); next tsc EXIT=0 / Jest EXIT=1 (locale import shadowed Jest `it`); corrected runs tsc EXIT=0 / Jest EXIT=0 (167 suites / 2050), then final tsc EXIT=0 / Jest EXIT=0 (167 / 2052).
- Final audits: `git branch --show-current` EXIT=0 (`ux-2026-09-21`); `git diff --check` EXIT=0; ratchets are Shell 203/342, HostChat 303/350, HostRoot 241/241. Headless Chrome mock renders for `conv/menu/settings/stream/switch`: EXIT=0; worktree remains uncommitted.
- Could not verify: device build/install and before/after device captures; the orchestrator will run those. No engine, governor, pins, Meter, `AppShell.tsx`, `AiChatPage.tsx`, or `HostRoot.tsx` changes.
