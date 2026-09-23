# REPORT - opencl-q6k-f32-product: give the Q6_K batch GEMM the f32-product fix

Coder task, engine only (one OpenCL kernel). No push, no tag, no release, never upstream.
No phone, no device contact, no build on this host beyond the syntax gate of section 4.

Trees:

- Base: protected local ref `kalsa-gpu-opencl-v73` = `1068eb03d` (`1068eb03d301a1dcb657f4e6923fe77678e651ee`).
- Worktree: `/Users/marco/Projects/kalsallama-wt-q6k`, **detached** at `1068eb03d` (the shared
  checkout `/Users/marco/Projects/kalsallama` was left untouched; its dirty files belong to
  another session and are still exactly as found).
- Commit: **`914b34a7ea0b4fb6a86c30c491f723d08cebc8c6`**, parent **`1068eb03d301a1dcb657f4e6923fe77678e651ee`**,
  on local branch `kalsa-opencl-q6k-f32-product`. One file changed, 20 insertions, 17 deletions.
  NOT pushed.
- Input: the recon at `scratchpad/agents/gpu-numerics-fix-recon/REPORT.md` (read first, as ordered).

Scope discipline: exactly one kernel, `kernel_gemm_noshuffle_q6_K_f32` inside
`kernels/gemm_noshuffle_q6_k_f32.cl`. The `_cok` sibling in the SAME file, the three q4_K
siblings, the seven other half-product noshuffle files, and the MoE family were NOT touched -
see section 6 for the follow-up list. One kernel, one diff, one attribution.

---

## 1. Before-source: where the q6_K kernel multiplied in half

All line numbers are in `ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl` at the base
tree `1068eb03d` (identical to the pristine worktree before the edit).

Accumulator and operand declarations, inside `kernel_gemm_noshuffle_q6_K_f32` (kernel starts
line 14):

```c
// :38-40
half8 c0 = 0, c1 = 0, c2 = 0, c3 = 0;
half8 B;
half4 dequantized_weights;
```

The multiply/accumulate. There are FOUR blocks (j=0..3), each with the same four-line
`cN += B * dequantized_weights.sN;` shape, all in half arithmetic:

- `:66-69` (after dequant block j=0)
- `:78-81` (j=1)
- `:90-93` (j=2)
- `:102-105` (j=3)

```c
// :66-69
c0 += B * dequantized_weights.s0;
c1 += B * dequantized_weights.s1;
c2 += B * dequantized_weights.s2;
c3 += B * dequantized_weights.s3;
```

Mechanics of the half product, for the record:

- `B` is the activation operand, `half8`, read from the f16-narrowed image with `read_imageh`
  (`:60-61, :72-73, :84-85, :96-97`). The narrowing to f16 happens earlier in the shared
  `kernel_transpose_32_16` (`transpose.cl:113` "// converts to FP16") - the recon section 4;
  this fix does NOT change it, exactly as `67c73d26c` did not change it for q4_K.
- `dequantized_weights` is `half4`, computed in half (`:62-65` etc.).
- So `B * dequantized_weights.sN` is a half x half = half product, accumulated into a
  `half8` accumulator: every multiply AND every add rounds to fp16.

Not touched, verified after the edit (post-edit line numbers):

- `kernel_gemm_noshuffle_q6_K_f32_cok` (starts `:155`): `half8 acc = 0;` at `:185`,
  `acc += B * dq;` at `:206, :212, :218, :224` - still half, deliberately. It only serves
  ne1 <= 8 and only when `GGML_OPENCL_Q6K_GEMM_COK=1` (default OFF, `ggml-opencl.cpp:23189-23190`),
  so it cannot run in the 256-token protocol; changing it would mix two questions.
- `gemm_noshuffle_q6_k_f32_tiled.cl` is a different file and is natively f32 already; it is
  unreachable on A7X anyway (recon 1.2). Not touched.

---

## 2. The exact change

Commit `914b34a7e`, diff vs parent `1068eb03d`, one file
`ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl`, 20 insertions / 17 deletions:

