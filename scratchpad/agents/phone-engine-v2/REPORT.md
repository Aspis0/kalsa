# Phone engine v2 - the line the phone should actually ship

Status: BUILT AND VERIFIED. Nothing pushed, nothing tagged, no upstream, no PR - every
push command in section 7 is UNRUN. Shared checkout `/Users/marco/Projects/kalsallama`
treated read only: `git status --porcelain=v1` byte-identical before and after this
session (12 lines both, `diff` rc=0, snapshots `/tmp/phone-engine-v2-shared-status-before.txt`
vs live). Own worktree: `/Users/marco/Projects/kalsallama-wt-phone-engine-v2`
(`git worktree add --detach ... d754229443670a7454731cd48028cb409ecc0ec2`); after all
commits and builds `git status --porcelain=v1` = 0 lines (clean).

Base: **d754229443670a7454731cd48028cb409ecc0ec2** (the commit the phone pins today).
Tip: **1577495b92096fca572f57a35b71607bacac85d5** (short `1577495b9`).

```
d754229443  base (phone pin today, unchanged)
e1cfb60f71  opencl: KALSA_Q8A_SCALE carries the dense q6_K activation block scale in f32   (cherry-pick of 87f31d81f)
1577495b92  opencl: KALSA_Q6K_DENSE routes dense q6_K prefill to the dp4a path by default  (the flip)  <- tip
```

`git rev-list --count HEAD` = **11201** (base 11199 + the two commits).
`git merge-base --is-ancestor d75422944... HEAD` -> rc=0 (base is an ancestor, so the
push in section 7 is a fast-forward).

---

## 1. Cherry-pick of the activation-scale fix - rc=0, no conflict

Command: `git cherry-pick 87f31d81f` in the worktree -> **rc=0, applied clean, no
conflicts, no hunk to report.** Resulting commit `e1cfb60f7141bcd2b2dad00d2d36d41ea49c2d7d`,
3 files changed, 61 insertions(+), 8 deletions(-). Commit message byte-identical to the
original (`git show -s --format=%B` both sides, `cmp` rc=0; no `(cherry picked from ...)`
trailer added).

Patch-id proof, `git show <sha> | git patch-id --stable`, both values quoted:

```
original: 7e82148c4554321daffaeb20ddc5e4d3146757a1  87f31d81fe2660b1608cd260f0ed45573a867b9c
picked:   7e82148c4554321daffaeb20ddc5e4d3146757a1  e1cfb60f7141bcd2b2dad00d2d36d41ea49c2d7d
```

Token `7e82148c4554321daffaeb20ddc5e4d3146757a1` on both sides: EQUAL under `--stable`.

One precision on "its parent `563896ffa` is already in the base": the sha `563896ffa`
is not an ancestor of the base (`git merge-base --is-ancestor 563896ffa d75422944` ->
rc=1). The two lines are rebased twins - the base carries the patch-equivalent commit
`d75422944` itself, and the patch-ids match:

```
d754229443670a7454731cd48028cb409ecc0ec2: 079721e8ecbecc67b1de96b3d59a5d255a3699af
563896ffa527b6e3453197c2d2f4b29a2ca54def: 079721e8ecbecc67b1de96b3d59a5d255a3699af
```

So the parent's change is in the base in exactly the sense patch-id equality defines,
which is why the pick applied without a conflict.

## 2. The default flip (commit 2)

Commit `1577495b92096fca572f57a35b71607bacac85d5`, `ggml/src/ggml-opencl/ggml-opencl.cpp`
only, 1 file changed, 5 insertions(+), 5 deletions(-). Full diff:

