# BRIEF - Stage 0b, app side: per-phone decode-pacing skin lines

Target: repo `kalsa` (Aspis0), worktree `/Users/marco/Projects/kalsa-wt-severe`, detached at
`aa789620` (the Stage 0 app commit). App only: no binding change, no engine change, no pin move,
no APK.

Write the brief in one go from the source of truth: the coordinator addendum
`scratchpad/agents/learning-governor/DESIGN-ADDENDUM-2026-10-15.md`, Item A, plus the code as it
stands in `src/engine/declaredSevere.ts` at `aa789620`.

## Clean-code contract (verbatim, it is binding)

```
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
```

## The change, exactly

In `src/engine/declaredSevere.ts`:

1. Add optional `startSkinC` / `fullSkinC` to the `DECLARED_SEVERE` row type (`:18`), both
   `number | undefined` by omission - do not add a null default or a sentinel.
2. The Xiaomi 14 row (`:28`, `{ model: /^23127PN0CG$/, severeSkinC: 66.5 }`) gets
   `startSkinC: 39.0` / `fullSkinC: 42.6`.
3. `pacingHeadroomLines` (`:46-57`) feeds `headroomAt` `row.startSkinC ?? PACING_START_SKIN_C` and
   `row.fullSkinC ?? PACING_FULL_SKIN_C`. `headroomAt` itself does not change.
4. The shared constants (`:8-9`) stay as the default, with a comment that says which phones use
   them today and why (the S23's calibrated lines) - a comment must be true: after this change the
   S23 row uses the default pair and the Xiaomi row declares its own.

Arithmetic the audit will check by hand - do not "fix" these, they are the contract:

| phone | start | full |
|---|---|---|
| S23 (`SEVERE 42.0`, default pair) | `(38.1 - 12) / 30` = **0.87** | `(41.7 - 12) / 30` = **0.99** |
| Xiaomi 14 (`SEVERE 66.5`, own lines) | `(39.0 - 36.5) / 30` = **0.083** | `(42.6 - 36.5) / 30` = **0.203** |

`src/engine/declaredSevere.test.ts` (or wherever it lives - read it, the path may differ):
re-pin the Xiaomi cases from today's 0.053 / 0.173 to 0.083 / 0.203, and keep the S23 cases at
0.87 / 0.99 as the regression guard for "a row that declares no lines still gets the shared pair".
Add one case that a row with no lines and no declared SEVERE still returns `null`.

## Out of scope - do not touch

- No second table, no per-model map refactor, no new file unless the existing test file genuinely
  stops being readable (it should not need one).
- No change to the binding, the engine, `package.json`, the lockfile or the pin.
- No `apk.yml`, no CI dispatch, no push, no tag, no new branch (you are on a detached HEAD; commit
  there and report the new sha).
- Do not "fix" the Stage 2 freshness gate or the blind budget: those are paper items in the
  addendum (Items B and C), not this step.

## Verify before you report (quote the real exit codes)

1. `npx jest src/engine/declaredSevere --silent > /tmp/out.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/out.log`
2. The wider governor input tests that could touch these lines (find them, do not guess the names):
   run them and quote the count and the exit code.
3. `git -C /Users/marco/Projects/kalsa-wt-severe diff --stat` and the full diff of the commit you made.
4. Confirm you did not modify anything outside the files you name.

## Report format

English. `file:line` for every change, the exact commands with their real `EXIT=` values, the new
commit sha, and an explicit list of what you could NOT verify (e.g. anything needing a device).