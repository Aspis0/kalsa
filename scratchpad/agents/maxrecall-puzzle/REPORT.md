# MAX-RECALL HOSTILE REVIEW (angle 3/3): THE BITSELECT PUZZLE + NUMERICAL CONSISTENCY

**Session:** 2026-08-19 (math-specialist angle; read-only on code; simulation only, no device/write access to source).
**Repo:** `C:\Users\gualt\Desktop\Kalsa\moe-experiments`, submodule `BigMoeOnEdge/third_party/llama.cpp` @ `eaec5d884`.
**Primary evidence:** `scratchpad/agents/retrial-s23/REPORT.md`, raw logs `results/oracle_consumer_s23/retrial/*.log`.
**Discipline:** all arithmetic cross-checked by byte-exact simulation (`sim1.py`–`sim4.py`, Python 3.12) against the deterministic harness data. Report written incrementally so no derivation is lost.

> **UPDATE (defectP experiment, 2026-08-19):** the on-device discriminating experiment (`scratchpad/agents/defectP-experiment/REPORT.md`, logs `results/oracle_consumer_s23/defectP/`) REFUTED the earlier "bit7-clear / same-position" reading of the producer trigger and identified the partner mapping. The corrected model (TASK 4 below) reproduces ALL SIX datapoints byte-exactly (including the bit7 cross-check counters). Read Task 4 as the authoritative mechanism; keep Task 1 as the elimination trail.

---

## TASK 1 — THE ARITHMETIC RIDDLE: where the 1/2 comes from

### 1.0 Ground truth locked in (verified, not trusted)

- **Harness data is a deterministic LCG, NOT random.** `tests/test-opencl-moe-roundtrip.cpp:fill_pattern`:
  `want[i] = (uint8_t)((i*131 + 17) & 0xFF)`. Period exactly 256; the map i→value is a bijection on bytes (131 odd, gcd(131,256)=1).
- q4_0 "as" case: ne=256×512×4, nbytes=294,912 = 16,384 blocks × 18 B. Block layout `{18, 2, 16}` (qs at offsets 2..17).
- Odd-qs candidate = block offset j with qj = j−2 odd → 8/block → **131,072 candidates** (matches report).
- **Byte value distribution over the odd-qs candidate set:** the log prints `odd_want_hi_f=8192` = 131,072/16 *exactly*. I derived + simulated the same: odd-qs positions have byte indices i≡odd (mod 256), so values = the **even residues {0,2,…,254}, each exactly 1,024 times**. Therefore
  `P(want high nibble == 0xF)` over candidates = 8 even-F values (F0,F2,…,FE)×1024 / 131072 = **1/16**.
  ⇒ Hypothesis space is tightly constrained: a *random-data* argument can never be used here; probabilities are exact counts over a period-256 bijection.

Measured q4_0 "as" cells (from logs):

| cell | config | mismatch | per-offset | first | odd_want_hi_f |
|---|---:|---:|---:|---:|---:|
| 2b / 5a | fixed restore, producer bytewise=bitselect | 65,536 | 8,192 ×8 | 39 | 8,192 |
| 7 | old restore + HOST_REPACK (correct producer) | 61,440 | 7,680 ×8 | 3 | 8,192 |
| 1a | old restore + bytewise producer | 94,208 | 11,776 ×8 | 3 | 8,192 |
| 2a / 7 | fixed restore + HOST_REPACK | 0 | — | — | — |

Every mismatch byte is `got = (want & 0x0F) | 0xF0` with `qs_other = 0` (from `hi_to_f_lo_ok == qs_mismatch`).

### 1.1 Candidate hypotheses, with explicit arithmetic

Notation: `N = 131,072` candidates; `E` = poison events; `I` = invisible (poisoned but want hi already 0xF); visible = E − I. Under the harness pattern, **I = E × (fraction of events that land on the 8 even-F value classes)**.

**(a) convert writes hi nibble = 0xF always (data-independent, every candidate):**
E = N = 131,072. F must be invisible where want hi=F, which is uniformly 1/16 of candidates ⇒ I = 131,072×(1/16) = 8,192 ⇒ visible = 122,880. **REFUTED** (measured 65,536). Even *forcing* "writes F to all odd-qs positions" cannot hit 65,536 on this pattern; it can only hit 122,880 (or 131,072 if the discharge check is absent, which the log excludes).

**(b) convert swaps/duplicates a nibble (data-dependent wrong values):**
A swap/duplicate (e.g. `hi[j] = ((x0&0xF0)>>4) | (x0&0xF0)`) yields wrong high nibbles equal to *some partner nibble*, which equals 0xF only 1/16 of the time. Such mismatches would land mostly in `qs_other`, not `hi_to_f_lo_ok`. The logs have `qs_other=0` and `hi_to_f_lo_ok = qs_mismatch` for every affected type — every miswritten byte is *exactly* `(want&0x0F)|0xF0`. **REFUTED on signature purity** (not just on count).

