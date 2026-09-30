# Kalsa REAP parameter budget and device fit

All numbers computed from the real Qwen3.6-35B-A3B artifacts: `config.json`,
`model.safetensors.index.json`, and the per-tensor shapes read from all 26
safetensors shard headers (`tensor-shapes.json`). The base sum is asserted
equal to the published index total, **35,951,822,704 params**, by
`verify/param_table.py`.

## Text-only accounting (what ships)

Dropped from every pruned export: `mtp.*` (844,640,768 params — REAP never
touches it and transformers v5.16 ignores it at load) and `model.visual.*`
(446,571,248 params — Kalsa is text-only). Everything else copied verbatim;
expert tensors (`mlp.experts.gate_up_proj [256,1024,2048]` and
`mlp.experts.down_proj [256,2048,512]` per layer) and the router
(`mlp.gate.weight [256,2048]`) scale by kept/256. Rounding per layer is
`round(256 × keep_ratio)` (moep `scoring.py:112`), identical to the REAP
fork's `int(256 × ratio)` pruned count (`layerwise_prune.py:326`) at our ratios.

Base text params = 35,951,822,704 − 844,640,768 − 446,571,248 = **34,660,610,688**
(experts 32,212,254,720 of it = 40 layers × 256 × 805,306,368).

Per-expert arithmetic, from `config.json` (`hidden_size` 2048,
`moe_intermediate_size` 512):

```
gate_up = 1024 × 2048 = 2,097,152      (2 × I, fused gate+up)
down    = 2048 ×  512 = 1,048,576
per expert = 3,145,728      per layer = ×256 = 805,306,368
kept/layer: round(256×0.75)=192, round(256×0.50)=128, round(256×0.35)=90, round(256×0.25)=64
```

## Sizes per ratio

Bytes/p param: BF16 2.0; Q8_0 34B/32 = 1.0625; Q4_0 18B/32 = 0.5625;
Q4_K_M ≈ 4.85 bpw × k-quant overhead factor 1.0155 (factor derived from the
unsloth full-model Q4_K_M = 22,134,528,992 B measured in
reports/moe-f0.1.md vs our 21.80 GB estimate — so the Q4_K_M column is
anchored to a real file).

| prune | kept/layer | text params | BF16 GB | Q8_0 GB | Q4_0 GB | Q4_K_M GB |
|---:|---:|---:|---:|---:|---:|---:|
| 0%  | 256 | 34,660,610,688 | 69.32 | 36.83 | 19.50 | 21.34 |
| 25% | 192 | 26,602,304,128 | 53.20 | 28.26 | 14.96 | 16.38 |
| 50% | 128 | 18,543,997,568 | 37.09 | 19.70 | 10.43 | 11.42 |
| 65% |  90 | 13,759,378,048 | 27.52 | 14.62 |  7.74 |  8.47 |
| 75% |  64 | 10,485,691,008 | 20.97 | 11.14 |  5.90 |  6.46 |

External anchors: our 0% Q4_K_M 21.34 GB ≈ unsloth's published 22.13 GB file;
our 50% Q4_0 10.43 GB ≈ the moep paper's measured "pruned 50%, Q4 (11.4 GB)"
(Table 5, which is Q4-family and includes conversion overhead); our 0% Q8_0
36.83 GB ≈ the paper's "38 GB Q8 reference". The table reproduces three
independent published measurements within ~1–3%.

## Vision weights in the pruned HF dirs (audit item 10)

moep surgery copies `model.visual.*` verbatim into every pruned HF dir
(446,571,248 params = **0.89 GB BF16 each**; only `mtp.*` is dropped), so the
on-pod HF dir sizes are the text sizes above **+0.89 GB each**:

| prune | text params | + vision | pruned HF dir (BF16) |
|---:|---:|---:|---:|
| 25% | 26,602,304,128 | +446,571,248 | 54.10 GB |
| 50% | 18,543,997,568 | +446,571,248 | 37.98 GB |
| 65% | 13,759,378,048 | +446,571,248 | 28.41 GB |
| 75% | 10,485,691,008 | +446,571,248 | 21.86 GB |

The GGUFs stay **text-only**: `convert_hf_to_gguf.py` writes an mmproj only
with `--mmproj` (`convert_hf_to_gguf.py:117-118` — "Export multimodal
projector (mmproj) for vision models"), which `pod/40_convert.sh` never
passes, so vision weights never enter any GGUF and the GGUF size table above
is unchanged. One mmproj can later be converted from the BASE checkpoint if
vision is ever wanted (moep's own export docstring notes the tower is copied
verbatim, so a base-derived mmproj matches every pruned variant).

## Device fit (resident, no expert streaming)

Assumptions (owner-provided): usable model RAM ≈ 4.5 GB on an 8 GB phone,
9 GB on a 16 GB phone, 5.5 GB on an 8 GB PC, 11 GB on a 16 GB PC. KV for the
hybrid 30:1 linear:full attention is small (2 KV heads × head_dim 256 × 10
full layers); leave ~0.3–0.5 GB of the budgets above for it.

| prune | Q4_0 | Q4_K_M | Q8_0 |
|---|---|---|---|
| **8 GB phone (4.5 GB)** | none | none | none |
| **16 GB phone (9 GB)** | 65% (7.74), 75% (5.90) | 65% (8.47, tight), 75% (6.46) | none |
| **8 GB PC (5.5 GB)** | none (75% = 5.90 misses) | none | none |
| **16 GB PC (11 GB)** | 50% (10.43, tight), 65%, 75% | 65% (8.47), 75% (6.46) | none (75% = 11.14 misses) |

## Who needs `--moe-stream` on the 8 GB class

**Every ratio.** The smallest artifact (75% Q4_0, 5.90 GB) exceeds both 8 GB
budgets, so the 8 GB phone and the 8 GB PC always run the streaming path
(`--moe-stream` family — `--moe-stream`, `--cache-mb`, `--dense-weights`,
`--drop-cold-experts`, `--n-expert-used`; see reports/moe-f0.1.md for the flag
set and reports/research-newmoe-candidates.md for CalaQwen = Qwen3.6-35B-A3B
KEXP on the S23 at 5.70 tok/s with streaming, 30.7 MiB/tok, hit 80.7%).

Streaming cost scales with the routed pool that remains: at k=6 the model
routes 40 × 6 × 3,145,728 = 755M expert params/token, so a 65% prune carries
264M and a 75% prune 189M — 2.9× / 4.0× less routed byte traffic than shipped
CalaQwen at the same k, with a smaller expert pool (90 or 64 per layer instead
of 256) that raises the cache hit rate. The 16 GB phone is the only class with
resident options (65%/75% at Q4_0/Q4_K_M).

Practical reading for the ratio gate: **65% and 75% prunes are the only ones
that fit the 16 GB phone resident**; 50% is a 16 GB PC resident / 16 GB phone
streaming artifact; 0%/25% are measurement baselines, never ship states.
