# REPORT - opencl-f32-transpose: f32 activation operand for the q4_K/q6_K batch GEMM

Candidate 2, ready to measure if the `914b34a7e` (q6_K product) measurement falls short.
Coder session in a detached worktree. No push, no tag, no upstream. Governor and upload path
not touched. No on-device number is claimed here: a built binary is not a measurement.

## 0. Checklist answers (owner's 4 items)

1. Diff + list: sections 2 and 3, full `git show` in the appendix. The list of which kernels
   get f32 vs half activations is section 3, stated per call site, plus the per-device
   execution reality on the 740 (which includes one discrepancy I found in the recon).
2. Syntax + Android build: section 4. All 6 `.cl` syntax checks rc=0; final ninja rc=0;
   binary self-reports `commit 40a9358a1` (build 11196, Clang 21, Android aarch64);
   `llama-perplexity` sha256
   `5a92eab207e630a9cdb2d355b7559e97d1dcd3acd81d1927ac9e3347f6a64b34`.
3. Speed expectation with precedent: section 5.
4. Commit: `40a9358a191386c55fb2f48caaecfac74c135bb0`, parent
   `914b34a7ea0b4fb6a86c30c491f723d08cebc8c6`, ref `kalsa-opencl-f32-transpose`. NOT pushed.

Stack check (required order): `1068eb03d` -> `914b34a7e` -> `40a9358a1`. Upload-degrade
(`1069243206`-family worktree) is not in this chain. Verified with `git log`.

Trees:

- Work: `/Users/marco/Projects/kalsallama-wt-f32transpose`, detached, created this session at
  `914b34a7e`. The shared `/Users/marco/Projects/kalsallama` was not checked out or modified
  (only `git worktree add`, `git show`, `git log` against its object store).
