# REPORT - quant-alignment: is the common residual carried by the activation quantiser?

Explorer cell, read-only against the code; one file written (this report). No sub-agents, no
phone contact, no code changes.

**Provenance.** All file:line below verified in the working tree at
`/Users/marco/Projects/kalsallama`, branch `main`, HEAD `833cde99b` (stock, PRE-fix: the
tree's `quant_a_q8_1.cl` still stores `da` as `half`, and `git cat-file -t 87f31d81f`
confirms the fp32-scale fix exists only as a commit on the integration line - the phone
ships `1577495b9`, which contains it). Dispatch predicates were re-read in this tree; they
match the archive's descriptions at `1068eb03d` (line numbers drift slightly between the
two refs; both are quoted where it matters). Archived inputs read in full:
`s23-kld-740-q4-0/REPORT.md` (sections 13, 14, 17, 22, 23, 24, 26 read; section headers
1-26 mapped), `residual-after-q6k-route/REPORT.md` (all 791 lines), `COORDINATOR-STATE.md`
(377 lines).

**Could NOT verify from here:** anything on the phone (this is source + archive only); the
actual enqueue counts at `-b 1` (source says zero - see Z1 for the one run that turns this
into data); whether the `llamafile` batched sgemm is compiled into the Android build (carried
over from the residual report, still open); the true tie behaviour of Adreno `rint` vs the
CPU's `nearest_int` on this driver (both are round-to-nearest-even by construction - see row
4 of the table - not device-tested).

---

## 0. VERDICT, UP FRONT: the hypothesis is refuted as stated; a refined version survives

Your hypothesis: the ~0.005-0.006 residual common to both batch shapes is carried by the
GPU's activation quantiser, which cannot reproduce the CPU's scheme.

Three findings attack it, in order of force:

1. **At `-b 1` the activation quantiser never executes.** Every one of the seven
   `kernel_quant_a_q8_1` dispatch sites in `ggml-opencl.cpp` is closed for this model on
   this device at `ne1 == 1` (and for most sites, at every shape - detail in section 1).
   The batch-1 arm runs the GEMV family with `CL_FLOAT` (f32) activation images: no int8
   quantisation, and not even the f16 transpose boundary. Yet batch 1 reads
   **0.006012** - the same band as batch 256's **0.005412**. A component that is absent in
   one of the two shapes cannot be the term *common* to both. The bitwise identity of
   stock vs full precision at `-b 1` is exactly what the dispatch predicts (both selectors
   only gate `ne1 > 8` branches); it proves the two arms are comparable, not that the
   quantiser ran.
2. **Where the quantiser does run (batch 256, 18 dense q6_K tensors), its measured sign is
   helpful, not harmful.** Same shape, same reference: dp4a + quantiser = **0.005412**,
   quantiser removed (q6_K routed to the f32 GEMM) = **0.006954**. Turning the quantiser
   OFF made the metric **0.001542 worse**. A term cannot be carrying +0.005 while removing
   it costs +0.0015.
3. **The scheme mismatch is real but bounded.** Block 32 vs 256 and the scale handling set
   a *floor* for the dp4a path (triangle bound: two nearby near-truth quantisers are
   within ~the sum of their individual errors of each other, and the f32 arm prices that
   class at ~0.007-class already) - the residual report section 12.1 row 4 reached the same
   conclusion before the fp16-scale fix convicted the cliff case instead.

