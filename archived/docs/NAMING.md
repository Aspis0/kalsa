# NAMING — official names for campaign techniques

Rule (owner, 2026-08-16): if someone published it, we use THEIR name; if we are
first, WE name it (like CalaQwen). Internal shorthand stays in old logs/results;
all NEW reports and docs use the names below.

## Published techniques → their names

| internal shorthand | official name | source |
|---|---|---|
| REAP | **REAP** (permanent expert pruning from the checkpoint) | published (REAP paper) |
| k6 / `--n-expert-used` | **top-k reduction** (inference-time expert count override) | generic published concept |
| drop / `--drop-cold-experts` | **expert skipping** (per-token, weight-thresholded) | AdapMoE-family |
| selfspec | **self-speculative decoding** | Draft & Verify (ACL 2024) family |
| overlap / `--overlap` | **IO/compute overlap** | standard systems technique |
| expert prefetch (generic) | **expert prefetching** | ExpertFlow / SP-MoE family |

## Ours to name — DECIDED BY OWNER 2026-08-18. All three slots are closed.

| internal shorthand | what it is | **OFFICIAL NAME** |
|---|---|---|
| "la ricetta" (quant + top-k 6 + skipping 1.0 con `--drop-no-renorm`) | the certified phone config; p=0.000488 on S23 (Mellum2 Q4_K_M, its own config); CalaQwen default changed to drop 1.0 + `--drop-no-renorm` on 2026-08-18 | **Kalsa Recipe** (slug `kalsa-recipe`) |
| K-F / kf-prefetch (dispatcher-gated cold-start prefetch) | — | **NO NAME. Stays "cold-start prefetch."** |
| E4 / draft congelato (attention-only self-draft with frozen recurrent state) | — | **NO NAME. Stays "frozen draft."** |
| the quality finding "skipping cold experts improves multilingual PPL on Mellum, optimum at 0.5" | our measured result (noise 1e-6) | no coined name; cite the measurement |

**Owner's reasoning, recorded because it is a standard and not a preference
(2026-08-18): "non c'è nulla di nuovo in queste cose."** A coined name is a claim
of novelty. Cold-start prefetch does not earn one — prefetching is published, and
our version is **in the graveyard anyway**: measured +7.1 % *against* warm on the
Jelly (p=0.000977), null cold, null on S23 / Xiaomi / CalaQwen. Naming a technique
we killed would be marketing.

Frozen draft is the closer call and the answer is still no: it does carry an
unpublished result (`alpha_alltok` **0.413** vs the mirror paper's **0.038**, i.e.
the opposite polarity works on hybrids), but there is **no product to name** — it is
dead as a speed technique and survives only as a correction mechanism plus 251 MiB
of RAM. The *finding* can be cited in a report; the *thing* gets no name.

Only the shipped config is named, because only it is a thing a user receives.

## Models (already named)

- **CalaQwen** = Qwen3.6-35B-A3B quantized (ours: KEXP on PC, phone quant on devices)
- **Marco / Marco1c** = Marco-Mini-Instruct-KEXP
- **Mellum2** = the PC multilingual-PPL quality thermometer

## Open honesty item

The recipe's QUALITY gate (PPL curve) is certified on **Mellum** only; CalaQwen
runs the recipe in all speed cells but has no dedicated quality gate yet — its
optimum drop may differ from 0.5. Queued as an owner-approved TODO (~1 PC-day).
