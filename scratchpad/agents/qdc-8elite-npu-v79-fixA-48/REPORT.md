# REPORT — `npu-v79-fixA-48`

## Session

`job=796621`, `QRD8750`, serial `b4bd0901`; submitted `09/02/26 5:30:25 AM`, started `09/02/26 5:36:29 AM`, ended `09/02/26 5:40:09 AM`; `DONE elapsed=42 npu_dead=0`. [raw/running.txt:1-3; raw/events.txt:1; raw/done.txt:1]

Backend `HTP0`; kit `npu-kit-153fdbafd.tgz`; SHA256 `e7ff4cd8b18ac1b554d8660e315432926a1440ff9c7bb991de9ecf3191623350`; device verify `24/24 OK`. [raw/serial.txt:1-2; raw/kit_sha_host.txt:1-2; raw/kit_verify.txt:1-25]

`Hexagon Arch version v79`; HTP0 `hvx=6`, `hmx=1`, `vtcm=8 MB`; `EXIT=0`. [raw/list_devices.txt:7-15]

## Dissent

The orchestrator states `40 = 34 + 2 + 6`. [ANALYSIS-orchestrator.md:14-16] Independent FIFO alignment gives `34 + 2 = 36` changed stock verdicts, plus `6` appended extra observations, hence `42`, not `40`. [../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt.census.txt:5,12; raw/ops_mm_r1.txt.census.txt:5-6; raw/ops_mm_r1.txt:2452,2460,2468,2476,2484,2492]

The orchestrator states an R1 pre-gate `41.4 °C` region. [ANALYSIS-orchestrator.md:63-64] The raw R1 pre-gate contains only `GATE_PASS`; no raw `41.4` value exists. [raw/gate_pre_mm_r1.txt:1]

## Gate 1 — Class A fix

Baseline #46: `505/542`, `37` failures, `36` `INTERNAL-ERROR`, NaN index `305`. [../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt.census.txt:2-3,12,45]

R1/R2/R3 grep pair: `INTERNAL-ERROR=0`, `graph_failed=0` in all three runs; census pair `internal_error_lines=0`, `compute_failed=0` in all three. [raw/summary.txt:1-3; raw/ops_mm_r1.txt.census.txt:7,12; raw/ops_mm_r2.txt.census.txt:7,12; raw/ops_mmid_r3.txt.census.txt:7,12]

Former-IE transitions: `34/36 → OK`; `2/36 → NS`; no former-IE shape is in either final R1/R2 failure list. [../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt.census.txt:20-56; raw/failing_mm_r1.txt:1-3; raw/failing_mm_r2.txt:1-3; raw/ops_mm_r1.txt.census.txt:9-12; raw/ops_mm_r2.txt.census.txt:9-12]

The two NS flips are `q4_0 m=1,n=2048,k=8192` and `q8_0 m=6,n=4096,k=5120`: #46 `FAIL`/IE → #48 `NS` in both R1 and R2 (FIFO, 0-based byte pairs: R1/R2 `169921→170085`, `175736→175900`; baseline `175301→175465`, `182624→182788`). [raw/ops_mm_r1.txt:1737-1738,1800-1801; raw/ops_mm_r2.txt:1737-1738,1800-1801; ../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt:1801-1805,1883-1887]

Code trace: `supported_mul_mat` precomputes at `ggml-hexagon.cpp:2875`, rejects `kparams.vtcm_size > sess->vtcm_size` at `:2876-2878`; precompute selects HMX through `is_hmx_eligible` at `:2589`, otherwise falls back to HVX at `:2595-2596`. [/Users/marco/Projects/kalsallama/ggml/src/ggml-hexagon/ggml-hexagon.cpp:2589,2595-2596,2875-2878; raw/list_devices.txt:9]

For these two geometries, the traced transition is HMX-eligible/HMX-fit → supported → DSP runtime IE in #46, then HMX-ineligible → HVX parameterization → VTCM demand over the `8 MB` budget → clean `NS` in #48. [/Users/marco/Projects/kalsallama/ggml/src/ggml-hexagon/ggml-hexagon.cpp:2589,2595-2596,2875-2878; raw/list_devices.txt:9; ../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt:1801-1805,1883-1887; raw/ops_mm_r1.txt:1737-1738,1800-1801]

This is an honest upfront capability decline replacing the #46 runtime error; both shapes were already broken in #46. [../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt.census.txt:12,20-56; raw/ops_mm_r1.txt:1737-1738,1800-1801]

## Gate 2 — no regression

Aligned stock comparison: `1470` baseline headers versus the first `1470` R1/R2 headers; `0` header mismatches; `0` former-OK degradations. [../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt.census.txt:5-6; raw/ops_mm_r1.txt.census.txt:5-6; raw/ops_mm_r2.txt.census.txt:5-6]

Raw category count: `34` former-IE→OK (`25` = five quant types × `m=16,n=5..9`; `4` = `m=16,n=16`; `5` = `m=1,n=64`), `2` former-IE→NS, `6` appended extras: `42` observations. [../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt.census.txt:20-56; raw/ops_mm_r1.txt:2452,2460,2468,2476,2484,2492]

