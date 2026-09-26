# arm.sh — one measured arm. One responsibility: build the llama-completion
# command for a backend, run it on the device, pull its log, and parse
# timings + backend proof out of that log. Nothing else (gates, cooldown and
# row bookkeeping live in d_run.sh).
#
# Flag provenance: the kit's own help (npu-spec-verify/raw/s23-prep/
# completion_help.log) — `-p`, `-n`, `--ignore-eos` (:257), `--seed`, `--temp`,
# `--perf` default false (:45), `--no-warmup` (:340), `-dev/--device` (:121),
# `-lm` (used by every npu-spec-verify call). Backend flags are
# npu-spec-verify/d_run.sh's arm B/C selection, with the GPU arm swapped in
# from `--list-devices` (GPUOpenCL: QUALCOMM Adreno(TM)).

arm_backend_flags() {
  case "$1" in
    cpu) printf '%s' "-ngl 0" ;;
    gpu) printf '%s' "-dev GPUOpenCL -ngl 99" ;;
    npu) printf '%s' "-dev HTP0 -ngl 99 -nkvo" ;;
    *) return 1 ;;
  esac
}

# Prompt is embedded single-quoted; d_run.sh refuses any prompt text holding
# a single quote before the first arm (load_prompt), so this cannot break.
arm_remote_cmd() {
  local backend="$1" tag="$2" flags
  flags=$(arm_backend_flags "$backend") || return 1
  printf 'cd %s && export LD_LIBRARY_PATH=%s/lib && export ADSP_LIBRARY_PATH=%s/lib && export GGML_HEXAGON_NDEV=1 && export GGML_HEXAGON_VERBOSE=1 && ./bin/llama-completion -m %s/ship.gguf -lm none -p %s -n 127 --ignore-eos --seed 1 --temp 0 -c 2048 -b 2048 -ub 1024 -t 8 -fa 1 --no-warmup --perf --simple-io --no-display-prompt %s > %s/%s.log 2>&1; rc=$?; echo EXIT=$rc >> %s/%s.log; exit $rc' \
    "$D" "$D" "$D" "$D" "$PROMPT_TEXT" "$flags" "$D" "$tag" "$D" "$tag"
}

# Sets ARM_WALL_S; pulls $D/<tag>.log to $RAW/<tag>.log (pull failure
# is not fatal here — arm_parse marks a missing log as run_fail).
arm_run() {
  local backend="$1" tag="$2" t0 t1 rc
  t0=$(date +%s)
  set +e
  adbT "$ARM_TIMEOUT_S" -s "$SER" shell "$(arm_remote_cmd "$backend" "$tag")" > "$RAW/${tag}_shell.txt" 2>&1
  rc=$?
  set -e
  t1=$(date +%s)
  ARM_WALL_S=$((t1 - t0))
  printf 'EXIT=%s wall_s=%s\n' "$rc" "$ARM_WALL_S" >> "$RAW/${tag}_shell.txt"
  adbT 60 -s "$SER" pull "$D/$tag.log" "$RAW/$tag.log" >> "$RAW/${tag}_pull.txt" 2>&1 || true
}

