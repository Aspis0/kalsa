# ROUND 0 — Literature sweep and hypothesis generation

**Author role:** first speaker, adversarial scientific roundtable  
**Ground truth:** BRIEF.md (wins over priors). PLAN.md §3/§6/§9, Registro checkpoint, `reports/moe-f3.md`, `reports/moe-f4.md`, `reports/moe-f0.6.md`.  
**Scope:** theory and literature only. No phone runs. No `../ai-chat`.

---

# Part A — Open contradiction and model card audit

## A.1 Bandwidth ceiling: which reading is correct?

### The two readings

From BRIEF §2–§4 (all [M] unless noted):

| symbol | value |
|---|---|
| `B` = bytes read per token | 84.73 MiB/tok |
| `t_decode` | 0.201 s/tok |
| `t_compute` | 0.116 s/tok |
| `t_cache` | 0.012 s/tok |
| `t_flash_io` (runtime account) | 0.319 s/tok |
| `R` = decode speed | 5.02 tok/s |
| `fio_1MiB` | 413 MiB/s random read |

```
Reading 1 (F4 report):  B / t_flash_io  = 84.73 / 0.319 = 265.6 ≈ 266 MiB/s
Reading 2 (wall-clock): B × R          = 84.73 × 5.02  = 425.3 MiB/s
```

### Verdict: **Reading 2 is the correct measure of device storage throughput. The runtime is at the UFS ceiling. There is no meaningful bandwidth headroom for “more I/O workers.”**

### Arithmetic that settles it

**Fact 1 — `t_flash_io` cannot be exclusive wall-clock I/O time.**

If I/O alone took 0.319 s of wall time per token, then

```
t_decode ≥ t_flash_io  ⇒  0.201 ≥ 0.319
```

which is false. The runtime reports `--overlap` and the decomposition is not additive:

```
t_compute + t_cache + t_flash_io = 0.116 + 0.012 + 0.319 = 0.447 ≠ 0.201
```

Therefore `t_flash_io` is an **aggregated / multi-thread accounting** of I/O work (thread-seconds of I/O, or sum of per-thread wait windows), **not** wall-clock exclusive I/O. Dividing bytes by that quantity yields an **I/O-thread efficiency metric**, not storage bandwidth. F4’s “266 MiB/s achieved vs 413 available ⇒ headroom” is an artefact of that misreading.

**Fact 2 — wall-clock payload rate is unambiguous.**

In one second of wall clock the system emits 5.02 tokens and therefore reads

```
84.73 MiB/tok × 5.02 tok/s = 425.3 MiB/s
```

of expert payload from storage (plus whatever dense/shared traffic is not in `mib_tok`). That is the device’s delivered random-read throughput under the real access pattern.

**Fact 3 — comparison to fio.**

fio random read at 1 MiB block size = **413 MiB/s** [M]. Expert tensor size is 0.942 MB ≈ **0.90 MiB** (binary), so the fio block size is the right order of magnitude. Wall-clock 425 vs fio 413 is **at or slightly above the measured ceiling** (ratio 425/413 ≈ 1.03). Slight overshoot is consistent with: residual page-cache hits after `posix_fadvise(DONTNEED)`, partial sequential runs when co-activated experts land nearby in the GGUF, buffered-I/O path ≠ fio DirectIO path, and ± few-percent measurement noise. It is **not** consistent with “~35% headroom.”

**Fact 4 — effective wall I/O under overlap (cross-check).**

A minimal overlap model with serial cache management:

```
t_decode ≈ t_cache + max(t_compute, t_io_wall)
0.201    ≈ 0.012  + max(0.116, t_io_wall)
⇒ t_io_wall ≈ 0.189 s/tok
⇒ B / t_io_wall = 84.73 / 0.189 ≈ 448 MiB/s
```

Same conclusion: wall I/O is in the 420–450 MiB/s band, not 266.

**Fact 5 — fifth I/O thread is saturation, not starvation.**

`t=3 --io-threads 5` (one core moved from compute to I/O) [M, F4.4]:

| metric | baseline t4/io4 | t3/io5 | Δ |
|---|---:|---:|---:|
| tok/s (warm median) | 5.02 | 4.835 | **−3.7%** |
| flash_io account | 0.319 | 0.359 | +12.5% |
| reported MiB/s | 266 | 236 | −11% |
| compute | 0.116 | 0.127 | +9.5% |
| hit-rate | 56.9% | 56.9% | 0 |

If the I/O path were **starved of workers**, more I/O threads would raise delivered MiB/s and tok/s. Observed: I/O accounting **worsens**, reported throughput **falls**, compute **suffers** (lost core), hit-rate unchanged. That is the signature of a **device-side or queue-depth saturated** path plus CPU contention, not of an under-provisioned reader pool.

### Strategic implication (why this comes first)

| avenue | live? |
|---|---|
| “Make I/O faster by more threads / more QD on the current packing” | **Dead** (or near-dead) at current layout |
| Fewer bytes per token (hit rate, precision, pruning, drop-k) | **Live** |
| More contiguous / larger-block reads (packing, reordering) | **Live** — can raise effective BW toward sequential ~1.6 GiB/s class |
| Different I/O path (O_DIRECT, layout, batching spans) | **Live** — may change *effective* BW without changing device peak |
| Latency hiding (prefetch, MTP) that does not reduce bytes | **Marginal** if already I/O-wall; only helps if it moves work off the critical path or improves hit rate |

**Single measurement that would re-open the question** (if someone rejects the accounting argument): sample `/proc/<pid>/io` `read_bytes` and wall time over a fixed 64-token window with `posix_fadvise(DONTNEED)` pre-run, and simultaneously run a background fio 1 MiB random job to see if the app steals bandwidth from fio. If app `read_bytes/Δt ≈ 400+ MiB/s` and fio collapses, ceiling confirmed. If app `read_bytes/Δt ≪ 300` while fio stays high, then Reading 1’s “headroom” story resurrects and we have a software path bug. **[not yet measured; proposed]**

---

## A.2 Model card and GGUF metadata vs BRIEF §3

Sources: HF model card `Qwen/Qwen3.6-35B-A3B` [web], GGUF dump F0.6 [V], PLAN §3.1 [V].

| property | value | BRIEF §3 | consistent? |
|---|---|---|---|
| Architecture | `qwen35moe` / `Qwen3_5MoeForConditionalGeneration` | (implied) | yes |
| Total params | ~35.95B | — | yes |
| **Layers** | **40** | “45 MoE layers” [U] | **NO — BRIEF wrong** |
| Routed experts / layer | **256** | E ≈ 256 [U] | yes (now [V]) |
| Active routed / token | **8** | 8 | yes |
| Shared expert | **1 always-on** (`*_shexp`) | mentioned elsewhere | yes; flash traffic excludes it |
| Active params / token | ~3B (8 routed + 1 shared) | — | yes |
| Expert FF dim | 512 | — | yes |
| Hidden | 2048 | — | yes |
| Expert size IQ2_M | 0.942 MB (37 L), 1.098 MB (3 L: 34,38,39) | matches [M] | yes |
| **Naive traffic / token** | **8 × 40 × 942080 B = 301.5 MB (median); weighted 305.2 MB** | **≈343 MB** [D] | **NO — BRIEF overstates by ~12%** |
| Expert-loads / token @ 0% hit | **320** | **≈364** from 343/0.942 | **NO** |
| File size | 11.52 GiB | matches | yes |
| Shared expert resident | ~2.30 MB/layer × 40 ≈ 92 MB | — | yes |

### Attention architecture (exact)

