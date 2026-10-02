# BINDING-PATCHES.md — node_modules/llama.rn local patches (iOS first build)

Context: first iOS compile of the Kalsa app, worktree `~/Projects/kalsa-ios`,
branch `ios/first-build` (base `ffd5867c`), binding pin
`llama.rn@github:Aspis0/kalsa.rn#6c9b16edc9f53cf9b106ac1e269e44c4904f52e0`
(engine vendored under `vendor/llama.cpp`, engine pin **61c90948** —
`vendor/VERSIONS:9` `LLAMA_CPP_COMMIT=61c9094811cb200fd475491f18f594fbde77634b`,
corroborated by `lib/commonjs/version.js:8` `BUILD_COMMIT = '61c9094'`). The
main checkout `~/Projects/kalsa` runs a **newer** binding (engine
`5b596ce432ee…`), so `diff -rq` between the two `node_modules` trees returns 30
differing paths, 26 of them pure version drift — it is NOT a
pristine-vs-patched baseline (AUDIT-first-compile.md S1-1). These patches exist ONLY to get the
simulator/device compile past the pin; they are NOT a deliverable. Each diff
below is an exact unified diff of what was applied to
`~/Projects/kalsa-ios/node_modules/llama.rn/...` (regenerated from the installed
files with `diff -u` on 2026-10-02). The owning session must fold
equivalent fixes into the binding repo before the next pin bump (see
"Binding-side follow-ups" below).

Date: 2026-10-01. Xcode 27.0 (27A266a), iOS SDK 27.0.
Revised 2026-10-02 against AUDIT-first-compile.md: engine pin, Patch 1
attribution, exact hunk headers, plus "Validation status 2" and
"Binding-side follow-ups" at the end.

---

## Patch 1 — flash-attn smem loop calls a macro that no longer exists

Error (first simulator build, `xcodebuild ... -destination 'generic/platform=iOS
Simulator'`, EXIT=65):

```
node_modules/llama.rn/vendor/llama.cpp/ggml/src/ggml-metal/ggml-metal-ops.cpp:3518:27:
error: use of undeclared identifier 'FATTN_SMEM'
```

Cause: the flash-attn path defines a local lambda `fa_smem` (ggml-metal-ops.cpp:3510)
and uses it at :3522, but the simdgroup-reduction loop at :3518 still calls the old
macro name `FATTN_SMEM` — a rename that missed one call site in the binding's
vendored overlay.
Fix: call the lambda. Attribution, corrected (AUDIT-first-compile.md S1-2): the
engine does NOT carry this bug — `git -C ~/Projects/kalsallama grep -n
'FATTN_SMEM' 61c9094811cb…` and the same at `origin/main` are both empty, and the
engine at the pin has no `while` loop there at all (`ggml-metal-ops.cpp:3510-3522`
is the `fa_smem` lambda, then `int32_t nsg = ne00 >= 512 ? 8 : 4;`). The
`while (nsg > 1 && FATTN_SMEM(nsg) …)` loop is a binding overlay patch inside
`Aspis0/kalsa.rn`'s vendored tree, written against a pre-`cdc06426e` llama.cpp —
the upstream commit that replaced the `FATTN_SMEM` macro with the `fa_smem`
lambda. The fold-in therefore belongs to the binding repo's vendor overlay, not
to `Aspis0/kalsallama`, and the loop itself is an unattributed overlay patch
whose provenance must be recorded there (S1-2).

```diff
--- a/vendor/llama.cpp/ggml/src/ggml-metal/ggml-metal-ops.cpp
+++ b/vendor/llama.cpp/ggml/src/ggml-metal/ggml-metal-ops.cpp
@@ -3515,7 +3515,7 @@
         // simdgroups per threadgroup (a.k.a. warps)
         int32_t nsg = ne00 >= 512 ? 8 : 4;
 
-        while (nsg > 1 && FATTN_SMEM(nsg) > props_dev->max_theadgroup_memory_size) {
+        while (nsg > 1 && fa_smem(nsg) > props_dev->max_theadgroup_memory_size) {
             nsg /= 2;
         }
 
```

