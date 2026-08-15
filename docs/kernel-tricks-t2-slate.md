# Trick slate T2 — round 2 (bio-derived combinations) — 2026-08-15 night

Owner steering after round 1: think outside the box; steal from
biology; if it feels like a "built thing" you remember, it exists —
COMBINE your own notions instead. Round 1 (lossy tier / similarity
fold / dynamic k) all died to prior art (HOBBIT, DyMoE, DynaExq, SMoE,
MC-SMoE, AdapMoE, Elastic MoE — see t2-novelty report). The occupied
map itself became the input for round 2.

## Round 2 candidates

### T2-K — "Chaperones" — tiered JIT for weights ⭐ spike candidate
Bio: chaperone proteins fold clients asynchronously, off the synthesis
path. CS twin: JVM tiered compilation (interpreter -> JIT for hot code).
Mechanism: cache entries start in stock Q4_K layout (interpreter);
a background folder repacks HOT entries to the 8x8 i8mm layout
(S3b measured: GEMV 389us vs 495us host = x1.27) ONLY when io-threads
idle, priority by hit counters. S3's insert-repack kill does not apply:
zero cost on the critical path, folding amortized over an entry's hot
life. Ceiling on the certified Mellum cell (82% compute): ~+17% wall.
- Kill criteria: folded-entry hit-share < 50% (folding lags the working
  set); repack throughput < eviction churn; G15-class identity breaks
  (repack is layout-only — identity class known from S2/S3 gates).
- PC-testable: yes (engine change moderate; host cell measurable).

### T2-L — "Autophagy" — memory-pressure self-cannibalization
Bio: under starvation the cell digests non-vital components to protect
vital ones. Mechanism: the engine self-monitors majflt/swap deltas (the
zram sentinel that exposed the 60-100x stock collapse); when pressure
rises it SHRINKS ITS OWN CACHE and re-pins dense weights (madvise/
mlock priority inversion) before the OS swaps the heart to keep the
fat. Derived from OUR 2026-08-14 zram discovery; papers never touch
OS-pressure interplay (they live on servers).
- Kill criteria: sentinel can't detect early enough (collapse faster
  than the loop); cache shrink hurts more than swap (measure the
  crossover).
- Product-hardening value even if "novelty" is judged systems-craft.

### T2-M — "REM sleep" — nightly self-reorganization per user
Bio: sleep consolidation + synaptic pruning. Mechanism: while charging
and idle (the phone's night), replay the day's routing telemetry and
METABOLIZE the local model: demote never-used experts to Q2 on disk,
cluster co-activated experts adjacently (sequential UFS reads), refresh
cache priors — guarded by an ON-DEVICE micro-PPL gate (our gate
discipline, miniaturized). Every phone's model slowly takes its
owner's shape. Privacy-perfect (nothing leaves the device).
- Enabler probe (PC, tonight): does per-conversation/per-user expert
  usage SKEW exist? predict_log on Marco/Mellum across different
  prompt domains -> usage histograms, Gini, overlap across domains.
  No skew -> T2-M dies cheaply.
- Kill criteria: skew Gini < ~0.3 (uniform usage); micro-PPL gate too
  expensive on device; rewrite wear on flash unacceptable.

### Kill tally (updated 2026-08-15 ~02:00)
- T2-B similarity fold: **DEAD BY PHYSICS** — simprobe on Mellum2 AND
  Qwen35: experts are near-orthogonal (max off-diag cos 0.02 / 0.14 vs
  threshold 0.95, ZERO pairs, multiplier 1.00 everywhere; cross-layer
  baseline same order). 8 minutes of compute killed it forever.
- T2-J/D closed-loop prefetch controller: NEAR-DUP — ExpertFlow (Shen
  2025, arXiv:2510.26730) closes the same loop (stall counter -> widen
  S, overfetch counter -> narrow S, occupancy backpressure). Our
  lead-time sensors are richer but the loop is occupied. STILL the
  right ENGINEERING fix for our stutter (validated approach, no novelty
  claim).
- T2-E co-activation flash layout: NEAR-DUP(Apple) LOUDLY —
  LLM-in-a-Flash §3.2 tried exactly this at neuron level, published the
  hub-neuron FAILURE mode, shipped row-column bundling instead.

### Round-2 novelty checks in flight
- T2-J closed-loop prefetch controller on lead-time telemetry (round-1.5,
  report2 pending) + T2-E co-activation flash layout (Apple patent
  proximity check pending) — both feed T2-K/T2-M tooling regardless.

## Round 1 postmortem (kept for the record)
A (lossy demotion cache) = HOBBIT/DyMoE/DynaExq. B (similarity fold) =
SMoE + MC-SMoE + Cache-Conditional. C (entropy-gated k) = AdapMoE
(decrease-only) and Elastic MoE showed increase-k degrades. Full
citations in scratchpad t2-novelty/report.md — bank a copy in
docs/ if any candidate graduates.
