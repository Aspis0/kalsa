# AUDIT: S23 t4 KV Wipe Fix — prefix prewarm skip on chat-held KV

**Reviewer Doc (MiMo V2.5)** · 2026-09-13
**Writer**: grok-4.6
**Verdict**: FIX

---

## 1. Security / Secrets

No secrets in log paths. `logPrewarm` emits `{op, reason, hash, ...}` — hash is djb2 (unsigned int), not PII. `markChatKvCleared()` returns `{kvHoldsChatSession: false, lastChatNPast: undefined, chatKvDiskCurrent: false}` — no PII.

**CONFIRMED** — clean.

---

## 2. Privacy — prewarm must not upload

`queueStaticPrefixPrewarm` (L765–877) calls `engine.completion(...)` which is a local llama.rn inference. No network call. `recordPrefillSample` records timing locally. No upload.

**CONFIRMED** — safe.

---

## 3. Bugs — does the skip actually prevent the wipe?

### 3a. The guard

> `LlamaService.ts` L933–936:
> ```
> if (!shouldWipeKvOnPrefixInputChange(kvHoldsChatSession)) {
>   logPrewarm({ op: "skip", reason: "kv_holds_chat" });
>   return;
> }
> ```
> This returns BEFORE `resetPrewarmState()` / `clearCache` / `markChatKvCleared` / `queueStaticPrefixPrewarm`.

> `prefixPrewarm.ts` L152–156:
> ```
> export function shouldWipeKvOnPrefixInputChange(
>   kvHoldsChatSession: boolean,
> ): boolean {
>   return !shouldSkipPrewarmWhenKvHoldsChat(kvHoldsChatSession);
> }
> ```
> `shouldSkipPrewarmWhenKvHoldsChat(true) === true`, so `shouldWipeKvOnPrefixInputChange(true) === false`. Guard fires. **Correct.**

**CONFIRMED** — skip works when `kvHoldsChatSession === true`.

### 3b. Async `getToolChoiceMode().then` — can kvHoldsChatSession change?

> `LlamaService.ts` L925:
> ```
> void getToolChoiceMode().then((toolChoiceMode) => {
> ```

`kvHoldsChatSession` is captured inside the `.then()` callback. It is read at execution time, not at call time. If a send or dispose fires between `notifyStaticPrefixInputs()` and the `.then()`, the value seen is the *current* value at `.then()` execution, not the stale one. This is correct behavior — the guard reads the latest state.

**CONFIRMED** — no stale-read bug.

### 3c. `void withEngineJob(clearCache)` + `void queueStaticPrefixPrewarm` — FIFO or race?

Both are enqueued via `withEngineJob` which chains on `engineJobChain`:

> `LlamaService.ts` L699–712:
> ```
> function withEngineJob<T>(fn: () => Promise<T>): Promise<T> {
>   engineJobPendingCount += 1;
>   const run = engineJobChain.then(
>     () => runEngineJob(fn),
>     () => runEngineJob(fn),
>   );
>   engineJobChain = run.catch(() => undefined);
> ```

FIFO is enforced. `clearCache` runs first, then `queueStaticPrefixPrewarm` prefill runs second. No interleaving within a single `notifyStaticPrefixInputs` call.

**But**: two rapid `notifyStaticPrefixInputs` calls (e.g., locale + webToolsEnabled both change in the same React batch) each call `void getToolChoiceMode().then(...)`. Both `.then()` callbacks read `kvHoldsChatSession` independently. Both call `resetPrewarmState()` + `void withEngineJob(clearCache)` + `void queueStaticPrefixPrewarm(...)`. The `withEngineJob` FIFO serializes the two `clearCache` calls, so no double-wipe. But `resetPrewarmState()` is called *outside* the job, *before* the busy check. See Finding 3d.

### 3d. 🔴 `resetPrewarmState()` called before `busy` check — premature state kill

> `LlamaService.ts` L937–942:
> ```
> const busy = engineJobPendingCount > 0;
> resetPrewarmState();
> if (busy) {
>   logPrewarm({ op: "skip", reason: "in_flight" });
>   return;
> }
> ```

When the engine is busy, we still call `resetPrewarmState()` which does:

> `LlamaService.ts` L740–744:
> ```
> function resetPrewarmState(): void {
>   prewarmGeneration += 1;
>   prewarmPrefixHash = null;
>   prewarmQueuedKey = null;
> }
> ```

This kills any in-flight prewarm (via `prewarmGeneration++`) and nulls the hash, *before* we check if we can actually do anything. If `busy === true`, we skip clearCache but the prewarm state is already destroyed. The next `notifyStaticPrefixInputs` will see `prewarmPrefixHash === null` → won't skip → will re-resolve and re-queue. This is *functionally* recoverable but the generation bump is gratuitous — it kills a prewarm that could still be useful.

**PLAUSIBLE** — not a correctness bug (the prewarm re-queues), but `resetPrewarmState()` should move AFTER the `if (busy)` return, or the busy check should come first. The current code is wasteful and confusing.

### 3e. `markChatKvCleared` race with concurrent dispose

If `notifyStaticPrefixInputs` fires while a dispose is in progress:
- `dispose` sets `kvHoldsChatSession = false` (L1990) then calls `resetPrewarmState()` (L2001).
- `notifyStaticPrefixInputs`'s `.then()` sees `kvHoldsChatSession === false` → proceeds to wipe.
- `dispose` also calls `context.stopCompletion()` and sets `disposing = true`.
- The `void withEngineJob(async () => { if (!context || disposing) return; ... })` guard at L944 catches this.