- Build dir (this session's own): `build-android-ocl-f32t` inside that worktree.
- Report: this file.

## 1. Provenance of the port

Both probe commits are reachable in the shared repo (`git cat-file -t` = commit):

- `7ef9389bc` "selectable precision and math flags" (KALSA_GEMM_PREC / KALSA_GEMM_MATH).
  NOT ported: that axis separates accumulator/product/dequant precision, which the shipped
  fixes (`67c73d26c`, `914b34a7e`) already baked in as f32 in the two main kernels. Porting
  it would reopen a question that is already answered for our path.
- `5d188a9e4` "selectable f32 activation operand" (KALSA_GEMM_B, q4_0 only). Ported in shape:
  companion transpose kernel + env selector + `-DKALSA_GEMM_B_FLOAT=1` compile flag +
  doubled transposed scratch + `CL_FLOAT` image + transpose-kernel selection.

Adaptations vs the probe (the probe had no small-batch siblings and only touched q4_0):

- Selector scope here: q4_K and q6_K batch GEMM programs only (what Q4_K_M exercises).
- Small-batch gating: `gemm_noshuffle_q4_k_f32.cl` contains `_r1`/`_kimg`/`_cok` siblings that
  still read `read_imageh`, and `gemm_noshuffle_q6_k_f32.cl` contains a `_cok` sibling. Only
  the MAIN batch kernel is macro-ified, so the host selects the f32 transpose only when the
  main kernel is the one selected (gate in section 2.2). Probe had no such condition.
- The probe's "float requires KALSA_GEMM_PREC=mul/deq" guard is not needed: at `914b34a7e`
  both main kernels already accumulate and multiply in f32, so an f32 operand is always
  meaningful.
- The probe's exit(1) on an unrecognized `KALSA_GEMM_B` value is kept: an A/B must never run
  the wrong arm silently.

## 2. What changed

`git show --stat` (appendix has the full diff):

```
 ggml/src/ggml-opencl/ggml-opencl.cpp               | 90 +++++++++++++++-------
 .../ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl | 26 ++++---
 .../ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl | 26 ++++---
 ggml/src/ggml-opencl/kernels/transpose.cl          | 30 ++++++++
 4 files changed, 127 insertions(+), 45 deletions(-)
```

### 2.1 The transpose, before/after

- BEFORE: `kernels/transpose.cl` has one activation transpose, `kernel_transpose_32_16`:
  reads the f32 source image with `read_imageh`, writes `half4` with `write_imageh`
  (source comment: "converts to FP16"), zero-pads the N tail. All ten quant trans-weight
  paths launch it. It is UNTOUCHED by this change.
- AFTER: `kernel_transpose_32_32` appended as its f32 twin: same 4x4 tile, same bounds guard,
  same zero padding, `read_imagef` in / `write_imagef` out. The new kernel is byte-identical
  to the one in probe `5d188a9e4` (both blobs are `5b9396b79`; `diff` of the whole file
  against `git show 5d188a9e4:.../transpose.cl` = identical).

### 2.2 Host call sites touched (2 of 10) + plumbing

| site | line before -> after | change |
|---|---|---|
| struct member | 1226 -> 1227 | `+ cl_kernel kernel_transpose_32_32;` |
| selector helper | (new) 1546-1560 | `kalsa_gemm_b_float()`, env `KALSA_GEMM_B`, default float |
| kernel create + arm log | 3939 -> 3958-3960 | create `kernel_transpose_32_32`; `GGML_LOG_INFO "... activation operand: float|half"` |
| q4_K program build | 4423 -> 4443-4449 | local opts copy, `+= " -DKALSA_GEMM_B_FLOAT=1"` when float |
| q6_K program build | 5543 -> 5567-5574 | same, on a copy of `CL_moe_compile_opts` (shared string not mutated) |
| q4_K transpose block | 22643-22668 -> 22672-22717 | gate `use_f32_trans` (22693), scratch size (22697), image format (22702), kernel select (22717) |
| q4_K old decl spot | 22784-22793 -> removed | `_r1/_kimg/_cok` predicates hoisted above the transpose so the gate can see them |
| q6_K transpose block | 23138-23168 -> 23175-23207 | cok predicates hoisted + gate `use_f32_trans` (23182), scratch size (23186), image format (23192), kernel select (23207) |
| q6_K old decl spot | 23186-23188 -> removed | `use_q6k_cok` moved above the transpose |

Before/after of the two touched call sites (q6_K shown; q4_K is the same shape with
`K * (N + padding)` and `img_fmt = {...}` aggregate syntax):

```
BEFORE                                          AFTER
region.size = ne00 * (ne1 + padding)/2 ...      region.size = use_f32_trans ? ne00 * (ne1 + padding) * sizeof(float)
                                                                                       : ne00 * (ne1 + padding) * sizeof(float)/2;
img_fmt...data_type = CL_HALF_FLOAT;            img_fmt...data_type = use_f32_trans ? CL_FLOAT : CL_HALF_FLOAT;
kernel = backend_ctx->kernel_transpose_32_16;   kernel = use_f32_trans ? backend_ctx->kernel_transpose_32_32
                                                                    : backend_ctx->kernel_transpose_32_16;
```

Selector semantics:

- `KALSA_GEMM_B` unset -> float (WORKING DEFAULT for our shipped Q4_K_M path).
- `KALSA_GEMM_B=float` -> float (explicit).
- `KALSA_GEMM_B=half` -> stock behavior, same binary (this is the comparison arm; the flag
  stays out of compile_opts, and section 4.1 shows the half arm preprocesses to the same code
  tokens as `914b34a7e`).
- anything else -> `GGML_LOG_ERROR` + `exit(1)`.
- The flag is part of compile_opts, hence part of the program-cache key, so the two arms get
  distinct `.clbin` entries on the phone (same mechanism as the engine's kset keying).

Gates (why they exist): the small-batch siblings read the half image, so the f32 transpose is
only selected when the main batch kernel runs:

- q4_K: `use_f32_trans = kalsa_gemm_b_float() && !use_cok && !use_r1 && !use_kimg` (line
  22693). At `ne1 > 8` all three are false, so batch prefill (our bench: ne1=256) always
  takes f32. If someone disables `_cok` and runs ne1<=8, the main kernel runs and the gate
  correctly follows it to f32.
- q6_K: `use_f32_trans = kalsa_gemm_b_float() && !use_q6k_cok` (line 23182). `_cok` is
  opt-in and default OFF, so the main kernel (f32 reader) is the default selection for all
  ne1 in this block.

### 2.3 Kernels

- `gemm_noshuffle_q4_k_f32.cl`: macro block added; main `kernel_gemm_noshuffle_q4_k_f32`
  only: `half8 B` -> `KALSA_GEMM_B_TYPE B`, 8 `read_imageh(src1,...)` -> `KALSA_GEMM_READ_B`.
  `_r1`, `_kimg`, `_cok` untouched (they keep `half8 B` + `read_imageh`).
- `gemm_noshuffle_q6_k_f32.cl`: same, main `kernel_gemm_noshuffle_q6_K_f32` only (8 read
  sites); `_cok` untouched.
- With the flag undefined both files preprocess to the same code tokens as `914b34a7e`
  (section 4.1), so the half arm is the old arithmetic, not a re-derivation of it.

## 3. THE LIST: which kernels receive f32 activations, which still receive half

All ten transpose call sites in `ggml-opencl.cpp` at `40a9358a1`, default selector:

| # | call site (line) | enclosing path | activation operand |
|---|---|---|---|
| 1 | 20432 | q1_0 batch GEMM | HALF (untouched) |
| 2 | 20888 | q4_0 batch GEMM | HALF (untouched; the probe's q4_0 wiring was not ported) |
| 3 | 21098 | q4_1 batch GEMM | HALF (untouched) |
| 4 | 21359 | q5_0 batch GEMM | HALF (untouched) |
| 5 | 21540 | q5_1 batch GEMM | HALF (untouched) |
| 6 | 21766 | iq4_nl batch GEMM | HALF (untouched) |
| 7 | 22201 | q8_0 batch GEMM | HALF (untouched) |
| 8 | 22717 | q4_K batch GEMM | **F32 when main kernel selected** (gate 22693), half when `_r1`/`_kimg`/`_cok` selected |
| 9 | 23207 | q6_K batch GEMM | **F32 when main kernel selected** (gate 23182), half when `_cok` selected |
| 10 | 23444 | q5_K batch GEMM | HALF (untouched) |

Kernels that never see the transposed image (unchanged): all GEMV/decode paths (ne1==1, no
transpose, f32 image as before), the tiled q6_K GEMM (reads the f32 source directly), the
bin/a8 paths, and the dp4a dense paths (they quantize the untransposed f32 subbuffer with
`kernel_quant_a_q8_1`).

### Execution reality on the Adreno 740 for LFM2.5-2.6B Q4_K_M at -b 256 (source reading)

Default envs, `has_integer_dot = true` (the recon's reading of this device):

- 148 Q4_K tensors: q4_K dense dp4a defaults to `adreno_gen == X2E` (line 22736) -> OFF on
  the 740; bin/a8 kernels are X2E-only -> OFF. Dispatch reaches the transpose + main GEMM, so
  with this candidate those 148 tensors get f32 activations. This is the leg that will move
  the measurement if the operand matters.
- 19 Q6_K tensors: the q6_K dense dp4a branch defaults to `adreno_gen != X1E` (lines
  23113-23118), AND `has_integer_dot`, and its condition at line 23123 (`ne1 > 8`,
  `ne00 % 32 == 0`, `ne01 % 64 == 0`, name not output/token_embd) is satisfied by all 19 at
  batch 256. The dispatch is line 23141 (`kernel_gemm_noshuffle_q6_k_q8_1_dp4a`) and it
  RETURNS before the transpose block. Under this reading, on the 740 at batch 256 neither the
  q6_K transpose nor the q6_K noshuffle GEMM - including the kernel `914b34a7e` fixes -
  executes for those tensors, and the q6_K half of this candidate is only exercised if the
  dp4a branch declines (`GGML_OPENCL_Q6K_DENSE_DP4A=0`, shape mismatch, or
  `has_integer_dot` false).
- tied lm_head / token_embd: CPU (supports_op declines vocab-scale Q6_K on A7X).

DISCREPANCY TO FLAG: `gpu-numerics-fix-recon/REPORT.md` section 1.4 states "the q6_K dp4a
program ... has no dispatch site anywhere in ggml-opencl.cpp". It does have one, at line
23141. The symbol is `kernel_gemm_noshuffle_q6_k_q8_1_dp4a` with a LOWERCASE `k`, while the
noshuffle GEMM is `..._q6_K_f32` with an uppercase `K`; a case-sensitive grep for
`q6_K_q8_1_dp4a` misses the dp4a symbol (it returned nothing for me twice before I went
case-insensitive - the same trap presumably caught the recon). Consequence: the recon's two
claims ("has_integer_dot is true on this device" and "q6_K dp4a never dispatches") cannot both
be true. If `has_integer_dot` is true, the first measurement may show little movement on the
Q6_K leg regardless of `914b34a7e`, because a different kernel (q8_1 dp4a) is doing that work
- and the Q6_K error, if any, would enter through activation quantization there, which neither
candidate touches. Source-level reading only; the measurement decides.

## 4. Verification (numbers on disk)

### 4.1 Syntax gate, every .cl file touched

Command (the archive's pre-registered gate, `adreno-acc-type/PREREG.md:128-129`), from the
worktree root:

```
/opt/homebrew/share/android-ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang \
    -x cl -cl-std=CL1.2 -Xclang -finclude-default-header -target spirv64 \
    -fsyntax-only ggml/src/ggml-opencl/kernels/<file>
```

| file | default arm rc | `-DKALSA_GEMM_B_FLOAT=1` rc |
|---|---|---|
| transpose.cl | 0 | 0 |
| gemm_noshuffle_q4_k_f32.cl | 0 | 0 |
| gemm_noshuffle_q6_k_f32.cl | 0 | 0 |

Only warning: the pre-existing `cl_qcom_reqd_sub_group_size unknown ... pragma - ignoring`
in the stock q6_K file (present before the change).

Preprocessor identity (clang -E, linemarkers stripped, same path for both sides):

- No-flag arm of both GEMM files: NON-BLANK output IDENTICAL to `914b34a7e`. (q6_K is
  byte-identical; q4_K differs only by 4 blank lines clang emits around the new conditional
  block. Code tokens: equal. `read_imagef` occurrences: 0 in both.)
- Float arm, q4_K: 8 `read_imagef` (main kernel) + 24 `read_imageh` (the three untouched
  siblings) + `float8 B` x1 / `half8 B` x3. q6_K: 8 + 8 (`_cok`), `float8 B` x1 /
  `half8 B` x1. Exactly the intended split.

### 4.2 Android arm64 build

Recipe: the phone bench's, from `s23-native-gpu-bench/REPORT.md:49` (Ninja, NDK 29 toolchain,
android-28, arm64-v8a, Release, GGML_OPENCL=ON, embed kernels ON, Adreno kernels ON, bin
kernels OFF, OpenCL from `/Users/marco/kalsa-opencl-deps/android-prefix`), build dir
`build-android-ocl-f32t`.

- Configure: rc=0, `-- ggml commit:  40a9358a1` (re-run after the final amend so the stamp
  matches the ref).
- First `ninja llama-perplexity llama-cli`: **rc=1**, one real error, mine:
  `ggml-opencl.cpp:22702: error: non-constant-expression cannot be narrowed from type 'int'
  to 'cl_channel_type' in initializer list [-Wc++11-narrowing]` on the q4_K `img_fmt`
  braced init with the ternary. Fixed with an explicit
  `static_cast<cl_channel_type>(...)`; commit amended (same message), reconfigured,
  rebuilt.
- Final `ninja llama-perplexity llama-cli`: **rc=0**, `[175/175] Linking CXX executable
  bin/llama-cli`. Build log: `/tmp/f32t-cl/build2.log`.
- Binary self-report (generated `common/build-info.cpp`):
  `LLAMA_BUILD_NUMBER = 11196`, `LLAMA_COMMIT = "40a9358a1"`,
  `LLAMA_COMPILER = "Clang 21.0.0"`, `LLAMA_BUILD_TARGET = "Android aarch64"`; the runtime
  line is `version: ... (build 11196, commit 40a9358a1)` - it names this ref's sha.
- The Android `llama-perplexity` the phone needs:

```
path:    /Users/marco/Projects/kalsallama-wt-f32transpose/build-android-ocl-f32t/bin/llama-perplexity
size:    119849832 bytes
sha256:  5a92eab207e630a9cdb2d355b7559e97d1dcd3acd81d1927ac9e3347f6a64b34
```

  Companion `bin/llama-cli`: sha256
  `75f47bf993248d24e6e193b21fc8977c431b3b5de653c3f8520ee6c80249bfca`, 165530240 bytes.
- `llvm-readelf -d` NEEDED: `libomp.so, libm.so, libdl.so, libOpenCL.so, libc.so` - same set
  as the bench binaries (ship `libomp.so` alongside, as in `s23-kld-740-q4km`).

Arms on the phone:

- f32 arm (the candidate): run the binary as-is; stderr will contain
  `ggml_opencl: q4_K/q6_K batch GEMM activation operand: float (KALSA_GEMM_B)`.
- half arm (in-binary control, reproduces `914b34a7e` arithmetic): same binary plus
  `KALSA_GEMM_B=half`.
- One binary serves both arms; cache entries are separated by the compile-opts key.

## 5. Expected speed cost, with the precedent named

Precedent: the archive's operand-B cell (`adreno-operand-b/REPORT.md`, QRD8650 / Adreno 750,
Q4_0 shipped model, kit at probe `5d188a9e4`) measured the f32-operand variant at
`stock:mul:float` 147.05 t/s against the stock control 288.62 t/s = **0.509x**, and found NO
numerical gain THERE: KLD 0.004736 -> 0.004641 (within 2%), same-top slightly worse. (That
cell's speed comparison carries its own validity caveat: 5.71 C start-temperature excursion
against a 2 C band, declared degraded; three independent half-arm estimates still agreed
within 1%.)

Why it could still matter on Q4_K_M on the 740, in one sentence each:

- The archive's test was a different quant mix where the error was already small: Q4_0 on the
  750, after the product fix, sat at KLD ~0.0047; the operand change had almost nothing left
  to fix there. Our failing regime is KLD 0.395 - about 80x worse - and it is produced by the
  K-quant kernels, whose f32-operand arm has never been measured on any device (recon:
  "MEDIUM as a contributor; UNTESTED for q6_K", "q4_K fidelity never measured anywhere").
- The recon names the f16 activation operand as the residual that survives if the q6_K
  product fix alone is not enough, and it is precisely the one the q6_K patch cannot address
  for the Q4_K leg: the operand enters before the f32 product
  (`convert_float8(B)` widens an already-narrowed half), so activation precision lost at the
  image read is gone regardless of how the product is computed.

Honest expectation, not a promise: the only measurement that exists says the f32 operand
moves KLD within 2% on q4_0, so the prior is that this arm buys little accuracy and pays
real speed - budget roughly 0.5-0.8x prefill throughput against the half arm (the transposed
leg writes 2x bytes, the GEMM reads RGBA32F instead of RGBA16F, and the B register footprint
doubles; the 750/Q4_0 point estimate is 0.509x, a different device and mix, so treat it as
order-of-magnitude only). Its value is discrimination: if `914b34a7e` alone leaves KLD near
0.395 and this arm collapses it, the operand was the Q4_K residual; if this arm also fails
while costing half the speed, the operand is refuted for the K-quants too and the field
narrows to tile geometry, summation order, the 740 compiler, and the q8_1 dp4a path from
section 3.

## 6. Commit, and what was not touched

```
ref:    kalsa-opencl-f32-transpose
commit: 40a9358a191386c55fb2f48caaecfac74c135bb0
parent: 914b34a7ea0b4fb6a86c30c491f723d08cebc8c6   (its parent: 1068eb03d)
message: opencl: f32 activation operand for the q4_K/q6_K batch GEMM   (Assisted-by: pi)
pushed: NO. No tag, no upstream.
```

Not touched: governor, upload path, the eight non-K transpose call sites, the GEMV/decode
paths, the `_r1`/`_kimg`/`_cok` small-batch kernels, both dp4a paths, the tiled path, the
`KALSA_GEMM_PREC`/`KALSA_GEMM_MATH` axis (not ported), and every file outside the four in the
stat. The shared checkout was not modified; all work happened in the detached worktree.

## Appendix: full diff (`git show 40a9358a1`)

```
commit 40a9358a191386c55fb2f48caaecfac74c135bb0
Author: Marco Gualtieri <66642624+Aspis0@users.noreply.github.com>
Date:   Tue Sep 22 03:30:09 2026 -0400

    opencl: f32 activation operand for the q4_K/q6_K batch GEMM
    
    Companion transpose kernel_transpose_32_32 (from probe 5d188a9e4,
    byte-identical) next to kernel_transpose_32_16. KALSA_GEMM_B=float|half
    selects the operand, default float: activations stay f32 into the main
    q4_K and q6_K batch GEMM (the Q4_K_M shipped path). The small-batch
    siblings (_r1/_kimg/_cok) keep reading the half image, so the f32
    transpose is selected only when the main batch kernel runs. The eight
    other quant transpose call sites are untouched.
    
    Half arm preprocesses to the same code tokens as the base (NDK clang
    -fsyntax-only rc=0 in both arms, Android arm64 build in the report).
    
    Stack: 1068eb03d -> 914b34a7e -> this.
    
    Assisted-by: pi

diff --git a/ggml/src/ggml-opencl/ggml-opencl.cpp b/ggml/src/ggml-opencl/ggml-opencl.cpp
index 97ebf0d18..8012cfcbd 100644
--- a/ggml/src/ggml-opencl/ggml-opencl.cpp
+++ b/ggml/src/ggml-opencl/ggml-opencl.cpp
@@ -1224,6 +1224,7 @@ struct ggml_backend_opencl_context {
 
     cl_kernel kernel_transpose_32;
     cl_kernel kernel_transpose_32_16;
+    cl_kernel kernel_transpose_32_32;
     cl_kernel kernel_transpose_16;
     cl_kernel kernel_transpose_8_buf;
     cl_kernel kernel_transpose_16_buf;
@@ -1542,6 +1543,23 @@ static bool use_adreno_bin_kernels(ggml_backend_opencl_context * backend_ctx) {
 #endif // GGML_OPENCL_USE_ADRENO_BIN_KERNELS
 }
 
+// KALSA_GEMM_B=float|half: activation operand of the q4_K/q6_K batch GEMM, default float.
+// float keeps activations f32 through kernel_transpose_32_32; half keeps the stock f16 narrowing.
+inline bool kalsa_gemm_b_float() {
+    static const bool value = [] {
+        const char * e = getenv("KALSA_GEMM_B");
+        if (e && strcmp(e, "half") == 0) {
+            return false;
+        }
+        if (e && *e && strcmp(e, "float") != 0) {
+            GGML_LOG_ERROR("ggml_opencl: unrecognized KALSA_GEMM_B='%s' (use half|float)\n", e);
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
@@ -3937,6 +3955,9 @@ static void load_cl_kernels(ggml_backend_opencl_context *backend_ctx) {
         if (backend_ctx->kernel_build_failed) { return; }
 
         CL_CHECK((backend_ctx->kernel_transpose_32_16 = clCreateKernel(backend_ctx->program_transpose, "kernel_transpose_32_16", &err), err));
+        CL_CHECK((backend_ctx->kernel_transpose_32_32 = clCreateKernel(backend_ctx->program_transpose, "kernel_transpose_32_32", &err), err));
+        GGML_LOG_INFO("ggml_opencl: q4_K/q6_K batch GEMM activation operand: %s (KALSA_GEMM_B)\n",
+                      kalsa_gemm_b_float() ? "float" : "half");
         CL_CHECK((backend_ctx->kernel_transpose_32    = clCreateKernel(backend_ctx->program_transpose, "kernel_transpose_32", &err), err));
         CL_CHECK((backend_ctx->kernel_transpose_16    = clCreateKernel(backend_ctx->program_transpose, "kernel_transpose_16", &err), err));
         CL_CHECK((backend_ctx->kernel_transpose_8_buf  = clCreateKernel(backend_ctx->program_transpose, "kernel_transpose_8_buf", &err), err));
@@ -4422,7 +4443,11 @@ static void load_cl_kernels(ggml_backend_opencl_context *backend_ctx) {
 #else
         const std::string kernel_src = read_file("gemm_noshuffle_q4_k_f32.cl");
 #endif
-        cl_program prog = build_program_from_source(backend_ctx, kernel_src.c_str(), compile_opts);
+        std::string q4k_compile_opts = compile_opts;
+        if (kalsa_gemm_b_float()) {
+            q4k_compile_opts += " -DKALSA_GEMM_B_FLOAT=1";
+        }
+        cl_program prog = build_program_from_source(backend_ctx, kernel_src.c_str(), q4k_compile_opts);
         if (backend_ctx->kernel_build_failed) { return; }
         CL_CHECK((backend_ctx->kernel_gemm_noshuffle_q4_k_f32 = clCreateKernel(prog, "kernel_gemm_noshuffle_q4_k_f32", &err), err));
         CL_CHECK((backend_ctx->kernel_gemm_noshuffle_q4_k_f32_r1 = clCreateKernel(prog, "kernel_gemm_noshuffle_q4_k_f32_r1", &err), err));
@@ -5542,8 +5567,12 @@ static void load_cl_kernels(ggml_backend_opencl_context *backend_ctx) {
 #else
         const std::string kernel_src = read_file("gemm_noshuffle_q6_k_f32.cl");
 #endif
+        std::string q6k_compile_opts = CL_moe_compile_opts;
+        if (kalsa_gemm_b_float()) {
+            q6k_compile_opts += " -DKALSA_GEMM_B_FLOAT=1";
+        }
         cl_program prog =
-            build_program_from_source(backend_ctx, kernel_src.c_str(), CL_moe_compile_opts);
+            build_program_from_source(backend_ctx, kernel_src.c_str(), q6k_compile_opts);
         if (backend_ctx->kernel_build_failed) { return; }
 
         CL_CHECK((backend_ctx->kernel_gemm_noshuffle_q6_K_f32 = clCreateKernel(prog, "kernel_gemm_noshuffle_q6_K_f32", &err), err));
@@ -22643,14 +22672,34 @@ static void ggml_cl_mul_mat_q4_k_f32_adreno(ggml_backend_t backend, const ggml_t
             padding = 8 - extra_elements;
         }
 
+        // Small-batch (medium n_q) occupancy fix: at ne1<=8 the 2x8 grid is
+        // (1, ceil(M/2)) -> ~M/256 workgroups, which under-occupies the SP and
+        // makes the GEMM much slower than the ne1==1 GEMV at the same weight
+        // traffic. The _r1 (1-row) kernel doubles the M-axis workgroup count
+        // and removes the accumulator spill. Opt-in via env while validating.
+        static const bool q4k_gemm_r1   = (getenv("GGML_OPENCL_Q4K_GEMM_R1")   != nullptr);
+        static const bool q4k_gemm_kimg = (getenv("GGML_OPENCL_Q4K_GEMM_KIMG") != nullptr);
+        // Cooperative-K (intra-WG K-split + reduction) for the small-batch
+        // (n_q in [2..8]) path: DEFAULT ON, opt out with GGML_OPENCL_Q4K_GEMM_COK=0.
+        // Byte-identical greedy output; large-batch (ne1>8) untouched.
+        static const char * q4k_cok_env = getenv("GGML_OPENCL_Q4K_GEMM_COK");
+        static const bool q4k_gemm_cok  = (q4k_cok_env == nullptr) || (atoi(q4k_cok_env) != 0);
+        const bool use_cok  = q4k_gemm_cok && (ne1 <= 8);
+        const bool use_r1   = !use_cok && q4k_gemm_r1 && (ne1 <= 8);
+        // Weights-as-image (L1/TPL1) for the small-batch weight-read-bound path.
+        const bool use_kimg = !use_cok && !use_r1 && q4k_gemm_kimg && (ne1 <= 8);
+
+        // the small-batch kernels read the half image; only the main batch GEMM takes the f32 operand
+        const bool use_f32_trans = kalsa_gemm_b_float() && !use_cok && !use_r1 && !use_kimg;
+
         // subbuffer for transposed activations
         region.origin = 0;
-        region.size = K * (N + padding) * sizeof(float)/2;
+        region.size = use_f32_trans ? K * (N + padding) * sizeof(float) : K * (N + padding) * sizeof(float)/2;
         backend_ctx->prealloc_act_trans.allocate(context, region.size);
         CL_CHECK((b_sub_buf_trans = clCreateSubBuffer(backend_ctx->prealloc_act_trans.buffer, 0, CL_BUFFER_CREATE_TYPE_REGION, &region, &err), err));
 
         // image for transposed activations
-        img_fmt = {CL_RGBA, CL_HALF_FLOAT};
+        img_fmt = {CL_RGBA, static_cast<cl_channel_type>(use_f32_trans ? CL_FLOAT : CL_HALF_FLOAT)};
         memset(&img_desc, 0, sizeof(img_desc));
         img_desc.image_type = CL_MEM_OBJECT_IMAGE1D_BUFFER;
         img_desc.image_width = K * (N + padding) / 4;
@@ -22665,7 +22714,7 @@ static void ggml_cl_mul_mat_q4_k_f32_adreno(ggml_backend_t backend, const ggml_t
         int width_B = K/4;
         int padded_height_B = (N + padding)/4;
 
-        kernel = backend_ctx->kernel_transpose_32_16;
+        kernel = use_f32_trans ? backend_ctx->kernel_transpose_32_32 : backend_ctx->kernel_transpose_32_16;
         CL_CHECK(clSetKernelArg(kernel, 0, sizeof(cl_mem), &b_img));
         CL_CHECK(clSetKernelArg(kernel, 1, sizeof(cl_mem), &b_img_trans));
         CL_CHECK(clSetKernelArg(kernel, 2, sizeof(int),    &height_B));
@@ -22773,22 +22822,6 @@ static void ggml_cl_mul_mat_q4_k_f32_adreno(ggml_backend_t backend, const ggml_t
         }
 
         // gemm
-        // Small-batch (medium n_q) occupancy fix: at ne1<=8 the 2x8 grid is
-        // (1, ceil(M/2)) -> ~M/256 workgroups, which under-occupies the SP and
-        // makes the GEMM much slower than the ne1==1 GEMV at the same weight
-        // traffic. The _r1 (1-row) kernel doubles the M-axis workgroup count
-        // and removes the accumulator spill. Opt-in via env while validating.
-        static const bool q4k_gemm_r1   = (getenv("GGML_OPENCL_Q4K_GEMM_R1")   != nullptr);
-        static const bool q4k_gemm_kimg = (getenv("GGML_OPENCL_Q4K_GEMM_KIMG") != nullptr);
-        // Cooperative-K (intra-WG K-split + reduction) for the small-batch
-        // (n_q in [2..8]) path: DEFAULT ON, opt out with GGML_OPENCL_Q4K_GEMM_COK=0.
-        // Byte-identical greedy output; large-batch (ne1>8) untouched.
-        static const char * q4k_cok_env = getenv("GGML_OPENCL_Q4K_GEMM_COK");
-        static const bool q4k_gemm_cok  = (q4k_cok_env == nullptr) || (atoi(q4k_cok_env) != 0);
-        const bool use_cok  = q4k_gemm_cok && (ne1 <= 8);
-        const bool use_r1   = !use_cok && q4k_gemm_r1 && (ne1 <= 8);
-        // Weights-as-image (L1/TPL1) for the small-batch weight-read-bound path.
-        const bool use_kimg = !use_cok && !use_r1 && q4k_gemm_kimg && (ne1 <= 8);
 
         cl_mem q_img = nullptr;
         if (use_kimg) {
@@ -23142,15 +23175,21 @@ static void ggml_cl_mul_mat_q6_K_f32_adreno(ggml_backend_t backend, const ggml_t
             padding = 8 - extra_elements;
         }
 
+        static const char * q6k_cok_env = getenv("GGML_OPENCL_Q6K_GEMM_COK");
+        static const bool q6k_gemm_cok  = (q6k_cok_env != nullptr) && (atoi(q6k_cok_env) != 0);
+        const bool use_q6k_cok = q6k_gemm_cok && (ne1 <= 8);
+        // _cok reads the half image; only the main batch GEMM takes the f32 operand
+        const bool use_f32_trans = kalsa_gemm_b_float() && !use_q6k_cok;
+
         // subbuffer for transposed activation
         region.origin = 0;
-        region.size = ne00 * (ne1 + padding) * sizeof(float)/2;
+        region.size = use_f32_trans ? ne00 * (ne1 + padding) * sizeof(float) : ne00 * (ne1 + padding) * sizeof(float)/2;
         backend_ctx->prealloc_act_trans.allocate(context, region.size);
         CL_CHECK((b_buf_trans = clCreateSubBuffer(backend_ctx->prealloc_act_trans.buffer, 0, CL_BUFFER_CREATE_TYPE_REGION, &region, &err), err));
 
         // image for transposed activation
         img_fmt.image_channel_order = CL_RGBA;
-        img_fmt.image_channel_data_type = CL_HALF_FLOAT;
+        img_fmt.image_channel_data_type = use_f32_trans ? CL_FLOAT : CL_HALF_FLOAT;
         memset(&img_desc, 0, sizeof(img_desc));
         img_desc.image_type = CL_MEM_OBJECT_IMAGE1D_BUFFER;
         img_desc.image_width = ne00 * (ne1 + padding) / 4;
@@ -23165,7 +23204,7 @@ static void ggml_cl_mul_mat_q6_K_f32_adreno(ggml_backend_t backend, const ggml_t
         int width_B = ne00/4;
         int padded_height_B = (ne1 + padding) / 4;
 
-        kernel = backend_ctx->kernel_transpose_32_16;
+        kernel = use_f32_trans ? backend_ctx->kernel_transpose_32_32 : backend_ctx->kernel_transpose_32_16;
         CL_CHECK(clSetKernelArg(kernel, 0, sizeof(cl_mem), &b_img));
         CL_CHECK(clSetKernelArg(kernel, 1, sizeof(cl_mem), &b_img_trans));
         CL_CHECK(clSetKernelArg(kernel, 2, sizeof(int),    &height_B));
@@ -23185,9 +23224,6 @@ static void ggml_cl_mul_mat_q6_K_f32_adreno(ggml_backend_t backend, const ggml_t
         // bit-exact). It is also NEUTRAL on end-to-end MTP (q4_K cok already
         // captured that; the MTP bottleneck moved off the GEMMs). Keep opt-in
         // for batched serving until PPL-validated on a non-GDN q6_K model.
-        static const char * q6k_cok_env = getenv("GGML_OPENCL_Q6K_GEMM_COK");
-        static const bool q6k_gemm_cok  = (q6k_cok_env != nullptr) && (atoi(q6k_cok_env) != 0);
-        const bool use_q6k_cok = q6k_gemm_cok && (ne1 <= 8);
         kernel = use_q6k_cok ? backend_ctx->kernel_gemm_noshuffle_q6_K_f32_cok
                              : backend_ctx->kernel_gemm_noshuffle_q6_K_f32;
         int padded_N = ne1 + padding;
diff --git a/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl b/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl
index eeb85b625..a8557e58e 100644
--- a/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl
+++ b/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl
@@ -29,6 +29,14 @@ inline void get_scale_min_k4(
     }
 }
 
+#ifdef KALSA_GEMM_B_FLOAT
+#define KALSA_GEMM_B_TYPE float8
+#define KALSA_GEMM_READ_B(img, idx) read_imagef(img, idx)
+#else
+#define KALSA_GEMM_B_TYPE half8
+#define KALSA_GEMM_READ_B(img, idx) read_imageh(img, idx)
+#endif
+
 #ifdef ADRENO_GPU
 REQD_SUBGROUP_SIZE_128
 #endif
@@ -59,7 +67,7 @@ kernel void kernel_gemm_noshuffle_q4_k_f32(
     // The q4_K fidelity gain and speed cost are NOT measured for this kernel.
     // Do not infer q4_K measurements from q4_0.
     float8 c0 = 0, c1 = 0, c2 = 0, c3 = 0;
-    half8 B;
+    KALSA_GEMM_B_TYPE B;
     half4 dequantized_weights;
 
 
@@ -93,8 +101,8 @@ kernel void kernel_gemm_noshuffle_q4_k_f32(
             ushort4 bits4 = vload4(0, weight_ptr + (ki/4) * m);
 
             // j=0
-            B.s0123 = read_imageh(src1, gy*2   + (ki+0) * n_4);
-            B.s4567 = read_imageh(src1, gy*2+1 + (ki+0) * n_4);
+            B.s0123 = KALSA_GEMM_READ_B(src1, gy*2   + (ki+0) * n_4);
+            B.s4567 = KALSA_GEMM_READ_B(src1, gy*2+1 + (ki+0) * n_4);
             dequantized_weights.s0 = (bits4.s0 & 0x000F) * scale.s0 - mval.s0;
             dequantized_weights.s1 = (bits4.s1 & 0x000F) * scale.s1 - mval.s1;
             dequantized_weights.s2 = (bits4.s2 & 0x000F) * scale.s2 - mval.s2;
@@ -105,8 +113,8 @@ kernel void kernel_gemm_noshuffle_q4_k_f32(
             c3 += convert_float8(B) * (float)dequantized_weights.s3;
 
             // j=1
-            B.s0123 = read_imageh(src1, gy*2   + (ki+1) * n_4);
-            B.s4567 = read_imageh(src1, gy*2+1 + (ki+1) * n_4);
+            B.s0123 = KALSA_GEMM_READ_B(src1, gy*2   + (ki+1) * n_4);
+            B.s4567 = KALSA_GEMM_READ_B(src1, gy*2+1 + (ki+1) * n_4);
             dequantized_weights.s0 = ((bits4.s0 & 0x00F0) >> 4) * scale.s0 - mval.s0;
             dequantized_weights.s1 = ((bits4.s1 & 0x00F0) >> 4) * scale.s1 - mval.s1;
             dequantized_weights.s2 = ((bits4.s2 & 0x00F0) >> 4) * scale.s2 - mval.s2;
@@ -117,8 +125,8 @@ kernel void kernel_gemm_noshuffle_q4_k_f32(
             c3 += convert_float8(B) * (float)dequantized_weights.s3;
 
             // j=2
-            B.s0123 = read_imageh(src1, gy*2   + (ki+2) * n_4);
-            B.s4567 = read_imageh(src1, gy*2+1 + (ki+2) * n_4);
+            B.s0123 = KALSA_GEMM_READ_B(src1, gy*2   + (ki+2) * n_4);
+            B.s4567 = KALSA_GEMM_READ_B(src1, gy*2+1 + (ki+2) * n_4);
             dequantized_weights.s0 = ((bits4.s0 & 0x0F00) >> 8) * scale.s0 - mval.s0;
             dequantized_weights.s1 = ((bits4.s1 & 0x0F00) >> 8) * scale.s1 - mval.s1;
             dequantized_weights.s2 = ((bits4.s2 & 0x0F00) >> 8) * scale.s2 - mval.s2;
@@ -129,8 +137,8 @@ kernel void kernel_gemm_noshuffle_q4_k_f32(
             c3 += convert_float8(B) * (float)dequantized_weights.s3;
 
             // j=3
-            B.s0123 = read_imageh(src1, gy*2   + (ki+3) * n_4);
-            B.s4567 = read_imageh(src1, gy*2+1 + (ki+3) * n_4);
+            B.s0123 = KALSA_GEMM_READ_B(src1, gy*2   + (ki+3) * n_4);
+            B.s4567 = KALSA_GEMM_READ_B(src1, gy*2+1 + (ki+3) * n_4);
             dequantized_weights.s0 = ((bits4.s0 & 0xF000) >> 12) * scale.s0 - mval.s0;
             dequantized_weights.s1 = ((bits4.s1 & 0xF000) >> 12) * scale.s1 - mval.s1;
             dequantized_weights.s2 = ((bits4.s2 & 0xF000) >> 12) * scale.s2 - mval.s2;
diff --git a/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl b/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl
index 8ec34883e..2f499353a 100644
--- a/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl
+++ b/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl
@@ -8,6 +8,14 @@
 #define REQD_SUBGROUP_SIZE_64  __attribute__((qcom_reqd_sub_group_size("half")))
 #endif
 
+#ifdef KALSA_GEMM_B_FLOAT
+#define KALSA_GEMM_B_TYPE float8
+#define KALSA_GEMM_READ_B(img, idx) read_imagef(img, idx)
+#else
+#define KALSA_GEMM_B_TYPE half8
+#define KALSA_GEMM_READ_B(img, idx) read_imageh(img, idx)
+#endif
+
 #ifdef ADRENO_GPU
 REQD_SUBGROUP_SIZE_128
 #endif
@@ -39,7 +47,7 @@ kernel void kernel_gemm_noshuffle_q6_K_f32(
     // The accumulator must be float too, else the f32 product rounds back to half on every +=.
     // The q6_K fidelity gain and speed cost are NOT measured for this kernel.
     float8 c0 = 0, c1 = 0, c2 = 0, c3 = 0;
-    half8 B;
+    KALSA_GEMM_B_TYPE B;
     half4 dequantized_weights;
 
     global const ushort * ptr_ql = src0_ql + gx_2;
@@ -60,8 +68,8 @@ kernel void kernel_gemm_noshuffle_q6_K_f32(
 
         // j=0
         // load 2x 4 elements of activations on N, corresponding to 8 rows on N
-        B.s0123 = read_imageh(src1, gy*2 + (i + 0)*n_4 + 0);
-        B.s4567 = read_imageh(src1, gy*2 + (i + 0)*n_4 + 1);
+        B.s0123 = KALSA_GEMM_READ_B(src1, gy*2 + (i + 0)*n_4 + 0);
+        B.s4567 = KALSA_GEMM_READ_B(src1, gy*2 + (i + 0)*n_4 + 1);
         dequantized_weights.s0 = (convert_half((bits4.s0 & 0x000F) | ((bits2.s0 & 0x03) << 4)) - 32.f) * scale_s.s0 * scale_d.s0;
         dequantized_weights.s1 = (convert_half((bits4.s1 & 0x000F) | ((bits2.s1 & 0x03) << 4)) - 32.f) * scale_s.s1 * scale_d.s1;
         dequantized_weights.s2 = (convert_half((bits4.s2 & 0x000F) | ((bits2.s2 & 0x03) << 4)) - 32.f) * scale_s.s2 * scale_d.s2;
@@ -72,8 +80,8 @@ kernel void kernel_gemm_noshuffle_q6_K_f32(
         c3 += convert_float8(B) * (float)dequantized_weights.s3;
 
         // j=1
-        B.s0123 = read_imageh(src1, gy*2 + (i + 1)*n_4 + 0);
-        B.s4567 = read_imageh(src1, gy*2 + (i + 1)*n_4 + 1);
+        B.s0123 = KALSA_GEMM_READ_B(src1, gy*2 + (i + 1)*n_4 + 0);
+        B.s4567 = KALSA_GEMM_READ_B(src1, gy*2 + (i + 1)*n_4 + 1);
         dequantized_weights.s0 = (convert_half((((bits4.s0 & 0x00F0) >> 4) | ((bits2.s0 & 0x0C) << 2))) - 32.f) * scale_s.s0 * scale_d.s0;
         dequantized_weights.s1 = (convert_half((((bits4.s1 & 0x00F0) >> 4) | ((bits2.s1 & 0x0C) << 2))) - 32.f) * scale_s.s1 * scale_d.s1;
         dequantized_weights.s2 = (convert_half((((bits4.s2 & 0x00F0) >> 4) | ((bits2.s2 & 0x0C) << 2))) - 32.f) * scale_s.s2 * scale_d.s2;
@@ -84,8 +92,8 @@ kernel void kernel_gemm_noshuffle_q6_K_f32(
         c3 += convert_float8(B) * (float)dequantized_weights.s3;
 
         // j=2
-        B.s0123 = read_imageh(src1, gy*2 + (i + 2)*n_4 + 0);
-        B.s4567 = read_imageh(src1, gy*2 + (i + 2)*n_4 + 1);
+        B.s0123 = KALSA_GEMM_READ_B(src1, gy*2 + (i + 2)*n_4 + 0);
+        B.s4567 = KALSA_GEMM_READ_B(src1, gy*2 + (i + 2)*n_4 + 1);
         dequantized_weights.s0 = (convert_half((((bits4.s0 & 0x0F00) >> 8) | (bits2.s0 & 0x30))) - 32.f) * scale_s.s0 * scale_d.s0;
         dequantized_weights.s1 = (convert_half((((bits4.s1 & 0x0F00) >> 8) | (bits2.s1 & 0x30))) - 32.f) * scale_s.s1 * scale_d.s1;
         dequantized_weights.s2 = (convert_half((((bits4.s2 & 0x0F00) >> 8) | (bits2.s2 & 0x30))) - 32.f) * scale_s.s2 * scale_d.s2;
@@ -96,8 +104,8 @@ kernel void kernel_gemm_noshuffle_q6_K_f32(
         c3 += convert_float8(B) * (float)dequantized_weights.s3;
 
         // j=3
-        B.s0123 = read_imageh(src1, gy*2 + (i + 3)*n_4 + 0);
-        B.s4567 = read_imageh(src1, gy*2 + (i + 3)*n_4 + 1);
+        B.s0123 = KALSA_GEMM_READ_B(src1, gy*2 + (i + 3)*n_4 + 0);
+        B.s4567 = KALSA_GEMM_READ_B(src1, gy*2 + (i + 3)*n_4 + 1);
         dequantized_weights.s0 = (convert_half((((bits4.s0 & mask_f000) >> 12) | ((bits2.s0 & mask_c0) >> 2))) - 32.f) * scale_s.s0 * scale_d.s0;
         dequantized_weights.s1 = (convert_half((((bits4.s1 & mask_f000) >> 12) | ((bits2.s1 & mask_c0) >> 2))) - 32.f) * scale_s.s1 * scale_d.s1;
         dequantized_weights.s2 = (convert_half((((bits4.s2 & mask_f000) >> 12) | ((bits2.s2 & mask_c0) >> 2))) - 32.f) * scale_s.s2 * scale_d.s2;
diff --git a/ggml/src/ggml-opencl/kernels/transpose.cl b/ggml/src/ggml-opencl/kernels/transpose.cl
index ad89bdcbd..5b9396b79 100644
--- a/ggml/src/ggml-opencl/kernels/transpose.cl
+++ b/ggml/src/ggml-opencl/kernels/transpose.cl
@@ -141,3 +141,33 @@ kernel void kernel_transpose_32_16(__read_only image1d_buffer_t input, __write_o
     write_imageh(output, (i_2+2)*padded_rows+j, (half4)(temp0.s2, temp1.s2, temp2.s2, temp3.s2));
     write_imageh(output, (i_2+3)*padded_rows+j, (half4)(temp0.s3, temp1.s3, temp2.s3, temp3.s3));
 }
+
+kernel void kernel_transpose_32_32(__read_only image1d_buffer_t input, __write_only image1d_buffer_t output, const uint rows, const uint cols, const uint padded_rows) {
+
+    const int i = get_global_id(0);
+    const int j = get_global_id(1);
+    const int i_2 = i<<2;
+    const int j_2 = j<<2;
+    float4 temp0 = {0,0,0,0};
+    float4 temp1 = {0,0,0,0};
+    float4 temp2 = {0,0,0,0};
+    float4 temp3 = {0,0,0,0};
+
+    if((j_2+0)*cols+i*4+3 < rows*cols*16){
+        temp0 = read_imagef(input, (j_2+0)*cols+i);
+    }
+    if((j_2+1)*cols+i*4+3 < rows*cols*16){
+        temp1 = read_imagef(input, (j_2+1)*cols+i);
+    }
+    if((j_2+2)*cols+i*4+3 < rows*cols*16){
+        temp2 = read_imagef(input, (j_2+2)*cols+i);
+    }
+    if((j_2+3)*cols+i*4+3 < rows*cols*16){
+        temp3 = read_imagef(input, (j_2+3)*cols+i);
+    }
+
+    write_imagef(output, (i_2+0)*padded_rows+j, (float4)(temp0.s0, temp1.s0, temp2.s0, temp3.s0));
+    write_imagef(output, (i_2+1)*padded_rows+j, (float4)(temp0.s1, temp1.s1, temp2.s1, temp3.s1));
+    write_imagef(output, (i_2+2)*padded_rows+j, (float4)(temp0.s2, temp1.s2, temp2.s2, temp3.s2));
+    write_imagef(output, (i_2+3)*padded_rows+j, (float4)(temp0.s3, temp1.s3, temp2.s3, temp3.s3));
+}
```
