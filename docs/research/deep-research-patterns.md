# Deep research over a local library — patterns to steal

2026-08-16. Research notes for a Kalsa chat mode: question → plan → hybrid retrieve → cited report, all on-device with llama.rn 0.12.8 and a ~4B GGUF (Qwen3.5-4B + optional Qwen3.5-VL). Not a design spec; steal patterns, do not port frameworks.

Kalsa already has hybrid BM25+dense (`document_chat`), a residual retrieval loop (max 3 rounds, 1800-char budget), and `formatPassageCitation` (`sourceId#pN` → `p. N`). The gap is planning + multi-query orchestration + a cited report, not retrieval itself.

## Patterns to steal

### 1. Plan-and-execute, not ReAct

- **Source:** Shaikh, *Dissecting Agentic RAG* (arXiv:2606.21553); LlamaIndex `SubQuestionQueryEngine`. MIT / CC BY 4.0.
- **What:** Decompose once into sub-questions, retrieve for each, one synthesis call. Do **not** ask the LLM “what next?” after every hop.
- **Evidence:** On local Qwen2.5-7B / HotpotQA (n=5000): 2 retrieval steps captured 95% of a 5-step loop; step 1 vs 2 was −7.1 EM. Adaptive BM25/dense routing *lost* to fixed hybrid RRF (−1.8 EM) because entity heuristics over-routed to BM25.
- **Adapt:** Host-owned loop. LLM only for (a) JSON sub-questions and (b) final write. Reuse existing hybrid + residual loop per sub-query. Cap hops at 2 (3 only if coverage is still low).
- **Risk:** 4B is weaker than 7B. Bad decomp poisons every hop. Always keep a template fallback.

### 2. Constrain the planner; never free-form questions

- **Source:** gpt-researcher planner (`generate_search_queries_prompt`); Qwen function-calling docs; llama.rn GBNF / `json_schema`. Apache-2.0 / Apache-2.0 / MIT.
- **What:** Ask for a JSON **list of 3 short search phrases**, not an essay. gpt-researcher defaults: `MAX_ITERATIONS=3`, `MAX_SUBTOPICS=3`. Qwen recommends Hermes-style tools; llama.rn already parses `tool_calls` and can force JSON via GBNF.
- **Small-model evidence:** Qwen3-4B is usable for *one* structured call; long ReAct loops spiral (malformed calls, lost thread). Llama 3.2 3B is “triage, not multi-step plans.” Thinking/ReAct stopwords inside `<think>` can false-trigger tools — disable thinking for the planner.
- **Adapt:** One completion, `json_schema` for `{ "subqueries": string[3..5] }`. Reject empty/duplicate/too-long (>12 words). If parse fails → fallback (pattern 3). Do not let the 4B choose tools mid-loop.
- **Risk:** 4B emits near-paraphrases of the user question. Dedup by Jaccard against the original and each other.

### 3. Fallback when decomposition fails

- **Source:** STORM paper (direct prompting yields shallow What/When/Where); Kalsa `retrievalLoop` residual words; HyDE (smolagents retriever: “use the affirmative form”). STORM MIT; smolagents Apache-2.0.
- **What:** If the planner fails or returns clones, **do not retry the LLM**. Expand mechanically:
  1. Original question as query 0.
  2. Fixed slots: definition / mechanism / evidence-or-result / comparison-or-limit / who-or-when (drop empty slots).
  3. Entity/keyword split from the question (noun chunks already useful for BM25).
  4. Residual uncovered tokens from round 1 (already in `retrievalLoop`).
- **Adapt:** This is host TypeScript, zero tokens. Same path `document_chat` already uses for residual rounds.
- **Risk:** Templates are generic. Fine for a phone; better than a second 4B plan call.

### 4. Perspective is optional; outline is not

- **Source:** STORM (NAACL 2024, MIT). https://github.com/stanford-oval/storm — Shao et al. 2024.
- **What:** STORM’s win is *not* “ask 30 questions.” Direct question-asking is shallow. They (1) invent 5 writer perspectives, (2) simulate a short grounded Q&A per perspective (M≤5), (3) draft an outline from parametric knowledge, (4) refine the outline with gathered notes, (5) write **section by section**, retrieving refs per section, then polish duplicates. Question-asker ran on GPT-3.5; article+citations needed GPT-4 (3.5 was unfaithful to sources). Ablation: dropping the outline collapsed quality.
- **Adapt:** Skip web-similar-article perspective discovery (no Wikipedia API, too many LLM calls). Keep: 3–5 sub-queries as cheap stand-ins for perspectives; a 5–7 heading outline **after** retrieval, generated from *notes* not from the raw question; section-wise write if the report exceeds ~400 words. Never dump the whole passage pool into one 4B context.
- **Risk:** STORM over-associates unrelated facts (editors’ main complaint). A 4B will do this more. Mitigate by citing only passages in the current section’s retrieved set.

