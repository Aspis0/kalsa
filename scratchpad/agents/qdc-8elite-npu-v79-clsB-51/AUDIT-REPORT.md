# AUDIT-REPORT — cell #51 (qdc-8elite-npu-v79-clsB-51)

**Auditor:** hostile (different model from REPORT author)
**Date:** 2026-02-09
**Target:** REPORT.md (written by GPT-5.6 Luna)
**Raw:** DIR/raw/ (all 4 ops logs, nan files, failing files, libs_active, summary, gates, provenance, serial, list_devices, kit_verify, events, done)
**Cross-cell:** #48, #49, #50 raw

---

## 1. FABRICATION/DRIFT

Every quote and line reference verified against raw. Findings:

### 1a. Header SHA claims — all verbatim

REPORT line `raw/kit_sha_host.txt:3`:
```
5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8  bin/test-backend-ops-153f
```
Actual `kit_sha_host.txt:3`: `5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8  bin/test-backend-ops-153f` **MATCH.**

REPORT line `raw/kit_sha_host.txt:4`:
```
e95fa35eed6ec979b9ef7a6cf5098ff738e580bfbd01f38e991202c2ef8dd99a  lib-fix/libggml-hexagon.so
```
Actual `kit_sha_host.txt:4`: identical. **MATCH.**

REPORT line `raw/kit_sha_host.txt:5`:
```
37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044  lib-fix/libggml-htp-v79.so
```
Actual `kit_sha_host.txt:5`: identical. **MATCH.**

REPORT line `raw/kit_sha_host.txt:6`:
```
e91fbcef71f0ece20cf8e33fa26ac2c3b2bdce34ddc662ee926afb40574079ba  lib/libggml-hexagon.so
```
Actual `kit_sha_host.txt:6`: identical. **MATCH.**

REPORT line `raw/kit_sha_host.txt:7`:
```
37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044  lib/libggml-htp-v79.so
```
Actual `kit_sha_host.txt:7`: identical. **MATCH.**

### 1b. libs_active.txt quotes — all verbatim

REPORT line `raw/libs_active.txt:1`:
```
r1_ctrl hexlib=e91fbcef71f0ece20cf8e33fa26ac2c3b2bdce34ddc662ee926afb40574079ba skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044 tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8
```
Actual: identical. **MATCH.**

REPORT line `raw/libs_active.txt:2`:
```
r2_fix hexlib=e95fa35eed6ec979b9ef7a6cf5098ff738e580bfbd01f38e991202c2ef8dd99a skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044 tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8
```
Actual: identical. **MATCH.**

REPORT line `raw/libs_active.txt:3`:
```
r3_ctrl hexlib=e91fbcef71f0ece20cf8e33fa26ac2c3b2bdce34ddc662ee926afb40574079ba skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044 tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8
```
Actual: identical. **MATCH.**

REPORT line `raw/libs_active.txt:4`:
```
r4_fix hexlib=e95fa35eed6ec979b9ef7a6cf5098ff738e580bfbd01f38e991202c2ef8dd99a skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044 tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8
```
Actual: identical. **MATCH.**

### 1c. summary.txt quotes — all verbatim

REPORT line `raw/summary.txt:1`:
```
r1_ctrl: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed
```
Actual: identical. **MATCH.**

REPORT lines `raw/summary.txt:2-4`: r2_fix, r3_ctrl, r4_fix — all identical to actual. **MATCH.**

### 1d. ops log line numbers — all correct

REPORT `raw/ops_r1_ctrl.txt:2493` → ` 545/546 tests passed`. Actual: `    545/546 tests passed` (4 leading spaces, REPORT quotes 1). **MINOR: quote imprecise on leading whitespace, but content correct.** Not a finding on substance.

REPORT `raw/ops_r1_ctrl.txt:2495-2496`:
```
Failing tests:
  MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1)
```
Actual `ops_r1_ctrl.txt:2495-2496`: identical. **MATCH.**

REPORT `raw/ops_r1_ctrl.txt:2502` → `EXIT=1`. Actual: `EXIT=1`. **MATCH.**

All 4 ops logs: lines 2493, 2502 verified. **MATCH.**

### 1e. failing_*.txt quotes — all verbatim

REPORT `raw/failing_r1_ctrl.txt:1-3`:
```
Failing tests:
  MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1)
  Backend HTP0: [ANSI]FAIL
```
Actual `failing_r1_ctrl.txt:1-3`:
```
Failing tests:
  MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1)
  Backend HTP0: [1;31mFAIL[0m
```
REPORT quotes `[ANSI]FAIL` as a placeholder for the ANSI escape sequence. Actual has `[1;31mFAIL[0m`. **MATCH** (REPORT explicitly notes this is an ANSI-code placeholder).

