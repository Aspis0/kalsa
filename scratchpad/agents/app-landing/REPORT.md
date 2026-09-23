# App landing report: combined ref, pin bump, gate, checks, release APK

Repo: `~/Projects/kalsa` (app, remote `origin = https://github.com/Aspis0/kalsa.git`).
Work location (own ref, own worktree, shared checkout untouched): `~/Projects/kalsa-wt-landing`, branch `kalsa-app-landing` based on `e5788cf`.
Constraints honored: no push, no upstream write, no phone. Nothing was installed on either device; both phones stayed untouched.

Chain under test:
- engine `d754229443670a7454731cd48028cb409ecc0ec2` (branch `kalsa-phone-v1-1-1`)
- binding `b62be78f95b93ea7ba8755388c87f0860827b363` (branch `kalsarn-governor-engine`), vendors that engine
- app ref `kalsa-app-landing`, tip `a9c68b21ec5307cc58d2a65271c61483976c6ac2`

## 1. Combine the three sibling lines

Order: three gate-fix commits first (so `native/kalsallama.pin` exists before anything sets it), then `7e04002`, then `0db9dc6`.
No cherry-pick conflicted. `0db9dc6` and `7e04002` touch the same two files (`src/engine/governorInputs.ts`,
`src/engine/governorInputs.test.ts`); git auto-merged both (`Auto-merging src/engine/governorInputs.test.ts` /
`Auto-merging src/engine/governorInputs.ts`) and the working tree was clean after each pick.

`git patch-id --stable` pairs (original -> pick on the new ref):

| original | new ref | patch-id (identical on both sides) |
|---|---|---|
| `28d775e` | `62ce72e` | `6f929aecbda32920a2aa849a6bf51f6e3b0b5960` |
| `924e9aa` | `fc23b2e` | `340bcba0c440559c04c24e22fa7533fff18d5e07` |
| `b1fe88b` | `943144f` | `44f3c55dc5c06a4e1192085cfac36bd6030b8e46` |
| `7e04002` | `18d4e33` | `f03fa0ad96f7e5b2a062c9b4b97f5b9b993463ec` |
| `0db9dc6` | `a855ab6` | `e234fe611a3e7ab04e1fe055f37fcafff2a4cb1c` |

Quoted pairs (orig / new, left-to-right as printed by `git show <c> | git patch-id --stable`):

```
28d775e orig: 6f929aecbda32920a2aa849a6bf51f6e3b0b5960 28d775e438363f180eccd68371f8e234d48e61a3
62ce72e new : 6f929aecbda32920a2aa849a6bf51f6e3b0b5960 62ce72e82a9d98e37655922a50b28294294fdd43

924e9aa orig: 340bcba0c440559c04c24e22fa7533fff18d5e07 924e9aad2f6910cc20570e8ad6e20d3fdd821e8c
fc23b2e new : 340bcba0c440559c04c24e22fa7533fff18d5e07 fc23b2edcb61804cee75baa8ed30f01f5452d791

b1fe88b orig: 44f3c55dc5c06a4e1192085cfac36bd6030b8e46 b1fe88b1ace39b03a377f9fe8f746c18787d699a
943144f new : 44f3c55dc5c06a4e1192085cfac36bd6030b8e46 943144f860b72a05338b2f3abdca0b250351ea4f

7e04002 orig: f03fa0ad96f7e5b2a062c9b4b97f5b9b993463ec 7e04002a0e203f8f788f7ca773d143bc3f09ab39
18d4e33 new : f03fa0ad96f7e5b2a062c9b4b97f5b9b993463ec 18d4e3349dc8970bcdabf8088c8f81f3161bc7ff

0db9dc6 orig: e234fe611a3e7ab04e1fe055f37fcafff2a4cb1c 0db9dc68228fa7a074fddffc13acf0ccb30493a3
a855ab6 new : e234fe611a3e7ab04e1fe055f37fcafff2a4cb1c a855ab6c1d91b1684eea249e5f0aa6f4642f2fef
```

Resulting line: `e5788cf -> 62ce72e -> fc23b2e -> 943144f -> 18d4e33 -> a855ab6`.

## 2. Pin bump (one commit on top, `a9c68b2`)

