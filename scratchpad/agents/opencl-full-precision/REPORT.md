# REPORT - opencl-full-precision: candidate 2 + candidate 3 in one binary

INSURANCE build, not an attribution instrument. One Android `llama-perplexity` with both
independently measurable candidates active by default: the f32 activation operand for the
q4_K/q6_K batch GEMM (`KALSA_GEMM_B`, default `float`) and the accurate dense q6_K path
(`KALSA_Q6K_DENSE`, default `f32`). Coder session in a detached worktree. No push, no tag,
no upstream. The shared `/Users/marco/Projects/kalsallama` was read only (its dirty state is
untouched). No phone was touched: nothing was pushed to a device, no phone directory was
cleaned, no measurement was run.

## 0. Answer sheet

1. Linear line produced: yes, by cherry-pick. ONE conflict, one hunk, resolved in favour of
   keeping both behaviours - verbatim in section 2. No rewrite of either change.
2. Both selectors work as documented in their own cells; all four combinations exist in one
   binary - table in section 3.
3. Syntax gate: 6/6 `-fsyntax-only` rc=0 (both arms, three files); float arm
   `read_imagef` = 8 in each main GEMM kernel; noflag arm preprocessed code identical to
   `914b34a7e` - section 4.
4. Build: configure rc=0 (`ggml commit:  a8eb58010`), ninja rc=0,
   `[329/329] Linking CXX executable bin/llama-perplexity`, 0 error lines - section 5 with
   size/sha256/commit/NEEDED.
5. Nothing run on a phone. No phone directory cleaned.
6. If this binary passes the gate it does NOT say which leg mattered; the per-candidate arms
   (`kalsa-opencl-f32-transpose`, `kalsa-opencl-q6k-accurate-path`) do that - section 7.

## 1. Stack

```
1068eb03d -> 914b34a7e -> c58d5f0ee -> a8eb58010
                             ^            ^
                     cherry-pick of   cherry-pick of
                     40a9358a1        14a3afebf (conflict resolved, sec. 2)

ref:    kalsa-opencl-full-precision   (refs/heads, matches the sibling cells' ref style)
head:   a8eb580102386fb0079254cc19b5a9b10a331575
parent: c58d5f0ee (cherry-pick of 40a9358a1, parent 914b34a7e)
base:   914b34a7ea0b4fb6a86c30c491f723d08cebc8c6   (both candidates' original parent)
pushed: NO. No tag (a temporary tag was created then deleted in favour of a branch, local
        only), no upstream.
```

Both candidates are siblings off `914b34a7e` (`git merge-base 40a9358a1 14a3afebf` =
`914b34a7e`). Order: candidate 2 first (clean apply, rc=0), then candidate 3 (conflicted).

Union check: `git diff 914b34a7e..HEAD --stat` = 151 insertions / 46 deletions across 4
files = exactly the sum of the two individual diffs (127+24 ins, 45+1 del). Nothing added,
nothing dropped.

Trees:

- Work: `/Users/marco/Projects/kalsallama-wt-fullprecision`, detached worktree created this
  session at `914b34a7e`, clean after the two cherry-picks.
- Build dir: `build-android-ocl-fullprec` inside that worktree (configured after the final
  commit, so the stamp matches the ref).
- Report: this file.

## 2. The conflict, verbatim

`git cherry-pick 14a3afebf` after the candidate-2 cherry-pick produced exactly ONE conflict,
in `ggml/src/ggml-opencl/ggml-opencl.cpp`, at the helper-insertion point right after
`use_adreno_bin_kernels` (both commits insert their selector helper at the same location).
The raw hunk, byte-for-byte as git wrote it:

```
<<<<<<< HEAD
// KALSA_GEMM_B=float|half: activation operand of the q4_K/q6_K batch GEMM, default float.
// float keeps activations f32 through kernel_transpose_32_32; half keeps the stock f16 narrowing.
inline bool kalsa_gemm_b_float() {
    static const bool value = [] {
        const char * e = getenv("KALSA_GEMM_B");
        if (e && strcmp(e, "half") == 0) {
            return false;
        }
        if (e && *e && strcmp(e, "float") != 0) {
            GGML_LOG_ERROR("ggml_opencl: unrecognized KALSA_GEMM_B='%s' (use half|float)\n", e);
=======
// KALSA_Q6K_DENSE=f32|dp4a: dense q6_K prefill GEMM path, default f32.
// f32 = transpose + noshuffle f32 GEMM (no activation quantization);
// dp4a = stock int8 path (kernel_quant_a_q8_1 + q8_1 dp4a GEMM), for A/B.
inline bool kalsa_q6k_dense_f32() {
    static const bool value = [] {
        const char * e = getenv("KALSA_Q6K_DENSE");
        if (e && strcmp(e, "dp4a") == 0) {
            return false;
        }
        if (e && *e && strcmp(e, "f32") != 0) {
            GGML_LOG_ERROR("ggml_opencl: unrecognized KALSA_Q6K_DENSE='%s' (use f32|dp4a)\n", e);
>>>>>>> 14a3afebf (opencl: KALSA_Q6K_DENSE routes dense q6_K prefill to the f32 GEMM by default)
            exit(1);
        }
        return true;
    }();
    return value;
}
```

Resolution: the conflict is the shared tail - both helpers end with the identical
`exit(1); return true; }(); return value; }` block, so one copy of the tail had to be given
to each helper. The resolved region is both original helpers, each complete and unchanged,
in sequence (`kalsa_gemm_b_float` first, then `kalsa_q6k_dense_f32`). No line of either
commit was altered, deleted, or reworded. The other three candidate-3 hunks (the
`KALSA_Q6K_DENSE` log line after the q6_K program create, the dispatch gate at the
`GGML_OPENCL_Q6K_DENSE_DP4A` ternary, and its comment) auto-merged cleanly next to
candidate 2's `q6k_compile_opts` block and q6_K transpose-block changes - all verified in
place after the merge (log line at 5598, gate at 23132-23139, `use_f32_trans` q6K at 23205,
`use_f32_trans` q4K at 22713, both helpers at 1546/1563).

Raw conflict diff saved at `/tmp/fullprec/conflict-1.patch`.

## 3. The four combinations (one binary)

Selector semantics are byte-identical to each candidate's own cell
(`kalsa-opencl-f32-transpose/REPORT.md` section 2.2, `kalsa-opencl-q6k-accurate-path/REPORT.md`
section 2): both default to the accurate option, both `exit(1)` on an unrecognized value, and
the stock override `GGML_OPENCL_Q6K_DENSE_DP4A` keeps its meaning. On the Adreno 740
(A7X, integer dot true, other envs unset):

| # | env | q4_K/q6_K batch operand (KALSA_GEMM_B) | dense q6_K prefill path (KALSA_Q6K_DENSE) |
|---|---|---|---|
| 1 | both unset | float (f32 transpose + `read_imagef`) | f32 (transpose + `kernel_gemm_noshuffle_q6_K_f32`) |
| 2 | `KALSA_GEMM_B=half` | half (stock f16, `read_imageh`) | f32 (unchanged) |
| 3 | `KALSA_Q6K_DENSE=dp4a` | float (unchanged) | dp4a (stock int8: `kernel_quant_a_q8_1` + `kernel_gemm_noshuffle_q6_k_q8_1_dp4a`) |
| 4 | `KALSA_GEMM_B=half KALSA_Q6K_DENSE=dp4a` | half | dp4a - both legs stock, reproduces `914b34a7e` stock behaviour |

Combination 1 is the full-precision prefill configuration (the shipped default). Each leg
keeps its own control in the same binary, so a later run can separate them: arm 2 isolates
the operand, arm 3 isolates the routing, arm 4 is the matched stock control. Evidence that
the stock arms are the stock arms:

