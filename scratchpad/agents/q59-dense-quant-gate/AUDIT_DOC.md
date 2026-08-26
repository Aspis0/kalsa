# q59 — Documentary Audit (AUDIT_DOC.md)

Auditor: hostile documentary reviewer. Read-only. Numbers already certified by
AUDIT_MATH.md (VERDICT BANK-WITH-CORRECTIONS, wording only; all numbers CONFIRMED).
Scope: cross-file consistency, verdict wording, math-audit corrections applied, owner-decision
framing, q41 distinction, structure/hygiene, and anything else.

---

## 1. CROSS-FILE CONSISTENCY

### 1.1 PLAN #32 vs REPORT.md / PAIRED.md / ARBITRATION.md — Δ% per corpus

| File | wiki | it | es | fr | zh |
|---|---|---|---|---|---|
| REPORT.md | −1.1565 | +0.8410 | +1.3927 | +0.4611 | +1.0238 |
| ARBITRATION §1 | −1.1565 | +0.8410 | +1.3927 | +0.4611 | +1.0238 |
| PLAN #32 | −1.16 | +0.84 | +1.39 | +0.46 | +1.02 |
| ALIVE #14 | −1.16 | +0.84 | +1.39 | +0.46 | +1.02 |

**PASS.** PLAN/ALIVE use 2-decimal truncation of REPORT's 4-decimal values. No rounding
direction error: −1.1565→−1.16 (rounds to 2dp, correct), +0.8410→+0.84, +1.3927→+1.39,
+0.4611→+0.46, +1.0238→+1.02. All within ±0.01 of the certified value.

### 1.2 Q4_0 Δ% range

- PLAN #32: "+2.15…+3.36 sulle 4 lingue" — matches REPORT fr +2.1522, zh +3.3575. ✓
- ALIVE #14: "+2.15…+3.36 on all four languages" — same. ✓
- ARBITRATION §2(3): "lower bound ≥ +1.69 %" — min CI low = fr +1.6944 ≥ 1.69 ✓

### 1.3 CI upper bound +1.93%

- PAIRED.md: max IQ4_NL CI high = es +1.9294. ✓
- PLAN #32: "upper bound ≤ +1.93 %" — 1.9294 rounds to 1.93. ✓
- ALIVE #14: "upper bound ≤ +1.93 %" — same. ✓
- ARBITRATION §2(1): "≤ +1.93 %" — same. ✓

### 1.4 Q4_0 lower bound ≥ +1.69%

- PAIRED.md: min Q4_0 CI low = fr +1.6944. ✓
- PLAN #32: "Q4_0 lower bound ≥ +1.69 % ovunque" ✓
- ALIVE #14: implied by "Q4_0 +2.15…+3.36" (not explicit about CI lower bound, but not
  contradicting). ✓

### 1.5 Size −3.4% / −5.1%

- REPORT.md: −3.3772% (same-source), −5.1334% (shipped). ✓
- PLAN #32: "−3.4 % vs Q4_K_M same-source (−5.1 % vs shipped unsloth)" ✓
- ALIVE #14: "Size −3.4 %" (only same-source; no shipped comparison stated). ✓
- AUDIT_MATH.md A4: "−3.3772%" confirmed.

**MINOR.** PLAN #32 and ALIVE #14 both round −3.3772% to −3.4% (2dp round) and −5.1334%
to −5.1% (1dp truncation). These are minor rounding representations. The actual numbers in
REPORT.md are higher-precision and the certified values. No substance lost.

### 1.6 Chunk counts

- PLAN #32: "15/15 celle e sha ricalcolati su disco" — present. ✓
- ALIVE #14: does not list per-corpus chunk counts. Not required (summary row). ✓
- ARBITRATION §1: "64/60/59/59/61" — matches REPORT.md. ✓
- AUDIT_MATH A2: confirmed. ✓

### 1.7 Commit/prereg IDs and source revision

