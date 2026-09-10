# C6d — Hostile Audit (DeepSeek) · commit `3c9e2a3` on `feat/moe-stream`

**Date:** 2026-09-06 · **Mode:** READ-ONLY (no source edited) · **Auditor artifact:** this file.
**Binding:** `C6D-MVP-BINDING.md` · **Map:** `C6D-MINIAPP-GLASS-MAP.md` · **Self-report under audit:** `C6D-IMPL-REPORT.md`

## Verification log (reproduced, not trusted)

| Check | Command / source | Result |
|---|---|---|
| Commit scope | `git show 3c9e2a3 --stat` | 3 files: `en.ts` +7, `it.ts` +7, `AskAssistantMiniappRenderer.tsx` +57/−19. No sneaky extras. |
| New style keys | `git show 3c9e2a3 -- src/theme/createStyles.ts \| wc -l` | **0 lines — createStyles untouched.** Parent suspect #4 CONFIRMED clean. |
| Typecheck | `npx tsc --noEmit` | exit 0 ✓ (impl-report claim confirmed) |
| Slots exist | `src/agent/createMiniappTool.ts:44` | `checklist (title?, steps[] or items[])` — title is a first-class slot |
| Builder emits title | `src/domain/miniappBuildersNew.ts:163` | `[{ type: "timeline", title: asString(slots.title), steps }]` — block.title is genuinely populated |
| Registry declares title | `AskAssistantMiniappRenderer.tsx:1669,1599,1466` | `timeline`/`quality_panel`/`citations` all list `title` in `schemaFields` |
| Styles exist | `createStyles.ts:895,937,940` | `miniappEvidenceItem`, `miniappPlannerTimeline`, `miniappPlannerTimelineItem` all pre-existing |
| `renderer.source` exists | `en.ts:607`, `it.ts:606` | `"Fonte"` resolved in both locales — the citations "Source:" label is not a missing key |
| `{n}` interpolation | `src/i18n/index.ts:59` | `applyParams` regex `/\{(\w+)\}/`; params key `n` matches `{n}` — `stepN` renders "Step 1" etc. correctly |
| Fallback translation | `translate()` → `FLAT_CATALOG.en` | missing-key fallback is EN; unused params silently ignored |
| Grep binding claim | `TimelineBlockView` → `miniappFallbackBlock` | count 0 ✓ (outer wrapper replaced as binding required) |
| EN/IT parity | `it.ts satisfies LocaleStrings` (`types.ts`) | type-forced; tsc 0 proves 7/7 keys mirrored |

---

## Part 1 — Parent suspects: verdicts

### S-1. `TimelineBlockView` ignores `block.title` — **CONFIRMED (HIGH-ish, see nuance)**

Old (`3c9e2a3^`): `<Text style={miniappBlockTitle}>{toStringValue(block.title, "Timeline")}</Text>`
New (line 1265): `<Text style={miniappBlockTitle}>{context.t("miniapp.timelineTitle")}</Text>`

- `block.title` is **populated**: `buildChecklist` emits `{type:"timeline", title: asString(slots.title), steps}` (`miniappBuildersNew.ts:163`), and `create_miniapp`'s checklist slot accepts `title?` (`createMiniappTool.ts:44`).
- The copy-from model `WorkflowTimelineBlockView` (line 981) still does `toStringValue(block.title, "Workflow timeline")` — the impl report claims "structure copied from WorkflowTimelineBlockView", then deviates from it exactly where content preservation matters.
- The binding itself says "**Title fallback**: i18n (checklist/timeline), not `"Timeline"`" — "fallback" means `block.title` wins when present. The implementation made the i18n string the *only* option, dropping the fallback semantics the binding prescribed.
- **Nuance (fairness):** for the single-block checklist path, the miniapp shell header (`miniappHeader` → `localMiniapp.title`, renderer ~2155) shows the same slot title, so the loss is masked in the most common case. It bites whenever the title differs (hand-written `timeline` blocks in multi-block/nested miniapps, or any future builder) — but it is still a regression vs pre-commit behavior and a binding violation.

### S-2. Same for `QualityPanelBlockView` — **CONFIRMED**

Old: `toStringValue(block.title, "Quality panel")` → New (line 1292): fixed `t("miniapp.qualityTitle")`.
`quality_panel` registry declares `title` in `schemaFields` (line 1599). Hand-written quality panels lose their heading with no way to recover it.

### S-3. IT copy awkward — **CONFIRMED, worse than "awkward"**

| key | IT | Verdict |
|---|---|---|
| `timelineTitle` | `Scheda cronologia` | Wrong. "Scheda" = card/sheet/fact-sheet → reads "timeline fact sheet". Also collides with existing tab vocabulary (`renderer.tabN: "Scheda {n}"`) — reads like a tab label. Natural: `Cronologia` (or `Elenco passi` for checklist). |
| `timelineEmpty` | `Nessuna voce da scheda ancora.` | Broken Italian. "da scheda" is meaningless (machine-translated remnant of "from card"); "ancora" stranded at the end. Should be `Ancora nessuna voce.` |
| `qualityEmpty` | `Nessuna voce di qualità ancora.` | Clunky calque; acceptable-ish but `Ancora nessuna voce di qualità.` is natural. |
| `citationsEmpty` | `Nessuna citazione ancora.` | Clunky inversion; `Ancora nessuna citazione.` is natural. |
| `stepN` | `Passo {n}` | Fine. |
| `qualityTitle` / `citationsTitle` | `Pannello qualità` / `Citazioni` | Fine. |