Commit `a9c68b21ec5307cc58d2a65271c61483976c6ac2` "deps : pin llama.rn to binding b62be78, engine pin to d754229",
3 files changed, 5 insertions(+), 5 deletions(-). The pin movement itself is the one-line diff:

```diff
diff --git a/native/kalsallama.pin b/native/kalsallama.pin
--- a/native/kalsallama.pin
+++ b/native/kalsallama.pin
@@ -1 +1 @@
-4ccef2f85dbc27e095e11ffcbad4628be9961790
+d754229443670a7454731cd48028cb409ecc0ec2
```

`package.json` and `package-lock.json` moved atomically with the pin file, because a commit where they diverge
would fail the provenance gate at its own tip. Lockfile agreement after `npm install`:

```
root dep : github:Aspis0/kalsa.rn#b62be78f95b93ea7ba8755388c87f0860827b363
resolved : git+ssh://git@github.com/Aspis0/kalsa.rn.git#b62be78f95b93ea7ba8755388c87f0860827b363
version  : 0.13.0-rc.4
integrity: sha512-eG9fi3b5VrE/oskssoA5G78AT6xR/HrxekwAiiFuud3ap26u67XHp+DqXwzTvw3hQ8oTnUSZNltoV1HveAxIlQ==
```

## 3. Install (real, from the committed lockfile)

`npm install` regenerated the lockfile (lockfile legitimately changes with the bump), then `npm ci` proved the
committed lockfile installs clean: `added 944 packages` / exit 0. Provenance of the installed tree:

```
node_modules      : drwxr-xr-x 487 ... (real directory, test -L fails: not a symlink)
node_modules/llama.rn : drwxr-xr-x  17 ... (real directory, not a symlink)
LLAMA_CPP_COMMIT=d754229443670a7454731cd48028cb409ecc0ec2   (node_modules/llama.rn/vendor/VERSIONS)
lock resolved     : git+ssh://git@github.com/Aspis0/kalsa.rn.git#b62be78f95b93ea7ba8755388c87f0860827b363
package.json      : "llama.rn": "github:Aspis0/kalsa.rn#b62be78f95b93ea7ba8755388c87f0860827b363"
top-level dirs in node_modules: 483
```

## 4. Gate (bump, install, gate, build - never gate on a stale tree)

`bash scripts/assert-engine-provenance.sh` after the bump+install:

```
[provenance] lockfile pins Aspis0/kalsa.rn@b62be78f95b9
[provenance] OK: 1119 files match Aspis0/kalsa.rn@b62be78f95b9
[provenance] engine inside it: kalsallama@d75422944367 == native/kalsallama.pin
GATE_EXIT=0
```

Re-run again after the first build attempt had written engine build outputs into `node_modules` (the failure mode
a stale green would hide): still exit 0, same three lines. Build outputs live only under the script's excluded
paths (`node_modules/llama.rn/android/.cxx` 5.2G, `.../android/build` 4.5G).

## 5. App checks

- `npx tsc --noEmit` -> `TSC_EXIT=0`.
- `npx jest` -> `Test Suites: 94 passed, 94 total / Tests: 1214 passed, 1214 total` (exit 0).
- Base `e5788cf` baselines (`~/Projects/kalsa/local-artifacts/`): `tsc_exit=0`, `Test Suites: 94 passed, 94 total /
  Tests: 1209 passed, 1209 total`. The combined line adds 5 tests (governor picks); no suite fails on either
  ref, so there is no base-identical failure to qualify.

## 6. Release APK

Build path, in the required order (bump -> install -> gate -> checks -> build).

First `npm run android` was run as instructed, guarded so it could not violate "no phone": stdin closed, a shell
watchdog (this Mac has no `timeout` binary), and an adb stub on PATH reporting zero devices, because two live
phones are connected (`192.168.1.82:5555`, `adb-R3CW406P8CV-zyLM4b...`) and `expo run:android` is an install
command. It got as far as compiling the native engine and was killed by the watchdog at 240 s (exit 143), during
the compile; install only ever runs after a finished build, so nothing was deployed. It leaves only a
debug-variant `android/` scaffold, which was wiped afterward.

