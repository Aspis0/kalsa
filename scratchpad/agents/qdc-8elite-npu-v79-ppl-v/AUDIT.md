# Hostile Audit: REPORT cell #47 (job 796297)

Writer: independent (mimo Reviewer). REPORT writer = Claude Fable = prereg author = #46 auditor — conflict of interest noted; every claim verified against raw.

---

## 1. PPL numbers and EXIT=0

**REPORT claim:** Ship 40.2720, OLMoE 9.0620, both EXIT=0.

**Raw verification:**
- `raw/ppl_ship_htp.dev.txt`: `[32]40.2720,` then `Final estimate: PPL = 40.2720 +/- 0.87472` then `EXIT=0`. **CONFIRMED.**
- `raw/ppl_olmoe_htp.dev.txt`: `[32]9.0620,` then `Final estimate: PPL = 9.0620 +/- 0.13192` then `EXIT=0`. **CONFIRMED.**

**r recomputation:**
- Ship: 40.2720 / 40.2837 − 1 = −0.000290 = **−0.029 %** → PASS (≤ 2 %). **CONFIRMED.**
- OLMoE: 9.0620 / 9.0562 − 1 = +0.000640 = **+0.064 %** → PASS (≤ 2 %). **CONFIRMED.**

## 2. Execute-op proof

**REPORT claim:** Ship 10648 MUL_MAT, 0 MUL_MAT_ID. OLMoE 3024 MUL_MAT_ID (1008/1008/1008), 5136 MUL_MAT.

**Raw verification:**
- `grep -c 'execute-op MUL_MAT[^_]' ppl_ship_htp.dev.txt` → **10648**. CONFIRMED.
- `grep -c 'execute-op MUL_MAT_ID' ppl_ship_htp.dev.txt` → **0**. CONFIRMED.
- `grep -c 'execute-op MUL_MAT_ID' ppl_olmoe_htp.dev.txt` → **3024**. CONFIRMED.
- OLMoE split: `grep -o 'ffn_[a-z]*_exps' | sort | uniq -c` → **1008 ffn_down_exps, 1008 ffn_gate_exps, 1008 ffn_up_exps**. CONFIRMED.
- OLMoE dense: `grep -c 'execute-op MUL_MAT[^_]' ppl_olmoe_htp.dev.txt` → **5136**. CONFIRMED.

**Is execute-op count sufficient proof of HTP0 execution (not silent CPU fallback)?** Yes, supplemented by:
- `ppl_ship_htp.dev.txt:0.00.290.892`: `llama_prepare_model_devices: using device HTP0 (Hexagon)`
- `ppl_ship_htp.dev.txt:0.00.411.442`: `load_tensors: layer 0 assigned to device HTP0`
- `ppl_olmoe_htp.dev.txt:0.00.177.433`: same `using device HTP0` line
- Every execute-op line has `HTP0` as the device prefix and `HTP0-REPACK` as the weight buffer.

A CPU fallback would produce zero execute-op lines and `using device CPU` or `-ngl 0`. Neither is present. **CONFIRMED: both models ran on HTP0.**

## 3. Cross-check: PPL_HTP(#47) vs PPL_HTP(#46)

**REPORT claim:** "PPL_HTP(#47) = PPL_HTP(#46) to the printed precision for both models."

**Raw verification:**
- #46 ship HTP: `Final estimate: PPL = 40.2720 +/- 0.87472` (`../qdc-8elite-npu-v79-judge/raw/ppl_ship_htp.txt:1.19.299.610`)
- #47 ship HTP: `Final estimate: PPL = 40.2720 +/- 0.87472` (`raw/ppl_ship_htp.dev.txt:1.36.092.371`)
- #46 OLMoE HTP: `Final estimate: PPL = 9.0620 +/- 0.13192` (`../qdc-8elite-npu-v79-judge/raw/ppl_olmoe_htp.txt:1.17.967.752`)
- #47 OLMoE HTP: `Final estimate: PPL = 9.0620 +/- 0.13192` (`raw/ppl_olmoe_htp.dev.txt:1.28.888.150`)

**Byte-identical to printed precision.** No anomaly. CONFIRMED.

The `[32]` per-chunk line equals Final estimate in both (`[32]40.2720`, `[32]9.0620`). 32-chunk closure met. CONFIRMED.

## 4. shas, kit verify, file counts

**REPORT claim:** All three shas match; kit OK count = manifest lines.

**Raw verification:**
- Ship SHA: host=`a247afd6…` device=`a247afd6…` (`raw/sha_ship.gguf.txt`). MATCH.
- OLMoE SHA: host=`9d0b90c6…` device=`9d0b90c6…` (`raw/sha_olmoe.gguf.txt`). MATCH.
- Corpus SHA: host=`173c87a5…` device=`173c87a5…` (`raw/sha_wiki.test.raw.txt`). MATCH.
- Kit verify: 24 lines of `OK`, `MANIFEST_LINES=24`. `NOK=24, NMAN=24`. MATCH. CONFIRMED.

## 5. Defect shapes claim

**REPORT claim:** "those shapes are not exercised by these two models' forward pass — the proof lines show the models use m∈{shortconv, expert} shapes that ran clean."

**Analysis:** The #46 defect shapes are:
- 36 INTERNAL-ERROR: test-backend-ops synthetic shapes (m=16, n=4..9; m=1,n=2048,k=8192; etc.)
- 1 NaN: `MUL_MAT(type_a=q4_0, m=2880,n=32,k=2880)`