| Claim | File | Value | Verified |
|---|---|---|---|
| prereg `f10d997b` | PLAN #32, ALIVE #14, manifest.json, RUN_LOG.md | `f10d997b` | ✓ consistent |
| source `851bf6e8` | PLAN #32, REPORT.md, manifest.json, RUN_LOG.md | `851bf6e8` | ✓ consistent |
| quantizer `e5605f3bd` | PLAN #32, REPORT.md | `e5605f3bd` | ✓ consistent |
| PPL binary `1882bf8cd` | REPORT.md, RUN_LOG.md, AUDIT_MATH B2 | `1882bf8cd` | ✓ consistent |

**PASS.** All cross-referenced IDs match across every file that mentions them.

### 1.8 Sign p thresholds

- PAIRED.md: it 4.224e-5, es 5.126e-6, fr 3.794e-3, zh 2.643e-4.
- PLAN #32: "sign p ≤ 4e-3" — correct upper bound for all four (worst = fr 3.794e-3 ≤ 4e-3). ✓
- ALIVE #14: "sign p ≤ 4e-3" — same. ✓
- ARBITRATION §2(1): "p = 4.2e-5/5.1e-6/3.8e-3/2.6e-4" — correct rounded values. ✓

### 1.9 SE range 0.15–0.30 pp, 6–7× reduction

- PAIRED.md SE values: wiki 0.00505, it 0.00153, es 0.00269, fr 0.00177, zh 0.00297 (all in NLL).
  These are in NLL units, not percentage points directly. The 0.15–0.30 pp claim is about the
  Δ% CI half-widths: it ±0.30 pp, es ±0.54 pp, fr ±0.35 pp, zh ±0.59 pp.
- PLAN #32: "SE 0.15–0.30 pp" — this is narrower than the actual CI half-widths (0.30–0.59 pp).
- ARBITRATION §2(1): "SE 0.15–0.30 pp" — same claim.

**MINOR.** The claim "SE 0.15–0.30 pp" appears to conflate the SE with the CI half-width.
The SE values (from PAIRED.md) are: it SE=0.00153 NLL → in Δ% terms ≈ 0.15 pp; es SE=0.00269 →
≈0.27 pp; fr SE=0.00177 → ≈0.18 pp; zh SE=0.00297 → ≈0.30 pp. So SE range 0.15–0.30 pp is
actually correct if we interpret it as SE of Δ% (not CI half-width). The CI half-width = 1.96 ×
SE = 0.29–0.59 pp. The "6–7× reduction" claim refers to the naive ±err ~1.0–1.15% being 6–7×
the paired SE. This is arithmetically correct (1.0/0.15 ≈ 6.7, 1.15/0.30 ≈ 3.8 — wait).

