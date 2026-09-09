#!/usr/bin/env bash
set -euo pipefail

# Usage: ./run_wild.sh <model-label> <sampler-file>
# The first stage uses the same llama-server flags as the G1 dev pass, on the
# dedicated wild port. Non-Italian locales use the English system prompt.
# system-prompt-en.txt is the declared prompt for every non-IT wild language.

G1_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVER_BIN="/Users/marco/kalsa-mac/build-kalsallama-67c73d26c/bin/llama-server"
QUALITY_ROOT="/Users/marco/Projects/kalsa"

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <model-label> <sampler-file>" >&2
  exit 2
fi

MODEL_LABEL="$1"
SAMPLER_ARG="$2"
if [[ "$SAMPLER_ARG" = /* ]]; then
  SAMPLER="$SAMPLER_ARG"
else
  SAMPLER="$G1_ROOT/$SAMPLER_ARG"
fi

case "$MODEL_LABEL" in
  lfm|lfm-dev|lfm25-2.6b)
    MODEL_PATH="/Users/marco/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf"
    ;;
  minicpm|minicpm-dev|minicpm5-2b)
    MODEL_PATH="/Users/marco/kalsa-qdc/models/MiniCPM5-2B-Q4_K_M.gguf"
    ;;
  *)
    echo "unknown model label: $MODEL_LABEL" >&2
    exit 2
    ;;
esac

if [[ ! -x "$SERVER_BIN" ]]; then
  echo "server binary is not executable: $SERVER_BIN" >&2
  exit 1
fi
if [[ ! -f "$MODEL_PATH" ]]; then
  echo "model file is missing: $MODEL_PATH" >&2
  exit 1
fi
if [[ ! -f "$SAMPLER" ]]; then
  echo "sampler file is missing: $SAMPLER" >&2
  exit 1
fi

mkdir -p "$G1_ROOT/results/wild"
WILD_LOG="$(mktemp "${TMPDIR:-/tmp}/kalsa-wild-server.XXXXXX.log")"
WILD_PID=""

stop_wild_server() {
  if [[ -n "$WILD_PID" ]] && kill -0 "$WILD_PID" 2>/dev/null; then
    kill "$WILD_PID" 2>/dev/null || true
    wait "$WILD_PID" 2>/dev/null || true
  fi
  WILD_PID=""
}
trap 'stop_wild_server; rm -f "$WILD_LOG"' EXIT

cd "$G1_ROOT"
"$SERVER_BIN" -m "$MODEL_PATH" --port 8081 --host 127.0.0.1 \
  -c 8192 -b 512 -ub 256 -t 8 -ctk q8_0 -ctv q4_0 -fa auto \
  --jinja --reasoning on --reasoning-format deepseek --reasoning-preserve --mlock \
  > /dev/null 2>"$WILD_LOG" &
WILD_PID=$!

healthy=0
for ((attempt = 0; attempt < 300; attempt++)); do
  if curl --fail --silent http://127.0.0.1:8081/health > /dev/null; then
    healthy=1
    break
  fi
  if ! kill -0 "$WILD_PID" 2>/dev/null; then
    sed -n '1,80p' "$WILD_LOG" >&2
    exit 1
  fi
  sleep 1
done
if [[ "$healthy" -ne 1 ]]; then
  echo "wild server did not become healthy on port 8081" >&2
  sed -n '1,80p' "$WILD_LOG" >&2
  exit 1
fi

wild_status=0
python3 run_corpus.py \
  --base-url http://127.0.0.1:8081 \
  --model-label "$MODEL_LABEL" \
  --sampler "$SAMPLER" \
  --system-prompt-en-file system-prompt-en.txt \
  --system-prompt-it-file system-prompt-it.txt \
  --out "results/wild/${MODEL_LABEL}.jsonl" \
  --corpus corpus/wild.jsonl \
  --split all || wild_status=$?

stop_wild_server
trap - EXIT
rm -f "$WILD_LOG"

QUALITY_TMP="$(mktemp -d "${TMPDIR:-/tmp}/kalsa-quality-g1.XXXXXX")"
cleanup_quality() {
  rm -rf "$QUALITY_TMP"
}
trap cleanup_quality EXIT
mkdir -p "$QUALITY_TMP/scripts/quality"
cp "$QUALITY_ROOT/scripts/quality/run.mjs" "$QUALITY_TMP/scripts/quality/run.mjs"
cp "$QUALITY_ROOT/scripts/quality/report.mjs" "$QUALITY_TMP/scripts/quality/report.mjs"
cp "$QUALITY_ROOT/scripts/quality/score.mjs" "$QUALITY_TMP/scripts/quality/score.mjs"
cp "$QUALITY_ROOT/scripts/quality/questions.json" "$QUALITY_TMP/scripts/quality/questions.json"
cp "$G1_ROOT/matrix-g1.json" "$QUALITY_TMP/scripts/quality/matrix.json"

mkdir -p "$G1_ROOT/results/bakeoff"
KALSA_LLAMA_SERVER="$SERVER_BIN" KALSA_QUALITY_PORT=8082 \
  node "$QUALITY_TMP/scripts/quality/run.mjs" --out "$G1_ROOT/results/bakeoff"
node "$QUALITY_TMP/scripts/quality/report.mjs" --out "$G1_ROOT/results/bakeoff"

exit "$wild_status"
