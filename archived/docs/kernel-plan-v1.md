# Kalsa Kernel Plan v1 — CPU / RAM / GPU / Flash

Date: 2026-08-14. Author: campaign coordinator. Status: DRAFT for external
hostile audit (Qwen 3.8 Max). Every number below has a source report in
`reports/`; every claim is tagged [MEASURED], [DERIVED] or [HYPOTHESIS].

## 0. Mission (owner directive, 2026-08-14)

We want OUR kernel layer. Not to out-optimize llama.cpp on its home turf —
we measured that floor three times — but because:

1. **We will always run brand-new LLMs.** When a new architecture drops,
   upstream ships slow fallbacks for weeks/months. A standing kernel
   capability = day-zero fast paths (proven once already: our Q6_K OpenCL
   dispatch fix made GPU output token-identical where upstream was
   garbage).
2. **Our runtime is streaming MoE from flash.** Upstream will never
   optimize for flash-streamed experts (`use_extra_bufts=false`, hook in
   the CPU mul_mat_id loop only). Anything cache-aware is ours alone.
3. **Speed is not the only axis.** Heat/throttle and TTFT are product
   metrics. A kernel that cuts joules per token or moves prefill heat to
   the GPU is a kernel, even at neutral wall-clock.

Targets (owner): S23 wall ≥7 (stretch 9) tok/s on the big-model tier;
flagship resident 15-20; sustained decode without collapse; TTFT ~1-3 s
via prewarm everywhere.

---

## 1. CPU — what we know

### Measured (S23 = SD8Gen2, campaign pin armv8.2+dotprod, REPACK on)

| fact | number | source |
|---|---|---|
| K0 waterfall at t4, Mellum2 k8 | 0.228 s/tok: GEMV floor 0.023 (10%), layout 8%, attn ~15%, "dispatch" 43%, t4-vs-t2 sync tax 21%, dequant <2% | moe-mellum2-kernel-k0.md |
| S0: t2 beats t4 | 0.181 vs 0.228; k6d10: **0.148** | k0 + s2 reports |
| Config-only product win | **k6d10 t2 = 5.151 wall tok/s** (+37% vs F1c 3.76), zero kernel code | moe-mellum2-kernel-s2.md |
| S1 virtual tall GEMV | 2.58× at t=8 microbench; **NULL at t2 on-model** (421 µs stock=fused=tall) | moe-mellum2-kernel-s1.md |
| S2 fused FFN (5 nodes→1 launch) | bit-exact for prod graphs, full suite 16191/16191, **fused LOSES ~7% to stock at every same-t pair** | s2 report + hostile review |
| S3: streamed experts never repacked | `use_extra_bufts=false` unconditional (cache rebind); stock = fused = plain vec_dot | moe-mellum2-kernel-s3.md |
| S3: REPACK 8x4 ID at t2 | **loses 0.52×** (949 vs 496 µs) — per-expert row split + 8-row alignment at 2 threads | s3 report |
| S3b: i8mm 8x8 ID at t2 | **wins the op 1.27×** (389 vs 496 µs) but token-model **+0.2–4%** (down Q8_0/Q5_0 doesn't benefit) | s3 §Phase 0b |
| i8mm CPU-time per op | **−21%** at equal wall | s3b bench |
| Dense control | same binary, dense 2B = 15.9 tok/s → the tax is the 64-micro-expert geometry, not the build | F1d |
| Per-SoC thread U-curve | S23: t2; SM8650: t4 (Marco 8.58 vs 4.11 at t6); knee t4>t5>t6 | xiaomi t4 round |

### Failure taxonomy (CPU)

- **L1 — t4 attributions don't transfer to t2.** The K0 "dispatch 43%"
  slice evaporated at t2: two threads already saturate GEMV bandwidth.
- **L4 — fusion loses if it worsens locality or bypasses faster paths.**
  S2's own overheads (gate↔up per-row bounce across two 9.3 MiB tensors,
  4 barriers/layer, wait-all-three I/O serialization) cost more than the
  launch count saved.
- **L5 — microbench wins dilute on the model mix.** i8mm 1.27× on the ID
  op → +4% token-model.

### Verdict + hypotheses (CPU)

- **Speed at t2 on this silicon: CLOSED.** 0.148 s/tok is the floor,
  measured on three kernel families (vec_dot/llamafile, REPACK 8x4,
  i8mm 8x8). [MEASURED]
- **K-E (in flight): i8mm as a THERMAL kernel.** −21% CPU-time per op at
  equal wall → fewer joules → less throttle on sustained. J/token and
  sustained curves were NEVER measured. Kill criterion: on-model CPU-time
  delta <10% or no sustained/thermal dividend. [HYPOTHESIS, cell running]
- **Thread scaling reopens above t2 only with fat ops** (S1 fused hit
  2.58× at t8). If a future device has more fast cores AND thermal room,
  the S1/S2 substrate becomes relevant again. Keep the branch PR-able.
  [DERIVED]
- **8 Elite Gen 5 class (Oryon, ~2× compute, ~2× BW): the floor moves.**
  All t2 conclusions are per-SoC; re-run the S3b bench matrix on first
  contact. [DERIVED]

