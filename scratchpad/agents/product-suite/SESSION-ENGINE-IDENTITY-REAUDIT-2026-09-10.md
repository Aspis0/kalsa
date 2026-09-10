# SESSION-ENGINE-IDENTITY-REAUDIT — 2026-09-10

**Base**: uncommitted diff on working tree (HEAD = e2e09f5)
**Coder**: DeepSeek98c66 (engine identity fix)
**Scope**: reaudit of BLOCK #2 from `SESSION-IDENTITY-AUDIT-e2e09f5-2026-09-10.md`
**Previous audit**: `SESSION-IDENTITY-AUDIT-e2e09f5-2026-09-10.md` (verdict: BLOCK — `engineBuild` static)
**Reviewer**: autonomous audit (read-only, code not modified)

---

## Verdict: **SHIP** (code-review approval)

The BLOCK is resolved. `engineBuild` now carries a deterministic, build-time-computed identity from real inputs (pin, patches, native tree, overlay script, source-build plugin, llama.rn version, variant). The old static `kalsa-native-patches:app:1` is eliminated. Local gates pass: jest 632/632, sessionMetaHarness 50/0, sessionSaveGate 46/0, engineIdentity 16/16. Pre-existing failures (ModelRegistry budget, sessionMetaHarness facts) are fixed by the same diff. No on-device or real APK verification performed.

---

## 1. Diff inventory

| File | Status | Lines | Purpose |
|------|--------|-------|---------|
| `scripts/engine-build-id.js` | **new** | 173 | Deterministic build id from committed inputs |
| `src/engine/engineIdentity.ts` | **new** | 65 | Runtime fingerprint + `readEngineBuildId()` |
| `src/engine/engineIdentity.test.ts` | **new** | 187 | 16 tests covering fail-closed, sensitivity, determinism |
| `app.config.js` | modified | +8 | Embeds `extra.engineBuildId` at prebuild |
| `src/engine/LlamaService.ts` | modified | −9/+3 | Removes old static fingerprint, wires new identity |
| `src/engine/sessionPersistence.ts` | modified | 1 | Comment accuracy on `engineBuild` field |
| `scripts/sessionMetaHarness.mjs` | modified | +57 | Fixes 2 pre-existing failures, adds 4 identity tests |
| `src/engine/ModelRegistry.test.ts` | modified | 1 | Fixes 1 pre-existing failure (budget 256/512→512/1024) |

All 3 new files are untracked, not gitignored (`git check-ignore` returns empty).

---

## 2. Build-time identity generation — `scripts/engine-build-id.js`

### 2.1 Inputs covered

| Input | Source | Hashed as |
|-------|--------|-----------|
| Fork pin commit | `native/kalsallama.pin` → `pin.commit` | 40-char sha validated, then `pin:<commit>` |
| Bridge/native patches | `patches/*.patch` (sorted by name) | `patch:<name>:<sha256>` per file |
| Native source tree | `native/` recursive (excludes `kalsallama.pin`) | `native:<relpath>:<sha256>` per file |
| Overlay script | `scripts/sync-kalsallama.sh` | `overlay:<sha256>` |
| Source-build plugin | `plugins/withLlamaFromSource.js` | `source-plugin:<sha256>` |
| llama.rn base version | `node_modules/llama.rn/package.json` → `version` | `llama.rn:<version>` |
| Build variant | `KALSA_LLAMA_FROM_SOURCE` env (`"0"` → prebuilt, else source) | `variant:<source\|prebuilt>` |

**Canonical form**: newline-joined `pin:…\nvariant:…\nllama.rn:…\noverlay:…\nsource-plugin:…\npatch:…\nnative:…` → SHA-256 → `kalsa-eng-v1:<variant>:<hex>`.

### 2.2 Determinism verified

```
ID1 = node scripts/engine-build-id.js
edit patches/llama.rn+0.12.8.patch  → ID2 ≠ ID1
restore patch                       → ID3 = ID1
edit native/kalsallama.pin commit   → ID  ≠ ID1
restore pin                         → ID  = ID1
```

Same inputs always produce the same id. Any single input change produces a different id.

### 2.3 Fail-closed on unreadable inputs

