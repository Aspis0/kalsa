# Q25 — Crazy / Exotic Proposals Archive

> **Author:** q25 agent (automated sweep)
> **Created:** 2026-08-22
> **Status:** COMPLETE
> **Owner directive (22/08 evening):**
> (a) Mali kernels for cheap-phone markets — queue #26 already has the gate
> (b) NPU for compute-bound SPIKES (TTFT/prefill, embeddings, vision encoders, small drafts/classifiers) — never decode
> (c) "AI-ISP for images" → vision-encoders-on-HTP

---

## Summary Table

| # | Idea | Epoch Verdict | What Changed Since | Reopen Gate | Priority |
|---|------|--------------|--------------------|-------------|----------|
| 1 | **NPU/HTP for MoE decode** | KILLED (08/06 recon) | 0.67 MiB load = quant unsupported; decode on HTP slower than CPU (Qwen3.5-4B Q4_0: CPU 11.4, HTP 3.0 t/s, llama.cpp #23314); unified memory = DRAM-bound | Never reopen for decode | **LOW** (owner repurposed NPU for spikes — see #2) |
| 2 | **NPU/HTP for compute-bound SPIKES** (prefill, embeddings, vision encoders, draft/classifiers) | PARKED → owner 22/08: "reopen as coprocessor" | AI Hub 690 tok/s prefill; mllm-NPU >1000 tok/s on 1.8B; Hexagon VTCM 8 MB confirmed; `nspss-*` thermal already readable; llama.cpp Hexagon backend open-source | (a) verify Q4_0/Q4_NL tensor loading on S23 Hexagon v73; (b) measure prefill tok/s on a supported quant (NOT Q4_K_M); (c) cost of CPU↔HTP handover per layer < 0.5 ms | **HIGH** (owner directive) |
| 3 | **AI-ISP for images → vision-encoders-on-HTP** | Owner 22/08: "ISP vivo, non il silicio ma l'encoder" | True ISP (Spectra/CHI) = photographic pipeline router, not compute; EVA/CVP = fixed-function (DFS, optical flow), no GEMM; VENUS = encode-only. "AI-ISP" reinterpreted as running a CLIP/SigLIP vision encoder on HTP for multimodal Kalsa | (a) find a vision encoder that fits in < 8 MB VTCM + streaming weights; (b) verify Hexagon backend executes the encoder's ops; (c) measure prefill speedup vs CPU | **MED** (owner direction, needs feasibility proof) |
| 4 | **ISP Spectra / CHI compute** | KILLED (18/08 recon) | CHI composes photographic pipelines; "extended nodes" dispatch to CPU/GPU/DSP, not ISP. `qcom_camss` mainline = V4L2 capture. CHI is a router, not an engine | Never | **LOW** |
| 5 | **EVA/CVP for matrix compute** | KILLED (18/08 recon) | `eva-kernel` = `msm_cvp` renamed; allow-list `cvp_hfi_defs[]` permits DFS, SGM_OF, CV_TME, WARP, NCC, HCD, OD, FD, ICA, DMM, DCM only. DCM = "Descriptor Calc & Matching" ≠ dense compute. `SET_MODEL_BUFFERS` = face-detection IOVA, not arbitrary weights. SELinux neverallow on `/dev/cvp*` | Never | **LOW** |
| 6 | **VENUS motion-estimation-only** | KILLED (18/08 recog) | No ME-only mode in public UAPI. Trick exists on NVIDIA NVENC (desktop). Patching kernel cannot add firmware mode. Would be SAD, not GEMM anyway | Never | **LOW** |
| 7 | **UFS HPB acceleration** | KILLED (18/08, 3 independent reasons) | Removed from Linux mainline 2023; sysfs `hpb_enable` read-only by ABI; accelerates 4 KB random reads only (our blocks = ~1 MB) | Never | **LOW** |
| 8 | **Sensor hub / DPU display / modem DSP** | KILLED (18/08) | Sensor hub: no public compute API. DPU: display-only. Modem: "Qualcomm programs those cores" — sealed | Never | **LOW** |
| 9 | **GPU OpenCL for MoE offloading** | Initially KILLED (09/08) → REVIVED (19-20/08) | Deep research killed it 09/08 (K2: GDN/SSM ops missing; K5: OpenCL slower on same S23). Then we fixed the Adreno miscompilations: q4_0/q4_1/q5_0/q5_1/mxfp4 now pass on A740. K2 closed (q4_K/q5_K). KEXP kernels written from scratch (q2_K/q3_K). **SHIPPED: 1.553× OLMoE experts-on-GPU, 1.81× KEXP exploratory** | Already reopened and closed as success | **HIGH** (active, shipped) |
| 10 | **GPU trunk-dense offloading** | DEMOTED (08/07 profiling) | F5.2 profiler showed experts GEMM = 54.5% of compute, trunk dense = rest. With compute only 0.116 s/token and bottleneck at I/O, moving dense to GPU frees cores but I/O stays | If stall% > 20% on a new device class (dispatcher rule from KF) | **LOW** |
| 11 | **Vulkan backend** | KILLED (22/08, plugged-exploratory) | `supports_op` lies (declares SUPPORTED for K-quant shaders that crash on Adreno 740). `createComputePipeline ErrorUnknown` → SIGABRT on every K-quant pipeline. 242/242 f16 passes but all MoE pipelines abort. OpenCL with our kernels is the only working GPU path | If Qualcomm fixes Vulkan K-quant support on A7X (unlikely) | **LOW** |
| 12 | **LiteRT / TFLite GPU for small models** | CONDITIONAL PASS (11-12/08) | Gemma-4-E2B GPU ~26.8 vs CPU ~9.7 → **~2.8× PASS** (gate ≥1.15×). Qwen2.5-1.5B GPU ~18.7 vs CPU ~25.8 → **0.73× FAIL** (CPU already fast). Win exists for 2-3B class only. Kernel no-subgroup in fork: positive but conditional on product ROI | For Kalsa product: use if a 2-3B model is in the catalog; not relevant to research track | **MED** (product track) |
| 13 | **Expert fusion (9 → 3 wide matmuls)** | PARKED (08/07) | Idea: reduce dispatch overhead by grouping experts. Requires experts co-located in memory. Blocked on expert packing (H6/G3) which is itself original research | If expert packing is done AND dispatch overhead is measured > 20% of token time | **LOW** |
| 14 | **Expert packing on flash (H6/G3)** | PARKED — original research potential | Reorder experts in GGUF by co-activation to convert random reads to sequential. No published work does this for single-device. Would benefit both streaming and potential expert fusion | Feasible anytime (PC-side GGUF rewrite); gate: measure random vs sequential read delta for our expert size (0.942 MB) on UFS 3.1 — if seq/random > 2×, the work is worth it | **MED** |
| 15 | **Speculative CPU decoding (MTP/NextN on CPU+flash)** | KILLED by measurement (10/08) | F6 measure: cost C(4) ≈ 10-14 vs gate ≤2.2 → **3× slower than baseline**. Three independent failures: (a) CPU compute-bound (not memory-bound), (b) acceptance ~60% but scattering kills expert reuse, (c) byte-amortization 0.00%. Literature confirms: Nightjar/OpenInfer roofline, DFlash GPU-native, MoE-SpeQ/EcoSpec all say same | Only with a "regime change" — e.g. offloaded verify on NPU/GPU (owner directive #b) | **MED** (owner directive may revive a variant) |
| 16 | **Neuron pruning + healing LoRA on RunPod** | GATE CLOSED (10/08) | Trigger: k=6 must fail on KEXP. k=6 succeeded (+13.6% speed, PPL 1.852 < floor). Pruning and k=6 attack the same −25% GEMV term: free version won | Only if a future model requires > 8 active experts AND the router cannot be satisfied with k-reduction | **LOW** |
| 17 | **ZEDA-style distillation on RunPod** | PARKED (11/08) | Research-speed-pruning report: ZEDA 1.2×, TEAL 1.8× require training/kernel not in hand. Ceiling on our hardware: +7-15% per Amdahl. Pod RINVIATO (owner: +2-4% doesn't pay $50-120) | If speed plateaus below product target AND RunPod budget allocated for other reasons | **LOW** |
| 18 | **DraftExpert distillation** | PARKED (literature noted, no code) | arXiv:2607.24434: 1.45× with distilled draft experts, acceptance 84-87%. Paper without code. Implementation from scratch = expensive | If speculative decoding regime changes (e.g. NPU verify) AND code becomes available | **LOW** |
| 19 | **Drop-by-weight (skip expert compute on low-weight routes)** | KILLED by audit (11/08) | Source code audit: `router_hook.cpp:206-216` re-puncts dropped slot onto top expert → `mul_mat_id` computes it anyway. **Expert compute per token is INVARIANT to drop**. Drop only saves flash I/O on misses, which is already saturated (+13.6% came from k-change, not drop) | Never — architectural: the fork explicitly does not skip compute | **LOW** |
| 20 | **Top-p dynamic routing** | SIMULATED but NOT implemented (11/08) | Simulatable for free on route-traces before patching. Would skip experts with router probability < p threshold. Same audit problem as #19: if fork still computes the dropped expert, no gain | Same as #19 — only if fork changes to actually skip compute for dropped experts | **LOW** |
| 21 | **O_DIRECT I/O (kimi-k3-in-c inspired)** | DEPLOYED (22/08) | Borrowed from kimi-k3-in-c. Directly bypasses page cache. F5.2 proved page cache is wasted for expert streaming. O_DIRECT + per-range fallback implemented; 8/8 byte-identity PASS | Already shipped in engine | **HIGH** (active) |
| 22 | **CPU↔GPU thermal governor** | QUEUED (#24, design study) | Owner directive: start CPU (fast), if skin temp hits T1 switch to GPU cool-mode (−19% speed, −2.75°C on KEXP). llama.cpp can't migrate tensors at runtime → switch = reload. Need hysteresis + switch cost + J/token measurement | Design study first (paper), then prototype. Gate: cost of switch < 2 s | **MED** (design study, owner authorized) |
| 23 | **Multi-device matrix (S24/UFS 4.0, Pixel)** | PARKED (08/07) | S24/S25 have UFS 4.0 (~2× random read vs 3.1). Different thermal envelope. Strategy matrix from old plan still valid | After S23 baseline is fully characterized; test on one UFS 4.0 device | **LOW** |
| 24 | **Self-speculative decoding (F1)** | PARTIALLY IMPLEMENTED → STALLED | F1b: draft==gold 0.833 (k2 healthy), but live alpha = 0.08 vs 0.70 teacher-forced. Speedup 0.22×. Qwen Max diagnosis: 45% state corruption (prefix phantom), 30-35% batched-verify infidelity, <10% k2-weakness. G16 restore gate PASS on pure transformers. Blocked on verify-integrated-in-session (measured C(4) ≈ 10-14) | Blocked by #15 (speculative CPU cost); would reopen if verify runs on NPU/GPU | **MED** |
| 25 | **Mali GPU kernels (cheap-phone markets)** | QUEUED (#26, recon needed) | Owner 22/08: "market nobody exploits" (Africa/SEA). Paper arXiv 2410.03613: <3% ALU utilization on Mali with generic kernels — gap IS in the kernel, attackable. But decode remains memory-bound; Mali low-end has small ALU. Jelly = Mali-G57 available for recon | GATE: Jelly test-backend-ops + llama-bench Vulkan (and OpenCL, expected dead). If prefill within 3-5× theoretical → real path; if dead → close with number. Owner directive (a) | **HIGH** (owner directive) |
| 26 | **mllm-NPU (external codebase)** | KILLED by recon (18/08) | MIT license but does NOT include QNN (proprietary). Runs on Hexagon v75, not v73 (S23). MoE is CPU-only in their code. Target phones in README are 8 Elite (not our hardware). Loads pre-compiled context binary — cannot pass arbitrary weights | Never on v73; revisit only if v75+ hardware is available AND QNN API opens | **LOW** |

---

## Detailed Entries

### 1. NPU/HTP for MoE Decode — KILLED

**Where:** PLAN-archive.md §GPU/NPU recon (2026-08-06, lines 4387-4442); PLAN-archive.md recon silicio (18/08, lines 6099-6118).

**What it was:** Run the MoE decode loop on the Hexagon NPU (HTP) instead of CPU, exploiting the HTP's fixed-function matrix hardware for faster inference.

**Killed with evidence:**
- 0.67 MiB loaded on HTP: NOT a capacity limit but the result of quant type `Q4_K_M` being unsupported in the Hexagon backend (llama.cpp #22791, maintainer: "We do not support Q4_K_M in the Hexagon backend").
- Decode is DRAM-bound: Hexagon VTCM = 8 MB scratchpad, not VRAM; unified memory architecture means HTP competes with CPU for the same DRAM bandwidth.
- Third-party numbers (llama.cpp #23314): OnePlus 12, Qwen3.5-4B Q4_0 → CPU 11.43, OpenCL 8.44, **HTP 3.02 t/s**. Another run: CPU 9.1, OpenCL 9.4, HTP 8.9. Parity at best, never faster.
- PowerInfer-2 decode on NPU: 1.4-2.3 t/s (catastrophic).

**What changed since:** Nothing. The physics (DRAM-bound decode + unified memory) are immutable.

**Reopening criteria:** Never for decode.

**Priority: LOW** — but see entry #2 for the repurposed direction.

---

### 2. NPU/HTP for Compute-Bound SPIKES — PARKED → OWNER DIRECTION

**Where:** PLAN-archive.md recon silicio (18/08, lines 6127-6158); PLAN.md STATO CORRENTE "NPU (HTP)" paragraph; owner directive 22/08 evening.

**What it was (original):** Part of the NPU decode proposal. Killed alongside #1.

**What it became (owner 22/08):** "NPU never for decode, only for compute-bound SPIKES: TTFT/prefill of the prompt, embeddings in research mode, vision encoders, small draft models / classifiers. NPU as auxiliary coprocessor inside the MoE-streaming CPU engine."

**What changed since killing #1:**
- AI Hub (Qualcomm) numbers: **690 tok/s prefill** on ~50× CPU. Consistent: prefill is compute-bound (GEMM dominant), decode is memory-bound.
- mllm-NPU: **>1000 tok/s** prefill on Qwen1.5-1.8B, 7.3-18.4× CPU at prompt 1024.
- The 0.67 MiB load was a quant-mismatch artifact, not a capacity proof.
- Hexagon thermal already readable: `nspss-*` in sysfs.
- Owner idea (reopening S23): map only the dense weights (few hundred MB) on HTP once, stream experts on CPU as already done. FastRPC #137 (VA leak) avoided because dense are never unmapped. LFM2.5 dense (hybrid conv/SSM) must be verified as Hexagon-compatible ops.

**Reopening criteria (cheap gates):**
1. Verify that Q4_0 or IQ4_NL tensors load on Hexagon v73 (S23) — cheap: 30 min with a test binary.
2. Measure prefill tok/s on a supported quant for a small model (e.g. Qwen3.5-4B Q4_0) — 1 day.
3. Measure CPU↔HTP handover cost per layer — if < 0.5 ms, the per-layer split is viable.

**Priority: HIGH** (owner explicit directive).

---

### 3. AI-ISP for Images → Vision-Encoders-on-HTP — OWNER DIRECTION

**Where:** Owner directive 22/08 evening; PLAN-archive.md ISP recon (18/08, lines 6046-6087); EVA-NPU round 2 reports.

**What it was (original):** Use the phone's ISP for general compute on image tensors. Investigated as "AI-ISP."

**What it became:** The true ISP (Spectra/CHI) is a photographic pipeline router, not a compute engine (killed in recon). "AI-ISP for images" reinterpreted as running a **vision encoder** (CLIP, SigLIP, or similar) on the Hexagon HTP for multimodal capabilities in Kalsa.

**Evidence on file:**
- ISP Spectra / CHI: "extended nodes" dispatch to CPU/GPU/DSP, not ISP silicon. CHI is an orchestrator, not an engine.
- EVA/CVP: allow-list permits only DFS, optical flow, NCC, face detection — no GEMM. SELinux neverallow blocks app access.
- VENUS: encode-only API, no ME-only mode on Android.
- Vision encoder on HTP: **zero prior art found** — "nobody has done generic compute on a phone ISP" (the gap is real but the ISP is the wrong target; HTP is the right one).

**Reopening criteria:**
1. Identify a vision encoder that fits in < 8 MB VTCM with streaming weight access.
2. Verify the encoder's ops (attention, GELU, MatMul) are in the Hexagon backend's supported set.
3. Measure end-to-end prefill speedup vs CPU for a typical vision input.

**Priority: MED** (owner direction; needs a feasibility proof before investing time).

---

### 4-8. ISP / EVA / VENUS / HPB / Sensor-Hub — KILLED

All killed in the 18/08 recon with primary-source evidence (see entry #3 above). Summary:
- ISP Spectra: photographic router, not compute engine.
- EVA/CVP: fixed-function (face detection, optical flow), no GEMM. SELinux blocks.
- VENUS: video encode-only. No ME-only mode.
- UFS HPB: removed from mainline 2023, sysfs read-only, only helps 4 KB reads (we read ~1 MB).
- Sensor hub / DPU / modem DSP: no public compute API; modem cores programmed only by Qualcomm.

**Priority: all LOW, none reopenable.**

---

### 9. GPU OpenCL for MoE Offloading — KILLED → REVIVED → SHIPPED

**Where:** PLAN-archive.md 2026-08-06 (line 4387), 2026-08-09 (line 1369), 2026-08-19/20 (trans4 chapters), 2026-08-21 (K2, qk23), STATO CORRENTE.

**Story:** Initially killed 09/08 (K2: GDN/SSM ops missing on OpenCL; K5: OpenCL slower than CPU on same S23). Then the Adreno miscompile saga began: three E031 compiler bugs dissected (convert-READ, restore-READ, convert-WRITE) plus a fourth (K2: literal masks in `get_scale_min_k4`). All fixed. KEXP q2_K/q3_K kernels written from scratch (upstream has none for any GPU). **Result: 1.553× OLMoE SHIP (N≥5, audit BANK), 1.81× KEXP exploratory.** Vulkan remains dead on Adreno.

**What changed:** Everything. This is now a shipped result, not a proposal.

**Priority: HIGH** (active, shipped).

---

### 10. GPU Trunk-Dense Offloading — DEMOTED

**Where:** PLAN-archive.md line 4096; F5.2 profiler results (line 2538).

**What:** Move attention + shared expert (dense portion) to GPU via OpenCL, keep routed experts on CPU.

**Killed by profiling:** Experts GEMM = 54.5% of compute. Tronco dense = rest. But with compute only 0.116 s/token (bottleneck is I/O), freeing CPU cores from dense work gains almost nothing.

**Reopen gate:** stall% > 20% on a new device class (dispatcher rule from KF analysis).

**Priority: LOW.**

---

### 11. Vulkan Backend — KILLED

**Where:** PLAN.md session #15, 22/08 night. `results/vulkan_vs_opencl_s23/`.

**What:** Use Vulkan compute shaders for MoE expert execution on Adreno.

**Killed with evidence:** `supports_op` lies — declares SUPPORTED for K-quant pipelines that crash with `createComputePipeline ErrorUnknown` → SIGABRT. 242/242 f16 passes but all MoE K-quant pipelines abort. OpenCL with our fixed kernels is the only working GPU path (407/407).

**Reopening criteria:** Qualcomm fixes Vulkan K-quant on A7X driver (unlikely given they themselves prefer OpenCL).

**Priority: LOW.**

---

### 12. LiteRT / TFLite GPU — CONDITIONAL PASS

**Where:** PLAN-archive.md 2026-08-11/12 nottata tripla (line 865). Reports: `moe-litert-f0-f1.md`, `moe-litert-qwen.md`.

**What:** Use Google LiteRT-LM (TFLite successor) with GPU delegate for on-device inference.

**Results:**
- Gemma-4-E2B: GPU ~26.8 vs CPU ~9.7 → **~2.8× PASS** (gate ≥1.15×). Caveat: different models, wall includes UI prefill.
- Qwen2.5-1.5B: GPU ~18.7 vs CPU ~25.8 → **0.73× FAIL**. CPU already at ceiling for 1.5B.

**What changed:** Kernel no-subgroup in the LiteRT fork is promising but conditional on product ROI. OpenCL llama.cpp path remains dead for MoE.

**Reopen gate:** If Kalsa product catalog includes a 2-3B model where GPU delegate provides clear win.

**Priority: MED** (product track, not research track).

---

### 13. Expert Fusion (9 → 3 Wide MatMuls) — PARKED

**Where:** PLAN-archive.md line 4096.

**What:** Reduce per-expert dispatch overhead by fusing 3 routed experts into a single wider matmul.

**Blocked on:** Expert packing on flash (H6/G3) — experts must be co-located in memory first.

**Reopen gate:** Expert packing done AND dispatch overhead measured > 20% of token time.

**Priority: LOW.**

---

### 14. Expert Packing on Flash (H6/G3) — PARKED

**Where:** PLAN-archive.md §H6/G3 hypothesis; §6 ipotesi H6.

**What:** Rewrite GGUF to reorder experts by co-activation patterns, converting random reads to semi-sequential reads on flash. Listed as potentially original contribution ("no published work does this for single-device").

**What changed:** Random read on UFS 3.1 for ~1 MB blocks: ~370-410 MiB/s estimated (F2.1); sequential: ~1686 MB/s. If the ratio is > 2×, the work is justified.

**Reopen gate:** Measure actual random-vs-sequential delta for our expert size on UFS 3.1. If ratio > 2×, proceed. Feasible as a PC-side GGUF rewrite (no device work).

**Priority: MED.**

---

### 15. Speculative CPU Decoding (MTP/NextN on CPU+Flash) — KILLED BY MEASUREMENT

**Where:** PLAN-archive.md F6 (line 1715-1732); `reports/research/speculative-cpu-literature.md`.

**What:** Use draft models (MTP or external) to speculatively decode multiple tokens at once, reducing total I/O by amortizing expert loads.

**Killed with numbers:** Cost C(4) ≈ 10-14 vs gate ≤2.2 → **3× slower than baseline**. Three independent failures: (a) CPU is compute-bound on 3B active params (not memory-bound — speculative helps only memory-bound), (b) expert scattering kills cache hit-rate on speculative drafts, (c) byte-amortization between consecutive tokens = 0.00% on our trace.

**Literature confirms:** Nightjar/OpenInfer roofline shows CPU speculative only wins for < 3B dense, memory-bound, acceptance ≥ 60%, no scattering. We fail all three.

**Reopening criteria (owner direction #b):** Only if verify runs on NPU/GPU (making the compute-bound problem irrelevant) AND acceptance rate > 60% on MoE-specific draft patterns.

**Priority: MED** (owner's NPU-spike direction may revive a variant).

---

### 16. Neuron Pruning + Healing LoRA on RunPod — GATE CLOSED

**Where:** PLAN-archive.md 2026-08-10 (line 1160-1168).

**What:** Permanently remove a fraction of the 256 experts via pruning, then heal the model with LoRA fine-tuning on RunPod (8× H100, ~$1-3k). Would reduce both compute and I/O by the same fraction as k-reduction.

**Gate:** k=6 must fail on KEXP. k=6 succeeded → pruning and k-reduction attack the same −25% GEMV term; free version won.

**Reopen criteria:** A future model requires > 8 active experts AND k-reduction causes quality collapse on that model's task mix.

**Priority: LOW.**

---

### 17. ZEDA-Style Distillation on RunPod — PARKED

**Where:** PLAN-archive.md research-speed-pruning (line 1026-1033).

**What:** Distill a smaller expert set from the 256-expert model using ZEDA-style training on RunPod.

**Status:** Ceiling estimated at +7-15% by Amdahl on our hardware. RunPod RINVIATED (owner: +2-4% doesn't justify $50-120).

**Reopen gate:** Speed plateaus below product target AND RunPod budget allocated for other work.

**Priority: LOW.**

---

### 18. DraftExpert Distillation — PARKED

**Where:** PLAN-archive.md §3.3 table; line 777.

**What:** Per-layer distilled draft experts for self-speculative decoding (arXiv:2607.24434: 1.45×, acceptance 84-87%). Paper without code.

**Reopen gate:** Speculative regime changes (e.g. NPU verify) AND code becomes publicly available.

**Priority: LOW.**

---

### 19. Drop-by-Weight — KILLED BY AUDIT

**Where:** PLAN-archive.md 2026-08-11 audit (line 966-973).

**What:** Skip compute on experts with low router weight, even if they were selected (cache hits). Would save compute proportional to drop rate.

**Killed:** Source audit (`router_hook.cpp:206-216`): dropped slot is re-puncted onto top expert; `mul_mat_id` computes it regardless. **Expert compute per token is INVARIANT to drop.** Drop only saves flash I/O for cache misses, which is already saturated. The +13.6% speed of k=6 came from k-change (fewer experts), not drop.

**Reopening criteria:** Fork must change to actually skip compute for dropped experts. Architectural change, not a tuning parameter.

**Priority: LOW.**

---

### 20. Top-p Dynamic Routing — SIMULATED, NOT IMPLEMENTED

**Where:** PLAN-archive.md line 1017, 1031-1032.

**What:** Drop experts whose router probability falls below a dynamic p threshold. Simulatable for free on route-traces.

**Same problem as #19:** If the fork still computes the dropped expert, no gain. Simulation would show savings but implementation is blocked on the same architectural issue.

**Priority: LOW.**

---

### 21. O_DIRECT I/O — DEPLOYED

**Where:** PLAN-archive.md line 1984; F5.2 results. Inspired by kimi-k3-in-c (§3.3).

**What:** Bypass the page cache with `O_DIRECT` + `pread` for expert streaming, preventing cache pollution. Implemented with per-range fallback for alignment issues.

**Status:** 8/8 byte-identity PASS. Page cache proven wasteful (F5.2: cache evicts expert pages immediately). Already shipped in engine.

**Priority: HIGH** (active).

---

### 22. CPU↔GPU Thermal Governor — QUEUED (#24)

**Where:** PLAN.md queue #24; owner directive.

**What:** Start inference on CPU (fast), switch to GPU cool-mode (−19% speed, −2.75°C on KEXP) if skin temperature exceeds threshold T1. Requires hysteresis + measurement of switch cost (tensor migration = reload = seconds).

**Status:** Design study authorized by owner. Gate: switch cost < 2 s AND J/token comparison (race-to-idle hypothesis: "fast CPU ≈ same energy as slow GPU" must be measured, not assumed).

**Priority: MED** (design study, owner authorized).

---

### 23. Multi-Device Matrix (S24/UFS 4.0, Pixel) — PARKED

**Where:** PLAN-archive.md line 783.

**What:** Test the streaming engine on faster storage (UFS 4.0) and different SoCs.

**Status:** After S23 baseline is fully characterized. UFS 4.0 random read ~2× faster than 3.1.

**Priority: LOW.**

---

### 24. Self-Speculative Decoding — STALLED

**Where:** PLAN.md STATO CORRENTE, SELFSPEC section.

**What:** Run draft generation and verification in a single pass using the model's own MTP heads.

**Status:** F1b implemented: draft==gold 0.833 (k2 healthy). Live alpha = 0.08 vs 0.70 teacher-forced. Speedup 0.22×. Blocked on prefix-phantom corruption (45% per Qwen Max) and verify-integrated-in-session cost (C(4) ≈ 10-14, same as #15).

**Reopening criteria:** Blocked by #15 — if verify runs on NPU/GPU, the cost structure changes entirely.

**Priority: MED.**

---

### 25. Mali GPU Kernels (Cheap-Phone Markets) — QUEUED (#26)

**Where:** PLAN.md queue #26; `docs/research-adreno-vs-mali-8xx-2026-08.md`; owner directive 22/08 evening.

**What:** Write dedicated OpenCL/Vulkan kernels for Mali GPUs (G57, G78, G720) targeting cheap-phone markets (Africa, SEA) where MediaTek/Samsung dominate.

**Evidence on file:**
- arXiv 2410.03613: Mali-G720 Immortalis MP12 has ~1.5× the theoretical FP16 GFLOPS of Adreno 750, yet prefill is **5.3× slower** in practice. ALU utilization: **<3% on Mali vs ~20% on Adreno** with generic kernels. The gap IS in the kernel.
- Old Malis (G78): study had to shrink prompts from 64 to 32 tokens for usable data.
- Our A7X kernel work proves the approach (upstream disabled the GPU; we re-enabled it with minimal diffs).

**GATE (economic, before writing any kernel):** Jelly (Mali-G57) recon — test-backend-ops + llama-bench Vulkan (and OpenCL, expected dead). If prefill within 3-5× of theoretical → real path (dedicated Mali kernels); if dead → close with number.

**Priority: HIGH** (owner directive).

---

### 26. mllm-NPU (External Codebase) — KILLED

**Where:** PLAN-archive.md recon silicio round 2 (line 6147).

**What:** Use the mllm framework (UbiquitousLearning, MIT license) for NPU inference.

**Killed:** Does NOT include QNN (proprietary dependency). Runs on Hexagon v75, not v73 (S23). MoE is CPU-only in their code. Target phones are 8 Elite. Loads pre-compiled context binary — cannot pass arbitrary weights at runtime.

**Priority: LOW.**

---

## Sources Swept

- [x] PLAN-archive.md (8617 lines — full sweep of NPU/HTP/ISP/image/vision/spike/proposta keywords)
- [x] PLAN.md (1736 lines — queue items, STATO CORRENTE, owner directives)
- [x] docs/ALIVE.md
- [x] docs/ENGINE.md
- [x] docs/research-adreno-vs-mali-8xx-2026-08.md
- [x] Keyword grep: NPU, HTP, Hexagon, QNN, ISP, image, vision, camera, DSP, NNAPI, LiteRT, TFLite, proposta, pazza, esotic, spike, crazy, exotic, co-process

---

## Positioning Relative to Owner's Three Directions (22/08 evening)

| Owner Direction | Ideas Affected | Status |
|---|---|---|
| **(a) Mali kernels for cheap-phone markets** | #25 (Mali kernels) | Queue #26, gate = Jelly recon. HIGH. |
| **(b) NPU for compute-bound SPIKES** (never decode) | #1 (decode — dead), #2 (spikes — alive), #15 (speculative — may revive), #24 (self-spec — may revive) | #2 is the active direction: HIGH. #15/#24 reopen only if NPU verify is proven. |
| **(c) AI-ISP → vision-encoders-on-HTP** | #3 (vision encoders on HTP), #4-8 (true ISP — dead) | #3 is the active direction: MED (needs feasibility proof). #4-8 permanently dead. |