**(c) fixed restore reads the wrong word/byte (data-dependent coincidence):**
The fixed restore is a pure shift/mask extraction (cvt.cl `kernel_restore_block_*_trans4_ns` at eaec5d884) that is the exact integer inverse of the producer contract. Cell 2a/7: **HOST_REPACK (contract-correct producer) + fixed restore = 0** — the same restore kernel byte-perfectly inverts correct storage. Any read-layout error of the fixed restore would be visible in that arm. Hence the 65,536 under bytewise/bitselect **cannot originate in the fixed restore**; it originates in the *stored* bytes the (miscompiled) device convert wrote. **REFUTED for the fixed-restore 65,536 by the HOST_REPACK=0 result.**

**(d) harness pattern makes P(want hi==0xF)=1/2 or P(coincidental match)=1/2:**
The "P(want hi=F)=1/2" version is **REFUTED numerically**: `odd_want_hi_f = 8,192 = 1/16`, derived and logged, not 1/2. 
*However*, the *refined* version of (d) is the surviving mechanism — see 1.2: the pattern sets the *trigger* half, and the value-correlated trigger **by construction has zero F-overlap**, so the 15/16 "already-F" filter never applies. This is exactly the "prime suspect = data generation" note folded in below.

### 1.2 THE SURVIVING MECHANISM (verified byte-exactly on the real harness data)

I parameterized the device defect at the observable byte level ("high nibble of stored odd-qs hi-component forced to 0xF") and swept selector families against the *real* fill_pattern. Only ONE family reproduces **every** cell-2b flight measurement (65,536 visible, 8,192 per offset, first=39, blocks 0/1 clean, zero invisible):

> **Producer (convert) defect P: fires on odd-qs positions where the WANT byte value < 0x80 (bit 7 = 0).**

sim1/sim3 exact output:
- `P = want<0x80`: events 65,536; invisible **0**; visible **65,536**; per-offset **8,192**; first=39. = **cell2b & cell5a (bytewise AND bitselect)**.
- `R = block-even`: events 65,536; invisible 4,096; visible **61,440**; per-offset **7,680**; first=3. = **cell7 (old restore)**.
- `P ∪ R`: events 98,304; invisible 4,096; visible **94,208**; per-offset **11,776**; first=3. = **cell1a (both broken)** — the historical value reproduced exactly.
- `∅` (HOST_REPACK+fixed): **0**. = cell2a/7 clean gate.

Why P has invisible = 0 (the heart of the riddle): `want < 0x80` ⇒ high nibble ∈ {0..7} ⇒ high nibble can never be 0xF. So the value-correlated trigger can never "miss" on an already-F position, and the 15/16 visibility filter that a value-independent trigger carries (and that the old-restore R does carry) **vanishes**. Hence, for the producer stage, visible = E = N/2 = 65,536 exactly. The number 65,536 = 131,072×½ is therefore set by the **data, not by a kernel probability**: the LCG is a bijection, so "MSB clear" selects exactly half the candidate space (64 of 128 even-residue value classes).

For the old-restore stage (R: block-even), the trigger is value-independent, so the standard 15/16 visibility applies: 65,536×(15/16) = 61,440 — precisely the pre-registered poisoning model (which *assumed* P(trigger)=½ and P(visible|trigger)=15/16, giving 61,440). The pre-registration's 15/32 prediction is thus confirmed for the *restore* stage; it is NOT the right formula for the *producer* stage, where the measured 65,536 demands the value-correlated zero-invisible P.

Correlation check (sim2): `want<0x80` is **not** block-discrete, not a qj-class, not a b%m/position rule (every b%m and qj splits exactly 50/50 on this pattern; only 5,504 blocks are all-8 or all-0, the rest mixed 1–7). It is genuinely *value-correlated* — consistent with the "tracer" observation that the producer vs old-restore miscompiles land differently, and consistent with bitselect==bytewise (same 65,536) since both compile to the identical pack expression evaluated on the same values.

**Verdict, hypothesis elimination:**
- (a) hi→F on ALL candidates: 122,880 → REFUTED.
- (b) nibble swap/duplicate: signature pollution (qs_other>0) → REFUTED.
- (c) fixed-restore read error: killed by HOST_REPACK=0 → REFUTED.
- (d) data sets P(hi=F)=1/2: REFUTED (P=1/16 measured); **refined (d) = the data pattern + value-correlated trigger (P: want<0x80, zero-invisible) is EXACTLY what survives**, in combination with the value-independent old-restore selector R (block-even, 15/16 visible).

