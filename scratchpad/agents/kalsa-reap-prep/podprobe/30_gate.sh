#!/usr/bin/env bash
# 30_gate.sh — run the fixed gate on ONE arm. Responsibility: launch the
# server with this arm's flags, run gsm8k + gsm8kit + tools + humaneval +
# flores + bpb + benches, record everything (double-BOS check AFTER the
# requests, truncation counts inside the JSONs), tear down. bench.txt is
# written LAST and is the arm's resume marker (run_probe.sh skips an arm
# only when it exists).
# Usage: 30_gate.sh <tag> <gguf> <tokenizer_dir> [extra server flags...]
# All extra flags go to the server; --override-kv pairs are ALSO replayed on
# llama-perplexity in the bpb stage (bug fixed 2026-10-01: bpb used to run
# at the model's DEFAULT expert count — gate_probe_a40 REPORT.md).
set -uo pipefail
# shellcheck source=env.sh
. "$(dirname "$0")/env.sh"

TAG="${1:?tag}"; GGUF="$2"; TOK="$CELL/$3"; shift 3 || true
OUT="$RESULTS/$TAG"
mkdir -p "$OUT"
[ -f "$OUT/bench.txt" ] && { echo "30: [$TAG] already done (bench.txt)"; exit 0; }
rm -f "$OUT/gsm8k.json" "$OUT/gsm8kit.json" "$OUT/tools.json" \
      "$OUT/humaneval.json" "$OUT/flores-chrf.json" "$OUT/flores-wronglang.json" \
      "$OUT/bpb.json"

EXTRA=("$@")
ARM_KV=()
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--override-kv" ] && [ "$#" -ge 2 ]; then
    ARM_KV+=(--override-kv "$2"); shift 2
  else
    echo "30: [$TAG] note: arm flag '$1' is server-only (not replayed on bpb)"
    shift
  fi
done

LIMIT=()
[ -n "${PROBE_GEN_LIMIT:-}" ] && LIMIT=(--limit "$PROBE_GEN_LIMIT")

echo "30: [$TAG] start $(date +%H:%M:%S) — $GGUF ${EXTRA[*]:-}"
"$LLAMA_BIN/llama-server" -m "$GGUF" -ngl 99 -c 16384 --port "$PORT" "${EXTRA[@]+${EXTRA[@]}}" \
  >"$OUT/server.log" 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do
  curl -s "http://127.0.0.1:$PORT/health" | grep -q '"ok"' && break
  sleep 3
done
curl -s "http://127.0.0.1:$PORT/health" | grep -q '"ok"' \
  || { echo "30: [$TAG] server never became healthy (see $OUT/server.log)" >&2; exit 1; }

rc_gsm=0; rc_gsm8kit=0; rc_tools=0; rc_humaneval=0; rc_flores=0
# math at 8192: the probe cut reasoning models mid-think at 4096 (A40 REPORT
# reading 3); tools stay at the runner default (short answers, product parity)
GSM8K_MAX_TOKENS="${GSM8K_MAX_TOKENS:-8192}"
(cd "$EVAL" && "$PY" run_gen_eval.py --dataset gsm8k \
  --holdout "$EVAL/gsm8k-200.jsonl" --server "http://127.0.0.1:$PORT" \
  --max-tokens "$GSM8K_MAX_TOKENS" \
  --out "$OUT/gsm8k.json" "${LIMIT[@]:+${LIMIT[@]}}") > "$OUT/gsm8k.log" 2>&1 \
  || rc_gsm=$?
echo "30: [$TAG] gsm8k EXIT=$rc_gsm"

(cd "$EVAL" && "$PY" run_gen_eval.py --dataset gsm8kit \
  --holdout "$EVAL/gsm8kit-100.jsonl" --server "http://127.0.0.1:$PORT" \
  --max-tokens "$GSM8K_MAX_TOKENS" \
  --out "$OUT/gsm8kit.json" "${LIMIT[@]:+${LIMIT[@]}}") > "$OUT/gsm8kit.log" 2>&1 \
  || rc_gsm8kit=$?
echo "30: [$TAG] gsm8kit EXIT=$rc_gsm8kit"

