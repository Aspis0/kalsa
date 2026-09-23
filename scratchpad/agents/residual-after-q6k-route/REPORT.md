# REPORT - residual-after-q6k-route: what is the 0.006954 made of, and what next

Explorer cell, read-only. Engine pinned `1068eb03d` (all file:line below = that commit,
verified via `git show 1068eb03d:...` into /tmp, shared tree not modified). Report written
incrementally, section by section.

## 0. Ledger of measured inputs (not re-derived here)

From tonight's `s23-kld-740-q4-0` session (2x2 factorial + ablations, owner-supplied):

| fact | number |
|---|---|
| stock / dp4a-arm median KLD / same-top | 0.394993 / 63.892 % |
| full-precision cell (q6k route + f32 operand) | **0.006954 / 92.913 %** (gate: 0.005 / 95 % -> FAIL both) |
| -ot F32 conv (22 tensors) -> CPU | 0.006991 (+0.5 %) - nothing |
| -ot attention projections (32) -> CPU | 0.005925 (-14.8 %) |
| -ot ffn_down (30) -> CPU | 0.005863 (-15.7 %) |
| instrumented routing, default (fixed) | dp4a=0, f32=269 |
| instrumented routing, stock selector | dp4a=252, f32=17 (17/269 decline the dp4a predicate) |
| prefill throughput stock -> full precision | 75.94 +- 0.12 -> 68.42 +- 0.19 t/s = **-9.9 %** (routing leg -7.8 %, operand leg -4.6 %, sub-additive) |

Caveat carried through: `-ot` moves weights only; softmax, KQ scores, KV and all
attention arithmetic stayed on the GPU in every ablation row.

Control that anchors every bound below: same phone, same driver, same binary, same
harness, Q4_0 model = **0.001373 / 97.413 % PASS** (both limbs).

## 1. THE CENSUS TEST - F32 exonerated before any walk

Decided first, as ordered. Census sources: (a) archived parse of the exact Q4_K_M file
`s23-kld-740-q4-0/raw/gguf-census-q4km.txt` (271 lines, produced last night by python
struct-parse of `/Users/marco/kalsa-models/LFM2.5-2.6B-Q4_K_M.gguf`), cross-checked by
(b) my own `llama-gguf <file> r n` dump this session of both files (Q4_0 =
`/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`, 1593894944 B = the
a247afd6-shipped file; Q4_K_M re-dumped from `/Users/marco/kalsa-models/`).
Counts reproduced independently: Q4_K_M {Q4_K:148, Q6_K:19, F32:99}; Q4_0 {q4_0:166,
q6_K:1, f32:99} - matches `gpu-numerics-fix-recon/REPORT.md:32,95`.

Side by side, class by class:

| class | Q4_K_M (failing) | Q4_0 (passing) | name-set diff |
|---|---|---|---|
| quant matmul weights | 148 Q4_K + 18 non-vocab Q6_K | 166 q4_0 | 166/166 identical names; only the type tag differs (148/148 Q4_K names and 18/19 Q6_K names verified present as q4_0 by join; comm = empty) |
| vocab (CPU both runs) | token_embd Q6_K | token_embd Q6_K | identical |
| F32 | 99 | 99 | **diff of name lists = IDENTICAL (99/99)** |

Non-matmul F32 counted separately, as ordered: of the 99 F32 tensors, **77 are norm
vectors** (61 x 2048-elem: token_embd_norm + 30 blk attn_norm + 30 ffn_norm; 16 x
64-elem: attn_q/k_norm in the 8 attention layers) - these feed RMS_NORM, never a
matmul kernel; **22 are `shortconv.conv.weight`** (3 x 2048, one per non-attention
block) - these feed GGML_OP_SSM_CONV (`llama-arch.cpp:947` maps
LLM_TENSOR_SHORTCONV_CONV -> GGML_OP_SSM_CONV; graph built at
`src/models/lfm2.cpp:223` `ggml_ssm_conv(ctx0, bx, conv_kernel)`), also never a
MUL_MAT. Zero of the 99 reach a matmul kernel in either run.

Consequence, stated explicitly: the identical 99-tensor F32 set executed in the
**passing** Q4_0 configuration through the same kernels, so the F32 path cannot be
what separates pass from fail; the only difference between the runs is the quant type
of the same 166 weight names. Item (1) of the brief drops down the ranking. The
on-phone -ot ablation (0.006991, +0.5 %) independently confirms it with a
measurement, not just this diff.

## 2. THE F32 WALK (item 1) - dispatch predicates in order, `ggml_cl_mul_mat` @1068eb03d

Entry `:23770`. For src0t=F32, src1t=F32, ne1=256, A7X:

1. `:23788` quant-kv-without-FA branch -> only Q4_0/Q8_0 src0: no.
2. `:23886` F16 KQ/KQV block (`src0t == F16`): no.
3. `:24173` Adreno trans-weight family `if (ne01 && ne1 && use_adreno_kernels(...))`:
   for F32 this gate is `ne0>=512 && ne1>=512 && ne2=ne3=1` (`use_adreno_kernels`,
   `:9006-9030`, default branch - the %64 rule applies only to K-quants). Norm weights
   are 2048x1 / 64x1 -> ne1<512 -> gate fails. Even for a >=512x512 F32 weight the
   gate would pass but every branch inside tests a Q* type (`Q1_0..Q5_K`,
   `:24181-24237`) -> no F32 arm, falls through, nothing returns.
