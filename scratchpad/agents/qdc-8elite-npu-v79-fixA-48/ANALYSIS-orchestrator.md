# Cell #48 — orchestrator analysis (verified on raw before REPORT delegation)

Every number below re-derived by me from `raw/` with the FIFO token-scan
(stdout never reorders against itself; headers and verdicts pair in order;
0 unmatched headers in all parses). Job 796621, QRD8750 serial `b4bd0901`,
Submitted 05:30:25, Started 05:36:29, Ended 05:40:09 (~4 min billed), driver
`DONE elapsed=42 npu_dead=0`. Kit `npu-kit-153fdbafd.tgz` verified on device
(`raw/kit_verify.txt`), `Hexagon Arch version v79` (`raw/list_devices.txt`).

## Headline

- **Gate 1 (Class A fix) PASS**: `dsp-rsp: INTERNAL-ERROR` count 36 → **0** in
  R1, R2, R3 (`raw/summary.txt`); no former-IE shape in any `Failing tests:`.
- **Gate 2 (no regression) PASS**: per-shape verdict diff #46→R1 shows exactly
  40 changed shapes = 34 FAIL→OK + 2 FAIL→NS + 6 extras; zero former-OK
  degraded; `q4_0 m=576,n=512,k=576` unchanged OK.
- **Gate 3 PASS**: MUL_MAT_ID 301/301 (`raw/summary.txt`), judge on
  (301 `recopy=get/set`).
- R1 = R2 = `545/546` (OK=545, FAIL=1, NS=930 by token count; 546 = 542 stock
  − 2 NS-flips + 6 extras).

## The 2-of-36 that became "not supported" (mechanism traced in code)

`q4_0 m=1,n=2048,k=8192` and `q8_0 m=6,n=4096,k=5120`: FAIL(IE) in #46 →
**NS** in #48. Chain (kalsallama tip 153fdbafd):
`ggml_hexagon_supported_mul_mat` calls `ggml_hexagon_precompute_matmul_params`
(`ggml-hexagon.cpp:2875`) and refuses when `kparams.vtcm_size > sess->vtcm_size`;
the precompute selects the path at `:2589`
(`if (hmx_enabled && ggml_hexagon_matmul_is_hmx_eligible(...))`). Pre-fix these
two were HMX-eligible → HMX params fit → "supported" → DSP refused `%32` at
runtime → INTERNAL-ERROR. Post-fix they are HMX-ineligible → HVX param
computation → VTCM demand for these large geometries (host m = test-n = 2048 /
4096) exceeds the 8 MB budget → **clean upfront refusal** (ggml keeps the op on
CPU). A runtime defect became an honest capability decline. Not a regression:
both shapes were broken in #46.

## Class B discrimination (the NaN, q4_0 m=2880,n=32,k=2880)

- R1: 4 in-run occurrences (1 stock early + 3 extras appended at end) →
  **stock FAILs** (`NaN at index 354`, HTP0=nan CPU=3.173089, raw r1:592),
  extras all OK (FIFO positions 238k-240k region → OK,OK,OK).
- R2: identical pattern — first occurrence FAIL (`index 354`, CPU=8.473092,
  r2:592), 3 extras OK.
- CPU reference value at the failing index DIFFERS across runs (3.17 vs 8.47)
  → input data differ across runs, **yet HTP0=nan lands at index 354 both
  times**. #46 (different binary) had index 305. → the corrupted slot is
  binary/layout-fixed, data-independent.
- `q4_0 2880,32,1024` (k=1024) OK; `q4_0 2880,64,2880` (n=64) OK;
  `q8_0 2880,32,2880` OK ×2 per run.

**Reading (per the prereg grid):** the failure is tied to the FIRST execution
of the shape in process lifetime; identical later executions pass (warm-up
masks it). Data-independent fixed slot + first-touch trigger + q4_0-specific →
**uninitialized-memory family** (scale-pad load or VTCM layout undercount)
strongly favored; fp16-accumulation overflow now doubly disfavored (three
identical-shape re-executions pass in-run; the slot is data-independent).
Confound disclosed: the extras run at the END of the census (memory warmed by
~1470 prior tests); a future probe would place extras FIRST to separate
"first-of-shape" from "cold-process". Not needed for this cell's claim.

## Method

Judge integrity: `recopy=get/set` 546× (R1), 301× (R3); `GGML_TEST_PLAIN_HOST=1`
in force. Thermal pre-gates all PASS (R1 41.4 °C region — see gate files);
post snapshots present. Session ended by orchestrator at 05:40 after DONE
(browser End Session → Confirm dialog "Are you sure you want to end this
session?" → Yes). ~641 min remain on QRD8750.