Note: verbatim `diff -u` output regenerated from the installed files on
2026-10-02 (3518 is the only changed line; the blank context lines carry diff's
single leading space — an earlier note claiming the source itself had a trailing
space there does not reproduce).

---

## Patch 2 — don't compile arch/arm/quants.c for x86_64 (dangling `_generic` refs)

Error (second simulator build, after patch 1; everything compiled, app link
failed, EXIT=65):

```
Undefined symbols for architecture x86_64:
  "_ggml_vec_dot_q2_0_q8_0_generic", referenced from:
      _ggml_vec_dot_q2_0_q8_0 in libllama-rn.a[x86_64][344](quants-9b4aaa9c0bdb04106b66054dccef1b2b.o)
```

Cause: the podspec globs `ggml-cpu/**/*.{h,c,cpp}` (`llama-rn.podspec:46`), so
BOTH `arch/arm/quants.c` and `arch/x86/quants.c` compile for every slice.
Upstream CMake compiles only
the arch dir matching the target. On the x86_64 simulator slice,
`arch/arm/quants.c` takes its non-NEON `#else` fallbacks, which call
`ggml_vec_dot_q2_0_q8_0_generic` — but on x86 the x86 section of
`arch-fallback.h` (included by `ggml-cpu/quants.c:9`) renames that generic
definition to `ggml_vec_dot_q2_0_q8_0`, leaving `_generic` undefined; the
archive then contains a duplicate `ggml_vec_dot_q2_0_q8_0` (arm fallback +
renamed generic) and the linker picks the arm one, which carries the dangling
reference. Verified: the arm64 slice is clean (`_generic` defined, arm NEON
impl used); only the x86_64 slice is affected — the arm64 device build is NOT
blocked by this.

Fix: mirror upstream CMake — skip the whole file when compiling for x86
(arm64/iOS unaffected). Applied as a `#if/#else ... #endif` wrapper around the
entire file:

```diff
--- a/vendor/llama.cpp/ggml/src/ggml-cpu/arch/arm/quants.c
+++ b/vendor/llama.cpp/ggml/src/ggml-cpu/arch/arm/quants.c
@@ -1,3 +1,10 @@
+// x86_64 simulators: upstream CMake never compiles arch/arm for x86 targets.
+// This file's non-NEON fallbacks call *_generic symbols that the x86 section
+// of arch-fallback.h renames away inside quants.c, so compiling them for an
+// x86_64 slice leaves dangling references (upstream's x86 build takes
+// ggml_vec_dot_q2_0_q8_0 from the renamed generic instead).
+#if defined(__x86_64__) || defined(__i386__) || defined(_M_IX86) || defined(_M_X64)
+#else
 #define GGML_COMMON_IMPL_C
 #include "ggml-common.h"
 #include "ggml-quants.h"
@@ -4316,4 +4323,5 @@
     ggml_vec_dot_iq4_xs_q8_K_generic(n, s, bs, vx, bx, vy, by, nrc);
 #endif
 }
+#endif
 
```

Header correction (AUDIT-first-compile.md, Record accuracy nit): the previously
recorded headers (`@@ -1,3 +1,12 @@`, `@@ -4316,3 +4325,4 @@`) implied +10 lines.
Real sizes are 4319 → 4327 (**+8**); the first hunk is `@@ -1,3 +1,10 @@`, and the
trailing hunk's old side must cover through line 4319 — the file's trailing
blank line is real context (the audit phrased this as "the original line number
should be 4319, not 4316"; 4316 is where the hunk's context starts, 4319 is
where the old side must end). The headers above are verbatim `diff -u` output
from the installed files, not hand-edited.

