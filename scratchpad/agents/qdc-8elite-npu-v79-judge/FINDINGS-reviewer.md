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

## 6. PPL arms: execute-op proof ABSENT → METHOD-VOID by the prereg's letter (reviewer's own omission)

`raw/ppl_ship_htp.txt` and `raw/ppl_olmoe_htp.txt` are 12 lines each: zero `ggml-hex`
lines, zero `execute-op` lines (host capture and device tee identical). Cause: the
prereg command omits `-v`. q55's binding command (`q55-v75-npu-correctness/PREREG.md:20-22`)
was `llama-perplexity -ngl 99 -dev HTP0 -c 2048 -b 2048 -ub 1024 -fa on --load-mode none
--chunks 32 -v`; #46's PREREG rev-3 dropped `-v` (prereg author = this reviewer). Without
`-v`, `llama-perplexity`'s log filter suppresses the backend's INFO-level verbose lines
that `GGML_HEXAGON_VERBOSE=1` emits (the kit's `--help`, `raw/perplexity_help.txt:200`:
`-v, --verbose, --log-verbose  Set verbosity level to infinity`). The env var was set; the
tool did not print. Method error, not a device event.

PREREG rev-3, arm 4 (binding): "**Proof absent → METHOD-VOID for that arm** (no PPL
number banked; PASS/GREY/FAIL impossible), per q55's 'proof lost → VOID' rule." → both
PPL arms are METHOD-VOID for certification purposes in #46. The numbers are recorded as
report-only.

Circumstantial evidence that the HTP arms DID execute on HTP0 (recorded for an
AMENDMENT the hostile audit may accept or reject; not applied by the reviewer):

| witness | ship | OLMoE |
|---|---|---|
| wall time HTP vs CPU (gate_pre→gate_post mtimes) | 81 s vs 423 s = **5.2×** | 80 s vs 491 s = **6.1×** |
| tool-internal clock at `Final estimate` | 1:19.3 vs 7:01.4 | 1:18.0 vs 8:08.3 |
| device selected (`W ... device HTP0 did not report memory`) | yes, `-ngl 99` | yes, `-ngl 99` |
| PPL differs from CPU twin (a silent CPU fallback is deterministic → identical) | 40.2720 ≠ 40.2837 | 9.0620 ≠ 9.0562 |
| same kit/device/session executed on HTP minutes earlier (ops arms: DSP responses) | `backend_htp0=1`, 505 OK, 36 dsp-rsp | idem |

Expected HTP/CPU prefill ratio from #43/#45 anchors ≈ 7×; 5–6× with load and upload
overheads is consistent; a CPU fallback would give ≈1×. Thermal snapshots after the CPU
PPL arms reached HAL 74.1 / 77.2 °C with Thermal Status 3 (`gate_post_ship_cpu`,
`gate_post_olmoe_cpu`); all PRE gates passed (max 57.9 °C, status ≤ 1; `olmoe_cpu`
after one 3-min wait). Snapshots are informational per prereg; the in-run excursion is
the #43 CPU pattern and is reported, not hidden.

**Consequence for banking:** judge repaired = CLOSED on the ops evidence; MUL_MAT_ID
patched-correct = CLOSED; numerical certification = OPEN (VOID), Session 1 D does NOT
close on correctness from #46 alone. **Follow-up cell #47** (cheap, ~15 min QDC): re-run
the two HTP PPL arms with `-v` (kit unchanged 93e9592fa, same corpus/models/flags);
CPU twins may be reused from #46 only if #47's prereg says so up front (CPU PPL is
deterministic for identical binary+model+corpus+flags) — otherwise rerun them too.
