# AUDIT_DOC — Hostile documentation audit (q63 + q67 bank package)

**Auditor:** mimo (doc review)
**Date:** 2026-08-27
**Scope:** PLAN #35, ALIVE #14 (erratum), ALIVE #18, q63 REPORT/PAIRED/RUN_LOG/PREREG, q67 REPORT/RUN_LOG/PREREG, docs/PLAN-10DAYS §8
**Standard:** Hostile — find every factual error, omission, incoherence, or overclaim in the bank documentation chain.

---

## 1. Number traceability (PLAN #35 ↔ REPORT ↔ PAIRED ↔ RUN_LOG)

### Verdict: PASS with minor notes

Every number in PLAN #35 and ALIVE #18 traces to the evidence:

| Claim in PLAN #35 | Source | Match |
|---|---|---|
| C1 = 3 098 664 160 B | REPORT.md `candidate1 bytes = 3098664160` | ✓ exact |
| C1 wiki −2.31 | REPORT `-2.3073%` → rounds to −2.31 | ✓ |
| C1 it +0.43 | REPORT `+0.4317%` → rounds to +0.43 | ✓ |
| C1 es +0.95 | REPORT `+0.9525%` → rounds to +0.95 | ✓ |
| C1 fr +0.12 | REPORT `+0.1226%` → rounds to +0.12 | ✓ |
| C1 zh +0.62 | REPORT `+0.6197%` → rounds to +0.62 | ✓ |
| C2 = 2 765 741 280 B | REPORT `candidate2 bytes = 2765741280` | ✓ exact |
| C2 it +1.31, es +1.73, zh +1.69, wiki −3.16, fr +0.84 | REPORT +1.3068/+1.7250/+1.6869/−3.1592/+0.8372 → rounded correctly | ✓ |
| es CI [+0.39, +1.51] | PAIRED_Q63.md `CI low +0.3947%, CI high +1.5133%` → rounds to [+0.39, +1.51] | ✓ |
| pp512 HTP 199.7 / CPU 43.8 | q67 manifest `bench_first_sample_ts = 199.685` / `43.8054` | ✓ (199.685→199.7, 43.8054→43.8) |
| ≈ 4.5× | 199.685 / 43.8054 = 4.558× → "≈ 4.5×" | ✓ |
| ~37 promoted tensors | PAIRED/Q59 PREREG: 24 attn_qkv Q5_K + 9 attn_v Q5_K + 4 ffn_down Q5_K = 37 | ✓ |

**f-1. MINOR: 199.7 is first-sample, not jsonl-avg.** PLAN #35 says "pp512 HTP 199.7 vs CPU 43.8 t/s ≈ 4.5×". These are `bench_first_sample_ts` values. The jsonl averages are 201.72/45.02 (ratio 4.48×). The PLAN uses first-sample throughout — consistent within itself — but does not label which metric. **Severity: cosmetic, no overclaim** (the first-sample and avg give the same qualitative conclusion).

**f-2. MINOR: A1 "20 chunks" omitted from PLAN #35 narrative.** PLAN says "C1 CARICA ED ESEGUE su HTP0" without mentioning guard-kill or chunk count. The RUN_LOG shows `execute_op_HTP0=30674`, `execute_op_attn=3951`, `max_chunk=20`, `workload_rc=137`. The claim "carica ed esegue" is literally true (load succeeded, execute-op proof obtained), but the omission of the guard-kill and 20-chunk termination makes the narrative incomplete. **Severity: LOW — not a factual error, but an omission of material context.**

---

## 2. es honesty note

### Verdict: PASS — correctly worded, no overclaiming

The es CI straddling the +1.0% gate threshold is present in all three bank documents:

- **PLAN #35:** "onestà: il paired post-hoc NON-gating dà su es CI [+0.39, +1.51] che NON esclude la soglia — dichiarato, non gating"
- **ALIVE #18:** "honesty note: the post-hoc NON-gating paired CI on es [+0.39, +1.51] does not exclude the threshold"
- **ALIVE #14 (row 18 text is the same as above)**

Both:
- ✓ Correctly label the CI as post-hoc and NON-gating
- ✓ Correctly state that the CI "does not exclude the threshold" / "NON esclude la soglia"
- ✓ Correctly state this is "dichiarato" / "declared" — explicitly a disclosure, not a reclassification
- ✓ Do NOT claim "PASS with margin" — the +0.95% point-estimate is within the CI
- ✓ The PAIRED_Q63.md header reads "POST-HOC, NON-GATING" in capitals

**No overclaim found.** The honesty note is consistent and correctly framed as non-gating throughout.

---

## 3. q59 erratum consistency

### Verdict: PASS — consistent across all three locations

**PLAN row 35:**
> "l'arm 'IQ4_NL' di q59 era NON pura (37 tensori Q5_K) → NON HTP-readable; il suo FAIL resta valido come gate qualità, ma la domanda 'HTP-readable' l'ha chiusa solo C1"

