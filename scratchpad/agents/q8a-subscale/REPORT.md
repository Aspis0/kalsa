# REPORT - q8a-subscale: KALSA_Q8A_SUBSCALE promotes the q8_1 activation sub-block sum `sa` to f32

Status: COMPLETE - built, gated, seven targets run, reported. Nothing pushed, nothing
tagged, no upstream, no phone contact, no PR (all push commands in section 9 UNRUN).

Boundaries held by this cell: no push, no tag, no upstream, no PR, no phone contact.
Shared checkout `/Users/marco/Projects/kalsallama` read only - `git status --porcelain=v1`
snapshotted before the session (`/tmp/q8a-subscale-shared-status-before.txt`, 12 lines).
Own worktree: `/Users/marco/Projects/kalsallama-wt-phone-engine-v2`, detached at
**`1577495b92096fca572f57a35b71607bacac85d5`** (branch `kalsa-phone-v1-1-1` tip, the line
the phone ships).

Why this build exists: probe **Z2** (`GGML_OPENCL_Q4K_DENSE_DP4A=1`, stock env, batch 256)
returned **KLD 5.103422 / PPL 2556.19 / same-top 12.373 %**
(`../s23-kld-740-q4-0/REPORT.md` §27.1). Its pre-registration (§27) registered in advance
that a *large worsening* would be **ambiguous**, because forcing the q4_K path brings the
fp16 `sa` sub-block sum alive, and §27 states the obstacle in one line: no env exists to
run the sa-in-fp32 twin - the consumer signature is hardwired `__global const half
*src1_sa`, so the twin needs a build. That is this build.

## 1. Inventory (written BEFORE any code changed, line numbers at `1577495b9`)

### 1.1 The writer in scope

One quantiser writes `sa` for every dense dp4a dispatch in scope:
`kernels/quant_a_q8_1.cl` (50 lines) - `sa` parameter `:19`
(`__global half * sa`), store `:49` (`sa[blk] = (half)(d * (float)sum);`). Its sibling
`da` at `:18`/`:48` is already `q8a_t` (the `87f31d81f` promotion, cherry-picked here as
`e1cfb60f7`).

A second writer, `kernels/moe_reorder_quant_a_q8_1.cl` (`:17`, store `:63`), feeds only the
7 MoE dispatch sites. Different kernel, unreachable with the shipped dense model
(`n_expert = 0`), and outside this task's scope ("the quantiser kernel" = `quant_a_q8_1.cl`).

### 1.2 Consumers of `sa` fed by that writer - 4 files, 6 entry points

| file | entry points | `src1_sa` | `sh_s` decl | staged load |
|---|---|---|---|---|
| `kernels/gemm_noshuffle_q4_0_q8_1_dp4a.cl` | `:30` | `:35` | `:58` | `:93` |
| `kernels/gemm_noshuffle_q4_k_q8_1_dp4a.cl` | `:56`, `:172 _wimg` | `:63`, `:179` | `:89`, `:209` | `:135`, `:249` |
| `kernels/gemm_noshuffle_q5_0_q8_1_dp4a.cl` | `:39`, `:138 _wimg` | `:45`, `:144` | `:68`, `:169` | `:103`, `:203` |
| `kernels/gemm_noshuffle_q5_k_q8_1_dp4a.cl` | `:56` | `:64` | `:91` | `:132` |

The q4_K lines `:135`/`:249` are the exact consumer lines the §27 pre-registration names.
Every consumer stages `sa` through `__local half sh_s[]` and converts to float at use
(`LD4(sh_s, b)`), so - as with `da` - the promotion has to change the buffer element type,
the local staging type, and the load cast together, or the value re-flushes on the way in.

Dense dp4a GEMMs that do **NOT** read `sa` (writer still writes it, value dead):
`gemm_noshuffle_q6_k_q8_1_dp4a.cl`, `gemm_noshuffle_q8_0_q8_1_dp4a.cl`,
`gemm_noshuffle_iq4_nl_q8_1_dp4a.cl`. MoE dp4a GEMMs read `sa` but are fed by the other
writer - untouched.

### 1.3 Host dispatch sites of this writer (7 dense), with sa-buffer line

