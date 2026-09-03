# AUDIT-PRERUN — Cell #53: OpenCL picks A/B on HDK8550

Hostile pre-run audit. Every claim cites file:line.

---

## 1. A/B Integrity — could any arm run the WRONG build?

**VERDICT: CONFIRMED CORRECT.** No wrong-build path exists.

Trace of `$BENCH` expansion through `run_arm` nested quoting (the #52 three-session burner):

`BENCH` is assigned on Mac (d_run.sh:54):
```
BENCH="taskset $CPU_MASK ./llama-bench -m $D/model.gguf -t 4 -ngl 99 -fa 0 -p 512 -n 128 -r 3 -o md"
```
`$CPU_MASK` and `$D` expand to Mac-side literals (`f0`, `/data/local/tmp/kalsa53`). The resulting string is a pure literal — no remaining `$` for the device shell to mis-expand.

Passed to `run_arm` as `$4` (d_run.sh:66–75). Inside `run_arm`, the launch line (d_run.sh:73):
```
adbT 30 -s "$SER" shell "nohup sh -c 'cd $D/$3; LD_LIBRARY_PATH=$D/$3 $4 > $D/$3/$1.out 2>&1; echo \$? > $D/$3/$1.exit' </dev/null >/dev/null 2>&1 & echo LAUNCH_OK"
```
Mac shell expands `$D`, `$3`, `$4`, `$1` inside the double quotes. `\$?` is escaped → literal `$?` for device. Single quotes inside the double-quoted string are literal characters passed to the device shell, preventing re-interpretation.

Device shell receives (for `bench_base_1`):
```
nohup sh -c 'cd /data/local/tmp/kalsa53/base; LD_LIBRARY_PATH=/data/local/tmp/kalsa53/base taskset f0 ./llama-bench -m /data/local/tmp/kalsa53/model.gguf ... > .../base/bench_base_1.out 2>&1; echo $? > .../base/bench_base_1.exit' ...
```

Each arm's `cd $D/$3` and `LD_LIBRARY_PATH=$D/$3` route to the correct kit subdirectory. `./llama-bench` resolves relative to that subdirectory. Model path is absolute (`$D/model.gguf`), shared across both kits — correct, model lives at `$D/` not inside kit subdirs.

Confirmed: `picks-kit-53.tgz` contains `./llama-bench` and `./test-backend-ops`; `base-kit-53.tgz` contains `./llama-bench` and `./test-backend-ops`. Each arm runs its own kit's binary. ✓

---

## 2. ABBA Bench Order + Re-entrancy

**VERDICT: PLAUSIBLE — degraded ABBA on partial re-run. Medium severity.**

Bench sequence (d_run.sh:76–80):
```
bench_base_1  → base     (position 1)
bench_picks_1 → picks    (position 2)
bench_picks_2 → picks    (position 3)
bench_base_2  → base     (position 4)
```

Skip guard (d_run.sh:66):
```
if grep -q "exit=0" "$RAW/$1_$JOB.out" 2>/dev/null; then log "skip $1 (already banked)"; return 0; fi
```

Scenario: `bench_base_1` succeeds (exit=0), `bench_picks_1` fails (exit=TIMEOUT). On re-run:
- `bench_base_1` → skipped (exit=0 banked from prior session)
- `bench_picks_1` → re-runs (1st in new session)
- `bench_picks_2` → re-runs (2nd)
- `bench_base_2` → re-runs (3rd)

Effective order: base_1 (old thermal state) → picks_1 → picks_2 → base_2. First-order thermal drift cancellation is partially broken — base_1 ran under different thermal conditions than the other three. PREREG does not address this edge case. Acceptable per pragmatics but the operator should note degraded confidence in the mean comparison.

---

## 3. `run_arm` Signature — All Call Sites

**VERDICT: CONFIRMED CORRECT.** All 10 call sites pass 4 args in order `name cap_seconds kit_subdir command`.

#52 `run_arm` signature: `$1=name $2=cap $3=command` (3 args).
#53 `run_arm` signature: `$1=name $2=cap $3=kit_subdir $4=command` (4 args) — d_run.sh:66.

Call sites (d_run.sh:82–91):
```
run_arm tbo_base_mm    1200 base  "./test-backend-ops test -b GPUOpenCL -o MUL_MAT"
run_arm tbo_picks_mm   1200 picks "./test-backend-ops test -b GPUOpenCL -o MUL_MAT"
run_arm tbo_base_mmid  1200 base  "./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID"
run_arm tbo_picks_mmid 1200 picks "./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID"
run_arm tbo_base_fa    1500 base  "./test-backend-ops test -b GPUOpenCL -o FLASH_ATTN_EXT"
run_arm tbo_picks_fa   1500 picks "./test-backend-ops test -b GPUOpenCL -o FLASH_ATTN_EXT"
run_arm bench_base_1  1500 base  "$BENCH"
run_arm bench_picks_1 1500 picks "$BENCH"
run_arm bench_picks_2 1500 picks "$BENCH"
run_arm bench_base_2  1500 base  "$BENCH"
```

All 10: 4 args, kit_subdir ($3) is `base` or `picks`, command ($4) is the binary+flags. ✓

---

## 4. PREREG vs Driver Divergences

**VERDICT: CONFIRMED — no material divergences.**

### Caps (PREREG vs driver)
| Arm | PREREG | Driver (d_run.sh) | Match? |
|---|---|---|---|
| tbo_*_mm | 20 min | 1200s (d_run.sh:82–83) | ✓ |
| tbo_*_mmid | 20 min | 1200s (d_run.sh:84–85) | ✓ |
| tbo_*_fa | 25 min | 1500s (d_run.sh:86–87) | ✓ |
| bench_* | 25 min | 1500s (d_run.sh:88–91) | ✓ |

### Arm names (PREREG vs driver)
PREREG §4 arm A: `tbo_{base,picks}_{mm,mmid,fa}` — driver matches (d_run.sh:82–87). ✓
PREREG §4 arm B: `bench_{base,picks}_{1,2}` — driver matches (d_run.sh:88–91). ✓

### Grid decidability (PREREG §Grid)
- **G1**: Q1 all-PASS on both → need per-op exit codes. Driver collects exit code in `.out` metadata (`exit=${E:-NONE}`, d_run.sh:79). Each tbo arm's `.out` has exit code. Operator can compare base vs picks per-op. ✓
- **G2**: picks FAIL any test baseline PASSES — same exit-code comparison. ✓
- **G3**: both fail same test — same comparison, both non-zero. ✓
- **G4**: model fails to load — bench arm would exit non-zero, `.out` carries loader error. ✓

All grid cells decidable from collected outputs. ✓

### Ops lists
PREREG: MUL_MAT + MUL_MAT_ID + FLASH_ATTN_EXT — driver tests exactly these three (d_run.sh:82–87). ✓

### Model
PREREG: `LFM2.5-2.6B-Q4_K_M.gguf` from `LiquidAI/LFM2.5-2.6B-GGUF @ f4a289c8` — driver pushes `$HOME/kalsa-qdc/models/LFM2.5-2.6B-Q4_K_M.gguf` (d_run.sh:16). Filename matches. ✓

---

## 5. Two-Kit `sha256sum -c` Line — `;` Swallow Risk

**VERDICT: CONFIRMED BUG — narrow but real. Low severity.**

The verification line (d_run.sh:47):
```
adbT 120 -s "$SER" shell "cd $D/picks && sha256sum -c SHA256SUMS; cd $D/base && sha256sum -c SHA256SUMS" > "$RAW/kit_verify_$JOB.txt" 2>&1
grep -q "FAILED" "$RAW/kit_verify_$JOB.txt" && { log "KIT_SHA_MISMATCH"; exit 5; }
```

The `;` between the two `sha256sum -c` calls means both run regardless of the first's exit status. The grep only looks for the string `FAILED`.

**What `sha256sum -c` produces on various failures:**
- Checksum mismatch: outputs `filename: FAILED` → grep catches it. ✓
- SHA256SUMS file missing: stderr `sha256sum: SHA256SUMS: No such file or directory` → captured by `2>&1` but does NOT contain `FAILED` → **grep does NOT catch it.**
- Permission denied: stderr `Permission denied` → no `FAILED` → **grep does NOT catch it.**

**Scenario**: Partial tar extraction (disk full, I/O error) leaves picks kit with missing SHA256SUMS. The base kit extracts fine. The grep check sees no `FAILED` → passes. Script proceeds with a structurally incomplete picks kit. The arm later fails at launch (LAUNCH_FAIL) or with a corrupted binary — wasting a device session.

**Mitigation**: Replace `;` with `&&` or check exit codes separately:
```
adbT 120 ... shell "cd $D/picks && sha256sum -c SHA256SUMS && cd $D/base && sha256sum -c SHA256SUMS"
```
Or use separate `adbT` calls with explicit exit-code checks.

**Practical risk**: Low — both tarballs contain SHA256SUMS (verified via `tar tzf`). Requires a partial extraction to trigger.

---

## 6. Session-Killers

**VERDICT: CONFIRMED — no unguarded adb calls. All protected.**

### adbT coverage audit (every `adb` invocation in d_run.sh)
Every `adb` call goes through `adbT` (d_run.sh:20–21):
```
adbT(){ local t="$1"; shift; perl -e 'alarm shift; exec @ARGV or exit 127' "$t" adb "$@"; }
```

Counted 21 adb calls in d_run.sh, all via `adbT` with explicit timeouts (30–2400s). ✓

### Tunnel-drop behavior
`connect.sh` sets `ServerAliveInterval=30` (connect.sh:57). If tunnel drops mid-run:
- Next `adbT` call hangs until its per-call cap fires (30–300s).
- Perl alarm kills adb, run_arm logs failure, arm returns non-zero.
- ABORT may trigger (rc 7/8) or arm reports failure (rc 9).
- No inter-arm tunnel health check, but per-call caps provide defense-in-depth. ✓

### Unguarded critical steps
- `MODEL_SHA_FILE` check at script top (d_run.sh:17–18): refuses without MODEL_SHA.txt. ✓
- Resume guard checks model SHA + both kit binaries before skipping pushes (d_run.sh:38–40). ✓
- CLEAN_OK gate before each launch (d_run.sh:70–71). ✓
- LAUNCH_OK gate after each launch (d_run.sh:74–75). ✓
- `pkill` bracketed to avoid self-match (d_run.sh:77): `llama-benc[h]|test-backend-op[s]`. ✓

### `ck` function — ABORT semantics (d_run.sh:81)
```
ck(){ rc=$?; [ $rc -eq 7 ] || [ $rc -eq 8 ] && ABORT=1; }
```
Bash left-associativity: `(rc==7 || rc==8) && ABORT=1`.
- rc=0 (success): ABORT stays 0. ✓
- rc=7 (gate abort): ABORT=1. ✓
- rc=8 (clean/launch fail): ABORT=1. ✓
- rc=9 (non-zero device exit — a RESULT per PREREG): ABORT stays 0. ✓ (correct: test failures are data, not aborts.)

---

## 7. Ops Lessons Compliance (all six from #52 REPORT.md:80–98)

| # | Lesson | Cell #53 status | Evidence |
|---|---|---|---|
| 1 | T4 pattern (nohup sh -c only bg word) | ✅ EMBODIED | d_run.sh:73 — `nohup sh -c '...' </dev/null >/dev/null 2>&1 & echo LAUNCH_OK` |
| 2 | Bare-hex taskset (no 0x prefix) | ✅ EMBODIED | d_run.sh:52 — `printf "%x"`; d_run.sh:54 — `taskset $CPU_MASK` (no 0x) |
| 3 | No llama-cli probe | ✅ EMBODIED | No llama-cli in any arm. Correctness via test-backend-ops, perf via llama-bench. |
| 4 | Bracketed pkill pattern | ✅ EMBODIED | d_run.sh:77 — `'llama-benc[h]|test-backend-op[s]'` |
| 5 | Perl-alarm caps on all adb | ✅ EMBODIED | d_run.sh:20–21 — all 21 adb calls via `adbT`. |
| 6 | Explicit -ngl/-dev flags | ✅ EMBODIED | d_run.sh:54 — `-ngl 99` explicit. No CPU bench → `-dev` not needed. |

---

## FIX LIST (by severity)

### HIGH — Fix before launch

None.

### MEDIUM — Fix before launch if feasible

**M1: `sha256sum -c` `;` should be `&&`** (d_run.sh:47)
Replace:
```
adbT 120 -s "$SER" shell "cd $D/picks && sha256sum -c SHA256SUMS; cd $D/base && sha256sum -c SHA256SUMS"
```
With:
```
adbT 120 -s "$SER" shell "cd $D/picks && sha256sum -c SHA256SUMS && cd $D/base && sha256sum -c SHA256SUMS"
```
Or better: two separate `adbT` calls with individual exit-code checks so you know WHICH kit failed.

### LOW — Note for operator

**L1: ABBA degradation on partial re-run** — If a mid-sequence bench arm fails and the driver is re-run, the skip guard re-runs from that point onward. The first base run's thermal state differs from the re-run session. PREREG doesn't address this. Operator should note degraded thermal cancellation in any partial-re-run scenario.

**L2: connect.sh `adb devices` without cap** (connect.sh:67) — The tunnel-retry loop uses bare `adb devices` (no adbT). If the tunnel is established but remote adb is slow, each call could hang up to TCP timeout (~30s). 20 iterations × 30s = 600s worst case. Not a d_run.sh issue (d_run.sh is not running yet), but wastes time.

---

## MATERIALS CHECK

### picks-kit-53.tgz contents (verified via `tar tzf`)
```
./BUILD_NOTE.txt
./SHA256SUMS
./libomp.so          ← present (needed by base)
./llama-bench
./llama-cli          ← present (never used by driver)
./test-backend-ops
```

### base-kit-53.tgz contents (verified via `tar tzf`)
```
./BUILD_NOTE.txt
./SHA256SUMS
./llama-bench        ← NO libomp.so (driver copies from picks)
./test-backend-ops   ← NO llama-cli (driver never uses it)
```

Driver assumptions match tarballs:
- `cp $D/picks/libomp.so $D/base/libomp.so` (d_run.sh:45) — picks has libomp.so, base does not. ✓
- `chmod 755 llama-bench llama-cli test-backend-ops` for picks, `chmod 755 llama-bench test-backend-ops` for base (d_run.sh:44) — base tarball has no llama-cli. ✓
- Driver never invokes llama-cli. ✓

---

## MODEL_SHA.txt REFUSAL PATH

**VERDICT: CONFIRMED — refusal works correctly.**

d_run.sh:17–18:
```
MODEL_SHA=$(cat "$MODEL_SHA_FILE" 2>/dev/null | tr -d '\n ')
[ -n "$MODEL_SHA" ] || { echo "NO MODEL_SHA.txt — refuse to run unpinned"; exit 3; }
```

If MODEL_SHA.txt doesn't exist: `cat` fails (stderr suppressed), `MODEL_SHA` is empty, `[ -n "" ]` is false, script prints refusal and exits 3. ✓
This is the designed behavior — model download orchestrator writes MODEL_SHA.txt after successful download + verification.

---

## SUMMARY

| Check | Verdict |
|---|---|
| A/B integrity (wrong build) | ✅ CONFIRMED CORRECT |
| ABBA re-entrancy | ⚠️ PLAUSIBLE — degraded on partial re-run |
| run_arm signature (all call sites) | ✅ CONFIRMED — 10/10 correct |
| PREREG vs driver divergences | ✅ CONFIRMED — none |
| sha256sum -c `;` gap | 🔴 CONFIRMED BUG — `;` should be `&&` |
| Session-killers (unguarded adb) | ✅ CONFIRMED — all 21 adb calls via adbT |
| Ops lessons (all 6) | ✅ ALL EMBODIED |
| Kit contents vs assumptions | ✅ MATCH |
| MODEL_SHA.txt refusal | ✅ WORKS |

**Bottom line**: One fixable bug (M1: sha256sum `;`→`&&`). One noted behavior (L1: ABBA degradation). No session-wasters beyond these. Safe to launch after M1 fix.