Guard shape (S2-6): `#if <x86> / #else <body> / #endif` lets the body compile
for every non-x86 architecture (powerpc, riscv, s390, loongarch, wasm …), where
the same dangling-`_generic` breakage returns. The audit's advice: make the guard
**positive** — `#if defined(__aarch64__) || defined(__ARM_NEON)` … `#endif`,
naming the architectures whose kernels this file is (the form used everywhere
else in this tree).

App status: **no longer needed for the app.** The app repo now injects
`EXCLUDED_ARCHS[sdk=iphonesimulator*] = x86_64` for every pod target AND the app
target into the generated Podfile's existing `post_install` hook (kalsa repo,
branch `ios/first-build`, commit `5d58e12a`,
`plugins/withLlamaIosSourceBuild.js:62-106`), so the x86_64 simulator slice is
never compiled. Verified 2026-10-02 with this patch REVERTED: clean simulator
build EXIT=0, arm64-only binaries (see "Validation status 2"). Keep the patch
anyway — the binding is still wrong on x86_64, and an Intel-Mac simulator or
x86 CI hits it (S2-8). node_modules has it re-applied, so this record matches
the tree.

---

(End of patches — updated as the fix loop progresses.)

## Validation status (2026-10-01, end of fix loop)

With patches 1+2 applied to `node_modules/llama.rn`:

- Simulator: `xcodebuild -workspace ios/KalsaAIChat.xcworkspace -scheme
  KalsaAIChat -configuration Debug -destination 'generic/platform=iOS
  Simulator' -derivedDataPath /tmp/kalsa-ios-dd build` → **EXIT=0, BUILD
  SUCCEEDED** (log `/tmp/ios-build.log`, `EXIT=0` at :10275). The linked
  `KalsaAIChat.debug.dylib` (fat arm64+x86_64, 109 MB) contains all 68
  `ggml_metallib_*` embed symbols and `_OBJC_CLASS_$_RNLlama`.
- Device: `... -destination 'generic/platform=iOS' -derivedDataPath
  /tmp/kalsa-ios-dd-device CODE_SIGNING_ALLOWED=NO build` → **EXIT=0, BUILD
  SUCCEEDED** (log `/tmp/ios-device-build.log`, `EXIT=0` at :69014), arm64
  dylib with the same 68 embed symbols.
- Both local Swift modules (KalsaThermal, KalsaLifecycle) compiled on both
  sides. No app-side fix was needed for the compile itself; the only app-repo
  change since is the `EXCLUDED_ARCHS` Podfile mod (commit `5d58e12a`, see
  "Validation status 2").
- Total build wall time: first full simulator build 306.8 s; full device build
  263.0 s. Heaviest TUs (single-file wall, M-series, -O3 via podspec):
  `cpp/jsi/RNLlamaJSI.cpp` 11.9 s, `ggml-cpu/ops.cpp` 8.0 s,
  `common/peg-parser.cpp` 7.9 s, `cpp/rn-tts.cpp` 7.7 s; the Metal units are
  cheap (`ggml-metal-ops.cpp` 1.2 s, measured directly).

---

## Validation status 2 (2026-10-02, EXCLUDED_ARCHS in the app Podfile)

App-repo change: kalsa repo, branch `ios/first-build`, commit `5d58e12a`
(`plugins/withLlamaIosSourceBuild.js:62-106`) injects
`EXCLUDED_ARCHS[sdk=iphonesimulator*] = x86_64` for every pod target and the app
target into the generated Podfile's existing `post_install` hook. Idempotent
across `expo prebuild` reruns: a second prebuild without `--clean` produced a
byte-identical Podfile, exactly one `# KALSA_EXCLUDED_ARCHS_X86_64` block, one
`post_install do`, one `LLAMA_RN_CXX20` block.