```diff
-// KALSA_Q6K_DENSE=f32|dp4a: dense q6_K prefill GEMM path, default f32.
+// KALSA_Q6K_DENSE=f32|dp4a: dense q6_K prefill GEMM path, default dp4a.
 // f32 = transpose + noshuffle f32 GEMM (no activation quantization);
 // dp4a = stock int8 path (kernel_quant_a_q8_1 + q8_1 dp4a GEMM), for A/B.
 inline bool kalsa_q6k_dense_f32() {
     static const bool value = [] {
         const char * e = getenv("KALSA_Q6K_DENSE");
-        if (e && strcmp(e, "dp4a") == 0) {
-            return false;
+        if (e && strcmp(e, "f32") == 0) {
+            return true;
         }
-        if (e && *e && strcmp(e, "f32") != 0) {
+        if (e && *e && strcmp(e, "dp4a") != 0) {
             GGML_LOG_ERROR("ggml_opencl: unrecognized KALSA_Q6K_DENSE='%s' (use f32|dp4a)\n", e);
             exit(1);
         }
-        return true;
+        return false;
     }();
```

The default flip is the final `return true;` -> `return false;`, but a literal one-line
change is not sufficient: in the original lambda one fall-through served both "explicit
`f32`" and "unset" (unrecognized values `exit(1)` before reaching it), so flipping only
the last line would have made `KALSA_Q6K_DENSE=f32` silently select dp4a. The arm checks
are therefore mirrored - same structure, same line count, the exact mirror of the
`kalsa_q8a_scale_f32()` selector below it (early-return the non-default arm, error on
anything else, default last).

Selector verified in both directions. The function was extracted from the file bytes
into a harness (`awk` over `ggml-opencl.cpp`, compiled with `c++ -std=c++17`):

| `KALSA_Q6K_DENSE` | returns | route |
|---|---|---|
| unset | 0 | **dp4a (new default)** |
| `""` (empty) | 0 | dp4a (default) |
| `f32` | 1 | **transpose + f32 GEMM (still reachable)** |
| `dp4a` | 0 | dp4a (measured arm) |
| `bogus` | exit 1 | `error: unrecognized KALSA_Q6K_DENSE='bogus' (use f32|dp4a)` |

The fp16 control arm is untouched by this commit (`kalsa_q8a_scale_f32()` unchanged,
same extraction harness): unset -> 1 (fp32 scale, the winning arm), `fp16` -> 0 (the
measured control), `fp32` -> 1, `bogus` -> exit 1. So all three selectors still reach
every arm; only the default moved.

Commit message (subject + one-line justification citing the measurement, not intent):

```
opencl: KALSA_Q6K_DENSE routes dense q6_K prefill to the dp4a path by default

Measured: int8 dp4a + f32 activation scale gives 0.005412 median KLD / 93.982 % same-top at 76.44 t/s vs 0.006954 / 92.913 % at 68.42 t/s for the f32 route (s23-kld-740-q4-0 REPORT.md section 22), so ship the measured configuration.

Assisted-by: pi
```

The dispatch consumes the value where it always did
(`q6k_dense_dp4a_on = ... : (!kalsa_q6k_f32 && adreno_gen != X1E)`, then
`has_integer_dot` and the shape guards - all pre-existing, unmodified). On-device
confirmation line for the next measurement:
`ggml_opencl: dense q6_K prefill GEMM path: dp4a (KALSA_Q6K_DENSE)` plus
`ggml_opencl: q8_1 activation scale: fp32 (KALSA_Q8A_SCALE)` (ggml-opencl.cpp:5605, 4572).

## 3. Diff scope of the two commits - enumerated

`git show --name-only` per commit, union = `git diff --name-status d75422944..HEAD`
(3 files):

| file | pick `e1cfb60f7` | flip `1577495b9` |
|---|---|---|
| `ggml/src/ggml-opencl/kernels/quant_a_q8_1.cl` | yes - **the quantizer kernel** (q8_1 block scale stored as float on the fp32 arm) | - |
| `ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_q8_1_dp4a.cl` | yes - the dp4a GEMM, fp32-scale build variant of the kernel | - |
| `ggml/src/ggml-opencl/ggml-opencl.cpp` | yes - `KALSA_Q8A_SCALE` selector + kernel selection | yes - **the dispatch default** (one hunk, section 2) |

