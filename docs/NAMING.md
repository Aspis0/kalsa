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

## Ours to name (nobody published these) — OWNER PICKS

| internal shorthand | what it is | proposed names (pick or invent) |
|---|---|---|
| "la ricetta" (quant + top-k 6 + skipping 0.5-0.65) | the certified phone config; p=0.000488 on S23; PPL optimum at drop 0.5 (Mellum) | **[DA SCEGLIERE]** — e.g. Ricetta Kalsa · KEXP Recipe · Kalsa Serve |
| K-F / kf-prefetch (dispatcher-gated cold-start prefetch, issue-only layer-ahead, width knob) | prefetch itself is published; OUR novelty = the measured dispatcher policy (ON iff stall% high AND cache cold AND no thermal alarm) + cold-start-only scope | **[DA SCEGLIERE]** — e.g. Kalsa Cold-Start · Kalsa Kernel CS |
| E4 / stateless drafting / draft congelato (attention-only self-draft with FROZEN recurrent state on hybrids) | unpublished polarity (verified by 2 web sweeps); mirror paper failed the opposite way at α=0.038 | **[DA SCEGLIERE]** — e.g. CalaDraft · Kalsa StatelessDraft · FrozenDraft |
| the quality finding "skipping cold experts IMPROVES multilingual PPL, optimum at 0.5" | our measured result (DROPCURVE_OPTIMUM, noise 1e-6) | claim name for the report — e.g. "cold-expert noise" finding |

## Models (already named)

- **CalaQwen** = Qwen3.6-35B-A3B quantized (ours: KEXP on PC, phone quant on devices)
- **Marco / Marco1c** = Marco-Mini-Instruct-KEXP
- **Mellum2** = the PC multilingual-PPL quality thermometer

## Open honesty item

The recipe's QUALITY gate (PPL curve) is certified on **Mellum** only; CalaQwen
runs the recipe in all speed cells but has no dedicated quality gate yet — its
optimum drop may differ from 0.5. Queued as an owner-approved TODO (~1 PC-day).
