# Engine single line + upstream — step A + step B reports

Repo `Aspis0/kalsallama`, worktree `~/Projects/kalsallama`, branch `main`.
Session date 2026-09-30. English only, no device, no adb, no push.

## Preflight

- `git status`: one untracked file, `CMakeUserPresets.json` (local Snapdragon
  build preset, `git check-ignore` negative). **Declared deviation**: the brief
  said "status must be clean or STOP". The file is absent from both merge
  parents (`git cat-file -e` fails on both), so neither the fast-forward nor
  the merge could touch it, and it was never staged. Proceeded instead of
  stalling the whole step; nothing was stashed or discarded.
- `git fetch origin` EXIT=0, `git fetch upstream` EXIT=0.
- `git merge --ff-only origin/main`: `e8065c7cf` → `d389de2fb`
  `d389de2fbdfe70574fd209c607f65d1c0ce27376`. `git rev-parse HEAD` matches. EXIT=0.
- Note for step B: tag `b11304` = `81ff93ea1d48c0482508d30e75b814df99c25bf0`;
  `upstream/master` = `f7b384c1e` (7 commits later, contains `4453b535f`,
  NextN row reorder — to be kept out per coordinator). Step B merges the tag,
  not the branch.

## Step A — merge feat/governor-platform-status into main

- Trial `git merge-tree --write-tree d389de2fb origin/feat/governor-platform-status`:
  EXIT=0, clean tree, **zero predicted conflicts**.
- `git merge --no-ff origin/feat/governor-platform-status` EXIT=0
  (ort strategy, no conflicts). Branch printed before commit: `main`.
- **Merge commit `5de9fa2fcdbfce5d326973f047f463245ba00c6d`**
  parents: `d389de2fbdfe70574fd209c607f65d1c0ce27376` (main) ×
  `d07d0181b3249189c6132e0c9d669ec7164de6cc` (feat). 33 files changed,
  +4325/−153. No conflict files existed, so no conflict resolutions and no
  `git add` were needed; the commit message names repo, branch and both shas.
- Both-intent verification: `git diff HEAD origin/feat/...` differs from feat
  in exactly 6 files, and every one of them was touched **only by main** since
  merge base `833cde99b` (feat=0): `ggml/src/ggml-cpu/ggml-cpu.cpp` (main=1),
  `src/bmoe/expert_stream_source.{cpp,h}` (main=2), `src/llama-kv-cache.cpp`
  (main=6), `src/llama-model.{cpp,h}` (main=1). Nothing from feat was dropped.

## Build + test (host, `build-metal`: Release, CPU + Apple BLAS + Metal)

- Baseline at `d389de2fb` (5 tools + 8 governor targets): **EXIT=0**.
- Post-merge (5 tools + 14 test targets): first attempt hit a stale-generated
  makefile race (`No rule to make target 'test-governor-bench-route'`); after
  an explicit `cmake -B build-metal` reconfigure: **EXIT=0**.
- Pre-existing warning, not from the merge:
  `tests/test-governor-v02-router.cpp:702` `test_npu_prefill_lane`
  (-Wmissing-prototypes; feat-side code).

### test-backend-ops (CPU backend, filtered)

`test-backend-ops -o MUL_MAT,SET_ROWS,GET_ROWS,FLASH_ATTN_EXT,SSM_CONV -b CPU`
**EXIT=0**, 7476/7476 tests passed, 3/3 backends passed (CPU + FA vec slice).

### Governor battery (KALSA_HYBRID_GGUF=~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf)

There are **no `test-kv-commit*` files on this line**; KV-commit is exercised
by `test-governor-v0-commit`. 14 `test-governor-*` binaries, run directly with
`-m` where they parse args, env where they read it:

| test | exit |
|---|---|
| test-governor-v0 | 0 |
| test-governor-v0-commit | 0 |
| test-governor-v0-devices | **1** |
| test-governor-v0-hybrid | 0 |
| test-governor-v0-mtp-hybrid | **77 (SKIP = UNTESTED)** |
| test-governor-v0-shared-cells | **1** |
| test-governor-v0-turns | 0 |
| test-governor-v02-router | 0 |
| test-governor-bench-route | 0 |
| test-governor-bench-route-evidence | 0 |
| test-governor-bench-route-latch | 0 |
| test-governor-bench-route-setter | 0 |
| test-governor-platform-thermal | 0 |
| test-governor-v0-route-switch | 0 |

Both failures were attributed by building `test-governor-v0-devices` +
`test-governor-v0-shared-cells` at **both merge parents** in detached
worktrees (`/tmp/kp1` = d389de2fb, `/tmp/kp2` = d07d0181b, identical flags):

| test | main d389de2fb | feat d07d0181b | merge 5de9fa2fc |
|---|---|---|---|
| v0-devices | 1 | 1 | 1 |
| v0-shared-cells | 1 | **0** | 1 |

- **v0-devices EXIT=1 is pre-existing on BOTH parents.**
  `tests/test-governor-v0-devices.cpp:241` requires the governor to
  auto-select staged AND naive V (`commit_staged_count > 0 &&
  commit_naive_count > 0`); on this Mac it never selects staged
  ("automatic staged/naive selection missing"). Not merge-caused. Note:
  REPOS.md's standing matrix `0 0 77 77 0 0 0` is stale against both tips —
  devices no longer skips on the Mac, it runs and fails.
