# AUDIT - opencl-q6k-f32-product: the Q6_K f32-product kernel fix, pre-measurement review

Reviewer: independent, read-only. Nothing outside this report was modified; no build artifacts
were produced in either tree; the only commands run were git inspection, source greps, the NDK
clang syntax gate reproduced into /tmp, and an Apple SDK symbol diff.

Subject: commit `914b34a7ea0b4fb6a86c30c491f723d08cebc8c6` ("opencl: compute the Adreno q6_K
GEMM product in f32"), parent `1068eb03d301a1dcb657f4e6923fe77678e651ee`, ref
`kalsa-opencl-q6k-f32-product`, worktree `/Users/marco/Projects/kalsallama-wt-q6k` (clean,
detached at the commit). One file: `ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl`,
20 insertions / 17 deletions.

## OPEN VERDICT

May this be built into an Android binary and measured on the phone as it stands? **Yes.** The
audit found no blocker: the scope is exactly the one kernel claimed, every arithmetic operation
on the accumulation path of `kernel_gemm_noshuffle_q6_K_f32` was walked and no half product
survives anywhere on it, no promotion changes semantics (no dropped scale, no operand-order
change), the store block is type-agnostic and correct for the float8 accumulator, and the
dispatch analysis independently confirms this kernel is the deterministic selection for all
GPU-routed Q6_K tensors of the Q4_K_M model at batch 256 on an A7X. The syntax gate is real and
reproduces (rc=0, verified here, with a negative control that fails as expected). What could
invalidate the measurement: (1) the file has NEVER been compiled by the Qualcomm E031.x
compiler - clang says nothing about whether the Adreno compiler accepts it or generates correct
code, and that compiler family has documented miscompiles in neighboring kernels - though an
on-device compile failure would be loud (program-build failure at init, assert via CL_CHECK, or
a CPU-fallback timing/KLD signature), not a silent wrong number; (2) the fidelity magnitude on
q6_K is unmeasured, so "KLD stays ~0.395" would not falsify the diff, it would only show the
half product was not sufficient (the recon's candidate table anticipates exactly this); (3) the
float8 accumulator doubles accumulator registers per work item - the speed cost could exceed
the 0.66x class precedent, so measure speed in the same session and do not gate the build on
it; (4) attribution is clean only under default env - it is, everything that could route around
this kernel (q6_K cok, r1, kimg, tiled, mc3, moe, dp4a) is default-OFF on A7X.

Item verdicts: 1 SCOPE CONFIRMED; 2 SEMANTICS CONFIRMED; 3 ACCUMULATOR CONFIRMED (change) /
PARTIAL (one sentence of the justification overstates what was measured); 4 REFERENCE
CONFIRMED; 5 REACHABILITY CONFIRMED (one counting slip flagged, nothing missed); 6 EVIDENCE
CONFIRMED for what is verifiable; the rest is stated unproven.

---

## 1. SCOPE - CONFIRMED

- `git diff --name-status 1068eb03d..914b34a7e` = exactly one file,
  `ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl`. `--stat`: 1 file changed,
  20 insertions(+), 17 deletions(-), as claimed. The arithmetic checks: 3 added comment lines +
  1 replaced accumulator line + 16 replaced product lines = 20 additions; 1 + 16 = 17 deletions.
- Worktree state: `git status --porcelain` is EMPTY and HEAD is detached at `914b34a7e`, so the
  committed diff and the working tree are byte-identical by construction. The ref
  `kalsa-opencl-q6k-f32-product` resolves to the commit; its parent resolves to `1068eb03d`.
- Only the intended lines: the five hunks are the accumulator declaration (old `:38`) and the
  four product blocks (old `:66-69`, `:78-81`, `:90-93`, `:102-105`), plus the comment. The
  second kernel in the file, `kernel_gemm_noshuffle_q6_K_f32_cok` (starts `:158` post-commit),
  is untouched - still `half8 acc = 0;` (`:185`) and `acc += B * dq;` (`:206, :212, :218,
  :224`) - which matches the commit message's stated scope.
- The shared checkout `/Users/marco/Projects/kalsallama` has dirty files, but those belong to
  another session/tree; the audited worktree is clean and the author's REPORT makes the same
  claim (`opencl-q6k-f32-product/REPORT.md:9-11`).

## 2. SEMANTICS - CONFIRMED (no half product survives on the accumulation path)

Full walk of `kernel_gemm_noshuffle_q6_K_f32` (file `kernels/gemm_noshuffle_q6_k_f32.cl`,
post-commit line numbers):

| operation | site | type now |
|---|---|---|
| activation load `read_imageh(src1, ...)` | `:63-64, :75-76, :87-88, :99-100` | half STORAGE only; f16-narrowed image, unchanged by design; widened by `convert_float8(B)` before use |
| dequant index `convert_half(qbits)` | `:65-68, :77-80, :89-92, :101-104` | exact (values 0..63 are exact in half); integer bit assembly is int arithmetic |
| dequant offset `- 32.f` | same lines | promotes the whole expression to FLOAT (`half - float` -> float) |
| dequant scales `* scale_s.sN * scale_d.sN` | same lines | float: `scale_s` is char4 (promoted int -> float), `scale_d` is half4 (promoted to float); result rounded to half ONCE at assignment to `dequantized_weights.sN` - operand storage, not a product; identical to the q4_K reference and shown irrelevant by the `deq` probe variant (0.004793 vs 0.004736, `adreno-acc-type/REPORT.md:25, 51-52`) |
| product `convert_float8(B) * (float)dequantized_weights.sN` | `:69-72, :81-84, :93-96, :105-108` | FLOAT: exact widenings on both operands, then float8 x float scalar broadcast multiply |
| accumulate `c0 += <float8>` | same lines | FLOAT: `c0..c3` are `float8` (`:41`); no rounding to fp16 anywhere in the sum |
| store `vstore4((float4)(c0.sN, c1.sN, c2.sN, c3.sN), ...)` | `:114-142` | unchanged; before, half lanes widened implicitly in the `float4` constructor, now the constructor is identity; `dst` is `global float *` |

There is no `fma`, `mad`, `dot`, or any other half-typed multiply anywhere in the main kernel;
the 16 product lines are the only multiply-accumulate sites. The one remaining fp16 rounding on
the path (the dequantized weight stored as half) is operand storage that the reference q4_K fix
kept and that the archive measured as immaterial; the other (B in f16) is the named residual
the recon section 4 documents, deliberately untouched so the A/B isolates the product.

Reverse risk - promotions that change semantics rather than precision: none found. No cast
drops a scale (both scale factors act inside the dequant expression before the half store,
exactly as before); operand order is unchanged and multiplication is commutative anyway;
`float8 c0 = 0` is a valid scalar vector-init; `+=` on a float8 lvalue is a float add. The only
behavioral change is the intended precision change.

The `_cok` sibling in the same file remains a fully half kernel (`:185`, `:206-224`) - out of
scope by design, and unreachable by default (section 5).

## 3. THE ACCUMULATOR - CONFIRMED as a change; the justification is PARTIAL (one sentence overstated)

- Store block: correct and unchanged, see section 2. No conversion or rounding hazard.
- Register pressure: the accumulators go from 16 to 32 32-bit registers per work item, plus an
  8-wide f32 temporary per product. This is plausible for the target: the IDENTICAL shape
  (float8 x4 accumulators + `REQD_SUBGROUP_SIZE_128` + same 4x8 tile) is the fixed q4_K main
  kernel, which demonstrably compiled AND executed on the target 740/E031.41 compiler in the
  failing measurement session (148 Q4_K tensors routed through it at `1068eb03d`; the run
  produced output, not a crash). q6_K adds only one extra `vload4` (the `qh` bits) per step.
  There are no OpenCL unroll pragmas and the manual j=0..3 unroll is type-agnostic, so no
  unrolled-loop breakage is possible from a type change. Caveat: this exact file has still never
  been seen by E031.x - the first phone build is the first real compile. Note also the probe's
  acc variant was SLOWER than mul (172.8 vs 189.7 t/s, `adreno-acc-type/REPORT.md:21, 23`), so
  the register effect is not purely theoretical.
- The author's justification: the mechanism they state is real C semantics - with a `half8`
  accumulator, `c0 += <float8>` converts the running sum back to fp16 on every `+=`
  (`gemm_noshuffle_q6_k_f32.cl:38-39` comment; REPORT section 3). The archive confirms the
  premise: acc-only (float8 accumulator, half product) measured KLD 0.460999 vs stock 0.453822
  vs mul 0.004736 (`adreno-acc-type/REPORT.md:19-23`, verified against
  `raw/sa812464/variants.tsv:3`) - the product is the active ingredient. HOWEVER: I checked the
  probe source (`7ef9389bc`, `gemm_noshuffle_q4_0_f32.cl` PREC variants) and EVERY non-stock
  variant already carried `KALSA_GEMM_ACC_TYPE float8` - PREC=1 (acc), 2 (mul) and 3 (deq) all
  set float8 accumulators. The cell (half accumulator + f32 product) was NEVER measured. So the
  author's strong phrasing - "the accumulator must be float too" / "the fix would be nullified
  by the accumulator" - is a sound extrapolation but not a measurement; and reading 2 of the
  same cell (float accumulator changed nothing in the half-product regime) weakly suggests the
  accumulator axis is second order, so "nullified" is unproven. The q4_K reference commit was
  more careful: its comment claims only the MEASURED fact ("A float accumulator alone was
  measured not to fix it"). Conclusion: mirroring `67c73d26c` (which ships accumulator +
  product together, as do `513bf4cea` and the probe's mul variant) is the right and faithful
  choice; only the rhetoric of necessity exceeds the evidence. This does not block anything.

## 4. THE REFERENCE - CONFIRMED, same shape hunk for hunk

Side-by-side of `67c73d26c` (q4_K) and `914b34a7e` (q6_K):

| aspect | 67c73d26c (q4_K) | 914b34a7e (q6_K) |
|---|---|---|
| accumulator hunk | `half8 c0..c3` -> `float8 c0..c3` + comment (@@ -51,7 +51,11) | same (@@ -35,7 +35,10; 3-line comment instead of 4) |
| product hunks | 4 hunks x 4 lines: `cN += B * dw.sN` -> `cN += convert_float8(B) * (float)dw.sN` (16 lines) | identical, 16 lines |
| left untouched | `half8 B`, `half4 dequantized_weights`, `read_imageh` loads, transpose, store block | identical |
| siblings left half | `_r1`, `_kimg`, `_cok` in the same file | `_cok` in the same file |

The only textual differences are the dequantization expressions themselves (q6_K: 4 source
buffers ql/qh/s/d, 6-bit values with a -32 offset, two-level char+half scales; q4_K: nibbles
with d/min scales) and the comment wording. Nothing in the q6_K structure required different
treatment for the main kernel: its dequant expression already promotes to f32 before the single
half store (via `- 32.f`), so widening the product and accumulator is exactly the same edit. No
place where q4_K shape was copied into a context needing something else was found.

## 5. REACHABILITY - CONFIRMED (one counting slip flagged; nothing missed)

Dispatch walk re-derived in the audited tree (`ggml/src/ggml-opencl/ggml-opencl.cpp`):

- A7X = 730/740/750 (`:299-304`). Entry gate `if (ne01 && ne1 && use_adreno_kernels(...))`
  (`:24173`); `use_adreno_kernels` needs weight ne0,ne1 >= 512 on E031.38+ and ne1 % 64 == 0
  for K-quants (`:9006-9028`). All 19 Q6_K weights pass (ne1 = 512 / 2048 / 128000).
- Q6_K x F32 -> `ggml_cl_mul_mat_q6_K_f32_adreno` (`:24229-24232`), guard
  `!use_flat_gemv_for_large_m_q6_K`: fires only if weight ne1 % 128 != 0 (or an env-gated size
  escape that A7X excludes) (`:9460-9478`) - false for all model weights.
- Inside: `ne1 == 1` / mc3 / tiled-mc GEMV branch (`:22928`) not taken at batch 256; `q6k_mc3`
  is env-gated default OFF (`GGML_OPENCL_Q6K_MC3`, `:22918`); tiled needs X2E/A8X default plus
  ne1 >= 32768 (`:9301-9303`, `:9322-9326`) - OFF on A7X; `_cok` needs
  `GGML_OPENCL_Q6K_GEMM_COK=1` AND ne1 <= 8 - DEFAULT OFF (`:23182-23190`). Selection at
  `:23191-23192`: `kernel_gemm_noshuffle_q6_K_f32`. CONFIRMED for batch 256 on A7X, matching
  the recon's citations (`gpu-numerics-fix-recon/REPORT.md` section 1.2).
- The author's leftover list, re-verified by grep over the committed tree:
  - q4_K `_cok`: default ON for ne1 <= 8 (`:22787-22788`) - CONFIRMED as the only
    default-reachable unfixed kernel in the GEMM family: any real-app prefill chunk of 2..8
    tokens routes Q4_K tensors to it while Q6_K tensors route to the NOW-FIXED main kernel.
  - q4_K `_r1` / `_kimg`: env-gated default OFF (`:22781-22782`). q6_K `_cok`: default OFF
    (`:23188-23190`). Not reachable by default.
  - 7 whole noshuffle files still half (q5_k, q4_1, q5_0, q5_1, q8_0, iq4_nl, q1_0 - verified
    by grep; Q4_K_M contains none of these types). q4_0 and q4_K main files carry the fix.
  - MoE: the author counts 11 `gemm_moe_*_ns.cl` files (mxfp4 + 10 quant types) - correct; the
    recon's "ten" missed `gemm_moe_mxfp4_f32_ns.cl`. Unreachable twice over: the model is dense
    and `use_adreno_moe_kernels` returns false on A6X/A7X/UNKNOWN (`:9044-9052`).
  - `gemm_noshuffle_q6_k_f32_tiled.cl` is natively f32 and unreachable on A7X; the `*_dp4a`
    variants are the integer-dot family, not this defect class.
  - Real-app sweep: chunks of 9..N tokens hit the fixed main kernels for both quant types;
    ne1 == 1 decode and (env-gated) ne1 == 3 verify hit the q6_K GEMV kernels
    (`:22936-22990`) - a different arithmetic family (f32, decode measured clean in the
    archive) that was never claimed fixed; on A7X the vocab-scale Q6_K lm_head is CPU-fallback
    by default anyway (`:9739-9748`). Nothing reachable was missed.
- Counting slip (cosmetic): the commit message says "Serves the 19 Q6_K tensors (14 ffn_down +
  5 attn_v)" and the REPORT's section 5 says "only 19 of 266 tensors route through this kernel
  (14 ffn_down + 5 attn_v; the tied Q6_K lm_head falls back to CPU on A7X)". 14 + 5 = 18: the
  model has 19 Q6_K tensors, of which 18 (14 ffn_down + 5 attn_v) route through this kernel;
  the 19th (token_embd, the tied lm_head, ne1 = 128000) runs on CPU. The fix covers 100% of the
  GPU-reachable Q6_K GEMMs either way, so no conclusion changes.

## 6. EVIDENCE STANDARD - CONFIRMED for what is verifiable; the rest stays unproven

Verified here, independently:

- The exact claimed NDK clang command (`/opt/homebrew/share/android-ndk/.../clang -x cl
  -cl-std=CL1.2 -Xclang -finclude-default-header -target spirv64 -fsyntax-only`) reproduces on
  the committed file: exit 0, single warning (`cl_qcom_reqd_sub_group_size` pragma ignored),
  matching the author's claim including the warning text. The PRE-fix file also passes (exit 0).
- Negative control (mine, not the author's): the same file with `convert_float8` corrupted to
  `convert_float9` produces 16 errors and exit 1 - the gate is real, not vacuous.
- The "no link possible on this macOS host" claim is correct in substance: the unmodified
  engine calls `clGetKernelSubGroupInfo` (CL 2.1) and `clCreateBufferWithProperties` (CL 3.0),
  neither of which exists in Apple's OpenCL 1.2 framework headers/runtime (symbol diff of the
  ggml-opencl sources against the CommandLineTools SDK OpenCL headers). Only
  `clEnqueueMarkerWithWaitList` (CL 1.2) was the near miss in a first narrow grep.

Unproven, stated plainly:

- NO Android/Adreno build was done and NO link was attempted, per the commit message and REPORT.
  The file has never been compiled by the Qualcomm E031.x OpenCL compiler; clang's frontend
  acceptance says nothing about E031.41's acceptance, register allocation, or codegen, and that
  compiler family has documented miscompiles in adjacent kernels (flat K-quant GEMV NMSE ~12 on
  740 driver 0676.73, `:9460-9462`; MoE trans4_ns on A7X, `:9044-9048`). A syntax check is not
  a compile; a compile would not be a measurement.
- Mitigating fact for the phone session: the kernel source is embedded and hash-keyed (source +
  opts + device + kset), so the device will compile THIS text fresh at init, and an on-device
  compile failure is loud - `kernel_build_failed` -> assert via CL_CHECK, or a full verdict fail
  -> CPU fallback, which the timing/KLD signature would expose - not a silent wrong number.
- No fidelity or speed number for q6_K exists on any device; the 95.8x precedent is q4_0 on an
  Adreno 750 board. Whether the q6_K half product explains the 0.395 / 63.9% failure is exactly
  what the upcoming A/B decides; this commit makes that experiment possible and nothing more.
  The author's own documents state all of this correctly (commit message, REPORT sections 4,
  5, 6.3); nothing in them lets the syntax check masquerade as a compile.

## Verdict summary

| item | verdict |
|---|---|
| 1 scope (one file, intended lines, clean tree) | CONFIRMED |
| 2 semantics (no surviving half product, no semantic drift) | CONFIRMED |
| 3 accumulator (store block, pressure, justification) | CONFIRMED (change) / PARTIAL ("must be float" is sound but unmeasured; the half-acc + f32-product cell never ran) |
| 4 reference parity with 67c73d26c | CONFIRMED |
| 5 reachability at batch 256 on A7X + leftover list | CONFIRMED (count slip: 18 of the 19 Q6_K tensors are GPU-served, not 19) |
| 6 evidence standard | CONFIRMED (syntax gate reproduces; link-blocker claim verified; Adreno compile and all device numbers unproven, honestly labeled) |
