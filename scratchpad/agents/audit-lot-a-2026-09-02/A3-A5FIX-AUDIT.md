# LOT-A Audit — A3 + A5-fix

**Date:** 2026-09-02  
**Branch:** `lot-a/chat-ui`  
**Auditor:** Reviewer Doc (read-only)

---

## VERDETTO 1: A3 — Regenerate removal (commit `056b61d`)

### ✅ PASS

**Scope compliance — commit `056b61d --stat`:**  
3 files touched: `src/i18n/en.ts`, `src/i18n/it.ts`, `src/screens/AiChatPage.tsx`.  
No file outside scope. `regenState.ts` not modified (intact in diff). ✅

**1. Removed i18n keys — 3 keys removed per language:**  
`en.ts`: `regenerate`, `cancelRegenerate`, `regenCostHint`  
`it.ts`: `regenerate`, `cancelRegenerate`, `regenCostHint`

| Key | grep `src/` for references | Status |
|-----|---------------------------|--------|
| `chat.regenerate` | 0 hits | ✅ Unreferenced — clean removal |
| `chat.cancelRegenerate` | 0 hits | ✅ Unreferenced — clean removal |
| `chat.regenCostHint` | 0 hits | ✅ Unreferenced — clean removal |

**2. Edit i18n independence:**  
Edit uses `chat.edit` key — not any of the 3 removed keys. No collision. ✅

**3. Residual `regenerate` occurrences — classification:**

| File:Line | Text | Classification |
|-----------|------|----------------|
| `src/app/AppShell.tsx:3489` | `// Refuse model switch while edit/regenerate owns the turn.` | (a) Comment — still valid; edit flow owns the turn via `regenInFlightRef` |
| `src/i18n/en.ts:271,279` | `tightNow: "Memory low — regenerate not supported, free"` | (a) `model.tightNow` — model selection memory gate, unrelated to chat Regenerate UI action |
| `src/i18n/en.ts:514` | `regenFailed: "Regenerate failed"` | (a) Used by `editMessage` (line 3054–3139) and `handleSend` (line 1868, 2103, 2120, 2158, 2303, 2502, 2532) |
| `src/i18n/it.ts:511` | `regenFailed: "Rigenera fallita"` | (a) Italian counterpart of above |
| `src/i18n/en.ts:510` | `regenBusy: "Already regenerating"` | (a) Used by `editMessage` (line 3034) and `handleSend` (line 2064) and `AppShell` (line 3491) |
| `src/i18n/it.ts:507` | `regenBusy: "Rigenera già in corso"` | (a) Italian counterpart |
| `src/engine/regenState.ts:3,6` | Comments about regenerate/edit | (a) Module docs — describes shared infrastructure |
| `src/screens/AiChatPage.tsx` (many lines) | `regenInFlightRef`, `regenAbortRef`, `regenGenerationRef`, `regenHandleSendPassRef` | (a) Shared concurrency infrastructure consumed by `editMessage` and `handleSend` |

**Zero (b) dangling references.** ✅

**4. Modal More — post-A3 content, row by row:**

| Row | Icon | Label | Condition | File:Line |
|-----|------|-------|-----------|-----------|
| 1 | Copy icon | `t("common.copy")` | Always | `AiChatPage.tsx:4045` |
| 2 | ClipboardList | `t("notes.saveToNotes")` | `onSaveToNotes` present | `AiChatPage.tsx:4064` |
| 3 | Languages | `t("translate.title")` | Always | `AiChatPage.tsx:4074` |
| 4 | Volume2 | `t("voice.readAloud")` / `t("voice.stopReading")` | `role === "assistant"` | `AiChatPage.tsx:4082` |
| 5 | SquarePen | `t("chat.edit")` | `role === "user" && !sending` | `AiChatPage.tsx:4101` |
| 6 | X | `t("common.cancel")` | Always | `AiChatPage.tsx:4112` |

Regenerate row: **gone**. Spec matches. ✅

**5. Chip row — post-A3:**

**Assistant messages** (`AiChatPage.tsx:5144–5168`):
- Copy (`AiChatPage.tsx:5144`)
- Read Aloud (`AiChatPage.tsx:5151`, conditional on `onSpeak`)
- More (`AiChatPage.tsx:5166`)

Regenerate chip: **gone**. ✅

**User messages** (`AiChatPage.tsx:4976–4991`):
- Copy (`AiChatPage.tsx:4976`, conditional on `hasText`)
- More (`AiChatPage.tsx:4983`)