---

## 2. RAM / cache — what we know

The streaming engine (expert cache + expert-ready hook + drop-cold) IS our
proprietary kernel layer today. Facts:

| fact | number | source |
|---|---|---|
| Streaming regime is silicon-independent | MiB/tok and hit% identical S23↔Xiaomi↔Jelly to the digit (e.g. Marco1c 51.5/53.5 on all three) | lineup-card |
| Byte cuts pay ONLY if they cut ACTIVE bytes | drop d1.0: +23% (F1e); KEXP on S23: 1.62× (Marco1c) | F1e, marco reports |
| Fewer stored bytes ≠ faster decode | REAP-50 resident 2.82 GB = 10.68 vs streamed A0 10.60 on G99 (majflt 0, hot=cold) | reap50 jelly |
| Sub-4-bit dequant tax on weak cores | KEXP k4 on G99: 8.83 vs A0 10.60 — 6.8 GB/s effective vs 10.8 roofline | moe-g99-freetier.md |
| Residency machinery works | 100% page cache, load 3.36→0.90 s hot | reap50 jelly |
| Cache-insert repack | dead: −1.5% (would only help gate/up, and ID t2 loses on 8x4) | s3 phase 0 |

### Hypotheses (RAM)

- **K-R is mostly harvested.** The active-byte levers (k-cut, drop-cold,
  KEXP-on-strong-silicon) are measured and shipped/gated. Remaining ideas:
  - Per-layer mixed expert quant (hot layers Q4, cold Q3) — bounded by L2
    (dequant tax) on weak cores; viable on flagships only. [HYPOTHESIS]
  - Admission/eviction policy tuning beyond drop-cold (frequency-aware,
    layer-aware) — expected single-digit %; only worth it bundled with
    other work. [HYPOTHESIS]
- **The cache is where day-zero MoE arch support lives** (expert tensor
  naming/layout per new arch): keep the insert path geometry-agnostic
  like the S2 matcher. [DERIVED]

---

## 3. GPU — what we know

| fact | number | source |
|---|---|---|
| GDN + MoE kernels EXIST upstream in our pin | GATED_DELTA_NET, SSM_CONV, MUL_MAT_ID Q4_K/Q5_K/Q6_K (Adreno) | gdn-k0 op inventory |
| Our Q6_K dispatch fix | large-M redirect broke lm_head (NMSE ~12) → fixed, greedy token-identical, regression tests added | moe-gdn-k22-fix.md |
| A7X decode on GPU | 740: 0.41× CPU (5.06 vs 12.37). Xiaomi 750 CPU 16.15 vs GPU 7.07 (0.44×) | k2.2, gpu_xiaomi |
| A7X prefill on GPU | **1.29×** (740, measured) up to 5.77× (crossgen recon data) — "the GPU dividend on A7X is TTFT" | k2.2, recon |
| M1 port post-mortem | subgroup-free dequant MISCOMPILES on driver E031.41; noshuffle already at DRAM roof (34-41 GB/s) on FFN shapes; E2E gap = **~60 ms/tok dispatch/glue**, not kernels | moe-mld-m1.md |
| LiteRT proof | 1.43× at 3.8B ON the 750 (subgroup-free + their fused executor); S23: GPU 2.8× vs size-matched CPU, but 1.5B GPU 18.7 FAIL vs CPU 25.8 | litert reports |
| Q7-LANDMINE | expert-ready hook exists ONLY in the CPU mul_mat_id loop → streamed experts must stay on CPU (or engine rework) | gdn-k0 |
| Subgroup broadcast | absent on all A7X; first silicon = Adreno 830 / 8 Elite | adreno750 recon |

### Failure taxonomy (GPU)

- **L8 — the gap is the executor, not the kernels.** Per-op dispatch/glue
  (~60 ms/tok) dwarfs kernel deltas; ML Drift-style fused executor is the
  real unit of work (months, not weeks).
- **L9 — drivers lie.** The same kernel + convert PASSES with stock
  convert and MISCOMPILES with ours on E031.41. Driver-version matrices
  are part of any GPU claim.

### Hypotheses (GPU) — K-G: the PREFILL executor

- **Scope prefill only, dense+attention only** (experts stay CPU per
  Q7-LANDMINE; prefill is compute-bound so GPU wins where decode lost).
  Value: TTFT 1.3-1.7×+ on the A7X installed base AND **moves the prefill
  thermal spike off the CPU** (E1 finding: TTFT and thermal peak share the
  prefill root cause; prewarm currently burns 30-50 s of CPU at launch).
  [HYPOTHESIS built on MEASURED 1.29× floor]
- **Gate K-G with M2-carta first** (1 day): dispatch count per prefill
  from sched logs + fusion ceiling estimate. Kill: paper ceiling <1.3× or
  no staged deliverable inside 2 weeks of work.
- **perf/W on GPU prefill was never measured** — fold into K-E
  methodology (J per prefill token, CPU vs GPU). [HYPOTHESIS]