| site (tensor class) | `prealloc_moe_sa` alloc | writer pick | consumer pick | in scope? |
|---|---|---|---|---|
| q4_0 `GGML_OPENCL_Q4_0_DENSE_DP4A` (default off) | `:20909` | `:20912` | `:20922` | **yes** (reads sa) |
| q5_0 `GGML_OPENCL_Q5_DENSE_DP4A` (default off) | `:21352` | `:21355` | `:21384-85` | **yes** |
| iq4_nl (X2E default) | `:21794` | `:21797` | no sa read | no |
| q8_0 (opt-in) | `:22110` | `:22113` | no sa read | no |
| **q4_k = the Z2 path** (`GGML_OPENCL_Q4K_DENSE_DP4A`, default X2E only) | `:22837` | `:22840` | `:22871-72` | **yes** |
| q6_K (`KALSA_Q6K_DENSE`, default dp4a) | `:23235` | `:23238` (the only `_f32` pick) | no sa read | no |
| q5_K (X2E default) | `:23573` | `:23576` | `:23586` | **yes** |

7 MoE writer sites (`:27431, 27849, 28231, 28615, 28841, 29166, 29730`): untouched.

### 1.4 What the `da` fix actually covers - FINDING, read off the code before building

`kalsa_q8a_scale_f32()` (`:1569-1583`, `KALSA_Q8A_SCALE`, unset -> fp32, bogus ->
error + `exit(1)`) builds the flagged quantiser (`:4565-4569`) and the flagged q6_K GEMM
(`:4543-4547`), and **the flag is selected at exactly one dispatch site: q6_K `:23238`**.
The base quantiser build (`:4557`) carries no flag, so its `da` is `half`, and the q4_K
site (`:22840`) picks that base build while its consumer types `src1_da` as `half`
(`gemm_noshuffle_q4_k_q8_1_dp4a.cl:62,178`).

Consequence, stated before the build so it cannot be discovered later: **on the Z2 (q4_K)
path `da` is still fp16 in the shipped configuration; `KALSA_Q8A_SCALE` does not act
there.** The `87f31d81f` fix removed the `da` flush on the q6_K path it was measured on.
The twin built here removes the *second* fp16 scale (`sa`) exactly as tasked; if the
attribution arm does not recover Z2, the `da` leg on this path (plus the 32-vs-256 grid
of `../opencl-q8-activation-scale/REPORT.md` §3.1) is still standing. Queue item, not
folded into this commit - the task scopes the diff to `sa` and "nothing else".

## 2. The change as built - commit `f0811bd315eee844bfac10206b50480668d231a7`

Stack: `1577495b9` (committed) -> `f0811bd31` (this), one commit, worktree clean after
(`git status --porcelain` = 0 lines). `git rev-list --count HEAD` = **11202** (was 11201).
ASCII check on the staged diff: 0 non-ASCII lines.

`git show --stat`:

```
 ggml/src/ggml-opencl/ggml-opencl.cpp               | 99 +++++++++++++++++++---
 .../kernels/gemm_noshuffle_q4_0_q8_1_dp4a.cl       | 14 ++-
 .../kernels/gemm_noshuffle_q4_k_q8_1_dp4a.cl       | 20 +++--
 .../kernels/gemm_noshuffle_q5_0_q8_1_dp4a.cl       | 20 +++--
 .../kernels/gemm_noshuffle_q5_k_q8_1_dp4a.cl       | 14 ++-
  ggml/src/ggml-opencl/kernels/quant_a_q8_1.cl      | 12 ++-
 6 files changed, 145 insertions(+), 34 deletions(-)
```

