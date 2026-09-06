# AUDIT — 750 f16 MUL_MAT analysis + gate (qdc-750-mulmat-view)

## Findings

F1 — CONFIRMED (analysis line-by-line). All quoted file:line anchors reproduce in the fork
worktree kalsallama-wt-oclpicks-25910: test-backend-ops.cpp:4077-4170 (bs/nr/k_v/o semantics;
the failing view is created at :4161-4162 with view_offs `0` — `o` only repeats outputs);
l4 kernel `mul_mv_f16_f32_l4.cl:498` `src0 = (global char *)((global char *)src0 + offset0);`,
`:519` `const ulong off = r0c * nb01 + (i12 / r2) * nb02 + (i13 / r3) * nb03;`, `:520`
`x4_o[o] = (global half4 *)(src0 + off);`; generic `mul_mv_f16_f32.cl:63`
`ulong offset_src0 = r0*nb01 + (i12/r2)*nb02 + (i13/r3)*nb03;` — the generic kernel is
stride/batch/offset-aware exactly as claimed (also :65 `x = (global half *)(src0 +
offset_src0)`), and r2/r3 are computed identically for both selections. Tensor table correct:
nb01 = 2×2112 = 4224, k_v=k nb01 = 2112, 4224 % 16 = 0, 2112 % 16 = 0 (half4 alignment holds
for both layouts).
F2 — CONFIRMED (the unexplained core, as stated). The l4_y8 kernel IS stride-aware (quotes in
F1) and the visible ne/local sizes are unchanged by the view (1056 % 4 = 0, 128 % 8 = 0), so
"the view changes strides, not sizes" is right — and the analysis does not identify what
differs on the 750. The kernel's sub-group machinery (`intel_reqd_sub_group_size` /
`cl_qcom_reqd_sub_group_size` / `qcom_reqd_sub_group_size("half"|"full")`,
mul_mv_f16_f32_l4.cl:12-18) is a plausible miscompile vector with strided rows — PLAUSIBLE,
unproven; the analysis should label it a hypothesis.
F3 — REFUTED (my hostile check): the compiler-version discriminator does not hold. The
qdc-7pg3-govbench-52 raws contain BOTH `Compiler E031.45.02.06` and `Compiler E031.45.02.16`
lines — the 732 also ran with .02.06 and still passed 925/925 — so a version-narrowed gate
(upstream-#26476 style; the backend already parses the compiler version,
ggml-opencl.cpp:152,163,297 `get_adreno_cl_compiler_version`) would be WRONG: the defect may
not be version-conditional. The chosen board-based scope (`gpu_family == ADRENO`) is the
right one.
F4 — CONFIRMED (gate 2f3b24dee). `const bool adreno_noncontiguous_src0 =
backend_ctx->gpu_family == ADRENO && !ggml_is_contiguous(src0);` and the dispatch
`if (adreno_noncontiguous_src0) { kernel = backend_ctx->kernel_mul_mat_f16_f32; nrows = 4; }
else if (ne11*ne12 < 4) { …1row } else if (adreno_use_lane_split …) { …l4_dr_lq } …` —
the gate routes the whole F16×F32 branch (non-contiguous src0, all Adreno) to the generic
kernel with nrows=4. Contiguous cases (k_v == k, nb01 == ne00×2) are NOT gated ✓; the failing
k_v=2112 cases (nb01=4224 ≠ 2112) are ✓ — the prediction "all 20 turn PASS" is exactly the
gate's behavior, falsifiable by the three pre-registered tests.
F5 — MINOR, PLAUSIBLE. The gate also reroutes in-app batched VIEW matmuls on the 8 Elite and
the 732 (K-cache views in prefill K·Q with GQA) to the slower generic kernel — a performance
regression on the 830 is plausible (the l4_y8 is the fast path; pp512 #58 = 291 t/s was the
750). The PREREG's perf guard covers only the 750 pp512 ±10% — an 8-Elite pp512 bench is
ABSENT from the device test list — add it before adopting the gate.
F6 — MINOR, CONFIRMED. The pre-registered test list lacks an explicit n>1-view case (the
failing family has o=1; `o` only repeats outputs) — add `o=2` (or a view with a non-zero
`view_offs`) MUL_MAT on the 750 to the regression matrix; MUL_MAT_ID 407/407 and
FLASH_ATTN_EXT guards are present ✓.
F7 — CONFIRMED-checks: the baseline-first procedure (step 0, reproduce the 20 FAIL on
12f6d9b6d before counting the candidate) is sound; the fix-as-chosen (option b of Amendment
1) matches the pre-registered Amendment 1; the bare 178a6c449-cherry-pick prediction (H1
REFUTED — the change is quantized-only, F16/F32 excluded) was stated before the run ✓.

## Verdict

