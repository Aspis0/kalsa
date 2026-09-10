# SESSION ENGINE IDENTITY FIX — e2e09f5 (2026-09-10)

**Repo**: `/Users/marco/Projects/kalsa` (main)
**Base commit**: `e2e09f5` (`fix(session): bind the saved KV to the model file and the engine build`)
**Scope of this fix**: audit `SESSION-IDENTITY-AUDIT-e2e09f5-2026-09-10.md` item **#2 / BLOCK** — `engineBuild` was not a real identity.
**Status**: **committed locally on `main` as `095466e` (`095466ec5c88a8cf4588b898b00cce632b1c1508`)** — `fix(session): derive engine identity from native build inputs`, 8 files.
**Not pushed. No CI build triggered in this step.** MiMo re-audit verdict: **SHIP (code review)** — `SESSION-ENGINE-IDENTITY-REAUDIT-2026-09-10.md`.

**Local commit contents** (verified via `git ls-tree` / `git cat-file`; 3 additions, 5 modifications):
- `A scripts/engine-build-id.js`
- `A src/engine/engineIdentity.ts`
- `A src/engine/engineIdentity.test.ts`
- `M app.config.js`
- `M src/engine/LlamaService.ts`
- `M src/engine/sessionPersistence.ts`
- `M scripts/sessionMetaHarness.mjs`
- `M src/engine/ModelRegistry.test.ts`

**NEW APK DOES NOT EXIST YET.** The commit is not pushed and no CI build has run, so there is no APK built from this code. The `engineBuildId` transit into a shipped artifact is therefore still **unverified for this commit** (see the LIMIT box in §2.2). Verification requires an `apk.yml` build from `095466e` and inspection of the `app.config` inside that APK.

> **FOR MIMO — CHANGES SINCE YOUR FIRST PASS (2026-09-10, section 6 only)**
> Status update: your re-audit returned **SHIP**, and the 8 audited files are now
> committed locally as `095466e` (not pushed). Sections 1–2 (engine identity
> fix) are unchanged from what you approved. The three post-audit
> test/harness-only changes are in §6:
> 1. `scripts/sessionMetaHarness.mjs` — aligned two stale facts expectations to
>    `MEMORY_FACTS_ON_USER_TAIL` (this was a real CI failure: `apk.yml` runs it;
>    44/2 → 50/0). No production code changed.
> 2. `scripts/sessionMetaHarness.mjs` — added missing `modelFileId` /
>    `engineBuild` mismatch + absent-vs-present identity cases.
> 3. `src/engine/ModelRegistry.test.ts` — stale MiniCPM5 thinking budget
>    (expected 256/512, approved 512/1024/2048 per `acade04`/`899e76b`;
>    `thinkingBudgetsHarness.mjs` case 10 already asserts the approved values).
>    Test expectation only, no registry behaviour changed.
> Re-audit **§6**; sections 1–2 are unchanged. `app.config.js` → APK transit is
> explicitly **unverified for the new code** — see the LIMIT box in §2.2. No
> APK built from `095466e` exists yet (not pushed, no CI run).

---

## 1. The confirmed defect (audit #2)

`engineBuildFingerprint` (LlamaService.ts, pre-fix) returned

```
kalsa-native-patches:app:1
```

for every build. Both components were static:

- `kalsa-native-patches` is a **string literal** in `patches/llama.rn+0.12.8.patch`
  (`cpp/common/common.cpp`), compiled into `librnllama.so`. It is a boolean
  marker, not a build identifier.
- `nativeBuildVersion` came from `expo-application` and read `versionCode`,
  which `app.config.js` never sets (Expo default `1`).

Consequence: changing the kalsallama fork pin or the native patch set did
**not** change the saved-KV identity, so a new engine could silently reuse a
foreign KV. The audit's stated goal ("a new engine build costs one cold start
instead of silently reusing a foreign KV") was not met for engine-only changes.

---

## 2. Fix design (smallest sound integration)

Two pieces, both derived from the *real* committed build inputs:

### 2.1 Build-time identity — `scripts/engine-build-id.js` (new)