**Single surviving hypothesis:** one physical phenomenon — the Adreno 740 / E031.41.03.62 driver miscompiling the trans4-MoE odd-qs high-nibble data path to 0xF — manifesting in the two transport kernels with *different* position selectors: the (both-variant) convert forces F on the bit7-clear class (65,536 visible, 0 invisible), and the old restore forced F on even blocks (65,536 events, 4,096 invisible). All four target numbers (61,440 / 65,536 / 0 / e2e-PASS) plus the 5th datum (94,208) are reproduced exactly (sim3). The "1/2" in the riddle is the *data's* contribution; the old restore's 61,440 and the fixed restore's 65,536 are *different* visibility-filtered counts of the same forcing-of-F class of defect.

*(Surviving-hypothesis caveat for the discriminating experiment: P's exact microarchitectural trigger — source-byte MSB vs an LCG-coincident positional class — is not uniquely pinned by these aggregates; see the discriminating experiment at the end.)*

---

## TASK 2 — WHAT E2E PASS PROVES (types q4_1/q5_0/q5_1/mxfp4) AND THE LATENT-WEIGHTS QUESTION

### 2.0 Verified mechanism of the e2e judge (source-checked)
`test-backend-ops.cpp` runs MUL_MAT_ID via `ggml_backend_compare_graph_backend` (line 1503), which copies the GPU graph to the CPU reference backend through `ggml_backend_graph_copy` → weights move GPU→CPU via `ggml_backend_tensor_get` (restore kernel). So the judge's weights J = R(storage) (R = restore), and the GPU computes C(storage) directly. The roundtrip byte stream the harness audits is exactly the stream handed to the judge. Confirmed at ggml-backend.cpp.

### 2.0 follower: consumer idiom audit (tracer finding folded in — CONFIRMED)
- `kernels/gemm_moe_q4_0_f32_ns.cl` + `gemv_moe_q4_0_f32_ns.cl`: **shift-then-mask**, `(q.x >> 4) & 0x000F`, with a KALSA comment blaming mask-then-shift as miscompiled on this device (top-bit signed smear; "q6_K is the only nibble-packed MoE type that passes").
- `kernels/gemm(gemv)_moe_q4_1/q5_0/q5_1..._f32_ns.cl`: **mask-then-shift**, `(x & 0x00F0) >> 4` (UNREWRITTEN).
- `gemv_moe_mxfp4_f32_ns.cl`: E4M3 sign/exp extraction, already shift-then-mask by nature.
So of the 5 affected types, only q4_0's consumer was rewritten yet **all 5 e2e PASS** (cell 4: q4_1 75/75, q5_0 3/3, q5_1 3/3, mxfp4 74/74, q4_0 74/74).

### 2.1 Formalization of the PASS semantics
Notation: x = original tunable bytes; s⁺ = contract-conformant storage; T₀ = intended convert; s = T₀-broken device convert output = actual storage; R = fixed restore (pure integer shift/mask, the exact T₀⁻¹ on s⁺, byte-clean under HOST_REPACK — cell 2a/7 give 0). Judge weight bytes J = R(s) (via get_tensor). GPU computes with C(s).

Two facts:
- **F1 (consumer correct on contract storage):** oracle campaign: for all s⁺ conformant, C(s⁺) = dequant_x86(T₀⁻¹(s⁺)).
- **F2 (fixed restore exact on contract storage):** R(s⁺) = T₀⁻¹(s⁺), byte-proven (HOST_REPACK roundtrip = 0).

For the ACTUAL non-conformant s = T(x):
- If C reads contract layout, C(s) = dequant_x86(T₀⁻¹(s)) = dequant_x86(R(s)) = judge → PASS (float noise only).
- PASS at threshold 5×10⁻⁴ therefore proves: **C(s) ≈ dequant_x86(R(s))**, i.e. the consumer's effective dequant of the real storage agrees with the restore's integer reconstruction to <5×10⁻⁴ — for the given (dirty) s.
- Since PASS holds for many seeds/cases, and the stores s are the SAME dirty product, this is strong evidence C's read layout ≡ contract ≡ R⁻¹-layout for q4_1/q5_0/q5_1/mxfp4 — independent of the mask/shift rewrite, because these consumers were NOT rewritten and still match the exact-integer judge. (If their mask-then-shift idiom were miscompiled on this device, GPU-vs-judge disagreement would be at the ~0.45 level, i.e. FAIL.)

**Quantified strength of that evidence:** x' = R(s) differs from x on 65,536 of 524,288 weights (fraction 1/8). A consumer read-off of even a modest fraction of those same positions vs the judge would inject error energy (1/8)·E[Δq²]/E[q²] ≈ 0.45 NMSE (the closed form), ~900× the 5×10⁻⁴ threshold. PASS across 156 affected MUL_MAT_ID cases at <5×10⁻⁴ bounds any consumer-vs-restore layout deviation to ≤ ~0.1% of that corruption signal. **PASS ⇒ consumers read the same effective weights the fixed restore reconstructs; i.e., no additional consumer-path misread.**

### 2.2 What PASS does NOT prove — the latent wrong-weights risk (YES/NO)
PASS proves **self-consistency** (judge == GPU), NOT fidelity: x' = R(T(x)) ≠ x (65,536 odd-qs high-nibbles forced to 0xF per affected tensor; each becomes code-15 ⇒ weight 7·d for q4_0). Nothing in the PASS arms shows bytes are the model's original bytes.

Evidence the risk is reachable in production:
- (a) Cell-3 weight-path predicate: tensor_set dispatches `trans4-moe` iff `(strstr(name,"ffn") && strstr(name,"exps")) || strstr(name,"as")` AND ne01%32==0 (ggml-opencl.cpp:6979).
- (b) Standard llama.cpp MoE checkpoint tensor names are `blk.N.ffn_gate_exps.weight` / `ffn_up_exps` / `ffn_down_exps` — they contain "ffn" AND "exps" ⇒ **the gate fires for real models**.
- (c) The only correct producer in-tree (HOST_REPACK) is q4_0-only; q4_1/q5_0/q5_1/mxfp4 have no contract-correct producer on this device → their production storage is necessarily the miscompiled T(x).

Therefore, **in any real load path that (i) uses this .so+kernel set on Adreno 740 (driver 0676.73/E031.41.03.62), (ii) gates a MoE weight tensor into trans4-moe, and (iii) has no bypass**, the GPU consumes weights x' ≠ x (1/8 of weights corrupted). e2e PASS does not mitigate this — the judge is fed the same wrong bytes.

Caveat that bounds the strength of the claim: the pre-registered §4 production smoke (enqueue shim to list kernel names in a real fixed-prompt MoE inference with use_extra_bufts=false; storage-path log; patched/unpatched logits A/B) was explicitly deferred and NOT run. Whether the live engine's load pipeline for a specific model hits this convert (vs image buffers / extra bufts / a CPU-side repack) is unmeasured. So the verdict is:

**LATENT WRONG-WEIGHTS RISK: YES (conditional, real, un-refuted by PASS).** Confirmed at the byte level (65,536 dirty odd-qs nibbles per tensor = 1/8 of weights) for the set_tensor→convert→consumers path; gated on the trans4-moe dispatch, which real MoE tensor names satisfy; mitigation (HOST_REPACK) is q4_0-only. Unmeasured: whether production inference this .so actually fires the convert — to be closed by the deferred smoke.

### 2.3 Cheapest discriminating device experiment
1. **Kernel-free, strongest-ROI:** change only the harness `fill_pattern` constant (131→coprime value or offset) and rerun the sweep (bytewise AND bitselect). Prediction under the surviving hypothesis: dirty count stays exactly N/2 and the mismatch SET equals the NEW pattern's want<0x80 class (first block etc. shift exactly as simulated); under a positional/coincidence story the set/count would differ. This discriminates the value-correlated trigger from a positional coincidence in ONE device run, no .so rebuild.
2. **Decision-relevant:** force a contract-correct producer for all 5 types (extend HOST_REPACK beyond q4_0). Then: roundtrip must be 0 for all 5 AND e2e must PASS. That is the only byte-clean-and-PASS state; it unambiguously separates producer vs restore and gives production a correct load path.
3. **Closes the production question itself:** the deferred enqueue-shim smoke (does trans4-moe convert fire during a real model load + fixed-prompt inference?) + patched/unpatched fixed-prompt logits A/B, plus dequantize-and-compare of on-device reconstructed weights vs PC host-dequant of the original GGUF (already ≈ measured: 65,536 dirty per tensor).

---

## TASK 3 — NUMERICAL AUDIT: ERR ≈ 0.43 vs CLOSED-FORM 0.45058; 12/12 OFFLINE NMSE

### 3.1 Closed-form re-derivation (arithmetic verified)
Per pre-registration (§1): unpoisoned q=n−8 uniform 0..15 ⇒ E[q²]=(Σ_{−8}^{7}q²)/16=344/16=21.5. Poisoned value = (15−8)d=7d ⇒ Δq=7−q=15−n ⇒ E[Δq²]=(Σ₀¹⁵(15−n)²)/16=1240/16=77.5. Poisoning fraction = (8 odd-qs per 32-weight block)·(trigger 1/2)=1/8. Zero-mean iid activations kill cross terms; d² and activation variance cancel. E[NMSE] = (1/8·77.5)/21.5 = 9.6875/21.5 = **0.4505813953** = 1240/(8·344) ✓ (Σ₀¹⁵n²=1240, Σ₁⁷q²... checked).
- Consistent with the old-restore byte model: 131,072·(1/2)·(15/16) = 61,440 visible events (cell 7 re-measured exactly 61,440; per-offset 7,680 = 15/32·16,384 ✓).
- Trigger 1/2 = the old restore's value-independent block-even selector R (sim3): 8,192 blocks·8 = 65,536 events, 4,096 invisible ✓ — i.e. the closed form's "½" is the *restore* stage, validated on-device.

### 3.2 RECOMPUTE of the reported ERR values from the logged f1/f2 (all 12; task asked ≥3)
Parsed cell6_armA_unpatched_hostrepack_q4_0_dump.log: 12 cases, n = 512/1024/2048 rows each, all rows present (14,336 total). Recompute NMSE = Σ(f1−f2)²/Σf1²:

| case | n | harness ERR | recompute | |Δ| |
|---|---:|---:|---:|---:|
|1|512|0.33686806|0.33686806|1.0e-09|
|2|512|0.32776330|0.32776331|2.9e-09|
|3|1024|0.54089516|0.54089516|2.1e-09|
|4|1024|0.39566796|0.39566796|1.7e-10|
|5|2048|0.43938111|0.43938111|1.8e-09|
|6|2048|0.39562080|0.39562080|4.9e-10|
|7|512|0.48223020|0.48223020|3.7e-09|
|8|512|0.32909543|0.32909544|5.0e-09|
|9|1024|0.42802839|0.42802839|5.7e-09|
|10|1024|0.41165641|0.41165641|4.1e-09|
|11|2048|0.54383045|0.54383045|3.8e-10|
|12|2048|0.35830978|0.35830978|1.4e-09|

All 12 match the harness ERR to <1e-8 (≤1e-9 absolute); mean of the 12 = 0.43250, range 0.32776–0.54383. **The reported ERR numbers and the "12/12 offline NMSE match" claim are CONFIRMED (reproduced from the raw log).**


### 3.3 Band / test-power audit
- Pre-registered band 0.36-0.70: 10/12 inside; cases 2 (0.32776) and 8 (0.32910) sit slightly below 0.36 — the retrial report stated this honestly (2 of 12 below band). Not a falsifier (falsifier = systematically out-of-band OR non-reproducible ERR; both avoided).
- Closed form 0.45058 vs observed: per-case |0.45058 - ERR| = 0.011-0.123, mean ~0.071, observed std ~0.07. The single-constant 0.45058 is the byte-frequency expectation; the per-case spread is finite-sample (non-uniform codes/activations per case), anticipated by the pre-registration ("finite quantized test rows", weak-band note in restore-fix-review L217). The cluster (mean 0.4325; historical runs 0.4561 / 0.4499 / 0.485 / 0.488, all ~0.45) confirms the model. Verdict: **PLAUSIBLE-CONFIRMED** (reproducible, in-cluster; not a tight point estimate).
- Test power/detection: 5e-4 threshold vs ~0.45 signal = ~900x headroom; the pass/fail split is robust (Arm A 0/12 FAIL at mean 0.4325, Arm B 12/12 PASS) — consistent with the run9/run10 data-dependent scatter (0.35-0.73) already documented in oracle-consumer L944-946.

### 3.4 Cross-check of Task 1 arithmetic against the 0.45058 model
The closed-form poisoning fraction (1/8) equals, byte-for-byte, the fraction of weights corrupted by EITHER defect (65,536 / 524,288 = 1/8). Under the fixed restore + miscompiled producer (the production-relevant state), the run-time weights are x' = R(T(x)) with the same 65,536 corrupted odd-qs hi-nibbles — i.e. the "0.45058" number is simultaneously (i) the historical judge-poisoning ERR and (ii) the size of the latent production weight error. Internal consistency holds.

---

## FINAL VERDICTS

**Task 1 — Bitselect puzzle / arithmetic riddle.** No single "kernel trigger probability" explains the counts; the 1/2 figure is set by the **harness data pattern** (deterministic bijective fill_pattern) interacting with a **value-correlated producer trigger**. Derived + simulated:
- (a) hi-nibble->0xF on ALL candidates ⇒ 131,072 x 15/16 = 122,880 → **REFUTED** (measured 65,536).
- (b) nibble swap/duplicate ⇒ wrong values mostly != 0xF ⇒ qs_other > 0 → **REFUTED** (qs_other = 0; every mismatch is exactly (want&0x0F)|0xF0).
- (c) fixed-restore read error ⇒ would appear under HOST_REPACK, which measured 0 → **REFUTED**.
- (d) "data sets P(hi=0xF)=1/2" ⇒ P = 1/16 (odd_want_hi_f = 8,192, derived + logged) → **REFUTED**; *refined* (d) survives (see below).
- Survivor: producer defect P fires on want<0x80 (bit-7 clear) odd-qs positions — under the LCG, exactly half the value space AND zero overlap with the 0xF classes ⇒ **65,536 visible, 0 invisible**; old-restore defect R fires block-even, value-independent ⇒ 65,536 events with 4,096 invisible ⇒ **61,440**; P u R = **94,208**; none ⇒ **0** (HOST_REPACK+fixed). All reproduced byte-exactly (sim3); both bytewise and bitselect producers give identical 65,536 because the two compile to identical pack expressions on identical values. verdict: **CONFIRMED** (single coherent two-stage device miscompile of the odd-qs high-nibble path forcing 0xF; counts fully data-determined).

**Task 2 — e2e PASS semantics.** PASS proves judge/GPU self-consistency on the same (dirty) weights: the GPU consumer reads the fixed-restore reconstruction (contract layout) of the miscompiled storage. Strength: a consumer-vs-judge layout deviation at the corrupted positions would produce ~0.45 NMSE (~900x threshold) and would have FAILed; 156 affected cases passed. q4_1/q5_0/q5_1 passing with the UNREWRITTEN mask-then-shift idiom demonstrates their consumers are not miscompiled here (the q4_0 rewrite was form-specific). PASS does NOT prove the run-time weights equal the model's original bytes.

**Task 3 — numerical audit.** 0.45058 re-derived exactly (1240/(8·344)); all 12 reported ERRs recomputed from the raw cell6 f1/f2 log to <1e-8 (12/12 match **CONFIRMED**, beyond the report's own <1e-6 claim); band & historical cluster consistent (mean 0.4325 vs 0.45058; 2/12 marginally under 0.36, honestly disclosed). verdict: **CONFIRMED** (reproducibility), closed-form **PLAUSIBLE-CONFIRMED** (point-estimate scatter acknowledged).

**LATENT WRONG-WEIGHTS RISK IN PRODUCTION-RELEVANT PATHS: YES (conditional).**
- Real if the weight-load path for these MoE types on this .so + Adreno 740 dispatches set_tensor->kernel_convert_block_*_trans4_ns: the trans4-moe name gate ((ffn+exps) or as, and ne01%32==0) matches real checkpoint tensor names (blk.N.ffn_*_exps.weight); HOST_REPACK (the only correct producer) is q4_0-only; e2e PASS does not restore fidelity.
- Byte-level corruption is confirmed: 65,536 odd-qs hi-nibbles -> 0xF per affected tensor = 1/8 of weights, value-correlated (bit-7-clear source), identical for bytewise and bitselect producers.
- NOT YET MEASURED: whether live production inference actually fires this convert (the deferred §4 production smoke — enqueue shim, storage-path log, patched/unpatched fixed-prompt logits A/B — was not run). Until then the risk is bounded at the source/byte level and must not be claimed "measured".
- Discriminating experiment (cheapest first): (1) rerun the roundtrip sweep with a DIFFERENT fill_pattern constant (no .so rebuild) — prediction: dirty count stays N/2 and the set tracks the new want<0x80 class; (2) force a contract-correct producer for all 5 types (extend HOST_REPACK) — roundtrip 0 for all 5 + e2e PASS is the only clean state; (3) the production enqueue-shim smoke + dequantize-and-compare vs host dequant of original GGUF.

*Prepared by the math-specialist angle (maxrecall-puzzle); all arithmetic cross-checked against the real harness data + raw device logs (sim1-sim3, nmse3b).*


---

## TASK 4 — defectP EXPERIMENT: PARTNER MAPPING (bit7 OF THE EVEN BYTE) + SIX-DATAPOINT UNIFIED MODEL + FIX PREDICTION

### 4.0 Correction of the Task-1 survivor (recorded verbatim)
The earlier survivor ("producer P fires on want<0x80 = same-position bit7 CLEAR") is REFUTED by the defectP device runs:
- const40 (every byte 0x40: bit7 clear, <0x80): **0** mismatches — a same-position bit7-clear gate would fire on ALL 131,072.
- constC0 (every byte 0xC0: bit7 set): **131,072** mismatches (every odd-q fires, got = (want&0x0F)|0xF0 = 0xF0) — a same-position bit7-clear gate would fire on NONE.
- lcg29: 57,344 (not ~half) with an imperfect same-position bit7 partition.
Conclusion: a bit7 gate EXISTS on the write side but with **REVERSED polarity (fires when bit7 SET)** and it reads a **PARTNER source byte, not the same-position want byte**. The Task-1 "65,536 with zero invisible" was a multiplier-131 coincidence.

### 4.1 Exact partner mapping (derived from cvt.cl @ eaec5d884; verified byte-exactly by sim4.py)
The five trans4 converts compute, per pair (w,j):
`(x0, x1) = (b->qs[2(4w+j)], b->qs[2(4w+j)+1])` = (EVEN, ODD) qs byte of the pair,
`hi[j] = trans4_pack_hi(x0,x1) = ((x0 & 0xF0) >> 4) | (x1 & 0xF0)`.
Under the fixed restore, a stored hi-word byte maps as: its LOW nibble = `(x0 & 0xF0) >> 4` (feeds the EVEN restored byte's high nibble); its HIGH nibble = `x1 & 0xF0` (feeds the ODD restored byte's high nibble).

**Mechanism:** the sub-expression `(x0 & 0xF0) >> 4` is a mask-then-shift whose AND-mask retains bit 7; on this device the compiler treats the masked byte as signed and emits an arithmetic shift (SBFX/ASR): when bit7(x0)=1 the field sign-fills (bits 4..31 = 1), the OR against `(x1 & 0xF0)` lets the sign-fill win, and truncated to 8 bits it becomes the stored hi-byte high nibble = **0xF** → the ODD restored byte's high nibble floods; the even byte and the low nibbles stay clean (got = (want&0x0F)|0xF0 exactly — matches `hi_to_f_lo_ok == qs_mismatch`, `qs_other = 0`).

**PARTNER MAPPING (the single mapping that fits all data):** for restored odd qs byte qs[2k+1] of block (i00,i01,i02), the trigger is **bit7 of the even partner qs[2k] (= x0) of the same pair, same block**. This is local (even byte immediately before the odd byte), NOT a cross-block transpose; it explains why the same-position bit7 is only a proxy (the harness counts the odd byte's own bit7).

### 4.2 Ranked defect-site list (cvt.cl @ eaec5d884)
1. **`trans4_pack_hi` — `((x0 & 0xF0) >> 4)`** (line 59 bytewise; line 57 bitselect): the only expression in the pack pair whose mask retains bit7 AND is right-shifted; matches the campaign's documented "mask-then-shift is miscompiled on Adreno 740 (signed smear; a later mask does not rescue)" (KALSA note in `gemm/gemv_moe_q4_0_f32_ns.cl`). Trigger byte (x0=even) and flood target (odd high nibble) both match. **PRIMARY** (bytewise arm).
2. **Shared LOAD of x0/x1 and global STORE of hi[j]** in the five `kernel_convert_block_*_trans4_ns` kernels — the only constructs shared by the bytewise AND bitselect arms, which corrupt IDENTICALLY (65,536). If the rank-1 rewrite clears only the bytewise arm, the residual site is here (the defectP report's "upstream/downstream of the pack helpers" caveat). **SECONDARY / required to fully explain bitselect-identical corruption.**
3. `trans4_pack_lo` — `(x1 & 0x0F) << 4` (line 51/49): low-nibble mask + left shift; bit7 never retained, sign-flood impossible here. Low risk; listed for completeness.
4. `convert_uchar(...)` / `bitselect(...)` wrappers — byte-width ops; only misbehave if the backend miscompiles the integer field extract as above.

Path-specific note: the identical `((x0 & mask_F0) >> 4)` idiom also appears in the dense / SoA / K convert paths that round-trip **clean** (lines 316, 507, 705, 931, 1088, 1213, 1159, 1300) — so the miscompile is DISPATCH/PATH-specific to trans4-MoE, not a universal property of the expression text. The (fixed) restore kernels also contain the idiom (411, 604, 818, 1048) but are byte-clean under HOST_REPACK and are NOT implicated.

### 4.3 Unified model — ALL SIX datapoints reproduced byte-exactly (sim4.py)
Model: **P' (convert): odd-qs high nibble -> 0xF iff bit7( qs[2k] = even partner ) = 1** (fires 65,536 under any bijective fill, since even-qs positions occupy the odd residue class, half of which have bit7 set — the "1/2" is still data-set, but via the even-partner VALUE not the same-position byte). **R (old restore): block-even** (unchanged).

| datapoint | fill | measured (q4_0 "as") | sim4 | match |
|---|---|---|---|---|
| a | lcg131 | 65,536 / first 39 / p.o. 8,192 / mbit7cl 63,488 / cset 63,488 / deficit 4,096, invis 0 | identical | EXACT |
| b | const40 | 0 (all cases clean, rc=0) | 0 | EXACT |
| c | constC0 | 131,072 / first 3 / got 0xF0 | 131,072 / first 3 | EXACT |
| d | lcg29 | 57,344 / first 5 / mbit7cl 15,360 / cset 23,552 / deficit 92,160, invis 8,192 | identical | EXACT |
| cell7 | hostrepack + OLD restore | 61,440 / first 3 / p.o. 7,680 (= 65,536 events - 4,096 invis) | 61,440 | EXACT (R still stands) |
| cell1a | lcg131, bytewise, OLD restore | 94,208 / first 3 / p.o. 11,776 | 94,208 (P u R) | EXACT (union with corrected P) |

Extra: mxfp4 @lcg131 reproduces 65,536 / mbit7cl 64,000 / cset 64,000 / deficit 3,072 / first 2 (matches the defectP report's mxfp4 row) — the model generalizes past q4_0.

### 4.4 Minimal fix prediction
Predicted fix (shift-first-then-mask, the device-documented working idiom) in `ggml/src/ggml-opencl/kernels/cvt.cl`:
- line 59 (bytewise): `convert_uchar((x0 & 0xF0) >> 4)` -> `convert_uchar((x0 >> 4) & 0x0F)`
- line 57 (bitselect): `(uchar)((x0 & 0xF0) >> 4)` -> `(uchar)((x0 >> 4) & 0x0F)`
- defensive (line 51 / 49): `(x1 & 0x0F) << 4` -> `((x1 << 4) & 0xF0)` in both arms (equivalent under correct compilation; removes bit-7-adjacent masking a buggy compiler could mishandle).
- defense-in-depth (NOT required by evidence): same rewrite in the five trans4 restore kernels.
This fixes all five trans4 converts for BOTH producer variants from the two helper definitions (the kernels call `trans4_pack_lo/hi`).

Counts after fix (all under every fill):

| datapoint | before | after fix |
|---|---:|---:|
| lcg131 P | 65,536 | 0 |
| const40 P | 0 | 0 |
| constC0 P | 131,072 | 0 |
| lcg29 P | 57,344 | 0 |
| cell7 R (old-restore state; already fixed by eaec5d884) | 61,440 | 0 |
| cell1a P u R | 94,208 | 0 |

All six -> 0; e2e stays PASS and becomes weight-faithful (GPU and judge both see x, not x').

CAVEAT / fallback: if after the helper rewrite the BITSELECT arm (or bytewise) still corrupts, the residual site is the shared x0/x1 LOAD or hi[j] STORE (rank 2). The next discriminating fill is a TARGETED SINGLE-PAIR probe: one block with the (even,odd) pair set to fixed values (e.g. even x {0x00,0x80} x odd x {0x40,0xC0}), all other bytes unit — observe which even-bit7 x odd-value combination floods, under BOTH variants, in one run. (All simulation artifacts: sim4.py, verify6.txt.)

### 4.5 Answer to the original riddle, restated
The 1/2 is the product of (i) the deterministic bijective fill (half the even-partner values have bit7 set => fires = 65,536 under ANY bijection) and (ii) the value-correlated trigger's overlap with the already-0xF class (0 overlaps under mult 131 => 65,536 visible; 8,192 overlaps under mult 29 => 57,344 visible). The old-restore 61,440 and bytewise/bitselect 65,536 differ only in visibility filtering of the SAME forcing-of-F defect class.


---

## REVISED FINAL VERDICT (post defectP experiment)

- **Task 1 riddle — RESOLVED, mechanism corrected.** The 1/2 is set by the harness data pattern (bijective fill) interacting with a **value-correlated, partner-byte, bit7-SET write-side trigger**, not the earlier "same-position bit7-clear" reading (REFUTED by const40/constC0/lcg29). The single mapping reproducing **all six datapoints byte-exactly** (sim4.py) is:
  - **P' = convert: odd-qs high nibble -> 0xF iff bit7 of the even partner qs[2k] (= x0) is SET** — root cause the mask-then-shift sign-flood of `((x0 & 0xF0) >> 4)` in `trans4_pack_hi` (cvt.cl:57/59), shared LOAD/STORE as the residual site explaining bytewise==bitselect.
  - **R = old restore: block-even, value-independent** (61,440 = 65,536 - 4,096) — still stands with corrected P; P u R = 94,208.
- **Task 2 — e2e PASS semantics unchanged:** PASS = judge/GPU self-consistency on the same (dirty) weights; does NOT prove fidelity. Latent wrong-weights risk standing (see below).
- **Task 3 — numerics:** unchanged, CONFIRMED (0.45058 re-derived; all 12 ERRs recomputed from logs to <1e-8).
- **Minimal fix:** shift-first-then-mask in `trans4_pack_hi` (cvt.cl:57,59) [+ defensive `trans4_pack_lo`]; predicted all six counts -> 0 under every fill; e2e stays PASS and becomes weight-faithful. Fallback if bitselect arm persists: single-pair fill probe + shared load/store site (rank 2).

**LATENT WRONG-WEIGHTS RISK IN PRODUCTION-RELEVANT PATHS: YES (conditional) — UNCHANGED and now with a cleaner root cause.** The polarity correction does NOT make the defect benign: bit7-set source bytes are common in real quantized weights (any value >= 0x80), so a real load dispatch to the trans4 convert for these MoE types on this .so/Adreno 740 runs with 65,536 (per affected tensor) odd-qs high-nibbles forced to 0xF (>0x80 source bytes fire). The name gate (ffn+exps / as, ne01%32==0) matches real checkpoints; HOST_REPACK is q4_0-only; e2e PASS is not fidelity. The deferred §4 production smoke remains the unmeasured link.
