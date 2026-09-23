# Release prep v1.1.1 - re-verification of the governor pair on the main base

Status: PREPARED AND VERIFIED. Nothing pushed, nothing tagged, all push/tag commands
below are UNRUN. The shared checkout `/Users/marco/Projects/kalsallama` was read only
(its status is byte-identical before and after this session: the same 7 modified files,
same untracked entries). No Metal build was made - that artifact belongs to the release
workflow.

Worktree: `/Users/marco/Projects/kalsallama-wt-release-v1-1-1`
(created with `git worktree add --detach ... 833cde99b`, then `git switch -c`).

---

## 1. The release line

Ref: **`kalsa-release-v1-1-1`**
Tip: **`a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1`** (short `a7d2cec79`)

```
833cde99b  main (server : stamp the cache namespace on a restored slot)
e3088932c  governor : state raw t_idle_c in llama-ext.h and pin the sole-decider rule  (pick of 7ac6a2387)
a7d2cec79  governor : refuse a plugged baseline of 0 C or colder in the engine gate    (pick of e25701d02)  <- tip
```

Method: cherry-pick of the two originals onto `main`, in original order.

Cherry-pick outcomes, verbatim from the terminal:

- `git cherry-pick 7ac6a2387` -> rc=0, `[kalsa-release-v1-1-1 e3088932c] ... 2 files changed, 14 insertions(+), 3 deletions(-)`. No conflict.
- `git cherry-pick e25701d02` -> rc=0, `Auto-merging src/llama-governor-policy.cpp` then
  `[kalsa-release-v1-1-1 a7d2cec79] ... 2 files changed, 15 insertions(+), 7 deletions(-)`. No conflict.

No conflicting hunk existed, so there was nothing to stop for. The only base difference
between the GPU line (where the pair was authored) and `main` is the EXCLUDED GPU hunk in
`prefill_engine()` (~line 163 of `src/llama-governor-policy.cpp`, the V73 enablement from
`1068eb03d`); the gate hunk this release carries is in `profile_is_valid()` (~line 60) -
disjoint, which is why git auto-merged. `src/llama-ext.h` and
`tests/test-governor-v02-router.cpp` are byte-identical between the two bases
(blobs `0550d17c6` / `e58ceb537` on both). Governor logic was not rewritten: thresholds
and tolerances untouched.

Union check: `git diff --name-status 833cde99b..HEAD` lists exactly 3 files -
`src/llama-ext.h`, `src/llama-governor-policy.cpp`, `tests/test-governor-v02-router.cpp`.
Zero GPU/OpenCL files. The GPU/numerics line (`1068eb03d` -> `563896ffa`), the transpose
ref and the experimental instrument ref are NOT in this release. Commit count on the line:
`git rev-list --count HEAD` = **11195** (main 11193 + 2).

Commit messages on the picks are byte-identical to the originals (`diff` of `%B` empty
for both pairs).

## 2. patch-id proof - the change is unchanged

```
== ORIGINAL 7ac6a2387 ==
da3ab315f974240886b7b0c402650d69e3b102f3 7ac6a2387c68ca4dccd61422ec833313192f6849
== PICKED e3088932c ==
da3ab315f974240886b7b0c402650d69e3b102f3 e3088932ccf6ed4568e0bbd1996ca6f51df4fbca

== ORIGINAL e25701d02 ==
4b9eed7f876dc7dfb0e1dec827d3108451f30af4 e25701d02bd7a6669e627163285ce2bb5c516e2f
== PICKED a7d2cec79 ==
4b9eed7f876dc7dfb0e1dec827d3108451f30af4 a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1
```

Pair 1: `da3ab315f974240886b7b0c402650d69e3b102f3` == `da3ab315f974240886b7b0c402650d69e3b102f3` - EQUAL.
Pair 2: `4b9eed7f876dc7dfb0e1dec827d3108451f30af4` == `4b9eed7f876dc7dfb0e1dec827d3108451f30af4` - EQUAL.

Both patch-ids match their originals exactly (`--stable`). The re-verification on the
`main` base carries the same change, byte-for-byte, as the GPU-base originals.

## 3. Evidence 1 - the seven standing targets with the fixture

Standing config: Release, `GGML_METAL=OFF`, `GGML_OPENCL=OFF`, Ninja, worktree
`/Users/marco/Projects/kalsallama-wt-release-v1-1-1`, own build dir `build/`.

- Configure: **rc=0**, summary stamps `-- ggml commit: a7d2cec79`.
- Build: **8/8 targets, rc=0 (160/160 ninja steps)**, zero lines matching `error`
  (`/tmp/release-v1111-build.log`).
- Fixture: symlinked from the shared checkout (19,077,344 bytes, untouched) into this
  worktree as `build/tinyllamas/stories15M-q4_0.gguf`, so the standing invocation
  `-m build/tinyllamas/stories15M-q4_0.gguf` is used verbatim.