Nothing else. Whole line vs release, for context (`git diff --name-status a7d2cec79..HEAD`,
6 commits, 10 files): `ggml-opencl/CMakeLists.txt`, `cl-program-cache.cpp`,
`cl-program-cache.h`, `ggml-opencl.cpp`, `kernels/gemm_noshuffle_q6_k_f32.cl`,
`kernels/gemm_noshuffle_q6_k_q8_1_dp4a.cl`, `kernels/quant_a_q8_1.cl`,
`src/llama-governor-policy.cpp`, `tests/CMakeLists.txt`,
`tests/test-opencl-moe-roundtrip.cpp`. The 7 files beyond the new pair are the base
line's four picks (audited in `../phone-line-audit/REPORT.md`).

**The f32 activation transpose is ABSENT** (it moved the metric the wrong way and did
not travel):

- `git merge-base --is-ancestor 40a9358a1 HEAD` -> rc=1 (not in the line).
- `git diff d75422944..HEAD | grep -c -i "transpose_32_32\|KALSA_GEMM_B"` -> 0 hits
  (grep rc=1); same grep over `git diff a7d2cec79..HEAD` -> 0 hits.
- `git diff --name-only a7d2cec79..HEAD | grep -i transpose` -> 0 hits:
  `transpose.cl` (the companion `kernel_transpose_32_32` of `40a9358a1`) is not in the
  line, and on disk `transpose.cl` has 0 occurrences of `kernel_transpose_32_32`,
  `ggml-opencl.cpp` and `kernels/gemm_noshuffle_q6_k_f32.cl` have 0 occurrences of
  `KALSA_GEMM_B`.
- What remains is the stock transpose (`kernel_transpose_32_16` and friends), which
  belongs to the base's f32 route - still reachable via `KALSA_Q6K_DENSE=f32`.

## 4. Evidence 1 - the seven standing targets with the fixture

Standing config: Release, `GGML_METAL=OFF`, `GGML_OPENCL=OFF`, Ninja, own build dir
`build/` in this worktree. Fixture symlinked from the shared checkout (19,077,344 bytes,
sha256 prefix `66967fbe`, untouched) as `build/tinyllamas/stories15M-q4_0.gguf`, so the
standing invocation `-m build/tinyllamas/stories15M-q4_0.gguf` runs verbatim.

- Configure **rc=0** (`/tmp/phone-engine-v2/native-configure.log`), summary stamps
  `-- ggml commit:  1577495b9` (configured after both commits), CPU + BLAS backends.
- Build **rc=0, 479/479 ninja steps** (`/tmp/phone-engine-v2/native-build.log`). One grep
  hit on `error`: line 224 `-- UI: download dist.tar.gz.sha256 from b11201 failed: "HTTP
  response code said error"` - the known configure-time UI-asset message, not a compile
  error.
- Binaries run from `build/bin`, cwd = worktree root, real `$?`
  (logs `/tmp/phone-engine-v2/targets/*.log`):

| # | target | invocation | exit |
|---|---|---|---|
| 1 | test-governor-v0 | `-m` fixture | **0** |
| 2 | test-governor-v0-commit | `-m` fixture | **0** |
| 3 | test-governor-v0-devices | `-m` fixture | **77** |
| 4 | test-governor-v0-hybrid | no `-m` (takes none) | **77** |
| 5 | test-governor-v0-shared-cells | `-m` fixture | **0** |
| 6 | test-governor-v0-turns | `-m` fixture | **0** |
| 7 | test-governor-v02-router | no `-m` (takes none) | **0** |

