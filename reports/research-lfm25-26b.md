REPLACE_CANDIDATE — LFM2.5-2.6B vs Qwen3.5-2B prefill is NOT_PUBLISHED; closest official number is predecessor LFM2-2.6B at 143 tok/s 1K-prefill vs Qwen3-4B 57 tok/s (2.5×) on Galaxy S25 / llama.cpp Q4_0, but only 143 vs Qwen3-1.7B 140 (near-tie).

# LFM2.5-2.6B recon vs Qwen3.5-2B (on-device chat)

Scope: web-only. Official claims vs independent measurements are labelled. A number that is not published is written **NOT_PUBLISHED**, not estimated.

Candidate: https://huggingface.co/LiquidAI/LFM2.5-2.6B  
Released: 2026-08-04 (blog dated Aug 4, 2026). This report is 2026-08-13.

---

## 1. Model card facts

Sources: [HF card](https://huggingface.co/LiquidAI/LFM2.5-2.6B), [config.json](https://huggingface.co/LiquidAI/LFM2.5-2.6B/raw/main/config.json), [official docs](https://docs.liquid.ai/lfm/models/lfm25-2.6b), [blog](https://www.liquid.ai/blog/lfm2-5-2-6b), [LICENSE](https://huggingface.co/LiquidAI/LFM2.5-2.6B/blob/main/LICENSE), [chat_template.jinja](https://huggingface.co/LiquidAI/LFM2.5-2.6B/raw/main/chat_template.jinja), [GGUF repo](https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF).

### Architecture

Hybrid **conv + attention**. `model_type: lfm2`, class `Lfm2ForCausalLM`.

| Item | Value | Source |
|---|---|---|
| Total params | 2.69B (card); 2.6B in tables | HF card |
| Hidden size | 2048 | config.json |
| Intermediate (SwiGLU) | 10752 | config.json |
| Layers | 30 | HF card + config.json |
| Layer mix | **22 double-gated short convolution + 8 GQA** | HF card |
| Exact `layer_types` | 22× `conv`, 8× `full_attention`, interleaved (pattern starts `conv, conv, full_attention, …`) | config.json |
| Attention | GQA, 32 Q heads / 8 KV heads | config.json |
| Conv state | `conv_L_cache: 3` (kernel size 3), `conv_dim: 2048` | config.json |
| Vocab | 128,000 (byte-level BPE, expanded in-place from LFM2’s 65,536) | HF card + [tokenizer-expansion blog](https://www.liquid.ai/blog/tokenizer-expansion) |
| Context | 131,072 tokens (128K) | HF card / config `max_position_embeddings` |
| Training budget | ~34T tokens + 128K mid-training + 4-stage post-train (2× SFT, teacher specialization, MOPD, agentic RL) | HF card + blog |
| Recommended sampling | temp 0.1, top_k 50, repetition_penalty 1.1 | HF card |

Same backbone family as LFM2.5-8B-A1B (hybrid LFM2, same tokenizer-expansion procedure). LFM2.5-2.6B is the **dense** sibling, not the MoE.

### Languages — Italian is listed

Official 16-language list on the 2.6B card:

> English, Arabic, Chinese, French, German, **Italian**, Japanese, Korean, Portuguese, Spanish, Vietnamese, Thai, Indonesian, Hindi, Russian, Polish

So IT / ES / FR / EN are all first-class on the card. Caveat: **no per-language Italian score is published** for LFM2.5-2.6B. The older LFM2 paper treated Italian as “additional base support”, not a priority language (priority was JA/AR/KO/ES/FR/DE). LFM2.5-2.6B’s 128K vocab expansion was done “to better support non-Latin scripts”, same procedure as 8B-A1B — that helps CJK/AR more than IT.

### Tool calling

Yes, native. Four-step protocol documented on the card and at [docs.liquid.ai tool-use](https://docs.liquid.ai/lfm/key-concepts/tool-use):

1. Tools as JSON in the system prompt, or `apply_chat_template(..., tools=...)`.
2. Model emits Pythonic calls between `<|tool_call_start|>` and `<|tool_call_end|>` (JSON override via system prompt).
3. Host returns a `tool` role message.
4. Model answers in plain text.

SGLang parser tag is `lfm2`. Same special tokens / ChatML family as the rest of LFM2.5, so an 8B-A1B tool-call fine-tune recipe transfers.

### License

HF tag: **`lfm1.0`** = [LFM Open License v1.0](https://huggingface.co/LiquidAI/LFM2.5-2.6B/blob/main/LICENSE).

- Royalty-free copyright + patent grant, including commercial use, **only if the Legal Entity’s annual revenue is below USD 10,000,000**.
- Commercial use at/above that threshold is **not licensed**. Need a separate Liquid deal.
- Qualified non-profits are exempt from the threshold for non-commercial/research use.
- Redistribution of derivatives must keep the license + change notices.

This is **not** Apache-2.0. Qwen3.5-2B is the usual Qwen open license (no $10M gate). If the shipping app’s entity is already over $10M ARR, LFM2.5-2.6B is a legal blocker until a commercial license is signed. Under $10M it is usable, including commercial redistribution of a fine-tune, with the license attached.

### Reasoning / think mode

Official card, verbatim:

> LFM2.5-2.6B is a **pure reasoning model that always thinks before it answers**. It adds a `<think>` tag directly in the chat template when starting an assistant answer.

The last lines of `chat_template.jinja`:

```
{%- if add_generation_prompt -%}
    {{- "<|im_start|>assistant\n<think>" -}}
{%- endif -%}
```

There is **no** `enable_thinking=false` switch (unlike Qwen3.5-2B, which **defaults to non-thinking**). `preserve_thinking` only controls whether prior turns keep the think block in history. At the 1.2B scale Liquid ships a separate Instruct vs Thinking pair; at 2.6B they shipped only the always-think agentic checkpoint.

Implication for a phone chat app: every reply spends decode tokens on a `<think>…</think>` trace before user-visible text. On a ~30 tok/s phone that is a TTFT tax on top of prefill. **NOT_PUBLISHED** how many think tokens a typical turn uses.

### GGUF

Official repo: **https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF**

Architecture tag in the GGUF: **`lfm2`**.

Official quants (HF file listing):

| Quant | Size |
|---|---|
| Q4_0 | 1.59 GB |
| **Q4_K_M** | **1.67 GB** |
| Q5_K_M | 1.94 GB |
| Q6_K | 2.22 GB |
| Q8_0 | 2.87 GB |
| BF16 / F16 | 5.4 GB |

No official IQ / IQ4_XS / Q3_K listed on the official repo. Community quants exist (54 quantized descendants on the parent card).

Recommended llama.cpp one-liner (docs + GGUF card):

```
llama-cli -hf LiquidAI/LFM2.5-2.6B-GGUF -c 4096 --color -i --temp 0.1 --top-k 50 --repeat-penalty 1.1
```

Also official: ONNX (`LFM2.5-2.6B-ONNX`) and MLX (`LFM2.5-2.6B-MLX`).

### Chat template

ChatML-like. [Docs](https://docs.liquid.ai/lfm/key-concepts/chat-template). Shape:

```
<|startoftext|><|im_start|>system
…<|im_end|>
<|im_start|>user
…<|im_end|>
<|im_start|>assistant
<think>
```

Special tokens of note: `<|startoftext|>`, `<|im_start|>/<|im_end|>`, `<think></think>`, `<|tool_call_start|>/<|tool_call_end|>`. Tools are inlined into the system prompt as `List of tools: […]`. Same family as LFM2.5-8B-A1B.

---

## 2. Prefill speed (headline)

### Official claims — LFM2.5-2.6B specifically

Sources: [HF card CPU section](https://huggingface.co/LiquidAI/LFM2.5-2.6B), [blog](https://www.liquid.ai/blog/lfm2-5-2-6b).

Published **decode** numbers only:

| Device | Quant | Prefill | Decode | Memory | Source |
|---|---|---|---|---|---|
| Apple M5 Max | not stated | **NOT_PUBLISHED** | **220 tok/s** | < 2.5 GB | official card + blog |
| AMD Ryzen AI Max+ 395 | not stated | **NOT_PUBLISHED** | **113 tok/s** | < 2.5 GB | official card + blog |
| “a phone” (unnamed) | not stated | **NOT_PUBLISHED** | **30 tok/s** | not stated | official card + blog |

Blog wording: “the fastest model we tested **at reading in prompts** and generating answers, decoding 220 / 113 / 30 tok/s…”. The prefill claim is qualitative (“fastest at reading in prompts”). The numeric table/chart is decode. **No official tok/s prefill number exists for LFM2.5-2.6B on any named phone.**

No official number vs **Qwen3.5-2B** (or vs Qwen3.5 anything at the 2B size). Official quality table compares against Qwen3.5-**4B/9B** and Gemma-4-E2B/E4B, not Qwen3.5-2B. Official speed prose does not name Qwen3.5-2B.

GPU H100 claim (not relevant to phones): ~15k output tok/s at high concurrency, BF16, SGLang 0.5.16, 1024-in / 256-out.

### Official numbers — same architecture, predecessor LFM2-2.6B

LFM2.5-2.6B reuses the LFM2 hybrid (22 conv + 8 GQA). The [LFM2 technical report](https://arxiv.org/html/2511.23404v1) (arXiv:2511.23404, 2025-11-28) is the only official source with **named-device, named-quant, prefill+decode** tables. These are **LFM2-2.6B, not LFM2.5-2.6B**. LFM2.5-2.6B has a 128K vocab (vs 65K) and 128K ctx (vs 32K); vocab growth can move speed a little. Treat as architecture-class evidence, not a 2.5 measurement.

Setup (paper §2.4): llama.cpp, **Q4_0**, batch=1, CPU backend. Prefill = prompt tokens/s at 1K and 4K prompt length. Decode = tok/s generating 100 tokens from a 1K / 4K prefix.

**Samsung Galaxy S25, Snapdragon 8 Elite (Table 2):**

| Model | Prefill 1K | Prefill 4K | Decode 1K | Decode 4K |
|---|---:|---:|---:|---:|
| **LFM2-2.6B** | **143** | **116** | **33.8** | **30.0** |
| Qwen3-1.7B | 140 | 98 | 39.7 | 26.9 |
| Qwen3-4B | 57 | 35 | 17.2 | 11.4 |
| Gemma-3-4B | 72 | 63 | 18.3 | 17.9 |
| Llama-3.2-3B | 79 | 51 | 24.2 | 15.8 |
| SmolLM3-3B | 98 | 66 | 26.1 | 19.2 |

Paper text: “LFM2-2.6B delivers about **2–3× higher throughput than Qwen3-4B** across prefill and decode.” Against Qwen3-**1.7B** on the same S25 table, 1K prefill is **143 vs 140 — a tie**. Decode at 1K is actually slower (33.8 vs 39.7).

**AMD Ryzen AI 9 HX 370 laptop CPU (Table 3):**

| Model | Prefill 1K | Prefill 4K | Decode 1K | Decode 4K |
|---|---:|---:|---:|---:|
| **LFM2-2.6B** | **1,335** | **1,171** | **50.3** | **46.8** |
| Qwen3-1.7B | 2,019 | 1,491 | 60.8 | 38.5 |
| Qwen3-4B | 861 | 628 | 31.0 | 22.2 |
| Gemma-3-4B | 1,119 | 1,054 | 33.0 | 31.6 |
| Llama-3.2-3B | 1,179 | 916 | 38.3 | 28.2 |

On the laptop, Qwen3-1.7B **beats** LFM2-2.6B on 1K prefill (2,019 vs 1,335) because it is smaller. LFM2-2.6B beats Qwen3-4B (~1.55× prefill, ~1.6× decode).

Paper headline (intro): “up to ∼2× prefill and decode speedups versus similarly sized baselines.” That “2×” is vs 3–4B dense transformers, **not** vs a 2B hybrid.

Helio G99, Galaxy S23, Q4_K_M: **NOT_PUBLISHED** for either LFM2-2.6B or LFM2.5-2.6B.

Qwen3.5-2B itself is also a hybrid (Gated DeltaNet + Gated Attention, 24 layers). Official LFM tables never include it. **Prefill LFM2.5-2.6B vs Qwen3.5-2B: NOT_PUBLISHED.**

### Independent / community measurements

| Who | Device | Quant | Prefill | Decode | Notes | Source |
|---|---|---|---|---|---|---|
| Turing Pi (2026-08-04) | Turing RK1, **RK3588** (4×A76+4×A55), Ubuntu 24.04, llama.cpp CPU-only, 4 threads, ctx 4096 | **Q4_K_M** official | **~30 tok/s** (one run 30.5) | **~14 tok/s** (13.2–14; 9 tok/s with 8 threads) | Independent, same-day as the model release. Not a phone. RK3588 is stronger than Helio G99 (2×A76+6×A55). | [turingpi.com](https://turingpi.com/lfm2-5-2-6b-rk3588-llama-cpp-turing-pi-rk1/) |
| r/LocalLLaMA (2026-01-02) | unnamed Android phone, Termux llama.cpp `GGML_OPENCL=ON` | LFM2-**2.6B-Exp** Q4_K_M (predecessor Exp, not 2.5) | **NOT_PUBLISHED** | “40+ tok/s” claimed for OpenCL GPU path | Independent, different checkpoint, GPU not CPU, device unnamed. | [reddit](https://www.reddit.com/r/LocalLLaMA/comments/1q1k9g3/lfm2_26bexp_on_android_40_tps_and_32k_context/) |

No independent llama.cpp bench on Helio G99, Galaxy S23, or Snapdragon 8 Gen 1/2 was found for LFM2.5-2.6B.

No independent head-to-head of LFM2.5-2.6B Q4_K_M vs Qwen3.5-2B Q4_K_M on any phone.

### What this means for the 47 s / 1.4k-token system prompt

Your measured pain: Qwen3.5-2B Q4_K_M, Helio G99, **28 tok/s prefill** → 1.4k tokens ≈ 47 s.

Public data does **not** say LFM2.5-2.6B is faster than that on a G99.

- Official LFM2.5-2.6B phone number is **decode 30 tok/s** on an unnamed phone — same class as your current decode, not a prefill win.
- Closest official prefill (LFM2-2.6B, S25, Q4_0, 1K) is 143 tok/s. An S25 is far above a G99; you cannot scale that number down without inventing a result.
- The only independent ARM prefill for **LFM2.5-2.6B Q4_K_M** is **~30 tok/s on RK3588**. That is the same order as your 28 tok/s on G99, on a **stronger** SoC. It is not a controlled comparison (different runtime flags, prompt lengths, llama.cpp builds).
- Always-on `<think>` adds decode before the first visible token. That can erase a modest prefill win.
- Hybrid conv state has documented llama.cpp prompt-cache / `seq_rm` quirks (see §4). If the 1.4k system prompt cannot be cached across turns, you pay prefill every turn regardless of tok/s.

**Bake-off is mandatory.** The marketing 2–3× is vs Qwen3-**4B** on an S25, not vs Qwen3.5-**2B** on a G99.

---

## 3. Quality

### Official LFM2.5-2.6B table

Source: [HF card](https://huggingface.co/LiquidAI/LFM2.5-2.6B) / [blog](https://www.liquid.ai/blog/lfm2-5-2-6b). Liquid harness, vLLM, generation settings in blog footnote 1. **No Qwen3.5-2B column. No Gemma-3.5-class 2B column.**

| Benchmark | LFM2.5-2.6B (2.6B) | gemma-4-E2B-it (5.1B) | gemma-4-E4B-it (8B) | Qwen3.5-4B (4.7B) | Qwen3.5-9B (9.7B) |
|---|---:|---:|---:|---:|---:|
| AA-Omni-Public Index | -29.50 | -74.47 | -49.03 | -54.30 | -50.43 |
| AA-Omni-Public Acc | 8.13 | 6.37 | 8.33 | 17.63 | 21.30 |
| AA-Omni-Public Non-hallu | 59.04 | 13.67 | 37.42 | 12.66 | 8.84 |
| AIME25 | 51.87 | 26.33 | 34.27 | 49.33 | 56.07 |
| LiveCodeBenchv6 | 59.41 | 54.92 | 63.77 | 60.85 | 69.86 |
| **IFBench** | **59.17** | 34.08 | 39.24 | 48.40 | 56.47 |
| **Multi-IF** | **80.07** | 69.44 | 77.35 | 55.67 | 62.55 |
| **IFStruct** | **85.49** | 64.85 | 76.65 | 36.25 | 78.50 |
| **BFCLv4** | **56.88** | 36.98 | 46.39 | 50.56 | 60.13 |
| **ToolSandbox** | **77.83** | 52.40 | 65.00 | 75.55 | 76.44 |
| τ³-Bench Banking | 5.67 | 3.35 | 4.12 | 5.45 | 5.15 |
| Claw-Eval avg (EN) | 62.85 | 53.14 | 58.02 | 62.28 | 66.53 |
| PinchBench | 68.22 | 44.24 | 55.09 | 71.26 | 71.45 |
| BrowseComp+ (OpenClaw) | 26.89 | 8.31 | 15.90 | 24.46 | 27.23 |

Liquid’s own summary: leads every IF bench and nearly every tool bench; trails only Qwen3.5-9B on BFCLv4; coding is where larger models keep an edge. They explicitly **do not recommend** it for agentic coding or knowledge-heavy tasks.

### Cross-card vs Qwen3.5-2B (different harness — do not treat as a bake-off)

[Qwen3.5-2B card](https://huggingface.co/Qwen/Qwen3.5-2B):

| Bench | Qwen3.5-2B (official, Qwen harness) | LFM2.5-2.6B (official, Liquid harness) |
|---|---:|---:|
| IFEval (non-think) | 61.2 | NOT_PUBLISHED |
| IFEval (think) | 78.6 | NOT_PUBLISHED (model is always-think) |
| IFBench (think) | 41.3 | 59.17 |
| MultiChallenge (think) | 33.7 | NOT_PUBLISHED |
| BFCL-V4 (think) | 43.6 | 56.88 |
| MMMLU (non-think / think) | 56.9 / 63.1 | NOT_PUBLISHED |
| IFStruct (Liquid leaderboard scrape on the Qwen card) | **33.15** | **85.49** |

IFStruct 85.49 vs 33.15 is the one number that is at least on the same leaderboard ([LiquidAI/ifstruct-v1.0](https://huggingface.co/datasets/LiquidAI/ifstruct-v1.0)). Everything else is cross-harness.

Qwen3.5-2B also reports multilingual think-mode: MMMLU 63.1, INCLUDE 55.4, WMT24++ 45.8, MAXIFE 60.6, Global PIQA 69.3. **LFM2.5-2.6B publishes no Italian / ES / FR / EN split.**

### Independent evals of LFM2.5-2.6B

**NOT_PUBLISHED** as of 2026-08-13. The model is nine days old. No third-party Italian eval, no LMSYS / EQ-Bench / independent BFCL rerun found.

Turing Pi’s qualitative check (not a bench): the model followed a constrained Bash-script prompt but missed a millidegree-to-Celsius conversion. Anecdote, not a score.

### Predecessor LFM2-2.6B (for scale, not a substitute)

LFM2 paper (internal harness): LFM2-2.6B IFEval 79.56, GSM8K 82.41, MGSM 74.32. That is LFM2, 10–12T tokens, 32K ctx, 65K vocab — not LFM2.5.

---

## 4. llama.cpp / llama.rn support

### Arch tag and since when

- GGUF architecture: **`lfm2`** ([official GGUF card](https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF)). MoE sibling is `lfm2moe`.
- LFM2.5-2.6B does **not** need a new arch. It is the same `lfm2` graph as LFM2-2.6B.
- Support is mature enough that Liquid’s day-one story for this release is “just `-hf LiquidAI/LFM2.5-2.6B-GGUF`”.
- Earliest public evidence of `lfm2` in llama.cpp: issues filed **2025-07-30** ([#14979 imatrix](https://github.com/ggml-org/llama.cpp/issues/14979)) already load `architecture = lfm2`. `lfm2moe` landed around **b6709** (Oct 2025, [HF discussion](https://huggingface.co/LiquidAI/LFM2-8B-A1B/discussions/2)). Exact first PR / first release tag: **NOT_PUBLISHED** in the pages retrieved (search did not surface the original “add LFM2” PR number). Conservative statement: **in-tree since at least July 2025**, ~13 months before this recon.

### Known issues (conv / hybrid memory)

These are real and they matter for a 1.4k-token sticky system prompt.

1. **Prompt cache often cannot be partially reused.** [llama.cpp #16491](https://github.com/ggml-org/llama.cpp/issues/16491) (2025-10-09, closed, LFM2-2.6B + LFM2-8B-A1B, arch `lfm2` / `lfm2moe`): every edited prompt logs `forcing full prompt re-processing due to lack of cache data (likely due to SWA or hybrid/recurrent memory)` then `memory_seq_rm [0, end)`. `--swa-full` did not change it. Workaround reported in comments: pre-create context checkpoints with `n_predict=1` on prompt segments.

2. **`llama_memory_seq_rm` cannot rewind conv state to an arbitrary position.** Recurrent/hybrid memory refuses a partial range (documented in llama.cpp recurrent-memory comments; bindings such as LlamaCppEx test this as `:full` reset vs `:part` reuse). Editing or shrinking a prefix tends to drop the whole state.

3. **Session / cache file reload.** [llama.cpp #19041](https://github.com/ggml-org/llama.cpp/issues/19041): LFM2-1.2B, first run OK, second run loading the session file hits `GGML_ASSERT(cell.has_seq_id(seq_id))`. Sticky-prompt-via-session is not something to assume without a device test.

4. **Parallel slots + KV.** [llama.cpp #16278](https://github.com/ggml-org/llama.cpp/issues/16278) (2025-09-26): LFM2-2.6B-GGUF parallel decode asserts on `ubatch.seq_id` in the KV cache. Relevant if llama.rn `n_parallel` is used.

5. **CPU-only scheduler assert** (later, LFM2.5 family): [llama.cpp #19184](https://github.com/ggml-org/llama.cpp/issues/19184) (2026-01-29) — “LFM2(.5) series fails with CPU-only inference” via a scheduler assert. Status of a fix on current master: not verified here. Worth pinning a known-good llama.cpp build in the bake-off.

6. **imatrix / some K-quants** had early LFM2 bugs (`shortconv.in_proj` size). Official repo already ships Q4_K_M, so this is historical for the official files.

llama.rn session API (`saveSession` / `loadSession`) exists and is documented as “saves time of prompt processing”. Whether it works on `lfm2` on Android CPU is **NOT_PUBLISHED**. llama.rn also notes state load/save is incomplete on Android OpenCL unless `kv_unified: true` and `flash_attn_type: 'off'`.

### llama.rn recency

- Package: [`llama.rn`](https://www.npmjs.com/package/llama.rn) **0.13.0-rc.0**, published ~3 days before this recon (npm “3 days ago” on 2026-08-13). Repo: https://github.com/mybigday/llama.rn
- Bundles llama.cpp as a git submodule (`third_party/llama.cpp` → `ggml-org/llama.cpp`). Exact commit / `bXXXX` tag is **not** in `package.json` or `.gitmodules` (unpinned URL). Given the package date, it is current llama.cpp, not a 2024 snapshot.
- README explicitly talks about **recurrent / hybrid models** (MTP rollback state allocation) and ships `saveSession`/`loadSession`, Jinja tool calling, GBNF.
- Tool calling goes through llama.cpp `chat.cpp` + minja. LFM2.5’s ChatML + `<|tool_call_start|>` is the kind of native template llama.cpp already knows; if a given build’s `chat.cpp` has no dedicated `lfm2` parser it falls back to GENERIC JSON. **Whether 0.13.0-rc.0’s chat.cpp has a first-class LFM2 tool parser: NOT_PUBLISHED.** Test in the bake-off with `--jinja` / `tools:`.
- Helio G99 is **not** in llama.rn’s OpenCL (Adreno 700+) or Hexagon (SM8450+) support lists. On G99 you are on **CPU**, same as today. S23 (Snapdragon 8 Gen 2) can try OpenCL/Hexagon; official Liquid phone number is CPU.
- OpenCL backend restriction (llama.rn README): Adreno + **Q4_0 / Q6_K** only. Official Q4_K_M may not offload. Bake-off on S23 should include Q4_0 as well as Q4_K_M.

**Bottom line:** llama.rn is new enough to load `lfm2`. The risk is not “unknown architecture”. The risk is conv-state cache / session / tool-parser behaviour on CPU.

---

## 5. Fine-tuning

### Does Liquid’s cookbook cover the dense 2.6B?

Yes at the family level, no as a dedicated 2.6B notebook.

- [Liquid cookbook](https://github.com/Liquid4All/cookbook) + [docs Unsloth](https://docs.liquid.ai/lfm/fine-tuning/unsloth) + [docs TRL](https://docs.liquid.ai/lfm/fine-tuning/trl) all say “LFM2.5 models are fully supported”.
- Every official Colab defaults to **`LiquidAI/LFM2.5-1.2B-Instruct`** (or 1.2B-Base for CPT, VL-1.6B for vision). Swap the `model_id` to `LiquidAI/LFM2.5-2.6B` or `…-Base`. Same `Lfm2ForCausalLM`, same module names.
- Official notebooks: Unsloth SFT / GRPO / CPT; TRL SFT / DPO / GRPO. [leap-finetune](https://github.com/Liquid4All/leap-finetune) wraps TRL for LFM defaults.
- Community already fine-tuned the **dense 2.6B** (LFM2-2.6B tic-tac-toe RL, etc.). Same modules.

There is also `LFM2.5-2.6B-Base` specifically “for fine-tuning”. For a native tool-call FT you probably want the post-trained 2.6B (already agentic) or the Base if you want a clean slate. Liquid recommends FT for any specific use case.

### TRL / PEFT / Unsloth

All three are first-class.

**Unsloth target modules (correct for this arch)** — from [unsloth.ai LFM2.5 tutorial](https://unsloth.ai/docs/models/tutorials/lfm2.5):

```
["q_proj", "k_proj", "v_proj", "out_proj", "in_proj", "w1", "w2", "w3"]
```

That hits GQA (`q/k/v/out`), the gated-conv in/out projections (`in_proj`, `out_proj`), and SwiGLU (`w1/w2/w3`).

**Do not copy the TRL docs snippet blindly.** [docs.liquid.ai/trl](https://docs.liquid.ai/lfm/fine-tuning/trl) shows a generic

```
target_modules=["q_proj", "k_proj", "v_proj", "o_proj"]
```

which misses conv + MLP and uses `o_proj` instead of LFM2’s `out_proj`. The Unsloth recipe is the one to share with the 8B-A1B pipeline (8B-A1B additionally has expert `w1/w2/w3` + router; dense 2.6B has no experts).

Also supported: QLoRA (`load_in_4bit=True`), Unsloth GGUF export `q4_k_m`, DPO, GRPO.

`transformers>=5.0` (card) / `>=5.2.0` (docs) required.

---

## 6. Verdict

**REPLACE_CANDIDATE** — worth a device bake-off vs Qwen3.5-2B Q4_K_M. Not a ship-it-blind swap.

### The 3 decisive facts

1. **Prefill vs Qwen3.5-2B is NOT_PUBLISHED, and the official 2–3× is vs Qwen3-4B on an S25.** Same-arch LFM2-2.6B is a **tie** with Qwen3-1.7B on S25 1K prefill (143 vs 140, llama.cpp Q4_0). The only independent LFM2.5-2.6B ARM prefill is **~30 tok/s Q4_K_M on RK3588**, which does not promise a win over your **28 tok/s on G99**. Always-on `<think>` plus conv-state cache invalidation can make the 1.4k system prompt *worse* if you cannot keep it in session. The bake-off must measure: G99 CPU and S23 CPU/OpenCL, Q4_K_M **and** Q4_0, 1.4k sticky system prompt **first turn and turn 2**, with and without `saveSession`.

2. **Family alignment is real.** Same `lfm2` arch, same ChatML + `<|tool_call_start|>` template, same `lfm1.0` license, same Unsloth/TRL module list as the LFM2.5-8B-A1B you already plan to fine-tune. Official GGUF exists. llama.rn 0.13.0-rc.0 is new enough. Italian is on the 16-language card. Tool calling is native and agentic-RL-trained.

3. **Quality looks like an IF/tool upgrade on official numbers, with two product risks.** Liquid IFBench 59 / IFStruct 85 / BFCLv4 57 vs Qwen3.5-2B’s own 41 / 33 / 44 (mixed harness except IFStruct). No Italian score. **Always-think cannot be turned off.** License is revenue-gated at $10M — legal review, not Apache.

### Bake-off checklist (do not skip)

- Devices: Helio G99 (floor) and Galaxy S23 (ceiling of the current fleet).
- Quants: official Q4_K_M (matches what you ship) and Q4_0 (OpenCL + paper’s official table).
- Metrics: prefill tok/s at ~1.4k, decode tok/s, TTFT including `<think>`, turn-2 prefill with unchanged system prompt (cache/session), peak RSS.
- Quality: Italian tool-call + IF suite you already use on Qwen3.5-2B; do not trust Liquid’s table alone.
- llama.rn: 0.13.0-rc.0 or newer; confirm Jinja tool parse; confirm `saveSession` actually skips the 1.4k prefill on `lfm2`.
- Legal: confirm entity revenue vs LFM Open License v1.0 §5 before any store build.

### What would flip this to NOT_YET

- Entity ≥ $10M ARR and no Liquid commercial license.
- Bake-off shows turn-2 still full-reprefill of 1.4k on G99 (conv-state cache miss) **and** prefill ≤ current 28 tok/s.
- Always-think TTFT is unacceptable and a no-think FT is not in scope.

### What would flip this to SIDEGRADE

- Bake-off prefill/TTFT within ~10% of Qwen3.5-2B and Italian quality not clearly better. Family alignment alone is not enough to swap a shipping model.

---

Sources (every claim above traces to one of these)

- https://huggingface.co/LiquidAI/LFM2.5-2.6B
- https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF
- https://huggingface.co/LiquidAI/LFM2.5-2.6B/blob/main/LICENSE
- https://huggingface.co/LiquidAI/LFM2.5-2.6B/raw/main/chat_template.jinja
- https://huggingface.co/LiquidAI/LFM2.5-2.6B/raw/main/config.json
- https://www.liquid.ai/blog/lfm2-5-2-6b
- https://www.liquid.ai/blog/introducing-lfm2-5-the-next-generation-of-on-device-ai
- https://docs.liquid.ai/lfm/models/lfm25-2.6b
- https://docs.liquid.ai/lfm/key-concepts/tool-use
- https://docs.liquid.ai/lfm/fine-tuning/unsloth
- https://docs.liquid.ai/lfm/fine-tuning/trl
- https://unsloth.ai/docs/models/tutorials/lfm2.5
- https://github.com/Liquid4All/cookbook
- https://arxiv.org/html/2511.23404v1
- https://huggingface.co/Qwen/Qwen3.5-2B
- https://turingpi.com/lfm2-5-2-6b-rk3588-llama-cpp-turing-pi-rk1/
- https://github.com/ggml-org/llama.cpp/issues/16491
- https://github.com/ggml-org/llama.cpp/issues/16278
- https://github.com/ggml-org/llama.cpp/issues/14979
- https://github.com/ggml-org/llama.cpp/issues/19041
- https://github.com/ggml-org/llama.cpp/issues/19184
- https://github.com/mybigday/llama.rn
- https://www.npmjs.com/package/llama.rn
- https://venturebeat.com/technology/no-cloud-no-gpus-no-problem-liquid-ais-new-model-lfm2-5-2-6b-brings-powerful-ai-agents-to-devices-as-small-as-a-raspberry-pi

DONE
