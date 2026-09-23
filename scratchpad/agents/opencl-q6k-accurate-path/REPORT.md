# REPORT - opencl-q6k-accurate-path: route dense q6_K prefill to the f32 GEMM by default

Candidate 3, ready to measure alongside `914b34a7e` and `40a9358a1`. Coder session in a
detached worktree. No push, no tag, no upstream. Governor and upload path not touched.
No on-device number is claimed here: a built binary is not a measurement.

## 0. Checklist answers (owner's 5 items)

1. Which kernel computes the Q6_K tensors on the Adreno 740 at batch 256: **the dp4a one**,
   section 1, with the full predicate walk and file:line at `914b34a7e`. Its precision loss
   (int8 activation quantization in `kernel_quant_a_q8_1`) is **inherent to the path, not a
   bug** of the half-product family - verdict and reasoning in section 1.2.
2. Fix type: **the second option** - stop routing Q6_K to dp4a by default, behind the
   `KALSA_Q6K_DENSE` selector, accurate path default, section 2. Not a kernel patch: there
   is no defect of the family to patch.
3. Stack: `1068eb03d` -> `914b34a7e` -> `14a3afebf`, ref `kalsa-opencl-q6k-accurate-path`,
   verified with `git log` (section 3). NOT pushed.
4. Build: configure rc=0 (`ggml commit: 14a3afebf`), final `ninja llama-perplexity` rc=0
   (329/329, zero error lines, log `/tmp/q6kpath/build.log`); binary
   `build-android-ocl-q6kpath/bin/llama-perplexity`, 119749040 bytes, sha256
   `eded46b090e8dd7406bf86021e4086e1cd51086585252428cfd7d86cf670b5a5`, self-reports
   `version: ... (build 11196, commit 14a3afebf)`, NEEDED =
   `libomp.so, libm.so, libdl.so, libOpenCL.so, libc.so` (section 4).
5. Speed expectation with precedent: section 5. Cost is on the q6_K tensors only
   (19 of 266), batch prefill only. Not wider.

Trees:

- Work: `/Users/marco/Projects/kalsallama-wt-q6kpath`, detached, created this session at
  `914b34a7e`. The shared `/Users/marco/Projects/kalsallama` was not checked out or modified
  (only `git worktree add`, `git show`, `git log` against its object store).
- Build dir: `build-android-ocl-q6kpath` inside that worktree.
- Report: this file.

## 1. Settled from source: the dp4a kernel computes the Q6_K tensors

All line numbers are at `914b34a7e` (the file is byte-identical between `1068eb03d` and
`914b34a7e` - that commit only touched one `.cl` file).

### 1.1 The predicate walk, in order

Device mapping first: `get_adreno_gpu_gen` (`ggml-opencl.cpp:285`) matches
`strstr(device_name, "740")` (`:300`) and returns `ADRENO_GPU_GEN::A7X` (`:302`); the
device reports `QUALCOMM Adreno(TM) 740` (`s23-kld-740-q4km/raw/opencl-banner.log:4`), so
`adreno_gen = A7X` (`:6848-6850`). `has_integer_dot` is set from the
`cl_khr_integer_dot_product` extension string (`:7005-7007`) and the same device's banner
says `khr dot product support: true` (`opencl-banner.log:12`). Both gates below therefore
pass on this phone.

Entry and order inside `ggml_cl_mul_mat_q6_K_f32_adreno` (`:22880`), for ne1 = 256:

1. Outer route `:24229`: `src0t == Q6_K && src1t == F32 && !use_flat_gemv_for_large_m_q6_K`
   -> enters the Adreno q6_K function. The flat-GEMV escape is opt-in
   (`GGML_OPENCL_FLAT_LARGE_M`, `:9399`, unset; function at `:9427`) - false.
2. `:22928` `if (ne1 == 1 || use_q6k_mc3 || use_q6k_tiled_mc)` -> GEMV-family, returns
   there. False at batch 256: ne1 = 256; both mc3 terms need `ne1 == 3` plus the opt-in
   `GGML_OPENCL_Q6K_MC3` (`:22918`, unset).
