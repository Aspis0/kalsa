# Model research for the Kalsa catalog — 2026-09-26

Purpose: choose, on quality evidence, the two models Kalsa suggests per machine
("Smarter answers" / "Faster answers") for llama.cpp (GGUF) on ordinary Macs and
Windows PCs with 8/16/32/64 GB RAM. This replaces the Arcee Trinity Nano Preview
row (no serious benchmarks, bad community opinion).

Everything below was checked on 2026-09-26 against the live pages linked. Rules
used: never invent a number; quote the sentence a benchmark number was read
from; independent sources first (Artificial Analysis, leaderboards), publisher
model-card numbers second and labelled; say "not found" when that is the truth.

## Method and honesty notes (read first)

- Hugging Face model cards were read via huggingface.co pages and the public HF
  API (`/api/models/...`), which is also where every Q4_K_M byte size comes from
  (the `size` field of the repo tree JSON). Sizes are exact, not rounded.
- Reddit pages could not be opened directly (www.reddit.com and old.reddit.com
  both returned shell pages with no thread content to the fetcher). Community
  reception below is therefore summarised from search-engine result snippets of
  the linked threads, with the thread links given. Where a quote is a snippet it
  is marked as such.
- `https://huggingface.co/google/diffusiongemma-26b-a4b` returned HTTP 401 — the
  real instruction-tuned repo is `google/diffusiongemma-26B-A4B-it`, which opens.
- A guessed dev.to URL for DiffusionGemma returned 404; the facts attributed to
  it below come from the search snippet and the GitHub PR instead.
- LiveBench and the Open LLM Leaderboard: no pages for these specific 2026
  models surfaced in any search. Where independent numbers exist they are
  Artificial Analysis numbers (or AA numbers quoted on cards). Many cards carry
  only publisher-run tables — those are labelled.
- llama.cpp PR statuses were checked against the GitHub search API
  (`api.github.com`, repo `ggml-org/llama.cpp`) on 2026-09-26.
- "RAM needed" is an estimate by rule: Q4_K_M bytes ÷ 2^30 (GiB) + a KV-cache
  allowance at 8k context (≈0.3–0.5 GiB for hybrid/linear-attention or
  KDA/MLA/SWA models, ≈0.7–1.5 GiB for dense GQA models), plus ~1.5–2 GB OS
  overhead on Windows. These are labelled estimates.

---

## Part 1 — The six requested models

### 1. k2-horizon-7b (IFM "K2 Horizon")