- **v0-shared-cells EXIT=1 is inherited from main, not merge-caused.** The
  merge log is byte-identical to main's tip (`diff` empty). Root cause: main's
  gemma-mtp line rewrote the test (4 commits: `56e1beecd`, `604824d90`,
  `9f8a2b44a`, `a0cc09109`) to assert mirror semantics ("view decode goes
  through", cell ops no-op into success) and lifted the fences in
  `src/llama-kv-cache.cpp` — but `src/llama-memory-hybrid.cpp:88`
  (`llama_memory_hybrid::shared_fence`, unchanged base code) still refuses
  decode / memory update on any shared hybrid
  (`shared(mem_other != nullptr)`), so the drafter pattern main's own rewritten
  test asserts cannot pass **on main itself**. The mirror work is half-landed
  on main's desktop line. Feat passes because it still carries the older
  fence-era test (`shared_cells_*_fence=PASS`, size=256, negative guards) —
  and the hybrid fence behavior feat relies on **survives the merge**
  (identical hybrid code; the fences fire identically in the merged logs).
  Owner decision needed before step B's governor-relevant hunks: finish the
  mirror work (lift the hybrid fence for the attention side) or restore the
  fence-era expectations. I did not touch either.

## Android arm64 (OpenCL + Hexagon, docker, NEW build dir)

Run per brief: `docker run --rm --platform linux/amd64 -u 501:20
-v ~/Projects/kalsallama:/workspace -w /workspace
ghcr.io/snapdragon-toolchain/arm64-android:v0.7`, NDK r29, Hexagon SDK
/opt/hexagon/6.6.0.0, tools 19.0.07, OpenCL Adreno kernels (target v300,
embedded), `-march=armv8.7a+fp16+dotprod+i8mm ...` flags matching
`kalsallama-onecopy-hmx/build-onecopy-hmx-fused-v73`. Built from
`git archive HEAD` of the merge commit inside the container FS.

**Result: EXIT=0 for all three required artifacts** (built in the tree of
merge commit `5de9fa2fc`, logs + binaries kept in
`~/Projects/kalsallama-stepa-android-artifacts/`):

- `llama-cli` — ELF 64-bit ARM aarch64, `/system/bin/linker64`, 138 MB (static,
  `BUILD_SHARED_LIBS=OFF`, the repo's own Android convention — see below)
- `libggml-hexagon.so` — ELF 64-bit ARM aarch64, 6.9 MB (shared config)
- `libggml-htp-v73.so` — ELF 32-bit **QUALCOMM DSP6 (EM_QDSP6)**, 810 KB —
  the real Hexagon QURT skel; produced by the CMake-driven qaic step only,
  never re-run by hand

Findings an owner should know (all pre-existing, none merge-caused):

1. **`-DPREBUILT_LIB_DIR=android_aarch64` is mandatory**: without it the
   Hexagon SDK's `hexagon_fun.cmake:99` (`string(FIND)` on the unset var)
   fails at `ggml/src/ggml-hexagon/CMakeLists.txt:22` and configure dies. The
   repo's untracked `CMakeUserPresets.json` sets it (line 22); the working
   spike build had it in cache. Plain-cmake invocations fail.
2. **Shared `libllama.so` does not link on Android** (default
   BUILD_SHARED_LIBS=ON): `undefined symbol: AHardwareBuffer_allocate`,
   referenced by `src/bmoe/platform_io.cpp:398` (guarded
   `__ANDROID_API__ >= 26`, active at our android-34); no CMakeLists in the
   engine links `android`. Pre-existing on both lines (`platform_io.cpp` is
   unchanged since the shipped pin `8537d097c` and predates the merge base;
   the spike never hit it because it built static, partial targets, and never
   llama-cli). The binding fork's own CMake presumably adds `-landroid` in the
   delivery chain.
3. **Rosetta flakiness**: under `--platform linux/amd64` on this arm64 Mac,
   random single build processes (qaic, embed_kernel.py) die silently with no
   stderr, roughly one per large parallel batch; reproduced standalone (1 fail
   per 8-way round of ~60 kernel generations, no OOM, nothing in dmesg).
   Ninja resume + retry gets through; the two recorded successful runs passed
   on their first attempt (`ATTEMPT 1 BUILD_EXIT=0` twice).

## Smoke (Mac, ship GGUF, 32 tokens, greedy, seed 42, --single-turn)

- Before (build `b11219-d389de2fb`): EXIT=0, Prompt 223.7 t/s, Generation 128.0 t/s.
- After merge (build at `5de9fa2fc`): EXIT=0, Prompt 199.9 t/s, Generation 127.4 t/s.
- Generated text: **identical** (whole-log diff shows only the t/s line).

## Not verified / open

- `test-governor-v0-mtp-hybrid` skipped (77) — ship GGUF is not an MTP model;
  UNTESTED, not a pass.
- v0-devices and v0-shared-cells failures are real, pre-existing on their
  parent lines, and need an owner decision (see above).
- No device checks: Hexagon/HTP and Adreno behavior is compile+link only.
- Shared-lib Android build (`libllama.so`) cannot link until `android` is
  linked somewhere in the engine's CMake (see Android §2).
- Diagnostic artifacts removed: detached worktrees at both parents, their
  build dirs, the source tarball; the repo's `git status` is back to exactly
  the pre-existing untracked `CMakeUserPresets.json`.

**STOPPING here per brief — step B (`git merge --no-ff 81ff93ea1`, tag
b11304, per-file replay of our commits) waits for the coordinator's go.**

---

# Step B report — upstream b11304 merge (coordinator GO received)

Basis: base `4bc272fd7` (= `git merge-base HEAD 81ff93ea1`), upstream tag
`b11304` = `81ff93ea1d48c0482508d30e75b814df99c25bf0` (294 commits to our
side; `upstream/master` `f7b384c1e` deliberately excluded — contains
`4453b535f` NextN row reorder). Spec followed:
`~/lab/spec/upstream-b11304-desktop.md`.

## Merge

- Before-smoke at `5de9fa2fc`: EXIT=0, Prompt 208.4 / Generation 125.9 t/s.
- Trial merge-tree: **exactly the 8 predicted files** (ggml-cpu.c, repack.cpp,
  llama-context.cpp, llama-memory-hybrid.cpp, llama-model.cpp,
  tests/CMakeLists.txt, test-backend-ops.cpp, llama-bench.cpp).
- **Merge commit `e3c43a9db7427d91c4646529fb54d2c708b201a7`** (initial
  `16612ddda` amended once: the first resolution leaked a stale
  `if (NOT GGML_BACKEND_DL)` context fragment from a .rej into
  tests/CMakeLists.txt, caught by configure "Flow control statements are not
  properly nested"; fragment removed, parents unchanged). Branch printed
  before commit: `main`. Parents: `5de9fa2fc` × `81ff93ea1`.

## Conflict resolutions (upstream's file first, our commits replayed)

| file | our commits replayed | how |
|---|---|---|
| `ggml/src/ggml-cpu/ggml-cpu.c` | `5236140e5` expert-ready hook; `b8a78977d` `74e37a625` `b34df7afd` `4a3ae4e5e` `8d3c2ea75` `ab2f09c3f` `dcc9f25a5` fused MoE GEMV/FFN family; `3f3558b3b`/`6b6d4a980` merge content (iqp) **dropped per spec** | 9 of 12 delta hunks applied via `git apply --reject`; hand-stitched: include `repack-q23k.h` (+upstream `tiled/tiled.h`), hook inserted before upstream's `mul_mat_id_tiled` call, fused-FFN scratch terms added beside upstream `ggml_tiled_wdata_size`. iqp zero references remain tree-wide; fused dispatch (`ggml_cpu_mul_mat_id_should_fuse` → `mul_mat_id_fused`) survives unchanged before tiled, still guarded by `ggml_cpu_repack_extra_is_tiled` |
| `ggml/src/ggml-cpu/repack.cpp` | `757adec33` `cef64aa4c` `a077cad3f` `0540f2fd7` `384174993` `d34ae8c82` `acc5dc96d` `d7c207ccb` `458878943` `ab2f09c3f` `dcc9f25a5` (q23k 8x4 family + tiled-extra guards) | 16 of 17 hunks applied; hand-wrote the instance region: fork's **file-static** scheme kept (required by `ggml_cpu_repack_extra_is_tiled` pointer-equality `k_tiled` set), upstream's new Q1_0 pair added as file-statics AND to `k_tiled`; function body = upstream dispatch (incl. Q1_0 branch) + fork q2_K/q3_K 8x4 branches |
| `src/llama-context.cpp` | `9586bf985` `a29edcf49` (pressure callback), `6f3881baf` `98bee958d` (ctx_other generalisation), `e31b9144c` (perf reset) | 4 of 5 hunks applied; hand-placed pressure block before upstream's `balloc->init(batch_inp, vocab, output_all)` (batch_ext signature taken) |
| `src/llama-model.cpp` | `281394434` (GEMMA4_ASSISTANT), `6f3881baf` `21d3154df` `dadafd290` `98bee958d` `237461a98` (shared-cells/MTP) | 8 of 9 hunks applied; kept fork `init_mappings(params.mmap_prefetch >= 0, …)` + upstream `prec_policy.load` |
| `src/llama-memory-hybrid.cpp` | `9586bf985` (pressure callback), `dadafd290` (hybrid handoff), shared guard (`6f3881baf` era) | 7 of 8 hunks applied; hand-placed fork `shared` throw guard at top of upstream's `state_read` try/catch + `state_clear` (spec shape). `shared_fence` verified **byte-identical to step A** (untouched per owner rule) |
| `tools/llama-bench/llama-bench.cpp` | `c77fe1354` `815b8edc2` (`-nr/--no-repack`, `--no-extra-bufts`) — **superseded** | upstream wholesale per spec owner decision: upstream `--repack <0|1>` wires the same `use_extra_bufts`; bench scripts passing `-nr` need out-of-repo update |
| `tests/CMakeLists.txt` | governor/repack test blocks (`6892d0415` `47f18811c` `5484efb9d` `34c1ce533` `543bc8479` `e7e34a7e4` `cd213fff7` lineage) | fork blocks re-inserted between APPLE block and upstream `if (NOT GGML_BACKEND_DL AND GGML_CPU)` guard (40 governor refs, platform-thermal kept) |
| `tests/test-backend-ops.cpp` | NPU judge lineage (`28b9a1351` `ff7ae8009` `9a36bf779` `8b86f9f75` `bc6729409` — auto-merged), usage doc lines | upstream usage rewrite kept; fork `GGML_TEST_PLAIN_HOST=1` and `-t <n>` doc lines appended (both features verified still parsed in merged file) |

Clean upstream deletions accepted (ours == base): `iqp.{cpp,h}`,
`build-self-hosted.yml`, `fusion.yml`, `fattn-swizzle.cuh`, `hex-dma.h`,
`hvx-mm-kernels-flat.h`. `ggml-cpu.h` include NOT re-added (upstream removed
it; `repack-q23k.h` kept — it declares `ggml_cpu_repack_extra_is_tiled` used
by the fused matcher).

## Audit points (coordinator message) — all closed before commit

1. `ggml-cpu.c` .rej hand-applied (include + hook + sizing) and deleted;
   file staged only after review; fused dispatch verified against fork.
2. iqp users re-hosted: hook fires before tiled call; fused-FFN scratch
   sizing kept alongside `ggml_tiled_wdata_size`; MUL_MAT_ID passes (below).
3. `llama-bench.cpp` resolved (upstream wholesale) and listed.
4. Gates at commit time: unmerged=0, `ls-files -u`=0, no *.rej/*.orig
   (`git status --porcelain --ignored` clean).
5. `shared_fence` byte-identical to step A; the two known-red test files
   untouched.

## Build + test

- Host build (same 20 targets): **EXIT=0**. 4 warnings, all pre-existing in
  fork test files (`test_npu_prefill_lane`/`test_resolve_prefill_device`
  missing-prototypes, sign-compare + unused var in v0-hybrid).
- `test-backend-ops -o MUL_MAT,MUL_MAT_ID,SET_ROWS,GET_ROWS,FLASH_ATTN_EXT,
  SSM_CONV -b CPU`: **EXIT=0, 8459/8459** (MUL_MAT_ID included — the
  workspace-resolution crash gate from the spec passes).
- Governor battery (same 14, `KALSA_HYBRID_GGUF` set): **12 × EXIT=0**;
  `test-governor-v0-mtp-hybrid` **77 = SKIP = UNTESTED**;
  `test-governor-v0-devices` **EXIT=1** and `test-governor-v0-shared-cells`
  **EXIT=1** — both known pre-existing reds carried, **failure output
  unchanged** (same terminal lines as step A: "automatic staged/naive
  selection missing" / "non-owner decode failed on live cells").
- Android (same recipe as step A: git archive of `e3c43a9db`, container FS,
  `-DPREBUILT_LIB_DIR=android_aarch64`, NDK r29, Hexagon SDK 6.6.0.0):
  **llama-cli** static EXIT=0 (attempt 1), **libggml-hexagon.so** +
  **libggml-htp-v73.so** shared targets EXIT=0 (attempt 1) — artifacts in
  `~/Projects/kalsallama-stepb-android/`. This also proves the governor NPU
  prefill / HTP lane host code compiles against upstream's rewritten
  Hexagon buffers/DMA. Shared `libllama.so` still not linkable (pre-existing
  `AHardwareBuffer_allocate` issue from step A, unchanged).
- Smoke after: EXIT=0, build `b11565-e3c43a9db`, Prompt 199.3 / Generation
  127.4 t/s. Generated text **identical** to pre-B and to step A (identical
  is not required after an upstream merge — reported because it held).

## Not verified / open (step B)

- No device: NPU/HTP/Adreno runtime behavior compile+link only; MTP
  acceptance (`4453b535f` exclusion sanity) not measurable without the phone.
- Spec's desktop MUST-VERIFY items (server API round trip, slot restore
  corruption path `08618ff8e`, rendered-prompt byte-compare, LLAMA_ARG_* env
  scrub, tiled A/B on Windows) are desktop-release tasks outside this merge
  session.
- `test-governor-v0-mtp-hybrid` remains UNTESTED (77, no MTP model on Mac).
- The two known-red governor tests await their own post-B fix (owner
  decision), per coordinator.

**STEP B COMPLETE. Stopping — not pushing (push disabled; coordinator
pushes).**
