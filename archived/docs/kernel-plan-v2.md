# Kalsa Kernel Plan v2 — post-audit synthesis

Date: 2026-08-14. Supersedes v1 (`kernel-plan-v1.md`, kept for the record).
Inputs: hostile audits by Qwen 3.8 Max and GPT Terra 5.6 (both in `docs/`,
verbatim). This version adopts every point where the two auditors
CONVERGED, adopts GPT's product framing, and keeps v1's ground-truth
tables by reference (they were not disputed — both audits accepted the
measurements).

## 0. Audit triage

| finding | Qwen | GPT | v2 action |
|---|---|---|---|
| Target S23 ≥7 t/s unsupported by any funded workstream (~36% gap from 5.151) | ✔ (attack 5) | ✔ (first "non si salva") | **ADOPTED** — §2 reconciliation, owner decision required |
| "CPU speed CLOSED" overclaimed | ✔ (don't make L1 a law of physics) | ✔ (rewrite as regime-scoped) | **ADOPTED** — closure language now: *"no path with >10% upside demonstrated for this geometry/SoC/threading regime (3 kernel families measured)"* |
| K-E not an energy thesis without a real power protocol | ✔ (idle subtraction, p95, soak, rail) | ✔ (−21% CPU-time ⇏ fewer J) | **ADOPTED** — running cell demoted to SCREENING; confirmatory protocol in §3.1 |
| K-G: 1.29× is not a spendable budget until CPU↔GPU boundaries are measured end-to-end (copies, fences, layout conversions — not dispatch counts) | ✔ (hybrid sync risk) | ✔ (sharper: prototype = 2 boundaries + 1 full prefill layer chain) | **ADOPTED** — GPT's prototype IS the new M2 gate; "2-week stages" contradiction with the M1 "months" post-mortem removed |
| K-F imprecise: cross-token expert prefetch is SPECULATION (can't know next token's experts) → metrics are prefetch precision / cache pollution / wasted bytes | — | ✔ | **ADOPTED** — §3.3 splits the two modes: within-token layer-ahead (deterministic once layer l's hidden exists) vs cross-token (speculative) |
| K-A is config management, not kernel — do it, but don't let it consume the kernel identity | ✔ | ✔ | **ADOPTED** — K-A becomes the *dispatch layer inside* the kernel library (see §1), not a standalone "kernel" claim |
| The real asset is K-N + harness, as EXECUTABLE infra, not a doc | ✔ (fascia A) | ✔ ("registry, microbench, oracle, raw logs, regressioni") | **ADOPTED** — §3.4 |
| Identity: "your kernel is the layer" (Qwen) vs "build the LIBRARY with an ABI" (GPT) | layer | library | **GPT's frame ADOPTED as the product** (it answers the owner's ask literally); Qwen's list defines what goes inside it |

Both audits independently endorsed: streaming cache as the defensible
core, Q6_K fix as credibility precedent, S1/S2 substrate kept as asset
not roadmap, and the entire fascia-D closure list (GPU decode A7X,
cache-insert repack, REPACK 8x4, compression-in-cache, sub-4-bit on weak
cores, prunes-for-speed). Unchanged from v1.

## 1. The product: **Kalsa Kernel** (library, not aspiration)

A C/C++ layer with a stable ABI for streamed quantized MoE:

- **Primitives**: expert `mul_mat_id` / expert GEMV-GEMM, dequant,
  routing/layout transforms. Each primitive ships with a CONTRACT:
  supported shapes/quants, correctness oracle (NMSE vs `use_ref` +
  greedy determinism policy), fallback path, and a perf budget per
  device class.
- **CPU backend**: NEON dotprod + i8mm implementations behind a
  shape/SoC dispatcher. The dispatcher IS the autotune (ex-K-A):
  first-launch micro-bench, per-device cached config (threads/k/drop/
  impl-choice). The per-SoC U-curves we already measured are its seed
  data.
- **GPU backend (OpenCL)**: only for subgraphs that stay resident on
  GPU with measured boundaries — admitted per §3.2's gate, never before.
- **Runtime hooks** (expert-ready, cache, prefetch): consumers of the
  kernel, packaged separately (GPT's separation, Qwen's "layer").
- **CI**: versioned bench + correctness runs keyed by (model, quant,
  shape, device, temperature, commit). The S3b matrix + S2 adversarial
  harness + Phase-0 honesty gates become the CI content.

**Kernel #1 = streamed `mul_mat_id`.** Today's champion implementation is
the stock vec_dot path (it beat our three challengers — that is a valid
outcome: the contract's first budget is the measured floor, 0.148 s/tok
at t2 on SD8Gen2 for the Mellum geometry). S1/S2/i8mm live behind the
same contract as alternative impls the dispatcher may select on other
silicon (S1 fused won 2.58× at t8; i8mm wins per-op). Day-zero work on a
new arch = adding a primitive or an impl behind an existing contract.

## 2. Target reconciliation (owner decision required)

Measured: k6d10 t2 wall = **5.151** tok/s; compute floor 0.148 s/tok →
ideal ceiling ~6.75 even with flash at zero. Therefore:

- **≥7 (stretch 9) on S23 big-tier via CPU kernels: not supported by any
  measured path.** The honest options:
  a. **Self-speculation** (F1b diagnosis in flight): batch-verify
     amortizes flash I/O — the only measured-mechanism candidate that
     attacks wall, not compute. If F1b revives alpha, the 7 t/s path is
     selfspec, not kernels.
  b. Re-scope the 7-9 ambition to flagship/8-Elite-class (where 10.57 is
     already real) and accept **5.1-6 as the S23 big-tier number**.
  c. Serve a smaller tier on S23 (dense 2B = 15.9 measured).
- The kernel library's value is then: floors defended by contract,
  day-zero speed on new archs, thermal (if K-E survives), TTFT (if K-G
  survives) — none of which promises 7 on S23 big-tier.

**RESOLVED (owner, 2026-08-14):** option (b) accepted for big MoEs —
**S23-class big-tier = 5-6 tok/s** (Mellum2/Marco/CalaQwen); the 7-9
ambition moves to flagship/residency tiers; small Qwens stay fast
everywhere (2B = 15.9 measured on S23, resident on any RAM). Selfspec
(§2a) remains the only candidate that could revisit this — pending F1b.

**Tier doctrine (owner Q, same date):** same SoC ≠ same tier. Tiers are
a matrix of compute-class × measured RAM budget: more RAM at equal
silicon shifts big MoEs toward residency (miss→0 removes the flash term
from wall — Mellum 5.15 → ~6.5-6.75 ceiling; Marco's 46% miss traffic
evaporates; CalaQwen becomes admissible resident at 24 GB); less RAM
degrades hit% and admissibility. Small models cluster by SoC alone. The
dispatcher's first-launch probe (compute + RAM budget + sustained) — not
the spec sheet — assigns the tier. Cheap falsification test when
available: S23 Ultra (same 8Gen2, 12 GB) — resident Marco vs our
streamed 8.82.

## 3. Workstreams (re-gated per audit)

### 3.1 K-E thermal — screening now, confirmatory protocol defined

Running cell = SCREENING only (current_avg sampling). If it shows ANY
signal (CPU-time/token −10%+ or late-rep sustained delta), the
confirmatory cell runs the auditors' protocol: idle-power baseline
subtracted, identical token sequences, controlled initial thermal state
(soak windows), governor/pinning recorded, 5-10 min sustained per arm,
median + p95 + variance, J/token = ∫P dt / N with sampling limits
declared. Kill stands: no energy/thermal dividend → archive.

### 3.2 K-G GPU prefill — boundary prototype BEFORE any executor

Replaces v1's M2-carta+stages. One prototype, one question: **does ≥1.3×
survive the boundaries?** Measure end-to-end on device: (1) CPU→GPU
activation upload + layout conversion, (2) GPU→CPU return before expert
FFN, (3) one full prefill layer chain (attn+dense on GPU, expert on CPU)
with fences — wall and J. The M1 lesson (60 ms/tok glue) and the
"months, not weeks" executor estimate are accepted: no executor work
until the prototype proves the budget. If expert-FFN dominates prefill
time, kill early (measure that fraction first — it is one profile run).

### 3.3 K-F prefetch — two modes, correct metrics

- **Layer-ahead (within token)**: experts of layer l+1 are KNOWN once
  layer l's hidden exists (router is per-layer). Deterministic overlap of
  I/O for l+1 with compute of l. Metric: I/O stall reduction. Cheap cell.
- **Cross-token**: speculative; primary metrics are prefetch PRECISION,
  cache pollution, wasted bytes (GPT) — I/O stall alone is insufficient.
  Only worth measuring on Marco-class/mid-silicon where flash s/tok ≫
  compute. Kill: stall <10% of token time or precision too low to pay.

### 3.4 K-N — executable infrastructure, not a document

Deliverable is a runnable kit: shape registry, microbench runner (S3b
generalized), correctness oracles, raw-log conventions, perf-regression
CI, convert pipeline. Definition of done: a new architecture can be taken
from HF drop to "measured + fast-or-triaged" by one engineer in ≤2 days
using only the kit. The playbook doc is the kit's README, not the
deliverable.

## 4. Funding tiers (Qwen's fasce, GPT-adjusted)

- **A (fund now)**: Kalsa Kernel library skeleton (contracts + dispatcher
  + CI packaging of existing assets) · K-N kit · streaming cache
  hardening/telemetry.
- **B (gated)**: K-E (screening → confirmatory) · K-G (boundary
  prototype) · K-F (layer-ahead cell first).
- **C (asset, not roadmap)**: S1/S2 fused substrate (PR-able) · Q6_K fix
  precedent.
- **D (closed, regime-scoped)**: CPU speed hunting on SD8Gen2/t2/Mellum
  geometry · GPU decode A7X · cache-insert repack · REPACK 8x4 streamed ·
  compression-in-cache · sub-4-bit-on-weak-cores as universal lever ·
  prunes-for-speed.

## 5. Sequencing (scales no longer mixed)

| when | what | exit |
|---|---|---|
| now (running) | K-E screening on S23 | signal? → confirmatory; else archive |
| this week | Library skeleton: contract for kernel #1 + dispatcher seeded with U-curve data + CI packaging | new-arch onboarding usable |
| this week | K-G boundary prototype (1 profile run + 2 boundary measurements) | ≥1.3× survives → staged plan (own doc, months-honest); else kill |
| next | K-F layer-ahead cell on Marco-class/mid silicon | stall −X% measured or kill |
| standing | K-N kit hardening; selfspec owns the 7 t/s question (§2a) | — |

## 6. State update (2026-08-14, post-funnel — supersedes §3/§5 rows)

The funnel ran. Outcomes, with evidence in `reports/` and PLAN checkpoints:

- **K-E: DEAD (KE_NULL).** i8mm never executes in the real engine — mmla
  kernels live only in the REPACK path that streamed experts bypass
  (`use_extra_bufts=false` is load-bearing). Decode deltas were noise;
  the −6.3% cpu-time was an n_gen artifact. Kill criterion honored.
- **K-G: DEAD (KG_KILL).** The "1.29× GPU prefill" was a cold-outlier
  mean; honest p512 is 1.12–1.15×, hybrid 1.07×, boundary cost 0.068
  ms/tok (not the bottleneck). No executor was ever built. §3.2 closed.
- **K-F: ALIVE → prototype LANDED.** Stall measured at 37.3% of wall on
  Marco-Jelly (wall = compute + mgmt + stall closes at the ms), derived
  from existing logs at zero device-minutes. Issue-only layer-ahead
  implemented as `--kf-prefetch` on `kalsa/kf-layer-ahead` (@ `c3e8fc4`:
  feat + tests + docs + 2 review fixes). Hostile review: 4 contract
  claims CONFIRMED (issue-only single call site; byte-identity with drop
  OFF; off-by-default allocation-free; exclusivity validated), races/
  leaks/lifecycle REFUTED. Key caveat (F2): byte-identity does NOT hold
  under `--drop-cold-experts` (residency feeds `apply_drop`) — identity
  is gated at drop 0; d065 text divergence is expected and informational.
  **ABBA A/B running on Jelly now** (2+2 + hot + identity-d0 pair).
- **Library (§1): BUILT.** Contract #1 (streamed mul_mat_id: NMSE 5e-4,
  determinism classes, measured floors as budgets), dispatcher
  (SoC × RAM × geometry → threads/k/drop/impl, default OFF, user flags
  win), keyed CI. Hostile review closed 10/10, ctest green. Lives in
  `kalsa-engine/` (BigMoeOnEdge decommissioned by owner directive).
