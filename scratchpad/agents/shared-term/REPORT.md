# REPORT - shared-term: where can the common ~0.005-0.006 residual live?

Explorer cell, read-only against source and archived reports. One file written (this report).
No sub-agents, no phone contact, no code changes.

## 0. PROVENANCE AND WHAT I COULD NOT VERIFY

Sources read: `s23-kld-740-q4-0/REPORT.md` (sections 13, 14, 15, 17, 22-27, 16.4 in full),
`quant-alignment/REPORT.md` (all 253 lines), `residual-after-q6k-route/REPORT.md` (all 791
lines), `q8a-subscale/REPORT.md` (sections 1-6 as written so far).

Code: `/Users/marco/Projects/kalsallama`, line numbers taken from the HEAD blob `833cde99b`
via `git show HEAD:<file> | grep -n`, because the WORKING TREE has uncommitted edits
(`ggml-opencl.cpp` differs by +244 lines, `git diff --stat`: 264 insertions - working-file
lines do not match HEAD). Kernel `.cl` files byte-compared HEAD vs the shipped commit
`1577495b9` (same commit object exists in this clone): SAME for `gemm_noshuffle_q4_k_f32.cl`,
`gemm_noshuffle_q6_K_f32.cl`, `gemv_noshuffle_q4_k_f32.cl`, `gemv_noshuffle_q6_K_f32.cl`,
`add.cl`, `rms_norm.cl`, `softmax_f32.cl`, `rope.cl`, `mul_mm_f16_f32_kq_kqv.cl`,
`transpose.cl`, `gemm_noshuffle_q4_0_f32.cl`; DIFF only for
`gemm_noshuffle_q6_k_q8_1_dp4a.cl` (the `da` half->q8a_t fix, HEAD `b4c9ddb57676` vs ship
`22c3d360962e`). `ggml-cpu.c`, `ggml-quants.c`, `common/common.h` are byte-identical
HEAD vs ship, so their line numbers are valid for both.

COULD NOT VERIFY from here: anything on the phone (this is source + archive only); the
actual enqueue counts at `-b 1` (source says zero; Z1 was never run for me); the true floor
value itself (heuristic vs transitive bound disagree, section 2); whether the driver lowers
any f32 kernel to fp16 internally on E031.41 (no device disassembly); the `sa`-fp32 twin
result (q8a-subscale build in flight); the full-corpus matched f16+fa-on reference cell
(still generating); ship-line `ggml-opencl.cpp` line numbers (I cite HEAD; ship-side
equivalents quoted by q8a-subscale where they matter: q6_K site `:23238`, q4_K site
`:22840`, `KALSA_Q8A_SCALE` selector `:1569-1583`).

## 1. THE CONSTRAINTS AS A FILTER (numbers as archived)

| constraint | number (source) | what it kills |
|---|---|---|
| b1 probe: stock == full, bitwise | 0.006012 / 93.138 % both arms (s23 17.3) | anything that exists only at ne1>8 cannot be the band |
| quantiser never executes at b1 | 7 dense sites, all gated `ne1 > 8` / X2E / env-off: HEAD `ggml-opencl.cpp:22454` (q4_K, plus X2E default `:22440-22447`), `:22846` (q6_K), GEMV returns first `:22176` (q4_K) / `:22684` (q6_K); GEMV activation images `CL_FLOAT` `:22388` and `:22684+51` | the quantiser-as-common-carrier hypothesis (quant-alignment refutation, adopted) |
| quantiser sign where it runs | 0.005412 (on) vs 0.006954 (routed off) = +0.0015 when removed (s23 22/13) | quantiser-as-harm at its shipping scope |
| -ot matrix, FULL-config baseline 0.006954 | attn proj -14.8 %, ffn_down -15.7 %, F32 conv +0.5 % (s23 13) | one-class-carries-it, for those classes |
| -ot probes, SHIP-config baseline 0.005412 | gate/up -1.4 % (60 tensors), conv-proj +1.5 % (44) (s23 27) | one-class-carries-it for the 104 previously-untested tensors; also bounds 104 pure-Q4_K + 22 F32 offload at ~0 |
| forced q4_K dp4a (Z2) | KLD 5.103422, PPL 2556 (s23 27) | "the path is imprecise" reading; it is broken; attribution blocked on sa-fp32 twin (q8a-subscale) |
| KV term | +0.001493 full matched, +0.004754 reduced matched (s23 24/26) | nothing killed; magnitude open, orientation-dependent |
| FA term, matched | +0.000916 (s23 26.2) | FA as a carrier |
| Q4_0 control, same phone/binary/protocol | 0.001373 / 97.413 % PASS (s23 5-6) | any op shared with Q4_0 jointly > ~0.0014 |

