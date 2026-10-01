# Kalsa MoE design — how to build the best ~128-expert Qwen3.6-35B-A3B derivative

Author: Fable 5.1 (research designer), 2026-10-01. Design only: no model run, no cloud, no spend,
no push, no code-repo edit. Offline Python over the committed router bins and CSVs only
(`raw/curve.py`, `raw/exp2.py`, logs alongside; seeds fixed; each run < 1 min).

Evidence labels used throughout: **MEASURED** (ours, with `file:line`), **PUBLISHED** (arXiv id +
section/table), **HYPOTHESIS** (reasoned estimate; the experiment plan exists to replace it).
Lab paths are relative to `~/Projects/kalsa-moe-experiments/`; `prep/` = `scratchpad/agents/kalsa-reap-prep/`,
`v3/` = `scratchpad/agents/moe-expert-usage-v3/`, `k128/` = `scratchpad/agents/moe-keepset-128/raw/`
(GLM 67143a4f, in progress at the time of writing — its tables are used, not redone).

---

## 1. Recommendation (one paragraph)

Build first a **training-free REAP-saliency prune of Qwen3.6-35B-A3B to 128 experts/layer, uniform per
layer, ranked on our own seven-domain calibration (IT/FR/ES/EN/ZH + code + math at equal token budgets)
with a per-domain coverage floor and an explicit Super-Expert guard, then quantize with an imatrix from
the same calibration into two artifacts from the same ranking: experts Q4_0 + trunk Q5/Q6 (~10.7 GB,
PC 16 GB resident) and experts IQ3_S-class + trunk Q5/Q6 (~8.7 GB, 16 GB phone resident)**. Rank the experts by REAP (gate × output norm), not by routing mass: on this exact base REAP beats mass
and random at both tested depths (PUBLISHED, arXiv:2607.16721 Table 3), and mass-based ranking is
blind to the rare, high-magnitude "Super Experts" whose removal collapses reasoning (PUBLISHED,
arXiv:2507.23279 §Tables 3-5). The calibration mixture, not the criterion, is what decides the
languages: RAZOR's English-biased set kept only 49-58 % of the five languages' routing mass and lost
Italian 2.5× (MEASURED, `results/gate_probe_a40_2026-10-01/REPORT.md:14,18`; `v3/REPORT.md:79`),
while a Kalsa-balanced 128-set keeps 85-90 % for the languages and 68-75 % for code/math (MEASURED,
`v3/REPORT.md:194`; `k128/merged_curve.csv:2`). Expected result at 128 (HYPOTHESIS, bands in §2.4):
IT/FR/ES bpb 0.58-0.60 → **0.62-0.68** (RAZOR: 1.46), EN 0.59 → 0.62-0.66, ZH 0.85 → 0.90-0.98,
GSM8K −3 to −10 points, HumanEval+ −3 to −10 points, tools within noise; a 160-expert artifact at
IQ3_S (same bytes as 128 @ Q4_0) is the equal-GB rival and must be built from the same ranking in the
same session, because the published equal-memory evidence says bits are the cheaper thing to give up
down to ~3 bpw (PUBLISHED, arXiv:2607.16721 Table 5). If the training-free 128 lands within ~+0.1 bpb
of the base on the languages and within ~10 points on code/math, a router-only + attention/shared
LoRA self-distillation heal (≈3 GPU-hours, ~2-10k sequences) is expected to recover about half of the
remaining gap (PUBLISHED, arXiv:2607.16721 §5.7; arXiv:2605.28042 Table 1). Whole phase-1 cost:
**one pod session ≈ $15-25 (cap $40)** plus ~1 Mac day; the healing probe is a separate ≤ $20.

---

## 2. The math

### 2.1 Bytes: what a keep-set + quant weighs

Per expert 3,145,728 params (gate_up 1024×2048 + down 2048×512), 40 MoE layers, experts total
32,212,254,720 of 34,660,610,688 text params, so the non-expert trunk (attention, GDN, shared
experts, router, embeddings + untied head) is **2,448,355,968 params** (MEASURED,
`prep/docs/PARAM-BUDGET.md:21,29`; config: hidden 2048, moe_intermediate 512, shared 512, vocab
248,320, untied — PUBLISHED, Qwen/Qwen3.6-35B-A3B `config.json`).

```
bytes(K, b_e, b_d) = 40 · K · 3,145,728 · b_e/8  +  2,448,355,968 · b_d/8
```

With the trunk at 5.5 bpw (Q5_K/Q6_K class; shared expert and head never below Q6) the trunk is
**1.68 GB**; the expert pool is what the two knobs K (experts/layer) and b_e (expert bpw) buy
(`raw/exp2.log` §F, GB = 1e9 B):

| K | Q4_K (4.85) | Q4_0 (4.5) | Q3_K_M (3.9) | IQ3_S (3.5) | IQ3_XXS (3.1) | KEXP (2.75) |
|---:|---:|---:|---:|---:|---:|---:|
| 96 | 9.01 | 8.48 | 7.57 | 6.97 | 6.36 | 5.84 |
| 112 | 10.23 | 9.61 | 8.55 | 7.85 | 7.14 | 6.53 |
| **128** | 11.45 | **10.74** | 9.53 | **8.73** | 7.92 | 7.22 |
| 144 | 12.67 | 11.88 | 10.52 | 9.61 | 8.70 | 7.91 |
| **160** | 13.89 | 13.01 | 11.50 | **10.49** | 9.48 | 8.60 |
| 192 | 16.33 | 15.27 | 13.46 | 12.25 | 11.04 | 9.99 |
| 256 | 21.21 | 19.80 | 17.39 | 15.78 | 14.17 | 12.76 |