- **Quality gate: PASSED.** PPL k6d1.0 dMacro +0.0378 / worst fr +0.0877
  → 5.151 t/s is the certified Mellum2-S23 product config. Remaining
  arms (k6d065, k4d0) in flight.
- **Ship criterion: PRE-REGISTERED AND RUNNING.** Owner decision: paired
  ABBA, declared-first metrics (median wall, sustained late-rep, J/token,
  temp, TTFT), Wilcoxon + effect size + p-value. PREREG at
  `results/kernel_ship_ab_s23/PREREG.md`; 12-pair config-only A/B
  (stock t4/k8/no-drop vs certified t2/k6/d1.0) running on S23 with the
  campaign cell binary. K-F is deliberately excluded (factor isolation).
- **Tier doctrine (§2): resolved in PLAN** — tiers = SoC × measured RAM
  matrix, dispatcher first-launch probe assigns the tier; big-MoE target
  on S23-class accepted at 5–6 t/s.

## 7. Related work — bibliography (added 2026-08-14)

Everyone hides memory latency behind compute; none of these combine
single-phone + MoE-native expert selection + byte-identity + zero
per-model training. Positioning per source:

1. **PRESERVE** — arXiv:2501.08192. Prefetch of weights/KV into on-chip
   caches during inter-device communication, GPU/NPU clusters. Hides
   *network* latency in datacenters; dense serving. Different universe
   from flash-on-phone.
