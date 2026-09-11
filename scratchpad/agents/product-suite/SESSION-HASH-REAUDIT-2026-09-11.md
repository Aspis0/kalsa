# SESSION-HASH-REAUDIT-2026-09-11

**Delta:** SHIP-WITH-FIXES only (re-audit of `computeSessionPromptEnvHash` extraction)
**Date:** 2026-09-11
**Previous:** SESSION-HASH-AUDIT-2026-09-11.md (production hash unify already CONFIRMED correct)

---

## 1. AppShell still computing a second hash path

**REFUTED.**

AppShell imports `computeSessionPromptEnvHash` (load-time) at `AppShell.tsx:170`. It is called at two sites (`AppShell.tsx:3789`, `AppShell.tsx:4338`). AppShell does **not** contain any direct `promptEnvToolHashFields` or `computePromptEnvHash` call — the extraction is clean.

LlamaService.ts still calls `promptEnvToolHashFields` directly at `LlamaService.ts:3128` and `computePromptEnvHash` at `LlamaService.ts:3142`. This is the **save-side** (F6 in `streamAssistantTurn`) and must remain independent of the load-side wrapper. The two codepaths produce equivalent hashes:

- **Load (sessionPromptEnv.ts:21-24):**
  ```
  promptEnvToolHashFields({
    toolsWired: Boolean(toolNames.length && args.executeTool),
    toolCallingEnabled: shouldUseToolCalling(await getToolChoiceMode()),
    toolNames,
  })
  ```
- **Save (LlamaService.ts:3093 + 3128-3131):**
  ```
  promptEnvToolHashFields({
    toolsWired: hasTools,  // hasTools = Boolean(options?.tools?.length && options?.executeTool) @3093
    toolCallingEnabled,     // shouldUseToolCalling(await getToolChoiceMode()) @3022-3023
    toolNames,
  })
  ```

Both call `getToolChoiceMode()` from AsyncStorage, both apply `shouldUseToolCalling()`, both derive `hasTools` from the same `Boolean(tools.length && executeTool)` pattern. Hashes match. No residual duplication — this is the correct load/save symmetry.

---

## 2. Unused imports in `sessionPromptEnv.ts`

**REFUTED (technically). All 5 imports are referenced, but see Finding 5 (dead code).**

| Import | Used at |
|---|---|
| `getToolChoiceMode` (benchConfig) | `sessionPromptEnv.ts:22` |
| `shouldUseToolCalling` (benchConfig) | `sessionPromptEnv.ts:22` |
| `* as MemoryStore` | `sessionPromptEnv.ts:30` (inside dead branch) |
| `promptEnvToolHashFields` (sessionKey) | `sessionPromptEnv.ts:21` |
| `computePromptEnvHash` (sessionPersistence) | `sessionPromptEnv.ts:37` |
| `memoryFactTextsForEnvHash` (sessionPersistence) | `sessionPromptEnv.ts:31` (inside dead branch) |
| `MEMORY_FACTS_ON_USER_TAIL` (ttftFlags) | `sessionPromptEnv.ts:27` (dead branch condition) |

No import is dangling — every symbol appears in the function body. However, `MemoryStore`, `memoryFactTextsForEnvHash`, and the `MEMORY_FACTS_ON_USER_TAIL` guard are only reachable through dead code (see Finding 5). ESLint `no-unused-imports` would not flag them because the references exist syntactically.

---

## 3. Test mock not actually reaching `getToolChoiceMode`

**REFUTED.**

`sessionPromptEnv.test.ts:14-19` mocks `AsyncStorage.getItem` to return the mode when the key matches `BENCH_TOOLCHOICE_KEY`:

```typescript
(AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
  key === BENCH_TOOLCHOICE_KEY ? mode : null,
);
```

`getToolChoiceMode()` (`benchConfig.ts:394-396`) reads `AsyncStorage.getItem(BENCH_TOOLCHOICE_KEY)` and returns the raw string (or `"auto"` default). The mock intercepts this path. The test at `sessionPromptEnv.test.ts:48-62` asserts `expect(mode).toBe("auto")` after calling `computeSessionPromptEnvHash`, confirming the mock reaches `getToolChoiceMode`.

The second test (`sessionPromptEnv.test.ts:64-85`) mocks `"none"`, asserts `fields.hasTools === false`, and verifies the empty-tools hash matches — same mechanism, confirmed working.

---

## 4. `executeTool` typing

**PLAUSIBLE.**

`sessionPromptEnv.ts:17`:
```typescript
executeTool?: unknown;
```

The parameter is only used for a truthiness check at `sessionPromptEnv.ts:21`:
```typescript
toolsWired: Boolean(toolNames.length && args.executeTool),
```