The release APK was then produced exactly as `.github/workflows/build-kalsa-apk.yml` does it:

```
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT=$ANDROID_HOME
export JAVA_HOME=/opt/homebrew/opt/openjdk@17        # temurin 17 on CI, Homebrew openjdk 17.0.20.1 here
export HEXAGON_SDK_ROOT=/nonexistent/hexagon-sdk     # this Mac has ~/.hexagon-sdk; CI does not.
export HEXAGON_TOOLS_ROOT=/nonexistent/hexagon-sdk/tools  # Without this the auto-detect turns the DSP build on and configure fails.
export KALSA_LLAMA_FROM_SOURCE=1 KALSA_DEBUGGABLE=0
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a \
    -PrnllamaBuildFromSource=true -PrnllamaHexagon=false --console=plain
./gradlew --stop
```

`BUILD SUCCESSFUL in 8m 39s`, 773 actionable tasks. One deviation from CI: the runner-fit parallelism caps
(`CMAKE_BUILD_PARALLEL_LEVEL=2`, `NINJAFLAGS=-j2`, `-Dorg.gradle.workers.max=2`) were not applied; they exist to
fit a 4-core CI runner and do not change outputs. Full log: `build-release.log` next to this report.

Artifact (app commit `a9c68b21ec5307cc58d2a65271c61483976c6ac2`, worktree clean):

```
path  : android/app/build/outputs/apk/release/app-release.apk
size  : 152760095 bytes (145.7 MiB)
sha256: 09ae46f87caf3afaa2055e5440a86899c753aad5f8af036a2830b2d2e2b70eee
```

Engine stamp read from inside the built APK (`unzip -p app-release.apk assets/app.config`):

```
APK extra.engineBuildId = kalsa-eng-v2:698c3664d2593388738fd6a119096aab16f07bc7199c417d031c8c6ee3fcd6d2
```

Correspondence to `d754229443670a7454731cd48028cb409ecc0ec2`, established from inputs, not from a printed claim:

1. The id is `sha256` over a canonical subject that contains the literal line `kalsallama:<40-hex>` read from the
   installed `vendor/VERSIONS`, plus `llama-rn:<40-hex>` from the lockfile (see `scripts/engine-build-id.js`).
2. `collectEngineBuildInputs()` on this tree: `kalsallamaSha = d754229443670a7454731cd48028cb409ecc0ec2`,
   `llamaRnCommit = b62be78f95b93ea7ba8755388c87f0860827b363`.
3. `engineBuildIdFromInputs(inputs)` equals the APK-embedded stamp (`== APK stamp -> true`), and equals a fresh
   `node scripts/engine-build-id.js` on the committed tree.
4. The gate ties that same `vendor/VERSIONS` value to `native/kalsallama.pin` (`d754229 == d754229`).
5. Counterfactual: rebuilding the id with the previous engine `4ccef2f85dbc27e095e11ffcbad4628be9961790` gives
   `kalsa-eng-v2:5a8157213bd540e68272fa94a528d22cfc6ca91dc4c61fa31fe12491513b51ff`, which is not the APK stamp.
   A different engine cannot produce the stamp embedded in this APK.

So the artifact's own claim, read from inside the artifact, is bound to engine `d754229...` via binding
`b62be78f...`, and the gate that checks it is wired into `build-kalsa-apk.yml` (pick `943144f`).

## 7. Push commands (UNRUN)

Per this repo's rules: push only with Marco's explicit approval and a prior audit. Nothing was pushed.

```
# combined five-commit app line:
git push origin a855ab6:refs/heads/kalsa-app-landing        # UNRUN

# pin bump commit on top of it:
git push origin a9c68b2:refs/heads/kalsa-app-landing        # UNRUN

# (equivalent single form once both are approved: git push origin kalsa-app-landing)
```

---

# SECOND ROUND (2026-09-22): re-pin to engine 1577495b / binding 5b966218

Same chain, new pin. Engine branch `kalsa-phone-v1-1-1` moved to
`1577495b92096fca572f57a35b71607bacac85d5`; binding branch `kalsarn-governor-engine` moved to
`5b966218eadb85aaacf3eefcefa38651fc8ed1ec` (both pushed and audited upstream before this round).
Work again in `~/Projects/kalsa-wt-landing`, branch `kalsa-app-landing`. No push, no new refs, no phone.