**MAJOR.** Let me re-examine: "SE 0.15–0.30 pp, 6–7× più stretta del ±err naive". The naive
per-arm ±err is ~1.0–1.15% of PPL (from the log's `Final estimate +/-` values). The paired SE is
the SE of the *difference*, which is ≈ 0.15–0.30 pp. But "6–7×" is the ratio of naive to
paired SE: max naive 1.15% / min paired SE 0.15 pp = 7.7×; min naive 1.0% / max paired SE 0.30
pp = 3.3×. The "6–7×" claim only holds for the favorable end of the range. The actual range of
reduction factors is roughly 3.3–7.7×.

**Actually**: the "naive ±err" is not an SE of Δ% — it's the PPL error bar on each arm
separately. For the paired analysis, the relevant comparison is the naive Δ% uncertainty
(~√2 × 1% ≈ 1.4% = 140 pp relative) vs the paired SE (0.15–0.30 pp). That gives a
reduction of 140/30 ≈ 4.7× to 140/150… hmm, this interpretation doesn't work either.

The cleanest reading: PLAN #32 says "6–7× più stretta del ±err naive". The naive per-arm
error is ±(1.0–1.15)% of PPL. The paired SE of Δ% is 0.15–0.30 pp (from the PAIRED CIs:
half-width/1.96). The "6–7×" claim is: 1.0% / 0.15pp = 6.7×; 1.15% / 0.17pp = 6.8×.
These are cherry-picked extremes. The actual reduction range across the four language
corpora is approximately 3.3–7.7×. The claim "6–7×" is stated as a general figure but
only holds for the best-corpus end.

**Fix wording**: change to "3–7× più stretta" or "fino a 7× più stretta".

### 1.10 Plan #32 pipe count / table structure

PLAN row 32 has 4 pipes → 3 columns, matching the table header `| # | Cosa | Chi/quando |`
(also 3 columns). **PASS.** Column count is correct.

ALIVE row 14 has 4 pipes → 3 columns, matching its table header (3 columns). **PASS.**

### 1.11 gguf files out of git

- .gitignore contains `*.gguf` and `*.safetensors`. ✓
- `gguf/source/` contains `.safetensors` files → covered. ✓
- `gguf/` contains `.gguf` files → covered. ✓
- The q59 directory is untracked (git status confirms). ✓
- PLAN #32 says "i gguf da 2.5–2.8 GB restano fuori git" — this is correct. ✓

**NOTE.** The `gguf/source/` directory also contains `config.json`, `merges.txt`,
`tokenizer.json`, `tokenizer_config.json`, `vocab.json` which are NOT in .gitignore.
These are NOT the gguf/safetensors files and are small metadata. The claim "i gguf
restano fuori git" is about the model files, not these metadata files. Not a defect
in the claim. The entire q59 directory is untracked so nothing is committed.

### 1.12 gguf/source/ metadata not claimed as committed

- ARBITRATION does not claim source metadata is committed. ✓
- PLAN #32 does not claim source metadata is committed. ✓
- The evidence path statement says `gguf/ppl/*.{json,log}` (raw results), not source. ✓

**PASS.** No document claims the source metadata files are committed.

---

## 2. VERDICT WORDING

### 2.1 FAIL verdict — no softening

| File | Verdict statement |
|---|---|
| REPORT.md | "IQ4_NL all-corpus gate FAIL", "Q4_0 all-corpus gate FAIL" |
| ARBITRATION §1 | "IQ4_NL: FAIL (2/5 corpora above +1.0%)", "Q4_0: FAIL (4/5)" |
| ARBITRATION §1 | "Nothing below re-opens the gate" |
| PLAN #32 | "IQ4_NL FAIL, Q4_0 FAIL → nessun denso HTP-readable spedisce" |
| ALIVE #14 | "IQ4_NL FAIL, Q4_0 FAIL; no dense HTP-readable quant ships" |

**PASS.** The FAIL verdict is stated unambiguously in all four files. No sentence softens it
to a pass.

### 2.2 Paired analysis labelled non-gating

| File | Label |
|---|---|
| PAIRED.md title | "POST-HOC, NON-GATING" |
| PAIRED.md:3 | "does not alter the preregistered point-estimate gate or its verdict" |
| ARBITRATION §2 | "post-hoc, non-gating" (header); "Δ%_point is the paired point estimate, not a new gate decision" |
| PLAN #32 | "post-hoc, NON-gating, `PAIRED.md`" |
| ALIVE #14 | "Paired per-chunk reading (post-hoc, non-gating)" |

**PASS.** Every mention of the paired analysis in PLAN/ALIVE/ARBITRATION is labelled
"non-gating" or equivalent.

### 2.3 No re-litigation of the gate

ARBITRATION §1 states: "Nothing below re-opens the gate." The §2 reading is explicitly
labelled post-hoc. The §3 options are framed as owner decisions, not as reversals.
**PASS.**

---

## 3. MATH-AUDIT CORRECTIONS APPLIED

### Correction 1: PAIRED.md rounding-floor banner

**AUDIT_MATH finding #1 (MAJOR wording):** Replace the `**IMPORTANT: … NOT negligible**`
banner and "NOT negligible vs mean |d|" assessments with quantitative statement.

**Current PAIRED.md:** The file has been regenerated. The current text states:
> "The `(2N−1)·5e-5/P_N` figure is a worst-case bound on the last chunk's reconstructed
> value; the pairwise `d_N` bound below is the sum of candidate and control bounds. This
> is a numerical floor for reconstructed per-chunk values, not additional model
> uncertainty."

The word "IMPORTANT" does not appear. The word "negligible" does not appear as a banner.
The file explains the floor is per-chunk, not additional model uncertainty. The
assessment table columns are: "control nll_N floor", "pair floor", "pair floor / mean".
**APPLIED.** The banner has been replaced. The current wording is consistent with the
math audit's finding.

**Quote (PAIRED.md:14-17):**
> "The `(2N−1)·5e-5/P_N` figure is an upper bound only when `P_{N−1} ≥ P_N`. The exact
> adjacent-term bound is `N·5e-5/P_N + (N−1)·5e-5/P_{N−1}`; it is approximately 1.006×
> larger for wiki control, where the sequence rises at the end. This has no numeric
> consequence for the reported results."

This is an honest statement of the approximation. The old "NOT negligible" assessment is
gone. **CORRECTION 1: APPLIED.**

### Correction 2: PAIRED.md telescoping self-check disclosure

**AUDIT_MATH finding #2 (MINOR wording):** Disclose that 0.000e+00 is a telescoping identity.

**Current PAIRED.md:**
> "The displayed maximum absolute discrepancy `|mean(nll) − ln(JSON ppl)| = 0.000e+00` is
> a telescoping identity: the reconstructed terms sum to `N·ln(P_N)` for any sequence. It
> validates only that the parsed last value is bound to JSON `ppl` and that the float loop
> is sane; it does **not** validate the individual per-chunk reconstruction."

**APPLIED.** The disclosure is present and accurate: it states the identity is telescoping,
explains what it validates (P_N ↔ JSON consistency + float loop sanity), and explicitly
says what it does NOT validate (per-chunk reconstruction). **CORRECTION 2: APPLIED.**

### Correction 3: ARBITRATION.md claim-1 tightening

**AUDIT_MATH finding #3 (MINOR wording):** Tighten ARBITRATION §2(1) claim about the
pairing's resolution.

**Current ARBITRATION.md §2(1):**
> "the naive per-arm `± err` (~1.0–1.15 % of PPL) suggested the whole effect could be
> noise; the pairing (SE 0.15–0.30 pp, a 6–7× reduction) shows the degradation is
> distinguishable from 0 and bounded above by ≤ +1.93 % on every corpus — while its
> exact position vs the +1.0 % line stays unresolved on it/es/zh (point 2)."

**APPLIED.** The sentence now says "distinguishable from 0" (correct), not "distinguishable
from +1.0%" (which would be the overstatement the audit flagged). The concession that
"+1.0% line stays unresolved on it/es/zh" follows immediately and correctly. The audit's
suggested wording was: "the pairing shows the degradation is distinguishable from 0 (and
bounded above by ≤+1.93%), while the exact position vs +1.0% stays unresolved on it/es/zh".
The current text is substantively equivalent. **CORRECTION 3: APPLIED.**

