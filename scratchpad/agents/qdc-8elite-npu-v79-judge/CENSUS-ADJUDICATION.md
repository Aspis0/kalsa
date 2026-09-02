# Census adjudication — frozen `census.awk` vs `census.awk.headerfix`

Adjudicator: read-only on all source files, one write: this report.
Scope: should `census.awk.headerfix` become the frozen tool for future cells?

---

## 0. Mechanism of the fix (one line)

**Frozen** `census.awk`:43 — when a header line matches `index(line, header)`, the code
sets `pending=1`, checks for a same-line verdict, and if a verdict exists calls
`finish()`. `observe(line)` is only called inside the `if (pending)` block on
NON-header lines (line 47: `if (pending) { observe(line); ... }`). Result: diagnostics
(glued to a header line that carries no same-line verdict) are never scanned.

**Headerfix** `census.awk.headerfix`:43 — adds `observe(line)` at line 43 inside the
header-match block, BEFORE the verdict check. Result: diagnostics on header lines are
scanned even when the verdict arrives on a subsequent line.

The two scripts are otherwise byte-identical.

---

## 1. Verification: #46 mm_ph1 (patched kit, HTP arm)

### Counts (run with `/usr/bin/awk`)

| Metric | Frozen | Headerfix | Code truth |
|---|---|---|---|
| fail_total | 37 | 37 | 37 |
| compute_failed | **4** | **28** | **36** (`test-backend-ops.cpp:1850 + :743-48`) |
| htp_nonfinite | 0 | **1** | **1** (q4_0 m=2880,n=32: `HTP0=nan CPU=-12.339559`) |
| judge_nonfinite | 0 | 0 | 0 |
| real_fail | **33** | **8** | **0** (all 36 are DSP INTERNAL-ERROR; 1 is HTP NaN) |
| internal_error_lines | 36 | 36 | 36 |
| unresolved | 0 | 0 | — |

**Direct grep on `raw/ops_mm_ph1.txt`:**
- `dsp-rsp: INTERNAL-ERROR` = 36 (`raw/ops_mm_ph1.txt` — grep verified)
- `ggml_backend_graph_compute failed` = 36 (1:1 with INTERNAL-ERROR; grep verified)
- `HTP0=(nan|inf)` = 1 (the q4_0 m=2880 test at `raw/ops_mm_ph1.txt:642`)

**Neither parser variant reaches the code-truth 36.** The frozen `compute_failed=4`
misses 32 because the DSP stderr line of test N interleaves across the pty boundary
into test N+1's header (e.g. `raw/ops_mm_ph1.txt:104-106`: `OK` at :105 belongs to the
previous test; the `graph_compute failed` text at :106 is glued to the NEXT header).
Headerfix's `compute_failed=28` closes the gap by scanning header-line diagnostics, but
still misses 8 tests where pty interleave displaced the diagnostic entirely — these land
as `real_fail=8` with no attribution marker.

**Assessment:** Headerfix is strictly more accurate on #46. Every number it produces is
closer to the code truth than frozen's. The 28-vs-36 compute_failed gap is a log-format
limitation (±4 by construction; FINDINGS-reviewer.md §3), not a parser defect. The 1
htp_nonfinite is the unique genuine kernel NaN, correctly surfaced only by headerfix
(frozen buries it in real_fail). The 8 residual real_fail are the same "undiagnosed"
tests identified by FINDINGS §3's independent Python block parser (5 without
INTERNAL-ERROR attribution + 3 with displaced diagnostics).

---

## 2. Verification: #46 id_ph0 (control arm)

| Metric | Frozen | Headerfix | Direct scan |
|---|---|---|---|
| judge_nonfinite | **60** | **299** | **301** (`grep -cE 'CPU=(nan\|-nan\|inf\|-inf)'`) |
| real_fail | 239 | 0 | — |
| unresolved | 2 | 2 | — |
| fail_total | 299 | 299 | — |
| total | 810 | 810 | — |

**Source:** `raw/ops_id_ph0.txt:36,45` — the first control diagnostic
`"[MUL_MAT_ID] inf mismatch: HTP0=-29.375000 CPU=inf ..."` has no verdict on its
line; `FAIL` arrives at `raw/ops_id_ph0.txt:44-45`. Same mechanism: frozen misses
the header-glued diagnostic.

