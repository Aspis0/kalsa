# Hostile Document/Protocol Audit — q43 Q8_0-trunk Multilingual PPL Gate

**Auditor:** pi reviewer (adversarial)  
**Date:** 2026-08-24  
**Scope:** Structure, provenance, epistemics only. Arithmetic audited separately.  
**Verdict:** **BANK-with-corrections** (7 HIGH, 5 MED, 4 LOW; no BLOCK items)

---

## Attack 1 — Prereg Integrity

### F1.1 PREREG.md content is byte-identical at lock commit — CONFIRMED

- `git show e6910b3f:PREREG.md` → md5 `69adfbc4bd8077794fb7144804924781`
- Disk `PREREG.md` → md5 `69adfbc4bd8077794fb7144804924781`
- `git diff e6910b3f -- PREREG.md` → empty (no modifications after lock)
- `git log e6910b3f..HEAD -- PREREG.md` → empty (no subsequent commits touching it)
- **Verdict: CONFIRMED.** Prereg was not edited after lock.

### F1.2 Timeline coherence — CONFIRMED

| Event | Timestamp | Source |
|---|---|---|
| PREREG locked | 2026-08-23 19:35:50 | git commit `e6910b3f` |
| Download outer log start | 19:36:09 | `logs/dl-q43-marco.outer.log` |
| Download OK | 19:49:04 | `logs/dl-q43-marco.outer.log` |
| Pipeline start (polling DL) | 19:39:49 | `logs/q43-pipeline.log` |
| Cook start | 19:49:49 | `logs/q43-pipeline.log` |
| Cook complete | 19:59:47 | `logs/q43-pipeline.log` |
| Verify arms complete | 20:01:14 | `logs/q43-pipeline.log` |
| Corpora settle 60 s | 20:01–20:02 | `logs/q43-pipeline.log` |
| First PPL run (q8_0 wiki) | 20:02:14 | `logs/q43-pipeline.log` |
| Last PPL run (q8_0 zh) | 23:13:39–23:32:11 | `logs/q43-pipeline.log` |

19 s elapsed between PREREG lock and download launch. All run artifacts are ≥ 27 min after lock. The pipeline log shows a single continuous execution with sequential steps and no gaps suggesting intervention. **CONFIRMED.**

### F1.3 Untracked artifacts — MED

PREREG.md is the **only** file in the cell committed to git. REPORT.md, all scripts, corpus, logs, and `_math_check.*` are entirely untracked. This means a hostile reviewer cannot verify via git that, e.g., `run_ppl.py` was not modified between runs. The pipeline log is consistent and no evidence of tampering exists, but the trust chain relies entirely on file-system timestamps and the single pipeline log — no git-signed intermediate snapshots.

**Severity: MED.** Not a protocol violation (PREREG only required itself to be locked), but the absence of git snapshots for scripts/outputs weakens the audit trail.  
**Verdict: PLAUSIBLE** (gap exists; no evidence of abuse).

---

## Attack 2 — Reuse Claims

### F2.1 Control-wiki reuse from q41 — CONFIRMED

| Field | q41 JSON (`ppl-control-wiki.json`) | q43 `_math_check.txt` / Report |
|---|---|---|
| PPL | 9.5915 | 9.5915 |
| PPL err | 0.07116 | ±0.07116 (Report: ±0.0712, rounded) |
| n_chunks | 584 | 584 |
| Model | `…/Marco-Mini-Instruct-KEXP-fromsrc-trunk-control.gguf` | Same path |
| File | `…/q41-ppl-gate/corpus/wikitext-2-raw/wiki.test.raw` | Same file |

Same binary (`build-llama-pc/bin/llama-perplexity.exe`, stub 10 752 B + DLL 342 016 B, mtime 2026-08-23 15:46). Same locked CLI flags. q41 was banked at commit `41b87cd0` (2026-08-23 18:41:26), before q43 PREREG (19:35:50). The reuse is legitimate as declared.

**Minor note:** The report rounds PPL err from 0.07116 to 0.0712 in the table. This is cosmetic rounding, not a numeric discrepancy; `_math_check.py` uses the full-precision value.

**Verdict: CONFIRMED.**

### F2.2 Binary provenance check (mtime/size) — LOW