**Diff scope = the quantiser + the four consumers of `sa` + their host wiring, nothing
else** (the task's scope rule, enforced file by file):

| file | what changed |
|---|---|
| `kernels/quant_a_q8_1.cl` | writer: `q8s_t` typedef (`float` under `-DKALSA_Q8A_SUBSCALE_F32`, else `half`), `sa` parameter and store use it |
| `kernels/gemm_noshuffle_q4_k_q8_1_dp4a.cl` | 2 entry points (plain + wimg): typedef, `src1_sa` signature, `__local sh_s` staging, `(q8s_t)0` fallback |
| `kernels/gemm_noshuffle_q4_0_q8_1_dp4a.cl` | same 4 edits, 1 entry point |
| `kernels/gemm_noshuffle_q5_0_q8_1_dp4a.cl` | same 4 edits, 2 entry points |
| `kernels/gemm_noshuffle_q5_k_q8_1_dp4a.cl` | same 4 edits, 1 entry point |
| `ggml/src/ggml-opencl/ggml-opencl.cpp` | 7 new `cl_kernel` handles (all `= nullptr`, inside the same `#ifdef GGML_OPENCL_USE_ADRENO_KERNELS` block as their base handles); selector `kalsa_q8a_subscale_f32()`; 5 extra program builds gated on it (each `compile_opts`/`dp4a_opts` + ` -DKALSA_Q8A_SUBSCALE_F32`, only when the arm is fp32, programs released after `clCreateKernel` like the stock pattern); 1 `GGML_LOG_WARN` arm line; the 4 dispatch sites pick writer build, consumer build, and `prealloc_moe_sa` element size by arm |

Deliberately untouched: `moe_reorder_quant_a_q8_1.cl` (the other writer) and every MoE
GEMM (out of scope: not the quantiser in the task, unreachable with the dense shipped
model); the 3 dense sites whose `sa` is written but never read (iq4_nl `:21797`, q8_0
`:22113`, q6_K `:23238`) - they keep the stock writer build, so no dead-data buffer size
moves either; `KALSA_Q8A_SCALE` handling everywhere (see section 3); the `da` typing at
the armed sites (stays `half`, exactly as shipped - changing it would move two variables
in the Z2 twin).

Buffer-safety note (same argument as `../opencl-q8-activation-scale/REPORT.md` §2.2):
`prealloc_moe_sa` is one grow-only buffer shared by all 14 sites; each site writes its
whole `n_blocks` region with its own writer before its own consumer reads it, on one
in-order queue, so fp32/fp16 arm orderings are both safe (fp32-then-fp16 reuses the
oversized buffer and rewrites it as halves; fp16-then-fp32 sees `4n > 2n` and reallocs).

## 3. Selector truth tables (harness: both functions `awk`-extracted from the file bytes,
compiled with `c++ -std=c++17`, run per env value; logs `/tmp/q8a-subscale/sel/`)

### `KALSA_Q8A_SUBSCALE` (this commit) - default **fp16**

| `KALSA_Q8A_SUBSCALE` | returns | arm |
|---|---|---|
| unset | 0 | **fp16 = today's behaviour (default)** |
| `""` (empty) | 0 | fp16 (default) |
| `fp16` | 0 | fp16, explicitly |
| `fp32` | 1 | **float `sa` end to end at the 4 armed sites** (the Z2 twin arm) |
| `bogus` | rc=1 | `ggml_opencl: unrecognized KALSA_Q8A_SUBSCALE='bogus' (use fp16|fp32)` then `exit(1)` - an A/B can never run the wrong arm silently |
| `FP32` (wrong case) | rc=1 | same rejection (case-sensitive, same as the `da` selector) |

Cross combinations, both selectors set (subscale x scale): `fp32/fp16` -> 1/0,
`fp16/fp32` -> 0/1, `fp32/fp32` -> 1/1, `fp16/fp16` -> 0/0. The two selectors are
independent; neither reads the other's env.

On-device confirmation line (WARN, survives the bench stderr filter, printed at load
next to the existing one):
`ggml_opencl: q8_1 activation subscale: fp16|fp32 (KALSA_Q8A_SUBSCALE)`.

### `KALSA_Q8A_SCALE` (the `da` selector) - UNTOUCHED, still defaults to f32

Proof it did not move, two ways:

1. Byte compare of the extracted function, HEAD blob vs working tree:
   `cmp .../da_sel_HEAD.inc .../da_sel_WT.inc` -> **rc=0, 14 lines, byte-identical.**
   The extraction is `awk '/^inline bool kalsa_q8a_scale_f32\(\)/,/^}/'` over
   `git show HEAD:ggml/src/ggml-opencl/ggml-opencl.cpp` and over the working file.

