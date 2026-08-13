# Ling 3.0 Tiny vs LFM2.5-8B-A1B — G99 free-tier recon

**Date:** 2026-08-13
**Verdict:** `NOT_BETTER`
**Single blocking issue:** `bailingmoe3` is not in shipping llama.cpp (PR [#26608](https://github.com/ggml-org/llama.cpp/pull/26608) still **OPEN**). The model cannot enter our factory (gguf-dump / PC smoke / Jelly cells) on the tree we ship.
**First fail-fast:** after (or instead of) a merge, download the smallest community GGUF, build the `bailingmoe3-support` fork, `gguf-dump` verify arch, PC smoke with `enable_thinking=false`, count output tokens on a 10-prompt chat set. Do **not** pull a 4.82 GB Q4 onto Jelly until that smoke says think-OFF is short.

Announced ≠ downloadable is called out in place. Every load-bearing claim has a URL.

---

## 1. Identity and geometry (config.json raw over marketing)

**Exact HF repos (downloadable today)**

| Role | Repo | What it is |
|---|---|---|
| Official BF16 weights | [inclusionAI/Ling-3.0-tiny](https://huggingface.co/inclusionAI/Ling-3.0-tiny) | Single hybrid-reasoning checkpoint. Created **2026-08-10** (`createdAt` 2026-08-10T02:44:06Z via [HF API](https://huggingface.co/api/models/inclusionAI/Ling-3.0-tiny)). |
| Official FP8 | [inclusionAI/Ling-3.0-tiny-fp8](https://huggingface.co/inclusionAI/Ling-3.0-tiny-fp8) | Same arch, quantized safetensors. |
| Official INT4 | [inclusionAI/Ling-3.0-tiny-int4](https://huggingface.co/inclusionAI/Ling-3.0-tiny-int4) | `compressed-tensors` pack-quantized Linear; **attention + shared/dense FFN left in BF16**. File store **5.82 GB**. Not a GGUF. |
| Official collection | [inclusionAI/ling-30](https://huggingface.co/collections/inclusionAI/ling-30) | Tiny + Flash family only. **No base / instruct / thinking split** for Tiny. One checkpoint, hybrid think on/off. |
| Community GGUF (PR author) | [bloomer010/Ling-3.0-tiny-GGUF](https://huggingface.co/bloomer010/Ling-3.0-tiny-GGUF) | `bailingmoe3` GGUF. Q4_K_M **4.82 GB**. Requires the unmerged fork. |
| Other community GGUF | [WhiskyAKM/Ling-3.0-Tiny-GGUF](https://huggingface.co/WhiskyAKM/Ling-3.0-Tiny-GGUF), [NANI-Nithin/Ling-3.0-tiny-GGUF](https://huggingface.co/NANI-Nithin/Ling-3.0-tiny-GGUF) | Same caveat. |

API listing (OpenRouter) went up **2026-08-06** ([openrouter.ai/inclusionai/ling-3.0-tiny](https://openrouter.ai/inclusionai/ling-3.0-tiny); AA FAQ says the same). Weights on HF are **2026-08-10**. AA page: [artificialanalysis.ai/models/ling-3-0-tiny](https://artificialanalysis.ai/models/ling-3-0-tiny).

**No official GGUF.** Smallest official download is the INT4 safetensors at 5.82 GB, useless to our llama.cpp factory.

**config.json raw** ([huggingface.co/inclusionAI/Ling-3.0-tiny/raw/main/config.json](https://huggingface.co/inclusionAI/Ling-3.0-tiny/raw/main/config.json)):

| Field | Value |
|---|---|
| `architectures` | `BailingMoeV3ForCausalLM` |
| `model_type` | `bailing_hybrid` (HF card tag). GGUF name in the open PR: **`bailingmoe3`**, not `bailingmoe` / `bailingmoe2`. |
| `auto_map` | `configuration_bailing_moe_v3.BailingMoeV3Config` / `modeling_bailing_moe_v3.BailingMoeV3ForCausalLM` |
| Total params (safetensors census, not marketing) | **7,893,392,800** (7.893B). BF16 7,893,352,704 + F32 40,096. Store 15.80 GB. [HF API](https://huggingface.co/api/models/inclusionAI/Ling-3.0-tiny) |
| Published active | **1.3B** (card). Reconstructed decode-active without input embed ≈ **1.14B** (see §7). |
| `num_experts` / `num_experts_per_tok` | **128 routed / k = 8** |
| `num_shared_experts` | **1** (`moe_shared_expert_intermediate_size`: 512) |
| Expert FFN dim | `moe_intermediate_size`: **512** (SwiGLU) |
| Dense FFN dim | `intermediate_size`: **4608**; `first_k_dense_replace`: **1** → 1 dense + 23 MoE |
| Layers | `num_hidden_layers`: **24**; `layer_group_size`: 4 |
| Attention | Hybrid **3:1 KDA : MLA** (18 Kimi Delta Attention + 6 Multi-head Latent Attention). Card: [Ling-3.0-tiny](https://huggingface.co/inclusionAI/Ling-3.0-tiny). Tiny-specific: `q_lora_rank`: **256**, `kv_lora_rank`: **512** (Flash has no Q-LoRA — this is why Tiny needs an extra path in PR 26608). |
| Heads | `num_attention_heads` 16, `num_key_value_heads` 16, `head_dim` 128, `qk_rope_head_dim` 64, `qk_nope_head_dim` 128 |
| Hidden | `hidden_size`: **1536** |
| Context (native) | `max_position_embeddings`: **131072**. **Not 262K.** 262144 is a **YaRN override** (`factor: 2.0`, `original_max_position_embeddings: 131072`) in the SGLang launch line on the card. |
| Vocab | `vocab_size`: **157184**; `tie_word_embeddings`: **false** |
| MTP | `num_nextn_predict_layers`: **0** (no bundled next-n / MTP on Tiny; Flash has 1) |
| Router | sigmoid, `topk_method`: `noaux_tc`, `n_group`: 8, `topk_group`: 4, `routed_scaling_factor`: 2.5 |

**Variants:** one Tiny instruct/hybrid checkpoint. No separate base, no separate thinking weights. Flash is a different size class (124B / 5.1B).

---

## 2. LICENSE

- HF YAML frontmatter and `cardData.license`: **`mit`**. [README.md](https://huggingface.co/inclusionAI/Ling-3.0-tiny/raw/main/README.md), [HF API](https://huggingface.co/api/models/inclusionAI/Ling-3.0-tiny).
- **No `LICENSE` file** in the weights tree ([file list](https://huggingface.co/inclusionAI/Ling-3.0-tiny/tree/main)). MIT is declared on the card that hosts the safetensors, which is how HF binds a license to weights, but it is metadata, not a copy of the MIT text in-repo.
- Community GGUF `bloomer010/Ling-3.0-tiny-GGUF` also tags MIT (derived).
- Contrast: LFM2.5-8B-A1B is **LFM 1.0**, not MIT ([Liquid card](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B)).

Treat Tiny weights as MIT-on-the-card, commercially usable. If legal wants a LICENSE blob in the file, it is not there.

---

## 3. Thinking / verbosity — the mobile kill question

### What is KNOWN

Thinking is **hybrid and switchable**, Qwen-style, **default ON**.

Chat template ([chat_template.jinja](https://huggingface.co/inclusionAI/Ling-3.0-tiny/raw/main/chat_template.jinja)):

- `enable_thinking` true → `thinking_option = 'on'` → generation prompt ends with `\n<think>`
- `enable_thinking` false → `thinking_option = 'off'` → generation prompt ends with `\n<think></think>` (empty think block, then the answer)
- If neither is passed, **default is `on`**
- Alternate spelling: `detailed thinking on/off` in the system string

Official card, SGLang client: disable per request with `"chat_template_kwargs": {"enable_thinking": false}`. [Ling-3.0-tiny](https://huggingface.co/inclusionAI/Ling-3.0-tiny).

AA measured the **think-ON** model:

- Intelligence Index **25** (v4.1.1), Agentic Index **16**. [AA model page](https://artificialanalysis.ai/models/ling-3-0-tiny); vendor card repeats this.
- **51k output tokens per Intelligence Index task**: **32k reasoning + 19k answer**. [AA tweet 2026-08-12](https://x.com/ArtificialAnlys/status/2087371372683243750) (chart saved as `aa-tokens.jpg` in this dir). That is ~65% above Qwen3.6-35B-A3B / Nemotron 3.5 Lightning (~31k).
- Whole-suite verbosity: **210M** output tokens vs median **42M** in its open-weights size class. [AA page](https://artificialanalysis.ai/models/ling-3-0-tiny).

Vendor eval table is labeled **Ling-3.0-tiny (Thinking)** — image on the [model card](https://huggingface.co/inclusionAI/Ling-3.0-tiny), saved here as `vendor-eval.png`:

| Bench | Ling-3.0-tiny (Thinking) |
|---|---:|
| GDPval v2-AA (Elo) | 772.00 |
| TAU3-Banking-AA | 20.80 |
| BFCL-v4 (FC) | 62.72 |
| Terminal-Bench 2.1 | 27.70 |
| ArtifactsBench | 47.93 |
| SciCode | 24.20 |
| AA-LCR | 58.70 |
| AA-Omniscience acc / non-halluc | 8.52 / 69.54 |
| GPQA Diamond | 73.40 |
| HLE | 9.30 |
| HMMT-Feb26 | 70.31 |
| IMO-AnswerBench | 71.03 |
| IFBench / LIFEBench / Multi-IF | 63.61 / 62.30 / 83.15 |

AA's independent breakdown (chart `aa-breakdown.jpg`, [tweet thread](https://x.com/ArtificialAnlys/status/2087371367884956099)) agrees in the large: τ³-Banking 21, Terminal-Bench ~29, SciCode 24, HLE 9, GPQA 73, CritPt **0**, Omniscience acc **9** (last in the panel), non-halluc **70** (first), AA-LCR 59, GDPval Elo 772. Knowledge accuracy is weak; the Omniscience *index* (−19) is rescued by refusing 63% of questions.

### What is UNKNOWN (this is the kill)

**No think-OFF / Instant-mode eval numbers exist.** Searched: official card, AA page + AA tweets, OpenRouter, vendor table (every column is Thinking), Reddit, secondary blogs. Nothing publishes GPQA / IFBench / AA-II / token-per-task at `enable_thinking=false`.

On a 15 t/s phone:

- 51k tokens/task → **57 minutes** of decode per AA-class item.
- Even a “short” 2k-token think at 12 t/s → **167 s to first answer token**.
- 19k *answer* tokens alone, ignoring reasoning → 21 minutes.

LFM2.5-8B-A1B is **reasoning-only** (no off switch) — [Liquid blog](https://www.liquid.ai/blog/lfm2-5-8b-a1b) — so it is also chatty. We do **not** have an AA token-per-task for LFM2.5 (AA verbosity is N/A; II is an estimate). The difference that matters for the lane: Ling **can** be switched off, but we have **zero evidence** the off mode is a usable 8B-class chat model rather than a collapsed student. Until a think-OFF smoke counts tokens and a cheap quality probe (IF/PPL/our multi5) lands, **think-ON verbosity is a kill criterion for G99 chat UX**, and think-OFF quality is an open fail-fast, not a reason to replace LFM.

---

## 4. llama.cpp / GGUF

| Item | Status | URL |
|---|---|---|
| Arch in GGUF | **`bailingmoe3`** (new). Not `bailingmoe` (Ling 2.x) and not a silent reuse of `bailingmoe2`. | PR [#26608](https://github.com/ggml-org/llama.cpp/pull/26608) |
| Upstream | **OPEN, not merged.** `state: open`, `merged: false`, `mergeable_state: unstable`, last update 2026-08-13T13:35:28Z, 11 commits / +944 −12 / 18 files. Reviewers requested: ggerganov, JohannesGaessler. Checked via [GitHub API](https://api.github.com/repos/ggml-org/llama.cpp/pulls/26608) on 2026-08-13. | |
| Tiny-specific extra | Q-LoRA path (`q_a_proj → q_a_layernorm → q_b_proj`, rank 256). Flash projects Q directly. Conversion of Tiny failed until commit `517b467` on that PR. | same PR |
| Official runtime | SGLang image `lmsysorg/sglang:dev-Ling-3.0-tiny`; InclusionAI vLLM fork `inclusionAI/vllm-ling-v3` branch `ling_3_0`. Ollama: [PR #17643](https://github.com/ollama/ollama/pull/17643), **MLX / Apple Silicon only**, not in a release. | [card](https://huggingface.co/inclusionAI/Ling-3.0-tiny) |
| Official GGUF | **None.** | |
| Community GGUF | bloomer010 (PR author): BF16 15.8 GB, Q8_0 8.41, Q6_K 6.50, Q5_K_M 5.64, **Q4_K_M 4.82**, MXFP4_MOE 4.72, Q3_K_M 3.84, IQ2_M 2.70, Q1_0 1.30. Card says stock llama.cpp **will not load**. | [bloomer010/Ling-3.0-tiny-GGUF](https://huggingface.co/bloomer010/Ling-3.0-tiny-GGUF) |
| Android / G99 / Vulkan | Unproven. Flash testers on the same PR reported Vulkan freezes, ROCm start hangs, MTP issues (Tiny has no MTP). KDA is a new recurrent op for our tree. | PR comments on [#26608](https://github.com/ggml-org/llama.cpp/pull/26608) |

**Factory implication:** our `bmoe-cli --list-archs` / on-device binary do not know `bailingmoe3`. This is a hard stop, not a “download and bench” item.

LFM2.5 contrast: day-one llama.cpp, official [LiquidAI/LFM2.5-8B-A1B-GGUF](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF), already measured on Jelly.

---

## 5. Multilingual (IT / ES / FR)

**Ling-3.0-tiny: no primary-source language list.** The official card, Flash card, collection, and AA page do not claim IT/ES/FR. Vocab 157184 is consistent with a ZH/EN-heavy Ant tokenizer (same vocab as Flash) but that is not evidence of Romance-language quality.

Flash reports [SWE-Bench Multilingual 72.4](https://huggingface.co/inclusionAI/Ling-3.0-flash) — that is *programming* languages, not Italian/Spanish/French chat.

**LFM2.5-8B-A1B: explicit.** Card languages: English, Arabic, Chinese, French, German, Italian, Japanese, Korean, Portuguese, Spanish. [LiquidAI/LFM2.5-8B-A1B](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B). Tokenizer was expanded 65K→128K specifically for non-Latin scripts ([blog](https://www.liquid.ai/blog/lfm2-5-8b-a1b)).

For a free tier that serves IT/ES/FR, LFM is the documented option. Ling is an untested ZH/EN-first bet.

---

## 6. Quality vs LFM2.5-8B-A1B

Same-index number everyone will quote:

| | Ling-3.0-tiny | LFM2.5-8B-A1B |
|---|---:|---:|
| AA Intelligence Index | **25** (full, think-ON) | **8** (**estimate**, “independent evaluation forthcoming”) |
| AA Agentic Index | 16 | — |
| AA page | [ling-3-0-tiny](https://artificialanalysis.ai/models/ling-3-0-tiny) | [lfm2-5-8b-a1b](https://artificialanalysis.ai/models/lfm2-5-8b-a1b) |

**Comparability flag — do not treat 25 vs 8 as a clean win.**

- Ling's 25 is think-ON at 51k tokens/task.
- LFM's 8 is an AA *estimate*; verbosity and per-eval bars are not published yet.
- Both are reasoning models. LFM is **reasoning-only** ([blog](https://www.liquid.ai/blog/lfm2-5-8b-a1b)). Ling is hybrid, but every published number is the ON setting.

Shared benches that actually exist today (different harnesses; treat as class, not a delta we would ship on):

| Bench | Ling (Thinking, vendor table) | LFM2.5 (Liquid first-party) | Sources |
|---|---:|---:|---|
| AA-Omniscience index | −19 (AA) | −24.70 | [AA tweet](https://x.com/ArtificialAnlys/status/2087371367884956099), [LFM card](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B) |
| AA-Omniscience acc | 8.52 / ~9 | 8.67 | vendor table + Liquid |
| AA-Omniscience non-halluc | 69.54 / ~70 | 63.47 | same |
| IFBench | 63.61 | 56.47 | vendor table + Liquid |
| Multi-IF | 83.15 | 79.93 | same |
| BFCL-v4 | 62.72 | 48.50–49.73 | vendor table + Liquid (two Liquid tables disagree by ~1 pt) |

Honest class read: on *think-ON agent/IF/FC* numbers Ling looks like a stronger 8B-total MoE than LFM, and it sits next to Qwen3.5-4B/9B-Thinking on the vendor grid (beats them on TAU3-Banking 20.8 vs 6.8/7.0; trails them on GPQA 73.4 vs 77.1/80.6 and on Omniscience accuracy). Knowledge is not a reason to take it. Instruction-following / tool-use might be. None of this is measured in our PPL/multi5 gates, and none of it is think-OFF.

LFM's published strength is on-device IF + tool loop with official llama.cpp, not the AA headline.

---

## 7. Our math

### 7.1 Geometry → params

From §1 config, SwiGLU = 3 × hidden × intermediate.

| Piece | Params |
|---|---:|
| One routed/shared expert | 3 × 1536 × 512 = **2,359,296** |
| 23 layers × 128 routed | **6,945,767,424** |
| 23 × 1 shared | **54,263,808** |
| 23 routers (1536 × 128) | **4,521,984** |
| Layer-0 dense FFN | 3 × 1536 × 4608 = **21,233,664** |
| Embed + untied lm_head | 2 × 157184 × 1536 = **482,869,248** |
| Residual (attn + norms + other) | 7.893B − 7.005B experts − 0.021B dense − 0.483B embed/head ≈ **0.385B** |
| HF census total | **7.893B** |

Decode-active (no input embed):

- FFN: 23 × 9 × 2.359M + 21.2M = **0.510B**
- Attn + norms: **0.385B**
- lm_head: **0.241B**
- **Sum ≈ 1.14B** (published 1.3B includes embed and/or rounding)

Always-on decode (attn + lm_head + dense FFN + norms/router) ≈ **0.65B**.
Expert-active (8 routed + 1 shared × 23) ≈ **0.49B**.

**KEXP leverage is weaker than on LFM.** Experts are ~43% of Ling decode-active vs ~70% on LFM2.5 (LFM active FFN ≈ 1.06B of 1.5B). Cutting expert bpw helps LFM more than Ling.

### 7.2 Bytes / token and file sizes

Q4_K_M community file: **4.82 GB** ([bloomer010](https://huggingface.co/bloomer010/Ling-3.0-tiny-GGUF)).
4.82e9 B / 7.893e9 params = **4.89 bpw** average.

LFM2.5 official Q4_K_M: 5,155,564,768 B ([our G99 report](../g99-freetier/report.md)) / 8.3B = **4.97 bpw**.
LFM decode-active 1.5B × 4.97 / 8 = **889 MiB/tok**.

| Recipe | Ling bytes/tok | File | How |
|---|---:|---:|---|
| Vanilla Q4 (uniform 4.89 bpw on 1.14B decode-active) | **665 MiB/tok** | **4.82 GB** (measured community) | 1.141e9 × 4.89 / 8 / 1024² |
| Vanilla Q4 if we take published 1.3B | 758 MiB/tok | same file | sensitivity |
| KEXP: experts 2.75 bpw (Q2/Q3 mix), rest Q5_K 5.5 bpw | **588 MiB/tok** | **~3.06 GB** (est.) | 0.488e9×2.75/8 + 0.652e9×5.5/8 |
| KEXP: experts 2.75, rest Q6 6.5 bpw | **665 MiB/tok** | **~3.13 GB** | up-precision attn cancels the expert cut |

Sanity vs our LFM KEXP projection: same recipe on LFM gives ~637 MiB/tok and 10.6 × (889/637) ≈ **14.8 t/s**, matching the written 14.7. Accounting is consistent.

Cache fraction at a 2000 MB mmap window:

- Ling Q4 4.82 GB → **41%**
- Ling KEXP ~3.1 GB → **65%**
- LFM Q4 5.16 GB → **39%**

### 7.3 8 GB phone / 2.5–3 GB usable — can 4.82 GB sit RAM-resident?

**No.** 4.82 GB > 3 GB. The Q4 file cannot be fully resident in a 2.5–3 GB usable budget.

What *did* happen with LFM Q4 on Jelly (8 GB): mmap 4908 MiB, RSS ~5 GiB, swap 1.1 GiB, no OOM ([G99 report](../g99-freetier/report.md)). That is mmap + swap, not “3 GB usable, fully resident.” Same story, slightly smaller file, for Ling Q4.

If the product constraint is really ~2.5–3 GB for the model:

- Q4_K_M 4.82 GB — **does not fit resident**. Expect paging. 2000 MB cache covers 41% of the file.
- KEXP ~3.1 GB — **still over 3 GB**, borderline if usable is the top of the 2.5–3 band.
- Community Q3_K_M 3.84 GB — still over.
- Community IQ2_M **2.70 GB** — the first file that actually sits in a 3 GB budget. Quality unknown; smoke only.
- Official INT4 safetensors 5.82 GB — worse, and not GGUF.

Jelly has 8 GB; “usable 2.5–3 GB” is the honest Android leftover after system + app + KV. **Do not plan a 4.82 GB free-tier resident model on G99.**

### 7.4 Decode projections

**Calibration we will not mix.**

Campaign-instrumented working set (lineup card, [report](../lineup-card/report.md)):

| cell | t/s | MiB/tok (instrumented) | realized |
|---|---:|---:|---:|
| Marco1c S23 | 8.819 | 51.5 | **454 MiB/s** |
| CalaQwen S23 | 5.696 | 30.7 | 175 MiB/s |
| Marco1c Jelly | 3.642 | 51.58 | 188 MiB/s |

Those MiB/tok figures are **not** the theoretical active-weight bytes in §7.2 (600–900 MiB). They are the campaign counter (with a hit%). **Do not divide 454 MiB/s by 665 MiB/tok** — that mixes two unit systems and yields 0.7 t/s, which is garbage.

Use them only as a **same-campaign S23/Jelly ratio** on a MoE: 8.819 / 3.642 = **2.42×**.

Jelly LFM2.5-8B-A1B Q4_K_M, measured, our cells ([G99 report](../g99-freetier/report.md)):

| k | t/s |
|---|---:|
| 4 (native) | **10.6** |
| 3 | **12.3** |
| 2 | **14.4** |
| KEXP proj. | 14.7 / 16.3 / 18.3 |

Assume BW-bound decode, same realized efficiency as LFM Q4 k=4 on Jelly, scale by theoretical bytes/tok. Ling native k is **8** (not 4); we do not invent k-cut cells.

| Device | Recipe | t/s | How |
|---|---|---:|---|
| Jelly | Ling Q4 k=8 | **14** (12–14) | 10.6 × (889/665) = 14.2; 10.6 × (1.5/1.3) = 12.2 if we only trust published actives |
| Jelly | Ling KEXP k=8 | **16** | 10.6 × (889/588) = 16.0 |
| S23 | Ling Q4 k=8 | **30–34** | Jelly band × 2.42 (Marco1c ratio). LFM2.5 itself is **unmeasured on S23**. |
| S23 | Ling KEXP k=8 | **~39** | 16.0 × 2.42 |

**Assumptions (all of these can fail):**

1. Decode is memory-bound on active weights the way LFM Q4 k=4 was on Jelly. KDA is a recurrent linear-attention op; on Mali-G57/G99 it may be **compute-bound** and miss this band entirely. No Android kernel exists in our tree.
2. k=8 gather (128 tiny experts) has the same efficiency as LFM k=4 (32 fat experts). More, smaller tiles can be worse on a phone.
3. S23/Jelly = 2.42× transfers from Marco1c (35B KEXP, 53% hit) to an 8B MoE. CalaQwen's 3.5× is a denser/smaller working set and is **not** used.
4. Think-ON does not change t/s; it changes **tokens to first useful byte**. A 14 t/s think-ON model with 2k–32k reasoning tokens loses the UX contest to a 10.6 t/s model that answers sooner, if LFM's traces are shorter. We have not measured LFM trace length.

Headline vs the 15–20 t/s free-tier wish: Jelly Ling Q4 is **projected ~14, not measured, and not 15–20**. KEXP ~16 is a projection on an arch we cannot load. LFM KEXP 14.7/16.3/18.3 is the only path that already has a measured baseline on this phone.

---

## 8. Verdict

**`NOT_BETTER`** for the G99 free-tier lane.

Not `REPLACES_LFM25`: cannot run on our llama.cpp, 4.82 GB Q4 is not RAM-resident in a 2.5–3 GB usable budget, think-ON is a UX kill at phone t/s, think-OFF quality is unpublished, IT/ES/FR is undocumented, Jelly decode is a projection that still sits in the same 12–16 t/s band as LFM (Q4 10.6 / KEXP ~15–18), not above it.

Not `COMPLEMENTS` as a lane item: a complement still has to load. After PR 26608 merges **and** a think-OFF smoke shows short answers with non-collapsed IF, reopen as a quality-upside experiment (AA 25 think-ON is real). Until then it is a watchlist card, not a second SKU.

**Single blocking issue:** llama.cpp `bailingmoe3` (with Tiny's Q-LoRA path) is **not merged**. Everything else is hypothetical.

**First fail-fast (standard, in order):**

1. Do not wait for a marketing 262K / AA-25 story. Confirm PR [#26608](https://github.com/ggml-org/llama.cpp/pull/26608) merged, **or** build [aetherbird/llama.cpp `bailingmoe3-support`](https://github.com/aetherbird/llama.cpp/tree/bailingmoe3-support) as a throwaway.
2. Download the **smallest** community GGUF: [Q1_0 1.30 GB](https://huggingface.co/bloomer010/Ling-3.0-tiny-GGUF) (or IQ2_M 2.70 GB if Q1 is a toy).
3. `gguf-dump` / `bmoe-cli --list-archs`: must show `bailingmoe3`, 128 experts, k=8, `q_lora_rank=256`, 24 layers, no MTP.
4. PC smoke, **both** `enable_thinking=true` and `false`. Fail if think-OFF still emits long `<think>` bodies or if think-ON average tokens on a 10-prompt chat set is in the thousands.
5. Only then: Q4_K_M 4.82 GB, PC PPL vs LFM A0, then Jelly bench against the cells we already have (LFM Q4 k=4 **10.6** / k=3 **12.3** / k=2 **14.4**). Compare think-OFF tokens and t/s, not AA 25.

Do not take a 4.82 GB file to an 8 GB G99 expecting residency. Do not treat 25 vs 8 as a reason to switch the lane.

DONE
