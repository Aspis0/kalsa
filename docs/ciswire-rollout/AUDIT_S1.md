# AUDIT S1 — Flag Plumbing

**Date:** 2026-08-25  
**Spec:** `PLAN_CISWIRE_FOR_REAL.md` Part 2 + `MAP_S1_S2_S5.md`  
**Diff:** 262 insertions, 7 deletions across 11 files  
**tsc --noEmit:** EXIT 0 ✓  
**jest (compactor|telemetry):** 20/20 PASS ✓  

---

## Findings

| # | File:Line | Verdict | Finding | Fix |
|---|-----------|---------|---------|-----|
| 1 | `SettingsScreen.tsx:1130-1165` + `SettingsScreen.tsx:1168-1260` | **DEFECT** | **Dual compaction UI.** Old boolean Switch in Context section (`handleToggleCompaction`, writes `"1"`/`"0"`) coexists with new 3-way segmented control (`handleSelectCompactionMode`, writes `"anchored"`/`"ciswire"`/`"off"`). Two independent UIs write different formats to the same `COMPACTION_ENABLED_KEY`. User can toggle the old Switch, then see the segmented control out of sync (and vice versa). The old Switch writes `"1"` which `parseContextMode` maps to `"anchored"` — functional but the user's intent to select ciswire via the old toggle is silently lost. | **Must fix before S2.** Remove the old Context GlassPanel2 section entirely, or gate it behind a feature flag. The 3-way segmented is the replacement; two write paths is a collision vector. |
| 2 | `SettingsScreen.tsx:448-458` | **DEFECT** | **`handleToggleCompaction` rollback omits `compactionMode`.** On write failure, catch restores `compactionEnabled` to `previous` but does NOT restore `compactionMode`. State becomes inconsistent: `compactionEnabled` rolled back but segmented control still shows the failed value. | **Must fix before S2.** Add `setCompactionMode(previousMode)` in the catch, or remove the old handler entirely (see #1). |
| 3 | `SettingsScreen.tsx:1220-1240` + `SettingsScreen.tsx:1370-1395` | **DEFECT** | **Dual memory UI.** Memory switch rendered in BOTH the CisWire section (`ciswireMemory` label) AND the legacy Memory section (`memory.enabled` label). Both bind to same `memoryEnabled` state and `handleToggleMemory`. Functionally identical but visually confusing — user sees two toggles for the same thing. Spec says CisWire section has its own memory toggle; the old Memory section toggle is not mentioned for removal. | **Must fix before S2.** Decide: either move memory toggle INTO CisWire section only (removing from Memory section), or keep in Memory section and remove from CisWire section. Current dual-render is not in spec. |
| 4 | `SettingsScreen.tsx:460-472` | **CONFIRMED-OK** | **`handleSelectCompactionMode` rollback is correct.** Restores both `compactionMode` and `compactionEnabled` on failure. | — |
| 5 | `SettingsScreen.tsx:474-482` | **CONFIRMED-OK** | **`handleToggleCiswireToolHelp` rollback is correct.** Restores `ciswireToolHelpEnabled` on failure. Writes `"1"`/`"0"` to `CISWIRE_TOOLHELP_KEY`. | — |
| 6 | `SettingsScreen.tsx:382-392` | **CONFIRMED-OK** | **First open for user who never touched settings.** `parseContextMode(null)` → `"anchored"`, `parseCompactionEnabled(null, false)` → `true` (default). Segmented control renders Standard selected. No write occurs on mount. ✓ | — |
| 7 | `compactor.ts:267-277` + `ttftFlags.ts:93-107` | **CONFIRMED-OK** | **Byte-identity of legacy paths.** All four combinations verified: (a) stored `"0"`: `parseContextMode` → `"off"`, `parseCompactionEnabled` → `false`. (b) stored `"1"`: → `"anchored"`, `true`. (c) absent: → `"anchored"`, `true`. (d) `"ciswire"`: → `"ciswire"`, `true`. All match pre-S1 regime. | — |
| 8 | `compactor.ts:267` | **CONFIRMED-OK** | **`parseContextMode` default is `"anchored"` for all garbage/absent.** Agrees with `COMPACTION_ENABLED_DEFAULT = true`. The two parsers (`parseContextMode` for regime, `parseCompactionEnabled` for boolean) are consistent: default = ON = anchored. | — |
| 9 | `ttftFlags.ts:93-107` | **PLAUSIBLE-RISK** | **`parseCompactionEnabled` now accepts `"off"`, `"anchored"`, `"ciswire"`.** This is correct for S1 (new segmented writes these values). But it widens the boolean parser's vocabulary beyond the original boolean contract (`"0"`/`"1"`/`"true"`/`"false"` only). If any future code writes a mode string to `COMPACTION_ENABLED_KEY` expecting it to be treated as a boolean, the widened acceptance silently changes behavior. | Can defer — but document the vocabulary expansion in `parseCompactionEnabled`'s docstring. Currently the docstring only mentions `"0"/"false"/"1"/"true"`. |
| 10 | `AppShell.tsx:4512-4523` | **CONFIRMED-OK** | **`turnCiswireFlags` bitmask computation.** `(contextMode === "ciswire" ? 1 : 0) | (memoryEnabledRef.current ? 2 : 0) | (toolhelpRef.current ? 4 : 0)`. All three bits sourced from live ref state. Comment: "Telemetry bitmask only — no gating behavior here." | — |
| 11 | `AppShell.tsx:4505-4507` | **CONFIRMED-OK** | **Catch fallbacks preserve pre-S1 behavior.** `contextModeRef = "anchored"`, `compactionEnabledRef = COMPACTION_ENABLED_DEFAULT`, `toolhelpRef = false`. All three fall back to the shipped default. | — |
| 12 | `AppShell.tsx:2401-2402` | **CONFIRMED-OK** | **`toolhelpRef` read but unused for decisions.** Only consumed for bitmask. No gating. S4 will add the gate. | — |
| 13 | `turnTelemetry.ts:190-194` | **CONFIRMED-OK** | **Omission rule in `formatTelemetryLine`.** `ciswireFlags` destructured, spread only when truthy: `...(ciswireFlags ? { ciswireFlags } : {})`. When 0 or undefined → field absent from JSON. ✓ | — |
| 14 | `digestTelemetry.ts:34-35` | **CONFIRMED-OK** | **Omission rule in `formatDigestLine`.** Same pattern: `...(t.ciswireFlags ? { ciswireFlags: t.ciswireFlags } : {})`. ✓ | — |
| 15 | `memoryTelemetry.ts:58-59` | **CONFIRMED-OK** | **Omission rule in `formatMemoryLine`.** Same pattern. ✓ | — |
| 16 | `AppShell.tsx:4255-4258` | **CONFIRMED-OK** | **Early-exit settled path populates `ciswireFlags`.** `emitSettledMemoryTelemetry(earlyTelemetry)` passes `ciswireFlags: turnCiswireFlags || undefined`. ✓ | — |
| 17 | `AppShell.tsx:4890-4891` | **CONFIRMED-OK** | **Turn-end KALSA_MEMORY line populates `ciswireFlags`.** `ciswireFlags: turnCiswireFlags || undefined`. ✓ | — |
| 18 | `AppShell.tsx:4746-4752` | **CONFIRMED-OK** | **KALSA_DIGEST line populates `ciswireFlags`.** Spread into formatDigestLine call. ✓ | — |
| 19 | `LlamaService.ts:2964-2968` + `LlamaService.ts:3280-3283` | **CONFIRMED-OK** | **Both `emitTurnTelemetry` call sites in `streamAssistantTurn` pass `options.ciswireFlags`.** Main round (line 2964) and fallback round (line 3280). ✓ | — |
| 20 | `LlamaService.ts:3547, 3717, 3842` | **PLAUSIBLE-RISK** | **Three utility `emitTurnTelemetry` calls omit `ciswireFlags`.** `extractMemory`, `translateText`, `completeOnce` are utility completions, not user-facing turns. The spec says "ciswireFlags bitmask on every line" but these are auxiliary engine calls that don't represent the turn's feature state. Omitting is defensible — the bitmask describes the turn's configuration, not the utility's. | Can defer — but add a comment at each site explaining why `ciswireFlags` is omitted (not a turn). |
| 21 | `LlamaService.ts:855` | **CONFIRMED-OK** | **`emitTurnTelemetry` guards with `ciswireFlags !== undefined`.** Only assigns when present; omits from JSON otherwise. ✓ | — |
| 22 | `compactor.test.ts:56-72` | **CONFIRMED-OK** | **`parseCiswireToolHelp` tests are meaningful.** Tests all branches: `"1"`/`"true"` → on, `null`/`undefined`/`""`/`"0"`/`"false"`/`"off"`/`"yes"` → off. Contract-level, not implementation-detail. ✓ | — |
| 23 | `compactor.test.ts:33-54` | **CONFIRMED-OK** | **Existing `parseContextMode` tests unchanged.** All four legacy combinations covered. ✓ | — |
| 24 | (missing) | **DEFECT** | **No tests for `handleSelectCompactionMode` or `handleToggleCiswireToolHelp`.** These are UI callbacks in a React component — harder to unit test, but the write-then-rollback logic is critical. At minimum, a test that `handleSelectCompactionMode("ciswire")` writes `"ciswire"` to `COMPACTION_ENABLED_KEY` and `"1"` to `COMPACTION_CHOICE_KEY` would catch regressions. | Can defer to S2 if SettingsScreen integration tests are planned. |
| 25 | `en.ts:93-101` + `it.ts:92-100` | **CONFIRMED-OK** | **i18n keys complete.** 7 new keys in both locales: `ciswire`, `ciswireHint`, `ciswireCompaction`, `ciswireOff`, `ciswireStandard`, `ciswireMode`, `ciswireMemory`, `ciswireToolHelp`. Italian translations natural. No missing-key crash paths. | — |
| 26 | `SettingsScreen.tsx:1195-1215` | **CONFIRMED-OK** | **a11y labels present.** Segmented control: `accessibilityRole="radio"`, `accessibilityState={{ selected }}`, `accessibilityLabel={label}`. Memory switch: `accessibilityLabel={t("settings.ciswireMemory")}`. ToolHelp switch: `accessibilityLabel={t("settings.ciswireToolHelp")}`. ✓ | — |
| 27 | `ttftFlags.ts:1-7` + `ttftFlags.ts:74-84` | **PLAUSIBLE-RISK** | **`getCiswireToolHelp` is an async wrapper around sync `parseCiswireToolHelp`.** Only used by SettingsScreen's initial `Promise.all`. AppShell reads the key directly in its own `Promise.all` and calls `parseCiswireToolHelp` synchronously. The async wrapper adds AsyncStorage import to ttftFlags.ts (a pure-flags module). Not harmful but pollutes the module boundary. | Can defer — but consider moving `getCiswireToolHelp` to SettingsScreen's local scope or a settings-utils module. |
| 28 | `AppShell.tsx:4929-4931` | **CONFIRMED-OK** | **`streamAssistantTurn` receives `ciswireFlags` via `options`.** Passed through to both `emitTurnTelemetry` call sites inside. ✓ | — |
| 29 | (diff-wide) | **CONFIRMED-OK** | **No console.log left behind by this diff.** All `console.log` calls in the diff are telemetry emission (formatMemoryLine, formatDigestLine, formatTelemetryLine) — these are intentional structured logging, not debug prints. | — |
| 30 | (diff-wide) | **CONFIRMED-OK** | **No dead code in diff.** `CISWIRE_FLAG_*` constants, `parseCiswireToolHelp`, `CISWIRE_TOOLHELP_KEY` are all consumed. `getCiswireToolHelp` is consumed by SettingsScreen. | — |
| 31 | `SettingsScreen.tsx:460-472` | **PLAUSIBLE-RISK** | **`handleSelectCompactionMode` writes mode string directly to `COMPACTION_ENABLED_KEY`.** This is the key the old toggle writes as `"1"`/`"0"`. The new handler writes `"anchored"`/`"ciswire"`/`"off"`. Both parsers handle all values correctly, but the key's semantic has shifted from "boolean flag" to "mode discriminator". Any code that does `key === "1"` (not just the parsers) will break. | Can defer — grep confirms no raw `=== "1"` checks on this key outside the parsers. But the semantic shift should be documented. |

---

## Seam Bug Analysis (Two-Pass Authorship)

| # | Verdict | Finding |
|---|---------|---------|
| S1 | **CONFIRMED-OK** | No duplicated logic between passes. Pass 1 added constants/parser in `compactor.ts`; Pass 2 added UI in `SettingsScreen.tsx` and telemetry threading in `AppShell.tsx`/`LlamaService.ts`. No overlapping edits. |
| S2 | **CONFIRMED-OK** | No half-migrated call sites. `parseContextMode` has exactly one production call site (AppShell.tsx:4499). `parseCiswireToolHelp` has exactly two: AppShell.tsx:4510 (sync in Promise.all) and ttftFlags.ts:76 (async wrapper for SettingsScreen). |
| S3 | **CONFIRMED-OK** | Naming consistent across passes. `CISWIRE_TOOLHELP_KEY`, `parseCiswireToolHelp`, `ciswireFlags`, `turnCiswireFlags` — all use the same prefix/camelCase convention. |
| S4 | **CONFIRMED-OK** | No state written by one pass but read differently by the other. `toolhelpRef` is written in AppShell's try block and read in the bitmask computation — same pass. `compactionMode` state in SettingsScreen is self-contained. |

---

## Summary

| Category | Count |
|----------|-------|
| DEFECT (must fix before S2) | 3 |
| PLAUSIBLE-RISK (can defer) | 5 |
| CONFIRMED-OK | 23 |

### Must Fix Before S2

1. **#1 — Dual compaction UI.** Remove old Context section Switch or gate it. Two write paths to the same key is a collision vector.
2. **#2 — `handleToggleCompaction` rollback bug.** Catch block doesn't restore `compactionMode`. (Moot if #1 removes the old handler.)
3. **#3 — Dual memory UI.** Memory switch rendered in two places. Decide which section owns it.

### Can Defer

4. **#9 — `parseCompactionEnabled` vocabulary expansion.** Document in docstring.
5. **#20 — Utility `emitTurnTelemetry` calls omit `ciswireFlags`.** Add explanatory comments.
6. **#24 — No SettingsScreen callback tests.** Plan for S2 integration tests.
7. **#27 — `getCiswireToolHelp` async wrapper pollutes ttftFlags.** Move to local scope.
8. **#31 — `COMPACTION_ENABLED_KEY` semantic shift.** Document; no raw `=== "1"` checks found.

---

# RE-AUDIT — Fix Pass Verification

**Date:** 2026-08-25 (same session)
**Fix pass scope:** `SettingsScreen.tsx` only (153+ / 51−, working tree diff vs HEAD)
tsc --noEmit: EXIT 0 ✓

## Per-Finding Verdicts

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | Dual compaction UI | **RESOLVED** | `handleToggleCompaction` deleted — 0 references (`grep` returns exit 1). Legacy Context `GlassPanel2` section fully removed; replaced by CisWire panel at :1121. `handleSelectCompactionMode` is the sole writer of `COMPACTION_ENABLED_KEY` — `grep` confirms only 4 refs: import (:70), getItem (:383), comment (:432), multiSet (:441). No other handler writes that key. |
| 2 | Rollback gap | **RESOLVED** | Old handler deleted. New `handleSelectCompactionMode` (:434) catch block restores BOTH `setCompactionMode(previousMode)` AND `setCompactionEnabled(previousEnabled)` (:449-450). No other handler has a partial rollback — `handleToggleCiswireToolHelp` (:454) only writes `CISWIRE_TOOLHELP_KEY` (separate key, separate state, correct single-state rollback). |
| 3 | Duplicate memory switch | **RESOLVED** | Exactly ONE `onValueChange={handleToggleMemory}` at :1189 (in CisWire panel). Legacy Memory section (:1316) no longer renders a switch — only shows title, note, facts list, and add-fact input. Layout is coherent: title → note → `{!memoryEnabled ? disabledNote : null}` → facts list → add-fact input. No orphaned labels or broken structure. |

## Regression Scan

| Check | Result |
|-------|--------|
| Unused imports? | None. All 7 new imports (`CISWIRE_TOOLHELP_KEY`, `COMPACTION_CHOICE_KEY`, `COMPACTION_ENABLED_KEY`, `parseContextMode`, `ContextMode`, `getCiswireToolHelp`, `parseCompactionEnabled`) are referenced in code. |
| Dead i18n keys? | 3 keys orphaned in locale files: `settings.context`, `settings.contextCompaction`, `settings.contextCompactionHint`. Also `memory.enabled` removed from JSX but still in locale files. All harmless dead weight — no crash paths. |
| JSX structure broken? | No. CisWire panel renders: header → hint → segmented control → memory switch → toolHelp switch. Memory panel renders: title → note → disabledNote → facts list → add-fact input. Both well-formed. |
| tsc --noEmit | EXIT 0 ✓ |

## Diff Scope Check

The full uncommitted diff spans 11 files (238+/51−). The fix pass touched **only** `SettingsScreen.tsx` — the other 10 files (`compactor.ts`, `compactor.test.ts`, `ttftFlags.ts`, `AppShell.tsx`, `LlamaService.ts`, `turnTelemetry.ts`, `digestTelemetry.ts`, `memoryTelemetry.ts`, `en.ts`, `it.ts`) are the original S1 diff, unchanged since the audit. No regressions detected in those files from the fix pass.

## Final Verdict

**SEALED** — All 3 must-fix defects resolved. No regressions introduced. tsc passes. Fix pass is correctly scoped to SettingsScreen.tsx only.
