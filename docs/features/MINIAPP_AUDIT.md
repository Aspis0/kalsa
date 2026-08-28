# Miniapp block audit — Kalsa (Fase 5)

Date: 2026-08-02  
Scope: client-side miniapp schema (`miniapp_v1`), registry renderer, system prompt list, content filter interaction.

## Architecture notes

| Layer | Location | Role |
| --- | --- | --- |
| Prompt list | `src/i18n/en.ts` / `it.ts` (`systemPrompt*`) | Tells the model which block types exist |
| Parse / normalize | `src/domain/askAssistant.js` (`parseMiniappFromText`, `normalizeMiniapp`) | Extracts JSON from model text; soft defaults |
| History sanitize | `src/screens/AiChatPage.tsx` (`sanitizeHistoryMessages`) | Caps size when reloading chat |
| Render registry | `src/ui/AskAssistantMiniappRenderer.tsx` (`ASK_ASSISTANT_MINIAPP_BLOCK_REGISTRY`) | Whitelist of renderable types |
| Math helpers | `src/domain/miniappMathCore.js` | Stats, regression, density→mass (client-side) |

There is **no strict fail-closed validator** on every field (Aspis worker had one). Kalsa uses **tolerant normalize + registry fallback** (`Unsupported miniapp block: {type}`).

`LlamaService` exposes `onMiniapp` but never emits it (cloud SSE path only). Local models must put a miniapp JSON object in the answer text; `AiChatPage` extracts it via `parseMiniappFromText` when the turn ends.

---

## Prompt-listed types (primary audit targets)

### `table` (+ aliases)

| | |
| --- | --- |
| **Status** | **OK** |
| **Registry** | `table`, `data_table`, `result_table`, `input_table`, `editable_table` |
| **Schema (model)** | `{ type: "table", title?, columns?: [{key,label}], rows: object[] \| string[][] }` |
| **Notes** | `normalizeTable` derives columns from first object row if missing; empty rows → “No rows yet.” Caps: 50 rows × 12 cols. No crash on missing headers. |
| **Editable** | `editable_table` / `input_table` are marked editable; cell editing UI is not a full spreadsheet (display-oriented). |

### `chart` (+ `scientific_plot`)

| | |
| --- | --- |
| **Status** | **OK** (minor) |
| **Registry** | `chart`, `scientific_plot` |
| **Schema** | `{ type: "chart"\|"scientific_plot", title?, points?: [x,y][] \| {x,y}[], series?: [{points}], fitType?: "linear"\|"quadratic" }` |
| **Notes** | Client-side linear/quadratic fit via `fitRegression`. Empty points → equation “not enough points”, no crash. Bar-style visual only (not a full charting lib). |
| **Recommendation** | Prompt could mention `points` / `series` shape; optional later. |

### `calculator` ⚠️ → fixed

| | |
| --- | --- |
| **Status** | **FIXED** (was broken; evaluator hardened) |
| **Before** | Listed in system prompt and chat quick-action copy, **absent from registry** → always `Unsupported miniapp block: calculator`. Later used `Function(...)` for arithmetic (blocked by review). |
| **After** | Registry entry + `CalculatorBlockView`: local numeric fields, optional formula, formula + result display. |
| **Schema** | `{ type: "calculator", title?, fields?: [{id,label,value,unit?}], formula?, value? }` |
| **Compute** | Client-side **safe recursive-descent parser** (no `eval` / `Function` / `new Function`). Pipeline: (1) length ≤ 200 chars, (2) substitute field identifiers to numbers, (3) tokenize numbers / `+ - * /` / parentheses, (4) parse with depth ≤ 20 and tokens ≤ 100. Over limit / leftover identifiers / div-by-zero → i18n `renderer.formulaUnsupported`. |
| **Prompt** | "Calculator formulas: numbers, field identifiers, + - * / and parentheses only." |

### `metric` (+ `metric_strip`)

| | |
| --- | --- |
| **Status** | **OK** |
| **Schema** | Single: `{ type: "metric", id?, label?, value?, unit?, caption? }` · Strip: `{ type: "metric_strip", metrics: [{id,label,value}] }` |
| **Notes** | `getMetricRows` falls back to treating the block itself as one metric. Values can resolve from miniapp `computed` by id. Empty → empty grid (no crash). |

### `tabs` ⚠️ → fixed

| | |
| --- | --- |
| **Status** | **FIXED** (was non-interactive) |
| **Before** | Registry claimed `interactive` + `stateful`, but UI stacked **all** tabs vertically with no selection. |
| **After** | Segment control + only the active tab’s children rendered. Local state. |
| **Schema** | `{ type: "tabs", title?, tabs\|items: [{ id?, title\|label, blocks: [...] }] }` |

### `expandable` ⚠️ → fixed

| | |
| --- | --- |
| **Status** | **FIXED** (was always open) |
| **Before** | Always expanded; no collapse control despite `stateful`. Hardcoded “Details” / “No details yet.” |
| **After** | Press title to toggle; respects `initiallyOpen` (default true). i18n labels. |
| **Schema** | `{ type: "expandable", title?, initiallyOpen?: boolean, blocks: [...] }` |

### `html`