Worst part is systemic: because of S-1, the awkward `Scheda cronologia` is now the **always-on heading for every checklist miniapp** — the bad copy is on-screen, not a corner-case fallback. (Note: EN fallbacks `"Timeline"`/`"Quality panel"`/`"Citations"` equal the old hardcoded strings, so EN is only wrong where S-1 bites.)

### S-4. Zero new `createStyles` keys — **CONFIRMED CLEAN**

3-file diff, createStyles untouched; all five reused styles (`miniappPlannerTimeline`, `miniappPlannerTimelineItem`, `miniappEvidenceItem`, `miniappBlockTitle`, `miniappFallbackText`) verified to exist. Impl report's "reuse only" claim is true. Also matches the map's recommendation (items for citations, planner items for timeline/quality).

---

## Part 2 — Findings the parent did NOT list

### F-1. Citations: `record.text` mislabeled as `source` — MEDIUM (new logic, semantically wrong)

```tsx
const source = toStringValue(citationRecord.source, toStringValue(citationRecord.url, toStringValue(citationRecord.text)));
```
renders `Source: <text>` when a citation is `{title, text}` or `{id, text}`. `text` is a quote/passage, not a source. The very pattern this was copied from, `EvidencePanelBlockView` (lines ~872-874), maps `text` → **note**, not source. Hand-written miniapp JSON (explicitly still allowed by the tool prompt, `en.ts:1063` "fall back to emitting miniapp_v1 JSON by hand") with `{id, text}` citations now prints a card whose bold line is the bare id and whose "Fonte:" line is the quoted passage itself. Inconsistent with the sibling view; mislabels model data.

### F-2. Citations: statement never falls back to url/source — LOW

`{url}`-only citation → `statement = ""` → empty bold line, then correct `Source: url`. Old code had the same empty-statement bug, so not a regression, just a missed improvement while the block was being rewritten anyway.

### F-3. Citation numbering dropped — LOW regression

