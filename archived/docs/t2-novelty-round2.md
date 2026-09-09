# Novelty web-sweep round 2 — candidates D and E

**Date:** 2026-08-15  
**Bar:** "nobody has even TRIED it". False NOVEL wastes engineering days. This report errs toward prior art.  
**Neither candidate clears the bar.** D is a closed-loop already shipped (coarser telemetry). E is Apple's co-activation flash bundling at a finer grain — **NEAR-DUPLICATE(Apple), loudly**.

Companion to `report.md` (candidates A–C). Same named-system checklist.

---

## Candidate D — Closed-loop expert-prefetch CONTROLLER on live lead-time telemetry

### Verdict: **NEAR-DUPLICATE (ExpertFlow, Shen et al. 2025)**

**Key-question answer: YES.** At least one MoE offloading system has shipped a runtime feedback loop on *measured* prefetch lateness and waste, not only a static or offline-trained policy.

Closest match: **ExpertFlow: Adaptive Expert Scheduling and Memory Coordination for Efficient MoE Inference** (Shen, Chu, Zhang, Xiang, Wu, Zhang; UConn; arXiv:2510.26730, 30 Oct 2025).  
https://arxiv.org/abs/2510.26730 · HTML: https://arxiv.org/html/2510.26730v1

They increment/decrement the prefetch *horizon* `S` from two live counters: stall (predicted expert not ready when demanded) and overfetch (expert already resident when needed). That is the same control problem as D (late → earlier/wider; waste → narrower), with cheaper sensors.

### What the candidate is

Per prefetched expert, measure:

- issue timestamp  
- I/O-complete timestamp  
- first-demand-touch timestamp  

Derive per window: `late%` (demand beat I/O), lead-time percentiles, issue→complete service time, in-flight depth, wasted-bytes ratio.

Then a **feedback controller** (per ~second or per N tokens) sets prefetch **width** and **issue rate**:

- late% high → issue earlier / wider  
- waste high → narrower  
- in-flight saturated → backpressure  
- ramp-up suppression on the first tokens of a burst  

Contrast requested: PreScope (cost-model + offline predictor), HOBBIT/DyMoE (precision, not rate), ProMoE/ExpertFlow-2024 (predictive, no lateness loop), Linux adaptive readahead, Srinath 2007 HW prefetcher throttling.

### What prior art actually does

**ExpertFlow (Shen 2025) — the loop exists.**  
https://arxiv.org/html/2510.26730v1

§2.3.3 *Real-time Step Size Adjustment* (verbatim intent):

> “This requires a **feedback loop** that monitors indicators like **cache miss rate and wait time**, and adjusts `S` responsively. The control logic must be stable and responsive, avoiding oscillations or overcompensation.”

§3.2.2 *Cross-Layer Prediction and Delta Adjustment* (the shipped controller):

> “if a predicted expert is unavailable (causing **wait latency**), a **stall counter** increases. When it exceeds a threshold, the counter resets and **`S` is incremented by 1**. Conversely, if experts are already loaded when needed, an **overfetch counter** increases. Once this reaches its threshold, it resets and **decrements `S` by 1**.”

§3.3.2 *Prefetch and Cache Coordination*:

- query cache occupancy **before** computing skip distance `S` (admission / backpressure)  
- post-prefetch transfer times **update the bandwidth estimate** `C_s` used in `S = (N_e · E_s) / (C_s · T_l)`  
- feedback counters incorporate cache hit/miss stats  

Mapping onto D:

| D signal | ExpertFlow 2025 |
|---|---|
| late% / demand-before-IO | stall counter (wait latency) |
| wasted-bytes / unused prefetch | overfetch counter |
| issue earlier / wider | increment `S` (deeper lookahead) |
| narrower | decrement `S` |
| inflight / backpressure | cache occupancy checked before admitting more prefetch |
| service time | observed transfer time → `C_s` |
| per-expert issue / complete / touch timestamps, lead-time percentiles, wasted-bytes *ratio*, ramp-up suppression | **not** instrumented |

They do **not** keep a per-expert lead-time histogram. They do **not** name a PID / AIMD on `late%`. They **do** close the loop on measured lateness and waste at runtime and change prefetch aggressiveness. That is the question the owner asked.

**PreScope** (Yu et al., arXiv:2509.23638) — the designated contrast, still the second-closest.  
https://arxiv.org/abs/2509.23638 · HTML: https://arxiv.org/html/2509.23638v1

