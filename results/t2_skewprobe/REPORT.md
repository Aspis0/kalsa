SKEW_WEAK/UNIFORM(gini=0.500, top16=24.7%, jaccard=0.057)

T2-M is dead on this model. A 300-token conversation already touches ~86–95% of (layer, expert) slots in a single domain. Across five domains, 7,158 / 7,168 slots fire at least once (10 never-used, 0.14%). The 16 hottest experts capture only ~25% of decode activations on every layer of every domain (0 / 140 layer×domain cells reach the 60% bar). Nightly Q2-demotion of “never-used” experts and clustering of a hot-16 set have nothing to demote and nothing compact to keep.

The low Jaccard (0.057) is not a rescue. Domains do pick different slightly-hotter experts, but each domain still needs ~220–250 of the 256 experts per layer. Sculpting per usage-profile would still leave almost the whole pool resident.

## Verdict ingredients

Thresholds (as specified): SKEW_STRONG requires top-16 ≥ 60% **and** Gini ≥ 0.5 on most layers; SKEW_DOMAIN requires that same within-domain concentration **and** mean pairwise Jaccard < 0.4; otherwise WEAK/UNIFORM.

| check | value | pass? |
|---|---|---|
| mean Gini (full 256-bin, zeros included) | 0.500 | borderline |
| frac of (layer, domain) with Gini ≥ 0.5 **and** top-16 ≥ 0.6 | **0.0** (0 / 140) | no |
| mean top-16 coverage | **24.7%** (domain means 21.2–28.7%; no layer ≥ 60%) | no |
| mean pairwise Jaccard of top-16 sets | 0.057 | low, but irrelevant without concentration |

Gini ~0.5 is *not* a tight-subset signal here. With 256 experts, Gini of a k-hot uniform subset is `1 − k/256`. Observed Gini 0.50 with ~220–250 experts used per layer is a moderately heavy tail on an already-wide support, not a 16-expert club.

## Aggregates per domain (decode only)

Model: Marco-Mini-Instruct-KEXP.gguf · arch `qwen3moe` · 28 layers · 256 experts · campaign k=6. Each domain: 300 decode steps, 50,400 decode rows (`300 × 28 × 6`).

| domain | s | mean Gini | median Gini | layers Gini≥0.5 | mean top-16 | layers top-16≥60% | mean never-used / layer | unused (layer,expert) | unused % | dropped rows |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| coding | 37.3 | 0.576 | 0.567 | 28/28 | 28.7% | 0/28 | 35.5 / 256 | 995 / 7168 | 13.9% | 1578 |
| cooking | 43.5 | 0.493 | 0.505 | 14/28 | 24.1% | 0/28 | 20.2 / 256 | 565 / 7168 | 7.9% | 2527 |
| legal | 45.8 | 0.506 | 0.513 | 16/28 | 24.3% | 0/28 | 24.1 / 256 | 676 / 7168 | 9.4% | 2145 |
| casual | 46.5 | 0.483 | 0.483 | 10/28 | 25.2% | 0/28 | 18.6 / 256 | 522 / 7168 | 7.3% | 2536 |
| math | 55.4 | 0.441 | 0.426 | 3/28 | 21.2% | 0/28 | 13.2 / 256 | 369 / 7168 | 5.1% | 1875 |
| **all 5 combined** | — | **0.500** | — | — | **24.7%** | **0/140** | — | **10 / 7168** | **0.14%** | — |

Coding is the most concentrated domain and still uses a mean 220.5 experts/layer. Math is the most uniform (252 used on layer 25). Combined, the unused set collapses to 10 slots.

## Cross-domain top-16 Jaccard (mean / min / max over 28 layers)

| pair | mean | min | max |
|---|---:|---:|---:|
| coding\|cooking | 0.074 | 0.000 | 0.185 |
| coding\|legal | 0.076 | 0.032 | 0.280 |
| coding\|casual | 0.012 | 0.000 | 0.067 |
| coding\|math | 0.055 | 0.000 | 0.280 |
| cooking\|legal | 0.114 | 0.032 | 0.280 |
| cooking\|casual | 0.044 | 0.000 | 0.143 |
| cooking\|math | 0.073 | 0.000 | 0.185 |
| legal\|casual | 0.020 | 0.000 | 0.067 |
| legal\|math | 0.083 | 0.000 | 0.185 |
| casual\|math | 0.024 | 0.000 | 0.103 |

Mean pairwise = 0.057. Several layers have Jaccard 0 (disjoint top-16), including coding vs casual on the last layer. That is domain-specificity of the *hottest* 16, not of the working set. Layer 27 still has 174 experts used in **every** domain.

## Example layers

`used` = experts with ≥1 decode activation. `never_all` = unused in all five domains at that layer.

