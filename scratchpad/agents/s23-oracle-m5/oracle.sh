#!/usr/bin/env bash
# usage: oracle.sh A_LABEL B_LABEL — TF verdict of the UNMODIFIED oracle_logit.py (thresholds
# fixed in PREREG.md: 0.03 / 0.02 / 0.10), plus the per-step table from steps.py.
set -u; . "$(dirname "$0")/env.sh"
python3 -I "$LAB/oracle_logit.py" "$OUT/$1-probs.jsonl" "$OUT/$2-probs.jsonl" TF 0.03 0.02 0.10 > "$OUT/oracle-$1-vs-$2.txt" 2>&1; rc=$?
cat "$OUT/oracle-$1-vs-$2.txt"; echo "oracle_exit=$rc"
python3 -I "$LAB/steps.py" "$OUT/$1-probs.jsonl" "$OUT/$2-probs.jsonl" > "$OUT/steps-$1-vs-$2.txt" 2>&1; echo "steps_exit=$?"