From HF model card and GGUF `full_attention_interval=4`:

```
Hidden layout: 10 × ( 3 × (Gated DeltaNet → MoE) → 1 × (Gated Attention → MoE) )
```

- **30 / 40** layers: **Gated DeltaNet** (linear attention) — 32 V heads, 16 QK heads, head_dim 128  
- **10 / 40** layers: **Gated full attention** (GQA) — 16 Q / 2 KV, head_dim 256, RoPE dim 64  
- Ratio 3:1 linear:full; full every 4th layer in the block group  
- KV cache cost is ~¼ of a dense full-attn 40-layer model of same width — a structural gift for RAM budget vs expert cache

### Corrected derived quantities [D, re-derived]

Use binary MiB consistently with the runtime’s `mib_tok`:

```
expert_med = 942080 B = 0.8984 MiB
naive_med  = 320 × 0.8984 = 287.5 MiB/tok   (= 301.5 MB decimal)
naive_wt   = 305201152 B = 291.1 MiB/tok    (= 305.2 MB decimal)
actual     = 84.73 MiB/tok                  [M]
byte_hit   = 1 − 84.73/287.5 = 70.5%        (median expert size)
           = 1 − 84.73/291.1 = 70.9%        (weighted)
```

**BRIEF’s “byte-level hit rate ≈ 74%” is high by ~3–4 points** because it divided 88.8 MB by the inflated 343 MB naive. The **56.9% per-request hit** and **~70–71% byte hit** still answer different questions and both remain informative. Content dependence (F4.5 checkpoint): Italian chat 71–77% request-hit vs benchmark EN 56.9% — real product traffic is better than the gate number.

### Loud disagreements with BRIEF / PLAN

1. **BRIEF §4 / F4 “bandwidth headroom”** — wrong metric; ceiling reached.  
2. **BRIEF §3 naive 343 MB/tok and 45 layers / 364 loads** — stale; F0.6 replaced them with 305.2 MB / 40 / 320 and PLAN §5 was updated, but BRIEF was not.  
3. **BRIEF §3 “byte hit ≈ 74%”** — recompute to **~70.5–71%**.  
4. **PLAN H2 target “≤50 MB/token with ~2 GB cache”** — observed is **88.8 MB/token at 2 GB**; H2 as stated is **not yet met**. Hit-rate 56.9% request / ~71% byte is below the literature’s 80–90% LRU claims at “2× working set,” which means either the working set is larger than assumed, the eviction policy is weaker than offline SCH, or content/locality on the bench prompt is worse (F4.5 supports the last).  
5. **Registro REAP arithmetic** used ~74% → 87% byte-hit and 7 tok/s — directionally right if pool halves, but the starting 74% should be 71%, and the jump to 87% is **[speculation]** until `h(C)` and the post-prune access distribution are measured.

---

# Part B — Literature sweep

Constraint filter used for “survives OUR constraints” (BRIEF §6): no root; stock Android/UFS; ≤ ~5.6 GB RSS; quality measurable; TTFT and energy matter; flash offload tier ~400 MiB/s random, not HBM/DDR/NVMe.

---

## B.1 On-device / memory-constrained MoE inference

### LLM-in-a-Flash — Apple, arXiv:2312.11514, 2023/2024
URL: https://arxiv.org/abs/2312.11514  
Problem it attacks: Run LLMs larger than DRAM by storing weights in flash and paging on demand.  
Mechanism: Windowing of activations + row-column bundling so flash reads become large sequential transfers rather than scattered neuron loads; sparsity-aware packing.  
What they measured: Up to 2× model size vs DRAM; **4–5× CPU / 20–25× GPU** vs naive load; Apple hardware (not public phone UFS 3.1 numbers).  
Does it survive OUR constraints? **PARTIAL** — principle (pack for sequential flash) transfers; their bundling is neuron-granularity for dense FFN sparsity, not 0.9 MB expert slices.  
If PARTIAL: re-cast bundling as **expert co-activation packing** in GGUF layout (our H6 / axis c).

### PowerInfer-2 — arXiv:2406.06282, 2024
URL: https://arxiv.org/abs/2406.06282  
Problem: LLM (incl. sparse/MoE) inference on smartphones beyond RAM.  
Mechanism: Neuron-cluster hot/cold split; pipeline I/O with NPU/CPU compute; TurboSparse-modified models.  
Measured: **Mixtral-class 47B at 11.68 tok/s** on phone; up to 27.8× vs baselines; requires their sparse models + non-public Android stack.  
Survives? **PARTIAL** — proves phone+flash is viable; **no public Android code** for stock Termux/llama.cpp path; depends on model surgery (TurboSparse) we do not have.  
If PARTIAL: extract the I/O–compute pipeline idea only; discard NPU-private path.

### EdgeMoE — arXiv:2308.14352, 2023
URL: https://arxiv.org/abs/2308.14352  
Problem: On-device MoE with expert load cost dominating.  
Mechanism: **Per-expert mixed quantization** (hot experts higher precision) to cut I/O volume on misses.  
Measured: Edge devices; substantial load reduction vs uniform quant (paper-scale models, not 256-expert 35B).  
Survives? **PARTIAL** — precision-as-bandwidth is exactly HOBBIT’s cousin and our axis (a); quality instrument required.  
If PARTIAL: need Italian perplexity gate before any bit drop on cold experts.

### Mixtral-offloading (Eliseev & Mazur) — arXiv:2312.17238, 2023
URL: https://arxiv.org/abs/2312.17238  
Problem: Mixtral-8×7B on consumer GPU with limited VRAM.  
Mechanism: LRU expert cache in RAM + **speculative expert loading** from next-layer router prediction; mixed quant.  
Measured: Desktop / Colab free tier; enables Mixtral where naive fails.  
Survives? **PARTIAL** — LRU+spec load is already in BigMoeOnEdge’s design space; their offload tier is **PCIe/CPU RAM**, orders of magnitude faster than UFS. Hit-rate gains do not transfer 1:1 when miss penalty is ~2–3 ms vs ~μs.  
If PARTIAL: keep the predictor idea; re-budget for 400 MiB/s miss cost.

### MoE-Infinity — arXiv:2401.14361, 2024
URL: https://arxiv.org/abs/2401.14361  
Problem: MoE serving on personal machines with limited GPU memory.  
Mechanism: **Sequence-level expert activation tracing**; activation-aware cache replace + prefetch.  
Measured: **3.1–16.7×** per-token latency vs vLLM/Ollama/DeepSpeed/BrainStorm on DeepSeek/Mixtral; GPU+CPU RAM.  
Survives? **PARTIAL** — tracing is F7; offload tier is host RAM not flash.  
If PARTIAL: port the trace→policy loop, not the PCIe numbers.

### Pre-gated MoE — ISCA 2024 / Microsoft, 2024
URL: https://www.microsoft.com/en-us/research/wp-content/uploads/2024/05/isca24_pregated_moe_camera_ready.pdf  
Problem: Dynamic expert activation serializes load after gate.  
Mechanism: **Pre-gate** predicts experts for layer N+1 from layer N, enabling prefetch before N+1 hidden is ready; algorithm–system co-design (may need training).  
Measured: Single-GPU MoE serving; lower GPU memory, higher throughput, quality maintained (paper claims).  
Survives? **PARTIAL** — prefetch-from-prior-gate is high-value; full pre-gated training may be out of scope.  
If PARTIAL: try **training-free** cross-layer predictors (Fate) first.

