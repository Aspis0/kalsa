# AUDIT-PRERUN — Cell #58 (qdc-8g3-rerun-58)

Date: pre-execution audit. Source files: PREREG.md, d_run.sh, connect.sh in
this folder. Reference: ../qdc-8g3-govbench-55/{PREREG.md,REPORT.md,d_run.sh},
../qdc-cpu-tuned-57/REPORT.md.

---

## 1. PREREG Grid Soundness

### G1 — MUL_MAT census family lock
> "the EXPECTED outcome is 905/925 with all 20 failures in exactly the
> family `type_a∈{f16,bf16}, type_b=f32, m=128, n=1, k=1056, k_v=2112`,
> batch shapes bs=[2..8]×[1,3]"
> "ANY failure outside that family, or a different failure count, DOES
> quarantine this cell's GPU numbers"

**CONFIRMED.** Count (905/925), type params (6 dimensions), batch grid
(14 shapes) are all pinned before the session. A 21st failure, a missing
failure, or any failure outside the stated family trips quarantine. No
post-hoc discretion.

### G2 — MUL_MAT_ID census
> "expected 407/407. Any failure → GPU numbers quarantined"

**CONFIRMED.** Single-number gate, zero ambiguity.

### G3 — GPU bench ±10 % band
> "pp512 and tg128 each within ±10% of #55 (284.18 / 23.42)"

Implied bounds (both sides, both metrics):
- pp512: [255.76, 312.60]
- tg128: [21.08, 25.76]

Consequence is pre-registered: in-band → CONFIRMED + Amendment closed;
out-of-band → #58 supersedes #55, discrepancy banked, repeat cell queued.
**CONFIRMED.** No post-hoc judgment needed in either branch.

### G4 — informative, not a gate
> "GPU pp512 / 98.97 ≥ 2× reaffirms the 750 GPU-prefill lane… Not a gate
> on this cell."

98.97 is #57's fixed tuned-CPU pp512 — not derived from #58's data.
**CONFIRMED.** No cell-data-dependent decidable remains anywhere in the grid.

### Grid verdict: **CLEAN — no #55 sin repeated.**

---

## 2. Driver vs PREREG Consistency

### 2a. Arm match (names, caps, flags, order)

| # | PREREG spec | d_run.sh line | Match? |
|---|---|---|---|
| 1 | `tbo_mm` cap 1200 | `run_arm tbo_mm 1200 "./test-backend-ops test -b GPUOpenCL -o MUL_MAT"` | ✓ |
| 2 | `tbo_mmid` cap 1200 | `run_arm tbo_mmid 1200 "./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID"` | ✓ |
| 3 | `bench_gpu` -ngl 99 -fa 0, -t 4, bare-hex taskset, -r 3, cap 1500 | `run_arm bench_gpu 1500 "taskset $CPU_MASK ./llama-bench -m lfm26.gguf -t 4 -ngl 99 -fa 0 -p 512 -n 128 -r 3 -o md"` | ✓ |

**CONFIRMED.** Three arms, exact match on all parameters, order preserved.

### 2b. Deletion artifacts — dangling references

#55 had 5 arms: tbo_mm, tbo_mmid, bench_cpu, bench_gpu, bench_cpu_pure.
#58 deleted bench_cpu and bench_cpu_pure. Scan for stale references:

- `bench_cpu` in d_run.sh: **none** (grep-clean).
- `bench_cpu_pure` in d_run.sh: **none** (grep-clean).
- Comment blocks: the "R2 CPU bench" and "R2b TRUE CPU bench" comments
  from #55 are gone. Remaining comments (`R1 correctness`, `G4: llama-bench
  itself`, `R3 GPU bench`) all describe code that still exists.

**CONFIRMED.** No dangling references.

### 2c. Last arm rc — no ABORT check on bench_gpu

```
if [ $ABORT -eq 0 ]; then run_arm bench_gpu 1500 "taskset $CPU_MASK ./llama-bench …"; fi
```

No `rc=$?; [ $rc -eq 7 ] || [ $rc -eq 8 ] && ABORT=1` after bench_gpu.
This matches #55's pattern — bench_gpu was also the last arm in #55's
driver and also lacked the ABORT check (along with bench_cpu_pure). Since
nothing follows bench_gpu, an ABORT would only affect the DONE log, which
runs unconditionally. The arm's exit code is captured in its .out file
via the `exit=${E:-NONE}` append. **Acceptable. CONFIRMED.**

### 2d. DIR / device paths

- Mac DIR: `…/qdc-8g3-rerun-58` ✓ (matches folder)
- Device D: `/data/local/tmp/kalsa58` ✓ (unique, no collision with kalsa55)
- No hardcoded `kalsa55` anywhere in the script.

**CONFIRMED.**

### 2e. chmod line

```
chmod 755 llama-bench llama-cli test-backend-ops governor-bench
```

Binaries exercised by the three arms: `test-backend-ops` (tbo_mm, tbo_mmid),
`llama-bench` (bench_gpu). Both chmod'd. `llama-cli` and `governor-bench`
are unused but harmless. **CONFIRMED.**

---

## 3. Bugs — sed/python surgery + semantic checks

### 3a. Comment orphaning
No orphaned comment blocks. The deleted CPU-arm comments were removed
cleanly; the three surviving comment blocks each precede the code they
describe. **CONFIRMED.**

### 3b. `rc=$?` after `[ … ] && ABORT=1`

Pattern:
```
run_arm tbo_mm 1200 …; rc=$?; [ $rc -eq 7 ] || [ $rc -eq 8 ] && ABORT=1
```

Parse tree: `([ $rc -eq 7 ] || [ $rc -eq 8 ]) && ABORT=1` (left-to-right
associativity of `||`/`&&`).

- rc=0 → both brackets false → ABORT untouched ✓
- rc=9 (non-zero test exit = RESULT) → both brackets false → ABORT
  untouched ✓ **(The #118 comment holds: a 9 from tbo_mm is a RESULT, not
  an abort.)**
- rc=7 (gate abort) → ABORT=1 ✓
- rc=8 (launch/clean fail) → ABORT=1 ✓
- rc=142 (adbT SIGALRM) → both brackets false → ABORT untouched. This is
  arguably wrong (an adb timeout during census could be consequential) but
  matches #55's behavior and is out of scope for this audit.

**CONFIRMED** for the intended semantics. The 9-does-not-abort path is
correct.

### 3c. Resume guard
```
PRE=$(adbT 300 -s "$SER" shell "cd $D && sha256sum lfm26.gguf 2>/dev/null" …)
if [ "$PRE" = "$MODEL_SHA" ] && adbT 60 -s "$SER" shell "test -x $D/llama-bench && echo BINOK" | grep -q BINOK; then
```

Checks BOTH model SHA AND binary executable before skipping pushes. Double
guard. **CONFIRMED.**

### 3d. CAP_HIT pkill patterns
```
pkill -f 'llama-benc[h]|test-backend-op[s]|llama-cl[i]'
```

Bracket-trick prevents self-match. Covers all three binary names used in
arms. `|| true` ensures best-effort cleanup doesn't fail the script.
**CONFIRMED.**

### 3e. `set -u` safety
All variables assigned before use. `local start=… E=""` in run_arm
initializes both. No unbound-variable risk under `set -u`. **CONFIRMED.**

### 3f. Stale comment (cosmetic)
```
# ---- R3 GPU bench (Q2) — -fa 0: FA kernels do not compile on Adreno 732 ---
```

"Adreno 732" is a leftover from #52's driver. #58 runs on Adreno 750. Zero
functional impact — the comment describes the flag rationale, not the
target device. **CONFIRMED harmless. Severity: cosmetic.**

### Bug verdict: **CLEAN. No functional defects from the surgery.**

---

## 4. Comparability Traps

### 4a. Kit sha
#58: `gov-kit-5c3979438.tgz` (419bef91…)
#55: `gov-kit-5c3979438.tgz` (419bef91…)
**Same. CONFIRMED.**

### 4b. Model sha
#58: `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`
#55: `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`
**Same. CONFIRMED.**

### 4c. Flags
#58 bench_gpu: `-m lfm26.gguf -t 4 -ngl 99 -fa 0 -p 512 -n 128 -r 3 -o md`
#55 bench_gpu: `-m lfm26.gguf -t 4 -ngl 99 -fa 0 -p 512 -n 128 -r 3 -o md`
**Identical. CONFIRMED.**

### 4d. Arm order → thermal state difference ⚠️

| #55 order | #58 order |
|---|---|
| tbo_mm → tbo_mmid → **bench_cpu** → bench_gpu → bench_cpu_pure | tbo_mm → tbo_mmid → bench_gpu |

In #55, `bench_cpu` (-ngl 0, CPU-only) ran between the census arms and
bench_gpu, giving the GPU a ~1-2 min cool-down under zero GPU load before
the sustained bench. In #58, bench_gpu fires immediately after two
consecutive GPUOpenCL census arms — the GPU may enter the bench at a
higher thermal state.

**Does the PREREG acknowledge this?** No. The PREREG lists the arm order
and mentions "each behind the #38 thermal gate (HAL ≤60 °C, status ≤1,
retry ×3 @60 s)" but does not discuss the arm-order difference from #55
or its potential thermal impact on bench_gpu.

**Is it fatal?** No — mechanically the grid still works:
1. The thermal gate checks HAL ≤60 °C before bench_gpu; if the census
   arms pushed the GPU hot, the gate retries (3× @60 s).
2. If the thermal state pushes numbers outside the ±10% band, G3 triggers
   supersede + repeat — the correct outcome.
3. The census arms (test-backend-ops) run individual matmul test cases,
   not sustained load; their thermal footprint is far lighter than
   bench_gpu's multi-minute -ngl 99 run.

**PLAUSIBLE gap.** The grid handles it; the PREREG analysis should
acknowledge the difference for completeness and to pre-empt any "but #58
ran hot" objection in the REPORT.

### 4e. Quantized-op-set overlap
The 20-FAIL family is f16/bf16 batched view-K matmuls. The ship model is
QAD-Q4_0. The PREREG states "the family has zero overlap with the ship
model's quantized op set." This is the key comparability guarantee: the
correctness finding does not affect the bench numbers. **CONFIRMED.**

---

## 5. Ops Lessons Compliance (#52 REPORT lessons 1-7)

PREREG: "All #52 ops lessons bind: T4 nohup launch, adbT perl-alarm caps,
re-entrant arms (skip on exit=0), bracketed pkill, ref-clicks only on
portal dialogs and Session Status re-verified after End."

| Lesson | Implementation | Verdict |
|---|---|---|
| T4 nohup launch shape | `nohup sh -c 'cd $D; LD_LIBRARY_PATH=$D $3 > … & echo LAUNCH_OK` | ✓ CONFIRMED |
| adbT caps on every adb call | All 19 adb invocations go through `adbT <timeout> …` (grep: zero bare `adb` calls in d_run.sh) | ✓ CONFIRMED |
| Re-entrant arms (skip exit=0) | `grep -q "exit=0" "$RAW/$1_$JOB.out"` at top of run_arm | ✓ CONFIRMED |
| Bracketed pkill | `pkill -f 'llama-benc[h]\|test-backend-op[s]\|llama-cl[i]'` | ✓ CONFIRMED |
| Ref-clicks only on portal | Portal interaction is human-only; driver logs "Remember: End Session" | ✓ CONFIRMED |
| Session Status re-verified after End | Procedure section of PREREG: "Session Status re-verified after End" | ✓ CONFIRMED (by reference) |

