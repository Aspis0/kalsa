# Hostile read-only audit: `f16903b80265fecc37f56acee86d68e6e47de665`

Subject: detached HEAD in `/Users/marco/Projects/kalsa-wt-landing`, parent `e206a945b` (`origin/main`). `git status` reported `## HEAD (no branch)`, `git rev-parse HEAD` returned `f16903b80265fecc37f56acee86d68e6e47de665`, `git rev-parse HEAD^` returned `e206a945bf39610681bc50b989f5a4d179a0b889`, and `git diff --name-only HEAD^ HEAD` returned only `.github/workflows/build-kalsa-apk.yml`. I inspected that worktree and the named lab report/coder files only.

## 1. Android setup action and downstream steps

**Verdict: CONFIRMED for fixing the reported `tools` lookup failure; PLAUSIBLE for end-to-end compatibility.** The exact failure was `Warning: Failed to find package 'tools'` from `sdkmanager tools` (provided `REPORT.md`, lines 17–21). The action change addresses that exact package request.

The `v4` ref resolved during this audit to `be39fa834029ff78f1a44aa3bb0819b8fc2bd8fd` (`gh api repos/android-actions/setup-android/git/refs/tags/v4`). The metadata at that exact commit says:

> `default: '15859902'` (cmdline-tools, action.yml:9)
>
> `default: 'platform-tools'` (packages, action.yml:24)
>
> `using: node24` (action.yml:27)

At the old `v3` commit `9fc6c4e9069bf8d3d10b2204b1fb8f6ef7065407`, the corresponding lines were `default: '12266719'`, `default: 'tools platform-tools'`, and `using: node20` (`action.yml`:9, 24, 27). So the cmdline-tools default changes from `12266719`/16.0 to `15859902`/22.0; the removed `tools` package is no longer requested by default. This workflow also explicitly supplies `packages: platform-tools` (workflow lines 40–43).

The v4 source at the resolved commit maps `15859902` to short version `22.0` (`case '15859902': return '22.0'`, src/main.ts:10–11) and contains the direct guard:

> `// The 'tools' package is deprecated and no longer served by Google,` (src/main.ts:186)
>
> `if (pkg === 'tools') {` (src/main.ts:189)
>
> `Skipping deprecated package 'tools', it is no longer available in the Android SDK repository.` (src/main.ts:191)

It filters that package before calling `sdkmanager` (src/main.ts:175–200). This is a direct upstream fix, not an inference from the action version number.

**Preinstalled SDK behavior changes in a material but expected way.** v4 first looks for its requested version directory; if that is absent, it accepts `cmdline-tools/latest` only when `source.properties` has the exact requested `Pkg.Revision` (src/main.ts:64–103). Otherwise it downloads the requested version (src/main.ts:106–135). The failing runner had its manager at `/usr/local/lib/android/sdk/cmdline-tools/16.0/bin/sdkmanager` (`REPORT.md`, line 17); the report also records `Found preinstalled sdkmanager in /usr/local/lib/android/sdk/cmdline-tools/latest` (REPORT.md, line 176). Since v4 requests 22.0, it will reject that 16.0 manager and use an existing 22.0 manager if present, otherwise download 22.0 under the SDK root. It still uses the runner's SDK root when `ANDROID_SDK_ROOT` is set: `let ANDROID_SDK_ROOT = process.env['ANDROID_SDK_ROOT'] || ANDROID_HOME_SDK_DIR` (v4 src/main.ts:49–50), then `core.exportVariable('ANDROID_HOME', ANDROID_SDK_ROOT)` and `core.exportVariable('ANDROID_SDK_ROOT', ANDROID_SDK_ROOT)` (v4 src/main.ts:202–204). The equivalent selection/export lines are present in v3 src/main.ts:44–45 and 180–182, so v4 did not change this behavior. It does not read an existing `ANDROID_HOME` to choose the SDK root; it reads `ANDROID_SDK_ROOT`, falling back to `~/.android/sdk`. The existing next step installs the same platform/build-tools/CMake/NDK packages (workflow line 46), through the manager the action adds to `PATH` (v4 src/main.ts:206–207). `platform-tools` is requested twice, once by the action and again on line 46; that is redundant work, not a different SDK root.

The next step still runs:

> `sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" "cmake;3.22.1" "ndk;27.1.12297006"` (workflow:46)

Licences do not regress. Direct quotes:

> `default: 'true'` (v4 action.yml:14)
>
> `sdkManagerExe, '--licenses',` (v4 src/main.ts:169–170)
>
> `java-version: 17` (workflow:38)

v3 has the same license default and call (v3 action.yml:14; v3 src/main.ts:157–164). Google's current `sdkmanager` launcher source says `This tool requires JDK 17 or later` (Google Gitiles, [launcher source](https://android.googlesource.com/platform/prebuilts/cmdline-tools/%2B/db049c98617976c1d4d337c12034ab6e515911cb/tools/bin/sdkmanager), lines 177–180); this job's Java 17 satisfies that requirement. v4's `node24` is the GitHub Action runtime, distinct from the project Node version 20 (workflow lines 30–32) and Java 17.

The source preserves the SDK root and exports `ANDROID_HOME`; the native package request is unchanged; the provenance gate remains before prebuild and Gradle (workflow lines 45–68). I found no apparent downstream break. **PLAUSIBLE**, not confirmed, because this commit has no completed run proving the 22.0 manager, Gradle build, and gates end to end. The extra 22.0 download is a cost/availability dependency worth watching.

## 2. Push/dispatch triggers, concurrency, and combined CI cost

**Verdict: CONFIRMED.** The changed workflow declares `workflow_dispatch` separately from `push`, and under `push` has `branches: [main]` plus the three ignored patterns (workflow lines 3–11). A `main` push runs when any changed path is outside those ignored patterns. This commit's changed path, `.github/workflows/build-kalsa-apk.yml`, matches none of them, so landing this commit on `main` triggers the APK workflow. A docs-only push is suppressed. GitHub documents `paths-ignore` as a `push`/`pull_request` filter and says a push runs if any changed path does not match an ignored pattern ([workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore)). It does not filter the separate `workflow_dispatch` event; manual dispatch still runs for a docs-only ref.

The APK workflow concurrency key is `build-kalsa-apk-${{ github.ref }}` with `cancel-in-progress: true` (workflow lines 16–18). E2E independently includes `main` in its push branches and has the same docs ignores (e2e lines 5–12); its group is `e2e-${{ github.ref }}` (e2e lines 34–36). Therefore a qualifying `main` push starts both jobs; their distinct groups do not cancel each other. New runs of either workflow on the same ref can cancel an earlier run of that same workflow.

Measured from `createdAt` to `updatedAt` in the requested `gh run list` output (elapsed run time, not exact billed CPU time):

| Workflow | Completed successful runs observed | Mean elapsed |
|---|---:|---:|
| `build-kalsa-apk.yml` | 3 | 36m 10s |
| `e2e-emulator.yml` | 6 | 1h 08m 30s |
| Combined runner elapsed | — | about 1h 44m 40s |

The three successful APK rows were `33143387783` = 39m30s, `33138362611` = 30m53s, and `33119894980` = 38m07s. The six successful E2E rows were `35491509270` = 1h07m39s, `35488652462` = 1h02m25s, `35483990916` = 1h08m01s, `35463404191` = 1h07m15s, `35444601804` = 1h07m08s, and `35432343219` = 1h18m30s; each returned E2E row was `event: push`, `headBranch: main`. The workflows run in separate concurrency groups. If both get runners at the same time, wall time should be near the longer E2E run; aggregate runner time is roughly 105 minutes per qualifying push.

## 3. The “~2 h APK build” comment

**Verdict: REFUTED.** The comment says `# A ~2 h APK build is pointless for docs-only commits.` (workflow line 7). The successful APK runs measured above are 30m53s–39m30s, mean 36m10s. The workflow's `timeout-minutes: 120` (line 23) is a maximum, not evidence that builds take two hours. The requested run list returned only four total rows: those three successes and run `35785657656`, a 32-second failure. Nothing in this sample supports a two-hour APK runtime. Even if the author was thinking of the combined APK+E2E runner consumption, the observed combined figure is about 1h45 aggregate, not a two-hour APK build.

## 4. Debuggable APK path and exact fix