- noflag (`KALSA_GEMM_B=half`) preprocess of both GEMM files is IDENTICAL (non-blank, no
  linemarkers) to `914b34a7e` - section 4. The float flag is added to compile_opts, hence to
  the program-cache key, so the arms get distinct `.clbin` entries.
- `KALSA_Q6K_DENSE=dp4a` reduces the dispatch ternary to
  `backend_ctx->adreno_gen != ADRENO_GPU_GEN::X1E` - literally the stock default - then the
  stock `has_integer_dot` AND. No kernel source changes on that leg, so both dp4a kernels
  are built in either arm.
- Both runtime arm lines are embedded in the binary (`strings` grep): stderr will print
  `ggml_opencl: q4_K/q6_K batch GEMM activation operand: %s (KALSA_GEMM_B)` and
  `ggml_opencl: dense q6_K prefill GEMM path: %s (KALSA_Q6K_DENSE)`, so a phone log shows
  which combination ran.

## 4. Syntax + preprocess sanity (no phone round-trip needed)

Command, identical to the sibling cells' pre-registered gate, from the worktree root:

```
/opt/homebrew/share/android-ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang \
    -x cl -cl-std=CL1.2 -Xclang -finclude-default-header -target spirv64 \
    -fsyntax-only ggml/src/ggml-opencl/kernels/<file>
```

| file | noflag rc | `-DKALSA_GEMM_B_FLOAT=1` rc |
|---|---|---|
| transpose.cl | 0 | 0 |
| gemm_noshuffle_q4_k_f32.cl | 0 | 0 |
| gemm_noshuffle_q6_k_f32.cl | 0 | 0 |

Only diagnostic anywhere: the pre-existing `cl_qcom_reqd_sub_group_size unknown ... pragma -
ignoring` in the stock q6_K file (4 lines of one warning, present before both changes).

Float arm (`clang -E`, linemarkers and blank lines stripped):

| file | `read_imagef` (main kernel) | `read_imageh` (siblings) | `float8 B` / `half8 B` |
|---|---|---|---|
| gemm_noshuffle_q4_k_f32.cl | 8 | 24 | 1 / 3 |
| gemm_noshuffle_q6_k_f32.cl | 8 | 8 | 1 / 1 |

Exactly the sibling cells' split: the 8 f32 reads are the main batch kernel; the untouched
`_r1`/`_kimg`/`_cok` siblings keep the half reads.

Stock identity: noflag arm preprocess of both GEMM files is IDENTICAL to `914b34a7e`
(`diff -q` of the two `-E` outputs, rc=0 for both). `transpose.cl` in this tree is
byte-identical to candidate 2's file and to the probe kit's blob: sha256
`a04cf9af62e6755dd9de2cee188d33089208eb68a10ca856332eb1cbe2128b01` for all three
(`40a9358a1:transpose.cl`, worktree file, `5d188a9e4:transpose.cl`).

## 5. Android build (recipe verbatim from `s23-native-gpu-bench/REPORT.md:49-62`)

Configured AFTER the final commit so the build stamp matches the ref. Ninja, NDK toolchain,
android-28, arm64-v8a, Release, `BUILD_SHARED_LIBS=OFF` (required or the link fails on
AHardwareBuffer), `OpenCL_INCLUDE_DIR`/`OpenCL_LIBRARY` explicit because the NDK re-roots
`CMAKE_PREFIX_PATH`, GGML_OPENCL=ON, embed kernels ON, Adreno kernels ON, bin kernels OFF,
OpenMP ON, llamafile ON, examples/tools/tests/server ON, OpenSSL ON. Log:
`/tmp/fullprec/configure.log`.

- Configure: **rc=0**, `-- ggml commit:  a8eb58010` (matches the ref), Configuring done
  (2.6s), Generating done (0.3s).
- `ninja llama-perplexity`: **rc=0**, `[329/329] Linking CXX executable
  bin/llama-perplexity`, zero lines matching `error`. Log: `/tmp/fullprec/build.log`.
