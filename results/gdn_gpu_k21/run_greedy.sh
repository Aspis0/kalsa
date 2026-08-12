#!/data/data/com.termux/files/usr/bin/bash
# K2.1 greedy runner — one variable at a time. Do not delete anything.
set -eu
export LD_LIBRARY_PATH="${HOME}/gdn_k2/bin:/vendor/lib64:${LD_LIBRARY_PATH:-}"
ROOT="${HOME}/gdn_k2"
BIN="${ROOT}/bin/llama-cli"
MODEL="${ROOT}/models/Qwen3.5-2B-Q4_K_M.gguf"
LOGDIR="${ROOT}/k21/logs"
mkdir -p "${LOGDIR}"

TAG="${1:?tag}"
shift
PROMPT="${PROMPT:-The capital of France is}"
NTOK="${NTOK:-32}"
NCTX="${NCTX:-512}"

CMD=( "${BIN}" -m "${MODEL}" -c "${NCTX}" --temp 0 -s 42 -n "${NTOK}" -no-cnv -st "$@" )

{
  echo "date=$(date -Iseconds)"
  echo "tag=${TAG}"
  echo "NTOK=${NTOK}"
  echo "PROMPT=${PROMPT}"
  echo "LD_LIBRARY_PATH=${LD_LIBRARY_PATH}"
  printf 'cmd='
  printf '%q ' "${CMD[@]}"
  echo
} > "${LOGDIR}/${TAG}.cmd"

echo "=== RUN ${TAG} ===" >&2
echo "cmd: ${CMD[*]}" >&2

set +e
printf '%s\n' "${PROMPT}" | "${CMD[@]}" > "${LOGDIR}/${TAG}.txt" 2> "${LOGDIR}/${TAG}.err"
EC=$?
set -e
echo "exit=${EC}" | tee -a "${LOGDIR}/${TAG}.cmd"
echo "=== DONE ${TAG} exit=${EC} ===" >&2
exit "${EC}"