**Verdict: REFUTED for this workflow producing a debuggable APK today; CONFIRMED that another manual CI workflow can.** The subject workflow sets `KALSA_DEBUGGABLE` to `1` only when `github.ref == 'refs/heads/bench-dev-models'` (workflow lines 67 and 73). Pushes now build only `main` (line 6), so all automatic APKs from this workflow are non-debuggable. The live remote heads are only `brain`, `main`, `remote-brain`, and `ux-2026-09-21`; `bench-dev-models` exists only as `refs/tags/archive/bench-dev-models`, which cannot match `refs/heads/bench-dev-models`.

The trace is direct: `app.config.js` includes `./plugins/withDebuggableRelease` only when `process.env.KALSA_DEBUGGABLE === "1"` (lines 69–73); that plugin inserts `debuggable true` into the generated Gradle `release` block (plugin lines 15–24). There is no tracked `app.json` at this commit (`git ls-tree <commit> app.json` returned no entry). The separate `.github/workflows/apk.yml` does provide a manual `debuggable` input and a Gradle edit when it is `true` (lines 30–35, 183–215), and labels that artifact `-debuggable` (line 272). Thus CI as a whole can still produce one, but this newly main-triggered workflow cannot, which is a real loss for the stated S23 measurement path.

Minimal fix for this workflow: add a boolean dispatch input; keep every push non-debuggable; distinguish manual debuggable runs in their concurrency group and artifact name. The normal artifact name remains unchanged, while debug artifacts are labeled. The provenance check stays before prebuild, unchanged (workflow lines 58–68).

```diff
 on:
-  workflow_dispatch:
+  workflow_dispatch:
+    inputs:
+      debuggable:
+        description: Build a debuggable release APK for device measurements
+        required: false
+        type: boolean
+        default: false
   push:
     branches: [main]
@@
 concurrency:
-  group: build-kalsa-apk-${{ github.ref }}
+  group: build-kalsa-apk-${{ github.ref }}-${{ github.event_name == 'workflow_dispatch' && inputs.debuggable && 'debuggable' || 'release' }}
   cancel-in-progress: true
@@
       - name: Prebuild Android native project
         env:
           KALSA_LLAMA_FROM_SOURCE: "1"
-          KALSA_DEBUGGABLE: ${{ github.ref == 'refs/heads/bench-dev-models' && '1' || '0' }}
+          KALSA_DEBUGGABLE: ${{ github.event_name == 'workflow_dispatch' && inputs.debuggable && '1' || '0' }}
@@
       - name: Build arm64 release APK
         env:
           KALSA_LLAMA_FROM_SOURCE: "1"
-          KALSA_DEBUGGABLE: ${{ github.ref == 'refs/heads/bench-dev-models' && '1' || '0' }}
+          KALSA_DEBUGGABLE: ${{ github.event_name == 'workflow_dispatch' && inputs.debuggable && '1' || '0' }}
@@
-          name: kalsa-apk-arm64-v8a-${{ github.sha }}
+          name: kalsa-apk-arm64-v8a${{ github.event_name == 'workflow_dispatch' && inputs.debuggable && '-debuggable' || '' }}-${{ github.sha }}
```

## 5. Other stale branch/ref references in this file

**Verdict: CONFIRMED, but only for the two stale `bench-dev-models` conditions already identified above.** `git ls-remote --heads origin` returned `refs/heads/brain`, `refs/heads/main`, `refs/heads/remote-brain`, and `refs/heads/ux-2026-09-21`; it returned no `refs/heads/bench-dev-models` or `refs/heads/engine-pin-kalsallama`. `refs/tags/archive/bench-dev-models` exists, but neither stale expression matches that tag. The remaining live branch filter is `branches: [main]` (workflow line 6). Search of this file found no other branch/tag names (`rg` hits were lines 6, 17, 67, and 73).

## 6. Security

**Verdict: REFUTED for expression-to-shell injection; CONFIRMED for a limited checkout-token persistence exposure; note the action tag is not immutable.** The workflow has only `permissions: contents: read` (lines 13–14), no `secrets.*` references, and no dispatch inputs today. The only expressions are `github.ref` in concurrency/environment, `github.sha` in the artifact name, and those same environment expressions (workflow lines 17, 67, 73, 111). No expression interpolates user-controlled text directly into a `run:` command. `github.ref` is passed as an environment value and compared to a fixed string; shell commands do not splice it into source text.

