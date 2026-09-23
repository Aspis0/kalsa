# CI failure report: run 35785657656 fails in `Set up Android toolchain`

Repo read: worktree `/Users/marco/Projects/kalsa-wt-landing`, verified
`git rev-parse --short=9 HEAD` → `e206a945b` before any read.
Read-only session; no files in `/Users/marco/Projects/kalsa` were touched; nothing edited or pushed.

## 1. Failing step and exact error

`gh run view 35785657656 --log-failed > /tmp/ci-fail.log 2>&1; echo $?` → `0`.
Failing step: **`Set up Android toolchain`** (job `apk`, died at 23s; the provenance gate
step `Assert the installed engine is the pinned fork commit` never ran — see the skipped
list in `gh run view 35785657656`).

Verbatim from `/tmp/ci-fail.log` (tail -60):

```
apk	Set up Android toolchain	2026-09-22T21:17:18.7238536Z [command]/usr/local/lib/android/sdk/cmdline-tools/16.0/bin/sdkmanager tools
apk	Set up Android toolchain	2026-09-22T21:17:20.4240633Z [===                                    ] 10% Computing updates...
apk	Set up Android toolchain	2026-09-22T21:17:20.4240633Z Warning: Failed to find package 'tools'
apk	Set up Android toolchain	2026-09-22T21:17:20.4506316Z /home/runner/work/_actions/android-actions/setup-android/v3/dist/index.js:1823
apk	Set up Android toolchain	2026-09-22T21:17:20.4509161Z Error: The process '/usr/local/lib/android/sdk/cmdline-tools/16.0/bin/sdkmanager' failed with exit code 1
apk	Set up Android toolchain	2026-09-22T21:17:20.4515825Z Node.js v24.19.0
```

(The lines just above the tail are sdkmanager dumping the SDK license text, then
`Accept? (y/N): All SDK package licenses accepted` — licenses were accepted fine; the
failure is the package lookup itself.)

Belief check: **CONFIRMED** — the failure is `android-actions/setup-android@v3` running
`sdkmanager tools` against a package Google no longer serves, and it happens before the
provenance gate.

## 2. Every `setup-android` use in `.github/workflows/*.yml`

`grep -rn "setup-android" .github/workflows/` → exactly one hit:

```
.github/workflows/build-kalsa-apk.yml:36:        uses: android-actions/setup-android@v3
```

In context (`.github/workflows/build-kalsa-apk.yml:35-39`, no `with:` — defaults are used):

```yaml
35	      - name: Set up Android toolchain
36	        uses: android-actions/setup-android@v3
37	
38	      - name: Install Android native build packages
39	        run: sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" "cmake;3.22.1" "ndk;27.1.12297006"
```

`grep -rn "setup-android" .github/ | grep -v build-kalsa-apk.yml` → `none elsewhere`.

## 3. What `setup-android@v3` installs by default

Action.yml fetched at the exact ref used. The ref `v3` resolves today to
`gh api repos/android-actions/setup-android/git/ref/tags/v3` →
`9fc6c4e9069bf8d3d10b2204b1fb8f6ef7065407 commit`.
`gh api 'repos/android-actions/setup-android/contents/action.yml?ref=v3' --jq .content | base64 -d`:

```yaml
inputs:
  cmdline-tools-version:
    default: '12266719'
  accept-android-sdk-licenses:
    default: 'true'
  log-accepted-android-sdk-licenses:
    default: 'true'
  packages:
    description: 'Additional packages to install'
    required: false
    default: 'tools platform-tools'
runs:
  using: node20
  main: 'dist/index.js'
```

So the default install is: cmdline-tools `12266719` (only if none preinstalled), accept
licenses, then `sdkmanager tools platform-tools`. **The `packages` input is the one that
changes what gets installed.** Our workflow passes no inputs, so it inherits
`tools platform-tools` — confirmed in BOTH run logs:

```
green: with: ...   packages: tools platform-tools   (2026-08-27T21:49:44)
red:   with: ...   packages: tools platform-tools   (2026-09-22T21:17:07)
```

Releases (`gh release list -R android-actions/setup-android -L 20`):
`v4.0.4 2026-09-17`, `v4.0.3 2026-09-17`, `v4.0.2 2026-09-17`, `v4.0.1 2026-04-04`,
`v4.0.0 2026-03-24`, `v3.2.2 2024-11-09`, `v3.2.1 2024-04-05`, `v3.2.0 2023-11-25`, ...

- Newest v3.x is **v3.2.2 (2024-11-09)**; its action.yml still reads
  `default: 'tools platform-tools'` (fetched at `?ref=v3.2.2`) — no newer v3.x changed it.
- The fix landed in **v4.0.2**, release body verbatim: `Fix for removed tools package.`
  Thanks @vbuberen for the pull request #538`
- `action.yml` at `?ref=v4.0.4`: `packages: default: 'platform-tools'`, and
  `runs: using: node24`, `cmdline-tools-version: default: '15859902'`.

## 4. Why 33119894980 was green and 35785657656 is red

- **The `v3` tag did NOT move.** Both runs downloaded the same SHA:
  green log: `Download action repository 'android-actions/setup-android@v3' (SHA:9fc6c4e9069bf8d3d10b2204b1fb8f6ef7065407)`
  red log:   `setup-android@v3' (SHA:9fc6c4e9069bf8d3d10b2204b1fb8f6ef7065407)`
  — and that is still the tag's SHA today (see §3).
