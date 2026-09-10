# C6 Hostile Audit — commit `ab6f4a0` (feat/moe-stream)

**Date:** 2026-09-06 · **Mode:** read-only (no source edits) · **Tree audited:** working tree == commit `ab6f4a0` (verified `git diff ab6f4a0 -- <scoped files>` is empty; HEAD == ab6f4a0).

**Verdict: DO NOT SHIP.** The committed tree does **not compile** (`tsc --noEmit` exit 2), the impl report's central verification claim ("tsc --noEmit → 0 errors") is false, a registered block type (`unit_converter`) renders garbage labels because its i18n keys were deleted while still referenced, and the templates deliverable is dead UI with a **latent ReferenceError** on tap. The smoke tests are real and pass — but they pass on a tree that cannot build, because none of them import the renderer.

---

## 0. MVP checklist verdicts

| # | Binding item | Verdict |
|---|---|---|
| 1 | Prompt +5 types (data_table, input_panel, result_card, action_bar, citations) EN+IT in systemPrompt / systemPromptWithSearch / operative miniapp | ✅ **DONE** — all 3 locations × 2 locales (`en.ts:1039,1065,1102`, `it.ts:1008,1026,1062`). But IT copy has typos and a malformed bracket (F-10), and EN operative grows ~230 chars appended to **every** turn. |
| 2 | 3 QuickAction templates reachable by user | ❌ **NOT REACHABLE** — `QuickActionSheet` is imported by **nothing** (only re-exported by `src/theme/components/index.ts:7`; `AppShell.tsx`/`AiChatPage.tsx` have zero references — F-03). And when a template is tapped, `onChooseTemplate?.(template)` throws **ReferenceError** (F-02). |
| 3 | requiresAi → i18n hint, not "unsupported" | ⚠️ **WIRED, with caveats** — `runAction` short-circuits on `action.requiresAi` (`AskAssistantMiniappRenderer.tsx:2038-2041`). The hint surfaces inside a **full-screen overlay** with no path to the chat (F-08), and the check runs *before* local exports, so `{id:"export_json", requiresAi:true}` would be blocked from a local export (F-08b). |
| 4 | Bio dead code deleted without breaking 37 registered types | ⚠️ **BROKEN** — registry is untouched (39 entries; the map's "37" was wrong, not the code), but the cleanup **broke the registered `unit_converter` type** by deleting the keys it renders (F-04), left ~15 bio constants/types dead in the file (F-05), changed `export_plate_map` behavior under stale comments (F-06), and left a **dangling `]);` syntax error** (F-01). |
| 5 | Smoke tests real, not lies | ⚠️ **REAL but blind** — 16 tests pass on the committed tree (verified by running jest). But they never import the renderer, so they certify a tree that fails `tsc` and ships a broken block view (F-09). |

---

## 1. Findings

### F-01 — CRITICAL / CONFIRMED — Committed tree does not compile: dangling `]);` from the LEGACY_LAB_ACTION_IDS deletion
`src/ui/AskAssistantMiniappRenderer.tsx:199`

```
197:// export_plate_map is rejected here too: the general mini-app format has no plate maps,
198:// so this action never reaches handleAskAssistantMiniappAction (miniappActions.ts).
199:]);
200:const WELL_CELL_CANDIDATE_KEYS = ["well", "well_id", "well-id", "wellid"];
```

The commit deleted `const LEGACY_LAB_ACTION_IDS = new Set([` and its entries but left the closing `]);`. `npx tsc --noEmit` **fails (exit 2)**:

```
src/ui/AskAssistantMiniappRenderer.tsx(199,1): error TS1128: Declaration or statement expected.
src/ui/AskAssistantMiniappRenderer.tsx(199,2): error TS1128: Declaration or statement expected.
```

Metro/Babel will fail to bundle the app; `AppShell.tsx` imports this renderer, so the **whole app is broken at build time**. The impl report's verification section ("`npx tsc --noEmit` → 0 errors (full-project; touched files clean)") is **false for the committed tree**. Moreover (verified with a standalone TS 5.9 repro): a TS1128 parse error in one file **suppresses all semantic diagnostics in the rest of the program** — so F-02 and F-04 below are also currently invisible to tsc.

### F-02 — HIGH / CONFIRMED — `QuickActionSheet` references `onChooseTemplate` it never destructures: latent ReferenceError
`src/theme/components/QuickActionSheet.tsx:19` vs `:23` vs `:131`

```
19:  onChooseTemplate?: (template: MiniappTemplate) => void;
...
23:export function QuickActionSheet({ visible, onClose, onAction }: Props) {
...
131:                                onChooseTemplate?.(template);
```

The prop is declared on `Props` but **not destructured** in the function signature. `onChooseTemplate?.(template)` at line 131 evaluates an undeclared binding → `ReferenceError: onChooseTemplate is not defined` on every template tap. TS2304 is masked today by F-01 (repro confirmed: with a sibling file containing TS1128, tsc reports only the parse errors; without it, `b?.(1)` on an undeclared `b` → TS2304). Once F-01 is fixed, tsc will start failing here too.

### F-03 — MEDIUM / CONFIRMED (parent suspicion) — Templates are dead UI: QuickActionSheet has no caller anywhere
```
$ grep -rn "QuickActionSheet" src/
src/theme/components/index.ts:7:export { QuickActionSheet, type QuickAction } from "./QuickActionSheet";
src/domain/miniappTemplates.ts:1:// ... inside the QuickActionSheet "miniapp" action.
```

`AppShell.tsx:314/4383–4386/5682–5715` (overlay drawer, per the map) and `AiChatPage.tsx` **never import or mount it**. History shows it shipped unmounted since the Fase-0 monolith split. Consequences:
- C6 checklist item 2 ("3 templates reachable by user") is **not met** — templates exist only in code.
- The impl report's own leftover note ("wire the sheet into the chat surface … in a follow-up PR") concedes this; the commit message's "expand QuickActionSheet miniapp action" is productized **dead UI**.
- Because nothing mounts the sheet, `quickActions.compareData*` etc. (9 i18n keys) and `MINIAPP_TEMPLATES` are only reachable through dead code.
- Additionally the new `isMiniapp: true` field (`QuickActionSheet.tsx:60`) is **never read** — the render computes `const isMiniappAction = id === "miniapp"` (`:82`) instead. Dead field.
- UX detail: `miniappOpen` state lives in the component and survives open/close cycles (Modal is always mounted), so the sheet reopens pre-expanded — probably unintended; also tapping the miniapp row no longer fires `onAction("miniapp")` at all (behavior change vs. pre-commit).

### F-04 — HIGH / CONFIRMED — Deleted i18n keys still referenced: registered `unit_converter` block renders raw key strings
`src/ui/AskAssistantMiniappRenderer.tsx:812-814` (UnitConverterBlockView — registered type, per binding "do not break registered types"):

```
812:      <Text ...>{toStringValue(block.title, context.t("renderer.massFromDensity"))}</Text>
813:      <NumberField label={context.t("renderer.volumeMl")} ... />
814:      <NumberField label={context.t("renderer.densityGml")} ... />
```

The commit deleted `renderer.massFromDensity`, `renderer.volumeMl`, `renderer.densityGml` from **both** `en.ts` and `it.ts` (en.ts old keys at the `@@ -589,9 +582,6 @@` hunk, mirrored in it.ts). `translate()` falls back to the raw key → the block title/labels render literally as `renderer.massFromDensity`, `renderer.volumeMl`, `renderer.densityGml`. Since `t()` is typed (`TranslationKey`), this is also a TS2345 type error, currently masked by F-01. The map explicitly listed the unit-converter density/mass path as bio skew to remove *or handle* — the i18n keys were removed but **not the view**.

### F-05 — MEDIUM / CONFIRMED — Bio cleanup incomplete: well-plate/pathway constants and dead helpers still shipped
Contradicting the impl report's "well-plate constants removed" claim, all of these are still in `AskAssistantMiniappRenderer.tsx`, mostly unreferenced:

```
22:const MAX_WELLS = 384;
23:const MAX_PATHWAY_NODES = 40;
24:const MAX_PATHWAY_EDGES = 80;
178:const LETTER_ROWS = "ABCDEFGHIJKLMNOP";
200:const WELL_CELL_CANDIDATE_KEYS = ["well", "well_id", "well-id", "wellid"];
201:const SAMPLE_FIELD_CANDIDATES = ["sample", "sample_name", "sampleid", "sample_id", "sampleid", "sample name", ...];  // note duplicate "sampleid"
202:const REPLICATE_COLUMN_CANDIDATES = [...];
203:const STATUS_HIDE_TIMEOUT_MS = 3000;          // no usage anywhere
205:type PlateMapState = { ... }
210:type PlateWell = { ... }
422:function axisLabelsFromValue(value, axis, ...) // sole caller of LETTER_ROWS; itself uncalled — grep shows no call sites
```

`grep` finds **no callers** for any of these (including `STATUS_HIDE_TIMEOUT_MS` and `axisLabelsFromValue`). The commit message says "Remove ~1640 LOC bio-dead code (pathway/plate/legend views + helpers)" — the LOC was removed, but the cleanup stop-line was drawn arbitrarily mid-constant-block, leaving the well-plate scaffolding compiled and shipped. The orphaned comment block at `:190-198` ("Action legacy bio … non più raggiungibili dal registro", "statuses below ARE localized") describes a code region that no longer exists.

### F-06 — MEDIUM / CONFIRMED — `export_plate_map` behavior silently changed; two comments now lie about interception
`LEGACY_LAB_ACTION_IDS` (the only blocker for `export_plate_map`) was deleted. Who still intercepts it?

- `AskAssistantMiniappRenderer.tsx:185` — `EXPORT_PLATE_MAP: "export_plate_map"` remains in `LOCAL_ACTIONS`, and `isMiniappExportAction` (`:441-448`) still includes it — but that predicate is used *only* to set the transient "Preparing action…" status (`:2096`), not to block.
- `AskAssistantMiniappRenderer.tsx:197-198` — "export_plate_map is rejected here too: … so this action **never reaches** handleAskAssistantMiniappAction" — **now false**: it reaches it.
- `src/app/miniappActions.ts:143-146` — "export_plate_map is intercepted earlier, in the renderer's **LEGACY_LAB_ACTION_IDS** dispatcher … so it can never reach this function" — references a deleted object; **now false**.

Actual new behavior: `export_plate_map` → "Preparing action…" status (persistent — never cleared, no timeout code exists) → `setMobileError(miniapp.actionNotSupported)`. Before the commit the user got `miniapp.legacyLabActions`. Neither message is great for a C6 prompt that now actively teaches the model to emit `action_bar`, but shipping a behavior change under stale comments that point at deleted code is exactly the drift this cleanup was supposed to remove.

### F-07 — MEDIUM / CONFIRMED — requiresAi UX is a dead-end inside the overlay
`AskAssistantMiniappRenderer.tsx:2038-2041`:

```
2038:      if (action.requiresAi) {
2039:        setStatusText(t("miniapp.actionRequiresAi"));
2040:        return;
2041:      }
```

`en.ts:555` — "This action needs the AI to run — **ask the chat to execute it**." The renderer runs in a **full-screen modal** (`AppShell` overlay) with no reference to the chat composer, no draft prefill, no "copy prompt" affordance, and no action label echoed. The user must dismiss the overlay and re-type the request from memory. Binding-compliant ("surface clear i18n feedback… no fake AI dispatch backend") but product-hollow; the follow-up should prefill the draft via `onAction`/`setAskAssistantDraft` (the callback channel that already exists in `miniappActions.ts`).

F-07b (same block): the `requiresAi` check sits **before** the local export handlers — an action object `{ id: "export_json", requiresAi: true }` (models do emit redundant flags) is refused a purely-local export. Check order should be: local exports first, requiresAi second.

### F-08 — MEDIUM / CONFIRMED — Smoke tests give false confidence: 16 green on a non-compiling tree
- Verified: `npx jest src/app/miniappActions.smoke.test.ts` → **16 passed** on the committed tree. The tests themselves are genuine (real imports, real assertions, real mocks for expo modules).
- But none of them import `AskAssistantMiniappRenderer` — so F-01 (parse failure), F-02 (TS2304), and F-04 (raw-key labels) are all invisible to the suite. The impl report's "16 tests, all pass **+ tsc clean**" pairs a true claim with a false one, and the suite endorsed the broken tree.
- Specific weaknesses:
  - `export_csv` test (`miniappActions.smoke.test.ts:99-105`) passes an **empty-envelope** miniapp (`envelope([])`), so `buildMiniappCsv` returns the literal string `miniapp.noExportableRows` ("message\nNo exportable rows in this mini-app.\n") as the CSV payload — and the test only asserts `setFeedback` was called. It does not assert the written content, so the "success" after writing an error string to a `.csv` file is untested (and the feedback/CSV-content contradiction is a pre-existing quirk now blessed by a passing test).
  - The i18n parity test covers only `quickActions.*` + `actionRequiresAi` — it does **not** cover the three prompt strings that were the core of item A, and (fatally) does not check that deleted keys have no live references — precisely the regression F-04 shipped.
  - `evaluateCalculatorFormula` battery is good (precedence, ids, divzero, overflow, charset, length) — but does not cover `a.a`-style dotted garbage (F-11d).

### F-09 — HIGH / CONFIRMED — IT copy is broken Italian: 2 spelling errors, 3 "de fonti", an unbalanced bracket
`src/i18n/it.ts`:

```
836:    compareDataPrompt: "Trforma questi dati in una tabella di confronto.",   // → Trasforma
837:    quickCalculatorPrompt: "Rsolvi questo calcolo e mostra il risultato.",   // → Risolvi
1008: "Inoltre, i tipi di blocco includono data_table (colonne [{key,label]} con righe), ... e citations (una lista de fonti con titoli e url).",
1026: "Altri tipi di blocco: data_table (colonne [{key,label}] con righe), ... (una lista de fonti con titoli e url). " +
1062: "Altri tipi di blocco: ... (una lista de fonti con titoli e url). " +
```

- `it.ts:1008` — `[{key,label]} con righe` — **mismatched bracket** (`{` closed by `]`, stray `}`). The other two copies at 1026/1062 are well-formed — so the operative-block copy (the one appended **every turn**) is the malformed one.
- "lista **de** fonti" ×3 → "lista **di** fonti".
- Untranslated template labels: `compareData: "Compare data"`, `quickCalculator: "Quick calculator"`, `readingQuiz: "Reading quiz"` are English in the **Italian** catalog while their subtitles/prompts are Italian — binding said "EN+IT labels". An Italian user gets "Compare data / Costruisce una tabella di confronto".
- Also note (PLAUSIBLE, low): `en.ts:1039` operative copy emits the literal `{key,label}` — safe from the i18n interpolator (verified: `applyParams` regex `\{(\w+)\}` at `src/i18n/index.ts:59` cannot match `{key,label}` because of the comma, and `operativeBlock` parts are joined without interpolation), but it is placeholder-lookalike syntax in a per-turn prompt; the model may echo it into JSON column defs. Cosmetic.

### F-10 — LOW / CONFIRMED — New files have no trailing newline; dead exports
- `\ No newline at end of file` on `src/domain/miniappCalculator.js`, `src/domain/miniappCalculator.d.ts`, `src/domain/miniappTemplates.ts`, `src/app/miniappActions.smoke.test.ts`. Nit, but this project's other files are clean.
- `miniappTemplates.ts:40-42` — `MINIAPP_TEMPLATE_IDS` is exported and used **nowhere** (grep: only QuickActionSheet imports `MINIAPP_TEMPLATES`). `labelKey/subKey/promptKey` are typed `string` instead of a `quickActions.*` template-literal key — a typo like `compareDataPromt` would pass tsc and silently render a raw key at runtime.
- `src/domain/miniappCalculator.d.ts` ends without newline; `.js` uses CJS `module.exports` while `.ts` siblings use ESM — interoperates under Metro/babel, but the module is stylistically split from the codebase.

### F-11 — LOW / test-driven findings on the new calculator (the *best* code in the commit — nitpicks only)
Battery run (node, all cases below executed against the committed file):
- `a.a` with `{a:2}` → **`{ok:true, value:2.2}`** — dotted-garbage formula accepted (id `\b` substitution turns `a.a` into `2.2`; the post-substitution charset allows `.`). Invalid math accepted silently. (CONFIRMED, low — no injection vector; parser still rejects everything else.)
- `1.` → accepted as `1` (trailing-dot number) — fine, but combined with the above shows the charset gate is laxer than the parser.
- `--2` → `2`, `+5` → `5`, `- 5` → `-5`, `1\n+2` → `3` — all fine (whitespace/newlines tolerated; arguably `1\n+2` should be allowed anyway).
- All hostile inputs correctly rejected: `1/0`, `1/-0`, `0/0`, `9e999`, `1e3`, `abs(2)`, `x^2`, `2;3`, 2×200-digit strings (201 rejected, 200 accepted), 101-token expr, 21-deep nesting (20 accepted), `Infinity`/`NaN`/string vars, `2−3` (unicode minus), underflow → "unsupported". Div-zero, depth, token, length gates all work; `err.code` on a plain `Error` is fine in JS.
- `1e308*10` → unsupported (non-finite) ✓; but `123456789012345678901234567890*2` → `ok:true` with **2.46e29** — precision loss beyond 2^53 not flagged. A calculator displaying rounded garbage is a display concern only.
- Test gap: none of the smoke tests cover negatives (`a-2` with `a:-3` → `-5` ✓ verified), dotted garbage, or depth cap.

---

## 2. What the impl report got wrong (fact-check)

| Report claim | Reality |
|---|---|
| "`npx tsc --noEmit` → 0 errors (full-project; touched files clean)" | **False** — exit 2, TS1128 ×2 at renderer:199 (verified). |
| "well-plate constants [removed]" | **False** — `WELL_CELL_CANDIDATE_KEYS`, `SAMPLE_FIELD_CANDIDATES` (with duplicate `sampleid`), `REPLICATE_COLUMN_CANDIDATES`, `PlateMapState`, `PlateWell`, `LETTER_ROWS`, `MAX_WELLS/MAX_PATHWAY_NODES/MAX_PATHWAY_EDGES` all remain, most uncalled. |
| "no broken references, no callers" (of removed bio code) | **False** — `renderer.massFromDensity/volumeMl/densityGml` deleted but still called at renderer:812-814 (registered `unit_converter` type). |
| "~1640 LOC removed" | Diff says 1726 deletions / 586 insertions — LOC claim ≈ fine; completeness claim is not. |
| "templates are wired and ready" | Wired into a component that is **not mounted anywhere**, with an **undeclared identifier** at the tap site. |
| "16 tests, all passing" | **True** (verified) — but meaningless as a gate given everything above. |

---

## 3. Ship / fix-first order

**Blockers (must fix before this commit can even build):**
1. **F-01** — Delete the dangling `]);` at `AskAssistantMiniappRenderer.tsx:199`. One line. Then re-run `tsc` — expect F-02/F-04 to surface (they're currently masked).
2. **F-04** — Restore `renderer.massFromDensity/volumeMl/densityGml` in `en.ts` + `it.ts` (or delete the UnitConverterBlockView + registry entry — but that *breaks* a registered type, which the binding forbids; restore the keys).
3. **F-02** — Add `onChooseTemplate` to the signature destructure at `QuickActionSheet.tsx:23` (or drop the prop + `MINIAPP_TEMPLATES` import entirely).

**Correctness / productization (before merge):**
4. **F-09** — Fix `it.ts:836-837` ("Trforma"/"Rsolvi"), `:1008` malformed `{key,label]}` → `{key,label}`, "de fonti" → "di fonti" ×3, and translate the 3 template labels in IT.
5. **F-06** — Either restore a `export_plate_map` blocker (with a current comment), or delete `EXPORT_PLATE_MAP` from `LOCAL_ACTIONS`/`isMiniappExportAction` and fix the two stale comments (renderer:197-198, miniappActions.ts:143-149).
6. **F-08** — Strengthen smoke tests: assert `export_csv` content (empty-envelope → error-string CSV currently reported as success), parity-check the 3 prompt strings (not just quickActions), and add a "deleted i18n keys have no `t()` callers" regression test — that test would have caught F-04.

**Productize / decide (item 2 is currently unmet):**
7. **F-03** — Either mount `QuickActionSheet` (wire `onChooseTemplate` → set draft in AiChatPage, `onAction("miniapp")` semantics) or descope templates + the 9 `quickActions.*` keys + `miniappTemplates.ts` from this PR. As shipped, the feature is unreachable UI.
8. **F-07** — requiresAi: move the check after local exports; give the hint a way out (prefill the chat draft with the action label; echo the action id/label in the status).
9. **F-05** — Finish the cleanup: drop `WELL_CELL_*`, `SAMPLE_FIELD_CANDIDATES` (dedupe `sampleid` while there), `REPLICATE_COLUMN_CANDIDATES`, `PlateMapState`, `PlateWell`, `LETTER_ROWS`, `axisLabelsFromValue`, `STATUS_HIDE_TIMEOUT_MS`, `MAX_WELLS/MAX_PATHWAY_NODES/MAX_PATHWAY_EDGES`, `isMiniapp`, and the orphaned comment block at :190-198.

**Nits (any time):**
10. **F-11** — `a.a` → `2.2` acceptance; >2^53 precision; add negative-value/dotted-garbage/depth tests. Trailing newlines in the 4 new files. `MINIAPP_TEMPLATE_IDS` dead export; type `labelKey` as `keyof`-derived literal. Consider `maxTokens`-style guard alignment — currently `CALC_MAX_TOKENS=100` cap vs 101-token test ✓ consistent.

**Ship when:** `npx tsc --noEmit` exit 0 on the committed tree, jest still green, and either QuickActionSheet is mounted or templates are removed from the PR scope.