| # | target | invocation | exit |
|---|---|---|---|
| 1 | test-governor-v0 | `-m` fixture | **0** |
| 2 | test-governor-v0-commit | `-m` fixture | **0** |
| 3 | test-governor-v0-devices | `-m` fixture | **77** |
| 4 | test-governor-v0-hybrid | no `-m` (takes none) | **77** |
| 5 | test-governor-v0-shared-cells | `-m` fixture | **0** |
| 6 | test-governor-v0-turns | `-m` fixture | **0** |
| 7 | test-governor-v02-router | no `-m` (takes none) | **0** |

Seven counts: **0 0 77 77 0 0 0** - the expected sequence exactly. `FAIL` appears in
0 of the logs. (8th, non-standing `test-governor-v0-mtp-hybrid` with `-m`: 77, also
expected.)

The bare-run trap was demonstrated first-hand on all five model-dependent targets, each
exit 1 with `error: --model is required`:

```
BARE test-governor-v0            rc=1 : error: --model is required
BARE test-governor-v0-commit     rc=1 : error: --model is required
BARE test-governor-v0-devices    rc=1 : error: --model is required
BARE test-governor-v0-shared-cells rc=1 : error: --model is required
BARE test-governor-v0-turns      rc=1 : error: --model is required
```

A bare exit 1 is a missing fixture, not a failure of the code. Targets 4 and 7 take no
`-m` at all.

### The governor sole-decider test, run specifically

The sole-decider pins live in `test_thermal_state()` of
`tests/test-governor-v02-router.cpp` (the rule this release carries: the engine is the
only plugged-validity decider, and it refuses a plugged baseline of 0 C or colder).
Run of that target, two ways:

- Direct: `./build/bin/test-governor-v02-router` -> prints
  `router_v02_golden=PASS` / `router_v02_metrics=PASS`, **rc=0**.
- `ctest --test-dir build -R '^test-governor-v02-router$' --output-on-failure` ->
  **100% tests passed out of 1** (label `router`).

The pins compiled into the shipped binary (`strings build/bin/test-governor-v02-router`):

```
engine rule refuses a zero plugged baseline
engine rule refuses a negative plugged baseline
refused baseline leaves the state Invalid
```

Source lines on the release tip: `tests/test-governor-v02-router.cpp:175-188`. Note the
pin text is the POST-`e25701d02` form ("refuses", state `Invalid`) - proof the second
commit's flipped expectation is what was executed, not the superseded "accepts a zero
baseline" version. Result: **PASS**.

## 4. Evidence 2 - Android arm64 build (llama-cli + llama-perplexity)

Recipe reused from the bench (`build-android-ocl-1068`/`-q6k` lineage), own build dir
`build-android-ocl-release-v1111`, configure run AFTER the cherry-picks so the stamp
matches the release tip:

```sh
cmake -B build-android-ocl-release-v1111 -S . -G Ninja \
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

Both recovered recipe lines honored: `BUILD_SHARED_LIBS=OFF` (or the link dies on
`AHardwareBuffer_allocate/lock/release/unlock` from `src/bmoe/platform_io.cpp`), and the
two explicit OpenCL paths (the NDK re-roots `CMAKE_PREFIX_PATH`).

- **Configure rc=0** (`/tmp/release-v1111-android-configure.log`). Summary:
  `-- Including CPU backend`, `-- Including OpenCL backend`, `-- ggml commit: a7d2cec79`
  (stamped after the commits, as required). Cache verified:
  `BUILD_SHARED_LIBS:BOOL=OFF`, `GGML_OPENCL:BOOL=ON`,
  `OpenCL_INCLUDE_DIR:PATH=.../include`, `OpenCL_LIBRARY:FILEPATH=.../libOpenCL.so`.
- **ninja rc=0**, **408/408** steps (`/tmp/release-v1111-android-build.log`).
- The linking lines:

```
[400/408] Linking CXX executable bin/llama-perplexity
[408/408] Linking CXX executable bin/llama-cli
```

- One grep hit on `error` in the build log, line 241:
  `-- UI: download dist.tar.gz.sha256 from b11195 failed: "HTTP response code said error"` -
  a configure-time UI-asset download message quoting HTTP error text, not a compile error.
- Binaries: `bin/llama-cli` 165,885,448 bytes; `bin/llama-perplexity` 120,189,440 bytes;
  `file llama-cli` -> `ELF 64-bit LSB pie executable, ARM aarch64 ... interpreter
  /system/bin/linker64` (not runnable on this Mac).
- **Embedded commit string**: generated `common/build-info.cpp` says
  `char const * LLAMA_COMMIT = "a7d2cec79";`, and `strings` finds exactly 1 hit of
  `a7d2cec79` in EACH binary, 0 hits of the excluded GPU tip `563896ffa` and 0 hits of
  `e25701d02`, next to the format string `version: %s (build %d, commit %s)`. The line
  the app will print: `version: <llama_version()> (build 11195, commit a7d2cec79)`.
- **Build number**: `LLAMA_BUILD_NUMBER = 11195`, equal to `git rev-list --count HEAD`
  on the release line. Compiler literal: `Clang 21.0.0`, target `Android aarch64`.
- Metal: NOT built, deliberately - that artifact comes from the release workflow.

## 5. Push + tag commands (UNRUN - copy-pasteable, in order, shas filled in)

None of the block below was executed. State at run time: release tip
`a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1`; neither `refs/heads/kalsa-release-v1-1-1`
nor `refs/tags/kalsa-server-v1.1.1` exists on the remote yet (checked with
`git ls-remote`, empty).

```sh
# 1) push both branch tips - both are fast-forwards (see section 6)
git push origin main kalsa-release-v1-1-1
# equivalent, one per line:
# git push origin main                               # origin/main: 2361be359 -> 833cde99b
# git push origin kalsa-release-v1-1-1                # new branch at a7d2cec79
```

```sh
# 2) annotated tag at the release tip, style of kalsa-server-v1.1.0
#    (title line, blank line, prose paragraphs - v1.1.0's message shape)
git tag -a kalsa-server-v1.1.1 a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1 -m 'kalsa-server v1.1.1

