# Eval gate: Kalsa-REAP vs shipped LFM2.5-2.6B (fixed 2026-09-30)

Defines what a gate session must measure and the exact "wins clearly"
thresholds. Fixed per the Fable 5.1 review (sections T7/T8, top changes 3–4)
and the owner decision of 2026-09-30 (PC + 16 GB phones; LFM stays on 8 GB;
$0 probe first; one ratio, 50 %). Every cell is measured **paired**: same
models' items, same llama.cpp build, same session, greedy. **Q8_0 and the
25 % arm are dropped** — the pod produces one ratio (50 %), quants Q4_0 +
Q4_K_M.

## Baseline anchors already in the lab (not re-derived)

> **Known confound (probe 2026-09-30)**: public-domain classics are memorized
> by large models in pretraining — the unpruned Qwen3.6 scored en 0.024 bpb
> on Pride and Prejudice (recall, not modelling). Gate bpb numbers on this
> corpus inflate exactly the artifacts with more capacity; the generative
> holdouts (GSM8K/tools) don't share it. A future gate session should prefer
> recent/licence-clean text it can argue is out-of-training, or treat bpb as
> a tie-breaker with the confound recorded.

| fact | value | source |
|---|---|---|
| ship artifact | `LFM2.5-2.6B-QAD-Q4_0.gguf`, 1,593,894,944 B, sha256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` | `~/kalsa-models/mac/`, matches `docs/ALIVE.md` "Ship model" line |
| S23, Q4_K_M | pp512 84.09 / tg128 16.04 tok/s | `scratchpad/agents/archive-gpu-docs/REPORT.md:183` |
| CalaQwen (Qwen3.6 35B-A3B) streamed on S23 | 5.70 tok/s, compute-bound | `reports/research-newmoe-candidates.md:12,14,168` |

The ship baseline is re-measured in every gate session anyway; the anchors
exist so a suspicious Kalsa number can be cross-read immediately.

## Gate matrix

| metric | instrument | notes |
|---|---|---|
| bpb × 5 languages | `eval/run_bpb_eval.py` over `eval/text-holdout/` | ≥ 500 KB/language non-Wikipedia held-out text (public-domain PG books, `MANIFEST.json` has licences+hashes); leading 600 KB per language, 8 segments; per-language **bootstrap CI** on the Kalsa−LFM diff |
| GSM8K pass@1 | `eval/run_gen_eval.py --dataset gsm8k` (200 items, greedy, seed-42 slice) | strict last-number match on think-stripped output; **paired bootstrap CI** |
| Tool calls pass@1 | `eval/run_gen_eval.py --dataset tools` (100 items) | holdout built from hermes' **glaive-function-calling-5k.json — a different generator from the calibration's func-calling files** (review T7); scoring is dialect-fair (see below); **paired bootstrap CI** |
| decode tok/s | `llama-bench` tg128, labeled by device (Mac probe / S23 gate) | Mac numbers are Mac numbers, never presented as phone ones |
| degeneration | 8-prompt smoke | 0 tolerated |

## What "fixed" means here (review → change)

- **Tool scoring is format-fair.** LFM2.5 renders `<|tool_call_start|>[name(args)]<|tool_call_end|>` (read from its GGUF `tokenizer.chat_template`, see `eval/show_chat_template.py`); Qwen renders `<tool_call>{json}</tool_call>`. `eval/toolcalls.py` parses both into (name, args) and the scorer applies the same name+superset-args rule. A model no longer loses for speaking the other dialect.
- **`--no-display-prompt` on every generation** — the echoed prompt contains digits (GSM8K), so a scorer on plain stdout could pass without any generation.
- **Thinking is handled identically for both models: off.** LFM2.5's template has no thinking switch, so enabling it for Qwen would compare different settings; the gate measures the one-pass assistant. Any `<think>` block is stripped before matching, and an unclosed `<think>` (budget exhausted mid-reasoning) counts as a miss.
- **bpb corpus**: `eval/text-holdout/` replaces multi5 as the gate corpus (multi5 stays for F0 continuity). Containment-checked against the calibration set (`eval/check_holdout_disjoint.py`, 80-char windows at every alignment, fail at row containment > 0.5) — Jaccard was structurally ~0 and proved nothing.
- **CIs on every gate metric**: `eval/bootstrap_ci.py`, paired percentile bootstrap (10k resamples, seed 42), diff CI per language / per holdout.
- **Arms**: ratio 50 % only (owner decision 2026-09-30); quants Q4_0 + Q4_K_M only; Q8_0 dropped.

## "Wins clearly" — the ship threshold

With A = Kalsa artifact (one ratio + quant), B = LFM2.5 QAD-Q4_0 measured in
the same session:

1. **IT bpb** diff ≤ −0.30 with a 95 % CI whose upper bound is < 0.
2. **EN bpb** diff ≤ −0.20, same CI condition.
3. **ES/FR/ZH bpb** diff ≤ 0 with CI upper bound ≤ 0 (no language left behind).
4. **GSM8K**: pass-rate diff ≥ +15 points, CI lower bound > 0.
5. **Tools**: pass-rate diff ≥ +15 points, CI lower bound > 0.
6. **Degeneration**: 0 of 8 smoke prompts degenerate (hard fail otherwise).
7. **Speed floor** (device gate, PC + 16 GB phones resident): decode ≥ 0.5 × LFM decode on the same device. On 8 GB phones this cannot pass for Qwen3.6 (5.70 tok/s streamed, compute-bound — PARAM-BUDGET.md), which is why LFM stays there.

Rationale: 15 points ≈ 4× the noise floor of a 200-item set; the bpb margins
are 5–15× the slice jitter F0 measured (±0.02); the CI conditions replace the
old point-estimate-only rule — a "win" that the bootstrap cannot distinguish
from 0 is not a win.

**Verdict rule**: if no artifact passes all seven, the default is `no-ship`
and LFM2.5-2.6B stays the lineup — the gate exists precisely to prevent
shipping a big model that does not clear the small one by a wide margin.
