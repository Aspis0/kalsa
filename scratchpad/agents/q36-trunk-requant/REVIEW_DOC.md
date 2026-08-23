# Hostile Review — REPORT.md (q36 trunk-requant)

**Reviewer:** read-only audit, no file edits, no git, no device, no downloads.
**Scope:** REPORT.md + verify_variants.json + NPU_DESK.md + QUALITY_SANITY.md + ab/sanity/ANSWERS.md + QUANTIZE_STATUS.txt.
**Standard:** every claim must rest on evidence present in the cited files; recommendation strength must match evidence strength.

---

## Finding 1 — Recommendation "Do not ship" is stronger than the evidence warrants

**Verdict: PLAUSIBLE**

REPORT.md:6 opens with **"Do not ship B′ from the current KEXP file"** and §7 (line 341–345) labels all three from-KEXP variants as **FAIL**. The evidentiary base is:

- 4 sanity prompts, N=1 per variant, temp 0, greedy.
- q1 (Spa 2000 factual recall): all three variants fail catastrophically.
- q2–q4: pass or match baseline errors.
- Long suite (6 prompts): instruction-following holds; content quality degrades in spots (wrong RAM math, Bogus "server di inferenza", Bari on Milano–Napoli train) but these are scored PASS because the harness tests instruction constraints, not factual accuracy.

The recommendation is **binary** ("do not ship") but the evidence is **N=1 on a single factual-recall prompt per variant**. The report itself acknowledges this in §4 (line 215): "A/B is qualitative, temp 0, one seed-less greedy run per prompt, N=1. That is the campaign's own design." The honest self-assessment makes the binary recommendation audacious: one prompt, one run, four prompts total — and the recommendation is an absolute block.

This is *defensible* if q1 is truly the canary the campaign designed it to be (report says so at line 227: "q1 is the gate the campaign invented this suite for"). But a gate designed for N=1 needs a follow-up with N≥3 before issuing a ship/no-ship verdict. The report never calls for that follow-up; it jumps to "Road A remains necessary" (line 13) instead. The recommendation outruns the data by one experiment.

**Missing:** no power analysis, no confidence interval on the q1 failure rate, no bootstrap or permutation test. For a binary recommendation backed by N=1 per arm, this is thin.

---

## Finding 2 — Source-vs-requant caveat is present but its placement in the table overclaims

**Verdict: CONFIRMED**

The caveat IS present and prominent:

- Opening paragraph (line 9): "destroys factual-recall quality" with context "from its on-disk Q5_K weights."
- §4.1 (line 234): "This understates a from-source Q8_0."
- §6 caveat #1 (line 318): "Every quality number here is Q5_K→{Q8_0,IQ4_NL,Q4_0}, not Q8_0-source→those types."

However, §7's summary table (lines 341–344) says:

```
| trunk Q8_0 from KEXP | +1.95 % | PASS | FAIL (q1 collapse) |
| trunk {Q8_0,...} from original Q8 | unknown | PASS (same dims) | not measured |
```

The row "FAIL (q1 collapse)" does carry "from KEXP" in the first column, but the column header reads **"quality vs shipped KEXP (this cell)"** — a header that refers to the baseline comparison, not to the source path. A reader scanning the table sees **FAIL** in big bold text for Q8_0, without immediately parsing that this FAIL is specifically the double-quant path. The "not measured" row for from-source is visually subordinate.

The claim "Q8_0 is not 'near-lossless vs Q5_K'" (line 230) is correct **for the double-quant path** and is properly qualified in the surrounding text. But the table does not repeat the qualifier; it just says FAIL. The caveat is buried in the prose, not in the decision surface (the table). This is a classic case of correct body text + misleading summary artifact.

**Evidence:** Compare line 341 (table: "FAIL (q1 collapse)") with line 234 (text: "This understates a from-source Q8_0"). The table wins attention; the text correction is weaker.

---

## Finding 3 — NPU desk overclaims runtime HTP success from supports_op predicates

**Verdict: CONFIRMED**

NPU_DESK.md:11 states: **"The trunk itself can run on HTP with Q8_0, IQ4_NL, or Q4_0."** This is a runtime claim. The evidence is entirely static analysis of `ggml-hexagon.cpp` predicates (supports_op, MUL_MAT type switches, dimension checks). NPU_DESK.md:5 correctly states "No device access, no git writes."

