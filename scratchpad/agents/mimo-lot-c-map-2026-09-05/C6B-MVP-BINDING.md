# C6b MVP binding — `create_miniapp` tool (parent, 2026-09-06)

Source: `C6B-TOOL-MINIAPP-MAP.md` (Explorer). Parent verified: `TOOL_ENTRIES` in `src/agent/toolRegistry.ts`, `executeTool` in `AppShell.tsx:2027`, `onMiniapp` wired `AppShell.tsx:5194`, templates in `src/domain/miniappTemplates.ts` (prompt-only today).

## Product intent (Marco)

- Small on-device models fail free-form miniapp JSON in prose.
- Preferred path: **one tool call** → app builds `miniapp_v1`.
- Templates stay **generic / non-bio** (reuse the 3 C6 templates).
- Prose-parse remains **fallback**, not primary.

## In scope (single PR, Ornith first)

1. **Tool name** `create_miniapp` in `toolNames.ts` + `TOOL_ENTRIES` row (default on; no privacy gate / no egress).
2. **JSON Schema args** (tight enum):
   - `template`: enum `compare_data` | `quick_calculator` | `reading_quiz`
   - `slots`: object (additionalProperties ok) — builder validates
   - required: `["template"]`
3. **`buildMiniappV1(templateId, slots)`** in `miniappTemplates.ts` (or sibling `miniappBuilders.ts` if file would exceed ~250 lines):
   - `compare_data` → `data_table` (+ optional title)
   - `quick_calculator` → `calculator` / `input_panel`+`result_card` as already renderable
   - `reading_quiz` → `quiz` block (answerIndex 0–3, options length ≥2)
   - Invalid slots → `null` (executor returns error text, no broken UI)
4. **Executor** `createMiniappTool.ts` (or under `src/agent/`):
   - On success: `onMiniapp(normalizeMiniapp(built))` + return short `{ text }` for synthesis round
   - On failure: clear error string (EN; model language via existing locale pattern if other tools do it)
5. **Wire** in `AppShell` `executeTool` switch/dispatch like other tools; pass `onMiniapp` into executor factory.
6. **System / tool descriptions** EN+IT — short: when to call `create_miniapp` vs answering in prose; list the 3 templates.
7. **Tests**: builder unit tests (valid/invalid slots per template) + executor smoke (success calls onMiniapp, bad slots no call) + registry includes name.
8. **Keep** `parseMiniappFromText` fallback unchanged.

## Out of scope

- New block types in registry
- Grammar/GBNF experiments (native overlay already derives from schema; do not force grammar-on if other tools leave it off)
- Removing prose miniapp prompt entirely
- More than 3 templates
- Redesign of AskAssistantMiniappRenderer
- Push without parent verify

## Success criteria

- Small model can emit a short tool call with `template` enum + slots; UI opens/shows miniapp via existing `onMiniapp` → message.miniapp path.
- Invalid slots never crash renderer.
- `tsc` 0 on touched paths; targeted jest EXIT 0.
- No bio copy in new strings.

## Impl profile

**Ornith first.** Luna only if Ornith fails.
