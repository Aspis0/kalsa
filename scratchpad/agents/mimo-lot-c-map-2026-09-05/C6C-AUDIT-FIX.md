# C6c — Audit-Fix Report (DeepSeek findings 1–9) · commit `b56d5bc` on `feat/moe-stream`

**Date:** 2026-09-06 · **Mode:** fix-only (source edited) · **Parent audit:** `C6C-AUDIT-DEEPSEEK.md`.

## Verify (re-run)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit **0** ✓ |
| Test (targeted) | `npx jest src/agent/createMiniappTool.test.ts` | **39 passed** ✓ (36 + 3 new) |
| Test (full) | `npx jest` | 49 suites, **487 passed** ✓ |
| Smoke | `npx jest src/app/miniappActions.smoke.test.ts` | 18 passed ✓ |

## Findings fixed

**F-1 (slots description)** — `createMiniappTool.ts` now documents real per-template contracts: `compare_data (title?, columns[], rows[])`, `quick_calculator (title?, formula, fields[])`, `reading_quiz (title?, questions[] of {question, options[2..4], answerIndex?, explanation?})`, `kpi_strip (title?, metrics[] of {label, value, unit?, tone?})`, `checklist (title?, steps[] or items[])`, `pros_cons (title?, rows[] of {pro?, con?})`. Removed the fictional top-level `pro, con`.

**F-2 (icons)** — `QuickActionSheet.templateIcon` now cases `compare_data`→Columns2, `quick_calculator`→Calculator, `reading_quiz`→HelpCircle, `kpi_strip`→BarChart2, `checklist`→ListChecks, `pros_cons`→Scale (imported `BarChart2/ListChecks/Scale`). `AiChatPage.miniappIcon` reconciled: all 6 tool kinds (`compare_data`/`quick_calculator`/`reading_quiz`/`kpi_strip`/`checklist`/`pros_cons`) now resolve; legacy model-chosen kinds (`calculator`/`comparison`/`planner`/`quiz`) kept as fallback. Imported `Calculator/Columns2/HelpCircle/ListChecks/Scale`.

**F-3 (checklist body)** — `buildChecklist` no longer emits a `body` field the renderer ignores. `body` is promoted to the visible title only when no `title` is given, then dropped (verified: `steps[i].body` is `undefined`).

**F-4 (pros_cons headers)** — added `miniapp.pro`/`miniapp.con` keys (EN `Pro`/`Con`, IT `Pro`/`Contro`); threaded a `ColumnLabels` map from the executor → `buildMiniappV1` → `buildC6c` → `buildProsCons`. `columns` are now `[{key:"pro",label}, {key:"con",label}]` — `key` stays stable for row lookup, `label` is localized.

**F-9 (IT copy)** — `"Preferito lo strumento"` → `"Preferisci lo strumento"` (both systemPrompt + systemPromptWithSearch); `"usa solo sei templates"` → `"usa solo questi sei modelli"`. No residual matches.

## Tests added (pin the fixes)

- `checklist promotes body to the visible title and drops it (F-3)` — body-only item → `{title:"Only body"}`, `body` undefined; titled item keeps title, drops body.
- `pros_cons localizes column headers via labels (F-4)` — builder-level custom labels → `{key,label}` columns; key stays stable.
- `F-1: pros_cons reads rows[], not top-level pro/con` — `{pro,con}` without `rows[]` → `null` (invalid_slots).
- `executor localizes headers by locale (F-4)` — IT executor → columns equal `getStrings("it").miniapp.{pro,con}`.

## Commit

`b56d5bc` (`fix(miniapp): C6c — slot docs, icons, checklist/pros_cons polish`) — 8 C6c files, +151/−30. **Not pushed** (remote still at C6b `c26ad2f`).

Leftovers: F-5 (per-field byte cap / 64 KiB block) deferred to a follow-up ticket (optional, not clean as a one-liner — reject-vs-truncate is a design choice); F-8 (unified rejection/skip/truncate policy across builders, kpi whitespace guard) deferred. Untracked build/audit artifacts (`docs/`, `out/`, `results/`, `n3.txt`, `device-decode-lineup-out/`) left out of the commit.