Old: `1. Title` / `2. Title`… New: bare `Title`. Loses scannability of long lists and breaks "see citation N" cross-references. Consistent with `EvidencePanelBlockView` (also unnumbered), so it's a deliberate-style question — but it *is* a UX regression vs pre-commit citations, and the diff doesn't acknowledge it. If numbering matters, `miniappEvidenceItem` has `gap: 2` and no number slot; adding one would need a new style (out of C6d's "zero keys" constraint) — so the choice to drop it is implicitly forced. Flag for a conscious decision, not silent.

### F-4. Quality rows truncated at 2 lines — LOW regression

Old: full text. New: `numberOfLines={2}` on `label: value`. A quality check sentence ("Titration purity 99.2% — above 95% threshold, recompute at 25°C…") truncates with **no expansion affordance** (blocks are static; no "show more"). Timeline titles also gain truncation (old: never truncated). Matches the WorkflowTimeline copy, but for quality metrics the value is potentially the most important content on screen.

### F-5. Generic `timeline` blocks now force checklist vocabulary — LOW

"Step {n}" is always shown as the emphasized first line. Pre-commit, the entry title was the primary line and "Step N" was a last-resort fallback only when both `title` and `label` were missing. The binding explicitly asked for "Step" for the checklist path — but `buildChecklist` emits `type:"timeline"`, so the renderer cannot distinguish a checklist from a hand-written dated timeline; dated/historical timelines (real `time` values) now read "Step 1 • 2026-09-06". The copy-from model uses neutral "Day N"… for workflows. There is no neutral option left. Documented-decision territory; low severity, but the old fallback semantics were actually *smarter* for generic timelines.

### F-6. i18n keys placed in `miniapp:{}`, not `renderer:{}` — LOW consistency

The file's own comment at `en.ts:576` defines `renderer:` as "UI chrome / fallback labels inside the miniapp renderer (not model content)". These 7 keys are exactly that — and the equivalent strings for the sibling view live there (`renderer.noEvidenceNotes`, `renderer.evidencePanel`, `renderer.source`, plus the same-shaped `renderer.tabN` / `nestedDepthCapped: "{depth}"`). `miniapp:` is the template/slot section (consumed by the `create_miniapp` executor for `pro`/`con`). `stepN` belongs next to `renderer.tabN`. Cosmetic today (no collisions; both sections render the same), wrong drawer tomorrow.

### F-7. The twin view is still hardcoded English — LOW consistency

`WorkflowTimelineBlockView` (lines 981, 1000) still hardcodes `"Workflow timeline"`, `"No timeline steps configured."`, `"Day {n}"`. C6d i18n-ized one timeline and left its visual twin (the very template it copied) in raw English. Map §5 flagged exactly these. Not in C6d's binding scope ("i18n only for strings you touch"), so this is a *deliberate debt*, but the catalog is now internally inconsistent on the same screen family.

### F-8. Empty `<Text>`s always rendered — NIT

Timeline: `toStringValue(record.title, toStringValue(record.label, ""))` renders an empty truncated Text per entry even when the entry is a bare time/`output` record. Citations: empty bold statement Text. Zero-height, harmless, sloppy — the evidence-panel model guards `source`/`note` but not the statement either.

### F-9. Double-evaluated `toStringValue` — NIT

`toStringValue(record.time, toStringValue(record.when))` computed twice per entry (condition + output). Extract to a const.

### F-10. `.concat().slice(0, MAX_TABLE_ROWS)` pre-existing quirks — NIT, not C6d's

`items` ≥ 50 entries silently nukes `citations`/`steps`/`events`; duplicate `record.id` across concat'd arrays collides React keys (`record.id || index`). Preexisting in all three views; unchanged by this commit. Not held against C6d.

### F-11. A11y — no change, no regression

Rows are plain Views/Texts, no `list`/`listitem` roles — identical to `WorkflowTimelineBlockView` and to pre-commit behavior. Whole-shell `interactiveMiniappA11y` label unchanged. Nothing new to fix, nothing silently improved either.

### Regression matrix vs `WorkflowTimelineBlockView` (the stated copy-from model)

| Aspect | WorkflowTimeline (model) | New TimelineBlockView | Verdict |
|---|---|---|---|
| Outer | `miniappPlannerTimeline` | same | ✓ |
| Item | `miniappPlannerTimelineItem` | same | ✓ |
| Header index | `Day {n}` (hardcoded EN) | `stepN` i18n | ✓ better (per binding) |
| Title | `toStringValue(block.title, …)` | **fixed i18n string** | ✗ S-1 |
| Body | action/title/label, `numberOfLines={2}` | title/label, 2-line | ✓ |
| Output line | guarded | guarded | ✓ |
| Empty state | hardcoded EN | i18n | ✓ better |

The structural copy is faithful; the *title* copy is where it broke — ironic, since the binding only asked for the title fallback to be i18n.

---

## Part 3 — Fix-first list (VERDICT: fix one, then ship)

1. **[HIGH] Restore `block.title` precedence in all three views** (one-line change each):
   `{toStringValue(block.title, context.t("miniapp.timelineTitle"))}` and likewise `qualityTitle`/`citationsTitle`. This satisfies the binding's own wording ("fallback"), the registry (`title` in schemaFields), the builder (checklist title slot), the copy-from model (line 981), and pre-commit behavior. Covers S-1, S-2 and the un-listed citations variant in one shot.
2. **[MEDIUM] Fix the Italian copy** (`it.ts:565-571`): `timelineTitle → "Cronologia"`; `timelineEmpty → "Ancora nessuna voce."`; `qualityEmpty → "Ancora nessuna voce di qualità."`; `citationsEmpty → "Ancora nessuna citazione."` (editorial — exact wording up to parent).
3. **[MEDIUM] Citations `text` → note, not source** (`AskAssistantMiniappRenderer.tsx` CitationsBlockView): align with `EvidencePanelBlockView` (`source = source ?? url`; `note = note ?? summary ?? text`), and let `statement` fall back to `source` so url-only citations don't render a blank bold line. Fixes F-1 + F-2.
4. **[LOW, decide] Quality truncation**: drop `numberOfLines={2}` for quality rows (static block, no expand affordance), or accept deliberately. Fixes F-4.
5. **[LOW, decide] Citation numbering**: accept the drop (document in impl report) or restore the `n.` prefix. Fixes F-3.
6. **[LOW] Either move the 7 keys to `renderer:` or accept the split; and take `WorkflowTimelineBlockView`'s three hardcoded strings into a follow-up C6e** — the catalog now i18n-izes one timeline and leaves its twin in raw English. Fixes F-6 + F-7.
7. **[NIT] Extract the double `toStringValue(record.time, …)`; guard empty-statement Texts.** Fixes F-8/F-9. Can ride along with #3.

Nothing here is ship-blocking on crash/correctness of data (no crash, no data mutation) — but #1 is a user-visible content loss introduced by the commit and contradicts the binding it was written against; it should not ride to production. Fix #1+#2+#3 (≈10 lines, no new styles), re-run `tsc`, re-commit, then ship.

---

## Part 4 — What's actually GOOD (so the next pass doesn't regress it)

- Zero new design tokens/keys — the "reuse only" discipline held, including declining the map's optional `miniappChecklistStep`.
- `stepN` interpolation is correct end-to-end (`{n}` regex vs `{ n: index+1 }` — key `n`, matches).
- EN/IT parity enforced by types, not vibes.
- IT keys mirrored 7/7; `renderer.source` exists in both locales (checked, not assumed).
- Timeline `when`-fallback and `output` line are genuine small improvements over pre-commit.
- Binding's grep-verify ("no `miniappFallbackBlock` outer wrapper") passes.
- Impl report is honest: it does not claim `block.title` is preserved — the title-drop slips through precisely because the report's "Verify" section never mentions the title line. Add a "title preserved" check to the impl-report template for the next block-polish cycle.