| `KALSA_Q8A_SCALE` (subscale held unset) | returns | arm |
|---|---|---|
| unset | 1 | **fp32 (default, unchanged)** |
| `""` | 1 | fp32 (default) |
| `fp16` | 0 | fp16 |
| `fp32` | 1 | fp32 |
| `bogus` | rc=1 | `unrecognized KALSA_Q8A_SCALE='bogus' (use fp32|fp16)`, `exit(1)` |

`git diff` of the commit contains zero hunks inside `kalsa_q8a_scale_f32()`, and the only
`KALSA_Q8A_SCALE` lines in the whole diff are the pre-existing WARN block re-anchored
around the new sibling WARN (its two lines unchanged).

## 4. The default arm reproduces the committed configuration - machine proof

Three independent machine checks, strongest first. "Default arm" = `KALSA_Q8A_SUBSCALE`
unset, i.e. what the phone ships.

**4.1 LLVM IR identity (stronger than the `clang -E` form the `da` control used).**
Every touched `.cl` compiled to LLVM IR at `-O2` for `spirv64`, new tree with the define
OFF vs the blob committed at `1577495b9` (file names normalised, same command both
sides). For the quantiser the IR diff is **exactly one line**, and it is OpenCL
kernel-argument *name* metadata, not code:

```
507c507
< !6 = !{!"float*", !"char*", !"q8a_t*", !"half*",     !"int"}
---
> !6 = !{!"float*", !"char*", !"q8a_t*", !"q8s_t*",    !"int"}
```

Every instruction, type, and all other metadata is byte-identical (the whole-file `diff`
reports that single line and nothing else; rc=1 = only that difference). The same
property is exactly what the `da` fix already carries: its own IR delta at that node was
`!"half*"` -> `!"q8a_t*"`. A typedef name in one metadata string is the entire delta of
the default arm; the compiled kernel is the same kernel.

**4.2 Preprocess identity (the `da` control's own form).** `clang -E -P` (NDK r29 clang
21, `-x cl -cl-std=CL3.0 -finclude-default-header -target spirv64`), new tree define OFF
vs committed blob, all 5 files: the diff is only the added `typedef half q8s_t;` line and
the alias spelling `half` -> `q8s_t` at the substituted tokens (`sa` parameter, store,
`src1_sa`, `sh_s`, load fallback) - counts (total differing lines / lines that are not
that form): quantiser 5/0, q4_0 7/0, q4_k 13/0, q5_0 13/0, q5_k 7/0 - machine-classified
line by line, 0 lines outside the form in all 5 files. Sample (quantiser):

```
94a95
> typedef half q8s_t;
99c100
<         __global half * sa,
---
>         __global q8s_t * sa,
124c125
<     sa[blk] = (half)(d * (float)sum);
---
>     sa[blk] = (q8s_t)(d * (float)sum);
```

`q8s_t` preprocesses to `half` with the define OFF, so the fp16 arm compiles the stock
types and the stock arithmetic.

**4.3 Host side.** With the selector returning 0 (proven for unset/empty/`fp16` in
section 3), every added host statement is skipped or takes its false edge: no extra
program is built (same builds, same `compile_opts`, hence the same program-cache keys as
the committed build), all 4 sites pick the base writer (`kernel_quant_a_q8_1`), the base
consumers, and `prealloc_moe_sa` stays `n_blocks * sizeof(cl_half)`. The only executed
default-arm delta in the binary is one extra `WARN` stderr line at load
(`q8_1 activation subscale: fp16 (KALSA_Q8A_SUBSCALE)`) - it prints, it computes nothing.

**4.4 Treatment arm sanity (define ON vs committed blob):** the IR shows the intended
change and nothing else - `fptrunc float -> half; store half, align 2` becomes
`store float, align 4` at the `sa` store, plus the arg-type name metadata.

## 5. Syntax gate (NDK clang `-fsyntax-only`, spirv64, both arms)

Same gate as `../opencl-q8-activation-scale/REPORT.md` §4 (the `.cl` files are embedded
as strings and only compiled on the device, so a host build cannot catch a kernel syntax
error - this gate is the one that can):