With Patch 1 applied and Patch 2 **reverted** (the reverted file is byte-identical
to a pristine copy: `diff` against `~/Projects/kalsa/node_modules/llama.rn/.../
arch/arm/quants.c` → identical, 4319 lines):

- `npx expo prebuild -p ios --clean` → EXIT=0 (34 s); `cd ios && pod install` →
  EXIT=0 (32 s); `EXCLUDED_ARCHS` present 264× in
  `Pods/Pods.xcodeproj/project.pbxproj`, 2× in `KalsaAIChat.xcodeproj/project.pbxproj`.
- Clean simulator build: `xcodebuild -workspace ios/KalsaAIChat.xcworkspace
  -scheme KalsaAIChat -configuration Debug -destination 'generic/platform=iOS
  Simulator' -derivedDataPath /tmp/kalsa-ios-dd2 clean build` →
  **EXIT=0, BUILD SUCCEEDED**, wall 337 s (log `/tmp/ios-build2.log`;
  `grep -c "error:"` → 0; `grep -c "Undefined symbols"` → 0).
- `lipo -info`: `KalsaAIChat` (58 KB launcher), `KalsaAIChat.debug.dylib` (54 MB),
  `__preview.dylib`, and the dSYM's DWARF copy → `Non-fat file … architecture:
  arm64` for all four (the 2026-10-01 dylib was fat `x86_64 arm64`, 109 MB).
- Object counts: 1041 under `Objects-normal/arm64`, **0** under
  `Objects-normal/x86_64`.
- Wall-time caveat: not directly comparable to the 306.8 s above — that figure
  comes from the earlier fix loop, whose log the audit flags as an incremental
  tail (S2-10), while this run started from an emptied `/tmp/kalsa-ios-dd2`.

Patch 2 was re-applied afterwards so `node_modules` matches this record.

---

## Binding-side follow-ups for the binding owner

All for `Aspis0/kalsa.rn` (the binding repo). file:line citations are against
the installed pin in `~/Projects/kalsa-ios/node_modules/llama.rn`.

1. **Patch 1 (Metal flash-attn loop).** Replace `FATTN_SMEM(nsg)` with
   `fa_smem(nsg)` at `vendor/llama.cpp/ggml/src/ggml-metal/ggml-metal-ops.cpp:3518`
   in the binding's vendor overlay, and record that the enclosing `while` loop
   is itself an unattributed binding overlay patch (AUDIT S1-2). It cannot land
   in `Aspis0/kalsallama`: that repo has no `FATTN_SMEM` at any commit.
2. **Patch 2, positive guard.** Re-express the guard at
   `vendor/llama.cpp/ggml/src/ggml-cpu/arch/arm/quants.c:1-7` as
   `#if defined(__aarch64__) || defined(__ARM_NEON)` … `#endif` instead of the
   negative `#if defined(__x86_64__) || … / #else`, which lets the body compile
   on every other non-x86 architecture (AUDIT S2-6). Keep it: the app's
   `EXCLUDED_ARCHS` change protects only this app's simulator builds.
3. **Narrow the `LLAMA_RN_CXX20` Podfile block (AUDIT S2-12).**
   `src/expo-plugin/withLlamaRN.ts:107` injects, for every pod target,
   `config.build_settings['OTHER_CPLUSPLUSFLAGS'] = '$(inherited) -std=gnu++20'`
   (generated `ios/Podfile:98-105`), clobbering the flags
   `react_native_post_install` composed (`-DRCT_NEW_ARCH_ENABLED=1`,
   `-ivfsoverlay …/React-VFS.yaml`); it works only because `$(inherited)`
   re-chains them. Keep `CLANG_CXX_LANGUAGE_STANDARD` / `CLANG_CXX_LIBRARY` and
   drop the `OTHER_CPLUSPLUSFLAGS` assignment — the podspec already sets
   `-std=c++20`. The same clobber exists in the Xcode-project mod at
   `src/expo-plugin/withLlamaRN.ts:74-76`.
