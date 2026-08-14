#!/data/data/com.termux/files/usr/bin/bash
# One llama-bench cell on Jelly. Args: CELL_TAG  -p N  -n N
# Writes stdout json to ~/jelly_4b_baseline/${CELL_TAG}.json
# stderr to ~/jelly_4b_baseline/${CELL_TAG}.err
set -euo pipefail
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export PATH="$PREFIX/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/opt/llama-bench:/vendor/lib64:$PREFIX/lib"

CELL="${1:?cell tag}"
shift
MODEL="$HOME/models/Qwen3.5-4B-Q4_K_M.gguf"
BENCH="$HOME/opt/llama-bench/llama-bench"
COLD="$HOME/bin/cold_model.sh"
OUT="$HOME/jelly_4b_baseline"
mkdir -p "$OUT"

echo "CELL=$CELL start $(date -Iseconds)"
"$COLD" "$MODEL"
echo "COLD_OK $(date -Iseconds)"

# -ngl 0 CPU; -t 2 G99 A76 pair; -r 2 per report
set +e
"$BENCH" -m "$MODEL" -ngl 0 -t 2 -r 2 -o json "$@" >"$OUT/${CELL}.json" 2>"$OUT/${CELL}.err"
rc=$?
set -e
echo "CELL=$CELL rc=$rc end $(date -Iseconds)"
exit "$rc"
