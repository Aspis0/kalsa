# SESSION NO_FILE Recon — 2026-09-11

**Scenario:** LFM on `conv-g1-m01`. `KALSA_SESSION save ok:true usedTokens:3305` at 21:07:53. Extract timeout → force-stop. Next launch: `KALSA_SESSION load ok:false reason:no_file`. Disk `files/sessions/` has no `lfm2_002e5-2_002e6b__conv-g1-m01-*` file. MiniCPM5 kvs for that conv still exist. Only LFM kvs present is `conv-g1-t11` from 19:49.

**Verdict:** Two code paths can independently cause this. Both are active.

---

## 1. sessionStem / promptEnvHash — the memory-facts bypass

`sessionKey.ts:64-71`:
```typescript
export function sessionStem(
  modelId: string,
  conversationId: string,
  promptEnvHash: string,
): string | null {
  const model = sanitizeSessionSegment(modelId);
  const conv = sanitizeSessionSegment(conversationId);
  const env = sanitizeSessionSegment(promptEnvHash);
  if (!model || !conv || !env) return null;
  return `${model}${SEP}${conv}${SEP}${env}`;
}
```

The file stem is **three-part**: `modelId__conversationId__promptEnvHash`. Any change to any component produces a **different stem** and a **different file path**.

`ttftFlags.ts:23`:
```typescript
export const MEMORY_FACTS_ON_USER_TAIL = true;
```

`sessionKey.ts:149-164` — `computePromptEnvHash`:
```typescript
export function computePromptEnvHash(
  locale: string,
  memoryFacts: readonly string[] | undefined | null,
  hasTools: boolean,
  toolNames?: readonly string[] | null,
  blockFormat?: string | null,
): string {
  const memoryFactsJoined =
    !MEMORY_FACTS_ON_USER_TAIL && Array.isArray(memoryFacts)
      ? memoryFacts.join("\n")
      : "";
```

With `MEMORY_FACTS_ON_USER_TAIL = true`, facts are **always omitted** from the env hash. The hash depends on: **locale, hasTools, toolNames, blockFormat**.

**Critical asymmetry between save and load:**

Save-time hash (`LlamaService.ts:3118-3127`):
```typescript
    const promptEnvInputs: PromptEnvInputs = {
      locale,
      hasTools: hasTools && toolCallingEnabled,
      toolNames: toolCallingEnabled ? toolNames : [],
      blockFormat,
      facts: MEMORY_FACTS_ON_USER_TAIL
        ? []
        : memoryFactTextsForEnvHash(options.memoryFacts),
    };
    lastPromptEnvHash = computePromptEnvHash(
      promptEnvInputs.locale,
      promptEnvInputs.facts,
      promptEnvInputs.hasTools,
      promptEnvInputs.toolNames,
      promptEnvInputs.blockFormat,
    );
```

Load-time hash (`AppShell.tsx:3792-3798`):
```typescript
      let sessionPromptEnvHash = computePromptEnvHash(
        locale,
        [],
        true,
        toolNames,
        blockFormat,
      );
```

At **save** time: `hasTools = hasTools && toolCallingEnabled`, `toolNames = toolCallingEnabled ? toolNames : []`.
At **load** time: `hasTools = true` (hardcoded), `toolNames = agentOptions.tools.map(...)`.

If `toolCallingEnabled` is `false` at save time (e.g. bench `toolChoiceMode` is `"none"`), the save hashes `{hasTools: false, tools: []}`. At load time, it hashes `{hasTools: true, tools: [...]}`. **Different hash → different stem → file not found.**

---

## 2. discardStaleConversationSessions — deletes the old stem on env-hash mismatch

`sessionPool.ts:148-160`:
```typescript
export async function discardStaleConversationSessions(
  modelId: string,
  conversationId: string,
  keepEnvHash: string,
): Promise<number> {
  try {
    const names = await listKvsNames();
    const stems = staleStemsForConversation(
      names,
      modelId,
      conversationId,
      keepEnvHash,
    );
    for (const stem of stems) await dropStem(stem);
    return stems.length;
  } catch {
    return 0;
  }
}
```

Called from `tryLoadEngineSession` (`LlamaService.ts:2464-2466`):
```typescript
    const staleDropped = convId
      ? await discardStaleConversationSessions(modelId, convId, envHash ?? "")
      : 0;
```

This runs **before** `sessionFileExists(stem)`. It finds all `.kvs` files with the same `modelId + conversationId` but a **different** `promptEnvHash`, and **deletes them**.

The `no_file` log fires when `staleDropped === 0` (`LlamaService.ts:2475-2483`):
```typescript
        if (staleDropped > 0) {
          log(false, { reason: "meta_mismatch:promptEnvHash" });
          return false;
        }
        // ...
        log(false, { reason: "no_file" });
        return false;
```

`no_file` with `staleDropped === 0` means: **no files for this model+conv exist on disk at all** — neither the target stem nor any stale variant.

---

## 3. Extract timeout + env-hash change → next load sees a new stem, old kvs already gone

The sequence:

1. **Turn N** runs with env hash **A**. `lastPromptEnvHash = A`.
2. `saveEngineSession` writes file at stem `lfm2_...__conv-g1-m01__<A>`. Log: `save ok:true`.
3. `evictSessionPool(stem_A, budget)` — stem_A is `keepStem`, protected.
4. Extract gate released → `extractMemory` runs.
5. Extract times out. `extractMemory` finally block restores native KV from checkpoint. **No session files deleted.**
6. **Env hash changes** between turns (e.g., `toolCallingEnabled` flips, tool list changes, locale changes). Now `lastPromptEnvHash = B`.
7. **Turn N+1** runs with env hash **B**. Save writes file at stem `lfm2_...__conv-g1-m01__<B>`.
8. `evictSessionPool(stem_B, budget)` — stem_B is `keepStem`. **stem_A is now a candidate for eviction** (different stem, not `keepStem`). If budget is tight, stem_A gets deleted.
9. Force-stop.
10. **Next launch** computes env hash. If hash is **B**: stem_B exists → load succeeds. If hash is **A** (e.g., settings reverted): stem_A was evicted in step 8 → `no_file`.

The `evictSessionPool` eviction path (`sessionPool.ts:41-61`):
```typescript
export function pickEvictionStems(
  files: PoolFile[],
  budgetBytes: number,
  keepStem: string,
): string[] {
  // ...
  const ordered = files
    .filter((f) => f.stem !== keepStem)
    .slice()
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.stem.localeCompare(b.stem));
  const evict: string[] = [];
  for (const f of ordered) {
    if (remaining <= budget) break;
    evict.push(f.stem);
    remaining -= Math.max(0, f.bytes);
  }
  return evict;
}
```

Only `keepStem` is protected. All other stems are eviction candidates sorted by `lastUsedAt`.

---

## 4. Whether save ok:true can return before the .kvs exists on UFS

**No.** The save path is strictly sequential (`LlamaService.ts:2228-2385`):

```
ctx.saveSession(tmpPath)          // native write to .tmp
  → FileSystem.moveAsync(.tmp → .kvs)   // rename, atomic on same FS
    → writeSessionMeta(stem, meta)       // AsyncStorage write
      → FileSystem.deleteAsync(.bak)     // cleanup
        → log(true, ...)                 // ← THIS is the "save ok:true"
          → evictSessionPool(...)
            → deleteLegacyModelSession(...)
```

The log fires **after** the `.kvs` rename, **after** meta write, **after** `.bak` cleanup. By the time `save ok:true` is logged, the file is on UFS.

If the meta write fails, the code **rolls back** (`LlamaService.ts:2345-2363`):
```typescript
      if (!(await writeSessionMeta(stem, meta))) {
        try {
          await FileSystem.deleteAsync(path, { idempotent: true });
        } catch {
          // ignore
        }
        if (hadPrevious) {
          try {
            await FileSystem.moveAsync({ from: bakPath, to: path });
          } catch {
            // ignore — worst case cold start
          }
        }
        log(false, { reason: "meta_write" });
        return false;
      }
```

Meta failure → `.kvs` deleted + `.bak` restored → `save ok:false`. So `save ok:true` **guarantees** both `.kvs` and meta exist.

---

## 5. extractMemory checkpoint path — wrong stem for restore

`LlamaService.ts:4172-4176`:
```typescript
        if (preserve) {
          if (chatKvDiskCurrent && modelId && (await sessionFileExists(modelId))) {
            restorePath = sessionFilePath(modelId);
          } else if (modelId) {
            tempPath = `${sessionFilePath(modelId)}.extract-ckpt`;
```

`sessionFilePath(modelId)` calls `sanitizeModelId` which only replaces `/`, `\`, `..` (`sessionPersistence.ts:136-138`):
```typescript
export function sanitizeModelId(modelId: string): string {
  return modelId.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
}
```

But `sessionStem` uses `sanitizeSessionSegment` which replaces **all** non-alphanumeric non-hyphen chars with `_XXXX` hex codes (`sessionKey.ts:16-30`).

Result: `sessionFileExists(modelId)` looks for `sessions/lfm2-002e5-2-002e6b.kvs` (legacy format). The actual file is at `sessions/lfm2_002e5-2_002e6b__conv-g1-m01__<hash>.kvs`. **Always false for stem-based files.** Extract always takes the `tempPath` branch, which is correct behavior (creates a temp checkpoint) but means the "reuse just-saved .kvs" optimization is dead for pool-format files.

This is **not** the cause of `no_file` — the temp checkpoint is created and deleted within the extract, never touching the session file.

---

## 6. disposeEngineLocked — intentionally preserves session files

`LlamaService.ts:1918` (comment in `disposeEngineLocked`):
```
    // Intentionally do NOT delete session files here — they survive dispose
    // so the next initEngine can restore KV after app restart / model reload.
```

Force-stop → `disposeEngineLocked` → no file deletion. Session files survive.

---

## Root cause summary

**Most likely:** The env hash at load time differs from the env hash at save time. This happens when `toolCallingEnabled`, tool names, locale, or `blockFormat` change between the save and the next launch. The load computes a new stem, finds no file for it, and (if the old file was already evicted by a previous `discardStaleConversationSessions` or `evictSessionPool` call) reports `no_file` with `staleDropped === 0`.

**Contributing factor:** `MEMORY_FACTS_ON_USER_TAIL = true` means facts don't affect the env hash, so a fact change during extractMemory doesn't cold-start the KV. But it also means the env hash is **fragile to tool/locale/format changes** that the user may not realize affect session identity.

**The `no_file` with `staleDropped === 0` specifically** means: at the moment of load, **zero** `.kvs` files exist on disk for `lfm2_002e5-2_002e6b` + `conv-g1-m01` under **any** env hash. The file from 21:07:53 was either:
- Evicted by `evictSessionPool` during a later save (different stem became `keepStem`)
- Deleted by `discardStaleConversationSessions` during an intermediate load
- Never written under the stem the load expects (hash mismatch at save time)
