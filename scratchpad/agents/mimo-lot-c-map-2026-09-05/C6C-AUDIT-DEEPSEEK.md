# C6c — Hostile Audit (DeepSeek) · commit `2fdaef4` on `feat/moe-stream`

**Date:** 2026-09-06 · **Mode:** READ-ONLY (no source edited) · **Auditor artifact:** this file.
**Binding:** `C6C-TEMPLATE-SESSION-BINDING.md` · **Self-report under audit:** `C6C-IMPL-REPORT.md`.

## Verification log (reproduced, not trusted)

| Check | Command | Result |
|---|---|---|
| Describe commit | `git show 2fdaef4 --stat` | 8 files, +430/−70; exactly the 8 scoped files. No sneaky extras. |
| Typecheck | `npx tsc --noEmit` | exit 0 ✓ (impl-report claim confirmed) |
| Test (targeted) | `npx jest src/agent/createMiniappTool.test.ts src/app/miniappActions.smoke.test.ts` | 2 suites, 54/54 ✓ |
| Test (full) | `npx jest` | 49 suites, 484/484 ✓ |
| Renderer contract | read `AskAssistantMiniappRenderer.tsx` | `MAX_TABLE_ROWS=50`, `MAX_TABLE_COLUMNS=12`, TimelineBlockView, normalizeTable, registry inspected |
| Normalizer contract | read `askAssistant.js` | `MAX_MINIAPP_BLOCKS=24`, `MAX_QUIZ_OPTIONS=4`, 64 KiB block cap, `normalizeMiniapp` re-run in executor |

---

## Part 1 — MVP checklist verdicts

### 1. Six templates in sheet + tool enum + prompts EN/IT — **CONFIRMED**
- `src/domain/miniappTemplates.ts:6-14` union has exactly 6 ids; `MINIAPP_TEMPLATES:25-64` and `MINIAPP_TEMPLATE_IDS:66-70` list the same 6 in the same order.
- `src/agent/createMiniappTool.ts:49-53` enum spills `[...MINIAPP_TEMPLATE_IDS]` (single source of truth, good).
- `QuickActionSheet.tsx:131-146` maps `MINIAPP_TEMPLATES`, so all 6 rows appear automatically.
- EN/IT keys for the 3 new entries exist in both locales; parity is *type-enforced* (`src/i18n/types.ts:4` `LocaleStrings = typeof en`, it.ts `satisfies`), so tsc passing is proof of parity, not just vibes.
- **Caveat (severity MEDIUM-ish, see F-2):** the sheet renders all 6 but three of them with the *default* icon.

### 2. reading_quiz = questions[1..8] → N quiz blocks; reject 0/>8; per-q 2..4 options — **CONFIRMED**
`miniappBuildersNew.ts:45-48` rejects `length <1 || >8`; loop 52-74 emits one `{type:"quiz"}` block per item; per-item `asStringArray` options capped **2..4** (line 64-68); optional in-range `answerIndex` via `safeAnswerIndex`; optional `explanation`. Tests cover 1/3/8 OK, 0 and 9 rejected, 1-option and 5-option rejected, missing question text, non-array questions. Note: `MAX_QUIZ_OPTIONS=4` in `askAssistant.js:244` matches the builder cap — no drift.

### 3. kpi_strip / checklist / pros_cons builders match renderer field shapes — **CONFIRMED, with 3 caveats**
- `metric_strip`: `getMetricRows→block.metrics[]` (renderer:513-517) reads `{label,value}` — builder emits exactly that (+optional `unit`/`tone`). ✓
- `timeline`: `TimelineBlockView` (renderer:1258-1277) reads `block.items ⧺ block.steps ⧺ block.events`, per-entry `title`/`label`/`time` — builder emits `steps:[{title}]`. ✓
- `data_table`: `normalizeTable` (renderer:522-546) maps object rows by `column.key` — fixed `["pro","con"]` + `{pro?,con?}` rows work. ✓
- Caveat A (F-3): `body` accepted but never rendered — silent data loss.
- Caveat B (F-4): rendered headers are the literal strings `pro` / `con` in **both** locales.
- Caveat C (F-6): `unit`/`tone` are *not* "declared schema fields" on `metric_strip` (`schemaFields: ["metrics","title"]`, renderer:1551-1558) — the impl report's justification for F-6 is wrong, though harmless because `schemaFields` is metadata only (no enforcement code exists for it).

