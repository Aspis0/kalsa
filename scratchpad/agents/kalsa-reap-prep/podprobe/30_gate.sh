#!/usr/bin/env bash
# 30_gate.sh — run the fixed gate on ONE arm. Responsibility: launch the
# server with this arm's flags, run gsm8k + tools + bpb + benches, record
# everything (double-BOS check AFTER the requests, truncation counts inside
# the JSONs), tear down. bench.txt is written LAST and is the arm's resume
# marker (run_probe.sh skips an arm only when it exists).
# Usage: 30_gate.sh <tag> <gguf> <tokenizer_dir> [extra server flags...]
set -uo pipefail
# shellcheck source=env.sh
. "$(dirname "$0")/env.sh"

TAG="${1:?tag}"; GGUF="$2"; TOK="$CELL/$3"; shift 3 || true
OUT="$RESULTS/$TAG"
mkdir -p "$OUT"
[ -f "$OUT/bench.txt" ] && { echo "30: [$TAG] already done (bench.txt)"; exit 0; }
rm -f "$OUT/gsm8k.json" "$OUT/tools.json" "$OUT/bpb.json"

LIMIT=()
[ -n "${PROBE_GEN_LIMIT:-}" ] && LIMIT=(--limit "$PROBE_GEN_LIMIT")

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

rc_gsm=0; rc_tools=0
(cd "$EVAL" && "$PY" run_gen_eval.py --dataset gsm8k \
  --holdout "$EVAL/gsm8k-200.jsonl" --server "http://127.0.0.1:$PORT" \
  --out "$OUT/gsm8k.json" "${LIMIT[@]:+${LIMIT[@]}}") > "$OUT/gsm8k.log" 2>&1 \
  || rc_gsm=$?
echo "30: [$TAG] gsm8k EXIT=$rc_gsm"

(cd "$EVAL" && "$PY" run_gen_eval.py --dataset tools \
  --holdout "$EVAL/tools-100.jsonl" --server "http://127.0.0.1:$PORT" \
  --out "$OUT/tools.json" "${LIMIT[@]:+${LIMIT[@]}}") > "$OUT/tools.log" 2>&1 \
  || rc_tools=$?
echo "30: [$TAG] tools EXIT=$rc_tools"

# single-BOS check runs AFTER the requests: the warning is emitted when a
# prompt is tokenized, so a pre-request grep would always read count=0
if grep -q "2 BOS" "$OUT/server.log"; then
  echo "DOUBLE_BOS_WARN count=$(grep -c "2 BOS" "$OUT/server.log")" >> "$OUT/notes.txt"
  echo "30: [$TAG] WARNING — server log shows a doubled-BOS warning" >&2
else
  echo "DOUBLE_BOS_WARN count=0" >> "$OUT/notes.txt"
fi

kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null || true
trap - EXIT

rc_bpb=0
(cd "$EVAL" && "$PY" run_bpb_eval.py --llama "$LLAMA_BIN" --model "$GGUF" \
  --tokenizer "$TOK" --corpus "$CORPUS" --out "$OUT/bpb.json" \
  --langs "${PROBE_BPB_LANGS:-en,it,es,fr,zh}") \
  > "$OUT/bpb.log" 2>&1 || rc_bpb=$?
echo "30: [$TAG] bpb EXIT=$rc_bpb"

# two labelled benches: the GPU number ranks arms on THIS pod; the CPU
# number (all-vCPU threads) is the PC-proxy Fable-2 asked for — community
# vCPU counts vary, so it is a proxy, not a device number
NPROC="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 8)"
"$LLAMA_BIN/llama-bench" -m "$GGUF" -ngl 99 -p 512 -n 128 -r 2 \
  > "$OUT/bench.txt" 2>&1 || true
"$LLAMA_BIN/llama-bench" -m "$GGUF" -ngl 0 -t "$NPROC" -p 512 -n 128 -r 2 \
  >> "$OUT/bench.txt" 2>&1 || true

# marker last, and only when every gate step succeeded: a failed step must
# not mark the arm done (Fable-3 §7.7)
if [ "$rc_gsm" = "0" ] && [ "$rc_tools" = "0" ] && [ "$rc_bpb" = "0" ]; then
  echo "30: [$TAG] done $(date +%H:%M:%S)"
else
  rm -f "$OUT/bench.txt"
  echo "30: [$TAG] INCOMPLETE (gsm8k=$rc_gsm tools=$rc_tools bpb=$rc_bpb) — marker withheld" >&2
  exit 1
fi
