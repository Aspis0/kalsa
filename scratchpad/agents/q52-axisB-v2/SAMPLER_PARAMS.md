# SAMPLER_PARAMS.md - Production Sampler Settings

**Repo:** ai-chat | **Binding:** llama.rn 0.12.8 | **Date:** 2026-08-24

---

## 1. PRIMARY CHAT COMPLETION (streamAssistantTurn)

**Source:** src/engine/LlamaService.ts:2429-2448

| Parameter | Value | Source | Notes |
|---|---|---|---|
| temperature | **0.7** | LlamaService.ts:2446 | Overrides llama.rn default (0.8) |
| top_k | **40** | LlamaService.ts:2447 | Equals llama.rn default (40) |
| top_p | **0.95** | LlamaService.ts:2448 | Equals llama.rn default (0.95) |
| min_p | *(not set)* | - | Fallback: **0.05** (types.d.ts:278) |
| typical_p | *(not set)* | - | Fallback: **1.0** disabled (types.d.ts:290) |
| penalty_last_n | *(not set)* | - | Fallback: **64** (types.d.ts:298) |
| penalty_repeat | *(not set)* | - | Fallback: **1.0** no penalty (types.d.ts:302) |
| penalty_freq | *(not set)* | - | Fallback: **0.0** disabled (types.d.ts:306) |
| penalty_present | *(not set)* | - | Fallback: **0.0** disabled (types.d.ts:310) |
| mirostat | *(not set)* | - | Fallback: **0** disabled (types.d.ts:314) |
| mirostat_tau | *(not set)* | - | Fallback: **5.0** (types.d.ts:318) |
| mirostat_eta | *(not set)* | - | Fallback: **0.1** (types.d.ts:322) |
| seed | *(not set)* | - | Fallback: **-1** random (types.d.ts:362) |
| n_predict | **1024** default | LlamaService.ts:2444 via thinkingBudgets.ts:78 | Per-model overrides in sec 4 |
| stop | 6-word array | LlamaService.ts:339-346 | See sec 3 |
| grammar | *(not set)* | - | No grammar in production |
| json_schema | *(not set)* | - | No structured output in production |


**Thinking fields** (spread via ...roundThinkingFields):
Default thinking mode = default (benchConfig.ts:169):

| Field | Value | Source |
|---|---|---|
| enable_thinking | false | thinkingBudgets.ts:72 |
| thinking_budget_tokens | 0 | thinkingBudgets.ts:74 |
| reasoning_format | none | thinkingBudgets.ts:76 |
| chat_template_kwargs | {enable_thinking:false} | thinkingBudgets.ts:77 |

Global for all models in default mode. Budget256/512 enable thinking
with per-model token budgets (see section 4).

---

## 2. ALL COMPLETION CALL SITES

### 2a. Prewarm (LlamaService.ts:636)
- n_predict: 0 (prompt-only) | stop: STOP_WORDS
- Samplers: NONE (all llama.rn defaults, irrelevant at 0 tokens)

### 2b. Main chat (LlamaService.ts:2429) - PRODUCTION PATH
- See section 1 above for full table.

### 2c. extractMemory (LlamaService.ts:2898)
- temp=0.1, top_k=20, top_p=0.9, n_predict=256
- thinking off | min_p/typical_p/penalties/mirostat/seed: llama.rn defaults

### 2d. translateText (LlamaService.ts:3063)
- temp=0.2, top_k=20, top_p=0.9, n_predict=1024
- thinking off | min_p/typical_p/penalties/mirostat/seed: llama.rn defaults

### 2e. summarizeConversation (LlamaService.ts:3168)
- temp=0.2, top_k=20, top_p=0.9, n_predict=400 (SUMMARIZE_N_PREDICT)
- thinking off | min_p/typical_p/penalties/mirostat/seed: llama.rn defaults

### 2f. completeOnce (LlamaService.ts:3283)
- temp: caller-provided, fallback 0.3 | top_k=20, top_p=0.9
- n_predict: caller-provided, fallback 256 | thinking off
- json_schema: optional | min_p/typical_p/penalties/mirostat/seed: llama.rn defaults
- Callers: deepResearch planner (temp=0.3, deepResearch.ts:255)
  deepResearch writer (temp=0.5, deepResearch.ts:355)

---

## 3. STOP SEQUENCES

Defined at: LlamaService.ts:339-346

    STOP_WORDS = [
      </tool_call>,
      <|im_start|>,
      <|end_of_text|>,
      <|end|>,
      </s>,
      <turn|>,
    ]

Used identically by ALL 6 completion call sites. Covers Qwen-style
(im_end), Llama-style (end_of_text, /s), and app-internal (turn)
EOS markers. Global, not per-model.

---

## 4. PER-MODEL OVERRIDES (ModelRegistry.ts)