3. `:23028` `if (use_q6k_tiled(...))` -> tiled batched GEMM, returns. False:
   `use_q6k_tiled` (`:9323`) needs `q6k_gemv_tiled_enabled` (`:9313`), which defaults to
   `tiled_gemv_default_on` = X2E or A8X only (`:9300-9303`), env unset - false on A7X; it
   also needs `ne01 >= 32768` (vocab), and the tied vocab Q6_K is CPU anyway.
4. `:23090` `if (q6k_dense_dp4a_on && !is_output_w_dp4a && ne1 > 8 && ne00 % 32 == 0 &&
   ne01 % 64 == 0)` -> **TRUE for all 19 Q6_K tensors at batch 256**:
   - `q6k_dense_dp4a_on`: env `GGML_OPENCL_Q6K_DENSE_DP4A` unset (`:23080`) -> default
     `adreno_gen != X1E` (`:23081-23083`) -> A7X passes; ANDed with `has_integer_dot`
     (`:23085`) -> true (banner log).
   - `!is_output_w_dp4a` (`:23087-23088`): the 19 are 14 ffn_down + 5 attn_v
     (`914b34a7e` commit message); output/token_embd never reach here (CPU).
   - `ne1 > 8`: 256 > 8.
   - `ne00 % 32 == 0`: structural - `GGML_ASSERT(ne00 % ggml_blck_size == 0)` (`:22907`)
     with Q6_K block 256, so ne00 is a multiple of 256 for every legal tensor.
   - `ne01 % 64 == 0`: holds for all 19 (sibling cell's per-tensor catalogue walk,
     `opencl-f32-transpose/REPORT.md` section 3).

   The branch runs `kernel_quant_a_q8_1` (`:23098-23106`) then
   `kernel_gemm_noshuffle_q6_k_q8_1_dp4a` (`:23108-23123`) and **returns at `:23126`**.
5. Unreachable at batch 256: the transpose block (`kernel = kernel_transpose_32_16`,
   `:23168`) and `kernel_gemm_noshuffle_q6_K_f32` (`:23191-23192`).

So: **the dp4a kernel returns first**; the noshuffle f32 GEMM - the kernel `914b34a7e`
fixes, and the kernel `40a9358a1` feeds - **never executes for the 19 Q6_K tensors at
batch 256 on this device.** Both existing candidates miss the q6_K contribution entirely,
which is a sufficient explanation for either measuring "no effect" on the q6_K leg.

dp4a declines (fall-through to the f32 GEMM) only if: `GGML_OPENCL_Q6K_DENSE_DP4A=0`,
shape mismatch (ne1 <= 8, ne00 not multiple of 32 - impossible here, ne01 not multiple of
64), name output/token_embd, `has_integer_dot` false (contradicted by the banner), or the
X1E generation (not this device).

The recon discrepancy is settled definitively: `gpu-numerics-fix-recon/REPORT.md:127-129`
claims the q6_K dp4a program "has no dispatch site anywhere" at `1068eb03d`. I grepped the
blob straight from the object store (`git show 1068eb03d:...ggml-opencl.cpp`): the dispatch
is at `:23108` (`cl_kernel dk = backend_ctx->kernel_gemm_noshuffle_q6_k_q8_1_dp4a;`), plus
the MoE twin at `:29044`. The symbol's `q6_k` is lowercase while the noshuffle GEMM's is
`q6_K`; a case-sensitive `q6_K_q8_1_dp4a` grep misses it - the same trap the sibling
independently hit. The recon's claim is wrong; the sibling's correction is right.

For contrast, the Q4_K dp4a path really is X2E-only: default `adreno_gen == X2E`
(`:22684-22688`), ANDed with `has_integer_dot` (`:22691`) - off on A7X, which is why the
148 Q4_K tensors take the transpose + noshuffle GEMM that the existing candidates fix.

### 1.2 What the dp4a kernel does numerically: inherent, not a bug

