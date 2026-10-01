# Kalsa MoE quality gate probe - Runpod A40, 2026-09-30/10-01

Pod `nytgw2hjgsfz6e` (A40 48 GB SECURE, $0.49/h), engine `spike/topk-k2-renorm` a2f252fbd, scripts
`scratchpad/agents/kalsa-reap-prep/podprobe/` (+ fixes in `RUN-2026-09-30-A40.md`). Results mirrored from the private
HF dataset `Kalsa-ai/kalsa-gate-probe-results` (results/, server.log omitted). Total Runpod spend $6.82 of the
owner's $10 cap; pod deleted 2026-10-01 09:0x UTC after all 9 arms were verified on HF.

| arm | bpb en | it | es | fr | zh | GSM8K (capped@4096) | tools (capped) |
|---|---:|---:|---:|---:|---:|---|---|
| LFM2.5-2.6B ship | 1.101 | 1.476 | 1.273 | 1.331 | 1.718 | 0.900 (10) | 0.81 (0) |
| Qwen3.5-2B Q4_K_M | 0.749 | 0.804 | 0.788 | 0.808 | 1.077 | 0.180 (161) | 0.78 (2) |
| Qwen3.5-2B Q4_0 | 0.755 | 0.813 | 0.794 | 0.819 | 1.085 | 0.145 (168) | 0.78 (6) |
| Qwen3.5-4B Q4_K_M | 0.678 | 0.699 | 0.703 | 0.707 | 0.976 | 0.545 (75) | 0.84 (0) |
| RAZOR-19B k8 Q4_K_M | 0.792 | 1.462 | 1.141 | 1.274 | 1.101 | 0.710 (33) | 0.79 (6) |
| RAZOR-19B k8 Q4_0 | 0.798 | 1.474 | 1.142 | 1.272 | 1.108 | 0.645 (53) | 0.80 (4) |
| RAZOR-19B k4 Q4_K_M | (k8*) | | | | | 0.450 (96) | 0.76 (12) |
| RAZOR-19B k4+k2=16 | (k8*) | | | | | 0.635 (53) | 0.79 (7) |
| Qwen3.6-35B-A3B unpruned "k4" | 0.586* | 0.580* | 0.601* | 0.604* | 0.852* | 0.585 (64) | 0.80 (5) |

*bpb measured at the model's DEFAULT expert count: `30_gate.sh:59` runs `run_bpb_eval.py` without the arm's `"$@"`
overrides, so `expert_used_count=4` / `expert_used_k2` reached the server (GSM8K, tools) but NOT bpb. RAZOR k4 and
k4+k2 bpb are byte-identical to k8; the Qwen3.6 bpb row is Qwen3.6 at its default k (unpruned base), not k4.

Readings, as far as the data goes:
1. RAZOR-19 lost the non-English languages. Same default k: IT 1.462 vs unpruned Qwen3.6 0.580 (2.5x worse), ES 1.141
   vs 0.601, FR 1.274 vs 0.604; EN only 0.792 vs 0.586. In Italian RAZOR is no better than LFM (1.476). The pruning
   (calibrated for English) removed the experts other languages use. For an Italian-first product this prune is out.
2. Unpruned Qwen3.6 beats LFM by a wide margin on bpb in every language (IT 0.58 vs 1.48) - the owner's "stravincere"
   bar on language modelling; speed/RAM on 16 GB devices is NOT measured by this probe (A40 only).
3. GSM8K is confounded by the 4096-token cap (Qwen3.5-2B: 161/200 answers cut while still thinking; LFM only 10). The
   numbers rank how often a model finishes, not only whether it is right. Re-score on uncapped answers or a higher
   cap before any decision on reasoning.
4. Top-k 4 costs RAZOR 26 GSM8K points (0.71 -> 0.45, cap 33 -> 96); the k2=16 renorm recovers most of it (0.635).
5. Tools: all arms within 0.76-0.84; LFM 0.81.
6. Q4_0 vs Q4_K_M: +0.006-0.012 bpb (small).
7. Known gaps: RAZOR k8 Q4_K_M CPU tg128 segfaulted in llama-bench (bench.txt has pp512 only); speed numbers are A40
   CPU/GPU, not phone numbers.
