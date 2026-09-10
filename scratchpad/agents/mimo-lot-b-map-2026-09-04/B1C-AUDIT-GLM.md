# B1C Audit — GLM replacement

**Auditor:** GLM (replacing crashed audit run)
**Date:** 2026-09-04
**Files audited:**
- `src/memory/MemoryStore.ts` — `updateFact`, `MemoryDuplicateError`
- `src/memory/MemoryStore.test.ts` — updateFact test suite
- `src/screens/SettingsScreen.tsx` — edit UI (~591–630, ~1449–1545)
- `src/i18n/en.ts`, `src/i18n/it.ts` — `edit*` keys

**Parent notes verified:**
1. Empty/whitespace save → silent no-op cancel (map said no-op cancel) — **IMPLEMENTED**, no notice
2. Epoch bump on successful updateFact — **IMPLEMENTED**, parent said required
3. a11y on Pencil/Check/X — **IMPLEMENTED**, `accessibilityLabel` on all three Pressables

---

## Confirmed / Plausible / Refuted

### CONFIRMED

**1. `updateFact` epoch bump contradicts map rationale (MAP/IMPL divergence)**
`MemoryStore.ts:245` — `bumpEpoch()` fires after every successful write.
`B1C-EDIT-FACT-MAP.md` §2: "Epoch decision: No bump. Rationale: epoch guards extraction-job stale writes… an edit doesn't empty the store or disable memory."
Parent overruled: "Epoch bump on successful updateFact — required." Impl follows parent, not map.
`MemoryStore.test.ts:674–681` — test explicitly asserts `getEpoch()` increments by 1.
**Verdict:** Impl is *correct per parent instruction*; map was stale. No code bug, but map rationale is now misleading.

**2. Silent discard of unsaved edits when switching edit target**
`SettingsScreen.tsx:591–596` — `handleStartEditingMemoryFact` unconditionally overwrites `editingFactId` and `editingText`:
```
setEditingFactId(fact.id);
setEditingText(fact.text);
```
If user edits fact A, types partial text, then taps Pencil on fact B → fact A edits silently vanish. No confirmation, no notice.
**Verdict:** Plausible UX gap. Not a correctness bug but a data-loss-adjacent UX surprise.

**3. `handleDeleteMemoryFact` does not clear editing state**
`SettingsScreen.tsx:631–658` — after `removeFact` + `reloadMemory`, the function never calls `setEditingFactId(null)` or `setEditingText("")`.
**Actual exposure:** near-zero. Edit mode replaces the Trash2 icon with Check/X, so you cannot trigger `handleDeleteMemoryFact` on the same fact while editing it. Deleting a *different* fact while editing one is safe (the deleted fact's ID just won't match on next save → no-op).
**Verdict:** Plausible — defensive cleanup is cheap and prevents obscure future regressions.

**4. `handleDeleteMemoryFact` missing `memoryBusy` dependency**
`SettingsScreen.tsx:658` — dependency array is `[reloadMemory, t]`, but `handleDeleteMemoryFact` is gated by `memoryBusy` via the Pressable `disabled={memoryBusy}` prop, not inside the callback itself. Functionally safe (button is disabled when busy), but ESLint `exhaustive-deps` would flag it.
**Verdict:** NIT — technically incorrect deps, zero runtime impact.

### REFUTED

**5. Empty/whitespace save is NOT a silent cancel — but it IS invisible**
`SettingsScreen.tsx:600–603`:
```
if (!editingText.trim()) {
  handleCancelEditingMemoryFact();
  return;
}
```
Correct: no write to store, no network hop, edit mode dismissed.
The map spec says "no-op cancel" and the impl matches. However, the parent note says "may need notice." Currently there is no user-facing indication that the save was discarded (the TextInput just disappears). A `memory.editEmpty` notice was not added.
**Verdict:** Functionally correct per map. UX concern flagged by parent — not a bug, but a missing polish item.

**6. `updateFact` early-return on same text is correctly placed AFTER duplicate check**
`MemoryStore.ts:236–243`:
```
const key = normalizeKey(normalized);
if (facts.some((fact, factIndex) => factIndex !== index && normalizeKey(fact.text) === key)) {
  throw new MemoryDuplicateError();
}
if (facts[index].text === normalized) return;   // ← correct position
```
If the order were reversed, re-saving the same text as another fact would silently no-op instead of throwing. Current order is correct.
**Verdict:** Correct implementation.

