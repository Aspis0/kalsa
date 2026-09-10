# C6 Hostile-Audit Fix Report

**Audited commit:** `ab6f4a0` (`feat/miniapp): C6 — prompt types, templates, requiresAi, bio cleanup`)
**Fix date:** 2026-09-06 · **Mode:** source edits (this session)
**Tree after fix:** working tree (uncommitted, **not pushed**)

## Verdict: FIXED — builds, i18n clean, templates reachable

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **EXIT 0** (0 errors) — see `/tmp/c6-tsc.log` |
| `npx jest src/app/miniappActions.smoke.test.ts` | **EXIT 0 — 18 passed, 0 failed** — see `/tmp/c6-test.log` |

The commit `ab6f4a0` did **not** compile. This session fixed every blocker and correctness
finding from `C6-AUDIT-DEEPSEEK.md`. The impl report's "tsc → 0 errors" was **false** for the
committed tree; it is now **true** for the fixed tree.

## Why tsc was exit 2 at commit, exit 0 now

`ab6f4a0` left a dangling `]);` (F-01) — a **parse error**. A parse error in one file *suppresses
all semantic diagnostics in the rest of the program*, so F-02 (`onChooseTemplate` undeclared) and
F-04 (`massFromDensity` etc. not on `RendererContext`) were invisible to tsc. Fixing F-01 unmasked
them; fixing those in turn yields a clean build.

## Findings fixed (mapped to audit)

- **F-01 (CRITICAL, build-blocker):** deleted the orphan `]);` at `AskAssistantMiniappRenderer.tsx:199`
  (leftover from the `LEGACY_LAB_ACTION_IDS` cut in `ab6f4a0`) plus the stale comment block it was
  closing. Removed the dead well-plate/pathway constants (`MAX_WELLS`, `MAX_PATHWAY_NODES`,
  `MAX_PATHWAY_EDGES`, `LETTER_ROWS`, `WELL_CELL_CANDIDATE_KEYS`, `SAMPLE_FIELD_CANDIDATES`,
  `REPLICATE_COLUMN_CANDIDATES`, `STATUS_HIDE_TIMEOUT_MS`) and the dead `PlateMapState` / `PlateWell`
  types and the uncalled `axisLabelsFromValue` helper.
- **F-04 (HIGH):** restored the three deleted `renderer.*` keys still referenced by
  `UnitConverterBlockView` — `renderer.massFromDensity`, `renderer.volumeMl`, `renderer.densityGml` —
  in **both** `en.ts` and `it.ts` (previously deleted but still `t()`-ed → raw-key leak). Also added
  `setInput` / `runAction` to the `RendererContext` type (they were wired into `blockContext` but
  missing from the type — the two semantic errors unmasked after F-01).
- **F-02 (HIGH):** `QuickActionSheet` now destructures `onChooseTemplate` **and** `onlyTemplates`;
  the tap site uses `onAction?.(id)` (now optional). No more latent ReferenceError.
- **F-03 (productize):** `QuickActionSheet` is now **mounted** in `AiChatPage.tsx` — a `Sparkles`
  entry button in the composer left group opens it; choosing a template prefills the composer draft
  (`setDraft(t(template.promptKey))`) and focuses the field. The sheet is mounted with
  `onlyTemplates`, so it shows just the "miniapp" action that expands to the 3 templates — no dead
  buttons, no `onAction` required for the template path.
- **F-06 (correctness):** removed `EXPORT_PLATE_MAP` from `LOCAL_ACTIONS` and from
  `isMiniappExportAction`; rewrote the `miniappActions.ts` comment to state the honest behavior
  (`export_plate_map` falls through to the generic "not available" handler — correct, since the
  general mini-app format has no plate maps). No stale comments point at deleted code.
- **F-09 (Italian copy):** `Trforma`→`Trasforma`, `Rsolvi`→`Rsolvi` (Risolvi), `de fonti`→`di fonti`
  (×3), and the malformed `[{key,label]}`→`[{key,label}]` in the operative miniapp string (`it.ts`).
  Also added `chat.a11yTemplates` (EN+IT) for the entry button.
- **F-10 (nits):** added trailing newlines to the 4 new files; typed `MiniappTemplate.labelKey/subKey/promptKey`
  as `TranslationKey` (a key typo now fails tsc instead of silently leaking a raw key) — this let me
  drop the `as TranslationKey` casts at the call sites.

## Tests added (smoke suite: 16 → 18)

- **F-04 regression guard:** `translate("en"/"it", key)` for the 3 restored density keys must **not**
  equal the raw key (catches a future "keys deleted while referenced" regression).
- **F-11 gap:** calculator negative-variable / subtraction cases (`a-2` with `a:-3` → `-5`).

## Verification commands (honest, no pipe before status)

```
npx tsc --noEmit > /tmp/c6-tsc.log 2>&1; echo TSC_EXIT:$?      # -> TSC_EXIT:0
npx jest src/app/miniappActions.smoke.test.ts > /tmp/c6-test.log 2>&1; echo TEST_EXIT:$?  # -> TEST_EXIT:0 (18 passed)
```

Grep confirmations: no `Trforma|Rsolvi \|de fonti|label\]}`; no orphan `]);`; `onChooseTemplate`
destructured; `QuickActionSheet` imported from `src/screens/AiChatPage.tsx`; bio symbols
(`MAX_WELLS`/`MAX_PATHWAY_NODES`/`LETTER_ROWS`/`WELL_CELL_CANDIDATE_KEYS`/`PlateMapState`/`PlateWell`/
`axisLabelsFromValue`) — 0 references.

## Leftovers (intentional)

- `docs/`, `out/`, `results/`, `n3.txt`, `device-decode-lineup-out/` — unrelated dirty tree, left untouched.
- `MINIAPP_TEMPLATE_IDS` export in `miniappTemplates.ts` — unused, harmless; left for a future action list.
- `QuickActionSheet`'s `onAction` is optional and only used when mounted **without** `onlyTemplates`
  (this PR mounts with `onlyTemplates`); the non-template quick actions (chat/search/openLast) remain
  unwired — out of C6 scope.

## Commit

`fix(miniapp): C6 — compile, i18n, template mount` — only the 9 C6-related files below. **Not pushed.**

Files: `src/i18n/en.ts`, `src/i18n/it.ts`, `src/ui/AskAssistantMiniappRenderer.tsx`,
`src/app/miniappActions.ts`, `src/theme/components/QuickActionSheet.tsx`,
`src/screens/AiChatPage.tsx`, `src/domain/miniappTemplates.ts`, `src/domain/miniappCalculator.js`,
`src/app/miniappActions.smoke.test.ts`.