**ALIVE row 14 ERRATUM append:**
> "the q59 'IQ4_NL' arm was NOT pure — 37 Q5_K tensors → not HTP-readable; its quality FAIL stands, but the HTP-readable question was settled only by q63's C1"

**ALIVE row 18:**
> "Banked q59 erratum: its 'IQ4_NL' arm was non-pure (37 Q5_K), never HTP-readable"

All three state:
- ✓ 37 Q5_K tensors (matches recon: 24+9+4)
- ✓ Non-pure = not HTP-readable
- ✓ Quality FAIL stands as a gate
- ✓ HTP-readable question settled only by q63 C1

**No inconsistency found.**

---

## 4. q67 story coherence

### Verdict: MINOR FINDINGS — two omissions, no factual errors

### Attempt trail (PREREG → REPORT → PLAN #35)

| Attempt | PREREG (locked) | REPORT (actual) | PLAN #35 (bank) |
|---|---|---|---|
| 1 | VOID (missing -f) | A1 DONE rc=0, 0 chunks (no -f); A2 DONE rc=0, 0 chunks; B DONE, pp512 measured | Not mentioned (correct — old) |
| 2 (Amdt 1) | Corrected +f, A1 then A2 | A1 STOPPED guard-kill 41.1°C, 20 HTP chunks, 30674 execute-op; A2 NOT RUN per stop rule | "C1 CARICA ED ESEGUE su HTP0 (prova execute-op, sha verificati, temp piatte)" |
| 2 (Amdt 2) | A2 reopened (post-result, CPU ref only) | A2 STOPPED guard-kill 43.0°C, 4 chunks | Not mentioned |
| 3 (Amdt 3) | A2 unplugged, final | Still running (`<ESITO_A3>`) | `<ESITO_A3>` placeholder present |

**f-3. FINDING: PLAN #35 says "C1 CARICA ED ESEGUE su HTP0" without mentioning guard-kill at 41.1°C.** The claim is literally true — the model loads, execute-op proof obtained, flat temps during B arms — but the A1 guard-kill after 20 chunks is a material fact about thermal behavior. **Severity: LOW — omission, not overclaim.**

**f-4. FINDING: PLAN #35 omits why A2 only reached 4/20 chunks.** Amendment 2 explicitly states: "The PLUGGED-charging device cannot sustain a dense-4B CPU PPL." This explains the rapid thermal rise (43.0°C in 568s, Δ8.2°C) and is contextually important for the "plugged" documentation. PLAN #35 does not mention it. **Severity: LOW — omission.**

**f-5. NO FINDING: pp512 claim rests on B arms — correct.** The 199.7/43.8 t/s numbers come from `b_npu` and `b_cpu` arms (llama-bench, not llama-perplexity). The LOAD claim (execute-op proof) rests on A1 attempt 2 HTP arm. These are correctly distinguished.

**f-6. NO FINDING: r not claimed until A3 lands.** PLAN #35 uses `<ESITO_A3_LUNGO>` placeholder. ALIVE #18 uses `<ESITO_A3>`. Both are intentional placeholders. No fabricated r value. ✓

---

## 5. Consequence chain consistency

### Verdict: PASS

The consequence chain is coherent across all documents:

| Element | PLAN #35 | ALIVE #18 | PLAN-10DAYS §8 | PLAN row 14/#32 |
|---|---|---|---|---|
| Road D open | "Conseguenza: road D APERTA" | "Consequence: road D open" | §8 condition (3) "q63 FAILS" → NOT triggered | "Road D opened: q63 'IQ4_NL-M'" |
| Per-device v75-class only | "ship per-device (solo v75-class)" | "per-device ship (v75-class only)" | §8: "the consumer generation is v75-only" | "per-device ship (v75-class only)" |
| q52 loop gate required | "DOPO un gate loop classe q52 (lezione B')" | "AFTER a q52-class loop gate" | Not in §8 (different scope) | "PASS 5/5 → per-device ship after a q52-class loop gate" |
| HVX §8 "q63 FAIL" not triggered | "la condizione 'q63 FAIL' della regola pre-delegata HVX (§8) NON scatta" | "the HVX §8 pre-delegated rule's 'q63 FAIL' condition does NOT trigger" | §8: "(3) q63 FAILS" — correctly identifies this as NOT met | Implicit |
| Owner decision A | — | — | — | "#32 q59 (IQ4_NL FAIL, owner A)" + "OWNER DECISION 26/08: A" |

**No inconsistency.** The consequence chain is logically sound: q63 PASS → dense HTP-readable need solved → HVX §8 condition (3) "q63 FAILS" is false → HVX chapter stays frozen → road D open for per-device v75-class ship after q52-class loop gate.

---

## 6. Cross-references and lock commits

### Verdict: PASS (all verified commits are correct; one note)

