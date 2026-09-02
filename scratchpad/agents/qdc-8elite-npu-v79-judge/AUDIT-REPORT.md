# AUDIT — cell #46 REPORT.md, hostile (reviewer: Claude Fable, under the owner's
# 1/09 direct-work window; writer of REPORT.md was Luna → different weights, writer≠auditor holds)

**Disclosure of conflict:** this auditor also authored the #46 PREREG and
`FINDINGS-reviewer.md`, and the PPL `-v` omission (F3) is this auditor's error. The
PPL-VOID finding is against the author's interest and is kept as the binding call.

Verdict: the REPORT's numbers are accurate to the raw and its top-line verdicts
(MUL_MAT_ID patched-correct; MUL_MAT not; PPL VOID; D OPEN) are correct. Two MAJOR
mischaracterizations of the MUL_MAT defect split must be fixed before banking, and the
"judge PROVISIONAL" call should be reconsidered against the raw. Then APPLY.

## F1 — MAJOR. Investigation 2's "(c) undetermined / INTERNAL-ERROR→OK" is REFUTED by source

REPORT (`## Investigation 2`) concludes "**(c) undetermined**" and cites
`INTERNAL-ERROR→OK` and `INTERNAL-ERROR→not supported` pairs (raw `ops_mm_ph1.txt:104-105,
1116-1117`) as if a DSP-errored test could pass or be skipped. It cannot.

Source (`kalsallama/tests/test-backend-ops.cpp`):
- `:1846` `const bool cmp_ok = compare_graph_backend_judge(...)`
- `:1850` `bool test_passed = ud.ok && cmp_ok;` → `:1857` returns `OK` iff `test_passed`.
- `:743-748` in `compare_graph_backend_judge`: `if (status1 != GGML_STATUS_SUCCESS) {
  fprintf(... "ggml_backend_graph_compute failed" ...); ggml_backend_graph_copy_free(copy);
  return false; }`. A DSP INTERNAL-ERROR makes `ggml_backend_hexagon_graph_compute` return
  `GGML_STATUS_FAILED` (`ggml-hexagon.cpp:3685`), so `cmp_ok=false` → `test_passed=false`
  → **FAIL, always**.

The `OK`/`not supported` tokens adjacent to a `graph_compute failed` line belong to a
DIFFERENT test: `:1160` prints the header `  MUL_MAT(...): ` with `fflush(stdout)` and NO
newline BEFORE compute; the verdict completes the line AFTER compute. The DSP stderr line
interleaves on the merged adb pty between a neighbour's newline and the next verdict.
Determinate count, by grep on the raw: `dsp-rsp: INTERNAL-ERROR` = 36 and
`ggml_backend_graph_compute failed` = 36 (1:1). **All 36 INTERNAL-ERROR are FAILs.**
Answer is (a)-equivalent: complete propagation, not undetermined.

Fix: replace Investigation 2's verdict with "36 INTERNAL-ERROR → 36 `graph_compute
failed` → 36 FAIL (code-guaranteed, `test-backend-ops.cpp:1850`); the frozen census's
`compute_failed=4` is a census-tool undercount (header-glue, `FINDINGS-reviewer.md` §1),
NOT a propagation gap."

## F2 — MAJOR. The 37-shape list mislabels 36 DSP failures as `real_fail`

`## Open MUL_MAT shapes` carries the frozen-census category prefix, so 33 of 37 read
`real_fail:` — which the prereg defines as "both sides finite" numeric mismatch. They are
not: they are DSP `dsp-rsp: INTERNAL-ERROR` graph-compute failures. Correct split
(code + grep + direct scan of `raw/ops_mm_ph1.txt`):

- **36 = DSP INTERNAL-ERROR** (graph-compute failures): q4_0/q4_1/q8_0/mxfp4/iq4_nl at
  `m=16,n∈{5,6,7,8,9,16}` and the `m=1,n=64` family — matches #43's characterization
  (29 at m=16 n=4..8 + outliers).
