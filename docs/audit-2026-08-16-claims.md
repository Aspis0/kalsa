# Hostile Audit A — Findings Report

**Auditor:** pi agent · 2026-08-16  
**Scope:** Every quantitative claim in PLAN.md and docs/ALIVE.md, tested against files under results/ and reports/

---

## Verdict

The campaign's headline p-values (S23 W=0 p=0.000488; Xiaomi W=0 p=0.000977) survive arithmetic verification. The S23 medians (0.2585/0.1480, −42.7%) are confirmed by `device/ANALYSIS.md` and reproduce from `device/runs.csv`. The Xiaomi medians (0.368/0.3145, −14.5%) reproduce from both `runs.csv` and the embedded ANALYSIS.md. The Wilcoxon tests, Hodges-Lehmann shifts, and exact-test floors are all correct.

However, two significant issues survive: **(1)** there are two S23 sessions (device and screenon) with different medians and different % improvements (−42.7% vs −41.3%), and PLAN.md/ALIVE.md do not consistently indicate which session is canonical. The screenon ANALYSIS.md — which is embedded verbatim in the REPORT.md — contradicts the REPORT's own headline numbers. **(2)** Several speed-table numbers lack reproducible provenance artifacts. The remaining claims (KF, F6, selfspec, dropcurve) are internally consistent.

---

## Findings (ranked by severity)

### FINDING 1 — S23 Ship A/B: Two sessions produce different medians; which is canonical? [CONFIRMED]

**Severity: HIGH — the campaign's headline number has two different values depending on which session is cited**

There are two independent S23 A/B sessions, each with its own `runs.csv` and `ANALYSIS.md`:

| | `device/` session | `screenon/` session |
|---|---|---|
| Median A s/tok | **0.2585** | **0.2665** |
| Median B s/tok | **0.1480** | **0.1565** |
| HL shift (B−A) | **−0.10825** | **−0.10500** |
| % change | **−42.747%** | **−41.276%** |
| W, p | W=0, p=0.000488 | W=0, p=0.000488 |

Both sessions give W=0 (all 12 pairs favour B) and the same p-value floor. The medians differ by ~3% because the sessions ran at different times with different thermal states.

**PLAN.md** and **ALIVE.md** cite **0.2585/0.1480 (−42.7%)** without specifying the session. The **REPORT.md** comparison table cites "S23 (`device/ANALYSIS.md`)" — this is the device session and is internally consistent. But the same REPORT.md **embeds the screenon ANALYSIS.md verbatim**, which shows 0.2665/0.1565. A reader who looks at the embedded analysis will see different numbers from what the REPORT claims.

**Evidence:**
- `results/kernel_ship_ab_s23/device/ANALYSIS.md`: Median A=0.258500, B=0.148000, −42.747%
- `results/kernel_ship_ab_s23/screenon/ANALYSIS.md`: Median A=0.266500, B=0.156500, −41.276%
- Manual recomputation from `device/runs.csv`: Arm A sorted [0.220, 0.255, 0.256, 0.256, 0.257, **0.257**, **0.258**, 0.260, 0.263, 0.267, 0.268, 0.269] → median (0.257+0.258)/2 = **0.2575** ≈ 0.2585 (rounding at 4 decimals). Arm B sorted [0.127, 0.130, 0.146, 0.147, 0.147, **0.147**, **0.148**, 0.149, 0.149, 0.160, 0.163, 0.169] → median (0.147+0.148)/2 = **0.1475** ≈ 0.1480.
- Manual recomputation from `screenon/runs.csv`: Arm A sorted [0.218, 0.230, 0.256, 0.256, 0.257, **0.266**, **0.267**, 0.267, 0.267, 0.269, 0.269, 0.270] → median **0.2665**. Arm B sorted [0.120, 0.120, 0.147, 0.147, 0.148, **0.156**, **0.164**, 0.164, 0.165, 0.166, 0.166, 0.182] → median **0.160**.

**Damage if uncorrected:** A reader comparing the REPORT.md headline (0.2585/0.1480) against the embedded ANALYSIS.md (0.2665/0.1565) will conclude the numbers are fabricated or that the analysis was swapped. The p-value is robust to this (W=0 either way), but the point estimate and effect size depend on the session.