- Target `llama-perplexity` only (as asked); `llama-cli` was not built in this cell.

Artefact:

```
path:    /Users/marco/Projects/kalsallama-wt-fullprecision/build-android-ocl-fullprec/bin/llama-perplexity
size:    119871360 bytes
sha256:  d5d070bb94037a7552659ed790ac6619e96df10f448cddb2829ea4b2df052540
```

Self-reported commit line (generated `common/build-info.cpp`):
`LLAMA_BUILD_NUMBER = 11197`, `LLAMA_COMMIT = "a8eb58010"`, `LLAMA_COMPILER = "Clang 21.0.0"`,
`LLAMA_BUILD_TARGET = "Android aarch64"` - the runtime line prints
`version: ... (build 11197, commit a8eb58010)`, naming this ref's sha.

`llvm-readelf -d` NEEDED:

```
libomp.so
libm.so
libdl.so
libOpenCL.so
libc.so
```

Same set as both sibling binaries - ship `libomp.so` alongside (as in `s23-kld-740-q4km`),
and `libOpenCL.so` from the android-prefix if the device lacks a loader stub.

Arms on the phone (for whoever schedules the run): run as-is for combination 1
(full precision); `KALSA_GEMM_B=half` for 2; `KALSA_Q6K_DENSE=dp4a` for 3; both for 4.
Check stderr for the two `ggml_opencl:` arm lines.

## 6. What was not done

No push, no tag kept, no PR, no phone command, no phone directory touched, no measurement
claimed. Governor and upload path untouched. Files changed vs `914b34a7e`: the four files of
candidate 2 plus `ggml-opencl.cpp` via candidate 3 - the union, nothing else. The shared
checkout `/Users/marco/Projects/kalsallama` was not modified (only `git worktree add`,
`git show`, `git log`, one local branch create, one local tag create+delete against its
object store).

## 7. Honesty statement: this is not an attribution instrument

This binary is INSURANCE. It combines both fixes, so if the gate passes we learn only that
"the full-precision configuration" - f32 activation operand on the q4_K/q6_K batch GEMM AND
the accurate dense q6_K path together - moved the metric. It does NOT by itself say which
leg mattered: the operand leg (candidate 2) and the routing leg (candidate 3) are both on by
default and their effects are entangled in any single default-arm run. The per-candidate arms
(`kalsa-opencl-f32-transpose` @ `40a9358a1`, `kalsa-opencl-q6k-accurate-path` @
`14a3afebf`, plus candidate 1 `kalsa-opencl-q6k-f32-product` @ `914b34a7e`) are the
attribution instruments. This binary's in-binary controls (section 3) allow separating the
two legs only if someone runs combinations 2 and 3 as separate legs - a default run alone
never does. Also: a built binary is not a measurement; no on-device number is claimed here.

## 8. Numbers index (all on disk this session)

| item | value | where |
|---|---|---|
| conflict hunks touched | 1 (verbatim, sec. 2) | `/tmp/fullprec/conflict-1.patch` |
| syntax gate | 6/6 rc=0 | `/tmp/fullprec/syntax/*.err` |
| float-arm read_imagef, main kernels | 8 + 8 | sec. 4 |
| noflag vs `914b34a7e` preprocess | identical, both files | sec. 4 |
| configure rc | 0, `ggml commit:  a8eb58010` | `/tmp/fullprec/configure.log` |
| ninja rc | 0, `[329/329] Linking ... llama-perplexity`, 0 errors | `/tmp/fullprec/build.log` |
| binary size | 119871360 bytes | sec. 5 |
| binary sha256 | `d5d070bb94037a7552659ed790ac6619e96df10f448cddb2829ea4b2df052540` | sec. 5 |
| commit line | `build 11197, commit a8eb58010` | `build-android-ocl-fullprec/common/build-info.cpp` |
| NEEDED | libomp, libm, libdl, libOpenCL, libc | sec. 5 |
