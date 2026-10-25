#!/bin/bash
# One model's battery on the lab server (port 8191): start it, run its tests, measure speed, stop it.
# Usage: run_battery.sh <model.gguf> <tag> <bonsai|gemma>
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
mkdir -p "$LOG" "$R"

if [ "$KIND" = "bonsai" ]; then
  SAMPLING="--temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.05"
else
  SAMPLING="--temp 1.0 --top-p 0.95 --top-k 64"
fi

echo "kalsa-server processes before start: $(pgrep -f kalsa-server | wc -l | tr -d ' ')" > "$LOG/preflight.txt"
"$BIN" -m "$MODEL" --host 127.0.0.1 --port 8191 -ngl 99 -fa on -c 16384 --parallel 1 --jinja --no-webui \
  -ctk q8_0 -ctv q8_0 $SAMPLING > "$LOG/server.log" 2>&1 &
SERVER=$!
echo "$SERVER" > "$LOG/server.pid"
( while kill -0 "$SERVER" 2>/dev/null; do echo "$(date +%s) $(ps -o rss= -p "$SERVER" | tr -d ' ')" >> "$LOG/rss.log"; sleep 5; done ) &
SAMPLER=$!

for i in $(seq 1 180); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' -m 2 "$BASE/health")" = "200" ] && break
  kill -0 "$SERVER" 2>/dev/null || break
  sleep 2
done
if [ "$(curl -s -o /dev/null -w '%{http_code}' -m 2 "$BASE/health")" != "200" ]; then
  echo "server did not become healthy" >> "$LOG/exit.txt"
  kill "$SERVER" 2>/dev/null; kill "$SAMPLER" 2>/dev/null
  exit 1
fi
THINK_SWITCH=$(curl -s -m 10 "$BASE/props" | python3 -c 'import sys,json; print("yes" if "enable_thinking" in json.load(sys.stdin)["chat_template"] else "no")')
echo "startup ok; template reads enable_thinking: $THINK_SWITCH" > "$LOG/startup.txt"

CALFLAG=""
[ "$THINK_SWITCH" = "yes" ] && CALFLAG="--no-think"
BENCHFLAG=""
[ "$THINK_SWITCH" = "yes" ] && BENCHFLAG="--think-switch"

if [ "$KIND" = "bonsai" ]; then
  python3 "$H/quiz/run_quiz.py" --label "$TAG-on" --think on --seeds 1,2,3 --out "$R/quiz" --base "$BASE" > "$LOG/quiz-on.log" 2>&1
  echo "quiz-on EXIT=$?" >> "$LOG/exit.txt"
  python3 "$H/quiz/run_quiz.py" --label "$TAG-off" --think off --seeds 1,2,3 --out "$R/quiz" --base "$BASE" > "$LOG/quiz-off.log" 2>&1
  echo "quiz-off EXIT=$?" >> "$LOG/exit.txt"
  python3 "$H/ling/quiz_ling.py" --out "$R/ling/$TAG" > "$LOG/ling-on.log" 2>&1
  echo "ling-on EXIT=$?" >> "$LOG/exit.txt"
  python3 "$H/ling/quiz_ling.py" --nothink --out "$R/ling/$TAG" > "$LOG/ling-off.log" 2>&1
  echo "ling-off EXIT=$?" >> "$LOG/exit.txt"
fi

node "$H/lab-restraint/run.mjs" --base "$BASE" --model "$NAME" --tag "$TAG" --out "$R/restraint" > "$LOG/restraint.log" 2>&1
echo "restraint EXIT=$?" >> "$LOG/exit.txt"
node "$H/lab-calendar/run.mjs" --base "$BASE" --model "$NAME" --tag "$TAG" --out "$R/calendar" $CALFLAG > "$LOG/calendar.log" 2>&1
echo "calendar EXIT=$?" >> "$LOG/exit.txt"
node "$H/story/run_story.mjs" --base "$BASE" --model "$NAME" --runs 5 --out "$R/story/$TAG" > "$LOG/story.log" 2>&1
echo "story EXIT=$?" >> "$LOG/exit.txt"

python3 "$H/bench/bench_ttft.py" --label "$TAG" --out "$R/speed/$TAG.json" $BENCHFLAG > "$LOG/bench.log" 2>&1
echo "bench EXIT=$?" >> "$LOG/exit.txt"

kill "$SERVER" 2>/dev/null
wait "$SERVER" 2>/dev/null
kill "$SAMPLER" 2>/dev/null
echo "battery done" >> "$LOG/exit.txt"