1. **Repo / release / params / arch / context.** `IFM/K2-Horizon-7B`, created
   2026-09-01, last modified 2026-09-24; GGUF at `IFM/K2-Horizon-7B-GGUF`
   (https://huggingface.co/IFM/K2-Horizon-7B). Card: "K2-Horizon-7B is the
   medium dense member of the K2-Horizon family: a 7B-core decoder-only model
   with a 512K context window." Total 8,999,178,240 BF16 params (~9B); dense
   (no active split). Custom architecture `k2_horizon`
   (`modeling_k2_horizon.K2HorizonForCausalLM`, needs `trust_remote_code=True`).
   "Native 524,288-token context from the midtraining stages onward" (512K).
   Technical report listed as "In Progress — End of September 2026".
2. **Licence.** Apache-2.0. Card: "Fully open. Training data and recipe,
   training code, and evaluation resources are public." No user cap, no AUP
   gate in the licence itself.
3. **Benchmarks.** No independent leaderboard page found for the model itself;
   one r/LocalLLaMA thread reports an AA ranking (see §4). Publisher-reported
   (BF16): MMLU-Pro 73.8, GPQA-Diamond 73.7, IFEval 82.6, GSM8K 93.8, MBPP
   89.4, AIME26 88.3; "HMMT Feb 2026 — 73.3"; "SWE-bench Verified — 70.6";
   "HLE — 18.6"; SciCode 31.6; "LCR — 68.0"; "Terminal-Bench 2.1 — 39.1";
   "tau3-Banking — 25.8"; BrowseComp 59.0. GGUF quality table: "BF16 average
   79.4; Q4_K_M 77.3" (i.e. −2.1 points at Q4_K_M).
4. **Community.** r/LocalLLaMA release thread "Introducing K2 Horizon:
   Frontier Performance, Radically…" describes "IFM's open-source fleet of six
   frontier AI models … 375B-A23B, 36B-A4B, 32B, 7B, 3.7B, and 0.9B"
   (https://www.reddit.com/r/LocalLLaMA/comments/1w68rj6/). Thread title
   (snippet): "For the GPU-poor, K2 Horizon 7B ranks between Qwen 3.6 27B and
   Qwen 3.6 35B-A3B" on the AA Intelligence Index
   (https://www.reddit.com/r/LocalLLaMA/comments/1wg82rd/). Other snippets:
   "Casually destroys Muse Glimmer with a way smaller size"
   (…/1wg0vqz/); "7B uses ~5.2 GiB for weights + ~5 GiB for context"
   (…/1wg4a0u/); quants thread notes it is "less KV-cache efficient than Qwen,
   requiring more memory bandwidth" (…/1wnky7x/). English-only tag.
5. **llama.cpp.** **Blocked.** The official GGUF card itself says llama.cpp
   support requires a fork, PR "in progress"; stock llama.cpp has no
   `k2_horizon` arch. Official GGUF Q4_K_M =
   **5,592,217,984 bytes** (5.21 GiB), Q5_K_M = 6,466,075,008 bytes.
6. **RAM / fit.** ~5.2 GiB weights + ~0.7–1 GiB KV (est.) → fits 16 GB well,
   marginal-but-possible on 8 GB. Would be a top "Smarter" 16 GB pick —
   **except it does not run on stock llama.cpp**, so Kalsa cannot ship it now.
   GGUF models were "evaluated only on non-agent tasks so far" per the GGUF
   card.
7. **Italian/English.** English only ("en" tag). Nothing on Italian.

**Verdict: do not add now. Re-check when the llama.cpp PR merges; the paper
scores are the best in the ≤9B class we found.**

### 2. Granite 4.2 8B (IBM)

1. **Repo / release / params / arch / context.** `ibm-granite/granite-4.2-8b`,
   repo created 2026-08-07, card release date August 25, 2026
   (https://huggingface.co/ibm-granite/granite-4.2-8b). Dense 8B (8,791,592,960
   BF16 params). "Decoder-only Dense Transformer (Reasoning)",
   `GraniteForCausalLM`, GQA 32 heads / 8 KV heads, RoPE, SwiGLU, RMSNorm.
   Context: "Natively Supports 128K (Long-context extension to 512K)". Family
   is 3B / 8B / 30B dense, all created 2026-08-07, all with official GGUFs
   created 2026-08-12 (`granite-4.2-3b-GGUF`, `granite-4.2-8b-GGUF`,
   `granite-4.2-30b-GGUF`) plus fp8/mxfp4/nvfp4/MLX variants (HF API listing).
2. **Licence.** Apache 2.0 (HF API tag `license:apache-2.0` on all 22
   ibm-granite 4.2 repos). Commercial use fine, no cap, no AUP gate.
3. **Benchmarks.** No independent leaderboard found. Publisher-reported (8B
   column): MMLU-Pro 74.04; GPQA 64.14; IFBench (prompt) 79.33; AIME25 86.67;
   HMMT Feb25 78.33; LiveCodeBench v6 73.24; SciCode 36.09; "SWE-bench
   Verified: 47.67"; SWE-bench Pro 19.11; Terminal-Bench 2.1 20.56. IFEval is
   not reported for 4.2 (4.0-h-tiny reported IFEval; 4.2 card lists IFBench).
   Cross-check from IFM's K2 table (second party): Granite 4.2-8B HMMT Feb 2026
   66.5, SWE-bench Verified 47.7, HLE 9.7, SciCode 30.4, LCR 43.3,
   Terminal-Bench 2.1 18.4 — consistent.
4. **Community.** r/LocalLLaMA thread (title via search snippet):
   "IBM Released Granite 4.2 as Dense Reasoning Models at 3B, 8B and 30B Under
   Apache 2.0 With a 512K Context"
   (via https://mindpattern.ai). Roundup coverage: IBM's technical blog
   "Granite 4.2 LLMs: How They're Built" (https://news.smol.ai, Aug 24 2026);
   eesel.ai positions it as "the enterprise/on-prem pick, noted for permissive
   licensing, commodity hardware support, and grounded tool use"
   (https://www.eesel.ai). No looping/refusal complaints surfaced in snippets.
5. **llama.cpp.** Supported. Granite family support long-merged: granite type
   check #20795 (merged 2026-03-20), Granite 4.0 chat template #20804 (merged
   2026-04-02), Granite 4.1 template #23518 (merged 2026-05-28), and llama-bench
   parameter counts for `granite-4.2-3b/8b/30b` updated in #28643 (merged
   2026-09-10). Official IBM GGUFs exist. Q4_K_M =
   **5,347,917,952 bytes** (4.98 GiB); 3B = 2,244,011,552 bytes;
   30B = 17,721,455,328 bytes.
6. **RAM / fit.** 8B: ~5.0 GiB + ~1.0 GiB KV (est.) ≈ 6 GiB → **16 GB tier**;
   sensible both as "Faster" and as a compact "Smarter". 3B: ~2.1 GiB + ~0.6 →
   fits **8 GB**. 30B: ~16.5 GiB + ~1.5 → fits **32 GB**.
7. **Italian/English.** Card's 12 evaluated languages include Italian and
   English (card language list: English, German, Spanish, French, Japanese,
   Portuguese, Arabic, Czech, Italian, Korean, Dutch, Chinese).

**Verdict: add. granite-4.2-8b is a safe Apache "Faster 16 GB" and honest
"Smarter 16 GB" alternative; granite-4.2-3b fills the 8 GB tier.**

### 3. Ling 3.0 Tiny (inclusionAI)

1. **Repo / release / params / arch / context.** `inclusionAI/Ling-3.0-tiny`,
   created 2026-08-10, last modified 2026-09-24
   (https://huggingface.co/inclusionAI/Ling-3.0-tiny). 7.9B total, MoE with
   "only 1.3B activated parameters per token"; "a 3:1 alternating stacking of
   KDA and MLA" (Kimi Delta Attention + Multi-Head Latent Attention); sparse
   FFN with 128 routed experts, 8 + 1 shared active; MTP/NEXTN speculative
   decoding supported. Context: up to 256K with YaRN (base 131,072). Official
   GGUF: `inclusionAI/Ling-3.0-tiny-GGUF` (created 2026-08-30); bartowski and
   many community quants exist.
2. **Licence.** MIT. Commercial use fine, no cap, no AUP gate.
3. **Benchmarks.** The card quotes Artificial Analysis: "a score of 25 on the
   Artificial Analysis Intelligence Index v4.1.1 and 16 on the Artificial
   Analysis Agentic Index", plus speed claims ("over 160 tokens/s", "around
   100-105 tokens/s on DGX Spark and 86-90 tokens/s on an M4 Pro MacBook",
   "~8.34 GiB peak at 8K context"). **No MMLU-Pro, GPQA, IFEval or math/coding
   numbers are given as text — the results table is an image.** For
   comparison, Gemma 4 12B is quoted at "14" on an AA index (version not
   stated on the comparison page) — do not compare across index versions.
4. **Community.** Very positive on speed-per-RAM:
   "Ling 3.0 Tiny is the strongest, fastest and greatest model on my low end
   PC" — "the fastest, smartest model I can run on my poor [PC with] 4GB VRAM"
   (https://www.reddit.com/r/LocalLLaMA/comments/1vqx6nd/);
   "Ling Tiny, King of Speed" — "the best model that works on an AMD 780M iGPU
   with 16GB RAM"; "Ling 3.0 Tiny still seems to be leading the pack despite
   only having 1.3B active" (AA small-model update thread, 300+ upvotes).
   It also runs from a CPU llama.cpp build on a phone ("Ling-3.0-tiny on a
   Galaxy A56: 9 tok/s…", https://x.com post, Aug 23 2026). Complaint in
   snippets: wanted "good dynamic quantizations" (now partly addressed by
   official GGUF).
5. **llama.cpp.** Runs: community GGUFs existed within a day and the **official
   `inclusionAI/Ling-3.0-tiny-GGUF`** is trustworthy (publisher). Q4_K_M =
   **4,823,894,944 bytes** (4.49 GiB). The KDA+MLA hybrid is supported in
   llama.cpp (the same KDA machinery used by the Ling 3.0 family and Kimi-line
   models; the X post above is a llama.cpp CPU build).
6. **RAM / fit.** ~4.5 GiB + ~0.3–0.5 GiB KV (linear-attention layers keep the
   cache tiny) ≈ 5 GiB → fits **8 GB tightly, 16 GB comfortably**. "Faster"
   pick at 16 GB; the 1.3B active params make it the fastest quality model we
   found in that class.
7. **Italian/English.** Not stated on the card; no language list found.
   inclusionAI's Ling line is Chinese/English-focused historically — treat
   Italian quality as **unknown**.

**Verdict: add as "Faster answers" at 16 GB (and optionally 8 GB). Flag
Italian as unverified.**

### 4. Apriel-v1.6-15B (ServiceNow Apriel-1.6-15B-Thinker)

1. **Repo / release / params / arch / context.**
   `ServiceNow-AI/Apriel-1.6-15b-Thinker`, repo created 2025-11-28, blog post
   December 9, 2025 (so **late 2025, not 2026**)
   (https://huggingface.co/ServiceNow-AI/Apriel-1.6-15b-Thinker). 15B dense
   (14,863,859,712 BF16), LLaVA-family **multimodal** (image+text), built on
   Apriel-1.5-15B-Thinker; context 131,072 (vLLM start command
   `--max-model-len 131072`); reasoning output ends with
   "[BEGIN FINAL RESPONSE]".
2. **Licence.** MIT. Commercial use fine, no cap.
3. **Benchmarks.** No independent page found; all numbers on the card are
   publisher-reported: "MMLU Pro: 79 (vs. 77 for Apriel-1.5)"; "GPQA Diamond:
   73 (vs. 71)"; IFBench 69 (IFEval not listed); "AIME 25: 88"; "LCB 81";
   "SWE-bench Verified: 23 (vs. 16 for 1.5)"; AA index "57 (headline)";
   long-context "50*" only "With [DCA] … Without this, the model scores 36."
4. **Community.** Skeptical-wait-and-see. Release thread
   (https://www.reddit.com/r/LocalLLaMA/comments/1pgsodd/, 157 upvotes); the
   most telling thread title: "Anyone here tried Apriel v1.6? Fraud or
   giantkiller?" (https://www.reddit.com/r/LocalLLaMA/comments/1pxl6zs/).
   For the 1.5 predecessor: community consensus "skeptical ('obvious it isn't
   on R1's level') but hopeful". Practical thread asking for a vLLM tool
   parser (…/1qg7zo1/).
5. **llama.cpp.** Community GGUF: `DevQuasar/ServiceNow-AI.Apriel-1.6-15b-Thinker-GGUF`,
   Q4_K_M = **8,785,478,240 bytes** (8.18 GiB) + mmproj. llama.cpp runs it
   with quirks: issue #16454 ("Misc. bug: Slower performance on newer models
   Apriel-1.5-15b, granite-4.0-h-tiny", closed 2025-10-17) reports llama-bench
   "detecting it as llama 34B" and ~3.12 tps vs 12.79 expected; fixed chat
   templates circulate in forks; no merged native support found in the GitHub
   search (only tool-call parsing PR #16932 mentioning Apriel-1.5, merged
   2025-11-18).
6. **RAM / fit.** ~8.2 GiB + ~1 GiB KV → **16 GB** minimum, but the shaky
   llama.cpp path and the reasoning-heavy output format make it a poor Kalsa
   chat model.
7. **Italian/English.** Card: strongest in English; "Output quality may degrade
   in underrepresented languages." No Italian claim.

**Verdict: do not add. Benchmark-vs-experience gap ("Fraud or giantkiller?"),
no stock llama.cpp support, English-centric.**

### 5. Mi:dm K 2.5 Pro (KT)

1. **Repo / release / params / arch / context.** **No Hugging Face repo
   found.** What exists: an arXiv paper "Mi:dm K 2.5 Pro"
   (https://arxiv.org/abs/2603.18788, March 2026, KT Tech Innovation Group):
   "a 32B parameter flagship LLM", 128K context via "a progressive training
   strategy", built with "Depth Upscaling (DuS) with a layer predictor,
   Reasoning SFT, model merging, asynchronous RL". KT's HF org
   (`K-intelligence`, https://huggingface.co/K-intelligence) holds only
   Mi:dm 2.0 models: Midm-2.0-Mini-Instruct (2B, updated Oct 29 2025) and
   Midm-2.0-Base-Instruct (12B); a HF-wide search for "Midm" returns only
   unrelated 2023 user repos. KT sells 2.5 Pro through an "NPU LLM Station"
   (Rebellions ATOM-MAX appliance) per the search results.
2. **Licence.** **N/A — no weights released.** The arXiv paper itself is
   CC BY-NC-SA 4.0 (that is the paper's licence, not a model licence). The
   older open Mi:dm 2.0 models exist, but they are a different, older
   generation.
3. **Benchmarks.** Abstract only claims: "achieves competitive performance"
   and "sets state-of-the-art results on Korean-specific benchmarks" — no
   numbers on the abstract page; **no MMLU-Pro/GPQA/IFEval figures found
   anywhere open**. The KoBBQ Korean-bias preprint references it with
   "competitive performance" (ResearchGate, ~Mar 2026).
4. **Community.** No r/LocalLLaMA or HF discussion found — consistent with a
   closed enterprise model.
5. **llama.cpp.** Impossible: no weights → no GGUF.
6. **RAM / fit.** N/A (32B class would be 32 GB tier anyway).
7. **Italian/English.** Korean-focused with English; paper emphasises "deep
   linguistic and cultural understanding" of Korean. No Italian.

**Verdict: exclude. It is an API/appliance product, not an open-weights model.**

### 6. DiffusionGemma 4 (DiffusionGemma 26B-A4B-it)

1. **Repo / release / params / arch / context.**
   `google/diffusiongemma-26B-A4B-it`, created 2026-06-09
   (https://huggingface.co/google/diffusiongemma-26B-A4B-it). Card: "Based on
   the 26B A4B Mixture-of-Experts (MoE) Gemma 4 architecture"; 25.2B total /
   3.8B active (safetensors ~25.8B BF16, ~51.6 GB); "block-autoregressive
   multi-canvas sampling" — canvas 256 tokens, "15-20 tokens per forward
   pass", up to 48 denoising steps; autoregressive encoder + KV cache,
   decoder with bidirectional attention, sliding window 1024. Context up to
   256K; multimodal (text+image+video in).
2. **Licence.** Apache 2.0 (unusual for a Gemma-family release — confirmed on
   the card page and in the developer-blog coverage).
3. **Benchmarks.** Publisher-reported vs its autoregressive sibling Gemma 4
   26B-A4B (quoted from card table): "MMLU Pro: 77.6% vs 82.6%"; "GPQA
   Diamond: 73.2% vs 82.3%"; "AIME 2026 no tools: 69.1% vs 88.3%";
   "LiveCodeBench v6: 69.1% vs 77.1%"; "Codeforces ELO: 1429 vs 1718".
   **IFEval is not mentioned anywhere on the page.** Speed claims: ">1100
   tokens/sec per user in low-batch settings on H100 FP8" (card); "700+ tok/s
   on RTX 5090" (https://datanorth.ai, Jun 11 2026).
4. **Community.** No dedicated r/LocalLLaMA thread surfaced. Coverage summary:
   "The consensus across reviews is that it's **not as sharp as standard
   autoregressive Gemma** — a tradeoff of diffusion decoding"; HN commenters
   "split between users impressed by the cost-to-quality ratio and skeptics
   who still prefer newer Qwen or GLM variants" (theneuron.ai roundup).
5. **llama.cpp.** **No stock support.** PR #24427 "Add diffusion-gemma
   block-diffusion support" (github.com/ggml-org/llama.cpp) is still **open
   with merge conflicts as of 2026-06-18**; the model runs only on that PR
   branch. `unsloth/diffusiongemma-26B-A4B-it-GGUF` exists (Q4_K_M =
   **16,806,810,208 bytes**, 15.65 GiB) but requires the unfetched-PR build.
   So: llama.cpp can run a diffusion LM only via that patch — not in release
   builds.
6. **RAM / fit.** ~15.7 GiB + KV → 32 GB tier — but see 5.
7. **Italian/English.** "35+ supported out of the box; pre-trained on 140+
   languages" (card). Italian presumably included; not individually verified.

**Verdict: exclude until the PR merges upstream, and re-test quality against
plain Gemma 4 26B-A4B then — it loses to its sibling on every published
number.**

---

## Part 2 — 2026 landscape: other strong candidates for 8–64 GB machines

### Qwen3.5 family (Alibaba) — Feb 27–Mar 2, 2026 — Apache 2.0

`Qwen/Qwen3.5-4B`, `Qwen/Qwen3.5-9B` (+ 0.8B/2B/27B/35B-A3B/122B-A10B/397B-A17B).
Architecture: "Gated Delta Networks combined with sparse Mixture-of-Experts";
context "262,144 natively and extensible up to 1,010,000 tokens"; "Expanded
support to 201 languages and dialects"; thinking by default
(https://huggingface.co/Qwen/Qwen3.5-4B, /Qwen3.5-9B).

Publisher numbers — **Qwen3.5-4B**: MMLU-Pro 79.1; GPQA Diamond 76.2; IFEval
89.8; HMMT Feb25 74.0; LiveCodeBench v6 55.8. **Qwen3.5-9B**: MMLU-Pro 82.5;
GPQA Diamond 81.7; IFEval 91.5; AIME 2026 (MathArena) 92.5; LiveCodeBench v6
65.6. (All quoted from the model cards; treat as publisher-reported.)

llama.cpp: supported — the Gated-DeltaNet "Qwen3Model" architecture landed via
PR #20967 (merge noted in the LlamaCppEx v0.8.51 changelog; secondary source).
Unsloth GGUFs for every size, incl. MTP speculative variants.
Q4_K_M sizes (unsloth): 4B = **2,740,937,888 B** (2.55 GiB); 9B =
**5,680,522,464 B** (5.29 GiB); 2B = 1,280,835,840 B (1.19 GiB).

Community: strongly positive; one caution — Latent.space AINews (Mar 2026)
notes Qwen3.5-9B run at "Q8_0 quantization 'due to quality issues with other
quants'" (snippet; suggest UD/dynamic quants in Kalsa and tune-check).

Fit: 9B → 16 GB Smarter. 4B/2B → 8 GB Faster. 201 languages ⇒ Italian covered.

### Qwen3.6 family (Alibaba) — April 2026 — Apache 2.0

`Qwen/Qwen3.6-27B` (dense, Apr 21 2026), `Qwen/Qwen3.6-35B-A3B` (MoE 35B/3B
active, Apr 15 2026), Plus, Max Preview. Same hybrid DeltaNet layout, 262K
context, thinking by default, vision included.

Publisher numbers — **27B**: MMLU-Pro 86.2; GPQA Diamond 87.8; AIME26 94.1;
HMMT Feb26 84.3; LiveCodeBench v6 83.9; "SWE-bench Verified: 77.2".
**35B-A3B**: MMLU-Pro 85.2; GPQA 86.0; AIME26 92.7; HMMT Feb26 83.6;
LiveCodeBench v6 80.4; "SWE-bench Verified: 73.4". (IFEval absent from both
cards.)

llama.cpp: supported (same arch family as Qwen3.5; `ggml-org/Qwen3.6-27B-GGUF`
official GGUF exists; community testing "llama.cpp currently beats vLLM for
this model" on Intel Arc). Q4_K_M (unsloth): 27B = **16,817,244,344 B**
(15.66 GiB); 35B-A3B UD-Q4_K_M = **22,134,528,992 B** (20.61 GiB).

Community: "roughly 110 tokens per second on an RTX 4070 Super with just 12GB
VRAM" (startupfortune.com, May 21 2026); on Apple Silicon the 35B-A3B "ran
cleanly at 32k context and was ~3x faster than the 27B dense model".

Fit: 27B → 32 GB Smarter. 35B-A3B → 32/64 GB (both roles).

Newer: **Qwen3.8-Flash-Next** (Aug 26, 2026) is a ~125B-class MoE "preview of
the Qwen4 architecture" (https://huggingface.co/Qwen/Qwen3.8-Flash-Next,
thenewstack.io) — **too big for 8–64 GB**, watch for a small Qwen4 instead.

### Gemma 4 (Google) — March 2026 — Apache 2.0 tag

`google/gemma-4-E2B-it` (5.1B total / "2.3B effective" via Per-Layer
Embeddings), `gemma-4-E4B-it` (8B total / 4.5B effective), `gemma-4-12B-it`
(11.95B dense), `gemma-4-26B-A4B-it` (25.2B/3.8B active MoE), `gemma-4-31B-it`
(dense 31B). 128K context (E2B/E4B), 256K (12B/26B/31B); multimodal
(text+image, +audio on E2B/E4B/12B). Licence: HF API tag `apache-2.0` on all
sizes (the card also links a Gemma 4 licence document; the effective terms we
can quote are Apache 2.0). "pre-trained on 140+ languages", "Out-of-the-box
support for 35+ languages" (Italian covered).

Publisher numbers: **E2B** MMLU-Pro 60.0, GPQA-D 43.4, AIME26 37.5, LCB v6
44.0; **E4B** MMLU-Pro 69.4, GPQA-D 58.6, AIME26 42.5, LCB v6 52.0;
**12B** MMLU-Pro 77.2, GPQA-D 78.8, AIME26 77.5, LCB v6 72.0, Codeforces 1659;
**26B-A4B** MMLU-Pro 82.6, GPQA-D 82.3, AIME26 88.3, LCB v6 77.1, Codeforces
1718. **31B** GPQA-D 84.3 (from the 12B card's comparison column).
IFEval is not on any of the pages.

llama.cpp: supported (unsloth published all sizes 2026-04-01; Google publishes
official QAT GGUFs). Known open issues to watch: #28827 "gemma4 thinking
starts to emit progressivly long trailing garbage" (open), #28954 "Images
above ~1.2 Mpx trigger ggml_assert with Gemma4 Models" (open), #26239
"infinite generation / unstable output on gfx1151 (HIP, Windows) with long
prompts" (open). I could not identify the original support PR via GitHub
search — support is evident from the merged-codebase bug reports and the
runnable GGUFs, but treat the exact merge date as unverified.

Q4_K_M sizes: E2B = **3,106,738,272 B** (2.89 GiB, unsloth); E4B =
**4,977,171,584 B** (4.64 GiB, unsloth, +mmproj); 12B = **7,662,533,088 B**
(7.14 GiB, bartowski, +mmproj); 26B-A4B UD-Q4_K_M = **16,947,541,728 B**
(15.78 GiB, unsloth); 31B = **18,323,733,440 B** (17.06 GiB, unsloth).

Community: "Gemma 4 feels better in conversations, reasons shorter, and
doesn't have the 'genshin impact' bias when describing anime pictures"
(https://www.reddit.com/r/LocalLLaMA/comments/1sb9f4g/). Negatives: small
variants' vision "mixed reviews" (plainenglish.io); "Why Gemma 4 QAT Struggles
in Local Coding Agents" (testquality.com); HN: "the 12B likely underperforms
on coding vs. Qwen 3.6 35B A3B, Gemma 4 26B A4B, and Nemotron 3 Nano 30B"
(https://news.ycombinator.com/item?id=48385906).

### Ministral 3 (Mistral) — Oct 31, 2025 — Apache 2.0

`mistralai/Ministral-3-8B-Instruct-2512` (+3B/14B, Instruct+Reasoning). 8.9B
total ("8.4B Language Model" + "0.4B Vision Encoder"), dense; "Supports a 256k
context window"; language tags include `it` (Italian). Publisher: "GPQA
Diamond: … 0.668 (Reasoning)"; "AIME25 = 0.787"; "LiveCodeBench = 0.616
(Reasoning)"; Instruct "Arena Hard = 0.509", "MMLU 5-shot = 0.761" (base).
**MMLU-Pro and IFEval are not reported.** Official GGUFs from mistralai and
`ggml-org` (day-one llama.cpp); 8B Q4_K_M = **5,198,911,904 B** (4.84 GiB);
14B Q4_K_M = 8,239,593,024 B (7.67 GiB).
Community: mixed — "Ministral 3 frequently fell into repetitive…" (release
thread …/1pcayfs/); 14B "performing almost on par with Mistral Small and
Gemma" (…/1pcgzkc/). Fit: 16 GB.

### Phi (Microsoft)

No Phi-5 exists on HF: `api.models?author=microsoft&search=Phi-5` returns only
`microsoft/phi-1_5` (2023). The "Phi-5 Medium 14B" claim circulating on
aggregator blogs (llmcheck.net) is **unverified by any primary source I could
open**. The newest verifiable Phi in our catalog is `microsoft/Phi-mini-MoE-instruct`
(June 2025) — see Part 3. Conclusion: nothing to add from Microsoft in 2026.

### SmolLM / OLMo

- **SmolLM4: no release found.** `HuggingFaceTB` search for SmolLM4 returns an
  empty list on 2026-09-26. SmolLM3 (2025) remains the latest; it does not
  beat anything in our tiers on known numbers → not recommended.
- **OLMo 3 / 3.1 (AI2, Nov–Dec 2025)** — `allenai/Olmo-3-1125-32B`,
  `Olmo-3.1-32B-Instruct` / `Olmo-3-7B-Instruct`, Apache 2.0, fully-open data.
  No 2026 refresh found. Honest position: great licence and provenance, but no
  published numbers I found beat Qwen3.5-9B / granite-4.2-8b in the same RAM
  tiers → bench-off candidate only.

### EXAONE / K-EXAONE (LG)

`LGAI-EXAONE/K-EXAONE-2.0-750B-A37B` (created 2026-08-05) is Korea's largest
open-weight model — **750B, far beyond 64 GB**. `EXAONE-4.0-32B` (Jul 2025)
carries licence tag **`license:other`** (EXAONE licence family; non-OSI —
LG's EXAONE licences have historically restricted commercial use). For a
commercial desktop app: exclude unless LG's terms are cleared.

### NVIDIA Nemotron 3 Nano 30B-A3B — Dec 2025

`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16`: `NemotronHForCausalLM`
(hybrid Mamba-attention MoE, 6 experts/token), created 2025-12-04, licence
**`nvidia-nemotron-open-model-license` (tag `other`, non-OSI — check terms
before commercial bundling)**. Well liked locally; HN cites it above Gemma 4
12B for coding. unsloth Q4_K_M = **24,574,373,664 B** (22.88 GiB) → 32 GB
tier. Keep as bench-off candidate behind Apache options.

### Muse-Glimmer-30B (Meta Superintelligence Labs) — Aug 9–10, 2026

`meta-models/Muse-Glimmer-30B`: ~29.6B dense multimodal "agentic" model,
**Apache 2.0**; NVFP4 build by NVIDIA (Aug 28 2026). unsloth GGUF exists
(UD-Q4_K_XL = **15,878,222,368 B**, 14.79 GiB; no plain Q4_K_M in the unsloth
repo) → 32 GB tier. Evidence so far is thin: **no MMLU-Pro/GPQA/IFEval found**;
the best independent data point is indirect — in IFM's K2 card table
"Muse Glimmer-30B 24.0" loses tau3-Banking to K2-Horizon-7B's 25.8, and the
community quipped K2 "Casually destroys Muse Glimmer with a way smaller size".
Bench-off candidate, not a default pick.

### Too big for every Kalsa tier (for completeness)

- **Mistral Small 4**: 119B total / 6.5B active MoE; "approximately 79.5 GB of
  VRAM with Q4_K_M" (willitrunai.com, via search) → does not fit 64 GB.
- **DeepSeek V4 Flash**: "284B total / 13B active params"
  (api-docs.deepseek.com) → no.
- **K-EXAONE-2.0-750B-A37B** → no.
- **Qwen3.5-397B-A17B / 122B-A10B** → 122B does not fit at Q4 (≈73 GB).

---

## Part 3 — Re-judging the current catalog rows

| Row (repo) | Verdict | Evidence |
|---|---|---|
| `google/gemma-4-E2B-it` | **KEEP — 8 GB "Smarter"** | Apache 2.0 tag; MMLU-Pro "60.0%" at 2.3B effective is class-leading (card); Q4_K_M 2.89 GiB fits 8 GB; official QAT + unsloth GGUF; community: "Gemma 4 feels better in conversations" (r/LocalLLaMA 1sb9f4g). Watch llama.cpp bug #28827 (trailing garbage in thinking). |
| `Qwen/Qwen3.5-4B` | **KEEP — 8/16 GB "Faster"** | MMLU-Pro 79.1, GPQA 76.2, IFEval 89.8, 201 languages (card, publisher); hybrid DeltaNet ⇒ tiny KV, fast; unsloth GGUF 2.55 GiB. Caveat: community ran siblings at Q8_0 "due to quality issues with other quants" — prefer UD quants; validate on device. |
| `mistralai/Ministral-3-8B-Instruct-2512` | **REMOVE (demote to bench-off)** | Apache 2.0 + official/ggml-org GGUFs are fine, but card publishes no MMLU-Pro/IFEval; community: "Ministral 3 frequently fell into repetitive…" (…/1pcayfs/) and 14B-relative disappointment (…/1pd5yxy/). The 16 GB slots are better filled by Qwen3.5-9B / Ling-3.0-tiny / granite-4.2-8b. |
| `llm-jp/llm-jp-4-32b-a3b-thinking` | **REMOVE for Kalsa** | Apache 2.0, qwen3_moe arch (runs in llama.cpp), official GGUF (21,400,590,272 B = 19.93 GiB) — but languages are English+Japanese only; only publisher MT-Bench numbers exist ("7.82 MT-Bench JA (medium)", judged by gpt-5.4); "not been tuned to ensure outputs align with human intent and safety" (card). No Italian. Wastes a 32 GB slot for an Italian/English product. |
| `amd/Instella-MoE-16B-A3B-Think` | **REMOVE — licence** | "ResearchRAIL — licensed for academic and research purposes … released for research purposes only" (card). Not usable in a commercial app. Also English-tagged only, no benchmark numbers quoted on card. |
| `LiquidAI/LFM2.5-8B-A1B` | **REMOVE (owner decision confirmed)** | Already rejected by the owner. Corroborating: custom `lfm1.0` licence ("license:other"), and card shows "AA-Omniscience Index: -24.70" despite IFEval 91.84 — a memorisation-heavy profile. 5,155,564,768 B Q4_K_M. |
| `microsoft/Phi-mini-MoE-instruct` | **REMOVE** | 2025 model: 7.6B/2.4B MoE, **4k context** (card), English-only, MMLU-Pro "49.68" — far below everything else we keep (Qwen3.5-4B: 79.1). GGUF is third-party (`smarttasks/…`), 4,993,133,088 B. Obsolete. |
| `ibm-granite/granite-4.0-h-tiny` | **REMOVE — superseded** | MMLU-Pro 44.94 / GPQA 32.59 (card, Oct 2025) vs granite-4.2-8b 74.04/64.14. Replace with `granite-4.2-3b` (2,244,011,552 B Q4_K_M, Apache, official GGUF). |
| `google/gemma-4-26B-A4B-it` | **KEEP — 32 GB "Faster" (also 64 GB)** | MMLU-Pro 82.6, GPQA-D 82.3, AIME26 88.3 (card); 3.8B active ⇒ fast; official QAT q4_0 GGUF + unsloth UD-Q4_K_M 15.78 GiB. Fits 32 GB with room. |
| `google/gemma-4-E4B-it` | **KEEP — 16 GB "Faster" alternative** | MMLU-Pro 69.4, GPQA-D 58.6 (card); 4.64 GiB Q4_K_M; audio+vision. Slightly behind Ling-3.0-tiny on speed-per-RAM; keep as the multimodal/multilingual-safe option. |
| `Qwen/Qwen3.6-35B-A3B` | **KEEP — 32/64 GB "Smarter" and "Faster"** | MMLU-Pro 85.2, GPQA 86.0, AIME26 92.7, SWE-bench Verified 73.4 (card, publisher); ~110 tok/s on an RTX 4070 Super (community); UD-Q4_K_M 20.61 GiB fits 32 GB. |
| `google/gemma-4-12B-it` | **KEEP — 16 GB "Smarter" alternative** | MMLU-Pro 77.2, GPQA-D 78.8 (card); 7.14 GiB Q4_K_M (bartowski) fits 16 GB; HN considers it weaker than Qwen3.6-35B/Gemma-26B/Nemotron-30B at coding — that's why Qwen3.5-9B leads the tier on paper. |

### Rows to ADD

| New row | Slot | Why |
|---|---|---|
| `Qwen/Qwen3.5-9B` (unsloth GGUF) | **16 GB "Smarter"** | Best published small-model numbers we found: MMLU-Pro 82.5, GPQA-D 81.7, IFEval 91.5 (card, publisher); 5.29 GiB Q4_K_M; Apache; 201 languages (Italian). |
| `inclusionAI/Ling-3.0-tiny` (official GGUF) | **16 GB "Faster"** | 1.3B active ⇒ fastest in class; "25 on the Artificial Analysis Intelligence Index v4.1.1" (card quoting AA); MIT; official GGUF 4.49 GiB; community "fastest, smartest… on my low end PC". Flag: Italian unverified. |
| `ibm-granite/granite-4.2-8b` (official GGUF) | **16 GB all-round alternative / bench-off** | MMLU-Pro 74.04, SWE-bench Verified 47.67 (card); Apache; thinking mode; Italian tested by IBM. |
| `Qwen/Qwen3.6-27B` (ggml-org/unsloth GGUF) | **32 GB "Smarter"** | MMLU-Pro 86.2, GPQA-D 87.8, SWE-bench Verified 77.2 (card, publisher) — the highest dense-model numbers that fit any tier; 15.66 GiB Q4_K_M; Apache; hybrid KV ⇒ small cache. |
| `ibm-granite/granite-4.2-3b` (official GGUF) | **8 GB "Faster" candidate** | Apache; official GGUF 2.09 GiB; same reasoning recipe as the 8B; **no benchmark numbers found for the 3B specifically** — pick it after an on-device A/B vs gemma-4-E2B and Qwen3.5-2B. |

Bench-off candidates (add only after local tuning wins): granite-4.2-30b
(16.50 GiB), gemma-4-31B (17.06 GiB), Muse-Glimmer-30B (14.79 GiB),
Nemotron-3-Nano-30B-A3B (22.88 GiB, licence check needed),
Ministral-3-14B-Instruct-2512 (7.67 GiB → 16 GB).

---

## Part 4 — Ranking per RAM tier (recommendation)

Estimated RAM = Q4_K_M GiB + KV at 8k (est.) + OS overhead; "Smarter" maximises
quality evidence, "Faster" maximises speed evidence at acceptable quality.
All primary numbers are publisher-reported (model cards) unless noted;
independent-leaderboard coverage of this 2026 generation was scarce
(see honesty notes).

### 8 GB RAM

| Role | Model | Why (evidence) | Est. RAM |
|---|---|---|---|
| Smarter | **gemma-4-E2B-it** (unsloth/google QAT GGUF) | MMLU-Pro 60.0, GPQA-D 43.4 (card); best under-3B-effective scores found; 2.89 GiB Q4_K_M; Apache; Italian in the 35+ OOTB set | ~3.5 GiB + OS |
| Faster | **Qwen3.5-2B** (unsloth GGUF) — or granite-4.2-3b after A/B | 1.19 GiB Q4_K_M; hybrid DeltaNet ⇒ fastest; 201 languages; **no specific benchmarks found for the 2B** — this slot is picked on architecture and footprint; granite-4.2-3b (2.09 GiB) is the quality-safe alternative with IBM's Italian testing | ~1.5–2.8 GiB |

(Rejected for this tier: K2-Horizon-7B — no stock llama.cpp; SmolLM — no 2026
release found; Ministral-3-3B — community "underwhelming", repetitive reports.)

### 16 GB RAM

| Role | Model | Why | Est. RAM |
|---|---|---|---|
| Smarter | **Qwen3.5-9B** | MMLU-Pro 82.5, GPQA-D 81.7, IFEval 91.5 (card, publisher); 5.29 GiB Q4_K_M; 201 languages; r/LocalLLaMA treats it as the small-model reference point Ling Tiny is compared against | ~6 GiB |
| Faster | **Ling-3.0-tiny** (official GGUF) | 25 on AA Intelligence Index v4.1.1 (card quoting AA); 1.3B active; "fastest, smartest model… on my low end PC" + "King of Speed" (r/LocalLLaMA); 4.49 GiB; MIT | ~5 GiB |
| Alternates | gemma-4-12B-it (7.14 GiB; MMLU-Pro 77.2, vision+audio) · granite-4.2-8b (4.98 GiB; MMLU-Pro 74.04, SWE-v 47.67) · gemma-4-E4B-it (4.64 GiB) · Qwen3.5-4B (2.55 GiB; MMLU-Pro 79.1) | all Apache/MIT, all with trusted GGUFs | — |

(Rejected/removed here: Ministral-3-8B (repetitiveness, thin published
numbers); Apriel-1.6-15B (llama.cpp quirks, benchmark scepticism);
K2-Horizon-7B (fork-only).)

### 32 GB RAM

| Role | Model | Why | Est. RAM |
|---|---|---|---|
| Smarter | **Qwen3.6-27B** (ggml-org GGUF) | MMLU-Pro 86.2, GPQA-D 87.8, AIME26 94.1, SWE-bench Verified 77.2 (card, publisher) — best numbers of anything that fits a 32 GB machine; 15.66 GiB Q4_K_M; hybrid KV | ~17 GiB |
| Faster | **gemma-4-26B-A4B-it** (Google QAT or unsloth UD-Q4_K_M) | 3.8B active MoE ⇒ near-3B speed; MMLU-Pro 82.6, GPQA-D 82.3, AIME26 88.3 (card); official QAT GGUF designed for 4-bit; 15.78 GiB | ~17 GiB |
| Also strong | Qwen3.6-35B-A3B (20.61 GiB; MMLU-Pro 85.2, SWE-v 73.4) — pick it as Smarter instead if users need 16k+ context or coding agents | | ~21 GiB |
| Bench-off | granite-4.2-30b (16.50 GiB, Apache) · gemma-4-31B (17.06 GiB) · Muse-Glimmer-30B (14.79 GiB, Apache, thin evidence) · Nemotron-3-Nano-30B-A3B (22.88 GiB, licence "other") | | — |

(Excluded: DiffusionGemma-26B-A4B — no stock llama.cpp and loses to plain
Gemma 26B-A4B on every published number; llm-jp-4-32b — en/ja only.)

### 64 GB RAM

| Role | Model | Why | Est. RAM |
|---|---|---|---|
| Smarter | **Qwen3.6-35B-A3B** at Q8_0 (or UD-Q4_K_M with very long context) | Best scores that fit with headroom (MMLU-Pro 85.2, GPQA 86.0, AIME26 92.7, SWE-v 73.4, card); 3B active keeps even Q8_0 fast; ~40 GiB at Q8_0 (est.) | ~42 GiB |
| Faster | **gemma-4-26B-A4B-it** UD-Q4_K_M | Same evidence as 32 GB row; leaves 40+ GiB free for context/documents | ~17 GiB |
| Honest gap | Nothing open fits 64 GB that clearly beats Qwen3.6-35B-A3B: Mistral Small 4 ≈ 79.5 GB at Q4_K_M (willitrunai), Qwen3.5-122B-A10B ≈ 73 GB (est.) — both overflow | | — |

---

## Part 5 — Remove from the catalog

1. **arcee-ai/Trinity-Nano-Preview** — owner's decision; nothing in this
   research rehabilitates it (no serious benchmarks found anywhere in searches).
2. **amd/Instella-MoE-16B-A3B-Think** — ResearchRAIL licence: "released for
   research purposes only" → cannot ship commercially; English-only.
3. **microsoft/Phi-mini-MoE-instruct** — 4k context, 2025 vintage, MMLU-Pro
   49.68, English-only, third-party GGUF. Strictly dominated.
4. **ibm-granite/granite-4.0-h-tiny** — superseded by Granite 4.2 (MMLU-Pro
   44.94 vs 74.04 at the 8B size; the 3B slot is better served by
   granite-4.2-3b).
5. **llm-jp/llm-jp-4-32b-a3b-thinking** — Japanese/English only (no Italian),
   MT-Bench-only published numbers, safety-alignment caveat in the card. Remove
   unless a Japanese market row is ever needed.
6. **LiquidAI/LFM2.5-8B-A1B** — owner-rejected; stands (custom lfm1.0 licence,
   negative AA-Omniscience on card).
7. **mistralai/Ministral-3-8B-Instruct-2512** — demote/remove: fine licence and
   GGUFs, but no MMLU-Pro/IFEval published and community reports of
   repetitiveness; every 16 GB slot it could fill has a better-evidenced model.

**Do NOT add (evaluated, rejected):** K2-Horizon-7B (fork-only llama.cpp),
DiffusionGemma-26B-A4B (PR #24427 unmerged; weaker than sibling), Apriel-1.6
(llama.cpp quirks, reception sceptical, English-centric), Mi:dm K 2.5 Pro (no
open weights), Qwen3.8-Flash-Next / Mistral Small 4 / DeepSeek V4 Flash /
K-EXAONE-2.0 (do not fit ≤64 GB), EXAONE-4.0-32B & Nemotron-3-Nano (non-OSI
licences; bench-off only), SmolLM4 & Phi-5 (do not exist).

**Watch list:** the K2-Horizon llama.cpp PR; the DiffusionGemma PR #24427;
llama.cpp gemma4 open bugs #28827/#28954/#26239; a future small Qwen4;
Granite 4.3; Ling-3.0-tiny Italian quality reports.

---

# Part 6 — Chat quality, Qwen3.8-27B, speed (added 2026-09-26, follow-up)

Owner's reframe, taken as ground truth for this section: Kalsa is a general
CHAT assistant, often in ITALIAN, not a coding tool; MMLU-Pro/GPQA rank the
wrong thing; the community's "Qwen is benchmaxxed (code/math/IF/agentic),
Gemma 4 is the better general assistant (chat, writing, non-English, ~50%
shorter thinking)" position must be tested; and on the owner's M1 Max, dense
Qwen3.6-27B runs ~7 tok/s and gemma-4-26B-A4B runs SLOWER than
Qwen3.6-35B-A3B.

Method notes for this part: LMArena and eqbench.com numbers were read live on
2026-09-26 with a real browser (the tables are JS-rendered and invisible to
plain fetches); reddit content is quoted from search snippets (direct fetches
still return shell pages); every number below carries its source and an
independent/publisher label.

## 6.1 Qwen3.8-27B — the model Part 1 missed

1. **Repo / release / params / arch / context.** `Qwen/Qwen3.8-27B`, created
   **2026-08-05**, last modified 2026-08-14
   (https://huggingface.co/Qwen/Qwen3.8-27B). Dense — "BF16: 27781427952"
   (~27.8B), no active split. "Causal Language Model with Vision Encoder";
   hybrid layout "16 × (3 × (Gated DeltaNet → FFN) → 1 × (Gated Attention →
   FFN))", 64 layers, MTP trained. Context: "262,144 natively and extensible
   up to 1,000,000 tokens".
2. **Licence.** "license:apache-2.0". Commercial use fine, no cap, no AUP
   gate. 6,652,309 downloads last month; 16,344 likes; 202 discussions.
3. **Benchmarks.** Card (publisher-reported) is entirely agentic/code/vision:
   "GPQA Diamond: 89.2"; "SWE-bench Pro: 61.7"; "Terminal Bench 2.1
   (Terminus): 73.0"; "LiveCodeBench v6: 90.3"; "IFBench: 79.5"; "HLE: 30.8
   — Judged by GPT-4o." **MMLU-Pro, IFEval, math (AIME/HMMT), creative
   writing and multilingual scores are not on the card.** Independent,
   chat-relevant (live-read, below): LMArena overall #95, 1438 ±6 (16,383
   votes); Creative-Writing category #157, 1364 ±11; Multi-Turn #97,
   1444 ±12. EQ-Bench Creative Writing: rubric **77.50**, Elo 1671.3 — below
   gemma-4-12B-it (78.55) despite 2.3× the parameters. Not on EQ-Bench 3.
4. **Community.** Simon Willison (Aug 16, 2026,
   https://simonwillison.net/2026/Aug/16/qwen-38-27b/): quality "excellent…
   can write code, drive tools, annotate images and generally do everything
   that I need from an LLM", but the default reasoning effort xhigh is
   "absolutely not a good way to run the model" — it used "22,276 reasoning
   tokens to produce 3,223 tokens of output" on one prompt. "The only thing
   holding this back from being a daily driver is performance." This is the
   strongest single data point that Qwen3.8-27B is tuned for benchmarks and
   agents, not chat latency.
5. **llama.cpp / GGUF.** Supported — same "Qwen3Model" hybrid architecture
   family as Qwen3.5/3.6; **ggml-org/Qwen3.8-27B-GGUF** (official,
   2026-08-14), plus unsloth (2026-08-13) and bartowski (2026-08-14). unsloth
   **UD-Q4_K_M = 16,464,440,224 bytes (15.34 GiB)** + mmproj ~0.87 GiB.
   Unsloth's local guide: "runs on setups with just 17GB RAM/VRAM"
   (https://unsloth.ai).
6. **RAM / fit.** ~15.3 GiB + ~0.5 GiB KV (hybrid) → **32 GB minimum**, but
   speed rules it out for ordinary machines (see 6.5): dense 27B at M1-M4
   speeds ≈ the owner's ~7 tok/s class.
7. **Italian/English.** No language claims on the card; nothing found
   anywhere about its Italian.

**Small/medium Qwen3.8 MoE? No.** The complete Qwen3.8 family on HF (API
listing, 2026-09-26): `Qwen3.8-27B` (dense, 08-05), `Qwen3.8-2.4T-A95B` +
FP8 (08-08), `Qwen3.8-27B-FP8` (08-13), `Qwen3.8-Flash-Next` + FP8 (08-24,
~125B-class). Nothing between 27B dense and 125B. A small Qwen4/Qwen3.8 MoE
remains the thing to watch.

## 6.2 Chat-quality evidence (all independent, read live 2026-09-26)

**LMArena text leaderboard** (https://arena.ai/leaderboard/text — format:
rank · model · licence · Elo ±CI · votes). Human-preference votes:

| Model | Overall | Creative Writing | Multi-Turn |
|---|---|---|---|
| gemma-4-31b | **#73 · 1453 ±7** (6,135 votes) | #80 · 1419 ±19 | #67 · **1465** ±17 |
| qwen3.5-397b-a17b | #88 · 1442 ±3 | #95 · 1405 ±6 | — |
| **qwen3.8-27b** | #95 · 1438 ±6 (16,383 votes) | #157 · **1364** ±11 | #97 · 1444 ±12 |
| **gemma-4-26b-a4b** | #96 · 1438 ±7 (6,078) | #106 · **1399** ±18 | #87 · **1449** ±17 |
| muse-glimmer | #118 · 1424 ±10 | #156 · 1365 ±23 | #112 · 1430 ±24 |
| qwen3.5-27b | #146 · 1409 ±4 | #164 · 1358 ±9 | — |
| qwen3.5-35b-a3b | #163 · 1394 ±4 | #182 · 1342 ±9 | #165 · 1395 ±8 |
| granite-4.2-30b | #227 · 1341 ±10 | — | #244 · 1320 ±27 |
| granite-4.2-3b | #283 · 1292 ±12 | — | #277 · 1287 ±29 |
| granite-4.2-8b | #287 · 1289 ±11 | — | #292 · 1270 ±29 |

**Not listed anywhere on the LMArena text board** (checked to the bottom of
the ~370-row table): gemma-4-12B, gemma-4-E4B, gemma-4-E2B, Qwen3.5-9B,
Qwen3.5-4B, Qwen3.6-27B, Qwen3.6-35B-A3B, Ling-3.0-tiny. For those, chat
quality must be inferred from family + publisher data; say so to users.

**Language categories on LMArena:** English, Chinese, French, German,
Spanish, Russian, Japanese, Korean — **there is no Italian category**
(navigation read live). So no arena-style Italian evidence exists there.

**EQ-Bench Creative Writing leaderboard** (https://eqbench.com/creative_writing.html;
LLM-judged; columns Model · Slop · Length · Rubric Score · Elo Score; exact
rows as displayed):

- "Qwen3.8-2.4T-A95B 1.7 i 3.5 6046 83.60 1842.5"
- "Muse-Glimmer-30B 1.7 i 4.0 5837 81.30 1798.3"
- "Qwen3.8-27B 1.7 i 4.2 5400 77.50 1671.3"
- "Inkling 2.1 i 4.2 8378 81.90 1610.8"
- "Inkling-Small 2.0 i 3.8 8589 77.65 1491.4"
- "Qwen3.5-397B-A17B 3.4 i 5.2 5871 80.00 1478.2"
- "gemma-4-31B-it 4.1 i 5.7 5884 80.05 1368.2"
- "gemma-4-26B-A4B-it 4.4 i 6.4 6824 80.15 1304.6"
- "gemma-4-12B-it 4.5 i 6.5 6900 78.55 1288.9"
- "NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4 3.1 i 3.5 11382 71.95 1280.3"

Read honestly: by rubric score the Gemma 4 trio (78.55–80.15) writes as well
as or better than Qwen3.8-27B (77.50) at a third of the size, and
Muse-Glimmer-30B (81.30) is the best open writing model that fits our tiers.
Two caveats kept visible: Gemma's "slop" (cliché-phrase) metric is the worst
of the group (5.7–6.5 vs Qwen's 3.5–4.2), and its Elo is dragged down by
style/verbosity factors — humans on LMArena still rank the Gemmas far above
Qwen3.8-27B for writing (1419/1399 vs 1364).

**EQ-Bench 3 (emotional intelligence)** (https://eqbench.com/eqbench3.html;
score is the last number in each row):
"gemma-4-31B-it … 1434.1"; "gemma-4-26B-A4B-it … 1430.6";
"Qwen3.5-397B-A17B … 1413.1"; "gemma-4-12B-it … 1361.2".
Qwen3.8, Ling-3.0, Granite: **not listed**. A 397B-parameter Qwen scores
below a 26B Gemma on EQ — strong support for the owner's position.

**Verbosity (thinking-trace length).** Community measurements, r/LocalLLaMA
(snippet quotes): "reasoning token needed for gemma4 is 60%+ less generally
and that on its own is a big win"
(https://www.reddit.com/r/LocalLLaMA/comments/1sapl6k/); "Gemma 4 31B is far
more efficient with token use" while Qwen is "benchmaxxed"
(…/1t4nkez/); "gemma uses significantly less reasoning tokens than qwen"
(…/1sc6fbq/); "Qwen often thinks too much" (…/1saoyj7/). Qwen3.8-27B's
xhigh default makes it extreme: "22,276 reasoning tokens to produce 3,223
tokens of output" (Willison). This matches the owner's "~50% shorter"
observation.

**Hallucination / factuality.** No SimpleQA and no AA-Omniscience figure was
found for ANY Gemma 4 or Qwen 3.5–3.8 model (cards and searches; the
AA-Omniscience tables that exist publicly cover closed models and Nemotron 3
Ultra — "AA-Omniscience score of 78.7" per NVIDIA's X post). The only number
in our set remains LFM2.5-8B-A1B's "AA-Omniscience Index: -24.70" (card,
publisher). **Say "no independent factuality benchmark found" for the chat
candidates.**

## 6.3 Italian evidence — what exists and what is broken

- **Gemma 4 cards** (publisher): MMMLU — 31B "88.4%", 26B-A4B "86.3%", 12B
  "83.4%", E4B "76.6%", E2B "67.4%", Gemma 3 27B "70.7%" (from
  https://huggingface.co/google/gemma-4-12B-it table). "Out-of-the-box
  support for 35+ languages, pre-trained on 140+ languages." No per-language
  table, no explicit Italian sentence.
- **Qwen3.5 cards** (publisher): "Expanded support to 201 languages and
  dialects" — but no MMMLU/Global-MMLU number is published for Qwen3.5–3.8,
  so **no head-to-head multilingual score exists** between these families.
- **MMLU-ProX** (arXiv 2503.10497) has an Italian split but predates these
  models; **no Gemma 4 / Qwen 3.5–3.8 MMLU-ProX Italian result was found**.
- **INCLUDE / Global-MMLU rows for these models: not found** on any card.
- **ItaEval leaderboard** (https://huggingface.co/spaces/RiTA-nlp/ita-eval):
  **broken as of 2026-09-26** — the Space crashes at startup with
  "FileNotFoundError: [Errno 2] No such file or directory:
  './eval-results/model_info.yaml'". No rankings retrievable.
- **LMArena:** no Italian language category (see 6.2).
- **Granite 4.2** card lists Italian among its 12 evaluated languages
  (Part 1) — but its LMArena chat Elo (1289–1341) shows it is not a chat
  model.
- Niche signal: "Dante-2B", a 2.1B bilingual Italian/English model built
  from scratch precisely because "most open-source LLMs treat Italian as
  secondary" (r/LocalLLaMA post / ai-pulse-ashen.vercel.app) — evidence the
  big models' Italian is good-not-perfect, not a candidate for our catalog.

**Conclusion for Italian:** the best available evidence is family-level —
Gemma 4's MMMLU (86.3–88.4% at 26B+) and 140+-language pretraining, plus
community consensus that Gemma leads non-English quality. No direct Italian
benchmark for any 2026 candidate could be cited. Kalsa should run its own
small Italian chat/translation eval before shipping claims.

## 6.4 Community: Qwen vs Gemma for chat, writing, languages

- "Gemma is so much better than Qwen, prove me wrong" —
  https://www.reddit.com/r/LocalLLaMA/comments/1tl3jui/ — the summary
  comment: "Qwen 3.6 does better by doing more inference. If you don't like
  that and the loops, then Gemma 4 would be your next stop for sure."
- "Gemma 4 and Qwen3.5 on shared benchmarks" — …/1saoyj7/ — "Qwen often
  thinks too much"; Qwen "way better" at image processing.
- "Dense Model Shoot-Off: Gemma 4 31B vs Qwen3.6/5 27B" — …/1t4nkez/ —
  Qwens are more "benchmaxxed"; "Gemma 4 31B is far more efficient with
  token use."
- Counterpoint: "Qwen 3.6 35B crushes Gemma 4 26B on my tests" (thread title
  surfaced in search) — Qwen wins accuracy on hard analytical tasks and
  "produces ~8x more tokens/time", catching numerical details Gemma missed.
  Right model for the "coding/math" shelf, wrong default for chat.
- Medium (tort_mario, "Local LLMs in Real Work: Gemma 4, Qwen 3.6"):
  "thinking mode made models worse at following instructions" — for chat,
  ship Gemma with thinking short/off by default.
- HN on Gemma 4 12B (https://news.ycombinator.com/item?id=48385906):
  "Qwen 3.5 9B is great for coding, but based on subjective tests, the Gemma
  4 12B seems even better" — and (Part 1) the same thread ranks 12B below
  Qwen3.6-35B/Nemotron-30B for heavy coding. 12B = the chat sweet spot.

**Net:** the owner's community summary is confirmed by every independent
chat metric we could find (arena overall/writing/multi-turn, EQ-Bench 3,
creative-writing rubric, verbosity). Qwen keeps the code/math/agentic crown.

## 6.5 Decode speed at Q4 on Apple Silicon and DGX Spark

Ground truth (owner's M1 Max): dense Qwen3.6-27B ≈ **7 tok/s**;
gemma-4-26B-A4B slower than Qwen3.6-35B-A3B. Everything below is consistent
with that.

| Model | Chip / device | tok/s | Quant | Source |
|---|---|---|---|---|
| Qwen3.8-27B | DGX Spark | "20-27" stock, "34-38" tuned | (llama.cpp/vLLM) | NVIDIA dev forums, Aug 15 2026 (title: "Qwen3.8-27B at 34–38 tok/s on DGX Spark"; opener: "stuck around 20-27 tok/s … with llama.cpp or vLLM") |
| Qwen3.8-27B | M5 Mac | "around 15-30 tokens a second" (LM Studio); "roughly 72% faster … with MTP speculative decoding on the Spark" | Q4-class | https://simonwillison.net/2026/Aug/16/qwen-38-27b/ |
| Qwen3.6-35B-A3B | RTX 4070 Super 12 GB | "~110 tokens per second" | Q4 | startupfortune.com, May 21 2026 (community benchmark) |
| Qwen3.6-35B-A3B | Apple Silicon (MLX) | "~3x faster than the 27B dense model" (27B ≈ 7 tok/s on M1 Max ⇒ ~20 tok/s class) | UD-Q4_K_M | ez-local-llama-cpp-mac GitHub docs (Part 1) + owner's 27B figure |
| gemma-4-26B-A4B | M-series laptops | "~27 tok/s" | Q3 (~11.2 GB) | localcode 0.3.39 docs via libraries.io |
| gemma-4-26B-A4B | M4 Pro Mac mini | "~62 tok/s" | MLX | Hacker News "My local model setup on an M4 Pro Mac Mini", Sep 2026 |
| gemma-4-12B | Tesla P100 16 GB (non-Mac reference) | "22.3 tok/s" | GGUF | llm-benchmark.de; **no reliable M-series figure found** |
| Qwen3.5-9B | M4 Pro Mac mini 24 GB | "Generation: 51 tok/s", "Prompt processing: 362 tok/s" | 4-bit MLX | LinkedIn "LLM Benchmarks: Real-World Performance vs Best Case" |
| Ling-3.0-tiny | M4 Pro MacBook | "86-90 tokens/s" (publisher, FP8 not Q4) | FP8 | model card, https://huggingface.co/inclusionAI/Ling-3.0-tiny |
| Ling-3.0-tiny | Galaxy A56 (phone, CPU llama.cpp) | "9 tok/s" | community GGUF | X post, Aug 23 2026 |

Not found, said plainly: a direct M1–M4 tok/s number for Qwen3.6-35B-A3B,
gemma-4-12B and Ling-3.0-tiny at Q4 (llamabench.ai has a Ling-3.0-tiny page
but it did not open at the addressed path). Use the owner's M1 Max ordering
(MoE Qwen 35B > MoE Gemma 26B > dense 27B) as the Mac ranking.

## 6.6 Revised recommendations for a CHAT product

The Part 4 ranking ranked the wrong thing for Kalsa (it used MMLU-Pro/GPQA
as the tiebreaker). Revised tiers — chat quality (arena + EQ-Bench) and
Italian first, speed second, MMLU-Pro/GPQA only as a floor check:

**8 GB**
- Smarter: **gemma-4-E2B-it** — weakly evidenced (no arena/EQ-Bench entry;
  MMMLU "67.4%" publisher) but the only sub-3B-effective model with 35+
  languages and vision; Apache; 2.89 GiB Q4_K_M.
- Faster: **granite-4.2-3b** (official GGUF 2.09 GiB; arena #283 · 1292 —
  low but measured; IBM tests Italian) or **Qwen3.5-2B** (1.19 GiB; no chat
  scores). Pick after the on-device A/B; do not ship two unevidenced claims.

**16 GB (the tier that matters most)**
- Smarter (chat): **gemma-4-12B-it** — replaces Qwen3.5-9B. Evidence:
  creative-writing rubric 78.55 vs Qwen3.8-27B's 77.50 (EQ-Bench);
  MMMLU 83.4; "60%+ less" reasoning tokens than Qwen; 7.14 GiB Q4_K_M
  (bartowski); HN: for subjective chat/coding-blend use "the Gemma 4 12B
  seems even better" than Qwen3.5-9B. Qwen3.5-9B (MMLU-Pro 82.5 publisher)
  moves to the per-task coding/math shelf.
- Faster (chat, Italian-safe): **gemma-4-E4B-it** — 4.64 GiB Q4_K_M,
  MMMLU 76.6, audio+vision, same 35+ languages; dense small ⇒ fast on any
  16 GB machine. **Ling-3.0-tiny** stays the speed-only alternative
  (1.3B active, "86-90 tok/s" publisher claim, MIT) with the standing
  caveat: Italian unverified, no chat leaderboard entry.

**32 GB**
- Smarter (chat): **gemma-4-26B-A4B-it** — arena overall 1438, multi-turn
  1449, creative writing 1399, EQ-Bench 3 1430.6, MMMLU 86.3; Apache;
  UD-Q4_K_M 15.78 GiB; MoE 3.8B active so chat stays fluid even though the
  owner measured Qwen3.6-35B-A3B faster — for a chat product the ~1400-Elo
  family gap beats raw tok/s. (On M5/DGX-class 32 GB machines, upgrade the
  Smarter slot to **gemma-4-31B-it** — arena 1453, best open chat Elo that
  fits anywhere.)
- Faster (chat): **gemma-4-12B-it** again — same family UX and Italian, and
  on a 32 GB machine a dense 12B is quick. Keep **Qwen3.6-35B-A3B** as the
  optional "tech-savvy" Smarter (arena 1394; the speed king per the owner's
  own measurement) — offered, not defaulted.
- Dense 27B (Qwen3.6-27B, Qwen3.8-27B): **excluded by the owner's speed
  rule** — 7–30 tok/s depending on chip; even Willison won't daily-drive it.

**64 GB**
- Smarter (chat): **gemma-4-31B-it** at Q6_K/Q8_0 (18.32 GiB at Q4_K_M ⇒
  ~22–35 GiB at Q6/Q8) — the best-fitting open chat model (1453/1465/1419);
  on slower 64 GB machines fall back to gemma-4-26B-A4B at Q6/Q8 — same MoE
  speed, higher fidelity.
- Faster (chat): **gemma-4-26B-A4B-it** at Q8_0 — quantization does not
  change active parameters, so it stays MoE-fast while closing quality gap
  to the 31B.
- Writing specialist (optional row): **Muse-Glimmer-30B** — EQ-Bench CW
  "81.30 / 1798.3" (best open writing model that fits), arena 1424, Apache
  2.0, UD-Q4_K_XL 14.79 GiB; caveat: no factuality benchmark, thin general
  evidence.
- Out of scope forever in this tier: Qwen3.8-2.4T-A95B, Inkling (975B-A41B),
  Inkling-Small (276B-A12B, Thinking Machines, July 15 2026 — arena #87 ·
  1442 and EQ-Bench CW "81.90" make it the open chat leader, but it needs a
  server, not a Kalsa machine).

## 6.7 Future per-task list — leaders with evidence

| Task | Winner (that fits Kalsa tiers) | Evidence | Runner-up |
|---|---|---|---|
| Coding | **Qwen3.6-35B-A3B** (32 GB) | "SWE-bench Verified: 73.4", LCB v6 80.4 (card, publisher); community rates it above Gemma 4 for coding (HN 48385906); owner-measured fastest 32 GB model | Qwen3.8-27B on fast machines ("LiveCodeBench v6: 90.3" card; but 15-38 tok/s and xhigh verbosity) |
| Math / science | **Qwen3.6-35B-A3B** | "GPQA: 86.0", AIME26 92.7 (card); Qwen owns every math benchmark in Part 1's tables | Qwen3.8-27B ("GPQA Diamond: 89.2" card) where speed allows |
| Writing | **gemma-4-31B-it** (32/64 GB), **gemma-4-12B-it** (16 GB) | LMArena CW 1419; EQ-Bench CW 80.05 / 1368.2; EQ-Bench 3 1434.1 | **Muse-Glimmer-30B** — EQ-Bench CW "81.30 / 1798.3", best open rubric after the 2.4T Qwen; ship as a "creative" special |
| Multilingual / Italian | **gemma-4-26B-A4B-it** (and 31B) | MMMLU "86.3%" vs Gemma 3 27B 70.7% (card); "140+ languages"; community consensus; Qwen publishes no MMMLU for 3.5–3.8 | Granite-4.2 (Italian among 12 tested languages — but chat Elo 1289; keep only if an Italian enterprise/compliance use appears) |
| Law | **No winner — no evidence found.** No legal benchmark result exists for any candidate (no INCLUDE rows, ItaEval broken, no Italian arena). Practical default: gemma-4-26B-A4B with retrieval for knowledge, granite-4.2-8b/30b as the enterprise-licence alternative — and run an internal Italian legal-QA eval before advertising a "Law" task. | — | — |

**Part 6 watch list:** Qwen4 / small Qwen3.8 MoE (would take the 16 GB
coding/math shelf); Inkling distills (chat leader, currently too big);
ItaEval space repair (the only real Italian leaderboard); llama.cpp MTP for
gemma-4 (would lift MoE chat speed); Muse-Glimmer factuality data; K2-Horizon
llama.cpp merge (still the best ≤9B paper scores).

---

# Part 7 — Measured speeds by machine (added 2026-09-26, follow-up #3)

Rules kept: only numbers a human actually measured, with the machine, quant
and engine named; every cell carries its source; empty rather than guessed.
Prefill is given where the source gave it (llama-bench "pp512" = prefill
tok/s at 512-token prompt; "tg128" = decode tok/s at 128-token generation —
note llama-bench tg128 is a best case; real chat at long context is slower,
which is exactly what the owner's numbers show).

Source-key for the big table:
- **[owner]** = owner's M1 Max 32 GB, llama.cpp (ground truth).
- **[slb350]** = https://slb350.github.io/strix-benchmarks/ — AMD Strix
  Halo, "AMD Ryzen AI MAX+ 395 (16C/32T)", "Radeon 8060S Graphics (RDNA
  3.5, gfx1151)", "128GB unified (120GB soft VRAM cap)", llama.cpp on RADV
  (Mesa Vulkan); rows quoted verbatim.
- **[coffie]** = https://calebcoffie.com/benchmarks (read in browser,
  2026-09-26) — llama.cpp, decode tok/s "4 workload shapes" ranges, TTFT;
  RTX 3090 · 24 GiB (drv 590, power caps noted) and RTX 5070 · 12 GiB
  (250 W cap, drv 595); plus Strix Halo rows (96 GiB VRAM cap).
- **[llmcheck]** = https://llmcheck.net (aggregator; single figures, engine
  noted per cell).
- **[nvforum]** = NVIDIA developer forums, "Qwen3.8-27B at 34–38 tok/s on
  DGX Spark" thread (Aug 15, 2026).
- **[willison]** = https://simonwillison.net/2026/Aug/16/qwen-38-27b/.
- **[hn]** = Hacker News "My local model setup on an M4 Pro Mac Mini"
  (Sep 2026); **[startupfortune]** = startupfortune.com May 21, 2026;
  **[x-phone]** = X post Aug 23, 2026 (Galaxy A56); **[psp]** =
  pcserverandparts.com DGX Spark review; **[localcode]** = localcode 0.3.39
  docs via libraries.io.

## 7.1 The big table — measured decode (and prefill) tok/s

| Model (quant) | Machine | Engine | Decode tok/s | Prefill | Source |
|---|---|---|---|---|---|
| Qwen3.6-35B-A3B (Q4) | **M1 Max 32 GB (owner)** | llama.cpp | **45–60** (context-dependent) | **350–450** | [owner] |
| Qwen3.6-35B-A3B (Unsloth Q4-family, 20.8 GiB) | Strix Halo 128 GB | llama.cpp (RADV) | 60 (tg128) | 1029 (pp512) | [slb350]: "Qwen3.6-35B-A3B Hybrid MoE (3B active, 256 experts) 20.8 GiB 1029 60" |
| Qwen3.6-35B-A3B (Q4_K_M) | Strix Halo 128 GB | llama.cpp | 52.5–52.9 (baseline), 60.8–70.6 (MTP n=2/n=3) | — | [coffie] |
| Qwen3.6-35B-A3B (Q4_K_M) | RTX 3090 24 GB | llama.cpp | 148.1–148.6 (baseline); 122.1–169.0 (MTP n=2); 136.6–161.4 (MTP n=3) | — | [coffie] |
| Qwen3.6-35B-A3B (UD-Q4, MLX) | M4 Max 48 GB | MLX | ~42 | — | [llmcheck] |
| Qwen3.6-35B-A3B (Ollama) | M5 Max 64 GB | Ollama | ~48 | — | [llmcheck] |
| Qwen3.6-35B-A3B (Ollama) | M1 Ultra | Ollama | 46 | — | [llmcheck] |
| Qwen3.6-35B-A3B (Q4) | RTX 4070 Super 12 GB | llama.cpp | ~110 | — | [startupfortune] (community benchmark) |
| gemma-4-26B-A4B (Q4_K_M) | Strix Halo 128 GB | llama.cpp | 45.1–47.7 and 47.2–52.0 (two runs) | — | [coffie] |
| gemma-4-26B-A4B (Q8_0, 16 GiB) | Strix Halo 128 GB | llama.cpp (RADV) | 52.9 (tg128); QAT+MTP 61.22→83.18 | 1196 (pp512) | [slb350]: "Gemma-4-26B-A4B MoE (4B active) 16 GiB 1196 52.9" |
| gemma-4-26B-A4B (Q4_K_M) | RTX 3090 24 GB (300 W cap) | llama.cpp | 116.3–119.5 | — | [coffie] |
| gemma-4-26B-A4B (MLX) | M4 Pro Mac mini 24 GB | MLX | ~62 | — | [hn] |
| gemma-4-26B-A4B (Q3, 11.2 GB) | M-series laptops (16 GB+) | llama.cpp | ~27 | — | [localcode] |
| gemma-4-26B-A4B (Q4) | **M1 Max 32 GB (owner)** | llama.cpp | slower than Qwen3.6-35B-A3B (no number) | — | [owner] |
| gemma-4-12B (Q4) | **M1 Max 32 GB (owner)** | llama.cpp | **20.4** | — | [owner] |
| gemma-4-12B (UD-Q8_K_XL, 13.6 GiB) | Strix Halo 128 GB | llama.cpp (RADV) | 14.0 (tg128); MTP 13.74→33.49 (n=4) | 716 (pp512) | [slb350]: "Gemma-4-12B Dense (12B) 13.6 GiB 716 14.0" |
| gemma-4-E4B (Q4_K_M) | RTX 3090 24 GB | llama.cpp | 116.2–148.2 | — | [coffie] |
| gemma-4-E4B (Q4_K_M) | RTX 5070 12 GB | llama.cpp | 124.8–129.8 | — | [coffie] |
| gemma-4-E4B (Q4_K_M) | Strix Halo 128 GB | llama.cpp | 52.1–55.3 (two runs) | — | [coffie]; [slb350]: "Gemma-4-E4B Dense (7.5B) 4.7 GiB 1828 59" (tg128 59, pp512 1828) |
| gemma-4-31B dense (Q4) | **M1 Max 32 GB (owner)** | llama.cpp | **unusable — no answer after 10 min** | — | [owner] |
| Qwen3.8-27B (Q8_0, 26.63 GiB) | Strix Halo 128 GB | llama.cpp (RADV) | 7.53 (plain); 5.10–11.87 with MTP (60.84% acceptance) | 236.7 (pp512) | [slb350]: "Plain llama-bench reaches 236.7 prompt processing and 7.53 generation on RADV." |
| Qwen3.8-27B (UD-Q4_K_XL + MTP) | Strix Halo 128 GB | llama.cpp | "Q4 generates 15.35 tokens per second against 11.87 for Q8" | — | [slb350] |
| Qwen3.8-27B (mtplx, 26k ctx) | **M1 Max 32 GB (owner)** | llama.cpp | **10–15** | — | [owner] |
| Qwen3.8-27B | DGX Spark | llama.cpp / vLLM | 20–27 stock → **34–38 tuned** | — | [nvforum] |
| Qwen3.8-27B | M5 Mac (+Spark) | LM Studio; llama.cpp+MTP | "around 15-30 tokens a second"; MTP "roughly 72% faster" on Spark | — | [willison] |
| Qwen3.6-27B dense (UD-Q4_K_XL) | Strix Halo 128 GB | llama.cpp (RADV) | 12.0 (tg128); MTP 11.58→21.32 | 322 (pp512) | [slb350]: "Qwen3.6-27B Dense (27B) 16.4 GiB 322 12.0" |
| Qwen3.6-27B-MTP (Q4_K_M) | RTX 3090 24 GB | llama.cpp | 29.8–63.7 (n=2); 31.1–59.2 (n=3) | — | [coffie] |
| Qwen3.6-27B-MTP (Q8_0) | 2× RTX 3090 | llama.cpp | 42.5–57.1 (MTP n=2/n=3) | — | [coffie] |
| LFM2.5-2.6B (Q4_K_M) | RTX 3090 24 GB | llama.cpp | 234.4–332.6 | — | [coffie] |
| LFM2.5-2.6B (Q4_K_M) | RTX 5070 12 GB | llama.cpp | 266.8–273.7 | — | [coffie] |
| LFM2.5-2.6B (publisher claim) | "Apple M5 Max" / "AMD Ryzen CPU" | (unspecified) | "220 tok/s on an Apple M5 Max and 113 tok/s on an AMD Ryzen CPU, in under 2.5 GB of memory" | — | card: https://huggingface.co/LiquidAI/LFM2.5-2.6B (publisher) |
| granite-4.2-3b / granite-4.2-8b | any | any | **no measured tok/s found anywhere** (searched r/LocalLLaMA, aggregators, llama-bench tables) | — | proxy only: granite-4.1-8b Q4_K_M — RTX 3090 "71.5-127.0", RTX 5070 "96.0-100.2" [coffie]; Strix "Granite-4.1-8B … 936 38.6" [slb350] |
| Ling-3.0-tiny (community GGUF) | Galaxy A56 (phone) | llama.cpp CPU | 9 | — | [x-phone] |
| Ling-3.0-tiny | — (local desktop) | — | **no local desktop measurement found**; only API figures ("over 160 tokens/s" card; "26.4 t/s" AA providers page) | — | card + https://artificialanalysis.ai/models/ling-3-0-tiny/providers |
| 120B-class MoE (reference) | DGX Spark | llama.cpp | ~17–59 | — | [psp] |

Cells deliberately left empty (nothing measured found): every model on M1 /
M2 / M3 base and Pro; M3 Max; M2/M3 Ultra; RTX 3060, 4060, 4090, 5090;
Windows CPU-only DDR4/DDR5 rigs (except the LFM2.5-2.6B publisher CPU claim);
Intel/AMD iGPU Vulkan numbers; gemma-4-E2B on Apple Silicon; granite-4.2-3b
anywhere. One 64 GB Mac datapoint exists but could not be opened to verify
which Gemma size it was (blog.venturemagazine.net returned HTTP 403; its
snippet says "I set it up on a 64 GB Mac, watched it hit around 32 tokens
per second" — model size unstated, so it is not used).

**LFM2.5-2.6B exact repo, confirmed:** `LiquidAI/LFM2.5-2.6B` (created
2026-07-28), 2,697,198,592 params (2.69B dense hybrid, "22 double-gated
short convolution blocks + 8 GQA"), 128K context, official
`LiquidAI/LFM2.5-2.6B-GGUF` (2026-08-01). Licence tag "license:other",
"License: lfm1.0" — same custom licence family the owner already rejected
for LFM2.5-8B-A1B; Italian is among its 16 card languages; card shows
"AA-Omni-Public: Index -29.50" (negative, like its 8B sibling).

## 7.2 Apple memory bandwidth (Apple sources only)

| Chip | Bandwidth | Apple source read this session |
|---|---|---|
| M2 | 100 GB/s | support.apple.com MacBook (M2) tech-spec page, fetched: "100GB/s memory bandwidth" |
| M2 Pro | 200 GB/s | support.apple.com "Mac mini (2023) - Tech Specs": "Apple M2 Pro chip … 200GB/s memory bandwidth" |
| M1 Max | 400 GB/s | support.apple.com "Mac Studio (2022) - Tech Specs": "Apple M1 Max chip … 400GB/s memory bandwidth" |
| M4 Pro | 273 GB/s | support.apple.com MacBook Pro 16-inch 2024 tech specs: "نطاق ترددي للذاكرة 273GB/s" (memory bandwidth 273GB/s) |
| M4 Max (16C CPU/40C GPU) | 546 GB/s | support.apple.com/id-id/121553: "M4 Max dengan CPU 16-core dan GPU 40-core (bandwidth memori 546 GB/s)" |
| M5 | 153 GB/s | support.apple.com MacBook Pro 14-inch (M5) tech specs: "153GB/s memory bandwidth"; apple.com newsroom iPad Pro M5: "over 150GB/s of unified memory bandwidth — a nearly 30 percent increase compared to the previous generation" |
| M5 Pro / M5 Max | not verified from an Apple page this session | third-party review (nexoratechlab.online) claims M5 Max "doubles memory bandwidth to 614GBps" — treat as unconfirmed |
| M1 base / M1 Pro / M1 Ultra / M2 Max / M2 Ultra / M3 base / M3 Pro / M3 Max / M4 base | not verified from an Apple page this session | do not quote numbers for these without re-checking support.apple.com |

## 7.3 Sanity check against the owner's M1 Max (all consistent)

- Qwen3.6-35B-A3B: owner 45–60 decode / 350–450 prefill. Independent:
  Strix 60 tg128 / 1029 pp512 (slb350, 256 GB/s but short-context
  llama-bench); 52.5–52.9 real-shape decode (coffie); M4 Max ~42, M5 Max
  ~48, M1 Ultra 46 (llmcheck). The owner's numbers sit exactly in the
  measured band. ✓
- Qwen3.8-27B + MTP: owner 10–15 on M1 Max; Strix Q4+MTP 15.35, Q8+MTP
  11.87 (slb350). Same class. ✓
- gemma-4-12B: owner 20.4 (Q4, 400 GB/s); Strix 14.0 at Q8 (bigger files,
  256 GB/s, slb350). Direction and magnitude consistent. ✓
- gemma-4-31B unusable on M1 Max 32 GB: RAM is only half the story — dense
  27–31B on ≤400 GB/s measures 7.5–12 tok/s even on Strix's llama-bench
  (Qwen3.6-27B 12.0, Qwen3.8-27B 7.53), so a 31B at 400 GB/s with 32 GB
  total RAM (weights + KV + OS) falls off a cliff. The owner's "no dense
  27B+ except fast machines" rule matches every measurement. ✓

## 7.4 Chat-product picks for 32 GB and 64 GB, per machine class

Rules applied: chat quality from Part 6 (Gemma-first); "Faster" must still
be a strong model (no E4B/E2B on 32/64 GB big machines, per owner); dense
27–31B only where measured decode ≥ ~15–20 tok/s. "est." = inferred from
the bandwidth/measured neighbours above, not a measurement.

**32 GB machines**

| Machine class | Smarter (chat) | Faster (chat) | Basis |
|---|---|---|---|
| M1 Pro / M2 Pro (200 GB/s) | gemma-4-26B-A4B Q4 (15.8 GiB fits; est. ~25–35 tok/s — no direct measurement) | gemma-4-12B Q4 (est. ~10–14 from owner 20.4 @400 GB/s) | bandwidth scaling from [owner]; cells empty in 7.1 |
| M1 Max / M2 Max (400 GB/s) — the owner's class | gemma-4-26B-A4B Q4 (owner-measured, slower than Qwen35 but the chat-quality pick; Qwen3.6-35B-A3B 45–60 measured as the optional "tech" alternative) | gemma-4-12B Q4 — 20.4 measured [owner] | [owner] |
| M3 Pro (bandwidth unverified; the M3 Pro generation was the bandwidth-cut generation) | gemma-4-26B-A4B Q4 with reduced expectations, else drop to the 16 GB picks (gemma-4-12B Smarter / E4B Faster) | gemma-4-12B Q4 | est. only — no measurements exist |
| M4 Pro (273 GB/s; Mac mini 32 GB) | gemma-4-26B-A4B — ~62 tok/s measured on M4 Pro 24 GB via MLX [hn] | gemma-4-12B Q4 (est. ~14–18) | [hn] |
| M5 Pro | same as M4 Pro (M5 helps prefill more than decode, see 7.5) | same | est. |
| RTX 4070-class 12 GB (+32 GB sys) | Qwen3.6-35B-A3B Q4 — ~110 tok/s measured on 4070 Super [startupfortune]; for CHAT quality gemma-4-26B-A4B is the better model but has no 12 GB measurement — test before shipping | same model, non-thinking | [startupfortune] |
| Strix Halo 128 GB | gemma-4-26B-A4B — 45–53 measured, MTP 83 [coffie][slb350] | Qwen3.6-35B-A3B MTP — 60.8–70.6 measured [coffie] (arena 1394: strong enough as Faster) | measured |
| DGX Spark 128 GB | gemma-4-31B is permitted by the owner's fast-machine rule and Qwen3.8-27B measured 34–38 tuned [nvforum] (dense-27B class ≥20 ✓); but for CHAT pick gemma-4-26B-A4B (est. fast, unmeasured on Spark) | Qwen3.6-35B-A3B (est.; 120B MoE run 17–59 on Spark [psp], 35B-A3B must be well above that) | mixed |
| Dense 27–31B on any non-fast 32 GB machine | **excluded** (7.3) | — | [owner][slb350] |

**64 GB machines**

| Machine class | Smarter (chat) | Faster (chat) | Basis |
|---|---|---|---|
| M1 Max / M2 Max 64 GB (400 GB/s) | gemma-4-26B-A4B at Q6/Q8 (same speed, higher fidelity); dense 31B still excluded (measured class 7.5–15 tok/s at 256–400 GB/s < 15–20 bar) | Qwen3.6-35B-A3B Q4 (45–60 measured class [owner]) or gemma-4-12B at Q8 | measured/est. |
| M3 Max 64 GB | same picks; bandwidth unverified this session — measure first | same | est. |
| M4 Max 64 GB (546 GB/s) | gemma-4-26B-A4B Q8 | Qwen3.6-35B-A3B — ~42 measured (MLX, 48 GB) [llmcheck] | [llmcheck] |
| M5 Max 64 GB | **gemma-4-31B-it** — owner's rule allows dense on M5/DGX class; ~48 tok/s measured for Qwen3.6-35B-A3B [llmcheck] shows the machine is fast; 31B itself unmeasured — validate on device before default | gemma-4-26B-A4B Q8, or Qwen3.6-35B-A3B (~48 Ollama measured [llmcheck]) | measured for neighbours only |
| M1/M2 Ultra (800 GB/s) | gemma-4-31B (est. ≥20; unmeasured — flag) | gemma-4-26B-A4B; Qwen3.6-35B-A3B measured 46 on M1 Ultra [llmcheck] | mixed |
| RTX 3090 / 4090 24 GB (+64 GB sys) | gemma-4-26B-A4B — 116–119.5 measured [coffie] | Qwen3.6-35B-A3B(+MTP) — 122–169 measured [coffie] | measured |
| RTX 5090 32 GB | no our-model measurement exists; assume 4090-class or better, verify | verify | empty |
| DGX Spark 128 GB | gemma-4-31B (dense allowed here; Qwen3.8-27B measured 34–38 [nvforum] proves the class; 31B unmeasured) | gemma-4-26B-A4B (est.) | mixed |
| Strix Halo 128 GB | gemma-4-26B-A4B Q8 — 52.9 tg128, MTP 83.18 [slb350] | Qwen3.6-35B-A3B MTP — 63–70 [coffie] | measured |

Where Part 6 differs from this table (Part 6 recommended gemma-4-31B
generically at 64 GB), this table tightens it: 31B only on the rows above
where the dense-27B measured class clears ~15–20 tok/s or the owner's
fast-machine rule applies (M5 Max / Ultra / DGX / RTX-24GB+).

## 7.5 Does memory bandwidth alone predict speed?

Mostly yes for decode, with two measured exceptions:

1. **Dense models track bandwidth closely.** gemma-4-12B: 20.4 tok/s at
   400 GB/s [owner] vs 14.0 at Q8 on 256 GB/s Strix [slb350]; RTX 3090
   (936 GB/s) runs the same dense E4B at 116–148 where Strix runs it at
   53–59 — roughly the bandwidth ratio.
2. **MoE decode on llama.cpp does NOT scale linearly with bandwidth across
   machines.** Qwen3.6-35B-A3B measured: M1 Ultra (800 GB/s) 46 ≈ M4 Max
   (546 GB/s) 42 ≈ M5 Max 48 ≈ M1 Max (400 GB/s) 45–60 — all within noise
   of each other — while RTX 3090 (936 GB/s) hits 148. Apple-Silicon MoE
   decode is dominated by per-token kernel/launch overhead and expert
   routing, not raw bandwidth; NVIDIA's compute path breaks the ceiling.
   So: bandwidth predicts speed *within* a chip family and for dense
   models; it under-predicts NVIDIA and over-predicts big Apple chips for
   MoE.
3. **Newer generations shift prefill, not decode.** M5's GPU Neural
   Accelerators: "M5's Neural Accelerators give 4× faster prompt processing
   but only ~19–27% faster token generation" (compute-market.com analysis),
   and decode stayed ~42→48 M4 Max→M5 Max on the same MoE model [llmcheck]
   — consistent with decode being bandwidth-bound. One search-summary
   paraphrase (tech.grahammiranda.com, citing Ollama: decode 58→112 on
   M4 Max→M5 Max) contradicts this, but the page could not be opened (404),
   so it is recorded here as **unconfirmed** and excluded from the tables.
4. **MTP/speculative decoding is the real speed lever on slow-bandwidth
   machines**: Qwen3.8-27B Q8 7.53 → 11.87 and Q4+MTP 15.35 [slb350];
   Qwen3.6-27B 11.58 → 21.32 [slb350]; gemma-4-12B 13.74 → 33.49 [slb350];
   Qwen3.6-35B 52.9 → 70.6 [coffie]; "~72% faster" on Spark [willison].
   Kalsa should ship MTP-enabled builds wherever the model ships an MTP
   head (Qwen3.5/3.6/3.8 do; gemma-4 QAT MTP exists on Strix).

**Part 7 watch list:** llama.cpp MTP for gemma-4 outside Strix builds; a
real M5 Pro/Max Apple spec page (bandwidth unverified); RTX 4090/5090
llama-bench rows for gemma-4/Qwen3.6 (none found); granite-4.2 tok/s
(anywhere — currently zero public measurements); Ling-3.0-tiny on desktop
CPUs (only a phone number exists); localscore.ai expanding beyond its fixed
Llama 1B/8B/14B set (checked 2026-09-26 — it cannot answer our models).

---

# Part 8 — CPU-only PCs and the minimum CPU (added 2026-09-26, follow-up #4)

Context: Kalsa runs its own llama.cpp fork (based on upstream **b10950**) on
Windows PCs, some with no usable GPU. Two owner questions: (1) on CPU-only,
is decode bound by RAM or CPU? (2) is Haswell (AVX2+FMA, 2013) the right
minimum? Same rules: quoted sources, no invented numbers; estimates are
labelled "est." and derived by arithmetic from measured anchors.

## 8.1 Decode is memory-bound; prefill is compute-bound

**Decode (token generation) = memory-bandwidth-bound. Measured evidence:**

- The cleanest controlled experiment found (dev.to, "DDR5 Speed and LLM
  Inference", https://dev.to/maximsaplin/ddr5-speed-and-llm-inference-3cdn):
  i5-13600KF, LM Studio, **same CPU**, only RAM speed changed —
  "Mistral 7B [Q6_K]: 9.42 t/s at 4800MT/s → 11.93 t/s at 6200MT/s";
  "Llama 3.1 8B [f16]: 3.86 t/s → 4.87 t/s"; the author's conclusion:
  "STRONG linear correlation between tokens per second and AIDA-reported
  memory speeds" and "You might be better off with fewer/slower cores yet
  faster memory." Core count barely mattered — RAM bandwidth was the knob.
- Mechanism, in llama.cpp's own discussion of CPU (Snapdragon) performance,
  ggml-org/llama.cpp discussion #8273: during token generation the whole
  active model must be moved "from RAM into the CPU's on-die caches" per
  token (TG stage), i.e. GBs per token — the definition of bandwidth-bound.
- Single-channel ≈ halves decode. Linus Tech Tips forum (llama.cpp memory
  threads): dual channel doubles memory bandwidth and "the entire model
  must be read from memory to generate each token", so single-channel runs
  at roughly half speed. No A/B tok/s table was found — the halving is
  bandwidth arithmetic, labelled est. Cheap single-stick laptops are the
  worst Kalsa machines for this reason.
- r/LocalLLaMA CPU-only thread (…/1p90zzi/, hardware unstated in snippet):
  "Phi-4 (14B): 6.0 tokens/second. Qwen3-14B: 5.8 …" and
  "prompt eval time = 12053.37 ms / 1459 tokens" (≈121 tok/s prefill) —
  note the prefill:decode ratio (~20:1) that is typical of CPU-only runs.
- Anchor points for small models on CPU: LFM2.5-2.6B card (publisher):
  "220 tok/s on an Apple M5 Max and 113 tok/s on an AMD Ryzen CPU, in under
  2.5 GB of memory" (https://huggingface.co/LiquidAI/LFM2.5-2.6B; relayed
  by smol.ai AINews as "112 tokens per second on an AMD CPU"); LFM2-2.6B
  is "usable" even on a Raspberry Pi 5 (deputyos.com); Ling-3.0-tiny:
  9 tok/s on a Galaxy A56 phone's CPU via llama.cpp (X post, Aug 23 2026).
- Community CPU references for 7–8B Q4: Ryzen 5 5600G ≈ "12.1 tokens/s"
  average in OpenBenchmarking's llama.cpp CPU suite (model/quant not stated
  in the snippet — weak anchor); a Ryzen 3900 PRO CPU-only run at ~6 t/s
  (dev.to "Running Local LLMs, CPU vs GPU"); AMD's own blog (publisher):
  "The AMD Ryzen AI 9 HX 375 processor can achieve up to 50.7 tokens per
  second in Meta Llama 3.2 1b Instruct (4-bit quantization)"
  (https://www.amd.com). One low outlier to treat with caution: sitepoint
  (Mar 2026) claims "Full CPU inference on DDR5-4800 dual-channel systems
  can manage 1 to 3 tokens per second for a 7B Q4_K_M model" — far below
  the dev.to controlled numbers above; likely a suboptimal/thread-starved
  setup. **No published tok/s was found for any of our models on a
  Haswell/Skylake DDR3/DDR4 box** — the estimates in 8.4 are computed.

**Prefill (prompt processing) = compute-bound.** Consensus across tuning
guides and fork discussions: llama.cpp performance-tuning notes —
"Prompt processing (pp) Compute (FLOPS) … tokens/sec of output Memory
bandwidth" (notes.itsvasugrover.com, Mar 2026); ik_llama.cpp GitHub
discussion on an Intel mini PC: "token generation being mostly
memory-bound, so CPU-side gains (e.g., AVX-512) yield small improvements
for TG" — i.e. the AVX level and core count pay off on prefill, not decode.
This is why CPU-only chat feels fine per token but the first answer after
a long prompt is slow. No AVX2-vs-AVX512 prefill A/B number was found; the
sapphirerapids/zen4 AVX-512 variants in upstream exist for exactly this
(see 8.2).

**Typical real memory bandwidth (unit arithmetic: MT/s × 8 bytes per
channel; dual channel = ×2 — computed, not a quoted benchmark):**

| RAM | Channels | GB/s (est.) |
|---|---|---|
| DDR3-1600 | dual | 25.6 |
| DDR4-2666 | dual | 42.6 |
| DDR4-3200 | dual | 51.2 |
| DDR4-3200 | **single** | 25.6 |
| DDR5-4800 | dual | 76.8 |
| DDR5-5600 | dual | 89.6 |
| LPDDR5-5500 (laptop, soldered) | (wide) | ~88 |

(Crucial markets DDR5-5600 as "~50% more bandwidth than DDR4" — eBay/Newegg
listing text; the table above is JEDEC transfer math.) For comparison: an
M1 Max is 400 GB/s and an RTX 3090 is ~936 GB/s (Part 7) — a dual-channel
DDR4 desktop gives the CPU ~1/8 of a 3090 and ~1/16 of an M-series Max.

## 8.2 The minimum instruction set in llama.cpp today (upstream + our fork)

- **Upstream ships runtime-dispatched CPU variants.** From
  `ggml/src/CMakeLists.txt` (master, read 2026-09-26), the x86-64 variant
  list is: `x64`, `sse42`, `sandybridge (SSE42 AVX)`, `haswell (SSE42 AVX
  F16C FMA AVX2 BMI2)`, `skylakex (… AVX512)`, `icelake (… AVX512_VBMI
  AVX512_VNNI)`, plus ivybridge, piledriver, cannonlake, cascadelake,
  cooperlake, zen4, alderlake, sapphirerapids. Enabling them all requires
  dynamic backend loading: "GGML_CPU_ALL_VARIANTS requires
  GGML_BACKEND_DL" (same file, ~line 460). At runtime the loader picks the
  best variant whose feature flags the CPU satisfies — that is the whole
  point of the `ggml-cpu-*.dll` layout.
- **Upstream b10950 (= our fork's base) publishes exactly this:** release
  tag b10950 includes `llama-b10950-bin-win-cpu-x64.zip` — 18,426,198
  bytes, large enough only because it is a multi-variant fat archive
  (GitHub API asset list, read 2026-09-26).
- **So: a CPU without AVX2 does not crash.** The sse42/sandybridge variant
  is in the same archive and loads instead; it runs, slower (fewer/wider
  FMA units hurt prefill much more than decode, per 8.1). An
  illegal-instruction crash happens only on a build compiled with a single
  native variant above the CPU's level — which neither upstream's release
  zip nor our fork is (below).
- **Our fork, checked in this repo** (read-only; no GitHub search needed):
  `crates/kalsa-runtime/src/assets.rs:210` — "The fork's Windows archives
  carry the per-variant `ggml-cpu-*` libraries and no plain `ggml-cpu.dll`,
  and need the VC++ redistributable, as upstream's did." Same for the
  Vulkan archive (assets.rs:224). The Windows CPU engine row is
  `kalsa-server-v1.1.2-bin-win-cpu-x64.zip` (13,762,007 bytes) from the
  fork's own CDN — and assets.rs:19 states the fork is published on "the
  app's CDN, not GitHub". A GitHub search for a kalsa llama.cpp fork /
  "kalsa-server" returns **ZERO** repositories (GitHub API, 2026-09-26),
  consistent with the CDN-only policy. Conclusion: the fork inherits
  upstream's all-variants dynamic CPU backend; the pre-AVX2 fallback ships
  in the box.

## 8.3 The installed base

Steam Hardware Survey (https://store.steampowered.com/hwsurvey, read live
2026-09-26 — it does carry instruction-set rows):

- "AVX2 95.40% +0.36%"
- "FMA 95.59% +0.37%"
- "AVX 97.23% +0.23%"
- "AVX512F 23.90% +0.51%"
- "SSE2 98.15% +0.13%"
- OS: "Windows 11 64 bit 70.97%", "Windows 10 64 bit 22.90%".

So **~95% of Windows gaming PCs have AVX2+FMA**, and AVX-512 is only ~24%
(not a sensible requirement). The ~4.6% without AVX2 = Sandy/Ivy Bridge
(2011–2013), AMD FX/piledriver-era, and the Atom/Celeron/Pentium Silver
parts that lacked AVX for years — exactly the CPUs the sse42/sandybridge
variants exist for. Reference floor: Microsoft ships Windows 11 only on
"1 gigahertz (GHz) or faster with 2 or more cores on a compatible 64-bit
processor" with a curated CPU list (microsoft.com windows-11-specifications,
aka.ms/CPUlist); Microsoft "first announced that they would only support
8th Generation of Intel processors and newer" (learn.microsoft.com hosted
discussion, Oct 2021) — the de-facto Win11 floor is 8th-gen Intel / Zen+
(2017+), all AVX2, mostly DDR4.

## 8.4 Recommendation

**1) Minimum supported CPU: yes, set it at Haswell (AVX2+FMA) — as a
support and messaging floor, not as a crash line.** Reasons: (a) it
matches upstream's `haswell` variant being a first-class target (8.2);
(b) the survey says that excludes only ~4.6% of Windows PCs (8.3); (c)
below AVX2 the app still runs via the bundled sse42/sandybridge variant —
so gate with a **clear message** ("Your PC's CPU is below the supported
level; answers will be very slow"), never an illegal-instruction crash;
the fallback DLLs are already in the fork's zip (assets.rs:210).

**2) Usable-speed floor is a different thing — and it is RAM, not CPU.**
Decode on CPU follows bandwidth (8.1), so the real triage for a CPU-only
machine is channels + DDR generation:

| Machine (CPU-only) | Bandwidth (est.) | LFM2.5-2.6B Q8 (~2.7 GB/token) | gemma-4-E4B Q4 (~5.0 GB/token) |
|---|---|---|---|
| Haswell i5/i7, dual DDR3-1600 (2013–15) | 25.6 GB/s | **~5–6 tok/s (est.)** | **~2–3 tok/s (est.)** |
| Skylake 6th-gen, dual DDR4-2666 | 42.6 GB/s | ~9–10 tok/s (est.) | ~4–5 tok/s (est.) |
| Ryzen 5 5600 / 8th-gen+, dual DDR4-3200 | 51.2 GB/s | ~11–13 tok/s (est.) | ~5–7 tok/s (est.) |
| Modern laptop, LPDDR5/DDR5-5600 | ~88 GB/s | ~20–25 tok/s (est.; publisher: "113 tok/s on an AMD Ryzen CPU" — DDR5 desktop, favorable setup) | ~10–11 tok/s (est.) |
| Same machines, single-channel RAM | ≈ half of the above | ≈ half (est.) | ≈ half (est.) |

Anchors for the estimates: dev.to's measured 9.42–11.93 t/s for a 7B Q6_K
(~4.5 GB/token) at DDR5-4800→6200 on one CPU; the phone's 9 tok/s for
Ling-tiny; Strix Halo's ~100%-of-bandwidth GPU efficiency as the upper
bound and CPU efficiency at ~50–70% of bandwidth as the realistic band.

**3) Product decisions this implies:**
- On CPU-only machines, default to the **small dense/hybrid models**
  (LFM2.5-2.6B class — noting its lfm1.0 licence issue from Part 7 — or
  Ling-3.0-tiny for speed) and only offer gemma-4-E4B where RAM is
  dual-channel DDR4 or better. E4B at ~3 tok/s (Haswell/DDR3 est.) is
  below any chat threshold.
- Requiring Windows 11-era CPUs (8th-gen+/Zen+) is the right line for
  **marketing "fast answers"** — those machines are 100% AVX2 with DDR4
  dual-channel minimum — but do not hard-require it: Win10 is still 22.9%
  of the survey, and Haswell+DDR4 exists below it. Support AVX2, recommend
  8th-gen+.
- Prefill is compute-bound (8.1): on old CPUs, cap the context Kalsa
  mounts by default (long prompts + AVX2-less prefill = minute-scale first
  answers), and leave threads at physical-core count.
- AVX-512 (23.9%): no action; the skylakex/icelake/zen4 variants in the
  archive pick it up automatically for prefill when present.

**Part 8 watch list:** a real Haswell/Skylake llama-bench run of
LFM2.5-2.6B / gemma-4-E4B to replace the estimates above (none public);
single-channel A/B tok/s data; Steam survey month-over-month AVX2 trend
(+0.36% this reading); whether the fork ever publishes an x64 macOS build
(deliberately absent today, assets.rs:195-202).
