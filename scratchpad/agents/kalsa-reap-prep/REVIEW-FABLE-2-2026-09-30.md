# Second independent review (Fable 5.1, 2026-09-30): fixes + $0 probe

Reviewer: Paseo agent `620e86e7-03a9-4daa-bfcb-21b7b9d5bf0c` (claude-fable-5-1, high, read-only, web). Subject:
`4d202f91` (fixes), `07cc69e8` (probe), `25622a70` (corpus move). Owner addenda during the run: MoE with
<= 2-3B active faster than dense 4B within 16 GB; Ling/Granite/Trinity excluded (worse than LFM2.5 per owner);
MoEfication from dense Qwen3.5-9B / Gemma ~12B.

## Coordinator verification (on disk)

| Claim | Verdict | Line read |
|---|---|---|
| Stage 10 still dies: `next()` on a list | CONFIRMED | `pod/10_fetch_model.sh:41` `p = next(sorted(pathlib.Path(...).glob(...)))` |
| Stage 05 asserts the old 1280 rows (set is now 10,620) | CONFIRMED | `pod/05_fetch_calib.sh:37` `[ "$n" = "1280" ] || ...` |
| LFM template always opens a think block, so thinking-off does nothing for LFM | CONFIRMED | `lfm2.5-tokenizer/chat_template.jinja` last block `"<|im_start|>assistant\n<think>"` |

Not re-checked by me: CPU-only speed numbers (Fable ran them), GSM8K regeneration (3/4 LFM hit the 1024 cap),
double BOS, the other new holes, all external literature.

## Verdict (verbatim)

NO-GO on the $15 pod. GO WITH CHANGES on the direction, with the honest finding that no 2026 MoE meets all of the
owner's constraints off the shelf, and the only transformation that meets the speed and size bars (50 % prune +
top-4 with k2 renormalisation + LoRA heal) is expected to land near, not above, the dense Qwen3.5-4B on quality.

## Key findings (condensed; full text in the agent transcript)

- **Speed is Metal-specific.** Same Mac, CPU only (`-ngl 0`, 8 threads, tg64): LFM 63.7, Qwen3.5-4B 31.3, REAP20 34.7
  tok/s -> REAP20 = 0.54x LFM and 1.11x dense 4B. The 0.5x-LFM floor is the wrong bar on PC; use absolute bars
  (e.g. >= 15 tok/s on a DDR5 laptop CPU + prefill at 8k), and heat/token above ~8 tok/s on phones.
- **REAP20 Q4_K_M = 16.07 GiB**: a 32 GB PC model, not 16 GB.
- **bpb corpus unusable** (one memorised classic per language). Even so REAP20 loses to dense 4B on IT (1.163 vs
  1.112) and ZH (1.413 vs 1.269). Replace with post-cutoff (after July 2026) per-document text, 50+ docs/language.
- **GSM8K gap is a token-budget artefact**: `n_predict` 1024, LFM always reasons (template), 3 of 4 regenerated LFM
  items hit the cap mid-reasoning; double BOS on every LFM prompt. Tools: format now fair; nested-list `str(args)`
  compare still unfair on order. Raw outputs are not stored.
- **Pod still cannot complete**: stage 10 `next()` bug, stage 05 1280 assertion, stage 40 uploads the folder to repo
  root then verifies `tree/main/upload-staging`, `timeout --foreground` leaves children on the GPU, watchdog group
  kill (plausible), stage-20 failure keeps the pod alive for nothing. `mac/30_convert.sh` uses `${q,,}` (bash 3.2 on
  this Mac: bad substitution). `calib/sources.py:59` seed via `hash()` of strings is not reproducible.
- **The 50 % prune already exists free**: RAZOR-19B-A3B E128of256 of Qwen3.6, Apache-2.0 (unhealed).

## Owner addendum answers

Active params per decoded token, Qwen3.6-35B-A3B (config: hidden 2048, 40 layers = 10 full attn + 30 GDN, 256 x 512
experts, top-8 + shared, vocab 248,320 untied):

