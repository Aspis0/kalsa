# C6 — Miniapp Pipeline Map (Kalsa)

> Branch: `feat/moe-stream` · Date: 2026-09-05  
> Read-only audit for LOT-C **Miniapp productization** (callable/structured miniapps on existing actions).

---

## 1. Existing Surfaces

| Surface | File | Role |
|---|---|---|
| **Type definitions** | `src/domain/askAssistant.d.ts` | `AskAssistantMiniapp` envelope, `parseMiniappFromText`, `normalizeMiniapp`, `normalizeMiniappBlock`, `normalizeQuizBlock` |
| **Parse / normalize** | `src/domain/askAssistant.js:237–517` | Balanced-brace JSON scanner, fence extraction, soft-normalize with caps (`MAX_MINIAPP_BLOCKS=24`, `MAX_BLOCK_JSON_BYTES=64KB`) |
| **Block registry + renderer** | `src/ui/AskAssistantMiniappRenderer.tsx:2938–3676` | `ASK_ASSISTANT_MINIAPP_BLOCK_REGISTRY` — 37 block types, each with `render`, `schemaFields`, `capabilities`, `visual` preset |
| **Actions dispatch** | `src/app/miniappActions.ts` | `handleAskAssistantMiniappAction` — `export_csv`, `generate_report`, fallthrough → "not supported" |
| **Legacy lab actions** | `src/ui/AskAssistantMiniappRenderer.tsx:259–300` | `LOCAL_ACTIONS` + `LEGACY_LAB_ACTION_IDS` — plate/pathway actions blocked from registry but code dormant in renderer |
| **Shell wiring** | `src/app/AppShell.tsx:314,4383–4386,5682–5715` | Overlay drawer; renders `AskAssistantMiniappRenderer` inside full-screen modal |
| **Chat extraction** | `src/screens/AiChatPage.tsx:63,619–694,2467–2621` | `sanitizeHistoryMessages` normalizes miniapps from history; `parseMiniappFromText` extracts from final assistant text |
| **Operative prompt** | `src/context/operativeBlock.ts:38–44` | `buildOperativeBlock` assembles language + web_search + honesty + **miniapp** rules |
| **System prompts** | `src/i18n/en.ts:1042–1073,1105–1109` | Miniapp block type list + envelope shape + quiz privacy rule |
| **i18n (renderer chrome)** | `src/i18n/en.ts:540–627` | `miniapp.*` + `renderer.*` strings — fallback labels, export feedback, pathway editor labels |
| **i18n (quiz)** | `src/i18n/en.ts:627+` | `quiz.*` — check, retry, correct, wrong, notGradable |
| **Math core** | `src/domain/miniappMathCore.js` (referenced) | `computeStatistics`, `fitRegression`, `convertVolumeDensityToMass` |
| **Quick-action entry** | `src/theme/components/QuickActionSheet.tsx:11,41` | `"miniapp"` quick-action type |
| **Tool gate** | `src/rules/toolGateRegistry.ts` + `.test.ts:40–43` | Miniapp tools are exempt from gate expansion |
| **Quiz block** | `src/ui/blocks/QuizBlock.tsx` | Standalone interactive quiz component (radio + check + retry) |
| **Lab theme** | `src/ui/labTheme.ts` (referenced) | Glass surface variant selector |

---

## 2. Block Types (Registry)

All 37 registered block types from `ASK_ASSISTANT_MINIAPP_BLOCK_REGISTRY` (`AskAssistantMiniappRenderer.tsx:2938–3676`):

