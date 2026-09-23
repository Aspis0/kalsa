# Engine integration line - preparation report

Task: combine the four local engine refs into one pushable/pinnable line on top of
`kalsallama/main` (`833cde99b`), prove it with the standing targets, an Android arm64
build, and a kernel syntax check, and print the morning landing sequence.

Status: PREPARED ONLY. Nothing was pushed, nothing was tagged, no phone was touched.
The q6k f32-product change is carried but CONDITIONAL (section 2).

Worktree: `/Users/marco/Projects/kalsallama-wt-integration` (added detached off
`kalsa-gpu-opencl-v73`, then `git switch -c kalsa-engine-integration`). The shared
checkout `/Users/marco/Projects/kalsallama` was only read.

---

## 1. The line

Branch: `kalsa-engine-integration`
Final sha: `fe96676218bd48a6190332e59e1f54c3abc7b969` (short `fe9667621`)

```
833cde99b  main (server : stamp the cache namespace on a restored slot)
1068eb03d  gpu: no exit(1) on the OpenCL compile path, verdict keyed on the kernel set, V73 GPU prefill lane
533d40008  ggml-opencl : degrade weight-upload failures to a load error instead of abort
ad83b9fc9  opencl: compute the Adreno q6_K GEMM product in f32          <- CONDITIONAL, see 2
fe15ea668  governor : state raw t_idle_c in llama-ext.h and pin the sole-decider rule
fe9667621  governor : refuse a plugged baseline of 0 C or colder in the engine gate   <- tip
```

Five commits for four changes. Method: `git worktree add --detach ... kalsa-gpu-opencl-v73`,
`git switch -c kalsa-engine-integration`, then each remaining change replayed onto the
previous tip with `git cherry-pick` (the rebase replay, run this way so the four original
refs are never moved). No merges, no squashes.

### What the rebase did to each change

| # | change | original ref sha | on the line | rebase outcome |
|---|---|---|---|---|
| 1 | OpenCL compile-path / verdict key (gpu base) | `1068eb03d` | `1068eb03d` (same object) | Not rebased: already a direct child of `main`, used as the base as-is. |
| 2 | upload failures degrade to load error | `909243206` | `533d40008` | Clean, zero conflicts. Its original parent was `1068eb03d`, which is also the line tip at that point, so the diff applied exactly. |
| 3 | q6_K f32 product | `914b34a7e` | `ad83b9fc9` | Clean, zero conflicts. Replayed onto `533d40008` instead of `1068eb03d`; it touches only `kernels/gemm_noshuffle_q6_k_f32.cl`, change 2 touches only `ggml-opencl.cpp` - disjoint files. |
| 4 | governor doc + pin test | `942bc938c` | `fe15ea668` | Clean, zero conflicts. Replayed onto `ad83b9fc9` (original parent was `main`); it touches `src/llama-ext.h` + `tests/test-governor-v02-router.cpp`, disjoint from every OpenCL hunk. |
| 5 | governor `t_idle_c > 0.0f` guard | `35eeeae34` | `fe9667621` | Clean, zero conflicts. Same file as change 1 (`src/llama-governor-policy.cpp`) but a different hunk region (`profile_is_valid`, ~line 60, vs `prefill_engine`, ~line 163), so the two coexist. |

Proof the content survived: `git patch-id --stable` is IDENTICAL for all five
original-vs-rebased pairs. Proof the whole line equals the union of the four refs:
`git diff --name-status 833cde99b..kalsa-engine-integration` lists exactly 10 files
(ggml-opencl CMakeLists, cl-program-cache.cpp/.h, ggml-opencl.cpp, the q6_K .cl,
llama-ext.h, llama-governor-policy.cpp, tests/CMakeLists.txt, test-governor-v02-router.cpp,
test-opencl-moe-roundtrip.cpp) = the union of the refs' individual diffs.

All four original refs are untouched and still point where they did:
`kalsa-gpu-opencl-v73=1068eb03d`, `kalsa-opencl-upload-degrade=909243206`,
`kalsa-opencl-q6k-f32-product=914b34a7e`, `kalsallama-governor-sole-decider=35eeeae34`.

### One correction to the task table

The task states the governor ref commit `35eeeae3` has parent `833cde99b` (main).
Actual topology: `35eeeae34`'s parent is `942bc938c`, and `942bc938c`'s parent is
`833cde99b`. The ref carries two commits, and the described change ("doc, pin test,
`t_idle_c > 0.0f` guard") is exactly that pair: `942bc938c` is the doc (raw `t_idle_c`
in `llama-ext.h`) plus the pin test, `35eeeae34` is the guard and the pin flip.
Both were carried, in order, at the end of the line. The coordinator's own table also
records parent `942bc938`. No squash was needed - there was no conflict noise to hide.