Anchors: our 50 %/Q4_K_M estimate 11.42 GB vs this table 11.45 (MEASURED, `PARAM-BUDGET.md:45`);
unsloth's real unpruned files UD-Q4_K_M 22.1 GB, UD-IQ3_XXS 13.2, UD-IQ2_M 11.5, **UD-IQ2_XXS 10.8**,
UD-IQ1_M 10.0 (PUBLISHED, HF `unsloth/Qwen3.6-35B-A3B-GGUF` tree, read 2026-10-01). Budgets:
16 GB PC ≤ 11 GB, 16 GB phone ≤ 9 GB (owner numbers, `PARAM-BUDGET.md:86,88`).

**Equal-GB rows the experiment must compare** (nested keep-sets: the 128 set is the top of the 160
set by construction, so one ranking yields every row):
- PC ≈ 10.5-10.8 GB: 128 @ Q4_0 · 144 @ Q3_K_M · **160 @ IQ3_S** · 192 @ KEXP-2.75 · unpruned UD-IQ2_XXS.
- Phone ≈ 8.5-8.7 GB: **128 @ IQ3_S** · 144 @ IQ3_XXS · 160 @ KEXP · 96 @ Q4_0.

Note the streaming geometry does not shrink with K: per token the model still reads k = 8 routed
experts (+ 1 shared) per layer, so active compute and raw bytes/token are **ratio-invariant**
(MEASURED correction, `PARAM-BUDGET.md:99`). Pruning is a RAM/download play; k and b_e are the
only bytes/token levers (§2.6).

### 2.2 What the prune removes: the retained-saliency curve (proxy, MEASURED)

Our v3 study measured, per (layer, expert), the selected top-8 router mass on a topic-controlled
parallel corpus (FLORES-200 for 10 languages, GSM8K, Python/C++ code; 130,975 tokens;
`v3/REPORT.md:17-45`). Re-ranking on a content-disjoint split (`raw/curve.py`, seed 20261001),
share of each group's top-k mass that a balanced keep-set retains (`raw/curve.log`):

| K/layer | IT | FR | ES | EN | ZH | CODE | MATH | DE | JA | KO | RU | AR |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 64 | 68.0 | 69.5 | 70.3 | 61.0 | 59.3 | 37.2 | 49.4 | 54.5 | 50.2 | 49.9 | 55.0 | 58.4 |
| 96 | 80.4 | 81.7 | 82.5 | 76.8 | 74.5 | 52.9 | 64.1 | 66.4 | 62.1 | 61.9 | 66.7 | 70.9 |
| **128** | **88.5** | 89.3 | 89.8 | 86.4 | 85.1 | **68.1** | **75.5** | 74.0 | 71.6 | 70.5 | 74.3 | 78.8 |
| 160 | 93.6 | 94.1 | 94.3 | 92.4 | 92.0 | 79.5 | 85.7 | 79.8 | 78.8 | 77.3 | 81.1 | 86.4 |
| 192 | 97.0 | 97.2 | 97.3 | 96.4 | 96.2 | 88.7 | 92.9 | 85.2 | 83.9 | 81.9 | 85.8 | 90.1 |
| 224 | 99.0 | 99.1 | 99.1 | 98.9 | 98.8 | 96.0 | 97.9 | 91.5 | 89.6 | 88.7 | 90.5 | 95.4 |

This reproduces the audited v3 row within 1 pp (`v3/REPORT.md:194`: 89.3/89.1/89.8/86.4/84.7/69.6/75.4)
and GLM's `k128/merged_curve.csv:2` (88.0/87.9/88.5/85.2/83.8/69.1/74.7). Fit: the **removed**
share behaves like a power of the removed fraction f = 1 − K/256, m(f) ≈ f^γ with **γ ≈ 2.2 for the
languages, ≈ 1.7 for math, ≈ 1.5 for code** (read off the table: languages 11.5 % removed at f = 0.5,
3.0 % at f = 0.25; code 31.9 % and 11.3 %). Code is the flattest distribution — its experts are a
pool of their own (Jaccard 0.25-0.27 with every language, `v3/REPORT.md:130`) and every language-only
ranking guts it (EN-only: code 27-28 %, `k128/merged_curve.csv:6`).

Per-layer heterogeneity at K = 128 (`raw/curve.log`): IT retained min 78.5 / median 88.6 / max 97.5 %,
CODE 44.2 / 71.3 / 77.5 %. Effective expert count exp(H) of the balanced calibration mass runs from
**106-111 in layers 38-39 to 200-215 in layers 0-2** (most diffuse early, most concentrated late);
JS divergence between IT and EN routing is ≤ 0.1 in layers 4-31 and rises to **0.35-0.56 in layers
36-39** (`raw/exp2.log` §D) — the "language-specific processing sits in the last layers" pattern that
arXiv:2605.28042 §4.2 relies on (PUBLISHED). Both facts argue the same way: do not expect large
gains from per-layer reallocation on this proxy (next item).

**Three keep-set rules at the same 5,120-expert budget (MEASURED, `raw/exp2.log` §A-D; `k128/merged_curve.csv`):**