4. `:24252` local-memory GEMM gate:
   `src1t==F32 && ne00%16==0 && ne11>1 && !(a7x_f32lm_bypass && src0t==F32 && ne11>8 && A7X)`.
   `a7x_f32lm_bypass` defaults TRUE (env unset, `:24250-24251`), adreno_gen==A7X,
   ne11=256>8 -> the last term is false -> **whole gate false: kernel_mul_mm_f32_f32_l4_lm
   is bypassed on A7X at ne1>8 by design** (`:24243-24249`: "E031.41 executes
   kernel_mul_mm_f32_f32_l4_lm poorly... Fallback to the MV style kernels for A7x and
   ne11 > 8"). Override exists: GGML_OPENCL_A7X_F32_LM_BYPASS=0.
5. `:24864` F16 tiled (`src0t==F16`): no. `:24874` SOA Q4_0 flat block: Q4_0 only.
6. `:24944` "custom matrix x vector" switch: **`case GGML_TYPE_F32` -> `:24949`
   `kernel = kernel_mul_mat_f32_f32` - THIS branch returns first.**

Precision of that kernel (`kernels/mul_mv_f32_f32.cl:26`): src0 read as
`global float* x` (`:61`), src1 as `global float* y` (`:63`), accumulator
`float sumf = 0; sumf += (float) x[i] * (float)y[i]` (`:76-77`): **input not converted
to half anywhere, weights stored f32, accumulator float.** The l4_lm alternative it
bypasses on A7X (`mul_mm_f32_f32_l4_lm.cl`) is also f32 end to end
(`local float buf_a/buf_b :41-42`, `float sums[] :72`). So the GPU F32 matmul path
has no half-precision step at all.

Execution reality in THIS model: none of the 99 F32 tensors reaches mul_mat (section 1).
The two F32 consumers that do execute on GPU are RMS_NORM
(`supports_op :9660`, kernel `rms_norm.cl:54-86` float4 sumf, f32) and SSM_CONV
(`supports_op :9682-9683` F32-only, dispatch `:31435-31439` -> `ggml_cl_ssm_conv`
`:15971`, kernel `ssm_conv.cl:31,70` `float sumf = 0.0f`, f32 in/out). Both f32.

## 3. THE OTHER EXECUTING OPS (item 2): kernel, precision, ranking

Op inventory at ne1=256, fa off, A7X (all @1068eb03d):

| op class | kernel / dispatch | precision story |
|---|---|---|
| quant GEMM Q4_K (148) | `kernel_gemm_noshuffle_q4_k_f32` (`ggml-opencl.cpp:22806`; `.cl:35`) | f32 operand after transpose fix (combo), f32 product/acc (`float8 c0 :61`, `convert_float8(B)*(float) :102`), **weights dequantized into `half4 dequantized_weights` (`gemm_noshuffle_q4_k_f32.cl:63,98-100`) - each dequantized weight rounded to fp16** |
| quant GEMM Q6_K (18 GPU) | `kernel_gemm_noshuffle_q6_K_f32` or dp4a (see sibling report) | fixed arm: same shape - f32 operand/product/acc, **half4 dequant** (`.cl:47`) |
| attention score/output (fa off) | KQ/KQV adreno (`ggml-opencl.cpp:23937,23945` -> `mul_mm_f16_f32_kq_kqv.cl`) or generic F16 GEMM if admission declines | A operand = K/V read as f16-widened-float: `mm_load_a` reads `read_imagef` then `convert_float16(as_half16(regA))` (`.cl:25-28`) - the bit-cast round-trip recovers the f16 values stored in the F16 KV cache; products float (`alu_32 :39-57 rC += regA.s0 * matrix_B_vec[i]`), accumulator float4/float16. A image created `{CL_RGBA, CL_FLOAT}` (`ggml-opencl.cpp:20184` region). CPU arm reads the same f16 KV values widened to float -> arithmetic family MATCHES; f16 KV storage is shared by both arms. Exact branch (KQV vs generic F16) in our bench: NOT VERIFIED (no per-kernel trace) |
| softmax | `ggml_cl_soft_max` (`:31510`), `softmax_f32.cl` | f32 in/out, float slope (`:45-69`) - no half |
| RMS norm | `ggml_cl_rms_norm...` (`:856,2989`), `rms_norm.cl` | float4 sumf, f32 (`:54,83-86`) |
| RoPE | `kernel_rope_norm_f32` (`:3026`) | f32 |
| shortconv (22 F32) | `ggml_cl_ssm_conv` (`:31439`), `ssm_conv.cl` | `float sumf` f32 in/out (`:31,70`) |
| KV cache write/read | store to F16 (bench default, `common/common.h:341-342`; no -ctk/-ctv in any arm's command) | f16 storage shared by both arms; reads widened to float in both |
| lm_head / token_embd | CPU (A7X decline, `ggml-opencl.cpp:9739-9748`) | identical CPU math both arms - adds no new error |
| norms F32 (77) | RMS_NORM, not a matmul (section 1) | f32 |

Ranking by expected numerical impact, with what justifies it:

1. **Quant batch GEMM paths (Q4_K+Q6_K, 166 GPU tensors)** - top because the only two
   measurements that moved the metric live here (q6k route 56.8x; and each -ot class
   removed ~15% of KLD, all three classes being matmul classes). Every class runs the
   same kernel family, so per-kernel error is per-class shares of similar size.
2. **CPU reference activation quantization (not a GPU op, but enters every row)** -
   Q8_K/Q8_0 floor, section 5. Ranked second because it is the only term provably
   outside GPU control, and it differs BETWEEN the two models' references.
3. **Attention (scores, softmax, V-mul) + KV f16** - ranked low: the identical code
   ran in the passing Q4_0 control at total 0.001373, so this whole group is bounded
   by ~0.001-0.002 of our 0.006954. The -ot "attention" row moved only weights
   (brief's caveat confirmed: softmax/KQ/V-mul stayed GPU in every row).
4. **RoPE / RMSNorm / softmax / SSM_CONV** - all f32 end-to-end (file:lines above),
   same bound via the control. No half anywhere on these paths.
5. **F32 class** - last: census identity (section 1) + measured ablation (+0.5%).

## 4. TESTING THE SIBLING CLAIM: is dp4a's loss "inherent"? (item 3)

### 4.1 What the CPU reference itself computes, per class

CPU `mul_mat` quantizes src1 (activations) to `vec_dot_type` of src0
(`ggml-cpu.c:1378`, `:1468-1469`, conversion loop `:1518-1546`):

| class | vec_dot_type (file:line) | activation block / scale dtype |
|---|---|---|
| Q4_K | `GGML_TYPE_Q8_K` (`ggml-cpu.c:509`) | **per-256 block, FLOAT scale**: `block_q8_K.d` is `float` (`ggml-common.h:369-375`); quantizer `quantize_row_q8_K_ref` (`ggml-quants.c:2768`): `iscale = -127.f/max` (`:2788`), `nearest_int` (`:2789`), `y[i].d = 1/iscale` float |
| Q6_K | `GGML_TYPE_Q8_K` (`ggml-cpu.c:525`) | same as Q4_K |
| F32 | `GGML_TYPE_F32` (`ggml-cpu.c:414`, `vec_dot = ggml_vec_dot_f32 :413`) | **no activation quantization at all** - pure f32 products |
| (Q4_0 control for contrast) | `GGML_TYPE_Q8_0` (`ggml-cpu.c:438`) | **per-32 block, HALF scale**: `block_q8_0.d` is `ggml_half` (`ggml-common.h:251-255`); `quantize_row_q8_0_ref` (`ggml-quants.c:276`) |

Weight-side scale application on CPU is in float in both K-quant vec_dots:
`ggml_vec_dot_q6_K_q8_K_generic` computes int8xint8 products into int32
(`quants.c:851-899`, `aux32[l] += scale * aux16[l]` with int8 weight scale), then
`const float d = GGML_CPU_FP16_TO_FP32(x[i].d) * y[i].d; sums[l] += d * aux32[l]`
(weight d is fp16-in-format, activation scale is float). Q4_K identical structure
(`quants.c:696+`). So: **CPU uses int8 activations AND float block scales for both
K-quants.** The Q8_0 path (control model) is the different one: per-32, half scale.

### 4.2 What the GPU dp4a kernels do, verbatim

- `quant_a_q8_1.cl`: per-32 block amax, `q = rint(v * id)` int8 (`:31`),
  `da[blk] = (half)d` (`:34`) - **per-32 activation scale stored as HALF**, `sa` also
  half (`:35`). Block size 32 vs CPU's 256; scale dtype half vs CPU's float.
- `gemm_noshuffle_q6_k_q8_1_dp4a.cl`: exact int8xint8 dots in groups of 16
  (`dot4_q8a :30-39`, `dot_acc_sat_4x8packed_ss_int`), scale application:
  `scale0 = dd * (float)sc.s0` (`:79-80`, dd fp16 weight superblock scale -> float),
  `rf.s##j = scale0 * (float)raw1 + scale1 * (float)raw2` (`:101-104`),
  `acc[g] += ad * rf` with `ad = (float)sh_d[...]` - **accumulator is `float4 acc`,
  f32** (`:67-69,107`), dst written f32 (`:120-125`).

### 4.3 Verdict

The claim's two factual legs check out: CPU quantizes activations to int8 for Q4_K
and Q6_K (Q8_K), and applies block scales in float; the GPU dp4a also uses int8
activations with f32 accumulation. **So "int8 activation quantization" as such cannot
be the explanation for 0.395 - if it were, the CPU reference would carry the same
loss against truth, and every arm would land near it.** Two measured facts make the
"inherent" claim insufficient:

1. The f32-GEMM arm (NO activation quantization on GPU, f16 operand) sits 57x closer
   to the same CPU reference (0.006954). If the CPU's own int8 quantization dominated
   the gap, removing GPU-side quantization should have moved KLD DOWN only to the
   CPU's own floor - it did (0.007!), but that also proves the CPU's int8 floor is
   SMALL (~0.001-0.007, section 5). Then dp4a-vs-CPU = |GPU_int8_scheme -
   CPU_int8_scheme|, two nearby quantizers, which by the triangle bound
   |a-c| <= |a-b| + |b-c| (b = truth) is at most ~2x the single-quantizer floor -
   i.e. **bounded ~0.014, not 0.395**.
2. Asymmetry with the f32 cell explained: the f32 cell is "further from CPU
   arithmetic" per-element (f16 operand, no act quant) but each side is close to
   TRUTH, and KLD is a distance to truth-anchored distributions; the dp4a cell lands
   57x further because 0.395 requires one side to be far from truth, and the f32 arm
   demonstrates the CPU side is not. **Therefore 0.395 contains a defect-sized term,
   not an inherent-quantization term.** Candidates for that defect (none verified):
   the fp16 `da` scale (`quant_a_q8_1.cl:34`) degrading small-amax blocks (subnormal
   half: values below 6e-5 lose precision catastrophically - block scales are
   amax/127, and post-norm activations can have amax < 0.0078 for quiet blocks);
   or driver codegen of `dot_acc_sat_4x8packed_ss_int` on E031.41 (this compiler
   family miscompiles other kernels in this file, `:9456-9459`, `:9894-9905`,
   `:9046-9048`). What WOULD make 0.395 unavoidable: nothing found in source - the
   arithmetic as written should be within ~0.01 of CPU. NOT VERIFIED which of the
   two it is; cheapest discriminator: one phone arm with `KALSA_Q6K_DENSE=dp4a` and
   `da` promoted to float (one-line `quant_a` variant + rebuild, ~2 min arm);
   falsifier for the half-scale hypothesis: KLD stays >= 0.3 -> suspect driver codegen,
   test with a scalar (non-dot-product) int8 kernel variant.

## 5. THE COMMON-TO-ALL-CLASSES LOSS: candidate (a) half at op boundaries

Question: which GPU ops on A7X write results as CL_HALF_FLOAT that a later op reads
back as half, so every op boundary rounds to 11 bits?

Exhaustive walk of writes to half storage in the executing paths:

| site | write (file:line) | read back (file:line) | verdict |
|---|---|---|---|
| quant-GEMM activation transpose (q4_K/q6_K) | `transpose.cl:139 write_imageh` (dest image `{CL_RGBA, CL_HALF_FLOAT}`, `ggml-opencl.cpp:22653` and `:23153`) | `read_imageh` in `gemm_noshuffle_q4_k_f32.cl:96-141` and (combo float arm) `read_imagef` instead | **measured**: the f32-transpose arm (cell C, `KALSA_GEMM_B=float`) moved KLD 0.394993 -> 0.395990 in the dp4a column and 0.006977 -> 0.006954 in the f32 column: i.e. removing THIS rounding changed the residual by 0.3%. Not the carrier. |
| KV cache | stored as F16 by cache default (`common/common.h:341-342`; no -ctk/-ctv in any command) | read as f16 in KQ (`mm_load_a` bit-cast, `mul_mm_f16_f32_kq_kqv.cl:25-28`) and in CPU attention alike | shared by BOTH arms (same cache type); CPU reference reads the same f16 values -> this rounding is common-mode, NOT a GPU-vs-CPU divergence source at the read; divergence enters only because K/V VALUES differ slightly upstream. Cannot explain class-independent GPU-side loss. |
| dequantized weights inside every quant GEMM | registers only: `half4 dequantized_weights` (`gemm_noshuffle_q4_k_f32.cl:63`, `q6_k :47`, `q4_0 :45`) | same kernel | weight-side rounding per product, but present in the PASSING Q4_0 control too (`q4_0 :45,62-65`) and ablated on the 750: `stock:deq` (float dequant) = 0.004793 vs `stock:mul` 0.004736 -> no gain (`adreno-acc-type`, ALIVE 57). Same bound argument: control passed WITH this rounding. |
| graph intermediates (softmax out, norm out, rope out, SSM_CONV out, add/residual) | f32 dst everywhere: `softmax_f32.cl:67 pdst = (global float*)`, `rms_norm.cl:86 global float4* y`, `ssm_conv.cl:29 global float* d` | next op reads float | **no half boundary** |
| GEMV/decode paths | `CL_FLOAT` image (`ggml-opencl.cpp:22443`, q6_K GEMV `:22978-22979`) | `read_imagef` (`gemv_noshuffle_q4_k_f32.cl:288`) | f32, no half |

Conclusion for candidate (a): **the only half boundary on the critical path is the
quant-GEMM transpose, and it is measured to carry ~0.3% of the residual (refuted as
the common floor).** All other op-boundary storage is f32. The half storages that
remain (KV cache, weight-dequant registers) are present identically in the passing
Q4_0 control, so they cannot exceed the control's total (0.001373) in contribution.

Candidate (b) attention/softmax itself: float arithmetic end to end (section 3), f16
KV shared by both arms, and the identical code passed the gate at 0.001373 in the
Q4_0 control -> bounded small. The -ot caveat is real (scores/V-mul never moved to
CPU) but the control bounds the whole group, so completing the ablation there is
low-yield.

Candidate (c) CPU reference floor: see section 6 - yes, partially irreducible.

## 6. THE FLOOR: is part of the residual irreducible by making the GPU more precise? (item 4)

**Yes - plainly: part is irreducible, and the already-run precision arms show it.**

What the gate compares: GPU logits vs CPU logits of the same quantized model. For the
K-quant matmuls the CPU reference **quantizes every activation row to int8** (Q8_K:
per-256, float scale - `ggml-cpu.c:509,525`; `ggml-quants.c:2768`) before the dot;
the full-precision GPU arm does **not** quantize activations (f16 operand, f32
product/acc). So d(GPU, CPU) includes the CPU's own activation-quantization error.
No amount of extra GPU precision can remove that term - it only grows the asymmetry;
the only way to remove it is to make the GPU **reproduce** the CPU's quantization
decision-for-decision (same block 256, same `iscale=-127/max`, same `nearest_int`),
which is a different strategy than "more precise".

Bounds on the floor (all measured, this phone unless noted):

- **Lower-bound structure**: the Q4_0 control passes at **0.001373 / 97.413 %** with
  a CPU reference using Q8_0 (per-32, half scale) and with all the same shared GPU
  code (attention, KV f16, norms, transpose-half, half weight dequant) - so the whole
  class "shared-op noise + reference quantization floor" is <= 0.0014 for that model.
- **Our arm's floor estimate**: 0.006954 = floor + GPU-side batch-GEMM error. The
  floor for Q8_K (per-256, coarser amax block than Q8_0's per-32, but float vs half
  scale - opposite directions) is unmeasured on this model; by the control's order of
  magnitude it is plausibly ~0.001-0.003, i.e. **at most roughly half of 0.006954 is
  possibly irreducible; the rest (~0.004-0.006) is GPU-side and in principle cuttable.**
- The 750's nearest floor probe: batch-1 GEMV fp32 vs its CPU reference = **0.000962**
  (`adreno-precision-bisect`, measure 3) - a second data point that the
  "GPU-near-truth vs int8 CPU reference" floor sits ~0.001 for Q8_0-type references.
- Same-top limb: the 750's best (0.004736) still yielded only 94.826 % - near-0.005
  KLD corresponds to ~95 % same-top, i.e. **both limbs must be attacked together**;
  cutting KLD to ~0.003 would be expected to put same-top in the 96-97 % band
  (interpolating control 0.001373->97.4 % and 0.004736->94.8 %, same-phone scaling
  assumed - MED confidence).

Cheapest direct measurement of the floor itself: **one GPU arm at `-b 1`** (routes all
matmuls to the fp32 GEMV paths, precedent = bisect measure 3) against the EXISTING
`cpu-q4km.kld`. CPU logits should be batch-shape invariant (per-row quantization and
per-row vec_dot partition over K depends on thread count, not on ne11:
`ggml-cpu.c:1518-1546` row loop with `ne10_block_start = (ith*ne10/bs)/nth`
:1534-1539; rows distributed `i11 = ith; i11 += ne11/nth`-style, per-row independent)
- verify first with a CPU-vs-stored-reference run at -b 1 (~11 min, KLD should be ~0;
if not, reference must be regenerated per shape). GPU -b 1 arm: ~8-9 min (750
precedent: b1 is ~8x slower than b256: 254 s vs 32 s). **If -b1 lands <= ~0.002 ->
floor small, residual is batch-GEMM-specific -> candidates 1/3 below can pass the
gate. If -b1 lands >= ~0.0045 -> the floor plus shared ops already eat the gate ->
the gate is NOT reachable by precision work alone on this device; passing then
requires matching the CPU's activation quantization (candidate 2) or re-gating.**
This is the single most decisive number still missing.

## 7. ARCHIVE CHECK: was the 750's 0.004736 ever attributed? (item 5)

Searched with `rg --no-ignore` across `~/Projects/kalsa-moe-experiments` (raw/ included).
Verdict: **no op-class attribution and no isolating ablation (KV type, attention-only,
norm, layer-count sweep) exists for the 750's post-fix residual. It was carried as an
unattributed residual, with exactly two named structural suspects that were never
tested.** Quotations:

- `adreno-acc-type/REPORT.md:56-58` (750, Q4_0, post product-fix):
  "la congiunzione NON è soddisfatta" - the pre-registered conjunctive gate (median
  <= 0.005 AND same-top >= 95 %) was **NOT met** (0.004736 passes the KLD limb,
  94.826 % fails the same-top limb), and: "Resta anche un fattore ~5 fra `mul`
  (0,004736) e il percorso GEMV fp32 misurato in batch 1 (0,000962): un residuo
  esiste" - a factor ~5 remained vs the fp32 GEMV path, explicitly unexplained.
- `adreno-operand-b/REPORT.md:32-37`: the operand axis was tested next and refuted
  ("la precisione dei dati in memoria non spiega il residuo"); the residual section is
  titled "Il residuo, e cosa resta in piedi": "I sospetti nominati nel PREREG e non
  ancora testati restano due, entrambi strutturali: la geometria del tile ... e
  l'ordine di somma" - **tile geometry and summation order, both never tested.**
- Chain of per-measure refutations (operand-b, `archived/ALIVE-2026-09-full.md:494`):
  attention (ALIVE 56), compiler flags, f16 accumulator, dequantization (ALIVE 57),
  stored-operand precision - "L'unica cosa che ha mai spostato la KLD è il prodotto,
  di 95,8×". **Attention was refuted as the 750's big cause only as an algorithm
  mismatch (-fa alignment, bisect measure 2), not as a per-op numerical contributor
  below the ~0.005 level.**
- `gpu-divergence-verdict/REPORT.md:92` records the 0.004736/94.826 row as "NOT
  satisfied ... No; and its own gate failed". So "accepted at 0.004736" in the brief
  is acceptance-as-reference-value, not a passed gate.

What this bounds for us: the 750 number tells us a same-architecture Q4_0 arm sat at
0.0047 with its residual unattributed and two structural suspects open - it does NOT
license attributing our 0.006954 to any op class either. The chain does license
ruling OUT (for the shared mechanisms): f16 accumulator, dequant precision, operand
storage, compiler flags, attention-algorithm mismatch - all previously refuted at
KLD scale, consistent with tonight's own factorial (operand leg ~0).

No KV-cache-type, norm, or layer-count ablation on the 750: `rg -ctk|cache-type-k|
type_k|layer-count|layer sweep` over the adreno-*/gemm-f32-ship/logit-oracle cells
finds no such run (only q44-ngl-sweep-mem, which is a memory/oom sweep, not accuracy).

## 8. APP SHAPE (added questions 6-7-8)

### 8.1 (6) What batch does the app submit? - owner's lead CONFIRMED, streaming-prefill premise REFUTED

Confirmed from my own reading (file:line):

- `kalsa/src/engine/LlamaService.ts:2391` `n_batch: 512`; `:2394`
  `n_ubatch: tuning.n_ubatch`.
- `kalsa/src/engine/deviceTuning.ts:244` `const DEFAULT_UBATCH = 256;`;
  `:731` `let n_ubatch = DEFAULT_UBATCH;` with `ubatchSource = "measured:ubatch-256"`;
  override only at `:734-739` (`ubatchOverride > 0`).
- The app's own call site does NOT pass an override: `LlamaService.ts:2279-2292`
  `resolveEngineTuning({..., request: {contextBudget, mmap, repack}})` - no
  `ubatchOverride` key anywhere in `src/` outside deviceTuning itself (rg: only the
  type at `:119` and the handler `:734-738`). **So production never overrides: 256.**
- Binding passthrough: `llama.rn-kalsa/cpp/jsi/JSIParams.cpp:315`
  `cparams.n_ubatch = getPropertyAsInt(params, "n_ubatch", ...)`; embedding-only
  special case at `:418` (`n_ubatch = n_batch`) applies only when
  `embedding=true` - not the chat prefill path.
- Vendored clamp: `vendor/llama.cpp/src/llama-context.cpp:248`
  `n_ubatch = min(n_batch, ...)` -> min(512,256)=256; graph built per ubatch in
  `process_ubatch` (`llama-context.cpp:1344`).

(a) Can anything lower n_ubatch below 256 at runtime for this app?
- The only other n_batch mutation is `cpp/rn-slot-manager.cpp:1026-1028` (halve on
  decode failure, floor 32). **Not reachable in normal single-session use**: the slot
  manager is created only by `enableParallelMode` (`rn-llama.cpp:1164,1203`) and the
  app never calls it (rg `enableParallelMode|llamaEnableParallelMode` in `kalsa/src`:
  zero hits); the chat path decodes via `rn-completion.cpp` directly
  (`parent_ctx->decode(llama_batch_get_one(...))`, `:1679`). Even if reached, it
  halves the *batch builder* limit, not `cparams.n_ubatch` (already fixed at context
  creation, `llama-context.cpp:248`). Error-path only.
- No device-conditional ubatch: DEFAULT_UBATCH is a single global; the Jelly Star
  profile (`deviceTuning.ts:211-213`, `:333-341`) sets cores/threads, not ubatch
  (rg `ubatch` in deviceTuning: only lines 244/731-739/752/764-765 = the default and
  override machinery). **256 on every device profile.**

(b) Split before the GPU: prefill submissions are capped at `params.n_batch`=512 in
`rn-completion.cpp:1585-1587` (`n_eval > n_batch -> n_eval = n_batch`), then
`llama_decode` internally splits into ubatches of `n_ubatch`=256
(`llama-context.cpp:1753,1856` -> `process_ubatch :1344`). So **per-graph ne1 <= 256,
typically exactly 256 for full chunks** (plus smaller tail chunks: prompt remainder
`prompt_len mod 256`, and checkpoint-boundary splits at `state_ckpt_prefill_interval`
256 / `state_ckpt_min_gap` 64, `rn-completion.h:125,128` -> chunks of 64..512 tokens
-> ubatches of 256 + remainder). Decode is ne1=1; MTP/spec batches are small
(spec_prompt chunks also capped at n_batch `rn-completion.cpp:999-1010`, but draft
verify batches are 1+draft tokens).

(c) No profile sets it smaller - see above.

**Verdict: the bulk of app prefill is 256-token ubatches = exactly the bench shape.
The dp4a branch (ne1>8) DOES fire in the shipped configuration; tonight's 56.8x
applies to the product's dominant path. The earlier "streaming ne1<=8 = real app
prefill" premise is REFUTED for bulk prefill**; ne1<=8 graphs occur only as
(remainder/boundary tail chunks, decode, spec-verify) - real but minority, and NOT
covered by the bench (see 8.3). Where I looked for the prior claim: `rg` over the
archive finds only hypothetical phrasings (`gpu-numerics-fix-recon/REPORT.md:113-115`
"kernels a small-chunk (<= 8 token) streaming prefill **would** hit") and the q60-q62
"streaming" cells which are about expert-streaming I/O, not token batching - **I could
not find an archived statement that the app prefills <= 8 tokens; if it exists it was
not produced by rg --no-ignore over scratchpad/agents in this search (NOT FOUND).**

### 8.2 (7) Dispatch walk for ne1 = 1/2/4/8, three classes, A7X (@1068eb03d)

**Q4_K** (entry `ggml_cl_mul_mat_q4_k_f32_adreno :22354`):
1. bin/a8 kernels (`:22413-22419`): X2E-only, null handle -> false (`use_q4_k_bin_kernels :9482-9491`).
2. `ne1 == 1 || use_mc3` (`:22420`); `use_mc3` = env `GGML_OPENCL_Q4K_MC3` + ne1==3
   (`:22399-22404`) -> off by default.
   - **ne1==1 -> GEMV branch returns first**: activation image `{CL_RGBA, CL_FLOAT}`
     (`:22443`), kernel `kernel_gemv_noshuffle_q4_k_f32` (`:22556`), precision:
     f32 operand (`read_imagef`, `gemv_noshuffle_q4_k_f32.cl:288`), accumulator
     `private float2 totalSum` **float** (`:268`), products computed through
     `dequantizeBlockAccum_ns_sgbroadcast_*` macros with float shared_y (`:35,138`) -
     weights enter as `convert_half2(convert_float2(d)*(uchar)sv)` scale in half
     (`:284-285`) i.e. same fp16 weight-scale as format - **f32 product/acc, f32
     operand: this is the clean path (750-measured 0.000962 class)**.
3. ne1 in {2,4,8}: not (1); dp4a dense gate `:22683-22699`: `q4k_dense_dp4a_on`
   defaults `adreno_gen == X2E` (`:22684-22690`) -> **false on A7X** (and
   `N >= q4k_dp4a_minn` default 9, `:22694-22697` -> false for N<=8 anyway).
4. small-batch block `:22785-22806`: `use_cok = q4k_gemm_cok(default ON) && ne1<=8`
   (`:22787-22788`) -> **TRUE for 2/4/8 -> `kernel_gemm_noshuffle_q4_k_f32_cok`
   (`:22803`, `.cl:399`)**. `_r1`/`_kimg` are env opt-ins, off (`:22785-22786`).
   Precision: `half8 acc = 0` (`.cl:428`), `half8 B`, `read_imageh` (half operand via
   `transpose_32_16`), `acc += B * dq` with `half dq` (`.cl:452-470` area) ->
   **HALF PRODUCT + HALF ACCUMULATOR over each subgroup's K-slice**, then
   cross-subgroup reduce in float (`reduceLM ... convert_float8(acc)`, `.cl:74-82`).
   **This half-accumulator path runs ONLY at ne1<=8 and is invisible to tonight's
   bench (ne1=256)** - exactly the blind spot flagged in the brief. It is DEFAULT ON
   (`:22784` comment "DEFAULT ON, opt out with GGML_OPENCL_Q4K_GEMM_COK=0").
   - ne1==3 note: mc3 stays off (env), so _cok still wins at 3.

**Q6_K** (entry `ggml_cl_mul_mat_q6_K_f32_adreno :22880`):
1. flat-GEMV escape (`use_flat_gemv_for_large_m_q6_K`, `:9470-9474` area): needs
   `ne1 % 128 != 0`... fires only for non-multiple shapes + env - false for our weights
   (ne1 of weight = 2048/512/128000, all multiples; predicate is weight-side).
2. `ne1==1 || use_q6k_mc3 || use_q6k_tiled_mc` (`:22928`); mc3/tiled_mc need env
   `GGML_OPENCL_Q6K_MC3` + ne1==3 (`:22921-22926`) -> off.
   - **ne1==1 -> GEMV branch returns first** (`:22928-23026`): activation image
     `{CL_RGBA, CL_FLOAT}` (`:22978-22979`), default kernel
     `kernel_gemv_noshuffle_q6_K_f32` (ternary `:29970`-area selection, o4 variants
     gated `ne01 >= 32768` `:22944` -> false for our 2048/512 M) - precision:
     f32 operand (`read_imagef`, `gemv_noshuffle_q6_K_f32.cl:229`), products in
     `dequantize_block_acc_bcast_8_hi` with explicit `(float)` casts and
     `float8 shared_y` (`.cl:19-49`), accumulator `total_sum` in **float** with
     float reduce (`local float2 reduceLM` `.cl:318-327`) -> **f32 operand, f32
     product, f32 accumulator; qh weights read as half image but that is the fp16
     format scale itself (`src0_d` is `half` in block_q6_K)**.
3. ne1 in {2,4,8}: else-branch (`:23027+`): dense dp4a gate `ne1 > 8` (`:23090`)
   -> **false**, so dp4a does NOT fire for q6_K at small batch either;
   `use_q6k_cok` needs env `GGML_OPENCL_Q6K_GEMM_COK` (default OFF, `:23189-23190`)
   -> false; tiled layout needs `use_q6k_tiled` (X2E/A8X default, `:9322-9326`) -> false.
   -> **falls to transpose (`:23168`) + main `kernel_gemm_noshuffle_q6_K_f32`
   (`:23191-23192`)**. At pinned 1068eb03d that kernel is the UNFIXED one
   (`half8 c0`, half product - `recon :105-108`); under the fix stack
   (914b34a7e+) it is f32 product/acc but still reads the **half operand image**
   (stock transpose) unless `KALSA_GEMM_B=float`.

**F32** (no F32 tensor reaches matmul in this model - section 1; walk for
completeness of the hypothetical, `ggml_cl_mul_mat :23770`):
- ne1==1: local-mem GEMM gate needs `ne11>1` (`:24254`) -> skip; SOA gate needs
  `ne11>2` (`:24874-24877`) -> skip; **custom MV switch `case F32 :24946-24949` ->
  `kernel_mul_mat_f32_f32` (f32 operand, `float sumf`, `mul_mv_f32_f32.cl:76-77`)**.
- ne1 in {2,4,8}: local-mem gate `:24252`: `ne11>1` true, bypass term requires
  `ne11 > 8` -> false -> gate PASSES -> **`kernel_mul_mm_f32_f32_l4_lm`
  (`:24288`)**: f32 local buffers `local float buf_a/buf_b` (`mul_mm_f32_f32_l4_lm.cl:41-42`),
  `float sums[]` (`:72`) - f32 product/acc.
- All F32 paths f32 end to end (section 2). No half accumulator anywhere in the F32 family.

**Half-accumulator inventory at ne1<=8 (the bench-invisible set): q4_K `_cok`
(half acc `.cl:428`, default ON for ne1<=8) is the ONLY default-reachable
half-accumulator in this model's GPU paths. q6_K at 2..8 runs the (fix-stacked) f32
product main kernel; F32 family is f32; GEMVs are f32.**

### 8.3 (8) Can the batch-256 result be extrapolated to the app? Plainly:

**Bulk prefill: YES - same shape, same kernels, same routing (ne1=256 ubatches, dp4a
bracket ne1>8 satisfied, section 8.1). The bench measures exactly what the product
prefills with. Tail/decode/spec paths (ne1<=8, ne1=1): NO - different kernels, never
measured (q4_K `_cok` half accumulator runs there by default); the fix's effect on
those paths is unknown and unmeasured.** The honest sentence: the dominant product
path is covered and tonight's fix applies to it; the minority small-ne1 paths use
kernels nobody has measured for fidelity on this model, and the fix may or may not
apply there (q6_K small-batch runs the same fixed main GEMM under the fix stack, so
q6_K tails ARE covered; q4_K tails run `_cok`, NOT covered).

Measurement needed for the tails, exact commands (same protocol as
`s23-kld-740-q4-0/REPORT.md` sections 7-11, combo binary `a8eb58010`):

```
# CPU reference for shape -b 8 (see invariance note below - regenerate to be safe):
cd /data/local/tmp/s23-kld-740-q4-0 && LD_LIBRARY_PATH=$PWD/lib TMPDIR=$PWD \
  ./llama-perplexity[-combo] -m LFM2.5-2.6B-Q4_K_M.gguf -f corpus.txt \
  -c 256 -b 8 -ngl 0 -fa off -s 42 --temp 0 --kl-divergence-base cpu-q4km-b8.kld

# GPU arm at the same shape:
  ... -b 8 -ngl 99 -fa off ... --kl-divergence --kl-divergence-base cpu-q4km-b8.kld
```

Must the CPU reference be regenerated for that shape? **From source: the CPU's
per-row arithmetic does NOT change with batch shape** - activation quantization and
vec_dot are per (row=token, K-slice=thread): `from_float` per row with
`ne10_block_start = (ith*ne10/bs)/nth` (`ggml-cpu.c:1534-1539`), rows iterated
`i11` over all ne11 (`:1526-1546`); Q8_K/Q8_0 blocking (256/32) is along K only
(`ggml-quants.c:2768/276`), independent of ne11. So each token's CPU logits are
identical at -b 8 and -b 256 (same thread count), **but** llamafile-sgemm batching
(`ggml-cpu.c:1484-1513`, guarded `GGML_USE_LLAMAFILE`) could reorder K for
contiguous src1 - whether it is compiled into the Android build is NOT VERIFIED.
Cheapest safe course: regenerate the reference per shape (costs one CPU arm) OR
validate reuse first with one CPU-vs-stored-reference run (KLD~0 proves reuse).

Costs (measured tonight, this phone, this corpus, 14 chunks): CPU arm **10.62 min**
(`cpu-q4km.log`), GPU arms **1.05-1.38 min** (`gpu-full.log` etc., warm cache;
+~2-4 min first compile per new kernel set, `provenance` 1.87 min warm / cold runs
3-4 min). At -b 8 the GPU arm grows roughly with the small-batch kernel cost -
expect ~2-5 min (the 750's -b 1 arm was 254 s vs 32 s at -b 256, i.e. ~8x; -b 8 is
between; treat as ESTIMATE, not measured). Total for a tails arm + its reference:
**~15-20 min of phone time.**

Also not covered by the bench and worth one line: KV cache types differ bench vs app
(bench ran defaults F16/F16; app sets type_k=q8_0, type_v=q4_0,
`deviceTuning.ts:744-745`) - the app's KV config was never KLD-gated; if the product
gate must hold for the shipped KV config, add `-ctk q8_0 -ctv q4_0` to BOTH arms and
regenerate the reference with those flags (same cost formula as above).

## 9. RANKED FIX CANDIDATES

Ordering by expected impact x confidence / cost. Gate = KLD <= 0.005 AND same-top
>= 95 %; context: same-top 95 was only ever crossed on this phone by the Q4_0
control (97.413) and by batch-1 GEMV arms (750: 98.031); the 750's best batch-GEMM
arm stopped at 94.826 for KLD 0.004736 - so passing BOTH limbs likely needs KLD
<= ~0.003-0.004, not merely 0.005.

**Action 0 (selector, zero build): GPU arm at -b 1 vs the stored reference.**
Routes every matmul to the fp32 GEMV paths; measures the floor (CPU Q8_K activation
quantization) plus GEMV residual directly. Precedent: 750 Q4_0 gave 0.000962/98.031
this way (bisect measure 3). Cost: one CPU-vs-stored-ref reuse check (~11 min) + one
GPU arm (~9 min, -b 1 is ~8x slower). Falsifies BOTH directions of the story below:
-b1 <= 0.002 -> floor small, residual is batch-GEMM machinery (-> candidate 1);
-b1 >= 0.0045 -> floor+shared eat the gate -> precision work alone cannot pass
(-> candidate 2 only, or state gate unreachable). Everything ranked after this is
conditional on it.

**1. Batch-GEMM structural term: summation order + tile geometry (and optionally
half->float weight dequant) in `kernel_gemm_noshuffle_q4_k_f32` /
`..._q6_K_f32`.**
- Locus: K-loop order and per-fiber accumulation in
  `kernels/gemm_noshuffle_q4_k_f32.cl:96-141` (main kernel, `float8 c0 :61`) and
  `kernels/gemm_noshuffle_q6_k_f32.cl:60-110` (main, `float8 c0 :47` area); host
  workgroup tiles set at dispatch `ggml-opencl.cpp:22810-22830` / `:23191-23240`;
  weight dequant into `half4 dequantized_weights` at `q4_k .cl:63,98-100`,
  `q6_k .cl:47`.
- Why ranked 1: it is the ONLY structural axis still standing - operand refuted
  twice (0.3 % tonight; 750 `adreno-operand-b`), dequant refuted on 750 for q4_0 but
  **never for q4_k/q6_k**, product fixed, flags/accumulator refuted (ALIVE 57);
  tile+order are the 750's two named-untested suspects (`adreno-operand-b:32-37`);
  and the -ot spread (each moved class ~15 %) is the signature of a term shared by
  every class through common machinery rather than one class's kernel.
- Expected impact: the 750's GEMM-vs-GEMV gap was factor ~5 (0.0047 -> 0.00096)
  unexplained by operand/deq; if a comparable share survives here, 0.006954 ->
  ~0.0015-0.003 - enough for both limbs IF the floor is small (Action 0 decides).
  Confidence MED (structural suspects, never isolated on any device).
- Cheapest test: after Action 0, one worktree variant behind a `KALSA_*` env
  selector in the style of `KALSA_GEMM_B` (same 2-kernel scope): reorder the K
  accumulation GEMV-style and/or change tile; one build, one ~1.2 min arm. The
  half->float dequant variant is the same selector pattern (probe precedent
  `7ef9389bc` KALSA_GEMM_PREC, `kalsa/gemm-acc-probe` branch).
- Falsifier: variant moves median KLD < 10 % (or same-top < 0.5 pp) -> order/tile/deq
  refuted for this model -> only candidate 2 remains for the gate.

**2. Make the GPU reproduce the CPU's activation quantization exactly (Q8_K-matched
int8 path) - the only route that removes the reference-floor term; precision cannot.**
- Locus: `kernels/quant_a_q8_1.cl:7-36` (currently per-32 blocks, HALF scale
  `da[blk]=(half)d :34`, `rint :31`) must become Q8_K semantics to match
  `ggml-quants.c:2768-2796`: block **256**, `iscale=-127.f/max :2788`,
  `nearest_int :2789` (note: rint != nearest_int on ties - match the CPU's
  round-half-away), **float** scale, CPU's sign convention irrelevant (cancels in
  product); feeding an int8 GEMM that applies scales as
  `d_w(fp16->fp32) * d_a(float)` exactly like `quants.c:896-898`.
- Why ranked 2 and not 1: it attacks the IRREDUCIBLE-by-precision term (section 6)
  by construction - identical quantization decisions make the GPU and CPU agree on
  activations, collapsing that component to weight-side/order residue - but it is
  gated behind explaining the 0.395 dp4a arm, because that arm already runs int8
  activations and is catastrophically wrong (section 4): shipping Q8_K quantization
  through the same pipeline inherits the defect.
- Prime defect suspects for the 0.395 (each testable): (i) **argument order of
  `dot_acc_sat_4x8packed_ss_int(w0, a0, r)`** (`gemm_noshuffle_q6_k_q8_1_dp4a.cl:31-38`)
  - the kernel assumes acc-last; the platform builtin prototype is an OpenCL
  builtin not in this tree (Intel's similarly-named extension is acc-FIRST) -
  if acc-first, every dot returns garbage -> exactly a defect-sized 0.395; (ii)
  driver codegen of that intrinsic on E031.41 (precedent: this compiler miscompiles
  other kernels here, `ggml-opencl.cpp:9456-9459`, `:9894-9905`); (iii) fp16 `da`
  (`quant_a_q8_1.cl:34`) - weaker, subnormal error hits only quiet blocks.
- Expected impact: removes the floor component (est. 0.001-0.004, Action 0
  measures it) AND restores a FASTER path (dp4a is what the -7.8 % routing leg pays
  for). Confidence MED on direction, gated on defect diagnosis.
- Cheapest test: one device-side unit arm first (known activation matrix ->
  `kernel_quant_a_q8_1` + dp4a GEMM -> compare vs CPU Q8_K row-quantized dot;
  a5-line main() harness, no model), or as a full-arm shortcut: `KALSA_Q6K_DENSE=dp4a`
  with a scalar-fallback variant of `dot4_q8a` (no builtin) - if KLD collapses from
  0.395, suspect (i)/(ii) confirmed; if not, quant_a itself.
- Falsifier: Q8_K-matched path still lands >= 0.005 at -b 256 with Action 0 floor
  already low -> mismatch term wasn't the carrier either; gate likely unreachable.

**3. Complete the attribution matrix: -ot ffn_gate/ffn_up and shortconv
in_proj/out_proj (104 of 166 K-quant tensors NEVER moved).**
- Locus: measurement only, zero build, same combo binary. ffn_gate/up = 60 tensors,
  shortconv projections = 44 (census, section 1). The three completed rows each
  recovered ~15 %; 63 % of tensors are untested, so ~2/3 of a class-proportional
  residual is still unattributed.
- Expected: completes (or breaks) the proportional-share model; if one pair moves
  KLD 40 %+ , that pair names the carrier. Confidence HIGH that it is informative,
  this is attribution not a fix (CPU offload is not shippable - CPU prefill is 8.8x
  slower).
- Test: two arms (~2-6 min each; the ffn_down row took 4.07 min vs 1.15 baseline,
  expect similar for gate/up).
- Falsifier: both rows ~15 % again -> shares fully proportional -> confirms
  candidate 1/2 framing (shared machinery or floor), no single-class target exists.

**4. Attention computation / KV type isolation - bounded LOW, close the -ot caveat.**
- Locus: scores path `mul_mm_f16_f32_kq_kqv.cl:25-28` (A = f16 KV read through a
  CL_FLOAT image with a bit-cast round-trip - value-preserving, section 3),
  softmax `softmax_f32.cl:67`, KV type `common/common.h:341-342` (bench F16/F16;
  app q8_0/q4_0 `deviceTuning.ts:744-745`).
- Expected impact: <= ~0.0014 - the whole shared-op group passed inside the
  control's 0.001373 total, so it CANNOT be the common floor. Confidence HIGH it is
  not the carrier; the caveat is that -ot never moved it, so this is the cheap
  completion: arms with `-ctk f32 -ctv f32` (both arms + regenerated ref, ~25 min)
  isolate KV-f16; isolating softmax/score arithmetic has no flag and would need a
  supports_op decline env (small patch).
- Falsifier: KLD moves < 0.0005 -> drop permanently.

**5. Product-coverage, not gate: q4_K `_cok` half accumulator at ne1<=8.**
- Locus: `kernels/gemm_noshuffle_q4_k_f32.cl:399-470` - `half8 acc = 0 :428`,
  `read_imageh` operand, `acc += B*dq` half product, float reduce only at :74-82;
  default ON for ne1<=8 (`ggml-opencl.cpp:22787-22788`). This is the only
  default-reachable half accumulator left, it runs on app tail/boundary chunks and
  decode-adjacent small batches (section 8.2), and NO measurement covers it on this
  model.
- Expected: unknown; tails are a minority of prefill but they feed the same
  residual stream; confidence LOW-MED that it is small, HIGH that it is unmeasured.
- Cheapest test: the -b 8 arm + shape reference of section 8.3 (~15-20 min phone).
  Fix if it moves: mirror the f32-product fix into `_cok` (`half8 acc` -> `float8`,
  `B * dq` -> `convert_float8(B) * (float)dq`), one kernel, selector-gated.
- Falsifier: -b 8 KLD ~= -b 256 KLD (per-token) -> `_cok` loss negligible -> drop.

**6. dp4a defect -> recover the -9.9 % speed (candidate 2's enabler, listed here for
the speed motive).** Locus and suspects as in candidate 2. Measured stakes: 75.94 ->
68.42 t/s = -9.9 % (routing leg -7.8 %, operand leg -4.6 %). A correct CPU-matched
dp4a should be FASTER than the f32 path (no transpose launch, int8 dots), turning
the accuracy vehicle into a speed win. Test = candidate 2's unit harness.
Falsifier: with the defect fixed and Q8_K matching, KLD still >= 0.005 -> dp4a
family abandoned for accuracy, retained only if speed is re-bought knowingly.

**Excluded (do not retry): F32 class** - census identity (section 1) + measured
+0.5 % (`-ot` row a). **Activation operand (f16 image)** - moved 0.3 % tonight, and
refuted on the 750 (`adreno-operand-b`). **Compiler flags / f16 accumulator /
stored-operand precision** - refuted on the 750 (ALIVE 57/59). **Product precision
in q4_0/q4_K kernels** - fixed, the 56.8x is already banked.

## 10. THE FLOOR PARAGRAPH (the one that matters)

Part of the 0.006954 is irreducible by making the GPU more precise, and the arms
already run prove it: the full-precision cell (f32 products, f32 accumulation, f32
or f16 operand, no GPU-side activation quantization at all) still sits 1.39x above
the KLD limb because the gate measures distance to a CPU reference that **throws
away most of the activation's precision itself first** - for Q4_K and Q6_K every
activation row is rounded to int8 in 256-element blocks with a float scale
(`ggml-cpu.c:509,525`; `ggml-quants.c:2768`) while the GPU keeps f16/f32
activations; that quantization is in the reference, not the GPU, so widening the
GPU only widens the asymmetry. Bound: the Q4_0 control - whose reference quantizes
per-32 with a half scale (`ggml-cpu.c:438`, `ggml-common.h:251-255`) and whose GPU
path shares every shared op with our failing arm - passes at 0.001373/97.4 %, and
the 750's near-truth GEMV arm hit 0.000962/98.0 %; our reference uses the coarser
per-256 block (larger amax over 256 than over 32 -> bigger steps, despite the float
scale), so the floor for THIS model is plausibly ~0.001-0.004 of the 0.006954 -
unmeasured, and `-b 1` measures it in one ~20-minute session. If that probe returns
>= ~0.0045 the honest verdict is: **the gate as written is not reachable by GPU
precision work alone on this device** - the remaining routes are (a) making the GPU
arithmetic CLOSER to the CPU's by replicating its Q8_K activation quantization
decision-for-decision (candidate 2, which also buys back the 9.9 % speed if the
dp4a defect is found), or (b) re-gating with the reference floor subtracted. If it
returns <= 0.002, the floor is not the blocker and the residual lives in the shared
batch-GEMM machinery (candidate 1), which precision-adjacent structural work can
still cut. The same-top limb raises the bar further: every passing configuration on
this device has been either near-truth GEMV or the Q4_0 control; no K-quant
batch-GEMM arm has yet produced same-top >= 95 % anywhere in the archive.

## 11. NOT VERIFIED / NOT FOUND

- The exact prototype of the OpenCL builtin `dot_acc_sat_4x8packed_ss_int`
  (argument order) - not in this tree; the leading defect candidate for the 0.395
  dp4a arm (section 9/2).
- Whether `GGML_USE_LLAMAFILE` is compiled into the Android build (affects strict
  CPU batch-shape invariance of the reference; CMakeCache of the phone build dir not
  present on this machine) - section 8.3 treats reuse as expected-but-verify.
- The Q8_K reference floor for this model (0.001-0.004 is inference from block
  geometry + control bounds, NOT a measurement) - `-b 1` settles it.
- Which branch (KQV adreno vs generic F16 GEMM) actually executes the score/V
  matmuls in our runs - both are float arithmetic, so precision claims do not depend
  on it, but no per-kernel trace exists for attention.
- The 17 stock-selector executions that took the f32 route instead of dp4a
  (instrumented counts) - some tensors decline the predicate
  (`ggml-opencl.cpp:23090` name/shape conditions); per-tensor attribution of the 17
  NOT VERIFIED.
- An archived claim that "real app prefill streams <= 8 tokens": NOT FOUND by
  `rg --no-ignore` over scratchpad/agents (section 8.1); the source says bulk prefill
  is 256.
- Q4_K/Q6_K half->float dequant on THIS model (750 tested q4_0 only) - folded into
  candidate 1 as a variant, never measured here.

## 12. THE dp4a DEFECT QUESTION (follow-up)

### VERDICT BLOCK

- **Defect: YES (execution-level, carried over from s4.3: triangle bound on
  tonight's arms - |dp4a - f32arm| >= 0.388 with both referenced to the same CPU -
  and the CPU's own int8 quantization only costs ~0.007, so the dp4a arm computes
  something far from truth; precision family cannot do that).**
- **Location: NOT VERIFIED. My previously named suspect - argument order of
  `dot_acc_sat_4x8packed_ss_int` - is now REFUTED**, and that refutation is the
  deciding evidence produced this session: the compiler's own builtin header
  declares `int dot_acc_sat_4x8packed_ss_int(uint, uint, int)` (NDK clang 21
  `opencl-c.h:17278`, the packed family `:17270-17281`), i.e. (a, b, acc) with acc
  LAST, and the kernel's call `(w0, a0, r)` (`gemm_noshuffle_q6_k_q8_1_dp4a.cl:34-37`)
  matches that signature - a `-fsyntax-only` probe of the exact call compiles
  **rc=0** (`/tmp/dp4a-probe/ok_match.cl`, `-cl-std=CL3.0 -finclude-default-header
  -target spirv64`), and the KHR spec fixes the same order independently of which
  compiler is used (the device already accepted the file: verdict `ok=1`,
  `src=6080B` in last night's provenance). All 15 sibling dp4a/FA call sites use the
  same (packed, packed, acc) shape.
- **Leading remaining suspects: (1) E031.41 driver miscompile of the builtin**
  (precedent: this compiler family miscompiles other kernels in this very file -
  flat K-quant GEMV NMSE~12 `ggml-opencl.cpp:9456-9459`, FA SIGSEGV `:9894-9905`,
  MoE trans4 `:9046-9048`); **(2) `quant_a_q8_1.cl:34` stores the activation block
  scale as fp16** (`da[blk] = (half)d`) where CPU Q8_K keeps it float - with a
  cliff case: fp16 subnormal/FTZ when `d < 6.1e-5` (i.e. block amax < ~0.0078)
  zeroing quiet activation blocks entirely.
- **Minimal fix shape if the device test convicts the builtin** (one file, no host
  change): replace the 4 builtin calls in `dot4_q8a`,
  `kernels/gemm_noshuffle_q6_k_q8_1_dp4a.cl:30-40`, with
  `as_char4(w)`/`as_char4(a)` byte unpack + explicit int madd - the source-level
  semantics are provable by inspection, program-cache keys regenerate automatically,
  and the existing `KALSA_Q6K_DENSE=dp4a|f32` selector A/Bs it with no new switch.

### 12.1 Ranked alternative ways this kernel could lose 57x (all file:line @1068eb03d)

| # | candidate | verdict | evidence / what would settle it |
|---|---|---|---|
| 1 | builtin argument order | **REFUTED** | `opencl-c.h:17278` = (uint,uint,int); kernel call `(w0,a0,r)` `dp4a.cl:34-37`; syntax probe rc=0; KHR spec order fixed; 15 sibling call sites same shape; device accepted the file (verdict ok=1) |
| 2 | driver miscompile of `dot_acc_sat_4x8packed_ss_int` on E031.41 | **LEADING, not verifiable host-side** | only a device-side known-vector test (spec 12.2) or the scalar-replacement variant (12.3) can convict; in-file precedent of this compiler breaking other kernels (`ggml-opencl.cpp:9456-9459`, `:9894-9905`, `:9046-9048`) |
| 3 | activation block scale stored as fp16 in `quant_a` (`da[blk]=(half)d`, `quant_a_q8_1.cl:34`) vs CPU Q8_K float scale (`ggml-common.h:371`, `ggml-quants.c:2793`) | **small rounding + a zeroing cliff** | plain fp16 rounding is bounded by the `KALSA_GEMM_B` precedent (f16 operand measured ~0 effect) -> thousandths at most; BUT `d = amax/127 < 6.1e-5` (block amax < ~0.0078) -> fp16 subnormal, and Adreno fp16 denorm behavior is unknown (CL_DEVICE_HALF_FP_CONFIG) -> possible flush-to-zero = whole quiet blocks dropped, a cliff not a rounding. Settle: store `da` as float (host `cl_half`->`cl_float`, `ggml-opencl.cpp:23098-23101`) + one arm; or check denorm support banner |
| 4 | quantizer grid/rounding vs CPU: block 32 vs 256 (`quant_a_q8_1.cl:10-14` vs `ggml-quants.c:2770-2787`), rint ties-to-even (`:31`) vs ggml `nearest_int` ties-away (`ggml-quants.c:621`), sign conventions (GPU +127/amax vs CPU iscale=-127/max - cancels algebraically) | **cannot be the 57x** | both are near-truth quantizers; triangle bound caps their pairwise distance at ~the sum of their individual errors, which the f32 arm prices at ~0.007-class. These set dp4a's post-fix FLOOR (few thousandths), not its 0.395 |
| 5 | accumulator type/width | **REFUTED** | `float4 acc[NGROUPS]` f32 (`dp4a.cl:67-69,107`), dst f32 (`:120-125`); intermediate `raw1/raw2` exact int32 <= ~65k (`dot4_q8a :30-40`: 4 calls x 4 products x 32 x 127) |
| 6 | dequantized weights rounded to half before the dot | **NOT PRESENT in this path** | weights stay int8 until after the dot (SIGN6/EXP4/EXP2 `:14-27`, raw int products); the only fp16 input is `dd = src0_d` (`:77`), and that is the SAME fp16 format byte the CPU widens with `GGML_CPU_FP16_TO_FP32` (`quants.c:897`) - identical rounding both sides. (The `half4 dequantized_weights` rounding exists only in the noshuffle f32-GEMM family, not here) |
| 7 | `_sat_` saturation at realistic magnitudes | **IMPOSSIBLE** | per-dot-chain bound ~65,024 vs int32 limit 2,147,483,647 (~33,000x headroom); operands are bytes by construction; post-dot arithmetic is f32 |

### 12.2 Decisive device test, SPEC ONLY (not built): known-vector dot-primitive harness

Goal: separate "the kernel computes the wrong dot product" from "the kernel computes
the right dot product in lower precision". Two kernels in one standalone `.cl`, no
model, no ggml:

- **K1 `probe_dot` (the decider).** Inputs: one `__global uint4 *v` of, say, 256
  rows x (8 packed weight-words + 8 packed activation-words), byte patterns chosen
  host-side to be *adversarial*: full-range signed bytes (0x80/-128, 0x7F), mixed
  signs, and rows identical to what `SIGN6|EXP4|EXP2` + `quant_a` can actually emit
  (weights in [-32,31], acts in [-127,127]). Each row runs the EXACT production
  sequence: `r=0; for k in 0..3: r = dot_acc_sat_4x8packed_ss_int(w[k], a[k], r);`
  (mirroring `dot4_q8a`, `dp4a.cl:33-37`), writes `r` to `out_gpu[]`.
  Expected values: host computes the same sum with plain int32 C
  (`sum += (int8)(w[k]>>(8*j)&0xFF) * (int8)(a[k]>>(8*j)&0xFF)` for 4 bytes x 4
  words = 16 products/row) - exact integers, **tolerance 0 (bitwise equal)**. This
  removes quantization, scales, layout - everything except the builtin's arithmetic.
- **K2 `probe_acc_chain` (secondary).** Same rows but the acc threaded exactly as
  production across 8 calls with the int32 intermediate written after each step, so a
  wrong-but-deterministic driver lowering shows *where* it first diverges.

How to read the answer: all 256 rows equal -> the builtin/driver computes the right
dot, defect is NOT in the primitive (pushes suspicion to suspect 3, `da` fp16/subnorm,
or to a layout/scale path only the full kernel exercises); any row unequal -> builtin
miscompile convicted, and the mismatch pattern (constant factor? acc dropped? bytes
swapped?) names the driver bug precisely. Cost: ~80 lines of host C + one kernel,
built once with the existing Android toolchain flags (the same
`-cl-std=CL1.2 -target spirv64` syntax gate used by the sibling cells), minutes on
device; zero risk to the engine tree.

Optional K3 (only if K1 passes): run `kernel_quant_a_q8_1` alone on a fixed f32
vector with one block at amax = 0.005 (below the fp16 subnormal threshold) and
compare `da` against the host float value - a zeroed `da` convicts suspect 3's cliff.

### 12.3 If convicted: minimal fix shape and the money math

- **One-file fix** (builtin convicted): `kernels/gemm_noshuffle_q6_k_q8_1_dp4a.cl`,
  function `dot4_q8a :30-40` only - replace the four builtin calls with
  `as_char4(w)` / `as_char4(a)` unpack + explicit `int` multiply-add (16 products,
  source-provable, no extension dependency). Nothing else changes; the program-cache
  key regenerates itself; `KALSA_Q6K_DENSE=dp4a` vs `f32` already exists to A/B.
- **If suspect 3 convicted instead**: `quant_a_q8_1.cl:34-35` store `da` as float
  (plus host `prealloc_moe_da` to `cl_float`, `ggml-opencl.cpp:23099-23101`) - two
  files, still small.
- **Money:** stock routing is dp4a=252/f32=17 of 269 and runs at 75.94 t/s; the fix
  stack routes all 269 to f32 and pays 68.42 t/s = **-9.9 %**, of which the routing
  leg is **-7.8 %** and the operand leg **-4.6 %** (sub-additive). A convicted+fixed
  dp4a lets the default route go back to dp4a for the Q6_K tensors -> recovers up to
  the -7.8 % routing leg; if the Q8_K-matched quantizer (report s9/2) is also
  adopted, dp4a becomes both the fast AND the reference-matching path, i.e. the full
  -9.9 % is recoverable while *improving* accuracy. What cannot be claimed yet:
  that post-fix dp4a lands <= 0.005 - its grid differences (s12.1 #4) leave a floor
  of few thousandths to be measured with one `KALSA_Q6K_DENSE=dp4a` arm against the
  stored reference (~1.1 min/arm, no build beyond the one-file edit).