```diff
diff --git a/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl b/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl
index 141f6a2f6..8ec34883e 100644
--- a/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl
+++ b/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl
@@ -35,7 +35,10 @@ kernel void kernel_gemm_noshuffle_q6_K_f32(
     int gx = get_global_id(1); // m
     int gx_2 = gx << 2;
 
-    half8 c0 = 0, c1 = 0, c2 = 0, c3 = 0;
+    // Mirrors the q4_0/q4_K fix: the half PRODUCT, not the accumulator, causes divergence.
+    // The accumulator must be float too, else the f32 product rounds back to half on every +=.
+    // The q6_K fidelity gain and speed cost are NOT measured for this kernel.
+    float8 c0 = 0, c1 = 0, c2 = 0, c3 = 0;
     half8 B;
     half4 dequantized_weights;
 
@@ -63,10 +66,10 @@ kernel void kernel_gemm_noshuffle_q6_K_f32(
         dequantized_weights.s1 = (convert_half((bits4.s1 & 0x000F) | ((bits2.s1 & 0x03) << 4)) - 32.f) * scale_s.s1 * scale_d.s1;
         dequantized_weights.s2 = (convert_half((bits4.s2 & 0x000F) | ((bits2.s2 & 0x03) << 4)) - 32.f) * scale_s.s2 * scale_d.s2;
         dequantized_weights.s3 = (convert_half((bits4.s3 & 0x000F) | ((bits2.s3 & 0x03) << 4)) - 32.f) * scale_s.s3 * scale_d.s3;
-        c0 += B * dequantized_weights.s0;
-        c1 += B * dequantized_weights.s1;
-        c2 += B * dequantized_weights.s2;
-        c3 += B * dequantized_weights.s3;
+        c0 += convert_float8(B) * (float)dequantized_weights.s0;
+        c1 += convert_float8(B) * (float)dequantized_weights.s1;
+        c2 += convert_float8(B) * (float)dequantized_weights.s2;
+        c3 += convert_float8(B) * (float)dequantized_weights.s3;
 
         // j=1
         B.s0123 = read_imageh(src1, gy*2 + (i + 1)*n_4 + 0);
@@ -75,10 +78,10 @@ kernel void kernel_gemm_noshuffle_q6_K_f32(
         dequantized_weights.s1 = (convert_half((((bits4.s1 & 0x00F0) >> 4) | ((bits2.s1 & 0x0C) << 2))) - 32.f) * scale_s.s1 * scale_d.s1;
         dequantized_weights.s2 = (convert_half((((bits4.s2 & 0x00F0) >> 4) | ((bits2.s2 & 0x0C) << 2))) - 32.f) * scale_s.s2 * scale_d.s2;
         dequantized_weights.s3 = (convert_half((((bits4.s3 & 0x00F0) >> 4) | ((bits2.s3 & 0x0C) << 2))) - 32.f) * scale_s.s3 * scale_d.s3;
-        c0 += B * dequantized_weights.s0;
-        c1 += B * dequantized_weights.s1;
-        c2 += B * dequantized_weights.s2;
-        c3 += B * dequantized_weights.s3;
+        c0 += convert_float8(B) * (float)dequantized_weights.s0;
+        c1 += convert_float8(B) * (float)dequantized_weights.s1;
+        c2 += convert_float8(B) * (float)dequantized_weights.s2;
+        c3 += convert_float8(B) * (float)dequantized_weights.s3;
 
         // j=2
         B.s0123 = read_imageh(src1, gy*2 + (i + 2)*n_4 + 0);
@@ -87,10 +90,10 @@ kernel void kernel_gemm_noshuffle_q6_K_f32(
         dequantized_weights.s1 = (convert_half((((bits4.s1 & 0x0F00) >> 8) | (bits2.s1 & 0x30))) - 32.f) * scale_s.s1 * scale_d.s1;
         dequantized_weights.s2 = (convert_half((((bits4.s2 & 0x0F00) >> 8) | (bits2.s2 & 0x30))) - 32.f) * scale_s.s2 * scale_d.s2;
         dequantized_weights.s3 = (convert_half((((bits4.s3 & 0x0F00) >> 8) | (bits2.s3 & 0x30))) - 32.f) * scale_s.s3 * scale_d.s3;
-        c0 += B * dequantized_weights.s0;
-        c1 += B * dequantized_weights.s1;
-        c2 += B * dequantized_weights.s2;
-        c3 += B * dequantized_weights.s3;
+        c0 += convert_float8(B) * (float)dequantized_weights.s0;
+        c1 += convert_float8(B) * (float)dequantized_weights.s1;
+        c2 += convert_float8(B) * (float)dequantized_weights.s2;
+        c3 += convert_float8(B) * (float)dequantized_weights.s3;
 
         // j=3
         B.s0123 = read_imageh(src1, gy*2 + (i + 3)*n_4 + 0);
@@ -99,10 +102,10 @@ kernel void kernel_gemm_noshuffle_q6_K_f32(
         dequantized_weights.s1 = (convert_half((((bits4.s1 & mask_f000) >> 12) | ((bits2.s1 & mask_c0) >> 2))) - 32.f) * scale_s.s1 * scale_d.s1;
         dequantized_weights.s2 = (convert_half((((bits4.s2 & mask_f000) >> 12) | ((bits2.s2 & mask_c0) >> 2))) - 32.f) * scale_s.s2 * scale_d.s2;
         dequantized_weights.s3 = (convert_half((((bits4.s3 & mask_f000) >> 12) | ((bits2.s3 & mask_c0) >> 2))) - 32.f) * scale_s.s3 * scale_d.s3;
-        c0 += B * dequantized_weights.s0;
-        c1 += B * dequantized_weights.s1;
-        c2 += B * dequantized_weights.s2;
-        c3 += B * dequantized_weights.s3;
+        c0 += convert_float8(B) * (float)dequantized_weights.s0;
+        c1 += convert_float8(B) * (float)dequantized_weights.s1;
+        c2 += convert_float8(B) * (float)dequantized_weights.s2;
+        c3 += convert_float8(B) * (float)dequantized_weights.s3;
     }
 
     int idx = (gy<<3)*m + (gx<<2);
```