(cd "$EVAL" && "$PY" run_gen_eval.py --dataset tools \
  --holdout "$EVAL/tools-100.jsonl" --server "http://127.0.0.1:$PORT" \
  --out "$OUT/tools.json" "${LIMIT[@]:+${LIMIT[@]}}") > "$OUT/tools.log" 2>&1 \
  || rc_tools=$?
echo "30: [$TAG] tools EXIT=$rc_tools"

(cd "$EVAL" && "$PY" run_humaneval.py \
  --holdout "$EVAL/humaneval-164.jsonl" --server "http://127.0.0.1:$PORT" \
  --out "$OUT/humaneval.json" "${LIMIT[@]:+${LIMIT[@]}}") > "$OUT/humaneval.log" 2>&1 \
  || rc_humaneval=$?
echo "30: [$TAG] humaneval EXIT=$rc_humaneval"

(cd "$EVAL" && "$PY" run_flores.py \
  --holdout "$EVAL/flores-devtest-100.jsonl" --server "http://127.0.0.1:$PORT" \
  --out-prefix "$OUT/flores" "${LIMIT[@]:+${LIMIT[@]}}") > "$OUT/flores.log" 2>&1 \
  || rc_flores=$?
echo "30: [$TAG] flores EXIT=$rc_flores"

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
  --langs "${PROBE_BPB_LANGS:-en,it,es,fr,zh}" \
  "${ARM_KV[@]+${ARM_KV[@]}}") \
  > "$OUT/bpb.log" 2>&1 || rc_bpb=$?
echo "30: [$TAG] bpb EXIT=$rc_bpb"

# two labelled benches: the GPU number ranks arms on THIS pod; the CPU
# number is the PC-proxy Fable-2 asked for — community vCPU counts vary, so
# it is a proxy, not a device number
NPROC="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 8)"
# community pods oversell vCPUs: this A40 pod advertises 96 CPUs under a
# 7.65-core cgroup quota, and -t 96 decode thrashes to ~0.25 tok/s (observed
# 2026-09-30) — bench at the quota the container actually has, min 2
if [ -r /sys/fs/cgroup/cpu.max ]; then
  qmax=$(cut -d" " -f1 /sys/fs/cgroup/cpu.max); qper=$(cut -d" " -f2 /sys/fs/cgroup/cpu.max)
  if [ "$qmax" != "max" ] && [ "$qmax" -gt 0 ] && [ $((qmax / qper)) -lt "$NPROC" ]; then
    NPROC=$(( qmax / qper )); [ "$NPROC" -lt 2 ] && NPROC=2
  fi
elif [ -r /sys/fs/cgroup/cpu/cpu.cfs_quota_us ] && [ -r /sys/fs/cgroup/cpu/cpu.cfs_period_us ]; then
  qmax=$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us); qper=$(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us)
  if [ "$qmax" -gt 0 ] && [ $((qmax / qper)) -lt "$NPROC" ]; then
    NPROC=$(( qmax / qper )); [ "$NPROC" -lt 2 ] && NPROC=2
  fi
fi
"$LLAMA_BIN/llama-bench" -m "$GGUF" -ngl 99 -p 512 -n 128 -r 2 \
  > "$OUT/bench.txt" 2>&1 || true
"$LLAMA_BIN/llama-bench" -m "$GGUF" -ngl 0 -t "$NPROC" -p 512 -n 128 -r 2 \
  >> "$OUT/bench.txt" 2>&1 || true

# marker last, and only when every gate step succeeded: a failed step must
# not mark the arm done (Fable-3 §7.7)
if [ "$rc_gsm" = "0" ] && [ "$rc_gsm8kit" = "0" ] && [ "$rc_tools" = "0" ] \
   && [ "$rc_humaneval" = "0" ] && [ "$rc_flores" = "0" ] && [ "$rc_bpb" = "0" ]; then
  echo "30: [$TAG] done $(date +%H:%M:%S)"
else
  rm -f "$OUT/bench.txt"
  echo "30: [$TAG] INCOMPLETE (gsm8k=$rc_gsm gsm8kit=$rc_gsm8kit tools=$rc_tools" \
       "humaneval=$rc_humaneval flores=$rc_flores bpb=$rc_bpb) — marker withheld" >&2
  exit 1
fi
