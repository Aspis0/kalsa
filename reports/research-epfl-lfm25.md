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

DONE