4. **Narrow the podspec's `ggml-cpu/**` glob (AUDIT S2-7).**
   `llama-rn.podspec:46` globs `ggml/src/ggml-cpu/**/*.{h,c,cpp}` — every arch
   directory for every slice — while the podspec's own comment
   (`llama-rn.podspec:53-54`) says the file set mirrors the per-arch selection
   in `cmake/rnllama-sources.cmake`. Select sources per-arch the way upstream's
   CMake does; that removes the whole dangling-`_generic` class instead of the
   instance (four other arch files already compile to empty objects in both
   slices, per S2-7).

(Order item 6 of the audit's recommended order — install on a device and run one
model end to end — is app-side work, not a binding follow-up.)

---

## SDK 58 trial (2026-10-02, ios/first-build at 7c324067, expo 58.0.2 / react-native 0.88.0-rc.3)

Scope: node_modules patches applied in `~/Projects/kalsa-ios` to keep the SDK 58 beta
simulator build going. None are committed anywhere (node_modules is untracked); every
`npm ci` reverts them.

1. **Known patch re-applied (not a new SDK 58 breakage).** Patch 1 above
   (`FATTN_SMEM(nsg)` → `fa_smem(nsg)`, ggml-metal-ops.cpp:3518) is still required at
   pin 3d8fc84a; the compile fails without it exactly as on SDK 57. Re-applied by sed
   after `npm ci` / the expo 58 install.
2. **NEW — whisper.rn 0.7.2 does not compile under RN 0.88.** `node_modules/whisper.rn/ios/RNWhisper.mm:314-325`
   declares `RCTCxxBridge *cxxBridge = (RCTCxxBridge *)bridge.batchedBridge` and reads
   `cxxBridge.runtime`; RN 0.88-rc removed the `RCTCxxBridge` type from the headers
   (bridgeless-only) → 5 compile errors ("unknown type name 'RCTCxxBridge'", "property
   'runtime' not found"). RN 0.88's public `RCTBridge` header exposes no `runtime`/
   `jsCallInvoker`/`batchedBridge` at all.
   Node_modules patch applied (compile + launch + load verified): a file-local
   `@protocol RNWhisperBridgeRuntimeAccess` (void* runtime; shared_ptr<CallInvoker>
   jsCallInvoker) and a cast to `id<RNWhisperBridgeRuntimeAccess>` — mirroring the
   pattern the kalsa.rn fork itself already uses in `RNLlama.mm:76`
   (`@protocol RNLlamaBridgeRuntimeAccess`).
3. **kalsa.rn 3d8fc84a under RN 0.88: no NEW compile breakage.** `RNLlama.mm` compiled
   and its JSI install **worked at runtime** under the SDK 58 app (proof: Metro log
   `KALSA_PREWARM {"op":"done","promptMs":14098.758,"promptN":1889}` + native
   `load time = 1335.03 ms` in /tmp/kalsa-console58.log). The protocol-based dynamic
   dispatch survives the bridgeless RCTBridge. Caveat carried from the audit: the
   `while` loop overlay (item 1) remains unattributed in the fork's vendor tree.
4. **Binding-owner follow-ups added by this trial:**
   - whisper.rn is upstream npm (`mybigday/whisper_rn` 0.7.2), not the kalsa fork; if
     RN 0.88 lands on main, either bump to a whisper.rn release with bridgeless runtime
     access, or carry the protocol patch in a fork/patch-package. The runtime path it
     takes after the patch is the same dynamic dispatch kalsa.rn uses; untested beyond
     compile (no voice flow was run in the trial).
   - kalsa.rn: consider replacing the `batchedBridge ?: bridge` dynamic dispatch with
     the documented bridgeless runtime access before RN 0.88 stable; it currently
     relies on `RCTBridge` still responding to `runtime`/`jsCallInvoker` selectors at
     runtime, which is deprecation-shaped.