| rule | IT | FR | ES | EN | ZH | CODE | MATH | note |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| balanced mean, 7 domains, uniform 128 | 88.5 | 89.3 | 89.8 | 86.4 | 85.1 | 68.1 | 75.5 | baseline |
| languages only (no code/math in the ranking) | 92.2 | 92.6 | 92.9 | 90.5 | 90.8 | **26.1** | 59.7 | the trap |
| code/math weight 2 | 85.6 | 86.8 | 87.4 | 83.8 | 80.7 | 74.4 | 79.5 | k128 w2: 85.7/…/75.4/78.5 |
| coverage quota q = 32 per domain + mean fill | 83.8 | 84.9 | 85.4 | 81.0 | 83.0 | **75.7** | 77.5 | min-domain 68 → 76 |
| max-min greedy (equalise the worst domain) | 79.6 | 80.7 | 81.3 | 78.3 | 79.8 | 76.1 | 80.4 | all ~80 |
| non-uniform per layer, balanced marginal gain (floor 64, cap 224) | 88.8 | 89.7 | 90.3 | 86.6 | 85.7 | 68.5 | 75.8 | **+0.3-0.6 pp** only; k128 "waterline" +0.4-0.6 |

Reading: the frontier between languages and code is nearly linear — each pp of code bought costs
~0.5 pp of language mass. Per-layer reallocation is worth under a point on this proxy (GLM's
independent allocation agrees: `k128/merged_curve.csv:14` vs `:2`), and the published gain of a
JS-driven allocation was +0.014 xCOMET at 50 % pruning (arXiv:2605.28042 Fig. 7). Uniform first.

### 2.3 From removed saliency to quality: two regimes

**Collapse regime (MEASURED fit, 5 points).** RAZOR removed 50.9/49.8/49.4/41.5/44.9 % of the
IT/FR/ES/EN/ZH top-8 mass (`v3/REPORT.md:101-105`) and cost +0.882/+0.670/+0.540/+0.206/+0.249 bpb
on the same post-cutoff corpus (`results/gate_probe_a40_2026-10-01/REPORT.md:14,18`). Least squares
on ln Δbpb vs removed share r (`raw/exp2.log` §E):

```
Δbpb ≈ exp(−8.14 + 15.5 · r)        e-folding 0.065 in r;   predicted 0.77/0.65/0.61/0.18/0.30 vs observed 0.88/0.67/0.54/0.21/0.25
```

Damage is steeply non-linear past r ≈ 0.4: the next-ranked "refill" experts stop being substitutes.
This is the same shape as the published dose-response on this base (code HE+ 0.787 → 0.470 →
collapse as magnitude is displaced from the ranking, arXiv:2607.16721 §5.2) and as "general-chat
perplexity 5.20 → 12.00 (+131 %) at 50 % keep under a coding-heavy calibration" (same paper, §5.2 /
Table 2). **Limit:** five points, two parameters, r measured on FLORES and bpb on Wikipedia, and
IT/FR/ES sit within each other's CIs in r yet differ 0.34 bpb — mass alone does not order the
damage inside the collapse zone (`v3/AUDIT.md:358`: IT above 50 % in only 22/40 layers, sd 13 pp).
Extrapolating this fit to r = 0.11-0.15 gives Δbpb ≈ 0.002-0.003, which is **not** a prediction —
the fit knows nothing about the regime below r ≈ 0.4.

**Diffuse regime (PUBLISHED floor).** With the calibration matched to the use (in-domain), 50 %
pruning costs on Qwen3-30B-A3B (REAP, arXiv:2510.13999 Table 2): code 0.558 → 0.541 (−1.7 pt),
math 0.887 → 0.857 (−3.0), creative writing 0.811 → 0.718 (−9.3), multiple-choice 0.721 → 0.503
(−21.8). On Qwen3.6-35B-A3B itself at 50 % keep: HE+ 0.890 → 0.896 (unchanged), MBPP+ 0.772 →
0.728 (−4.5, CI [−7.7, −1.6]) (arXiv:2607.16721 Table 3/§5.1). Translation on Qwen3-30B-A3B at
50 % with FLORES calibration: "negligible" xCOMET loss, 70 % "minor" (arXiv:2605.28042 §5, Table 1).
So in-domain, with 68-70 % of code mass retained (RAZOR kept 69-70 % of code mass,
`v3/REPORT.md:79`, and its code evals held), the loss floor is a few points on generative tasks
and ~10 % on open-ended writing; language modelling (bpb) sits between those.

**Retraining ceiling (PUBLISHED law, for context).** Clark et al.'s routed scaling law
(arXiv:2202.01169 Eq. 1, Table 3: S-BASE a = −0.082, b = −0.108, c = 0.009, E_start 1.847,
E_max 314.5, base-10 logs) gives, at N ≈ 3·10⁹ active, a slope ∂log₁₀L/∂log₁₀Ê ≈ −0.023; the
saturating transform maps E = 256 → Ê = 141, 160 → 106, 128 → 91, so a model **trained** with 128
experts would sit only ≈ **+1.0 %** in loss above one trained with 256 (160: +0.3 %). Caveats:
top-1 routing, different N definition, no fine-grained experts. Its use here: the gap a heal has to
close is almost all "pruning damage", not "capacity"; healing has headroom.

