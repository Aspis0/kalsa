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

## How this file is used

- **Every coder brief opens with the block above, verbatim**, before anything else.
- The **orchestrator** follows the same rules where they apply to it: `git add` by explicit path,
  the branch printed before each commit, and every commit message naming the repo, the branch and
  the parent HEAD. No push, no tag, no merge to `main`, ever, without the owner saying so.
- Where a rule and the project's existing state disagree, say so in the report: **pre-existing
  excess is declared, not refactored** — for example `src/app/AppShell.tsx` at 7261 lines and
  `src/screens/AiChatPage.tsx` at 6092 are the controller being replaced, not files to clean up in
  passing.
- The three ratchets in `src/host/fileSize.test.ts` (`src/host` ≤ 350, `HostRoot.tsx` ≤ 250,
  `src/ui/shell` ≤ 342) are this rule made executable, and they only ever go **down**.