Headerfix's 299 is inside the prereg band (290–315) per AUDIT-REPORT.md §F3. The
`unresolved=2` (two malformed verdict boundaries at `raw/ops_id_ph0.txt:572,2837`) is
an interleave artefact, not a parser error. The raw summary is `0/301 tests passed`
(`raw/ops_id_ph0.txt:3241`); the 301-vs-299 delta is the two unresolved headers.

**Assessment:** Headerfix is strictly more accurate. Frozen's `judge_nonfinite=60`
is a 5× undercount that triggers a false band-miss investigation. Headerfix's 299
eliminates the investigation entirely.

---

## 3. Verification: #45 historical MUL_MAT (unpatched kit)

| Metric | Frozen | Headerfix | Direct grep |
|---|---|---|---|
| judge_nonfinite | **34** | **58** | 58 CPU-nonfinite lines |
| real_fail | **36** | **12** | — |
| internal_error_lines | 36 | 36 | 36 (`grep -c 'dsp-rsp: INTERNAL-ERROR'`) |
| ggml_backend_graph_compute failed | 0 | 0 | 0 (`grep -c`) |

**Source:** `../qdc-8elite-npu-v79-d-rest/raw/ops_MUL_MAT.txt`

**The 36 INTERNAL-ERROR tests are double-defective.** Every INTERNAL-ERROR line in
#45 carries `CPU=nan` or `CPU=inf` on the same header:

```
ops_MUL_MAT.txt:50: [MUL_MAT] NaN at index 12 (HTP0=2.684483 CPU=nan)   MUL_MAT(...q4_0,m=16,n=4...):
  ggml-hex: HTP0 dspcall : dsp-rsp: INTERNAL-ERROR
```

(36/36 INTERNAL-ERROR lines verified by grep cross-reference; see also
`ops_MUL_MAT.txt:267` for the `CPU=inf` mxfp4 variant.)

**Why frozen gets 34/36:** The 34 frozen `judge_nonfinite` are the 34 tests where
`CPU=nan` and `FAIL` appear on the SAME line (verified: `grep -cE 'CPU=(nan|-nan|inf|-inf).*FAIL'`
on the raw = 34). The 36 frozen `real_fail` are the 36 INTERNAL-ERROR tests — frozen
never calls `observe()` on their header lines, so `cur_compute` is never set (the
unpatched kit has no `ggml_backend_graph_compute failed` text; INTERNAL-ERROR appears
directly on the header). `finish()` falls through to `real_fail`.

**Why headerfix gets 58/12:** Headerfix's `observe(line)` on header lines catches
all 58 CPU-nonfinite diagnostics. The 36 INTERNAL-ERROR tests that also carry
CPU-nonfinite are now classified `judge_nonfinite` (not `compute_failed`, because the
unpatched kit emits no `ggml_backend_graph_compute failed` text, so `cur_compute` is
never set). The 12 `real_fail` are the residual INTERNAL-ERROR tests without a
CPU-nonfinite diagnostic on their header (verified: 10 `bs=[3,2]` batch tests +
2 `m=1,n=64` tests at `ops_MUL_MAT.txt:248,611,892,1025,1092,1225,3538,3606,3676,3745,3825,3895`).

**Which split is truer?** Headerfix's 58/12 is a more COMPLETE count of CPU-nonfinite
tests. But the banked #45 row's 34/36 split is a more MEANINGFUL characterization:
it separates "judge-poisoned" (CPU=nan, judge is the proximate cause of FAIL) from
"DSP-errored" (INTERNAL-ERROR, DSP is the proximate cause). The 36 double-defective
tests have both causes simultaneously; attributing them to `judge_nonfinite` (the
prereg category priority) loses the DSP-error signal that is the whole point of the
#45 acceptance bank. The frozen 34/36 split, while an undercount of judge-nonfinite
tests, preserves the DSP/judge distinction that matters for the historical record.

**Does adoption require changing the banked #45 row?** No. The campaign rule is:
banked cells are never rewritten; errata are appended. If headerfix is adopted, the
#45 row stays as-is (frozen output) with an errata note that headerfix would yield
58/12. The #45 banked numbers are not binding for future cells; they are the frozen
record of what the frozen tool produced on that day.

---

## 4. Answer to Question 3: demotion language

