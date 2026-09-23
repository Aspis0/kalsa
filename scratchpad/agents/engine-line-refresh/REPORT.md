# Engine line refresh - PARTIAL improvement, acceptance gate NOT met

**Read this first. This line is a PARTIAL improvement, not a fix.** The refreshed line closes
56.8x of the fidelity gap and does **NOT** pass the acceptance gate. Measured tonight on the
Adreno 740, shipped model LFM2.5-2.6B Q4_K_M, batch 256, against the archived CPU reference:
stock median KLD **0.394993**; with the q6_K pair carried by this line **0.006954 / same-top
92.913 %** (56.8x better); the gate is **<= 0.005 and >= 95 %**, so this run fails both
limbs - 1.39x above on KLD, 2.1 pp below on same-top. Do not land or describe this as fixed;
landing it is the owner's call between "ship the partial improvement" and "keep V73 off until
the residual is chased down".

Scope of this cell: refresh the line, prove the change byte-identical, re-run the standing
targets and the Android build. The phone numbers above were measured by sibling cells (see
section 2); I did not measure anything myself. No push, no tag, no upstream, ever. The shared
checkout `/Users/marco/Projects/kalsallama` was read only.

Worktree: `/Users/marco/Projects/kalsallama-wt-engine-refresh`, detached, created this session
at `fe9667621` (`git worktree add --detach`). Report: this file.

---

## 1. The refreshed line

Branch: `kalsa-engine-integration`
Old tip: `fe96676218bd48a6190332e59e1f54c3abc7b969`
**New tip: `563896ffa527b6e3453197c2d2f4b29a2ca54def` (short `563896ffa`)**

Two message-only reword rounds moved shas while every tree stayed identical (tree-hash
proof in 1 and 1.1): round 1, tip only - 19 -> 18 plus the reason line, sha `0f4c15c37` ->
`1140cbe3f`; round 2, both q6_K commits - breakdown 14 + 5 -> 14 + 4 and the excluded
tensor named `token_embd` (audit `night-gpu-numerics-audit` claim 1): tip `1140cbe3f` ->
`563896ffa`, product `01b965e38` -> `603f57800`, the two governor commits replayed
unchanged (`9a7df4d87` -> `7ac6a2387`, `8b4ce7cd6` -> `e25701d02`).

```
833cde99b  main (server : stamp the cache namespace on a restored slot)
1068eb03d  gpu: no exit(1) on the OpenCL compile path, verdict keyed on the kernel set, V73 GPU prefill lane
533d40008  ggml-opencl : degrade weight-upload failures to a load error instead of abort
603f57800  opencl: compute the Adreno q6_K GEMM product in f32      <- message arithmetic + breakdown fixed, see 1.2
7ac6a2387  governor : state raw t_idle_c in llama-ext.h and pin the sole-decider rule
e25701d02  governor : refuse a plugged baseline of 0 C or colder in the engine gate
563896ffa  opencl: KALSA_Q6K_DENSE routes dense q6_K prefill to the f32 GEMM by default   <- NEW TIP
```

Seven commits for five changes: the sibling's five-commit line plus the routing change as the
new tip. Method, in my own detached worktree: replay from `533d40008` with `git cherry-pick`
(the q6_K commit re-committed with the corrected message, then both governor commits,
then the routing change). No merges, no squashes. The routing cherry-pick auto-merged
`ggml-opencl.cpp` with zero conflicts (its hunks do not overlap the upload-degrade hunks).

### 1.1 Patch-id and tree verification (re-derived on the new tip, not inherited)