Two kernels, both under `ggml/src/ggml-opencl/kernels/`:

- `quant_a_q8_1.cl:7-36` `kernel_quant_a_q8_1`: per 32-element activation block, takes
  amax, `d = amax/127`, rounds `q = rint(v * 127/amax)` to int8, stores the int8 quants
  plus the block scale `d` and block sum as fp16. This is where activations become int8.
- `gemm_noshuffle_q6_k_q8_1_dp4a.cl:42` `kernel_gemm_noshuffle_q6_k_q8_1_dp4a`: repacks
  each q6_K weight byte to signed int8 (q6 - 32, via SIGN6/EXP4/EXP2, `:9-27`), computes
  exact int8 x int8 dot products in groups of 16 K (`dot_acc_sat_4x8packed_ss_int`,
  `:30-39` - magnitudes max ~16 x 127 x 32, far below int32 saturation), scales by
  dd (fp16 superblock) x sc (int8 per-16) x da (fp16 activation block scale), and
  accumulates into `float4 acc` in f32 (`:67`), writing f32 output.

Verdict:

- **There is no half product and no f16-operand defect in this path.** The products and
  the accumulation are f32; the integer dots are exact; the two-scales-per-32 grouping
  (raw1 = K..K+16 x scale0, raw2 = K+16..K+32 x scale1) matches the q6_K reference
  formula; the SIGN6 mapping and the noshuffle indices check out by hand.
- **The precision loss is the int8 activation quantization itself** (per-32 absmax
  rounding, plus fp16 storage of the block scale). That is inherent to the q8_1/dp4a
  design, not a defect of the family we have been patching (half product, f16 operand).
- It is also the same *kind* of quantization the CPU reference uses for Q6_K:
  `ggml-cpu.c:522-526` sets `vec_dot_type = GGML_TYPE_Q8_K` for Q6_K - the CPU quantizes
  activations to int8 too (per-256 superblock instead of per-32). Whether routing the
  GPU leg to unquantized f16-operand/f32-product arithmetic moves KLD therefore depends
  on which reference the bench compares against; that is a measurement question, not a
  source question.

Because the loss is inherent, the matching fix is routing, not a kernel patch - the owner's
second option.

## 2. The fix: `KALSA_Q6K_DENSE` selector, accurate path default

One file, `ggml/src/ggml-opencl/ggml-opencl.cpp`, 24 insertions / 1 deletion, same shape
as the sibling cell's `KALSA_GEMM_B` / `kalsa_gemm_b_float` selector:

- Helper `kalsa_q6k_dense_f32()` (inserted after `use_adreno_bin_kernels`, before
  `load_cl_kernels`): reads `KALSA_Q6K_DENSE`, returns true (f32) for unset or `f32`,
  false for `dp4a`, `GGML_LOG_ERROR` + `exit(1)` for anything else - an A/B must never
  run the wrong arm silently.
- Dispatch gate (`:23097-23104` after the edit): the stock ternary keeps
  `GGML_OPENCL_Q6K_DENSE_DP4A` first (its override meaning unchanged: `=1` forces dp4a,
  `=0` forces the f32 GEMM); when that env is unset, `KALSA_Q6K_DENSE` decides instead of
  the stock `adreno_gen != X1E` default, still ANDed with the generation check and
  `has_integer_dot`.
- One `GGML_LOG_INFO` after the q6_K noshuffle program create:
  `ggml_opencl: dense q6_K prefill GEMM path: f32|dp4a (KALSA_Q6K_DENSE)` - the phone run
  shows which arm is active.

Selector semantics on this device (A7X, dot true, envs otherwise unset):