All 4 failing files verified. **MATCH.**

### 1f. nan files — all verbatim

REPORT `raw/nan_r1_ctrl.txt:1`:
```
[MUL_MAT] NaN at index 338 (HTP0=nan CPU=-1.843428) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(...): [ref-buf] dev-out name=out type=f32 op=MUL_MAT buf="HTP0" buft="HTP0" host=1
```
Actual: identical. **MATCH.**

REPORT `raw/nan_r2_fix.txt:1`: index 482, PLAIN_HOST form. Actual: identical. **MATCH.**
REPORT `raw/nan_r3_ctrl.txt:1`: index 338, PLAIN_HOST form. Actual: identical. **MATCH.**
REPORT `raw/nan_r4_fix.txt:1`: index 360, PLAIN_HOST form. Actual: identical. **MATCH.**

### 1g. Cross-cell #46 reference

REPORT `../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt:642`:
```
[MUL_MAT] NaN at index 305 (HTP0=nan CPU=-12.339559) ...
```
Actual: `642:[MUL_MAT] NaN at index 305 (HTP0=nan CPU=-12.339559) ...` **MATCH.**

### 1h. Cross-cell #48 references

REPORT `../qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r1.txt:592`: index 354. Actual: line 592, index 354. **MATCH.**
REPORT `../qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r2.txt:592`: index 354. Actual: line 592, index 354. **MATCH.**
REPORT `../qdc-8elite-npu-v79-fixA-48/raw/provenance.txt:1`: `b4bd0901`. Actual: `b4bd0901`. **MATCH.**

### 1i. Cross-cell #50 references

REPORT `../qdc-8elite-npu-v79-clsB-50/raw/nan_r1_stock.txt:1`: index 388. Actual: index 388. **MATCH.**
REPORT `../qdc-8elite-npu-v79-clsB-50/raw/nan_r3_stock.txt:1`: index 353. Actual: index 353. **MATCH.**
REPORT `../qdc-8elite-npu-v79-clsB-50/raw/nan_r2_zpad.txt:1`: index 359. Actual: index 359. **MATCH.**
REPORT `../qdc-8elite-npu-v79-clsB-50/raw/nan_r4_zpad.txt:1`: index 334. Actual: index 334. **MATCH.**
REPORT `../qdc-8elite-npu-v79-clsB-50/raw/provenance.txt:1`: `f25c433a`. Actual: `f25c433a`. **MATCH.**
REPORT `../qdc-8elite-npu-v79-clsB-50/raw/skel_active.txt:1`: r1_stock skel=37131e07. Actual: identical. **MATCH.**
REPORT `../qdc-8elite-npu-v79-clsB-50/raw/skel_active.txt:3`: r3_stock skel=37131e07. Actual: identical. **MATCH.**
REPORT `../qdc-8elite-npu-v79-clsB-50/raw/summary.txt:1-4`: all 4 runs 545/546, nan_diags=1. Actual: identical. **MATCH.**

### 1j. Cross-cell #50 REPORT.md references

REPORT `../qdc-8elite-npu-v79-clsB-50/REPORT.md:168`: `T2 promoted; deeper DSP instrumentation post-window.` Actual line 168: identical. **MATCH.**
REPORT `../qdc-8elite-npu-v79-clsB-50/REPORT.md:172-175`: four candidate angles. Actual lines 172-175: identical. **MATCH.**

### 1k. Remaining references

REPORT `raw/kit_verify.txt:45`: `lib/libmtmd.so: OK`. Actual line 45: identical. **MATCH.**
REPORT `raw/kit_verify.txt:46`: `MANIFEST_LINES=45`. Actual line 46: identical. **MATCH.**
REPORT `raw/list_devices.txt:7`: `ggml-hex: Hexagon Arch version v79`. Actual line 7: identical. **MATCH.**
REPORT `raw/list_devices.txt:14`: `HTP0: Hexagon (0 MiB, 0 MiB free)`. Actual line 14: identical. **MATCH.**
REPORT `raw/list_devices.txt:15`: `EXIT=0`. Actual line 15: `EXIT=0`. **MATCH.**
REPORT `raw/provenance.txt:1`: `87b3a4aa`. Actual: `87b3a4aa`. **MATCH.**
REPORT `raw/serial.txt:1`: `serial=87b3a4aa t0=1788388595 t0_iso=2026-09-02T22:36:35Z`. Actual: identical. **MATCH.**
REPORT `raw/events.txt:1`: `[18:37:47 e=72] DONE npu_dead=0`. Actual: identical. **MATCH.**
REPORT `raw/done.txt:1`: `DONE elapsed=72 npu_dead=0`. Actual: identical. **MATCH.**