Post-edit grep proof of scope: `convert_float8(B)` appears 16x in the file (all 16 product
lines of the main kernel), `+= B *` remains 4x - only in the untouched `_cok` sibling
(`:206-224`). `git status` in the worktree: only this one file modified. The store block
(`vstore4((float4)(c0.sN, ...)` `:111-140` post-edit) needed no change: it already reads
`.sN` lanes into a `float4`, and a `float8` lane widens to `float` implicitly, same as the
q4_K fixed kernel's store block, which `67c73d26c` also left untouched.

---

## 3. The q4_K reference mirrored, and why the accumulator also becomes float

The reference is commit `67c73d26c` ("opencl: compute the Adreno q4_K GEMM product in f32",
diff reviewed in full). What it does to `gemm_noshuffle_q4_k_f32.cl`:

1. Accumulator hunk (its diff `@@ -51,7 +51,11`):
   `half8 c0 = 0, c1 = 0, c2 = 0, c3 = 0;` -> `float8 c0 = 0, c1 = 0, c2 = 0, c3 = 0;`
   plus a 4-line comment stating the half PRODUCT is what diverges, that a float accumulator
   ALONE was measured not to fix it, and that q4_K fidelity/cost are not to be inferred from
   q4_0.
2. Four product hunks: `cN += B * dequantized_weights.sN;` ->
   `cN += convert_float8(B) * (float)dequantized_weights.sN;` (16 lines total).
3. It does NOT touch: `half8 B;` (the f16 activation operand stays), `half4
   dequantized_weights;` (dequant stays half, only cast at the product site), the
   `read_imageh` loads, the transpose kernel, or the `vstore4` store block.