### Notes 4–7: no text changes needed

- NOTE 4 (approximate bound, labeled "approximate"): already labeled in PAIRED.md. No
  change needed. ✓
- NOTE 5 (1023 vs 1024 tokens): pedantic, no number affected. No change needed. ✓
- NOTE 6 (ETA 668 vs 606 chunks): scheduling estimate only, no gate impact. No change
  needed. ✓
- NOTE 7 (external facts not verified, PLAN/ALIVE edits prescriptive): informational.
  No change needed. ✓

---

## 4. OWNER-DECISION FRAMING

### 4.1 Options A/B/C presented as non-binding

- ARBITRATION §3 header: "Options for the owner (the decision is the owner's, per prereg)" ✓
- ARBITRATION §3 recommendation: "Orchestrator recommendation (non-binding): A now, B
  deferred" ✓
- PLAN #32: "Raccomandazione orchestratore (non vincolante): A ora, B differita" ✓
- ALIVE #14: "Orchestrator recommendation: A now, B deferred" ✓

**PASS.** All four files present the recommendation as non-binding and the decision as
the owner's.

### 4.2 Option B precondition: q52-class loop gate

| File | Statement |
|---|---|
| ARBITRATION §3 | "would need the same behavioural loop gate that killed B′ (q52) BEFORE shipping" |
| PLAN #32 | "gate loop comportamentale classe q52 (PPL 5/5 non vide la degenerazione di B′)" |
| ALIVE #14 | "after a q52-class loop gate" |