---

## 2. CONDITIONAL: the q6_K f32-product commit

`ad83b9fc9` (opencl: compute the Adreno q6_K GEMM product in f32) is in the line, and its
inclusion is CONDITIONAL on the correctness gate of the measurement running on the phone
right now (built from `kalsallama-wt-q6k`, ref `kalsa-opencl-q6k-f32-product=914b34a7e`).
If that measurement fails the gate, drop it with exactly this, before anything is pushed:

```sh
cd /Users/marco/Projects/kalsallama-wt-integration
git rebase --onto 533d40008 ad83b9fc9 kalsa-engine-integration
git rev-parse kalsa-engine-integration    # new tip - use this sha in every landing step
```

Why this is the whole operation: `--onto 533d40008` (the upload-degrade commit, the one
before q6k) `ad83b9fc9..kalsa-engine-integration` selects the two governor commits
(`fe15ea668`, `fe9667621`) and replays them onto 533d40008, skipping `ad83b9fc9`.
The skipped commit touches only the .cl kernel; both replayed commits touch governor
files, so it applies clean. The tip sha changes (the parent chain changed), so re-read it
with `git rev-parse` and re-run sections 3-5 evidence before pushing. If the drop happens
after the push, it becomes a force-push on a line someone may already pin - do the gate
decision first, in the morning, before landing command 1.

---

## 3. Evidence 1 - the seven standing targets

Standing config, same as the previous records: Release, `GGML_METAL=OFF`,
`GGML_OPENCL=OFF`, Ninja generator, worktree `/Users/marco/Projects/kalsallama-wt-integration`.

- Configure: rc=0. Targets built: 8/8, build rc=0 (160/160 ninja steps).
- Fixture: ALREADY ON DISK - `/Users/marco/Projects/kalsallama/build/tinyllamas/stories15M-q4_0.gguf`
  (19,077,344 bytes, mtime Aug 28). No model build was needed. It was symlinked into the
  integration worktree as `build/tinyllamas/stories15M-q4_0.gguf` so the standing
  invocation `-m build/tinyllamas/stories15M-q4_0.gguf` is used verbatim.
- Binaries run directly from `build/bin`, alphabetical order, real `$?`.

| # | target | invocation | exit |
|---|---|---|---|
| 1 | test-governor-v0 | `-m build/tinyllamas/stories15M-q4_0.gguf` | 0 |
| 2 | test-governor-v0-commit | `-m` fixture | 0 |
| 3 | test-governor-v0-devices | `-m` fixture | 77 |
| 4 | test-governor-v0-hybrid | no `-m` (takes none) | 77 |
| 5 | test-governor-v0-shared-cells | `-m` fixture | 0 |
| 6 | test-governor-v0-turns | `-m` fixture | 0 |
| 7 | test-governor-v02-router | no `-m` (takes none) | 0 |
| (8) | test-governor-v0-mtp-hybrid (eighth, not standing) | `-m` fixture | 77 |

Seven standing targets: **0 0 77 77 0 0 0** - the expected sequence exactly.
Router log: `router_v02_golden=PASS`, `router_v02_metrics=PASS`; `FAIL` appears in zero
of the eight logs.

The bare-run trap, demonstrated first-hand on all five model-dependent targets (no `-m`):

```
test-governor-v0 bare:          exit 1 | error: --model is required
test-governor-v0-commit bare:   exit 1 | error: --model is required
test-governor-v0-devices bare:  exit 1 | error: --model is required
test-governor-v0-shared-cells bare: exit 1 | error: --model is required
test-governor-v0-turns bare:    exit 1 | error: --model is required
```

A bare exit 1 is a missing fixture, not a regression. Targets 1, 2, 3, 5, 6 need `-m`.

---

## 4. Evidence 2 - Android arm64 build of the combined line

Recipe reused from the phone bench (`build-android-ocl-1068`, `build-android-ocl-q6k`),
own build dir `/Users/marco/Projects/kalsallama-wt-integration/build-android-ocl-integration`:

```sh
cmake -B build-android-ocl-integration -S . -G Ninja \
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

Two recipe lines had to be recovered, both proven by the bench's own cache:

- `BUILD_SHARED_LIBS=OFF`. Without it the option defaults to ON; the shared
  `libllama.so` then links every object and `src/bmoe/platform_io.cpp` (>= API 26) leaves
  `AHardwareBuffer_allocate/lock/release/unlock` undefined - link error, rc=1. The bench
  cache says `BUILD_SHARED_LIBS:BOOL=OFF`; static link only pulls referenced objects, so
  the bench never met this.
- Explicit `OpenCL_INCLUDE_DIR` / `OpenCL_LIBRARY`. The NDK toolchain re-roots find_*
  paths to ONLY under the NDK root, so `CMAKE_PREFIX_PATH` alone does not find the
  prefix's headers/libs anymore (`find_package(OpenCL)` fails, configure rc=1). Presetting
  the two paths is exactly how the bench's cache reads
  (`OpenCL_INCLUDE_DIR:PATH=.../include`, `OpenCL_LIBRARY:FILEPATH=.../libOpenCL.so`).

Cache parity check: 16/16 key entries byte-identical between my configure and
`build-android-ocl-1068`'s (toolchain, ABI, platform, build type, all GGML_OPENCL flags,
OpenCL paths, GGML_METAL/CUDA/VULKAN=OFF, BUILD_SHARED_LIBS=OFF).
Configure summary: `GGML_AVAILABLE_BACKENDS=ggml-cpu;ggml-opencl`, 185 kernels embedded.

Build: `cmake --build build-android-ocl-integration --target llama-cli llama-perplexity`

- **Compiler exit code: 0** (408/408 ninja steps, 42.40 s real).
- Binaries: `bin/llama-cli` 165,490,384 bytes; `bin/llama-perplexity` 119,817,608 bytes;
  `file llama-cli` -> `ELF 64-bit LSB pie executable, ARM aarch64 ... interpreter
  /system/bin/linker64` (Android, not runnable on this Mac - no emulator, no qemu here).

Self-reported build/commit line. The binaries cannot be executed on macOS, so the line was
read out of the linked ELF itself:

- `strings` shows the format `version: %s (build %d, commit %s)` and, verbatim in BOTH
  binaries, the string `fe9667621` - the integration line's tip sha
  (`git rev-parse --short HEAD` of the worktree at configure time, embedded as
  `LLAMA_COMMIT` by `common/build-info.cpp.in`).
- `LLAMA_BUILD_NUMBER` was read from the ELF's `.data` at its symbol address: **11198**,
  which equals `git rev-list --count HEAD` on the line.
- The reconstructed line the phone will print: `version: <llama_version()> (build 11198,
  commit fe9667621)` - it names the integration line's sha, as required.
  (Compiler literal in the binary: `Clang 21.0.0`, NDK r29.)

---

## 5. Evidence 3 - .cl kernel syntax check

Scope: every .cl file the line touches. `git diff --name-only 833cde99b..HEAD -- '*.cl'`
returns exactly one file:

```
ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl   (change ad83b9fc9)
```

Command (the preregistered gate from the q6k audit), run from the worktree root:

```sh
/opt/homebrew/share/android-ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang \
    -x cl -cl-std=CL1.2 -Xclang -finclude-default-header -target spirv64 \
    -fsyntax-only ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl
