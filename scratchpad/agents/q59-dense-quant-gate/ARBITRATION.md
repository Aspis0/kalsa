# q59 — Arbitration (orchestrator, 2026-08-26)

Prereg: `PREREG.md` (locked, Amendment 1 pre-result). Numbers: `REPORT.md` (gate) and
`PAIRED.md` (post-hoc, non-gating). Raw: `gguf/ppl/ppl-{arm}-{corpus}.{json,log}`.

## 1. Verdict by the letter of the prereg — FINAL

Gate: Δ% = PPL_cand / PPL_Q4_K_M − 1 ≤ +1.0 % on EVERY corpus (5/5), same source, same
pinned quantizer, identical chunks per corpus across arms.

| corpus | chunks | IQ4_NL Δ% | Q4_0 Δ% |
|---|---:|---:|---:|
| wiki | 64 | −1.1565 | −2.4648 |
| it | 60 | +0.8410 | +2.3886 |
| es | 59 | **+1.3927 FAIL** | +3.0402 |
| fr | 59 | +0.4611 | +2.1522 |
| zh | 61 | **+1.0238 FAIL** | +3.3575 |

- **IQ4_NL: FAIL** (2/5 corpora above +1.0 %). Does not ship under the prereg.
- **Q4_0: FAIL** (4/5). Does not ship.
- Q8_0: skipped (Amendment 1).
- Per prereg: "no readable dense quant ships without a quality decision by the owner (numbers on
  the table)". This document is the table. Nothing below re-opens the gate.

Execution hygiene (checked by the orchestrator on disk): 15/15 cells rc=0; JSON `ppl`/`ppl_err`
equal REPORT.md; one model sha256 per arm across all 5 corpora; chunk counts identical per corpus
across arms (64/60/59/59/61); runner detached (PID 39848) exited after `DONE q59 Amendment 1`; no
PPL value from the pre-amendment aborted cell was used (RUN_LOG.md).

## 2. What the numbers actually say (post-hoc, non-gating — `PAIRED.md`)

Per-chunk paired NLL differences on identical chunks (95 % CI on Δ%, exact sign test):

| candidate | corpus | Δ% point | 95 % CI | vs +1.0 % | chunks worse | sign p |
|---|---|---:|---|---|---:|---:|
| IQ4_NL | wiki | −1.16 | [−2.13, −0.17] | below | 21/64 | 8e-3 |
| IQ4_NL | it | +0.84 | [+0.54, +1.14] | straddles | 46/60 | 4e-5 |
| IQ4_NL | es | +1.39 | [+0.86, +1.93] | straddles | 47/59 | 5e-6 |
| IQ4_NL | fr | +0.46 | [+0.11, +0.81] | below | 41/59 | 4e-3 |
| IQ4_NL | zh | +1.02 | [+0.44, +1.61] | straddles | 45/61 | 3e-4 |
| Q4_0 | it/es/fr/zh | +2.15 … +3.36 | lower bound ≥ +1.69 on all four | entirely above | 53–58 of ~60 | ≤ 2e-10 |
| Q4_0 | wiki | −2.46 | [−3.25, −1.68] | below | 14/64 | 7e-6 |

Reading, in plain words:

1. **IQ4_NL is genuinely (not noise) worse than Q4_K_M on all four language corpora**
   (sign test p ≤ 4e-3 on each, paired 95 % CI excludes 0 on each), by roughly +0.5 … +1.4 %
   PPL. The naive per-arm `± err` (~1.0–1.15 % of PPL) suggested the whole effect could be noise;
   the pairing (SE 0.15–0.30 pp, a 3–7× reduction) shows the degradation is distinguishable from
   0 and bounded above by ≤ +1.93 % on every corpus — while its exact position vs the +1.0 % line
   stays unresolved on it/es/zh (point 2).
2. **Whether the true IQ4_NL degradation is above or below +1.0 % on it/es/zh is not resolved by
   this data** (all three CIs straddle +1.0 %). The prereg gate is a point-estimate gate and
   decided FAIL; the interval says "borderline", not "pass".
