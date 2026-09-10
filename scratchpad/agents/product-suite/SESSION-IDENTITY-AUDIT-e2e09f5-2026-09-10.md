# SESSION-IDENTITY-AUDIT — e2e09f5 (2026-09-10)

**Commit**: `e2e09f5dc724b8d4ff6f0583437d1180d1c0e364`
**Author**: Marco Gualtieri (Co-Authored-By: Claude Fable 5.1)
**Subject**: `fix(session): bind the saved KV to the model file and the engine build`
**Scope**: 7 files, +272 / -29 lines
**Reviewer**: autonomous audit (read-only, code not modified)
**Previous recon**: `SESSION-IDENTITY-RECON-2026-09-10.md` (repo main 3ca6145)

---

## Verdict: **BLOCK**

`modelFileId` (defect #1) is correctly bound. `engineBuild` (defect #3) is **not** a real identity — both components are static constants. The fingerprint `kalsa-native-patches:app:1` is identical across all engine builds unless `versionCode` in `app.config.js` is manually bumped. Changing the engine commit (llama.rn patches, native code) does not change this value. The commit's stated goal — "a new engine build costs one cold start instead of silently reusing a foreign KV" — is not achieved for engine-only changes.

---

## 1. What e2e09f5 fixes (recon defects #1 and #3)

### Defect #1 — Model-file identity now bound ✓

**Recon said**: same model id after a re-download with a different quant/sha silently loads an old .kvs.

**Fix**: `SessionMeta` gains `modelFileId: string` (format `size:mtime_ms:declaredSha` when sha available, `size:mtime_ms` otherwise). Compared in `sessionMetaMismatchField` (:408-409 of sessionPersistence.ts) → `meta_mismatch:modelFileId` on load → artifacts deleted, cold start.

**Call path**:
1. `initEngine` → `FileSystem.getInfoAsync(modelPath)` → `modelFileIdFromInfo(info, modelInfo?.sha256)` → `activeModelFileId` (LlamaService.ts:1739-1741)
2. `tryLoadEngineSession` builds `expectedMeta` with `modelFileId: activeModelFileId` (:2522) → `sessionMetaMismatchField(storedForConfig, expectedMeta)` (:2539)
3. Mismatch → `deleteSessionArtifacts(loadStem)` (:2533) → cold start

**Status**: CONFIRMED. The recon's #1 defect is closed.

**Note on sha provenance**: `modelInfo?.sha256` is the catalog-declared SHA (from `devModelCatalog.ts`), not a runtime hash of the actual file on disk. If a GGUF is corrupted or modified after download but keeps the same file size, the catalog SHA still matches. The `size:mtime` component catches modifications that change file size or mtime. This is an acceptable limitation — full runtime integrity checking would require hashing the GGUF at load time (expensive).

### Defect #3 — Engine/fork pin: NOT a real identity ✗

**Recon said**: app update with new native patches can restore stale state.

**What the code does**: `engineBuildFingerprint` (LlamaService.ts:1313-1319) extracts the `kalsa-native-patches` token from `context.systemInfo` and appends `nativeBuildVersion` from `expo-application`:
```typescript
function engineBuildFingerprint(systemInfo?: string): string | null {
  const patchToken = systemInfo.split(/\s+/)
    .find((token) => token.includes("kalsa-native-patches"))
    ?? "systemInfo:unmarked";
  return `${patchToken.slice(0, 96)}:app:${nativeBuildVersion ?? "unknown"}`;
}
```

**Why it's static — component 1 (`kalsa-native-patches`)**:
- Source: `node_modules/llama.rn/cpp/common/common.cpp:437`
  ```cpp
  os << " | kalsa-native-patches";
  ```
- This is a **string literal** compiled into `librnllama.so`. It does NOT encode which patches are applied, the llama.rn commit hash, or any build-time variant. It is a boolean marker: "this binary was built from patched source" vs "prebuilt upstream". The same string `kalsa-native-patches` is emitted for every source build regardless of which patches are in `patches/llama.rn+*.patch`.

**Why it's static — component 2 (`nativeBuildVersion`)**:
- Source: `expo-application` package, which reads `android:versionCode` from `AndroidManifest.xml`.
- `app.config.js` has `version: "0.1.0"` and no explicit `versionCode`.
- Expo defaults `versionCode` to `1` when omitted. Confirmed in build intermediates:
  ```
  android/app/build/intermediates/merged_manifests/release/.../output-metadata.json: "versionCode": 1
  ```
- `nativeBuildVersion` is `"1"` on every build unless someone manually bumps `versionCode` in `app.config.js`.

**Result**: `engineBuildFingerprint` always returns `"kalsa-native-patches:app:1"`. This value does not change when:
- llama.rn patches are updated (`patches/llama.rn+*.patch`)
- llama.cpp is updated within llama.rn
- The engine commit changes
- Native code is modified in `cpp/`

The only way to change it is to add/remove the `kalsa-native-patches` literal from `common.cpp` (toggles between `"kalsa-native-patches:app:1"` and `"systemInfo:unmarked:app:1"`), or to bump `versionCode` in `app.config.js`.

**Impact**: Two different engine builds with the same `versionCode` produce the same `engineBuild` fingerprint. The session meta comparison `a.engineBuild !== b.engineBuild` will be `false` (equal), so no cold start occurs. The scenario: SAME GGUF file (size:mtime unchanged, modelFileId matches) + DIFFERENT engine build (new native patches, updated llama.cpp) → the old KV is silently reused against the new engine. A re-quantized model file with different size/mtime is correctly caught by `modelFileId`; the gap is engine-only changes that leave the GGUF untouched.

**Status**: BLOCK. The recon's #3 defect is NOT closed. The `engineBuild` field exists in `SessionMeta` and is compared, but its value is constant across engine builds. The field provides no isolation between different native builds.

---

## 2. Format version 1 → 2 migration

`SESSION_FORMAT_VERSION = 2` (sessionPersistence.ts:18). `readSessionMeta` rejects `parsed.formatVersion !== SESSION_FORMAT_VERSION` (:619) → returns `null` → `tryLoadEngineSession` sees `no_meta` → cold start.

**No data loss**: old formatVersion 1 sidecars stay on disk but are never loaded. One-time cold start for all existing sessions after app update. This is the correct trade-off — the old format lacked the identity fields entirely.

**Edge**: a formatVersion 1 meta that somehow persists after the upgrade will never load because `readSessionMeta` strictly requires version 2. No silent fallback.

---

## 3. Save guard: session_identity_unavailable

LlamaService.ts:2214-2216:
```typescript
if (!activeModelFileId || !activeEngineBuild) {
  log(false, { reason: "session_identity_unavailable" });
  return false;
}
```

**When this fires**: `getInfoAsync` fails (returns null via `.catch(() => null)`) → the ternary `loadedFileInfo ? modelFileIdFromInfo(loadedFileInfo, ...) : undefined` evaluates to `undefined` → `activeModelFileId` is `undefined`. OR `systemInfo` is empty/missing → `engineBuildFingerprint` returns null → `activeEngineBuild` is `undefined`.

**Note**: `modelFileIdFromInfo` is never called with null — the ternary guards it. The "info null" scenario sets `activeModelFileId` to `undefined` directly via the ternary's else branch.

**Effect**: save is skipped entirely. No meta with empty identity reaches disk. Next app restart will cold-start. This is the correct fail-closed behavior.

**Verified**: the check is inside `withLifecycleLock(() => withEngineJob(...))` — no TOCTOU race with dispose.

---

## 4. Dispose cleanup

LlamaService.ts:1885-1886 (inside `disposeEngineLocked`):
```typescript
activeModelFileId = undefined;
activeEngineBuild = undefined;
```

Also clears `lastCompletionPromptEnvHash` and `lastCompletionPromptEnvInputs` (:1912-1913). All within `withLifecycleLock` — no stale identity survives engine teardown.

---

## 5. KALSA_PREFIX env-hash change logging

**New closure**: `noteCompletionPromptEnv` (LlamaService.ts:3140-3163).

**Call path**: invoked once per completion (guarded by `prefixEnvLogged` flag) at two sites:
- After `refreshGovernorBeforeCompletion` (:3482)
- After fallback `refreshGovernorBeforeCompletion` (:3849)

**Behavior**: compares `lastCompletionPromptEnvHash` with `lastPromptEnvHash`. If different, logs `KALSA_PREFIX {reason:"env_hash_changed", from, to, changed}` where `changed` is computed by `promptEnvChangedFields`.

**First turn after restoreEngineSession**: `restoreEngineSession` sets `lastCompletionPromptEnvHash = undefined` (:2669). The guard is `if (from && from !== lastPromptEnvHash)` (:3145). When `from` is `undefined`, `from && ...` short-circuits to `false` → **no log on the first turn after restore**. The `lastCompletionPromptEnvHash` is updated to `lastPromptEnvHash` at the end of the closure (:3161), so the SECOND turn will compare against the first turn's hash and log if it differs. This is correct behavior — the first turn has no "previous" to compare against.

**Race analysis**: the closure captures `promptEnvInputs` (constructed at the start of `streamAssistantTurn`, :3131-3139) and `lastPromptEnvHash` (set at :3148-3157). Both are local to the turn's async execution within `withEngineJob`. The `lastCompletionPromptEnvHash` and `lastCompletionPromptEnvInputs` module-let variables are only read/written inside this closure and inside `restoreEngineSession` (:2669-2670, which also runs inside `withLifecycleLock(() => withEngineJob(...))`). **No TOCTOU race** — the lifecycle lock + job FIFO serialize all access.

**Edge case — facts in changed array**: when `MEMORY_FACTS_ON_USER_TAIL = true` (ttftFlags.ts:23, pinned by test), `promptEnvInputs.facts` is always `[]` (:3137). Both `promptEnvChangedFields` comparisons produce `facts.join("\n") === ""` → "facts" never appears in `changed`. This is correct — facts ride the user tail and don't affect the prefix hash.

---

## 6. KALSA_SESSION tokensOnDisk

`tryLoadEngineSession` now includes `tokensOnDisk: buildKvDiagPayload({ ok, tokensLoaded }).tokens_on_disk` in the KALSA_SESSION log line (:2439). Same for `restoreNativeSession` (:4073). This was recon defect #5 (observability).

**Status**: CONFIRMED. tokensOnDisk is now visible in the load line without grepping KALSA_KVDIAG separately.

---

## 7. MEMORY_FACTS_ON_USER_TAIL pinning

New test `ttftFlags.test.ts` pins:
1. `MEMORY_FACTS_ON_USER_TAIL === true`
2. `computePromptEnvHash("en", ["likes tea"], true) === computePromptEnvHash("en", ["likes coffee"], true)`

This prevents an accidental flag flip from silently re-enabling facts-in-system-prompt without updating the env hash shape. If someone changes the flag to `false`, the test breaks and the env hash will now include facts (as intended by the old code path).

**Status**: CONFIRMED. Recon defect #4 is closed.

---

## 8. computePromptEnvHash shape change

The function now always passes `[]` for facts when `MEMORY_FACTS_ON_USER_TAIL` is true (:366-369 of sessionPersistence.ts). Previously, the caller was responsible for passing `[]` — the function hashed whatever it received.

**Backward compat**: old formatVersion 1 metas are rejected by `readSessionMeta` (format check), so there's no risk of a stale hash being compared. Old formatVersion 2 metas (which don't exist yet) would need to match the new shape. This is safe because formatVersion 2 is introduced in this very commit.

