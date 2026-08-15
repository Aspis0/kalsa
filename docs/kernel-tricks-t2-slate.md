# Trick slate T2 — "crazy but physical" candidates (owner mandate 2026-08-15 night)

Owner mandate: invent NEW tricks nobody has even tried (web-verified),
grounded in our measured physics. Generate many, kill fast on PC.

## The measured facts any new trick must exploit

- F1: **Re-read waste is huge**: 45.6 re-reads/token on S23 k8, 55.3 on
  Xiaomi — "bytes the cache had already paid for once". The cache
  thrashes; flash re-pays constantly.
- F2: **Drop is quality-certified**: d0.65 PASSES the PPL gate (even
  BEATS the k8 anchor) and d1.0 passes. The marginal (low-router-weight)
  experts contribute almost nothing — we already ship configs that
  DELETE them entirely.
- F3: **Compute-bound flagship regime**: certified Mellum k6d1.0 is 82%
  compute (0.175/0.213). S3b measured REPACK 8x8 GEMV x1.27 vs stock —
  unreachable for streamed experts at insert-time (S3 kill), but the
  kill was about *when/where to repack*, not the GEMV win itself.
- F4: **Prefetch pays only where stall>20%** (K-F law); on fast flash
  the bottleneck moves to compute and cache capacity.
- F5: **Thermal ceiling flattens everyone** on small silicon: sustained
  regime converges to ~2.5 tok/s regardless of trick (sweep).
- F6: Router weights are INFORMATION available before serving each
  expert (topk + weights known at route time).

## Candidates

### T2-A — Two-tier LOSSY expert cache ("demote, don't evict") ⭐ primary
On eviction, do not discard: re-quantize the expert Q4_K -> Q2_K-class
into a second RAM tier (~2.5-3x denser). On next access, serve from:
full tier if present; LOSSY tier if the ROUTER WEIGHT for this expert
is below a threshold (F2: those experts barely matter — we already
drop them at d0.65!); flash re-read only when a HIGH-weight expert
misses both tiers. Router-weight-conditioned precision serving.
- Physics: converts F1's 45 re-reads/token into RAM hits; capacity of
  tier-2 ~3x; quality knob is strictly gentler than drop (a 2-bit
  expert >> a deleted expert), and drop is already gated PASS.
- Cost: one Q4K->Q2K requant per eviction (io-threads are idle between
  bursts; async).
- Kill criteria: (a) requant cost/expert > eviction rate budget;
  (b) PPL gate fails even at weight-threshold = drop-threshold (would
  contradict F2 — unlikely); (c) hit% gain < 10 points.
- Novelty to verify: EdgeMoE does STATIC per-expert bitwidth offline;
  AdapMoE does skip-on-miss; MoE-Infinity/Fiddler do offload orchestration.
  A DYNAMIC demotion cache with router-weight-conditional tier serving
  at inference — believed untried. WEB-CHECK REQUIRED.

### T2-B — Expert similarity folding (cache-side dedup) — cheap probe first
If experts within a layer are redundant (common post-training), cluster
them; cache ONE representative per cluster; serve near-duplicates from
the representative (optionally + low-rank delta). Cache capacity
multiplies by the clustering factor.
- Decisive PC probe (~1h, pure python): read Mellum2/Marco GGUF expert
  tensors, pairwise cosine/JSD per layer. No structure -> DEAD tonight.
- Novelty: expert MERGING exists offline (MC-SMoE etc.) as model
  compression; as a runtime CACHE policy keyed by similarity groups —
  believed untried. WEB-CHECK REQUIRED.

### T2-C — Entropy-gated dynamic k (confidence-adaptive routing width)
Per token, choose k from router entropy: confident -> k=2, uncertain ->
k=8. Static k2 is garbage (F1c) but dynamic-k2-when-confident is a
different animal; IO and compute both scale with k.
- Cheap probe: --predict-log already dumps router data -> offline
  analysis: what % of tokens are "confident" and what would quality-
  proxy do. No engine change for the upper bound.
- Novelty: top-p/dynamic routing exists in TRAINING literature and some
  inference papers; in an on-device streaming engine where k drives
  FLASH IO — believed untried as a product lever. WEB-CHECK REQUIRED.
- Risk: quality gate; k-mix in context proved toxic for selfspec state
  (E2) but normal decode has no rewind so hparams k-switch per token is
  the same mechanism the engine already uses for diag — needs care.

### T2-D — Thermal pacing ("race-to-knee"): deliberately cap early-burst
speed to stay under the throttle knee; sustained median rises (F5 shows
greedy ON sags 0.35 vs OFF 0.23). Scheduler trick, sustained-regime
only; product regime is bursts — park unless a long-form SKU appears.

### T2-E — Persistent repacked expert store (REPACK resurrection):
one-time offline conversion of expert tensors to the 8x8 layout on
flash; streamed reads land already-repacked (S3b x1.27 GEMV, i8mm
reachable). On the 82%-compute certified cell, ceiling ~ +17% wall.
- Not "never tried by anyone" in spirit (file-layout variants existed
  in llama.cpp as Q4_0_8_8 file types, deprecated) — park as a KNOWN
  lever with new evidence, not a T2 novelty candidate.

## Tonight's execution

1. Novelty web-sweep (Grok, web search): T2-A, T2-B, T2-C against
   EdgeMoE / AdapMoE / MoE-Infinity / Fiddler / PreScope / ActiveFlow /
   llama.cpp PRs/issues / SwapMoE / HOBBIT / Mixtral-offloading / any
   2024-2026 arXiv. Verdict per candidate: NOVEL / NEAR-DUPLICATE(who) /
   KNOWN.
2. T2-B probe on PC: expert similarity structure of Mellum2 (python,
   gguf reader, numpy). Structure or death by morning.
3. T2-C probe if predict-log data exists or is cheap to produce on PC.
4. T2-A: design doc + engine touch-point analysis (no code tonight);
   spike tomorrow if the web-check clears it.