- A **Timer** “continuously monitors the execution pipeline” and records `t_io`, `t_c`, `t_g`.  
- PreSched “combines Timer feedback with LLaPor forecasts.”  
- Prefetch *count* `|f|` is `T_gap / t_io`, then accepted/rejected by a **predicted** `R_hit` / `R_miss` cost model, not by measured late% of last window.  
- LLaPor is an **offline-trained** layer-group predictor with online gradient updates.  
This is a live-parameterized cost-model scheduler. It is **not** a lateness/waste controller. Keep it in the contrast column.

**ProMoE** (Song et al., arXiv:2410.22134) — proactive cache + learned predictor. No stall/overfetch loop.  
https://arxiv.org/abs/2410.22134

**ExpertFlow (He et al. 2024, arXiv:2410.17954)** — different paper, same name. Predictive expert cache + token schedule. **No** closed loop on measured prefetch lateness. Do not confuse with Shen 2025.

**HOBBIT / DyMoE** — mixed-precision load policy, not issue-rate control. Confirmed in round 1.

**HybriMoE** — greedy per-layer CPU/GPU placement + next-layer prefetch. Local greedy, not a lateness controller.

**vLLM `--moe-gpu-prefetch <num>`** (issue #41447, Apr 2026) — static prefetch *count*. No telemetry loop.  
https://github.com/vllm-project/vllm/issues/41447

**Linux adaptive readahead** (`ondemand`, `context`, `adaptive`) — page-stream sequentiality, not router-driven expert IDs. Same *shape* (late → more pages; waste → shrink window), different object.

**Srinath et al., MICRO 2007, “Feedback Directed Prefetching”** — hardware cache-line prefetcher throttling on accuracy / pollution / bandwidth. Same *shape*, cache lines not experts.

**APAC** (Yang et al., IEEE TPDS 2025) — RL agent for **hardware** prefetch aggressiveness (accuracy / lateness / pollution). Not MoE expert offload.

No llama.cpp / ik_llama.cpp / ollama issue found that implements per-expert late%/waste AIMD. llama.cpp #20757 (round 1) is a lossless two-tier slot cache, not a prefetch-rate controller.

### Three closest works (one line each)

| Work | How it differs from D |
|---|---|
| **ExpertFlow (Shen 2025)** https://arxiv.org/abs/2510.26730 | **Same loop** (stall → wider `S`, overfetch → narrower `S`, occupancy backpressure, live `C_s`). Sensors are counters, not per-expert issue/complete/touch timestamps or lead-time percentiles. |
| **PreScope** https://arxiv.org/abs/2509.23638 | Live Timer feeds a **cost model** + offline LLaPor; prefetch width is `T_gap/t_io` gated by *predicted* hit rate, not measured late%/waste. |
| **Srinath 2007 / Linux readahead** | Identical control intuition (accuracy vs pollution vs bandwidth) on **cache lines / file pages**, not router-selected MoE experts. |

### Remaining sliver (do not treat as NOVEL)

Richer telemetry (per-expert lead-time CDF, wasted-bytes ratio, in-flight depth, burst ramp-up suppression) and an explicit AIMD/PID on those signals inside llama.cpp. That is a **better sensor suite** on a loop ExpertFlow already runs. Shipping D as “nobody closed a loop on prefetch lateness” is false.

### Search queries run (D)

- `adaptive prefetch aggressiveness MoE expert offloading feedback controller`
- `"closed loop" OR "feedback" prefetch expert MoE "late" OR lateness OR waste OR backpressure offloading`
- `ExpertFlow adaptive prefetch "prefetch horizon" OR "prefetch width" OR "number of experts to prefetch" runtime`
- `APAC "prefetch aggressiveness" RL "MoE" OR "mixture of experts" OR LLM Yang 2025`
- Plus fetches: PreScope 2509.23638, ExpertFlow 2510.26730

---

## Candidate E — Co-activation-clustered FLASH LAYOUT for experts

### Verdict: **NEAR-DUPLICATE (Apple LLM-in-a-Flash)** — say this loudly

Apple already stated the idea, measured co-activation, **tried packing co-activated units adjacently on flash so one sequential read serves a cluster**, and published it. Granularity is **neurons inside an FFN**, not whole MoE experts. The owner's instruction: *if Apple's bundling covers the concept at any granularity, say NEAR-DUPLICATE(Apple) loudly.* It does.

Paper: **LLM in a flash** (Alizadeh, Mirzadeh, Belenko, … Apple), arXiv:2312.11514v2.  
https://arxiv.org/abs/2312.11514 · HTML: https://arxiv.org/html/2312.11514v2 · Apple ML: https://machinelearning.apple.com/research/efficient-large-language

Section **3.2 “Bundling Based on Co-activation”** is the candidate, one level down.

### What the candidate is

Offline (or background on-device) rewrite of the expert weight file so experts that frequently **co-activate in the same token/layer window sit adjacent on flash** → one larger sequential read serves 2–3 experts (UFS likes sequential). Database clustering / game-asset streaming, applied to MoE experts.

Must check Apple row-column bundling **and** co-activation bundling; also SiDA, fMoE, ZipMoE, llama.cpp forks.

### What Apple actually does (read this twice)

Two *shipped* techniques, plus one *tried and published as negative*:

1. **Windowing** — keep recently activated FFN rows in DRAM; only the delta vs the last k tokens is read from flash.

2. **Row-column bundling** — store **up-projection column i concatenated with down-projection row i** (same intermediate neuron, two matrices). One sequential read of `2 · d_model · bytes` instead of two random reads. This is **within a projection pair**, not across experts.

3. **Bundling Based on Co-activation** (Figure 6, §3.2) — **this is E**.

   - They compute pairwise neuron co-activation on C4.  
   - Power-law “friends”: closest friend co-activates ≥95% of the time; 4th friend ~86%; 8th friend falls off.  
   - They **rewrote flash layout** so each neuron sits next to its closest friend; on a predicted activation they read the pair as one sequential chunk.  
   - **Negative result (their words):** “this resulted in loading highly active neurons multiple times and the bundling worked against our original intention. … the neurons that are very active are ‘closest friend’ of almost everyone.” They publish it as a failed attempt and invite “future research studies on how to effectively bundle the neurons.”

So Apple:

- identified that **co-activation clustering of flash layout** should turn random expert/neuron I/O into sequential bursts;  
- implemented it;  
- hit the **hub / popular-item** problem (the same problem E will hit: a hot expert is everyone's neighbor);  
- shipped the safer intra-neuron row-column pack instead.

**US20240370699A1 and adjacent filings.** Search for that exact number plus Apple flash-weight bundling did **not** return a publicly indexed grant/application with that serial in this sweep. The paper *is* the disclosure. If that application exists and claims “reordering neural-network parameters on non-volatile memory by co-activation so larger sequential reads replace random reads,” it covers E at the claim-language level regardless of neuron vs expert. Treat the paper as the citable prior art; do not assume the patent number is a miss.

Apple's related-work paragraph even points at **EdgeMoE** and says Mixture-of-Experts “have a sparse structure in their feed forward layer and can leverage our method.” They considered MoE as a consumer of the same flash-bundling idea.

### Other MoE storage-layout work (none is E; none beats Apple)

**ExFlow** (Yao et al., IPDPS 2024) — “Exploiting Inter-Layer Expert Affinity for Accelerating Mixture-of-Experts Model Inference.”  
https://arxiv.org/abs/2310.12888 (cited from ExpertFlow/PreScope as Yao 2024)

Places **frequently co-activated experts on the same GPU** to cut all-to-all. That is *device placement*, not flash file order. Same affinity signal, different medium.

**ZipMoE** (Yang et al., arXiv:2601.21198, ICML 2026).  
https://arxiv.org/abs/2601.21198 · HTML: https://arxiv.org/html/2601.21198v1

Lossless bit-field compression (E-chunks / SM-chunks) + **cache-affinity scheduling** (which *cache pool* an expert lands in: full / compressed / SM-only / E-only). Serialized to NVMe as compressed shards, **not** reordered by co-activation. “Cache-affinity” here means *schedule to the pool whose latency matches the expert's rank*, not “place friends sequentially on UFS.”

**SiDA-MoE** (Du et al., MLSys 2024) — embedding hash → expert, for serving. No flash clustering.  
https://proceedings.mlsys.org/paper_files/paper/2024/hash/698cfaf72a208aef2e78bcac55b74328-Abstract-Conference.html

**fMoE** — deduplicates *expert activation maps* in a predictor store, not weight-file layout.

**llama.cpp / GGUF** — experts are tensors in **index order** (`blk.N.ffn_*.EXPT`). mmap + `POSIX_MADV_WILLNEED` (issue #20757, discussion #23324) is sequential *because IDs happen to be packed*, not because a co-activation permutation was written. No fork found that rewrites the GGUF so `{e3,e7,e1}` sit in one extent because they co-fire.

**Flash-MoE** (danveloper/flash-moe, 2026) — Qwen3.5-397B from SSD on a 48 GB Mac, “inspired by LLM in a Flash.” Parallel `pread` of the **K active experts independently**; “Trust the OS” page cache. **No** co-activation clustering of the file.  
https://github.com/danveloper/flash-moe

**EdgeMoE / Mixtral-offloading / MoE-Infinity / HOBBIT** — cache/prefetch/quantize. File order is the checkpoint order.

Classic analogs (not MoE, same layout idea): DB clustering indexes, game-asset streaming packs, Extents / LFS write clustering. They establish the *pattern* is ancient; Apple applied it to LLM weights on flash.

### Three closest works (one line each)

| Work | How it differs from E |
|---|---|
| **Apple LLM-in-a-Flash, §3.2 “Bundling Based on Co-activation”** https://arxiv.org/abs/2312.11514 | **Same idea on flash**: cluster by co-activation, pack neighbors for one sequential read. Granularity is **FFN neurons**, they hit the hub-neuron failure, and they *shipped* row-column (same neuron, two matrices) instead. |
| **Apple row-column bundling** (same paper, §3.2 first half) | Sequential pack of **up-col i + down-row i** of one neuron. Not a cluster of *different* experts that fire together. |
| **ExFlow** (Yao et al., IPDPS 2024) | Co-activation affinity used to **colocate experts on GPUs** (communication), not to rewrite a UFS file. |

### Remaining sliver (do not treat as NOVEL)

Apply Apple's failed neuron experiment to **whole experts** (8–128 large blobs, k=2–8). Possible that the hub problem is milder (or worse: Mixtral's hot experts *are* everyone's friend). That is a **granularity swap**, not a new concept. Apple already told you the failure mode. A reviewer will write “NEAR-DUPLICATE(Apple) + ExFlow affinity signal.” If you still run it, the first experiment is: measure whether co-activated expert *sets* are stable enough that a static permutation beats index-order + `madvise` + multi-thread `pread` (Flash-MoE already gets 4+ tok/s on 397B that way).

### Search queries run (E)

- `LLM-in-a-Flash Apple "bundling" OR "row-column" co-activated neuron expert layout flash MoE`
- `US20240370699A1 patent Apple flash memory neural network weights bundling`
- `site:patents.google.com LLM flash memory bundling weights Apple 20240370699 OR 2024/0370699`
- `"ExFlow" OR "Exploiting Inter-Layer Expert Affinity" colocate co-activated experts storage OR flash OR disk OR layout ZipMoE file layout`
- `ZipMoE "cache-affinity" OR "expert layout" OR "storage layout" OR "sequential" flash expert clustering`
- `patents.google.com "storing model parameters in flash" bundling Apple neural network US2024`
- Plus fetches: arXiv 2312.11514v2, ZipMoE 2601.21198

---

## Cross-check of the named systems (D and E)

| System | D (closed-loop prefetch rate) | E (co-activation flash layout) |
|---|---|---|
| PreScope | Timer + **cost model**, not late%/waste AIMD | No |
| HOBBIT / DyMoE | Precision policy | No |
| ProMoE | Predictive prefetch, no lateness loop | No |
| ExpertFlow (He 2024) | Predictive cache | No |
| **ExpertFlow (Shen 2025)** | **YES — stall/overfetch → `S`** | No |
| SiDA-MoE | Hash routing | No file clustering |
| fMoE | Activation-map store | No |
| ZipMoE | Cache-pool scheduling | Compression shards, **not** co-act order |
| llama.cpp / ik / ollama | Static / mmap / WILLNEED | Index-order tensors |
| LLM-in-a-Flash | N/A (neuron paging) | **YES — co-act bundling tried** |
| EdgeMoE / Mixtral-offload / MoE-Infinity | Prefetch/cache | Checkpoint order |
| PowerInfer 1/2 | Neuron hot/cold | Not expert flash clusters |
| ExFlow | — | GPU colocation, not flash |
| Linux readahead / Srinath 2007 | Same *control shape*, wrong object | — |
| Flash-MoE (2026) | Independent `pread` | No clustering |

Patents: US20240370699A1 was **not** retrieved as a public record in this sweep. Apple's paper is sufficient prior art for E. Not FTO advice.

---

## Bottom line

| Candidate | Verdict | One-sentence reason |
|---|---|---|
| **D** | **NEAR-DUPLICATE (ExpertFlow Shen 2025, https://arxiv.org/abs/2510.26730)** | They already close a loop on measured wait (late) and overfetch (waste) and change prefetch horizon/aggressiveness at runtime. D is a richer sensor pack on that loop. |
| **E** | **NEAR-DUPLICATE (Apple LLM-in-a-Flash, https://arxiv.org/abs/2312.11514) — loudly** | §3.2 “Bundling Based on Co-activation” *is* co-activation flash clustering. They tried it (neurons), it failed on hubs, they published the attempt. Expert-level is the same claim at coarser grain. |

**Do not schedule either as “nobody has even tried it.”**  
If something still ships: D is incremental instrumentation on ExpertFlow's controller (justify only if llama.cpp has no `S` knob and you need phone-flash late% specifically). E should start from Apple's negative result, not from a novelty claim.

DONE
