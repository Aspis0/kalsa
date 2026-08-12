#!/data/data/com.termux/files/usr/bin/bash
# Isolate output_norm vs tied lm_head (token_embd Q6_K [2048, 248320]).
set -eu
export LD_LIBRARY_PATH="${HOME}/gdn_k2/bin:/vendor/lib64:${LD_LIBRARY_PATH:-}"
ROOT="${HOME}/gdn_k2"
BIN="${ROOT}/bin/llama-cli"
MODEL="${ROOT}/models/Qwen3.5-2B-Q4_K_M.gguf"
LOGDIR="${ROOT}/k21/logs"
mkdir -p "${LOGDIR}"
PROMPT="The capital of France is"
NTOK=32
NCTX=512

extract_gen() {
  awk '/\[Start thinking\]/ {p=1; next} p && NF {print; exit}' "$1"
}

run_one() {
  local tag="$1"; shift
  local txt="${LOGDIR}/${tag}.txt"
  local err="${LOGDIR}/${tag}.err"
  local cmdf="${LOGDIR}/${tag}.cmd"
  {
    echo "date=$(date -Iseconds)"
    echo "tag=${tag}"
    printf 'cmd='
    printf '%q ' "${BIN}" -m "${MODEL}" -c "${NCTX}" --temp 0 -s 42 -n "${NTOK}" -no-cnv -st "$@"
    echo
  } > "${cmdf}"
  echo "=== RUN ${tag} $* ===" >&2
  set +e
  printf '%s\n' "${PROMPT}" | "${BIN}" -m "${MODEL}" -c "${NCTX}" --temp 0 -s 42 -n "${NTOK}" -no-cnv -st "$@" > "${txt}" 2> "${err}"
  local ec=$?
  set -e
  echo "exit=${ec}" >> "${cmdf}"
  local first
  first="$(extract_gen "${txt}" || true)"
  local ok=NO
  case "${first}" in Thinking*) ok=YES ;; esac
  echo "RESULT ${tag} ok=${ok} exit=${ec} first=${first}" | tee -a "${LOGDIR}/isolate_table.txt"
}

echo "=== probe buffer types ===" >&2
"${BIN}" -m "${MODEL}" -ngl 0 -ot '___none___=___none___' -h > "${LOGDIR}/ot_probe.txt" 2> "${LOGDIR}/ot_probe.err" || true
grep -A20 'Available buffer types' "${LOGDIR}/ot_probe.err" "${LOGDIR}/ot_probe.txt" > "${LOGDIR}/ot_buft.txt" || true
cat "${LOGDIR}/ot_buft.txt" || true

# Common names: CPU, OpenCL
run_one iso_norm_cpu_lmhead_gpu -ngl 1 -fa off -ot 'output_norm.weight=CPU'
run_one iso_norm_gpu_lmhead_cpu -ngl 0 -ot 'output_norm.weight=OpenCL'
# If OpenCL name is GPUOpenCL, retry
if ! grep -q 'ok=' "${LOGDIR}/iso_norm_gpu_lmhead_cpu.cmd" 2>/dev/null; then
  :
fi
# If the OpenCL override failed, try GPUOpenCL
if grep -q 'unknown buffer type\|invalid' "${LOGDIR}/iso_norm_gpu_lmhead_cpu.err" 2>/dev/null; then
  run_one iso_norm_gpu_lmhead_cpu_alt -ngl 0 -ot 'output_norm.weight=GPUOpenCL'
fi

echo "=== ISOLATE DONE ==="
cat "${LOGDIR}/isolate_table.txt"