3. **Q4_0 is out** on every reading: lower bound ≥ +1.69 % on all four languages.
4. **Wiki inverts** (both candidates *better* than Q4_K_M, CI excludes 0, Q4_0 better on 50/64
   chunks). Factual, unexplained, single model; it is why the gate was multilingual (q43 lesson).
   It is not evidence in favour of the candidates for the app's IT/ES/FR/ZH users.
5. Size: IQ4_NL −3.38 % vs same-source Q4_K_M (−5.13 % vs the shipped unsloth Q4_K_M, which is
   itself 1.8 % larger than our same-source Q4_K_M). Not gated; small.

Caveats carried from PAIRED.md: post-hoc, single seed, 64/145 wiki chunks (Amendment 1),
unadjusted per-corpus intervals, 4-decimal log reconstruction floor (bounded per chunk; it
telescopes out of the mean and inflates the SE only marginally — see audit).

## 3. Options for the owner (the decision is the owner's, per prereg)

| option | what ships for dense models | consequence |
|---|---|---|
| **A — keep Q4_K_M (status quo)** | app default unchanged | dense/hybrid lane on HTP (R3, v75) stays without a shippable model; no quality change |
| **B — ship IQ4_NL with a quality asterisk** | IQ4_NL (HTP-readable, −3.4 % size) | +0.5 … +1.4 % PPL on IT/ES/FR/ZH (upper bound ≤ +1.93 %); would need the same behavioural loop gate that killed B′ (q52) BEFORE shipping — PPL 5/5 did not see B′'s degeneration either |
| **C — Q4_0** | — | out on every reading |

Orchestrator recommendation (non-binding): **A now, B deferred**. The only reason to want IQ4_NL
is the HTP dense/hybrid prefill lane (R3, 3.19–3.5×), and R3 is OFF in the router ledger until
the app-side spike cell and the HTP memory model exist. Nothing is lost by keeping Q4_K_M until
R3 is switchable; if R3 turns on, re-run the decision with a loop/behavioural gate on IQ4_NL
(same standard applied to B′), not with a lower PPL bar. IQ4_NL keeps the same status B′ has:
**NPU lab variant, not lineup**.

## 3b. Audit trail

- `AUDIT_MATH.md` (Reviewer Math, DeepSeek V4 flash, thinking max, 2026-08-26): every gate Δ%,
  chunk count, sha256 (re-hashed on disk), size Δ%, no-leak check, ordering/wall_s and all 10
  paired statistics (mean/sd/SE to 8 decimals, CI, sign tests) independently re-derived —
  CONFIRMED. Verdict **BANK-WITH-CORRECTIONS, wording only**: (1) PAIRED.md rounding-floor
  banner overstated (errors telescope out of the mean: ≤ 0.0014 pp; SE/CI inflation ≤ 0.05 %);
  (2) the 0.000e+00 self-check is a telescoping identity, disclosed; (3) §2 claim 1 tightened.
  All three applied before the bank (PAIRED.md regenerated from the corrected script; numbers
  byte-identical).
- `AUDIT_DOC.md` (Reviewer doc, MiMo V2.5, thinking max, 2026-08-26) on the bank package
  (PLAN #32 + 28c, ALIVE #14, this file, PAIRED, REPORT): cross-file numbers, verdict wording,
  math-audit corrections applied, owner-decision framing, markdown/structure — verdict
  **BANK-WITH-CORRECTIONS, wording only**: "3–5× milder" than q41 → **3–9×** (4.27 / 1.39…0.46);
  "6–7× SE reduction" → **3–7×** (1.0–1.15 pp naive vs 0.15–0.30 pp paired). Both applied in
  PLAN/ALIVE/this file before the bank.

## 4. Bookkeeping for the bank

- PLAN.md STATO CORRENTE: append the q59 verdict (FAIL by prereg; paired reading; owner decision
  pending; recommendation). Row 28c: "densi in IQ4_NL se q59 passa" → q59 did not pass.
- ALIVE.md: dense HTP-readable quant = **not shipped**; IQ4_NL = lab variant pending owner.
- Router ledger (`q54-engine-router/SPEC.md` §6): R3 unchanged (OFF; no shippable dense model on
  HTP adds a second reason it stays OFF).
- Secondary models (Qwen3.5-2B, Gemma-4-e2b): not run; not required by the prereg ("if time
  allows").
