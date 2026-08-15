SIMPROBE_DEAD(max_offdiag=0.019704)

# T2-B expert similarity probe

- Script: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\t2_simprobe\simprobe.py`
- Artifacts: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\t2_simprobe`
- Dequant: **`gguf.dequantize` → f32** (Mellum2: Q4_K / Q5_0 / Q8_0; Qwen: Q2_K / Q3_K). Not raw-byte comparison.
- Similarity: cosine on **full flattened** expert matrices (no row/col sampling).
- Also computed relative Frobenius `||Wi-Wj||_F / ||Wi||_F` (saved as npy).
- Clusters: greedy union-find (single-linkage connected components) at cos ≥ 0.95.
- Multiplier: `n_experts / n_clusters`.

## Mellum2-12B-A2.5B-Instruct-Q4_K_M

**Verdict:** `SIMPROBE_DEAD(max_offdiag=0.019704)`

- arch=`mellum`  layers=28  experts=64  used=8  hidden=2304  expert_ff=896
- sampled layers: [0, 4, 8, 12, 16, 20, 24, 27]
- qtypes: `{"ffn_down_exps": {"Q8_0": 14, "Q5_0": 14}, "ffn_gate_exps": {"Q4_K": 28}, "ffn_up_exps": {"Q4_K": 28}}`
- within-layer: max off-diag cos=0.019704, mean off-diag cos=0.000496
- cross-layer baseline: mean=0.000045, max=0.002441
- wall time: 114.7s

| layer | family | qtype | max cos | mean cos | #>0.95 | #>0.99 | clusters@0.95 | mult |
|------:|--------|-------|--------:|---------:|-------:|-------:|--------------:|-----:|
| 0 | ffn_gate_exps | Q4_K | 0.0045 | 0.0013 | 0 | 0 | 64 | 1.000 |
| 0 | ffn_up_exps | Q4_K | 0.0023 | -0.0000 | 0 | 0 | 64 | 1.000 |
| 0 | ffn_down_exps | Q8_0 | 0.0026 | 0.0000 | 0 | 0 | 64 | 1.000 |
| 4 | ffn_gate_exps | Q4_K | 0.0042 | 0.0010 | 0 | 0 | 64 | 1.000 |
| 4 | ffn_up_exps | Q4_K | 0.0023 | -0.0000 | 0 | 0 | 64 | 1.000 |
| 4 | ffn_down_exps | Q5_0 | 0.0025 | -0.0000 | 0 | 0 | 64 | 1.000 |
| 8 | ffn_gate_exps | Q4_K | 0.0057 | 0.0014 | 0 | 0 | 64 | 1.000 |
| 8 | ffn_up_exps | Q4_K | 0.0023 | -0.0000 | 0 | 0 | 64 | 1.000 |
| 8 | ffn_down_exps | Q8_0 | 0.0027 | 0.0000 | 0 | 0 | 64 | 1.000 |
| 12 | ffn_gate_exps | Q4_K | 0.0064 | 0.0012 | 0 | 0 | 64 | 1.000 |
| 12 | ffn_up_exps | Q4_K | 0.0025 | -0.0000 | 0 | 0 | 64 | 1.000 |
| 12 | ffn_down_exps | Q5_0 | 0.0032 | 0.0000 | 0 | 0 | 64 | 1.000 |
| 16 | ffn_gate_exps | Q4_K | 0.0068 | 0.0013 | 0 | 0 | 64 | 1.000 |
| 16 | ffn_up_exps | Q4_K | 0.0023 | -0.0000 | 0 | 0 | 64 | 1.000 |
| 16 | ffn_down_exps | Q5_0 | 0.0025 | 0.0000 | 0 | 0 | 64 | 1.000 |
| 20 | ffn_gate_exps | Q4_K | 0.0112 | 0.0018 | 0 | 0 | 64 | 1.000 |
| 20 | ffn_up_exps | Q4_K | 0.0023 | -0.0000 | 0 | 0 | 64 | 1.000 |
| 20 | ffn_down_exps | Q8_0 | 0.0022 | 0.0000 | 0 | 0 | 64 | 1.000 |
| 24 | ffn_gate_exps | Q4_K | 0.0116 | 0.0019 | 0 | 0 | 64 | 1.000 |
| 24 | ffn_up_exps | Q4_K | 0.0022 | 0.0000 | 0 | 0 | 64 | 1.000 |
| 24 | ffn_down_exps | Q8_0 | 0.0027 | -0.0000 | 0 | 0 | 64 | 1.000 |
| 27 | ffn_gate_exps | Q4_K | 0.0197 | 0.0022 | 0 | 0 | 64 | 1.000 |
| 27 | ffn_up_exps | Q4_K | 0.0059 | -0.0000 | 0 | 0 | 64 | 1.000 |
| 27 | ffn_down_exps | Q8_0 | 0.0037 | -0.0000 | 0 | 0 | 64 | 1.000 |

### Cross-layer baseline

