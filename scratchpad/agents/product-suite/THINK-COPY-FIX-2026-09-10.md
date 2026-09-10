# THINK-COPY-FIX-2026-09-10

Two independent smallest fixes on `kalsa` @ `1807aad` (origin/main). No commit/push/device/PLAN/ALIVE.

Recon: `THINK-COPY-RECON-2026-09-10.md`. Every quote below re-verified against the tree before editing.

---

## 1) Action-sheet Copy gate was inverted

### Verified in the tree

- Sheet open gate, `src/screens/AiChatPage.tsx` (`openMessageMenu`):
  ```ts
  if (
    streaming ||
    sendingRef.current ||
    translationInFlightRef.current ||
    regenInFlightRef.current ||
    (!text.trim() && !hasAttachments)          // ← line 3251
  ) {
    return;
  }
  ```
  The sheet therefore only opens when `text.trim()` is non-empty **or** the message has attachments.
- Sheet Copy row before the fix (line 4164):
  ```tsx
  {!messageMenu.text.trim() ? (
  ```
  i.e. it rendered only for empty text — unreachable for the text case the sheet actually serves. (Recon quoted 3244–3252 / ~4164; actuals are 3245–3252 and 4164 pre-edit.)
- Inline chips use the correct polarity: `const hasText = !!m.text.trim();` (line 5048) and `{hasText ? (` for the user Copy chip (line 5168). Assistant inline Copy is unconditional.

Recon verdict confirmed: the sheet Copy row is a defect (inverted), not an intentional attachment-only fallback.

### Fix

