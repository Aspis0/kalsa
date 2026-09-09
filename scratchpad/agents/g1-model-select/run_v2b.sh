#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVER_BIN="/Users/marco/kalsa-mac/build-kalsallama-67c73d26c/bin/llama-server"
TOOLS="$ROOT/tools-app-default.json"
MATRIX="$ROOT/matrix-g1.json"
QUESTIONS="/Users/marco/Projects/kalsa/scripts/quality/questions.json"
WILD_PORT=8085
BAKEOFF_PORT=8086

if [[ $# -ne 2 ]]; then echo "usage: $0 <lfm|minicpm> <sampler-file>" >&2; exit 2; fi
LABEL="$1"; SAMPLER="$2"; [[ "$SAMPLER" = /* ]] || SAMPLER="$ROOT/$SAMPLER"
case "$LABEL" in
  lfm) MODEL="/Users/marco/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf"; CELLS=(lfm@256 lfm@512) ;;
  minicpm) MODEL="/Users/marco/kalsa-qdc/models/MiniCPM5-2B-Q4_K_M.gguf"; CELLS=(minicpm@256 minicpm@512) ;;
  *) echo "unknown model label: $LABEL" >&2; exit 2 ;;
esac

mkdir -p "$ROOT/results/wild-v2b" "$ROOT/results/bakeoff-v2b"
SERVER_PID=""
stop_server() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  SERVER_PID=""
}
trap 'stop_server' EXIT INT TERM
start_server() {
  local port="$1" log="$2"
  "$SERVER_BIN" -m "$MODEL" --port "$port" --host 127.0.0.1 \
    -c 8192 -b 512 -ub 256 -t 8 -ctk q8_0 -ctv q4_0 -fa auto \
    --jinja --reasoning on --reasoning-format deepseek --reasoning-preserve --mlock \
    > /dev/null 2> "$log" &
  SERVER_PID=$!
  for ((attempt=0; attempt<300; attempt++)); do
    if curl --fail --silent "http://127.0.0.1:$port/health" > /dev/null; then return 0; fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then return 1; fi
    sleep 1
  done
  return 1
}

cd "$ROOT"
wild_ids="results/v2b-selection/$LABEL-wild.txt"
wild_out="results/wild-v2b/$LABEL.jsonl"
if [[ -s "$wild_ids" ]]; then
  start_server "$WILD_PORT" "$ROOT/results/wild-v2b/server-$LABEL.log"
  python3 run_corpus_v2b.py --base-url "http://127.0.0.1:$WILD_PORT" --model-label "$LABEL" --split all \
    --sampler "$SAMPLER" --system-prompt-en-file system-prompt-en.v2.txt --system-prompt-it-file system-prompt-it.v2.txt \
    --tools-file "$TOOLS" --ids-file "$wild_ids" --corpus corpus/wild.jsonl --out "$wild_out"
  stop_server
else
  : > "$wild_out"
fi

for cell in "${CELLS[@]}"; do
  budget="${cell##*@}"
  ids="results/v2b-selection/$LABEL-bakeoff-$budget.txt"
  out="results/bakeoff-v2b/$cell.jsonl"
  if [[ -s "$ids" ]]; then
    start_server "$BAKEOFF_PORT" "$ROOT/results/bakeoff-v2b/server-$LABEL-${cell//@/-}.log"
    python3 run_bakeoff_v2b.py --base-url "http://127.0.0.1:$BAKEOFF_PORT" --model-label "$LABEL" --cell "$cell" \
      --matrix "$MATRIX" --questions "$QUESTIONS" --tools-file "$TOOLS" \
      --system-prompt-en-file system-prompt-en.v2.txt --system-prompt-it-file system-prompt-it.v2.txt \
      --ids-file "$ids" --out "$out"
    stop_server
  else
    : > "$out"
  fi
done
echo "v2b complete model=$LABEL wild=$wild_out"