`unknown` is the loosest possible type. It works correctly (truthiness of `undefined` vs a function is distinct), but it documents nothing. The caller at `AppShell.tsx:3791` passes `agentOptions.executeTool` which is typed as `((...) => ...) | undefined` on the agent options interface. A more precise signature:

```typescript
executeTool?: ((...args: unknown[]) => unknown) | null;
```

This is a style/readability nit, not a correctness bug. The hash is unaffected because `Boolean()` treats any truthy value identically. **PLAUSIBLE** as a improvement, not a defect.

---

## 5. `MEMORY_FACTS_ON_USER_TAIL` branch — untested and dead

**CONFIRMED.**

`ttftFlags.ts:23`:
```typescript
export const MEMORY_FACTS_ON_USER_TAIL = true;
```

`sessionPromptEnv.ts:27-35`:
```typescript
if (!MEMORY_FACTS_ON_USER_TAIL) {
  try {
    const enabled = await MemoryStore.getEnabled();
    if (enabled) {
      facts = memoryFactTextsForEnvHash(await MemoryStore.listFacts());
    }
  } catch {
    // empty facts → match disabled / cold
  }
}
```

`MEMORY_FACTS_ON_USER_TAIL` is a compile-time constant `true`. The `!true` condition is always `false`. This entire block (9 lines) is **dead code** — it can never execute at runtime. The `MemoryStore` import and `memoryFactTextsForEnvHash` import exist solely to support this dead branch.

`sessionPromptEnv.test.ts` has **zero** references to `MEMORY_FACTS_ON_USER_TAIL`. The test file does not mock `MemoryStore`, does not test the `getEnabled()` path, and does not test the `listFacts()` path. The `MEMORY_FACTS_ON_USER_TAIL` branch is completely untested.

The same guard exists on the save-side (`LlamaService.ts:3138-3140`):
```typescript
facts: MEMORY_FACTS_ON_USER_TAIL
  ? []
  : memoryFactTextsForEnvHash(options.memoryFacts),
```

Both sides are consistent (both pass `[]` when `true`), so hashes match. But the dead code in `sessionPromptEnv.ts` is a maintenance hazard — if someone later sets `MEMORY_FACTS_ON_USER_TAIL = false`, they must also update `sessionPromptEnv.ts` to actually fetch facts from the store, and the current dead code path would activate without test coverage.

**Severity:** Low (dead code, no runtime impact). Flag for cleanup or guard with a comment.

---

## 6. File size / responsibility

**REFUTED (no issue).**

| File | Lines | Role |
|---|---|---|
| `sessionPromptEnv.ts` | 44 | Single exported function, load-time hash wrapper |
| `sessionPromptEnv.test.ts` | 91 | 2 focused tests for the wrapper |
| `sessionPersistence.ts` | 731 | Persistence layer, `computePromptEnvHash` lives here |
| `LlamaService.ts` | 4683 | Engine orchestrator, save-side hash at F6 |

`sessionPromptEnv.ts` is 44 lines with one function and one responsibility: compute the load-time prompt-env hash from AppShell-friendly inputs. It delegates to `sessionKey.ts` (tool field normalization) and `sessionPersistence.ts` (hash computation). This is the correct extraction — AppShell was previously doing this inline. The file does not leak persistence or engine concerns.

---

## 7. Dead code last

**CONFIRMED.**

The only dead code in the delta is the `MEMORY_FACTS_ON_USER_TAIL` guard block (`sessionPromptEnv.ts:27-35`). No other dead code was found:

- `sessionSaveOkAfterEvict` — confirmed deleted (zero grep hits across `src/`).
- All imports in `sessionPromptEnv.ts` are referenced (though some only in dead code).
- No leftover `promptEnvToolHashFields` in AppShell.
- `computeSessionPromptEnvHash` is called at both AppShell sites; no orphaned imports.

---

## Verdict

| # | Hunt target | Rating |
|---|---|---|
| 1 | AppShell second hash path | **REFUTED** — clean extraction, load/save symmetry correct |
| 2 | Unused imports | **REFUTED** — all referenced, though 3 only in dead code |
| 3 | Test mock not reaching getToolChoiceMode | **REFUTED** — mock intercepts AsyncStorage correctly |
| 4 | executeTool typing | **PLAUSIBLE** — `unknown` works but documents nothing |
| 5 | MEMORY_FACTS_ON_USER_TAIL untested | **CONFIRMED** — dead code, zero test coverage |
| 6 | File size/responsibility | **REFUTED** — 44 lines, single responsibility |
| 7 | Dead code | **CONFIRMED** — `sessionPromptEnv.ts:27-35` is unreachable |

**Overall: SHIP-WITH-FIXES.** The extraction is correct and the hashes match. One low-severity dead code block and one typing nit. No blockers.