| layer | coding gini / top16 / used | cooking | legal | casual | math | mean J | never_all |
|---:|---|---|---|---|---|---:|---:|
| 0 | 0.611 / 28.4% / 220 | 0.358 / 16.5% / 245 | 0.431 / 18.7% / 241 | 0.340 / 16.2% / 251 | 0.410 / 19.6% / 247 | 0.065 | 1 |
| 4 | 0.624 / 32.9% / 210 | 0.400 / 17.6% / 249 | 0.472 / 20.2% / 236 | 0.408 / 20.6% / 249 | 0.387 / 16.7% / 248 | 0.081 | 0 |
| 12 | 0.591 / 31.6% / 222 | 0.599 / 32.4% / 216 | 0.605 / 30.7% / 213 | 0.589 / 31.4% / 224 | 0.556 / 29.6% / 225 | 0.047 | 0 |
| 20 | 0.567 / 29.1% / 228 | 0.516 / 22.8% / 229 | 0.513 / 24.6% / 236 | 0.471 / 22.5% / 240 | 0.404 / 19.8% / 249 | 0.050 | 0 |
| 27 | 0.544 / 24.4% / 218 | 0.489 / 23.4% / 246 | 0.539 / 29.7% / 228 | 0.496 / 24.8% / 239 | 0.398 / 18.4% / 248 | 0.081 | 0 |

Hottest cell in the whole matrix is still ~33% top-16 (coding L4, legal L26). Never-used-in-all-domains is 0–2 per layer.

## Method

**Flag:** `--route-trace PATH` (not `--predict-log`). `--predict-log` only scores “could this layer’s routing have been known a layer early”; it does not dump expert ids. `--route-trace` is the per-step per-layer dump. Requires `--moe-stream`. Engine not modified.

**Dump format** (`# route_trace v1`, see `core/include/bmoe/route_trace.h` + `core/src/metrics/route_trace_sink.cpp`):

```
# route_trace v1
# model=... arch=qwen3moe n_layer=28 n_expert=256 n_expert_used=6
# layer=L expert_bytes=... dense_bytes=...
turn,phase,step,layer,slot,expert,weight,residency,expert_bytes,dropped
```

One row per routed expert (cell of the step × layer matrix). `phase` 0=prefill, 1=decode. `slot` is rank 0..k-1 (descending weight). `weight` is the applied routing weight (`nan` if the graph exposed none). `residency` 0=miss, 1=hit, 2=hit-from-spec. `dropped` is the campaign drop-cold policy, not the router’s choice.

**Run config** (campaign-style k6 d0.65, host `bmoe-cli`):

```
bmoe-cli -m Marco-Mini-Instruct-KEXP.gguf -p <prompt> -n 300 -t 8
  --temp 0 --chatml --no-think
  --moe-stream --cache-mb 2000 --io-threads 4
  --n-expert-used 6 --drop-cold-experts 0.65
  --route-trace results/t2_skewprobe/<domain>.route.csv
```

`build\bin` on PATH for DLLs. Model opened read-only. Five prompts: coding (LRU+TTL), cooking (3-course Italian), legal (SaaS agreement), casual (weekend smalltalk), math (two trains + bird, then generalize).

**Metrics** (decode rows only; prefill excluded so a long generation is not mixed with the prompt):

- Histogram: count of decode rows per (layer, domain, expert id).
- Gini: standard Gini of the 256-bin count vector **including zeros**.
- top-16 share: sum of the 16 largest bins / layer activations (always 1,800 = 300×6).
- Jaccard: `|top16_A ∩ top16_B| / |top16_A ∪ top16_B|` per layer, then mean over layers and pairs.
- Never-used: bins with count 0. Reported per (layer, domain), as (layer, expert) pairs per domain, and as the intersection across all five domains.
- Dropped rows are **counted as usage** (the router selected them; `dropped` only records that the cache policy then skipped the flash read). Drop rate is 3.1–5.0% of decode rows; excluding them would not move top-16 near 60% or create a large unused set.

## Why this kills T2-M

The REM-sleep bet needs two things at once:

1. A large, stable unused set that a phone can evict to Q2 overnight.
2. A small hot set worth clustering (the “top-16 ≥ 60%” bar).

This probe hits neither. 300 decode tokens at k=6 already spread 1,800 activations/layer across ~210–250 experts. More tokens (a real evening of chat) can only grow the used set, not shrink it. Five domains together leave 10 slots untouched. The hottest 16 never carry even a third of the traffic, let alone 60%.

Jaccard < 0.4 would have meant “sculpt per profile” **if** each profile were concentrated. It is not. Different domains reshuffle which 16 are slightly hotter; they do not free the rest of the pool.

## What this does *not* prove

- Other models (Mellum, 128-expert, different k) are untested. This is the campaign KEXP on PC.
- Multi-turn user histories were not run. The saturation argument above says more tokens make unused *smaller*.
- Weight-mass Gini (sum of `weight` instead of activation counts) was not the specified metric; counts are the right unit for “was this expert needed on disk”.
- Prefill-only routing was excluded. Including it would add prompt-side experts and shrink unused further.

## Artifacts

All under `C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\t2_skewprobe\`:

| file | what |
|---|---|
| `run_and_analyze.py` | runner + metrics |
| `{coding,cooking,legal,casual,math}.route.csv` | `--route-trace` dumps (~1.96–2.38 MB) |
| `{coding,cooking,legal,casual,math}.log` / `.gen.txt` | full cli stdout (prompt echo + 300-token gen) |
| `analysis.json` | full per-layer numbers + top-16 id lists |
| `per_layer_metrics.csv` | one row per layer, all domain metrics |
| `jaccard_pairs.csv` | pairwise top-16 Jaccard mean/min/max |
| `verdict.txt` | one-line verdict |
| `orchestrator.stdout.log` | run log (37–55 s/domain, all exit 0) |