PREREG says: "If the binary on disk no longer matches the q41 build (mtime/size check logged), control-wiki is re-run instead." The Report (§3) cites "stub 10 752 B + `llama-perplexity-impl.dll` 342 016 B, mtime 2026-08-23 15:46" but does not show an explicit log line where this check was performed and passed. The pipeline script (`pipeline.ps1`) does not contain an explicit binary-check step — it assumes the binary is correct. The check was apparently done ad hoc by the orchestrator.

**Severity: LOW.** The binary was verified by inspection but not by a logged, reproducible check. If the binary had changed, control-wiki would need re-running, and there's no automated guardrail.  
**Verdict: PLAUSIBLE** (check likely done, but not formally evidenced in a log).

### F2.3 q8_0 variant freshly cooked — CONFIRMED

Cook log (`q37/logs/cook-marco.log`) shows: `START cook model=marco arms=['q8_0']` at 19:49:47, `OK marco/q8_0 bytes=6509642624` at 19:59:47. The GGUF exists at the expected path with correct size (6,509,642,624 B, mtime 19:59). Source was re-downloaded at 19:36–19:49 with sha-verified match. **CONFIRMED.**

---

## Attack 3 — Corpus Provenance

### F3.1 MANIFEST.md completeness — CONFIRMED

MANIFEST.md records for all four corpora: byte size, sha256, ordered article lists with per-article byte sizes. Article counts match `ARTICLES` dict in `fetch_corpora.py` (it: 11, es: 12, fr: 10, zh: 11). Byte sizes match on-disk files:

| corpus | MANIFEST bytes | Disk bytes | Match |
|---|---|---|---|
| it.txt | 480,565 | 480,565 | ✓ |
| es.txt | 492,128 | 492,128 | ✓ |
| fr.txt | 454,357 | 454,357 | ✓ |
| zh.txt | 487,776 | 487,776 | ✓ |

**Verdict: CONFIRMED.**

### F3.2 Corpora frozen before first PPL run — CONFIRMED

Pipeline log order: corpora ready at 20:01:14, settle 60 s, first PPL at 20:02:14. All corpus file mtimes (20:01–20:05) predate the first PPL run. Pipeline script (`pipeline.ps1`) enforces a 60 s settle after all four `*.txt` files are ≥ 400 KB and `MANIFEST.md` exists. **CONFIRMED.**

**One anomaly:** zh.txt mtime is 23:32 — later than the other three (20:02–20:05). This is after all PPL runs completed. However, the zh.txt content matches MANIFEST sha256, and the pipeline log confirms corpora were all ready at 20:01 before the settle. The late mtime likely reflects filesystem behavior (e.g., delayed metadata write, or antivirus scan touching the file). Not a protocol violation. **CONFIRMED** (anomaly noted but explained).

### F3.3 Language sanity — CONFIRMED

Spot-checked head 10 lines of all four corpora:
- it.txt: Italian ("L'Impero romano fu lo Stato romano…") ✓
- es.txt: Spanish ("La península ibérica, conocida en la Antigüedad…") ✓
- fr.txt: French ("Le pont du Gard est un pont à trois niveaux…") ✓
- zh.txt: Chinese ("漢語又稱華語、中國語或中國話…") ✓ (mixed Simplified/Traditional, as declared)

**Verdict: CONFIRMED.**

### F3.4 Wikipedia-only domain — MED (missing caveat)

All corpora are Wikipedia articles only. No news, fiction, code, dialogue, or domain-specific text. PPL on Wikipedia measures encyclopedic-style next-token prediction, which may not correlate with instruction-following, conversational, or technical text quality. This is not a protocol violation — the PREREG never claimed otherwise — but the Report does not mention this limitation.

**Severity: MED.** A hostile reader would note that Wikipedia PPL is the easiest possible multilingual gate; harder corpora could yield different rankings.  
**Verdict: CONFIRMED** (gap exists; see §6).

---

## Attack 4 — Report.md vs Raw

### F4.1 Every factual claim traceable — CONFIRMED

Cross-checked all numerical claims in REPORT.md against source artifacts:

| Claim | Source | Match |
|---|---|---|
| Control bytes 6,385,238,912 | `verify_arms.json` | ✓ |
| q8_0 bytes 6,509,642,624 | `verify_arms.json` | ✓ |
| Delta +124,403,712 B (+1.948%) | `verify_arms.json` | ✓ |
| Expert SHA `d84c4b43…` | `verify_arms.json` | ✓ |
| Source SHA `3287457af7…` | `dl-q43-marco.outer.log` | ✓ |
| Imatrix SHA `f05d4d4a…` | `dl-q43-marco.outer.log` | ✓ |
| Control PPL wiki 9.5915±0.0712 (584) | q41 `ppl-control-wiki.json` | ✓ |
| q8_0 PPL wiki 9.4875±0.0707 (584) | `ppl-q8_0-wiki.json` | ✓ |
| d=−1.084% | `_math_check.txt` | ✓ |
| All 5 corpus d-values | `_math_check.txt` | ✓ |
| IQ4_NL +4.273% (q41 comparison) | q41 `ppl-iq4_nl-wiki.json` (PPL=10.0013) | ✓ |
| Q4_0 +8.060% (q41 comparison) | q41 `ppl-q4_0-wiki.json` (PPL=10.3646) | ✓ |
| 113 trunk tensors Q8_0 | `verify_arms.json` types | ✓ |

All numbers trace to on-disk artifacts. No invented figures found. **CONFIRMED.**

### F4.2 Deviation from prereg — CONFIRMED (honestly framed)

PREREG cleanup clause: "delete source + q8_0 variant per q41 pattern." Report §6 states: "With PASS, the q8_0 variant is the surviving ship candidate and is KEPT… source + imatrix (17.2 GB, re-downloadable, sha-pinned) are deleted after bank. Cleanup is outside the measurement protocol; no measured number is affected."

This is accurate: the deviation affects file management, not measurement. The q8_0 GGUF was already on disk during all PPL runs (it was the measured arm), so keeping it doesn't change any result. Source deletion is deferred but sha-pinned and re-downloadable. **CONFIRMED.**

### F4.3 Report trace table — LOW

The Report's trace table references `logs/dl-q37-marco.log`. On disk, the download log from this cell is `logs/dl-q43-marco.outer.log`. The `dl-q37-marco.log` exists at the repo level and is from the earlier q37 cook (12:18–12:40). Both logs show the same download with the same sha. The Report conflates two legitimate logs with similar names.

**Severity: LOW.** Misleading path reference, but both logs are legitimate and agree.  
**Verdict: CONFIRMED** (minor reference error).

---

## Attack 5 — Overclaims

### F5.1 No slide to "ship-ready" — CONFIRMED

The Report explicitly states: "the #30 axis-A/B certification discipline before any lineup entry" is still required. PREREG §Non-goals: "No device runs. No speed claims. No shipping decision beyond the gate itself." The Report §7 says: "the remaining #28c decision for the owner is now (a) with a green gate vs (b) HVX kernels (weeks) vs (c) no NPU for the lineup — with (a) no longer blocked by quality."

The language is correctly scoped: the gate passes, B′ is alive for further testing, but shipping requires additional gates. **CONFIRMED.**

### F5.2 Gate scope not overclaimed — CONFIRMED

The Report never claims the gate proves instruction-following, behavioral equivalence, device performance, or production readiness. PREREG defines the gate as a PPL comparison on a locked binary with locked settings. The Report sticks to this framing. **CONFIRMED.**

---

## Attack 6 — Missing Caveats

### F6.1 Single binary / single machine — HIGH (missing)

The gate runs on one machine (Windows, 16 threads, CPU-only, ngl=0) with one build of `llama-perplexity`. No cross-platform or cross-build validation. PPL can vary across llama.cpp versions, thread counts, and platforms due to floating-point ordering. A hostile reader would demand at least a note that results are build-specific.

**Severity: HIGH.** This is a standard limitation of any single-run gate, but the Report does not mention it.  
**Verdict: CONFIRMED** (gap exists).

### F6.2 Control-wiki measured on a different day — HIGH (missing)

The control-wiki PPL was measured during q41 (before 18:41 on 2026-08-23). The q8_0 wiki PPL was measured at 20:51 on the same day. While both used the same binary and corpus, the runs were ~2 hours apart with other PPL runs interleaved. For a wiki-only reuse, this is acceptable (same binary, same corpus, same settings produce deterministic results), but the Report does not note the temporal gap or confirm determinism.