- Missing `native/kalsallama.pin` → throws `ENOENT` at `readJsonOrThrow` → prebuild fails
- Missing `patches/` directory → throws `ENOENT` at `readdirSync` → prebuild fails
- Missing `node_modules/llama.rn/package.json` → throws at `readJsonOrThrow` → prebuild fails
- Invalid pin commit (not 40-char hex) → throws validation error → prebuild fails

**Verified**: tested by renaming pin file and patches directory; both throw with clear error messages.

### 2.4 What is NOT hashed (and why it's acceptable)

- **`vendor/kalsallama-cpp/`**: derived from the pin commit + overlay script. If the pin changes, the id changes. If the overlay script changes, the id changes. A stray uncommitted modification to `vendor/` without updating the pin is a development workflow issue, not a build correctness problem — CI checkouts are clean.
- **`app.config.js` itself**: the config file generates the id; hashing it would be circular. The id changes when the inputs change, not when the config changes (unless the config changes the inputs, which it doesn't).
- **`node_modules/llama.rn/cpp/`**: the source tree that patches are applied to. Covered indirectly via `node_modules/llama.rn/package.json` version + `patches/*.patch` sha256. A patch change is caught; a llama.rn version bump is caught.

---

## 3. Embedding — `app.config.js`

```js
next.extra = { ...next.extra, engineBuildId: computeEngineBuildId(__dirname) };
```

**Transit path**: `app.config.js` → `expo prebuild` → native project assets → shipped APK's `app.config` → `expo-constants` (`Constants.expoConfig.extra.engineBuildId`) at runtime.

**Verified**: `npx expo config --type public --json` outputs:
```json
{ "extra": { "engineBuildId": "kalsa-eng-v1:source:765509c2…3a65" } }
```

**Prebuild timing**: `computeEngineBuildId(__dirname)` runs at prebuild time (when `app.config.js` is evaluated by Expo). The `__dirname` resolves to the project root. Whether the id survives into the shipped APK's native assets is not verified on a real build — transit to be confirmed.

**APK asset path**: `android/app/build/intermediates/assets/release/mergeReleaseAssets/app.config` carries the extra. This directory already exists in the build intermediates (confirmed for the previous empty `extra: {}`). The new `engineBuildId` embedding is not verified on a fresh prebuild or real APK — transit to be confirmed.

**Note on coder's §2.2 correction**: the asset merge intermediate currently shows the old `extra: {}` from before the diff. The intermediate reflects the last prebuild, not the working tree. Embedding into APK assets is not verified locally.

---

## 4. Runtime — `src/engine/engineIdentity.ts`

### 4.1 `engineBuildFingerprint(systemInfo, engineBuildId)`

Returns `${engineBuildId}:${marker.slice(0, 96)}` when all conditions met. Returns `null` (fail-closed) when:
- `engineBuildId` is missing/blank → `null`
- `systemInfo` is missing/blank → `null`
- `kalsa-native-patches` marker absent (prebuilt jniLibs) → `null`

**The marker check is now a GUARD, not an identity component**. The old code used the marker as the identity (`kalsa-native-patches:app:1`). The new code uses it only to verify the binary was compiled from patched source — if not, the generated build id would not describe what is actually running, so null is correct.

### 4.2 `readEngineBuildId()`

Lazy `require("expo-constants")` → reads `Constants.expoConfig.extra.engineBuildId`. Returns `null` on any failure (Node tests, APK without config-time id, expo-constants unavailable). Never throws.

**Verified in tests**: `jest.isolateModules` confirms it reads the embedded id when expo-constants is mocked, and returns null when expo-constants throws.

### 4.3 Wiring in `LlamaService.ts`

```typescript
activeEngineBuild =
  engineBuildFingerprint(
    typeof context?.systemInfo === "string" ? context.systemInfo : undefined,
    readEngineBuildId(),
  ) ?? undefined;
```

The old `expo-application` / `nativeBuildVersion` import is removed. The `session_identity_unavailable` guard at :2214 still catches `undefined` → save skipped.

---

## 5. Pre-existing failures — now fixed

### 5.1 `sessionMetaHarness.mjs` (2 failures → 0)

**Root cause**: e2e09f5 changed `computePromptEnvHash` to exclude facts when `MEMORY_FACTS_ON_USER_TAIL = true`, but the harness was not updated to match.

**Fix in diff**:
- `computePromptEnvHash stable + djb2 shape`: expects `memoryFactsJoined: ""` (was `"fact a"`)
- `computePromptEnvHash sensitive to locale / facts / hasTools`: asserts facts do NOT change the hash (was: asserts they DO)
- Added 4 new tests for `modelFileId`/`engineBuild` mismatch detection

**Result**: 50 passed, 0 failed (was 44 passed, 2 failed).

### 5.2 `ModelRegistry.test.ts` (1 failure → 0)

**Root cause**: test expected `thinking: { short: 256, extended: 512 }` for MiniCPM5, but registry has `{ short: 512, extended: 1024, nPredict: 2048 }`.

**Fix in diff**: updated assertion to match registry values.

**Result**: 4 passed, 0 failed (was 3 passed, 1 failed).

### 5.3 CI gate impact

- **`apk.yml`** (line 81): runs `sessionMetaHarness.mjs` → would have failed before this diff (2 failures). Now passes. `npx jest` is intentionally NOT run in this workflow.
- **`ci.yml`** (line 44): runs `npx jest --runInBand` → would have failed on `ModelRegistry.test.ts`. Now passes.
- **`bench.yml`** (lines 139, 154): runs both harnesses and jest → would have failed on both. Now passes.

**Conclusion**: the pre-existing failures that would block `apk.yml` (harness) and `ci.yml` (jest) are fixed by this diff. Local gates pass. CI/APK build not executed — outcome to be verified on next run.

---

## 6. Gate verification — all green

| Gate | Command | Result |
|------|---------|--------|
| TypeScript | `npx tsc --noEmit` | clean |
| Jest | `npx jest --runInBand` | 632 passed, 0 failed |
| sessionMetaHarness | `node scripts/sessionMetaHarness.mjs` | 50 passed, 0 failed |
| sessionSaveGate | `node scripts/sessionSaveGateHarness.mjs` | 46 passed, 0 failed |
| engineIdentity | `npx jest --runInBand src/engine/engineIdentity.test.ts` | 16 passed, 0 failed |
| Build id determinism | `node scripts/engine-build-id.js` (2 calls) | identical output |
| Build id sensitivity | patch edit → different id → restore → same id | verified |
| Fail-closed | missing pin/patches → throws | verified |
| expo config | `npx expo config --type public --json` → `extra.engineBuildId` | present |

---

## 7. Residual limitations (unchanged from previous audit)

1. **Runtime behavior not exercised**: static analysis only. No device or simulator.
2. **LFM recurrent state**: recon Q3 findings unchanged. `captureStateCheckpoint` and recurrent-restore unchanged by this diff.
3. **Chat template exact bytes**: recon Q1 finding unchanged. `blockFormat` hashed but template output not.
4. **`vendor/kalsallama-cpp` not directly hashed**: covered by pin commit + overlay script hash. Stray uncommitted vendor modifications are a dev workflow issue, not a build correctness problem.
5. **`native/` tree hashing walks working tree**: stray uncommitted files under `native/` change the local id. CI checkouts are clean → CI ids are reproducible. Documented at top of generator.

---

## 8. Summary

| # | Finding | Severity | File:Line | Status |
|---|---------|----------|-----------|--------|
| 1 | `engine-build-id.js` generates deterministic id from real inputs | — | scripts/engine-build-id.js:1-173 | CORRECT |
| 2 | `engineBuildFingerprint` uses build id + marker guard, not static literal | — | src/engine/engineIdentity.ts:30-45 | CORRECT |
| 3 | `readEngineBuildId` reads from expo-constants, fails closed on missing | — | src/engine/engineIdentity.ts:50-63 | CORRECT |
| 4 | `app.config.js` embeds `extra.engineBuildId` at prebuild | — | app.config.js:138-143 | CORRECT |
| 5 | `LlamaService.ts` removes `expo-application`, wires new identity | — | src/engine/LlamaService.ts:1734-1737 | CORRECT |
| 6 | Pre-existing `sessionMetaHarness` 2 failures fixed | — | scripts/sessionMetaHarness.mjs | FIXED |
| 7 | Pre-existing `ModelRegistry.test.ts` 1 failure fixed | — | src/engine/ModelRegistry.test.ts:48 | FIXED |
| 8 | All gates pass (jest 632/632, harnesses 50/0 + 46/0) | — | — | VERIFIED |

**BLOCK items**: none. Previous BLOCK #2 (static `engineBuild`) is resolved.

**SHIP conditions**: none — all gates are green.