**PASS.** The q52-class behavioural loop gate precondition is stated consistently in all
three files.

### 4.3 R3-router rationale consistency

| File | R3 description |
|---|---|
| ARBITRATION §3 | "the only reason to want IQ4_NL is the HTP dense/hybrid prefill lane (R3, 3.19–3.5×), and R3 is OFF in the router ledger until the app-side spike cell and the HTP memory model exist" |
| PLAN #32 | "l'unica ragione di IQ4_NL è la corsia R3 (denso/ibrido su HTP v75, 3.19–3.5×), che nel ledger è OFF finché mancano cella spike app-side e modello memoria HTP" |
| ALIVE #14 | "the only consumer is router lane R3 (dense/hybrid on HTP v75), OFF in the ledger until the app-side spike cell + HTP memory model exist" |

**PASS.** All three describe R3 as the reason for IQ4_NL, state it is OFF, cite the same
two preconditions (app-side spike cell + HTP memory model), and give the same speedup
(3.19–3.5×).

### 4.4 IQ4_NL = NPU lab variant, same status as B′

- ARBITRATION §3: "IQ4_NL keeps the same status B′ has: NPU lab variant, not lineup" ✓
- PLAN #32: "IQ4_NL = variante da laboratorio NPU, stesso status di B′" ✓
- ALIVE #14: "IQ4_NL = NPU lab variant, same status as B′" ✓

**PASS.**

---

## 5. DISTINCTION FROM q41

### 5.1 q41 numbers verified

ALIVE row 11 (line 404): "IQ4_NL +4.27%, Q4_0 +8.06% PPL" — this is the q41 KEXP-trunk
result. **PRESENT in ALIVE.md.** ✓

### 5.2 "3–5× milder" arithmetic

Dense (q59) IQ4_NL Δ%: worst case es +1.39%, range +0.46…+1.39% on 4 non-wiki corpora.
KEXP-trunk (q41) IQ4_NL: +4.27%.

Ratio range: 4.27 / 1.39 = **3.07×** (mild end) to 4.27 / 0.46 = **9.28×** (extreme end).

**MAJOR.** The claim "3–5× milder" only covers the ratio at the worst-language end
(3.07–4.57× across es/zh/it). On fr (+0.46%), the ratio is 9.3×, far outside the
"3–5×" range. The sentence reads: "Da NON confondere con q41 (tronco KEXP:
IQ4_NL +4.27 %): qui è il denso, effetto 3–5× più mite." A reader comparing the fr
number (0.46%) against q41's 4.27% would get 9.3×, contradicting "3–5×".

**Fix wording:** "3–9× più mite" or "3–5× più mite su es/zh (fino a 9× su fr)" or
simply "molto più mite" without a specific ratio.

### 5.3 No contradiction with row 11

The sentence says the dense effect is milder than the trunk effect. The actual numbers
confirm this: q59 dense worst (es +1.39%) is indeed milder than q41 trunk (+4.27%).
No factual contradiction — only the ratio range is understated.

---

## 6. STRUCTURE / HYGIENE

### 6.1 PLAN row 32 pipe count

