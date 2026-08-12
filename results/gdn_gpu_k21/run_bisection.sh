#!/data/data/com.termux/files/usr/bin/bash
# K2.1 layer bisection. Offload is from the END:
# n_layer_all=24, i_gpu_start=max(25-N,0)
# N=1 output only; N=2 layer 23 FULL; N=3 layer 22 GDN + 23 FULL
set -eu
export LD_LIBRARY_PATH="${HOME}/gdn_k2/bin:/vendor/lib64:${LD_LIBRARY_PATH:-}"
ROOT="${HOME}/gdn_k2"
BIN="${ROOT}/bin/llama-cli"
MODEL="${ROOT}/models/Qwen3.5-2B-Q4_K_M.gguf"
LOGDIR="${ROOT}/k21/logs"
mkdir -p "${LOGDIR}"

PROMPT="The capital of France is"
NTOK="${NTOK:-32}"
# Default n_ctx=0 → model 262144 → 3 GiB F16 KV. First-token garbage is
# independent of allocated ctx; 512 is enough for this prompt + 32 toks.
NCTX="${NCTX:-512}"
TABLE="${LOGDIR}/bisection_table.tsv"
echo -e "N\tok\tfirst_line\tpp_tps\ttg_tps\texit" > "${TABLE}"

extract_gen() {
  # first non-empty line after "[Start thinking]"
  awk '
    /\[Start thinking\]/ {p=1; next}
    p && NF {print; exit}
  ' "$1"
}

run_one() {
  local tag="$1"; shift
  local cmdf="${LOGDIR}/${tag}.cmd"
  local txt="${LOGDIR}/${tag}.txt"
  local err="${LOGDIR}/${tag}.err"
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
  local pp tg
  pp="$(sed -n 's/.*Prompt: \([0-9.]*\) t\/s.*/\1/p' "${txt}" | tail -1)"
  tg="$(sed -n 's/.*Generation: \([0-9.]*\) t\/s.*/\1/p' "${txt}" | tail -1)"
  local ok=NO
  case "${first}" in
    Thinking*) ok=YES ;;
  esac
  echo -e "${tag}\t${ok}\t${first}\t${pp}\t${tg}\t${ec}" | tee -a "${TABLE}"
  echo "=== DONE ${tag} ok=${ok} exit=${ec} ===" >&2
}

# Confirm layer assignment once (N=2 verbose)
echo "=== verbose N=2 layer map ===" >&2
printf '%s\n' "${PROMPT}" | "${BIN}" -m "${MODEL}" -c "${NCTX}" --temp 0 -s 42 -n 1 -no-cnv -st -ngl 2 -fa off -v \
  > "${LOGDIR}/ngl2_verbose.txt" 2> "${LOGDIR}/ngl2_verbose.err" || true
grep -E 'offloaded|assigned to device|layer' "${LOGDIR}/ngl2_verbose.err" | head -80 \
  > "${LOGDIR}/ngl2_layer_map.txt" || true

# CPU twin at the same -c, then bisection. N=3 is first GDN (N=2 is first FULL attn).
run_one "ngl0_cpu" -ngl 0
for N in 1 2 3 4 8 12 16 20 24; do
  run_one "ngl${N}_faoff" -ngl "${N}" -fa off
done

echo "=== BISECTION TABLE ==="
cat "${TABLE}"