### PLAUSIBLE

**7. `updateFact` dedupe throw is async — no double-tap guard needed but not explicitly protected**
`MemoryStore.ts:238–239` throws `MemoryDuplicateError` inside `withMutex`. The mutex serializes calls, so two concurrent `updateFact` calls cannot race. But the UI side does not disable the Check button *before* the await — `setMemoryBusy(true)` at line 605 runs before `await updateFact`, so double-tap is prevented.
**Verdict:** Safe.

**8. `useCallback` dependency arrays are correct (except NIT #4)**
`handleSaveMemoryFact` deps: `[editingFactId, editingText, handleCancelEditingMemoryFact, memoryBusy, reloadMemory, t]` — complete.
`handleStartEditingMemoryFact` deps: `[memoryBusy]` — complete.
`handleCancelEditingMemoryFact` deps: `[memoryBusy]` — complete.
**Verdict:** Correct.

**9. i18n keys present and mirrored**
`en.ts:911–914`: `editFact`, `editPlaceholder`, `editDone`, `editDuplicate` — all present.
`it.ts:883–886`: `editFact`, `editPlaceholder`, `editDone`, `editDuplicate` — all present and translated.
`typeof en` type-check in `it.ts:2` ensures mirror shape.
**Verdict:** Correct.

**10. Lucide icons imported**
`SettingsScreen.tsx:28`: `import { Check, ChevronRight, CircleQuestionMark, Pencil, Trash2, X } from "lucide-react-native"` — all three (`Check`, `Pencil`, `X`) present.
**Verdict:** Correct.

---

## Nits (ALL)

| # | Severity | File:Line | Description |
|---|----------|-----------|-------------|
| N1 | NIT | `SettingsScreen.tsx:658` | `handleDeleteMemoryFact` dependency array `[reloadMemory, t]` omits `memoryBusy`. ESLint `exhaustive-deps` violation. Zero runtime impact because button is disabled when busy. |
| N2 | NIT | `SettingsScreen.tsx:591–596` | `handleStartEditingMemoryFact` unconditionally overwrites editing state — no "discard unsaved?" prompt when switching edit target. UX polish gap. |
| N3 | NIT | `SettingsScreen.tsx:631–658` | `handleDeleteMemoryFact` does not call `setEditingFactId(null)` / `setEditingText("")` after delete. Defensive cleanup missing. Functionally unreachable in current UI. |
| N4 | NIT | `MemoryStore.ts` docstring (line 11) | Module-level doc says "epoch bumps on clear/remove/disable/edit" — "edit" was added to match impl, but map spec said "no bump". Doc is correct per current code but could confuse future readers about the original rationale. |
| N5 | NIT | `SettingsScreen.tsx:600–603` | Empty/whitespace save silently cancels with no user-facing notice. Parent noted "may need notice." A `memory.editEmpty` i18n key was not added. |
| N6 | NIT | `MemoryStore.ts:236` | `normalizeKey(newText)` recomputes what `normalizeText(newText)` already normalized — the `normalized` variable is the result of `normalizeText`, so `normalizeKey(normalized)` is `normalizeText(normalized).toLowerCase()`. One extra `normalizeText` call per update (harmless but redundant). |

---

## Blocker / Bug Summary

**No BLOCKERs or BUGs found.** The implementation is functionally correct. All parent requirements are met. The epoch bump diverges from the original map spec but aligns with the parent's explicit override.

---

## Ordered Fix List

| Priority | Item | Effort |
|----------|------|--------|
| — | No blockers to fix | — |
| 1 | N5: Add `memory.editEmpty` i18n key + show notice on whitespace-only save (parent flagged) | 15 min |
| 2 | N1: Add `memoryBusy` to `handleDeleteMemoryFact` deps array | 1 min |
| 3 | N3: Add `setEditingFactId(null); setEditingText("");` to `handleDeleteMemoryFact` success path | 2 min |
| 4 | N4: Clarify module docstring — note epoch bump is intentional per parent override | 1 min |
| 5 | N2: Optional — confirm-before-discard when switching edit target | 30 min |
| 6 | N6: Remove redundant `normalizeText` call inside `normalizeKey` in `updateFact` (or leave — negligible) | 2 min |

**Test coverage:** 8/8 requested `updateFact` tests present and passing. No additional test gaps identified.