### 5. Numbered citations assigned by the host

- **Source:** gpt-researcher report prompts (APA + `[n]` quick summary); STORM section-grounded citations; Gao et al. 2023 *Enabling LLMs to generate text with citations*. gpt-researcher Apache-2.0.
- **What:** Cloud stacks ask the model to emit `([Author, Year](url))` plus a bibliography. That needs a large context and a model that does not invent URLs. STORM retrieves a *subset* of refs per section so the model cannot cite what it cannot see.
- **Adapt (recommended format):**
  1. Host builds a stable map after retrieval: `[1] Title — p. 12` from existing `docId#pN`.
  2. Passages injected as `[[1]] …text…`.
  3. Model may only write `[[n]]` (GBNF: `[[` + digits + `]]`).
  4. Host rewrites `[[n]]` → `[Title, p. N]` and appends a **Sources** list. Drop any `n` not in the map.
- **Why not `[doc, p. N]` from the model:** 4B will hallucinate page numbers. `formatPassageCitation` already knows the page; the model should never invent it.
- **Budget:** Keep synthesis context ≤ existing `DOCUMENT_CHAT_RETRIEVAL_BUDGET_CHARS` × N_subq, hard-capped (~6–8k chars of passages). Per-section retrieve if over.

### 6. Per-source notes, then one synthesis

- **Source:** gpt-researcher (summarize each source to `SUMMARY_TOKEN_LIMIT=700`, then write); STORM conversation notes before outline.
- **What:** Compress each retrieved cluster *before* the long write so the writer sees notes, not raw PDF dump.
- **Adapt:** Skip a second LLM summarize on phone (too slow). Truncate + RRF merge already in `retrievalLoop`. Optional: one extractive sentence per passage (first 1–2 sents), host-side.
- **Risk:** 700-token LLM summaries are a GPT-4o-mini luxury. Do not add that call.

### 7. One tool, host loop — not an on-device agent framework

- **Source:** smolagents Agentic RAG (`RetrieverTool`, `max_steps=4`); PocketPal / ChatterUI / Airgap (llama.rn on phone, chat-only). smolagents Apache-2.0; llama.rn MIT.
- **What:** smolagents lets a *large* model rewrite queries and call BM25. No public phone app runs a multi-step deep-research agent on-device today. llama.cpp RAG samples are single-pass.
- **Adapt:** Do not embed smolagents/LangChain. Drive `document_chat` from TypeScript with a hop counter, char budget, and cancel. Surface plan + per-hop hits in the existing pipeline sidebar.
- **Risk:** True agent loops on 4B + phone RAM will OOM or spin. Parallel llama.rn slots (`n_parallel`) share KV and shrink `n_ctx`; do not use them to fan out sub-queries on device.

### 8. Grammar on the planner and the citer only

- **Source:** llama.rn GBNF + `response_format.json_schema`; Qwen-Agent (do not use ReAct stopword tools with thinking models).
- **What:** Constrain the two brittle JSON surfaces. Leave the report as free Markdown (`#` / `##`, short paragraphs).
- **Adapt:** Planner schema + citation token grammar. Temperature 0.3 plan / 0.5 write. `enable_thinking: false` for both.
- **Risk:** Over-constraining the report kills fluency. Only constrain citations.

## Vision gotchas