| Type | `schemaFields` | Editable | AI Action | Export | Visual Role |
|---|---|---|---|---|---|
| `action_bar` | actions, actionItems, title | ✓ | ✓ | — | command_bar |
| `action_row` | actions, actionItems, title | ✓ | ✓ | — | inline_actions |
| `ai_insight` | body, confidence, title | — | — | ✓ | ai_explanation |
| `insight` | body, summary, text, title | — | — | ✓ | insight |
| `calculator` | fields, formula, expr, label, title, value, result | ✓ | — | ✓ | calculator |
| `chart` | fit, kind, points, series, title, x, y | — | — | ✓ | scientific_plot |
| `citations` | citations, items, title | — | — | ✓ | source_list |
| `data_table` | columns, rows, title | — | — | ✓ | data_table |
| `editable_table` | columns, rows, title | ✓ | — | ✓ | editable_data_table |
| `expandable` | blocks, initiallyOpen, title | — | — | ✓ | collapsible_section |
| `formula_result` | formula, label, title, value | — | — | ✓ | calculated_result |
| `formula_trace` | steps, title | — | — | ✓ | calculation_trace |
| `formula` | expr, formula, label, title, value | — | — | ✓ | formula |
| `hero_summary` | body, eyebrow, title | — | — | ✓ | hero_summary |
| `input_panel` | fields, layout, liveRecompute, title | ✓ | — | ✓ | input_panel |
| `input_table` | columns, rows, title | ✓ | — | ✓ | input_table |
| `input_number` | id, label, max, min, unit, value | ✓ | — | ✓ | number_input |
| `metric` | caption, label, tone, unit, value | — | — | ✓ | metric |
| `metric_strip` | metrics, title | — | — | ✓ | metric_strip |
| `quiz` | answerIndex, explanation, options, question, title | — | — | ✓ | quiz |
| `quality_panel` | checks, metrics, title | — | — | ✓ | quality_checks |
| `result_card` | caption, formula, label, title, tone, value | — | — | ✓ | result_card |
| `result_table` | columns, rows, title | — | — | ✓ | result_table |
| `scientific_plot` | fit, fitType, height, kind, points, series, title, x, y | ✓ | — | ✓ | scientific_plot |
| `statistics_summary` | data, method, title, values | ✓ | — | ✓ | statistics_summary |
| `segmented_control` | id, label, options, value | ✓ | — | — | segmented_control |
| `table` | columns, rows, title | — | — | ✓ | table |
| `tabs` | id, items, tabs, value | — | — | ✓ | same_miniapp_tabs |
| `timeline` | items, steps, title | — | — | ✓ | timeline |
| `evidence_panel` | items, title, type | — | — | ✓ | evidence_panel |
| `hypothesis_card` | assumptions, hypothesis, prediction, statement, title, type | — | — | ✓ | hypothesis_card |
| `experiment_matrix` | columns, groups, readouts, rows, title, type | — | — | ✓ | experiment_matrix |
| `workflow_timeline` | items, steps, title, type | — | — | ✓ | workflow_timeline |
| `decision_tree` | nodes, title, type | — | — | ✓ | decision_tree |
| `decision_banner` | body, label, status, title, tone, value | — | — | ✓ | decision_banner |
| `risk_panel` | items, title, type | — | — | ✓ | risk_panel |
| `unit_converter` | density, densityUnit, fields, from, options, title, to, value, volume, volumeUnit | ✓ | — | ✓ | unit_converter |
| `warning` | body, title, tone | — | — | ✓ | warning |
| `html` | height, html, source, title | — | — | ✓ | html_document |

**Removed from registry** (bio legacy, code still in file but unreachable):
- `plate_grid` — comment: "blocco bio legacy" (renderer ~line 2790)
- `pathway_graph` — comment: "blocchi bio legacy" (renderer ~line 2930)
- `mechanism_legend` — same comment

**Fallback:** unknown block types render `UnsupportedBlock` with i18n `renderer.unsupportedBlock` (`AskAssistantMiniappRenderer.tsx:3592`).

---

## 3. Actions Table

### Shipped / callable today

| Action ID | Handler location | Behavior |
|---|---|---|
| `export_csv` | `miniappActions.ts:48–64` | Builds CSV from table block rows, writes to cache, `Sharing.shareAsync` |
| `generate_report` | `miniappActions.ts:44–47` | Surfaces feedback hint: "export JSON and ask chat to generate report" |
| `export_png` | `AskAssistantMiniappRenderer.tsx:3510–3530` | `captureRef` + `Sharing.shareAsync` |
| `export_jpeg` | `AskAssistantMiniappRenderer.tsx:3510–3530` | Same as PNG, `format: "jpg"` |
| `export_svg` | `AskAssistantMiniappRenderer.tsx:3533–3548` | Generates text-only SVG, writes + shares |
| `export_json` | `AskAssistantMiniappRenderer.tsx:3533–3548` | Writes `JSON.stringify(localMiniapp)`, shares |
| `export_plate_map` | Blocked in `LEGACY_LAB_ACTION_IDS` (renderer:299) | Never reaches miniappActions.ts; surfaces `miniapp.legacyLabActions` |
| *(any unknown id)* | `miniappActions.ts:76–79` | Surfaces `miniapp.actionNotSupported` |

### Legacy / blocked (dormant code)

| Action ID | Status |
|---|---|
| `add_sample` | `LEGACY_LAB_ACTION_IDS` → blocked |
| `auto_fill_replicates` | blocked |
| `clear_plate` | blocked |
| `add_node` / `add_edge` / `rename_node` / `set_node_kind` / `set_edge_kind` / `move_node` / `delete_selected` | blocked (pathway editor) |

### Miniapp envelope `actions` array

