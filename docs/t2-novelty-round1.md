# Novelty web-sweep — three MoE-on-device trick candidates

**Date:** 2026-08-15  
**Bar applied:** "nobody has even TRIED it". False NOVEL is expensive; this report errs toward prior art.  
**None of the three clears that bar.** Two are near-duplicates of published systems; one is a known algorithm whose naive form is already shown to fail.

---

## Candidate A — Two-tier LOSSY expert cache with router-weight-conditioned serving

### Verdict: **NEAR-DUPLICATE**

Closest match: **HOBBIT** (Tang et al., 2024). Same serve-time policy (router-weight / gate-score decides high vs low precision) and same two-precision cache idea. DyMoE and DynaExq independently implement mixed-precision expert caches with promotion/demotion. The remaining sliver — *on-the-fly re-quantize Q4_K→Q2_K at eviction instead of storing both versions, then flash-reread only high-weight misses* — is an implementation variant of a tried idea, not "nobody tried mixed-precision two-tier + router-gated serve".

### What the candidate is

1. Evict from a full-precision RAM expert cache by **re-quantizing** the expert (e.g. Q4_K → Q2_K, ~3× denser) into a **second RAM tier**, instead of discarding.  
2. Serve: full-precision hit if present; **lossy tier allowed only when this token's router weight is below a threshold**.  
3. Flash re-read only for **high-weight misses**.

### What prior art actually does

**HOBBIT — A Mixed Precision Expert Offloading System for Fast MoE Inference**  
https://arxiv.org/abs/2411.01433 (HTML: https://arxiv.org/html/2411.01433v2)

- Token-level dynamic expert loading: on a cache miss, rank selected experts by `||G(x)_e||` (router weight; they measure Pearson 0.99 vs `||G(x) E(x)||`).
- Thresholds T1/T2: important miss → load high-precision from CPU/SSD; moderately unimportant → **load a pre-stored low-precision version**; very unimportant → skip. Mixtral example: T1=0.6, T2=0.9 → 67% HP / 30% LP / 3% skip.
- **Separate high-precision and low-precision caches** in GPU memory; LHU eviction prefers keeping frequently-used *high-precision* copies because an HP miss costs ~bitwidth-ratio more than an LP miss.
- Built on llama.cpp. Jetson Orin + RTX 4090. Int4 replacement for FP16, Int2 for Int8.
- **Not** re-quantize-on-evict. Low-precision copies are **pre-quantized offline and loaded from storage**. Eviction from the HP cache does **not** demote that tensor into the LP cache by converting it.

This is the same *serve-time contract* as A (router weight gates whether lossy is acceptable; high-weight misses pay full I/O). The difference is *how the LP copy is produced* (pre-store + load vs compute-on-evict) and *where* the LP copy lives (HOBBIT: second cache populated from storage; A: second RAM tier populated from the evicted HP tensor).

**DyMoE — Dynamic Expert Orchestration with Mixed-Precision Quantization for Efficient MoE Inference on Edge**  
https://arxiv.org/abs/2603.19172 (HTML: https://arxiv.org/html/2603.19172)

- Edge, Mixtral-8×7B / Qwen3-30B-A3B, 12–24 GB. Decode importance = **gate score g_j** (exactly the router-weight signal).
- Mixed-precision cache: High (4-bit) or Low (2-bit or 0-bit skip). Rules: no duplication; **precision promotion** (Low cached but High requested → miss, load High, evict Low); conservative reuse (High cached, Low requested → use High).
- Loads the designated precision **from CPU/SSD**. Does not re-quantize an evicted HP expert in place.

**DynaExq — Dynamic Expert Quantization for Scalable Mixture-of-Experts Inference**  
https://arxiv.org/abs/2511.15015 (HTML: https://arxiv.org/html/2511.15015)

- Explicit **promote / demote** of per-expert precision under a hard HBM budget.
- Each expert has two **pre-packed** versions (hi/lo). Scheduler tracks long-horizon router hotness (EMA of activation counts), not the current token's gate weight.
- "The design **avoids on-the-fly repacking** during promotion" — they considered runtime re-quantize and rejected it. Demotion = copy the pre-packed LP version onto the GPU and drop HP.
- All experts stay resident at some precision (no flash re-read path).

