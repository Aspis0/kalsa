#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVER_BIN="/Users/marco/kalsa-mac/build-kalsallama-67c73d26c/bin/llama-server"
MODEL="/Users/marco/kalsa-qdc/models/MiniCPM5-2B-Q4_K_M.gguf"
QUESTIONS="/Users/marco/Projects/kalsa/scripts/quality/questions.json"
SAMPLER="$ROOT/samplers/minicpm.json"
PORT_WILD=8087
PORT_BAKEOFF=8088

if [[ $# -ne 1 || ( "$1" != "1024" && "$1" != "nobudget" ) ]]; then
  echo "usage: $0 1024|nobudget" >&2
  exit 2
fi
BUDGET="$1"
mkdir -p "$ROOT/results/wild-v2c" "$ROOT/results/bakeoff-v2c"
SERVER_PID=""
stop_server() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
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
start_server "$PORT_WILD" "$ROOT/results/wild-v2c/server-minicpm@$BUDGET.log"
python3 run_v2c.py --base-url "http://127.0.0.1:$PORT_WILD" --block wild --budget "$BUDGET" \
  --sampler "$SAMPLER" --questions "$QUESTIONS" --tools-file tools-app-default.json \
  --system-prompt-en-file system-prompt-en.v2.txt --system-prompt-it-file system-prompt-it.v2.txt \
  --out "results/wild-v2c/minicpm@$BUDGET.jsonl"
stop_server

start_server "$PORT_BAKEOFF" "$ROOT/results/bakeoff-v2c/server-minicpm@$BUDGET.log"
python3 run_v2c.py --base-url "http://127.0.0.1:$PORT_BAKEOFF" --block bakeoff --budget "$BUDGET" \
  --sampler "$SAMPLER" --questions "$QUESTIONS" --tools-file tools-app-default.json \
  --system-prompt-en-file system-prompt-en.v2.txt --system-prompt-it-file system-prompt-it.v2.txt \
  --out "results/bakeoff-v2c/minicpm@$BUDGET.jsonl"
stop_server
echo "v2c complete budget=$BUDGET"