### 2.4 Putting the two regimes together: expected numbers (HYPOTHESIS)

For the balanced-128 REAP artifact (languages at r ≈ 0.11-0.15, code r ≈ 0.30-0.32, math ≈ 0.25):

| metric | base (MEASURED) | expected at 128, no heal | at 160 | after heal (×0.5 gap) |
|---|---|---|---|---|
| IT bpb (postcutoff wiki) | 0.580 | 0.62-0.68 | 0.60-0.63 | 0.60-0.64 |
| FR / ES bpb | 0.604 / 0.601 | 0.64-0.70 | 0.62-0.65 | — |
| EN bpb | 0.586 | 0.62-0.66 | 0.60-0.62 | — |
| ZH bpb | 0.852 | 0.90-0.98 | 0.87-0.91 | — |
| GSM8K pass@1 (uncapped) | ≈0.85 (Mac probe, `prep/REPORT.md:222`) | −3 … −10 pt | −1 … −5 | −2 … −5 |
| HumanEval+ pass@1 | ≈0.89 (arXiv:2607.16721 Table 3) | −3 … −10 pt | −1 … −5 | −2 … −5 |
| tools-100 | 0.80-0.82 | within ±5 | ±3 | — |
| wrong-language answers | ≈0 | must stay < 2 % | — | — |

Bands come from: language removed share 3-5× smaller than RAZOR's EN (which cost +35 %) with the
exponential telling us the collapse term is negligible, plus the diffuse floor (+5-15 % on
open-ended text in REAP Table 2). Code/math sit where RAZOR's code sat (≈ 69 % retained), which held
on code evals — but our code pool is thinner than RAZOR's calibration made it, hence the wider band.
The owner's gate margins vs LFM (IT ≤ 1.106, EN ≤ 0.853, `prep/docs/EVAL-GATE.md:55-61`) leave ≈
0.45 bpb of room on IT: a 128-prune would have to lose **4× more than this estimate** to fail the
language gate. The code/math gate is the one at risk, which is why the plan weights it.

### 2.5 Quantization interplay: experts before bits, down to ~3 bpw

- **Quant penalties are small next to pruning penalties.** Dense 7B KLD vs f16 (PUBLISHED, llama.cpp
  community tables for Mistral-7B): Q4_K_M 0.0075, Q3_K_M 0.017, IQ3_S 0.021, IQ3_XXS 0.033, IQ2_M 0.070;
  Qwen3.8-27B: Q4_K_M 0.014, Q3_K_M 0.056, IQ3_XXS 0.065, IQ2_XXS 0.283 (sources in §7). Converting:
  Δbpb ≈ (KLD / ln 2) × tokens-per-byte (≈ 0.22-0.25 for this tokenizer, all five languages) →
  Q4_K_M→IQ3_S costs ≈ **+0.01-0.02 bpb**, →IQ2_XXS ≈ +0.05-0.09. Our own Q4_0 vs Q4_K_M delta was
  +0.006-0.012 bpb (MEASURED, `results/gate_probe_a40_2026-10-01/REPORT.md:35`).
- **MoE experts tolerate low bits better than dense layers** (PUBLISHED, MoQE arXiv:2310.02410: 2-bit
  experts with higher-precision non-experts still beat the dense model; shared/always-on experts
  need MORE bits, arXiv:2406.08155). Our KEXP recipe (q2_K/q3_K experts, Q5/Q6 trunk) is exactly this
  shape and ships on the S23 at 5.70 tok/s (MEASURED, `reports/research-newmoe-candidates.md:12`).
- **Equal-memory crossover on this base (PUBLISHED, arXiv:2607.16721 Table 5):** pruned-50 % Q4
  (11.4 GB) HE+ 0.902 / MBPP+ 0.720 ≈ unpruned IQ2_M (13.0 GB) 0.896 / 0.730; unpruned Q3_K_M (17.1 GB)
  MBPP+ 0.775 beats pruned Q8 0.728 (p = 0.0009). Their reading, "pruning wins only below 3 bpw",
  is code-only and under a code-heavy calibration; for the languages the unpruned IQ2 keeps every
  expert while the prune keeps 85-90 % of the mass — so at the PC budget **unpruned UD-IQ2_XXS
  (10.8 GB) is a live rival** and costs $0 to include.