| La | Lb | family | aligned mean/max | mismatched mean/max | random mean/max |
|---:|---:|--------|-----------------:|--------------------:|----------------:|
| 0 | 16 | ffn_gate_exps | 0.0002 / 0.0017 | 0.0000 / 0.0014 | 0.0001 / 0.0016 |
| 0 | 16 | ffn_up_exps | -0.0001 / 0.0014 | 0.0000 / 0.0020 | 0.0002 / 0.0021 |
| 0 | 16 | ffn_down_exps | -0.0001 / 0.0015 | 0.0000 / 0.0024 | 0.0000 / 0.0011 |
| 4 | 24 | ffn_gate_exps | 0.0001 / 0.0020 | 0.0000 / 0.0022 | 0.0001 / 0.0015 |
| 4 | 24 | ffn_up_exps | -0.0001 / 0.0016 | 0.0001 / 0.0015 | 0.0001 / 0.0015 |
| 4 | 24 | ffn_down_exps | 0.0000 / 0.0013 | 0.0001 / 0.0016 | -0.0001 / 0.0013 |
| 0 | 27 | ffn_gate_exps | 0.0000 / 0.0015 | -0.0001 / 0.0013 | -0.0001 / 0.0014 |
| 0 | 27 | ffn_up_exps | 0.0001 / 0.0015 | -0.0001 / 0.0016 | -0.0000 / 0.0011 |
| 0 | 27 | ffn_down_exps | 0.0000 / 0.0015 | 0.0002 / 0.0020 | 0.0001 / 0.0014 |

### Interpretation

Within-layer max off-diag cosine is 0.020 (last-layer `ffn_gate_exps`); every other sampled tensor is ≤ 0.012. Cross-layer baseline max is 0.002. Same order of magnitude as random high-D weights. **Zero pairs at cos≥0.95 on every layer/family. Multiplier = 1.00 everywhere.** A representative-expert cache cannot multiply capacity. The trick is **DEAD**.

## Qwen3.6-35B-A3B-KEXP

**Verdict:** `SIMPROBE_DEAD(max_offdiag=0.139725)`

- arch=`qwen35moe`  layers=40  experts=256  used=8  hidden=2048  expert_ff=512
- sampled layers: [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 39]
- qtypes: `{"ffn_down_exps": {"Q3_K": 40}, "ffn_gate_exps": {"Q2_K": 40}, "ffn_up_exps": {"Q2_K": 40}}`
- within-layer: max off-diag cos=0.139725, mean off-diag cos=0.001939
- cross-layer baseline: mean=0.000162, max=0.008769
- wall time: 366.2s

| layer | family | qtype | max cos | mean cos | #>0.95 | #>0.99 | clusters@0.95 | mult |
|------:|--------|-------|--------:|---------:|-------:|-------:|--------------:|-----:|
| 0 | ffn_gate_exps | Q2_K | 0.0673 | 0.0016 | 0 | 0 | 256 | 1.000 |
| 0 | ffn_up_exps | Q2_K | 0.0053 | -0.0000 | 0 | 0 | 256 | 1.000 |
| 0 | ffn_down_exps | Q3_K | 0.0040 | -0.0000 | 0 | 0 | 256 | 1.000 |
| 4 | ffn_gate_exps | Q2_K | 0.0376 | 0.0026 | 0 | 0 | 256 | 1.000 |
| 4 | ffn_up_exps | Q2_K | 0.0044 | 0.0000 | 0 | 0 | 256 | 1.000 |
| 4 | ffn_down_exps | Q3_K | 0.0040 | 0.0000 | 0 | 0 | 256 | 1.000 |
| 8 | ffn_gate_exps | Q2_K | 0.0360 | 0.0077 | 0 | 0 | 256 | 1.000 |
| 8 | ffn_up_exps | Q2_K | 0.0051 | 0.0000 | 0 | 0 | 256 | 1.000 |
| 8 | ffn_down_exps | Q3_K | 0.0044 | 0.0000 | 0 | 0 | 256 | 1.000 |
| 12 | ffn_gate_exps | Q2_K | 0.1397 | 0.0040 | 0 | 0 | 256 | 1.000 |
| 12 | ffn_up_exps | Q2_K | 0.0042 | 0.0000 | 0 | 0 | 256 | 1.000 |
| 12 | ffn_down_exps | Q3_K | 0.0051 | -0.0000 | 0 | 0 | 256 | 1.000 |
| 16 | ffn_gate_exps | Q2_K | 0.0157 | 0.0024 | 0 | 0 | 256 | 1.000 |
| 16 | ffn_up_exps | Q2_K | 0.0044 | 0.0000 | 0 | 0 | 256 | 1.000 |
| 16 | ffn_down_exps | Q3_K | 0.0054 | -0.0000 | 0 | 0 | 256 | 1.000 |
| 20 | ffn_gate_exps | Q2_K | 0.0377 | 0.0101 | 0 | 0 | 256 | 1.000 |
| 20 | ffn_up_exps | Q2_K | 0.0049 | -0.0000 | 0 | 0 | 256 | 1.000 |
| 20 | ffn_down_exps | Q3_K | 0.0043 | -0.0000 | 0 | 0 | 256 | 1.000 |
| 24 | ffn_gate_exps | Q2_K | 0.0742 | 0.0038 | 0 | 0 | 256 | 1.000 |
| 24 | ffn_up_exps | Q2_K | 0.0045 | -0.0000 | 0 | 0 | 256 | 1.000 |
| 24 | ffn_down_exps | Q3_K | 0.0048 | -0.0000 | 0 | 0 | 256 | 1.000 |
| 28 | ffn_gate_exps | Q2_K | 0.0161 | 0.0028 | 0 | 0 | 256 | 1.000 |
| 28 | ffn_up_exps | Q2_K | 0.0043 | 0.0000 | 0 | 0 | 256 | 1.000 |
| 28 | ffn_down_exps | Q3_K | 0.0046 | 0.0000 | 0 | 0 | 256 | 1.000 |
| 32 | ffn_gate_exps | Q2_K | 0.0514 | 0.0056 | 0 | 0 | 256 | 1.000 |
| 32 | ffn_up_exps | Q2_K | 0.0049 | -0.0000 | 0 | 0 | 256 | 1.000 |
| 32 | ffn_down_exps | Q3_K | 0.0048 | -0.0000 | 0 | 0 | 256 | 1.000 |
| 36 | ffn_gate_exps | Q2_K | 0.0514 | 0.0137 | 0 | 0 | 256 | 1.000 |
| 36 | ffn_up_exps | Q2_K | 0.0044 | -0.0000 | 0 | 0 | 256 | 1.000 |
| 36 | ffn_down_exps | Q3_K | 0.0047 | 0.0000 | 0 | 0 | 256 | 1.000 |
| 39 | ffn_gate_exps | Q2_K | 0.0485 | 0.0096 | 0 | 0 | 256 | 1.000 |
| 39 | ffn_up_exps | Q2_K | 0.0059 | 0.0000 | 0 | 0 | 256 | 1.000 |
| 39 | ffn_down_exps | Q3_K | 0.0053 | 0.0000 | 0 | 0 | 256 | 1.000 |