# arm_parse <tag> <backend>: sets ARM_STATUS (OK|VOID), ARM_VOID (reason),
# ARM_PROOF, ARM_PROMPT_N, ARM_PREFILL_MS, ARM_RUNS, ARM_DECODE_TPS.
# Proof rule (npu-spec-verify REPORT): HTP means `HTP0 execute-op` dispatch
# lines AND a `Hexagon Arch version` line — identical tokens alone would allow
# silent CPU fallback, so missing proof is METHOD-VOID, not a slow data point.
arm_parse() {
  # Separate `local`s: in `local a="$1" logf="$RAW/$a.log"` the second
  # expansion would see the OUTER (unset) a — unbound under set -u.
  local tag="$1"
  local backend="$2"
  local logf="$RAW/$tag.log"
  local exit_line=""
  ARM_STATUS=VOID; ARM_VOID=run_fail; ARM_PROOF=na
  ARM_PROMPT_N=na; ARM_PREFILL_MS=na; ARM_RUNS=na; ARM_DECODE_TPS=na
  [ -f "$logf" ] || return 0
  exit_line=$(sed -n 's/^EXIT=//p' "$logf" | tail -1)
  [ "$exit_line" = "0" ] || return 0
  # Field layout of the kit's perf lines (see ../npu-spec-verify/raw/s23/
  # A.log): "llama_perf_context_print: prompt eval time = <ms> ms / <tok>
  # tokens (...)" and "llama_perf_context_print:        eval time = <ms> ms
  # / <runs> runs (...)" — so $2 selects the line, ms/tok land on $6/$9 for
  # the prompt line and $5/$8 for the eval line.
  read -r ARM_PREFILL_MS ARM_PROMPT_N <<< "$(awk '$1=="llama_perf_context_print:" && $2=="prompt" && $3=="eval" {ms=$6; tok=$9} END{if (tok!="") print ms, tok}' "$logf")"
  read -r ARM_RUNS eval_ms <<< "$(awk '$1=="llama_perf_context_print:" && $2=="eval" && $3=="time" {ms=$5; runs=$8} END{if (runs!="") print runs, ms}' "$logf")"
  case "$ARM_PROMPT_N" in ''|*[!0-9]*) ARM_PROMPT_N=na;; esac
  case "$ARM_RUNS" in ''|*[!0-9]*) ARM_RUNS=na;; esac
  # Both perf numbers are the turn: a log without them is a truncated or
  # perf-less run, not a measurement (run_fail, same as a nonzero exit).
  case "$ARM_PREFILL_MS" in ''|*[!0-9.]*|.) ARM_VOID=run_fail; return 0;; esac
  [ "$ARM_PROMPT_N" != na ] || { ARM_VOID=run_fail; return 0; }
  [ "$ARM_RUNS" != na ] || { ARM_VOID=run_fail; return 0; }
  if [ "${ARM_RUNS:-na}" != na ] && [ -n "${eval_ms:-}" ]; then
    ARM_DECODE_TPS=$(awk -v r="$ARM_RUNS" -v m="$eval_ms" 'BEGIN{if (m+0>0) printf "%.2f", 1000*r/m; else print "na"}')
  fi
  case "$backend" in
    cpu)
      # Probe lesson from npu-spec-verify/raw/s23/A.log: even with -ngl 0 the
      # log prints `using device GPUOpenCL` (bare device discovery), so only
      # load-tensor ASSIGNMENTS discriminate the backend that actually ran.
      if ! awk '/assigned to device CPU/{n++} END{exit !(n>0)}' "$logf"; then
        ARM_VOID=no_cpu_proof; return 0
      fi
      if awk '/assigned to device (GPUOpenCL|HTP0)/ || /HTP0 execute-op/{n++} END{exit !(n>0)}' "$logf"; then
        ARM_VOID=cpu_backend_leak; ARM_PROOF=cpu_offload_lines_gt0; return 0
      fi
      ARM_PROOF=cpu_no_offload ;;
    gpu)
      if ! awk '/assigned to device GPUOpenCL/{n++} END{exit !(n>0)}' "$logf"; then
        ARM_VOID=no_gpu_proof; return 0
      fi
      ARM_PROOF="gpu_assigned_lines=$(awk '/assigned to device GPUOpenCL/{n++} END{print n+0}' "$logf")" ;;
    npu)
      if ! awk '/HTP0 execute-op/{n++} END{exit !(n>0)}' "$logf"; then
        ARM_VOID=no_htp_proof; return 0
      fi
      if ! awk '/Hexagon Arch version/{n++} END{exit !(n>0)}' "$logf"; then
        ARM_VOID=no_htp_proof; return 0
      fi
      ARM_PROOF="htp_ops=$(awk '/HTP0 execute-op/{n++} END{print n+0}' "$logf") arch=$(sed -n 's/.*Hexagon Arch version \([^ ,]*\).*/\1/p' "$logf" | head -1)" ;;
  esac
  ARM_STATUS=OK; ARM_VOID=na
  return 0
}