Two caveats carried forward, both already on record: (a) b1 and b256 numbers are scored
against different references (PPL 27.0660 vs 27.2114, s23 17.1), so "the band" is two
numbers against two baselines (quant-alignment section 2); (b) the -ot matrix is
half-filled per config: attn/ffn_down/F32conv rows ran on the FULL-precision config,
gate/up/conv-proj rows ran on the SHIP config - no config has all four quant classes
offloaded, so cross-row comparisons mix configs (flagged, not hidden).

## 2. THE ALGEBRA THAT SIZES THE CANDIDATES (my analysis, marked inference)

Three transitive bounds, each from archived measurements only:

1. CONTROL BOUND (measured): every op shared with the Q4_0 run (softmax, RMSNorm, RoPE,
   SSM_CONV, residual adds, f16 KV, f16 transpose machinery, shared driver lowering under
   `-cl-fast-relaxed-math`) is jointly <= 0.001373. Cannot carry 0.005 unless additivity
   fails badly.
2. OFFLOAD BOUND (measured): the GPU-side error of 104 pure-Q4_K tensors (gate/up,
   conv-proj, ship config) + 22 F32 conv tensors is ~0 (-0.000077 / +0.000083 /
   +0.000037). Q4_K weight-side fp16 rounding, f16 operand, and kernel order for those
   classes are therefore <= ~0.0005-0.001 combined. A corollary: no GROSS driver
   miscompile exists on the default Q4_K kernels (offload would have moved a lot).
3. b1 BOUND (measured + source): at b1 the GPU is near-truth (f32 GEMV operands/products/
   accumulators, CPU-matching q6_K GEMV weight side), shared ops are <= 0.0014 by (1),
   Q4_K GEMV rounding is <= its GEMM-class value by (2), yet the number is 0.006012. The
   remainder must sit in what b1 shares with b256 and the control does NOT share: the CPU
   reference's own Q8_K activation quantisation (per-256, f32 scale) and CPU execution.

Inference: the band is dominated by the REFERENCE side (est. 0.003-0.005), with GPU-side
tails at ~0.001-0.0015 total. This CONFLICTS with quant-alignment's heuristic (amax over
256 vs 32 ~1.3x -> floor ~0.001-0.002): both are inference, neither is a measurement, and
the conflict is exactly what the Z4 discriminator decides. Note the arithmetic consequence
if the heuristic is right: b1's 0.006 would be unexplained by any bounded GPU-side term,
so the two readings MUST be separated before the next build spends effort on kernels.

Also unresolved, carried from the anomalies: the +0.0015 "quantiser helps" delta is
confounded. Route-off (f32 GEMM) simultaneously REMOVES the activation quantiser and
ENGAGES `half4 dequantized_weights` in `gemm_noshuffle_q6_K_f32.cl:40` (stock HEAD, half
accumulator too: `half8 c0` `:38`). The FULL-config -ot rows show the two Q6_K-containing
classes carrying -0.00103 / -0.00109 while the pure-Q4_K classes carry ~0 - i.e. about
0.0015-0.002 sits on exactly the tensors the route swap touches. So "quantiser helps
+0.0015" and "q6 f32-route half4 dequant costs +0.0015" fit the SAME data. One arm splits
them (R3 readout, ranking entry 3).

## 3. THE TABLE - surviving and ruled-out candidates

Refs: file:line at HEAD `833cde99b` unless marked (ship `1577495b9`). "Both shapes" =
executed at b1 AND b256 in the SHIP default. Control = the Q4_0 pass at 0.001373.

