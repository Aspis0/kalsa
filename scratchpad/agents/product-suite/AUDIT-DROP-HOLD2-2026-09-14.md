# AUDIT-DROP-HOLD2 — `32dfe3c`

Reviewer: gpt-5.6-luna  
Writer under review: grok-4.6  
Scope: read-only source audit. No G2/Jelly/device claim.

## Verdict: FIX

## CONFIRMED

- **P1 — The “only after clear/release” invariant is still false.** Source grep still finds:

  > `src/engine/LlamaService.ts:2068` — `dropChatKvHold(true);`  
  > `src/engine/LlamaService.ts:2266` — `dropChatKvHold(true);`

  Disposal nulls JS state before native release (`2042–2044`), drops `true` at `2068`, and has branches that return with the native context explicitly leaked (`2130–2132`). `release()` is later (`2165–2167`). This is an unproven native-empty transition.

- **P1 — `contextReleased: !context` is not proof of release.** Extract uses it at `4598–4610`; disposal sets `context = null` before stopping/releasing the captured native handle (`2042–2044`). An in-flight extract can therefore drop `true` while the old handle is detached but not released.

  > `dropChatKvHold(nativeEmptyForHoldDrop({ contextReleased: !context }));`

- **P1 — `clearCacheSucceeded` is an optimistic promise result, not a native postcondition.** `tryClearNativeChatKv` returns `true` whenever `await engine.clearCache()` resolves (`2289–2294`). The native implementation silently returns when its internal context or memory is null (`node_modules/llama.rn/cpp/rn-llama.cpp:1134–1143`), while the JSI wrapper always resolves `undefined` after calling it (`node_modules/llama.rn/cpp/jsi/RNLlamaJSI.cpp:2317–2322`). The new paths can still erase the fingerprint after a no-op clear.

  > `await engine.clearCache();`  
  > `return true;`

- **P1 — Load misses still skip cleanup when the entry flag is already false.** `tryLoadEngineSession` snapshots `heldChatKvAtEntry` (`2666`), early `no_file` returns without touching native (`2737–2739`), and `finally` retries only when that flag was true (`2865–2869`). A t10 flag-only drop can leave native KV resident with `kvHoldsChatSession=false`; switching to a chat with no session then performs no clear. The old fingerprint is identity-filtered out after the conversation bind, so the next send can see `hasDigest=true` despite stale native KV.

  > `if (heldChatKvAtEntry) { await dropHoldAfterOptionalNativeClear(context); }`

- **P2 — Tests do not exercise the production latch.** The 34 added tests cover pure reducers only (`sessionPersistence.test.ts:441–507`); there is no mocked `LlamaService`/AppShell test for native load returning zero, clear rejection/no-op, disposal-before-release, or the invalidation/switch sequence.

- **P2 — Contract documentation is stale.** `sessionPersistence.ts:688–691` still says “overwrite utility completion returned” proves native KV is gone, contradicting the new predicate at `708–719`.

## PLAUSIBLE

- **P1 — Failed extract restore keeps a possibly invalid fingerprint.** Restore failure routes through `dropHoldAfterOptionalNativeClear` (`4598–4603`); if clear fails, `drop(false)` preserves `lastSuccessfulSessionSave` (`722–730`). The extract completion may already have replaced native chat KV. AppShell then treats the old save count as live (`5305–5317`), suppressing digest and retaining the old boundary. This is conservative for t10, but not evidence that the current native state is chat KV.

- **P1 — Invalidation can clear the wrong live conversation.** `wasActive` is captured before queueing (`2907`), but the queued job clears whatever `context` is current (`2910`). A rapid switch/delete while the FIFO is busy can clear the new chat; the current drop-hold path makes that side effect native rather than bookkeeping-only.

## REFUTED

- **`overwriteCompletionReturned` remains in code:** REFUTED. No matches in `src`; returned extract/utility completions no longer call the drop path.

- **`tokens_loaded:0` still unconditionally claims empty:** REFUTED mechanically. The branch now calls `dropHoldAfterOptionalNativeClear` before deleting the file (`2826–2831`). A successful native clear drops the fingerprint; a rejected clear takes `drop(false)` and keeps it. This is not an integration/device proof that the void native clear actually cleared.

- **Flag-only t10 drop clears the fingerprint:** REFUTED in the pure contract. `lastSaveAfterHoldDrop` returns the previous fingerprint for `false` (`722–730`), and the targeted suite passes.

## Verification

`sessionPersistence`: 34/34, exit 0. Full Jest: 74 suites / 742 tests, exit 0. `npm run typecheck`: exit 0. Source grep for `overwriteCompletionReturned`: no matches.