### 4. Quiz copy no longer claims "4-question" — **CONFIRMED**
- `en.ts:870` `"A quiz with several questions"`; `en.ts:879` prompt; `it.ts:844` `"Un quiz con diverse domande"` + prompt 853. Repo-wide grep for `4-question|4 domande|4 question|4 questions|quattro domande` → zero hits in `src/`.
- Historical "Trforma" typo (from C6 commits `ab6f4a0`,`8e788ec`) is **gone** from the current tree (it.ts:851/855 spell "Trasforma" correctly). Parent note answered: history only.

### 5. Tests are real — **CONFIRMED with hygiene nits (F-11)**
Inputs are constructed, outputs asserted structurally (`blocks[i].options`, `answerIndex`, `kind`, `blocks.length`, executor side effects incl. `onMiniapp` not-called-on-error). Statements like "grading disabled → null" are genuinely verified against post-normalize output. All 484 tests green. Not tautological except two spots (F-11).

---

## Part 2 — Parent notes verdicts

### P-1. Checklist `body` may pass through but TimelineBlockView ignores it — **CONFIRMED, with quote**
`AskAssistantMiniappRenderer.tsx:1271-1272`:
```jsx
{toStringValue(record.title, toStringValue(record.label, `Step ${index + 1}`))}
{record.time ? ` • ${toStringValue(record.time)}` : ""}
```
Only `title`/`label`/`time` are rendered; `body` is never read anywhere in `TimelineBlockView`. `body` survives into the block (`miniappBuildersNew.ts:146-148`) and post-normalize (`normalizeMiniappBlock` passes non-`title/question/explanation/options` keys through, `askAssistant.js:319-326`), so it's a **guaranteed silent drop** whenever the model supplies it. The binding's contract (`items: Array<string | {title, body?}>`) invites the model to send `body`; the renderer (out of C6c scope to change) discards it. Severity: MEDIUM (contract/data-loss, not crash) — worth a deliberate decision, see fix-first #4.

### P-2. "QuickActionSheet icons" in the commit message — commit touches AiChatPage; are sheet icons complete? — **COMMIT MESSAGE IS FALSE / WORK INCOMPLETE**
- The commit does **not** touch `src/theme/components/QuickActionSheet.tsx` at all. The message claims "QuickActionSheet icon map gains the new kinds" — it doesn't.
- `QuickActionSheet.tsx:32-39` `templateIcon(id)` has cases only for `quick_calculator`→Calculator and `reading_quiz`→HelpCircle; **`kpi_strip`, `checklist`, `pros_cons` (and `compare_data`) all fall to `default: Columns2`.** The sheet shows 6 rows, 3 of them with a generic/decorative icon — visually indistinguishable from `compare_data`'s row.
- Meanwhile `AiChatPage.tsx:405-419` `miniappIcon` *did* gain `kpi_strip`/`pros_cons`→BarChart2 (410-411) and `checklist`→ClipboardList (414), but the map is **split-vocabulary**: old cases (`calculator`,`comparison`,`planner`,`quiz`, 408-416) use the legacy model-chosen `kind` vocabulary, while the tool's built miniapps carry `kind = template id` (envelope in `miniappBuilders.ts:186-191`). Result: tool-built `compare_data`, `quick_calculator`, `reading_quiz` cards all fall through to `Sparkles` (418) even after C6c. Six templates, three icons, two maps. **CONFIRMED, MEDIUM** (pure cosmetics, but the commit message is a factual misstatement and the binding's "add icons for new ids" bullet was only half-done).