Pure, dependency-free Node module that hashes the inputs the native build
actually compiles:

- `native/kalsallama.pin` commit (the fork pin; validated as a 40-char sha)
- every `patches/*.patch` sha256 (the llama.rn bridge/native patch set)
- the `native/` source tree sha256 (bmoe streamer + `GovernorBatteryModule.kt`)
- `scripts/sync-kalsallama.sh` sha256 (the overlay machinery)
- `plugins/withLlamaFromSource.js` sha256 (the source-build machinery)
- `node_modules/llama.rn` package version (the base the patches apply to)
- build variant: `source` (default) vs `prebuilt` (`KALSA_LLAMA_FROM_SOURCE=0`)

Result: `kalsa-eng-v1:<variant>:<sha256>`.
Unreadable input → **throws**, so prebuild fails loudly instead of shipping an
unidentifiable engine (fail closed at build time).

### 2.2 Embedding — `app.config.js` (modified)

```js
const { computeEngineBuildId } = require("./scripts/engine-build-id.js");
// ...
next.extra = { ...next.extra, engineBuildId: computeEngineBuildId(__dirname) };
```

`extra` is embedded by `expo prebuild` into the shipped APK's
`assets/app.config`, and `expo-constants`' `ConstantsService.kt`
(`CONFIG_FILE_NAME = "app.config"`) exposes it as
`Constants.expoConfig.extra`. Verified in this repo:

- `npx expo config --type public --json` → `extra.engineBuildId` =
  `kalsa-eng-v1:source:765509c2…3a65`
- `android/app/build/intermediates/assets/release/mergeReleaseAssets/app.config`
  already exists in the release asset merge path (with `"extra":{}` from the
  previous config), proving the channel reaches the shipped APK.
- `expo-constants` is already imported by `src/telemetry/telemetry.ts` and
  `src/screens/SettingsScreen.tsx`, so no new dependency.

**LIMIT — APK transit not verified on the new code.** No APK built from this
diff exists yet (CI-only native builds, and this Mac builds no APK). The
inspected `mergeReleaseAssets/app.config` is from an **old** build and proves
only the *packaging mechanism* — that `extra` is written into the release
asset merge path — not that this specific `engineBuildId` is embedded in a
shipped artifact. The round-trip `app.config → assets/app.config →
Constants.expoConfig.extra` is a considered mechanism, not an observed fact for
the new code. This must be closed by inspecting the `app.config` inside an APK
built from this commit (apk.yml artifact) before any on-device claim.

### 2.3 Runtime — `src/engine/engineIdentity.ts` (new)

```ts
engineBuildFingerprint(systemInfo, engineBuildId)
```

- `engineBuildId` missing/blank → `null`
- `systemInfo` missing/blank → `null`
- `kalsa-native-patches` marker absent (prebuilt jniLibs) → `null`
- otherwise → `${engineBuildId}:${marker}`

`readEngineBuildId()` lazily reads `expo-constants` and returns `null` on any
failure (Node tests, APK without the config-time id).

`LlamaService.ts` now calls
`engineBuildFingerprint(systemInfo, readEngineBuildId())`. The
`expo-application` / `nativeBuildVersion` dependency is removed — an app version
bump no longer invalidates KV, an engine input change does. Save still fails
closed via the existing `session_identity_unavailable` guard.

---

## 3. Files changed (no docs touched)

| File | Change |
|------|--------|
| `scripts/engine-build-id.js` | **new**, 173 lines — deterministic input hashing |
| `src/engine/engineIdentity.ts` | **new**, 65 lines — pure fingerprint + reader |
| `src/engine/engineIdentity.test.ts` | **new**, 187 lines — 16 tests |
| `src/engine/LlamaService.ts` | remove static fingerprint + `expo-application`; wire new identity (net −9/+3) |
| `app.config.js` | embed `extra.engineBuildId` at prebuild (+8) |
| `src/engine/sessionPersistence.ts` | comment accuracy on the `engineBuild` field (1 line) |
| `scripts/sessionMetaHarness.mjs` | align facts expectations to `MEMORY_FACTS_ON_USER_TAIL`; add identity mismatch cases (post-audit) |
| `src/engine/ModelRegistry.test.ts` | stale MiniCPM5 budget expectation aligned to the approved 512/1024/2048 (post-audit) |