Spec matches. ✅

**6. Threading props:**

`ChatMessageRowProps` (`AiChatPage.tsx:4782`): No `onRegenerate` prop. ✅  
`chatMessageRowPropsEqual` (`AiChatPage.tsx:4816`): No `onRegenerate` comparison. ✅  
`ChatMessageRow` destructuring (`AiChatPage.tsx:4852`): No `onRegenerate`. ✅  
AiChatPage render: `onRegenerate={onRegenerateStable}` removed from both assistant/user rows. ✅

**7. TypeScript:** `npx tsc --noEmit` → **exit code 0**. ✅

**8. Regression — regenInFlightRef/regenAbortRef consumption:**

Both refs consumed **only** by:
- `editMessage` (lines 3023–3149) — the edit-then-generate flow
- `handleSend` (lines ~1925–2582) — the core send path
- `clearChat` (lines 1686–1691, 2960–2967) — teardown

No standalone regenerate caller remains. ✅

---

## VERDETTO 2: A5-fix — stale rgba purge (commit `dbbc75b`)

### ✅ PASS

**1. Commit `dbbc75b --stat`:**  
3 files, 12 insertions, 12 deletions. Exact match to claim. ✅

**Line-by-line verification:**

| # | File | Line | Old | New | Alpha |
|---|------|------|-----|-----|-------|
| 1 | `createStyles.ts` | 2061 | `rgba(232, 238, 231, 0.46)` | `rgba(232, 234, 231, 0.46)` | 0.46 ✅ |
| 2 | `createStyles.ts` | 2274 | `rgba(232, 238, 231, 0.46)` | `rgba(232, 234, 231, 0.46)` | 0.46 ✅ |
| 3 | `createStyles.ts` | 2730 | `rgba(232,238,231,0.30)` | `rgba(232,234,231,0.30)` | 0.30 ✅ |
| 4 | `createStyles.ts` | 3136 | `rgba(232, 238, 231, 0.46)` | `rgba(232, 234, 231, 0.46)` | 0.46 ✅ |
| 5 | `createStyles.ts` | 3288 | `rgba(232,238,231,0.46)` | `rgba(232,234,231,0.46)` | 0.46 ✅ |
| 6 | `createStyles.ts` | 3346 | `rgba(232,238,231,0.28)` | `rgba(232,234,231,0.28)` | 0.28 ✅ |
| 7 | `createStyles.ts` | 3833 | `rgba(232, 238, 231, 0.46)` | `rgba(232, 234, 231, 0.46)` | 0.46 ✅ |
| 8 | `createStyles.ts` | 3906 | `rgba(232, 238, 231, 0.42)` | `rgba(232, 234, 231, 0.42)` | 0.42 ✅ |
| 9 | `glass.ts` | 5 | `rgba(232, 238, 231, 0.62)` | `rgba(232, 234, 231, 0.62)` | 0.62 ✅ |
| 10 | `glass.ts` | 6 | `rgba(232, 238, 231, 0.18)` | `rgba(232, 234, 231, 0.18)` | 0.18 ✅ |
| 11 | `glass.ts` | 8 | `rgba(232, 238, 231, 0.12)` | `rgba(232, 234, 231, 0.12)` | 0.12 ✅ |
| 12 | `palettes.js` | 71 | `rgba(232, 238, 231, 0.92)` | `rgba(232, 234, 231, 0.92)` | 0.92 ✅ |

Only R/G changed (238→234). Blue channel (231) and all alpha values identical. No other rgba values modified. ✅

**2. Residual old pattern:**

- `grep -rn 'rgba(232, 238, 231' src/` → **0 hits** ✅
- `grep -rn 'rgba(232,238,231' src/` → **0 hits** ✅
- `grep -rn -i '#E8EEE7' src/` → **0 hits** ✅

**3. File paths verified:** `createStyles.ts`, `glass.ts`, `palettes.js` — all under `src/theme/`. ✅

**4. TypeScript:** `npx tsc --noEmit` → **exit code 0**. ✅

---

## Summary

| Commit | Claim | Verdict | Findings |
|--------|-------|---------|----------|
| `056b61d` (A3) | Regenerate UI + callbacks + 3 i18n keys removed; regenState intact; no dangling refs | **PASS** | 0 findings |
| `dbbc75b` (A5-fix) | 12 rgba substitutions, 238→234 only, alphas preserved | **PASS** | 0 findings |

**Total findings: 0**
