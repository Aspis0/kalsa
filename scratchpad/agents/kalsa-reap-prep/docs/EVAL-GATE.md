# Eval gate: Kalsa-REAP vs shipped LFM2.5-2.6B (fixed 2026-09-30)

Defines what a gate session must measure and the exact "wins clearly"
thresholds. Fixed per the Fable 5.1 review (T7/T8), the owner decision of
2026-09-30 (PC + 16 GB phones; LFM stays on 8 GB; $0 probe first; one
ratio, 50 %) and the Fable-2 review (thinking ON, single BOS, raw
outputs, post-cutoff corpus). Every cell is measured **paired**: same
items/documents, same llama.cpp build, same session, greedy. **Q8_0 and
the 25 % arm are dropped** — the pod produces one ratio (50 %), quants
Q4_0 + Q4_K_M.

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
| bpb × 5 languages | `eval/run_bpb_eval.py` over `corpus/postcutoff/` | ≥ 50 documents/language, every document a Wikipedia article CREATED after 2026-07-01 (per-doc title/pageid/revid in `MANIFEST.json`, CC-BY-SA-4.0). KNOWN BIAS (Fable-3 §3): creation ≠ novelty — many pages translate long-existing articles, so the corpus leans on cross-lingual recall with a cutoff asymmetry favouring Qwen; symmetric across arms, not a clean instrument. Per language the docs are concatenated into ONE llama-perplexity run (`-c 1024`); the per-CHUNK ppl values are the **bootstrap CI units** on the diff |
| GSM8K pass@1 | `eval/run_gen_eval.py --dataset gsm8k` (200 items, greedy, seed-42 slice) | strict last-number match on think-stripped output; **paired bootstrap CI** |
| Tool calls pass@1 | `eval/run_gen_eval.py --dataset tools` (100 items) | holdout built from hermes' **glaive-function-calling-5k.json — a different generator from the calibration's func-calling files** (review T7); scoring is dialect-fair (see below); **paired bootstrap CI** |
| decode tok/s | `llama-bench` tg128, labeled by device (Mac probe / S23 gate) | Mac numbers are Mac numbers, never presented as phone ones |
| degeneration | 8-prompt smoke | 0 tolerated |

## What "fixed" means here (review → change)

- **Tool scoring is format-fair.** LFM2.5 renders `<|tool_call_start|>[name(args)]<|tool_call_end|>` (read from its GGUF `tokenizer.chat_template`, see `eval/show_chat_template.py`); Qwen renders `<tool_call>{json}</tool_call>`. `eval/toolcalls.py` parses both into (name, args) and the scorer applies the same name+superset-args rule. A model no longer loses for speaking the other dialect.
- **Thinking ON for every model, n_predict ≥ 4096** (product parity; at 1024, LFM always-reasoning hit the cap on 3/4 regenerated items). Either reasoning dialect is stripped before matching: Qwen `<think>…</think>`, LFM QAD `[Start thinking]…[End thinking]`; unclosed reasoning at the cap is a miss.
- **Prompts go through the server's `/v1/chat/completions`** — the server owns template + tokenization, which kills the doubled BOS the raw-prompt `/completion` path produced; the pod runner greps the server log for the `2 BOS` warning and flags any arm that shows it. Raw model output is stored per item in the results JSON.
- **bpb corpus**: `corpus/postcutoff/` (per-document, post-cutoff Wikipedia creations, built by `eval/build_postcutoff_corpus.py`) replaces both multi5 and the memorised-Gutenberg set. Containment-checked against the calibration (`eval/check_holdout_disjoint.py`, 80-char windows at every alignment, fail at row containment > 0.5).
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

## Phase-0 additions (2026-10-01, DESIGN §4 item 3)

Three generative evals close the gap that mattered (§5.3: never gate on bpb
alone — a random 50 % prune looked fine on perplexity and lost 58 points of
pass@1). Sources, licences and sha256 pins: `PHASE0-EVALS.md`.

| metric | instrument | pairing units |
|---|---|---|
| HumanEval+ pass@1 (164 problems, greedy, thinking on) | `eval/run_humaneval.py` over `eval/humaneval-164.jsonl` (EvalPlus base+plus tests); one subprocess per problem in EvalPlus order (model code first, tests — which define `check()` — after, sentinel required: a `sys.exit(0)` or a redefined `check` cannot pass); best-effort isolation (replaced env, `PATH=/nonexistent`, rlimits, process-group kill on timeout) that is NOT a containment boundary — known bypasses (`_socket`, absolute paths) are documented in the runner, which refuses to run on macOS without `--allow-host`; pod only | per-item 0/1, `bootstrap_ci.py` unchanged |
| FLORES-200 devtest EN→{IT,FR,ES,ZH} (100 sentences, first slice) | `eval/run_flores.py` at `--max-tokens 4096`: chrF++ via sacrebleu + wrong-language rate via fastText lid.176 (`~/kalsa-models/lid.176.bin`) over NON-truncated items — a truncated item (length cut, unclosed `<think>`, answer stuck in `reasoning_content`) is a token-budget artifact, reported per pair and FAILING the run above 2 %, never counted wrong-language; LID self-check on the gold refs (≥ 90 %) else the run fails | per-sentence chrF and per-item 0/1, both bpb-shaped with a `metric` field — `bootstrap_ci.py --bpb` directly |
| GSM8K-Italian pass@1 (100 items, seed 42) | `eval/gsm8kit-100.jsonl` (Eurolingua/gsm8kx test split, MIT) through `run_gen_eval.py --dataset gsm8kit` — same last-number scorer as GSM8K | per-item 0/1, unchanged |

Generation-cap fix (A40 REPORT reading 3): math datasets run at
**n_predict 8192** (30_gate.sh, `GSM8K_MAX_TOKENS`); tools stay at 4096;
FLORES runs at 4096 so a thinking model can finish a one-sentence
translation plus its `<think>` block (the first draft kept 1024, which
counted truncations as wrong-language — audit B4). The
A40 raw generations cannot be re-scored uncapped — truncated items stored (all
but 2-4 per arm) no thinking text (`eval/rescore_gsm8k_raw.py` output in
PHASE0-EVALS.md), so the probe's GSM8K numbers keep their finish-rate
confound until regeneration. (Corrected per the audit: the cause was the
harness not archiving the raw responses, not the server's reasoning
handling; the runners now store `reasoning` per item, so future truncations
stay re-scorable from disk.)

bpb now receives the arm's `--override-kv` flags (`30_gate.sh` replay +
`run_bpb_eval.py --override-kv`); the A40 probe's bpb rows for the k4 arms
were measured at the model DEFAULT expert count — treat those cells as
"default-k" numbers. The replay carries only `--override-kv`: any other
expert-count mechanism would silently measure bpb at defaults (audit M8,
open).

Stop rule (DESIGN §4 S1), fail-closed: `eval/check_stop_rule.py --arm <dir>
--base <base dir>` prints each check with its numbers and exits 0 = GO /
1 = STOP. Rules for the 128-expert arms: IT bpb > 0.75, or HumanEval+ <
base − 15 pp, or wrong-language > 5 % in any pair. A missing dir, a missing
or unparsable JSON, a missing key, or n = 0 is a STOP with the reason
printed, and every rule is evaluated — an unreadable input can never yield
GO. It is INVOKED by `podprobe/run_probe.sh` after the arm loop, for
`razor19-k4-q4km` and `razor19-k4-k2` against `--base "$RESULTS/qwen36-k4"`
(the exact unpruned k=4 control), writing `results/stop-rule.log` into the
uploaded results; the verdict goes to the coordinator and does not change
the probe's exit code.

