#!/usr/bin/env bash
# 30_gate.sh — run the fixed gate on ONE arm. Responsibility: launch the
# server with this arm's flags, run bpb + gsm8k + tools + bench, record
# everything (incl. the double-BOS check on the server log), tear down.
# Usage: 30_gate.sh <tag> <gguf> <tokenizer_dir> [extra server flags...]
set -euo pipefail
# shellcheck source=env.sh
. "$(dirname "$0")/env.sh"

TAG="${1:?tag}"; GGUF="$2"; TOK="$CELL/$3"; shift 3 || true
OUT="$RESULTS/$TAG"
mkdir -p "$OUT"
[ -f "$OUT/gsm8k.json" ] && { echo "30: [$TAG] already done"; exit 0; }

echo "30: [$TAG] start $(date +%H:%M:%S) — $GGUF $*"
"$LLAMA_BIN/llama-server" -m "$GGUF" -ngl 99 -c 16384 --port "$PORT" "$@" \
  >"$OUT/server.log" 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do
  curl -s "http://127.0.0.1:$PORT/health" | grep -q '"ok"' && break
  sleep 3
done
curl -s "http://127.0.0.1:$PORT/health" | grep -q '"ok"' \
  || { echo "30: [$TAG] server never became healthy (see $OUT/server.log)" >&2; exit 1; }

# single-BOS check: the chat-completions path lets the server own template +
# tokenization; if the fork still warns about a doubled BOS we record it and
# flag the arm's generative numbers as suspect in the report
if grep -q "2 BOS" "$OUT/server.log"; then
  echo "DOUBLE_BOS_WARN count=$(grep -c "2 BOS" "$OUT/server.log")" >> "$OUT/notes.txt"
  echo "30: [$TAG] WARNING — server log shows a doubled-BOS warning" >&2
else
  echo "DOUBLE_BOS_WARN count=0" >> "$OUT/notes.txt"
fi

(cd "$EVAL" && "$PY" run_gen_eval.py --dataset gsm8k \
  --holdout "$EVAL/gsm8k-200.jsonl" --server "http://127.0.0.1:$PORT" \
  --tokenizer "$TOK" --out "$OUT/gsm8k.json") > "$OUT/gsm8k.log" 2>&1
echo "30: [$TAG] gsm8k EXIT=$?"

(cd "$EVAL" && "$PY" run_gen_eval.py --dataset tools \
  --holdout "$EVAL/tools-100.jsonl" --server "http://127.0.0.1:$PORT" \
  --tokenizer "$TOK" --out "$OUT/tools.json") > "$OUT/tools.log" 2>&1
echo "30: [$TAG] tools EXIT=$?"

kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null || true
trap - EXIT

(cd "$EVAL" && "$PY" run_bpb_eval.py --llama "$LLAMA_BIN" --model "$GGUF" \
  --tokenizer "$TOK" --corpus "$CORPUS" --out "$OUT/bpb.json") \
  > "$OUT/bpb.log" 2>&1
echo "30: [$TAG] bpb EXIT=$?"

"$LLAMA_BIN/llama-bench" -m "$GGUF" -ngl 99 -p 512 -n 128 -r 2 \
  > "$OUT/bench.txt" 2>&1
echo "30: [$TAG] bench EXIT=$?"
echo "30: [$TAG] done $(date +%H:%M:%S)"
