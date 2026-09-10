# C6b Implementation Report — `create_miniapp` tool + builders

Date: 2026-09-06 · Branch: `feat/moe-stream` · Status: **COMMITTED** (not pushed)

Commit: `f659bda` — `feat(miniapp): C6b — create_miniapp tool + builders`

## Results (real exits, before pipe)

| Check | Command | Exit |
|-------|---------|------|
| tsc | `npx tsc --noEmit` | **TSC_EXIT:0** |
| jest (new tests) | `npx jest src/agent/createMiniappTool.test.ts src/agent/toolRegistry.test.ts` | **TEST_EXIT:0** (22 tests / 2 suites) |

## Files (9, all C6b — battery / QuickActionSheet untouched)

New:
- `src/domain/miniappBuilders.ts` — `buildMiniappV1(templateId, slots) → AskAssistantMiniapp | null`. Strict per-template validation; returns `null` on bad input.
- `src/agent/createMiniappTool.ts` — `CREATE_MINIAPP_TOOL` definition (enum of 3 templates, `required:["template"]`) + `makeCreateMiniappExecutor` (success → `onMiniapp(normalized)` + short text; failure → error text, no `onMiniapp`).

Modified:
- `src/agent/toolNames.ts` — `"create_miniapp"` added to `ToolName` union + `ALL_TOOL_NAMES` (wire order, after `calendar_agenda`).
- `src/agent/toolRegistry.ts` — `TOOL_ENTRIES` row: `toggleKey:null, defaultOn:true, gateTable:null` (no privacy gate / no egress).
- `src/app/AppShell.tsx` — `executeTool` branch for `"create_miniapp"`; `onMiniapp` threaded via `onMiniappRef` (captured at send in `handleSendStream`), executor created in the `agentOptions` memo.
- `src/i18n/en.ts` + `it.ts` — `createMiniappInvalidTemplate` / `createMiniappInvalidSlots` / `createMiniappCreated`.
- `src/agent/toolRegistry.test.ts` — updated to 8 tools (directly tests the registry I changed).
- `src/agent/createMiniappTool.test.ts` — builder (valid/invalid per template) + executor (success calls `onMiniapp`, bad slots no call, localized errors) + registry name/row/`assembleTools`.

## Design notes

- Templates → renderable blocks only: `compare_data → data_table`, `quick_calculator → calculator`, `reading_quiz → quiz`. No new block types / no renderer changes.
- Second validation guard: `buildMiniappV1` runs `normalizeMiniapp` on the built envelope; `null` → executor error (never a broken UI).
- `parseMiniappFromText` fallback left unchanged (prose path still primary for free-form).
- Grammar: none forced (matches other tools — GBNF auto-derived from JSON-Schema `parameters`).

## Leftovers

- Uncommitted dirty tree (`device-decode-lineup-out/`, `docs/`, `n3.txt`, `out/`, `results/`) is pre-existing and was **not** staged or committed.
- Not pushed (per task).