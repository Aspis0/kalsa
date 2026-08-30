# REPORT — E031 kernel correctness on Adreno 830 (cell #39 candidate)

Prereg `e14b7fe1` (the lock commit — PREREG.md's own "locked at e68414a9" line names the
BASE commit it was written on top of; the prereg entered the repo at e14b7fe1, before any
measurement — raw mtimes 17:16-17:22 vs prereg commit 14:44). Session
`e031-adreno830-correctness`, QRD8750/Adreno 830, Android 16
(raw/provenance2.txt:1 `qti/sun/sun:16/...`). Kit bin-gov-5c3979438-stripped: the
on-device test-backend-ops sha256 is recorded in raw/provenance2.txt and matches the
kit's SHA256SUMS on the Mac (engine kalsa/governor-v0 @ 5c3979438 per the kit's
BUILD_NOTE.txt — hash provenance is the kit note, not a raw/ artifact). The QDC session
id and device serial were read from the live web UI and are not recorded in any raw/
artifact; they are reported here as unverifiable context only.

## Result: PASS per the pre-written rule

- **MUL_MAT: 925/925 executed tests passed, 0 FAIL, 545 not-supported skips**
  (raw/cert_mm_ocl2.out; 925+545 = 1470 = total per-case lines).
- **MUL_MAT_ID: 407/407 executed tests passed, 0 FAIL, 405 not-supported skips**
  (raw/cert_mmid_ocl2.out; 407+405 = 812 = total per-case lines). More than half the
  MMID suite is skipped by capability declaration — disclosed per prereg ("N_skipped
  alongside — never collapsed").
- Backend header: `Backend 1/2: GPUOpenCL`, `Device description: QUALCOMM Adreno(TM)
  830`, driver `OpenCL 3.0 QUALCOMM build: 0800.70 Compiler E031.47.18.47`.

## What this certifies about our q2_K/q3_K kernels (narrowed after audit)

- **Plain MUL_MAT q2_K/q3_K: NEVER EXECUTED on the 830** — all 26 cases (13 q2_K +
  13 q3_K) report `not supported [OpenCL]`. The backend declines the plain-MUL_MAT
  path for these types; in real inference those ops run on CPU. No correctness claim
  is made for that path.
- **MUL_MAT_ID q2_K/q3_K (the MoE path, where our 8x4 kernels live): 10 of 14 cases
  executed, all OK** — the realistic MoE shapes (m=64/96/512, n_mats=4, n=1..32).
  The 4 skipped cases are small shapes the kernels declare unsupported
  (m=8 n_mats=3, m=16 n_mats=5 — capability declarations, consistent with the
  kernels' shape requirements).
- The bankable claim is therefore: **the q2_K/q3_K MoE (MUL_MAT_ID) kernels are
  correct on the 830 for every shape they accept, first run, third GPU/compiler
  generation.** Nothing broader. Comparison with the 740 certification (E031.45,
  407/407) is a cross-cell observation: the executed-count totals match, but the
  740 logs are not in this cell's raw/ and no per-case equivalence is claimed.

## Thermal record (procedural deviation, disclosed)

- The prereg promised live-HAL snapshots before AND after each run; raw/ contains
  only two POST snapshots. `therm_post.txt` (mtime 17:16) is the post of the vacuous
  first attempt: 35.3 °C CPU0 / 32.0 °C GPU0, status 0. `therm_post2.txt` (mtime
  17:22, same minute as both real logs) is a single post shared by the two real runs:
  61.9 °C CPU0 / 54.4 °C GPU0, status 0. **No pre-run snapshots were captured** —
  a procedural deviation from the prereg. An earlier draft of this report cited a
  "pre 37.3/32.4 °C" pair that exists in no artifact; it was a mis-transcription
  from the live terminal and is retracted.
- Why the cell survives: correctness is not clock-sensitive (prereg's own words) and
  `Thermal Status: 0` (never throttled) is on record in both snapshots.
- Exit codes: claimed 0 at run time but not preserved as artifacts (logs are
  stdout/stderr captures only); the completeness signature (full per-case list +
  summary + green backend OK in both logs) is the evidence of clean completion.

## Honest note — a vacuous first attempt, not counted

First runs used `-b OpenCL`: the backend registers as **`GPUOpenCL`**, so the filter
matched nothing and both backends printed "Skipping" with a green OK
(raw/cert_mm_ocl.out AND raw/cert_mmid_ocl.out, 12 lines each). Per the prereg's
binding #37 lesson this is a VACUOUS SKIP and is not evidence; both kept in raw/ as
negative exhibits. Rule for future cells: the `-b` argument must be the REGISTERED
name (`GPUOpenCL`, `CPU`) and the output must contain per-case counts before it
counts as a run.

Audited: hostile GLM audit in AUDIT.md — verdict FIX, all 8 mandatory corrections
applied in this revision.