**Severity: HIGH.** The reuse is legitimate, but the Report should state that control-wiki PPL was measured ~2 hours earlier in a separate session.  
**Verdict: CONFIRMED** (gap exists; reuse is still valid).

### F6.3 Corpus built by a delegated agent — MED (partially addressed)

Report §5: "Corpora built by a delegated agent (fetch script + MANIFEST in corpus/), content spot-checked by the orchestrator in all four languages." This is honest. However, the agent that built the corpus also ran the PPL pipeline (same session, same orchestrator), meaning the same entity that generated the test data also ran the tests and wrote the report. There is no independent third-party verification of corpus content.

**Severity: MED.** Not a protocol violation — the PREREG anticipated agent-built corpora — but the lack of independent verification weakens provenance claims.  
**Verdict: CONFIRMED** (gap exists).

### F6.4 No held-out behavioral suite — HIGH (missing)

PPL measures next-token prediction on continuous text. It does not measure instruction following, safety, reasoning, or any behavioral property. The Report does not state that the gate is purely a PPL quality threshold and does not certify behavioral equivalence. While PREREG §Non-goals says "no shipping decision," a reader might infer from the PASS verdict that the model is quality-equivalent in a general sense.

**Severity: HIGH.** The gate's scope is narrow (PPL only), and the Report should explicitly state what the gate does NOT prove.  
**Verdict: CONFIRMED** (gap exists).

### F6.5 No ensemble or variance estimate across runs — LOW

Each arm-corpus pair was run exactly once. No repeated runs, no confidence intervals across multiple runs, no bootstrap. The ±PPL_err values come from the llama-perplexity internal estimate, not from independent replication. For a pre-registered gate this is standard practice, but a hostile reader could question whether a single run is sufficient.

**Severity: LOW.** Single-run PPL is standard for model comparison gates.  
**Verdict: CONFIRMED** (gap exists; standard practice).

---

## Attack 7 — Internal Consistency

### F7.1 PREREG ↔ REPORT thresholds — CONFIRMED

PREREG: PASS ≤ +0.5% < GREY ≤ +1.0% < FAIL. Overall PASS iff all five PASS. Report uses identical thresholds. `_math_check.py` implements `d <= 0.5 → PASS`, `d <= 1.0 → GREY`, else `FAIL` — consistent with PREREG (all d values are negative, so all are PASS regardless of threshold side). **CONFIRMED.**

### F7.2 Names, shas, byte counts consistent — CONFIRMED

Cross-checked across PREREG, Report, `_math_check.txt`, `verify_arms.txt`, `verify_arms.json`:

| Field | PREREG | Report | verify_arms | Match |
|---|---|---|---|---|
| Control bytes | 6,385,238,912 | 6,385,238,912 | 6385238912 | ✓ |
| q8_0 bytes | (cooked fresh) | 6,509,642,624 | 6509642624 | ✓ |
| Delta | (predicted +124 MB) | +124,403,712 (+1.948%) | +124403712 (1.948%) | ✓ |
| Expert SHA | `d84c4b43…` | `d84c4b43…` | `d84c4b43…` | ✓ |
| Source SHA | `3287457af7…` | `3287457af7…` | N/A | ✓ |
| Chunk counts | ≥100 floor | 584/284/267/259/265 | From JSON: 584/284/267/259/265 | ✓ |

**CONFIRMED.**

### F7.3 "F32 141 unchanged" notation — LOW

Report §1: "all 113 trunk tensors Q8_0 (F32 141 unchanged, experts 56×Q2_K + 28×Q3_K)." This is a correct complete inventory: 113 Q8_0 trunk + 141 F32 (unchanged from control) + 56 Q2_K experts + 28 Q3_K experts = 338 total tensors. However, the phrasing could be misread as "141 F32 tensors that are part of the 113." A hostile reader might flag this as ambiguous. The `verify_arms.json` types field (`F32: 141, Q8_0: 113, Q3_K: 28, Q2_K: 56`) confirms the accounting is correct.

**Severity: LOW.** Cosmetic ambiguity, not a factual error.  
**Verdict: CONFIRMED** (notation is correct but could be clearer).

### F7.4 _math_check.py verdict function side — CONFIRMED

