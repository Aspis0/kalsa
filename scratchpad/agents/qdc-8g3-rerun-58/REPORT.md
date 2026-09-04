# REPORT — Cell #58: 750 re-run with the split preregistered (closes the #55 Amendment)

Date: 2026-09-03 night (owner full delegation). QDC job 798429 (`sa802498`),
device `7b5f6c52`, QRD8650 (Snapdragon 8 Gen 3 / Adreno 750). Running
20:56:06 → Completed 21:04:48 EDT (portal-verified, ref-click End + reload) =
**~8.7 min billed**. Driver 20:58:35 → 21:03:38 (raw/, /tmp/cell58.log), three
arms, zero PRE-gate retries (all snapshots GATE_PASS), zero relaunches.
PREREG.md in this folder was written and audited (AUDIT-PRERUN.md, F15
applied) BEFORE the session was created.

## Materials (device-verified)

gov-kit `5c3979438` (SHA256SUMS all OK), ship model LFM2.5-2.6B QAD-Q4_0
`a247afd6…` sha OK on device, CPU_MASK `f0` (cpu4-7), nproc 8 — identical to
#55.

## Grid outcomes

- **G1 — MUL_MAT census: 905/925, 20 FAIL, all in the preregistered family**
  (raw/tbo_mm_sa802498.out): `type_a∈{f16,bf16} × type_b=f32, m=128, n=1,
  k=1056, k_v=2112`, 10 f16 + 10 bf16, batch shapes bs ∈ {[1,3],[2,1],[2,3],
  [4,1],[4,3],[8,1],[8,3]}. `diff` of the sorted failing-case lines against
  #55's raw: **IDENTICAL** (0 differences). Preregistered expected outcome →
  no quarantine of the quantized bench lanes. (Note: the PREREG's shorthand
  "bs=[2..8]×[1,3]" under-described the set — bs=[1,3] is in it, as it was in
  #55; the binding criterion was "identical family and count", which held.)
- **G2 — MUL_MAT_ID: 407/407 PASS** (raw/tbo_mmid_sa802498.out, exit=0).
- **G3 — GPU bench** (`-ngl 99 -fa 0 -t 4 -r 3`, raw/bench_gpu_sa802498.out):
  **pp512 291.11 ± 0.56** (#55: 284.18 → **+2.4%**), **tg128 23.02 ± 0.04**
  (#55: 23.42 → **−1.7%**). Both inside the ±10% band and >7 points from
  either edge → **#55's 750 GPU numbers are CONFIRMED as router constants;
  Amendment 1 of #55 is CLOSED** without owner sign-off, by re-run under a
  prereg that anticipated the split.
- G4 (informative): 291.11 / 98.97 (tuned CPU, #57) = **2.94×** → the 750
  GPU-prefill lane stands (#57's 2.87× reaffirmed).

## Arm-order note (PREREG F15 clause)

#58 went census → bench_gpu with no CPU arm in between; numbers landed
+2.4%/−1.7% of #55, far from the band edges, so the clause requiring
discussion near an edge is not triggered. Recorded: the GPU run followed
~4 min of OpenCL census load and still came out slightly FASTER than #55's
(which followed a CPU arm) — run-to-run noise dominates any warm-GPU effect
at this load.

## Router constants for Adreno 750 (ship 2.6B Q4_0, -fa 0)

pp512 **284–291** t/s (two sessions), tg128 **23.0–23.4** t/s. Decode remains
CPU (#57: 28.58 tuned CPU vs 23.0-23.4 GPU = GPU 0.80-0.82×); prefill GPU
2.9×. The 20-FAIL f16/bf16 family is now reproduced on the 750 in THREE
independent runs (#16 physical, #55, #58): it is a stable property of the
750 driver/compiler stack and the router's per-GPU capability probe must
cover it.

## Budget

8 Gen 3 pool: 979 → ~970 min.