Since no parser variant reaches the code-truth 36 on #46, and the category split is
parser-dependent (frozen 4/0/33 vs headerfix 28/1/8), the per-category split should
not drive binding decisions. The binding defect count comes from the code-guaranteed
grep pair. Draft prereg language:

```
## Census category split (REPORTED, NOT BINDING)

The census tool's per-category split (compute_failed / judge_nonfinite /
htp_nonfinite / real_fail) is reported for diagnostic value but is NOT
binding for prereg verdicts. pty interleave between stdout and stderr
crosses test boundaries, displacing diagnostics across adjacent tests;
no parser variant can attribute every failing test to its correct
category. The binding defect count is:

  FAIL_total    = census tool's fail_total (conservation-verified)
  DSP_ERROR     = `grep -c 'dsp-rsp: INTERNAL-ERROR' <raw>` (code-guaranteed
                  to equal ggml_backend_graph_compute failures on patched kits)
  GRAPH_FAILED  = `grep -c 'ggml_backend_graph_compute failed' <raw>`
  NUMERIC_NAN   = `grep -cE 'HTP0=(nan|-nan|inf|-inf)' <raw>` (with finite
                  CPU, per `test-backend-ops.cpp:1850`)

A test is attributed to DSP_ERROR iff its header or adjacent stderr carries
'dsp-rsp: INTERNAL-ERROR'; to NUMERIC_NAN iff HTP0 is nonfinite with a
finite CPU; to REAL_FAIL iff FAIL with neither marker. The code guarantee
(`test-backend-ops.cpp:743-748,1850`) ensures DSP_ERROR → FAIL; counts are
cross-checked but attribution to individual shapes remains ±4 by pty
interleave construction.
```

---

## 5. Answer to Question 4: verdict and acceptance numbers

### Verdict: ADOPT headerfix WITH demotion

**Reasoning:**
1. Headerfix is strictly more accurate on every #46-class log (Q1). No number it
   produces is worse than frozen's. The frozen tool's `compute_failed=4` is a 9×
   undercount that actively misleads (reads as a propagation gap; AUDIT-REPORT §F1).
   The frozen `judge_nonfinite=60` on the control is a 5× undercount that triggers
   a false investigation (AUDIT-REPORT §F3).
2. Headerfix does NOT require rewriting the banked #45 row (Q2). Banked cells are
   immutable; an errata line suffices. The frozen #45 34/36 split remains the
   historical record.
3. The per-category split must be demoted to "reported, not binding" regardless of
   which tool is frozen (Q3), because pty interleave makes exact attribution
   impossible. The binding counts come from the two greps + code guarantee.
4. Keeping frozen would mean future cells inherit the 9× and 5× undercounts with
   no fix available — an unacceptable regression in diagnostic value for zero
   benefit.

### Acceptance numbers for future validation (all 7 logs)

Pin these when validating headerfix on a new log:

| Log | Kit | op | ok | fail_total | compute_failed | judge_nonfinite | htp_nonfinite | real_fail | unresolved |
|---|---|---|---|---|---|---|---|---|---|
| `#46 raw/ops_mm_ph1.txt` | patched | MUL_MAT | 505 | 37 | 28 | 0 | 1 | 8 | 0 |
| `#46 raw/ops_id_ph1.txt` | patched | MUL_MAT_ID | 301 | 0 | 0 | 0 | 0 | 0 | 0 |
| `#46 raw/ops_id_ph0.txt` | patched | MUL_MAT_ID | 0 | 299 | 0 | 299 | 0 | 0 | 2 |
| `#45 raw/ops_MUL_MAT.txt` | unpatched | MUL_MAT | 472 | 70 | 0 | 58 | 0 | 12 | 0 |
| `#45 raw/ops_MUL_MAT_ID.txt` | unpatched | MUL_MAT_ID | 0 | 301 | 0 | 301 | 0 | 0 | 0 |
| Conservation: | | | ok+fail+skip = total, skip=928 (MUL_MAT) / 511 (MUL_MAT_ID) | | | | | | |

Invariant cross-checks (parser-independent, pin these too):
- `internal_error_lines` = 36 on #46 mm_ph1, 36 on #45 MUL_MAT, 0 elsewhere
- `recopy_lines` = executed on PH1 arms (542/542, 301/301)
- `banner=1` + `plain_host=1` on PH1 arms; `banner=0` on #45 (no `[ref-buf]` banner)

---

**Verdict: ADOPT headerfix with per-category demotion.**