| # | candidate | code site | both batch shapes? | does the Q4_0 control rule it out? | verdict / evidence | cheapest measurement that would move it |
|---|---|---|---|---|---|---|
| 1 | f16 activation conversion (the transpose to half images) shared by the matmuls | `transpose.cl:139-142` `write_imageh`; half image `ggml-opencl.cpp:22409` (q4_K), `:23151` (q6_K); GEMV images are `CL_FLOAT` `:22388` (q4_K), `:22684+51` (q6_K) | NO - absent at b1 entirely (GEMV reads f32 images) | control irrelevant: measured directly - operand leg 0.006977 -> 0.006954 (~0.03 %), and 750 `adreno-operand-b` refuted it | RULED OUT as the band term (cannot be common to both shapes; ~0 where it runs). Contributes <= ~0.0001 at b256 | none needed - it has been measured (factorial `KALSA_GEMM_B` leg) |
| 2 | accumulation width | executing paths are all f32: q4_K GEMM `float8 c0` `gemm_noshuffle_q4_k_f32.cl:61`; q6_K dp4a `float4 acc` + exact int32 dots (ship dp4a `.cl` `scale0*raw` f32, HEAD `:84-85,116-118`); GEMV `float2 total_sum` (`gemv_noshuffle_q6_K_f32.cl:219`, q4_K macros `:34-71`); half forms: `_cok` `half8 acc` `gemm_noshuffle_q4_k_f32.cl:428` and q6 f32-route `half8 c0` `:38` / `:182` | the f32 widths: YES (both shapes); the half forms: NEITHER shape (`_cok` runs only ne1 in 2..8; q6 f32 GEMM not in ship config, `KALSA_Q6K_DENSE=dp4a` default) | control runs the same width family and passes; 750 ALIVE 57 refuted f16-accumulator class | RULED OUT for the band. Blind spot kept alive: `half8 acc` at ne1 2..8 is default-ON (`q4k_gemm_cok`, `ggml-opencl.cpp:22176` family) and covers app tail chunks only | product-coverage, not band: one `-b 8` arm + regenerated b8 reference (~15-20 min phone, commands in residual 8.3) |
| 3 | accumulation order / tile geometry | K-loop order `gemm_noshuffle_q4_k_f32.cl:96-141`, workgroup tiles set at dispatch `ggml-opencl.cpp` (q4_K `:22454` region, q6_K `:22846` region); GEMV subgroup reduce | YES (order differs from CPU at both shapes) | partially: control bounds shared idioms; but q4_K/q6_K kernels are not the control's kernels | BOUNDED OUT by analysis: f32 reassociation over K=2048 is ~sqrt(K)*eps ~ 3e-6..1e-4 relative - two orders under what 0.005 needs. Residual risk = driver miscompile (E031.41 precedent `ggml-opencl.cpp:9456-9459`), but offload bound (section 2.2) kills gross miscompile on Q4_K paths | no cheap direct arm exists; cheapest indirect: R3 variant doubles as a kernel-fidelity check (entry 3) |
| 4 | RMSNorm / RoPE / softmax (and SSM_CONV) | `rms_norm.cl:84` `1.0f/sqrt(mean+eps)`; `softmax_f32.cl:91` `exp(...)` + `sub_group_reduce`; `rope.cl:26` cos/sin; `ssm_conv.cl` f32; all compiled under `-cl-fast-relaxed-math` `ggml-opencl.cpp:1484-1486` (so sqrt/exp may lower to approximations) | YES - all run at both shapes | YES, JOINTLY: the identical programs ran in the passing control at total 0.001373 | NOT the carrier (bounded <= ~0.0014 joint by the control); survives only as a <=0.001 tail. NOT exonerated per-op, bounded | optional low-yield build: strip fast-math from shared-op programs behind an env; falsifier pre-written in the ranking (entry 5) |
| 5 | KV write/read conversions | defaults f16/f16 `common/common.h:341-342`; read is value-preserving bit-cast `mul_mm_f16_f32_kq_kqv.cl:25-28` | YES - both band arms write/read f16 KV, and so did the control | YES for f16 KV: control passed with the same code -> f16 KV is common-mode, bounded | f16 KV: NOT a band term (both sides round the same values; bounded). QUANTISED KV (q8_0/q4_0): not present in any band arm (s23 25.3 matched-f16 audit) - it is a separate overlay term, +0.0015..+0.0048, orientation-dependent | the full-corpus matched f16+fa-on bridge cell, already generating (s23 26.3 blocked list) |
| 6 | per-layer residual adds | `add.cl` `kernel_add` (f32 load, f32 add, f32 store, HEAD `:55-60`); dispatch `ggml_cl_add` `:14802`, case `:9585`; fusion guard requires `final_add` type F32 `:8156` | YES | YES - identical code passed inside 0.001373 | RULED OUT as a divergence source: IEEE f32 add on both sides cannot create error for identical inputs; any delta here is inherited upstream, not new | none - ruled out by source (strongest form) |
| 7 | dequantisation of Q6_K (18 in-model GPU tensors; tied token_embd is CPU both arms) | ship b256 = dp4a: `gemm_noshuffle_q6_k_q8_1_dp4a.cl` (ship blob `22c3d360`) weights stay int until after the dot, `dd` = widened fp16 FORMAT scale (HEAD `:82-85,116-118`) = exactly what CPU widens with `GGML_CPU_FP16_TO_FP32`; ship b1 = GEMV: `gemv_noshuffle_q6_K_f32.cl:19-54` float products, half2 format scale, exact int8 sub-scales | the fp16-DEQUANT form: NO (it exists only in `gemm_noshuffle_q6_K_f32.cl:40` `half4 dequantized_weights` + `:38` half acc, which ship never executes); the ship forms: YES, and they are CPU-matching on the weight side | tied lm_head runs on CPU in both arms (adds nothing); control has only the CPU vocab Q6_K | RULED OUT as an fp16-dequant carrier in the SHIP config at both shapes (source-level). Its non-ship form is the live candidate for the -0.0015 route anomaly (entry 3 readout). CAUTION: the Q6_K dp4a ACTIVATION-side (scheme + execution) is a separate survivor - row 8b | dequant side: R3 half->float arm on the q6 f32 kernel splits the anomaly; activation side: R4 (entry 1) |
| 8a | SURVIVOR: reference-side CPU activation quantisation (Q8_K, per-256, f32 scale) - the floor | `ggml-cpu.c:509` (Q4_K) and `:525` (Q6_K) `vec_dot_type = GGML_TYPE_Q8_K`; conversion loop `:1468-1546`; `ggml-quants.c:2768-2802` (`iscale=-127/max`, `nearest_int`, f32 `y[i].d`) | YES - it is in the reference both shapes are scored against; batch-independent by construction; non-per-tensor by construction | NO - the control's reference uses a DIFFERENT scheme (Q4_0 -> `vec_dot_type Q8_0`, per-32, half scale, `ggml-cpu.c:426`), so 0.001373 bounds only the Q8_0 floor, never Q8_K | THE sized candidate: b1 near-truth GPU still 0.006012 (section 2 bound 3); conflicts with the 1.3x amax heuristic (quant-alignment) which says only 0.001-0.002 - UNRESOLVED, inference on both sides | Z4 floor discriminator: b1 arm whose GEMVs consume harness-verified CPU-matched activation codes. Kill line: b1 >= 0.0055 with codes proven identical -> dead; support: <= 0.003 |
| 8b | SURVIVOR (b256-only, explicitly NOT the band): q6_K dp4a activation scheme + execution on the 18 tensors | `quant_a_q8_1.cl:19` (32-block), `:35` `rint`, `:49` `sa` half (HEAD; ship `da` is f32 per `87f31d81f`) vs CPU per-256; consumer `gemm_noshuffle_q6_k_q8_1_dp4a.cl` (ship blob) | NO - at b1 the GEMV runs with no quantiser (this is why stock==full bitwise) | NO - the control has no dp4a path, nothing bounds it | alive for the b256 metric: FULL-config Q6_K-containing classes carry -0.0015..-0.002 combined while pure-Q4_K classes carry ~0; Z2 shows a FORCED sibling dp4a path is broken (5.10), so this driver's dp4a family carries live risk; the ship q6_K dp4a class has never been offloaded in the SHIP config | R4: Q8_K-matched quantiser (block 256, f32 scale, CPU `iscale`/`nearest_int` semantics), one build, one b256 arm; Z3 thresholds already pre-registered |
| 8c | SURVIVOR: Q4_K two-level fp16 scale rounding (d*sv then dequant value) | GEMM: `gemm_noshuffle_q4_k_f32.cl:88-89` `convert_half4(d*sv)` + `:63,:98-101` `half4 dequantized_weights` store; GEMV: `gemv_noshuffle_q4_k_f32.cl:284-285` (also `:434/:545/:724`) | YES - GEMM form at b256, GEMV form at b1, on all 148 Q4_K tensors in the ship default | PARTIAL: the control runs the single-level analogue (`gemm_noshuffle_q4_0_f32.cl:45,:66-69`) and passes, which bounds the single-level version jointly at 0.001373; the two-level K-quant version is unmeasured on every device (750 tested q4_0 dequant only) | alive but evidence-damped: offload of 104 pure-Q4_K ~0 caps a uniform per-tensor share at ~0.0005-0.001; it cannot be the >=0.004 carrier alone unless error concentrates in the never-offloaded attn/ffn_down Q4_K rows | R3: half->float dequant behind a `KALSA_*` selector in q4_K GEMM + GEMV (+ q6 f32 GEMM for the anomaly), one build, b1 and b256 arms |
| 9 | RULED OUT tonight: per-class weight axis | - | - | - | four -ot rows: -14.8 %, -15.7 %, -1.4 %, +1.5 % - no row >= 40 %, 63 % of mass ~0; single-class reading falsified twice (s23 13, 27) | do not rebuild per-class offload work |
| 10 | RULED OUT tonight: q4_K dp4a clamp/imprecision | `ggml-opencl.cpp:22454` env-forced | forced only | n/a | KLD 5.103422 = broken, not imprecise (Z2); attribution BLOCKED on the sa-fp32 twin (q8a-subscale commit `f0811bd31`, consumer hardwired `half*` on that path) | wait for the q8a-subscale twin arm; no other build informs this |
| 11 | RULED OUT: flash attention as carrier | matched measurement | both (fa-on arms exist) | n/a | +0.000916 matched (s23 26.2) | none |

