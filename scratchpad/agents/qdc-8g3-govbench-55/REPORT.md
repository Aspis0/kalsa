# REPORT — Cell #55: ship-config tier point on QRD8650 (Snapdragon 8 Gen 3 / Adreno 750)

Date: 2026-09-03. QDC job 797935 (`sa802004`), device `72c4dabb`, Running
07:16:42 → ended 07:28:45 CEST (portal-verified Completed) = **12 min
billed** of the 1000 free 8 Gen 3 minutes — cheapest cell of the campaign.
PREREG.md (inherits #52 with deltas) in this folder; raw in raw/. All five
arms ran once, zero PRE-gate retries, zero aborts, zero relaunches. Thermal
record (raw/therm_*): every PRE gate passed first try; the POST snapshot of
the LAST arm (bench_cpu_pure) failed the #38 thresholds — a non-gating
end-of-session reading taken after back-to-back bench arms; all earlier POST
snapshots passed. The QRD board runs cooler than the HDK but is not immune.

## Device (raw/recon_sa802004.txt)

- SoC `SM8650` (recon line 2), platform `pineapple`, Android 14 userdebug.
  GPU **Adreno 750** (OpenCL banner in bench outputs). 8 cores: cpu0-1
  @2.2656, cpu2-6 @2.9568, cpu7 @3.1872 GHz → CPU_MASK `f0` (cpu4-7), nproc 8.

## Q1 — correctness (gov-kit 5c3979438, shas device-verified)

- **MUL_MAT: 905/925 — 20 FAIL** (raw/tbo_mm_sa802004.out, exit=1).
  All 20 are the SAME family: `type_a=f16|bf16, type_b=f32, m=128, n=1,
  k=1056, k_v=2112` across batch shapes bs=[2..8]×[1,3] — f16/bf16 batched
  view-K matmuls. **This replicates campaign #16's physical-750 finding
  ("new compiler breaks f16 batched upstream, 20 fail") on QDC reference
  hardware**: it is the 750 driver/compiler stack, not the phone, and it is
  still present on this Android-14 QRD image.
- **MUL_MAT_ID: 407/407 PASS** (raw/tbo_mmid_sa802004.out, exit=0) — the
  MoE experts surface is clean on the 750 as on 732/740.
- Grid consequence — **stated as a post-hoc Amendment, per audit**: the
  inherited #52 grid says "any Q1 FAIL → G3, OpenCL lane not certifiable,
  GPU numbers quarantined". Read literally, that quarantines this cell's
  bench numbers. **Amendment 1 (post-hoc, disclosed)**: the 20 failures are
  a closed sub-family (f16/bf16 batched view-K) with zero overlap with the
  ship model's quantized op set, so this report splits the verdict — G3 for
  the failing sub-family, G1 logic for the quantized bench lanes. This split
  was NOT preregistered; a re-run under a prereg that anticipates it (or an
  owner sign-off on this amendment) is required before the 750 GPU numbers
  are used for router constants. The correctness finding itself (the 20-FAIL
  family) is unconditional.

## Q2 — ship config (LFM2.5-2.6B QAD-Q4_0, sha `a247afd6…`; -t 4, taskset
f0, -r 3; GPU with -fa 0 for cross-tier comparability)

| arm | flags | pp512 t/s | tg128 t/s |
|---|---|---|---|
| GPU full offload | -ngl 99 -fa 0 | **284.18 ± 0.07** | **23.42 ± 0.02** |
| CPU pure | -dev none -ngl 0 | 16.26 ± 0.20 | 11.56 ± 0.23 |
| CPU-weights hybrid | -ngl 0 | 17.09 ± 0.19 | 12.04 ± 0.18 |

**G1 confirmed for the 750 with the ship config**: GPU prefill 284 t/s
(1.87× the 732's 151.8, ~17× this build's CPU) and GPU decode 23.4 t/s
(2.0× CPU decode) — consistent with the #16-era "from 750 up the GPU flies"
verdict, now on reference hardware with the ship model.

### Bound caveats (inherited from #52 + one new)

1. CPU numbers remain build-suspect (no -march flags in the kit; no
   crossover constant from this cell). The suspicion is now reinforced:
   16.3 pp512 on 4×2.96+3.19 GHz cores is implausibly low for a tuned build.
2. Decode recorded, not gridded. Single session, 3-rep means.
3. NEW: the 20-FAIL family means any future 750 lane that materializes
   f16/bf16 batched view-K matmuls on GPU (e.g. certain attention or LoRA
   paths) needs a per-shape guard or the upstream fix; the router capability
   probe should cover this family alongside FA.

## Router tier map after today (ship 2.6B, GPU -fa 0, same kit everywhere)

| tier | GPU pp512 | GPU tg128 | correctness |
|---|---|---|---|
| Adreno 732 (7+ Gen 3, #52) | 151.8 | 17.3 | MM+MMID clean; FA does not compile |
| Adreno 740 (HDK8550, #53) | 84.1 (Q4_K_M) | 16.0 (Q4_K_M) | MM+MMID+FA clean |
| Adreno 750 (QRD8650, #55) | 284.2 | 23.4 | MMID clean; 20× f16/bf16-batched FAIL |

(740 row is Q4_K_M from the A/B cell — not directly comparable to the Q4_0
rows; the 740 ship-config numbers live in the S23 campaigns.)

## Session accounting

Submitted 07:15:17, Running 07:16:42, ended 07:28:45 = 12 min. Five arms,
zero gate retries, zero relaunches (the driver carried all seven #52
lessons). Remaining 8 Gen 3 budget ≈ 988 min.