### connect.sh

- Port: binds 6037 only, never touches 5037 (Jelly). ✓
- Old tunnel cleanup: kills via `tunnel-current.pid`, checks lsof after. ✓
- Foreign listener guard: exits with code 3 if 6037 still busy after kill
  attempt. ✓
- Environment: `export ANDROID_ADB_SERVER_PORT=6037` before exec d_run.sh. ✓
- Exec: `exec "$DIR/d_run.sh" "$JOB"` — inherits env, replaces process. ✓

**All ops lessons CONFIRMED.**

---

## Summary

| # | Finding | Angle | Severity | Verdict |
|---|---|---|---|---|
| F1 | G1 family lock is tight (6 dimensions + count + batch grid) | Grid | — | CONFIRMED |
| F2 | G2 is a single-number gate | Grid | — | CONFIRMED |
| F3 | G3 ±10% band covers both pp and tg, both sides; consequences pre-registered | Grid | — | CONFIRMED |
| F4 | No post-hoc decidable anywhere in the grid | Grid | — | CONFIRMED |
| F5 | Three arms match PREREG exactly (names, caps, flags, order) | Driver | — | CONFIRMED |
| F6 | No dangling bench_cpu/bench_cpu_pure references | Driver | — | CONFIRMED |
| F7 | Last arm (bench_gpu) lacks ABORT check — matches #55 pattern, acceptable | Driver | — | CONFIRMED |
| F8 | DIR=kalsa58, device D=kalsa58, no kalsa55 bleed | Driver | — | CONFIRMED |
| F9 | chmod covers all binaries the arms execute | Driver | — | CONFIRMED |
| F10 | rc=9 from tbo_mm correctly does NOT abort (#118 semantics preserved) | Bugs | — | CONFIRMED |
| F11 | Resume guard double-checks SHA + binary | Bugs | — | CONFIRMED |
| F12 | pkill bracket-trick correct, covers all arm binaries | Bugs | — | CONFIRMED |
| F13 | Stale "Adreno 732" comment — cosmetic only | Bugs | LOW | CONFIRMED |
| F14 | Kit sha, model sha, flags identical to #55 | Comparability | — | CONFIRMED |
| F15 | Arm order differs from #55 (no CPU cool-down before bench_gpu); PREREG does not acknowledge | Comparability | MEDIUM | **PLAUSIBLE** |
| F16 | All #52 ops lessons implemented (T4, adbT, re-entrant, bracketed pkill, portal) | Ops | — | CONFIRMED |
| F17 | connect.sh port hygiene clean (6037 only, foreign-listener guard) | Ops | — | CONFIRMED |

---

## Verdict

**16/17 CONFIRMED, 1 PLAUSIBLE (F15 — arm order thermal gap, not a grid
defect but a PREREG analysis omission).**

The grid is sound. The driver is a clean derivation from #55 with no
functional corruption. The kit, model, and flags are identical. The one
gap (arm order not discussed in PREREG) is mechanically absorbed by the
thermal gate and the ±10% band — it cannot produce a wrong verdict, only
an unexplained one in the REPORT.

## Recommendation: **APPLY-WITH-FIXES**

Apply: the cell is safe to run. The grid will produce a valid verdict
regardless of the arm-order thermal delta.

Fixes (non-blocking, do before REPORT写作):
1. **PREREG §Arms**: add one sentence acknowledging the arm-order
   difference from #55 and the thermal gate as mitigation. e.g. "Bench_gpu
   runs immediately after two census arms (no CPU cool-down interlude as in
   #55); the #38 gate mitigates, and any thermal impact large enough to
   push outside ±10% is correctly caught by G3."
2. **d_run.sh comment**: fix "Adreno 732" → "Adreno 750" in the R3
   comment (cosmetic, 5 seconds).