| file | committed blob | new, define OFF | new, `-DKALSA_Q8A_SUBSCALE_F32` |
|---|---|---|---|
| `quant_a_q8_1.cl` | 0 | 0 | 0 |
| `gemm_noshuffle_q4_0_q8_1_dp4a.cl` | 0 | 0 | 0 |
| `gemm_noshuffle_q4_k_q8_1_dp4a.cl` | 0 | 0 | 0 |
| `gemm_noshuffle_q5_0_q8_1_dp4a.cl` | 0 | 0 | 0 |
| `gemm_noshuffle_q5_k_q8_1_dp4a.cl` | 0 | 0 | 0 |

15/15 rc=0 (log `/tmp/q8a-subscale/syntax-gate.txt`).

## 6. Load management (owner instruction, mid-session)

Cap and serialization adopted for every heavy phase in this session:
- `ninja -j 3` for both builds (never the default `-j<cores>`), configure steps left to
  their own single-threaded work.
- Before each heavy phase: `pgrep -fl gradle` + `pgrep -f ninja` checked; if either is
  running, wait until clear (one heavy build at a time on this machine tonight).
- Context at adoption time: load average **110.19 / 76.02 / 41.92**, 23 gradle-related
  processes, NDK `clang++`/`ld.lld` from the APK build topping `ps`, and another cell's
  serialization script already waiting on `pgrep -f ninja`.

## 7. Native build (standing config) + the seven standing targets

Gate first: waited 22:48:09 -> 22:50:10 (~2 min) for the APK's NDK build to finish
(ninja and `ld.lld` processes present, load falling 30 -> 17), then ran mine at **`-j 3`**.

- Configure (standing config: Release, `GGML_METAL=OFF`, `GGML_OPENCL=OFF`, Ninja, BLAS ON,
  in-tree `build/`, re-run AFTER the commit): **rc=0**
  (`/tmp/q8a-subscale/native-configure.log`), summary stamps **`-- ggml commit: f0811bd31`**.
- `ninja -C build -j 3`: **rc=0, 141/141 steps**
  (`/tmp/q8a-subscale/native-build.log`). One grep hit on `error`: line 136
  `-- UI: download dist.tar.gz.sha256 from b11202 failed: "HTTP response code said error"`
  - the known configure-time UI-asset message, not a compile error.
