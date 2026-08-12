#!/data/data/com.termux/files/usr/bin/bash
# CPU-fix benches. Speed only when UNPLUGGED and batt >= 45.
set -eu
export LD_LIBRARY_PATH="${HOME}/gdn_k2/bin_cpufix:/vendor/lib64:${LD_LIBRARY_PATH:-}"
ROOT="${HOME}/gdn_k2"
BIN="${ROOT}/bin_cpufix"
MODEL="${ROOT}/models/Qwen3.5-2B-Q4_K_M.gguf"
# Task asked for ~/gdn_k2/Qwen3.5-2B-Q4_K_M.gguf; fall back to models/ if needed.
if [ ! -f "${MODEL}" ] && [ -f "${ROOT}/Qwen3.5-2B-Q4_K_M.gguf" ]; then
  MODEL="${ROOT}/Qwen3.5-2B-Q4_K_M.gguf"
fi
LOGDIR="${ROOT}/cpufix/logs"
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

assert_unplugged() {
  local js=""
  if command -v termux-battery-status >/dev/null 2>&1; then
    js="$(termux-battery-status 2>/dev/null || true)"
  fi
  if echo "${js}" | grep -q '"plugged": "UNPLUGGED"'; then
    return 0
  fi
  # dumpsys: plugged: 0 means unplugged
  local plugged
  plugged="$(dumpsys battery 2>/dev/null | awk '/^\s*plugged:/{print $2; exit}')"
  if [ "${plugged:-1}" = "0" ]; then
    return 0
  fi
  echo "REFUSE: phone is plugged. Unplug and rerun." >&2
  echo "${js}" >&2
  dumpsys battery 2>/dev/null | head -n 20 >&2 || true
  exit 7
}

assert_batt() {
  local lvl=""
  if command -v termux-battery-status >/dev/null 2>&1; then
    lvl="$(termux-battery-status 2>/dev/null | awk -F: '/"percentage"/{gsub(/[^0-9]/,"",$2); print $2; exit}')"
  fi
  if [ -z "${lvl}" ]; then
    lvl="$(dumpsys battery 2>/dev/null | awk '/^\s*level:/{print $2; exit}')"
  fi
  if [ -z "${lvl}" ] || [ "${lvl}" -lt 45 ]; then
    echo "REFUSE: battery ${lvl:-unknown}% < 45" >&2
    exit 8
  fi
  echo "battery=${lvl}% unplugged OK"
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
  return "${ec}"
}

MODE="${1:-help}"
shift || true

case "${MODE}" in
  batt)
    batt "${1:-now}"
    ;;
  sha)
    (cd "${BIN}" && sha256sum llama-bench llama-cli libc++_shared.so)
    ;;
  bench-cpu)
    assert_unplugged
    assert_batt
    batt "before_bench_cpu"
    run_cmd bench_cpu \
      "${BIN}/llama-bench" -m "${MODEL}" -t 4 -ngl 0 -p 128 -n 256 -r 2 -o json
    batt "after_bench_cpu"
    ;;
  bench-gpu)
    assert_unplugged
    assert_batt
    batt "before_bench_gpu"
    run_cmd bench_gpu_faoff \
      "${BIN}/llama-bench" -m "${MODEL}" -t 4 -ngl 99 -fa off -p 128 -n 256 -r 2 -o json
    batt "after_bench_gpu"
    ;;
  all)
    assert_unplugged
    assert_batt
    batt "before_all"
    run_cmd bench_cpu \
      "${BIN}/llama-bench" -m "${MODEL}" -t 4 -ngl 0 -p 128 -n 256 -r 2 -o json
    run_cmd bench_gpu_faoff \
      "${BIN}/llama-bench" -m "${MODEL}" -t 4 -ngl 99 -fa off -p 128 -n 256 -r 2 -o json
    batt "after_all"
    ;;
  *)
    echo "usage: $0 {batt|sha|bench-cpu|bench-gpu|all}" >&2
    exit 2
    ;;
esac