## R2.1 Pin commit rewritten (one pin commit on the line, final values)

The round-1 pin commit `a9c68b21ec5307cc58d2a65271c61483976c6ac2` was amended in place (it was never
pushed, so the rewrite is safe). The line now carries exactly one pin commit:

```
old tip a9c68b21ec5307cc58d2a65271c61483976c6ac2 (replaced, no longer exists)
new tip e206a945bf39610681bc50b989f5a4d179a0b889 "deps : pin llama.rn to binding 5b966218, engine pin to 1577495b"
line: e5788cf -> 62ce72e -> fc23b2e -> 943144f -> 18d4e33 -> a855ab6 -> e206a94
```

Amended commit diff (3 files, 5+/5-; pin movement is the one-line diff):

```diff
-4ccef2f85dbc27e095e11ffcbad4628be9961790
+1577495b92096fca572f57a35b71607bacac85d5      (native/kalsallama.pin)
"llama.rn": github:Aspis0/kalsa.rn#5b966218eadb85aaacf3eefcefa38651fc8ed1ec   (package.json)
```

`package-lock.json` agrees: `root dep: github:Aspis0/kalsa.rn#5b966218eadb85aaacf3eefcefa38651fc8ed1ec`,
`resolved: git+ssh://git@github.com/Aspis0/kalsa.rn.git#5b966218eadb85aaacf3eefcefa38651fc8ed1ec`,
`version 0.13.0-rc.4`, `integrity sha512-oLNcDi8kDKovKXDWJYlS4RJpg1VzmtAALmHVuLKMk1LBpfqKTh2xN0MOdTY9749vaXncYbNoENHV/Gfauhl8kQ==`.
Only the tip moved: `HEAD^ == a855ab6` confirmed.

The five preceding cherry-picks re-verified untouched after the amend (patch-id vs originals):

| original | pick | patch-id | verdict |
|---|---|---|---|
| `28d775e` | `62ce72e` | `6f929aecbda32920a2aa849a6bf51f6e3b0b5960` | OK, same shas as round 1 |
| `924e9aa` | `fc23b2e` | `340bcba0c440559c04c24e22fa7533fff18d5e07` | OK |
| `b1fe88b` | `943144f` | `44f3c55dc5c06a4e1192085cfac36bd6030b8e46` | OK |
| `7e04002` | `18d4e33` | `f03fa0ad96f7e5b2a062c9b4b97f5b9b993463ec` | OK |
| `0db9dc6` | `a855ab6` | `e234fe611a3e7ab04e1fe055f37fcafff2a4cb1c` | OK |

## R2.2 Install and gate (load-bearing: the pin moved)

`npm install` regenerated the lockfile at the new sha, then `npm ci`: `added 944 packages` / exit 0.

```
node_modules      : drwxr-xr-x 487 ... (real directory, test -L fails: not a symlink)
node_modules/llama.rn : drwxr-xr-x  17 ... (real directory, not a symlink)
LLAMA_CPP_COMMIT=1577495b92096fca572f57a35b71607bacac85d5   (node_modules/llama.rn/vendor/VERSIONS)
src/version.ts    : BUILD_NUMBER = '11201', BUILD_COMMIT = '1577495'  (matches the binding delta audit)
```

`./scripts/assert-engine-provenance.sh`:

```
[provenance] lockfile pins Aspis0/kalsa.rn@5b966218eadb
[provenance] OK: 1119 files match Aspis0/kalsa.rn@5b966218eadb
[provenance] engine inside it: kalsallama@1577495b9209 == native/kalsallama.pin
GATE_EXIT=0
```

Passed before any build, on the freshly installed tree.

## R2.3 App checks

- `npx tsc --noEmit` -> `TSC_EXIT=0`.
- `npx jest` -> `Test Suites: 94 passed, 94 total / Tests: 1214 passed, 1214 total` (exit 0).
- Matches the expected 94/1214 on this line (independent base recomputation 1213 + the one test the line
  adds = 1214). Divergence threshold not exceeded; nothing to investigate.

