# FINDINGS — reviewer notes on the #46 raw (Claude Fable, personal review under the
# owner's 1/09 direct-work window; independent of the REPORT writer)

Purpose: settle the two census anomalies BEFORE the REPORT/AUDIT bank them wrongly.
All quotes from `raw/ops_mm_ph1.txt` / `raw/ops_id_ph0.txt` after ANSI strip.

## 1. Kit error propagation is COMPLETE (not a gap)

```
grep -c 'dsp-rsp: INTERNAL-ERROR'            raw/ops_mm_ph1.txt  → 36
grep -c 'ggml_backend_graph_compute failed'  raw/ops_mm_ph1.txt  → 36
```
1:1. Every DSP INTERNAL-ERROR now makes `ggml_backend_hexagon_graph_compute` return
`GGML_STATUS_FAILED`, the judge compare prints
`compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed)`
and the test FAILs (e.g. `ops_mm_ph1.txt:104-106`, `:114-116`, `:305-308`). The
error-swallowing at `ggml-hexagon.cpp` flush_pending (`// TODO: handle errors`) is
closed on v79: no INTERNAL-ERROR test compares a random fill any more.

The frozen `census.awk` reported `compute_failed=4`, which reads as a propagation gap.
It is NOT: the failure text is usually printed ON the test header line, before any
verdict token (`ops_mm_ph1.txt:106`: `  MUL_MAT(...m=16,n=5...): compare_graph_backend_judge:
ggml_backend_graph_compute failed. status=...`), and the frozen script only runs
`observe()` on a header line when that same line already carries a verdict. Diagnostics
glued to a verdict-less header are therefore missed (they were never exercised by the
#43/#45 acceptance logs, which had no such lines).

## 2. Control band-miss (60 vs ~301) has the same cause

Frozen census on `ops_id_ph0.txt` (PLAIN_HOST=0): `judge_nonfinite=60 real_fail=239`.
With the header-observe fix (`census.awk.headerfix`, one added `observe(line)` call):
`judge_nonfinite=299 real_fail=0 unresolved=2 total=810` — inside the prereg band
(290–315). Two headers have no verdict (`unresolved=2`, hence 810 not 812); the log ends
with `EXIT=1` (present), so it is an interleave artefact at the summary boundary, not a
truncation. Substantive control result, parser-independent: **299 FAIL with the judge
off vs 0 FAIL with it on, same op class, same kit, same device** — the env switch is the
variable.

## 3. Why the header-observe fix is NOT silently adopted tonight

It also changes the historical #45 acceptance numbers: `#45 ops_MUL_MAT.txt` goes
`judge_nonfinite 34 → 58, real_fail 36 → 12`. Reason: in the UNPATCHED #45 log the
INTERNAL-ERROR tests carry `CPU=nan` on the same header line
(`qdc-8elite-npu-v79-d-rest/raw/ops_MUL_MAT.txt:50`), i.e. they were simultaneously
judge-poisoned AND DSP-errored; the fix attributes them to `judge_nonfinite` first (the
prereg's category order). That is a definitional change to a banked cell's split, and it
belongs to the hostile audit, not to a late-night edit of a frozen tool. Robust #46
verdicts do not depend on it (§5).

With the fix on #46 `ops_mm_ph1.txt`: `compute_failed=28 htp_nonfinite=1 real_fail=8`
(total 37). The remaining 28-vs-36 gap is boundary interleave: the async DSP stderr
line of test N can land after test N+1's header (e.g. `:104-106`: the `OK` at `:105`
belongs to the previous test, the header at `:106` already carries the next failure).
A second, independent block parser (Python, header→verdict blocks) attributes 32 of
the 37 fails to INTERNAL-ERROR and leaves 5 without one:

```
MUL_MAT(type_a=q4_0,  m=2880,n=32,k=2880)
MUL_MAT(type_a=q4_0,  m=1,n=2048,k=8192)      ← #43's "undiagnosed q4_0 m=1 n=2048"
MUL_MAT(type_a=q4_1,  m=1,n=64,k=256)         ← #43 INTERNAL-ERROR outlier family
MUL_MAT(type_a=iq4_nl,m=1,n=64,k=256)         ← same family
MUL_MAT(type_a=q8_0,  m=6,n=4096,k=5120)
```
Attribution is ±4 tests by construction of the log. Any REPORT wording must say
"37 MUL_MAT FAIL: 36 INTERNAL-ERROR dsp-rsp lines (1:1 with graph-compute failures),
attribution to individual shapes ±4 because DSP stderr interleaves across test
boundaries; shapes listed", never "33 real_fail".

## 4. Follow-up for the next kit (not this cell)

Make the harness attribution exact: print a per-test id on the library's error line
(session name + a graph sequence number) or run `-o MUL_MAT` with `-p`/shape filters so
each failing shape gets its own invocation. Then a census is trivial and the ±4 vanishes.

## 5. What is robust regardless of the parser

- `judge_nonfinite = 0` on both PLAIN_HOST=1 arms (frozen and fixed census agree).
- `recopy_lines = executed`: 542/542 and 301/301 (grep-exact).
- `ok + FAIL + skip` = 1470 / 812 (grep-exact conservation).
- MUL_MAT_ID: **301/301 OK** (`ops_id_ph1.txt` summary `301/301 tests passed`).
- Control: 299 FAIL off vs 0 FAIL on (MUL_MAT_ID).
- PPL: ship 40.2720 vs 40.2837 (r −0.029 %), OLMoE 9.0620 vs 9.0562 (r +0.064 %),
  all four `EXIT=0`.
