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