The `miniapp.actions` array is rendered as a bottom button row (`AskAssistantMiniappRenderer.tsx:3646–3660`). Each action button calls `runAction`, which:
1. Checks `LEGACY_LAB_ACTION_IDS` → rejects
2. Checks export IDs → handles locally
3. Checks `GENERATE_REPORT` → local feedback
4. Falls through → `onAction?.(action, miniapp)` → `handleAskAssistantMiniappAction` in `miniappActions.ts`

**No backend actions exist** — the comment at `miniappActions.ts:18` states "niente plate_grid / SVG bio — solo CSV e JSON generici". The registry marks `backendActionSupport: false` for `action_bar` and `action_row` (`AskAssistantMiniappRenderer.tsx:2946,2955`).

---

## 4. Prompt Hooks (System Instructions Steering Miniapp JSON)

### Operative block (compact, appended every turn)

`src/context/operativeBlock.ts:42–44` → `src/i18n/en.ts:1042–1045`:
```
Miniapp: you may emit interactive miniapp_v1 JSON (table, chart, calculator, metric, tabs, expandable, html, quiz);
for quiz never reveal answerIndex in prose — the app grades privately;
calculator formulas: numbers, field identifiers, + - * / and parentheses only.
```

### System prompt (no tools)

`src/i18n/en.ts:1069–1073`:
```
You can also generate interactive mini-apps: JSON blocks with types like table, chart, calculator,
metric, tabs, expandable, html and quiz (multiple-choice questions with 4 options, answerIndex required
as a zero-based integer 0-3, and optional explanation).
For quiz blocks never reveal answerIndex in the prose — the app grades the answer privately.
Calculator formulas: numbers, field identifiers, + - * / and parentheses only.
Emit a miniapp as a JSON object with schema miniapp_v1, kind, title, and blocks (optionally inside a ```json fence).
```

### System prompt (with tools)

`src/i18n/en.ts:1105–1109` — identical miniapp instructions as above.

### What the prompts steer toward

- **Envelope shape:** `{ schema: "miniapp_v1", kind, title, blocks: [...] }`
- **Block types listed:** table, chart, calculator, metric, tabs, expandable, html, quiz
- **NOT listed in prompt:** data_table, editable_table, input_table, input_panel, input_number, scientific_plot, statistics_summary, unit_converter, formula, formula_result, formula_trace, result_card, result_table, hero_summary, action_bar, action_row, metric_strip, segmented_control, timeline, workflow_timeline, decision_tree, decision_banner, risk_panel, evidence_panel, hypothesis_card, experiment_matrix, quality_panel, citations, insight, ai_insight, warning, html (listed)

**Gap:** 24 of 37 registry block types are not mentioned in any system prompt. The model cannot intentionally emit types it doesn't know about.

---

## 5. Bio Skew

### Dead code in renderer (still present, unreachable from registry)

| Area | File:line | Description |
|---|---|---|
| `PathwayNode` kind options | `AskAssistantMiniappRenderer.tsx:161` | `["gene", "protein", "drug", "process", "phenotype", "sample"]` |
| `PathwayEdge` kind options | `AskAssistantMiniappRenderer.tsx:162` | `["activation", "inhibition", "binding", "phosphorylation", "transcription", "unknown"]` |
| Pathway graph functions | `AskAssistantMiniappRenderer.tsx:338–910` | ~570 lines of `addPathwayNode`, `addPathwayEdge`, `updateSelectedPathwayNodeLabel`, etc. — all unreachable |
| `PathwayEditorPanel` | `AskAssistantMiniappRenderer.tsx:1786–2010` | ~220 lines of bio editor UI — unreachable |
| `MechanismLegendBlockView` | `AskAssistantMiniappRenderer.tsx:2012–2038` | Unreachable |
| `PlateGridBlockView` | `AskAssistantMiniappRenderer.tsx:3410–3456` | Unreachable |
| Well-plate constants | `AskAssistantMiniappRenderer.tsx:259–303` | `WELL_CELL_CANDIDATE_KEYS`, `SAMPLE_FIELD_CANDIATES`, `REPLICATE_COLUMN_CANDIDATES` |
| Unit converter density/mass | `AskAssistantMiniappRenderer.tsx:1544–1584` | Hardcoded `density_g_per_ml`, `ethanol`, `g/mL` detection pattern |
| `pathwayViewport` state | `AskAssistantMiniappRenderer.tsx:107–131,170–200` | Viewport calculation + editor state still threaded through entire renderer context |
| `LOCAL_ACTIONS` | `AskAssistantMiniappRenderer.tsx:259–276` | `ADD_SAMPLE`, `AUTO_FILL_REPLICATES`, `CLEAR_PLATE`, pathway actions — all bio |

### i18n strings with bio assumptions

| String | File:line | Content |
|---|---|---|
| `miniapp.noEditablePlate` | `en.ts:559` | "No editable plate or table was available." |
| `miniapp.plateCleared` | `en.ts:562` | "Plate assignments cleared." |
| `miniapp.legacyLabActions` | `en.ts:549` | "Legacy lab actions are not part of the general mini-app format." |
| `renderer.sampleSd` | `en.ts:581` | "Sample SD" (statistic label — not necessarily bio-only) |
| `renderer.pathwayEditor` | `en.ts:604` | "Pathway editor" |
| `renderer.pathwayHint` | `en.ts:615` | "Tap a node or edge to select it…" |
| `unsafeScience` | `en.ts:855` | "I can't help with unsafe biological or chemical instructions." |

### Prompt bio hints

The system prompts list **no bio-specific block types**, but the operative block's miniapp list is generic. The bio skew is confined to dead renderer code and legacy i18n strings, not active prompts.

---

## 6. Tests Covering Parse / Render / Actions

| Test file | What it covers | File:line |
|---|---|---|
| `src/rules/toolGateRegistry.test.ts:40–43` | Miniapp tools exempt from gate: `resolveToolGateTable("miniapp_quiz", true)` → undefined | |
| `src/rules/runToolGate.test.ts` | Tool gate runner (no direct miniapp assertions beyond gate exemption) | |

**No dedicated tests found for:**
- `parseMiniappFromText` (balanced-brace scan, fence extraction)
- `normalizeMiniapp` / `normalizeMiniappBlock` / `normalizeQuizBlock`
- `AskAssistantMiniappRenderer` block rendering
- `handleAskAssistantMiniappAction` (export_csv, generate_report, fallthrough)
- `flattenMiniappBlocks` / `summarizeMiniappForPrompt` / `buildMiniappCsv`
- `evaluateCalculatorFormula` (recursive-descent parser)
- `QuizBlockView` interaction states

The MINIAPP_AUDIT (`docs/MINIAPP_AUDIT.md`) documents manual verification and `npx tsc --noEmit` but no automated test suite.

---

## 7. Gaps for C6 MVP (Productizing Miniapps)

### 7.1 Prompt → Registry Mismatch

**24 of 37 block types are invisible to the model.** The prompt lists 8 types (table, chart, calculator, metric, tabs, expandable, html, quiz). The registry has 37. Types like `data_table`, `editable_table`, `input_panel`, `input_number`, `scientific_plot`, `statistics_summary`, `unit_converter`, `formula`, `result_card`, `hero_summary`, `action_bar`, `citations`, `evidence_panel`, `hypothesis_card`, `experiment_matrix`, `workflow_timeline`, `decision_tree`, `decision_banner`, `risk_panel`, `quality_panel`, `timeline`, `segmented_control`, `metric_strip`, `ai_insight` cannot be intentionally produced.

**Productization requires:** either (a) expand the prompt block type list, or (b) map block types to `EngineTool` schemas so the model calls named tools (PLAN_MINIAPP_V2 path), or (c) both.

### 7.2 No Generic Miniapp Templates / Presets

No template system exists. `QuickActionSheet` (`QuickActionSheet.tsx:11,41`) has a single `"miniapp"` entry that opens a chat prompt. No scaffolded templates (e.g., "comparison table", "budget calculator", "reading quiz", "project timeline") exist to guide the model or the user.

### 7.3 No Action Types Beyond Export + Report Hint

| Missing action type | Current state |
|---|---|
| `submit` / `save` | No handler |
| `navigate` / `open_url` | No handler |
| `copy_to_clipboard` | No handler |
| `share` (text) | No handler |
| `ai_refine` / `ai_expand` | `requiresAi` flag exists on action objects but no handler processes it |
| `trigger_tool` (call another engine tool) | Not implemented |

The `requiresAi` flag on `MiniappAction` (`AskAssistantMiniappRenderer.tsx:32–38`) is declared but never dispatched — `runAction` falls through to `onAction` which reaches `handleAskAssistantMiniappAction` which has no `requiresAi` branch.

### 7.4 UI Discoverability

- No in-chat miniapp preview card / inline renderer (miniapps only render in a full-screen overlay)
- No "create miniapp" button or template picker in the chat UI
- `QuickActionSheet` has a `"miniapp"` entry but it just sends a chat message
- No visual indication that a response contains a miniapp (the `onOpenMiniapp` callback is wired but the trigger is implicit)

### 7.5 i18n Incomplete

- 15+ renderer fallback strings are hardcoded English (not in `en.ts`): "No evidence notes yet.", "No matrix rows yet.", "No timeline steps configured.", "No decision nodes yet.", "No risks identified.", "No content in block", etc. — scattered across block view functions
- Pathway editor labels are English-only by design comment (`AskAssistantMiniappRenderer.tsx:282–283`)
- Bio legacy strings (`noEditablePlate`, `plateCleared`, `legacyLabActions`) remain in i18n even though the features they reference are disabled

### 7.6 No Test Coverage

Zero automated tests for the miniapp pipeline. Parse, normalize, render, actions, calculator evaluation, quiz grading — all untested.

### 7.7 Dead Bio Code (~900 lines)

Pathway editor (~570 lines), pathway editor panel (~220 lines), plate grid (~46 lines), mechanism legend (~26 lines), well-plate constants, unit converter density/mass path — all unreachable but still compiled and shipped. Cleanup would reduce bundle and cognitive load.

### 7.8 Missing `onMiniapp` Emit Path

`LlamaService` declares `onMiniapp?` (`LlamaService.ts:575`) and `AiChatPage` wires it (`AiChatPage.tsx:2459,2467`), but **no code path ever calls it** (confirmed by MINIAPP_AUDIT, AUDIT_MINIAPP_V2 §C12). Local models must embed miniapp JSON in prose text, which `parseMiniappFromText` extracts. This works but is fragile and token-inefficient.

### 7.9 No Schema Validation Layer

`normalizeMiniapp` is soft-tolerant — it accepts any object with `kind + title + blocks` and caps strings. There is no Zod/JSON-Schema validator, no field-type checking, no block-structure validation. Unknown fields pass through silently. This is intentional for resilience but means the model can emit malformed payloads that render as broken UI rather than failing fast.

---

## 8. Suggested Minimal Productize Slice (≤ 1 PR)

**Goal:** Make the existing renderer + actions usable as generic callable miniapps without changing the transport or model.

### Scope

1. **Expand the system prompt block type list** (`en.ts:1042–1045,1069–1073,1105–1109`) to include the 5 most useful generic types beyond the current 8:
   - `data_table` (richer than `table`: explicit column keys)
   - `input_panel` (user-editable numeric fields)
   - `result_card` (single KPI with formula)
   - `action_bar` (call-to-action buttons)
   - `citations` (source list)

   New prompt line (~100 tokens):
   ```
   Block types also include: data_table (columns as [{key,label}]),
   input_panel (numeric fields array), result_card (single value with formula),
   action_bar (action buttons), and citations (source list with titles/urls).
   ```

2. **Add 3 generic miniapp templates to QuickActionSheet** (`QuickActionSheet.tsx`):
   - "Compare data" → pre-fills chat with "Create a comparison table of…"
   - "Quick calculator" → pre-fills "Create a calculator for…"
   - "Reading quiz" → pre-fills "Create a 4-question quiz about…"

3. **Wire `requiresAi` action flag** in `runAction` (`AskAssistantMiniappRenderer.tsx:3500+`):
   - When `action.requiresAi === true`, call `onAction` (which reaches `handleAskAssistantMiniappAction`) — currently the fallthrough shows "not supported"
   - Add a `miniapp.actionRequiresAi` i18n string that says "This action needs AI — ask the chat to run it."

4. **Remove bio-dead code** (~900 lines):
   - Delete `PathwayEditorPanel`, `PathwayGraphBlockView`, `MechanismLegendBlockView`, `PlateGridBlockView`, all pathway functions, `LOCAL_ACTIONS` bio entries, `LEGACY_LAB_ACTION_IDS`, well-plate constants
   - Remove `pathwayViewport` from `RendererContext`
   - Remove `miniapp.noEditablePlate`, `miniapp.plateCleared`, `miniapp.legacyLabActions` from i18n

5. **Add smoke tests** for the critical path:
   - `parseMiniappFromText` with fenced JSON, raw JSON, and text-only
   - `normalizeMiniapp` with valid, missing-fields, and oversized payloads
   - `handleAskAssistantMiniappAction` for `export_csv`, `generate_report`, and unknown action
   - `evaluateCalculatorFormula` for basic arithmetic + edge cases (div-zero, overflow)

### What this does NOT change

- Transport stays prose-embedded JSON (no tool calls, no grammar changes)
- No new block types added to registry
- No i18n pass for hardcoded English fallbacks
- No full-screen vs inline rendering change
- No backend action routing

### Estimated size

~150 lines added (prompt + templates + action wiring + tests), ~900 lines removed (dead bio code). Net negative LOC. Single PR, reviewable in one pass.
