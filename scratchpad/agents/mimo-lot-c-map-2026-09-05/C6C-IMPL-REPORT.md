# C6c — Implementation report (child)

**Parent binding:** `C6C-TEMPLATE-SESSION-BINDING.md` (catalog v1, 6 templates, N-question quiz).
**Branch:** `feat/moe-stream` · **Commit:** `2fdaef4` (`2fdaef43a4cadca8a21c9b11d42097928629396c`) — **not pushed** (remote still at C6b `c26ad2f`).
**TSC_EXIT:** `0` · **TEST_EXIT:** `0` (36 passed / 1 failed → 0, after fixes).

## 1. Catalog (6 templates)
`compare_data`, `quick_calculator`, `reading_quiz` (now N questions), **`kpi_strip`**, **`checklist`**, **`pros_cons`**.

## 2. Renderer contracts inspected (matched exactly)
Inspected `src/ui/AskAssistantMiniappRenderer.tsx`:
- `metric_strip` → `getMetricRows(block)` reads `block.metrics[]` (capped 12); each metric uses `label`/`id` + `value` (number|string); `unit`/`tone` are declared schema fields.
- `timeline` → `TimelineBlockView` reads `block.items` ⧺ `block.steps` ⧺ `block.events` (capped 50); each entry renders `title`/`label`/`time`. **→ checklist normalizes to `steps[]` with `title`.**
- `data_table` → `normalizeTable` reads `block.columns[]` + `block.rows[]`; object rows map by `column.key`. **→ pros_cons uses fixed `["pro","con"]` columns + `[{pro,con}]` rows.**

## 3. Files changed (8, all C6c)
| File | Change |
|---|---|
| `src/domain/miniappTemplates.ts` | `MiniappTemplateId` + `MINIAPP_TEMPLATES`/`MINIAPP_TEMPLATE_IDS` → 6 ids. |
| `src/domain/miniappBuilders.ts` | Dispatcher routes `reading_quiz`/`kpi_strip`/`checklist`/`pros_cons` → new builders; exported shared helpers (`envelope`, `asString`, `asStringArray`, `safeAnswerIndex`, `isPlainObject`). Removed now-unused single-question `buildReadingQuiz`. |
| `src/domain/miniappBuildersNew.ts` **(new, 214 lines)** | `buildNQuestionQuiz`, `buildKpiStrip`, `buildChecklist`, `buildProsCons`, `buildC6c` dispatcher. |
| `src/agent/createMiniappTool.ts` | Tool description + slots enum/description list all 6. |
| `src/i18n/en.ts`, `src/i18n/it.ts` | quickActions labels/subs/prompts ×3 new; quiz copy fixed (no "4-question" lie); error text lists 6; systemPrompt / systemPromptWithSearch / operative.miniapp list 6 + prefer tool. |
| `src/screens/AiChatPage.tsx` | `miniappIcon` map gains `kpi_strip`/`pros_cons`→BarChart2, `checklist`→ClipboardList. |
| `src/agent/createMiniappTool.test.ts` | N-quiz + new-template + prompt-invariant tests. |

## 4. Validation rules enforced
- **reading_quiz**: `questions.length` 1..8 (0 and 9 → null); each item `question` (non-empty), `options` 2..4 (F2), optional in-range `answerIndex`, optional `explanation`; emits **one `quiz` block per question**.
- **kpi_strip**: `metrics` 1..8; each needs `label` + `value` (string|number); `unit`/`tone` optional.
- **checklist**: `steps[]` or `items[]` (string or `{title,body?}`), 1..12; string→`{title}`, object→`{title,title??body, body?}`.
- **pros_cons**: `rows[]` ≥1 with ≥1 non-empty `pro`/`con`; fixed `["pro","con"]` columns; empty rows skipped; `con`/`pro` kept as `""` when absent.

## 5. Tests (all green)
- N-quiz: 1/3/8 questions OK; 0 and 9 rejected; per-question option rules (2..4); per-question answerIndex (out-of-range → null grading, valid index kept); missing question text / non-array `questions` rejected.
- Each new template: valid build + invalid rejections (counts, missing label/value, non-array).
- Prompt invariant: en + it system prompts name **all 6** ids and steer `create_miniapp`; tool schema enum lists all 6.

## 6. Leftovers / notes
- No renderer block types added (out of scope); new templates reuse `quiz`/`metric_strip`/`timeline`/`data_table`.
- Checklist object items may carry `body`, but `TimelineBlockView` only renders `title`/`label`/`time` — `body` is passed through harmlessly (not rendered).
- Unrelated dirty-tree items (`device-decode-lineup-out/`, `docs/`, `out/`, `results/`, `n3.txt`) intentionally left uncommitted.
- Pending per binding: **parent verify + DeepSeek audit** before push.