REPORT `d_run.sh:4`: `All runs use bin/test-backend-ops-153f, EXTRA APPENDED (no FIRST), judge on.` Actual `d_run.sh:4`: identical. **MATCH.**

**FABRICATION/DRIFT verdict: CLEAN. No fabrications. One minor whitespace imprecision in a 545/546 quote (4 spaces quoted as 1), not a substantive finding.**

---

## 2. VERDICT INTEGRITY

### 2a. Grid case 2 correctly identified

REPORT claims "Grid case 2, binding: the NaN persists identically under the fixed host lib."

PREREG grid case 2: `R1/R3 NaN present AND R2/R4 NaN persists → fix REFUTED`

From `summary.txt`: r1_ctrl nan_diags=1, r2_fix nan_diags=1, r3_ctrl nan_diags=1, r4_fix nan_diags=1. **ALL FOUR have NaN.** Grid case 2 applies. **CONFIRMED.**

### 2b. Arm mapping correct

REPORT binding results table:
- R1 control: buggy `e91fbcef` — `libs_active.txt:1`: `r1_ctrl hexlib=e91fbcef...` **MATCH.**
- R2 fix: fixed `e95fa35e` — `libs_active.txt:2`: `r2_fix hexlib=e95fa35e...` **MATCH.**
- R3 control: buggy `e91fbcef` — `libs_active.txt:3`: `r3_ctrl hexlib=e91fbcef...` **MATCH.**
- R4 fix: fixed `e95fa35e` — `libs_active.txt:4`: `r4_fix hexlib=e95fa35e...` **MATCH.**

Skel and tbo identical across all 4: `37131e07...` / `5cf3565b...` **MATCH.**

### 2c. 545/546 ×4, nan_diags=1 ×4

`summary.txt`:
```
r1_ctrl: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed
r2_fix: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed
r3_ctrl: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed
r4_fix: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed
```
**MATCH.**

### 2d. Binding results table "Process exit 1" claim

REPORT: "The raw runner records EXIT=1 for each ops process."

`ops_r1_ctrl.txt:2502`: `EXIT=1`
`ops_r2_fix.txt:2502`: `EXIT=1`
`ops_r3_ctrl.txt:2502`: `EXIT=1`
`ops_r4_fix.txt:2502`: `EXIT=1`

**MATCH.**

**VERDICT INTEGRITY verdict: CLEAN. Grid case 2 correctly applied, arm mapping correct, numbers correct.**

---

## 3. FIX PAIR SENTENCE (ANGLE 3 — SPECIFIC SUSPECT)

REPORT line ~158 (Index observations section):
> "The fix pair differs at 482/360; those runs use different host-library bytes."

**FINDING: FACTUALLY WRONG AS WRITTEN.**

From `libs_active.txt`:
```
r2_fix hexlib=e95fa35eed6ec979b9ef7a6cf5098ff738e580bfbd01f38e991202c2ef8dd99a ...
r4_fix hexlib=e95fa35eed6ec979b9ef7a6cf5098ff738e580bfbd01f38e991202c2ef8dd99a ...
```

**r2_fix and r4_fix use the SAME host library bytes** (`e95fa35e`). "Those runs" (the fix pair) do NOT use different host-library bytes from each other. The sentence as written states a falsehood.

The plausible intended claim: the fix pair's NaN indices (482/360) differ from the control pair's indices (338/338), and this divergence between arms is consistent with the two arms using different host library bytes (control = `e91fbcef`, fix = `e95fa35e`), making the NaN index position lib-sensitive.

**Required correction:** Replace "those runs use different host-library bytes" with wording that says the control and fix arms use different library bytes, and the NaN index is lib-sensitive. For example:

> "The fix pair differs at 482/360; the control pair agrees at 338/338. The two arms use different host-library bytes (`e91fbcef` vs `e95fa35e`), and the NaN index is lib-sensitive."

**Severity: FIX.** The sentence misstates which runs differ. As written, it says the fix pair uses different bytes from each other; it should say the fix and control arms use different bytes.

---