Extracted the polarity into a pure, node-testable module next to `regenTarget.ts` (the repo's established pattern for pure screen logic), then used it in the sheet:

`src/screens/sheetCopyVisible.ts` (new):
```ts
export function sheetCopyVisible(text: string): boolean {
  return !!text.trim();
}
```

`src/screens/AiChatPage.tsx`:
```diff
-import { canRegen, editedFlagForResend, findRegenTarget } from "./regenTarget";
+import { canRegen, editedFlagForResend, findRegenTarget } from "./regenTarget";
+import { sheetCopyVisible } from "./sheetCopyVisible";
...
-                {!messageMenu.text.trim() ? (
+                {sheetCopyVisible(messageMenu.text) ? (
```

The inline Copy chips are untouched (`message-action-copy` on both the sheet row and the user chip was pre-existing).

`src/screens/sheetCopyVisible.test.ts` (new): 2 cases — non-empty/padded text visible; `""` and whitespace-only hidden.

Note on placement: the request allowed either an inline 3-line helper in `AiChatPage.tsx` or a one-token invert. Jest here is node-env with `testMatch: ["**/*.test.ts"]` and no `tsx` module extension, so a test cannot import `AiChatPage.tsx`. A same-directory `.ts` module matches the `regenTarget.ts` precedent, keeps `AiChatPage` thinner, and makes the tiny test real.

---

## 2) Decode EMA could publish a one-off fast turn

### Verified in the tree

- `src/engine/decodeSpeed.ts:4` — `MIN_ACCEPTED_PREDICTED_TOKENS = 16`.
- `recordDecodeSample` folded any usable sample straight into the EMA and `getDecodeTokPerSec` returned the first one immediately.
- `src/engine/LlamaService.ts:973–975` — interrupted turns are already skipped, so a completed "ciao" with thinking (hundreds of predicted tokens, e.g. 321 in 47s → 6.8 tok/s) still qualifies and can push the EMA over `EXTENDED_THINKING_MIN_DECODE_TOK_PER_SEC = 5`.

Confirms raising `16 → 64` would not filter thinking turns. Owner rule re-read: measure → short; Jelly 3.4 → 512; extended iff EMA ≥ 5.

### Fix (`src/engine/decodeSpeed.ts`)

- Keep recording **every** usable sample into the EMA (unchanged blending, `EMA_ALPHA = 0.3`).
- Track accepted sample count per model.
- Publish nothing until `MIN_SAMPLES_BEFORE_EMA = 3` accepted samples:
  ```ts
  export const MIN_SAMPLES_BEFORE_EMA = 3;

  type DecodeEma = { tokPerSec: number; samples: number };
  const emaByModel = new Map<string, DecodeEma>();   // replaces Map<string, number>

  export function getDecodeTokPerSec(modelId: string): number | null {
    const ema = emaByModel.get(modelId);
    if (!ema || ema.samples < MIN_SAMPLES_BEFORE_EMA) return null;
    return ema.tokPerSec;
  }
  ```
- Rejected samples (below 16 tokens / bad timing) never increment the counter.
- `__resetDecodeSpeedForTests()` clears the same map.

Because `getDecodeTokPerSec` feeds `resolveThinkingParams` (`LlamaService.ts:3020–3026`), a `null` keeps the `default` mode on the short budget until 3 accepted samples exist. `EXTENDED_THINKING_MIN_DECODE_TOK_PER_SEC` is **unchanged at 5**. No per-phone branches added.

Downstream: `LlamaService.ts:4137` (memory-extract timeout) and the `KALSA_THINKING` log will now show `decodeTokPerSec: null` for the first two accepted samples per model instead of the first. That is the intended new semantics.

### Test update (`src/engine/decodeSpeed.test.ts`)

The old first test expected the first 16-token sample to publish (`toBeCloseTo(16)`). Rewritten to the new contract (7 tests total):
1. withholds the EMA until 3 accepted samples (null, null, 16);
2. blends once published (three ×16 → 16; then 32 → 20.8);
3. still rejects sub-16 / bad-timing samples;
4. rejected samples do not count toward the threshold (2 valid + 1 rejected → still null, +1 valid → 16);
5. reset clears all measurements.

---

## Commands and real exit codes

```
$ npx jest src/engine/decodeSpeed.test.ts src/screens/sheetCopyVisible.test.ts
Test Suites: 2 passed, 2 total
Tests:       7 passed, 7 total
EXIT=0

$ npx jest src/engine/thinkingBudgets.test.ts   # downstream decision, extra safety
Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
EXIT=0

$ npx tsc --noEmit
(no output)
EXIT=0
```

## git status (no commit)

```
 M src/engine/decodeSpeed.test.ts
 M src/engine/decodeSpeed.ts
 M src/screens/AiChatPage.tsx
?? src/screens/sheetCopyVisible.ts
?? src/screens/sheetCopyVisible.test.ts
?? archived/docs/AUDIT_HARNESS_GLM.md
?? archived/docs/AUDIT_HARNESS_GLM_REAUDIT.md
?? archived/docs/remeasure-2026-08-25/
?? archived/docs/repo-audit-2026-08-28/
?? device-decode-lineup-out/
?? n3.txt
?? out/
?? results/ciswire-campaign/
```

The `archived/…`, `device-decode-lineup-out/`, `n3.txt`, `out/`, `results/ciswire-campaign/` entries were already untracked before this work; this change touched only the five `src/` files above.

Diffstat: `src/engine/decodeSpeed.test.ts | 29 ++`, `src/engine/decodeSpeed.ts | 38 ++`, `src/screens/AiChatPage.tsx | 3 +-`, plus the two new `src/screens/sheetCopyVisible.*` files.

## Hostile MiMo audit follow-up — SHIP-WITH-FIXES

All must-fixes were scoped to documenting intentional behavior. No logic changed, no new branches, no gating of Notes/Translate, no persistence, no threshold moves.

### F1 — attachment-only empty captions and the sheet Copy row

`openMessageMenu` still allows a sheet with empty text when `hasAttachments` is true (`(!text.trim() && !hasAttachments)` at `AiChatPage.tsx:3251`). That attachment-only case keeps Notes/Translate (and Edit for user turns) — they pre-existed and this diff did not touch them. Copy is the only row that needs text, so the fix added a one-line comment at the row rather than gating anything else:

`src/screens/AiChatPage.tsx` (line 4165):
```tsx
{/* Copy needs text; attachment-only empty captions keep Notes/Translate below. */}
{sheetCopyVisible(messageMenu.text) ? (
```

No change to the Notes/Translate/Edit rows.

### F2 — EMA stays in-memory, cold start is the owner rule

`MIN_SAMPLES_BEFORE_EMA` stays `3`; nothing is persisted. Extended the docs on `emaByModel` and `getDecodeTokPerSec` in `src/engine/decodeSpeed.ts` to state the intended behavior explicitly:

```ts
/**
 * In-memory only: a process restart resets the per-model sample count, so
 * thinking stays on the short budget until 3 accepted samples land again.
 * That cold-start withholding is intentional (owner rule: first measure →
 * short) and is deliberately not persisted.
 */
const emaByModel = new Map<string, DecodeEma>();
```

```ts
/**
 * EMA tokens/s for a model, or null until at least
 * `MIN_SAMPLES_BEFORE_EMA` usable chat samples have been recorded. The count
 * lives in the in-memory map above, so after a process restart this returns
 * null again and extended thinking stays withheld until 3 fresh samples.
 */
export function getDecodeTokPerSec(modelId: string): number | null {
```

### F3 — no `jest.isolateModules`

Not added. The existing `beforeEach(__resetDecodeSpeedForTests)` in `src/engine/decodeSpeed.test.ts` is sufficient and unchanged.

### Re-verification after doc edits

```
$ npx jest src/engine/decodeSpeed.test.ts src/screens/sheetCopyVisible.test.ts
Test Suites: 2 passed, 2 total
Tests:       7 passed, 7 total
EXIT=0

$ npx tsc --noEmit
(no output)
EXIT=0
```

Diffstat after the follow-up: `decodeSpeed.test.ts | 29 ++`, `decodeSpeed.ts | 46 ++`, `AiChatPage.tsx | 4 +-`, plus the two new `sheetCopyVisible.*` files.

## Residual notes

- `message-action-copy` testID is still shared by the sheet row and the user inline chip; pre-existing, out of scope.
- EMA publishes after 3 accepted samples, so on a cold session the first two completed turns always run the short budget. This is the intended conservative default per the owner rule ("first measure → short") and is now documented at the map and the getter; a process restart intentionally re-enters this window.
- Attachment-only empty captions still open the sheet and still expose Notes/Translate; Copy is hidden there by design (documented at the row).