## 4. RANKING - movement on the metric (ship-default protocol, baseline 0.005412 / 93.982 %) per unit of work, with the falsifying number written NOW

1. **R4 - Q8_K-matched activation quantiser for the dense q6_K dp4a (entry 8b), the first
   slice of the floor-alignment strategy.** Ceiling -0.001..-0.0015 (Q6-class offload signal
   + Z3), work = one quantiser variant + consumer `da` indexing + host buffer sizing + one
   selector (precedent: q8a-subscale touched 6 files / 145 lines), dp4a kept so 76.4 t/s is
   untouched, and it acts at b256 = the metric's shape. Best movement-per-work of anything
   that can start tonight. **FALSIFIER: median KLD drop <= -0.0002 at b256 (lands >=
   0.005212) -> dead (Z3 line); -0.0002..-0.0005 = weak, do not land; >= -0.0015 = strong.**
   Validity check in the same run: b1 must NOT move (> +/- 0.00005 movement at b1 means the
   build perturbed shared code -> result void, gate `ne1 > 8` makes b1 immune by design).
2. **R5 - the reference floor itself (entry 8a): CPU-matched activation codes on the paths
   that run at BOTH shapes (GEMVs first, then the q4_K f32 GEMM), entered via the Z4
   discriminator.** Largest ceiling in the map (-0.003..-0.004 = the only candidate sized
   to clear BOTH gate limbs alone), but the largest build (new pre-pass on 4-6 consumers +
   host, harness proof of bitwise-equal codes, decode AND prefill rebench) and its size is
   contested by the 1.3x heuristic - hence it ranks second per unit of work and its
   discriminator runs before any full build. **FALSIFIER: with harness-proven identical
   activation codes, b1 stays >= 0.0055 (from 0.006012) -> the floor is not the carrier,
   R5 abandoned outright; support: b1 <= 0.003 (floor >= half the band), then b256 slice
   support <= -0.001.** If this falsifier fires, entry 8c and driver-execution suspicion on
   the q6 dp4a path inherit the lead and the gate may be unreachable by kernels (say so
   before building).