**CONFIRMED** — dispose race is guarded.

---

## 4. Race: notify skip vs concurrent idle dispose vs send

All three paths check `kvHoldsChatSession` before acting. The flag is mutated synchronously (no await between read and write). The `.then()` callback runs on the microtask queue, so there's no interleaving within a single synchronous block.

Scenario: user sends → `kvHoldsChatSession = true` (L4159) → locale change fires → notify reads `true` → skips. Correct.

Scenario: send completes → `kvHoldsChatSession = false` (L2798) → locale change fires → notify reads `false` → wipes + prewarms. Correct (idle, empty KV).

**CONFIRMED** — no race.

---

## 5. Edge: prefix hash DID change while chat held — next send correctness

When locale/tools change mid-chat:
1. `notifyStaticPrefixInputs` skips (guard fires, `kvHoldsChatSession === true`).
2. `prewarmPrefixHash` stays at the *old* hash (from the last prewarm or turn mark at L4164).
3. User sends → `streamAssistantTurn` computes `turnPrefixHash` (L3381).

> `LlamaService.ts` L3383–3389:
> ```
> if (turnPrefixHash !== prewarmPrefixHash) {
>   logPrewarm({
>     match: false,
>     reason: shouldSkipPrewarmWhenKvHoldsChat(kvHoldsChatSession)
>       ? "kv_holds_chat"
>       : "prefix_miss",
>     prewarm: prewarmPrefixHash,
>     send: turnPrefixHash,
>   });
> }
> ```

The send logs a mismatch but proceeds normally — it just won't prefix-match. After the turn completes (L4164):
> `if (turnPrefixHash) prewarmPrefixHash = turnPrefixHash;`

Now `prewarmPrefixHash` is correct. The next `notifyStaticPrefixInputs` sees matching hash → skips. The next *idle* notify sees null (after dispose) or mismatch → re-prewarms.

**CONFIRMED** — stale prewarmPrefixHash is harmless; the send logs the miss and self-heals.

---

## 6. Test hygiene

### 6a. Harness only tests helpers, not the integration

> `prefixPrewarmHarness.mjs` tests `shouldWipeKvOnPrefixInputChange`, `shouldSkipPrewarmWhenKvHoldsChat`, hash stability, etc.

It does **not** test that `LlamaService.notifyStaticPrefixInputs` calls the guard before `clearCache`. No integration test exists.

**REFUTED** — the claim "harness asserts holds→no wipe" is misleading. The harness asserts the *helper returns false*. It does not assert that *LlamaService respects it*. A mock/patch test that spies on `clearCache` and asserts it's not called when `kvHoldsChatSession=true` is missing.

### 6b. Harness does not restore env

The harness doesn't set or restore `process.env`. `EAGER_PREFIX_PREWARM` is a compile-time `const true` in `ttftFlags.ts` — not env-gated. Not a bug, but noted.

**PLAUSIBLE** — no env restore, but not harmful here.

---

## 7. Removed behavior: idle path still wipes when holds=false

> `LlamaService.ts` L933:
> ```
> if (!shouldWipeKvOnPrefixInputChange(kvHoldsChatSession)) {
> ```

When `kvHoldsChatSession === false`, `shouldWipeKvOnPrefixInputChange` returns `true`, so the wipe proceeds. The idle path (post-send, post-dispose) correctly wipes empty KV and re-prewarms. The fix is scoped to the *chat-held* case only. This is correct — idle empty KV should be re-prewarmed on locale change.

**CONFIRMED** — idle wipe preserved, only chat-held wipe blocked.

---

## 8. Out of scope: `kv_inconsistent` / `pos_max >> n_tokens`

> `sessionPersistence.ts` L618:
> ```
> * Native save-refuse predicate for text (non-mrope): `pos_max+1 != n_tokens`.
> ```
> `sessionKvSaveWouldBeInconsistent` (L628–634) remains live. This fix does not touch it.

**CONFIRMED** — leftover noted. Not introduced by this change.

---

## Findings Summary

| # | Claim | Verdict | Severity |
|---|-------|---------|----------|
| 3a | Skip prevents wipe when kvHoldsChat=true | CONFIRMED | — |
| 3b | Async getToolChoiceMode doesn't cause stale read | CONFIRMED | — |
| 3c | FIFO serializes clearCache + prewarm | CONFIRMED | — |
| 3d | `resetPrewarmState()` called before busy check | PLAUSIBLE | Low (wasteful, not broken) |
| 3e | Dispose race guarded | CONFIRMED | — |
| 4 | No race between notify/dispose/send | CONFIRMED | — |
| 5 | Stale prewarmPrefixHash self-heals | CONFIRMED | — |
| 6a | Harness tests helpers, not LlamaService integration | REFUTED | Medium (test gap) |
| 6b | Harness doesn't restore env | PLAUSIBLE | Negligible |
| 7 | Idle wipe preserved | CONFIRMED | — |
| 8 | kv_inconsistent leftover live | CONFIRMED | Out of scope |

---

## Verdict: FIX

The core logic is correct — the skip guard at L933 fires before `clearCache` when `kvHoldsChatSession === true`. The fix solves S23 t4.

**But ship requires one fix**: `resetPrewarmState()` at L938 must move after the `if (busy)` return. Current placement kills an in-flight prewarm's generation counter and nulls the hash before we even know if we can act. It's functionally recoverable but gratuitously destructive and confusing.

**Also**: add a test that mocks `clearCache` and asserts it's not called when `kvHoldsChatSession === true` through the `notifyStaticPrefixInputs` path. The harness only validates the pure helper.
