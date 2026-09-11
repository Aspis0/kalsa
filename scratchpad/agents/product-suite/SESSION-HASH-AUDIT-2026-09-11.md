# SESSION-HASH-AUDIT — 2026-09-11

**Auditor:** MiMo (hostile pass)
**Target:** grok-4.6 diff — session hash unification (F6)
**Files:** `src/app/AppShell.tsx`, `src/engine/LlamaService.ts`, `src/engine/sessionKey.ts`, `src/engine/sessionPool.ts`, `sessionKey.test.ts`, `sessionPool.test.ts`, `memoryPrompt.test.ts`
**Intent:** load-time prompt-env hash must match streamAssistantTurn save hash (F6). `promptEnvToolHashFields` shared. Save must not log `ok:true` if keepStem missing after evictSessionPool. KALSA_SESSION includes stem.

---

## 1. SECURITY / SECRETS

### 1a. Stem logged in KALSA_SESSION — PII assessment

**PLAUSIBLE** (low severity)

The stem is logged at save and load success:

`src/engine/LlamaService.ts:2176` — save:
```js
...(logStem ? { stem: logStem } : {}),
```

`src/engine/LlamaService.ts:2443` — load:
```js
...(logStem ? { stem: logStem } : {}),
```

Stem is `${model}__${conversationId}__${envHash}`. The `modelId` is a sanitized GGUF filename (e.g. `qwen3_002e5-4b`). The `conversationId` comes from the conversations system (`meta.id`) — opaque UUID, not user-authored text. The `envHash` is a djb2 digest.

**Verdict: REFUTED for PII.** Conversation IDs are opaque UUIDs. Model IDs are file names. No user content leaks through the stem.

### 1b. No hardcoded secrets in the new code

**CONFIRMED.** No API keys, tokens, or credentials in the diff. The `sessionKey.ts` and `sessionPool.ts` additions are pure utility functions.

---

## 2. PRIVACY

No new user data collection. The `promptEnvToolHashFields` function only processes tool names (function names from the tool registry, not user queries). Facts are excluded from the env hash when `MEMORY_FACTS_ON_USER_TAIL` is true.

`src/app/AppShell.tsx:357-362`:
```js
if (!MEMORY_FACTS_ON_USER_TAIL) {
  try {
    const enabled = await MemoryStore.getEnabled();
```

**CONFIRMED.** No privacy regression.

---

## 3. BUGS

### 3a. CRITICAL — `promptEnvToolHashFields` fix: load path now matches save path

**CONFIRMED (fix is correct).**

Old AppShell load path hardcoded `hasTools: true`:
```js
// OLD (removed by diff):
let sessionPromptEnvHash = computePromptEnvHash(
  locale,
  [],
  true,   // ← hardcoded, diverged from save when toolChoiceMode = "none"
  toolNames,
  blockFormat,
);
```

New AppShell load path via `computeSessionPromptEnvHash`:
`src/app/AppShell.tsx:351-355`:
```js
const hashed = promptEnvToolHashFields({
  toolsWired: Boolean(toolNames.length && args.executeTool),
  toolCallingEnabled: shouldUseToolCalling(await getToolChoiceMode()),
  toolNames,
});
```

LlamaService save path:
`src/engine/LlamaService.ts:3126-3131`:
```js
const hashedTools = promptEnvToolHashFields({
  toolsWired: hasTools,
  toolCallingEnabled,
  toolNames,
});
```

Both pass through the same `promptEnvToolHashFields`:
`src/engine/sessionKey.ts:68-77`:
```js
export function promptEnvToolHashFields(args: {
  toolsWired: boolean;
  toolCallingEnabled: boolean;
  toolNames: readonly string[];
}): { hasTools: boolean; toolNames: readonly string[] } {
  return {
    hasTools: args.toolsWired && args.toolCallingEnabled,
    toolNames: args.toolCallingEnabled ? args.toolNames : [],
  };
}
```

Both paths call `shouldUseToolCalling(getToolChoiceMode())`. The hash inputs are now structurally identical.

**CONFIRMED.** The fix eliminates the old `hasTools: true` hardcode divergence.

### 3b. `blockFormat` — load vs save divergence check