### AdapMoE — arXiv:2408.10284, 2024
URL: https://arxiv.org/abs/2408.10284  
Problem: Edge MoE inference cost of loading all top-k.  
Mechanism: **Sensitivity-based adaptive gating** (skip low-sensitivity experts) + management co-design.  
Measured: Edge devices; **~25% fewer loads, ~1.35×** end-to-end (reported in secondary cites).  
Survives? **PARTIAL** — adaptive-k is lossy; needs quality meter.  
If PARTIAL: only after Italian PPL baseline; combine with drop-cold already in fork.

### HOBBIT — arXiv:2411.01433, 2024
URL: https://arxiv.org/abs/2411.01433  
Problem: Cache-miss experts dominate latency on memory-limited devices.  
Mechanism: On miss, load a **lower-precision** copy of the expert instead of full precision; criticality-aware; **~8k LOC on llama.cpp**.  
Measured: Jetson AGX Orin; Mixtral-8×7B / Phi-MoE; **up to 9.93×** decode vs MoE-Infinity; large gains vs mmap thrash.  
Survives? **PARTIAL** — best match to “bits as bandwidth knob” under flash misses; we are already at ~2.4 bpw on experts — headroom for *further* drop on cold-only path is limited and quality-risky.  
If PARTIAL: dual-store hot=IQ2_M / cold=IQ1_* only if PPL allows; code not public.

### ProMoE — arXiv:2410.22134, 2024
URL: https://arxiv.org/abs/2410.22134  
Problem: Reactive caching too late for MoE serving.  
Mechanism: **Proactive** learned caching / prefetch of experts.  
Measured: **~2.20× prefill / ~2.07× decode** (paper claims) vs reactive baselines; GPU serving.  
Survives? **PARTIAL** — predictor class is F7–F8; numbers assume fast secondary storage.  
If PARTIAL: re-evaluate under UFS miss cost.

### ExpertFlow — arXiv:2410.17954, 2024
URL: https://arxiv.org/abs/2410.17954  
Problem: Flexible routing + CPU↔GPU expert scheduling.  
Mechanism: Predictive routing path + token allocation + expert cache between CPU/GPU.  
Measured: **up to 93.72% GPU memory savings**, **2–10×** speed; high routing prediction accuracy cited in secondary sources (~92–95%).  
Survives? **NO** as a system (GPU-centric, multi-token batch). **PARTIAL** as a predictor idea.  
If PARTIAL: strip to single-token decode predictor under 2 GB cache.

### Klotski — arXiv:2502.06888, 2025
URL: https://arxiv.org/abs/2502.06888  
Problem: Pipeline bubbles in offloaded MoE inference.  
Mechanism: **Expert-aware multi-batch pipeline** reorders work to hide I/O; multi-batch.  
Measured: **>94% memory reduction**; large throughput gains at batch 64-class workloads.  
Survives? **NO** for interactive chat (batch≈1). Bubbles at bs=1 are a different shape.  
If PARTIAL: single-token prefetch pipeline only.

### Fate (Cross-Layer Gate) — arXiv:2502.12224, 2025
URL: https://arxiv.org/abs/2502.12224  
Problem: Edge MoE offload with inaccurate expert prediction.  
Mechanism: Use **adjacent-layer gate inputs** for training-free next-layer expert prefetch.  
Measured: High prefetch accuracy (paper: up to **~97%** at aggressive thresholds in related cites); edge-oriented speedups multi-×.  
Survives? **PARTIAL — strong candidate.** Training-free, low overhead, matches our stack. Accuracy must be re-measured on Qwen3.6-35B-A3B hybrid GDN/attn (cross-layer correlation may differ at GDN vs full-attn boundaries).  
If PARTIAL: implement as F7 offline oracle then F8 runtime; verify at 3:1 hybrid boundaries.

### SpecPrefetch — arXiv:2607.24787, 2026
URL: https://arxiv.org/abs/2607.24787  
Problem: Expert transfer on critical path after native top-k.  
Mechanism: Shared **low-rank adapter (~6.5M params)** predicts next-layer expert mass for async transfer; **native router still decides** (behavior-preserving).  
Measured: **Snapdragon 8 Elite**; Qwen3-VL-30B-A3B; Recall@8 **85.6–89.4%**; +20% on slow storage.  
Survives? **YES / closest prior art.** Same SoC family, same model family, phone storage, behavior-preserving. Elite ≠ Gen 2 / UFS4 ≠ UFS3.1, but the mechanism is designed for our regime.  
If PARTIAL: retrain/adapters on our traces; budget RAM for adapter + cache.

### FlashMoE — arXiv:2601.17063, 2026
URL: https://arxiv.org/abs/2601.17063  
Problem: SSD I/O bottleneck for MoE when RAM-offload is impossible.  
Mechanism: SSD offload + **ML cache** combining recency+frequency.  
Measured: Hit **+51% vs LRU/LFU**, **up to 2.6×** speedup; “edge” but desktop-class SSD in practice.  
Survives? **PARTIAL** — policy class transfers; SSD 5–7 GB/s ≠ UFS 0.4 GB/s changes the value of every hit point.  
If PARTIAL: plug policy into our simulator with 400 MiB/s cost model.

### SpecMD (Apple) — arXiv:2602.03921, 2026
URL: https://arxiv.org/abs/2602.03921  
Problem: MoE expert caching policies poorly benchmarked; LRU assumptions fail.  
Mechanism: Speculative expert prefetch study framework; proposes **Least-Stale** eviction.  
Measured: Collision misses **up to 85×** better than LRU; **>88% hit** with only **5% / 0.6 GB** VRAM cache on OLMoE; TTFT −34.7%.  
Survives? **PARTIAL** — “LRU is wrong for MoE” is directly actionable; VRAM cache ≠ flash. Least-Stale should be in F7 policy bake-off.  
If PARTIAL: re-run their policies on our route traces.

### DraftExpert — arXiv:2607.24434, 2026
URL: https://arxiv.org/abs/2607.24434  
Problem: Speculative decoding under expert-offloaded MoE on end devices.  
Mechanism: Per-layer **draft expert** (accelerator-resident) distilled from residual/logit/router signals; self-speculative + prefetch of target experts.  
Measured: **1.45×** decode; acceptance **84–87%**; prefetch hit **86–88%**; DeepSeek-V2-Lite, Moonlight-16B-A3B; CPU→GPU and Flash→NPU scenarios.  
Survives? **PARTIAL** — Flash→NPU path not open on S23; CPU draft expert may work; training cost non-trivial.  
If PARTIAL: F6 MTP first (native), then draft-expert if MTP fails.

### kimi-k3-in-c (FareedKhan-dev) — 2026, code
URL: (project referenced in PLAN §3.3; C99 O_DIRECT streaming)  
Problem: Extreme offload of trillion-scale MoE with knobbed RAM.  
Mechanism: `pread` + **O_DIRECT** (bypass page cache), LRU + batch prefetch; dense trunk also streamed.  
Measured: Kimi K3 2.78T in **8.24 GB RSS** but **~32 s/token** on dual EPYC + NVMe 5–6 GB/s when trunk also streams.  
Survives? **PARTIAL** — O_DIRECT lesson is live; full-trunk streaming is the wrong regime (we keep dense+shared resident). Linux x86 only.  
If PARTIAL: experiment O_DIRECT read path on f2fs/FBE Android (may fail without root/privileges).