Row 32 has 4 pipes (3 columns: # | Cosa | Chi/quando). Table header has 4 pipes.
**PASS.**

### 6.2 ALIVE row 14 pipe count

Row 14 has 4 pipes (3 columns). Table header has 4 pipes. **PASS.**

### 6.3 No broken markdown

- PLAN row 32: all `**bold**` opens are closed. No stray pipes inside cells. The single
  very long cell contains internal pipe characters used as data separators, not table
  delimiters — consistent with other long rows in this table (e.g. rows 28, 29, 30).
- ALIVE row 14: all `**bold**` opens are closed. No stray pipes inside cells. ✓
- ARBITRATION.md: all tables render correctly. All `**bold**` opens closed. ✓
- PAIRED.md: tables render correctly. ✓

**PASS.**

### 6.4 Language policy

- PLAN.md: Italian (row 32 is in Italian). ✓
- ALIVE.md: English (row 14 is in English). ✓
- ARBITRATION.md: English. ✓
- PAIRED.md: English. ✓
- AUDIT_MATH.md: English. ✓

**PASS.** Language policy is consistent.

### 6.5 Evidence paths exist on disk

| Path | Exists |
|---|---|
| `scratchpad/agents/q59-dense-quant-gate/REPORT.md` | ✓ |
| `scratchpad/agents/q59-dense-quant-gate/PAIRED.md` | ✓ |
| `scratchpad/agents/q59-dense-quant-gate/ARBITRATION.md` | ✓ |
| `scratchpad/agents/q59-dense-quant-gate/AUDIT_MATH.md` | ✓ |
| `scratchpad/agents/q59-dense-quant-gate/gguf/ppl/` | ✓ (30 json + 30 log + 15 pipeline logs) |
| `scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-*.gguf` | ✓ (4 gguf files) |
| `scratchpad/agents/q59-dense-quant-gate/gguf/source/` | ✓ (safetensors + metadata) |

**PASS.**

### 6.6 .gitignore covers gguf/safetensors

`.gitignore` contains `*.gguf` and `*.safetensors`. The `models/` and `models_staging/`
directories are also ignored. **PASS.**

---

## 7. ADDITIONAL FINDINGS

### 7.1 AUDIT_MATH "Required corrections" description vs actual applied state

ARBITRATION §3b states:
> "(1) PAIRED.md rounding-floor banner overstated (errors telescope out of the mean: ≤ 0.0014
> pp; SE/CI inflation ≤ 0.05 %); (2) the 0.000e+00 self-check is a telescoping identity,
> disclosed; (3) §2 claim 1 tightened. All three applied before the bank (PAIRED.md
> regenerated from the corrected script; numbers byte-identical)."

I verified:
- (1) PAIRED.md current text states floor is per-chunk bound, not additional model
  uncertainty. Banner "IMPORTANT: NOT negligible" is gone. ✓
- (2) PAIRED.md explicitly discloses telescoping identity. ✓
- (3) ARBITRATION §2(1) now says "distinguishable from 0" (not "distinguishable from the
  +1.0% gate"). ✓

"PAIRED.md regenerated from the corrected script; numbers byte-identical" — the PAIRED.md
file timestamp (Aug 26 12:35) is after the AUDIT_MATH timestamp (Aug 26 12:30), consistent
with regeneration after the audit. The numbers in PAIRED.md match REPORT.md (verified by
math audit B0 to 8 decimals). ✓

**PASS.** ARBITRATION §3b's description of the corrections is accurate.

### 7.2 ARBITRATION §4 bookkeeping — prescriptive, not yet done

ARBITRATION §4 says:
> "PLAN.md STATO CORRENTE: append the q59 verdict…
> ALIVE.md: dense HTP-readable quant = not shipped…
> Router ledger: R3 unchanged…"

These are instructions for the banking step. The git diff shows PLAN #32 and ALIVE #14
have already been written (the `+` lines in the diff). So the bookkeeping is done or
in progress.

**PASS.** No stale to-do items for the q59 bank step.

### 7.3 Dates

- PLAN #32: "PC notturna 25–26/08" — consistent with RUN_LOG.md timestamps (Aug 25-26). ✓
- ALIVE #14: "PC, 25–26/08" — same. ✓
- AUDIT_MATH: "2026-08-26" — consistent. ✓
- ARBITRATION: "2026-08-26" — consistent. ✓

**PASS.**

### 7.4 Agent/audit attributions

- AUDIT_MATH: "Auditor: independent re-derivation, Python 3 stdlib" ✓
- ARBITRATION §3b: "AUDIT_MATH.md (Reviewer Math, DeepSeek V4 flash, thinking max,
  2026-08-26)" — attributes to DeepSeek. ✓
- PLAN #32: "audit math DeepSeek BANK-w-corrections solo wording" ✓
- ALIVE #14: "Audit math DeepSeek BANK-w-corrections (wording only; all 15 cells + hashes
  re-derived on disk)" ✓

**PASS.**

### 7.5 AUDIT_MATH verdict line vs PLAN/ALIVE reference