The checkout step does use the default credential behavior: the workflow sets `submodules: recursive` but does not override `persist-credentials` (workflow lines 25–28). `actions/checkout@v4` declares `token` default `${{ github.token }}` and `persist-credentials` default `true` (its action.yml lines 12–24 and 52–54); its helper configures an `http.../.extraheader` from `settings.authToken` (src/git-auth-helper.ts lines 56–61). That leaves the read-only repository token available to subsequent build scripts through local Git config until checkout's post-job cleanup. This is not a write-capable token or an explicit repository secret, but it is unnecessary credential exposure if the scripts only need public Git fetches.

The new Android action is referenced as `android-actions/setup-android@v4` (workflow line 41), a movable major tag. It resolved to SHA `be39fa834029ff78f1a44aa3bb0819b8fc2bd8fd` during this audit, so future runs are not guaranteed to execute these exact inspected bytes if upstream moves the tag.

Optional hardening diff (public dependencies/provenance fetches do not need a persisted checkout token; the inspected v4 source can be pinned to the resolved commit):

```diff
       - name: Checkout with submodules
         uses: actions/checkout@v4
         with:
           submodules: recursive
+          persist-credentials: false
@@
       - name: Set up Android toolchain
-        uses: android-actions/setup-android@v4
+        uses: android-actions/setup-android@be39fa834029ff78f1a44aa3bb0819b8fc2bd8fd
```

## Audit verdict

**SHIP-WITH-FIXES.** The v4 change fixes the named `tools` failure. Before treating this as the measurement APK workflow, add the explicit dispatch input and keep `main` pushes non-debuggable as shown above. The credential persistence and floating action tag are security hardening items; they do not create a shell-injection finding.

## Re-audit of 08670fb

Scope: only `git diff f16903b80265fecc37f56acee86d68e6e47de665 08670fb7221a555fd52f69938a066614bffc6d32`. `git diff --name-only` returned:

> `.github/workflows/build-kalsa-apk.yml`

### 1. Match against the prior proposed diff and action pin

**Verdict: CONFIRMED.** The dispatch input, release/debug concurrency suffix, both `KALSA_DEBUGGABLE` expressions, and artifact suffix match the prior section-4 diff exactly. The Android action pin also matches the section-6 SHA exactly; the delta adds an audit comment to it.

Quoted lines from the new commit:

> `type: boolean` / `default: false` (workflow:9–10)
>
> `group: build-kalsa-apk-${{ github.ref }}-${{ github.event_name == 'workflow_dispatch' && inputs.debuggable && 'debuggable' || 'release' }}` (workflow:23)
>
> `KALSA_DEBUGGABLE: ${{ github.event_name == 'workflow_dispatch' && inputs.debuggable && '1' || '0' }}` (workflow:73, 79)
>
> `name: kalsa-apk-arm64-v8a${{ github.event_name == 'workflow_dispatch' && inputs.debuggable && '-debuggable' || '' }}-${{ github.sha }}` (workflow:117)
>
> `uses: android-actions/setup-android@be39fa834029ff78f1a44aa3bb0819b8fc2bd8fd # v4, audited 2026-09-23` (workflow:47)

One part of the prior section-6 *optional* hardening diff is absent: the checkout step still does not set `persist-credentials: false`. The action SHA pin itself is exact; the optional checkout-token mitigation was not included.

### 2. Hand evaluation of the three expression forms

**Verdict: CONFIRMED.** The table assumes workflow dispatch selects `refs/heads/main`, so all rows use the same `github.ref`. If dispatch selects another branch or tag, substitute that actual ref in the concurrency group; the debug suffix and artifact name are unchanged.

The workflow declares `debuggable` as Boolean with default `false` (workflow:5–10). The three expression forms appear at workflow:23, 73/79, and 117. GitHub's context reference says:

> `inputs | object | Contains the inputs of a reusable or manually triggered workflow.` (contexts reference, line 68)
>
> `If you attempt to dereference a nonexistent property, it will evaluate to an empty string.` (contexts reference, line 76)
>
> `concurrency | github, inputs, vars` (contexts reference, line 115)

The expression reference lists `&&` as AND and `||` as OR (lines 60–73) and says falsy values include `false` and `""` (line 45). These rules cover the push case and establish that the workflow-level group can legally read `inputs`.