### BigMoeOnEdge (Helldez) — 2026, software
URL: https://github.com/Helldez/BigMoeOnEdge  
Problem: Practical MoE streaming on phones.  
Mechanism: llama.cpp fork; LRU expert cache; `--moe-stream --cache-mb --dense-weights --overlap --io-threads --drop-cold-experts`.  
Measured: Author: ~5 tok/s on 12 GB / UFS4 with Q4_K_M 22 GB file; **our [M]: 5.02 tok/s on S23 8 GB / UFS3.1 / UD-IQ2_M**.  
Survives? **YES — it is our baseline.**

### SwapMoE — Kong et al., 2024
URL: (cited in HOBBIT related work; ACL/system line)  
Problem: Swap experts under memory pressure.  
Mechanism: Expert swapping policies for constrained devices.  
Measured: Edge-class; secondary citations only here.  
Survives? **PARTIAL** — swap ≠ stream; our explicit cache already replaces OS swap.

### Fiddler — Kamahori et al., 2024
URL: (HOBBIT related work)  
Problem: Hybrid CPU help for MoE inference.  
Mechanism: Use CPU compute for some experts while GPU holds others.  
Survives? **NO** — we are already CPU-only; no GPU MoE path on Adreno 740.

### SpecMoEOff — arXiv:2508.21706, 2025
URL: https://papers.cool/arxiv/2508.21706  
Problem: Speculative techniques for MoE offloading.  
Mechanism: Speculative offload-aware scheduling.  
Measured: **up to 2.5×** decode vs SOTA offload.  
Survives? **PARTIAL** — server/GPU class; idea only.

---

## B.2 Router behaviour and expert access statistics

### Mixtral of Experts — arXiv:2401.04088, 2024
URL: https://arxiv.org/abs/2401.04088  
Problem: Open MoE architecture + routing behavior.  
Mechanism: 8 experts, top-2; reports temporal locality of routing.  
Measured: P(same expert as previous token) ≈ **30%** vs 12.5% random; higher in deep layers.  
Survives? **YES** as a locality prior (different model).  
If PARTIAL: remeasure on Qwen3.6 with `--route-trace`.

### Not All Models Suit Expert Offloading (Local Routing Consistency) — arXiv:2505.16056, 2025
URL: https://arxiv.org/abs/2505.16056  
Problem: When is expert offloading profitable?  
Mechanism: Metrics **SRP** (segment routing best performance) and **SCH** (segment cache best hit rate with future info).  
Measured: LRU window hit rates: m=4 → **81.2%**, m=16 → **90.4%**, m=64 → **93.1%**, m=256 → **97.5%**; optimal cache ≈ **2× active experts**; Qwen3 among more local models (SRP 54.14 cited in PLAN).  
Survives? **YES** as measurement methodology; offline SCH is an **upper bound**, not a runtime guarantee under our 2 GB / 21% pool coverage.  
**Conflict with our data:** at ~2120 slots (~21% of 10240), literature suggests ≥85% LRU; we see **56.9%** request-hit on bench, **71–77%** on Italian chat. Either SCH offline ≠ online LRU, or our prompt/model differs, or BigMoeOnEdge’s hit definition ≠ theirs. **Must resolve with route traces.**

### Caching analysis Mixtral — arXiv:2511.05814, 2025
URL: https://arxiv.org/abs/2511.05814  
Problem: Cache policy quality under real routing.  
Mechanism: Compare LRU vs speculative expert loading.  
Measured: LRU precision **29.1%** / recall **58.2%**; speculative load precision=recall **84.6%**.  
Survives? **YES** as motivation for prediction over pure LRU.

### Doubleword blog — Qwen3.5-35B-A3B co-activation, 2026
URL: (cited PLAN §3.3; same 256e/40L family)  
Problem: Exploit co-activation structure.  
Mechanism: Oracle co-activation packing analysis.  
Measured: **−21.3% unique expert loads** with oracle co-activation.  
Survives? **YES** as ceiling for packing (axis c / H6).

### SpecMD Least-Stale findings — arXiv:2602.03921, 2026
URL: https://arxiv.org/abs/2602.03921  
Problem: Temporal locality assumptions fail for MoE.  
Mechanism: Benchmark many policies; MoE access ≠ classic LRU stack.  
Measured: See B.1; **LRU can be catastrophically wrong** on collision misses.  
Survives? **YES** — directly challenges BigMoeOnEdge’s LRU default.

### Our F4.5 content dependence [M, checkpoint]
URL: PLAN Registro 2026-08-06 (internal)  
Measured request hit-rates on same config: IT expository **77%**, instructions **75.9%**, short writing/reasoning **71.6%**, Python **67%**, EN bench **56.9%**.  
Survives? **YES** — first-class empirical constraint: **hit-rate is workload-dependent over a 20-point range.**

---

## B.3 Model surgery

### REAP — arXiv:2510.13999, ICLR 2026, Cerebras
URL: https://arxiv.org/abs/2510.13999  
Code: https://github.com/CerebrasResearch/reap  
Problem: One-shot MoE compression; pruning vs merging.  
Mechanism: **Router-weighted Expert Activation Pruning** — saliency = router gates × activation norms; prune low-saliency experts. Argues merging loses independent routing control.  
Measured: Up to **50% experts removed**, ~**97%** quality retained on generative tasks up to 1T-class; extended to Qwen3.5 hybrid class.  
Survives? **PARTIAL** — strongest *lossy* lever for our hit-rate math (halve pool → double relative cache coverage); **irreversible capacity loss**; English/coding calib ≠ Italian chat.  
If PARTIAL: Italian PPL first; prune 25% then 50% with F4.5+PPL gates; calibrate on our `--route-trace`.

### Expert merging (various, critiqued by REAP)
URL: same REAP paper surveys  
Mechanism: Merge similar experts into one with combined gate.  
Measured: Can look good on discriminative benches; REAP shows **generative collapse** from lost routing degrees of freedom.  
Survives? **NO** as primary lever given REAP’s critique and our generative chat product.

### MoE → dense / smaller MoE distillation
URL: multiple (e.g. Switch/distill lines; not re-listed)  
Mechanism: Distill sparse into dense or fewer experts.  
Measured: Task-dependent; often large quality loss at fixed active params.  
Survives? **PARTIAL** — product binary A already has dense 4B; for 35B-class research, distillation is a different project.

### Low-rank expert factorisation / weight sharing
URL: PreMoE (COLM 2026) https://arxiv.org/abs/2505.17639 ; related PEFT lines  
Mechanism: Factor experts or share bases across experts to cut storage.  
Measured: Training-free compile of sparse variants (PreMoE); variable quality.  
Survives? **PARTIAL** — changes bytes/expert; needs quality gate.

### Mixture-of-Depths / early exit
URL: Raposo et al. MoD and early-exit LLM literature  
Mechanism: Skip layers/tokens dynamically.  
Measured: Training-time methods; inference savings on dense models.  
Survives? **NO** without retraining Qwen3.6; architecture fixed.

### Adaptive-K / entropy routing — community 2026
URL: (e.g. Adaptive-K entropy routing discussions, 2026)  
Mechanism: Dynamic top-k from router entropy.  
Measured: Claimed 30–52% compute save (unverified primary here).  
Survives? **PARTIAL** — compute is not our bottleneck; fewer experts loaded **does** cut I/O if k drops. Quality risk.

---

## B.4 Quantisation as a bandwidth lever

### HOBBIT / EdgeMoE (again)
See B.1 — cold-expert low precision is the canonical “bits for I/O” move.

### Unsloth UD mixed-bit (our stack) [M]
URL: https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF  
Mechanism: Mixed IQ2_XXS/IQ3_XXS/IQ4_XS per tensor; denser path (embed, attn_out, output) at Q5_K/Q4_K.  
Measured: **2.4 bpw** on experts; usable Italian quality ~2 malformed/1000 tok [M].  
Survives? **YES — current baseline.**

