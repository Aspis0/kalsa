# C6c — F-5 Fix Report · commit `d5008e3` on `feat/moe-stream`

**Date:** 2026-09-06 · **Parent audit:** `C6C-AUDIT-DEEPSEEK.md` (F-5).

## Verify

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit **0** ✓ |
| Test (targeted) | `npx jest src/agent/createMiniappTool.test.ts` | **42 passed** ✓ (39 + 3 F-5) |
| Test (full) | `npx jest` | 49 suites, **490 passed** ✓ |

## What F-5 was

Builders capped *counts* (8 questions, 12 steps, 50 rows…) but not *bytes*. `normalizeMiniappBlock` (`askAssistant.js`) turns any block whose `JSON.stringify` > 64 KiB into `{type:"unknown"}` — yet the tool still reported success. Silent ugly degrade.

## Fix

**Per-field cap** (`MAX_SLOT_CHARS = 4000`) in `miniappBuilders.ts`, applied via new `asStringCapped` / `asStringArrayCapped` helpers (exported). Used by required string paths in both builder files:
- `miniappBuilders.ts`: `buildCompareData` columns (`asStringArrayCapped`), `buildQuickCalculator` formula (`asStringCapped`).
- `miniappBuildersNew.ts`: quiz `question` + `options`, kpi `label`, checklist step titles (incl. plain-string steps), `pros_cons` pro/con.

Empty-after-trim → null (as before); over-cap required field → whole build returns `null` (executor surfaces `invalid_slots`, loud).

**Serialized guard** (`MAX_BLOCK_JSON_BYTES = 64 * 1024`) duplicated from `askAssistant.js` (not exported) with a one-line sync comment. `oversizedBuilt()` in `buildMiniappV1` rejects the whole miniapp if any block **or** the full envelope exceeds the cap — the same cap the normalizer degrades past. Backstop for single blocks that can't be caught per-field (e.g. `pros_cons`'s one `data_table` block).

## Tests added

- `F-5: a single oversized required field rejects the whole build` — 5000-char quiz question / checklist step rejected; normal step builds.
- `F-5: a single block exceeding 64 KiB is rejected, not silently degraded` — `pros_cons` ~12 rows × 4000-char fields (~94 KiB single block) rejected.
- `F-5: a normal-sized checklist still builds`.

**Regression proof:** disabling the guard made the 64 KiB test fail (test is meaningful, guard is what rejects).

## Commit

`d5008e3` (`fix(miniapp): C6c — F5 slot/block size caps reject oversized`) — 3 files, +90/−10. **Not pushed.**

Leftovers: none deferred — F-5 fully shipped. Untracked build/audit artifacts left out of the commit.