| Event and input | Concurrency group | Both `KALSA_DEBUGGABLE` steps | Artifact name (`<sha>` = `github.sha`) |
|---|---|---|---|
| Push to `main`; `inputs` empty | `build-kalsa-apk-refs/heads/main-release` | `0` | `kalsa-apk-arm64-v8a-<sha>` |
| Dispatch on `main`; `debuggable=false` | `build-kalsa-apk-refs/heads/main-release` | `0` | `kalsa-apk-arm64-v8a-<sha>` |
| Dispatch on `main`; `debuggable=true` | `build-kalsa-apk-refs/heads/main-debuggable` | `1` | `kalsa-apk-arm64-v8a-debuggable-<sha>` |

For the audited commit as the run's `github.sha`, those artifact names expand to `kalsa-apk-arm64-v8a-08670fb7221a555fd52f69938a066614bffc6d32` and `kalsa-apk-arm64-v8a-debuggable-08670fb7221a555fd52f69938a066614bffc6d32` respectively.

**Push cannot produce `KALSA_DEBUGGABLE=1`.** On a push, `github.event_name == 'workflow_dispatch'` is false. Therefore the entire `&&` chain is false before it can yield the literal `'1'`; the `|| '0'` fallback yields `'0'`. In addition, `inputs.debuggable` is absent/empty on push, which is falsy. This is true at both env assignments (workflow:73, 79). The workflow's trigger block distinguishes the events directly:

> `workflow_dispatch:` (workflow:4)
>
> `push:` / `branches: [main]` (workflow:11–12)

### 3. Artifact-name consumers and rename safety

**Verdict: CONFIRMED; no consumer break found.** The normal release/false artifact name is unchanged from the parent: the empty suffix produces the old `kalsa-apk-arm64-v8a-<sha>` string. The new debug artifact uses the established `-debuggable-<sha>` form.

The exact worktree search `git grep -n 'kalsa-apk-arm64' 08670fb` found the upload expression at `.github/workflows/build-kalsa-apk.yml:117` and historical campaign/archive paths. The exact search over `/Users/marco/Projects/kalsa-moe-experiments/scripts` for `kalsa-apk-arm64`, `gh run download`, or `download-artifact` returned no matches. A broader lab code search found one hard-coded old local APK path in a smoke script:

> `APK_B="$HOME/kalsa-qdc/apk/apk-B-09bdfe9/kalsa-apk-arm64-v8a-09bdfe949403db7cd793da9471c5a78c50d62966/app-release.apk"` (`scratchpad/agents/qdc-apk-smoke-61/d_run.sh:15)

That fixed path names a different historical SHA/run; it does not resolve this workflow's artifact name. The app's `scripts/benchAggregate.mjs` mentions `actions/download-artifact` for `all-results/<artifact-name>/result.json` (line 7), not APKs. A lab handoff documents a manual debug-artifact download, and the new debug name conforms to its quoted command:

> `gh run download <run> -n kalsa-apk-arm64-v8a-debuggable-<sha> -D <dir>` (`llama-rn-fork/HANDOFF.md:928)

The matching `campaigns/ciswire.json` and archived report paths are hard-coded historical APK paths, not consumers of this workflow's generated name. No executable consumer tied to this workflow's output requires a different name.

### 4. New issues

**Verdict: REFUTED for a functional regression; PLAUSIBLE for the revised runtime comment.** The new `# An APK build (~35 min) is pointless for docs-only commits.` (workflow:13) is a reasonable rounding of the prior three-success mean of 36m10s; the observed range was 30m53s–39m30s. The input is Boolean, push is forced to `0`, true dispatch produces the intended debuggable release variant, and mode-specific concurrency groups avoid cancelling a release build with a debug dispatch on the same ref. The exact retained lines are `run: bash scripts/assert-engine-provenance.sh` (workflow:68), `run: bash scripts/assert-native-patch.sh` (workflow:95), and `android/app/build/outputs/apk/release/app-release.apk` (workflow:119). The action pin is the already audited SHA.

The one earlier optional hardening item still absent is `persist-credentials: false`; it is not introduced by this delta and does not invalidate the exact pin or the functional fix. No workflow was run as part of this read-only re-audit.