- Fixture: symlink intact -> shared checkout, 19,077,344 bytes, sha256
  `66967fbece6dbe97886593fdbb73589584927e29119ec31f08090732d1861739` (same bytes as the
  predecessor's session), so the standing invocation
  `-m build/tinyllamas/stories15M-q4_0.gguf` ran verbatim. Runs from the worktree root,
  real `$?`, logs `/tmp/q8a-subscale/targets/`:

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
`../phone-engine-v2/REPORT.md`, `../phone-line-prep/REPORT.md`, `../release-prep/REPORT.md`.
`grep -c FAIL` = 0 in all seven logs. The 77s print their registered skip reasons
(`governor-devices: SKIP no GPU backend available (exit 77)` - METAL=OFF/OPENCL=OFF build;
`governor-hybrid: SKIP KALSA_HYBRID_GGUF is unset (exit 77)`). Pass markers present
(`governor_commit_reject_mismatched_type=PASS`, `governor_v0_turns=PASS turns=3
generated=18 ...`, `governor_chunked_prefill=PASS`, ...).

## 8. Android arm64 build (llama-perplexity) - configured AFTER the commit

Gate: waited until 22:51:15 for the other build (load 10.9), configure single-threaded,
then **`ninja -j 3`**, target `llama-perplexity` (the binary this task names).
Recipe = `../phone-engine-v2/REPORT.md` §5 line by line (`BUILD_SHARED_LIBS=OFF` or the
link dies on `AHardwareBuffer_*`; the two explicit OpenCL paths the NDK re-roots), own
build dir `build-android-ocl-q8a-subscale`.

- **Configure rc=0** (`/tmp/q8a-subscale/android-configure.log`). Summary: `-- Including
  CPU backend`, `-- Including OpenCL backend`, **`-- ggml commit:  f0811bd31`** (after the
  commit). Cache verified: `BUILD_SHARED_LIBS:BOOL=OFF`, `GGML_OPENCL:BOOL=ON`,
  `GGML_OPENCL_EMBED_KERNELS:BOOL=ON`, `OpenCL_INCLUDE_DIR:PATH=.../android-prefix/include`,
  `OpenCL_LIBRARY:FILEPATH=.../android-prefix/lib/libOpenCL.so`.
- **ninja rc=0, 329/329 steps** (`/tmp/q8a-subscale/android-build.log`), **0 lines matching
  `error`**. Linking lines: `[328/329] Linking CXX static library
  tools/perplexity/libllama-perplexity-impl.a`, `[329/329] Linking CXX executable
  bin/llama-perplexity`.
- **Embedded commit string / build number** (generated
  `build-android-ocl-q8a-subscale/common/build-info.cpp`, re-checked against git):

```
int LLAMA_BUILD_NUMBER = 11202;        (== git rev-list --count HEAD)
char const * LLAMA_COMMIT = "f0811bd31";
char const * LLAMA_COMPILER = "Clang 21.0.0";
char const * LLAMA_BUILD_TARGET = "Android aarch64";
-> runtime: version: <llama_version()> (build 11202, commit f0811bd31)
```

  `strings` exact-match counts inside the ELF: `f0811bd31` = **1**,
  `1577495b9` = 0, `d75422944` = 0, `833cde99b` = 0. The selector is in the binary:
  `ggml_opencl: unrecognized KALSA_Q8A_SUBSCALE='%s' (use fp16|fp32)` present.
- **sha256 of the binary (for the phone's attribution arm):**

```
b01db9001b43dabb9f0f6cb1119b1cbf9c4695b71fd0ba1dfb6283d3eb6ec68a  build-android-ocl-q8a-subscale/bin/llama-perplexity
```

  size 119,915,312 bytes; `file`: `ELF 64-bit LSB pie executable, ARM aarch64 ...
interpreter /system/bin/linker64`, BuildID `a95f379fce0a6922392c6106742424cae1d3e730`
(not runnable on this Mac - all evidence read from the artifacts).
- Which arm ran is recorded in stderr at load, two lines:
  `ggml_opencl: q8_1 activation scale: fp16|fp32 (KALSA_Q8A_SCALE)` and
  `ggml_opencl: q8_1 activation subscale: fp16|fp32 (KALSA_Q8A_SUBSCALE)` - WARN, so it
  survives the bench stderr filter.

Suggested arms on the phone (same binary, Z2's env plus the new selector):

```sh
# control: forced q4_K dp4a, sa stays fp16 = exactly Z2's configuration
GGML_OPENCL_Q4K_DENSE_DP4A=1 ./llama-perplexity ...
# treatment: the sa-fp32 twin (the pre-registered missing row of section 27)
GGML_OPENCL_Q4K_DENSE_DP4A=1 KALSA_Q8A_SUBSCALE=fp32 ./llama-perplexity ...
```

Baseline to compare against: `../s23-kld-740-q4-0/REPORT.md` §27.1 (Z2 = KLD 5.103422 /
PPL 2556.19 / same-top 12.373 %) with its pre-registered thresholds (support >= ~0.0085,
falsifier < 0.007412, zone 0.007412..0.0085 inconclusive), and §23 for the ship-default
number (0.005412).

## 9. Boundaries: tip sha, refs, and the push command - UNRUN

Tip: **`f0811bd315eee844bfac10206b50480668d231a7`** (detached HEAD of
`/Users/marco/Projects/kalsallama-wt-phone-engine-v2`, one commit above the shipped tip):

```
f0811bd315  this: KALSA_Q8A_SUBSCALE ... f32   <- tip (new)
1577495b92  ship tip (unchanged, still the remote phone ref)
e1cfb60f71  KALSA_Q8A_SCALE ... f32 (the da pick)
```

- `git merge-base --is-ancestor 1577495b92096... HEAD` -> **rc=0**, so the push below is a
  fast-forward - no force, no lease.
- Worktree clean after everything: `git status --porcelain` = **0 lines**.
- `git rev-parse --abbrev-ref HEAD` = `HEAD`, `git rev-parse @{upstream}` =
  `fatal: HEAD does not point to a branch` - no branch, no upstream.
- Shared checkout untouched: `git status --porcelain=v1` before vs after the session,
  **diff rc=0, 12 lines both**.
- Read-only `git ls-remote origin` this session: `refs/heads/kalsa-phone-v1-1-1` =
  `1577495b92096fca572f57a35b71607bacac85d5` (the OLD tip - nothing moved),
  `refs/heads/kalsa-release-v1-1-1` = `a7d2cec79...`,
  `refs/tags/kalsa-server-v1.1.1` = `0f1b3bec7342ddd5624dc474c760a0b38bc80b5b`.
- Local refs also unmoved: `refs/heads/kalsa-phone-v1-1-1` = `d754229443`,
  `refs/heads/kalsa-release-v1-1-1` = `a7d2cec79`, tag object `0f1b3bec7` (type `tag`,
  commit `a7d2cec79`). **Not tagged, not pushed, no `git fetch`.**

**NONE of the block below was executed:**

```sh
# push the new line onto the phone branch (fast-forward 1577495b9 -> f0811bd31)
cd /Users/marco/Projects/kalsallama-wt-phone-engine-v2
git push origin f0811bd315eee844bfac10206b50480668d231a7:refs/heads/kalsa-phone-v1-1-1
```

```sh
# verify after running (expect the phone ref moved, release refs + tag unchanged)
git ls-remote origin refs/heads/kalsa-phone-v1-1-1 refs/heads/kalsa-release-v1-1-1 refs/tags/kalsa-server-v1.1.1
# expect:
# f0811bd315eee844bfac10206b50480668d231a7  refs/heads/kalsa-phone-v1-1-1
# a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1  refs/heads/kalsa-release-v1-1-1
# 0f1b3bec7342ddd5624dc474c760a0b38bc80b5b  refs/tags/kalsa-server-v1.1.1
```

Ref naming (`kalsa-phone-v1-1-1` vs a new ref) is the owner's call; the sha-based refspec
touches no local branch either way (the local `kalsa-phone-v1-1-1` in
`kalsallama-wt-phone-line` stays at `d75422944`).

## 10. What this build settles, and what it does not

Settles:
1. The pre-registered obstacle of §27 (`../s23-kld-740-q4-0/REPORT.md`) - "no env exists,
   consumer hardwired `half*`" - is removed: the sa-fp32 twin now exists in one binary,
   one env flip, both arms logged at load.
2. The shipped configuration does not move: default arm = fp16 = the committed behaviour,
   proven at LLVM-IR level (section 4.1) and by the selector truth table (section 3),
   with the seven standing targets reproducing `0 0 77 77 0 0 0`.

Does NOT settle (owner's to decide, stated not hidden):
1. **The `da` leg on the q4_K path is still fp16** (section 1.4 finding): `KALSA_Q8A_SCALE`
   acts only at the q6_K site, so the treatment arm above removes the `sa` FTZ leg alone.
   If the treatment does not recover Z2's output, the standing suspects are: `da` FTZ on
   this path (same family, not gated here), the 32-vs-256 activation grid
   (`../opencl-q8-activation-scale/REPORT.md` §3.1), and the scheme mismatch itself.
   If it does recover, `sa` FTZ is named as the destroyer and `da` FTZ is shown not to
   trigger on this path. Wiring `KALSA_Q8A_SCALE` into the q4_K site is a ~3-line change
   of the same shape (flagged here, NOT done - out of this task's scope).
2. No on-device number was taken by this cell (no `adb`, no device contact). The control
   arm (this binary, no new env) is also the phone-side check that the default arm
   reproduces the committed numbers (§23/§27 baseline).
3. MoE `sa` (the `moe_reorder_quant_a_q8_1` writer + 3 MoE GEMMs) stays fp16 always -
   unreachable with the shipped dense model, and out of the task's scope; if the MoE path
   is ever benched, it needs its own promotion plus the precompiled `_ila` binary problem
   of `../opencl-q8-activation-scale/REPORT.md` §3.4.
