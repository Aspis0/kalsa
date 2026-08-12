#!/data/data/com.termux/files/usr/bin/bash
# K2.2b on-device runner. Correctness may run plugged. Never bench plugged.
set -eu
export LD_LIBRARY_PATH="${HOME}/gdn_k2/bin_fix2:/vendor/lib64:${LD_LIBRARY_PATH:-}"
ROOT="${HOME}/gdn_k2"
BIN="${ROOT}/bin_fix2"
# Prefer the task-stated path; fall back to the K2.2 models/ layout.
if [ -f "${ROOT}/Qwen3.5-2B-Q4_K_M.gguf" ]; then
  MODEL="${ROOT}/Qwen3.5-2B-Q4_K_M.gguf"
else
  MODEL="${ROOT}/models/Qwen3.5-2B-Q4_K_M.gguf"
fi
LOGDIR="${ROOT}/k22b/logs"
mkdir -p "${LOGDIR}"

# Fixed long prompt (>=48 tokens). Do not change: this is the n>=32 prefill gate.
LONG_PROMPT='Write a careful step by step explanation of how a transformer language model turns a long prompt into the next token, covering tokenization, embedding lookup, attention over the full context, the feed forward layers, and the final language model head that produces a probability distribution.'

batt() {
  local tag="$1"
  {
    echo "=== battery ${tag} $(date -Iseconds) ==="
    if command -v termux-battery-status >/dev/null 2>&1; then
      termux-battery-status || true
    fi
    dumpsys battery 2>/dev/null | head -n 40 || true
  } | tee -a "${LOGDIR}/battery.txt"
}

run_cmd() {
  local tag="$1"
  shift
  {
    echo "date=$(date -Iseconds)"
    echo "tag=${tag}"
    echo "LD_LIBRARY_PATH=${LD_LIBRARY_PATH}"
    echo "MODEL=${MODEL}"
    printf 'cmd='
    printf '%q ' "$@"
    echo
  } > "${LOGDIR}/${tag}.cmd"
  echo "=== RUN ${tag} ===" >&2
  echo "cmd: $*" >&2
  set +e
  "$@" > "${LOGDIR}/${tag}.txt" 2> "${LOGDIR}/${tag}.err"
  local ec=$?
  set -e
  echo "exit=${ec}" | tee -a "${LOGDIR}/${tag}.cmd"
  echo "=== DONE ${tag} exit=${ec} ===" >&2
  return 0
}

MODE="${1:-help}"
shift || true

case "${MODE}" in
  batt)
    batt "${1:-now}"
    ;;
  ops-q6k)
    batt "before_ops_q6k"
    run_cmd test_MUL_MAT_q6k \
      "${BIN}/test-backend-ops" test -b GPUOpenCL -o MUL_MAT -p q6_K
    batt "after_ops_q6k"
    ;;
  ops-q4k)
    batt "before_ops_q4k"
    run_cmd test_MUL_MAT_q4k \
      "${BIN}/test-backend-ops" test -b GPUOpenCL -o MUL_MAT -p q4_K
    batt "after_ops_q4k"
    ;;
  ops-gdn)
    batt "before_ops_gdn"
    run_cmd test_GATED_DELTA_NET \
      "${BIN}/test-backend-ops" test -b GPUOpenCL -o GATED_DELTA_NET
    run_cmd test_gdn_family \
      "${BIN}/test-backend-ops" test -b GPUOpenCL -o SSM_CONV -o L2_NORM -o SOLVE_TRI -o CUMSUM
    batt "after_ops_gdn"
    ;;
  greedy-short-cpu)
    batt "before_greedy_short_cpu"
    printf '%s\n' "The capital of France is" | \
      run_cmd greedy_short_cpu \
        "${BIN}/llama-cli" -m "${MODEL}" -c 512 --temp 0 -s 42 -n 32 -no-cnv -st -ngl 0 -t 4
    batt "after_greedy_short_cpu"
    ;;
  greedy-short-gpu)
    batt "before_greedy_short_gpu"
    printf '%s\n' "The capital of France is" | \
      run_cmd greedy_short_gpu \
        "${BIN}/llama-cli" -m "${MODEL}" -c 512 --temp 0 -s 42 -n 32 -no-cnv -st -ngl 99 -fa off -t 4
    batt "after_greedy_short_gpu"
    ;;
  greedy-long-cpu)
    batt "before_greedy_long_cpu"
    printf '%s\n' "${LONG_PROMPT}" | \
      run_cmd greedy_long_cpu \
        "${BIN}/llama-cli" -m "${MODEL}" -c 512 --temp 0 -s 42 -n 24 -no-cnv -st -ngl 0 -t 4
    batt "after_greedy_long_cpu"
    ;;
  greedy-long-gpu)
    batt "before_greedy_long_gpu"
    printf '%s\n' "${LONG_PROMPT}" | \
      run_cmd greedy_long_gpu \
        "${BIN}/llama-cli" -m "${MODEL}" -c 512 --temp 0 -s 42 -n 24 -no-cnv -st -ngl 99 -fa off -t 4
    batt "after_greedy_long_gpu"
    ;;
  *)
    echo "usage: $0 {batt|ops-q6k|ops-q4k|ops-gdn|greedy-short-cpu|greedy-short-gpu|greedy-long-cpu|greedy-long-gpu}" >&2
    exit 2
    ;;
esac
