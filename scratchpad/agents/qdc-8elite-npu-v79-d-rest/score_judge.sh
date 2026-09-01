#!/bin/sh
# Classify test-backend-ops FAIL lines. Not a kit patch.
# JUDGE = CPU reference non-finite. REAL = INTERNAL-ERROR or finite mismatch.
set -eu
in=$1
base=${in%.txt}
ok=$(grep -c ': OK' "$in" 2>/dev/null || echo 0)
fail=$(grep -c 'FAIL' "$in" 2>/dev/null || echo 0)
skip=$(grep -c 'not supported' "$in" 2>/dev/null || echo 0)
judge=$(grep -E 'FAIL' "$in" | grep -Eic 'CPU=(nan|-nan|inf|-inf)' || true)
real_ie=$(grep -Eic 'INTERNAL-ERROR|dspqueue|qurt_exit|dspcall' "$in" || true)
real_fin=$((fail - judge))
if [ "$real_fin" -lt 0 ]; then real_fin=0; fi
{
  echo "ok=$ok fail=$fail skip=$skip"
  echo "judge_nonfinite=$judge"
  echo "real_internal=$real_ie"
  echo "real_fail_minus_judge=$real_fin"
} | tee "$base.score.txt"