- **Our setup step did not change.** `git log --oneline -- .github/workflows/build-kalsa-apk.yml`:
  `943144f ci : run the provenance gate...` (2026-09-22), `3aae1be`, `e687d77`,
  `a5ae74b ci: build and verify pinned engine APK` (2026-08-27). `git show a5ae74b:...`
  line 36 is identical: `uses: android-actions/setup-android@v3` (no `with:` then or now).
  `git diff a5ae74b e206a945b -- .github/workflows/build-kalsa-apk.yml` touches only the
  branch list, the new provenance-gate step, and `KALSA_DEBUGGABLE` — the setup step is
  absent from the diff. Inputs in the two run logs are byte-identical (§3).
- **Google removed the package.** Green run: `grep -c "Failed to find package" /tmp/green-run.log` → `0`,
  and `sdkmanager tools` exited 0 (the action proceeded to `[command]...sdkmanager platform-tools`).
  Red run: same grep → `1`, on `Warning: Failed to find package 'tools'`.
  Google's live repository indexes fetched now (`repository2-1..4.xml`; `repository2-5.xml`
  is a 404): `grep -c 'path="tools"'` → `0` in every file, while
  `path="platform-tools"`, `path="platforms;android-35"`, `path="build-tools;35.0.0"`,
  `path="cmake;3.22.1"`, `path="ndk;27.1.12297006"` each → `1`. Upstream's v4.0.2 release
  note (2026-09-17) says verbatim: `Fix for removed tools package.`

**Verdict: Google removed the `tools` package, not a tag move and not a workflow change.**
INFERENCE: the removal happened between 2026-08-27 (green) and 2026-09-22 (red); the
upstream fix dated 2026-09-17 puts it on/around mid-September 2026 (exact date not verified).
So run 33119894980 was the last green one **and the belief holds**: same action SHA, same
workflow step, same inputs — only Google's package index changed.

## 5. Minimal fix (NOT applied) + next failures of the same class

Recommended minimal diff — override the `packages` input on the one affected step:

```diff
diff --git a/.github/workflows/build-kalsa-apk.yml b/.github/workflows/build-kalsa-apk.yml
--- a/.github/workflows/build-kalsa-apk.yml
+++ b/.github/workflows/build-kalsa-apk.yml
@@ -33,7 +33,9 @@ jobs:
           java-version: 17
 
       - name: Set up Android toolchain
         uses: android-actions/setup-android@v3
+        with:
+          packages: platform-tools
 
       - name: Install Android native build packages
         run: sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" "cmake;3.22.1" "ndk;27.1.12297006"
```

Why this is safe/minimal: line 39 re-installs `platform-tools` anyway; nothing in this
workflow invokes legacy `tools` binaries; INFERENCE — `apk.yml` and `e2e-emulator.yml`
build the same APK with no `setup-android` at all (`grep -n "setup-" .github/workflows/apk.yml`
shows only `setup-node`/`setup-java`), so the `tools` package is not required by the build.
Alternative (upstream's own fix, slightly larger): bump to `android-actions/setup-android@v4`
(default `packages: platform-tools`, `node24` — also clears that action's Node-20 deprecation),
at the cost of its `cmdline-tools-version` default changing `12266719` → `15859902`.

Other steps that will fail next for the **same class** (removed packages / stale action
versions / runtime deprecation) — enumerated, not just the first:

1. **Removed/unavailable SDK package — currently green.** Line 39
   `sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" "cmake;3.22.1" "ndk;27.1.12297006"`:
   all five exist in Google's indexes today (counts quoted in §4), so it passes now. But
   they are pinned versions — INFERENCE: same failure mode whenever Google prunes an old
   `build-tools`/`ndk`/`cmake` pin, exactly like `tools`.
2. **Node 20 action-runtime deprecation — already firing warnings.** Annotation present in
   BOTH runs, verbatim: `Node.js 20 is deprecated. The following actions target Node.js 20
   but are being forced to run on Node.js 24: actions/checkout@v4, actions/setup-java@v4,
   actions/setup-node@v4, actions/upload-artifact@v4, android-actions/setup-android@v3.`
   `setup-android@v3` itself is `runs: using: node20` (§3). Warning today; breakage when
   GitHub stops forcing (INFERENCE on timing).
3. **Deprecated/moved action majors used in this workflow** (lines 21/25/30/102):
   annotation verbatim: `setup-java v4 is deprecated and will no longer receive updates.
   Please migrate to actions/setup-java@v5.` Latest upstream releases now:
   `actions/checkout v7.0.1 (2026-07-20)`, `actions/setup-node v7.0.0 (2026-07-14)`,
   `actions/setup-java v6.0.1 (2026-09-09)`, `actions/upload-artifact v7.0.1 (2026-04-10)`
   (`gh api repos/<r>/releases/latest`). Every one of ours is `@v4`.
4. **Runner image change.** Annotation verbatim: `"The ubuntu-latest label will migrate to
   Ubuntu 26 beginning October 19, 2026."` (line 17 `runs-on: ubuntu-latest`). INFERENCE:
   the action relies on the image's preinstalled SDK (`Found preinstalled sdkmanager in
   /usr/local/lib/android/sdk/cmdline-tools/latest` in both logs); an image swap can move or
   drop those paths — same class of external-environment breakage.
5. **Build toolchain pin.** Line 26 `node-version: 20` — Node 20 is past EOL (INFERENCE,
   not verified in this session); watch when bumping `setup-node`.