Those reference lines in the current tree: `gemm_noshuffle_q4_k_f32.cl:61` `float8 c0 = 0,
c1 = 0, c2 = 0, c3 = 0;`, `:62` `half8 B;`, `:102-105 / :114-117 / :126-129 / :138-141` the
16 `convert_float8(B) * (float)dequantized_weights.sN` lines.

**Accumulator decision: `half8` MUST become `float8`, and this is what the fixed kernel
actually does.** Justification, from the q4_K diff and the archive, not from taste:

- The q4_K fix changed BOTH the accumulator (hunk 1) and the product (hunks 2-4). The
  archive's q4_0 verdict ("the half PRODUCT, not the accumulator, is what diverges" - cell
  `adreno-acc-type`: `stock:acc` with a float accumulator but half product gave KLD
  0.460999, i.e. no improvement; `stock:mul` gave 0.004736) explains why the product change
  is the active ingredient - but it does NOT license leaving the accumulator in half.
- Mechanism: with a `half8` accumulator, `c0 += (float8 product)` converts the f32 sum right
  back to fp16 on every one of the k/4 iterations, so the f32 product's extra precision is
  thrown away at each step anyway - the fix would be nullified by the accumulator. The
  reference kernel's own comment says a float accumulator alone does not fix the problem;
  symmetrically, the product fix needs the float accumulator to have anything to accumulate
  into. `67c73d26c` ships them together, and `513bf4cea` (q4_0) does the same
  (`float8 c0..c3` there too, zero `half8` accumulator declarations left in
  `gemm_noshuffle_q4_0_f32.cl`).
- So mirroring the reference means mirroring both hunks: `float8 c0..c3` + the 16
  `convert_float8(B) * (float)` product lines, while keeping `half8 B` and `half4
  dequantized_weights` exactly as the reference keeps them. That is precisely the diff in
  section 2. What we do NOT extrapolate from q4_0 to q6_K is any MEASURED number: the
  comment in the kernel text says the q6_K gain and cost are unmeasured, same discipline as
  the q4_K comment.

---

## 4. The compile actually run

Syntax gate only, using the NDK clang - the same gate the archive pre-registered for kernel
edits (`adreno-acc-type/PREREG.md:128-129`, `gemm-f32-ship/AUDIT.md:17`). Exact command,
run from the worktree root `/Users/marco/Projects/kalsallama-wt-q6k`:

```
/opt/homebrew/share/android-ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang \
    -x cl -cl-std=CL1.2 -Xclang -finclude-default-header -target spirv64 \
    -fsyntax-only ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl
```

Results:

- BEFORE the edit (pristine `1068eb03d` worktree): **exit code 0**. One warning:
  `cl_qcom_reqd_sub_group_size unknown or does not require pragma - ignoring
  [-Wignored-pragmas]` - present in the stock file, not introduced by the change.
- AFTER the edit (committed `914b34a7e`): **exit code 0**, same single warning, no errors.
- Control, to show the gate is real: the unmodified q4_K file under the Apple system clang
  WITHOUT the default header fails (exit 1, `use of undeclared identifier 'half8'`) - the
  NDK clang with `-finclude-default-header` is the correct tool, and it accepts our file.

Stated plainly: **the Android/Adreno build has NOT been done.** No `ninja`, no
`llama-perplexity`, no APK, no clang E031.41 kernel compile, no device run in this task.
**The link cannot be done on this macOS host either**: building the OpenCL host code here
would fail at link because Apple's OpenCL.framework does not export the CL2.0/CL3.0 symbols
referenced by the unmodified engine code (`ggml-opencl.cpp` and its cache/helpers) - that
limitation is a property of the untouched code, not of this diff. The only claim this report
makes about compilability is: this one `.cl` file passes OpenCL C 1.2 syntax checking with
the NDK clang, rc=0, before and after the edit.

---

## 5. Expected speed cost, with the precedent numbers

What exists in the archive:

- **q4_0 f32-product fix: 0.663x** - cell `adreno-acc-type` (QRD8650 / Adreno 750):
  `stock:mul` ran 189.73 t/s vs 286.30 t/s of the same batch = **0.663x**, or **0.654x**
  vs the pre-registered 289.98 +/- 1.28 (`adreno-acc-type/REPORT.md:75`,
  `AUDIT.md:109`). The number that circulated later, **0.659x** (190.25 vs 288.62 t/s,
  `archive-gpu-docs/REPORT.md:137`), carries a recorded validity caveat: it "failed its own
  validity gate (5.71 C spread)" (`QDC-GPU-GOVERNOR-MAP-2026-09-16.md:322`); all of these
  were taken sequentially on a board that was heating, so they are INDICATIVE, not
  established (`adreno-acc-type/REPORT.md` speed section; `adreno-operand-b/REPORT.md:53`).
- **q4_K figure: it does not exist.** No speed measurement of the q4_K f32-product kernel
  was ever taken. The commit says it: `67c73d26c` "Fidelity and cost are unmeasured for this
  kernel"; `commit-map-engine/REPORT.md:375` "Never measured"; `gemm-f32-ship/PLAN.md:169`
  "neither the fidelity gain nor the 0.659x cost is known for q4_K". The `gemm-f32-ship`
  speed table (4.105 s -> 6.119 s GPU prefill, ratio falling 1.78x -> 1.242x) is NOT a q4_K
  number despite the APK pin carrying `67c73d26c`: that cell ran
  `LFM2.5-2.6B-QAD-Q4_0`, i.e. the q4_0 kernel (`gemm-f32-ship/REPORT.md:4-5`). So the
  search for a q4_K figure ends at "none exists".

My expectation for this q6_K diff, stated as expectation only:

- Same edit shape as both precedents (f32 product, float accumulator, f16 operand kept), same
  Adreno fp16-vs-fp32 ALU trade, so the KERNEL-level cost should land in the same class:
  roughly **0.65-0.67x of the q6_K GEMM's own throughput**. The 0.50x floor from
  `adreno-operand-b` did not materialize for the product-only change there, and nothing in
  this diff doubles a memory leg (activations still arrive as the same f16 image), so a
  sub-0.5x cliff is not expected.
- MODEL-level cost for the Q4_K_M prefill is smaller than that: only 19 of 266 tensors
  route through this kernel (14 ffn_down + 5 attn_v; the tied Q6_K lm_head falls back to CPU
  on A7X), the 148 Q4_K tensors already pay their own (itself unmeasured) `67c73d26c` cost
  in both arms of any A/B, and decode never touches this kernel (ne1==1 takes the GEMV
  path). So the marginal, attributable-to-this-commit prefill slowdown is a fraction of
  0.66x, weighted by the q6_K share of GPU prefill time - which nobody has measured either.
- Confidence language: LOW-MED. The precedents are 1-board, thermally confounded, Adreno
  750 numbers applied by resemblance to a 740; the q4_K figure that would have been the
  closest sibling does not exist. Do not treat any of these numbers as a gate; measure it in
  the same phone session that measures the KLD.

---

## 6. Follow-up list: kernels still multiplying in half (NOT touched in this pass)

Verified by grep on the worktree at commit `914b34a7e` (= `1068eb03d` + this one commit),
files under `ggml/src/ggml-opencl/kernels/`. Nothing in this section was modified; it is the
queue for later passes, one kernel per future pass so each phone measurement keeps a single
attribution.

### 6.1 Still half-product after this commit