**REFUTED.** Both paths call `getBlockFormat()` from the same bench config singleton:

`src/app/AppShell.tsx:3825`:
```js
const blockFormat = await getBlockFormat();
```

`src/engine/LlamaService.ts:3022`:
```js
const blockFormat = await getBlockFormat();
```

`computePromptEnvHash` includes `blockFormat` in its JSON digest:
`src/engine/sessionPersistence.ts:387`:
```js
blockFormat: typeof blockFormat === "string" ? blockFormat : "",
```

Same function, same input source. No divergence.

### 3c. `executeTool` presence at load vs send

**REFUTED.** Load path passes `agentOptions.executeTool` to `computeSessionPromptEnvHash`:
`src/app/AppShell.tsx:3829`:
```js
executeTool: agentOptions.executeTool,
```

Save path uses `options?.executeTool`:
`src/engine/LlamaService.ts:3091`:
```js
const hasTools = Boolean(options?.tools?.length && options?.executeTool);
```

Both flow through `toolsWired: Boolean(tools.length && executeTool)` in `promptEnvToolHashFields`. Same semantic.

---

## 4. RACES

### 4a. `getToolChoiceMode()` at load vs turn

**PLAUSIBLE (design-level, not a bug).**

Load path:
`src/app/AppShell.tsx:353`:
```js
toolCallingEnabled: shouldUseToolCalling(await getToolChoiceMode()),
```

Save path:
`src/engine/LlamaService.ts:3023-3024`:
```js
const toolChoiceMode = await getToolChoiceMode();
const toolCallingEnabled = shouldUseToolCalling(toolChoiceMode);
```

Both are `async` reads from `AsyncStorage`. If the user toggles tool calling between the load and the turn, the hashes will differ. The stored `promptEnvHash` won't match the freshly computed one, causing a cold start.

**This is the intended behavior** — tool calling mode change *should* invalidate the KV prefix. The system prompt differs between `hasTools=true` and `hasTools=false`:
`src/engine/LlamaService.ts:3185`:
```js
hasTools && toolCallingEnabled,
```

**Verdict: PLAUSIBLE** — not a bug, but the window exists. The test does not cover this scenario (see §7).

### 4b. `saveEngineSession` reads `lastPromptEnvHash` — stale value race?

**REFUTED.** `saveEngineSession` is wrapped in `withLifecycleLock(() => withEngineJob(...))`:
`src/engine/LlamaService.ts:2155-2157`:
```js
return withLifecycleLock(() =>
withEngineJob(async () => {
```

`streamAssistantTurn` sets `lastPromptEnvHash` under the same job chain. `saveEngineSession` is always called after the turn completes, so it reads the value the turn wrote. No stale read.

---

## 5. LEAKS

No memory leaks introduced. The new functions are stateless. `logStem` is a local variable scoped to the save/load closures.

---

## 6. EDGE CASES

### 6a. Evict ordering: `chatKvDiskCurrent` set after `sessionSaveOkAfterEvict` check

**CONFIRMED (correct ordering).**

`src/engine/LlamaService.ts:2368-2378`:
```js
await touchSessionUse(stem);
const budgetBytes = await readSessionPoolBudgetBytes();
await evictSessionPool(stem, budgetBytes);
await deleteLegacyModelSession(modelId);
if (!sessionSaveOkAfterEvict(await sessionFileExists(stem))) {
  log(false, { reason: "evicted" });
  return false;
}
chatKvDiskCurrent = true;
```

Sequence: touch → evict → verify keep file exists → set `chatKvDiskCurrent`. If eviction deletes the keep file, the function returns `false` before setting `chatKvDiskCurrent = true`. Correct.

**CONFIRMED.** The guard works.

### 6b. Early save returns logging `ok` without stem

**REFUTED.** All early returns in `saveEngineSession` log `log(false, ...)`:

`src/engine/LlamaService.ts:2197`:
```js
log(false, { reason: gate.reason ?? "no_context" });
```

`src/engine/LlamaService.ts:2203`:
```js
log(false, { reason: "no_context" });
```

`src/engine/LlamaService.ts:2211`:
```js
log(false, { reason: "no_session_key" });
```

`src/engine/LlamaService.ts:2213`:
```js
log(false, { reason: "session_identity_unavailable" });
```

