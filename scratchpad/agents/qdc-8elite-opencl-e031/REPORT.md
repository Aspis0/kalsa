# REPORT — E031 kernel correctness on Adreno 830 (cell #39 candidate)

Prereg `e14b7fe1` (locked pre-numbers). Session `e031-adreno830-correctness` (id 792315),
QRD8750/Adreno 830, Android 16, device 87b3a4aa. Kit bin-gov-5c3979438-stripped
(test-backend-ops sha in raw/provenance2.txt), engine kalsa/governor-v0 @ 5c3979438.

## Result: PASS per the pre-written rule

- **MUL_MAT: 925/925 tests passed** (raw/cert_mm_ocl2.out), 0 FAIL, 545 not-supported
  skips (capability declarations, counted separately per prereg).
- **MUL_MAT_ID: 407/407 tests passed** (raw/cert_mmid_ocl2.out), 0 FAIL.
- Backend header names Adreno 830 explicitly; thermal (live HAL group, AMENDMENT-1 of
  #38 applied): pre 37.3/32.4 °C CPU0/GPU0 status 0 → post 61.9/54.4 status 0. Never
  throttled.
- **Same counts as the E031.45 certification on Adreno 740** — our q2_K/q3_K kernels are
  correct on their third GPU generation/compiler, first run.

## Honest note — a vacuous first attempt, not counted

First runs used `-b OpenCL`: the backend registers as **`GPUOpenCL`**, so the filter
matched nothing and both backends printed "Skipping" with exit 0 and a green OK
(raw/cert_mm_ocl.out, 12 lines). Per the prereg's binding #37 lesson this is a VACUOUS
SKIP and is not evidence; kept in raw/ as the negative exhibit. Rule for future cells:
the `-b` argument must be the REGISTERED name (`GPUOpenCL`, `CPU`) and the output must
contain per-case counts before it counts as a run.

Pending: hostile audit (GLM) before ALIVE/registro entry — queued post-compaction.