- **Rule that follows:** at a fixed byte budget move along the K axis first and the b_e axis
  second, stopping at ≈ 3.1-3.5 bpw for the routed experts (IQ3_XXS/IQ3_S class), never below for the
  trunk and shared expert (Q5_K/Q6_K; head Q6/Q8). Expert-wise mixed precision (top-saliency experts
  Q4_K, tail IQ3) is a refinement for later; the imatrix must come from the seven-domain
  calibration (`prep/calib/make_imatrix_text.py`, 1,314,955 chars) — an English imatrix is the same
  trap as an English calibration (HYPOTHESIS, consistent with RAZOR's failure mode).
- **Phone caveat (MEASURED, memory note `kalsa-kexp-is-regime-bound`, verified in `repack.cpp` at the
  time):** on ARM llama.cpp has no NEON repack for q2_K/q3_K (IQ3 likewise), so sub-4-bit expert
  tensors stay file-backed and evictable; the fix was `use_mmap=false` (0.41 → 15.67 tok/s on the S23
  KEXP arm) or the queued NEON repack kernel. OpenCL `MUL_MAT_ID` lacks q2_K/q3_K (CPU fallback).
  A phone-resident IQ3 artifact therefore needs that engine item or `use_mmap=false`; the GPU/NPU
  paths want Q4_0 experts. Both phone shapes (128 @ IQ3_S resident vs 128 @ Q4_0 streamed) are
  kept in the plan; the device decides. We own no 16 GB phone (S23 8 GB, Jelly 8 GB, Xiaomi 12 GB):
  the Xiaomi is the nearest instrument for the 8.7 GB resident arm.

### 2.6 Streaming case (phones that cannot hold the pool)

Raw expert bytes per token = k · 40 · 3,145,728 · b_e/8 → k = 8: Q4_0 **540 MiB**, IQ3_S 420,
KEXP 330; k = 6: 405/315/248; k = 4: 270/210/165 (`raw/exp2.log` §F). Measured streamed bytes are far
lower because the cache serves the hot experts: CalaQwen (256-pool, KEXP, k = 6, drop-cold 0.65,
2 GB cache) **30.7 MiB/tok at 80.7 % hit, 5.70 tok/s, compute-bound on the S23** (MEASURED,
`reports/research-newmoe-candidates.md:12`). Pruning to 128 changes the streaming economics in one
way only: the pool shrinks (Q4_0 pool 9.1 GB, IQ3_S 7.0 GB, KEXP 5.5 GB), so the same cache covers a
larger fraction of it and the hit rate rises (HYPOTHESIS: ≥ 95 % with a 6-7 GB cache on a 16 GB phone,
measurable with the existing `--moe-stream` hit counter; the sacrificed experts are exactly the ones a
Kalsa user never pages in, which is why "resident on 16 GB, streamed on 12 GB" is the same artifact).
Expert locality across consecutive tokens is what every offloading system exploits (PUBLISHED,
MoE-Infinity arXiv:2401.14361; HOBBIT arXiv:2411.01433 serves cache misses with low-precision copies —
the same idea as our drop-cold, and a cheap future lane: keep an IQ2 copy of the cold half).
**k is the only speed lever**: k = 4 cost RAZOR 26 GSM8K points, k2 = 16 renorm recovered most
(MEASURED, `results/gate_probe_a40_2026-10-01/REPORT.md:33`; PUBLISHED method arXiv:2609.04575:
8 → 4 experts −0.35 MMLU with k₂ = 16 vs −4.65 with standard renorm; engine spike `a2f252fbd`).
Ship k = 8; expose k = 6 + k₂ renorm as a device-side option and re-tune k₂ on the pruned model
(the top-k₂ reference mass changes when 128 logits leave the softmax).

### 2.7 Limits of the whole model

Top-8 selected mass is only ~18 % of the full router softmax (MEASURED, `v3/REPORT.md:141`;
`v3/AUDIT.md` F10), the proxy's dynamic range is 50 → 100 % (a random half already scores 50),
every v3 segment is a cold-start sequence (`v3/AUDIT.md:319`, F9), and mass is not saliency (REAP's
own point). The proxy ranks keep-sets and rules out English-only calibration with certainty; it does
**not** predict bpb. Every number in §2.4 is replaced by §4's measurements.

---

## 3. Ranked candidates

Effects are relative to the unpruned base at the same quant; "lang" = IT/FR/ES/EN/ZH bpb;
costs are Runpod A100 80 GB ≈ $2/h, A40 ≈ $0.5/h; Mac = M1 Max 64 GB.

| # | method | lang effect | code/math effect | size | cost | risk | evidence |
|---|---|---|---|---|---|---|---|
| 1 | **REAP saliency, 7-domain balanced calibration, coverage floor, SE guard, uniform 128, Q4_0 experts / Q5-Q6 trunk, imatrix** | +5-15 % bpb | −3 … −10 pt | 10.7 GB (PC) | pod 1 profile pass (~$5-8) + Mac surgery/quant | medium: code/math band | PUBLISHED criterion on this base (2607.16721 T3); MEASURED keep-set mass; PUBLISHED SE rule (2507.23279) |
| 2 | same ranking, **160 @ IQ3_S-class** (equal bytes to #1) | +2-6 % bpb +0.01-0.02 quant | −1 … −5 pt | 10.5 GB | $0 extra (same profile; Mac quant) | low-medium | MEASURED curve (160: 92-94 % lang, 80 % code); PUBLISHED equal-memory crossover (2607.16721 T5) |
| 3 | same ranking, **128 @ IQ3_S** (phone resident) / 128 @ Q4_0 streamed | as #1 +0.01-0.02 | as #1 | 8.7 GB / 9.1 GB pool | $0 extra | medium: ARM repack / mmap eviction | MEASURED KEXP residency history; PUBLISHED MoQE |
| 4 | unpruned **UD-IQ2_XXS** reference (quant-only) | +0.05-0.09 bpb quant, all experts kept | small, but IQ2 brittleness | 10.8 GB | $0 (download) | low cost, unknown generation quality at 2.3 bpw | PUBLISHED file size; PUBLISHED Table 5 (IQ2_M ≈ pruned Q4 on code) |
| 5 | #1 + **heal**: router full + LoRA r64 on attention/GDN/shared expert, sequence-level self-distillation from the base, 2-10k multilingual+code+math prompts | recovers ~½ of the gap | recovers ~½ | unchanged | ≈3-6 GPU-h ≈ $8-20 + data prep | medium: data licences, over-fit to prompts | PUBLISHED 2607.16721 §5.7 (52 % HE+ gap, ppl 30.9 → 9.4, <3 h, 95M params); 2605.28042 T1 |
| 6 | code/math-weighted ranking (w = 2) or coverage quota q = 32 as an A/B of #1 | −3-5 pp mass → maybe +2-4 % bpb | +6-8 pp mass → maybe +2-4 pt | same | $0 (same profile) | low | MEASURED frontier (§2.2); PUBLISHED coverage idea (2607.01710) |
| 7 | non-uniform per-layer budget (marginal-gain or JS-driven) | ≤ +0.6 pp mass | ≤ +0.6 pp | same | $0 | low value now | MEASURED (k128 waterline; raw/exp2 §D); PUBLISHED +0.014 xCOMET (2605.28042 Fig. 7) |
| 8 | k = 6 + k₂ renorm at inference (speed/bytes lever, not a build) | ≤ −1 % (HYP.) | −2 … −5 pt (HYP.; k=4 was −26 / −7.5 with k₂) | −25 % bytes/tok | $0 | low | PUBLISHED 2609.04575; MEASURED A40 k4 rows |
| 9 | criterion alternatives: MSAN / gate-free (task-agnostic) or frequency-weighted REAP ("reap_flow") | ± few pp mass | ± | same | $0 (same stats) | low | PUBLISHED unified criteria (2606.15716: MAN/MSAN best task-agnostic); moep `scoring.py:21-33` has all |
| 10 | expert **merging** (HC-SMoE / Sub-MoE / M-SMoE) at 50 % | unknown; merging ties gates | worse on generative | same | medium (new code path) | **high** | PUBLISHED: REAP §"functional subspace collapse" (2510.13999); Sub-MoE 86 % at 50 % on zero-shot MC only (2506.23266) — not generative |
| 11 | 75 % prune (64/layer) to fit 8 GB | collapse regime (r ≈ 0.3 lang, 0.63 code) | collapse | 5.9 GB | — | **very high** | MEASURED curve row 64; PUBLISHED 25 %-keep collapses for mass, −10 pt for REAP (2607.16721 T3) |
| 12 | full-parameter heal / continued pretraining | best recovery | best | — | ≥ 4×A6000 × hours, 10k+ examples | high cost, 67 GB BF16 states | PUBLISHED 2605.28042 (full FT, "PEFT insufficient" at 75 %+) — only if #5 fails |

Candidates 1-4 and 6 are **one pod session**; 5 is a second, conditional session; 7-9 ride on the
same statistics; 10-12 are not recommended now.

---

## 4. Experiment plan (smallest set that decides)

**Phase 0 (Mac, $0, before the pod).**
1. Extend the calibration to seven equal-token domains (~450k tokens each, ≈ 3.2M total — the published
   runs used 2,047 samples / 3.15M tokens, arXiv:2607.16721 §3): today's set is 10,620 rows / 2.11M
   tokens, IT 30 %, code only 120 MBPP rows (`prep/README.md:79`; `prep/CALIB-COUNTS.json:14`). Add code
   (kalsallama + CPython sources, as in v3) and math (GSM8K train, MIT) and balance ZH/FR/ES. Keep
   **FLORES devtest out** of calibration (v3 used dev+devtest, `v3/REPORT.md:33`; devtest becomes an eval).
2. Patch `moep` profiler with a 7th accumulator, per-expert **max ‖down_proj output‖** (SE guard;
   `~/kalsa-models/reap-src/moep/src/moep/profiler.py:1-17` lists the six existing ones), and a
   `--domain` tag so one pass per domain writes seven `profile.stats.pt`. Smoke on the synthetic
   checkpoint (`prep/verify/make_synth_checkpoint.py`).
3. Add the missing evals to `prep/eval/`: HumanEval+ (164, MIT) pass@1 with execution; FLORES-devtest
   EN→{IT,FR,ES,ZH} 100 sentences chrF++ + **wrong-language rate** (fastText lid.176); GSM8K-IT 100
   items (`Eurolingua/gsm8kx` or `sapienzanlp/gsm8k_italian`, licence to verify). Fix the known bugs:
   `30_gate.sh:59` drops the arm's overrides for bpb; GSM8K cap → 8192 (`REPORT.md:30`).

**Phase 1 (one pod, A100 80 GB ≈ $2/h; volume 300 GB).**
| step | what | wall | $ |
|---|---|---|---|
| 1 | env + fetch BF16 base (67 GB, pinned revision) | 0.5 h | 1 |
| 2 | 7 domain profiles with moep (REAP, MAN, MSAN, mass, freq, prob_mass, max-norm) | 2-3 h | 4-6 |
| 3 | score offline: A = REAP balanced mean (nested 128/160), B = REAP + coverage q=32 (128), SE guard on all; Jaccard vs v3 mass sets; proxy table | 0.2 h | 0.4 |
| 4 | surgery (A128, A160, B128) → `--no-mtp` GGUF → imatrix (7-domain text) → quants: A128-Q4_0, A128-IQ3_S, A160-IQ3_S, B128-Q4_0; download UD-IQ2_XXS | 2-3 h | 4-6 |
| 5 | evals, every arm paired with the unpruned Q4_K_M reference (and LFM for the gate): bpb×5, GSM8K-200, tools-100, HumanEval+, FLORES chrF++ + wrong-language, GSM8K-IT | 5 arms × ~1.2 h (A40 class) | 3-4 (A40) or 12 (A100) |
| | **total** | **~10-14 h** | **$15-25, cap $40, hard stop $50** |

Order and **stop rules** (each decided on the pod before the next build):
- S1 — after A128-Q4_0: if IT bpb > 0.75, or HumanEval+ < base − 15, or wrong-language > 5 %: stop
  128 arms; build A160-IQ3_S and A192-IQ3_XXS instead and re-evaluate (same ranking, no new profile).
- S2 — if A128 lands IT ≤ 0.66 and HumanEval+ ≥ base − 6: build the phone arm A128-IQ3_S and
  (optional) A96-Q4_0; mark #5 (heal) as GO.
- S3 — if UD-IQ2_XXS beats every pruned arm on the full gate: park the prune lane (quant-only wins at
  this budget), document, stop spending.
- S4 — B128 vs A128: adopt B only if code/math gain ≥ 3 pt with language loss ≤ 0.02 bpb.
- Money: `--terminate-after`/podStop armed first as in `prep/RUN-2026-09-30-A40.md`; per-arm upload of
  ~1 MB results + keep-set JSONs to the private HF dataset; GGUFs never leave the pod except the one
  the owner picks; delete the pod (the volume bills while stopped).

**Phase 2 (conditional on S2, ≤ $20).** Heal A128: router matrices full, LoRA r = 64 on attention,
GDN projections and shared expert, experts frozen; sequence-level self-distillation — the unpruned
base (Q8 llama-server on the pod) answers 5-10k prompts drawn from FineWeb-2 (ODC-By 1.0) IT/FR/ES/ZH/EN
passages, our code sources and GSM8K-train problems; 3 epochs, lr 1e-5 class, bf16; re-run the phase-1
gate. Expected: half the gap closed (PUBLISHED, arXiv:2607.16721 §5.7). Then SFT the Kalsa identity on
top (PLAN.md phase 2), not before.

**Measurement notes.** Paired bootstrap CIs as in `prep/eval/bootstrap_ci.py`; bpb corpus =
`corpus/postcutoff/` (its recall bias is symmetric across arms, `prep/docs/EVAL-GATE.md:14,35`);
never the memorised Gutenberg set (`prep/REPORT.md:231`). Report real exit codes (`cmd > log 2>&1; echo $?`).
Mac may replicate one artifact's gate to cross-check the pod (`run_bpb_eval.py` exists); phone work
(hit rate, residency, speed) is a later device session on the Xiaomi, screen on, unplugged.

---

## 5. What we must NOT do

1. **Rank by routing frequency or mass alone.** Mass collapsed at 25 % keep on this base while REAP
   held (PUBLISHED, 2607.16721 Table 3), and Super Experts — 3 of 6,144 in Qwen3-30B-A3B, layers 1-3,
   rare but with extreme down_proj outputs — are invisible to frequency and fatal to prune (GSM8K
   −52 to −74 %, PUBLISHED 2507.23279). Our v3 ranking is mass: it is the proxy, not the keep-set.
2. **Calibrate in English (or code) only.** RAZOR: IT 0.58 → 1.46 bpb (MEASURED); coding-heavy
   calibration: general ppl +131 % (PUBLISHED). The EN-only keep-set guts code to 27 % (MEASURED).
3. **Gate on bpb alone.** A random 50 % prune scored better code perplexity than the base and lost
   58 points of pass@1 (PUBLISHED 2607.16721 §5.4); our gate today has no code eval and no generative
   language eval — add HumanEval+, FLORES chrF++ and the wrong-language rate before deciding anything.
4. **Merge experts at this granularity.** 256 fine-grained experts, 8 active: merging ties gates and
   collapses the functional manifold — worst exactly for high-granularity models (PUBLISHED
   2510.13999); Sub-MoE's 86 % is on zero-shot multiple choice, not generation.
5. **Prune past ~50 %** (64-96/layer) to reach 8 GB: our curve says code keeps 37-53 % of its mass
   there (collapse regime); the owner already scoped 8 GB to LFM.
6. **Expect speed from pruning.** Active compute and raw bytes/token are ratio-invariant
   (`PARAM-BUDGET.md:99`); the Mac probe measured 0.39-0.45× LFM decode for every Qwen MoE arm
   (`prep/REPORT.md:242`). Only k (with k₂ renorm) and expert bpw move speed.
7. **Re-use the script traps**: bpb run without the arm's overrides (`30_gate.sh:59`), GSM8K cut at 4096
   (`REPORT.md:30`), `| tail` swallowing the exit code, `--no-mtp` omitted (converter asserts), pod
   self-DELETE (403 — only STOP works), HF token on argv, memorised Gutenberg bpb corpus.
8. **Ship sub-4-bit experts on Android without the residency fix**: no NEON repack → evictable →
   0.4 tok/s collapse (MEASURED on the S23 KEXP arm); `use_mmap=false` or the repack kernel first.
9. **Calibrate on the eval**: FLORES devtest, GSM8K test, HumanEval are evals; v3's corpus used FLORES
   devtest — rebuild the calibration without it.
10. **Trust any delegate's keep-set or number without the on-disk check** (per-layer ids = 128 unique in
    [0,255], Jaccard vs v3 sets, proxy recomputed from the bins); and never quote the proxy as quality.
11. **Spend before the $0 arms exist**: UD-IQ2_XXS and the 7 keep-set variants cost nothing beyond
    one profile pass; the pod is for the profile, the surgery and the paired evals, not for exploring.
12. **Build RAZOR-28B (25 %)**: 16 GB at Q4_K_M fits no target (`prep/README.md`).

---

## 6. Open points for the coordinator / the keep-set agent

- `moe-keepset-128` (GLM 67143a4f): its uniform/weighted/waterline tables are consistent with this
  design (§2.2); what it should add is the **nested 128 ⊂ 160 ⊂ 192 export** per layer and a
  machine-readable JSON in moep's `kept_expert_indices` shape, so the pod's REAP sets can be diffed
  against the mass sets layer by layer.
- Whether moep's `profile` can run per domain in one pod boot without re-loading the model (it
  should: one load, seven dataset passes) — a 10-line change if not.