| | |
| --- | --- |
| **Status** | **OK** (sandbox intact; navigation lock applied) |
| **Schema** | `{ type: "html", title?, html\|source: string, height?: number }` |
| **Security** | WebView: `javaScriptEnabled={false}`, `domStorageEnabled={false}`, no file access, CSP `default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'`, `originWhitelist` `about:` + `data:`. |
| **Fix** | `onShouldStartLoadWithRequest` allows `about:` / `data:` **only during the initial bootstrap** of `source.html`; after first data: load / `onLoadEnd`, **all** further navigations return `false` (including later `data:`, `javascript:`, `http(s)`, `file`). |
| **Empty** | Empty html → i18n `renderer.emptyHtmlBlock`. |

---

## Other registry types (secondary)

| Type | Status | Notes |
| --- | --- | --- |
| `input_panel` / `input_number` | OK | Local inputs via renderer `inputs` state |
| `formula` / `formula_result` / `result_card` | OK | Static display of model-supplied value |
| `formula_trace` | OK | Lists `steps[].expr` |
| `unit_converter` | OK | Client density×volume→mass when density/volume present; else falls back to input_panel |
| `statistics_summary` | OK | Client mean/SD/Grubbs; editable CSV of values |
| `action_bar` / `action_row` | OK | Runs miniapp actions |
| `warning` / `decision_banner` | OK | Text fallbacks |
| `timeline` / `workflow_timeline` | OK | Flat list |
| `citations` / `evidence_panel` / `risk_panel` / `hypothesis_card` / `experiment_matrix` / `decision_tree` / `hero_summary` / `insight` / `ai_insight` / `quality_panel` / `segmented_control` | OK (soft) | Tolerate missing arrays; some English hardcoded labels remain (not crash bugs) |
| `plate_grid` / `pathway_graph` | Removed from registry | Bio legacy; unsupported fallback if emitted |
| **`quiz`** | **NEW** | See below |

---

## New block: `quiz`

```json
{
  "type": "quiz",
  "question": "…",
  "options": ["A", "B", "C", "D"],
  "answerIndex": 0,
  "explanation": "optional"
}
```

- **Normalize:** pad/truncate options to 4 strings; `answerIndex` is an **explicit integer 0–3 or `null`**. Missing / non-integer / out-of-range → `null` (grading disabled — **never defaults to 0**).
- **UI:** select one option (a11y `radio`) → Check → ✅/❌ text + correct answer + explanation → Retry resets. When `answerIndex` is `null`, Check shows i18n `quiz.notGradable` without marking correct/wrong.
- **Privacy contract:**
  - **Chat bubble prose:** model must never write `answerIndex` in free text (prompt rule).
  - **Persisted history / export JSON:** `answerIndex` **is present** in the miniapp object (needed to grade offline after reload). It is visible in export/history payloads, not in the assistant text bubble.
  - **On-screen:** the correct option is only revealed after the user presses Check (when gradable).

Envelope for a full miniapp:

```json
{
  "schema": "miniapp_v1",
  "kind": "quiz",
  "title": "…",
  "blocks": [{ "type": "quiz", "question": "…", "options": ["…","…","…","…"], "answerIndex": 1, "explanation": "…" }]
}
```

---

## Content filter

`src/domain/contentFilter.js` filters user **prompts**, not miniapp JSON structure. Quiz field names (`question`, `options`, `answerIndex`) do not match block patterns. No change required.

---

## Cross-cutting issues

| Issue | Severity | Action |
| --- | --- | --- |
| Prompt listed `calculator` without registry entry | High | Fixed |
| Tabs / expandable not interactive | Medium | Fixed |
| No local miniapp extraction from model text | High | Fixed (`parseMiniappFromText` + AiChatPage) |
| `onMiniapp` never called by `LlamaService` | Medium | Documented; text extraction avoids engine changes (Fase 5 constraint) |
| Hardcoded English in secondary blocks | Low | Left for later i18n pass |
| Bio dead code still in renderer file | Low | Leftover cleanup |
| Prompt does not document full envelope / field shapes | Medium | Partially improved for quiz; fuller schema doc optional |

---

## Fixes applied in this pass

1. `calculator` registry + interactive calculator view  
2. Interactive `tabs` and collapsible `expandable`  
3. Html navigation handler: drop `file:`  
4. Domain parse/normalize including `quiz`  
5. Quiz block UI + i18n + prompt list  
6. Extract miniapp from assistant text at end of turn  

## Review-hardening pass (post Fase 5)

1. **Quiz grading:** `answerIndex` null when invalid (no false grade on option 0); `quiz.notGradable` UI  
2. **History reload:** `sanitizeHistoryMessages` runs `normalizeMiniapp`; migrates miniapp-in-text via `parseMiniappFromText`; renderer recursively sanitizes blocks  
3. **Calculator:** recursive-descent parser with length/depth/token limits (no `Function`)  
4. **Parser:** balanced brace scanner (string-aware) for first-valid miniapp JSON  
5. **`onMiniapp`:** stores normalized miniapp only; does not set `streaming: false`  
6. **Html:** post-bootstrap navigation lock  
7. **Prompt:** `answerIndex` required 0–3 + calculator formula rule  
8. **Caps:** unknown-block string/size limits → `{ type: "unknown" }`  
9. **A11y:** quiz radios + explicit Correct/Wrong text; tabs role/label  

Verification: `npx tsc --noEmit` (see coder report).