### P-3. miniappBuildersNew naming / export surface — double-path bugs? — **no functional bug; real redundancy**
- `buildMiniappV1` (`miniappBuilders.ts:179-185`) narrows the 4 ids then calls `buildC6c` (`miniappBuildersNew.ts:190-210`) which re-switches on the same 4 — the inner `default: return null` is unreachable via the public path. Harmless, but the dispatcher boundary is ceremonial.
- `normalizeMiniapp` runs **twice per success**: `miniappBuilders.ts:192` ("second guard") and again in the executor `createMiniappTool.ts:93`. Idempotent (verified: 484 tests green, `blocks[0].answerIndex` null survives), but the "second guard" claim in the impl report is overstated — `normalizeMiniapp` does **not** structurally validate `timeline`/`data_table`/`metric_strip` blocks (only envelope shape + 64 KiB cap + string caps; `askAssistant.js:304-330`). A malformed block from a builder bug would sail through both normalizations into the renderer. PLAUSIBLE future-bug vector, no current trigger.
- Export surface: `buildNQuestionQuiz/buildKpiStrip/buildChecklist/buildProsCons` are exported but only `buildC6c` is imported anywhere (grep: single import, `miniappBuilders.ts:18`). Four public functions, zero direct tests, two normalizers, one split dispatcher → **refactor debt, not bugs**.

### P-4. Italian copy typos — **mixed verdict (see F-9)**

---

## Part 3 — Findings, by severity

### F-1. Tool `slots` description advertises slots that do not exist and hides ones that do — **CONFIRMED · MEDIUM** · `createMiniappTool.ts:38-44`
```
"Template-specific key-value slots (title, columns, rows, " +
"formula, fields, questions, metrics, steps, items, pro, con)."
```
- `pro` / `con` as **top-level** slots are fiction: `buildProsCons` reads only `slots.rows` (`miniappBuildersNew.ts:161`) and ignores `pro`/`con` entirely. A literal-minded model sending `{pro: "...", con: "..."}` gets `invalid_slots` — the feature the description just taught it to use fails on first try.
- The C6c rewrite **dropped** the per-question field names that the old description had (`question, options, answerIndex, explanation`) and replaced them with nothing — the model is now told *nothing* about the `questions[]` item shape. It must infer `question/options/answerIndex` from prose (which describes "4 options, answerIndex required 0-3", see F-10) — wrong shape → `invalid_slots`; probed 2..4 is luck, not contract.
- Fix is one string: enumerate per-template slot shapes including `questions:[{question, options(2..4), answerIndex?, explanation?}]`, `metrics:[{label,value,unit?,tone?}]`, `steps/items`, `rows:[{pro?,con?}]`.

### F-2. Sheet icons incomplete (commit message false; AiChatPage map half-vocabulary) — **CONFIRMED · MEDIUM** · see P-2 for detail
Files/lines: `QuickActionSheet.tsx:32-39`, `AiChatPage.tsx:405-419`. The 6-template catalog has 3 dedicated sheet icons and 3 dedicated card icons, and they are on different maps with different key vocabularies. Fix-first #2/#3.

### F-3. checklist `body` silently dropped by renderer — **CONFIRMED · MEDIUM** · P-1 quote, `AskAssistantMiniappRenderer.tsx:1271-1272`, `miniappBuildersNew.ts:140-148`
The impl report discloses it ("passed through harmlessly (not rendered)") — honest but not a fix. The binding contract invites `body`; the deliverable loses it with no visual trace. Decide: render `body` as a second line (renderer change, out of C6c scope → then C6c must not advertise `body` and should drop it from the contract), or keep `body` as title-fallback only and document it.