- **Two models, not one.** Catalog text model (Qwen3.5-4B) does **not** see images. Vision needs a VL GGUF + matching **mmproj**. Tool-calling research and VL OCR are separate sessions. Swapping models mid-research is too expensive; run vision *or* deep research, or OCR pages first, then research on extracted text.
- **llama.rn musts:** `initMultimodal({ path, use_gpu })`; **`ctx_shift: false`** (media token positions); local `file://` or data-URL only — **no HTTP**; `releaseMultimodal()` when done. Session save stores **only text before the first media chunk**. MTP speculative decoding is **text-only**.
- **Token cost.** Qwen3-VL patch 16, 32× spatial compression: visual tokens ≈ `H*W / 1024`. A raw 1280×1280 frame is ~1600 tokens before the cap. Qwen docs budget **256–1280 visual tokens/image** via `longest_edge`. Kalsa already sets `image_max_tokens: 512` and resizes to 1280 JPEG — keep both. In-tree `ESTIMATED_TOKENS_PER_IMAGE = 800` is explicitly unvalidated; measure with `tokenize(..., { media_paths })` before trusting the long-chat nudge.
- **Llama-3.2-Vision vs Qwen-VL.** Llama 3.2-V uses a different tile/global pack (often multiple 560 tiles). Do not reuse Qwen token math. SmolVLM (Apache-2.0) is the cheap on-device reference: 384² patch → **81 tokens**. If VL RAM hurts, a SmolVLM-class encoder is the escape hatch — not a second 4B-VL at full res.
- **Known upstream:** llama.cpp Qwen3-VL second-request KV bug (`#17200`) — reset/reinit multimodal between turns if the second image call dies. High `n_ctx` required (`-c 8192` minimum in llama.cpp VL notes).
- **Tools + images on 4B:** llama.rn can attach `tools` and `image_url` on the same completion, but a 4B VL will drop one of: valid JSON, page OCR, or the research plan. For scanned PDFs use the existing `[[DOCUMENT_VISION_FALLBACK]]` path (page images → short OCR notes → text research). Cap **1 page image at a time** in research mode (not the chat-turn 5).
- **Do not** feed 5×1280 images into the synthesis context. One image ≈ 512–800 tokens; five plus passages will evict the library hits.

## Recommended architecture

Host state machine. The 4B never owns the loop.

```
question
  → plan (GBNF JSON, 3–5 subqueries; thinking off)
      fail → template + residual expansion
  → for each subquery (max 2 hops, stop early if coverage ok):
        existing hybrid document_chat (1800-char, residual loop)
        accumulate passages; host assigns [[n]]
  → optional 5–7 heading outline from notes (one short completion)
  → write section-by-section (or one shot if notes < ~3k chars)
        model may only cite [[n]]
  → host rewrites [[n]] → [Title, p. N], appends Sources, strips unknowns
```

**A 4B can:** rewrite a question into 3 keyword queries; stitch 6–10 passages into a 400–800 word Markdown brief; copy `[[n]]` if grammar-forced.

**A 4B cannot:** run a faithful STORM conversation; judge source quality; keep citation fidelity without a host map; do multi-hop ReAct without spiraling; OCR + plan + write in one VL context.

**Budgets (phone):** ≤5 planner tokens-out (the JSON); ≤2 retrieve hops; ≤6k chars of passages in the writer (clamped further by nCtx; single full_context docs capped at 1600 chars); report target 400–800 words; no extra summarizer LLM; cancel must abort the host loop (existing `docOpGate`).

**Citation format to ship:** inline `[Title, p. N]` produced by the host from `[[n]]`. End matter:

```
## Sources
[1] Insulin.pdf, p. 12
[2] Review-2021.pdf, p. 3
```

## Sources

- STORM repo / MIT license: https://github.com/stanford-oval/storm
- STORM paper: https://arxiv.org/abs/2402.14207 · https://aclanthology.org/2024.naacl-long.347/
- gpt-researcher: https://github.com/assafelovic/gpt-researcher (Apache-2.0)
- gpt-researcher config / prompts: https://github.com/assafelovic/gpt-researcher/blob/master/docs/docs/gpt-researcher/gptr/config.md · https://github.com/assafelovic/gpt-researcher/blob/master/gpt_researcher/prompts.py
- LlamaIndex SubQuestionQueryEngine: https://docs.llamaindex.ai/en/stable/examples/query_engine/sub_question_query_engine/ (MIT)
- smolagents + Agentic RAG: https://huggingface.co/docs/smolagents · https://huggingface.co/docs/smolagents/en/examples/rag (Apache-2.0)
- Shaikh 2026 local 7B ablation: https://arxiv.org/abs/2606.21553
- Qwen function calling (Hermes): https://qwen.readthedocs.io/en/latest/framework/function_call.html
- Qwen3-VL README (token / pixel budget): https://github.com/QwenLM/Qwen3-VL
- llama.cpp multimodal: https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md
- llama.cpp Qwen3-VL KV issue: https://github.com/ggml-org/llama.cpp/issues/17200
- llama.rn (MIT): https://github.com/mybigday/llama.rn
- SmolVLM token packing: https://huggingface.co/blog/smolvlm
- Gao et al. 2023 citations: https://aclanthology.org/2023.emnlp-main.398/
