The “~37 EPFL LFM2.5 fine-tunes” are PersonaPO’s 37 personality-control checkpoints (mostly Big-Five SFT/LoRA/DPO on LFM2.5-8B-A1B-**Base**, plus 1.2B/350M smokes) from one EPFL CS-552 / MNLP student team — **none are useful to us**.

# Recon: EPFL fine-tunes of LiquidAI LFM2.5-8B-A1B

Date: 2026-08-13. Web-only. Downloads = Hugging Face “last month” as shown on the Hub.

## 0. What is actually there (do not force “37 EPFL 8B-A1B FTs”)

| Claim | Fact | Source |
| --- | --- | --- |
| “EPFL fine-tuned ~37 models from LFM2.5” | **True as an org count, false as a lab / 8B-A1B-only story.** Hugging Face org **PersonaPO** is labeled “(EPFL)” and hosts **exactly 37 models**. | https://huggingface.co/PersonaPO |
| Those 37 are all FTs of the reasoning-tuned `LFM2.5-8B-A1B` | **False.** Every 8B repo that declares a base points at **`LiquidAI/LFM2.5-8B-A1B-Base`**, not the reasoning-tuned checkpoint. 14 of the 37 are 1.2B or 350M. | API dump: https://huggingface.co/api/models?author=PersonaPO&limit=50 ; example card: https://huggingface.co/PersonaPO/lfm25-8b-a1b-sft-bigchat |
| Official 8B-A1B (reasoning) model tree | **39 finetunes**, **28 adapters**, **70 quantizations** (as of 2026-08-13). PersonaPO 8B full FTs live on the **Base** tree (33 finetunes), not as adapters of the reasoning model. | https://huggingface.co/models?other=base_model:finetune:LiquidAI/LFM2.5-8B-A1B ; https://huggingface.co/models?other=base_model:adapter:LiquidAI/LFM2.5-8B-A1B ; https://huggingface.co/models?other=base_model:quantized:LiquidAI/LFM2.5-8B-A1B ; https://huggingface.co/models?other=base_model:finetune:LiquidAI/LFM2.5-8B-A1B-Base |
| `epfl-llm` (Meditron) / Swiss AI Apertus | **No LFM2.5 models.** `epfl-llm` is the older Meditron medical Llama-2 suite. | https://huggingface.co/epfl-llm |

**Count that matches the owner’s “37”:** `PersonaPO` = 37 repos. Of those, **23** are `lfm25-8b-a1b-*`. The other 14 are 1.2B / 350M personality smokes.

A sibling org, **LiberteEPFL** (same people), has **54 more models** on `LFM2.5-1.2B` and `Qwen3-1.7B`. Those are the actual MNLP experiment grid. They are **not** on the 8B-A1B tree. https://huggingface.co/LiberteEPFL

---

## 1. Enumeration — every EPFL-attributable LFM2.5-8B-A1B* repo

**Affiliation evidence (verified, not inferred):**

- Org display name is `PersonaPO (EPFL)`. https://huggingface.co/PersonaPO
- Sole uploader: `AlirezaSakhaei` / Alireza Sakhaeirad. HF orgs: PersonaPO, LiberteEPFL, CriteriaPO, CriteriaPOProject. https://huggingface.co/AlirezaSakhaei
- EPFL people directory: **Student, EL-MA2 (Electrical Engineering, Master semester 2)**, `alireza.sakhaeirad@epfl.ch`. Not listed as lab staff. https://people.epfl.ch/alireza.sakhaeirad?lang=en
- LiberteEPFL members (API): `AlirezaSakhaei` + `maysay098` (“Maysay”). https://huggingface.co/api/organizations/LiberteEPFL/members
- `maysay098` has **no** EPFL page / no public models. **Inference:** second student on Team Liberte. https://huggingface.co/maysay098

**Shared facts (unless a row overrides):**

- **Base:** `LiquidAI/LFM2.5-8B-A1B-Base` (pretrained base, **not** the reasoning-tuned `LFM2.5-8B-A1B`). Official languages on the **reasoning** card include Italian; the **Base** card lists EN/AR/ZH/FR/DE/JA/KO/PT/ES and **omits Italian**. https://huggingface.co/LiquidAI/LFM2.5-8B-A1B ; https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-Base
- **Declared purpose:** Big-Five personality control (“bigchat” / PV / P-React+PSL). Training data visible in `LiberteEPFL/paired_big5_v2` is **English** roleplay with the system line `You are a helpful assistant with the following Big Five personality traits: …`. https://huggingface.co/datasets/LiberteEPFL/paired_big5_v2
- **Language(s):** English only (dataset + cards). No IT/ES/FR declared.
- **License:** **Not declared** on the 8B cards (no LICENSE file in `sft-bigchat`). Upstream Liquid weights are **LFM Open License v1.0** (`lfm1.0`). Only `PersonaPO/lfm25-350m-structdpo-smoke` is Hub-tagged `license:other`. https://huggingface.co/LiquidAI/LFM2.5-8B-A1B (License: lfm1.0) ; https://huggingface.co/PersonaPO/lfm25-8b-a1b-sft-bigchat/tree/main
- **Cards:** TRL auto-templates or empty HF skeletons. Commits say `Training in progress, step N` — these look like **Hub-callback checkpoints**, not polished releases.
- **Eval vs stock 8B-A1B:** **None published** on any 8B card.

### 1.1 8B-A1B family (23 repos) — the ones on the owner’s model tree

Downloads = Hub “last month”. Last update = Hub “Updated …” / `createdAt` (all June 2026; last 8B push 2026-06-24).

