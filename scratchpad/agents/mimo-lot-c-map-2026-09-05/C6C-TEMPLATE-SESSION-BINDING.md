# C6c — Template session binding (parent, 2026-09-06)

Marco: agrees with catalog proposal; quiz must be **N questions**.

## Catalog v1 (6 templates)

| id | Purpose | Blocks produced |
|---|---|---|
| `compare_data` | Comparison table | `data_table` |
| `quick_calculator` | Formula calculator | `calculator` |
| `reading_quiz` | **N-question** quiz | **N × `quiz` blocks** (1 question each; existing QuizBlock) |
| `kpi_strip` **NEW** | Key metrics | `metric_strip` (`metrics: [{label,value,unit?,tone?}]`) |
| `checklist` **NEW** | Ordered steps / checklist | `timeline` (`steps` or `items` as strings/objects with title/body) |
| `pros_cons` **NEW** | Pros vs cons | `data_table` with columns `["pro","con"]` (or localized labels via slots) + rows |

## Slot contracts (strict; null on invalid)

### compare_data (unchanged)
`title?`, `columns: string[]` (non-empty), `rows?: object[]`

### quick_calculator (unchanged rules)
`title?`, `formula`, `fields?: {id,label?,value?}[]` — validate formula + unique ids

### reading_quiz — **CHANGED**
```
title?
questions: Array<{
  question: string,
  options: string[2..4],
  answerIndex?: int in range,
  explanation?: string
}>
```
- Require `questions.length` in **1..8** (reject 0 or >8).
- Each item same validation as former single quiz.
- Builder emits one `quiz` block per question (optional per-block title `Q1`… or omit).
- **Do not** invent a multi-question QuizBlock type.

### kpi_strip **NEW**
`title?`, `metrics: Array<{ label: string, value: string|number, unit?: string, tone?: string }>`  
Require 1..8 metrics; each needs label + value.

### checklist **NEW**
`title?`, `steps: string[]` OR `items: Array<string | {title, body?}>`  
Require 1..12 steps/items after normalize to timeline `steps`/`items` shape the renderer accepts. Inspect TimelineBlockView once; match its expected fields.

### pros_cons **NEW**
`title?`, `rows: Array<{ pro?: string, con?: string }>`  
Require ≥1 row with at least one of pro/con non-empty. Columns fixed `["pro","con"]` (or `Pros`/`Cons` labels via column objects if data_table supports `{key,label}` — prefer simple string columns `pro`/`con` for small models).

## Copy (EN+IT) — Sessione C

- Sheet labels/subs/prompts for all 6; **fix quiz copy** (no more “4-question quiz” lie — say “quiz with several questions” / “quiz a più domande”).
- Tool schema enum + descriptions for all 6.
- systemPrompt / systemPromptWithSearch / operative.miniapp: list all 6 templates; prefer tool; prose fallback for other layouts.

## Files to touch

- `miniappTemplates.ts` — 6 ids + sheet entries
- `miniappBuilders.ts` — N-quiz + 3 new builders
- `createMiniappTool.ts` — schema enum
- `createMiniappTool.test.ts` — N-quiz + new templates + prompt invariant
- `en.ts` / `it.ts` — quickActions + tool/errors + system prompts
- QuickActionSheet already maps `MINIAPP_TEMPLATES` — should pick up new entries automatically if icons handled (add icons for new ids)

## Out of scope

- New renderer block types
- Changing QuizBlock component internals
- Removing prose fallback
- Battery / unrelated dirty tree

## Impl

**Ornith first.** Targeted jest + real `tsc` exit. Commit, no push until parent verify + DeepSeek audit.
