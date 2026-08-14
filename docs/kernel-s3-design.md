# Kernel S3 — repack-aware fused MoE FFN: coordinator design note

Date: 2026-08-14. Status: S3 grok in flight (diagnose-first mandate); this
note is the coordinator's design analysis, written for (a) steering the S3
iteration when Phase 0 lands, (b) the hostile review, (c) the record.

## Where S2 actually lost (three candidate mechanisms, ranked)

S2 measured: fused ON slower than stock OFF by ~+0.010 s/tok at t2 on both
k6d065 and k6d10 (S23, Mellum2). The naive reading was "stock uses REPACK
kernels, fused bypasses them". That reading has a hole: **streamed experts
almost certainly bypass REPACK in stock too** — llama.cpp's aarch64 REPACK
happens at load into the CPU extra buffer; BigMoeOnEdge streams expert
bytes from flash into its own cache in raw GGUF layout, and the stock
mul_mat_id loop reads them via the expert-ready hook. If Phase 0 confirms
this, stock and S2-fused run the SAME per-row vec_dot on the SAME bytes,
and the regression must come from the fused kernel's own structure:

1. **Phase D access pattern (prime suspect).** Fused D steals over n_embd
   output rows; for each row j it does k vec_dots touching row j of k
   DIFFERENT down matrices — striding across 8 large weight buffers per
   output row. Stock processes expert-by-expert: each down matrix is read
   sequentially once (hardware prefetcher friendly, DRAM-burst friendly).
   Down is Q8_0/Q5_0 and K0 showed it already at the DRAM ceiling
   (53.5 GB/s) — precisely the regime where access pattern is everything.
   A ~20% loss on the down third of GEMV time ≈ the observed +0.010.
2. **REPACK delta on gate/up (the real S3 upside, via cache).** K0
   measured Q4_K fused GEMV at 39 GB/s — NOT at the ~53 GB/s ceiling, so
   better microkernels have ~25-35% headroom on gate/up (2/3 of expert
   FLOPs). Neither stock nor fused gets this today for streamed experts.
   The lever is the K0 design's original idea: **repack at cache-insert**
   — one-time repack per cache fill (Q4_K → interleaved 8-row layout),
   amortized by ~88% hit at d1.0; both paths then consume repacked bytes.
3. **i8mm is OFF in the S23 build** (armv8.2-a+dotprod target;
   HAVE_MATMUL_INT8 failed). S23 cores (X3/A715/A510) support i8mm
   (armv8.6 feature). A `armv8.6-a+i8mm` build arm unlocks the mmla
   repack kernels — potentially the single cheapest win in the whole
   lane. Must stay a SEPARATE binary (campaign pin untouched) and be
   measured as its own A/B arm (build-flag lever, same class as REPACK).

## Design consequences

- **Fix D first, it is free**: restructure phase D expert-major, two-pass
  (D1: per-slot GEMV into k scratch columns, expert-sequential like
  stock; D2: tiny weighted reduce). This alone should erase the S2
  regression; the remaining fusion value = fewer activation quantizes +
  single launch.
- **Repack-at-cache-insert** is the substantive S3: cache stores experts
  in repacked layout; fused B/D (and, if exposed as a repacked ggml type,
  even the stock path) call the repack gemv kernels. Insert cost is paid
  on miss only (12% at d1.0); hit path gets the faster kernel with zero
  per-token overhead. Geometry stays runtime-read.
- **The i8mm build arm rides along** in every A/B: {dotprod, i8mm} ×
  {stock, S3} is a 2×2 that separates build-flag gains from kernel gains
  honestly.
- Down stays UNPACKED (K0: Q8_0/Q5_0 already at DRAM ceiling — do not
  spend insert cost where there is no kernel headroom); repack applies to
  Q4_K gate/up only.

## Honest ceiling

t2 compute 0.148 (k6d10 stock): if GEMV gate/up is ~0.06-0.07 of it,
+30% kernel gives ~0.02; D-fix recovers the S2 +0.010 relative to fused;
i8mm adds an unknown (measure). Realistic landing zone: **0.125-0.135
s/tok → PASS band (≤0.14)**; wall from 5.15 toward ~5.6-6.0. The 7-9
wall still requires the flash side (overlap/regime), not this kernel
alone — say so plainly in the phase report.

## Correctness policy (from S2's arc)

ON-vs-OFF token drift = expected deterministic reorder (documented);
gates are: NMSE 5e-4 per-op, ON==ON determinism, and (new for adoption)
the PPL quality gate on the target config — same discipline as d1.0.
