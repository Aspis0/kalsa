#!/data/data/com.termux/files/usr/bin/bash
# K2.2 on-device runner. Correctness may run plugged; speed is UNPLUGGED only.
set -eu
export LD_LIBRARY_PATH="${HOME}/gdn_k2/bin_fix:/vendor/lib64:${LD_LIBRARY_PATH:-}"
ROOT="${HOME}/gdn_k2"
BIN="${ROOT}/bin_fix"
MODEL="${ROOT}/models/Qwen3.5-2B-Q4_K_M.gguf"
LOGDIR="${ROOT}/k22/logs"
mkdir -p "${LOGDIR}"

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
  ops-gdn)
    batt "before_ops_gdn"
    run_cmd test_GATED_DELTA_NET \
      "${BIN}/test-backend-ops" test -b GPUOpenCL -o GATED_DELTA_NET
    run_cmd test_gdn_family \
      "${BIN}/test-backend-ops" test -b GPUOpenCL -o SSM_CONV -o L2_NORM -o SOLVE_TRI -o CUMSUM
    batt "after_ops_gdn"
    ;;
  greedy-cpu)
    batt "before_greedy_cpu"
    printf '%s\n' "The capital of France is" | \
      run_cmd greedy_cpu \
        "${BIN}/llama-cli" -m "${MODEL}" -c 512 --temp 0 -s 42 -n 32 -no-cnv -st -ngl 0 -t 4
    batt "after_greedy_cpu"
    ;;
  greedy-gpu)
    batt "before_greedy_gpu"
    printf '%s\n' "The capital of France is" | \
      run_cmd greedy_gpu_faoff \
        "${BIN}/llama-cli" -m "${MODEL}" -c 512 --temp 0 -s 42 -n 32 -no-cnv -st -ngl 99 -fa off -t 4
    batt "after_greedy_gpu"
    ;;
  bench-cpu)
    batt "before_bench_cpu"
    run_cmd bench_cpu \
      "${BIN}/llama-bench" -m "${MODEL}" -t 4 -ngl 0 -p 128 -n 256 -r 2 -o json
    # llama-bench writes json to stdout; keep a dedicated json copy
    cp -f "${LOGDIR}/bench_cpu.txt" "${LOGDIR}/bench_cpu.json" || true
    batt "after_bench_cpu"
    ;;
  bench-gpu)
    batt "before_bench_gpu"
    run_cmd bench_gpu_faoff \
      "${BIN}/llama-bench" -m "${MODEL}" -t 4 -ngl 99 -fa off -p 128 -n 256 -r 2 -o json
    cp -f "${LOGDIR}/bench_gpu_faoff.txt" "${LOGDIR}/bench_gpu_faoff.json" || true
    batt "after_bench_gpu"
    ;;
  *)
    echo "usage: $0 {batt|ops-q6k|ops-gdn|greedy-cpu|greedy-gpu|bench-cpu|bench-gpu}" >&2
    exit 2
    ;;
esac