### Cross-layer baseline

| La | Lb | family | aligned mean/max | mismatched mean/max | random mean/max |
|---:|---:|--------|-----------------:|--------------------:|----------------:|
| 0 | 20 | ffn_gate_exps | 0.0004 / 0.0065 | 0.0003 / 0.0088 | -0.0000 / 0.0017 |
| 0 | 20 | ffn_up_exps | -0.0000 / 0.0024 | 0.0000 / 0.0027 | 0.0003 / 0.0024 |
| 0 | 20 | ffn_down_exps | -0.0000 / 0.0036 | 0.0000 / 0.0035 | 0.0003 / 0.0022 |
| 4 | 36 | ffn_gate_exps | 0.0011 / 0.0106 | 0.0011 / 0.0053 | 0.0009 / 0.0037 |
| 4 | 36 | ffn_up_exps | -0.0000 / 0.0033 | 0.0000 / 0.0031 | -0.0000 / 0.0021 |
| 4 | 36 | ffn_down_exps | 0.0000 / 0.0026 | 0.0001 / 0.0029 | -0.0005 / 0.0015 |
| 0 | 39 | ffn_gate_exps | 0.0002 / 0.0062 | 0.0003 / 0.0062 | 0.0003 / 0.0032 |
| 0 | 39 | ffn_up_exps | -0.0001 / 0.0024 | 0.0000 / 0.0035 | -0.0000 / 0.0016 |
| 0 | 39 | ffn_down_exps | 0.0000 / 0.0029 | -0.0001 / 0.0029 | 0.0001 / 0.0017 |

### Interpretation

`ffn_up` / `ffn_down` sit on the cross-layer baseline (max ~0.005). `ffn_gate` has a slightly heavier tail (L12 max 0.140, a few layers 0.04–0.07) — above the ~0.01 cross-layer max, but still an order of magnitude below any cache-useful threshold. **Zero pairs at cos≥0.95. 256 clusters everywhere. Multiplier = 1.00.** Same verdict: **DEAD**. (Qwen has 256 experts, not 64.)

## Method caveats

- Dequant used the official `gguf` Python dequantizer to f32, not raw quantized bytes. Mellum2: gate/up = Q4_K, down = Q8_0 or Q5_0 (Q4_K_M mix). Qwen KEXP: gate/up = Q2_K, down = Q3_K.
- Full matrices (no row/col sampling). Mellum2 experts are 896×2304 (~2.06e6 dims); Qwen 512×2048 (~1.05e6 dims). A near-duplicate pair would still score cos≈1.
- Clustering is single-linkage (greedy union-find). Complete-linkage would only *increase* cluster count (lower multiplier). Irrelevant here: no edges exist at 0.95.
- Weight-space cosine ≠ activation-space interchangeability. This probe only falsifies *weight redundancy*. If two experts computed similar functions with unaligned weights, this test would miss it — but a byte-cache of near-duplicate matrices would not help that case either.
- Cross-layer compares the same family after dequant to f32 (possibly different source quant types).
- models/ was opened read-only (`GGUFReader(..., mode='r')` memmap). Nothing written under models/.
- Runtime: Mellum2 115s + Qwen 366s ≈ 8 min on this PC. Well under the 1h budget.

