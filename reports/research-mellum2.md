# Mellum2 (JetBrains) recon — Apache 12B/2.5B for the on-device 10 tok/s slot?

**Verdict: MAYBE.** Stack-legal and geometrically closer to a 10 tok/s S23 SKU than Instella or Lightning (Apache 2.0 on the weights, upstream `LLM_ARCH_MELLUM`, official GGUFs, no GDN, no shared expert, SWA 3:1). It is **not** a free 10 tok/s win: trained `k=8` makes routed expert traffic ~1.84× CalaQwen, S23 8 GB cannot comfortably RAM-resident a 4.2–4.8 GB KEXP file, and JetBrains itself claims **English + programming languages only**. The “native MTP head” is a **training-time auxiliary that is not in the downloadable checkpoints**.

Reference points we treat as measured, not estimated (same table as `newmoe-recon`):

| model (shipped) | S23 decode | MiB/tok | hit% | source |
|---|---:|---:|---:|---|
| Marco1c KEXP | 8.82 | 51.5 | 53.5 | lineup card / campaign |
| CalaQwen = Qwen3.6-35B-A3B KEXP `k6d065` | 5.70 | 30.7 | 80.7 | same; geometry [Qwen3.6-35B-A3B `config.json`](https://huggingface.co/Qwen/Qwen3.6-35B-A3B/raw/main/config.json) |

CalaQwen is **compute-bound** (fewer bytes, higher hit, slower — GDN). Marco is **I/O/hit-bound** (more bytes, worse hit, faster). Mellum2 has **no GDN**, so we score it in the Marco regime unless a measurement says otherwise.

Realized streaming bandwidth on S23: `8.82 × 51.5 ≈ 454 MiB/s` (Marco). CalaQwen realizes `5.70 × 30.7 ≈ 175 MiB/s`. We do **not** pretend a new model gets the 20–25 GB/s LPDDR5X silicon ceiling through the expert-stream path.

---

## 1. Identity

**Exact family (one geometry, six checkpoints).** All announced variants are **downloadable** as BF16 safetensors.

Collection: <https://huggingface.co/collections/JetBrains/mellum-2> (updated 2026-06-01)

| repo | role | announced + downloadable |
|---|---|---|
| [JetBrains/Mellum2-12B-A2.5B-Base-Pretrain](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Base-Pretrain) | base before 128K YaRN | yes |
| [JetBrains/Mellum2-12B-A2.5B-Base](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Base) | final long-context base | yes |
| [JetBrains/Mellum2-12B-A2.5B-Instruct-SFT](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Instruct-SFT) | SFT instruct (no CoT) | yes |
| [JetBrains/Mellum2-12B-A2.5B-Thinking-SFT](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Thinking-SFT) | SFT thinking | yes |
| [JetBrains/Mellum2-12B-A2.5B-Instruct](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Instruct) | RLVR instruct (flagship chat) | yes |
| [JetBrains/Mellum2-12B-A2.5B-Thinking](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Thinking) | RLVR thinking (flagship reasoner) | yes |

**Dates (announced vs first bits on disk):**

| event | date | source |
|---|---|---|
| Instruct repo `createdAt` | **2026-05-26** | [HF API](https://huggingface.co/api/models/JetBrains/Mellum2-12B-A2.5B-Instruct) |
| Technical report submitted | **2026-05-29** | [arXiv:2605.31268](https://arxiv.org/abs/2605.31268) |
| Public launch | **2026-06-01** | [HF blog](https://huggingface.co/blog/JetBrains/mellum2-launch), [JetBrains blog](https://blog.jetbrains.com/ai/2026/06/mellum2-goes-open-source-a-fast-model-for-ai-workflows/) |
| llama.cpp `LLM_ARCH_MELLUM` merged | **2026-06-02** | [PR #23966](https://github.com/ggml-org/llama.cpp/pull/23966) → commit [`4fb16ec`](https://github.com/ggml-org/llama.cpp/commit/4fb16eccce5e451b40014355f97374d692480a4d) |
| Official GGUF collection | **2026-06-04** | [JetBrains/mellum2-gguf](https://huggingface.co/collections/JetBrains/mellum2-gguf) |

There is **no other size**. Not a 4B/7B/30B family — only `12B-A2.5B`. Predecessor [JetBrains/Mellum-4b-base](https://huggingface.co/JetBrains/Mellum-4b-base) is a **different** 4B dense FIM completer (2025-04).

### Specs vs `config.json` raw

Primary: [Instruct `config.json`](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Instruct/raw/main/config.json) (Base is identical except `eos_token_id`).

| claim | verified? | where |
|---|---|---|
| 12B total | **YES** — HF safetensors metadata **12,149,923,072** params; BF16 store **24,299,846,144** B (~22.6 GiB) | [HF API `safetensors.total`](https://huggingface.co/api/models/JetBrains/Mellum2-12B-A2.5B-Instruct) + [`model.safetensors.index.json`](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Instruct/raw/main/model.safetensors.index.json) `total_parameters` |
| 2.5B active / token | **YES, reconstructed** ≈ 2.44B (attn + top-8 experts + router + untied LM-head). Vendor rounds to 2.5B. | paper §2.2 + geometry below |
| 64 experts / 8 active | **YES** — `num_experts: 64`, `num_experts_per_tok: 8` | config.json |
| Native MTP head | **ANNOUNCED, NOT DOWNLOADABLE.** No `mtp*` / `nextn*` keys in config. Zero MTP tensors in the weight map. Paper: *“removed during evaluation and inference.”* JetBrains on the llama.cpp PR: *“Not yet, will need to implement it in transformers first.”* | config + [weight-map search](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Instruct/raw/main/model.safetensors.index.json) + [arXiv HTML §2.1.5](https://arxiv.org/html/2605.31268v1) + [PR #23966 comment](https://github.com/ggml-org/llama.cpp/pull/23966#issuecomment-4614049304) |

`architectures: ["MellumForCausalLM"]`, `model_type: "mellum"`.

---

## 2. LICENSE — Apache 2.0 on the WEIGHTS, commercial OK

| check | result | source |
|---|---|---|
| HF Hub license tag on the **weight repo** | `license: apache-2.0` in README YAML + `cardData.license` + tags | [Instruct README raw](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Instruct/raw/main/README.md), [HF API](https://huggingface.co/api/models/JetBrains/Mellum2-12B-A2.5B-Instruct) |
| LICENSE file next to safetensors | **Absent.** Siblings are 5× `model-0000x-of-00005.safetensors` + tokenizer + `config.json`. No `LICENSE` / `NOTICE`. | same API `siblings` |
| Paper / blogs | “Released under the Apache 2.0 license” on **checkpoints**, not just training code | [arXiv abstract](https://arxiv.org/abs/2605.31268), [JetBrains blog](https://blog.jetbrains.com/ai/2026/06/mellum2-goes-open-source-a-fast-model-for-ai-workflows/), [HF launch](https://huggingface.co/blog/JetBrains/mellum2-launch) |
| Official GGUFs | same “Released under the Apache 2.0 license.” | [Q4_K_M card](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Instruct-GGUF-Q4_K_M) |
| Extra RAIL / non-compete / research-only | **None found** | contrast Instella ResearchRAIL |
| Commercial use | **OK.** Apache 2.0 §2 copyright + §3 patent grant; reproduction, modification, distribution, sublicense, **commercial use**. Attribution + NOTICE preservation required. | <https://www.apache.org/licenses/LICENSE-2.0> |

**Caveat, not a veto:** the grant lives in Hub metadata and prose, not a committed LICENSE blob. That is sloppy provenance, not a different license. For a shipped product, copy `LICENSE-2.0.txt` into our tree and keep the Apache NOTICE.

Gated? **No.** `gated: false`.

---

## 3. General-purpose vs CODE-ONLY (the product question)

**Neither a general multilingual chat SKU nor a Seed-Coder-style code-only model.** Official positioning: a **focal software-engineering assistant** that also does English chat, routing, RAG, and sub-agents.

### What the vendors actually say

- Paper abstract: *“a **general-purpose** language model **specialized in software engineering**”* — successor to the completion-only 4B Mellum. <https://arxiv.org/abs/2605.31268>
- JetBrains blog (2026-06-01): *“Mellum began with code completion; now we’ve evolved it to handle both **natural language and code**.”* Role: routing, summarization, sub-agents, private SE deployments — a “focal model,” not a frontier chat replacement. <https://blog.jetbrains.com/ai/2026/06/mellum2-goes-open-source-a-fast-model-for-ai-workflows/>
- HF launch: *“trained from scratch on **natural language and code**”*; *“intentionally focused on text and code rather than multimodal.”* <https://huggingface.co/blog/JetBrains/mellum2-launch>
- Product FAQ (JetBrains Mellum page, search-indexed): *“Mellum2: General chat-interface usage in **English and all major programming languages**.”* <https://www.jetbrains.com/mellum/>
- HF card `language: ["en"]` only. Widget prompts are generic English chat (“interesting fact about the universe”).

### Instruction-tuned variants

**Yes, four of them**, all downloadable (table in §1). Ship **Instruct** for interactive chat (no `<think>`). Ship **Thinking** only if we want CoT (emits `<think>…</think>`; vLLM `--reasoning-parser qwen3`). Both have tool-calling (Hermes / `<tool_call>`). SFT checkpoints exist if we want to RL ourselves.

### Benchmarks — self-reported by JetBrains, **not third-party verified**

Sources: [Instruct card](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Instruct), [Thinking card](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Thinking). Values are percentages.

**Instruct (no-think) vs similarly sized open models:**

| area | bench | Mellum2 Instruct | Qwen3.5 4B | Qwen3.5 9B | note |
|---|---|---:|---:|---:|---|
| Code | LiveCodeBench v6 | 37.2 | **51.0** | **63.7** | trails Qwen3.5 badly |
| Code | EvalPlus (HE+/MBPP+) | **78.4** | 69.4 | 71.8 | wins |
| Code | MultiPL-E (7 *programming* langs) | 67.1 | 51.0 | 67.1 | ties 9B |
| Tools | BFCL v3 | 66.3 | 64.1 | **70.5** | usable |
| Math | AIME 25+26 | 41.7 | 38.3 | **58.3** | |
| Knowledge | MMLU-Redux | 78.1 | **87.5** | **91.1** | not a knowledge model |
| Knowledge | GPQA Diamond | 40.9 | **76.8** | **79.8** | crushed |
| Chat | IFEval | 75.8 | **82.1** | **83.9** | |
| Chat | MixEval | 62.2 | 65.9 | **71.1** | |

**Thinking** lifts code/math/knowledge a lot (LCB 69.9, AIME 58.4, MMLU-Redux 86.2, GPQA 57.6) and is the one that looks “4B-class reasoner.” That is the wrong SKU for interactive 10 tok/s (CoT tokens are wall-clock).

Seed-Coder 8B on the same Instruct table: MMLU-Redux **38.1**, MixEval 37.2. Mellum2 is **not** in that code-only bucket.

### Multilingual (IT / ES / FR / ZH)

**No published number. Official claim is English-only for chat.**

- Pretrain mentions *“multilingual reasoning and QA datasets”* with **no language list and no MGSM / MMMLU / MMLU-ProX / EuroEval scores.** [arXiv §3.1.2](https://arxiv.org/html/2605.31268v1)
- MultiPL-E here is **C++/Java/PHP/TS/C#/Shell/JS**, not natural languages. [Instruct card notes](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Instruct)
- benchlm.ai lists Instruct multilingual as **“Not measured / 0 benchmarks.”** <https://benchlm.ai/models/mellum2-12b-a2-5b-instruct>
- Tokenizer is the Mellum-4B 98,304-piece vocab, *“designed to provide strong coverage of **programming language tokens** and technical terminology”* — not a 150k multilingual SPM. [arXiv §3.1.4](https://arxiv.org/html/2605.31268v1)
- Mellum-1 (2025-04) was marketed as a “fast, multilingual” **code** model; that adjective does **not** reappear as a measured claim for Mellum2. <https://blog.jetbrains.com/ai/2025/04/mellum-goes-open-source-a-purpose-built-llm-for-developers-now-on-hugging-face/>

**Product implication:** if IT/ES/FR/ZH conversational quality is a ship gate, Mellum2 is a **fail-fast**, not a tuning exercise. English SE-assistant + code is what they built.

---

## 4. Architecture for our stack

Primary: [config.json](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Instruct/raw/main/config.json) + [arXiv §2.2](https://arxiv.org/html/2605.31268v1) + [llama.cpp `mellum.cpp`](https://github.com/ggml-org/llama.cpp/blob/master/src/models/mellum.cpp).

| quantity | value | note |
|---|---|---|
| HF arch / `model_type` | `MellumForCausalLM` / `mellum` | new class, Qwen3-MoE recipe + SWA |
| GGUF arch | `mellum` | `LLM_TYPE_12B_A2_5B` when `n_layer==28` |
| layers | **28**, **all sparse** (`mlp_layer_types` = 28× `"sparse"`) | no dense FFN layers |
| hidden | **2304** | |
| `intermediate_size` | 7168 | **unused at inference** (leftover dense-FFN field) |
| expert FFN dim | **`moe_intermediate_size` = 896** | SwiGLU, 3 mats |
| routed experts | **64** | |
| k | **8** (top-8, softmax, `norm_topk_prob: true`) | **higher than our Cala k=6 runtime** |
| shared expert | **none** | paper: *“no shared expert”*; no `shared_expert*` tensors; llama.cpp graph has only `ffn_{gate,up,down}_exps` |
| attention | **GQA 32Q / 4KV**, `head_dim=128`, **QK-Norm** | not MLA, not GDN, not SSM |
| SWA | **3:1**, window **1024** | layers `3,7,11,15,19,23,27` full; rest sliding |
| RoPE | θ=500000; **YaRN only on full-attn layers** (`factor=16`, orig 8192) | sliding layers keep default RoPE |
| context | **131,072** (trained 8,192 → YaRN 128K) | |
| vocab | **98,304**, **untied** embed/lm_head | |
| activation | SiLU / SwiGLU | |
| extras | FIM trained (50/50 PSM/SPM); no vision | paper §3.2.2 |

**Expert size (the number our math needs):**

```
params_per_routed_expert = 3 × 2304 × 896 = 6,193,152
```

**Per-token routed expert params (k=8, 28 MoE layers):**

```
28 × 8 × 6,193,152 = 1,387,266,048   (~1.387B)
```

Always-hot (decode reads every token): attn 28×(Q+K+V+O+qk_norm) ≈ 595M + router 4.1M + layernorms + **untied LM-head 98,304×2304 = 226.5M**. Input embed is one row. Paper “2.5B active” ≈ these + routed experts.

KV cache is cheap: 4 KV heads × 128 × 28 layers. With SWA, 21/28 layers cap at 1024. At f16:

- SWA body: `21 × 2 × 4 × 128 × 2 × 1024 ≈ 44 MiB` (capped)
- Full layers @ 4k ctx: `7 × 2 × 4 × 128 × 2 × 4096 ≈ 56 MiB`
- Full layers @ 32k: ≈ 448 MiB

This is **not** a CalaQwen-class KV problem.

### MTP structure (paper only)

Paper §2.1.5 / §2.2: **one extra transformer layer**, predicts **one** future token, aux loss `α=0.1`. Used as a speculative-decoding **draft** in the narrative; **stripped at eval/inference**. SFT *kept* the head (`MTP head: Retained, α=0.1` in Table 6) — then the **released** Instruct/Thinking/Base weight maps have **no MTP tensors**. So even the SFT “retained” head did not ship.

llama.cpp `mellum.cpp` (225 lines): embed → 28× (RMS → GQA+QK-norm+RoPE/YaRN → residual → RMS → softmax MoE SwiGLU) → RMS → untied lm_head. **No MTP graph, no next-n head, no draft tensors.**

Our Qwen3.6 MTP machinery does **not** attach. There is nothing to attach to.

---

## 5. llama.cpp support + GGUFs

| item | status | source |
|---|---|---|
| Upstream arch | **Merged 2026-06-02**, PR [#23966](https://github.com/ggml-org/llama.cpp/pull/23966) (`model: add Mellum architecture`) | master `src/models/mellum.cpp` |
| Converter | `mellum.py` in the same PR | |
| MTP in llama.cpp | **No.** Author-adjacent JetBrains comment: *“Not yet… on the roadmap.”* | [comment](https://github.com/ggml-org/llama.cpp/pull/23966#issuecomment-4614049304) |
| Official GGUF | **Yes**, JetBrains, 2026-06-04 | [collection](https://huggingface.co/collections/JetBrains/mellum2-gguf) |
| Community GGUF | bartowski imatrix (b9590), mradermacher Base | [bartowski Instruct](https://huggingface.co/bartowski/Mellum2-12B-A2.5B-Instruct-GGUF), [bartowski Thinking](https://huggingface.co/bartowski/Mellum2-12B-A2.5B-Thinking-GGUF), [mradermacher Base](https://huggingface.co/mradermacher/Mellum2-12B-A2.5B-Base-GGUF) |
| vLLM | first-party serve snippets, Hermes tools, qwen3 reasoning parser | Instruct / Thinking cards |
| Ollama | `ollama run hf.co/JetBrains/Mellum2-12B-A2.5B-Instruct-GGUF-Q4_K_M` | official Q4 card |

**Official JetBrains GGUF sizes** ([Q4 card table](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Instruct-GGUF-Q4_K_M); they also publish KLD vs BF16 on Wikitext-2):

| quant | size | KLD vs BF16 | top-token match |
|---|---:|---:|---:|
| BF16 | 24.3 GB | — | — |
| Q8_0 | 12.9 GB | 0.016 | 95.2% |
| Q6_K | 10.9 GB | 0.038 | 92.9% |
| **Q4_K_M** | **8.1 GB** (file 8.07 GB) | 0.106 | 87.2% |
| MXFP4_MOE | **7.0 GB** | 0.166 | 84.2% |

**bartowski Instruct** (imatrix; useful as a file-size ladder, not as our KEXP recipe): IQ2_XS **4.81 GB**, Q2_K 5.16, Q3_K_M 6.18, Q4_K_M 8.17. <https://huggingface.co/bartowski/Mellum2-12B-A2.5B-Instruct-GGUF>

Distance from a supported arch: **zero for greedy decode.** This is not Instella (FarSkip) or Lightning (Mamba-2). It is a Qwen3-MoE cousin with SWA + QK-norm already in tree. Our fork still needs the `mellum` arch wired into expert-stream / k/drop / KEXP (new `LLM_ARCH`, not a convert-script afternoon — but a **small** graph vs GDN/SSM).

Community note: tool-call parse flakes on Thinking until official GGUFs + `--tools all` ([PR thread](https://github.com/ggml-org/llama.cpp/pull/23966), JetBrains `@Ar4l` 2026-06-05). Instruct is the lower-risk SKU.

---

## 6. Our math (S23)

Assumptions, same as `newmoe-recon`:

1. Expert FFN is SwiGLU, 3 mats, no latent compression.
2. No shared expert, no dense FFN layers. Always-hot = attn + router + norms + LM-head.
3. KEXP = experts **2.5–3.0 bpw** (use **2.75** mid), dense stays **~4.5 bpw** (Q4_K-class).
4. Vanilla Q4 = **~4.5 bpw** on experts *and* dense.
5. CalaQwen geometry: 40 MoE layers, k_runtime=6, expert `3×2048×512 = 3,145,728`.
6. Measured CalaQwen **30.7 MiB/tok** is **post-machinery** (cache + k6d065 + KEXP). Scale it by the **routed-expert-param ratio**.
7. S23 streaming realizes **~454 MiB/s** (Marco), not 20 GB/s DRAM.
8. If a KEXP file **fits and stays resident** in 8 GB with OS+KV, the regime flips from streaming toward DRAM GEMM.

### Geometry

| | CalaQwen k=6 | Mellum2 k=8 | Mellum2 k=6 drop |
|---|---:|---:|---:|
| expert params / tok | 40×6×3.146M = **755M** | 28×8×6.193M = **1,387M** | 28×6×6.193M = **1,040M** |
| ratio vs Cala routed | 1.00× | **1.84×** | **1.38×** |
| Q4 4.5 bpw expert traffic | 425 MB | 780 MB | 585 MB |
| KEXP 2.75 bpw expert traffic | 260 MB | 477 MB | 358 MB |

**File-size estimate (KEXP, geometry — not a bartowski Q2):**

```
routed expert store = 28 × 64 × 6,193,152 = 11,098,144,768 params   (91.3% of 12.15B)
always-hot          ≈ 12.150B − 11.098B     = 1.052B

KEXP-Q2 (2.5 bpw ex + 4.5 dense) ≈ 11.098×2.5/8 + 1.052×4.5/8 = 3.47 + 0.59 = 4.06 GB
KEXP mid  (2.75 bpw)             ≈ 3.82 + 0.59                               = 4.41 GB
KEXP-Q3 (3.0 bpw ex + 4.5 dense) ≈ 4.16 + 0.59                               = 4.75 GB
Vanilla Q4_K_M (measured official)                                          = 8.07 GB
MXFP4_MOE (official)                                                        = 7.0  GB
```

bartowski Q2_K 5.16 GB is the whole model at ~3.4 bpw (dense crushed too). Our KEXP should land **~4.1–4.8 GB**, between IQ2_XS and Q3_K_S.

### Cache fraction at 2000 MB

```
expert tensors = 28 × 64 = 1,792          (Cala: 256×40 = 10,240; Instella: 1,664)
per-expert KEXP 2.75 bpw ≈ 2.13 MB
expert store KEXP        ≈ 3,817 MB  →  2000/3817 = 52%
expert store Q4 4.5 bpw  ≈ 6,240 MB  →  2000/6240 = 32%
```

Per-token working set at k=8: **224** expert slots × 2.13 MB ≈ **477 MB** of experts, plus ~0.6 GB dense. A 2 GB cache holds ~938 experts (52% of the pool). **Fewer tensors than Cala (5.7×) ⇒ hit should beat Cala’s 80.7% and sit near/above Marco’s 53%.** That cuts flash misses; it does **not** shrink the “bytes touched” counter if that counter is GEMM traffic.

### Scaled MiB/tok (streaming)

```
Mellum2 KEXP k=8  ≈ 30.7 × 1.84 ≈ 56.4 MiB/tok
Mellum2 Q4   k=8  ≈ 56.4 × (4.5/2.75) ≈ 92 MiB/tok
Mellum2 KEXP k=6  ≈ 30.7 × 1.38 ≈ 42.3 MiB/tok
```

### Projected S23 decode

| variant | expected MiB/tok | BW-scaled from Marco (454 MiB/s) | compute note | honest band |
|---|---:|---:|---|---|
| KEXP stream k=8 | ~56 | **8.0 t/s** | no GDN, SWA, 4 KV — compute ceiling ≫ Cala 5.7 | **7.5–8.8 t/s** |
| Q4 stream k=8 | ~92 | 4.9 t/s | more I/O, same compute | **4.5–6 t/s** |
| KEXP stream k=6 drop | ~42 | **10.7 t/s** | 25% less expert GEMM than k=8 | **9.5–11.5 t/s if quality holds** |
| KEXP **RAM-resident** | ~56 touched but from DRAM | n/a (454 MiB/s model does not apply) | 2.44B × 2.75/8 ≈ 0.84 GB/tok; even 8 GB/s DRAM ⇒ ~10 t/s | **12–20 t/s on 12 GB; S23 8 GB only if it actually stays resident** |

**k=8 streaming does not clear 10 tok/s** on the Marco calibration. The 2.5B-active marketing number hides a **wide, shallow** MoE (896 FFN × 8-of-64) that moves more expert bytes than CalaQwen’s skinny 512-wide k=6.

### RAM-resident on 8 GB / 12 GB phones

| device | physical | KEXP 4.4 GB resident? | Q4 8.1 GB resident? |
|---|---|---|---|
| **Galaxy S23 (the 10 t/s target)** | **8 GB** | **Knife-edge / likely no.** One UI always-on is smaller than HyperOS, but 4.4 GB model + KV (~0.1–0.2 GB @ 4k with SWA) + our process + 3–3.5 GB system ≈ the whole machine. One major-fault storm and we are back to streaming. | **No.** |
| Xiaomi 14-class | 12 GB | **Yes**, comfortable (~6 GB `MemAvailable` observed on HyperOS still leaves headroom for 4.4 GB + KV; disable Memory Extension so the dense region is not writeback-evicted — see `hyperos-ram-recon`) | Tight. 8.1 GB + system will swap. |
| Any 8 GB Android | 8 GB | Treat as **streaming-only** unless a `MemAvailable` probe after load shows ≥1 GB slack | No |

S23 already **streams** a 12.5 GiB CalaQwen mmap “fine” (`hyperos-ram-recon`: *“Control: Samsung S23, 8 GB physical, same config, fine”*). Mellum2’s smaller file helps **first-touch and cache**, not the per-token byte tax.

**Do not sell “12B total on 8 GB phones” as RAM-resident.** Sell it as a streamed 2.5B-active MoE whose file happens to be 4–8 GB.

---

## 7. MTP head — announced vs usable

| question | answer | source |
|---|---|---|
| What did they train? | 1 extra transformer layer, 1-token lookahead, `α=0.1`. Ablation on a **14B** MoE / 105B tokens: HumanEval +10.4, MMLU +3.6 (quality, not speed). | [arXiv §2.1.5](https://arxiv.org/html/2605.31268v1) |
| Published acceptance / spec-dec speedup? | **None.** §6 inference numbers are **vLLM FP8 on 1×H100 without MTP**: 192 tok/s sync vs Qwen2.5-7B 193; 5,179 tok/s throughput (+21%). | [arXiv §6 / §7](https://arxiv.org/html/2605.31268v1) |
| In released weights? | **No** (config + weight map + llama.cpp loader). | §1, §4 |
| Survive quantization? | N/A — nothing to quantize. If they later ship the layer, a single extra MoE layer would KEXP like the others; 1-token drafts are usually robust to Q4, but that is speculation. | — |
| llama.cpp / our fork? | **Cannot exploit today.** PR author: implement in transformers first. Our Qwen3.6 MTP path has no `mellum` tensors to bind. | [PR #23966](https://github.com/ggml-org/llama.cpp/pull/23966#issuecomment-4614049304) |

### Does 2.5B-active change the CPU-sequential economics vs the killed 35B MTP path?

**No.** The 35B MTP kill was sequential draft-then-verify on CPU, not “the model is big.” Mellum2’s MTP is **one** extra layer (~1/28 ≈ 3.6% extra compute) proposing **one** token. Relative overhead is scale-invariant. Absolute decode is cheaper, so a 1.2–1.4× GPU-style spec-dec win would be nice **if the head shipped and verify could fuse** — but:

- 1-token MTP theoretical max is 2× at 100% accept; realistic 1.3–1.6× on GPU.
- On our expert-stream CPU path the MTP layer is **another 8-expert I/O** per speculated token. That is the same class of sequential tax that killed 35B MTP.
- Smaller active set does **not** flip the ratio; it just makes both the main pass and the draft pass faster by the same factor.

**Do not put MTP in the 10 tok/s plan.** If JetBrains later publishes an MTP-enabled checkpoint, re-open then.

---

## 8. Verdict

### MAYBE

Closer to a shippable Apache on-device MoE than anything in the Instella/Lightning recon: **license is real, llama.cpp is merged, GGUFs exist, graph is boring (good), no GDN, no shared expert, SWA + 4 KV is phone-friendly, 2.5B active is real.**

It fails the naive “2.5B active ⇒ 10 tok/s” slogan on two independent gates:

1. **Product / languages.** Official chat support is **English + programming languages**. No IT/ES/FR/ZH number exists. If those languages are a ship requirement, this is the wrong model regardless of speed.
2. **S23 decode math.** Trained **k=8** ⇒ ~56 MiB/tok KEXP streamed ⇒ **~8 t/s** on the Marco 454 MiB/s band. 8 GB S23 will not reliably RAM-resident 4.4 GB. Clearing 10 t/s needs **k-drop 8→6 (unproven quality)** or **12 GB DRAM-resident**.

MTP is a paper/training footnote, not an accelerator we can turn on.

### Blocking issue

**Pick one, either is sufficient to kill:**

- If the SKU must speak IT/ES/FR/ZH: **blocking issue = no multilingual claim or eval; official FAQ is English-only.**
- If the SKU is English SE-assistant and 10 t/s is the gate: **blocking issue = k=8 streamed bytes do not project to 10 t/s on S23 8 GB.**

### First fail-fast (cheap, sequential)

1. **Languages, 30 prompts, same day.** Instruct Q4_K_M, greedy, IT/ES/FR/ZH/EN (chat + a short code-explain). Compare to Marco1c. If Italian/Spanish collapse or code-switch into English, **stop** — product veto, no kernel work.
2. **S23 decode, next.** Official [Instruct Q4_K_M 8.07 GB](https://huggingface.co/JetBrains/Mellum2-12B-A2.5B-Instruct-GGUF-Q4_K_M) or bartowski Q3_K_M 6.18 GB through our expert-stream + k/drop at 2k ctx, k=8.  
   - If **< 7.5 t/s**: the 10 t/s thesis is dead even before KEXP.  
   - If **≥ 8 t/s**: immediately A/B **k=8 vs k=6** on a 50-prompt code+chat set. k=6 is the only streaming path that projects through 10 t/s.  
3. **Only if (2) is alive:** KEXP-requant experts to 2.5–3.0 bpw, remeasure, and probe `MemAvailable` after `mlock` of the 4.4 GB file on S23. Residency is a bonus, not the plan.

Do **not** start an MTP port. Do **not** pick Thinking as the interactive SKU.

### What would upgrade this to CANDIDATE_STRONG

- Language smoke is “usable” on IT/ES/FR (ZH optional), **and**
- S23 KEXP k=8 ≥ 8 t/s **and** k=6 drop holds quality, **or** S23 actually keeps 4.4 GB resident without major faults.

Until both are measured, treat Mellum2 as a **legal, well-supported, English-leaning SE MoE that is in the Marco speed class, not above it.**

DONE