The per-tensor table (NPU_DESK.md:128–136) uses ✅ marks for attn_q/k/v/output:

```
| attn_q | [1024, 2048] | ✅ | ✅ | ✅ | PASS |
```

These ✅ symbols communicate "this works" — not "this passes the static predicate check." The distinction matters:

1. **supports_op ≠ runtime success.** HTP buffer allocation can fail at graph-build time. Replication can fail for shapes not tested. HTP firmware versions may not support all tiled variants. None of these are checked by reading C++ source.

2. **NPU_DESK.md:179** itself acknowledges the distinction for GET_ROWS: "This is in the HTP device-side kernel, not just the host predicate. Even if supports_op returned true, the kernel itself rejects non-F32 input." This awareness of predicate-vs-kernel gap is NOT applied consistently to the ✅ marks in the attn tables.

3. **REPORT.md §5** (lines 282–284) inherits the desk's ✅ marks into its summary table as "PASS" without the "(desk)" qualifier that the column header carries. The column header "NPU attn (desk)" is present but the PASS values are not qualified.

**Evidence:** NPU_DESK.md:11 ("can run on HTP") vs NPU_DESK.md:5 ("No device access"); NPU_DESK.md:128–131 (✅ marks) vs NPU_DESK.md:179 (predicate-kernel gap acknowledged only for GET_ROWS).

---

## Finding 4 — "102 MiB" embedding size has no trace in the index

**Verdict: CONFIRMED**

REPORT.md:231 states: "The tied embedding (102 MiB of 217 MiB trunk) is in that round-trip." The trace index (lines 366–377) lists entries for tensor dump, expert sha, dry-run sizes, sanity texts, etc. — but **no entry for the 102 MiB figure**.

The number is derivable by approximation: token_embd has 155,583,488 elements (1024 × 151936); total trunk has 331,744,256 elements; 228,073,472 trunk bytes × 46.9% ≈ 107 MiB. But Q5_K encoding is not byte-uniform across tensor shapes (block overhead, scale factors differ by shape), so this is an approximation. The report presents "102 MiB" as exact without derivation.

If `baseline_tensors.json` contains per-tensor byte counts (the trace index cites it as "tensor dump"), the number could be verified from it. But the report does not say which file gives 102 MiB.

**Evidence:** REPORT.md:231 (102 MiB assertion) vs REPORT.md:366–377 (trace index: no entry for embedding size). Similarly, the "300/300 tokens" repetition claim (line 327) references `ab/sanity/stderr_q8_0.log` in body text but the trace index (line 376) lists only `ab-sanity.log`, not the stderr file.

---

## Finding 5 — Sanity q1 FAIL vs long suite PASS not held together

**Verdict: PLAUSIBLE**

REPORT.md §4.1 (line 227–235) establishes q1 as the gate and all variants fail it. §4.2 (line 237–254) shows the long suite passes. The report does address the tension:

> "The long battery does not reproduce q1's collapse. ... That does not rescue B′: the campaign added the sanity suite specifically because bpb and fluent prose hide 'says things that make no sense', and q1 is that test." (lines 253–255)

This is intellectually honest: the report explicitly says the long suite is the wrong test for this failure mode. But two gaps remain:

**Gap A — The long suite has its own quality failures that are scored PASS.** Q8_0's f45_1_esplicativo response says "7B × 4 B = 28 GB" (wrong RAM math). Q8_0's f45_2_scrittura adds a bogus "server di inferenza" coda. IQ4_NL's long_conversational_it places "Bari" on a Milano–Napoli train. These are factual/content failures that happen to not be instruction-following failures. The table (lines 246–251) marks them PASS because the PASS criterion is instruction constraint compliance, not factual accuracy. The report never explicitly states: "the long suite does not test factual accuracy and therefore its PASS verdicts are not evidence against the q1 failure." It is implied but not stated.

**Gap B — No cross-suite synthesis.** The sanity suite and long suite test different capabilities. The report treats them as separate sections (§4.1, §4.2) without a unified model of "what does this model lose under requant?" A synthesis paragraph that says "trunk requant preserves instruction-following and code generation but destroys single-hop factual recall" would tighten the conclusion. Instead, the report jumps from §4.2 to §5 (NPU desk) without bridging.