### F-4. pros_cons headers render as literal English `pro`/`con` in both locales — **CONFIRMED · MEDIUM-LOW** · `AskAssistantMiniappRenderer.tsx:522-546` (`normalizeTable`), `827-859` (`TableBlockView` header `column.label`, :843)
`normalizeTable` maps string columns to `{key:"pro", label:"pro"}`; no localization exists for these keys. The QuickActionSheet row is translated ("Pro e contro", it.ts:849) but the rendered table shows `pro | con` in the Italian UI. The binding explicitly allowed simple string columns for small models — an accepted tradeoff, but it should be a conscious one: the renderer already supports `{key,label}` column objects, and `buildProsCons` currently **discards** any model-provided localized columns (it forces `["pro","con"]` at :171-179 and never reads `slots.columns`). The cheap win (`key:"pro",label: t(...)` via a renderer-side key map) is left on the table.

### F-5. Unbounded slot strings + 64 KiB block cap → whole block silently degrades to `{type:"unknown"}` — **PLAUSIBLE · MEDIUM-LOW** · `miniappBuildersNew.ts` (no length caps on `asString` results), `askAssistant.js:306-312`
`asString`/`asStringArray` return arbitrary-length strings; the builders cap *counts* (8/8/12/50) but not *bytes*. `normalizeMiniappBlock` turns any block whose JSON exceeds 64 KiB into `{type:"unknown"}` — the user then sees an "unsupported block" render, the tool reported success, and there is no error path. A single 60 KiB checklist step (or 8 quiz questions with very long options/explanation) hits this. Low probability on small models' output budgets, but the failure mode is ugly and asymmetric with the rest of the validation (which *errors* loudly). Fix: cap string lengths in the builders (`MAX_*` per field) or reject on serialized size.

### F-6. Impl-report justification "unit/tone are declared schema fields" — **REFUTED · LOW (report accuracy)**
`metric_strip` registry entry: `schemaFields: ["metrics", "title"]` (renderer:1551-1558). `unit`/`tone` are per-metric subfields and appear in no schema list. No functional impact — `schemaFields` is unreferenced metadata outside the registry (grep: only declared, never consumed for validation) — but the audit trail now contains a wrong reason for a right decision, and `tone:` is ignored by `MetricListBlockView`/`Metric` (renderer:1079-1105 render label/value only; tone mapping exists elsewhere, e.g. :1017, for other blocks). `tone` is accepted, validated only as a non-empty string, and then dropped on the floor for `metric_strip`.

### F-7. Redundant double normalization + re-switch (see P-3) — **CONFIRMED · LOW** · `miniappBuilders.ts:192` + `createMiniappTool.ts:93`; `miniappBuilders.ts:179-185` + `miniappBuildersNew.ts:190-210`
No bug today; costs clarity and future drift surface. Every successful tool call pays two full `normalizeMiniapp` passes with identical work.

### F-8. Validation asymmetries inside C6c — **CONFIRMED · LOW** · `miniappBuildersNew.ts`
- **checklist rejects the whole miniapp on one empty/whitespace step** (`asString(entry)` null → `isPlainObject` false → `return null`, :134-136) while **pros_cons skips** empty rows (:172-174). Same class of input, opposite policy, no documented rationale. `["a", ""]` → total failure; `[{pro:"a", con:""}]` → success.
- **pros_cons silently truncates >50 rows** (`rows.slice(0, MAX_ROWS)`, :180) while quiz/kpi/checklist *reject* over-limit. A 51-pair input drops pair #51 with no signal (renderer would have capped at 50 anyway, so impact is zero in practice — but the inconsistency with the sibling builders is real).
- kpi_strip accepts `value: ""` / `"   "` (typeof string, :95-98) → renders `--` (renderer:511); `value: true` correctly rejected. `""` is arguably "a value," but whitespace-only isn't.
- checklist `steps` silently wins over `items` when both are arrays (:122-127) — contract says OR; no preference documented.

