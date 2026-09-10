# Hostile Audit: sheetCopyVisible + decodeSpeed (DeepSeek-authored)

**Repo:** kalsa @ 1807aad (uncommitted)  
**Auditor:** Different model from writer (DeepSeek)  
**Date:** 2026-09-10  
**Verdict:** SHIP-WITH-FIXES

---

## Q1: Is Copy shown for attachment-only empty caption?

**PLAUSIBLE — Copy is correctly hidden, but the sheet still opens and exposes Translate + Notes on empty text.**

The menu opens because `openMessageMenu` at line 3255 allows it:

> `(!text.trim() && !hasAttachments)`

When `text` is `""` but `hasAttachments` is true, the guard does **not** block. `setMessageMenu({ id, text: "", role })` fires.

At line 4165, `sheetCopyVisible("")` returns `false` — **Copy is hidden.** Correct.

But lines 4191 and 4201 are **not** gated by `sheetCopyVisible`:

> Line 4191: `onSaveToNotes(messageMenu.text);` — saves empty string as a note.  
> Line 4201: `void runTranslate(messageMenu.id, messageMenu.text);` — translates empty string.

If the intent is "no text-dependent actions when text is empty," Notes and Translate should also be gated. If the intent is "attachment-only messages can still be translated/saved-to-notes with empty caption," then this is fine but the asymmetry (Copy hidden, Translate/Notes shown) needs a comment explaining why.

**Verdict: PLAUSIBLE bug — inconsistent gating. Needs a comment or fix.**

---

## Q2: Does withholding EMA for 3 samples reset to short-term thinking after app kill?

**CONFIRMED.**

`emaByModel` is a module-level `Map` with no persistence:

> Line 16: `const emaByModel = new Map<string, DecodeEma>();`

`getDecodeTokPerSec` returns `null` until `samples >= 3`:

> Line 52: `if (!ema || ema.samples < MIN_SAMPLES_BEFORE_EMA) return null;`

On app kill, the in-memory map is gone. After restart, the first 3 decoded turns return `null` from `getDecodeTokPerSec`, which means extended thinking cannot be unlocked. This is by design per the comment at line 8:

> *"a one-off fast turn cannot unlock extended thinking by itself"*

But the restart consequence is not documented. A user who always has extended thinking enabled will experience 3 turns of degraded reasoning after every cold start.

**Verdict: CONFIRMED. Intentional but undocumented restart penalty. Consider persisting the EMA or reducing `MIN_SAMPLES_BEFORE_EMA` to 1 on cold start.**

---

## Q3: Can tests leak EMA across files if `__reset` is missed?

**PLAUSIBLE — no current leak, but fragile.**

`emaByModel` is a module singleton. Jest shares module instances across test files in the same worker (default for `--runInBand`). Currently only `decodeSpeed.test.ts` imports from `decodeSpeed.ts`:

> `grep -rn "decodeSpeed\|recordDecodeSample\|getDecodeTokPerSec" src --include="*.test.ts"` — single file.

The `beforeEach` at line 10 calls `__resetDecodeSpeedForTests()`, so within this file it's safe. But:

- `__resetDecodeSpeedForTests` is exported and documented as test-only (line 55: `/** Test-only: wipe in-memory decode EMAs. */`)
- No other test file currently imports it
- If any future test file imports `recordDecodeSample` without a corresponding `beforeEach` reset, samples leak across files in the same worker

**Verdict: PLAUSIBLE future risk. No current leak. Consider `jest.isolateModules` or a `jest.resetModules` hook in a root `setupFilesAfterSetup` for `decodeSpeed`.**

---

## Additional Findings

### A. `interrupted` skip at LlamaService:973 — no change, correct

> Line 973: `if (!r.interrupted) { recordDecodeSample(model.id, r.tokensPredicted, r.predictedMs); }`

Interrupted turns are still skipped for EMA. This is correct — partial decode speeds would poison the throughput estimate. **No issue.**

### B. EMA blend math is correct

Test at line 28: 3 samples of 16 tok/s, then 1 sample of 32 tok/s → expect 20.8.

> After 3 samples: `tokPerSec = 16`, `samples = 3`  
> 4th sample (32): `0.3 * 32 + 0.7 * 16 = 9.6 + 11.2 = 20.8` ✅

### C. Rejected samples don't inflate count — correct

Test at line 44: 2 good + 1 rejected (15 tokens) + 1 good = 3 counted samples.

> `isUsableSample(15, 1000)` → `15 >= 16` is false → early return, `samples` stays at 2. ✅

### D. `sheetCopyVisible` uses `!!text.trim()` — double-negation is fine

> Line 6: `return !!text.trim();`

`""` → `false`, `"hello"` → `true`, `"  \n  "` → `false`. Semantically clear. The `!!` is idiomatic for boolean coercion. No issue.

### E. Tests use `beforeEach` not `afterEach` for reset — acceptable

Reset before each test is correct here since the module is freshly imported per describe block in default Jest config. Using `afterEach` would also work but `beforeEach` is the standard pattern for stateful singletons.

---

## Summary

| Finding | Verdict | Severity |
|---|---|---|
| Copy hidden for attachment-only empty caption | ✅ Correct | — |
| Sheet opens for attachment-only (Notes/Translate on empty text) | PLAUSIBLE bug | Low |
| EMA resets on app kill (3-turn penalty) | CONFIRMED | Medium |
| Test EMA leak across files | PLAUSIBLE (future risk) | Low |
| `interrupted` skip correctness | ✅ Correct | — |
| EMA blend math | ✅ Correct | — |
| Rejected sample counting | ✅ Correct | — |

**Verdict: SHIP-WITH-FIXES** — gate Notes/Translate behind the same check as Copy, or add a comment explaining why they're exempt. Document the restart EMA penalty. No blocking issues.