| env | dense q6_K batch GEMM (ne1 > 8) | note |
|---|---|---|
| unset / `KALSA_Q6K_DENSE=f32` | `kernel_transpose_32_16` + `kernel_gemm_noshuffle_q6_K_f32` (the `914b34a7e` kernel) | **default = accurate path** |
| `KALSA_Q6K_DENSE=dp4a` | `kernel_quant_a_q8_1` + `kernel_gemm_noshuffle_q6_k_q8_1_dp4a` | arm B: predicate result identical to `914b34a7e` stock |
| `KALSA_Q6K_DENSE=<other>` | - | log error, `exit(1)` |
| `GGML_OPENCL_Q6K_DENSE_DP4A=0/1` | forced off / on (then `has_integer_dot`) | stock override, unchanged meaning |

What the switch is for: one binary serves both arms of the A/B, like the sibling's. The
default arm is the accurate path, so a default run measures "914b34a7e's kernel actually
executes for the 19 Q6_K tensors" for the first time; `KALSA_Q6K_DENSE=dp4a` reproduces
the stock arm bit-for-bit at the predicate level, so the speed and KLD difference between
the runs is attributable to the routing alone. The compile-opts/program-cache keying does
not apply here (no kernel source changes), but both kernels are built in either arm.

Scope of the behavior change: exactly the tensors that took the dp4a branch - dense Q6_K
with ne1 > 8 (batch prefill). Decode (ne1 == 1), verify chunks (ne1 <= 8 fell through to
the noshuffle GEMM before this change too, since dp4a requires ne1 > 8), the mc3 and tiled
opt-ins, Q4_K, all other quants, the MoE dp4a (`:29044`, model is dense, n_expert = 0),
and both dp4a kernel sources are untouched.

## 3. Stack and refs (item 3)

```
stack:  1068eb03d -> 914b34a7e -> 14a3afebf        (verified with git log --oneline -3)
ref:    kalsa-opencl-q6k-accurate-path @ 14a3afebf836c17d99646b9f4c2d4d962c6ed44f
parent: 914b34a7ea0b4fb6a86c30c491f723d08cebc8c6
pushed: NO. No tag, no upstream.
```

The three candidates are siblings off `914b34a7e` and independently measurable:

- `kalsa-opencl-q6k-f32-product` @ `914b34a7e` (candidate 1, q6_K f32 product)
- `kalsa-opencl-f32-transpose` @ `40a9358a1` (candidate 2, parent `914b34a7e`)
- `kalsa-opencl-q6k-accurate-path` @ `14a3afebf` (this, parent `914b34a7e`)

## 4. Build (item 4, numbers on disk)

Recipe: the phone bench's, verbatim from `s23-native-gpu-bench/REPORT.md:49-62` - Ninja,
NDK toolchain, android-28, arm64-v8a, Release, `BUILD_SHARED_LIBS=OFF` (required or the
link fails on AHardwareBuffer), `OpenCL_INCLUDE_DIR`/`OpenCL_LIBRARY` explicit because the
NDK re-roots `CMAKE_PREFIX_PATH`, Adreno kernels ON, bin kernels OFF, embed kernels ON.

- Configure: **rc=0**, `-- ggml commit:  14a3afebf` (configured after the commit so the
  stamp matches the ref), log `/tmp/q6kpath/configure.log`.
- `ninja llama-perplexity`: **rc=0**, `[329/329] Linking CXX executable bin/llama-perplexity`,
  zero lines matching `error`, log `/tmp/q6kpath/build.log`.
- No `.cl` file changed (`git show --stat` = 1 file), so the OpenCL syntax gate is not
  applicable; the host C++ compiled clean.
- Binary self-report (`build-android-ocl-q6kpath/common/build-info.cpp`):
  `LLAMA_BUILD_NUMBER = 11196`, `LLAMA_COMMIT = "14a3afebf"`, `LLAMA_COMPILER = "Clang 21.0.0"`,
  `LLAMA_BUILD_TARGET = "Android aarch64"`; the runtime line is
  `version: ... (build 11196, commit 14a3afebf)`.
- The Android `llama-perplexity` the phone needs:

```
path:    /Users/marco/Projects/kalsallama-wt-q6kpath/build-android-ocl-q6kpath/bin/llama-perplexity
size:    119749040 bytes
sha256:  eded46b090e8dd7406bf86021e4086e1cd51086585252428cfd7d86cf670b5a5
```