The only R1/R2 final failure is the known q4_0 NaN shape; control `q4_0 m=576,n=512,k=576` remains `OK`. [raw/failing_mm_r1.txt:1-3; raw/failing_mm_r2.txt:1-3; ../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt:1794,1803; raw/ops_mm_r1.txt:1736; raw/ops_mm_r2.txt:1736]

## Gate 3 — `MUL_MAT_ID`

R3: `301/301` passed, `EXIT=0`; judge integrity: `PLAIN_HOST=1`, `recopy_lines=301`. [raw/summary.txt:3; raw/ops_mmid_r3.txt:1,3542-3548; raw/ops_mmid_r3.txt.census.txt:2,5,16,19]

## Class B — discrimination data

FIFO offsets below are 0-based raw-byte `header→verdict` pairs.

| Probe | R1 | R2 |
|---|---|---|
| `q4_0 2880,32,2880`, four occurrences | `FAIL`, NaN index `354`, CPU `3.173089`, `53394→54041`; then `OK,OK,OK` at `237852→238499`, `238515→239162`, `239178→239824` | `FAIL`, NaN index `354`, CPU `8.473092`, `53394→54041`; then `OK,OK,OK` at `237852→238499`, `238515→239162`, `239178→239824` |
| `q4_0 2880,32,1024` | `OK`, `239840→240487` | `OK`, `239840→240487` |
| `q4_0 2880,64,2880` | `OK`, header/verdict `241166→241258` | `OK`, header/verdict `241166→241258` |
| `q8_0 2880,32,2880` | stock `OK` `54059→54708`; extra `OK` `240503→241150` | stock `OK` `54059→54708`; extra `OK` `240503→241150` |

[raw/ops_mm_r1.txt.census.txt:9,20; raw/ops_mm_r2.txt.census.txt:9,20; raw/ops_mm_r1.txt:592,600,2452-2492; raw/ops_mm_r2.txt:592,600,2452-2492]

The #46 NaN index was `305`; #48 is `354` in both runs, while the CPU references differ `3.173089` vs `8.473092`. [../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt.census.txt:45; raw/ops_mm_r1.txt.census.txt:20; raw/ops_mm_r2.txt.census.txt:20]

Per the preregistered grid: occurrence-dependent failure with later same-shape passes favors the uninitialized-memory family; `k=1024` clean and q8_0 clean favor a layout/quantization-dependent candidate; fp16-accumulation is disfavored. This cell does not confirm a root cause. [raw/ops_mm_r1.txt.census.txt:9-12,20; raw/ops_mm_r2.txt.census.txt:9-12,20; PREREG.md:59-67]

Order confound: the `6` extras are FIFO positions `1471-1476`, after `1470` stock cases, so the result is an end-of-warmed-census observation and does not separate first-of-shape from cold-process effects. [raw/ops_mm_r1.txt.census.txt:5-6; raw/ops_mm_r1.txt:2452-2492; PREREG.md:33-36]

## Thermal method

Pre-run gates: R1/R2/R3 `GATE_PASS`; method threshold `60 °C`, one `180 s` retry, post-run snapshot disclosed. [raw/gate_pre_mm_r1.txt:1; raw/gate_pre_mm_r2.txt:1; raw/gate_pre_mmid_r3.txt:1; PREREG.md:79-81]

Post-run HAL: R1/R2/R3 `max_hal_temp=42.0`, `status=0`; snapshots present. [raw/therm_post_mm_r1.txt:30-32; raw/therm_post_mm_r2.txt:30-32; raw/therm_post_mmid_r3.txt:30-32]

## Verdict

Gate 1: **PASS**. [raw/summary.txt:1-3; raw/ops_mm_r1.txt.census.txt:7,12; raw/ops_mm_r2.txt.census.txt:7,12]

Gate 2: **PASS** on the preregistered no-regression condition; the raw category arithmetic is `42`, not `40`. [raw/failing_mm_r1.txt:1-3; raw/failing_mm_r2.txt:1-3; ../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt.census.txt:20-56]

Gate 3: **PASS**. [raw/summary.txt:3; raw/ops_mmid_r3.txt:3542-3548]

Class B: **DATA BANKED; candidate narrowing only**. [PREREG.md:59-67]

## What this cell cannot say

No speed, PPL, v73/v75/KEXP, Class B root cause, governor/app claim, or DSP-side-code conclusion. [PREREG.md:84-88]

## Post-audit addendum (applied by orchestrator per AUDIT-REPORT F-3, APPLY verdict)

Baseline-trap resolution, binding for future readers: `q4_1`, `q8_0`, `mxfp4`,
`iq4_nl` `m=1,n=64` were **IE fails in #46** — the census `internal_error_lines=36`
includes them and the 36 IE : 36 compute-failed pairing closes over exactly the
36 non-NaN failing shapes (the whole #46 log contains ONE numeric diagnostic
line, the known q4_0 m=2880 NaN). The census awk shows them as `real_fail:`
only because pty alignment glued the FAIL verdict token to a header line without
the compute-failed prefix (census.awk:62-65 classifies from the header line
alone; per-category split is reported-not-binding by adoption). All 5 m=1,n=64
shapes transitioned to OK in #48. Do not re-derive a non-IE classification from
census sub-category labels.