The #47 execute-op shapes from the actual models:
- Ship (LFM2.5-2.6B): shortconv `2048:6144`, `2048:2048`; FFN `2048:10752`, `10752:2048`; attn `2048:2048`, `2048:512`. No m=16, no m=2880.
- OLMoE: expert `2048:1024:64:1` (MUL_MAT_ID), dense `2048:2048`, `2048:1024`. No m=16, no m=2880.

`grep -E 'm=16|m=2880' ppl_ship_htp.dev.txt` → empty. `grep -E 'm=16|m=2880' ppl_olmoe_htp.dev.txt` → empty.

**Verdict: PLAUSIBLE, not overreach.** The claim is supportable from the evidence. The failing shapes (m=16, m=2880) are synthetic test-backend-ops constructions, not shapes that appear in these two models' forward passes. However, "not exercised" is an inference, not a proof — a model's internal graph could theoretically produce such shapes at a different context length or batch size. For the stated scope (32 chunks, batch 2048), the claim holds.

## 6. Undisclosed deviations

### 6a. Post-gate thermal GATE_FAIL — MINOR

**Raw:** `gate_post_ship_htp.txt: GATE_FAIL`, `gate_post_olmoe_htp.txt: GATE_FAIL`.

**REPORT:** "Gates before each arm from the live HAL group; both HTP arms passed pre-gates; post-arm snapshots recorded (raw/gate_*)." The report mentions post-arm snapshots exist but does NOT disclose the GATE_FAIL status.

**Impact:** The prereg's thermal gate is pre-invocation only ("before EACH invocation, one ≤ 3-min wait then SKIP"). Post-arm thermal excursions are informational per the prereg. The runs completed successfully (EXIT=0, correct PPL). No validity impact.

**Verdict: MINOR.** The report should note the post-gate thermal status for completeness. Pre-gates PASS is correctly stated.

### 6b. CPU reuse — OK (declared in prereg)

Prereg item 3 explicitly declares CPU twins are not re-run. The report correctly takes PPL_CPU from #46. No undisclosed deviation. CONFIRMED.

### 6c. Filtered log — OK

Report states "Filtered logs are 282 773 / 219 143 lines (a few MB)." Raw: `wc -l ppl_ship_htp.dev.txt` → 282773, `wc -l ppl_olmoe_htp.dev.txt` → 219143. Numbers match. The filtered logs retain execute-op, per-chunk, Final estimate, EXIT=, offload lines. Nothing the verdict needs is lost. CONFIRMED.

### 6d. Billing

Report: "Submitted 10:03:08 PM, Running 10:04:24 PM, Ended 10:15:34 PM." Driver: `DONE elapsed=466` (7 min 46 s). QDC billed ~11 min (submitted→ended). Both consistent. No discrepancy. CONFIRMED.

## 7. Banking claim

**REPORT claim:** "Session 1 D CLOSES on correctness."

**Prerequisites per #47 PREREG decision rule:**
1. "#46's judge-repaired verdict stands after its hostile audit" — #46 AUDIT was APPLY (judge repaired raw-confirmed; MUL_MAT_ID 301/301 patched-correct). **MET.**
2. "ship = PASS here at 32 chunks" — Ship r = −0.029 % → PASS. **MET.**

**Prerequisites per #46 PREREG decision rule:**
- "MUL_MAT patched-correct = CLOSED" (301/301 OK, control 299 FAIL off → 0 FAIL on). **MET.**
- "MUL_MAT_ID 301/301 patched-correct" (from #46 ops_id_ph1.txt). **MET.**

**Internal consistency:** The ops defect list (36 INTERNAL-ERROR + 1 NaN) stays open as a hardening item. The prereg distinguishes "ops-correctness" (judge-repaired) from "numerical certification" (PPL PASS). Closing D on correctness while the defect list stays open is consistent with both preregs. CONFIRMED.

---

## Final verdicts

| # | Finding | Verdict | Severity | Fix |
|---|---------|---------|----------|-----|
| 1 | PPL numbers match raw, EXIT=0 | CONFIRMED | — | — |
| 1a | r computation correct | CONFIRMED | — | — |
| 2 | Execute-op proof present, correct counts | CONFIRMED | — | — |
| 2a | HTP0 execution proven (not CPU fallback) | CONFIRMED | — | — |
| 3 | Cross-check identical to #46 | CONFIRMED | — | — |
| 4 | shas match, kit OK = manifest | CONFIRMED | — | — |
| 5 | Defect shapes not exercised (supportable) | PLAUSIBLE | — | — |
| 6a | **Post-gate GATE_FAIL undisclosed** | **CONFIRMED** | **MINOR** | **Note in REPORT** |
| 6b | CPU reuse declared | CONFIRMED | — | — |
| 6c | Filtered log complete | CONFIRMED | — | — |
| 6d | Billing consistent | CONFIRMED | — | — |
| 7 | Banking claim internally consistent | CONFIRMED | — | — |

**No BLOCKERs. No MAJORs. 1 MINOR: undisclosed post-gate thermal GATE_FAIL.**

---

## APPLY

The cell banks. Ship = PASS (r −0.029 %), OLMoE = PASS (r +0.064 %), execute-op proof present, cross-check identical to #46, all shas match, kit verified. Session 1 D closes on correctness. The post-gate thermal GATE_FAIL is noted as a MINOR disclosure gap — the runs completed successfully and the prereg's thermal gate is pre-invocation only.

**APPLY**
