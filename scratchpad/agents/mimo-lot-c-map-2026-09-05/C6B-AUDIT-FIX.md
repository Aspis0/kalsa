# C6b Audit-Fix Report — `c26ad2f` `feat/moe-stream`

Fix pass over audit commit `f659bda` (`create_miniapp` tool + builders). READ-ONLY audit
(`C6B-AUDIT-DEEPSEEK.md`) was correct; this commit implements its fix-first items.

Verification re-run on the exact commit `c26ad2f`:
- `npx tsc --noEmit` → **0**
- `npx jest src/agent/createMiniappTool.test.ts src/agent/toolRegistry.test.ts` → **29 passed / 2 suites**

## What changed (5 files, +150 / −12)

| File | Fix |
|---|---|
| `src/i18n/en.ts` | F1: systemPrompt / systemPromptWithSearch / operativeBlock.miniapp steer `create_miniapp` (templates `compare_data` \| `quick_calculator` \| `reading_quiz` + slots); prose `miniapp_v1` JSON kept as **fallback only**. |
| `src/i18n/it.ts` | F1: same guidance, IT mirror. |
| `src/domain/miniappBuilders.ts` | F2 quiz cap 2..4 (reject >4); F3 formula validated via `evaluateCalculatorFormula`; F4 reject empty/duplicate field ids. |
| `src/app/AppShell.tsx` | F5: reset `onMiniappRef.current = () => {}` in `finish()`. |
| `src/agent/createMiniappTool.test.ts` | F2/F3/F4 builder rules, success-text identity, system-prompt invariant guard. |

## Fix-first items (from audit)

**F1 HIGH — implemented.** Both locales now tell the small on-device model to *call*
`create_miniapp` (template enum + slots) and treat prose `miniapp_v1` JSON as a fallback.
- `en.ts` operativeBlock.miniapp: prepended "Prefer the create_miniapp tool … fall back to
  emitting miniapp_v1 JSON by hand."
- `en.ts` systemPrompt + systemPromptWithSearch: appended "You can also build a miniapp with
  the create_miniapp tool … Prefer the tool; write miniapp_v1 JSON only when you need a
  layout the tool does not offer." and reworded the emit sentence to "As a fallback …".
- `it.ts` mirrors both (same two insertions + operativeBlock prepend).
- Note: inserted text uses an ASCII hyphen (`-`), not an em dash, to match the surrounding
  short-model copy and avoid any encoding edge. The 69 pre-existing em dashes in the file are
  untouched.

**F2 MED — implemented.** `buildReadingQuiz` now rejects `options.length > 4` as invalid
slots (in addition to `< 2`). No truncation happens in the builder, so a safe `answerIndex`
(`0..length-1`) can never be invalidated. The old "out-of-range → grading disabled" test for
the 2-option case is kept; a new `>4 options → null` test is added.

**F3 MED — implemented.** `buildQuickCalculator` calls `evaluateCalculatorFormula(formula,
fieldsToVars(fields))` (reusing the renderer's pure helper + `CALC_MAX_FORMULA_LEN`) and
returns `null` when `ok !== true`. Bare arithmetic (no fields) still succeeds. New tests:
unbalanced parens, bad charset, and referencing an unknown field id all → `null`.

**F4 LOW — implemented.** `buildCalculatorFields` rejects empty or duplicate field ids
(previously empty ids collapsed to `""`, causing duplicate React keys / value bleed).

**F5 optional — implemented.** `finish()` now resets `onMiniappRef.current = () => {}`. Sends
are already serial (F7's residual risk is one-line hardening, not a live exploit).

**F8 / F5-cosmetic (F5 in audit list) — deferred by design.** F8 (one on-device 2B smoke run
proving the small model emits `template`+`slots`) is an ops step, not code; leave for a manual
turn. F5/F6/F9/F12 (icon mapping, dead double-normalization, English fallback titles) are
cosmetic and left for a follow-up.

## Remaining (not committed, by choice)
- Pre-existing dirty tree (`docs/`, `out/`, `n3.txt`, `results/`, `device-decode-lineup-out/`)
  left unstaged — unrelated to C6b.
- F8 on-device smoke run (manual, small-model emit test) — not run.