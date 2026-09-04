# PREREG — Cell #58: 750 re-run with the split preregistered (closes the #55 Amendment)

Date: 2026-09-03 night, owner full delegation ("fai tutto"). Cell #55 banked
the 8650's GPU numbers under an inherited grid whose literal reading ("any Q1
FAIL → quarantine") the 20-FAIL f16/bf16 family tripped; the report split the
verdict post hoc (Amendment 1) and its own audit ruled that a re-run under a
prereg anticipating the split — or owner sign-off — is required before the
750 GPU numbers become router constants. This cell is that re-run. No new
question is asked; the point is that the interpretation rules below are
written BEFORE the session starts.

## Question

On QRD8650 (Snapdragon 8 Gen 3 / Adreno 750), with the same kit and model as
#55 (gov-kit `5c3979438`, sha 419bef91…; ship LFM2.5-2.6B QAD-Q4_0
`a247afd6…`), do the correctness census and the GPU bench reproduce #55, under
a grid that names the known-failing family in advance?

## Binding interpretation grid

- G1 (MUL_MAT census): the EXPECTED outcome is 905/925 with all 20 failures
  in exactly the family `type_a∈{f16,bf16}, type_b=f32, m=128, n=1, k=1056,
  k_v=2112`, batch shapes bs=[2..8]×[1,3] (campaign #16 + cell #55, the 750
  driver/compiler defect). That outcome does NOT quarantine the quantized
  bench lanes: the family has zero overlap with the ship model's quantized op
  set. ANY failure outside that family, or a different failure count, DOES
  quarantine this cell's GPU numbers (real G-FAIL) and is reported as a new
  correctness finding.
- G2 (MUL_MAT_ID census): expected 407/407. Any failure → GPU numbers
  quarantined (the MoE experts surface must stay clean).
- G3 (GPU bench, -ngl 99 -fa 0): pp512 and tg128 each within ±10% of #55
  (284.18 / 23.42) → **#55's GPU numbers are CONFIRMED as router constants
  and the Amendment is closed** (provisional flag removed in ALIVE). Either
  number outside ±10% → #58's numbers supersede #55's (single-session vs
  single-session; the discrepancy itself is banked as run-to-run instability
  and a repeat cell is queued before any constant is written).
- G4 (prefill verdict, informative — uses #57's tuned CPU 98.97 pp512): GPU
  pp512 / 98.97 ≥ 2× reaffirms the 750 GPU-prefill lane per #57's grid. Not
  a gate on this cell.

## Fixed materials

- Kit: `~/kalsa-qdc/gov-kit-5c3979438.tgz` (sha 419bef91…) — same binary as
  #55 for comparability. Model: `~/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf`
  (sha `a247afd6…`), sha verified on-device (mismatch = METHOD-VOID).
- Arms, in order, each behind the #38 thermal gate (HAL ≤60 °C, status ≤1,
  retry ×3 @60 s): `tbo_mm` (cap 1200 s), `tbo_mmid` (cap 1200 s),
  `bench_gpu` (-ngl 99 -fa 0, -t 4, taskset top-4 bare-hex from recon, -r 3,
  cap 1500 s). No CPU arms: the honest CPU lane is #57's and re-measuring it
  with this kit's crippled build would add nothing.
- All #52 ops lessons bind: T4 nohup launch, adbT perl-alarm caps, re-entrant
  arms (skip on `exit=0`), bracketed pkill, ref-clicks only on portal dialogs
  and Session Status re-verified after End.
- Declared arm-order difference vs #55 (audit F15): #55 ran a CPU-only arm
  between the censuses and `bench_gpu` (incidental GPU cool-down); #58 goes
  census → `bench_gpu` directly, so the GPU may enter the bench warmer. The
  #38 pre-arm gate still decides fitness, and the ±10% G3 band absorbs
  thermal drift; if either number lands within 2 points of a band edge, the
  REPORT must discuss this difference explicitly before banking a verdict.

## Procedure

One QDC session on QRD8650 (8 Gen 3 free pool, ~979 min left), booked 30 min,
expected ~10-12 min billed. Driver: `d_run.sh` in this folder (derived from
#55's, CPU arms removed). One QDC job at a time (nothing else in flight).

## Non-goals

No FA arms, no Q4_K_M, no thread sweep, no plateau study, no explanation of
#57's 28.58 tg outlier (separate repeat cell, still queued).
