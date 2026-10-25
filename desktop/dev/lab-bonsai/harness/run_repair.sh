#!/bin/bash
# Resumes the restraint and calendar runs of one model after a crash (items already recorded are skipped).
# Usage: run_repair.sh <model.gguf> <tag> <bonsai|gemma>
set -u
MODEL="$1"
TAG="$2"
KIND="$3"
LAB="$HOME/lab/bonsai"
H="$LAB/harness"
R="$LAB/results/full"
BIN="$LAB/llama-prism/build/bin/llama-server"
BASE="http://127.0.0.1:8191"
NAME="$(basename "$MODEL")"
LOG="$LAB/logs/$TAG"
mkdir -p "$LOG"

if [ "$KIND" = "bonsai" ]; then
  SAMPLING="--temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.05"
else
  SAMPLING="--temp 1.0 --top-p 0.95 --top-k 64"
fi

"$BIN" -m "$MODEL" --host 127.0.0.1 --port 8191 -ngl 99 -fa on -c 16384 --parallel 1 --jinja --no-webui \
  -ctk q8_0 -ctv q8_0 $SAMPLING > "$LOG/server-repair.log" 2>&1 &
SERVER=$!
for i in $(seq 1 180); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' -m 2 "$BASE/health")" = "200" ] && break
  kill -0 "$SERVER" 2>/dev/null || break
  sleep 2
done
if [ "$(curl -s -o /dev/null -w '%{http_code}' -m 2 "$BASE/health")" != "200" ]; then
  echo "repair: server did not become healthy" >> "$LOG/exit.txt"
  kill "$SERVER" 2>/dev/null
  exit 1
fi
THINK_SWITCH=$(curl -s -m 10 "$BASE/props" | python3 -c 'import sys,json; print("yes" if "enable_thinking" in json.load(sys.stdin)["chat_template"] else "no")')
CALFLAG=""
[ "$THINK_SWITCH" = "yes" ] && CALFLAG="--no-think"

node "$H/lab-restraint/run.mjs" --base "$BASE" --model "$NAME" --tag "$TAG" --out "$R/restraint" > "$LOG/restraint-repair.log" 2>&1
echo "repair restraint EXIT=$?" >> "$LOG/exit.txt"
node "$H/lab-calendar/run.mjs" --base "$BASE" --model "$NAME" --tag "$TAG" --out "$R/calendar" $CALFLAG > "$LOG/calendar-repair.log" 2>&1
echo "repair calendar EXIT=$?" >> "$LOG/exit.txt"

kill "$SERVER" 2>/dev/null
wait "$SERVER" 2>/dev/null
echo "repair done" >> "$LOG/exit.txt"