**Evidence:** REPORT.md:246–251 (long suite PASS marks with content errors in parentheticals) vs REPORT.md:227 (q1 as the sole gate). The parenthetical notes ("wrong RAM math", "Bari on Milano–Napoli") are data-quality observations that the PASS/FAIL binary discards.

---

## Finding 6 — Q8_0 "near-lossless" refuted only for from-KEXP

**Verdict: CONFIRMED (the refutation is properly scoped, but the scoping is easy to miss)**

REPORT.md:230–235 states:

> "Q8_0 is not 'near-lossless vs Q5_K': dequant Q5_K → quant Q8_0 is a different grid (Q5_K superblocks vs Q8_0/32). The tied embedding (102 MiB of 217 MiB trunk) is in that round-trip. This understates a from-source Q8_0 (which would not start from Q5_K). It does falsify 'just requant the file we ship'."

This is technically precise: the refutation applies to the double-quant path (Q5_K → Q8_0), not to a from-source Q8_0 (F16/Q8_0 → Q8_0). The phrase "dequant Q5_K → quant Q8_0" correctly identifies the mechanism.

However, the report NEVER explicitly states the converse: "a from-source Q8_0 may be near-lossless." The closest is "This understates a from-source Q8_0" (line 234), which says the current experiment understates from-source quality but does not commit to whether from-source would pass q1.

The opening paragraph (line 9) says "destroys factual-recall quality" without the "from-KEXP" qualifier in that clause. The qualifier appears in the preceding phrase ("from its on-disk Q5_K weights") but the subject-verb link ("destroys factual-recall quality") is detached from the qualifier. A reader who skips the conditional clause sees "requantizing trunk ... destroys factual-recall quality" as a universal claim.

**Evidence:** REPORT.md:9 ("destroys factual-recall quality" — universal-sounding) vs REPORT.md:234 ("understates a from-source Q8_0" — scoped correction buried 225 lines later).

---

## Summary Table

| # | Finding | Verdict | Primary file:line |
|---|---|---|---|
| 1 | "Do not ship" recommendation stronger than N=1 evidence | **PLAUSIBLE** | REPORT.md:6 (rec), REPORT.md:215 (N=1 ack) |
| 2 | Source-vs-requant caveat present in prose but overclaimed in summary table | **CONFIRMED** | REPORT.md:341 (table FAIL) vs REPORT.md:234 (text qualifier) |
| 3 | NPU desk overclaims runtime HTP from static predicates | **CONFIRMED** | NPU_DESK.md:11 ("can run on HTP") vs NPU_DESK.md:5 ("No device") |
| 4 | "102 MiB" embedding and "300/300" stderr lack trace index entries | **CONFIRMED** | REPORT.md:231 (102 MiB) vs REPORT.md:366–377 (trace index) |
| 5 | Sanity FAIL vs long PASS tension acknowledged but not synthesized | **PLAUSIBLE** | REPORT.md:253–255 (partial address) vs REPORT.md:246–251 (content errors scored PASS) |
| 6 | Q8_0 "near-lossless" refuted only for from-KEXP, qualifier easy to miss | **CONFIRMED** | REPORT.md:9 (universal-sounding) vs REPORT.md:234 (scoped correction) |

---

## Meta-observations

**Strengths the review does not challenge:**
- The expert identity verification (SHA256 across all four files, verify_variants.json) is rigorous.
- The QUANTIZE_STATUS.txt wall-time numbers are internally consistent with dry-run logs.
- The NPU_DESK.md predicate analysis is thorough and correctly cited to specific ggml-hexagon.cpp lines.
- The double-quant caveat is present in the prose — the issue is prominence, not absence.

**Structural weakness:** REPORT.md conflates two experiments in one document: (A) can-from-KEXP-requant preserve quality? (B) which trunk type would win B′? Experiment A has a clear answer (no). Experiment B has no answer ("not measured" for from-source). The recommendation "Do not ship" answers A but is presented as answering B. The document would be stronger if it separated these and issued conditional recommendations: "Do not ship from-KEXP requant. To evaluate from-source, re-download Q8_0 and re-run."