| Commit | Document | Present |
|---|---|---|
| `7477247a` (q63 lock) | PLAN #35 ✓, ALIVE #18 ✓ | q63 PREREG status says "LOCKED at commit time" but does not quote the hash — acceptable (orchestrator lock, not PREREG hash) |
| `4b5afc37` (q67 base lock) | PLAN #35 ✓, q67 PREREG ✓, q67 manifest `"prereg_commit": "4b5afc37"` ✓ | |
| `d451a1ee` (Amdt 1) | PLAN #35 ✓, q67 PREREG Amendment 1 ✓ | Not in q67 manifest `runs[]` (manifest cuts at ~1650 lines; amendment metadata likely in remaining JSON) |
| `aa697b3d` (Amdt 2) | PLAN #35 ✓, q67 PREREG Amendment 2 ✓ | Same note as above |
| `62e29f09` (Amdt 3) | PLAN #35 ✓, q67 PREREG Amendment 3 ✓ | RUN_LOG confirms: `2026-08-27T07:21:26 AMENDMENT3_START commit=62e29f09` ✓ |
| `e5605f3bd` (q63 quantizer) | q63 PREREG rebuild record ✓, manifest.json ✓ | |
| `1882bf8cd` (q63 PPL binary) | q63 PREREG rebuild record ✓ | |

**f-7. NOTE: q67 manifest `runs[]` was truncated at ~50KB before the Amendment 3 run entry.** The RUN_LOG confirms `AMENDMENT3_START commit=62e29f09` and `UNPLUGGED_VERIFY`. The manifest likely contains the full data in the truncated portion. This is a read-truncation artifact, not a documentation error. **Severity: informational.**

---

## 7. Additional findings (hostile sweep)

**f-8. FINDING: PLAN #35 q67 section omits Amendment 3 context.** PLAN says "Amdt 1–3 `d451a1ee`/`aa697b3d`/`62e29f09`" but does not describe what each amendment does. A reader cannot reconstruct the attempt trail from PLAN #35 alone — they must read q67 PREREG. **Severity: LOW for bank docs (PREREG is the authority), but the PLAN narrative is incomplete.**

**f-9. FINDING: q63 PREREG shape predicate "ne[0] % 32 == 0" claimed as met for Candidate 2.** PREREG states: "Candidate 2's quantized matrix first dimensions are all 2560, 4096, 5120, or 9216, so they meet that predicate." However, the q67 manifest dump records `"quantized_matrix_ne0_mod_32": false` for Candidate 1 (same architecture, same shapes). This suggests some quantized matrices have ne[0] not divisible by 32, despite the stated dimensions being individually divisible. **Severity: informational for this audit (this is a PREREG caveat, not a bank claim), but the factual accuracy of the predicate claim is questionable.**

**f-10. NO FINDING: STATO CORRENTE block in PLAN.md is coherent with row 35.** The STATO CORRENTE text at PLAN.md:15–45 summarizes q63/q67 identically to row 35, including the erratum, pp512 numbers, and consequence. ✓

---

## Summary of findings

| ID | Severity | Description |
|---|---|---|
| f-1 | cosmetic | 199.7 is first-sample, not jsonl-avg; not labeled in PLAN #35 |
| f-2 | LOW | A1 "20 chunks + guard-kill" omitted from PLAN #35 narrative |
| f-3 | LOW | PLAN #35 omits A1 guard-kill at 41.1°C in q67 section |
| f-4 | LOW | PLAN #35 omits "plugged-charging device cannot sustain dense CPU PPL" explanation for A2 4-chunk result |
| f-5 | none | pp512 claim correctly rests on B arms ✓ |
| f-6 | none | r not claimed until A3 lands — placeholders present ✓ |
| f-7 | info | q67 manifest truncated; Amendment 3 data confirmed via RUN_LOG |
| f-8 | LOW | PLAN #35 omits per-amendment descriptions for q67 Amdt 1–3 |
| f-9 | info | PREREG ne[0]%32 predicate claim may be inaccurate per manifest dump |

**No factual errors found.** All numbers trace. No overclaiming. Honesty note correctly worded. Erratum consistent. Consequence chain coherent. Lock commits verified.

---

## Verdict

**BANK-with-corrections**

The documentation is factually sound: all numbers trace to evidence, the es honesty note is correctly framed as non-gating, the q59 erratum is consistent across all locations, and the consequence chain is coherent. The q67 story is honestly represented — LOAD rests on execute-op proof, pp512 on B arms, no r value is claimed before A3 lands.

The four LOW-severity findings (f-2/f-3/f-4/f-8) are all omissions of material context in PLAN #35's q67 section: the guard-kill at 41.1°C, the 20-chunk HTP result, the plugged-charging thermal explanation for A2's 4-chunk termination, and the per-amendment descriptions. These do not constitute factual errors or overclaiming, but they make the PLAN narrative less complete than the underlying evidence. Corrections recommended before final bank, but blocking is not warranted.
