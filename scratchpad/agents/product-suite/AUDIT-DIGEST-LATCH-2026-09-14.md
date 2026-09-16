# AUDIT-DIGEST-LATCH-2026-09-14

Reviewer: gpt-5.6-luna  
Writer under review: grok-4.6  
Commit: `94dd4e5`  
Scope: read-only source audit; no native/device claim.

## Verdict: FIX

## CONFIRMED

- **P1 — Invalidation is bookkeeping, not native-empty.** The new helper clears JS state:

  > `src/engine/LlamaService.ts:2274-2286`
  > ```ts
  > if (nativeEmpty) {
  >   ({ ..., lastSuccessfulSessionSave } = chatKvHoldAfterNativeClear());
  > }
  > ```

  But both invalidators only call that bookkeeping and delete files; neither calls
  `context.clearCache()`:

  > `src/engine/LlamaService.ts:2867-2877, 2890-2894`
  > ```ts
  > if (activeModelId === modelId) markChatKvCleared();
  > await deleteSessionsForModelConversation(modelId, conv);
  > // ...
  > if (wasActive) dropChatKvHold(true);
  > await deleteSessionsForConversation(conversationId);
  > ```

  Active deletion immediately binds the new conversation and starts restore:

  > `src/app/AppShell.tsx:2409-2414`
  > ```ts
  > void invalidateConversationSessions(id);
  > bindActiveConversation(next.activeId);
  > if (modelId) void restoreEngineSession(modelId);
  > ```

  A restore miss then skips native clear when the entry flag was already dropped
  (`LlamaService.ts:2642`, `2841-2848`). The old native context can remain while
  `kvHoldsChatSession`, `nPast`, and the fingerprint are all gone; AppShell then
  computes `hasDigest=true` (`AppShell.tsx:5305-5317`). This is the exact unsafe
  false-negative the latch was meant to prevent.

- **P1 — Failed extract restore is treated as proof of emptiness.** `restoreNativeSession`
  returns false after `loadSession` failure/zero tokens and performs no clear:

  > `src/engine/LlamaService.ts:4380-4392`
  > ```ts
  > const result = await engine.loadSession(srcPath);
  > const ok = sessionLoadHasTokens(result);
  > return ok;
  > ```

  The path is installed before the extract completion, so an abort can happen
  before any overwrite (`LlamaService.ts:4494-4513, 4536-4549`). The finally block
  still does `dropChatKvHold(true)` on restore failure (`LlamaService.ts:4591-4602`).
  That nulls the hint without proving the native context is empty. The stale-native
  consequence is **PLAUSIBLE**, but the incorrect state transition is confirmed.

- **P1 — Utility clear failure is converted to `nativeEmpty=true` before the utility runs.**
  On `clearCache()` rejection, `nativeEmpty` remains false, but every non-abort path
  unconditionally calls `dropChatKvHold(true)` before `refreshGovernorBeforeCompletion`
  and `completion()`:

  > `src/engine/LlamaService.ts:4743-4756`
  > ```ts
  > let nativeEmpty = false;
  > try { await engine.clearCache(); nativeEmpty = true; } catch {}
  > if (aborted || signal?.aborted) dropChatKvHold(nativeEmpty);
  > // Utility completion overwrites chat KV.
  > dropChatKvHold(true);
  > ```

  The same ordering exists in extract and `completeOnce` (`4517-4529`,
  `4860-4874`). If the utility completion/refresh throws or never mutates native
  state, the old chat KV can still be present but its only surviving hint is gone.
  Defer irreversible invalidation until a successful overwrite/clear, or retain an
  explicit unknown/conservative state.

- **P2 — The latch wiring is untested.** The added tests exercise pure return values
  (`sessionPersistence.test.ts:373-422`, `windowKvInvariant.test.ts:272-335`).
  `dropChatKvHold` is private; there is no save→clear→send test, no invalidation
  test, no failed-restore test, and no mocked `LlamaService`/`AppShell` integration
  test. The `false` branch itself is not tested even though it is the t10 contract.

## PLAUSIBLE

- **P2 — Identity check is weaker than the session identity.** `SessionSaveFingerprint`
  carries `stem` (`model + conversation + prompt-env`; `sessionKey.ts:1-6, 37-47`),
  but `lastSaveTokensForHint` validates only `engineBuild` and `conversationId`
  (`sessionPersistence.ts:148-169`). `engineBuild` is build-wide, not a context/model
  identity. A leftover fingerprint for another model or prompt-env stem can pass if
  the normal clearing path is skipped. The ordinary model-switch path usually calls
  dispose, so impact is residual rather than proven here.

## REFUTED

- **Flag-only drop clears the fingerprint — REFUTED.** The `false` branch ends at
  `chatKvDiskCurrent = false` (`LlamaService.ts:2283-2286`); it does not assign
  `lastSuccessfulSessionSave`.

- **The old explicit-clear latch leak remains — REFUTED at the JS state level.**
  `chatKvHoldAfterNativeClear()` now returns `lastSuccessfulSessionSave: null`
  (`sessionPersistence.ts:692-703`), and `dropChatKvHold(true)` assigns it.
  The invalidation/restore findings above are about falsely claiming native-empty,
  not about a missed null assignment.

- **`KALSA_WINDOW` still serializes missing counts as zero — REFUTED.** Current code
  emits `nPast: nPast ?? null` and `lastSaveTokens: lastSaveTokens ?? null`
  (`AppShell.tsx:5385-5391`).

## Verification

`npm run typecheck`: PASS.  
`npx jest --runInBand --no-coverage --no-cache`: PASS, 74/74 suites and 735/735 tests,
exit 0. These are not native/integration tests and do not close the findings above.