Engine release: main 833cde99b plus the governor pair cherry-picked
(e3088932c, a7d2cec79), re-verified on the main base - patch-ids equal to the
originals, seven standing targets 0 0 77 77 0 0 0, sole-decider test PASS,
Android arm64 llama-cli/llama-perplexity built at commit a7d2cec79.

The pair: llama-ext.h states the raw forwarded t_idle_c and pins the engine as
the sole plugged-validity decider; the engine gate now refuses a plugged
baseline of 0 C or colder (t_idle_c > 0), restoring the removed app-side rule
at governor init with state Invalid.

The GPU/numerics line is not part of this tag: it fails its own acceptance
gate (median KLD 0.006954 vs 0.005, same-top 92.913% vs 95%) and costs -9.9%
prefill.

Assisted-by: pi'
```

(The message body is a draft for you to edit - it is the one thing in this report you
should rewrite in your own words before running.)

```sh
# 3) push the tag
git push origin kalsa-server-v1.1.1
```

- The tag points at the **`kalsa-release-v1-1-1` tip,
  `a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1`** (= `main` 833cde99b + the two governor
  commits), NOT at `main`'s tip `833cde99b`.
- The tag is **annotated**: `-a` creates a tag object (like the existing
  `kalsa-server-v1.1.0`, tag object `c105c218236799f2f651517f5a0aeabcf4a8d8a1` ->
  commit `2a290390d67311b580ef398fd545e6d060b39897`, verified annotated by
  `git cat-file -p`). Not lightweight. Verify after running with
  `git cat-file -t kalsa-server-v1.1.1` -> expect `tag`.

## 6. Fast-forward answer: YES, fast-forward - no decision needed

Read with `git ls-remote origin` (no fetch, no push; local remote-tracking refs happen to
match the remote byte-for-byte, so nothing drifted since the last fetch):

```
2361be35970dfd3cf5f83f5c11381cc00bb491b1  refs/heads/main
5c96b18ddca8c4adefce920f811232be4836f327  refs/heads/b11010-merge
d30c8d475d5eb47a544304ba592138d066bbc2e3  refs/tags/kalsa-server-v1.0.0
c105c218236799f2f651517f5a0aeabcf4a8d8a1  refs/tags/kalsa-server-v1.1.0
```

- `git merge-base --is-ancestor origin/main main` -> TRUE. `origin/main..main` = **234**
  commits, `main..origin/main` = **0**. So `main` IS fast-forwardable from
  `origin/main`; the push is a plain fast-forward, no force, no decision.
- The release line is also a fast-forward from `origin/main`: `origin/main..kalsa-release-v1-1-1`
  = **236** commits (the same 234 + the 2 governor commits).
- What the push changes on the remote: `refs/heads/main` moves `2361be359 -> 833cde99b`
  (+234 commits); `refs/heads/kalsa-release-v1-1-1` is created at `a7d2cec79` (+2 more);
  then the annotated tag object for `kalsa-server-v1.1.1` is added pointing at that tip.
- `origin/b11010-merge` at `5c96b18dd` is untouched by all three commands, and it is an
  ancestor of the release line anyway (it is `main~1`), so nothing on the remote is left
  divergent.

## 7. Deliberately not done

- No `git push`, no `git tag`, no `git fetch` (remote state read via `ls-remote`),
  no PR, no comment, no commit authored by hand - the two commits are cherry-picks with
  byte-identical messages.
- The shared checkout was not written to; its `git status` is identical before and after.
- Metal not built; GPU/numerics line, transpose ref and instrument ref not included.
- The original commits `7ac6a2387` and `e25701d02` and all other refs were not moved.