### F-9. Italian copy: pre-existing errors now *edited by this commit* — **CONFIRMED · LOW** · `it.ts:1023`, `it.ts:1042`, `it.ts:1078`
- `it.ts:1023` (operative.miniapp, line C6c rewrote): `"usa solo sei templates"` — English plural noun embedded in an Italian sentence (pre-existing pattern "questi tre templates" had the same flaw; the rewrite preserved it instead of fixing it; `modelli` is right there in the same file at :773's error text).
- `it.ts:1042 / 1078` (systemPrompt / systemPromptWithSearch, both lines C6c touched): `"Preferito lo strumento: scrivi JSON..."` — grammatically wrong (should be **Preferisci**). C6c edited these exact sentences to add the template list and left the error standing. It's pre-existing, but "read all the copy you touch, for free" — the audit's hostile finding is that the commit touched three Italian strings and fixed zero of their two typographic/grammatical defects. (Current tree: "Trforma" is already fixed; EN copy at :1054/:1082/:1119 is clean.)

### F-10. Prose guidance contradicts the reading_quiz contract — **CONFIRMED · LOW** · `en.ts:1082,1119` (and `it.ts:1042,1078`)
The three prompt blocks tell the model a hand-written `quiz` = "multiple-choice questions with **4 options**, answerIndex **required** as a zero-based integer 0-3." The C6c template contract is **2..4 options, answerIndex optional**. Harmless today (4 options / present index always satisfy both), but the model is steered toward exactly-4 forever, the template's optional answerIndex and 2-option questions will rarely be exercised in production, and F-1 removed the only description of the template's own shape. A one-line clarification ("reading_quiz questions take 2..4 options; answerIndex optional") costs nothing.

### F-11. Test hygiene nits — **CONFIRMED · LOW** · `createMiniappTool.test.ts`
- :389-390 — prompt invariant's assertion is `expect(hay.toLowerCase()).toContain("fallback")` — a tautology (any prompt containing the word "fallback" passes; the comment claims "prose JSON is framed as a fallback, not the primary instruction," which this assertion does not verify). Either assert instruction order/weight or drop the comment.
- :14-16 — `expectMiniapp` only checks `result.error === undefined`; the name promises a smoke, fine, but it doesn't pin `kind:"create_miniapp"` or a non-empty text.
- Missing tests that would have caught real findings: (a) pros_cons with `slots:{pro,con}` → expected invalid_slots (pins F-1); (b) checklist `items` with `body` → documents the drop (pins F-3/P-1); (c) steps+items both present → precedence; (d) kpi_strip `value:true` / `value:""` → rejection/render; (e) string-form `answerIndex` (`"1"`) per question; (f) checklist with one `""` step → the whole-build rejection (F-8) is currently *un*pinned behavior.
- Conversely, credit where due: the out-of-range test (:161-172) correctly asserts the post-normalize `null` grading semantics, and the executor side-effect tests (onMiniapp called/not-called) are real.

### F-12. Nits — **CONFIRMED · TRIVIAL**
- `miniappTemplates.ts` ends with no trailing newline (git diff shows `\ No newline at end of file`).
- checklist emits `title: asString(slots.title)` possibly `null` into the block (:151) while kpi_strip guards (`if (title) block.title = title`, :109-110) — normalize later coerces null→"" (askAssistant.js:319), so behavior is identical; the asymmetry is noise.
- The executor's `?.replace(...)` on `createMiniappInvalidTemplate` (`createMiniappTool.ts:75`) is defensive dead weight — both locales define the key and the type is not optional.

## Angles sweep

- **Security:** no injection surface — builders only emit structured JSON; renderer is text-only (`toStringValue`), SVG export escapes XML (renderer:440-465); no URLs/html/attachments. Slots are bounded in count and (post-normalize) string length; the 64 KiB block cap (F-5) is the only degradation path. Nothing exploitable found.
- **Privacy:** quiz `answerIndex` never appears in prose; tool result text is `"Miniapp created: {title}"`; no user content echoed into prompts from the tool path. Clean.
- **Races/leaks:** executor is synchronous; no timers, no state mutation outside `onMiniapp`; `signal` unused but correctly so (no I/O). None found.
- **Edge cases:** F-3, F-5, F-8, F-10 above.
- **Dead code:** `MINIAPP_TEMPLATES` exported+used; four builder exports used-only-via-`buildC6c` (P-3); `schemaFields` metadata (F-6); `buildC6c`'s unreachable `default`. Minor.
- **Test hygiene:** F-11.

## REFUTED claims (checked, found no issue)
- Any remaining "4-question" copy — **REFUTED**, repo grep clean.
- "Trforma" typo in current tree — **REFUTED**, fixed; history-only.
- N-quiz truncated by `MAX_MINIAPP_BLOCKS` — **REFUTED** (24 ≥ 8).
- Metric count/rows/steps drift vs renderer caps — **REFUTED** (8≤12, 12≤50, 50≤50).
- Builder `safeAnswerIndex` vs normalize `parseAnswerIndex` inconsistency — **REFUTED** (same regex/range semantics; `"01"` handled identically by both).
- Double-path causes a functional bug — **REFUTED** (redundant but idempotent; verified by 484 green tests incl. normalized-block assertions).

---

## Ship / fix-first list

**Must address before push (in this order):**
1. **F-1 (MEDIUM, guidance bug):** rewrite the tool's `slots` description (`createMiniappTool.ts:38-44`) to document real slots — `questions:[{question, options(2-4), answerIndex?, explanation?}]`, `metrics:[{label,value,unit?,tone?}]`, `steps: string[] | items: (string|{title,body?})[]`, `rows:[{pro?,con?}]`. Remove the fictional `pro, con` top-level slots.
2. **F-2 (MEDIUM, message-vs-reality + UX):** add `kpi_strip`/`checklist`/`pros_cons` cases to `QuickActionSheet.templateIcon` (`QuickActionSheet.tsx:32-39`), and add `compare_data`/`quick_calculator`/`reading_quiz` cases to `AiChatPage.miniappIcon` (`AiChatPage.tsx:405-419`) so all 6 tool kinds resolve; reconcile the two key vocabularies. Correct the commit message before push.
3. **F-3 (MEDIUM, silent data loss):** pick one: render `body` in `TimelineBlockView` (renderer change → new ticket, C6c must then say so), or drop `body` from the accepted contract + impl report; never ship "accepts body, discards body" silently.

**Strongly recommended before push:**
4. **F-5 (MEDIUM-LOW):** cap builder string lengths per field (or reject oversized serialized blocks) so a long checklist/quiz can't silently become an "unsupported block" after a successful tool call.
5. **F-4 (MEDIUM-LOW, i18n):** localize `pro`/`con` headers in the renderer (key→label map) or at least document the English-headers-in-IT tradeoff; the sheet copy is already translated, the table isn't.
6. **F-9 (LOW, copy):** fix `it.ts:1042/1078` "Preferito lo strumento" → "Preferisci lo strumento" and `it.ts:1023` "usa solo sei templates" → "usa solo questi sei modelli" (lines this commit already touched).

**Follow-up debt (separate ticket, not push-blocking):**
7. F-7 remove the redundant executor-side `normalizeMiniapp` (or fold the "second guard" comment into reality — normalize is not a structural validator).
8. F-8 unify rejection-vs-skip and reject-vs-truncate policies across the 4 builders; guard kpi `value` against whitespace-only strings.
9. F-11 add the 6 missing tests (F-1 pins, body-drop pin, precedence, boolean/empty kpi values, string answerIndex, empty-step rejection) and replace the tautological `toContain("fallback")` with an assertion that actually checks tool-vs-prose framing.
10. F-10 reconcile prose quiz guidance ("4 options required") with the template contract ("2..4, optional answerIndex") in one sentence in all prompt blocks. Trivia: trailing newline in `miniappTemplates.ts`, checklist `title:null` guard, defensive `?.replace`.

**Verdict:** functionally sound, tests real, copy lie fixed, renderer shapes matched — **ship after items 1-3**; the rest is polish. The two things that would embarrass this commit in review are the false "QuickActionSheet" commit message and the fictional `pro`/`con` slot contract, both of which are one-line fixes.