**Test update**: `memoryPrompt.test.ts` test "4" was updated to assert facts produce the SAME hash in tail mode (was: different hash). This correctly reflects the new behavior.

---

## 9. modelFileIdFromInfo — declaredSha provenance

**Format**: `${Math.trunc(size)}:${Math.round(modificationTime * 1000)}${:declaredSha}`

**`declaredSha` source**: `modelInfo?.sha256` from `getModelById(modelId)` (LlamaService.ts:1740). This is the catalog-declared SHA-256 from `devModelCatalog.ts` (e.g., `sha256: "ec2d5801640099e97d8d7e8003ad4d81f336e757811f03a26173dddf386602fd"` at devModelCatalog.ts:149). It is NOT computed from the actual file on disk at runtime.

**Implication**: if a GGUF file is corrupted or modified after download but retains the same byte size (e.g., byte-level corruption that doesn't change length), `modelFileId` still matches because the catalog SHA is unchanged. The `mtime` component would change only if the file system updates mtime on corruption (typically yes for writes, no for bit-rot). This is an acceptable limitation — runtime SHA verification would require reading the entire GGUF at load time.

**Edge — no SHA in catalog**: when `sha256` is absent from `ModelFileSpec`, `declaredSha` is `undefined` → format is `size:mtime_ms`. Two GGUF files with identical byte size AND identical second-precision mtime would produce the same identity. **Severity: LOW**. In practice: different quants of the same model have different sizes.

---

## 10. restoreEngineSession resets completion env state

LlamaService.ts:2669-2670:
```typescript
lastCompletionPromptEnvHash = undefined;
lastCompletionPromptEnvInputs = undefined;
```

This is correct — a conversation switch should not carry over the previous conversation's env-hash logging state. As noted in §5, the first turn after restore does NOT log `env_hash_changed` because the guard `if (from && from !== lastPromptEnvHash)` short-circuits on `from === undefined`. The second turn will log if the env differs.

---

## 11. Backward compatibility — working tree vs committed

All changes are committed (verified: `git show e2e09f5 -p` matches the on-disk file contents). No uncommitted modifications to the 7 changed files. The audit is against the committed state, not the working tree.

---

## Summary

| # | Finding | Severity | File:Line | Status |
|---|---------|----------|-----------|--------|
| 1 | modelFileId binds GGUF identity to session meta | — | sessionPersistence.ts:22-23, sessionKey.ts:82-100 | FIXED (recon #1) |
| 2 | **engineBuild is static: `kalsa-native-patches` (C++ literal) + `versionCode=1`** | **BLOCK** | **LlamaService.ts:1313-1319, common.cpp:437, app.config.js** | **NOT FIXED (recon #3)** |
| 3 | formatVersion 2 rejects old formatVersion 1 metas cleanly | — | sessionPersistence.ts:619 | CORRECT |
| 4 | session_identity_unavailable prevents empty identity on disk | LOW | LlamaService.ts:2214-2216 | CORRECT |
| 5 | dispose clears both new fields within lifecycle lock | — | LlamaService.ts:1885-1886, 1912-1913 | CORRECT |
| 6 | noteCompletionPromptEnv has no TOCTOU race | — | LlamaService.ts:3140-3163 | SAFE |
| 7 | KALSA_SESSION includes tokensOnDisk | — | LlamaService.ts:2439, 4073 | FIXED (recon #5) |
| 8 | MEMORY_FACTS_ON_USER_TAIL pinned by test | — | ttftFlags.test.ts:18-22 | FIXED (recon #4) |
| 9 | modelFileId declaredSha is catalog-declared, not runtime-computed | INFO | sessionKey.ts:95-100, LlamaService.ts:1740 | ACCEPTABLE |
| 10 | modelFileId size:mtime collision when no SHA | LOW | sessionKey.ts:95-100 | ACCEPTABLE |
| 11 | first turn after restoreEngineSession does NOT log env_hash_changed | — | LlamaService.ts:3145 | CORRECT (guard: `from && ...`) |

**BLOCK items**: #2 — `engineBuild` does not identify the engine build. Both components are static. The field is compared but never differs across engine-only changes.

---

## Limitations

1. **Runtime behavior not exercised**: this is a static code audit. No device or simulator was used. Race conditions involving AppState background/foreground transitions, concurrent `withEngineJob` enqueues, or native-layer save/load interleaving were analyzed structurally (lifecycle lock + FIFO) but not dynamically tested.
2. **LFM recurrent state**: the recon's Q3 findings about `captureStateCheckpoint` and recurrent-restore are unchanged by this commit. No new recurrent-state code was added. The existing `tokensLoaded > 0` guard and `deleteSessionArtifacts` on failure remain the only protection against silent recurrent-state drift.
3. **Chat template exact bytes**: the recon's Q1 finding about unhashed template text is unchanged. `blockFormat` is hashed but the actual template output is not. This is a known limitation, not a regression.
4. **e2e09f5 is not device-verified**: the commit has not been tested on a physical device. The BLOCK verdict on `engineBuild` is based on static analysis of the committed source and build configuration, not runtime observation.
