# CODER: setup-android v4 + APK build on main

Worktree `/Users/marco/Projects/kalsa-wt-landing`, detached HEAD at `e206a945b`
(= origin/main), 0 dirty files before the change. Committed on the detached HEAD;
no branch created, nothing pulled/pushed/tagged. `/Users/marco/Projects/kalsa` untouched.

Commit: `f16903b80265fecc37f56acee86d68e6e47de665`
Message: `ci : setup-android v4 (Google removed the SDK tools package), build the APK on main`

## Verification exit codes

| Check | Exit |
|---|---|
| `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build-kalsa-apk.yml'))"` | 0 |
| `actionlint .github/workflows/build-kalsa-apk.yml` (`/opt/homebrew/bin/actionlint`, installed) | 0 |
| `git diff --name-only` | only `.github/workflows/build-kalsa-apk.yml` |

## Diff (`git diff HEAD~1`)

```diff
diff --git a/.github/workflows/build-kalsa-apk.yml b/.github/workflows/build-kalsa-apk.yml
index 873c480..0aee9ea 100644
--- a/.github/workflows/build-kalsa-apk.yml
+++ b/.github/workflows/build-kalsa-apk.yml
@@ -3,7 +3,12 @@ name: Build Kalsa APK
 on:
   workflow_dispatch:
   push:
-    branches: [engine-pin-kalsallama, bench-dev-models]
+    branches: [main]
+    # A ~2 h APK build is pointless for docs-only commits.
+    paths-ignore:
+      - "**/*.md"
+      - LICENSE
+      - docs/**

 permissions:
   contents: read
@@ -33,7 +38,9 @@ jobs:
           java-version: 17

       - name: Set up Android toolchain
-        uses: android-actions/setup-android@v3
+        uses: android-actions/setup-android@v4
+        with:
+          packages: platform-tools

       - name: Install Android native build packages
         run: sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" "cmake;3.22.1" "ndk;27.1.12297006"
```

`git show --stat HEAD`: 1 file changed, 9 insertions(+), 2 deletions(-).

## Note (not changed, out of scope)

Lines with `KALSA_DEBUGGABLE: ${{ github.ref == 'refs/heads/bench-dev-models' && '1' || '0' }}`
now always evaluate to `'0'` (the branch no longer triggers builds; dispatch runs on main).
Owner said nothing else — left as is; flag for a later decision.

## Fix round

Audit verdict SHIP-WITH-FIXES (`AUDIT.md`). One commit on top of `f16903b80265fecc37f56acee86d68e6e47de665`,
same detached-HEAD worktree, no branch, no amend, no push. The "Note" above is resolved
by this round (audit §4): the debuggable path is back, as a dispatch input.

Commit: `08670fb7221a555fd52f69938a066614bffc6d32`
Message: `ci : APK debuggable only by dispatch input, pin setup-android to the audited sha`
`git show --stat HEAD`: 1 file changed, 12 insertions(+), 6 deletions(-).

### Verification exit codes

| Check | Exit |
|---|---|
| `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build-kalsa-apk.yml'))"` | 0 |
| `actionlint .github/workflows/build-kalsa-apk.yml` | 0 |
| `git diff --name-only HEAD` | only `.github/workflows/build-kalsa-apk.yml` |

### Diff (`git diff HEAD~1`)

```diff
diff --git a/.github/workflows/build-kalsa-apk.yml b/.github/workflows/build-kalsa-apk.yml
index 0aee9ea..df56b19 100644
--- a/.github/workflows/build-kalsa-apk.yml
+++ b/.github/workflows/build-kalsa-apk.yml
@@ -2,9 +2,15 @@ name: Build Kalsa APK
 
 on:
   workflow_dispatch:
+    inputs:
+      debuggable:
+        description: Build a debuggable release APK for device measurements
+        required: false
+        type: boolean
+        default: false
   push:
     branches: [main]
-    # A ~2 h APK build is pointless for docs-only commits.
+    # An APK build (~35 min) is pointless for docs-only commits.
     paths-ignore:
       - "**/*.md"
       - LICENSE
@@ -14,7 +20,7 @@ permissions:
   contents: read
 
 concurrency:
-  group: build-kalsa-apk-${{ github.ref }}
+  group: build-kalsa-apk-${{ github.ref }}-${{ github.event_name == 'workflow_dispatch' && inputs.debuggable && 'debuggable' || 'release' }}
   cancel-in-progress: true
 
 jobs:
@@ -38,7 +44,7 @@ jobs:
           java-version: 17
 
       - name: Set up Android toolchain
-        uses: android-actions/setup-android@v4
+        uses: android-actions/setup-android@be39fa834029ff78f1a44aa3bb0819b8fc2bd8fd # v4, audited 2026-09-23
         with:
           packages: platform-tools
 
@@ -64,13 +70,13 @@ jobs:
       - name: Prebuild Android native project
         env:
           KALSA_LLAMA_FROM_SOURCE: "1"
-          KALSA_DEBUGGABLE: ${{ github.ref == 'refs/heads/bench-dev-models' && '1' || '0' }}
+          KALSA_DEBUGGABLE: ${{ github.event_name == 'workflow_dispatch' && inputs.debuggable && '1' || '0' }}
         run: npx expo prebuild --platform android --no-install
 
       - name: Build arm64 release APK
         env:
           KALSA_LLAMA_FROM_SOURCE: "1"
-          KALSA_DEBUGGABLE: ${{ github.ref == 'refs/heads/bench-dev-models' && '1' || '0' }}
+          KALSA_DEBUGGABLE: ${{ github.event_name == 'workflow_dispatch' && inputs.debuggable && '1' || '0' }}
           CMAKE_BUILD_PARALLEL_LEVEL: "2"
           NINJAFLAGS: "-j2"
         run: |
@@ -108,7 +114,7 @@ jobs:
       - name: Upload APK artifact
         uses: actions/upload-artifact@v4
         with:
-          name: kalsa-apk-arm64-v8a-${{ github.sha }}
+          name: kalsa-apk-arm64-v8a${{ github.event_name == 'workflow_dispatch' && inputs.debuggable && '-debuggable' || '' }}-${{ github.sha }}
           path: |
             android/app/build/outputs/apk/release/app-release.apk
             kalsa-apk.sha256
```

Not done on purpose: `persist-credentials: false` on checkout (audit §6, deferred by the owner).

