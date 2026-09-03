# REPORT — Cell #56: ship-config tier point on QRD8635 (Snapdragon 8s Gen 3 / Adreno 735)

Date: 2026-09-03. QDC job 797956 (`sa802025`), device `7da1a203`, Running
07:32:31 → ended 07:46:02 CEST (portal-verified Completed) = **~13.5 min
billed** of the 1000 free 8s Gen 3 minutes. PREREG.md (inherits #52, grid
unchanged — first-contact tier) in this folder; raw in raw/. All five arms
ran once, zero PRE-gate retries, zero aborts; every gate snapshot in the
driver log is GATE_PASS including the final post-arm one (this board ran
cool throughout, /tmp/cell56.log).

## Device (raw/recon_sa802025.txt)

- SoC `SM8635` (recon line 2), platform `pineapple`, Android 14 userdebug.
  GPU **Adreno 735** (OpenCL banner in bench outputs). 8 cores: cpu0-2
  @2.016, cpu3-6 @2.8032, cpu7 @3.0144 GHz → CPU_MASK `f0` (cpu4-7), nproc 8.

## Q1 — correctness: **ALL PASS**

- MUL_MAT **925/925**, MUL_MAT_ID **407/407** (raw/tbo_mm_sa802025.out,
  raw/tbo_mmid_sa802025.out, both exit=0, 2/2 backends).
- **Cross-tier finding**: the 750's 20-FAIL f16/bf16-batched family (cell
  #55) does NOT reproduce on the 735 — same generation, same Android 14,
  same kit binary. The defect is specific to the Adreno 750 driver/compiler
  stack, not to the 8-Gen-3 generation. (FA not exercised in this cell — the
  preregistered op set is MM/MMID; note #52 DID hit FA incidentally via its
  crashed load probe, which is how the 732 compile failure was found.)

## Q2 — ship config (LFM2.5-2.6B QAD-Q4_0 `a247afd6…`; -t 4, taskset f0, -r 3)

| arm | flags | pp512 t/s | tg128 t/s |
|---|---|---|---|
| GPU full offload | -ngl 99 -fa 0 | **154.82 ± 1.34** | **16.49 ± 0.01** |
| CPU pure | -dev none -ngl 0 | 14.91 ± 0.01 | 11.34 ± 0.09 |
| CPU-weights hybrid | -ngl 0 | 15.12 ± 0.17 | 11.68 ± 0.10 |

**G1 fires** (grid as #52, first contact): kernels all-PASS and GPU pp512
(154.8) ≫ CPU pp512 (14.9) — the 735 lands close to the 732's GPU numbers
(151.8 ± 1.1 vs 154.8 ± 1.3: gap 3.0, overlapping at 2σ but not 1σ):
for router purposes the two mid-tier Adrenos behave as one performance
class on the ship config, with the 735 nominally ~2 % ahead.

Caveats: identical to #52 (CPU build-suspect — no crossover constant;
decode not gridded; single session, 3-rep means).

## Today's four-tier GPU map (ship 2.6B Q4_0, -fa 0, same kit — except 740†)

| tier | GPU pp512 | GPU tg128 | Q1 |
|---|---|---|---|
| Adreno 732 (SM7675, #52) | 151.8 | 17.3 | clean; FA does not compile |
| Adreno 735 (SM8635, #56) | 154.8 | 16.5 | clean |
| Adreno 740 (SM8550, #53)† | 84.1† | 16.0† | clean incl. FA |
| Adreno 750 (SM8650, #55) | 284.2 | 23.4 | 20× f16/bf16-batched FAIL |

† 740 numbers are Q4_K_M from the A/B cell — NOT comparable to the Q4_0
rows; the 740 ship-config numbers live in the S23 campaigns.

## Session accounting

Submitted 07:31:14, Running 07:32:31, ended 07:46:02 ≈ 13.5 min. Zero
retries, zero relaunches. Remaining 8s Gen 3 budget ≈ 986 min.