AUDIT_MATH verdict: "BANK-WITH-CORRECTIONS — wording-only fixes in PAIRED.md (rounding-floor
banner/assessments; tautology disclosure) and optionally ARBITRATION.md claim-1 sentence"

PLAN #32: "audit math DeepSeek BANK-w-corrections solo wording"
ALIVE #14: "Audit math DeepSeek BANK-w-corrections (wording only; all 15 cells + hashes
re-derived on disk)"

"BANK-w-corrections" is a reasonable shorthand for "BANK-WITH-CORRECTIONS". "Solo wording"
= "wording only". The claim "all 15 cells + hashes re-derived on disk" is supported by
AUDIT_MATH sections A1-A3. ✓

**PASS.**

### 7.6 Plan #32 "Q4_0 +2.15…+3.36 sulle 4 lingue" — which 4?

The "4 lingue" are it/es/fr/zh (the non-wiki corpora). Wiki is excluded because Q4_0 is
*better* than Q4_K_M on wiki (−2.46%). The range +2.15…+3.36 matches fr +2.1522 through
zh +3.3575. The 5th corpus (wiki) is correctly omitted from the FAIL summary. ✓

But: PLAN #32 says "FAIL 4/5" for Q4_0. The prereg says Q4_0 must pass ≤ +1.0% on ALL 5.
Q4_0 fails on it/es/fr/zh (4/5) and passes on wiki (Δ −2.46% ≤ +1.0%). So "FAIL 4/5"
means "fails on 4 out of 5" — this is a description of the failure pattern, not a claim
that it passes 1/5. The gate verdict is FAIL (does not pass ALL 5). ✓

**PASS.**

### 7.7 Plan #32 "wiki −1.16" — the sign

PLAN #32 states "wiki −1.16" for IQ4_NL. This is correct: IQ4_NL is BETTER than Q4_K_M
on wiki (PPL 8.5977 vs 8.6983). The negative sign indicates improvement. The gate still
FAILS because es and zh exceed +1.0%. ✓

**PASS.**

---

## Findings Summary

| # | Severity | Location | Finding | Fix |
|---|---|---|---|---|
| 1 | MINOR | PLAN #32, ALIVE #14, ARBITRATION §2(1) | "6–7× più stretta del ±err naive" — actual reduction range across 4 corpora is ~3.3–7.7×; "6–7×" only holds for best-corpus end | "3–7× più stretta" or "fino a 7× più stretta" |
| 2 | MAJOR | PLAN #32, ALIVE #14 | "effetto 3–5× più mite" vs q41 — actual ratio range is 3.1–9.3×; fr (+0.46%) vs q41 (+4.27%) = 9.3×, far outside "3–5×" | "3–9× più mite" or drop the specific ratio |
| 3 | MINOR | PLAN #32, ALIVE #14 | Size rounding: −3.3772% → "−3.4 %" and −5.1334% → "−5.1 %" — acceptable 1dp rounding but note these are not 2dp-consistent (−3.4 uses 1dp, not −3.38) | No fix required; rounding is within convention |

---

**Numbers**: ALL VERIFIED against REPORT.md and AUDIT_MATH.md. No numeric discrepancy found
between any two files.

**Verdict wording**: FAIL verdict is explicit and unsoftened in all files. Paired analysis
is correctly labelled non-gating everywhere.

**Math-audit corrections**: All 3 required wording corrections are APPLIED in the current
files. ARBITRATION §3b's description is accurate.

**Owner framing**: Non-binding. Option B precondition (q52-class loop gate) consistent.
R3 rationale consistent. IQ4_NL = lab variant = B′ status, consistent.

**Structure**: Tables render. Column counts match. Markdown clean. Evidence paths exist.
.gitignore covers model files.

**q41 distinction**: Numbers correct (4.27%), no factual contradiction, but the "3–5×"
ratio range understates the fr comparison (9.3×).

VERDICT: BANK-WITH-CORRECTIONS (1 MAJOR wording fix: "3–5×" → "3–9×" or equivalent in PLAN #32 and ALIVE #14; 1 MINOR: "6–7×" → "3–7×")