```

Result: **exit 0.** One warning, `cl_qcom_reqd_sub_group_size unknown or does not require
pragma - ignoring [-Wignored-pragmas]` - present in the stock file, not added by the change.

Belt-and-braces sweep, all 185 .cl files under `ggml/src/ggml-opencl/`: 114 pass, 71 fail
the bare gate. The 71 failures are stock parameterized kernels that need their per-kernel
`-D` defines from `ggml_opencl_add_kernel` (first errors: `undeclared identifier
'N_SIMDGROUP'`, `'BLOCK_M'`, `'DK'` - plain-file syntax check has no `-D`). Every one of
those 71 files is byte-identical to `main` (the line's only .cl delta is the one file
above, and it passes), so they are pre-existing, not introduced, and out of scope. The
kernel-set verdict key added by `1068eb03d` hashes the sources at configure time, so the
embed build also fails loudly if a touched kernel source changes.

---

## 6. LANDING COMMANDS (for the morning - nothing below has been run)

Run the block top to bottom in ONE shell, so the variables survive. Every line is
copy-pasteable. Nothing here was executed or prepared by the agent: no push, no tag.

Gate decision first: if the phone q6k measurement fails, run the section-2 drop command
BEFORE step 1; after the push, dropping becomes a force-push.

```sh
# 0) the engine sha every later step names (works before or after a q6k drop)
cd /Users/marco/Projects/kalsallama
ENGINE_SHA=$(git rev-parse kalsa-engine-integration)   # now fe96676218bd48a6190332e59e1f54c3abc7b969
echo "$ENGINE_SHA"
```
Rationale: one variable computed from the ref, so the binding pin and the manual checks
cannot disagree with the actual branch tip.

```sh
# 1) push the engine line to the fork (owner at the keyboard - never automated)
git push origin kalsa-engine-integration
```
Rationale: step 2's `sync:vendor` clones `LLAMA_CPP_REPO` (https://github.com/Aspis0/kalsallama)
at `LLAMA_CPP_REF` from GitHub, so the line must exist on the remote before the binding
can pin it; this is the single push that makes the whole line pinnable.

```sh
# 2) bump the binding's engine pin: edit REF only, sync rewrites COMMIT itself
cd /Users/marco/Projects/llama.rn-kalsa-wt-gov-transport     # branch kalsarn-governor-transport, at b97c581d
sed -i '' "s|^LLAMA_CPP_REF=.*|LLAMA_CPP_REF=$ENGINE_SHA|" vendor/VERSIONS
npm run sync:vendor
```
Rationale: `sync-vendor.sh` resolves REF to COMMIT, re-vendors `vendor/llama.cpp` from the
remote at that sha, and re-applies the 21 patches in `scripts/patches/llama.cpp/`; doing
the edit by hand without the script would leave `LLAMA_CPP_COMMIT` and the vendored tree
contradicting the REF. Watch-out: the script is `set -eo pipefail` - if any old patch no
longer applies against the new engine it stops; resolve each failure deliberately, do not
drop patches silently.

```sh
# 3) land b97c581d plus this bump, and push the binding (owner writes the commit message)
git add vendor/VERSIONS vendor/llama.cpp
git commit -m "build(engine): pin llama.cpp to ${ENGINE_SHA:0:9} (integration line)"   # edit freely
git push origin kalsarn-governor-transport
BINDING_SHA=$(git rev-parse HEAD)
echo "$BINDING_SHA"
```
Rationale: the app pin and the provenance gate both fetch
`github:Aspis0/kalsa.rn#<40-hex>` from GitHub, so the binding commit that carries both the
transport fix (`b97c581d`) and the engine bump must be on the remote before the app can
name it - pinning bare `b97c581d` alone would still ship engine `4ccef2f8`.

```sh
# 4) bump the app's llama.rn pin - package.json, lockfile, node_modules in one move
cd /Users/marco/Projects/kalsa-wt-gov-policy     # kalsa-governor-policy-consolidate at 0db9dc68
npm install "llama.rn@github:Aspis0/kalsa.rn#$BINDING_SHA"
```
Rationale: one `npm install` rewrites `package.json:49`, the spec (line 41) and resolved
(git+ssh) lines of `package-lock.json`, and `node_modules/llama.rn` together, so the three
can never drift apart; it runs in the app worktree at `0db9dc68` so binding lands at or
before the app, the order the coordinator fixed (never app-first).

```sh
# 5) the provenance gate - must exit 0 before any build
bash scripts/assert-engine-provenance.sh
# expect: "OK: ... files match Aspis0/kalsa.rn@..." and "engine inside it: kalsallama@fe9667621"
# (the sha printed must equal $ENGINE_SHA, truncated to 12)
```
Rationale: this is the check whose absence produced yesterday's non-reproducible APK - it
downloads the fork tarball at the locked sha and diffs it file-for-file against
`node_modules`, so an exit 0 proves the APK's engine is exactly the pushed line.

```sh
# 6) build only from that pinned state
npm run android        # expo run:android -> APK
```
Rationale: all three pins (engine line, binding, app) are now fixed and verified, so an
APK built at this moment carries the four engine changes, the transport fix, and the
provenance stamp - and can be rebuilt identically later.

Residual risks to carry into the morning: (a) the q6k gate may still fail - section 2 is
the whole drop; (b) `sync:vendor` patch application against the new engine tree is the
one untested link; (c) section 3 evidence must be re-run after any drop, since the tip
sha changes and every pin downstream names that sha.

---

## 7. Deliberately not done

- No `git push` anywhere, no tags, no PRs, no comments or messages written on the owner's
  behalf beyond the one-line commit template the owner is expected to edit.
- The phone was not touched; the in-flight q6k measurement owns it.
- The four original refs were not moved; all verification above ran in the new worktree.
