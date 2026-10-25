# LFM2.5-2.6B quants against BF16, five languages (multi5 KLD), 2026-09-28

Distribution-fidelity measurement of the catalog's candidate quants against the
BF16 reference, on the multi5 corpus (Wikipedia "Caffè" and its sibling articles in
it/en/es/fr/zh), M1 Max, Metal. Every number below is MEASURED today, 2026-09-28,
except where the arithmetic that produced it is stated.

## Method

Per language `L` in `it, en, es, fr, zh`, exactly two commands, in this order:

```
llama-perplexity -m LFM2.5-2.6B-BF16.gguf  -f corpus/multi5/$L.txt -c 512 -ngl 99 --kl-divergence-base /tmp/multi5/$L.kld
llama-perplexity -m <arm>.gguf             -f corpus/multi5/$L.txt -c 512 -ngl 99 --kl-divergence-base /tmp/multi5/$L.kld --kl-divergence
```

Reference = BF16; arms = Q8_0, Q6_K, Q4_0 QAD. Batch/ubatch at the tool defaults
(2048/512), no seed or sampling involved (PPL and logits are deterministic). The
binary is the app's own fork build — the `llama-perplexity` sitting in the Metal
bundle next to the v1.1.2 `kalsa-server`
(`…/runtime/builds/metal/kalsa-server-v1.1.2/`, `version: 0.4.1-dev (build 11198,
commit 5102686dd)` — the same build string the speed benches of 09-26 report). No
build was needed. Kalsa.app and its engine were running throughout, untouched; the
measurement does not time anything load-sensitive.

All 20 runs exited 0 (`EXIT=0` captured per run; logs in `/tmp/multi5/*-{tag}-{lang}.log`).

## Corpus

`/Users/marco/Projects/kalsa-moe-experiments/corpus/multi5/`, hashed today against
`SHA256SUMS`:

| file | bytes | sha256 today | vs SHA256SUMS |
|---|---|---|---|
| en.txt | 50 943 | `6a9f9bda…21b65bfb` | match |
| es.txt | 52 648 | `2dd7027b…818a6e3a` | match |
| fr.txt | 50 848 | `b32e09c5…f2ba65061` | match |
| it.txt | 45 747 | `498a5f3b…8ba85545a` | **stale SUMS** |
| zh.txt | 50 284 | `be40bbe1…9bf19251b` | match |

The `it` line of `SHA256SUMS` (`0aeaa45c…`, 50 054 B) hashes to `it_v1_literary.txt`
— verified today — and is the older literary Dante slice the project retired. The
file on disk as `it.txt` is the Wikipedia «Caffè» v2 slice the task and
`IT_V2_NOTE.md` name; that is what ran. (The staleness is already on record in
`kalsa-moe-experiments/scratchpad/agents/q41-ppl-gate/CORPUS.md`.)

## PPL (lower is better)

BF16 measured directly (`Final estimate: PPL`). For the arms the tool reports the
ratio `PPL(Q)/PPL(base)` (± SEM), so the absolute values below are base × measured
ratio — derived by that one multiplication, ratios as printed.

| quant | it | en | es | fr | zh |
|---|---|---|---|---|---|
| BF16 (reference) | 58.81 | 30.89 | 43.09 | 43.27 | 47.66 |
| Q8_0 | 60.40 | 30.91 | 43.71 | 43.55 | 47.78 |
| Q6_K | 58.06 | 30.50 | 44.11 | 42.44 | 47.38 |
| Q4_0 QAD | 44.37 | 27.74 | 34.97 | 35.71 | 42.04 |

Read the Q4_0 row with the next table: its PPL is *below* the reference (ratios
0.75–0.90) because the QAD file is a distilled quant — its whole distribution is
shifted toward sharper outputs, which teacher-forced PPL rewards and fidelity to the
reference punishes. PPL alone would flatter it; the KLD columns are the honest
distance to BF16.

## Mean KLD (distance to BF16's own next-token distribution; lower is closer)

| quant | it | en | es | fr | zh |
|---|---|---|---|---|---|
| Q8_0 | 0.00174 | 0.00082 | 0.00145 | 0.00134 | 0.00143 |
| Q6_K | 0.02012 | 0.00835 | 0.01587 | 0.01450 | 0.01622 |
| Q4_0 QAD | 0.22782 | 0.09765 | 0.18273 | 0.17658 | 0.18337 |

## KLD 99th percentile (the tail where a quant is most wrong)

| quant | it | en | es | fr | zh |
|---|---|---|---|---|---|
| Q8_0 | 0.0156 | 0.0067 | 0.0149 | 0.0112 | 0.0109 |
| Q6_K | 0.1876 | 0.0672 | 0.1610 | 0.1175 | 0.1368 |
| Q4_0 QAD | 2.0502 | 0.8126 | 1.5525 | 1.5312 | 1.2712 |

## Same top p (share of positions picking the same top token as BF16)

| quant | it | en | es | fr | zh |
|---|---|---|---|---|---|
| Q8_0 | 97.66 % | 98.82 % | 98.24 % | 97.94 % | 98.01 % |
| Q6_K | 93.02 % | 95.56 % | 94.45 % | 93.87 % | 93.07 % |
| Q4_0 QAD | 79.07 % | 85.71 % | 81.16 % | 79.74 % | 79.62 % |

(Each `Same top p` line in the logs carries ± ~0.1–0.2 % SEM. Italian is the
hardest language for every quant — it is also the slice every earlier gate ran.)

## File sizes and speed

| quant | bytes | GiB | tg128 d0 | tg128 @ d8192 |
|---|---|---|---|---|
| BF16 | 5 403 158 528 | 5.03 | 50.8 (09-26) | 48.1 (09-26) |
| Q8_0 | 2 874 779 648 | 2.68 | 81.0 (09-26) | 75.2 (09-26) |
| Q6_K | 2 221 615 104 | 2.06 | 91.59 ± 2.03 (today) | 83.73 ± 0.50 (today) |
| Q4_0 QAD | 1 593 894 944 | 1.48 | 125.24 ± 1.17 (today) | 112.34 ± 0.17 (today) |

Speeds are llama-bench tg128, threads 8, fa on, q8_0 KV, same fork build; today's
two rows were measured with Kalsa.app's Qwen 35B engine resident on the GPU (untouched),
and sit within noise of the 09-26 numbers for the same quant. The BF16/Q8_0 rows are
the 09-26 measurements (`docs/quiz-2026-09-26/speed-bench-LFM2.5-2.6B-BF16.md`,
`…-Q8_0.md`) — not re-measured today. File identity: Q6_K is the official LiquidAI
file from the catalog-pinned commit (`e7caca5d…`), sha256 `2e74b1a0…9c250d`;
Q8_0 sha256 `1e22128d…b0fc9` (catalog pin, verified 09-28); Q4_0 QAD local file
sha256 `a247afd6…8d40b03`; BF16 local file sha256 `590b1534…a360edb5`.

No shipping recommendation here — the fidelity/speed/size trade-off is the owner's call.

## Cleanup

The five per-language base logits files `/tmp/multi5/{it,en,es,fr,zh}.kld`
(measured 1.3–1.9 GB each, 7.7 GB total) were deleted by exact name after the runs;
so was the run script `/tmp/multi5/run.sh`. The run logs (small text, 144 KB) remain
in `/tmp/multi5/`.