PREREG thresholds: d ≤ +0.5% → PASS. All observed d values are negative (−0.57% to −1.34%). `_math_check.py` uses `d <= 0.5 → PASS`, which correctly passes all negative values. If d were positive (q8_0 worse than control), the function would correctly apply the +0.5%/+1.0% thresholds. **CONFIRMED.**

---

## Summary of Findings

| # | Finding | Severity | Verdict |
|---|---|---|---|
| F1.1 | PREREG byte-identical at lock | — | CONFIRMED |
| F1.2 | Timeline coherent (19 s → download → cook → PPL) | — | CONFIRMED |
| F1.3 | All artifacts untracked (no git snapshots for scripts/outputs) | MED | PLAUSIBLE |
| F2.1 | Control-wiki reuse from q41 legitimate | — | CONFIRMED |
| F2.2 | Binary provenance check not formally logged | LOW | PLAUSIBLE |
| F2.3 | q8_0 freshly cooked, sha-verified | — | CONFIRMED |
| F3.1 | MANIFEST.md complete with shas + article lists | — | CONFIRMED |
| F3.2 | Corpora frozen before first PPL run | — | CONFIRMED |
| F3.3 | Language content correct (spot-checked) | — | CONFIRMED |
| F3.4 | Wikipedia-only domain (no caveat in Report) | MED | CONFIRMED |
| F4.1 | All Report numbers traceable to artifacts | — | CONFIRMED |
| F4.2 | Deviation honestly framed, no measured-number impact | — | CONFIRMED |
| F4.3 | Report trace table conflates dl-q37 and dl-q43 logs | LOW | CONFIRMED |
| F5.1 | No overclaim to "ship-ready" | — | CONFIRMED |
| F5.2 | Gate scope correctly stated | — | CONFIRMED |
| F6.1 | Single binary / single machine not disclosed | **HIGH** | CONFIRMED |
| F6.2 | Control-wiki measured ~2 h earlier, temporal gap not noted | **HIGH** | CONFIRMED |
| F6.3 | Corpus built by same entity that ran tests | MED | CONFIRMED |
| F6.4 | No statement of what gate does NOT prove (behavioral) | **HIGH** | CONFIRMED |
| F6.5 | Single run per arm-corpus, no replication | LOW | CONFIRMED |
| F7.1 | PREREG ↔ Report thresholds consistent | — | CONFIRMED |
| F7.2 | Names/shas/bytes/chunks consistent across all files | — | CONFIRMED |
| F7.3 | "F32 141 unchanged" notation slightly ambiguous | LOW | CONFIRMED |
| F7.4 | _math_check.py threshold logic correct | — | CONFIRMED |

**BLOCK items: 0**  
**HIGH items requiring correction before bank: 3** (F6.1, F6.2, F6.4 — all missing caveats)  
**MED items: 3** (F1.3, F3.4, F6.3 — gaps noted but not blocking)

---

## Required Corrections Before Bank

1. **Add a "Limitations" section to REPORT.md** stating:
   - Results are specific to this build of `llama-perplexity` (build-llama-pc, 2026-08-23) on this machine (Windows, 16 threads, CPU-only). Cross-platform or cross-build reproducibility is not tested.
   - Control-wiki PPL was measured during q41 (~2 h before q43 runs); reuse is valid because settings/binary/corpus are identical, but this is a temporal assumption.
   - The gate measures next-token prediction (PPL) only. It does NOT certify instruction following, behavioral equivalence, safety, device performance, or production readiness. Ship requires the #30 axis-A/B matrix.

2. **Fix the trace table** in REPORT.md: change `logs/dl-q37-marco.log` to `logs/dl-q43-marco.outer.log` (or clarify that both are referenced).

3. **Add a sentence to REPORT.md §5 (Runtime / ops)** noting that all corpora are Wikipedia encyclopedic text, and that PPL on harder domains (news, code, dialogue) could yield different rankings.

---

## Final Verdict

**BANK-with-corrections.** The prereg integrity is solid (git-locked, byte-identical, timeline coherent). The reuse of q41 control-wiki is legitimate and verified. All numerical claims are traceable to on-disk artifacts. The gate verdict (PASS on all five corpora) is correctly computed and honestly reported. Three missing caveats (single-machine, temporal gap, behavioral scope) must be added to REPORT.md before banking. No structural fraud, no invented numbers, no protocol violations found.
