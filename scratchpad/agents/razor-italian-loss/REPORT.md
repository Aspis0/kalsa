# RAZOR-19B multilingual routing probe

**Verdict: CONFIRMED for the proposed routing-frequency mechanism.** On an equal 1,024-token sample per language, Italian, Spanish, and French route disproportionately to the experts RAZOR removed, relative to English: their removed-expert share of selected top-k routing mass is 51.4%, 56.3%, and 66.9% versus English's 45.9%. French is the strongest outlier at +21.0 points over English.

The first attempt at this measurement was invalid: `router_cb` read the strided `ffn_moe_topk` view as if it were contiguous (reading full argsort permutations instead of top-k ids) and aliased all microbatches onto one global index, so every expert appeared exactly 32 times per layer and all removed-mass shares came out ≈50%. That run's artifacts are archived unchanged in [raw/invalid-run-1/](raw/invalid-run-1/); its numbers are superseded by everything below.

## What was measured

The unpruned base `~/kalsa-models/probe/qwen36-35b-a3b-q4/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` (SHA-256 in [raw/source_hashes.txt](raw/source_hashes.txt)) ran on CPU (`-ngl 0`, Metal disabled) with llama.cpp eval-callback instrumentation in the detached worktree `/tmp/razor-italian-loss/kalsallama` at engine commit `61c9094811cb200fd475491f18f594fbde77634b`. For each language the sorted per-document corpus file was tokenized with the GGUF's own tokenizer and the first **1,024 tokens** evaluated in four 256-token microbatches. The model has 40 decoder MoE layers of 256 experts with top-8 routing.

The callback records `ffn_moe_topk-N` expert ids and the matching `ffn_moe_weights-N` raw softmax probabilities (pre-renormalization). `ffn_moe_topk-N` is a strided view of the full argsort (`ne[0]=8`, `nb[1]` spanning all 256 entries), so reads honor `nb[0]`/`nb[1]`; `ffn_moe_weights-N` (`[1, 8, ntok]`) is read honoring `nb[1]`/`nb[2]`. Top-k and weights are paired per (layer, microbatch) through a pending buffer, and the program verifies coverage after the run: each layer must be seen exactly once per microbatch (`topk_calls == weights_calls == 4`), must see exactly 1,024 tokens, and must have no unconsumed pairing — violations abort with a nonzero exit. These checks print as `ROUTER_SANITY` lines in each `raw/{lang}_agg.log`, and [raw/analyze_router.py](raw/analyze_router.py) re-verifies them from the logs.

## RAZOR survivor IDs