- `llvm-readelf -d` NEEDED: `libomp.so, libm.so, libdl.so, libOpenCL.so, libc.so` - the
  same set as the bench binaries; ship `libomp.so` alongside, as in `s23-kld-740-q4km`
  (and `libOpenCL.so` from the android-prefix if the device lacks a loader stub, same as
  previous sessions).

Arms on the phone: run as-is for the f32 arm (stderr contains the
`dense q6_K prefill GEMM path: f32` line); `KALSA_Q6K_DENSE=dp4a` for the stock arm
(stderr says `dp4a`). One binary serves both.

## 5. Expected speed cost (item 5), with precedents

The cost is real and it is paid on the q6_K tensors only:

- Scope: the 19 of 266 Q6_K tensors (14 ffn_down + 5 attn_v), batch prefill only. The
  148 Q4_K tensors keep their path (their dp4a is X2E-only and untouched), decode never
  reaches this branch, the tied Q6_K lm_head is CPU. Not wider than the q6_K leg.
- Mechanism: the dp4a arm skips the activation transpose entirely (it quantizes the
  untransposed f32 subbuffer in place) and runs int8 dots; the f32 arm adds one
  `kernel_transpose_32_16` launch plus the noshuffle GEMM with f32 products and an f16
  operand.
- Precedent for the GEMM itself: the f32-product change was measured at **0.663x** of the
  same-family stock GEMM's throughput (q4_0, `stock:mul` 189.73 vs 286.30 t/s,
  `adreno-acc-type`, Adreno 750 - re-derived in `opencl-q6k-f32-product/REPORT.md` section
  5). The f32-operand 0.509x figure (`adreno-operand-b`) is NOT paid by this candidate:
  this base keeps `kernel_transpose_32_16` and the f16 operand; the f32 operand is
  candidate 2's separate arm.
- Precedent for leaving dp4a: **none exists.** No throughput measurement of
  `kernel_gemm_noshuffle_q6_k_q8_1_dp4a` vs the noshuffle GEMM was ever taken (the recon
  treated it as dead code). Since dp4a also avoids the transpose, it is at least as fast
  as the stock noshuffle GEMM, so the honest bound is: q6_K leg throughput lands roughly
  **0.4-0.7x of its dp4a arm** (leg slows ~1.5-2.5x), the low end if dp4a was materially
  faster than stock noshuffle.
- Model level: that leg ratio weighted by the q6_K share of GPU prefill time, which
  nobody has measured. Count-share is 19/266 ~ 7%, but ffn_down are the large GEMMs of
  each block, so the time share is plausibly higher; a 2x leg slowdown then lands at
  low-single-digit to ~10% model-level prefill slowdown. Confidence LOW-MED: the
  precedents are 1-board, thermally confounded Adreno 750 numbers applied by resemblance.
  Measure KLD and speed in the same phone session; do not treat these as a gate.

Honest framing of what this candidate buys: not speed, and not a guaranteed KLD win -
dp4a has no half-product defect to remove, and the CPU reference quantizes activations to
int8 as well (Q8_K). What it buys is attribution: after this change both prior candidates'
kernels actually execute for the 19 Q6_K tensors, so a KLD run on this binary isolates
the q6_K contribution for the first time, and `KALSA_Q6K_DENSE=dp4a` gives the matched
control in the same binary.

## 6. What was not touched