Source: src/engine/ModelRegistry.ts

The model catalog carries NO sampler parameter overrides. No model entry
sets temperature, top_k, top_p, penalties, mirostat, or seed.

What the catalog DOES carry that affects decoding:

| Model | thinking.short | thinking.extended | nPredict | mtp.nMax | mtp.defaultEnabled |
|---|---|---|---|---|---|
| qwen3.5-4b (default) | 256 | 512 | 1024 | 3 | false |
| qwen3.5-4b-q3 | 256 | 512 | 1024 | - | - |
| gemma-4-e2b | - | - | 1024 | - | - |
| qwen3.5-2b | 512 | 1536 | **2560** | - | - |

n_predict resolution by thinking mode:
- default/off: n_predict=1024 for ALL models
- budget256/budget512: Math.max(1024, model.thinking.nPredict ?? 1024)
  4B/4B-Q3/Gemma: 1024 | 2B: 2560

MTP: 4B has mtp.nMax=3 but defaultEnabled=false. Production does NOT
engage speculative decoding. Only via bench override + app relaunch.

---

## 5. USER-ADJUSTABLE SETTINGS

Source: src/screens/SettingsScreen.tsx

There are NO user-facing sampler parameter controls (no temperature
slider, no top_k/top_p picker, no penalty settings).

The only setting that affects decoding:

| Setting | Options | Default | Effect |
|---|---|---|---|
| Thinking | off / Short / Extended | off | Changes n_predict ceiling and
| | | | enables/disables thinking_budget_tokens. || | | | Does NOT change temperature/top_k/top_p. |

Bench-only overrides (chat commands, not in Settings UI):
  /bench thinking <mode> - thinking mode (AsyncStorage)
  /bench speculative <none|mtp|clear> - MTP (init-time only)
  /bench engine <gpu=N,threads=N,ubatch=N> - engine init params (not samplers)

---

## 6. LIBRARY DEFAULTS (llama.rn 0.12.8)

Source: node_modules/llama.rn/lib/typescript/types.d.ts

Values when app does NOT set a parameter (baked into native binding):

| Parameter | llama.rn default | Used in prod chat? |
|---|---|---|
| temperature | 0.8 | NO - overridden to 0.7 |
| top_k | 40 | YES (explicitly set to 40) |
| top_p | 0.95 | YES (explicitly set to 0.95) |
| min_p | 0.05 | YES - falls through |
| typical_p | 1.0 (disabled) | YES - falls through |
| penalty_last_n | 64 | YES - falls through |
| penalty_repeat | 1.0 (none) | YES - falls through |
| penalty_freq | 0.0 (disabled) | YES - falls through |
| penalty_present | 0.0 (disabled) | YES - falls through |
| mirostat | 0 (disabled) | YES - falls through |
| mirostat_tau | 5.0 | YES - falls through |
| mirostat_eta | 0.1 | YES - falls through |
| seed | -1 (random) | YES - falls through |
| n_predict | -1 (infinity) | NO - always set explicitly |
| stop | [] (empty) | NO - always set to STOP_WORDS |
| grammar | none | YES - falls through |
| xtc_probability | 0.0 (disabled) | YES - falls through |
| dry_multiplier | 0.0 (disabled) | YES - falls through |
| top_n_sigma | -1.0 (disabled) | YES - falls through |

---

## 7. EFFECTIVE PRODUCTION SAMPLER PROFILE

Production chat with default thinking mode:

    temperature      = 0.7
    top_k            = 40
    top_p            = 0.95
    min_p            = 0.05       (llama.rn default)
    typical_p        = 1.0        (disabled)
    penalty_last_n   = 64
    penalty_repeat   = 1.0        (no repetition penalty)
    penalty_freq     = 0.0        (disabled)
    penalty_present  = 0.0        (disabled)
    mirostat         = 0          (disabled)
    seed             = -1         (random)
    n_predict        = 1024       (cap; actual stop at EOS/stop words)
    stop             = [im_end, im_start, end_of_text, end, /s, turn]
    grammar          = none
    thinking         = off (enable_thinking=false, budget=0)

---

## 8. CRITICAL OBSERVATION: WHY GREEDY FAILED

Production never runs temperature=0 (greedy). The app hardcodes
temperature=0.7 for every user-visible chat completion.

A temp-0 greedy loop failing a quality gate is expected: production
sampling is stochastic (temp=0.7, top_k=40, top_p=0.95). The test
cell must mirror production by using temp=0.7, NOT temp=0.

Additionally, production benefits from:
  - min_p=0.05 (filters low-prob tokens)
  - top_p=0.95 (nucleus sampling within cumulative 95%)
  - top_k=40 (hard cap on candidate tokens)
  - penalty_last_n=64 with penalty_repeat=1.0 (mild repetition control)

All these interact to produce the actual output distribution.
