# C6 — Miniapp Prompt Productization: Implementation Report

**Date:** 2026-09-05
**Branch:** uncommitted (not pushed)
**Goal:** Make the existing miniapp renderer + actions usable as generic callable miniapps
without changing transport or the model — expand the prompt, add templates, wire `requiresAi`,
remove bio-dead code, add smoke tests.

---

## 1. What changed

| # | Spec item | File(s) | Status |
|---|-----------|---------|--------|
| A | Expand system-prompt block-type list (+5) | `src/i18n/en.ts`, `src/i18n/it.ts` | ✅ |
| B | Add 3 miniapp templates to `QuickActionSheet` | `src/theme/components/QuickActionSheet.tsx`, `src/domain/miniappTemplates.ts` | ✅ |
| C | Wire `requiresAi` action flag | `src/ui/AskAssistantMiniappRenderer.tsx` | ✅ |
| D | Remove bio-dead code (~1640 LOC) | `src/ui/AskAssistantMiniappRenderer.tsx`, `src/i18n/it.ts` | ✅ |
| E | Smoke tests for critical path | `src/app/miniappActions.smoke.test.ts` | ✅ |

---

## 2. Prompt expansion (item A)

The system prompt previously named only 8 block types (`table, chart, calculator, metric,
tabs, expandable, html, quiz`) out of 38 registered. Added a sentence naming the 5 most useful
generic types — `data_table`, `input_panel`, `result_card`, `action_bar`, `citations` — in **all
three** operative prompt locations, in **both** EN and IT:

- `en.ts` `systemPrompt.miniappBlockTypes` (new flat key)
- `en.ts` `systemPrompt` + `systemPromptWithSearch` ("Other block types: …")
- `en.ts` `operativeBlock.miniapp` ("block types also include …")
- `it.ts` mirrors of all of the above, **plus** the previously-missing expansion in
  `it.ts` `operativeBlock.miniapp` (IT's operative string had NOT been expanded — now fixed).

The 5 types are now intentionally producible by the model without any registry/transport change.

## 3. Templates (item B)

New pure module `src/domain/miniappTemplates.ts` defines `MINIAPP_TEMPLATES` (3 entries) and
`MINIAPP_TEMPLATE_IDS`, each resolving `labelKey` / `subKey` / `promptKey` from `quickActions.*`
in i18n. `QuickActionSheet` now expands its `miniapp` action inline into the 3 templates
(Compare data / Quick calculator / Reading quiz); choosing one fires `onChooseTemplate(template)`
so a caller can prefilled the chat with `t(template.promptKey)`. No mounting caller exists yet, so
the sheet stays decoupled via the optional callback.

Template → prompt (EN): `compare_data` → "Turn this data into a comparison table." ·
`quick_calculator` → "Work out this calculation and show the result." ·
`reading_quiz` → "Ask me a 4-question quiz on what I just read."

## 4. requiresAi (item C)

`runAction`'s `execute()` now short-circuits on `action.requiresAi` and surfaces
`miniapp.actionRequiresAi` ("This action needs the AI to run — ask the chat to execute it.")
instead of routing to a (non-existent) backend. Rendered with a `sparkles-outline` glyph.

## 5. Bio cleanup (item D)

~**1640 LOC** removed from `AskAssistantMiniappRenderer.tsx`: `PathwayEditorPanel`,
`PathwayGraphBlockView`, `MechanismLegendBlockView`, `PlateGridBlockView`, all `*Pathway*`
helpers, `LOCAL_ACTIONS` bio entries, `LEGACY_LAB_ACTION_IDS`, well-plate constants, and
`pathwayViewport` from `RendererContext`. Bio block types (`pathway_graph`, `plate_grid`,
`mechanism_legend`) were already unregistered in the registry; their `BlockView` functions and
helpers are now deleted.

Removed leftover bio i18n keys from `it.ts` `miniapp` block that had no EN counterpart
(`renameNode`, `edgeLabel`) — these broke the `LocaleStrings` type (derived from EN) and are now
gone. Remaining bio references in the tree are intentional: dead theme style keys in
`createStyles.ts` (`miniappPathwayEditorPanel*`, `miniappMechanismLegend*`) and explanatory
comments in the renderer — no broken references, no callers.

## 6. Smoke tests (item E)

New `src/app/miniappActions.smoke.test.ts` — **16 tests, all passing (exit 0)**. Node-safe via
mocked `expo-file-system/legacy` + `expo-sharing`.

- `parseMiniappFromText`: fenced JSON, raw JSON, text-only, empty input.
- `normalizeMiniapp`: valid (block cap 24), missing-envelope → null, non-object → null.
- `evaluateCalculatorFormula`: arithmetic precedence, id substitution, div-by-zero (`divzero`),
  overflow (`unsupported`), unsupported chars / length.
- `handleAskAssistantMiniappAction`: `generate_report`, `export_csv` (writes + reports), unknown
  id (error), case-insensitive id.
- i18n parity: `quickActions.*` keys match EN↔IT; all 9 template keys + `miniapp.actionRequiresAi`
  resolve in both languages.

## 7. Verification

- `npx jest src/app/miniappActions.smoke.test.ts` → **16 passed, 0 failed**.
- `npx tsc --noEmit` → **0 errors** (full-project; touched files clean).

## 8. Leftovers / follow-up

- Dead theme style keys in `src/theme/createStyles.ts` (`miniappPathwayEditorPanel*`,
  `miniappMechanismLegend*`) — unused, no callers. Safe to delete in a later pass; left as-is.
- `QuickActionSheet` has no mounting caller yet — templates are wired and ready; wire the sheet
  into the chat surface (and pass `onChooseTemplate`) in a follow-up PR.
- No i18n pass for hardcoded-English fallbacks (out of C6 scope).

## 9. Commit

`feat(miniapp): C6 — prompt types, templates, requiresAi, bio cleanup` — staged files only:

```
src/i18n/en.ts
src/i18n/it.ts
src/theme/components/QuickActionSheet.tsx
src/ui/AskAssistantMiniappRenderer.tsx
src/domain/miniappCalculator.js
src/domain/miniappCalculator.d.ts
src/domain/miniappTemplates.ts
src/app/miniappActions.smoke.test.ts
```

Unrelated dirty tree (docs/, out/, results/, n3.txt, device-decode-lineup-out/) intentionally left untouched. NOT pushed.