| kernel (file / sub-kernel) | half product at | reachable for a Q4_K_M prefill on A7X? |
|---|---|---|
| `gemm_noshuffle_q4_k_f32.cl` `_r1` | `half8 c0` `:211`, `c0 += B * dq` `:243-258` | only ne1 <= 8 AND `GGML_OPENCL_Q4K_GEMM_R1` set (env, default unset) - not reachable by default |
| `gemm_noshuffle_q4_k_f32.cl` `_kimg` | `half8 c0` `:309`, `:345-369` | only ne1 <= 8 AND `GGML_OPENCL_Q4K_GEMM_KIMG` set (default unset) - not reachable by default |
| `gemm_noshuffle_q4_k_f32.cl` `_cok` | `half8 acc` `:428`, `acc += B * dq` `:453-468` | **YES, conditionally**: ne1 <= 8, DEFAULT ON (`ggml-opencl.cpp:22787-22788`). A <=8-token streaming prefill hits it. Not hit by the 256-token protocol (ne1=256) |
| `gemm_noshuffle_q6_k_f32.cl` `_cok` (left alone by this commit) | `half8 acc` `:185`, `acc += B * dq` `:206-224` | only ne1 <= 8 AND `GGML_OPENCL_Q6K_GEMM_COK=1` (default OFF, `:23189-23190`) - not reachable by default |
| `gemm_noshuffle_q5_k_f32.cl` | `:55` decl, `:100` products (whole file) | NO for this model - Q4_K_M has no Q5_K tensors. Only a Q5_K_M-class model reaches it |
| `gemm_noshuffle_q4_1_f32.cl` | `:35` / `:57` (whole file) | NO for this model (no Q4_1 tensors) |
| `gemm_noshuffle_q5_0_f32.cl` | `:32` / `:56` | NO (no Q5_0 tensors) |
| `gemm_noshuffle_q5_1_f32.cl` | `:33` / `:59` | NO (no Q5_1 tensors) |
| `gemm_noshuffle_q8_0_f32.cl` | `:35` / `:57` | NO (no Q8_0 tensors) |
| `gemm_noshuffle_iq4_nl_f32.cl` | `:55` / `:75` | NO (no IQ4_NL tensors) |
| `gemm_noshuffle_q1_0_f32.cl` | `:32` / `:54` | NO (no Q1_0 tensors) |
| all `gemm_moe_*_ns.cl` - I count **11** files (mxfp4, q2_k, q3_k, q4_0, q4_1, q4_k, q5_0, q5_1, q5_k, q6_k, q8_0); the recon said "ten" | half8 accumulators fed by half `dot()` products, e.g. `gemm_moe_q4_k_f32_ns.cl:277` `half8 acc8` + `:130-145` | NO, doubly: the shipped model is dense (`n_expert = 0`) AND `use_adreno_moe_kernels` returns false for A6X/A7X/UNKNOWN (`ggml-opencl.cpp:9044-9052`) |

Count reconciliation with the task brief: the recon's "8 other gemm_noshuffle_*" not-received
list was q6_K + 7 whole files (q5_k, q4_1, q5_0, q5_1, q8_0, iq4_nl, q1_0). This commit
fixes the q6_K entry, so **7 whole files remain**, plus the two partial leftovers inside
already-fixed files (q4_K's three siblings, q6_K's `_cok`), plus the MoE family. Everything
with "YES, conditionally" above is the only still-half code a Q4_K_M prefill on A7X can
reach, and only if the chunk size drops to <= 8 tokens.

### 6.2 Explicitly NOT follow-ups

- `gemm_noshuffle_q6_k_f32_tiled.cl`: natively f32 (`:116-119`), unreachable on A7X - fine.
- `*_q8_1_dp4a.cl` variants: integer dot-product path, not a half-product question; the
  q6_K one has no dispatch site at all (dead code, recon 1.4).
- `kernel_transpose_32_16` f16 narrowing: out of scope by design - `adreno-operand-b`
  measured keeping it f32 at 0.509x throughput for NO KLD gain on the only path it was
  measured on, and `67c73d26c` kept it too. This commit keeps the identical f16 operand,
  which is also what makes the A/B in the next phone session attributable to the product
  alone.

### 6.3 What this commit does NOT establish

Compile-verified only. No Android/Adreno build, no link on this host (Apple OpenCL lacks the
CL2.0/3.0 symbols the unmodified code references), no device run, no KLD, no speed number.
Whether the q6_K half product was sufficient to produce the measured 0.394993 / 63.892%
failure is exactly what the next phone A/B must decide (recon section 5); this diff makes
that experiment possible and nothing more.