Seven counts: **0 0 77 77 0 0 0** - the standing sequence, identical to
`../phone-line-prep/REPORT.md` and `../release-prep/REPORT.md`. `grep -c FAIL` = 0 in all
seven logs. The 77s print their registered skip reasons:
`governor-devices: SKIP no GPU backend available (exit 77)` (METAL=OFF/OPENCL=OFF build)
and `governor-hybrid: SKIP KALSA_HYBRID_GGUF is unset (exit 77)`. Pass markers present
(`governor_commit_reject_mismatched_type=PASS`, `shared_cells_negative_guards=PASS`,
`governor_v0_turns=PASS turns=3 generated=18 ...`, `router_v02_golden=PASS`,
`router_v02_metrics=PASS`).

Bare-run trap demonstrated first-hand on all five model-dependent targets - fixture
problem, not code:

```
BARE test-governor-v0               rc=1 : error: --model is required
BARE test-governor-v0-commit        rc=1 : error: --model is required
BARE test-governor-v0-devices       rc=1 : error: --model is required
BARE test-governor-v0-shared-cells  rc=1 : error: --model is required
BARE test-governor-v0-turns         rc=1 : error: --model is required
```

## 5. Evidence 2 - Android arm64 build (llama-cli + llama-perplexity)

Recipe from `../phone-line-prep/REPORT.md` section 5, honored line by line
(`BUILD_SHARED_LIBS=OFF` or the link dies on `AHardwareBuffer_*`, plus the two explicit
OpenCL paths the NDK re-roots). Own build dir `build-android-ocl-phone-engine-v2`,
configure run AFTER both commits:

