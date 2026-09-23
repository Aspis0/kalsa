# Phone line v1.1.1 - release tip + the four GPU commits

Status: BUILT AND VERIFIED. Nothing pushed, nothing tagged, no upstream set - every push
command in section 6 is UNRUN. The shared checkout `/Users/marco/Projects/kalsallama` was
read only: its `git status --porcelain=v1` is byte-identical before and after this session
(snapshots `/tmp/phone-line-shared-status-before.txt` / `-after.txt`, both 12 lines, `diff`
empty, rc=0).

Worktree: `/Users/marco/Projects/kalsallama-wt-phone-line`
(created with `git worktree add --detach ... a7d2cec79`, then `git switch -c`).
Worktree status after all builds: clean (no porcelain output).

---

## 1. The line

Ref: **`kalsa-phone-v1-1-1`** (local branch, no upstream)
Base: **`a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1`** = tip of `kalsa-release-v1-1-1`
(untouched - the release ref and the tag `kalsa-server-v1.1.1` both still point at
`a7d2cec79`, verified with `git show-ref` / `git ls-remote`, see sections 6-7).
**Tip: `d754229443670a7454731cd48028cb409ecc0ec2` (short `d75422944`)**

```
a7d2cec79  release tip (base, unchanged)
cd213fff7  gpu: no exit(1) on the OpenCL compile path, verdict keyed on the kernel set, V73 GPU prefill lane   (pick of 1068eb03d)
86f602f8a  ggml-opencl : degrade weight-upload failures to a load error instead of abort                        (pick of 533d40008)
5b6c5361c  opencl: compute the Adreno q6_K GEMM product in f32                                                 (pick of 603f57800)
d75422944  opencl: KALSA_Q6K_DENSE routes dense q6_K prefill to the f32 GEMM by default                         (pick of 563896ffa)  <- tip
```

Method: `git cherry-pick` of the four originals onto the release tip, in the given order,
all in this worktree. All four rc=0, no conflicts. The first pick auto-merged
`src/llama-governor-policy.cpp`: its V73 hunk sits in `prefill_engine()` (line ~166), the
release pair's hunk in `profile_is_valid()` (line ~60) - disjoint. Commit messages
byte-identical to the originals (`shasum` of `%B` pairwise equal: `f9e53b5c...`,
`a825cd6a...`, `bd9ee257...`, `d79654ef...`).

**Excluded refs - none of the three is in the line:**

- `git merge-base --is-ancestor 40a9358a1 HEAD` -> rc=1 (f32 activation transpose NOT in)
- `git merge-base --is-ancestor 87f31d81f HEAD` -> rc=1 (q8-scale activation fix NOT in)
- `git merge-base --is-ancestor c6b45aaa4 HEAD` -> rc=1 (experimental instrument NOT in)
- `git rev-list --count a7d2cec79..HEAD` = **4** (exactly the four picks, subjects quoted
  above; grep of the range for `transpose|q8|EXPERIMENTAL` subjects: no hits)

`git rev-list --count HEAD` = **11199** (release line 11195 + the four picks).

## 2. patch-id proof - all four pairs

`git show <ref> | git patch-id --stable`, original vs picked:

| # | original | patch-id (original) | picked on the line | patch-id (picked) | verdict |
|---|---|---|---|---|---|
| 1 | `1068eb03d301a1dcb657f4e6923fe77678e651ee` | `f038dbf67d85f7719b58ee561717d574ed42d5c8` | `cd213fff7863b39e45b891420b45a05a0b2ac911` | `f038dbf67d85f7719b58ee561717d574ed42d5c8` | EQUAL |
| 2 | `533d40008906aca732e818ca275bf95ead198914` | `a1f22bb0616010b87cc5e61a70f5e42c2fe79ba4` | `86f602f8ab4709d8b45a18f955f5275f00c6a27a` | `a1f22bb0616010b87cc5e61a70f5e42c2fe79ba4` | EQUAL |
| 3 | `603f5780012bfa7fecee0547880f8f4f3d9c2749` | `1501e8275d7760011f258cddea524cc6e9b2bb20` | `5b6c5361c43dc9581719540ed2fcdd680e27ef6a` | `1501e8275d7760011f258cddea524cc6e9b2bb20` | EQUAL |
| 4 | `563896ffa527b6e3453197c2d2f4b29a2ca54def` | `079721e8ecbecc67b1de96b3d59a5d255a3699af` | `d754229443670a7454731cd48028cb409ecc0ec2` | `079721e8ecbecc67b1de96b3d59a5d255a3699af` | EQUAL |

All four patch-ids match their originals exactly (`--stable`). The change on this line is
byte-for-byte the change of the integration line.

## 3. Union diff `a7d2cec79..HEAD` - enumerated

`git diff --name-status a7d2cec79..HEAD` (sorted), **8 files**:

```
M	ggml/src/ggml-opencl/CMakeLists.txt
M	ggml/src/ggml-opencl/cl-program-cache.cpp
M	ggml/src/ggml-opencl/cl-program-cache.h
M	ggml/src/ggml-opencl/ggml-opencl.cpp
M	ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl
M	src/llama-governor-policy.cpp
M	tests/CMakeLists.txt
M	tests/test-opencl-moe-roundtrip.cpp
```

Set equality: this list is byte-identical to the union of the four commits' own file lists -
`diff <(git diff --name-only a7d2cec79..HEAD | sort) <(for c in <the four>; do git show
--format= --name-only $c; done | sort -u)` -> rc=0, **SETS-EQUAL**, 8 files both sides.

Checks the owner asked for:

- **`transpose.cl`: ABSENT** (`grep -i transpose` over the union -> no hits). `40a9358a1`
  did not travel. Also absent: `gemm_noshuffle_q4_k_f32.cl`, `gemm_noshuffle_q6_k_q8_1_dp4a.cl`,
  `quant_a_q8_1.cl` (all files of the two other excluded commits).
- **Governor-pair files NOT touched:** `git diff --name-only a7d2cec79..HEAD --
  src/llama-ext.h tests/test-governor-v02-router.cpp` -> empty. The release pair's own hunks
  (including `profile_is_valid()` inside the policy file) are byte-identical to the release.
- **One governor file IS in the union: `src/llama-governor-policy.cpp` - expected, not
  drift.** The diff is exactly ONE hunk: the V73 GPU prefill lane in `prefill_engine()`
  (line ~166, generation list V75 -> V73+V75). That hunk lives inside the ordered commit
  `1068eb03d` itself (its subject literally names "the V73 GPU prefill lane"), so it must
  travel for patch-id equality. File-level proof:
  `git diff a7d2cec79..HEAD -- src/llama-governor-policy.cpp | git patch-id --stable` =
  `61713f7aa5db91a4667f2e3da8352c1cdd2642be` =
  `git show 1068eb03d -- src/llama-governor-policy.cpp | git patch-id --stable` =
  `61713f7aa5db91a4667f2e3da8352c1cdd2642be`. So the union equals exactly the files the
  four ordered commits touch - no more, no less. No governor *commit* is in the range
  (section 1), and the three release-governor files carry no new content beyond that one
  ordered lane.

## 4. Evidence 1 - the seven standing targets with the fixture

Standing config: Release, `GGML_METAL=OFF`, `GGML_OPENCL=OFF`, Ninja, own build dir
`build/` in this worktree. Fixture symlinked from the shared checkout (19,077,344 bytes,
untouched) as `build/tinyllamas/stories15M-q4_0.gguf`, so the standing invocation
`-m build/tinyllamas/stories15M-q4_0.gguf` runs verbatim.

- Configure: **rc=0**, stamp `-- ggml commit: d75422944` (the new tip, configure after the
  commits). `/tmp/phone-line/native-configure.log`.
- Build: **rc=0, 479/479 ninja steps** (`/tmp/phone-line/native-build.log`). One grep hit
  on `error`, line 241: `-- UI: download dist.tar.gz.sha256 from b11199 failed: "HTTP
  response code said error"` - the known configure-time UI-asset download message quoting
  HTTP error text, not a compile error.
- Binaries run from `build/bin`, alphabetical order, real `$?`
  (logs `/tmp/phone-line/targets/`):

| # | target | invocation | exit |
|---|---|---|---|
| 1 | test-governor-v0 | `-m` fixture | **0** |
| 2 | test-governor-v0-commit | `-m` fixture | **0** |
| 3 | test-governor-v0-devices | `-m` fixture | **77** |
| 4 | test-governor-v0-hybrid | no `-m` (takes none) | **77** |
| 5 | test-governor-v0-shared-cells | `-m` fixture | **0** |
| 6 | test-governor-v0-turns | `-m` fixture | **0** |
| 7 | test-governor-v02-router | no `-m` (takes none) | **0** |

Seven counts: **0 0 77 77 0 0 0** - the expected sequence exactly. `FAIL` appears in 0 of
the 7 logs; the router log carries `router_v02_golden=PASS` and `router_v02_metrics=PASS`.
**Identical to the release line's counts** (release-prep recorded the same
`0 0 77 77 0 0 0` on `a7d2cec79`) - no difference.

Bare-run trap demonstrated first-hand on all five model-dependent targets, each exit 1 with
the fixture problem (not a code failure):

```
BARE test-governor-v0              rc=1 : error: --model is required
BARE test-governor-v0-commit       rc=1 : error: --model is required
BARE test-governor-v0-devices      rc=1 : error: --model is required
BARE test-governor-v0-shared-cells rc=1 : error: --model is required
BARE test-governor-v0-turns        rc=1 : error: --model is required
```

## 5. Evidence 2 - Android arm64 build (llama-cli + llama-perplexity)

Recipe reused from the release build (both recovered lines honored: `BUILD_SHARED_LIBS=OFF`
or the link dies on the `AHardwareBuffer_*` symbols, and the two explicit OpenCL paths the
NDK re-roots). Own build dir `build-android-ocl-phone-v1111`, configure run AFTER the four
commits so the stamp matches:

```sh
cmake -B build-android-ocl-phone-v1111 -S . -G Ninja \
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

- **Configure rc=0** (`/tmp/phone-line/android-configure.log`). Summary: `-- Including CPU
  backend`, `-- Including OpenCL backend`, **`-- ggml commit: d75422944`** (the tip).
  Cache verified: `BUILD_SHARED_LIBS:BOOL=OFF`, `GGML_OPENCL:BOOL=ON`,
  `OpenCL_INCLUDE_DIR:PATH=.../android-prefix/include`,
  `OpenCL_LIBRARY:FILEPATH=.../android-prefix/lib/libOpenCL.so`.
- **ninja rc=0**, **408/408** steps (`/tmp/phone-line/android-build.log`). One grep hit on
  `error` = the same known UI-download message (line 241).
- The linking lines:

```
[400/408] Linking CXX executable bin/llama-perplexity
[408/408] Linking CXX executable bin/llama-cli
```

- **Embedded commit string**, both ELFs: generated `build-android-ocl-phone-v1111/common/build-info.cpp`
  says `char const * LLAMA_COMMIT = "d75422944";` and `int LLAMA_BUILD_NUMBER = 11199;`.
  `strings` on each binary: **`d75422944` = 1 hit** in `llama-cli` and 1 hit in
  `llama-perplexity`; `a7d2cec79` = 0, `563896ffa` = 0, `833cde99b` = 0 in both, next to
  the format string `version: %s (build %d, commit %s)`. The line the phone will print:
  **`version: <llama_version()> (build 11199, commit d75422944)`**.
- **Build number**: `LLAMA_BUILD_NUMBER = 11199` = `git rev-list --count HEAD` on this
  line (release 11195 + 4 picks). Cross-checked on disk.
- `file`: both `ELF 64-bit LSB pie executable, ARM aarch64 ... interpreter
  /system/bin/linker64` (not runnable on this Mac; evidence read from the artefacts).
  Sizes: `llama-cli` 165,466,048 B (BuildID `774941fe0d...`);
  `llama-perplexity` 119,800,632 B (BuildID `6cbe0d9d88...`).
- **sha256 (for the phone measurement):**

```
aa5fa409526c2958533e03470f8bc3571a21896e57f612485de63c31d14a24d1  build-android-ocl-phone-v1111/bin/llama-perplexity
4c351ace97745f847bb358dd2a0a0239757f152a830f8588892ba6902d3d17e6  build-android-ocl-phone-v1111/bin/llama-cli
```

## 6. Push commands (UNRUN - copy-pasteable; NO tag command is here)

None of the block below was executed. Read-only remote state (`git ls-remote origin`,
read before this session): `refs/heads/kalsa-release-v1-1-1` exists at `a7d2cec79`,
`refs/tags/kalsa-server-v1.1.1` exists pointing at `a7d2cec79` (peeled `^{}` =
`a7d2cec79...`), and **no `kalsa-phone-v1-1-1` ref exists on the remote yet**.

```sh
# 1) push the phone branch only - creates refs/heads/kalsa-phone-v1-1-1 at the tip
cd /Users/marco/Projects/kalsallama
git push origin refs/heads/kalsa-phone-v1-1-1:refs/heads/kalsa-phone-v1-1-1
```

```sh
# 2) verify after running (expect d75422944... and the release refs unchanged)
git ls-remote origin refs/heads/kalsa-phone-v1-1-1 refs/heads/kalsa-release-v1-1-1 refs/tags/kalsa-server-v1.1.1
# expect:
# d754229443670a7454731cd48028cb409ecc0ec2  refs/heads/kalsa-phone-v1-1-1
# a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1  refs/heads/kalsa-release-v1-1-1
# 0f1b3bec7342ddd5624dc474c760a0b38bc80b5b  refs/tags/kalsa-server-v1.1.1
# a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1  refs/tags/kalsa-server-v1.1.1^{}
```

Notes: the phone line contains the release tip as ancestor (`merge-base` = `a7d2cec79`),
so it sits on top of what is already on the remote; no force, no lease needed. The branch
has no upstream, hence the explicit full refspec. **There is deliberately no `git tag` and
no `git push --tags` anywhere in this block** - the release tag `kalsa-server-v1.1.1` stays
on `a7d2cec79` and must not move.

## 7. Deliberately not done

- No `git push`, no `git tag` (new or moved), no `git fetch`, no PR, no upstream config,
  no hand-authored commit: the four commits are cherry-picks with byte-identical messages.
- The shared checkout was not written to; `git status --porcelain=v1` identical before and
  after (12 lines both, `diff` rc=0).
- The three excluded refs (`40a9358a1`, `87f31d81f`, `c6b45aaa4`) are not in the line and
  their refs were not moved; originals `1068eb03d`, `533d40008`, `603f57800`, `563896ffa`
  and `kalsa-release-v1-1-1` all still point where they did.
- Metal not built (belongs to the release workflow); the phone measurement itself not run
  here - only the binary and its sha256 were produced for it.
