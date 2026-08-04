#!/data/data/com.termux/files/usr/bin/bash
# Detached F1 gate runner for S23 (safe binary, --no-conversation).
set +e
export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export PATH=$PREFIX/bin:$PATH
export LD_LIBRARY_PATH=$HOME/src/llama.cpp/build-safe/bin:$PREFIX/lib
export TMPDIR=$PREFIX/tmp
mkdir -p "$TMPDIR" "$HOME/experiments/results/logs"

OUT=$HOME/experiments/results/f1_gate_console.txt
STATUS=$HOME/experiments/results/f1_gate_status.txt

echo RUNNING > "$STATUS"
{
  echo "F1_START $(date -Iseconds 2>/dev/null || date)"
  termux-battery-status
  bash "$HOME/experiments/scripts/run_bench.sh" \
    --binary "$HOME/src/llama.cpp/build-safe/bin/llama-cli" \
    -m "$HOME/models/Qwen3.5-4B-Q4_K_M.gguf" \
    -p "$HOME/experiments/prompts/short.txt" \
    --phase F1 \
    --runtime mainline \
    --run-type warm \
    -n 128 \
    --notes "F1 gate safe binary --no-conversation"
  EC=$?
  echo "F1_EXIT=$EC"
  echo "F1_END $(date -Iseconds 2>/dev/null || date)"
  termux-battery-status
  exit $EC
} >"$OUT" 2>&1
EC=$?
echo "$EC" > "$STATUS"
exit $EC