- 8 Elite Gen 5 (broadcast=true) reopens GPU DECODE — different silicon,
  different plan, not this document.

---

## 4. Flash / storage — what we know

| fact | number | source |
|---|---|---|
| Streamed flash I/O | 0.11-0.42 s/tok depending on config; 349-425 MiB/s sustained reads (S23 t4 / Xiaomi screen-on) | kernel_s2, xiaomi rounds |
| Flash is rarely the wall | on S23-class the wall is compute (Mellum) or balanced (Marco); on G99 it's dequant/BW | multiple |
| overlap + io-threads already ship | io-two-wave variant NULL | F1e |
| Cold mmap load | 52 s first-load 4B on Xiaomi UFS4 (then 12-14 s) — load, not decode, feels it | ttft-4b |
| DONTNEED discipline | measurement-grade; product uses page-cache warmth (hot loads 0.90 s) | reap50, protocols |

### Hypotheses (Flash) — K-F

- **Router-ahead prefetch** (`route_ahead` flag exists, unproven):
  predict next-token experts one layer early, issue reads before compute
  needs them. Only pays where decode is I/O-STALLED — today that is
  Marco1c-class on mid silicon (flash 0.3+ s/tok vs compute 0.05).
  Measurable in a 1-day cell: stall time from the existing telemetry.
  Kill: overlap already hides >90% of I/O. [HYPOTHESIS]
- **Compression-in-cache** (store experts compressed, decompress on hit):
  bounded by L2 — decompress is dequant-tax by another name. Only
  plausible with hardware-cheap codecs and only on strong cores. LOW
  priority. [HYPOTHESIS]
- Write path: nothing to do (we never write).

---

## 5. The day-zero playbook — K-N (the strategic asset)

What "our kernel" means operationally when a new LLM drops:

1. **Convert + smoke** (we did the first-ever safetensors→GGUF of
   lfm2moe REAP in one night — pipeline is proven).
2. **Bench the fallbacks**: the S3b microbench harness + S2's
   test-backend-ops pattern generalize to any op — find where the new
   arch runs slow paths (like GDN did before 8ad8aef44).
3. **Write the 2-3 missing kernels** with the S2 discipline: geometry
   from tensors (no hardcode), NMSE oracle vs `use_ref`, adversarial
   matcher review, greedy determinism gates, honest ON≠OFF reorder
   policy + PPL gate.
4. **Autotune probe on device** (K-A): threads/k/drop per SoC — the
   U-curves are per-SoC facts (t2 S23 / t4 SM8650), a first-launch
   micro-bench + cached per-device config is pure product win and uses
   only existing knowledge. Smallest work item in this plan.
5. Upstream what generalizes (Q6_K fix precedent; S1+S2+matcher branch is
   PR-ready) — reputation + reduced fork drift.

Assets already in hand: fused-FFN matcher/kernel (correct, audited),
S3b bench matrix, adversarial harness, correctness oracles, the
convert pipeline, per-SoC U-curve data, this failure taxonomy.

---

## 6. Proposed sequencing (with gates)

| # | workstream | cost | gate to continue | expected value |
|---|---|---|---|---|
| 1 | **K-E** i8mm thermal (RUNNING) | 1 day | CPU-time/token −10%+ AND sustained/thermal dividend | sustained tok/s + battery, all CPU decode |
| 2 | **K-A** autotune probe (threads/k/drop per SoC) | 2-3 days | none needed — data exists, pure engineering | every device gets its best config day one |
| 3 | **K-G** M2-carta → GPU prefill executor (staged) | 1 day paper, then 2-week stages | paper ceiling ≥1.3×; each stage ships a measurable TTFT win | TTFT + heat off CPU on A7X base |
| 4 | **K-N** day-zero playbook doc + harness packaging | 2 days | — | time-to-fast on next LLM release |
| 5 | **K-F** router-ahead prefetch cell | 1 day | I/O stall >10% of token time on a target device | mid-silicon Marco-class decode |
| 6 | K-R extras (mixed expert quant etc.) | on demand | flagship-only, PPL-gated | single digits |

Explicitly NOT in plan: CPU speed kernels at t2 on SD8Gen2-class (closed,
3× measured); GPU decode on A7X (closed, 2 devices); cache-insert repack
(closed, −1.5%); REAP-style prunes for speed (L3).

## 7. Questions we invite the auditor to attack

1. Is the L1 claim (t2 saturates BW) actually proven, or only shown for
   the shapes we benched? (S1 421 µs three-way tie is the evidence.)
2. K-E: is current_avg battery sampling adequate for J/token, or do we
   need a power rail? What sampling design makes the A/B honest?
3. K-G: is "prefill-only, experts-on-CPU" coherent with a hybrid graph on
   A7X (attn on GPU, FFN CPU) — where do the sync points eat the 1.29×?
4. The wait-all-three hook serialization (S2 review §1d): worth an
   overlap redesign (compute expert i while waiting expert i+1) even on
   the STOCK path? Nobody measured its cost at d065 (12% miss).
5. Anything in the failure taxonomy you can refute with our own data?