### ik_llama.cpp / K-quant vs IQ on MoE experts
URL: ik_llama.cpp discussions (PLAN cites #359)  
Mechanism: K-quants may preserve MoE expert quality better than IQ at same bpw.  
Measured: Community reports; not our F4.4 (K-quant cell not completed).  
Survives? **PARTIAL** — F4.4 K vs IQ still open; if K is larger on disk, I/O **worsens** unless quality allows higher hit from better routing stability [speculation].

### KleidiAI / Arm CPU quant paths
URL: https://github.com/ARM-software/kleidiai ; https://www.arm.com/markets/artificial-intelligence/software/kleidi  
Mechanism: Microkernels for int4/etc on Arm; llama.cpp integration paths for Q4_0-class.  
Measured: Double-digit % prefill/decode gains on dense SLMs; **not MoE MUL_MAT_ID**.  
Survives? **PARTIAL** — helps **compute** (0.116 s/tok), which is secondary while I/O-bound; becomes primary if byte traffic halves.  
If PARTIAL: relevant after we become compute-bound.

### llama.cpp OpenCL MoE kernels [M, BRIEF]
URL: upstream llama.cpp  
Mechanism: GPU offload for `MUL_MAT_ID` only for Q4_0/Q4_1/Q4_K/MXFP4 — **not IQ**.  
Measured: Adreno 740 not on supported list; Vulkan broken (#6713).  
Survives? **NO** for our IQ2_M on S23 GPU today.

### MoE-SpeQ — speculative quantized decoding, 2025
URL: related arXiv line (SpeQ / MoE-SpeQ family, 2025)  
Mechanism: Trade cheap on-device compute to hide I/O via quantized speculative paths.  
Survives? **PARTIAL** — conceptually axis (d)+(a).

---

## B.5 Storage and the I/O path

### Our fio characterization [M, F2.1 / PLAN §5]
URL: internal `reports/moe-f2.md`  
Measured UFS 3.1 S23: random read **1M=413, 256k=214, 64k=83, 4k=21 MiB/s** (qd1 medians). Seq read class ~1.6–1.7 GB/s (AndroBench class).  
Implication: **block size dominates**. Expert-sized ~1 MiB is near the flat region; 4K thinking is wrong.

### Unleashing Zoned UFS — FAST 2026
URL: https://www.usenix.org/system/files/fast26_slides_kim-jungae.pdf  
Problem: Random read on mobile UFS.  
Mechanism: Zoned UFS reduces mapping overhead.  
Measured: Random read is the UX-critical metric; zoned helps.  
Survives? **NO** — needs zoned storage / not stock.

### Android io_uring
URL: BlackHat USA 2023 “Bad io_uring”; kernel docs  
Mechanism: High-performance async I/O via SQ/CQ rings.  
Measured: Present in modern Android kernels but **restricted / attack-surface hardened**; Termux reliability poor (PLAN: qd>1/io_uring unreliable).  
Survives? **PARTIAL at best** — do not bet the design on io_uring from untrusted app uid.

### O_DIRECT / kimi-k3 lesson
URL: PLAN §3.3; Linux `open(2)`  
Mechanism: Bypass page cache; avoid majflt storms and cache pollution.  
Measured: Desktop win for huge models; Android app uid + f2fs/FBE may reject or ignore.  
Survives? **PARTIAL** — worth a one-day experiment; not assumed.

### mmap thrash = our F3 wall [M]
URL: `reports/moe-f3.md`  
Measured: naive mmap 35B → **0.10 tok/s**, ~9.5 GiB flash/tok effective, hundreds of k majflt/tok.  
Survives? **YES as negative result** — explicit expert I/O required.

### f2fs / page cache / madvise
URL: Linux MM docs; Android storage stack  
Mechanism: `MADV_WILLNEED`/`RANDOM`, `posix_fadvise(DONTNEED)` (we use for cold).  
Measured: Default llama.cpp MAP_POPULATE+WILLNEED is catastrophic >RAM (PLAN §3.2).  
Survives? **YES** — we already left mmap; fadvise cold is part of protocol.

### GGUF layout [V, F0.6]
URL: `reports/moe-f0.6.md`  
Fact: gate/up/down **not contiguous** (shexp+router intercalated); one expert = contiguous slice **within** each tensor; 3 I/Os per expert-layer if per-matrix.  
Survives? **YES** — packing lever is real and under-explored (PLAN G3).

---

## B.6 Latency hiding

### Classical speculative decoding (Leviathan et al.)
URL: https://arxiv.org/abs/2211.17192  
Mechanism: Draft model proposes; target verifies in parallel.  
Measured: Large speedups when target is compute-bound and draft is cheap.  
Survives? **PARTIAL** — when target is **I/O-bound**, verification may load **more unique experts** per accepted token if draft path diverges; speedup non-monotonic.

### MoESD — arXiv:2505.19645, 2025
URL: https://arxiv.org/abs/2505.19645  
Problem: When does SD help MoE?  
Mechanism: Analytic + empirical; MoE arithmetic intensity → **non-monotonic** SD speedup vs batch.  
Measured: MoE can benefit **more** than dense at medium batch; BS=1 nuanced.  
Survives? **YES as warning** — do not assume MTP helps flash-bound decode.

### Cohere analysis — MoE + SD, 2026
URL: https://cohere.com/blog/mixture-of-experts-models-get-more-from-speculative-decoding  
Mechanism: Bandwidth-bound sweet spots; expert-routing correlation.  
Measured: Non-monotonic curves matching MoESD.  
Survives? **YES** as industrial corroboration.

### EVICT — arXiv:2605.00342, 2026
URL: https://arxiv.org/abs/2605.00342  
Problem: Speculative trees activate too many experts.  
Mechanism: Expert-aware draft tree that **minimizes union of experts**.  
Measured: **−32.5%** experts activated vs EAGLE-3.  
Survives? **PARTIAL** — if we do SD, EVICT-style objective is mandatory under flash.

### DraftExpert / native MTP (Qwen3.6)
URL: DraftExpert above; llama.cpp PR #22673  
Mechanism: MTP head natively in Qwen3.6 (`mtp_num_hidden_layers: 1`).  
Measured: GPU acceptance ~75%, >2× on DGX; **RTX3090 independent test: no net speedup** on A3B; **zero public ARM+flash numbers**.  
Survives? **Open experiment (F6)** — genuinely unknown under our ceiling.

### When speculation loses on bandwidth-bound systems [synthesis]
If each draft token triggers a near-disjoint expert set, bytes/accepted_token can **rise**. Break-even roughly:

```
speedup ≈ α / (1 + (1−α) · c_verify)   with α = accept rate
```

when verify is I/O-dominated and draft I/O is not free. With α=0.75 and verify loading ~same bytes as one target step, net can be <1. **[model; to measure in F6]**

---

## B.7 Mobile heterogeneous compute

### Adreno 740 + llama.cpp OpenCL [M, BRIEF]
Supported Adreno list excludes 740; `MUL_MAT_ID` IQ quants absent. Vulkan broken (#6713).  
Survives? **NO for MoE dispatch today.**

### Hexagon / QNN / nspss thermal zones [M]
Zones readable; stack non-public. PowerInfer-2 NPU path not reproducible.  
Survives? **NO** without Qualcomm NDA stack.

### NNAPI deprecated (Android 15)
URL: https://developer.android.com/ndk/guides/neuralnetworks/migration-guide  
Survives? **NO** as future path; migrate to TFLite Play Services / vendor SDKs — still not MoE streaming.

### Public MoE on mobile GPU with non-Q4_0
Search of public systems: **no credible open result** running IQ-quant MoE dispatch on Adreno 740-class GPU. SpecPrefetch/DraftExpert use Elite + NPU/Flash paths, not stock OpenCL IQ.  
Mark: **[gap, defensible]**

---

## B.8 Adjacent fields (transfer mechanisms)

### ARC — Megiddo & Modha, FAST 2003
URL: https://www.usenix.org/event/fast03/tech/full_papers/megiddo/megiddo.pdf  
Mechanism: Adaptive replacement balancing recency vs frequency via ghost lists.  
Transfer: Expert cache with scan-resistant workloads (code prompts thrash LRU — we saw 67% hit). **Try ARC/CAR before training a predictor.**

### LIRS — Jiang & Zhang
URL: http://web.cse.ohio-state.edu/hpcs/WWW/HTML/publications/papers/TR-02-6.pdf  
Mechanism: Inter-reference recency to keep low-IRR blocks.  
Transfer: Long-tail experts with bursty reuse.

### CLOCK-Pro
URL: OS page replacement literature  
Mechanism: Approximates LIRS with clock hands; low overhead.  
Transfer: Cheap userspace clock over 2k expert slots.

### TinyLFU / W-TinyLFU — Einziger et al., arXiv:1512.00727
URL: https://arxiv.org/abs/1512.00727  
Mechanism: Admission filter via approximate frequency sketch; window + SLRU.  
Transfer: **Do not admit** one-shot cold experts that evict hot ones — SpecMD’s collision-miss story. Caffeine’s default; 8 bytes/entry overhead.  
**High transfer value** under 2 GB / 10k expert universe.

### Hyperbolic caching
URL: USENIX ATC 2017 (Berger et al.)  
Mechanism: Evict by cost/benefit with time-based priority.  
Transfer: Cost = load time (size/BW); benefit = reuse probability — natural for variable expert sizes (0.942 vs 1.098 MB).

### Database buffer pools (clock, 2Q, cost-based)
URL: classic DB literature (e.g. DBMIN, PostgreSQL buffer manager)  
Transfer: **Cost-based eviction**: prefer to keep large/slow-to-load experts; pin shared/dense; hint from router probabilities as “pins.”

### CPU hardware prefetchers
URL: microarchitecture surveys  
Transfer: Stride prefetch fails on random expert IDs; **correlation prefetch** (A after B) matches co-activation tables.

### CDN / web caches
URL: TinyLFU as above; LRU-K  
Transfer: Admission > eviction when write (load) is expensive — our miss is a multi-ms flash read.

### zram / zswap
URL: Linux documentation  
Mechanism: Compressed RAM swap.  
Transfer: **Without root, limited.** Compressing *cached experts* in userspace (store IQ1 cold in RAM, decompress/promote) is a software analogue — related to HOBBIT but pure RAM tier. Energy cost of compress/decompress on little cores must be counted.

### Storage tiering
URL: hierarchical storage management  
Transfer: hot/warm/cold expert tiers: RAM full precision / RAM low precision / flash. Three-tier HOBBIT+cache.

---

## B.9 What the literature has NOT done

Defensible gaps (specific, not “nobody did on-device MoE”):

1. **No end-to-end system** combines **~256 experts × ~35–40 layers**, **stock Android 8 GB**, **UFS 3.x ~400 MiB/s**, **explicit DRAM expert cache with measured lmkd**, and **Italian generative quality gates**. Closest: SpecPrefetch (Elite, related model), PowerInfer-2 (non-public, TurboSparse), BigMoeOnEdge (us).

2. **No published h(C) curve** for Qwen3.5/3.6-35B-A3B under real RAM caps (we have **one** point at 2000 MB). Offline SCH curves ≠ online under lmkd.

3. **Expert packing for single-device sequential flash** at expert granularity is nearly empty (Apple bundles neurons; Doubleword oracle co-activation is analysis, not a shipped GGUF layout). PLAN G3 still open.

4. **No public ARM CPU + UFS measurement of MTP/SD** on hybrid GDN/MoE Qwen3.6; GPU numbers exist and disagree with each other.

5. **No open Adreno path for IQ-quant `MUL_MAT_ID`.**

6. **Mixed-precision per expert** studied (EdgeMoE/HOBBIT) but **not** at already-2.4 bpw floor with Romance-language morphology sensitivity measured.

7. **Cache admission (TinyLFU/Least-Stale) not evaluated** against BigMoeOnEdge LRU on phone traces — SpecMD did VRAM/desktop-class, not UFS.

8. **Wall-clock storage accounting** is routinely confused with thread-sum I/O metrics in system papers and in our own F4 writeup — the field under-reports *device* BW saturation on mobile flash.

9. **Energy per token** under expert streaming on UFS almost never reported; tok/s alone misranks levers on a phone.

10. **Cross-layer predictors at GDN↔full-attn boundaries** untested; Fate assumes homogeneous MoE stacks.

---

# Part C — Hypotheses

## H1 — Pool-halving via domain-calibrated REAP pruning   [axis: a]   [novel: no]

**Mechanism.** Remove ~25–50% of routed experts using REAP saliency on **Italian chat traces**. Pool size drops → same 2000 MB cache covers a larger fraction of remaining experts → miss rate drops → fewer flash bytes/token. File size drops → TTFT load falls. Bytes *requested* per token stay 8×40 (same top-k) but bytes *missed* fall.

**Model.**  
Let \(P\) = expert pool bytes ≈ \(256 \times 40 \times 0.942\text{ MB} = 9.65\text{ GB}\).  
Cache \(C = 2.0\text{ GB}\). Coverage \(c = C/P\).  
Approximate miss fraction of requested bytes \(m \approx (1-h_{\text{byte}})\).  
Observed: \(h_{\text{byte}} \approx 0.71\), traffic \(T = 88.8\text{ MB/tok}\).

Crude scaling (speculative, linear in uncovered mass): if prune fraction \(p\) of cold mass and cache keeps the hot set,

\[
T' \approx T \cdot \frac{1-c/(1-p)}{1-c} \quad \text{for } c < 1-p
\]

With \(c \approx 2/9.65 = 0.207\):

| \(p\) | \(c' = C/(P(1-p))\) | \(T'\) (MB/tok) if \(h\) scales with coverage | rough \(t_{\text{io}}\) @ 425 MiB/s wall | rough tok/s if \(t_{\text{tok}} \approx \max(t_{\text{cmp}}, t_{\text{io}})+t_{\text{c}}\) |
|---|---:|---:|---:|---:|
| 0 | 0.207 | 88.8 | 0.189 s | 5.0 |
| 0.25 | 0.276 | ~70–75 [range] | ~0.15–0.16 | **~5.5–6.0** |
| 0.50 | 0.414 | ~45–55 [range] | ~0.10–0.12 | **~6.5–7.5** if io≤compute |

Free parameter: how much of the *working set* was pruned. If REAP removes only never-used experts on Italian, upper end; if it removes morphology specialists, quality dies and effective hit may not rise.

**Prediction.** tok/s **5.5–7.5** at p=0.25–0.50 if quality holds; TTFT load **−25–50%** (file 11.5→~8.6–5.8 GB); RSS similar or lower; energy/token down with bytes. Quality: unknown — **blocker**.

**Assumptions.** (1) Working set shrinks with pool — if false, T'≈T. (2) Italian calib available — if false, coding-REAP may hurt IT. (3) Quality gate exists — if false, cannot ship.

**Falsification.** Calibrate REAP at p=0.25 on 10k Italian chat tokens of route+activation stats; measure F4 config: if `mib_tok` does not fall ≥15% or Italian PPL rises >3%, H1 dies at that p.

**Cost.** Medium: trace → REAP job (RunPod) → new GGUF → quality suite. Breaks: irreversibility; must version models.

**Prior art.** REAP (Cerebras) on Qwen3.5 class; not on UFS-streamed S23 Italian chat. **[tried as method, not in our regime]**

---

## H2 — Replace LRU with W-TinyLFU / Least-Stale admission   [axis: b]   [novel: no]

**Mechanism.** MoE access is not stack-distance friendly (SpecMD). LRU admits one-shot experts that evict hot ones. W-TinyLFU admits only if frequency sketch says newcomer beats victim; Least-Stale uses MoE-specific staleness. Higher hit rate at **same** C → fewer bytes.

**Model.**  
Let hit improve by \(\Delta h\) byte points.  
\(T' = T \cdot (1-h-\Delta h)/(1-h)\) with \(h=0.71\), \(T=88.8\).

| \(\Delta h\) | \(T'\) MB/tok | \(t_{\text{io,wall}}\) | tok/s rough |
|---|---:|---:|---:|
| +0.05 | 73 | 0.155 | ~5.7 |
| +0.10 | 58 | 0.123 | ~6.5 |
| +0.15 | 42 | 0.090 | ~7.0 (compute-bound floor ~1/(0.116+0.012)≈7.8) |

Plausible \(\Delta h\) from SpecMD-scale wins: **+5–12 points** on our traces [speculation]; not +30 (SCH offline with future info).

**Prediction.** tok/s **5.5–6.8**; TTFT unchanged; RSS unchanged; energy down slightly. No quality risk.

**Assumptions.** (1) Collision misses are material in our 56.9% regime — if misses are compulsory working-set misses, policy change ≈0. (2) Sketch overhead << 0.012 s cache_mgmt.

**Falsification.** Offline replay of `--route-trace` through LRU vs W-TinyLFU vs Least-Stale at 2120 slots; if best policy hit − LRU hit < 3 points, abandon. Cost: hours on PC, no phone.

**Cost.** Low–medium (cache policy in fork). Breaks: little.

**Prior art.** SpecMD Least-Stale; Caffeine W-TinyLFU; FlashMoE ML recency+freq. **Not measured on our fork/device.**

---

## H3 — Co-activation packing: rewrite GGUF for sequential multi-expert reads   [axis: c]   [novel: no — planned H6; sparse prior art]

**Mechanism.** F0.6: gate/up/down non-contiguous; random expert IDs ⇒ random seeks. Cluster co-activated experts into contiguous runs; load a **span** per miss cluster. Effective BW moves from random~400 toward semi-seq (fio seq ~1.6 GB/s class). Also 3-matrix merge into one packed expert blob.

**Model.**  
Let effective BW become \(B_{\text{eff}} = 413 \cdot \gamma\) with contiguity factor \(\gamma \in [1, 4]\) plausible for partial packing.  
Wall io time \(t_{\text{io}} = T_{\text{MiB}} / B_{\text{eff}}\).

With \(T=84.73\) MiB/tok:

| \(\gamma\) | \(B_{\text{eff}}\) | \(t_{\text{io}}\) | tok/s if io-bound |
|---|---:|---:|---:|
| 1.0 | 413 | 0.205 | ~4.6–5.0 |
| 1.5 | 620 | 0.137 | ~6.0–6.5 |
| 2.0 | 826 | 0.103 | ~7.0–7.5 |
| 3.0 | 1239 | 0.068 | ~7.5–8.0 (compute floor) |

Doubleword oracle −21% unique loads is a separate traffic win if packing aligns with clusters.

**Prediction.** tok/s **6–8** if \(\gamma \ge 1.5\); TTFT similar (same bytes load, better sequential); RSS same; energy: fewer seeks may lower power per byte slightly.

**Assumptions.** (1) Co-activation stable across Italian chat — if false, packing for wrong clusters. (2) UFS rewards multi-MB sequential within a token’s miss set — if misses are single experts, \(\gamma \approx 1\).

**Falsification.** Build co-activation matrix from traces; pack top clusters; microbench read of packed spans vs random experts at same total bytes; if span BW < 1.2× random, H3 weak.

**Cost.** High (GGUF rewriter + loader changes). Breaks: compatibility with stock GGUF; must version files.

**Prior art.** LLM-in-a-Flash bundling; Doubleword analysis; PLAN H6. **No full expert-pack GGUF on UFS phone published.**

---

## H4 — Cross-layer gate prefetch (Fate/SpecPrefetch class) under ceiling   [axis: d]   [novel: no]

**Mechanism.** Predict layer ℓ+1 experts from layer ℓ gate/hidden; issue I/O during layer ℓ compute. Does **not** reduce bytes if prediction only prefetches what would be loaded anyway — gains come from (i) converting miss stalls into overlapped I/O and (ii) secondary cache warming. Under **already-saturated** BW, pure overlap cannot exceed ~7.8 tok/s compute floor **unless** it also improves hit rate via earlier admission.

**Model.**  
Current: \(t_{\text{decode}} \approx 0.201\), \(t_{\text{compute}}=0.116\), exposed I/O stall ≈ \(0.201 - 0.012 - 0.116 = 0.073\) s if compute fully used (simplified).  
If prefetch hides fraction \(\beta\) of exposed stall:

\[
t' \approx 0.012 + 0.116 + (1-\beta)\cdot 0.073
\]

| \(\beta\) | \(t'\) | tok/s |
|---|---:|---:|
| 0 | 0.201 | 5.0 |
| 0.5 | 0.165 | 6.1 |
| 0.9 | 0.135 | 7.4 |
| 1.0 | 0.128 | 7.8 |

If prefetch **wrong** experts, BW waste **lowers** hit rate → tok/s falls. SpecPrefetch Recall@8 ~0.86–0.89 on related model.

**Prediction.** tok/s **5.5–7.2** if recall ≥0.85 and no BW thrash; TTFT: prefill may benefit more; RSS +adapter (~tens of MB); energy: extra wrong I/O hurts.

**Assumptions.** (1) Cross-layer correlation exists across GDN/full-attn boundaries. (2) We are not so BW-saturated that wrong prefetches destroy hot cache. (3) Prediction cheaper than 1 ms.

**Falsification.** Offline: from traces, predict top-8 of ℓ+1 from ℓ features; measure recall and **extra unique experts**. If recall <70% or extras >20% of loads, runtime H4 is net-negative under saturation.

**Cost.** Medium–high (F7–F8). Breaks: complexity; training data for SpecPrefetch adapter.

**Prior art.** Fate, SpecPrefetch (phone!), Pre-gated MoE, ProMoE, Mixtral-offloading. SpecPrefetch is the closest.

---

## H5 — Per-miss precision ladder (HOBBIT-style) at the 2.4 bpw floor   [axis: a/e hybrid]   [novel: no]

**Mechanism.** On cache miss, load IQ1_* (or similar) cold expert instead of IQ2_M; optionally promote to IQ2_M if reused. Cuts miss bytes ~30–50% at quality risk localized to cold experts.

**Model.**  
Miss traffic \(T_m = 88.8\) MB. If miss loads at ratio \(\rho\) bytes (e.g. 0.6):

\[
T' = T_m \cdot \rho = 88.8\rho
\]

| \(\rho\) | \(T'\) | tok/s rough |
|---|---:|---:|
| 1.0 | 88.8 | 5.0 |
| 0.7 | 62 | ~6.3 |
| 0.5 | 44 | ~7.0 |

**Prediction.** tok/s **6–7**; TTFT same; RSS may hold dual copies briefly; energy down; **quality risk on rare experts** (morphology).

**Assumptions.** (1) Further quant below 2.4 bpw is usable for cold — weak given already 2 malformed/1k. (2) Dual-quant GGUF or on-the-fly available.

**Falsification.** Force all misses to IQ1 path in offline sim of logits on Italian eval; if PPL delta > threshold or malformed rate doubles, kill.

**Cost.** High (dual storage or runtime requant). Breaks: quality, disk.

**Prior art.** HOBBIT, EdgeMoE. Never at our bpw floor on Italian.

---

## H6 — Userspace compressed expert slab (zram-analogue without root)   [axis: f]   [novel: yes]

**Mechanism.** **Not found in the MoE offload literature as a first-class design.** Keep a third tier **in process RAM**: experts stored with a fast userspace compressor (e.g. LZ4/ZSTD level 1) after first use or for mid-hot set. On hit in compressed slab: decompress to compute buffer (no flash). On miss: flash → optionally admit to compressed slab rather than full-precision cache, raising **effective expert count in the 2 GB budget**.

Physics: RAM is ~50–100+ GB/s vs flash 0.4 GB/s. If an expert compresses to fraction \(q\) (weights already quantized — **low** residual compressibility) decompression must still beat flash.

**Model.**  
Effective slots \(N_{\text{eff}} = C / (s \cdot q)\) with \(s=0.942\) MB, \(q\) = compressed/uncompressed.  
For already-IQ2 data, \(q \in [0.85, 1.0]\) is plausible (poor compressibility) **[speculation]**.  
If \(q=0.9\), slots +11% — small.  
**Pivot:** store **activations or router-side caches**, or store **higher-prec hot** + **aggressive cold** in the slab — or compress **spans of co-packed experts**.

Better formulation: use the 2 GB as **(1−α) full IQ2 + α ultra-low-bit or compressed**, chosen by TinyLFU frequency:

\[
N_{\text{hot}} = (1-\alpha)C/s,\quad N_{\text{cold,ram}} = \alpha C/(s\rho)
\]

with \(\rho=0.5\) cold bits. Example \(\alpha=0.3\): hot slots 1488, cold-ram slots 1274, total 2762 vs 2120 (+30% entities). Hit from larger entity count.

| scenario | \(N_{\text{eff}}\) | expected \(\Delta h\) | tok/s |
|---|---:|---:|---:|
| q=0.9 pure compress | ~2350 | +1–3 pt | ~5.2–5.5 |
| α=0.3 dual-precision RAM | ~2760 | +4–8 pt | **~5.7–6.5** |
| α=0.5 dual-precision | ~3180 | +6–12 pt | **~6.2–7.0** |

**Prediction.** tok/s **5.3–7.0** depending on residual compressibility vs dual-precision variant; TTFT same; RSS **must stay <5.6 GB** — risk; energy: decompress CPU vs flash I/O — often a win if q or ρ good.

**Assumptions.** (1) Something in the expert tier still compresses or can be dual-bit in RAM. If IQ2 is incompressible **and** we refuse dual-bit, H6 dies. (2) Decompress << flash miss (~2 ms). LZ4 on 1 MB is well under that on X3. (3) No root needed — pure userspace.

**Falsification.** (Cheap): sample 100 expert tensors; LZ4/ZSTD ratio. If mean q > 0.95, abandon pure compress; only dual-precision variant remains. (Next): implement dual-precision slab offline hit simulator.

**Cost.** Medium for dual-precision slab; low for compressibility microbench. Breaks: CPU energy on little cores if decompress storms; memory fragmentation.

**Prior art.** zram/zswap (OS); HOBBIT (flash-side low prec); compressed KV caches in serving — **not** a userspace compressed **expert** slab on phone MoE streaming. Marked **novel** in this combination.

---

## H7 — Energy-aware decode budget / thermal-die-gated pace   [axis: f]   [novel: partial]

**Mechanism.** Not a tok/s maximizer — a **product** hypothesis: gate on `max(cpu-*)` not battery (Registro finding); optional: reduce `--io-threads` or pause when die > T* to avoid cliff throttling; measure **tokens per joule**. Under sustained chat, half-speed after thermal cliff is worse UX than slightly slower steady.

**Model.** Burst 5.0 tok/s for 64 tok vs sustained unknown. If die throttling cuts to 0.5× after minutes (F2 invalid regime suggested ~half — **untrusted**), average over 10 min conversation may be ~3.5 vs steady 4.5 managed.

**Prediction.** Peak tok/s same or −5%; **sustained** +20–50% vs unmanaged cliff; TTFT same; energy/token better if avoid waste retries; RAM same.

**Assumptions.** Thermal cliff exists in valid top-app regime — **unproven** (F5 not done).

**Falsification.** F5 long-run with `cpu-*` logging; if tok/s flat for 10 min at die <50 °C, H7 is moot for now.

**Cost.** Low (harness). Breaks: nothing.

**Prior art.** OS thermal frameworks; not applied as expert-stream product metric in literature we found.

---

## Ranking by expected value per unit effort

**Criterion:** \(\mathbb{E}[\Delta \text{tok/s} \times \mathbf{1}_{\text{quality OK}} \times \mathbf{1}_{\text{feasible}}] / \text{engineer-days}\), with quality risk heavily penalizing irreversible lossy methods until PPL exists. Ceiling finding weights **byte reduction and hit rate** over raw I/O threads.

| rank | H | EV rationale |
|---|---|---|
| 1 | **H2** policy (TinyLFU/Least-Stale) | Offline falsifiable in 1 day; lossless; literature says LRU wrong; high EV/effort |
| 2 | **H4** cross-layer prefetch (trace→recall first) | Offline recall test cheap; phone runtime medium; SpecPrefetch exists |
| 3 | **H3** packing | High upside on BW physics; high eng cost; do after traces define clusters |
| 4 | **H6** dual-precision RAM slab (novel) | Medium upside; medium cost; compressibility pretest is cheap kill-switch |
| 5 | **H7** thermal/energy harness | Low tok/s upside now; **mandatory instrumentation** before F5; cheap |
| 6 | **H1** REAP | Highest raw upside **if** quality holds; **blocked** on Italian PPL + irreversible — last among lossy |
| 7 | **H5** HOBBIT ladder | Blocked on already-low bpw + quality |

**Do not rank “more io-threads”** — Part A kills it.

**Recommended sequence:**  
(1) Italian PPL instrument + route traces (enables everything),  
(2) H2 offline bake-off,  
(3) H4 recall study,  
(4) H3 packing design from co-activation,  
(5) H6 microbench,  
(6) only then H1/H5 lossy.

---

# Appendix — Claim discipline

- All [M] numbers from BRIEF/F4/F0.6.  
- Wall-clock BW 425.3 MiB/s: \(84.73 \times 5.02\).  
- Byte hit ~70.5%: \(1 - 84.73/287.5\).  
- Naive loads 320: \(8 \times 40\).  
- Literature entries: primary arXiv/URL given; secondary PLAN cites marked where paper HTML was used.  
- Anything about sustained thermal half-speed outside valid top-app regime: **[untrusted / do not use]**.  
- Novel mark on H6: no MoE-offload paper in this sweep implements userspace compressed/dual-bit expert slab as a third tier on phone flash streaming; attack that claim in R1 if a counterexample exists.

---

**END ROUND 0**