**PagedWeight** (https://arxiv.org/abs/2607.16184) dynamically drops Any-Precision **bit-planes** of expert linear-blocks under KV-cache pressure, routing-aware. Server vLLM, not a two-tier expert *cache*, not per-token router-weight serve gating, not flash.

**EdgeMoE** (https://arxiv.org/abs/2308.14352) assigns a **static** per-expert bitwidth offline from importance profiling. HOBBIT's intro is explicit: EdgeMoE is inflexible across environments. Not runtime eviction/serve.

**Mixtral-offloading** (https://arxiv.org/abs/2312.17238) uses HQQ mixed 4+2 **statically** (attention 4-bit, MoE 2-bit) plus LRU expert cache and next-layer prefetch. No router-gated precision at serve time.

**llama.cpp #20757** (https://github.com/ggml-org/llama.cpp/issues/20757, Mar 2026) requests a **lossless** two-tier GPU+RAM expert slot cache (SLRU). Tier 2 is pinned full-precision RAM, not a lossy requantized tier.

Checked and different: MoE-Infinity (activation-aware lossless cache), Fiddler (CPU compute instead of transfer), Pre-gated MoE (arch change for prefetch), ExpertFlow / ProMoE (predictive cache), SwapMoE (virtual-expert remap by importance, not precision), PowerInfer 1/2 (neuron hot/cold, not experts), LLM-in-a-Flash (page weights from NAND, not mixed-precision expert tiers), DeepSpeed-Inference (layer offload), ollama/mlc-llm (no this policy), SiDA-MoE (hashing / data-aware sparsity), BrainStorm (OSDI'23 dynamic-NN runtime), ZipMoE (lossless compression + cache-affinity). No relevant patent hits on the exact eviction-requantize + router-gated serve combo.

### Three closest works (one line each)

| Work | How it differs from A |
|---|---|
| **HOBBIT** https://arxiv.org/abs/2411.01433 | Same router-weight HP/LP serve policy and two precision caches; LP copies are **pre-stored and loaded on miss**, not produced by re-quantizing an evicted HP expert in RAM. |
| **DyMoE** https://arxiv.org/abs/2603.19172 | Same mixed-precision cache + gate-score serve + promotion; still **loads** HP/LP from host/SSD, does not demote-by-requantize on eviction. |
| **DynaExq** https://arxiv.org/abs/2511.15015 | Explicit HP↔LP demotion under a memory budget, but on **pre-packed** versions, long-horizon hotness (not per-token weight), and they **refuse** on-the-fly requantize. |

### Remaining sliver (do not treat as NOVEL)

On-the-fly Q4_K→Q2_K at eviction (compute, so you do not store both layouts) + flash-only-for-high-weight-misses, on a phone. That storage-vs-compute tradeoff is real (DynaExq avoided it for a reason: requantize is CPU-heavy and Q4_K→Q2_K is not a bit-plane drop). It is still the same *system idea* HOBBIT/DyMoE/DynaExq already shipped. Engineering a llama.cpp Q4→Q2 evict path is not "nobody tried two-tier lossy expert cache gated by router weight".

### Search queries run (A)

- `HOBBIT mixed-precision expert loading MoE inference eviction quantization`
- `lossy expert cache OR "re-quantize" OR requantize OR "quantize on eviction" MoE experts RAM cache`
- `DynaExq Dynamic expert quantization for scalable mixture-of-experts inference arxiv`
- `site:github.com/ggerganov/llama.cpp expert cache quantization eviction OR "q2" OR "lossy" MoE` (then `llama.cpp MoE expert cache quantization eviction mixtral offloading github`)
- `patent MoE expert cache mixed precision quantization eviction router weight`
- Plus paper fetches: HOBBIT v2 HTML, PagedWeight 2607.16184, DyMoE 2603.19172, DynaExq 2511.15015, llama.cpp #20757

---

## Candidate B — Runtime expert-similarity cache folding (dedup)

### Verdict: **NEAR-DUPLICATE**

Closest match: **SMoE** (Zhu et al., 2025/2026) for the *cache-path, model-intact substitution* half; **MC-SMoE / PuzzleMoE / HC-SMoE** for the *weight-similarity cluster + optional low-rank residual* half. Nobody stores "one representative per weight-cluster in the RAM cache only" as a named system, but that is the obvious glue of those two published ideas. Not "nobody tried serving expert B from a similar expert already in cache".

### What the candidate is

- Offline: cluster experts *within a layer* by **weight similarity**.  
- Runtime: RAM cache holds **one representative per cluster** (optionally + a low-rank delta).  
- Serve near-duplicate experts from that representative. **Model weights stay intact**; folding is cache-only.

Must distinguish from offline expert merging/pruning that *changes the checkpoint*.

### What prior art actually does

**SMoE — An Algorithm-System Co-Design for Pushing MoE to the Edge via Expert Substitution**  
https://arxiv.org/abs/2508.18983 (HTML: https://arxiv.org/html/2508.18983v3)

- Third category vs prefetch and prune: **expert substitution**.
- Low-score top-k experts (router scores near the inactive tail) are **replaced by functionally similar experts already in the GPU cache**. Similarity here is **score proximity** (threshold α around S_{k+1}), not cosine of weights.
- Model intact. Cache still stores full distinct experts; substitution only changes *which identity* runs.
- Edge: 3080 Ti / 4060 Ti / A6000; DeepSeek-MoE-16B, XVERSE-MoE, Qwen2-57B-A14B. ~48% decode latency cut, cache hit >60%, "almost no accuracy loss" at α ≤ 0.35.

This is the same *serving-path* claim: "do not load the requested expert; compute with a similar one that is already resident".

**Mixture of Cache-Conditional Experts for Efficient Mobile Device Inference**  
https://arxiv.org/abs/2412.00099 (HTML: https://arxiv.org/html/2412.00099v2)

- Qualcomm / mobile. Training-free **lossy, cache-aware reranking**: add a bias to in-cache experts so the router prefers them (Cache-Prior).
- Explicitly: models are insensitive to swapping **lower-weighted** experts; lossy routing beats the lossless cache-hit bound. Mentions HOBBIT and AdapMoE as other lossy strategies.
- Again: serve a *different* expert from cache; model intact.

**MC-SMoE — Merge, then Compress**  
https://arxiv.org/abs/2310.01334 · https://github.com/UNITES-Lab/MC-SMoE

- Offline: merge experts using routing-policy similarity, then decompose merged experts into **low-rank + structured-sparse** residuals. **Changes the model.**
- Candidate B's "optionally plus a low-rank delta" is this paper's compression step, relocated from the checkpoint into the cache.

**PuzzleMoE** (https://arxiv.org/abs/2511.04805), **HC-SMoE**, **Sub-MoE**, **D2**: same family — cluster/merge by weight or output similarity, sometimes keep a residual. All are *model compression*.

**SwapMoE** (https://arxiv.org/abs/2308.15030): keep a small set of **Virtual Experts** in memory and remap routing onto them by *importance to the current distribution*, not by weight similarity. Model interface changes via masked gating. Not cache folding.

Checked and different: PowerInfer (neuron activation clusters, not expert-weight clusters), LLM-in-a-Flash (page reuse, not expert aliasing), fMoE (dedups *expert activation maps* in a store, not weights), FluxMoE PagedTensor (virtual address remap of the *same* expert, not a neighbor), llama.cpp disk-paging PoC (#23324) (exact expert identity, LRU slots).

No paper or llama.cpp/ik_llama.cpp issue found that says: "cluster by ||W_i − W_j||, cache only the centroid, alias the other expert IDs onto it".

### Three closest works (one line each)

| Work | How it differs from B |
|---|---|
| **SMoE** https://arxiv.org/abs/2508.18983 | Cache-path, model-intact substitution of a *score-similar* resident expert; does **not** cluster by weights or store one representative per cluster. |
| **MC-SMoE** https://arxiv.org/abs/2310.01334 | Weight/routing similarity + **low-rank residual**, but **rewrites the checkpoint** for everyone; not a cache-only fold. |
| **Cache-Conditional Experts** https://arxiv.org/abs/2412.00099 | Lossy reroute to *whatever is already in cache*; no offline weight clustering, no shared representative, no delta. |

### Remaining sliver (do not treat as NOVEL)

Static weight-cluster cache alias (store centroid, serve all members, optional Δ) with the GGUF left unmodified. That is SMoE's serving contract + MC-SMoE's clustering/residual, minus the checkpoint rewrite. A reviewer will call it a combination, not a green field. If you still want to run it, the only honest delta vs SMoE is "similarity is weight-space and is precomputed, so the cache can physically drop the non-representatives". Measure whether weight-neighbors are actually interchangeable on *high-weight* hits — SMoE only substitutes the **low-score tail**, which is a weaker (safer) claim.

### Search queries run (B)

- `expert similarity cache OR "expert deduplication" OR "redundant experts" MoE inference runtime cache folding`
- `"merge experts" OR "expert merging" OR "similar experts" cache serving inference MoE NOT training NOT compress`
- `MC-SMoE expert merging inference cache "weight similarity" MoE serving redundant experts`
- `SwapMoE virtual experts remapping physical experts inference cache`
- `"similar expert" OR "duplicate expert" OR "redundant expert" OR "expert substitution" MoE cache inference serving`
- `MC-SMoE "Merge, then Compress" Li 2023 expert merging low-rank residual inference cache`

---

## Candidate C — Entropy-gated dynamic k on a top-k-trained model, on-device

### Verdict: **KNOWN** (algorithm) / **NEAR-DUPLICATE** of AdapMoE (on-device adaptive k)

The algorithm (router confidence / entropy / top-p mass → more experts when uncertain, fewer when confident) is published multiple times. AdapMoE already does **inference-time adaptive k on a top-k-trained Mixtral on edge**, where k is the I/O cost. The candidate's distinctive *direction* (confident → k=2, uncertain → **k=8**, i.e. *increase* above the trained k) was tried as naive inference-time scale-up and **hits a documented failure mode** (Elastic MoE "inference-time scaling wall").

This is the opposite of "nobody tried it".

### What the candidate is

Per token, choose k from router confidence (entropy / top-p mass): confident → k=2, uncertain → k=8, on an engine where **k linearly scales flash I/O on a phone**. Model was trained with fixed top-k. Distinguish from (i) training-time top-p and (ii) server-GPU dynamic-k papers.

### What prior art actually does

**AdapMoE — Adaptive Sensitivity-based Expert Gating and Management for Efficient MoE Inference**  
https://arxiv.org/abs/2408.10284 (HTML: https://arxiv.org/html/2408.10284v1) · ICCAD 2024 · https://github.com/PKU-SEC-Lab/AdapMoE

- **Inference-only** on **pretrained Mixtral-8×7B / 8×22B** (top-2 trained). Edge (4090, A6000), offload, k = on-demand load cost.
- Adaptive gating: if `(1−α)² × ∑diag(F) ≤ T` (α = normalized top-1 gate weight, F ≈ Fisher/Hessian of the layer), activate **1 expert instead of 2**. Sensitivity is offline; the per-token signal is the gate mass.
- Result: **~25% fewer** activated experts, 1.35× vs Mixtral-offloading, "no accuracy degradation" at a conservative 24% single-expert ratio.
- **Direction: only decrease k (2→1).** Never 2→8. They cite Adaptive Gating (Li 2023) as the score-only baseline that hurts accuracy; they add layer sensitivity.

This is the paper the prompt flagged. It is a near-duplicate of the *system setting* (on-device, top-k-trained, k = I/O, per-token adaptive k). It is **not** a duplicate of the *increase-k-when-uncertain* policy.

**Harder Tasks Need More Experts: Dynamic Routing in MoE Models**  
https://arxiv.org/abs/2403.07652 (HTML: https://arxiv.org/html/2403.07652v1) · NeurIPS 2024 · https://github.com/ZhenweiAn/Dynamic_MoE

- **Exact algorithm:** sort router probs, keep adding experts until cumulative mass ≥ p (top-p). High confidence → 1 expert; low confidence → more. "Harder tasks need more experts."
- **Training-time** (from-scratch 3.5B MoE + a dynamic entropy loss). They also sweep p at inference on *their* dynamically-trained checkpoint, not on a frozen Mixtral.
- This is the training-time paper the prompt asked to distinguish. The *policy* is the candidate's policy.

**Adaptive Gating in Mixture-of-Experts based Language Models** (Li et al., EMNLP 2023)  
https://arxiv.org/abs/2310.07188

- **Training** strategy: variable number of experts from the probability distribution. Cuts training time ≤22.5%. AdapMoE's "heuristic gating, low accuracy if deployed without finetune".

**AdaMoE** (Zeng et al.; survey https://arxiv.org/abs/2407.06204 §IV): training-time token-adaptive k via **null experts** and a larger k. Not inference-only, not on-device flash.

**Elbow-Based MoE Routing: A Training-Free Inference Time Plugin**  
https://arxiv.org/abs/2608.04401 (overview: https://www.alphaxiv.org/overview/2608.04401)

- Training-free, per-token k from the **elbow** of the sorted router distribution (Kneedle). OLMoE, H200.
- Explicitly a **monotone pruning rule**: `k(x) = min(e(x), K)`. **Never exceeds trained K.** 5.3% latency cut. Cites Harder Tasks as the training-time contrast.

**Elastic MoE: Unlocking the Inference-Time Scalability of Mixture-of-Experts**  
https://arxiv.org/abs/2509.21892 (HTML: https://arxiv.org/html/2509.21892v2)

- Directly studies **raising k' > k_train at inference** on a standard top-k model.
- Finding: **"inference-time scaling wall"** — performance **degrades rapidly** after a slight increase, because experts were never trained to collaborate at larger k. Naive C (k=2→k=8 on Mixtral) is exactly this failure case.
- Their fix is a **training** recipe (stochastic co-activation + hierarchical router loss), not a free inference plugin.

**RoE — Roster of Experts** (Apple, 2025/26)  
https://machinelearning.apple.com/research/roe

- Training-free: inject routing noise, sample **multiple expert sets**, aggregate. Increases expert use as an ensemble. Server-style; not entropy-gated k, not flash I/O.

**GeMoE: Gating Entropy is All You Need…**  
https://arxiv.org/abs/2606.26287 — entropy of the gate as the uncertainty signal for dynamic routing (title-level match to "entropy-gated"). Not on-device flash.

llama.cpp / ollama already expose a **static** override of `n_expert_used` (run Mixtral at k=1 or k=3). That is not entropy-gated, but it means changing k at inference on a top-k checkpoint is routine, not exotic.

Checked and different: Pre-gated MoE (fixed k, earlier gate), ExpertFlow / ProMoE / MoE-Infinity / Mixtral-offloading (fixed k, better cache), DeepSpeed-MoE (cluster), PowerInfer (neuron sparsity), LLM-in-a-Flash (paging).

### Three closest works (one line each)

| Work | How it differs from C |
|---|---|
| **AdapMoE** https://arxiv.org/abs/2408.10284 | Same setting (inference-only adaptive k on pretrained Mixtral, edge, k = load I/O); **only decreases** k (2→1) via top-1 mass × layer Fisher, never 2→8. |
| **Harder Tasks / Top-P** https://arxiv.org/abs/2403.07652 | Same confidence→k policy (including *more* experts when uncertain); **trained from scratch**, not a plugin on a frozen top-k phone model. |
| **Elastic MoE** https://arxiv.org/abs/2509.21892 | Same "raise k at inference on a top-k model"; they **tried it, it fails** without a special training recipe. |

### Remaining sliver (do not treat as NOVEL)

Entropy/top-p **increase** of k (2→8) on a **frozen** top-k checkpoint, justified by "k is flash I/O on a phone so we can *spend* I/O when uncertain". Elastic MoE says that spend **hurts quality**. AdapMoE already used the I/O justification, in the safer direction. Shipping C as a quality feature on Mixtral-class models is more likely a negative result than a trick. If you still run it, treat Elastic MoE's scaling wall as the first experiment, not an afterthought.

### Search queries run (C)

- `AdapMoE adaptive gating dynamic k experts inference entropy top-p Mixtral`
- `dynamic top-k OR "adaptive top-k" OR "top-p routing" MoE inference increase experts entropy uncertain`
- `AdaMoE "adaptive mixture of experts" inference top-p Mixtral pretrained increase k entropy-gated`
- `"inference-time" OR "inference only" OR "already trained" OR "pretrained Mixtral" dynamic k OR "increase k" OR "top-p" experts MoE`
- `Elastic MoE inference-time scalability "performance degradation" increase k pretrained top-k 2509.21892`
- `Adaptive gating in mixture-of-experts based language models Li 2023 2310.07188 inference OR training`

---

## Cross-check of the named systems (all three candidates)

| System | Relevance | Implements A / B / C? |
|---|---|---|
| EdgeMoE | Static per-expert bitwidth from offline importance | **No** (static; HOBBIT's foil) |
| AdapMoE | Adaptive k + skip + cache on edge Mixtral | **C near-dup** (decrease only) |
| MoE-Infinity | Activation-aware lossless expert cache | No |
| Fiddler | CPU compute to avoid PCIe | No |
| PreScope | Prefetch (name in the check-list; same family as predictive offload) | No |
| ActiveFlow | Not a hit for these three mechanisms | No |
| SwapMoE | Virtual-expert remap by importance | Not B (not weight-similarity cache fold) |
| HOBBIT | Mixed-precision load + two caches + router-weight score | **A near-dup** |
| Mixtral-offloading | LRU cache + static HQQ 4+2 + prefetch | No |
| ExpertFlow | Predictive cache / token schedule | No |
| ProMoE | Proactive prefetch | No |
| Pre-gated MoE | Arch change so layer ℓ gates ℓ+1 | No |
| SiDA-MoE | Hashing / data-aware sparse serving | No |
| BrainStorm | OSDI'23 dynamic-NN runtime | No |
| DeepSpeed inference | Layer/param offload, cluster MoE | No |
| llama.cpp / ik_llama.cpp | mmap, `--cpu-moe`, lossless GPU+RAM cache RFC, static `n_expert_used` | Pieces of infrastructure, not A/B/C |
| ollama / mlc-llm | Front-ends on the above | No |
| PowerInfer 1/2 | Neuron-level hot/cold | Not expert-cache A/B/C |
| LLM-in-a-Flash | NAND paging of weights | Not lossy expert tiers / fold / dynamic k |
| DyMoE (2026) | Mixed-precision cache + gate-score (not in the original list) | **A near-dup** |
| DynaExq (2025/26) | Online HP/LP demotion (not in the original list) | **A near-dup** |
| SMoE (2025/26) | Cache substitution (not in the original list) | **B near-dup** |
| Elastic MoE (2025) | Inference k-scale (not in the original list) | **C known / negative** |

Patents: keyword search on mixed-precision expert-cache eviction, expert-similarity cache folding, and entropy-gated on-device k did not surface a granted patent that is closer than the papers above. Do not treat that as a freedom-to-operate opinion.

---

## Bottom line

| Candidate | Verdict | One-sentence reason |
|---|---|---|
| **A** | **NEAR-DUPLICATE (HOBBIT; also DyMoE, DynaExq)** | Router-weight-gated mixed-precision expert cache is HOBBIT 2024; later systems add demotion/promotion. Requantize-on-evict is a storage variant, not a new idea. |
| **B** | **NEAR-DUPLICATE (SMoE + MC-SMoE + Cache-Conditional)** | Serving a similar expert from cache without changing the model is SMoE/Cache-Prior; weight clustering + low-rank delta is MC-SMoE. Cache-only centroid is the glue, not a green field. |
| **C** | **KNOWN / NEAR-DUPLICATE (AdapMoE + Top-P + Elastic MoE)** | Adaptive k on-device on Mixtral is AdapMoE; confidence→more experts is Top-P (2024); raising k on a frozen top-k model is tried and known to degrade (Elastic MoE). |

**Do not schedule engineering time on any of these as "nobody has even tried it".** If something still ships, A is the only one where a narrow implementation delta (compute-on-evict Q4→Q2 vs HOBBIT's store-both) is even arguable — and HOBBIT already captured the quality/I/O contract you care about.
