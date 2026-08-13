#!/system/bin/sh
# Phase 2 correctness on Xiaomi 14 Adreno 750. Plugged OK.
set -u
ROOT=/data/local/tmp/gdn_750
export LD_LIBRARY_PATH="$ROOT/bin:/vendor/lib64:/system/vendor/lib64"
BIN="$ROOT/bin"
LOG="$ROOT/logs"
TBO="$BIN/test-backend-ops"
STATUS="$LOG/phase2_status.txt"

ts() { date '+%Y-%m-%dT%H:%M:%S'; }

run_op() {
  name="$1"
  shift
  echo "$(ts) START $name $*" | tee -a "$STATUS"
  echo "=== START $name $(ts) cmd: $TBO test -b GPUOpenCL $* ===" > "$LOG/$name.txt"
  "$TBO" test -b GPUOpenCL "$@" >> "$LOG/$name.txt" 2>&1
  rc=$?
  echo "=== EXIT:$rc END $(ts) ===" >> "$LOG/$name.txt"
  echo "$(ts) END $name EXIT=$rc" | tee -a "$STATUS"
  return $rc
}

echo "$(ts) PHASE2 begin" > "$STATUS"

# GDN-family + CUMSUM already proven 15/15; re-run for a dedicated log.
run_op test_GATED_DELTA_NET -o GATED_DELTA_NET
run_op test_SSM_CONV -o SSM_CONV
run_op test_L2_NORM -o L2_NORM
run_op test_SOLVE_TRI -o SOLVE_TRI
run_op test_CUMSUM -o CUMSUM
run_op test_MUL_MAT_q6_K -o MUL_MAT -p q6_K
run_op test_MUL_MAT_q4_K -o MUL_MAT -p q4_K

echo "$(ts) PHASE2 all ops done" | tee -a "$STATUS"