| # | repo | base | method | purpose | lang | license | last update | dl / likes | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | [PersonaPO/lfm25-8b-a1b-sft-bigchat](https://huggingface.co/PersonaPO/lfm25-8b-a1b-sft-bigchat) | Base | **Full SFT** (TRL; 16.9 GB `model.safetensors`, F32/BF16). Commit “step 5000”. | Generic SFT on “bigchat” personality dialogue. Parent of DPO/StructDPO. | EN | undeclared (upstream lfm1.0) | 2026-06-11 | 12 / 1 | **NOISE** (English persona SFT from Base; would throw away Liquid’s reasoning/tool post-train) |
| 2 | [PersonaPO/lfm25-8b-a1b-dpo-bigchat](https://huggingface.co/PersonaPO/lfm25-8b-a1b-dpo-bigchat) | SFT-bigchat → Base | **Full DPO** (TRL) | Preference alignment on the same persona data | EN | undeclared | 2026-06-11 | 9 / 0 | **NOISE** |
| 3 | [PersonaPO/lfm25-8b-a1b-structdpo-bigchat](https://huggingface.co/PersonaPO/lfm25-8b-a1b-structdpo-bigchat) | SFT-bigchat | **Full DPO-like** (lr 5e-6, 4 GPU, 1 epoch, dataset “None”) | “StructDPO” experiment. No eval table. | EN | undeclared | 2026-06-24 | 4 / 0 | **RESEARCH_ONLY** |
| 4 | [PersonaPO/lfm25-8b-a1b-preact-psl-bigchat](https://huggingface.co/PersonaPO/lfm25-8b-a1b-preact-psl-bigchat) | Base | **PEFT adapter** (`library_name: peft`) | Reimplementation of **P-React + Personality Specialization Loss** (Dan et al., ACL 2025 Findings — East China Normal University, **not EPFL**). Empty model card. | EN | undeclared | 2026-06-15 | 3 / 1 | **RESEARCH_ONLY** |
| 5–13 | `lfm25-8b-a1b-pv-{openness,conscientiousness,extraversion,agreeableness}-{high,low}` + `pv-neuroticism-high` | Base | **Full SFT** (8B F32/BF16) | One full-weight clone per Big-Five pole. **`pv-neuroticism-low` 8B does not exist.** `pv-agreeableness-high` and `pv-neuroticism-high` have almost empty Hub tags (likely incomplete upload). | EN | undeclared | 2026-06-15 | 0–6 / 0–1 | **NOISE** |
| 14–23 | `lfm25-8b-a1b-pvlora-{openness,conscientiousness,extraversion,agreeableness,neuroticism}-{high,low}` (all 10 poles) | Base | **LoRA adapter** (`adapter_model.safetensors` 9.84 MB; r=16, α=32, dropout=0.05, targets `q/k/v/out_proj` only). Commit “step 1500”. | Per-trait LoRA. Card still says “trained with SFT”. | EN | undeclared | 2026-06-19 | 0–1 / 0–1 | **NOISE** |

PV 8B URLs (all under https://huggingface.co/PersonaPO/):

- `lfm25-8b-a1b-pv-openness-high` (5 dl), `…-openness-low` (6), `…-conscientiousness-high` (5), `…-conscientiousness-low` (4), `…-extraversion-high` (5), `…-extraversion-low` (5), `…-agreeableness-low` (4), `…-agreeableness-high` (0, incomplete), `…-neuroticism-high` (0, incomplete).
- PVLoRA: all ten `lfm25-8b-a1b-pvlora-{trait}-{pole}` (0–1 dl). Adapter config: https://huggingface.co/PersonaPO/lfm25-8b-a1b-pvlora-conscientiousness-high/raw/main/adapter_config.json

### 1.2 Same org, not 8B-A1B (14 repos) — listed so the “37” is complete

| family | repos | base | method | notes | verdict |
| --- | --- | --- | --- | --- | --- |
| 1.2B PV × 10 | `PersonaPO/lfm25-1.2b-pv-{trait}-{pole}` (all 10 poles, 2026-06-14, 5–12 dl) | `LiquidAI/LFM2.5-1.2B-Base` | Full SFT | Same Big-Five grid at 1.2B | **NOISE** |
| 1.2B P-React | `PersonaPO/lfm25-1.2b-preact-psl-bigchat` (2026-06-12, 2 dl) | `LFM2.5-1.2B-Base` | PEFT adapter | Same P-React+PSL method | **RESEARCH_ONLY** |
| 350M smokes | `pv-smoke-350m-o-high` (6 dl), `pv-smoke-350m-merged` (3), `lfm25-350m-structdpo-smoke` (10, 2026-06-24) | `LFM2.5-350M-Base` | SFT / merge / StructDPO | Pipeline debug. Last one tagged `license:other`. | **NOISE** |

### 1.3 Related EPFL org, not in the 37, not 8B-A1B

**LiberteEPFL** (54 models, last update 2026-06-10): SFT / DPO / GRPO / MoLoRA / RM full+LoRA grids on `LFM2.5-1.2B` and `Qwen3-1.7B`, dataset `paired_big5_v2`, eval dump `lfm-eval-results`. This is the actual experiment logbook. https://huggingface.co/LiberteEPFL/models?sort=modified

**CriteriaPO** (9 models, 2025, Qwen2.5-3B DPO ablations): earlier preference-optimization homework/research by the same author. No LFM. https://huggingface.co/CriteriaPO

**No other EPFL org or verified EPFL account** has an LFM2.5-8B-A1B fine-tune. `nathanrchn` is in “EPFL Data Science & AI Lab” and touched Liquid’s chat template; he did **not** publish an LFM2.5 FT. https://huggingface.co/nathanrchn

---

## 2. WHY — course artifact, not Swiss-AI / Apertus / epfl-llm

**Verdict: one CS-552 (Modern NLP, Spring 2026) student-team project, then scaled from 1.2B → 8B-A1B-Base. Not a coordinated lab release.**

Evidence, in order:

1. **The eval dataset says so.** `LiberteEPFL/lfm-eval-results` card, first sentence: *“Raw eval outputs for the MNLP report **Personality by Preference: Big-Five Control in Small Language Models via Preference-Optimized Mixture-of-LoRA** (Team Liberte).”* Systems named: prompted Base/Instruct, P-React, DPO-Full, DPO-MoLoRA; 3 seeds; judge = GPT-4o-mini + Gemini-3.1-flash-lite; retention = MMLU / ARC-Challenge / HellaSwag. **This is a course report title, not a paper.** https://huggingface.co/datasets/LiberteEPFL/lfm-eval-results
2. **CS-552 exists this semester and historically dumps dozens of near-identical Hub repos.** Course page (Antoine Bosselut, Spring 2026, with a dedicated “Project Assistance” slot): http://nlp.epfl.ch/cs-552-modern-nlp/ · GitHub: https://github.com/epfl-nlp/cs-552-modern-nlp · Edu: https://edu.epfl.ch/coursebook/en/modern-natural-language-processing-CS-552
3. **The rest of the class used the `cs-552-2026-*` naming and Qwen3-1.7B**, not LFM2.5-8B. Example: `cs-552-2026-catma/general_knowledge_model` is explicitly “the General Knowledge individual-model submission for the CS-552 Modern NLP course project” on `Qwen/Qwen3-1.7B`. Same pattern: `cs-552-2026-Flash-McQueenS-and-TheKing/safety_model`, `cs-552-2026-camykaz/math_model`, `cs-552-2026-databand/*`, `cs-552-2026-llmfao/*`. https://huggingface.co/cs-552-2026-catma/general_knowledge_model · https://huggingface.co/cs-552-2026-Flash-McQueenS-and-TheKing/safety_model
4. **Team Liberte chose LFM2.5-1.2B + Qwen3-1.7B for the report, then reused the same stack on 8B-A1B-Base under a second org (`PersonaPO`).** Same author, same `bigchat` / `preact-psl` / `pvlora` / `structdpo` names, same W&B project `alirezasakhaeirad/personapo`. Inference (strong): the 8B grid is the same homework scaled up, not a new lab program. The eval card only names the **1.2B** report.
5. **Method paper is not theirs.** `preact-psl` = P-React + PSL, Yuhao Dan et al., ECNU, ACL 2025 Findings. https://arxiv.org/abs/2406.12548 · https://aclanthology.org/2025.findings-acl.328/
6. **Not Swiss AI / Apertus / epfl-llm.** `epfl-llm` is Meditron (Llama-2 medical CPT, 2023). https://huggingface.co/epfl-llm/meditron-7b · Apertus is the ETHZ/EPFL/CSCS fully-open LLM, unrelated stack.

**What this is not:** a multilingual/IT/FR instruction campaign; a function-calling campaign; a published paper with a leaderboard vs stock LFM2.5-8B-A1B.

---

## 3. Product relevance (IT first, then ES/FR/EN; on-device; we already ship reasoning-tuned Q4_K_M + 2–3-bit expert requant)

Screening criteria: multilingual or IT/FR IT; tool-use / function calling; real eval vs stock.

| Candidate | Multilingual / IT / FR? | Tool-use? | Eval vs stock? | Verdict |
| --- | --- | --- | --- | --- |
| All 23 PersonaPO 8B repos | **No.** English Big-Five chat. Training from **Base** discards Liquid’s reasoning + tool post-train. | **No.** | **No** 8B table. Personality-steering eval exists only for the **1.2B** Liberte report (BFI judge, IPIP-50 matrices, MMLU/ARC/HellaSwag *retention* — not Italian PPL, not vs our GGUF). | **NOISE** (PV/PVLoRA/SFT/DPO) / **RESEARCH_ONLY** (P-React, StructDPO) |
| LiberteEPFL 1.2B grid | No | No | Yes, but personality metrics on 1.2B | **RESEARCH_ONLY** |
| Stock `LFM2.5-8B-A1B` (what we already ship) | Official card lists **Italian** among 10 languages (Base card oddly drops IT). | Official: tool calling | Liquid’s own benches | **This is the right base.** The EPFL FTs are not a better multilingual/IT base. |

**There is no USEFUL_CANDIDATE in the EPFL set.**

Taking `sft-bigchat` or a PV clone as a “better IT base” would be a regression: they start from Base, train on English persona roleplay, have ≤12 downloads, no Italian data, no tool-use, and several look mid-run.

French-from-EPFL is a red herring: the team wrote English data and an English report. EPFL being francophone does not appear in the weights.

---

## 4. Other notable things on the LFM2.5-8B-A1B tree (one line each)

**Serious-ish third-party finetunes (not EPFL)**

- [farbodtavakkoli/OTel-LLM-8B-A1B-IT](https://huggingface.co/farbodtavakkoli/OTel-LLM-8B-A1B-IT) — full FT of the **reasoning** model on English telecom RAG (326k rows); +7.2 pp LLM-judge vs stock on held-out OTel; **637k** dl; English-only, not a general/IT upgrade.
- [LLM-OS-Models/LFM2.5-8B-A1B-Terminal-ToolBench-Full-SFT-1Epoch](https://huggingface.co/LLM-OS-Models/LFM2.5-8B-A1B-Terminal-ToolBench-Full-SFT-1Epoch) — full SFT of reasoning model for **terminal next-command JSON**; TB2-lite 52.30 with a real metric table; Korean card; not general function-calling.
- [josephmayo/LFM2.5-8B-A1B-Coder](https://huggingface.co/josephmayo/LFM2.5-8B-A1B-Coder) — LoRA-then-merge on reasoning model, **123** multilingual coding rows; held-out NLL −44.7%; no public pass@k.
- [iselabvn/Tini-8B-A1B](https://huggingface.co/iselabvn/Tini-8B-A1B) / Tini1.5 / Tini-Cybersec — Vietnamese-lab family (also mirrored under `dungnvt`, `spinochenza`); not IT/FR.
- [gyung/lfm25-ko-legal-*](https://huggingface.co/gyung) + [LLM-OS-Models/LFM2.5-8B-A1B-KO-Legal-RAG-Agentic-LoRA-v5](https://huggingface.co/LLM-OS-Models/LFM2.5-8B-A1B-KO-Legal-RAG-Agentic-LoRA-v5) — Korean legal RAG / agentic LoRA swarm (~15 adapters); domain-KR only.
- [AyoubChLin/lfm2.5-8b-saudi-dialect](https://huggingface.co/AyoubChLin/lfm2.5-8b-saudi-dialect) — Saudi dialect adapter; not our languages.
- [reaperdoesntknow/LFM2.5-8B-A1B-Opus-Distil](https://huggingface.co/reaperdoesntknow/LFM2.5-8B-A1B-Opus-Distil) — 2.61k dl, 9 likes; Claude-Opus-style distill (no published eval vs stock on the listing page).
- [konic-labs/LFM2.5-8B-A1B-REAP-50](https://huggingface.co/konic-labs/LFM2.5-8B-A1B-REAP-50) — 5B REAP prune; interesting for RAM, not for IT quality.
- [Eriskii/LFM2.5-8B-A1B-Multichannel](https://huggingface.co/Eriskii/LFM2.5-8B-A1B-Multichannel) (35 dl, 11 likes) + [awhitehead](https://huggingface.co/awhitehead/LFM2.5-8B-A1B-Multichannel) fork — “multichannel” chat; not multilingual.
- Abliterations / heretic: [huihui-ai/Huihui-LFM2.5-8B-A1B-abliterated](https://huggingface.co/huihui-ai/Huihui-LFM2.5-8B-A1B-abliterated), [blockblockblock/…-uncensored-abliterated](https://huggingface.co/blockblockblock/LFM2.5-8B-A1B-uncensored-abliterated), [coder3101/LFM2.5-8B-A1B-heretic](https://huggingface.co/coder3101/LFM2.5-8B-A1B-heretic), [MuXodious/…-SOMPOA-heresy](https://huggingface.co/MuXodious/LFM2.5-8B-A1B-SOMPOA-heresy), [PinoCookie/…-abliterated](https://huggingface.co/PinoCookie/LFM2.5-8B-A1B-abliterated) — refusal wipes; irrelevant to IT PPL.
- Copies / empty FTs of Base (`larue316`, `hardcoremoore`, `useitone`, `eadx`, `Ollivertwisty`, `iceDonkey`, `microperceptron`) — Hub noise.

**Popular requants (70 on the official quantized tree)**

- [LiquidAI/LFM2.5-8B-A1B-GGUF](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF) — official, **112k** dl / 277 likes. This is the Q4_K_M family we already start from.
- [unsloth/LFM2.5-8B-A1B-GGUF](https://huggingface.co/unsloth/LFM2.5-8B-A1B-GGUF) — **22k** dl / 96 likes; Unsloth dynamic GGUF of the stock model (plus [unsloth/LFM2.5-8B-A1B](https://huggingface.co/unsloth/LFM2.5-8B-A1B) 1.41k dl BF16 mirror).
- [gaston-parravicini/LFM2.5-8B-A1B-Uncensored-Gaston-GGUF](https://huggingface.co/gaston-parravicini/LFM2.5-8B-A1B-Uncensored-Gaston-GGUF) — **18.8k** dl; uncensored GGUF, not a quality upgrade.
- Official MLX: [LFM2.5-8B-A1B-MLX-8bit](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-MLX-8bit) 1.9k / 32 likes; [MLX-4bit](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-MLX-4bit) 1.91k / 15; plus 5/6-bit and [mlx-community](https://huggingface.co/mlx-community/LFM2.5-8B-A1B-MLX-4bit) mirrors.
- [mudler/LFM2.5-8B-A1B-APEX-GGUF](https://huggingface.co/mudler/LFM2.5-8B-A1B-APEX-GGUF) — 4.07k / 29 likes; LocalAI APEX quant.
- [noctrex/LFM2.5-8B-A1B-MXFP4_MOE-GGUF](https://huggingface.co/noctrex/LFM2.5-8B-A1B-MXFP4_MOE-GGUF) — MXFP4 MoE GGUF (closer in spirit to our expert requant than any EPFL FT).
- [sakamakismile/LFM2.5-8B-A1B-NVFP4](https://huggingface.co/sakamakismile/LFM2.5-8B-A1B-NVFP4) — NVFP4, 991 dl.
- [Echo9Zulu/LFM2.5-8B-A1B-int4_sym-awq-ov](https://huggingface.co/Echo9Zulu/LFM2.5-8B-A1B-int4_sym-awq-ov) — OpenVINO AWQ int4.
- [exolabs/LFM2.5-8B-A1B-Q4_K_M-dequant-bf16-vllm](https://huggingface.co/exolabs/LFM2.5-8B-A1B-Q4_K_M-dequant-bf16-vllm) — dequant-to-BF16 for vLLM; not a better base.

**No Italian- or French-specialized LFM2.5-8B-A1B fine-tune showed up** in the official finetune/adapter trees or in Hub search.

---

## 5. Bottom line for the product

- The “37 EPFL models” are **one master’s student’s CS-552 personality-control grid**, published as `PersonaPO`, starting from **Base**, in **English**.
- They do not improve Italian (or FR/ES). They do not add tool-use. They have no eval vs the stock reasoning model we ship.
- Keep `LiquidAI/LFM2.5-8B-A1B` (reasoning) + our requant. If we want a better IT base, we have to **make** that FT (or wait for Liquid). Do not merge or swap in PersonaPO weights.

## 6. License gate

Canonical texts (they match):

- Full legal text + FAQ + Apache redline: https://www.liquid.ai/lfm-license (also linked as https://www.liquid.ai/lfm-open-license-v1.0)
- Same file on the model we ship: https://huggingface.co/LiquidAI/LFM2.5-8B-A1B/blob/main/LICENSE
- Liquid’s own plain-language restatement (2026-04-02): https://docs.liquid.ai/lfm/help/model-license
- Hub tag on the official model: `License: lfm1.0`. https://huggingface.co/LiquidAI/LFM2.5-8B-A1B
- **No `NOTICE` file** in the official repo tree (only `LICENSE`). Section 4(d) is therefore dormant unless Liquid later adds one. https://huggingface.co/LiquidAI/LFM2.5-8B-A1B/tree/main

This is **not** Apache 2.0. It is Apache-shaped with a revenue cliff. Liquid’s FAQ: *“the Commercial Use Limitation in Section 5 — this limitation is the key difference between our license and the standard Apache 2.0 text.”* https://www.liquid.ai/lfm-license

### 6.1 Derivatives (full SFT / LoRA-merged weights)

**Allowed.** §2 Grant of Copyright License:

> “each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, **prepare Derivative Works of**, publicly display, publicly perform, sublicense, and **distribute the Work and such Derivative Works** in Source or Object form.”

Condition: *“Subject to … the Commercial Use limitation set forth in Section 5.”*

§1 defines Derivative Works as “any work, whether in Source or Object form, that is based on (or derived from) the Work.” Full SFT, LoRA-merged weights, and a LoRA adapter that is not separable from the base at inference time are Derivative Works. Liquid’s docs: *“Can I modify the models? Yes, but the $10M revenue threshold still applies to modified models.”* and *“Do I have to open-source my modifications? No.”* https://docs.liquid.ai/lfm/help/model-license

FAQ: *“If I fine-tune the model with my own data, do I have to release my new model publicly? No. The license does not have a ‘copyleft’ requirement. You can keep your fine-tuned models proprietary.”* https://www.liquid.ai/lfm-license

You own *your* modifications; Liquid still owns the base; **use of the derivative stays under this license**. FAQ: *“Liquid AI retains ownership of the original base model. Users own the modifications … but use of those derivatives is still governed by the terms of this license.”*

### 6.2 Commercial use — gated, not free-for-all

**Not allowed outright. Gated on annual revenue of You or Your Legal Entity. No user-count gate. No registration below the cliff.**

§1:

> “**Commercial Use** shall mean any use of the Work for **direct or indirect commercial advantage or monetary compensation**.”
>
> “**Threshold** shall mean **annual revenue of 10 million United States dollars ($10,000,000) or more**.”
>
> “**Legal Entity** shall mean the union of the acting entity and all other entities that control, are controlled by, or are under common control with that entity” (50% ownership / beneficial ownership / power to direct).

§5 Commercial Use Limitation:

> “(a) The rights granted under this License for Commercial Use are conditioned upon **You or Your Legal Entity not exceeding the Threshold**.
>
> (b) **Any Commercial Use of the Work or a Derivative Work by a Legal Entity that exceeds the Threshold is not licensed under this Agreement.**
>
> (c) The Threshold shall not apply to a Qualified Non-Profit Organization’s use … for Non-Commercial or Research Purposes.”

Liquid summary (same page): *“Rights to use the model for commercial purposes end if your company's annual revenue exceeds $10 million USD. … We want to incentivize free use for research and projects, even projects that attract a lot of FREE users (**so no user threshold**). BUT: preserve ability to charge (1) enterprises and (2) projects that use our models to generate significant revenue ($10 million or more).”*

FAQ Q2: *“You are free to use the model for commercial purposes. However, this right is conditioned on your company's annual revenue. If your company's revenue exceeds $10 million USD, your right to use the model for commercial purposes under this free license ends.”*

FAQ Q3: *“Once you cross the revenue threshold, your use of the model for commercial purposes is no longer licensed under this agreement. You should contact Liquid AI at sales@liquid.ai to obtain a commercial license.”*

A **paid mobile app** is Commercial Use. Shipping a “free tier” that is part of a paid product is still “indirect commercial advantage.” The $10M is **company/Legal-Entity revenue**, not LFM-attributable revenue — if a parent or affiliate is over $10M, §1 aggregation can pull you over the line.

§11 Termination:

> “This License will **terminate automatically and immediately** if You fail to comply with any of its terms and conditions. Upon termination, You must **cease all use of the Work and any Derivative Works and delete all copies** in Your possession.”

Crossing $10M without a paid Liquid license is not a slap on the wrist. It is an automatic kill switch on every copy you still hold, including the on-device weights already shipped (you cannot keep using them; you also cannot leave customers running an unlicensed derivative).

### 6.3 Redistribution of derivative weights inside a commercial app

**Allowed under §4, if you are still under the §5 threshold, and if you actually do the paperwork.** §4:

> “You may reproduce and distribute copies of the Work or Derivative Works thereof **in any medium**, with or without modifications, and in Source or Object form, provided that You meet the following conditions:
>
> (a) You must give **any other recipients** of the Work or Derivative Works **a copy of this License**; and
>
> (b) You must cause any **modified files to carry prominent notices** stating that You changed the files; and
>
> (c) You must **retain**, in the Source form of any Derivative Works that You distribute, **all copyright, patent, trademark, and attribution notices** from the Source form of the Work …; and
>
> (d) If the Work includes a NOTICE text file … [include it].”

On-device ship = distribution “in any medium” to end users. Those users are “recipients.” Practically:

1. Bundle the full LFM Open License v1.0 text with the app (About / OSS licenses / a `LICENSE` next to the GGUF).
2. State that the weights are a modified derivative of `LiquidAI/LFM2.5-8B-A1B` (that is the “prominent notice” of §4(b)).
3. Keep Liquid’s copyright / license notices on any source-form artifacts you redistribute (tokenizer, config, chat template).
4. You **may** add your own copyright on *your* modifications and even put “additional or different license terms” on *your* modifications — **provided** use of the Work still complies with this license. You cannot Apache-relicense the Liquid weights.

**Naming / trademarks — you must *not* brand the product as LFM.** §7:

> “This License **does not grant permission to use the trade names, trademarks, service marks, or product names of the Licensor**, except for the **reasonable and customary use in describing the origin of the Work** and reproducing the content of the NOTICE file.”

So: *“based on Liquid AI LFM2.5”* in the about screen = allowed. Shipping the app as “LFM Chat” or putting the Liquid logo on the splash = not licensed.

There is **no** requirement to keep “LFM” in the model filename.

### 6.4 Quantized / requantized derivatives

**Same legal object as a fine-tune.** §1:

> “**Object** form shall mean any form resulting from **mechanical transformation or translation** of a Source form, including but not limited to compiled object code, generated documentation, and **conversions to other media types**.”

Q4_K_M, 2–3-bit expert requant, GGUF, MLX, ONNX are Object-form copies (and, after SFT, Derivative Works in Object form). Nothing in the license carves out quantization. Liquid’s official GGUF is itself published under `lfm1.0`. https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF

### 6.5 Acceptable-use / chatbot risk

**No content AUP in the license.** No banned-use list, no “no high-risk,” no “no chatbots,” no “no on-device.” The only use restriction is the §5 revenue cliff plus the usual Apache patent-termination (sue over the Work → patent license dies) and §11 auto-termination.

Warranty is “AS IS” (§8). You eat product-liability risk yourself. You *may* sell support/warranty (§10) if you indemnify Liquid.

A general chatbot app is in-scope. The bites that actually matter: **$10M Legal-Entity revenue**, **must ship the license to every user**, **do not use Liquid trademarks as the product name**, **parent-company aggregation**.

### 6.6 Community practice on the three derivatives we named

| Repo | Declared license | LICENSE file? | Practice |
| --- | --- | --- | --- |
| [LLM-OS-Models/LFM2.5-8B-A1B-Terminal-ToolBench-Full-SFT-1Epoch](https://huggingface.co/LLM-OS-Models/LFM2.5-8B-A1B-Terminal-ToolBench-Full-SFT-1Epoch) | **None** (API tags have no `license:*`) | No | Silent. Non-compliant with §4(a) if anyone downloads the weights. |
| [farbodtavakkoli/OTel-LLM-8B-A1B-IT](https://huggingface.co/farbodtavakkoli/OTel-LLM-8B-A1B-IT) | Hub tag **`license:apache-2.0`**. Card: “OTel release license Apache 2.0” **and** “Users must comply with both the OTel release license **and the upstream base-model license**.” | No LICENSE in the file list | Dual-license theatre. Apache on *their* extras is allowed by the last paragraph of §4; tagging the **whole derivative** Apache is wrong and would not survive a $10M audit. |
| [iselabvn/Tini-8B-A1B](https://huggingface.co/iselabvn/Tini-8B-A1B) | Card YAML `licence: mit` (typo, not even `license`) | No | Worse. MIT is incompatible with §5. Do not copy. |
| [huihui-ai/Huihui-LFM2.5-8B-A1B-abliterated](https://huggingface.co/huihui-ai/Huihui-LFM2.5-8B-A1B-abliterated) | Hub tag **`License: lfm1.0`** | — | The rare derivative that kept the upstream tag. |
| [josephmayo/LFM2.5-8B-A1B-Coder](https://huggingface.co/josephmayo/LFM2.5-8B-A1B-Coder) | **None** | No | Same silence as Terminal-ToolBench. |

Community practice is **not** evidence of what is legal. Most publishers either omit the license or slap Apache/MIT on top. We should do the opposite: ship `lfm1.0` + our notice, never relicense the weights.

### 6.7 VERDICT

**LICENSE_YELLOW(conditions)** for our exact case (fine-tune of reasoning `LFM2.5-8B-A1B` + 2–3-bit expert requant, weights shipped inside a paid mobile app).

Green **only if all of these stay true**:

1. Annual revenue of us **and** every affiliate in the §1 Legal Entity is **under USD 10,000,000**. The moment that is false, this license no longer covers Commercial Use — buy from `sales@liquid.ai` *before* the cliff, because §11 is automatic.
2. Every installed app includes a readable copy of LFM Open License v1.0 (§4(a)).
3. About / model card says the weights are a modified derivative of Liquid AI LFM2.5-8B-A1B (§4(b)) and keeps Liquid’s notices on tokenizer/config (§4(c)).
4. Product name / icon does **not** use Liquid / LFM as a mark (§7). “Powered by / based on Liquid AI LFM2.5” is the allowed form.
5. We do **not** Apache/MIT-relicense the shipped weights (OTel/Tini are a bad example).

It is **not** LICENSE_GREEN: the $10M cliff + Legal-Entity aggregation + “give every recipient the license” + trademark limit are real conditions, and a paid on-device ship is the fact pattern Liquid wrote §5 to capture. It is **not** LICENSE_RED unless we are already over $10M or we refuse the §4 notices.

I am not your lawyer. This is a close reading of the published text, not advice.

---

## 7. Tool-call FT recipe

### 7.1 What Terminal-ToolBench actually did

Repo: https://huggingface.co/LLM-OS-Models/LFM2.5-8B-A1B-Terminal-ToolBench-Full-SFT-1Epoch
Sibling: https://huggingface.co/LLM-OS-Models/LFM2.5-8B-A1B-Terminal-ToolBench-Full-SFT-2Epoch
Training code / eval: https://github.com/LLM-OS-Models/Terminal
Author org: https://huggingface.co/LLM-OS-Models (uploader `gyung`)

**Setup (verified from `trainer_state.json` + card + GitHub, not guessed):**

| Knob | Value | Source |
| --- | --- | --- |
| Base | **`LiquidAI/LFM2.5-8B-A1B` (reasoning)**, not Base | HF `base_model` tag |
| Method | **Full SFT** (16.9 GB `model.safetensors`, F32/BF16; no adapter files) | https://huggingface.co/LLM-OS-Models/LFM2.5-8B-A1B-Terminal-ToolBench-Full-SFT-1Epoch |
| Framework | Hugging Face `Trainer` / TRL-style SFT. `trainer_state.json` + `training_args.bin` present. Earlier Liquid-CLI experiments in the same repo used **Unsloth + torchrun DDP on 8×H200**; the 8B-A1B ToolBench run is the later “Full-SFT” line. | https://huggingface.co/LLM-OS-Models/LFM2.5-8B-A1B-Terminal-ToolBench-Full-SFT-1Epoch/raw/main/trainer_state.json · https://github.com/LLM-OS-Models/Terminal/tree/main/liquid_sft |
| Epochs | **1.0** (2-epoch sibling is worse — see below) | `trainer_state.json`: `"epoch": 1.0` |
| Steps | **1542** (`global_step`, checkpoint name on the card) | same |
| Peak LR | **2e-5** (matches Liquid’s official *full* SFT default) | log hits `2e-05` at step 94, then cosine decay |
| Warmup | ~93 steps (~6% of 1542) | same log |
| Eval | every 500 steps; **no best-metric checkpoint** (`best_metric: null`) | same |
| Chat template | **Official LFM template kept** (Pythonic `<|tool_call_start|>…` macros still in `chat_template.jinja`) | HF API `chat_template_jinja` |
| Router / experts | Full FT ⇒ **everything is updated**, including `Lfm2MoeTopKRouter` (`.gate.weight`, `.expert_bias`) and expert `gate_up_proj` / `down_proj`. They did not freeze the router. | architecture: https://raw.githubusercontent.com/huggingface/transformers/main/src/transformers/models/lfm2_moe/modular_lfm2_moe.py |
| Hardware (earlier Unsloth line in same repo) | 8×H200 DDP, `per_device_train_batch_size=16`, `max_seq_length=8192`, 2 epochs, 3510 samples after filtering 139,841 raw | https://github.com/LLM-OS-Models/Terminal/tree/main/liquid_sft |
| Sample count for *this* 1542-step run | **Not published.** 1542 steps × unknown global batch. Card only says “Terminal + ToolBench conversation data.” | card |

**Data format (this is the important part — and it is *not* native LFM tool-calling):**

`terminal_sft_utils.py` builds **single-turn user→assistant pairs** out of multi-turn `conversations`, then **masks the prompt** (`labels[:prompt_len] = -100`) so only the assistant JSON is trained. A row is kept only if the assistant contains `"commands"` / `"keystrokes"` and is not `"commands": []`. Holdout is by `(task, episode)` / source index so the TB2-lite eval slice is not in train. https://github.com/LLM-OS-Models/Terminal/blob/main/terminal_sft_utils.py

Target JSON (from the model card, **not** Liquid’s tool tokens):

```json
{
  "analysis": "brief reasoning about the next terminal action",
  "plan": "short execution plan",
  "commands": [{"keystrokes": "ls -la\n", "duration": 0.1}],
  "task_complete": false
}
```

System prompt they use at eval: *“You are a terminal automation assistant. Return JSON only.”* They kept the official chat template but **overwrote the native tool protocol** with this JSON. Valid JSON on the 1-epoch model is only **76.9%**. https://huggingface.co/LLM-OS-Models/LFM2.5-8B-A1B-Terminal-ToolBench-Full-SFT-1Epoch

**Eval vs stock (same TB2-lite 303-step proxy, not Docker TerminalBench):**

| Model | Score (100× Cmd F1) |
| --- | --- |
| Stock `LiquidAI/LFM2.5-8B-A1B` | **36.53** |
| Full SFT 1 epoch | **52.30** |
| Full SFT 2 epoch | **50.48** (−1.82 vs 1 ep) |
| 1-ep SFT + ECHO RLVR LoRA ckpt-610 | **54.05** |
| Raw RLVR LoRA on stock, no SFT, ckpt-1475 | 46.06 |

https://github.com/LLM-OS-Models/Terminal (README leaderboard, 2026-06-18). They themselves warn this is a **replay proxy**, not Harbor/Docker pass@1.

**Gotchas they actually measured:**

- **1 epoch > 2 epoch** on the same data. More SFT hurt JSON validity (76.9% → 74.9%) and command F1. Do not over-SFT the reasoning model.
- Unsloth SFT of earlier LFM2-8B in the same repo scored **worse** than their later “LiquidCLI / full” path (e.g. `gyung/LFM2-8B-Terminal-SFT-Unsloth` 28.23 vs LiquidCLI 32.41). Unsloth is fine for LoRA; it was not their winning 8B-A1B recipe.
- A later **RLVR LoRA on top of 1-ep SFT** is how they got the last +1.7 points. Online ECHO mix: 1,500 live tasks, 51.5% Endless Terminals / 48.5% OpenThoughts-Agent-v1-RL. That is the closest thing anyone published to “replay mix.”
- They did **not** train Liquid-native `<|tool_call_start|>` calls. Copying their JSON target would fight the chat template we already ship.

### 7.2 josephmayo/LFM2.5-8B-A1B-Coder (LoRA-then-merge)

Card: https://huggingface.co/josephmayo/LFM2.5-8B-A1B-Coder
LoRA: https://huggingface.co/josephmayo/LFM2.5-8B-A1B-Coder-LoRA
Evidence dump: https://huggingface.co/josephmayo/LFM2.5-8B-A1B-Coder/raw/main/evidence/hf_release_lfm25_8b_a1b_coder_lora_57of60_release_summary.json

| Knob | What the **card** says | What the **evidence JSON** says |
| --- | --- | --- |
| Base | reasoning `LFM2.5-8B-A1B` | same |
| Method | LoRA then merge | two-stage: scale an older adapter in at 0.1, then LoRA again |
| Rows | **123** “real-world and multilingual coding” | **1500** rows = public HumanEval/MBPP “corrected eval slice” × 25 repeats. Other curricula (real-world 3500, agentic 5000, …) **selected: 0**. Quote: *“treat the resulting score as benchmark-targeted, not clean held-out evidence.”* |
| Hardware | — | **2× Tesla T4** (Kaggle), `experts_implementation: eager` |
| LoRA | — | published `adapter_config.json` targets `q_proj, o_proj, k_proj, v_proj` (**`o_proj` is the Llama name; LFM uses `out_proj`**). The 57/60 run’s evidence list is `in_proj, k_proj, out_proj, q_proj, v_proj`. |
| Claimed metric | held-out NLL 3.39 → 1.87 (−44.7%) | HumanEval+MBPP greedy 23 → 57/60 after training **on the eval slice** |

**Do not copy this recipe.** The public card oversells 123 multilingual rows; the artifact is eval-set repair. Useful only as: (a) LoRA-then-merge on the **reasoning** checkpoint works on 2×T4; (b) people keep mistyping `o_proj` vs `out_proj`; (c) they did include **`in_proj`** (conv) on the run that actually moved the needle.

### 7.3 LFM2.5 hybrid / MoE: what to touch

Architecture (24 layers = 18 double-gated conv + 6 GQA; 32 experts, top-4; first 2 layers dense MLP). Config: https://huggingface.co/LiquidAI/LFM2.5-8B-A1B/raw/main/config.json
Code: https://raw.githubusercontent.com/huggingface/transformers/main/src/transformers/models/lfm2/modeling_lfm2.py · https://raw.githubusercontent.com/huggingface/transformers/main/src/transformers/models/lfm2_moe/modular_lfm2_moe.py

| Block | Module names | LoRA? |
| --- | --- | --- |
| Attention (6 layers) | `q_proj`, `k_proj`, `v_proj`, **`out_proj`** (not `o_proj`) | Yes. Liquid TRL default. |
| Conv (18 layers) | `in_proj`, `out_proj`, plus depthwise `conv` (Conv1d) | **`in_proj`/`out_proj` yes.** Unsloth’s official LFM2.5 list includes them. Conv1d kernel is almost never LoRA’d. https://unsloth.ai/docs/models/tutorials/lfm2.5 |
| Dense FFN (layers 0–1) | `w1`, `w3`, `w2` | Yes. Unsloth list. |
| MoE experts (layers 2–23) | Qwen2-style `gate_up_proj`, `down_proj` as **`nn.Parameter`**, not `nn.Linear` | **Not `target_modules`.** PEFT needs `target_parameters=[...]` or you silently skip every expert. https://huggingface.co/docs/peft/en/package_reference/lora (“Targeting nn.Parameter directly”) |
| Router | `Lfm2MoeTopKRouter.weight` + `expert_bias` buffer | Almost nobody LoRAs the gate. Full FT updates it. Touching the router on a small SFT is how you get routing collapse. |

**Official Liquid docs disagree with each other on names:**

- TRL cookbook (recommended path = LoRA): `target_modules=["q_proj","k_proj","v_proj","o_proj"]`, r=16, α=32, dropout=0.05, **lr 2e-4**, 3 epochs, bs=4, gas=4. Full FT: **lr 2e-5**, same schedule. https://docs.liquid.ai/lfm/fine-tuning/trl
- Unsloth page on Liquid docs: Llama names `gate_proj/up_proj/down_proj` — **wrong for LFM**. https://docs.liquid.ai/lfm/fine-tuning/unsloth
- Unsloth’s own LFM2.5 tutorial (correct-ish for *dense* LFM2.5): `["q_proj","k_proj","v_proj","out_proj","in_proj","w1","w2","w3"]`, r=16, α=16, lr **2e-4**, packing=False, max_seq 4096. https://unsloth.ai/docs/models/tutorials/lfm2.5
- PersonaPO PVLoRA (recon §1): attention-only `q/k/v/out_proj`, r=16. Missed conv + experts.
- Coder published adapter: `o_proj` (dead name). Later run added `in_proj`.

**Liquid-native tool format we should train, not Terminal JSON:**

Tools go in the system prompt as `List of tools: [{...}]`. Model emits:

`<|tool_call_start|>[name(arg="value")]<|tool_call_end|>`

Results come back as `role: tool`. JSON tool calls only if the system prompt says “Output function calls as JSON.” https://docs.liquid.ai/lfm/key-concepts/tool-use

Keep `<think>…</think>` in the chat template (`preserve_thinking`). The official template already strips old thoughts after the last user turn. Do not train that away.

Other Liquid entry points: overview https://docs.liquid.ai/lfm/fine-tuning/overview · datasets https://docs.liquid.ai/lfm/fine-tuning/datasets · LEAP Finetune wrapper https://docs.liquid.ai/lfm/fine-tuning/leap-finetune · notebooks https://github.com/Liquid4All/cookbook · Colab SFT https://colab.research.google.com/github/Liquid4All/docs/blob/main/notebooks/💧_LFM2_5_SFT_with_TRL.ipynb

Known hybrid footguns (documented or demonstrated, not folklore):

1. **`o_proj` vs `out_proj`.** Llama name in Liquid’s own TRL snippet. PEFT will skip or error.
2. **MoE experts are `nn.Parameter`.** Attention-only LoRA never touches them. If we need the experts to learn Italian/tool syntax, use full FT *or* PEFT `target_parameters`.
3. **Do not LoRA the router** unless we have a reason. Full FT of 1542 steps on a narrow JSON format did not obviously collapse routing (their eval still generates), but we have no routing-entropy log.
4. **Train-on-response-only** is what both Terminal (`encode_assistant_only`) and Tini (“Train on Response Only”) did. Required if we want to keep the reasoning prefix.
5. **1 epoch, then stop.** Terminal 2-ep regressed. Liquid full-FT snippet says 3 epochs on SmolTalk — that is a different data regime.
6. Tini mixed Hermes function-calling with reasoning distill and forced `<think>` in the **target language**. Closest published mix to “keep reasoning + add tools + change language,” but they relicensed MIT and did not publish module lists or eval vs stock. https://huggingface.co/iselabvn/Tini-8B-A1B

### 7.4 Recommended skeleton for *our* case

Start from **`LiquidAI/LFM2.5-8B-A1B` (reasoning)**, not Base and not PersonaPO. Use Liquid’s native chat template and native tool tokens. Do **not** adopt Terminal-ToolBench’s `{analysis, plan, commands}` JSON — that fights the template and only got 77% valid JSON.

Prefer **LoRA (Unsloth or TRL+PEFT) for the first pass**, because Liquid itself calls LoRA the recommended path and because full FT of all 32 experts is how you spend a cluster to forget Italian. Target at least:

```
target_modules = ["q_proj", "k_proj", "v_proj", "out_proj", "in_proj", "w1", "w2", "w3"]
```

If Italian PPL / tool-arg fidelity is still dead after that, add expert `target_parameters` (or a short full-FT of the last N layers), **not** the router. r=16, α=32, dropout 0.05, **lr 2e-4** (LoRA) or **2e-5** (if we ever full-FT), bf16, packing off, `max_seq_length` ≥ 4096 (8k if the tool inventory is large; Liquid warns 100+ tools eat context).

Data mix, since nobody published an Italian+tools LFM recipe — steal the *shape*, not the files:

- **Native tool SFT (role `system` = `List of tools: […]`, assistant = `<|tool_call_start|>[…]<|tool_call_end|>`, then `role: tool`, then final answer).** Multi-turn, including “no tool needed.” Hermes-FC-v1 is what Tini used as the tool slice. Rewrite / translate the *user* and *final-answer* sides to IT; keep tool **names** in English (that is how our inventory will look).
- **Italian chat / instruction replay** of the stock model’s own good traces (or a clean IT SFT set) so we do not pay PersonaPO’s “English persona from Base” tax. This is the anti-forgetting half. Terminal’s only published mix ratio is the *later RLVR* 51/49 split, not the SFT. Tini’s implicit mix is “reasoning distill + Hermes FC” with train-on-response-only. Start ~**50/50 IT-chat : tool-traces**, hold out a tool-call + IT-PPL eval, and stop at **1 epoch** (or earlier if IT PPL or stock tool-call rate drops).
- **Reasoning keep-alive:** leave `<think>` in the targets on a subset (Tini forced think-in-Vietnamese; we should force think-in-Italian on some rows and think-in-English on others, then measure both). Do not strip think tags in training.
- After SFT, **only if** tool-call exact-match is still short: a small GRPO/RLVR LoRA like their ECHO stage (they gained +1.7 on a proxy). Do not start with RL.

Then requant the **merged** reasoning+adapter weights the way we already requant stock. License: ship `lfm1.0` next to the GGUF (§6). Do not train on our own eval (Coder’s 57/60 is a warning, not a method).

DONE2

