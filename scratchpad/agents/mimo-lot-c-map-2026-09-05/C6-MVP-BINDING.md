# C6 MVP binding (parent, 2026-09-05)

Source map: `C6-MINIAPP-PIPELINE-MAP.md` (Explorer MiMo, parent-verified prompt list @ `en.ts:1042–1073` / `1105–1109`, `requiresAi` flag @ renderer L28 / L3816, LEGACY_LAB @ L288/L3673, plate/pathway comments @ L3117/L3216).

## In scope (single PR, prefer Ornith)

1. **Expand system prompt block-type list** in `operativeBlock` miniapp string + `systemPrompt` + `systemPromptWithSearch` (EN) **and IT mirrors**:
   - Keep existing 8: table, chart, calculator, metric, tabs, expandable, html, quiz
   - Add: `data_table`, `input_panel`, `result_card`, `action_bar`, `citations`
   - Short schema hints only (~100 tokens), no novel block types in registry

2. **3 QuickActionSheet miniapp templates** (prefill chat prompts):
   - Compare data → "Create a comparison table of…"
   - Quick calculator → "Create a calculator for…"
   - Reading quiz → "Create a 4-question quiz about…"
   - EN+IT labels

3. **Wire `requiresAi`**: when action has `requiresAi`, surface clear i18n feedback (`miniapp.actionRequiresAi`) instead of generic "not supported". No fake AI dispatch backend.

4. **Delete bio dead code** (~900 LOC) from `AskAssistantMiniappRenderer.tsx` + related: pathway editor/views, plate_grid view, mechanism_legend, LEGACY_LAB_ACTION_IDS / LOCAL_ACTIONS bio, well-plate constants, unused i18n keys (`noEditablePlate`, `plateCleared`, `legacyLabActions`). Do not break registered 37 types.

5. **Smoke tests** (new files, targeted only):
   - `parseMiniappFromText` / `normalizeMiniapp` (fenced, raw, text-only, oversized)
   - `handleAskAssistantMiniappAction` (export_csv, generate_report, unknown, requiresAi message path if testable)
   - calculator formula eval basics if exported/pure

## Out of scope

- New transport / `onMiniapp` emit path
- New registry block types
- Full i18n pass for hardcoded English fallbacks in block views
- Inline (non-overlay) miniapp rendering
- submit/save/navigate/share backends beyond requiresAi UX message
- Hard stop / battery (C7)

## Sequencing

Wait for C7 commit before Ornith touches `en.ts`/`it.ts`/`AppShell` overlap. C6 after C7 push.

## Impl profile

**Ornith first.** Luna only if Ornith fails (session/mtplx).