2. **PreScope** — arXiv:2509.23638. Closest technical relative: MoE
   expert prefetch with a *trained* next-layer predictor (LLaPor, >90%
   top-4), cross-layer scheduling, async PCIe I/O on V100/A100. Diff:
   per-model trained NN predictor vs our reuse of the model's own gate
   weights (zero training = day-zero); PCIe offload vs UFS flash; no
   phone constraints (thermal/battery/dispatcher).
3. **AirLLM** — github.com/lyogavin/airllm. Capacity play: layer-/
   expert-at-a-time streaming to fit huge models in tiny VRAM; accepts
   disk-bound speed. We start from the same streaming premise but the
   whole kernel program is making it *fast enough to ship* on a phone.
4. **prima.cpp** — github.com/OpenCPIL/prima.cpp. Orthogonal axis:
   piped-ring parallelism across multiple home devices, OS-advise
   prefetch of the (deterministically known) next dense layer. No MoE —
   no expert-selection problem, which is exactly where our prefetch
   lives. We make one phone self-sufficient instead of adding devices.
5. **ActiveFlow** — arXiv:2504.08378. Closest on-device relative:
   DRAM↔flash active-weight swapping on mobile with cross-layer
   preloading. Diff: relies on contextual sparsity + *sparsity-aware
   distillation* — the model is retrained and outputs change; we are
   byte-identical, model untouched, no per-model pipeline.
6. **Intel, US20240370699A1** — "Data pre-fetch for LLM processing".
   Processor circuitry + staging buffer prefetching the *deterministic*
   next layer's weights/KV on server-class parts; OS-driver scope; no
   flash, no expert selection. IP awareness: generic prefetch is dense
   prior-art territory; our defensible ground is *which bytes* (router-
   native expert ranking) and the issue-only identity contract, not
   prefetching per se.
