# Digest-share audit — `84f6195`

Scope: pushed commit only. Existing worktree edits were not touched.

## Verdict: FIX

## CONFIRMED

- **P1 — `lastSuccessfulSessionSave` is an unbounded false-positive latch.**

  > `src/engine/LlamaService.ts:2261-2265`  
  > `({ kvHoldsChatSession, lastChatNPast, chatKvDiskCurrent } = chatKvHoldAfterNativeClear());

  The helper clears the raw hold, `nPast`, and disk-current state, but not
  `lastSuccessfulSessionSave`. The only assignment is the successful-save path:

  > `src/engine/LlamaService.ts:2567-2571`  
  > `lastSuccessfulSessionSave = rememberSuccessfulSessionSave(..., true);`

  `dispose`, utility `clearCache`, failed extract restore, and session invalidation
  therefore leave a positive old token count alive. AppShell then does:

  > `src/app/AppShell.tsx:5305-5316`  
  > `lastSaveTokens: chatKvLastSaveTokens()`  
  > `const hasDigest = windowHasDigest({ retrievalOn, kvHeld });`

  With `retrievalOn=true`, stale tokens force `kvHeld=true` and `hasDigest=false`.
  This answers the t10 question: it will **not** “still have digest” after a real
  clear. Do not clear on every observed hold drop—that would regress the transient
  t10 false-negative case. Add a known-empty invalidation/generation, and bind the
  hint to engine + conversation identity.

- **P1 — stale hint can resurrect an old assemble boundary after extract/utility clear.**

  > `src/engine/LlamaService.ts:4566-4570`  
  > `kvHoldsChatSession = restored;`  
  > `if (!restored) { lastChatNPast = undefined; ... }`

  The failed-restore branch does not invalidate `lastSuccessfulSessionSave`; the
  new `getLoadedAssembleBoundary` ORs that hint at `1187-1197`. If the conversation
  identity still matches, AppShell can receive the old `loadedB` and assemble from
  it despite no restored native KV. That is a correctness/context-loss path, not
  merely telemetry drift.

- **CONFIRMED test gap.** The added 20 tests exercise pure helper inputs only:

  > `src/engine/windowKvInvariant.test.ts:272-335`

  There is no AppShell test, no save→clear→send lifecycle, no failed extract restore,
  no cross-conversation/generation case, and no assertion that `hasDigest` reaches
  `resolveWindowProfile` correctly.

- **CONFIRMED observability gap.**

  > `src/app/AppShell.tsx:5385-5391`  
  > `nPast: nPast ?? 0`

  `undefined` and an actual zero become indistinguishable, and the log omits
  `lastSaveTokens` and context mode. `KALSA_WINDOW` cannot prove whether the fix
  was activated or whether a stale save hint caused the decision.

## REFUTED

- **Extract save overwriting `usedTokens` with 192:** not directly supported by this
  code. Extract’s checkpoint save discards the return value:

  > `src/engine/LlamaService.ts:4316-4325`  
  > `await engine.saveSession(nativeSessionPath(destPath));`

  The fingerprint is assigned only by ordinary `saveEngineSession` at `2567-2571`.
  Extract restore updates `lastChatNPast`, not the fingerprint (`4357-4363`). A
  later ordinary save could of course replace it with its own native token count.

- **KALSA_WINDOW content/log injection:** no direct finding. Its emitted object is
  fixed to booleans, numbers, and null; no user text, IDs, or paths are interpolated.

## PLAUSIBLE

- **Low-grade privacy exposure:** the always-on `console.log` leaks approximate
  prompt/history size and KV footprint to local logs/logcat (`textEst`, `nPast`,
  `loadedB`, `legacyWindowStart`). This is not network exfiltration or content leak,
  but it is metadata exposure for any log collector. Gate it or document it if
  release logs are not strictly local.
