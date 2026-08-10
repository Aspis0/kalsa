# KEXP campaign baseline (adopted 2026-08-10)

## Identity
- file: `Qwen3.6-35B-A3B-KEXP.gguf`
- size: 13416430592 B
- sha256: `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a`
- phone path: `~/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf`
- link: `~/models/CAMPAIGN.gguf` → KEXP

## Official product metrics (device, CAMPAIGN bin 1ca51420…)
| metric | value | notes |
|---|---|---|
| PPL F=0 | **1.5249** | --ppl-decode corpus_subset_10k |
| PPL drop 0.65 k=8 | **1.5647** | same corpus |
| decode tok/s (phase C, drop 0.65) | ~4.96 med | ABBA vs IQ2_M ~5.12 (−3.1%) |
| KV session | n_common=71 PASS | --session gold gk1_in.jsonl |

## Quality floor for spend (gualt rule)
- **floor product PPL ≤ 2.0955** (never worse than old shipped IQ2_M F=0)
- Everything under the floor is spendable via k × drop grid

## Provenance
- Q8_0: sha `d1a395809f65a43a13ad119eb4e7acdef1ac6d68120f39902c8ab96e72794a59` size 36903140320
- imatrix: `1ff7ed0501e6abe596ffe0be0d6756d15a433358ba7537e4dd75ca9084a2bed2` size 192223904
- recipe: `results/requant1c/tensor_types.txt` (fix: `^output\.weight$=q4_k`)
- quantize: `llama-quantize --allow-requantize --imatrix models/imatrix_unsloth.gguf_file --tensor-type-file results/requant1c/tensor_types.txt models/Qwen3.6-35B-A3B-Q8_0.gguf models/Qwen3.6-35B-A3B-KEXP.gguf Q5_K`
- verify: experts Q2_K/Q3_K 120/0, dense 613/0
- note: Q8 may carry a newer weight revision than IQ2_M of 2026-08-03; decision metric is campaign path + pinned sha

## Historical reference (NOT deleted)
- IQ2_M path: `~/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf`
- IQ2_M PPL F=0 was 2.0955; drop 0.65 was 2.19992
