# AUDIT-DROP-HOLD — `b907290`

## Verdict

**FIX. Do not ship.** The pure reducer tests pass, but the production latch is not closed.

## Findings

### 1. CONFIRMED — `overwriteCompletionReturned` is not proof of an empty/non-chat KV

`src/engine/LlamaService.ts:4766-4775` continues into completion when `clearCache()` returned false. On a returned result it then unconditionally does:

> `dropChatKvHold(nativeEmptyForHoldDrop({ overwriteCompletionReturned: true }));`

before checking timeout/abort at `4807`; the same ordering exists at `4933-4947` and extract at `4580-4589`. A stopped completion is still a returned result: llama.rn loops while `!is_interrupted` (`node_modules/llama.rn/cpp/jsi/RNLlamaJSI.cpp:1291`), then calls `endCompletion()` and returns a result (`1360-1374`), with `interrupted` set in `JSICompletion.h:190`. Native prompt evaluation can also return early after a decode failure (`rn-completion.cpp:1172-1184`) and still reach the JSI return path.

Therefore a clear failure + interrupted/no-op/partial completion can null `lastSuccessfulSessionSave` while old or partial chat KV remains. The next send sees false `kvHeld` and can apply the digest/window decision to a live contaminated context. “Completion promise returned” is not an overwrite/empty postcondition.

### 2. CONFIRMED — load-failure cleanup still bypasses the latch and drops true without proof

The stated “only via `nativeEmptyForHoldDrop`” rule is false:

> `src/engine/LlamaService.ts:2068` — `dropChatKvHold(true);`
>
> `src/engine/LlamaService.ts:2266` — `dropChatKvHold(true);`

More importantly, `markChatKvCleared()` is called on failed session load at `2829` and `2857`. Its `finally` first attempts `context.clearCache()` at `2866-2869`, explicitly catches failure at `2869-2871`, then calls `markChatKvCleared()` unconditionally at `2876`. A failed/zero/partial load can therefore erase the fingerprint even when native clear failed or was never attempted. This directly violates the t10 safety premise.

### 3. CONFIRMED — failed extract restore preserves a fingerprint for state it no longer knows

The extract path documents that completion mutates the native context (`src/engine/LlamaService.ts:4429-4434`). If restore fails, it calls `dropHoldAfterOptionalNativeClear` (`4613-4616`). When that clear fails, `dropChatKvHold(false)` deliberately preserves the old fingerprint (`2275-2282`), and AppShell treats that fingerprint as live KV (`AppShell.tsx:5305-5317`). After extract has already changed native state, “last successful save” is not evidence that the current native state is that save. This is a conditional corruption path, not a harmless flag-only drop.

### 4. PLAUSIBLE — invalidation can clear the wrong active conversation

`invalidateEngineSession` captures `conv` before enqueueing (`2890`) but clears the context later (`2893-2899`). `invalidateConversationSessions` captures `wasActive` before enqueueing (`2914`) and later clears whichever context is current (`2915-2918`). `withEngineJob` can wait behind another job (`713-729`), while `bindActiveConversation` changes the global session at `AppShell.tsx:1005-1013`. A rapid switch/delete can therefore clear the newly active chat while deleting the old chat’s files. The commit increases the blast radius because invalidation now performs native `clearCache()`.

## Claim check

- `dropChatKvHold(true)` only through the predicate: **REFUTED**; direct true calls and failed-load paths remain.
- Invalidation uses the clear-then-drop helper: **CONFIRMED mechanically**, but identity is not rechecked inside the queued job.
- Failed extract restore no longer drops true without clear: **CONFIRMED for that branch**, but the retained fingerprint is not trustworthy after extract mutated native state.
- Flag-only `drop(false)` keeps the fingerprint: **CONFIRMED in the pure reducer** (`sessionPersistence.test.ts:459-470`), **REFUTED as a global invariant** because the call sites above still drop true incorrectly.
- `engine !== context` false-negative leaves the fingerprint forever: **REFUTED under the current lifecycle**. `disposeEngineLocked` nulls `context` at `2044` and immediately drops true at `2068` before release. A same-context clear failure is different: false retention has no expiry/retry and persists until a later proven-empty path (**PLAUSIBLE operational risk**, though consistent with t10’s fail-closed intent).

## Verification

`npm run typecheck`: EXIT 0. Local Jest: 74/74 suites, 740/740 tests; targeted persistence test 32/32. The added tests exercise only the pure boolean/reducer contract (`sessionPersistence.test.ts:441-496`); they do not execute `LlamaService` call sites, interrupted native results, failed restore, or invalidation races. No source files were changed.