GO — build the candidate kit (12f6d9b6d + 178a6c449 + the 2f3b24dee gate) and run the
pre-registered device test on QRD8650. 0 blockers, 2 minors (F5: add an 8-Elite pp512
perf-regression bench to the same session; F6: add an o>1 / non-zero-view_offs MUL_MAT case),
1 nit (F2's unproven hypothesis should be labelled). Gate scope recommendation: keep
`gpu_family == ADRENO && !ggml_is_contiguous(src0)` as-is — the all-Adreno board-based scope
is correct; do NOT narrow by compiler version (F3 refuted).
## Delta audit #21 — d_run.sh

F1 — BLOCKER, CONFIRMED: the fail count is 40, not 20. Running the driver's clean+count
against the real 58 file (raw/tbo_mm_sa802498.out): pass=905 ✓ but fail=40 (expected 20).
Cause: the output format is `  MUL_MAT(...): FAIL` (with a COLON before FAIL) and the file
additionally carries a bare `  MUL_MAT(...)` duplicate line per failing shape. The driver's
formula `fail=$( { grep -E "^  ${op}\\(.*FAIL[[:space:]]*$"; grep -E "^  ${op}\\(.*\\)[[:space:]]*$"; } | sort -u | wc -l )` counts the 20 `: FAIL` lines AND the 20 bare-")" duplicate
lines → 40. The BASELINE_GATE at line 118 (`if [ "$label" = baseline ] && [ "$LAST_FAIL" -ne
20 ]` → `exit 6` with END_REASON=baseline_gate) can then never pass → the whole cell always
stops before the candidate. Same defect in the fail-case extraction (line 73 regex — 40
lines, including the 20 duplicates — I checked: 0 of them end OK, so no PASS lines are
matched, but the duplicates inflate it). Fix: count/quote `: FAIL` only
(`grep -E "^  ${op}\\(.*: FAIL[[:space:]]*$"`), and drop the bare-`)` alternative (or make
it `: FAIL|FAILED`); re-validate on the 58 file → 20.
F2 — MAJOR, CONFIRMED: view_counts measures the wrong dimension. The failing family is
`m=128, n=1, k=1056, k_v=2112, o=1` with bs>1 and nr0=4 (per PREREG). The driver's
sub-filters `k_v>k && n>1` and `k_v>k && o>1` produce (on the real file) `n>1 pass=1
fail=0` and `o>1 pass=1 fail=0` — i.e. they capture nothing of the defect (its n=1, o=1).
The promised sub-counts must filter on the pre-registered signature (b≠[1,1] / the
(bs0,bs1,nr0) family), not on n/o.
F3 — CONFIRMED (hot path): set -u, every adbT has a timeout (30-2400); no `local a=$1
b=${a}` anywhere; the nohup+.exit polling is bounded by the step cap plus ≤75 s (sleep 15 +
cat cap 60); pkill with the bracket trick; deadline_check per step inside run_device_step;
the EXIT trap `trap 'rc=$?; log "END reason=$END_REASON rc=$rc"; exit "$rc"'` captures rc
BEFORE the log call — log's echo cannot clobber it; `exit 124` in deadline_check reaches the
trap with rc=124 and END_REASON=deadline, and `exit 6/7/5` variants carry their END_REASON
(thermal/baseline_gate/…) correctly.
F4 — CONFIRMED (kits): both tarballs list top-level `bin/`, `lib/`, `GIT_SHA`, `SHA256SUMS`
with RELATIVE paths (`bin/llama-bench`, `bin/test-backend-ops` …) — `sha256sum -c` with
cwd=$dir works; the kit content is sha-listed (GIT_SHA itself included in SHA256SUMS);
kit_sha via `tar -xOf` on macOS with the 40-hex validation; LD_LIBRARY_PATH=$dir/lib + cd
$dir/bin; the model pushed once with device-sha verification and shared across kit dirs
($REMOTE/$sha naming per kit).
F5 — CONFIRMED: the gate script path and semantics match cell 58 (58's d_run.sh:15
GATE=../kexp-speed-cell/thermal_gate.sh; :30-33 pre-retry 3×/60 s → return 7; :105 post
`|| true`) — same thresholds by shared script; skin/gate evidence written per step.
F6 — CONFIRMED: the tbo invocation `./test-backend-ops test -b GPUOpenCL -o MUL_MAT` matches
cell 58's proven line (58 d_run.sh:118 — the "test" positional is the 58-proven binary
format; my initial stray-arg suspicion REFUTED); bench `-t 4 -ngl 99 -fa 0 -p 512 -n 128 -r
3 -o md` matches the 58-era bench flags.

## Verdict

NO-GO for the device run until F1 is fixed (count `: FAIL` only; re-validate → 905/20 on the
58 file) and F2's sub-counts are re-filtered to the pre-registered b/nr signature. 1 blocker
(F1), 1 major (F2); F3-F6 confirmed clean.

## Delta audit #21b

F1 — CONFIRMED-FIXED. count_tbo (d_run.sh:50-70) now greps the colon forms:
`pass=$(grep -E '^  MUL_MAT\(.*: OK[[:space:]]*$' "$clean" | wc -l)` and
`fail=$(grep -E '^  MUL_MAT\(.*: FAIL[[:space:]]*$' "$clean" | wc -l)` — the bare-`)`
alternative is gone. Ran the logic on ../qdc-8g3-rerun-58/raw/tbo_mm_sa802498.out:
**pass=905, fail=20** (previous 40); fail_cases extraction = exactly **20 distinct `: FAIL`
signatures**, 905 `: OK` lines, zero OK lines in the fail file; the summarized LAST_FAIL=20 →
d_run.sh:137 `[ "$LAST_FAIL" -ne 20 ]` → BASELINE_GATE now passes.
F2 — CONFIRMED-FIXED. The awk sub-counts parse m/k/k_v/n and bucket `kv>k`:
`family(kv==2112 && m==128 && n==1) pass=28 fail=20` and `other kv>k pass=145 fail=0` — the
20 failures are all captured by the pre-registered family and none leak into "other".
Unchanged since #21: the EXIT trap (:16), deadline_check (:23), thermal_gate 3×/60 s with
GATE_ABORT return 7 (:40), and the BASELINE_GATE exit 6 (:137) are byte-identical to the
previous read; only count_tbo/summarize were rewritten.

## Verdict

GO for the device run — F1/F2 fixed and validated on the real baseline file
(905/20, family 28/20, other 145/0, 20 distinct fail signatures), gate and trap untouched.