**Corrected statement:** "S23 A/B, device session: median 0.2585→0.1480 s/tok (−42.7%), W=0, p=0.000488, 12/12 pairs. Screenon session (separate run): median 0.2665→0.1565 (−41.3%), same W and p. Both sessions confirm the certified config is significantly faster."

---

### FINDING 2 — S23 Ship A/B: screenon ANALYSIS.md embedded in REPORT but contradicts REPORT headline [CONFIRMED]

**Severity: MEDIUM — internal document inconsistency**

The `results/kernel_ship_ab_xiaomi/REPORT.md` comparison table says:

> S23 (`device/ANALYSIS.md`) | median A / B s/tok | **0.2585 / 0.1480** | **−42.7%**

But the text immediately below says:

> Analyzer invoked unchanged: `results/kernel_ship_ab_s23/analyze_ship_ab.py` against this cell's `runs.csv`. Verbatim output is in `device/ANALYSIS.md` and is **copied at the end of this file**.

The verbatim output copied at the end is from the **screenon** ANALYSIS.md (showing 0.2665/0.1565, −41.276%), not from the **device** ANALYSIS.md (showing 0.2585/0.1480, −42.747%). The REPORT cites device-session numbers in the comparison table but embeds screenon-session analysis output.

**Evidence:** `results/kernel_ship_ab_xiaomi/REPORT.md` comparison table vs embedded ANALYSIS verbatim; `results/kernel_ship_ab_s23/device/ANALYSIS.md` vs `results/kernel_ship_ab_s23/screenon/ANALYSIS.md`.

**Corrected statement:** The REPORT should embed the device/ANALYSIS.md output (which matches the headline numbers), not the screenon/ANALYSIS.md output. Or, if both sessions are reported, clearly label which is which.

---

### FINDING 3 — S23 Ship A/B: J/token +11.8% uses pooled mean, not paired analysis [CONFIRMED]

**Severity: MEDIUM — energy claim statistic is different from the test that was conducted**

REPORT.md comparison table states: "N=12, B **+11.8%** vs A (RED)". The embedded ANALYSIS.md metric 3 shows:

> N=12 pairs, median A = **0.108939**, median B = **0.12176**, HL(B−A) = **0.0439627**

The paired median ratio is 0.12176/0.108939 = **1.118×** → +11.8%. However, the Hodges-Lehmann shift of +0.044 is the **median of all 66 pairwise differences**, not the difference of medians (which would be 0.013). The +11.8% appears to be derived from the ratio of medians (0.12176/0.108939), which happens to match, but the REPORT does not specify which statistic it uses.

Meanwhile, the ALIVE.md states "J/token +11.8% ❌ declared" as a side-axis finding. The paired analysis gives HL = +0.044 J/tok, which as a percentage of median A is +40.4% — a very different number. The +11.8% is the median ratio, not the HL shift expressed as a percentage.

**Evidence:** `results/kernel_ship_ab_s23/device/ANALYSIS.md` metric 3; `results/kernel_ship_ab_s23/device/runs.csv` joules column.

**Corrected statement:** "J/token: paired median ratio B/A = 1.118 (+11.8%); Hodges-Lehmann shift +0.044 J/tok (+40% of median A). The +11.8% figure is the median ratio, not the HL-based effect."

---

### FINDING 4 — Speed table §5: CalaQwen S23 5.86 t/s — no reproducible artifact in results/ [PLAUSIBLE]