| component | params/token | share |
|---|---:|---:|
| GDN layers | 1.011 B | 34 % |
| full attention | 0.273 B | 9 % |
| shared expert + routers | 0.147 B | 5 % |
| routed experts (8 x 3.15M x 40) | 1.007 B | 34 % |
| lm_head | 0.509 B | 17 % |
| total | 2.947 B | |

Two thirds of active bytes are not routed experts: pruning changes nothing, top-k touches 34 %. k=4 -> 2.44 B/token
(~1.3x dense 4B); with k2=16 renormalisation the cost on Qwen3.6 is -0.35 MMLU / -0.6 GSM8K vs -4.65 / -6.6 with
standard renormalisation (arXiv 2609.04575), training-free, a few router lines.

2026 MoEs meeting all bars: **none found** (Qwen 2026 MoEs 35B-A3B and up; Gemma 4 26B-A4B 3.8 B active; DeepSeek-V4-Flash
A13B; GLM-5.3-Flash / Nemotron-3.5-Lightning 30B-A3B class; MiMo-V2.6-Flash, Hunyuan 3 100B+; Mistral Leanstral 119B-A6B;
A1B/A2B entries are LFM derivatives or CC-BY-NC).

MoEfication (owner question) fails the speed bar by arithmetic:

| | Qwen3.5-9B | Gemma 4 12B |
|---|---:|---:|
| dense active/token | 7.93 B | 11.9 B |
| non-FFN active (attn + lm_head) | 3.10 B | 3.41 B |
| carve 25 % FFN active | 4.31 B | 5.54 B |
| carve 12.5 % FFN active | 3.70 B | 4.47 B |
| vs dense 4B (3.57 B read/token) | slower at any carve | slower at any carve |
| Q4 file | ~5.5 GB | ~7.5 GB |

Distilling into a new ~1.5 B-active MoE: >= 50-100 B tokens, ~1.5-3k H100-hours, $5-10k: not affordable.

## Top actions (ranked)

1. Fix the gate before any new number: thinking ON for both with n_predict >= 4096 (or LFM think pre-closed for a
   non-thinking arm), single BOS, store raw outputs, post-cutoff per-document corpus. Re-run on the Mac, $0.
2. Two $0 arms: RAZOR-19B-A3B (k=8 and k=4) and Qwen3.6 unpruned with k=4 / k2=16 renormalisation (router patch in the
   fork). Report CPU (`-ngl 0`) numbers as the PC proxy; dense Qwen3.5-4B as control in every table.
3. Measure resident decode of a ~10 GB MoE on a real 16 GB device (no lab phone has 16 GB).
4. Absolute bars per class instead of 0.5x LFM.
5. In parallel: LoRA-identity Qwen3.5-4B as "Kalsa dense" fallback.

Bet: if RAZOR at k=4 holds within 2 points of dense 4B on fixed GSM8K/tools and within 0.05 bpb on IT, that is
"Kalsa" for 16 GB PCs and phones after a multilingual LoRA heal. Otherwise: dense Qwen3.5-4B as Kalsa base, then a
bigger REAP20/RAZOR for 32 GB PCs only, then wait.

Sources: https://huggingface.co/Nickyang/Qwen3.6-35B-A3B-RAZOR-19B-A3B-E128of256 · https://arxiv.org/html/2609.04575 ·
https://arxiv.org/html/2502.04416 · https://arxiv.org/abs/2606.01666 · https://arxiv.org/abs/2602.15521 ·
https://arxiv.org/html/2609.33614 · https://huggingface.co/Qwen/Qwen3.8-Flash-Next · https://huggingface.co/Qwen/Qwen3.5-9B ·
https://huggingface.co/Qwen/Qwen3.5-4B · https://huggingface.co/google/gemma-4-12B · https://huggingface.co/google/gemma-4-26B-A4B ·
https://arxiv.org/html/2607.02770v1 · https://huggingface.co/blog/state-of-open-models-summer-2026 · https://arxiv.org/abs/2510.13999