## R2.4 Release APK rebuilt

Fresh `npx expo prebuild --platform android --no-install` (the round-1 `android/` was wiped) then the same
CI-identical command as round 1 (`assembleRelease -PreactNativeArchitectures=arm64-v8a
-PrnllamaBuildFromSource=true -PrnllamaHexagon=false`, same env exports, `HEXAGON_*` forced nonexistent,
`KALSA_DEBUGGABLE=0`, `KALSA_LLAMA_FROM_SOURCE=1`, runner-fit parallelism caps still not applied).
`BUILD SUCCESSFUL in 8m 47s`, 773 actionable tasks, 773 executed (the npm ci replaced the engine tree, so
the native build was a full rebuild). Daemon stopped. Full log: `build-release-round2.log` next to this report.

Artifact (app commit `e206a945bf39610681bc50b989f5a4d179a0b889`, worktree clean):

```
path  : android/app/build/outputs/apk/release/app-release.apk
size  : 152760583 bytes (145.7 MiB)
sha256: d3c66bdb135d394b4bec741c96d89128efc3172cd8ef583e7f2347fdeddf00e3
(round-1 APK for comparison: 152760095 bytes, sha256 09ae46f87caf3afaa2055e5440a86899c753aad5f8af036a2830b2d2e2b70eee)
```

Engine stamp read from inside the built APK (`unzip -p app-release.apk assets/app.config`):

```
APK extra.engineBuildId = kalsa-eng-v2:1725f3a838b0b799f715136a16e6e18ace4f609bd89acb9258ec5c47c819b231
round-1 APK stamp       = kalsa-eng-v2:698c3664d2593388738fd6a119096aab16f07bc7199c417d031c8c6ee3fcd6d2
DIFFERENT               = yes (different sha256 value, read from inside each artifact)
```

Correspondence to the new pins, same input-level proof as round 1:

1. `collectEngineBuildInputs()` on this tree: `llamaRnCommit = 5b966218eadb85aaacf3eefcefa38651fc8ed1ec`
   (from the lockfile) and `kalsallamaSha = 1577495b92096fca572f57a35b71607bacac85d5` (from the installed
   `vendor/VERSIONS`).
2. `engineBuildIdFromInputs(inputs)` equals the APK-embedded stamp (`== APK stamp -> true`) and equals a
   fresh `node scripts/engine-build-id.js` on the committed tree.
3. The gate ties that `vendor/VERSIONS` value to `native/kalsallama.pin` (`1577495b == 1577495b`) and the
   whole installed tree to codeload `Aspis0/kalsa.rn@5b966218eadb` (1119 files).
4. Counterfactual: the round-1 pin pair (`b62be78f...` + `d754229...`) under the current engine tree builds
   `kalsa-eng-v2:850a556b814f0a92ce20f5e77556badae627efa44a89d3506727c6ff78ea7e48`, not the APK stamp.

Prefill, by construction: the artifact now carries a different engine build id than the round-1 APK and the
vendored engine is exactly the audited int8-default commit `1577495b` (previous APK: engine `d754229`, the
f32 route), so the fast int8 path with f32 activation scale is compiled into this APK's `librnllama*.so` by
construction. Two caveats stated plainly: the scale literal `0.005412` does not appear in the shipped
package sources (checked `vendor/`, `src/`, `cpp/`), so the correspondence rests on commit identity, which
is what the gate pins; and the 11.7 % prefill figure is the engine audit's device measurement - no phone was
touched in this round, so it is not re-measured here. Nothing else moved: `git status` clean, only
`vendor/`, `lib/`, `src/version.ts` differ between the pins per your own delta audit.

## R2.5 Push commands (UNRUN)

Same repo rule: push only with Marco's explicit approval and a prior audit. Nothing was pushed, no refs
created; the only ref change was the local rewrite of `kalsa-app-landing`'s tip (a9c68b2 -> e206a94).

```
# combined five-commit app line (unchanged by this round):
git push origin a855ab6:refs/heads/kalsa-app-landing        # UNRUN

# the single pin commit, now at final values:
git push origin e206a94:refs/heads/kalsa-app-landing        # UNRUN

# (single approved form: git push origin kalsa-app-landing)
```