- 16 GB phone: none in the lab; the Xiaomi 12 GB stands in for the 8.7 GB resident arm.
- This document is not committed; the coordinator commits (one pusher on main).

---

## 7. Sources

Ours (MEASURED): `results/gate_probe_a40_2026-10-01/REPORT.md:10-35`; `v3/REPORT.md:17-45,74-79,101-106,130,141,194,199`;
`v3/AUDIT.md:249-250,319,358`; `prep/REPORT.md:221-244`; `prep/docs/PARAM-BUDGET.md:21,29,45,86-88,99`;
`prep/docs/EVIDENCE.md:108-127`; `prep/docs/EVAL-GATE.md:55-61`; `prep/README.md:79,125`;
`prep/CALIB-COUNTS.json`; `reports/research-newmoe-candidates.md:12,164,175`; `PLAN.md:1058-1099`;
`docs/ALIVE.md:755`; `k128/merged_curve.csv:2,3,11,14`; `~/kalsa-models/reap-src/moep/src/moep/{profiler.py:1-17,scoring.py:21-33,73}`;
this folder's `raw/curve.py`, `raw/exp2.py` and logs (`EXIT=0`, seed 20261001, router bins
`/tmp/moe-expert-usage-v3/runs/full_{counts,mass}.bin` hashed in `v3/raw/source_hashes.txt`).