The pinned checkpoint publishes an explicit survivor manifest: [`kept_expert_indices.json`](https://huggingface.co/Nickyang/Qwen3.6-35B-A3B-RAZOR-19B-A3B-E128of256/blob/d897617a/kept_expert_indices.json), with `main_0` through `main_39`, each 128 expert ids out of the 256-expert pool (plus a separate `mtp_0` set; this probe evaluates the 40 decoder MoE layers, not MTP). The exact JSON is copied to [raw/kept_expert_indices.json](raw/kept_expert_indices.json), and [raw/razor_sets.csv](raw/razor_sets.csv) expands each decoder layer to a keep/remove bit per expert. The card says the retained weights are the base weights and describes RAZOR's expert score as a conditional RMS of local consensus-residual removal effects over 2,048 RazorCal calibration samples; it does not state RazorCal's language proportions. See the [pinned checkpoint card](https://huggingface.co/Nickyang/Qwen3.6-35B-A3B-RAZOR-19B-A3B-E128of256/blob/d897617a/README.md) and [RAZOR paper](https://arxiv.org/abs/2609.30465). **Mapping confidence: very high** (published per-layer ids; JSON SHA-256 in `raw/source_hashes.txt`).

## Routing to removed experts

The table reports (1) the fraction of top-k selections landing on RAZOR-removed experts, (2) the fraction of selected top-k router probability mass assigned to them, and (3) that removed mass divided by input tokens × decoder layers. Per-layer values are in [raw/per_layer_removed.csv](raw/per_layer_removed.csv); the aggregate is [raw/overall_summary.csv](raw/overall_summary.csv).

| Language | Removed selections | Removed share of selected top-k mass | Removed mass per token-layer |
|---|---:|---:|---:|
| EN | 48.40% | 45.90% | 0.08346 |
| IT | 52.67% | 51.35% | 0.09435 |
| ES | 56.95% | 56.33% | 0.10357 |
| FR | 66.42% | 66.94% | 0.12471 |
| ZH | 53.88% | 52.60% | 0.09606 |

English sits below the 50% a language-blind half-of-experts split would give, while every other tested language sits above it; the per-language removed-mass spread is wide (per-layer removed-mass shares range from 16.6% to 85.8% across layers and languages), so the ordering is not an artifact of aggregation. Selection counts and probability mass tell the same story.

## What a multilingual mass ranking would keep

For each layer I ranked experts by their accumulated selected router probability over the same 1,024-token sample — once by count of selections, once by mass — using EN alone and the balanced EN+IT+ES+FR sum (equal token counts, so equal weight). Each strategy keeps 128 experts per layer. The score is the share of IT's selected top-k probability mass assigned to the kept set (mean over the 40 layers; per-layer values in [raw/per_layer_it_keep_comparison.csv](raw/per_layer_it_keep_comparison.csv), expert ids in [raw/usage_rank_sets.csv](raw/usage_rank_sets.csv)).

| 128-expert set | IT selected routing mass retained |
|---|---:|
| Published RAZOR IDs | 48.35% |
| EN-only selection count | 77.33% |
| EN-only mass ranking | 76.31% |
| Balanced EN+IT+ES+FR selection count | 95.41% |
| Balanced EN+IT+ES+FR mass ranking | 95.63% |

The balanced ranking retains **~47 percentage points** more of IT's routing mass than the published RAZOR set on this sample. Even English-only usage ranking captures far more Italian routing than RAZOR does, which pins the difference on RAZOR's calibration-driven choices rather than on any EN-vs-IT router disagreement: the IT and EN per-layer top-128 sets overlap by a mean of 92.4 experts by selection count (93.4 by mass).

## Sanity of the fixed measurement

- **Selection counts are no longer uniform.** Per layer, the selection-count distribution over the 256 experts (min / median / max across the 40 layers, from [raw/sanity_count_distribution.csv](raw/sanity_count_distribution.csv)): EN **0–1 / 2–27 / 174–978**, IT **0 / 1–24 / 150–1015** (of 8,192 selections per layer). Real routing is strongly concentrated: a few experts absorb most selections while many are never picked — the opposite of run 1's uniform 32-everywhere.
- **Weights are probabilities.** The top-8 raw softmax probabilities per token sum to a mean of **0.18** across languages and layers, with per-token sums bounded by each layer's min/max in [raw/sanity_weights_sum.csv](raw/sanity_weights_sum.csv) — e.g. EN 0.065–0.626, FR 0.075–0.884, ZH 0.063–0.972; always inside (0, 1] as softmax requires, and never near 1 (the router is genuinely diffuse).
- **Coverage is exact.** Every run reports `topk_calls=4 weights_calls=4 tokens=1024` for all 40 layers with no pairing failures, and the CSV per-layer selection totals re-verify to 1,024 × 8.

## Interpretation and limits

The supplied A40 gate report records RAZOR versus unpruned-base bpb of IT **1.462 vs 0.580**, ES **1.141 vs 0.601**, FR **1.274 vs 0.604**, EN **0.792 vs 0.586**, and ZH **1.101 vs 0.852** (`~/Projects/kalsa-moe-experiments/results/gate_probe_a40_2026-10-01/REPORT.md`). The removed-expert routing shares line up with those losses in direction: the languages that lost the most bpb also send the largest share of their routing into the deleted experts, and English — the only language that barely regressed — sends the least. The magnitude ordering is not exact (FR routes most disproportionately while IT lost the most bpb), so routing share alone does not fully determine the damage; deleted experts' functions and the renormalized post-pruning router matter beyond raw mass share. This probe measures the unpruned base router only.

Limits: the sample is a 1,024-token prefix per language, not the full corpus; it uses the locally available Q4_K_M base GGUF, not BF16; and the corpus is the post-cutoff Wikipedia set whose creation-date cutoff can favor recall asymmetrically, as noted in the gate report. The ~95% IT mass retention of a balanced top-128 is a routing-mass statement, not a predicted bpb.

## Reproduction commands and output provenance

The exact five model commands and their `EXIT=0` results are in [raw/run_commands.txt](raw/run_commands.txt); each full stdout/stderr log is `raw/{lang}_agg.log` and carries the per-layer `ROUTER_SANITY` lines. The aggregate metrics, keep-set comparisons, and sanity CSVs are produced by [raw/analyze_router.py](raw/analyze_router.py):

```sh
python3 ~/Projects/kalsa-moe-experiments/scratchpad/agents/razor-italian-loss/raw/analyze_router.py > ~/Projects/kalsa-moe-experiments/scratchpad/agents/razor-italian-loss/raw/analysis.log 2>&1; echo EXIT=0
```

The instrumented CPU build used:

```sh
cmake -S /tmp/razor-italian-loss/kalsallama -B /tmp/razor-italian-loss/build-cpu -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=ON -DLLAMA_BUILD_TOOLS=OFF > /tmp/razor-italian-loss/cmake_cpu.log 2>&1; echo EXIT=0
cmake --build /tmp/razor-italian-loss/build-cpu --target llama-eval-callback -j 8 > /tmp/razor-italian-loss/build_v2.log 2>&1; echo EXIT=0
```

The exact model file and artifact hashes are in [raw/source_hashes.txt](raw/source_hashes.txt). No network service or paid API was used, and nothing was pushed.
