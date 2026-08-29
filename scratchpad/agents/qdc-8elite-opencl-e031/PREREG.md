# PREREG — E031 kernel correctness on Adreno 830 (QDC 8 Elite)

Written BEFORE any measurement. Locked at moe-experiments commit: **e68414a9**.

## The question

Do the fork's OpenCL MoE kernels — including our q2_K/q3_K 8x4 kernels, which exist
only in kalsallama — produce CORRECT results on **Adreno 830** (Snapdragon 8 Elite)?

Lineage: E031.45 certified 407/407 MUL_MAT_ID on Adreno 740 and (bank #16) transfers to
750 for our kernels while the NEW compiler broke 20 upstream f16-batched cases. The 830
is a third compiler/GPU generation; per the standing rule, nothing transfers — it must
be re-certified. This cell is correctness ONLY; no speed claims.

## Method (fixed)

- Kit: `~/kalsa-qdc/bin-gov-5c3979438-stripped` (arm64, GGML_OPENCL=ON, Adreno kernels,
  engine `kalsa/governor-v0` @ 5c3979438 — contains the same OpenCL kernels as main +
  governor code that does not touch kernels; SHA256SUMS recorded).
- Device: QRD8750, session minutes recorded. adb via SSH tunnel local port 6037 ONLY.
- Runs, in order, each `> file 2>&1` with real exit codes:
  1. `test-backend-ops test -b OpenCL -o MUL_MAT` → cert_mm_ocl.out
  2. `test-backend-ops test -b OpenCL -o MUL_MAT_ID` → cert_mmid_ocl.out
- The #37 lesson is binding: a run whose tail does not contain per-op OK/FAIL counts
  for the OpenCL backend is a VACUOUS SKIP and is not evidence. The `-b OpenCL`
  selector must be verified in the output header (platform/device lines must name
  Adreno 830).
- Thermal snapshot (live HAL group + Thermal Status — AMENDMENT-1 of cell #38 is
  binding for all QDC cells) before and after each run; correctness is not
  clock-sensitive but throttling state is recorded for honesty.

## Decision rule (written before the numbers)

- **PASS**: every executed case for both ops reports OK; skips explicitly listed as
  not-supported by the backend are acceptable and counted separately (they are
  capability declarations, not failures).
- **FAIL**: any FAIL line → the cell banks as a defect finding with the failing case
  names; no averaging, no re-runs to make it pass. A crash/abort mid-suite banks as
  FAIL with the tail of the log.
- Counts are reported as N_ok/N_executed with N_skipped alongside — never collapsed.

## What this cell cannot say

- Nothing about speed on the 830 (separate cell with its own prereg).
- Nothing about the 740/750 (already certified, different compilers).
- Nothing about NPU/HVX.
- A PASS does not certify f16 batched upstream cases beyond what the suite covers.