- **1 = genuine numeric NaN**, the only `HTP0=nan` with a finite CPU value in the whole
  log: `raw/ops_mm_ph1.txt:642` `[MUL_MAT] NaN at index 305 (HTP0=nan CPU=-12.339559) ...
  MUL_MAT(type_a=q4_0,...,m=2880,n=32,k=2880,...)`. That is a real v79 kernel defect on a
  large shape, distinct from the DSP-queue errors, and it is the headline of the v79
  defect list because it is a wrong number, not a refused op.

Fix: relabel the list "36 DSP INTERNAL-ERROR (compute-failed) + 1 numeric NaN
(q4_0 m=2880)"; do not present the 36 as `real_fail`. Adopt `census.awk.headerfix`
(compute_failed 4→28, htp_nonfinite 0→1) for #46 only, or annotate the frozen output;
the header-observe fix's effect on the banked #45 split is a separate item for the
follow-up, not this bank.

## F3 — reconsider "judge PROVISIONAL": the raw meets the control condition exactly

REPORT `## Binding verdict` sets judge = PROVISIONAL because the emitted control census is
`judge_nonfinite=60`, not 301. But the prereg's intent (control reproduces the poison) is
met on the raw: `grep -cE 'CPU=(nan|-nan|inf|-inf)' raw/ops_id_ph0.txt` = **301**, summary
`0/301 tests passed` (`raw/ops_id_ph0.txt:3241`). The `60` is the identical header-glue
undercount as F1/F2 (the header-observe fix yields 299, `FINDINGS-reviewer.md` §2). So the
poison is 301 with the judge OFF and 0 with it ON — a complete, raw-confirmed repair.

Recommendation: state judge = **REPAIRED (raw-confirmed: 301 poisoned FAILs off → 0 on;
recopy_lines=executed 542/301)**, with a noted caveat that the frozen census tool
mis-emits the control count (fix characterized). Keeping "PROVISIONAL" purely on the
tool's letter understates a decisive result; if the campaign prefers the literal reading,
bank PROVISIONAL but cite the 301 raw scan so the audit trail is honest.

## Confirmed against raw (no change needed)

- MUL_MAT_ID PLAIN_HOST=1: `301/301 tests passed`, fail=0, recopy=301, judge=0 →
  **patched-correct CONFIRMED** (was 0/301 all judge-poison in #43/#45).
- Conservation: 505+37+928=1470; 301+0+511=812 — CONFIRMED.
- Banner + `plain_host=1` + `backend_htp0` + `device_hexagon` present on ph1 arms — CONFIRMED.
- PPL numbers exact: ship 40.2720/40.2837 (r −0.029%), OLMoE 9.0620/9.0562 (r +0.064%),
  four EXIT=0 — CONFIRMED; and **VOID is correct**: zero `execute-op` lines because the
  prereg dropped q55's `-v` (this auditor's error); the numbers are report-only; #47
  (`../qdc-8elite-npu-v79-ppl-v/`) re-runs with `-v`. The circumstantial HTP evidence
  (wall 5.2×/6.1×, device HTP0, r≠0) is recorded, not banked.
- Thermal table matches the gate files; in-run CPU excursions (74.1/77.2 °C, status 3
  post-CPU-PPL) are the #43 pattern, disclosed. Billing/clocks match `running.txt`/`serial.txt`.

## Banking recommendation

Bank #46: judge REPAIRED (raw) / PROVISIONAL (tool letter) — campaign's call, evidence
either way in the row; MUL_MAT_ID patched-correct; MUL_MAT defect list = **36 DSP
INTERNAL-ERROR + 1 numeric NaN (q4_0 m=2880)**; PPL ship/OLMoE VOID → #47; Session 1 D
OPEN on ops correctness AND on certification (pending #47). The MoE-experts correctness
headline (301/301) and the single real kernel NaN are the durable results.