```sh
cmake -B build-android-ocl-phone-engine-v2 -S . -G Ninja \
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

- **Configure rc=0** (`/tmp/phone-engine-v2/android-configure.log`). Summary: `-- Including
  CPU backend`, `-- Including OpenCL backend`, **`-- ggml commit:  1577495b9`** (after the
  commits). Cache: `BUILD_SHARED_LIBS:BOOL=OFF`, `GGML_OPENCL:BOOL=ON`,
  `GGML_OPENCL_EMBED_KERNELS:BOOL=ON`,
  `OpenCL_INCLUDE_DIR:PATH=.../android-prefix/include`,
  `OpenCL_LIBRARY:FILEPATH=.../android-prefix/lib/libOpenCL.so`.
- **ninja rc=0, 408/408 steps** (`/tmp/phone-engine-v2/android-build.log`). One grep hit
  on `error`: line 243, the same known UI-download message (b11201).
- The linking lines:

```
[400/408] Linking CXX executable bin/llama-perplexity
[407/408] Linking CXX static library tools/cli/libllama-cli-impl.a
[408/408] Linking CXX executable bin/llama-cli
```

- **Embedded commit string, both ELFs**: generated
  `build-android-ocl-phone-engine-v2/common/build-info.cpp` says
  `int LLAMA_BUILD_NUMBER = 11201;` and `char const * LLAMA_COMMIT = "1577495b9";`
  (11201 = `git rev-list --count HEAD`, re-checked). `strings` exact-match counts:

| binary | `1577495b9` (tip) | `d75422944` | `87f31d81f` | `833cde99b` (main) |
|---|---|---|---|---|
| `llama-cli` | 1 | 0 | 0 | 0 |
| `llama-perplexity` | 1 | 0 | 0 | 0 |

  Next to the format string `version: %s (build %d, commit %s)`, i.e. the phone will
  print **`version: <llama_version()> (build 11201, commit 1577495b9)`**.
- `file`: both `ELF 64-bit LSB pie executable, ARM aarch64 ... interpreter
  /system/bin/linker64` (not runnable on this Mac; evidence read from the artifacts).
  BuildIDs: `llama-cli` `cdc28acd01418541f1ca9fa7751411da7ce3156c`,
  `llama-perplexity` `9ae9ecf020b55c37702d0168db4c870b0b383081`. Sizes: `llama-cli`
  165,605,064 B; `llama-perplexity` 119,901,504 B.
- **sha256 (for the phone):**

```
403857dab29ec33100628d4dae62395c23ad8e0d8e5663b3d7ca4025b432916e  build-android-ocl-phone-engine-v2/bin/llama-perplexity
c69c3ae7bf86bfca357db92ae757a301d9acac5a5a47da82f236b3d585cb116a  build-android-ocl-phone-engine-v2/bin/llama-cli
```

The next measurement must be of **this default configuration with no `KALSA_*` env set
at all** - no env means dp4a route + fp32 activation scale, which is exactly the
configuration section 22 measured (0.005412 / 93.982 % at 76.44 t/s). A configuration is
not measured until it is measured in the form it ships.

## 6. Tip sha and the push command - UNRUN

Tip: **`1577495b92096fca572f57a35b71607bacac85d5`** (detached HEAD of the worktree; no
local branch, no upstream - `git rev-parse @{upstream}` -> `HEAD does not point to a
branch`).

Read-only remote state, `git ls-remote origin` run this session:
`refs/heads/kalsa-phone-v1-1-1` = `d754229443670a7454731cd48028cb409ecc0ec2`,
`refs/heads/kalsa-release-v1-1-1` = `a7d2cec79...`,
`refs/tags/kalsa-server-v1.1.1` = `0f1b3bec7342ddd5624dc474c760a0b38bc80b5b`,
peeled `^{}` = `a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1`. The tip contains the current
remote phone ref as ancestor (rc=0), so the update is a fast-forward - no force, no
lease.

NONE of the block below was executed:

```sh
# push the new line onto the phone branch (fast-forward d75422944 -> 1577495b9)
cd /Users/marco/Projects/kalsallama-wt-phone-engine-v2
git push origin 1577495b92096fca572f57a35b71607bacac85d5:refs/heads/kalsa-phone-v1-1-1
```

```sh
# verify after running (expect the phone ref moved, release refs + tag unchanged)
git ls-remote origin refs/heads/kalsa-phone-v1-1-1 refs/heads/kalsa-release-v1-1-1 refs/tags/kalsa-server-v1.1.1
# expect:
# 1577495b92096fca572f57a35b71607bacac85d5  refs/heads/kalsa-phone-v1-1-1
# a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1  refs/heads/kalsa-release-v1-1-1
# 0f1b3bec7342ddd5624dc474c760a0b38bc80b5b  refs/tags/kalsa-server-v1.1.1
```

Ref naming (`kalsa-phone-v1-1-1` updated vs a new ref) is the owner's call; the sha-based
refspec above touches no local branch either way (the local `kalsa-phone-v1-1-1` checked
out in `kalsallama-wt-phone-line` stays at `d75422944`).

**Not tagged.** `git cat-file -t kalsa-server-v1.1.1` -> `tag`,
`git rev-parse kalsa-server-v1.1.1^{commit}` -> `a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1`,
both re-read after the builds: the release tag `kalsa-server-v1.1.1` stays on
`a7d2cec79` and must not move. There is no `git tag` and no `git push --tags` anywhere.

## 7. Deliberately not done

- No `git push`, no `git tag` (new or moved), no `git fetch`, no PR, no upstream config,
  no local branch created (detached per instruction - the tip is held by the worktree
  HEAD until the owner pushes).
- Shared checkout not written to: 12-line porcelain identical before/after.
- Refs not moved: `kalsa-phone-v1-1-1` (local) = `d75422944`, `kalsa-engine-integration`
  = `563896ffa`, `kalsa-opencl-q8-activation-scale` = `87f31d81f`,
  `kalsa-release-v1-1-1` = `a7d2cec79`, tag `kalsa-server-v1.1.1` -> `a7d2cec79`.
- `40a9358a1` (f32 activation transpose) and `c6b45aaa4` (instrument) not in the line
  (section 3); Metal not built (belongs to the release workflow); the phone measurement
  itself not run here - only the binary and its sha256 were produced for it.