## 4. OVERCLAIM

### 4a. T2 mechanism identified?

REPORT says: "T2 remains promoted" and "The remaining hypothesis is T2, not the descriptor-reuse narrative."

Neither statement claims T2's specific mechanism has been identified. T2 is a hypothesis category (VTCM layout/state corruption elsewhere), not a pinpointed mechanism. **No overclaim.**

### 4b. Eliminated-causes ledger

REPORT lists exactly 3 items:
1. Scale-pad uninitialized VTCM (T1): EXCLUDED. "#50 had NaNs on both stock and zeropad arms."
2. Descriptor cross-type reuse: EXCLUDED. "#51's fixed-library arms still produce the census NaN."
3. Cold-process first-touch: EXCLUDED. "#49's cold first execution passed."

Required list: T1 scale-pad (#50), descriptor cross-type reuse (#51), cold-process first-touch (#49). **MATCH — exactly 3, nothing more.**

### 4c. Containment gate

REPORT: "Class B: PARKED with containment. Keep the standing #47-style per-model PPL-cert gate; it remains in force regardless of this cell. No further cells without a new design."

**Containment gate unaffected. CONFIRMED.**

**OVERCLAIM verdict: CLEAN. No overclaim.**

---

## 5. OMISSION

### 5a. NaN counts via grep

```
grep -c 'NaN at index' ops_r1_ctrl.txt → 1
grep -c 'NaN at index' ops_r2_fix.txt → 1
grep -c 'NaN at index' ops_r3_ctrl.txt → 1
grep -c 'NaN at index' ops_r4_fix.txt → 1
```

REPORT claims nan_diags=1 ×4. **MATCH.**

### 5b. INTERNAL-ERROR counts

```
grep -c 'INTERNAL-ERROR' ops_r1_ctrl.txt → 0
grep -c 'INTERNAL-ERROR' ops_r2_fix.txt → 0
grep -c 'INTERNAL-ERROR' ops_r3_ctrl.txt → 0
grep -c 'INTERNAL-ERROR' ops_r4_fix.txt → 0
```

REPORT claims INTERNAL-ERROR=0 ×4. **MATCH.**

### 5c. NMSE counts

```
grep -c 'NMSE' ops_r1_ctrl.txt → 0
grep -c 'NMSE' ops_r2_fix.txt → 0
grep -c 'NMSE' ops_r3_ctrl.txt → 0
grep -c 'NMSE' ops_r4_fix.txt → 0
```

REPORT does not mention NMSE (none present). **No omission.**

### 5d. EXIT= lines

All 4 ops logs: `EXIT=1` at line 2502. REPORT quotes all 4. **MATCH.**

### 5e. Thermal gates 8/8 GATE_PASS

```
gate_pre_r1_ctrl.txt: GATE_PASS
gate_pre_r2_fix.txt: GATE_PASS
gate_pre_r3_ctrl.txt: GATE_PASS
gate_pre_r4_fix.txt: GATE_PASS
gate_post_r1_ctrl.txt: GATE_PASS
gate_post_r2_fix.txt: GATE_PASS
gate_post_r3_ctrl.txt: GATE_PASS
gate_post_r4_fix.txt: GATE_PASS
```

REPORT quotes all 8 as GATE_PASS. **MATCH.**

### 5f. failing_*.txt all name only the census q4_0 shape

All 4 failing files contain exactly:
```
Failing tests:
  MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1)
  Backend HTP0: [1;31mFAIL[0m
```

Single failing test = census q4_0 shape. No other failures. **MATCH.**

**OMISSION verdict: CLEAN. All counts, exits, gates, and failing tests verified.**

---

## FINAL VERDICT

| Section | Verdict |
|---------|---------|
| §1 Fabrication/Drift | **CONFIRMED** — all quotes verbatim, all line numbers correct |
| §2 Verdict Integrity | **CONFIRMED** — grid case 2 correct, arm mapping correct, numbers correct |
| §3 Fix Pair Sentence | **FIX** — "those runs use different host-library bytes" is wrong; r2_fix and r4_fix use the SAME lib |
| §4 Overclaim | **CONFIRMED** — no overclaim, ledger correct, containment gate intact |
| §5 Omission | **CONFIRMED** — all counts verified, no omissions |

**FIX.** One finding: the fix-pair sentence in the Index observations section misstates which runs differ. Correct the wording to say the control and fix arms use different library bytes, making the NaN index lib-sensitive. Everything else is clean — no fabrications, no overclaims, no omissions.