`logStem` is set at line 2211 *before* any `log(true, ...)` call. The only `log(true, ...)` call is at the end of the function, after `logStem = stem`. No early return logs `ok:true`.

**REFUTED.** No premature success logging.

### 6c. `sessionSaveOkAfterEvict` — trivial pass-through?

**CONFIRMED (trivial).**

`src/engine/sessionPool.ts:114-116`:
```js
export function sessionSaveOkAfterEvict(keepFileExists: boolean): boolean {
  return keepFileExists;
}
```

This is a direct identity function. It exists solely for testability — the test at `src/engine/sessionPool.test.ts:62-65` verifies the contract:
```js
expect(sessionSaveOkAfterEvict(true)).toBe(true);
expect(sessionSaveOkAfterEvict(false)).toBe(false);
```

**PLAUSIBLE** — debatable whether extracting this into a named function adds value. It does make the save path's intent explicit at the call site (`sessionSaveOkAfterEvict(await sessionFileExists(stem))`), but the test is meaningless.

### 6d. `loadStem` vs `stem` divergence — legacy fallback touch asymmetry

**PLAUSIBLE (low severity).**

`src/engine/LlamaService.ts:2505-2506`:
```js
loadStem = legacy;
logStem = legacy;
```

`src/engine/LlamaService.ts:2612-2613`:
```js
await touchSessionUse(stem);
if (loadStem !== stem) await touchSessionUse(loadStem);
```

When the legacy fallback fires, `loadStem` is the legacy stem (no env hash), `stem` is the new-format stem. Both are touched. But the legacy file is loaded (not the new-format one). The new-format stem's `touchSessionUse` is a no-op in practice (no file exists for it), but it writes to AsyncStorage with a key that will never match a real file. Harmless but wasteful.

**Verdict: PLAUSIBLE** — unnecessary AsyncStorage write on legacy fallback.

---

## 7. TEST HYGIENE

### 7a. CRITICAL — `promptEnvToolHashFields` test does not exercise AppShell or LlamaService

**CONFIRMED (coverage gap).**

`src/engine/sessionKey.test.ts:92-135` — the new test:
```js
describe("promptEnvToolHashFields", () => {
  test("load and save hashes match when tools are on", () => {
    const enabled = shouldUseToolCalling("auto");
    const save = promptEnvToolHashFields({
      toolsWired: true,
      toolCallingEnabled: enabled,
      toolNames: names,
    });
    const load = promptEnvToolHashFields({
      toolsWired: Boolean(names.length && true),
      toolCallingEnabled: enabled,
      toolNames: names,
    });
    expect(save).toEqual(load);
```

This tests the **utility function in isolation**. It does NOT test:
1. AppShell's `computeSessionPromptEnvHash` (the actual load path)
2. LlamaService's `streamAssistantTurn` hash computation (the actual save path)
3. The full round-trip: AppShell computes hash → passes to LlamaService → LlamaService saves → next load matches

The test calls `shouldUseToolCalling("auto")` and feeds the result in — it does not verify that `getToolChoiceMode()` at load time and at turn time produce the same value.

**CONFIRMED.** False coverage: the test proves the utility function is correct, not that the integration path is correct.

### 7b. `sessionSaveOkAfterEvict` test — tests a pass-through

**CONFIRMED.**

`src/engine/sessionPool.test.ts:62-65`:
```js
test("cannot report success without the keep file", () => {
  expect(sessionSaveOkAfterEvict(true)).toBe(true);
  expect(sessionSaveOkAfterEvict(false)).toBe(false);
});
```

This tests `return keepFileExists`. The test name implies it tests a safety invariant, but it tests a function that just returns its argument.

**CONFIRMED.** False coverage: the real safety invariant (save path does not set `chatKvDiskCurrent` before the eviction check) is untested.

### 7c. `memoryPrompt.test.ts` — comment-only change, no new test

**CONFIRMED.**

The diff in `memoryPrompt.test.ts` is:
```diff
-    // Call sites that always wire tools still pass the literal true
-    // (AppShell ensureEngine / download path); streamAssistantTurn passes
-    // the live Boolean(tools?.length && executeTool).
+    // AppShell load and streamAssistantTurn save both use promptEnvToolHashFields
+    // so toolChoiceMode none hashes as hasTools false / empty names.
```