| change | original ref | on the line | patch-id original vs line | tree original vs line |
|---|---|---|---|---|
| gpu base | `1068eb03d` | `1068eb03d` (same object) | n/a (not replayed) | n/a |
| upload degrade | `533d40008` | `533d40008` (same object) | n/a (not replayed) | n/a |
| q6_K f32 product | `914b34a7e` (= line's old `ad83b9fc9`) | `603f57800` | **EQUAL** `1501e8275d7760011f258cddea524cc6e9b2bb20` | identical (`git diff ad83b9fc9 603f57800` empty) |
| governor doc + pin test | `fe15ea668` | `7ac6a2387` | **EQUAL** `da3ab315f974240886b7b0c402650d69e3b102f3` | identical; raw message byte-identical (sha `d92399e2...`) |
| governor guard | `fe9667621` | `e25701d02` | **EQUAL** `4b9eed7f876dc7dfb0e1dec827d3108451f30af4` | identical; raw message byte-identical (sha `1b07cfc2...`) |
| q6_K routing | `14a3afebf` | `563896ffa` | **EQUAL** `079721e8ecbecc67b1de96b3d59a5d255a3699af` | identical; raw message differs from the original by 19 -> 18 plus the token_embd reason line (both rewords, see above) |

Tree proof for round 2 (`git rev-parse <sha>^{tree}`, before -> after, all six commits of
the line quoted, pairwise equal):

| commit role | before | after | tree (identical) |
|---|---|---|---|
| gpu base | `1068eb03d` | `1068eb03d` | `e0aa0333a60b3d72a355b0dee26c96190fbc631d` |
| upload degrade | `533d40008` | `533d40008` | `39f3a6a2ada2db5f465fa4a38c7ec9172e5c30cf` |
| q6_K f32 product | `01b965e38` | `603f57800` | `a153b1e8295b31e4986f164e6c29ea73572f4510` |
| governor doc | `9a7df4d87` | `7ac6a2387` | `1809c7ce060a02892617dc3e6ffec5d56d745326` |
| governor guard | `8b4ce7cd6` | `e25701d02` | `25f88c47b9fb030700ea190edd17e37a568902e1` |
| tip (routing) | `1140cbe3f` | `563896ffa` | `9865e0cb2e43e84b91468914eaf7687cf156bedf` |

`git diff 1140cbe3f 563896ffa` is empty (0 lines): round 2 changed no content. Round 1's
tree pair (tip before/after amend) is quoted in section 1.

The change itself, checked the way the sibling cell did it:
`git diff fe9667621 563896ffa | git patch-id --stable` =
`git show 14a3afebf | git patch-id --stable` = `079721e8ecbecc67b1de96b3d59a5d255a3699af`.
The routing change on the line is byte-identical to the original.

Union check: `git diff --name-status 833cde99b..HEAD` lists exactly the same 10 files as the
sibling's line (the routing hunks live inside `ggml-opencl.cpp`, already in the set).

All six original refs are untouched and still point where they did:
`kalsa-gpu-opencl-v73=1068eb03d`, `kalsa-opencl-upload-degrade=909243206`,
`kalsa-opencl-q6k-f32-product=914b34a7e`, `kalsa-opencl-q6k-accurate-path=14a3afebf`,
`kalsa-opencl-f32-transpose=40a9358a1`, `kalsallama-governor-sole-decider=35eeeae34`.

The two governor commits are unchanged as content and messages and are still two commits, in
the same order, as the sibling deliberately carried them. Their shas necessarily changed
because correcting the q6_K commit message rewrote its parent chain; nothing else about them
moved.

One side effect to know about: the branch ref moved under the sibling's worktree, so
`git -C /Users/marco/Projects/kalsallama-wt-integration status` now prints
`M  ggml/src/ggml-opencl/ggml-opencl.cpp` (index still at the old tip, HEAD now the new tip).
No file in that worktree was written by me; a `git reset --hard` there, at reuse time, clears
it. That is the sibling's worktree, so I left it alone.

### 1.2 Housekeeping 1: the q6_K commit message arithmetic

Both q6_K commits now carry the corrected census. Exact diff against the original messages,
everything else byte-untouched (product commit):

```
-... Serves the 19 Q6_K tensors
- (14 ffn_down + 5 attn_v) of the Q4_K_M catalogue model.
+... Serves the 18 Q6_K tensors
+ (14 ffn_down + 4 attn_v) of the Q4_K_M catalogue model.
+The 19th Q6_K tensor is token_embd (the tied output weight), which runs on the CPU, so it is not counted.
```

Tip commit: 19 -> 18 in the count sentence plus the same token_embd reason line, nothing
else. Census source: audit `night-gpu-numerics-audit` claim 1 - the model has 19 Q6_K
tensors, 18 reach the dp4a branch (14 ffn_down + 4 attn_v), and the 19th is
`token_embd.weight`, the tied output weight, which declines to CPU on A7X for vocab-scale
K-quants (`ggml-opencl.cpp:9741-9747`). The old "14 + 5" summed to 19 against its own
total of 18; that contradiction is what round 2 removed.

### 1.3 Housekeeping 2: the governor commits

Left exactly as the sibling carried them: two commits (`7ac6a2387`, `e25701d02`), messages
byte-identical (table above), contents byte-identical (trees identical, patch-ids equal).
Not squashed, not reordered, not edited.

---

## 2. Why the two q6_K commits travel together, and what is excluded

Measured on the Adreno 740 tonight by the sibling cells, LFM2.5-2.6B Q4_K_M, batch 256,
n = 1778, same corpus/seed/archived CPU reference (sources: `scratchpad/COORDINATOR-STATE.md`
decisions 1 and overnight log; `scratchpad/agents/opencl-q6k-accurate-path/REPORT.md` section
1.1 for the mechanism):

- **The f32-product commit alone changes NOTHING.** Bitwise identical to stock: median KLD
  **0.394993** both. Reason, settled from source: at batch 256 on this device the 19 Q6_K
  tensors take the int8 dp4a branch (`ggml-opencl.cpp:23090`), which returns at `:23126`;
  the transpose block (`:23168`) and `kernel_gemm_noshuffle_q6_K_f32` (`:23191`) that the
  commit fixes are unreachable there.
- **Adding the routing change (`563896ffa`) fixes the routing**: KLD collapses 56.8x to
  **0.006954 / same-top 92.913 %**. Gate (<= 0.005, >= 95 %) still NOT met.
  (The 2x2 evidence table's routing-at-half-operand cell reads 0.006977 / 93.026 %, within
  noise of the quoted pair; both readings are ~56-57x and both FAIL. Quoted figure is the
  coordinator's two-q6K-changes number.)
- Neither commit does anything useful alone: landing the product commit without the routing
  change gives bitwise-stock behaviour; landing the routing change without the product commit
  sends the tensors into a kernel whose half-product defect is still there. They are one
  unit, proved by measurement, which is why the routing change is appended on top rather than
  offered as an alternative.

**Excluded from the line: `kalsa-opencl-f32-transpose` @ `40a9358a1`** - measured on the Q4_K
leg at 0.395990 vs 0.394993 stock, i.e. it moves the metric in the WRONG direction, so it
does not land.

---

## 3. Evidence 1 - the seven standing targets (re-run on the new tip)

Standing config, same as the sibling's: Release, `GGML_METAL=OFF`, `GGML_OPENCL=OFF`, Ninja,
own build dir `build/` in `/Users/marco/Projects/kalsallama-wt-engine-refresh`.

- Configure: **rc=0**. Targets built: **8/8**, build **rc=0 (160/160 ninja steps)**, zero
  lines matching `error` (log `/tmp/engine-refresh/native-build.log`).
- Fixture: symlinked from the shared checkout into this worktree as
  `build/tinyllamas/stories15M-q4_0.gguf`, so the standing invocation
  `-m build/tinyllamas/stories15M-q4_0.gguf` is used verbatim. Five of the seven targets exit
  1 with `error: --model is required` if run bare (the sibling cell demonstrated this
  first-hand); every run below passed the fixture.
- Binaries run from `build/bin`, alphabetical order, real `$?` (logs in
  `/tmp/engine-refresh/targets/`):

| # | target | invocation | exit |
|---|---|---|---|
| 1 | test-governor-v0 | `-m` fixture | **0** |
| 2 | test-governor-v0-commit | `-m` fixture | **0** |
| 3 | test-governor-v0-devices | `-m` fixture | **77** |
| 4 | test-governor-v0-hybrid | no `-m` (takes none) | **77** |
| 5 | test-governor-v0-shared-cells | `-m` fixture | **0** |
| 6 | test-governor-v0-turns | `-m` fixture | **0** |
| 7 | test-governor-v02-router | no `-m` (takes none) | **0** |

Seven standing counts: **0 0 77 77 0 0 0** - the expected sequence exactly. The eighth,
non-standing `test-governor-v0-mtp-hybrid` (`-m` fixture): 77, also expected. `FAIL` appears
in 0 of the 8 logs; the router log carries `router_v02_golden=PASS` and `router_v02_metrics=PASS`.

Not re-run after either message reword, deliberately: commit-message edits change no file
content - every tree hash on the line is identical before and after each round (sections 1
and 1.1) - so behaviour cannot change and the counts above stand. Re-running would cost a
build and seven runs for zero information.

---

## 4. Evidence 2 - Android arm64 build of the new tip

Recipe reused verbatim from the sibling's report (its two recovered lines included):
`BUILD_SHARED_LIBS=OFF` (required, or the link fails on `AHardwareBuffer_allocate/lock/
release/unlock` out of `src/bmoe/platform_io.cpp`), and explicit `OpenCL_INCLUDE_DIR` /
`OpenCL_LIBRARY` (the NDK re-roots `CMAKE_PREFIX_PATH`, so `find_package(OpenCL)` fails
without them). Own build dir `build-android-ocl-refresh`:

```sh
cmake -B build-android-ocl-refresh -S . -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE=/opt/homebrew/share/android-ndk/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a \
  -DANDROID_PLATFORM=android-28 \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_PREFIX_PATH=/Users/marco/kalsa-opencl-deps/android-prefix \
  -DOpenCL_INCLUDE_DIR=/Users/marco/kalsa-opencl-deps/android-prefix/include \
  -DOpenCL_LIBRARY=/Users/marco/kalsa-opencl-deps/android-prefix/lib/libOpenCL.so \
  -DGGML_OPENCL=ON \
  -DGGML_OPENCL_EMBED_KERNELS=ON \
  -DGGML_OPENCL_TARGET_VERSION=300 \
  -DGGML_OPENCL_USE_ADRENO_KERNELS=ON \
  -DGGML_OPENCL_USE_ADRENO_BIN_KERNELS=OFF
```

- **Configure rc=0** on all three runs (logs `/tmp/engine-refresh/android-configure.log`,
  `android-configure2.log`, `android-configure3.log`). The latest configure, run after the
  second message reword, stamps the current tip: `-- ggml commit:  563896ffa`.
  Backends: `-- Including CPU backend`, `-- Including OpenCL backend`; 185 kernels embedded
  (same count as the sibling's build). Cache facts verified in `CMakeCache.txt`:
  `BUILD_SHARED_LIBS:BOOL=OFF`, `OpenCL_INCLUDE_DIR:PATH=.../include`,
  `OpenCL_LIBRARY:FILEPATH=.../libOpenCL.so`, `GGML_OPENCL:BOOL=ON`.
- **ninja rc=0** on all three runs. Full build of this tree (stamp then `0f4c15c37`):
  `[408/408] Linking CXX executable bin/llama-cli`, 43.3 s real
  (`android-build.log`). One grep hit on the string `error` in that log, line 241:
  `-- UI: download dist.tar.gz.sha256 from b11199 failed: "HTTP response code said error"` -
  a configure-time UI-asset download message quoting HTTP error text, not a compile error;
  the build completed 408/408 with rc=0.
- **Rebuilds after each reword: free, because only the stamp changed.** Both reword rounds
  changed no file content (tree hashes identical, section 1.1), so ninja re-ran only the
  stamp-dependent steps: round 1 **rc=0, `[9/9] Linking CXX executable bin/llama-cli`**
  (2.5 s, `android-build2.log`); round 2 **rc=0,
  `[30/30] Linking CXX executable bin/llama-cli`** (with `[29/30]` for
  `llama-perplexity`, `android-build3.log`). No 408/408 rebuild was needed after either.
- Binaries: `bin/llama-cli` 165,571,632 bytes; `bin/llama-perplexity` 119,875,816 bytes;
  `file` -> `ELF 64-bit LSB pie executable, ARM aarch64 ... /system/bin/linker64` (not
  runnable on this Mac; evidence read from the artefacts).
- **Embedded commit string (rebuilt after the second reword)**: generated
  `build-android-ocl-refresh/common/build-info.cpp` says
  `char const * LLAMA_COMMIT = "563896ffa";`, and `strings` finds the exact token
  `563896ffa` in BOTH binaries (1 hit each), with zero hits of either superseded sha
  (`1140cbe3f` = 0, `0f4c15c37` = 0 in both), next to the format string
  `version: %s (build %d, commit %s)`. The line the phone will print:
  **`version: <llama_version()> (build 11199, commit 563896ffa)`**.
- **Build number**: `LLAMA_BUILD_NUMBER = 11199`, cross-checked against
  `git rev-list --count HEAD` on the line = **11199** (the sibling's tip was 11198; the
  routing commit is the +1; message rewords do not change the commit count, so it stays
  11199). Compiler literal: `Clang 21.0.0`, target `Android aarch64`.
- `llvm-readelf -d` NEEDED: `libomp.so, libm.so, libdl.so, libOpenCL.so, libc.so` - the same
  set as the sibling's binaries.

---

## 5. Evidence 3 - .cl syntax gate: NOT APPLICABLE to this refresh

This refresh adds no kernel source changes: `git diff --name-only fe9667621..563896ffa --
'*.cl'` is empty; the routing commit touches only `ggml-opencl.cpp`, and the message reword
changes no tree (proven by the empty tree diffs in section 1.1). The gate is therefore not
applicable here, stated rather than skipped silently.

For completeness, the line's one pre-existing `.cl` delta versus `main`
(`kernels/gemm_noshuffle_q6_k_f32.cl`, byte-identical to what the sibling already verified)
was re-checked anyway with the preregistered command:

```sh
/opt/homebrew/share/android-ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang \
    -x cl -cl-std=CL1.2 -Xclang -finclude-default-header -target spirv64 \
    -fsyntax-only ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl
```

Result: **rc=0**, with the same stock warning the sibling recorded
(`cl_qcom_reqd_sub_group_size unknown or does not require pragma`), not introduced by us.

---

## 6. LANDING COMMANDS (for the owner - nothing below has been run)

Run the block top to bottom in ONE shell, so the variables survive. Every line is
copy-pasteable. Nothing here was executed by the agent: no push, no tag, no PR.

State going in: the line tip is `563896ffa527b6e3453197c2d2f4b29a2ca54def`; the q6_K pair is
in and unconditional (measured partial win, section 2); the f32 transpose stays out
(measured wrong direction); the acceptance gate is still unmet - landing it is the owner's
decision, made knowingly as a partial improvement.

```sh
# 0) the engine sha every later step names (computed from the ref, not typed by hand)
cd /Users/marco/Projects/kalsallama
ENGINE_SHA=$(git rev-parse kalsa-engine-integration)   # now 563896ffa527b6e3453197c2d2f4b29a2ca54def
echo "$ENGINE_SHA"
```
Reason: one variable read from the ref, so the binding pin, the provenance gate and the
manual checks cannot disagree with the actual branch tip.

```sh
# 1) push the engine line to the fork (owner at the keyboard - never automated)
git push origin kalsa-engine-integration
```
Reason: step 2's `sync:vendor` clones `LLAMA_CPP_REPO`
(https://github.com/Aspis0/kalsallama) at `LLAMA_CPP_REF` from GitHub, so the line must exist
on the remote before the binding can pin it; this is the single push that makes the whole
line pinnable. The branch has no upstream configured, so the ref name must be explicit.

```sh
# 2) bump the binding's engine pin: edit REF only, sync rewrites COMMIT itself
cd /Users/marco/Projects/llama.rn-kalsa-wt-gov-transport     # branch kalsarn-governor-transport, at b97c581d
sed -i '' "s|^LLAMA_CPP_REF=.*|LLAMA_CPP_REF=$ENGINE_SHA|" vendor/VERSIONS
npm run sync:vendor
```
Reason: `sync-vendor.sh` resolves REF to COMMIT, re-vendors `vendor/llama.cpp` from the remote
at that sha, and re-applies the 21 patches in `scripts/patches/llama.cpp/`; doing the edit by
hand without the script would leave `LLAMA_CPP_COMMIT` and the vendored tree contradicting the
REF (today both still say `4ccef2f85...`). Watch-out: the script is `set -eo pipefail` - if
any old patch no longer applies against the new engine it stops; resolve each failure
deliberately, do not drop patches silently. This is the one untested link of the chain.

```sh
# 3) land b97c581d plus this bump, and push the binding (owner writes the commit message)
git add vendor/VERSIONS vendor/llama.cpp
git commit -m "build(engine): pin llama.cpp to ${ENGINE_SHA:0:9} (integration line)"   # edit freely
git push origin kalsarn-governor-transport
BINDING_SHA=$(git rev-parse HEAD)
echo "$BINDING_SHA"
```
Reason: the app pin and the provenance gate both fetch `github:Aspis0/kalsa.rn#<40-hex>`
from GitHub, so the binding commit that carries both the transport fix (`b97c581d`) and the
engine bump must be on the remote before the app can name it - pinning bare `b97c581d` alone
would still ship engine `4ccef2f8`.

```sh
# 4) bump the app's llama.rn pin - package.json, lockfile, node_modules in one move
cd /Users/marco/Projects/kalsa-wt-gov-policy     # kalsa-governor-policy-consolidate at 0db9dc68
npm install "llama.rn@github:Aspis0/kalsa.rn#$BINDING_SHA"
```
Reason: one `npm install` rewrites `package.json:49`, the spec (line 41) and resolved
(git+ssh) lines of `package-lock.json`, and `node_modules/llama.rn` together, so the three
can never drift apart; it runs in the app worktree at `0db9dc68` so binding lands at or before
the app, the fixed order (never app-first).

```sh
# 5) the provenance gate - must exit 0 before any build
bash scripts/assert-engine-provenance.sh
# expect: "OK: ... files match Aspis0/kalsa.rn@..." and "engine inside it: kalsallama@563896ffa527"
# (the sha printed must equal $ENGINE_SHA, truncated to 12)
```
Reason: this is the check whose absence produced the non-reproducible APK - it downloads the
fork tarball at the locked sha and diffs it file-for-file against `node_modules`, so an exit 0
proves the APK's engine is exactly the pushed line.

```sh
# 6) build only from that pinned state
npm run android        # expo run:android -> APK
```
Reason: all three pins (engine line, binding, app) are now fixed and verified, so an APK
built at this moment carries the two q6_K changes, the gpu base, the upload degrade, the two
governor commits, the transport fix and the provenance stamp - and can be rebuilt identically
later.

Residual risks to carry into landing: (a) the acceptance gate is NOT met - this is a known
partial improvement, section 0; (b) `sync:vendor` patch application against the new engine
tree is the only untested link in the chain; (c) the line was verified by patch-id equality
and re-run evidence in this report, not independently audited - audit at landing time if the
owner wants a second pair of eyes.

---

## 7. Deliberately not done

- No `git push` anywhere, no tags, no PRs, no comments or messages written on the owner's
  behalf beyond the one-line commit template in step 3 the owner is expected to edit.
- The phone was not touched; all on-device numbers in this report are the sibling cells'.
- The six original refs were not moved; all verification ran in the new worktree.
- `kalsa-opencl-f32-transpose` stays excluded (section 2); the sibling's worktree was not
  modified (section 1.1).