**What survives (the refined hypothesis):** the common band is, on the evidence available,
(i) a *reference-side* term - the CPU quantises every activation row to int8 per 256 with a
float scale (`ggml-cpu.c:588`, loop `ggml-cpu.c:1518-1546`, `ggml-quants.c:2768`) while the
batch-1 GPU keeps f32 activations end to end, so `d(GPU, CPU)` at `ne1==1` *is* the Q8_K
floor plus GEMV residue - and/or (ii) a *weight-side/structural* term in the K-quant kernels
that exists in both shapes in kind (fp16-rounded weight sub-scales/dequantised values vs
the CPU's float), which has **never been measured on this model**. Note the consequence
that cuts against your framing in an interesting way: if (i) is right, fixing it requires
*adding* a CPU-matching quantiser to the paths that today have none (the GEMVs, the f32
GEMMs) - "aligning the quantiser" as scoped to the batched dp4a path alone can never move
the batch-1 number, because at batch 1 there is nothing there to align.

---

## 1. THE DISPATCH FACTS (load-bearing; all re-read in `main` @`833cde99b`)

Model = `LFM2.5-2.6B-Q4_K_M`, dense, 266 tensors (148 Q4_K + 19 Q6_K + 99 F32; no MoE
tensors, so the seven `kernel_moe_reorder_quant_a_q8_1` sites at `ggml-opencl.cpp:27294,
27712, 28094, 28479, 28704, 29029, 29595` never fire). Device = Adreno 740 (not X2E, not
X1E, `has_integer_dot` true).

| site | gate (file:line) | fires at `-b 1` (ne1=1)? | fires at `-b 256`? |
|---|---|---|---|
| q6_K dense dp4a + quant_a (`:23090`) | default ON for non-X1E (`:23079-23083`) AND `ne1 > 8` (`:23090`) | **NO** (ne1>8 fails; also `ne1==1` returns earlier into the GEMV branch at `:22928`) | **YES** (18 tensors; `output`/`token_embd` excluded by name `:23086-23087`) |
| q4_K dense dp4a + quant_a (`:22704`) | default `adreno_gen == X2E` (`:22686-22691`) AND `N >= 9` (`:22694-22697`) | NO (both terms false) | **NO** on A740 (X2E-only) - the 148 q4_K tensors take the f32 GEMM |
| q4_K GEMV (`:22420`) | `ne1 == 1` returns first; activation image `CL_FLOAT` (`:22442-22447`) | **YES - f32 operand, no quantiser, no f16 transpose** | no |
| q4_K `_cok` (`:22788`) | `ne1 <= 8`, default ON (`:22787-22788`) | no (GEMV returns first) | no (`ne1=256`) - runs only ne1 in 2..8; **`half8 acc` at `gemm_noshuffle_q4_k_f32.cl:428`** |
| q6_K GEMV (`:22928`) | `ne1 == 1`; activation image `CL_FLOAT` (`:22979`) | **YES - f32 operand, no quantiser** | no |
| q4_0 dense dp4a (`:20776`) | default **false** (`:20755-20758`) + `N > 8` | NO | NO (env-off; the Q4_0 control never quantises activations on GPU either) |
| q5_0 / iq4_nl / q8_0 / q5_K dense (`:21219, 21661, 21977, 23435`) | default off or X2E-only (`:21196`, iq4/q8/q5K `adreno_gen == X2E`) + `N > 8` | NO | NO |

Consequences:

- **`kernel_quant_a_q8_1` enqueue count at `-b 1` for this model = 0** (source-level
  deduction; Z1 below is the run that makes it data).
- At `-b 256` exactly **one** class quantises activations: 18 dense q6_K tensors. The 148
  q4_K tensors run `kernel_gemm_noshuffle_q4_k_f32` over the **f16-transposed** activation
  image at *both* relevant shapes (ne1 2..256; the f32-transpose arm measured this
  boundary at ~0: factorial `KALSA_GEMM_B` leg, 0.006977 -> 0.006954).
- At `-b 1` there is **no f16 activation boundary either**: GEMV activation images are
  `CL_FLOAT` (`:22443`, `:22979`) - so batch 1 is GPU near-truth (f32 operand, f32
  product/acc in the gemv macros, fp16 *format* weight scales identical to the CPU's)
  against an int8-quantised CPU reference.

## 2. WHAT THE TWO NUMBERS DO AND DO NOT PROVE

- `0.006012` (b1) and `0.005412` (b256) are measured against **different references**
  (`cpu-q4km-b1.kld` PPL 27.0660 vs `cpu-q4km.kld` PPL 27.2114 - s23 17.1/17.3). The
  "common band" is two numbers of similar size against two different baselines, not one
  proven term. The coordinator's own wording (both shapes "converge on a ~0.005-0.006
  residual band") is the strongest statement the data supports.
- Bitwise stock==full at b1 proves the q6_K selector is inert at `ne1==1`. It is an
  internal-consistency win for the dispatch model and nothing more.
- Lower bound on what the shared ops can carry: the Q4_0 control passes at
  **0.001373 / 97.413 %** through the same softmax/GDN/norms/f16-KV/f16-transpose code, and
  the 750's b1 GEMV probe hit **0.000962**. So softmax, attention, KV-write, norms, RoPE,
  SSM_CONV and the f16 operand *together* cannot exceed ~0.0014 of the band. The excess is
  Q4_K_M-specific and lives (at least mostly) in the K-quant matmul paths.
- Order-of-magnitude check on the reference-floor share (HEURISTIC, not a measurement):
  under roughly Gaussian activation statistics the amax over a 256-block exceeds the amax
  over a 32-block by ~1.3x, so `floor(Q8_K)` should be ~1.3x `floor(Q8_0)`, i.e. ~0.001-0.002
  given the control total of 0.001373 - which would leave ~0.004 of the b1 number sitting in
  the K-quant GEMV execution vs the CPU vec_dot (weight-side/structural), NOT in the
  reference floor. Heavy-tailed activations could raise the floor share; this cannot be
  settled analytically - it is exactly what Z4 measures.

---

## 3. WHAT WOULD FALSIFY THE HYPOTHESIS (pre-registered, before any build)

Each item: measurement, shape, number, predicted movement.

- **Z1 - dispatch audit (falsifies MY reading, so it goes first).** Run the existing
  instrumented binary (atomic enqueue counters, proven observationally neutral in s23 sec. 15)
  at `-b 1`. Prediction under my section 1: `quant_a=0, dp4a=0, f32=all`. If
  `kernel_quant_a_q8_1` enqueues are in fact > 0 at `ne1==1` (some gate behaves differently
  than read), the refutation in section 0 collapses and your hypothesis is back alive.
  Cost: minutes, no build beyond what exists.
- **Z2 - the forcing probe (the direct test of "the quantiser carries ~0.005").** Env-only,
  no build: `GGML_OPENCL_Q4K_DENSE_DP4A=1` at `-b 256`, default binary. This turns the
  32-block activation quantiser **on for the 148 q4_K tensors** (currently only 18 q6_K
  tensors quantise). If the scheme mismatch is the common ~0.005 carrier, the error scales
  with quantised tensor mass: 18 -> 148 is ~8x, so median KLD must rise from 0.005412 by
  **>= +0.003 (to >= ~0.0085)**. If it moves **< +0.002**, the scheme mismatch carries
  < 0.002 and cannot be the common term. **Confound to record in advance:** this probe also
  (a) skips the f16 transpose for q4_K (operand leg, already measured ~0, bounded) and
  (b) activates the fp16 `sa` sub-block sums (`quant_a_q8_1.cl:41`, consumer
  `gemm_noshuffle_q4_k_q8_1_dp4a.cl:63,135,146`) which are subject to the *next*
  flush-to-zero cliff and never run on A740 today - a large worsening would need a second
  arm with `sa` promoted to float to separate "scheme mismatch" from "sa FTZ".
- **Z3 - Q8_K-matched quantiser, dense q6_K, `-b 256`.** If you build proposal R4 below,
  pre-register: it must move median KLD by **>= -0.0005** to be worth landing,
  **-0.0015 or better** is strong support for the matching strategy, and **<= -0.0002**
  falsifies "scheme mismatch is a carrier" on the only tensors that quantise today.
  Also pre-register the ceiling: the q6_K-bearing classes (ffn_down, attn_v) measured
  ~15% of the residual each, so even a total win here caps around -0.001 to -0.0015 at
  b256, and **it cannot move the b1 number at all** (gate `ne1 > 8`).
- **Z4 - the floor discriminator (the one that decides your framing vs mine).** Build a
  `-b 1` arm whose GEMVs consume CPU-matched activation codes (proposal R5): first prove on
  a unit harness that the GPU's int8 codes bitwise equal `quantize_row_q8_K_ref` output, then
  measure. Predictions: **if** the common band is reference-floor-dominated, b1 must fall
  from 0.006012 to **<= ~0.003**; if b1 stays **>= 0.0055** with activation codes proven
  identical, the floor is falsified as the carrier and the residual is weight-side/structural
  in the K-quant kernels (dequant/order) - your activation-quantisation framing is dead in
  both its forms, and the dequantisation-of-the-weights candidate (deliverable 5) inherits
  the lead.
- **Z0 - attribution completion (gates the others).** Two `-ot` arms at b256 default,
  ffn_gate+ffn_up and shortconv.in_proj+out_proj (104 of 166 K-quant tensors never moved;
  s23 13.4 names them as untested). If any row moves **>= 40%**, a single class names the
  carrier; if all four untested rows come back **~15% +/-** like the two tested ones, the
  spread is proportional and the carrier is shared machinery/floor, not a class - which
  routes the effort to Z2/Z4 instead of a kernel fix.

---

## 4. ANYTHING THAT CONTRADICTS YOUR FRAMING (deliverable 5)

1. **"It is in something every token touches" - the quantiser is not that thing.** At b1
   zero tokens touch it (section 1). What *is* touched by every token in both shapes:
   the fp16 *format* weight scales (shared byte-identical with the CPU, so not a divergence
   source), the CPU's Q8_K reference quantisation (in the reference, not the GPU), and the
   K-quant weight-side arithmetic in whichever kernel family runs.
2. **The measured sign runs the other way.** At b256, quantised-activation dp4a (0.005412)
   beats no-quantisation f32 route (0.006954). Your own caveat - "more precise is not
   automatically closer" - is confirmed by the data, but it cuts against the hypothesis:
   the int8 path is the one *closer* to the CPU reference.
3. **Weight dequantisation is the leading SURVIVING candidate for the common term**, with
   this evidence: (a) `kernel_gemm_noshuffle_q4_k_f32.cl:63` dequantises weights into
   `half4 dequantized_weights` (f32 products of fp16-rounded values) while the CPU keeps
   `d * sv` in float (`ggml-cpu/quants.c:696+`, scale applied at `:744-749` area);
   (b) the q4_K GEMV rounds the sub-scale `d*sv` to half before use (residual report 8.2,
   `.cl:284-285`) - i.e. *some* fp16 weight-side rounding exists at BOTH batch shapes, for
   all 166 GPU tensors; (c) it has **never been measured on q4_K/q6_K on any device** -
   the 750 tested half->float dequant only for q4_0 (0.004793 vs 0.004736, +1%, in the
   stock column - `adreno-acc-type`), and the residual report lists it under NOT VERIFIED;
   (d) the class-proportional ablation spread (-14.8%, -15.7%, +0.5% over ~19%/18%/13%
   of tensors) is the signature of machinery shared by every class, which weight-side
   rounding is. Caveat against it: the Q4_0 control passes *with* fp16 weight-scale
   rounding in its kernels, so it cannot be large on average - "cannot-tell, but it is
   unmeasured and batch-common" is the honest verdict.
4. **Softmax / attention / KV / norms are bounded, not exonerated-by-argument**: the
   passing Q4_0 control ran the identical code at total 0.001373 (plus the 750 GEMV probe
   0.000962). They cannot carry 0.005 unless additivity fails badly. The f16 activation
   transpose - the one true fp16 op boundary on the GEMM path - was measured directly:
   ~0 (factorial operand leg). So "the next fp16-FTZ hazard" that *executes* is NOT in the
   common band either: after the `da` fix, the remaining FTZ-capable sites are the fp16
   `sa` (dormant unless Z2 fires it - see the confound) and the fp16 KV (common-mode,
   both arms, bounded by control). At b1 there is no fp16 activation step at all.
5. **The b1 reference itself changes with batch shape** (PPL 27.0660 vs 27.2114, s23 17.1):
   the CPU side is not bitwise shape-invariant (attention/GDN iterate the token dimension;
   llamafile sgemm status unverified). So part of any b1-vs-b256 difference can be
   reference-side, and "common term" comparisons across the two shapes carry this caveat.
6. **One anomaly nobody has explained**: the full-precision f32 route (0.006954) is
   *worse* than the int8 quantised route (0.005412) at the same shape - 0.001542 apart with
   replicate noise ~bitwise. If activations-only explain it (f16 operand: measured ~0;
   CPU floor: present in both), something in the f32-route *execution* (transpose-to-image
   path, K-reassociation in the main GEMM) adds error the linear-buffer dp4a path does not.
   Worth one arm before any of this is attributed cleanly: `KALSA_GEMM_B=float
   KALSA_Q6K_DENSE=f32` already exists (factorial cell 0.006954) vs default 0.005412 - the
   delta is real and unattributed.

---

## 5. DIFFERENCE TABLE: GPU activation quantiser vs the CPU reference

GPU = `quant_a_q8_1.cl` (as shipped on the phone: `KALSA_Q8A_SCALE` default fp32 for
`da`, per `87f31d81f`; `sa` unchanged = fp16). CPU = `quantize_row_q8_K_ref`,
the quantiser behind every Q4_K/Q6_K vec_dot (`ggml-cpu.c:509` and `:525`,
`.from_float = quantize_row_q8_K` at `ggml-cpu.c:588`, conversion loop
`ggml-cpu.c:1518-1546`). "Common" = present in BOTH batch shapes for this model on A740.

| # | axis | CPU reference (file:line) | GPU quantiser + consumer (file:line) | systematic batch-independent ~0.005 KLD? verdict |
|---|---|---|---|---|
| 1 | block size | **256** (`QK_K`), loop `ggml-quants.c:2770,2776` | **32** (`base = blk*32`, `quant_a_q8_1.cl:19`; consumer `k_b = k>>5`, q6 dp4a `:75`) | **NO as the common term** - not executed at b1 (section 1); at b256 removing it *raises* KLD 0.005412->0.006954. As a b256-only floor contributor: **plausible yes up to ~0.001-0.002** (triangle bound, residual report 12.1#4), cannot-tell until Z3 |
| 2 | scale format + storage | `float d` in `block_q8_K` (`ggml-common.h:370-375`), `y[i].d = 1/iscale` f32 (`ggml-quants.c:2802`) | `da[blk] = (half)d` (`quant_a_q8_1.cl:40`, stock tree; fp32 on the phone line), buffer `prealloc_moe_da` sized `cl_half` (`ggml-opencl.cpp:23099`) | **YES in principle - this exact axis produced the 73x error** (fp16 FTZ below amax ~0.0078: `127 * 2^-14 = 0.0078`; `CL_DEVICE_HALF_FP_CONFIG=0x16`, DENORM=0). But: fixed for the only executing consumer (dense q6_K, `87f31d81f`), **and absent at b1** -> after the fix, **NOT the common term**; residual plain-fp16 rounding bounded ~0.0005-class, and 6 dense + 7 MoE arms + 2 unrebuildable precompiled binaries still fp16 (coder's own list) - dormant, not common |
| 3 | sub-block structure | one `d` per 256 + `bsums[16]` **int16** per 16 (`ggml-quants.c:2795-2800`; struct `ggml-common.h:374`) | `sa = (half)(d*sum32)` per 32 (`quant_a_q8_1.cl:41`); q6 consumer uses ONLY `da` (`gemm_noshuffle_q6_k_q8_1_dp4a.cl:48,106,122-123`), q4 consumer uses `da`+`sa` (`gemm_noshuffle_q4_k_q8_1_dp4a.cl:62-63,134-135,146`) | consumer application of `d` per 32 vs per 256 = row 1, same verdict. **`sa` specifically: NO - not executing** (q4_K dp4a is X2E-only, `ggml-opencl.cpp:22686-22691` + `:22694-22697`); it becomes live only under the Z2 forcing probe, where it is the named confound (its own FTZ cliff: `|d*sum| < 6.1e-5` flushes the min-term) |
| 4 | rounding mode | `nearest_int` = float magic-number add on a 1.5*2^23 grid (`ggml-quants.c:621-626`), round-to-nearest-even | `rint` (`quant_a_q8_1.cl:35`), round-to-nearest-even under default FP mode; `id = 127/amax` (`:30`) is the exact negation of CPU `iscale = -127/max` (`ggml-quants.c:2790`) for `amax = |max|`, and `rint` is odd-symmetric | **NO.** Both round-to-nearest-even; the magnitudes feed identical values up to one float division's rounding. Tie/corner differences are ~1 count in ~10^6 -> orders below 0.005. (The residual report's "ties-away" characterization of `nearest_int` does not match the source I read; either way it is tie-only.) |
| 5 | saturation / clamping | explicit `MIN(127, v)` (`ggml-quants.c:2793`); no lower clamp | no clamp (`quant_a_q8_1.cl:35-36`) - but `|v*id| <= 127` by construction of `id` from the block amax, and the CPU's `MIN(127,.)` is unreachable beyond the same bound | **NO.** Both schemes bound codes to [-127,127] by construction; the clamp only catches float-rounding at exactly 127. |
| 6 | `da`/`sa` split + sign convention | signed max: `iscale = -127/max` (`ggml-quants.c:2790`), one struct `{float d; int16 bsums[16]; int8 qs[256]}` (`ggml-common.h:369-375`) | unsigned amax (`quant_a_q8_1.cl:29-30`), three flat buffers `qa/da/sa` (no block struct - coordinator's inventory) | Sign: **NO** - `id = -iscale` exactly, `rint(-x) = -rint(x)`, codes identical; cancels in the product too (residual report 12.1#4 agrees). Layout: NO - flat vs struct is irrelevant to value; the dtype/block consequences are rows 1-3. |
| 7 | FTZ / subnormal hazard inventory ("the next one") | CPU scale is `float` - no FTZ at any plausible magnitude (`ggml-quants.c:2802`); CPU activations never narrowed (`ggml-cpu.c:1518-1546` reads f32) | (a) `da` fp16 cliff amax<0.0078 - KNOWN, fixed for dense q6_K; (b) `sa` fp16 cliff - dormant (row 3); (c) f16 activation transpose `write_imageh` (`transpose.cl:139-141`, half activation images at `ggml-opencl.cpp:22653` q4_K and `:23153` q6_K) - executes for q4_K at ne1 2..256, **NOT at b1** (GEMV = `CL_FLOAT`, `:22443`, `:22979`), and measured ~0 (factorial operand leg 0.006977->0.006954); (d) fp16 KV - common-mode with the CPU reference (same cache type both arms), bounded by the Q4_0 control 0.001373 | **After the `da` fix: NO executing FTZ hazard of this family is common to both batch shapes.** The b1 arm has no fp16 activation step at all. The next one *of that kind* that could still fire is (b), and only if the q4_K dp4a is force-enabled (Z2) - arm Z2 with `sa` in fp32 or read its result with that confound named. |

---

## 6. RANKED PROPOSALS (deliverable 3), each with its cost and its speed effect

The speed result to protect: default config (`1577495b9`, q6_K dp4a + fp32 `da`) =
**76.36-76.44 t/s**, i.e. the -9.9% (75.94 -> 68.42) is already recovered by shipping the
dp4a route. No proposal below may move q6_K off dp4a; anything that does is listed under
"do not".

| rank | proposal | what it changes | cost (build / phone) | speed effect | expected KLD movement (pre-registered) |
|---|---|---|---|---|---|
| **R1** | **Complete the `-ot` attribution**: ffn_gate+ffn_up, shortconv.in_proj+out_proj -> CPU, b256 default (Z0) | nothing - measurement only; closes the 104/166 untested-tensor gap named in s23 13.4 | 0 build (binary exists), 2 arms x ~2-6 min | **none** (not a landing change) | informative either way: >=40% names a carrier; ~15% each confirms shared-machinery/floor and demotes all per-class kernel work |
| **R2** | **Two env/instrumented probes**: instrumented counters at `-b 1` (Z1) + `GGML_OPENCL_Q4K_DENSE_DP4A=1` forcing probe (Z2, with `sa`-fp32 companion arm if it worsens) | nothing - env vars on existing binaries | 0 build beyond what exists, 2-4 arms x ~1-4 min | **none** | Z1 prediction `quant_a=0`; Z2 prediction under your hypothesis >= +0.003, under my analysis < +0.002. This is the cheapest direct kill of either story |
| **R3** | **half->float weight-side dequant in the K-quant kernels** (attacks the leading surviving candidate, deliverable 5.3): `half4 dequantized_weights` (`gemm_noshuffle_q4_k_f32.cl:63`, `gemm_noshuffle_q6_K_f32.cl:47`-area on the phone line post-`914b34a7e`) and the gemv `d*sv` half sub-scale -> float | 2-3 kernels behind a `KALSA_*` selector (precedent `KALSA_GEMM_PREC 7ef9389bc`); b1 AND b256 arms | one build + 2-4 arms; **speed: unknown-small** (register pressure in the f32 GEMM, negligible in gemv) - must rebench pp256 and decode before landing; **does not touch dp4a routing**, so the 76.4 t/s default is preserved unless this is adopted for the q4_K GEMM, and then only the operand-leg-sized cost is at risk | >= -0.0015 at both b1 and b256 would confirm the common weight-side term (and it is the ONLY candidate that moves b1 without adding a quantiser); < -0.0005 at both -> drop it permanently |
| **R4** | **Q8_K-matched activation quantiser for the dense q6_K dp4a** (your example, scoped honestly): block **256**, `float` scale, CPU's `iscale`/`nearest_int` semantics (row 4 shows rounding already matches; row 6 shows sign cancels), one `da` per superblock; consumer already applies the weight scale per 16 (`scale0/scale1`, q6 dp4a `:84-85`), so only the `da` indexing changes (`sub` -> `sb_idx`), plus host buffer sizing `N*(K/256)*sizeof(float)` | `quant_a` variant + q6 consumer `da` read + 2 host allocation sites, one selector (the `KALSA_Q8A_SCALE` pattern already exists) | **keeps dp4a: speed stays at 76.4 t/s** (quant pre-pass cost essentially unchanged; no transpose, no f32 GEMM) - the -9.9% stays recovered | Z3: >= -0.0005 land it, <= -0.0002 drop it. **Ceiling: touches only the 18 q6_K tensors (~15-30% of the residual); cannot move b1 (gate `ne1 > 8`) - it can never alone make the b1 arm pass** |
| **R5** | **CPU-matched activation quantisation on the paths that run at BOTH shapes** (GEMV pre-pass + f32 GEMM pre-pass, per-256, harness-verified bitwise-equal to `quantize_row_q8_K_ref`) - the only proposal that can move the b1 number, because at b1 alignment must be *added*, not fixed | new pre-pass on GEMV + f32 GEMM families (~4-6 kernel consumers + host), the largest build here; gated on R1/R2/Z4 pointing at the floor rather than weight-side | decode speed at risk (GEMV pre-pass overhead) -> must bench decode AND prefill; **b256 prefill dp4a untouched -> the -9.9% recovery is preserved** | Z4: b1 0.006012 -> <= ~0.003 = floor confirmed, gate reachable by matching (then extend to q4_K at b256); b1 stays >= 0.0055 = floor falsified, abandon R5, weight-side (R3) inherits |
| **do not** | route q6_K back to the f32 GEMM "for precision" | - | - | **gives back the -9.9%** and is measured *worse* (0.006954 vs 0.005412) | - |
| **do not** | global `q8a_t` f32 promotion across 14 `.cl` + 14 host sites (coordinator's inventory) | obsolete for `da` (fp32 default ships); `sa` promotion only matters if/when q4_K dp4a is enabled (X2E or R2 forcing) - do it then, scoped | - | - | - |
| **do not** | chase softmax/attention/KV as the *common* term | bounded by the passing Q4_0 control at **0.001373 total** (same code, same device); the app-KV config is a *separate* product question with its own measured numbers (0.010268, s23 24) | - | - | - |

## Z1 counters RESULT

**Pre-registration (Z1, §3):** “Run the existing instrumented binary (atomic enqueue counters, proven observationally neutral in s23 sec. 15) at `-b 1`. Prediction under my section 1: `quant_a=0, dp4a=0, f32=all`.” The registered falsifier is any `kernel_quant_a_q8_1` enqueue at `ne1==1`.

**Observed:** at `-b 1`, median KLD was **0.006012**. The instrument emitted `ggml_opencl[instrument]: dense q6_K batch GEMM executions: dp4a=0, f32=0 (KALSA_Q6K_DENSE)`. This is zero dense q6_K batch-GEMM executions. The `c6b45aaa4` instrument reports only those dense batch-GEMM counters; its output has no `quant_a` enqueue count and does not count the `ne1==1` GEMV f32 path. Thus `dp4a=0` is consistent with the registered prediction, but this run cannot establish `quant_a=0` or `f32=all` from the emitted counters. **Verdict: INSTRUMENT-LIMITED; the registered quant_a falsifier remains unobserved.**

The host-restored original instrument binary matched the registered SHA-256 `108dfcd41c6d660f92e99bd75c9b38108ace7b7f1bcb908bb7bed6a3d8504cad`; it was pushed under the new device name `llama-perplexity-instr-z1-c6b45aaa4`, whose device SHA-256 matched. No build was performed. The successful run used the registered model, corpus and b1 reference with `-c 256 -b 1 -ngl 99 -fa off -s 42 --temp 0 --kl-divergence` and returned rc=0. A prior attempt exited rc=1 after three chunks without a counter line; those partial files are retained separately. The complete run was retried after the cool-down gate.

Successful-run start bracket: 30%, charge counter 1,170,000 µAh, 32.7 °C, thermal status 0, AC/USB/wireless false, Dozing. End bracket: 24%, charge counter 926,250 µAh, 37.5 °C, thermal status 1, AC/USB/wireless false, Dozing. `adsprpcd`, `pm-proxy`, and `heatmap` were each 7% CPU in both brackets. The thermal watcher recorded no stop gate; the battery remained above 22%.

Raw files: `raw/z1-original-binary-host-sha.txt`, `raw/z1-binary-push.txt`, `raw/z1-binary-push-exit.txt`, `raw/z1-device-binary-sha-and-inputs.txt`, `raw/z1-counters-success.log`, `raw/z1-counters-success.err`, `raw/z1-device-success-exit.txt`, `raw/z1-host-runner-r4-exit.txt`, `raw/z1-retry2-start-bracket.txt`, `raw/z1-success-end-bracket.txt`, `raw/z1-thermal-watchdog-retry2.log`, partial attempt `raw/z1-counters.log`, `raw/z1-counters.err`, `raw/z1-device-exit.txt`, and scripts `raw/run-scripts/z1-probe-device-r4.sh`, `raw/run-scripts/z1-bracket.sh`, `raw/run-scripts/z1-thermal-watchdog.sh`.

File inventory (`ls -la`; `wc -l`):
-rw-r--r-- 1 marco staff 178 raw/z1-original-binary-host-sha.txt
-rw-r--r-- 1 marco staff 177 raw/z1-binary-push.txt
-rw-r--r-- 1 marco staff 2 raw/z1-binary-push-exit.txt
-rw-r--r-- 1 marco staff 438 raw/z1-device-binary-sha-and-inputs.txt
-rw-r--r-- 1 marco staff 3087 raw/z1-counters-success.log
-rw-r--r-- 1 marco staff 33728 raw/z1-counters-success.err
-rw-r--r-- 1 marco staff 2 raw/z1-device-success-exit.txt
-rw-r--r-- 1 marco staff 2 raw/z1-host-runner-r4-exit.txt
-rw-r--r-- 1 marco staff 626 raw/z1-retry2-start-bracket.txt
-rw-r--r-- 1 marco staff 614 raw/z1-success-end-bracket.txt
-rw-r--r-- 1 marco staff 40514 raw/z1-thermal-watchdog-retry2.log
-rw-r--r-- 1 marco staff 530 raw/z1-counters.log
-rw-r--r-- 1 marco staff 33637 raw/z1-counters.err
-rw-r--r-- 1 marco staff 2 raw/z1-device-exit.txt
-rwxr-xr-x 1 marco staff 625 raw/run-scripts/z1-probe-device-r4.sh
-rwxr-xr-x 1 marco staff 576 raw/run-scripts/z1-bracket.sh
-rwxr-xr-x 1 marco staff 1918 raw/run-scripts/z1-thermal-watchdog.sh
       1 raw/z1-original-binary-host-sha.txt
       1 raw/z1-binary-push.txt
       1 raw/z1-binary-push-exit.txt
       4 raw/z1-device-binary-sha-and-inputs.txt
      58 raw/z1-counters-success.log
     204 raw/z1-counters-success.err
       1 raw/z1-device-success-exit.txt
       1 raw/z1-host-runner-r4-exit.txt
      23 raw/z1-retry2-start-bracket.txt
      23 raw/z1-success-end-bracket.txt
     202 raw/z1-thermal-watchdog-retry2.log
       6 raw/z1-counters.log
     203 raw/z1-counters.err
       1 raw/z1-device-exit.txt
      10 raw/run-scripts/z1-probe-device-r4.sh
       9 raw/run-scripts/z1-bracket.sh
      29 raw/run-scripts/z1-thermal-watchdog.sh