No new assertions. No new test functions. Just a comment update reflecting the new architecture. The test itself (`expect(computePromptEnvHash("en", [], true)).not.toBe(...)`) was already present and unchanged.

**CONFIRMED.** No new coverage added.

### 7d. No integration test for load→save→load round-trip

**CONFIRMED.** Zero test files reference `computeSessionPromptEnvHash`, `streamAssistantTurn`, `saveEngineSession`, or `tryLoadEngineSession`. The only test files in the diff are pure function unit tests.

---

## 8. DEAD CODE

### 8a. `promptEnvToolHashFields` — is it used outside the two call sites?

**CONFIRMED (no dead code).** Exactly two call sites:
- `src/app/AppShell.tsx:351` (load path)
- `src/engine/LlamaService.ts:3127` (save path)

Both are live code paths. No dead code.

### 8b. `sessionSaveOkAfterEvict` — is it used outside the save path?

**CONFIRMED (no dead code).** One call site at `src/engine/LlamaService.ts:2373`. Live code.

---

## SUMMARY

| # | Finding | Severity | Verdict |
|---|---------|----------|---------|
| 1a | Stem logged in KALSA_SESSION | Low | **REFUTED** (opaque UUIDs, no PII) |
| 3a | `promptEnvToolHashFields` fix | — | **CONFIRMED** (correct) |
| 3b | `blockFormat` divergence | — | **REFUTED** |
| 3c | `executeTool` divergence | — | **REFUTED** |
| 4a | `getToolChoiceMode()` race load vs turn | Medium | **PLAUSIBLE** (by design, not a bug) |
| 4b | Stale `lastPromptEnvHash` | — | **REFUTED** (serialized by job chain) |
| 6a | Evict ordering vs `chatKvDiskCurrent` | — | **CONFIRMED** (correct) |
| 6b | Early save returns logging ok | — | **REFUTED** |
| 6c | `sessionSaveOkAfterEvict` trivial | Low | **PLAUSIBLE** (debatable extraction) |
| 6d | Legacy fallback touch asymmetry | Low | **PLAUSIBLE** (wasteful no-op write) |
| 7a | **Tests don't exercise AppShell/LlamaService** | **HIGH** | **CONFIRMED** (false coverage) |
| 7b | `sessionSaveOkAfterEvict` test | Medium | **CONFIRMED** (false coverage) |
| 7c | `memoryPrompt.test.ts` comment-only | Medium | **CONFIRMED** (no new coverage) |
| 7d | **No integration test for round-trip** | **HIGH** | **CONFIRMED** (zero end-to-end) |

---

## VERDICT: SHIP-WITH-FIXES

**The hash-unification fix is correct.** `promptEnvToolHashFields` eliminates the old `hasTools: true` hardcode in AppShell's load path. The eviction guard ordering is sound. No PII leak. No race beyond the by-design `getToolChoiceMode()` window.

**Fixes required before merge:**

1. **[HIGH] Add an integration test** that verifies AppShell's `computeSessionPromptEnvHash` output equals `streamAssistantTurn`'s `promptEnvHash` for the same inputs. This is the single most important test for F6 and it does not exist. Even a mock-based test that exercises both code paths with shared `getToolChoiceMode` stubs would close the gap.

2. **[MEDIUM] Test the actual save-path invariant**: that `sessionSaveOkAfterEvict(false)` causes `saveEngineSession` to return `false` and *not* set `chatKvDiskCurrent = true`. The current test only proves the function returns `false` for `false` — it does not prove the save path respects the return value.

3. **[LOW] Remove the wasteful `touchSessionUse(stem)` on legacy fallback** when `stem` !== `loadStem`, or accept it as harmless.

**Ship blockers resolved:** The three intent items from the spec are all confirmed:
- Load-time hash matches save hash via shared `promptEnvToolHashFields` ✅
- Save must not log `ok:true` if keepStem missing after evict → guarded by `sessionSaveOkAfterEvict` + ordering ✅
- KALSA_SESSION includes stem → `logStem` set in both save and load paths ✅