No native/C++ files, no `patches/*.patch`, no `patch-package` run, no
`android/`/APK build on this Mac. Not ignored by git (`git check-ignore` returns
empty for all three new source files).

---

## 4. Test evidence

New suite: `npx jest --runInBand src/engine/engineIdentity.test.ts` →
**16 passed, 16 total**.

Covered:
- fail-closed: missing build id, missing `systemInfo`, missing patch marker
- stable for identical inputs
- **changes when the build id changes** (the audit's core regression)
- **never produces the old static `kalsa-native-patches:app:1`**
- `readEngineBuildId` reads the embedded id; returns `null` when
  `expo-constants` is unavailable
- generator determinism and sensitivity to pin / patch / native tree / variant
- generator reads the real committed inputs and is stable across calls

### Old implementation fails the same tests

Temporarily swapped `engineIdentity.ts` back to the pre-fix logic (same
signature, second argument ignored, `:app:1` tail). Result:

```
Tests: 6 failed, 10 passed, 16 total
```

Failures (all the audit-relevant ones):
`fails closed when the generated engine build id is unavailable`,
`fails closed when the binary lacks the native patch marker`,
`changes when the engine build id changes (pin/patch/variant)`,
`never fabricates the old static identity`,
`keeps the patch marker in the fingerprint`,
`readEngineBuildId › reads the id embedded at prebuild`.

The file was restored immediately; the fixed suite passes again.

### Live end-to-end input sensitivity

```
ID1 = node scripts/engine-build-id.js
edit patches/llama.rn+0.12.8.patch  -> ID2 != ID1
restore patch                       -> ID3 == ID1   (patch sha back to aa7f1926…)
edit native/kalsallama.pin commit   -> ID  != ID1
restore pin                         -> ID  == ID1
```

Both paths that the audit said were invisible now change the identity; restoring
the input restores the exact same id (deterministic).

### Full gates

- `npx tsc --noEmit` → clean.
- `npx jest --runInBand` → **632 passed, 0 failed** (67 suites). Before the
  post-audit alignment below it was 631/1.
- `node scripts/sessionSaveGateHarness.mjs` → 46 passed / 0 failed.
- `node scripts/sessionMetaHarness.mjs` → **50 passed / 0 failed** (was
  44/2 before the post-audit alignment; see §6).
- `node scripts/thinkingBudgetsHarness.mjs` → all cases passed.

---

## 5. Behavioural notes / residual limitations

1. **One-time cold start**: existing formatVersion-2 metas (if any) carry the
   old `engineBuild` string, so they now mismatch once and cold-start. In
   practice e2e09f5 was never shipped to a device, so no real user KV is lost.
2. **Prebuilt opt-out builds**: when `KALSA_LLAMA_FROM_SOURCE=0`, the binary
   lacks the marker → runtime fingerprint `null` → sessions are not saved (fail
   closed). This is intended; the audit's goal is trustworthy identity, not
   identity for an unpatched engine.
3. **`native/` tree hashing** walks the working tree, so a stray uncommitted
   file under `native/` would change the local id. CI checkouts are clean, so
   CI ids are reproducible; documented at the top of the generator.
4. **Binary-side proof**: the generated id encodes the *declared* inputs, while
   the runtime marker proves the `.so` was compiled from patched source. A
   build that ignores the declared inputs would still be caught by the missing
   marker (null) and by `scripts/assert-native-patch.sh`.
5. No device use, no phone files touched, no push. Report only.
6. **APK transit of the new identity is unverified.** See §2.2: only an old
   APK's packaging path was inspected. The new-code APK does not exist yet.

---

## 6. Post-audit additions (new since MiMo's first pass)

These are the **only** changes made after the first report/audit handoff.
Everything in §1–§2 is unchanged.

### 6.1 `scripts/sessionMetaHarness.mjs` — stale facts expectations (CI gate)

`apk.yml` runs this harness, so 44/2 was a real CI failure. The two failures
were stale expectations from before `e2e09f5`: they still assumed memory facts
live in the **system prompt** (`memoryFactsJoined: "fact a"`, and "facts must
change the hash"). Under the decided contract `MEMORY_FACTS_ON_USER_TAIL`
facts ride the **last user message**, so they are deliberately absent from
`computePromptEnvHash` — changing a fact must *not* invalidate the stable
prefix. This is the same contract already pinned in jest by
`memoryPrompt.test.ts` test 4 and `ttftFlags.test.ts`.

Changed:
- canonical-shape assertion now uses `memoryFactsJoined: ""`;
- the facts assertion is inverted (`base === hash(["g"])`, and
  `hash([]) === hash(["some fact"])`), renamed
  `... sensitive to locale / hasTools, not facts (tail mode)`;
- locale, hasTools, null≡[] behaviour kept.

No production behaviour changed — only the harness expectations.

**Proof the new assertions encode the real contract**: against the compiled
harness module,
```
actual === tail canonical  (new assertion)  : true
actual === facts canonical (OLD assertion)  : false
facts change hash under tail mode           : false
```
and the harness went **44/2 → 50/0**, with the two formerly failing cases now passing.

### 6.2 `scripts/sessionMetaHarness.mjs` — identity mismatch cases added

The harness did not cover the e2e09f5 identity fields on the meta layer. Added:
- `mismatch modelFileId → field name`
- `mismatch engineBuild → field name`
- `identity absent-vs-present mismatches` (undefined vs string → mismatch)
- `identity equal on both sides matches` (same identity → match, null field)

This mirrors what `sessionPersistence.test.ts` asserts in jest, now also on the
CI harness path.

### 6.3 `src/engine/ModelRegistry.test.ts` — stale MiniCPM5 budget

The test (added in `7836db7`) pinned `thinking: { short: 256, extended: 512 }`.
Commit `acade04` (owner decision 10/09: "LFM2.5 and dev MiniCPM5 registry
budgets 512/1024") and `899e76b` (nPredict 2048) changed the registry without
updating this expectation. `thinkingBudgetsHarness.mjs` case 10 already asserts
the approved `{512, 1024, nPredict: 2048}` for the low-tier model. So this is a
stale expectation of the approved budget, fixed by updating the test only —
**no registry behaviour changed**. Evidence: `git show acade04 --
src/engine/devModelCatalog.ts` and `git show 899e76b`.

Why it only surfaced now: jest is not run by `apk.yml` (comment at the
harness step), and `ci.yml` runs only on `feat/**`/PRs, so main accumulated the
staleness un-gated.

### 6.4 Gates after 6.1–6.3

- `npx tsc --noEmit` → clean
- `npx jest --runInBand` → **632/632** (67 suites)
- `sessionMetaHarness` → **50/0**
- `sessionSaveGateHarness` → 46/0
- `thinkingBudgetsHarness` → all passed
- `engineIdentity.test.ts` → 16/16

---

## 7. Next step

**Commit status**: local only, `095466e` on `main`. Not pushed, no CI build.

Remaining before any on-device claim:
- push (separate authorized step), then an `apk.yml` CI build from `095466e`;
- inspect the `app.config` inside that APK to confirm `extra.engineBuildId`
  transits the packaging path (closes the §2.2 LIMIT);
- then, and only then, an on-device check that a change of pin/patch/variant
  cold-starts KV while identical inputs reuse it.

Reviewer checklist for a future re-audit:
- for §1–§2: does hashing pin + patches + native + sync/plugin + llama.rn
  version + variant cover every engine-visible input the audit named?
- is the `null` (fail-closed) behaviour reachable in every "unavailable" case?
- **§6.1** — is the facts-in-hash inversion correct under
  `MEMORY_FACTS_ON_USER_TAIL`, and does the harness still fail if the flag is
  flipped?
- **§6.2** — are the added identity mismatch cases sufficient on the harness
  path?
- **§6.3** — is the MiniCPM5 budget `512/1024/2048` indeed the approved one
  (acade04/899e76b), i.e. a stale test and not a behaviour change?