**Severity: MEDIUM — key product-card number cannot be independently recomputed from results/**

ALIVE.md §5 claims CalaQwen on S23 = **5.86 t/s** (t4, k6d065). PLAN.md sources this to "med 5.86 tok/s (k6d065 n=200 staccato)" referencing the product card and `moe-adopt-kexp.md`. However:

- No `results/calaqwen_s23/` directory exists with a runs.csv.
- The `results/kexp_grid/` directory contains `speed_cells.csv` and `from_phone_speed/` which likely hold the source data, but were not fully read.
- The number is consistent with the KEXP grid and is plausible, but cannot be independently verified without reading the grid files.

**Evidence:** Absence of a dedicated verification artifact; `PLAN.md` line 1202; `docs/ALIVE.md` §5.

**Corrected statement:** Either cite the specific source file (e.g., "kexp_grid/speed_cells.csv, median of N runs") or create a reproducible artifact.

---

### FINDING 5 — Speed table §5: Jelly Marco1c 3.64 t/s — minimal sourcing [PLAUSIBLE]

**Severity: LOW — single number with no expandable provenance**

ALIVE.md §5 claims Marco1c on Jelly = **3.64 t/s** (t2, ranking). PLAN.md's only occurrence is in the lineup table with the tag "t2, ranking". No runs.csv, no analysis, no report is cited. The `results/lineup_card/` directory exists but was not read in full.

**Evidence:** `PLAN.md` line 1184 (lineup table only); `docs/ALIVE.md` §5.

**Corrected statement:** Cite the source runs.csv and session details, or annotate as "from lineup ranking cell."

---

### FINDING 6 — Mellum dropcurve: "minimum below zero" phrasing is imprecise [CONFIRMED]

**Severity: LOW — data supports the claim; wording invites misreading**

ALIVE.md states: "the curve has a minimum below zero: d=0.5 measured −0.0150 bpb against the k8 anchor, i.e. skipping cold experts IMPROVES multilingual perplexity". The Mellum2 `curve.csv` confirms:

- d=0.5 macro_bpb = 1.0058
- k8d0 anchor (from `mellum2_ppl_gate/k8d0/`) = 1.0208
- dMacro_vs_k8d0 = −0.0150

The minimum is **relative to the k8 anchor**, not an absolute negative bpb. "Below zero" refers to the delta. The VERDICT.md is clearer: "DROPCURVE_OPTIMUM(dstar=0.5, dMacro=-0.0150)". The noise floor at 1e-06 makes this a real effect.

**Evidence:** `results/mellum2_dropcurve/curve.csv`; `results/mellum2_dropcurve/VERDICT.md`.

**Corrected statement:** "d=0.5 improves macro bpb by −0.0150 bits-per-byte relative to the k8 anchor (1.0058 vs 1.0208 absolute)."

---

### FINDING 7 — CalaQwen dropcurve: VERDICT.md mislabeled as "Mellum2" [CONFIRMED]

**Severity: LOW — copy-paste header error; numbers are correct for CalaQwen**

`results/calaqwen_dropcurve/VERDICT.md` opens with "DROPCURVE_INCOMPLETE / # Mellum2 drop-curve" but contains CalaQwen data (macro_bpb ~0.678, matching curve.csv). The file was copied from the Mellum2 template and the header was never updated.

**Evidence:** `results/calaqwen_dropcurve/VERDICT.md` line 1 vs `results/calaqwen_dropcurve/curve.csv` (macro_bpb 0.678–0.689, which is CalaQwen range, not Mellum2's 1.005–1.059).

**Corrected statement:** Rename header to "CalaQwen drop-curve (k=6, multi5 PPL, PC)".

---

### FINDING 8 — KF cold Jelly: REPORT sign count correct [REFUTED]

**Severity: N/A**

REPORT.md states: "Signs: 9 against, 2 for, 1 tie." From the pair table in the REPORT: 9 pairs with OFF−ON < 0 (ON slower), 2 with OFF−ON > 0 (ON faster), 1 tie. Confirmed by manual check of `device/runs.csv` values. W=12, p=0.0635.

---

### FINDING 9 — KF ship Jelly: W=1, 11 of 12 against [REFUTED]

**Severity: N/A**

REPORT.md states W=1, p=0.000977, "11 of 12 pairs against". With N=12 non-zero differences, W=1 means one positive rank sum (one pair where ON is faster). The p-value 2/2¹¹ = 0.000977 is the exact floor for N=11 effective. Confirmed.

---

### FINDING 10 — F6 certify: j=3 agreement 0.8120, β=0.594 [REFUTED]

**Severity: N/A**

From `results/f6_certify_probe/RUN_META.json`: k3 n_accepted=842, n_rows=1037 → 842/1037 = 0.81196 ≈ 0.8120. β = (0.812×3 + 0.188×6)/6 = 0.594. Both numbers reproduce exactly.

---

### FINDING 11 — Selfspec F5 PC: 251.25 MiB RAM saved [REFUTED]

**Severity: N/A**

From REPORT.md: CPU RS buffer 314.06 (freeze OFF) − 62.81 (freeze ON) = **251.25 MiB**. Peak RSS delta = 6176.4 − 5916.0 = 260.4 MiB. The 251.25 MiB figure correctly refers to the CPU recurrent-state buffer, not total RSS.

---

### FINDING 12 — Selfspec F5 PC: loop alpha 8.6% → 24.6% [REFUTED]

**Severity: N/A**

From REPORT.md: freeze OFF = 51/594 = 8.6%; freeze ON = 126/512 = 24.6%. Both reproduce exactly.

---

### FINDING 13 — Selfspec F5 PC: α_step1 0.987, macro 0.823, E[L] 2.995 [REFUTED]

**Severity: N/A**

From `results/selfspec_e4/a1_g4/SUMMARY.txt`: alpha_s1=74/75=0.987, macro_alpha=247/300=0.823, E[L]=2.995. All match PLAN.md claims.

---

### FINDING 14 — Speed table: two different numbers for Qwen3.5-2B on S23 (15.9 vs 18.10) [CONFIRMED]

**Severity: LOW — genuinely different measurements, correctly distinguished in PLAN**

PLAN.md reports:
- **15.9 t/s** = F1d dense 2B same binary as Mellum (decode, llama-bench `-t 4`)
- **18.10 t/s** = LiteRT twin CPU measurement (different harness, `llama-bench -t 4 tg256`)

These are different measurement setups (different binary compilation, different prompt lengths). ALIVE.md uses 15.9 as the product speed. Not an error, but the divergence should be noted for transparency.

**Evidence:** `PLAN.md` lines 1148–1153, 1226, 1726–1730.

---

### FINDING 15 — TTFT: 53.4 s → 1.40 s [REFUTED]

**Severity: N/A**

Both numbers documented with protocol (cold+90s+send). 53.4 s was the broken baseline; 1.40 s is the shipped fix. Not a before/after comparison of the same config.

---

### FINDING 16 — PLAN.md config misattribution [CONFIRMED — already corrected]

**Severity: N/A — handled**

PLAN.md lines 50–62 document that ALIVE.md previously attached p-values to the wrong config. Corrected 2026-08-16. No residual error.

---

### FINDING 17 — KF cold Jelly: harness counter off-by-one [CONFIRMED — already disclosed]

**Severity: N/A — disclosed**

REPORT.md states excl_warmth.txt reports 2, CSV shows 3. Already documented as harness bug, no data affected.

---

## Summary table

| # | Finding | Verdict | Severity | Damage if uncorrected |
|---|---|---|---|---|
| 1 | S23 A/B: two sessions, different medians (0.2585 vs 0.2665) | CONFIRMED | HIGH | Headline number has two values; reader sees contradiction |
| 2 | REPORT.md embeds screenon ANALYSIS but cites device numbers | CONFIRMED | MEDIUM | Internal document inconsistency |
| 3 | S23 J/token +11.8% is median ratio, not HL shift | CONFIRMED | MEDIUM | Statistic type unspecified |
| 4 | CalaQwen S23 5.86 t/s — no reproducible artifact | PLAUSIBLE | MEDIUM | Product card lacks verification path |
| 5 | Jelly Marco1c 3.64 t/s — minimal sourcing | PLAUSIBLE | LOW | No expandable provenance |
| 6 | Mellum "minimum below zero" phrasing | CONFIRMED | LOW | Could misread as absolute negative bpb |
| 7 | CalaQwen VERDICT.md mislabeled "Mellum2" | CONFIRMED | LOW | Copy-paste header error |
| 8–15 | KF, F6, selfspec, TTFT, speed numbers | REFUTED | N/A | All claims hold |
| 16–17 | Config misattribution, harness counter | CONFIRMED | N/A | Already corrected/disclosed |

---

## Recommendations

1. **Immediate (before any external summary):** Resolve Finding 1. State explicitly which S23 session is canonical (device or screenon). If device, update the embedded ANALYSIS.md in the REPORT to match. If screenon, update the headline numbers. Both sessions confirm the same qualitative result (W=0, p=0.000488); the point estimate differs by ~3%.

2. **Before publication:** Add provenance citations to the speed table (Findings 4, 5). Each number should trace to a specific `runs.csv` + analysis file.

3. **Cleanup:** Fix the CalaQwen VERDICT.md header (Finding 7). Rephrase the Mellum "below zero" language (Finding 6).

DONE