3. **R3 - half->float weight-side dequant in the K-quant kernels (entries 8c + the q6
   f32-route form).** Cheapest build (2-3 kernels behind a `KALSA_*` selector, the
   `KALSA_GEMM_B` pattern), both shapes, and it is the only arm that splits the -0.0015
   anomaly: readout = q6 f32-route landing <= 0.0059 (from 0.006954) means the anomaly was
   its `half4` dequant (ship unaffected, R4's ceiling rises); staying >= 0.0065 means the
   matched-quantiser reading was right. Ceiling on the ship metric is small by the offload
   bound (~-0.0005, maybe -0.001 if error concentrates in the never-offloaded attn/ffn_down
   Q4_K rows). **FALSIFIER: both b1 and b256 move < -0.0002 -> delete this candidate
   permanently (this is the pre-registered expectation; >= -0.0015 would instead resurrect
   weight-side and demote entry 2's floor).**
4. **KV at the shipped configuration (entry 5, overlay).** Zero build (config/engine
   choice), and by far the largest measured movement ON THE PRODUCT METRIC
   (0.010268 -> f16-KV direction, term +0.0015..+0.0048) - but ZERO on the band metric
   (every band arm is f16 KV vs f16 reference), which is why it ranks here and not first.
   **FALSIFIER: the full-corpus matched f16+fa-on bridge cell, when it lands, gives
   K1-K2 <= +0.001 -> KV drops out of the ranking entirely; >= +0.0015 -> KV becomes
   entry 1 for the product gate (config-only work).**
5. **Shared-op fast-math lowering (entry 4, tail only).** The control already bounds the
   whole group at 0.001373 joint, so it cannot be the carrier; keep only as a <=0.001 tail.
   **FALSIFIER (pre-written so it is never re-litigated): an arm with fast-math stripped
   from shared-op programs moves < -0.0005 -> delete this row forever.** Lowest priority:
   expected movement is below every other entry's ceiling.
6. **q4_K `_cok` half accumulator at ne1 in 2..8 (entry 2, blind spot).** Not a band term
   (it runs at neither measured shape); it is product coverage for app tail chunks and the
   only default-reachable half accumulator left. **FALSIFIER: one `-b 8` arm + regenerated
   b8 reference returns median KLD within 15 % of the b256 value -> `_cok` loss negligible,
   drop it.**

| rank | entry | ceiling on the metric | work | the falsifying number (written before any build) |
|---|---|---|---|---|
| 1 | R4 matched quantiser, q6_K dp4a | -0.001..-0.0015 | medium build, 1 arm | drop <= -0.0002 (>= 0.005212) = dead; b1 moving > 0.00005 = void |
| 2 | R5 / Z4 reference floor | -0.003..-0.004 | largest build, gated on Z4 | b1 >= 0.0055 with proven-identical codes = dead |
| 3 | R3 half->float dequant | -0.0005..-0.0015 | smallest build, 2 arms | < -0.0002 at BOTH shapes = delete forever |
| 4 | KV shipped-config overlay | 0 on band metric; -0.0015..-0.0048 on product metric | config only | matched full-corpus cell <= +0.001 = out; >= +0.0015 = becomes #1 for product gate |
| 5 | shared fast-math tail (rms_norm/softmax/rope under `-cl-fast-relaxed-math`) | <= 0.0014 joint (already bounded by the control) | optional build | strip-flag arm moves < -0.0005 = delete forever |
| 6 | `_cok` half8 accumulator, ne1 in 2..8 (app tails, not band) | unmeasured | one -b 8 arm + b8 reference (~15-20 min) | b8 median KLD within 15 % of the b256 value = drop |