# MoE versus dense: evidence report

Status: researched 2026-09-14. “Stronger” below means benchmark capability, not throughput or memory footprint.

## 1. Is `sqrt(total × active)` a sourced rule?

**No. I found no primary paper that states or derives the exact rule**

\[
N_{eq}=\sqrt{T A}
\]

as a universal MoE-to-dense conversion, and I found no paper validating that exact rule against a broad set of measured benchmarks. The formula appears as community shorthand—for example, a 2025 Hacker News discussion—and as a later reinterpretation of Clark et al.; neither is a derivation or validation study: [Hacker News discussion, 2025-06-01](https://news.ycombinator.com/item?id=44149238), [Marin scaling-law analysis, accessed 2026-09-14](https://marin.community/analysis/scaling-laws-analysis/).

The likely source of the confusion is Clark et al.’s **effective parameter count (EPC)**. Their actual procedure is to fit a loss law in dense/base-model size, expert count, routing configuration, and training setup, then define the dense size `N̄` satisfying `L(N̄, 1) = L(N, E)`. It is not `sqrt(TA)`: the fitted exponent and expert-count transform are empirical, routing-dependent, and evaluated at a specified token count. Their paper also shows different EPCs for the same model on different tasks. [Clark et al., *Unified Scaling Laws for Routed Language Models*, 2022-02-02 / revised 2022-02-09](https://arxiv.org/pdf/2202.01169).

What I could **not** find: a primary-source citation for the geometric mean itself; a derivation from an MoE compute, loss, or information-theoretic law; or a benchmark paper showing that `sqrt(TA)` predicts where a MoE falls on a dense-model capability curve.

For orientation only, arithmetic gives:

| MoE | `sqrt(TA)` | What can be concluded from that number |
|---|---:|---|
| 6B total / 1B active | 2.45B | Nothing citable about whether it beats a 3B dense model. |
| 35B total / 3B active | 10.25B | Nothing citable about whether it beats a 3B dense model. |

Those are calculations, not literature claims.

## 2. What do published MoE scaling laws actually say?

| Work and date | Formula or result | What is held constant; inference relevance |
|---|---|---|
| Clark et al. (2022) | Loss is modeled using dense/base size, expert count, total parameters, inference FLOPs, routing frequency, and top-`K`; EPC is defined by equal fitted loss. | Models were trained on the same 130B-token schedule. This is a pretraining-loss law at a specified token count, not a universal inference-time capability rule. It explicitly finds task-dependent EPC. [Paper, 2022-02-02](https://arxiv.org/pdf/2202.01169) |
| Krajewski et al. (2024) | `L(N,D,G)=c+(g/G^γ+a)/N^α+b/D^β`, with active/model size `N`, tokens `D`, and granularity `G`. | Fits more than 100 models from 129M to 3.7B total parameters, trained for 16B–130B tokens. It compares compute-optimal training and says MoE advantage depends on token budget and granularity; it does not produce an equivalent dense size. [Paper, 2024-02-12](https://arxiv.org/pdf/2402.07871) |
| Ludziejewski et al. (2025) | `L(N_act,D,Ê)=a Ê^δ N_act^(α+γ ln Ê)+b Ê^ω D^(β+ζ ln Ê)+c`. | Joint fit over more than 280 experiments, up to 2.7B active and 5B total parameters. At fixed active size, more experts help more with more training tokens; compute-optimal MoEs trade fewer active parameters for more tokens. This is a training-budget law, not a ranking from `T,A` alone. [Paper, 2025-02-07](https://arxiv.org/abs/2502.05172) |
| Abnar et al. (2025) | Fits an IsoFLOP surface over total parameters and active parameters; sparsity is `S=(E−K)/E`. | Under fixed training compute, larger total capacity and fewer active parameters can improve pretraining loss. But at matched perplexity, sparser models can be worse on reasoning-oriented downstream tasks; this directly warns against converting active FLOPs into capability. [ICML paper, 2025-07-02](https://proceedings.mlr.press/v267/abnar25a.html) |
| Tian et al. (2025/ICLR 2026) | Defines an efficiency-leverage law depending on activation ratio, granularity, and total compute; the fitted relation is not a geometric mean. | Over 300 models, up to 28B total. A 17.5B/0.855B model matched a dense 6.1B model in their controlled training experiment, using more than seven times fewer active parameters/compute. That is a useful measured point, not a universal conversion: training was deliberately optimized and used a common 1T-token dataset. [Paper, 2025-07-20](https://arxiv.org/abs/2507.17702) |

The common pattern is conditional scaling: tokens, training compute, router/top-`K`, granularity, architecture, and task all matter. None of these papers supplies a defensible rule of the form “given only `T` and `A`, use dense size `f(T,A)` for inference capability.”

## 3. Direct measured comparisons

These are the closest useful measurements I found. They are not all clean causal experiments: current released models often change architecture, data, post-training, or reasoning mode at the same time.

### Qwen3: same family, relatively clean base-model comparison

Qwen3-30B-A3B is 30B total / 3B activated; Qwen3-14B is dense. The official base-model table reports:

| Benchmark | Qwen3-14B dense | Qwen3-30B-A3B MoE |
|---|---:|---:|
| MMLU | 81.05 | 81.38 |
| MMLU-Pro | 61.03 | 61.49 |
| SuperGPQA | 34.27 | 35.72 |
| BBH | 81.07 | 81.54 |
| GPQA | 39.90 | 43.94 |
| GSM8K | 92.49 | 91.81 |
| MATH | 62.02 | 59.04 |
| EvalPlus | 72.23 | 71.45 |
| MultiPL-E | 61.69 | 66.53 |
| MBPP | 73.40 | 74.40 |

The authors summarize the MoE as comparable to Qwen3-14B and Qwen2.5-32B, while outperforming Qwen2.5-14B on the reported tasks. Thus this particular 30B/3B model is roughly in the Qwen3-14B-dense neighborhood on the table, not near the geometric-mean value `sqrt(30×3)=9.49B` by any demonstrated rule. It still is not evidence that every 30B/3B MoE equals a 14B dense model. [Qwen3 Technical Report, 2025-05-14](https://arxiv.org/pdf/2505.09388)

### Qwen3.5: current 35B/3B example, but hybrid architecture

The official Qwen3.5-35B-A3B card identifies 35B total / 3B activated, hybrid linear-attention plus gated-attention, and sparse MoE; it compares it with the 27B dense Qwen3.5 model. Selected official results are:

| Benchmark | Qwen3.5-27B dense | Qwen3.5-35B-A3B MoE |
|---|---:|---:|
| MMLU-Pro | 86.1 | 85.3 |
| MMLU-Redux | 93.2 | 93.3 |
| SuperGPQA | 65.6 | 63.4 |
| IFEval | 95.0 | 91.9 |
| GPQA Diamond | 85.5 | 84.2 |
| HLE CoT | 24.3 | 22.4 |
| SWE-bench Verified | 72.4 | 69.2 |
| LiveCodeBench v6 | 80.7 | 74.6 |
| CodeForces | 1899 | 2028 |
| TAU2 | 79.0 | 81.2 |

The MoE is below the 27B dense model on most of these reported rows, with a few wins. This does not isolate sparsity—the models are hybrid and the card does not provide a small dense ladder—so it is counterevidence to a universal parameter conversion, not proof that the MoE is intrinsically weaker. [Qwen3.5-35B-A3B model card, model documentation current 2026-02-23; accessed 2026-09-14](https://huggingface.co/Qwen/Qwen3.5-35B-A3B), [Alibaba Cloud model documentation, 2026-02-23](https://help.aliyun.com/en/model-studio/newly-released-models)

### Granite 4.0: the requested 7B/1B versus 3B comparison

Granite 4.0 H-Tiny is hybrid MoE, 7B total / 1B active; H-Micro is hybrid dense 3B. Official results:

| Benchmark | H-Micro dense 3B | H-Tiny MoE 7B/1B |
|---|---:|---:|
| MMLU | 67.43 | 68.65 |
| MMLU-Pro | 43.48 | 44.94 |
| BBH | 69.36 | 66.34 |
| GPQA | 32.15 | 32.59 |
| IFEval average | 84.32 | 81.44 |
| GSM8K | 81.35 | 84.69 |
| DeepMind Math | 43.83 | 49.92 |
| HumanEval | 81 | 83 |
| MBPP | 73 | 80 |
| CRUXEval-O | 41.25 | 39.63 |
| MMMLU | 55.19 | 61.87 |

It is close to, sometimes above, and sometimes below the 3B dense model; there is no single “lands between” answer. The architecture is a confound: H-Tiny is a hybrid recurrent/attention MoE with 64 experts and six active, whereas H-Micro is hybrid dense. [Granite model documentation, accessed 2026-09-14](https://ibmgranite.mintlify.app/granite/docs/models/granite), [Granite 4.0 H-Tiny card, release 2025-10-02; accessed 2026-09-14](https://huggingface.co/ibm-granite/granite-4.0-h-tiny)

### Phi-mini-MoE: useful same-card ladder, but not same training recipe

Phi-mini-MoE is 7.6B total / 2.4B active. The model card’s `lm-evaluation-harness` table gives:

| Benchmark | Phi-3 mini dense 3.8B | Phi-mini-MoE 7.6B/2.4B | Phi-3 small dense 7.4B |
|---|---:|---:|---:|
| MMLU | 69.94 | 70.68 | 75.35 |
| MMLU-Pro | 45.65 | 49.68 | 52.06 |
| BBH | 54.94 | 55.27 | 62.07 |
| ARC-C | 85.58 | 84.91 | 84.30 |
| HumanEval | 72.60 | 73.80 | 70.10 |
| GSM8K | 84.61 | 84.89 | 84.84 |
| MT-Bench | 7.46 | 7.59 | 8.03 |

On this table the MoE is near Phi-3 mini 3.8B overall, clearly below Phi-3 small 7.4B on several knowledge/reasoning rows, and slightly ahead on some coding/math rows. Its geometric mean would be `sqrt(7.6×2.4)=4.27B`, which happens to be near one comparison point, but the mixed rows do not validate the formula. [Phi-mini-MoE model card, training period 2024-09 through 2025-03; accessed 2026-09-14](https://huggingface.co/microsoft/Phi-mini-MoE-instruct)

### Liquid LFM2.5: no clean same-family dense comparison found

The LFM2.5-8B-A1B card describes an 8.3B-total / 1.5B-active hybrid, trained on 38T tokens, and reports comparisons against other vendors rather than a same-recipe LFM2.5 dense model. Its published table includes Qwen3.5-4B and Qwen3-30B-A3B, but that is not a controlled LFM dense comparison. [LFM2.5-8B-A1B model card, 2026; accessed 2026-09-14](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B), [Liquid AI LFM2.5 announcement, 2026](https://www.liquid.ai/blog/lfm2-5-8b-a1b)

The older LFM2 technical report does provide a same-family statement: LFM2-8B-A1B is described as achieving “3–4B-class” quality at about 1.5B decode cost, and its table compares it with dense LFM2-2.6B. That is a useful vendor-reported point for **LFM2**, not LFM2.5, and it is not a derivation of `sqrt(TA)`. [LFM2 Technical Report, 2025-11-28](https://arxiv.org/abs/2511.23404), [LFM2-8B-A1B model card, accessed 2026-09-14](https://huggingface.co/LiquidAI/LFM2-8B-A1B)

## 4. Counter-evidence and limits

- **Very small models and reasoning:** Jelassi et al. train dense and MoE models from roughly 16M to 2.1B total parameters on 65B tokens. At fixed active parameters, adding experts improves memorization/world knowledge more than reasoning; on commonsense and math, MoE can be worse than a dense model at the same total size. This is direct evidence against one scalar effective size, especially below 10B. [Jelassi et al., *Mixture of Parrots*, ICLR 2025; arXiv revised 2025-03-01](https://arxiv.org/pdf/2410.19034)

- **Active parameters are not enough for downstream capability:** Abnar et al. report that at similar perplexity, sparser models with fewer active parameters can underperform on reasoning/read-comprehension tasks, while chain-of-thought changes the comparison. Their Qwen1.5-5x2.7B MoE experiment also reports a different slope under length-controlled CoT. [Abnar et al., ICML 2025](https://proceedings.mlr.press/v267/abnar25a.html)

- **Granularity and routing:** Krajewski et al. find that extreme granularity eventually hurts when routing overhead becomes large relative to active expert parameters; their main experiments hold expansion rate at 64 and do not yield a universal expert-count conversion. [Krajewski et al., 2024-02-12](https://arxiv.org/pdf/2402.07871)

- **Hybrid/recurrent architectures:** Granite H-Tiny, Qwen3.5-35B-A3B, and LFM2.5 combine MoE with recurrent/linear-attention components. Their scores cannot be attributed to MoE sparsity alone. [Granite documentation, accessed 2026-09-14](https://ibmgranite.mintlify.app/granite/docs/models/granite), [Qwen3.5 card, accessed 2026-09-14](https://huggingface.co/Qwen/Qwen3.5-35B-A3B), [LFM2.5 card, accessed 2026-09-14](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B)

- **Quantization:** Li et al. show that MoE post-training quantization is structurally sensitive: different expert/block/linear components need different bit allocations, based on two MoE models and six tasks. A 2025 ACL study reports MoE quantization results for Mixtral, Phi-3.5-MoE, DeepSeek-MoE, and Qwen1.5-MoE, but it compares quantizers/pruning strategies within MoEs rather than establishing an MoE-versus-dense capability law. MoQE reports that some 2-bit expert-weight configurations can beat a dense model trained on the same dataset, but that is a method-specific result, not a `T,A` rule. [Li et al., 2024-06-12](https://arxiv.org/abs/2406.08155), [ACL 2025 quantization study](https://aclanthology.org/2025.acl-long.633.pdf), [MoQE, Microsoft Research page, accessed 2026-09-14](https://www.microsoft.com/en-us/research/publication/mixture-of-quantized-experts-moqe-complementary-effect-of-low-bit-quantization-and-robustness/?lang=zh-cn)

What I could **not** find: a controlled, published experiment below roughly 10B total that holds architecture, data, post-training, decoding, and quantization constant and fits a universal dense-equivalent function of only total and active parameters. The available evidence instead says to benchmark the actual pair.

## Direct answer

Given a MoE with total parameters `T`, active parameters `A`, and a dense model of size `D`, **there is no sourced basis for deciding which is stronger from `T`, `A`, and `D` alone**. `sqrt(TA)` is an uncited community heuristic, not a published or benchmark-validated law. The defensible published alternatives are conditional scaling laws for specified training tokens/compute and fitted, task-specific EPCs—not an inference-time equivalence rule. For the 6B/1B versus 3B decision, and for the 35B/3B versus 3B decision, measuring both models on the same prompts, decoding settings, context lengths, and quantization is required; no citable rule settles it.
