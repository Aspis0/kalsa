# KV V-cache quality: q8_0 vs q4_0

## Verdict

On five language corpora, `K q8_0 / V q8_0` had lower PPL than the shipping `K q8_0 / V q4_0` in every language, lower mean and 99.9th-percentile KLD against the f16 baseline, and higher same-top-p agreement. This CPU evaluation found no quality loss from changing V to q8_0. It adds 2,048 bytes per token (1.953 MiB per 1,000 tokens) of KV payload.

## Method

- Model: `LFM2.5-2.6B-QAD-Q4_0.gguf`, SHA-256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`.
- Engine: `/Users/marco/Projects/kalsallama`, commit `5b596ce432ee08acdc6559ed656292038ce75f24`, built as CPU-only `llama-perplexity` in detached worktree `/tmp/kalsallama-ppl`. Build command: `cmake --build /tmp/kalsallama-ppl/build-quality --target llama-perplexity -j 8` (exit 0).
- All runs used `-c 4096 -b 512 -ub 512 -t 8 -ngl 0 -fa on --chunks -1 --ppl-stride 0`. Each language had a baseline f16 K/V PPL run saving logits under `/tmp`; both quantized KLD runs used those same-language logits with `--kl-divergence --kl-divergence-base`. Logits were deleted after each language. Cache arms used `-ctk q8_0 -ctv q4_0` and `-ctk q8_0 -ctv q8_0`; baseline used default f16 K/V. No GPU or phone was used.
- PPL and KLD uncertainties are the tool's reported ± values. Window count is the number of 4096-token chunks scored.

## Corpora

| Language | Source | Bytes | SHA-256 |
|---|---|---:|---|
| EN | `scratchpad/agents/q41-ppl-gate/corpus/wikitext-2-raw/wiki.test.raw` (WikiText-2 test) | 1,290,590 | `173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08` |
| IT | `scratchpad/agents/q43-q8trunk-ppl-gate/corpus/it.txt` (frozen MediaWiki extracts; see that directory's `MANIFEST.md`) | 480,565 | `fddf963377e1a90cd02dde9baf1fbe95a003e86f9ec0eebfda6e9b3652027aac` |
| FR | `scratchpad/agents/q43-q8trunk-ppl-gate/corpus/fr.txt` (frozen MediaWiki extracts) | 454,357 | `c477f06d166a387f937784742eb4ac04ac9b4f268f663618f8e28fee8a924f0e` |
| ES | `scratchpad/agents/q43-q8trunk-ppl-gate/corpus/es.txt` (frozen MediaWiki extracts) | 492,128 | `45b4bdbf62de82f8640d259368572553b07240dae7f42eb8c0bdfaa762146915` |
| ZH | `scratchpad/agents/q43-q8trunk-ppl-gate/corpus/zh.txt` (frozen MediaWiki extracts) | 487,776 | `234fe0fdfa8785838f995a9681ea3e1871bcb7c8ca74bf2180e4c90310a5c606` |

## PPL

PPL values are tool estimates with reported error bars. Arm 1 is shipping q8/q4; arm 2 is candidate q8/q8. Each value links to its raw text output in `raw/quality/`.

| Language | Windows | Baseline f16 K/V | Arm 1 PPL | Arm 2 PPL |
|---|---:|---:|---:|---:|
| EN | 71 | [38.3767 ± 0.39627](raw/quality/en-base-ppl.txt) | [38.5617 ± 0.39843](raw/quality/en-q8k-q4v-ppl.txt) | [38.3909 ± 0.39634](raw/quality/en-q8k-q8v-ppl.txt) |
| IT | 31 | [30.6153 ± 0.46077](raw/quality/it-base-ppl.txt) | [30.9677 ± 0.46746](raw/quality/it-q8k-q4v-ppl.txt) | [30.5434 ± 0.45953](raw/quality/it-q8k-q8v-ppl.txt) |
| FR | 28 | [30.9811 ± 0.48599](raw/quality/fr-base-ppl.txt) | [31.7357 ± 0.50029](raw/quality/fr-q8k-q4v-ppl.txt) | [30.9362 ± 0.48512](raw/quality/fr-q8k-q8v-ppl.txt) |
| ES | 30 | [22.7243 ± 0.33391](raw/quality/es-base-ppl.txt) | [23.1062 ± 0.34084](raw/quality/es-q8k-q4v-ppl.txt) | [22.7012 ± 0.33345](raw/quality/es-q8k-q8v-ppl.txt) |
| ZH | 38 | [47.4246 ± 0.62813](raw/quality/zh-base-ppl.txt) | [48.1155 ± 0.63872](raw/quality/zh-q8k-q4v-ppl.txt) | [47.2837 ± 0.62589](raw/quality/zh-q8k-q8v-ppl.txt) |

## KLD vs f16 K/V baseline

Mean KLD includes its reported ± error; p99.9 is the 99.9th percentile. Same-top-p is the scorer's percentage and reported ± error. Raw logs are linked for every arm.

| Language | Arm 1 mean KLD | Arm 1 p99.9 | Arm 1 same-top-p | Arm 2 mean KLD | Arm 2 p99.9 | Arm 2 same-top-p |
|---|---:|---:|---:|---:|---:|---:|
| EN | [0.008017 ± 0.000172](raw/quality/en-q8k-q4v-kld.txt) | 0.279565 | 95.976 ± 0.052% | [0.002170 ± 0.000048](raw/quality/en-q8k-q8v-kld.txt) | 0.064896 | 97.809 ± 0.038% |
| IT | [0.009116 ± 0.000243](raw/quality/it-q8k-q4v-kld.txt) | 0.299801 | 95.498 ± 0.082% | [0.002510 ± 0.000058](raw/quality/it-q8k-q8v-kld.txt) | 0.052127 | 97.479 ± 0.062% |
| FR | [0.009868 ± 0.000272](raw/quality/fr-q8k-q4v-kld.txt) | 0.325058 | 95.171 ± 0.090% | [0.002416 ± 0.000060](raw/quality/fr-q8k-q8v-kld.txt) | 0.057894 | 97.521 ± 0.065% |
| ES | [0.007882 ± 0.000153](raw/quality/es-q8k-q4v-kld.txt) | 0.250753 | 95.825 ± 0.081% | [0.002040 ± 0.000028](raw/quality/es-q8k-q8v-kld.txt) | 0.049553 | 97.655 ± 0.061% |
| ZH | [0.008838 ± 0.000129](raw/quality/zh-q8k-q4v-kld.txt) | 0.196680 | 95.045 ± 0.078% | [0.002469 ± 0.000016](raw/quality/zh-q8k-q8v-kld.txt) | 0.041110 | 97.226 ± 0.059% |

## KV RAM arithmetic

GGUF metadata gives 30 total blocks, 8 attention blocks, 32 query heads, 8 KV heads, and embedding length 2,048; head dimension is `2,048 / 32 = 64`. q8_0 stores 32 values in 34 bytes; q4_0 stores 32 in 18 bytes. K and V are both stored for each KV head:

- Arm 1, K q8_0 / V q4_0: `8 attention layers × 8 KV heads × 64 dimensions × (34 + 18) bytes / 32 = 6,656 bytes/token`, or 6.656 MB (6.348 MiB) per 1,000 tokens.
- Arm 2, K q8_0 / V q8_0: `8 × 8 × 64 × (34 + 34) / 32 = 8,704 bytes/token`, or 8.704 MB (8.301 MiB) per 1,000 tokens.
- Delta: `8 × 8 × 64 × (34 - 18) / 32 = 2,048 bytes/token`, or 2.048 MB (1.953 MiB) per 1,000 tokens.

The app currently selects q8_0 K / q4_0 V in [ModelRegistry.ts:287](/Users/marco/Projects/kalsa/src/engine/ModelRegistry.ts:287); it also records 6,656 bytes per KV token at line 293.