PUBLISHED (read 2026-10-01 via arXiv abstract/HTML):
- REAP — arXiv:2510.13999 (§4 saliency S_j = mean over routed tokens of g_j·‖f_j‖; Table 2 Qwen3-30B-A3B / GLM-4.5-Air at 50 %; merging baselines HC-SMoE, M-SMoE; functional subspace collapse).
- Qwen3.6-35B-A3B pruning study behind `moep` — arXiv:2607.16721 (Table 3 criterion shootout; §5.2 calibration trade-off and dose-response; §5.4 ppl vs pass@1; Table 5 equal-memory prune vs quant; §5.7 recovery fine-tune).
- RAZOR — arXiv:2609.30465 (consensus residual, router refill; GLM-4.7-Flash and Qwen3.6-35B-A3B at 25/50 %; +2.12-5.59 over REAP).
- Top-k₁ / normalise-by-top-k₂ — arXiv:2609.04575 (Qwen3.6-35B-A3B 8→4: −0.35 MMLU with k₂=16 vs −4.65).
- Translation specialists by expert pruning — arXiv:2605.28042 (§4.2 JS-divergence dynamic allocation; Table 1 recovery; routing mass vs REAP on Qwen3-30B-A3B 0.844 vs 0.801).
- Generic expert coverage — arXiv:2607.01710 (per-corpus profiling before the mask; beats REAP at 25-50 % retain).
- Super Experts — arXiv:2507.23279 (definition; 3 SEs in Qwen3-30B-A3B layers 1-3; Tables 3-5).
- Unified scoring (freq^b·gate^a·norm^c, MAN/MSAN) — arXiv:2606.15716.
- Sub-MoE — arXiv:2506.23266; HC-SMoE — arXiv:2410.08589 (ICML 2025).
- MoQE — arXiv:2310.02410; QuantMoE-Bench — arXiv:2406.08155; HOBBIT — arXiv:2411.01433; MoE-Infinity — arXiv:2401.14361.
- Routed scaling laws — arXiv:2202.01169 (Eq. 1, Table 3, Eq. 11).
- Precision scaling laws — arXiv:2411.04330 (abstract only: PTQ degradation grows with tokens/param).
- llama.cpp KLD tables: gist Artefact2/b5f810600771265fc1e39442288e8ec9 (Mistral-7B); HF bartowski/Qwen3.8-27B-GGUF card.
- File sizes: HF unsloth/Qwen3.6-35B-A3B-GGUF tree; config: HF Qwen/Qwen3.6-35B-A3B config.json.
- Data licences: FineWeb-2 ODC-By 1.0 (HF HuggingFaceFW/fineweb-2); FLORES-200 CC-BY-SA-4.0; GSM8K MIT; HumanEval MIT; Italian GSM8K sets — verify before use.

## Coordinator note (2026-10-01)

The Xiaomi 14 is the owner's daily phone with a PIN: it is NOT a lab instrument unless Marco explicitly offers it
for a session. Any device step here defaults to the S23 (8 GB) and stays a proposal until the owner picks a phone.
All 16 arXiv ids cited above were checked against arxiv.org abstracts by the coordinator (titles match).