Both dp4a kernel sources (`quant_a_q8_1.cl`, `gemm_noshuffle_q6_k_q8_1_dp4a.cl`), the
MoE dp4a, the Q4_K dp4a block, the transpose block itself, `_cok`/`_r1`/`_kimg`/mc3/tiled
paths, `KALSA_GEMM_B` (candidate 2's selector, not in this stack), governor, upload path,
every file outside `ggml-opencl.cpp`. No push, no tag, no PR. The shared checkout was not
modified; all work happened in the detached worktree.

## Appendix: full diff (`git show 14a3afebf`)

```
commit 14a3afebf836c17d99646b9f4c2d4d962c6ed44f
Author: Marco Gualtieri <66642624+Aspis0@users.noreply.github.com>
Date:   Mon Sep 22 04:02:07 2026 -0400

    opencl: KALSA_Q6K_DENSE routes dense q6_K prefill to the f32 GEMM by default

    The dense q6_K dp4a branch (default on non-X1E with integer dot) quantizes
    activations to int8 in kernel_quant_a_q8_1 and returns before the transpose,
    so the fixed noshuffle f32 GEMM never runs for the 19 Q6_K tensors at batch
    prefill. KALSA_Q6K_DENSE=f32|dp4a selects the path, default f32 (transpose +
    kernel_gemm_noshuffle_q6_K_f32); GGML_OPENCL_Q6K_DENSE_DP4A keeps its stock
    override meaning.

    Stack: 1068eb03d -> 914b34a7e -> this.

    Assisted-by: pi

diff --git a/ggml/src/ggml-opencl/ggml-opencl.cpp b/ggml/src/ggml-opencl/ggml-opencl.cpp
index 97ebf0d18..0d7824f64 100644
--- a/ggml/src/ggml-opencl/ggml-opencl.cpp
+++ b/ggml/src/ggml-opencl/ggml-opencl.cpp
@@ -1542,6 +1542,24 @@ static bool use_adreno_bin_kernels(ggml_backend_opencl_context * backend_ctx) {
 #endif // GGML_OPENCL_USE_ADRENO_BIN_KERNELS
 }

+// KALSA_Q6K_DENSE=f32|dp4a: dense q6_K prefill GEMM path, default f32.
+// f32 = transpose + noshuffle f32 GEMM (no activation quantization);
+// dp4a = stock int8 path (kernel_quant_a_q8_1 + q8_1 dp4a GEMM), for A/B.
+inline bool kalsa_q6k_dense_f32() {
+    static const bool value = [] {
+        const char * e = getenv("KALSA_Q6K_DENSE");
+        if (e && strcmp(e, "dp4a") == 0) {
+            return false;
+        }
+        if (e && *e && strcmp(e, "f32") != 0) {
+            GGML_LOG_ERROR("ggml_opencl: unrecognized KALSA_Q6K_DENSE='%s' (use f32|dp4a)\n", e);
+            exit(1);
+        }
+        return true;
+    }();
+    return value;
+}
+
 static void load_cl_kernels(ggml_backend_opencl_context *backend_ctx) {
     if (backend_ctx->kernels_loaded || backend_ctx->kernel_build_failed) {
         return;
@@ -5548,6 +5566,8 @@ static void load_cl_kernels(ggml_backend_opencl_context *backend_ctx) {

         CL_CHECK((backend_ctx->kernel_gemm_noshuffle_q6_K_f32 = clCreateKernel(prog, "kernel_gemm_noshuffle_q6_K_f32", &err), err));
         CL_CHECK((backend_ctx->kernel_gemm_noshuffle_q6_K_f32_cok = clCreateKernel(prog, "kernel_gemm_noshuffle_q6_K_f32_cok", &err), err));
+        GGML_LOG_INFO("ggml_opencl: dense q6_K prefill GEMM path: %s (KALSA_Q6K_DENSE)\n",
+                      kalsa_q6k_dense_f32() ? "f32" : "dp4a");
         GGML_LOG_CONT(".");
     }

@@ -23077,10 +23097,13 @@ static void ggml_cl_mul_mat_q6_K_f32_adreno(ggml_backend_t backend, const ggml_t
         CL_CHECK((b_sub_buf = clCreateSubBuffer(extra1->data_device, 0, CL_BUFFER_CREATE_TYPE_REGION, &region, &err), err));

         // dp4a (int8) dense q6_K prefill GEMM
+        // KALSA_Q6K_DENSE decides when GGML_OPENCL_Q6K_DENSE_DP4A is unset; the stock
+        // env keeps its override meaning (=1 forces dp4a, =0 forces the f32 GEMM)
         static const char * q6k_dense_dp4a_env = getenv("GGML_OPENCL_Q6K_DENSE_DP4A");
+        const bool          kalsa_q6k_f32      = kalsa_q6k_dense_f32();
                      bool   q6k_dense_dp4a_on  = (q6k_dense_dp4a_env != nullptr)
                                                    ? (atoi(q6k_dense_dp4a_env) != 0)
-                                                   : (backend_ctx->adreno_gen != ADRENO_GPU_GEN::X1E);
+                                                   : (!kalsa_q6k_f32 && backend_ctx->adreno_gen != ADRENO_GPU_GEN::X1E);
         // dot prod has to be available
         q6k_dense_dp4a_on = backend_ctx->has_integer_dot && q6k_dense_dp4a_on;
```

---

## 7. THE INSTRUMENT (experimental ref `kalsa-opencl-q6k-instrument` - never land)

Answers `night-gpu-numerics-audit/REPORT.md` claim 4 (`:121-135`) and its requirement 1
(`:318`): the `dense q6_K prefill GEMM path:` line appeared in 0 of 7 stderr files
because it was INFO-filtered, so the routing rested on source walk + behaviour, never on
an observation of execution. This ref makes that observation possible. **It is an
instrument, not a fix: do not land it, do not merge it, do not tag it.**

### 7.1 What it does (one file, `ggml-opencl.cpp`, 21 insertions / 1 deletion)

1. **Selector line moved `GGML_LOG_INFO` -> `GGML_LOG_WARN`** - WARN is not dropped by
   the stderr filter (the same filter that removes `version:` and every INFO line), so
   the load-time line `ggml_opencl: dense q6_K prefill GEMM path: f32|dp4a
   (KALSA_Q6K_DENSE)` becomes visible once per process.
2. **Execution counters**: two file-scope `std::atomic<size_t>` above
   `ggml_cl_mul_mat_q6_K_f32_adreno`, incremented (relaxed) immediately after each
   competing branch's `enqueue_ndrange_kernel` call - `kalsa_q6k_instrument_dp4a` inside
   the dp4a branch (after the `kernel_gemm_noshuffle_q6_k_q8_1_dp4a` enqueue, anchored on
   the unique lowercase-`k` `cl_kernel dk` line), `kalsa_q6k_instrument_f32` after the
   transpose + `kernel_gemm_noshuffle_q6_K_f32` enqueue (anchored on the function's unique
   four-release tail block). Neither branch contains a return between entry and enqueue,
   so counting at enqueue == counting branch taken, at the point of kernel submission -
   the strongest execution evidence short of a device trace. The GEMV/mc3/tiled paths are
   counted by neither counter: they are not the competing branches.
3. **Totals printed once at process exit** by a static object with a destructor, via
   direct `fprintf(stderr, ...)`:
   `ggml_opencl[instrument]: dense q6_K batch GEMM executions: dp4a=%zu, f32=%zu (KALSA_Q6K_DENSE)`.

**Choice: destructor counters, not the first-occurrence substitute.** The exit path makes
it reliable in this CLI: `main` is `tools/perplexity/main.cpp:3` ->
`llama_perplexity(...)` -> normal `llama_backend_free(); return 0;`
(`tools/perplexity/perplexity.cpp:2097`); grep finds no `_exit`/`quick_exit` anywhere in
the tool, and even the `exit(1)` error paths run static destructors. The destructor touches
only two file-scope atomics (trivially destructible - they outlive every destructor) and
stderr; direct `fprintf` because the static destructor runs after `llama_backend_free()`
and the llama/ggml log callback lifetime is not guaranteed that late.

Expected reads on the phone: default run -> `path: f32` at load, `dp4a=0, f32=N` at exit;
`KALSA_Q6K_DENSE=dp4a` -> `path: dp4a`, `dp4a=N, f32=0`. N is one increment per dense q6_K
batch matmul executed (GPU-routed Q6_K census x prefill chunks with ne1 > 8), which also
gives an independent execution census to check the audit's census correction against
(18 GPU-routed = 14 ffn_down + 4 attn_v, `night-gpu-numerics-audit` requirement 3).

### 7.2 Neutrality: verified, not asserted

Machine check (run this session, both sides from disk): deleting the four added blocks
(`<atomic>` include, counter/reporter block, the two increment lines) from the instrumented
file reproduces `14a3afebf` **byte-for-byte except the single `GGML_LOG_INFO` ->
`GGML_LOG_WARN` token** on the selector line - script output
`REDUCES-TO-BASE-PLUS-LOGLEVEL: True`. Consequences: no dispatch condition, kernel
selection, kernel argument, NDRange, buffer, or arithmetic line differs; no `.cl` file is
touched (`git diff --stat` = 1 file, 21+/1-); the increments are relaxed atomics appended
after the enqueues and read no value the arithmetic uses. The only added I/O is two stderr
lines (load + exit), which cannot enter the KLD computation.

**ACCEPTANCE TEST (owner's, binding):** run the instrument binary on the Q4_K_M model in
both configurations - default (f32 routing) and `KALSA_Q6K_DENSE=dp4a` - and require each
run's KLD to be **bitwise identical to the corresponding combo-binary cell**: f32 arm
`0.006954 / 92.913 %`, dp4a arm `0.394993 / 63.892 %`, at the printed precision the logs
carry. Bitwise agreement is the proof the instrument did not perturb what it measures;
any deviation rejects the instrument (it is not to be debugged into landing). The
counter line must additionally show `dp4a=0` in the f32 run and `f32=0` in the dp4a run.

Not pushed to any phone by this session; the owner schedules that.

### 7.3 Stack, ref, build numbers

```
stack:  1068eb03d -> 914b34a7e -> 14a3afebf -> c6b45aaa4
ref:    kalsa-opencl-q6k-instrument  @ c6b45aaa42859c3d6762a604cadb7bac43ec907f
        kalsa-opencl-q6k-accurate-path @ 14a3afebf  (unchanged - the two remain separable)
subject: "opencl: EXPERIMENTAL q6_K dispatch instrument - never land"
pushed: NO. No tag, no upstream.
```

- Configure: **rc=0**, `-- ggml commit:  c6b45aaa4` (run after the commit, so the stamp
  matches the ref), fresh build dir `build-android-ocl-q6kinstr` (the routing binary's
  dir was left untouched), log `/tmp/q6kinstr/configure.log`.
- `ninja llama-perplexity`: **rc=0**, `[329/329] Linking CXX executable bin/llama-perplexity`,
  zero lines matching `error`, log `/tmp/q6kinstr/build.log`. Recipe: the usual bench
  recipe (`BUILD_SHARED_LIBS=OFF` for the AHardwareBuffer link, explicit
  `OpenCL_INCLUDE_DIR`/`OpenCL_LIBRARY` because the NDK re-roots `CMAKE_PREFIX_PATH`).
- Binary self-report: `LLAMA_BUILD_NUMBER = 11197`, `LLAMA_COMMIT = "c6b45aaa4"`,
  Clang 21.0.0, Android aarch64 -> runtime `version: ... (build 11197, commit c6b45aaa4)`.

```
path:    /Users/marco/Projects/kalsallama-wt-q6kpath/build-android-ocl-q6kinstr/bin/llama-perplexity
size:    119759224 bytes
sha256:  108dfcd41c6d660f92e99bd75c9b38108ace7b7f1bcb908bb7bed6a3d8504cad
NEEDED:  libomp.so, libm.so, libdl.so, libOpenCL.so, libc.so   (same set as every bench binary)
```

The routing candidate's binary is untouched and still on disk for the KLD cells:
`build-android-ocl-q6kpath/bin/llama-perplexity`, sha256
`eded46b090e8dd7406bf86021e4086e1cd51086585252428cfd7d86cf670b5a5` (re-verified this
session after the instrument build).
