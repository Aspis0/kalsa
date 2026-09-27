# arm.sh — one measured arm (its proof run, its turn, its parses). One
# responsibility: build the llama-completion commands, run them, pull the
# logs, and parse proof + timings. Gates, cooldown and rows live in d_run.sh;
# stop logic in stop_lib.sh; sampler lifecycle in sampler.sh.
#
# Two-phase design (owner decision on audit dd6bdb56 A-1/A-2):
#   PROOF RUN = the load phase: same model/backend flags, a few tokens
#   (`-p " " -n 4 --ignore-eos --no-perf`), at `-lv 5` with
#   GGML_HEXAGON_VERBOSE=1 and GGML_OPENCL_LOG_KERNELS=1 — the only place
#   verbose/per-op output is allowed. All audited proof thresholds are
#   evaluated on this log, where LLAMA_LOG_DEBUG/GGML_LOG_DEBUG exist
#   (`load_tensors: assigned to device` is LLAMA_LOG_DEBUG, llama-model.cpp:1526;
#   execute-op is GGML_LOG_DEBUG gated on GGML_HEXAGON_VERBOSE,
#   ggml-hexagon.cpp:146-153; at default -lv 3 only WARN/ERROR pass —
#   common/log.cpp get_verbosity(INFO)=TRACE(4) > thold(3)).
#   MEASURED TURN = default verbosity, only LD/ADSP/GGML_HEXAGON_NDEV env,
#   `-t 5` (owner: app S23 preset sd-8-gen2 decode5/prefill5,
#   kalsa/src/engine/deviceTuning.ts:217-219); voided if its default-level
#   fingerprint differs from the proof run's.
#
# Flag provenance: kit help (npu-spec-verify/raw/s23-prep/completion_help.log)
# — `-f/--file` :48, `--ignore-eos` :257, `--perf` default false :45,
# `--no-warmup` :340, `-dev/--device` :121, `-lv 5` (STEP0's diagnostic) —
# and `-n %d` fed by DECODE_N below (N-1 eval runs, device-evidenced:
# -n 127 -> 126, -n 64 -> 63, s23-cli-heat/s23-cli-diag raw logs).
#
# Prompt identity (A15b): the turn reads THE verified file `-f $D/prompt.txt`,
# whose sha256 kit.sh checks against PROMPT.meta — verified copy = used copy.

# A6 proof thresholds, stated: 33-layer graph (audited, unchanged; they now
# run against the -lv 5 proof log):
#   N: >= 1000 `HTP0 execute-op` lines (~30 per layer; priors q58 3430@n1024,
#      q57 1764) — below that dispatch collapsed to init, not the run.
#   G: >= 30 `assigned to device GPUOpenCL` lines AND >= 8 distinct
#      `GGML_OPENCL_LOG_KERNELS:` dispatch lines (emitted from inside
#      enqueue_ndrange_kernel, ggml-opencl-kalsa-diag.cpp:36-44) and zero
#      `kernel set failed ... device disabled` lines.
#   C: >= 1 `assigned to device CPU` and zero offload assignment/execute —
#      meaningful only on the -lv 5 log (audit A-15).
MIN_HTP_OPS=1000
MIN_GPU_ASSIGN=30
MIN_GPU_KERNELS=8
# The -n of the measured turn. One definition feeds BOTH the -n flag and
# d_run's equal-decode gate (N-1 eval runs), so they cannot drift apart.
DECODE_N="${DECODE_N:-127}"

arm_backend_flags() {
  case "$1" in
    cpu) printf '%s' "-ngl 0" ;;
    gpu) printf '%s' "-dev GPUOpenCL -ngl 99" ;;
    npu) printf '%s' "-dev HTP0 -ngl 99 -nkvo" ;;
    *) return 1 ;;
  esac
}

# Env shared by both phases: device discovery only, no per-op output.
arm_env() {
  printf 'cd %s && export LD_LIBRARY_PATH=%s/lib && export ADSP_LIBRARY_PATH=%s/lib && export GGML_HEXAGON_NDEV=1 && ' \
    "$D" "$D" "$D"
}
# Proof-only env (A-2: verbose output lives exclusively in the load phase).
arm_proof_env() {
  printf '%s&& export GGML_HEXAGON_VERBOSE=1 && export GGML_OPENCL_LOG_KERNELS=1 && ' "$(arm_env)"
}

# The measured turn: 1018-token prefill from the verified file + DECODE_N
# decode tokens, EOS ignored, greedy, default verbosity.
arm_remote_cmd() {
  local backend="$1" tag="$2" flags
  flags=$(arm_backend_flags "$backend") || return 1
  printf '%s./bin/llama-completion -m %s/ship.gguf -lm none -f %s/prompt.txt -n %d --ignore-eos --seed 1 --temp 0 -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt %s > %s/%s.log 2>&1; rc=$?; echo EXIT=$rc >> %s/%s.log; exit $rc' \
    "$(arm_env)" "$D" "$D" "$DECODE_N" "$flags" "$D" "$tag" "$D" "$tag"
}

# The proof run doubles as the load phase: page-in, weight upload and the
# OpenCL kernel compile happen here (outside the measured window), with a
# few tokens at -lv 5 so every audited proof line exists in this log only.
arm_load_cmd() {
  local backend="$1" tag="$2" flags
  flags=$(arm_backend_flags "$backend") || return 1
  printf '%s./bin/llama-completion -m %s/ship.gguf -lm none -p " " -n 4 --ignore-eos --seed 1 --temp 0 -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --no-perf --simple-io --no-display-prompt -lv 5 %s > %s/%s.load.log 2>&1; rc=$?; echo EXIT=$rc >> %s/%s.load.log; exit $rc' \
    "$(arm_proof_env)" "$D" "$flags" "$D" "$tag" "$D" "$tag"
}

# A timeout here (perl alarm killed adb: rc 124, or 142 = SIGALRM) leaves the
# remote llama-completion running — kill and VERIFY it (A-4: stop_lib's
# kill_remote_llama checks with pgrep and records kill_unverified on failure).
arm_kill_orphan() {
  local backend="$1" rc="$2"
  log "ARM_TIMEOUT backend=$backend rc=$rc -> killing remote llama-completion"
  kill_remote_llama "arm_timeout_$backend" || true
}

# arm_load <backend> <tag>: the proof run. Sets ARM_LOAD_WALL_S,
# ARM_LOAD_RC; pulls $D/<tag>.load.log for the record.
arm_load() {
  local backend="$1" tag="$2" t0 t1 rc
  t0=$(date +%s)
  set +e
  adbT "$ARM_TIMEOUT_S" -s "$SER" shell "$(arm_load_cmd "$backend" "$tag")" > "$RAW/${tag}.load_shell.txt" 2>&1
  rc=$?
  set -e
  t1=$(date +%s)
  ARM_LOAD_WALL_S=$((t1 - t0)); ARM_LOAD_RC=$rc
  if [ "$rc" -ge 124 ]; then arm_kill_orphan "$backend" "$rc"; fi
  adbT 60 -s "$SER" pull "$D/$tag.load.log" "$RAW/$tag.load.log" >> "$RAW/${tag}.load_pull.txt" 2>&1 || true
  return 0
}

# arm_run <backend> <tag>: the measured turn. Sets ARM_WALL_S, ARM_RC.
arm_run() {
  local backend="$1" tag="$2" t0 t1 rc
  t0=$(date +%s)
  set +e
  adbT "$ARM_TIMEOUT_S" -s "$SER" shell "$(arm_remote_cmd "$backend" "$tag")" > "$RAW/${tag}_shell.txt" 2>&1
  rc=$?
  set -e
  t1=$(date +%s)
  ARM_WALL_S=$((t1 - t0)); ARM_RC=$rc
  if [ "$rc" -ge 124 ]; then arm_kill_orphan "$backend" "$rc"; fi
  printf 'EXIT=%s wall_s=%s\n' "$rc" "$ARM_WALL_S" >> "$RAW/${tag}_shell.txt"
  adbT 60 -s "$SER" pull "$D/$tag.log" "$RAW/$tag.log" >> "$RAW/${tag}_pull.txt" 2>&1 || true
}

# Backend fingerprint at DEFAULT verbosity — the three components that exist
# without -lv (owner decision: "whatever default-level lines exist; state
# which"): fit line (W, run-1 evidence), HTP0-memory warning (W, run-1
# evidence; absent when -dev excludes HTP0, i.e. the G arm), n_threads
# (tool INFO, run-1 evidence). Missing pieces print `?` and fail closed.
arm_fingerprint() {
  local logf="$1" ngl="" thr="" htp=""
  if [ -f "$logf" ]; then
    ngl=$(sed -n 's/.*n_gpu_layers already set by user to \([0-9][0-9]*\).*/\1/p' "$logf" | head -1)
    thr=$(sed -n 's/.*system_info: n_threads = \([0-9][0-9]*\).*/\1/p' "$logf" | head -1)
    htp=$(awk '/common_get_device_memory_data_impl: device HTP0 did not report memory/{print 1; exit}' "$logf")
  fi
  printf 'ngl=%s htp=%s thr=%s' "${ngl:-?}" "${htp:-0}" "${thr:-?}"
}

# arm_parse_proof <tag> <backend>: gates the -lv 5 proof log — exit, all
# three fingerprint pieces, then the audited thresholds. Sets ARM_STATUS,
# ARM_VOID, ARM_PROOF, ARM_PROOF_FP.
arm_parse_proof() {
  local tag="$1"
  local backend="$2"
  local logf="$RAW/$tag.load.log"
  local exit_line="" gpu_assign=0 gpu_kernels=0 htp_ops=0
  ARM_STATUS=VOID; ARM_VOID=proof_run_fail; ARM_PROOF=na; ARM_PROOF_FP="?"
  [ -f "$logf" ] || return 0
  exit_line=$(sed -n 's/^EXIT=//p' "$logf" | tail -1)
  [ "$exit_line" = "0" ] || return 0
  ARM_PROOF_FP=$(arm_fingerprint "$logf")
  case "$ARM_PROOF_FP" in
    *"=?"*) ARM_VOID=no_fingerprint; return 0 ;;
  esac
  case "$backend" in
    cpu)
      if ! awk '/assigned to device CPU/{n++} END{exit !(n>0)}' "$logf"; then
        ARM_VOID=no_cpu_proof; return 0
      fi
      # Leak check (A-15): meaningful on this log — device lines exist here.
      if awk '/assigned to device (GPUOpenCL|HTP0)/ || /HTP0 execute-op/{n++} END{exit !(n>0)}' "$logf"; then
        ARM_VOID=cpu_backend_leak; ARM_PROOF=cpu_offload_lines_gt0; return 0
      fi
      ARM_PROOF=cpu_no_offload ;;
    gpu)
      gpu_assign=$(awk '/assigned to device GPUOpenCL/{n++} END{print n+0}' "$logf")
      if [ "$gpu_assign" -lt "$MIN_GPU_ASSIGN" ]; then
        ARM_VOID=no_gpu_proof; ARM_PROOF="gpu_assigned_lines=$gpu_assign"; return 0
      fi
      gpu_kernels=$(awk '/^GGML_OPENCL_LOG_KERNELS:/{n++} END{print n+0}' "$logf")
      if [ "$gpu_kernels" -lt "$MIN_GPU_KERNELS" ]; then
        ARM_VOID=gpu_exec_low; ARM_PROOF="gpu_assigned_lines=$gpu_assign kernels=$gpu_kernels"; return 0
      fi
      if awk '/kernel set failed to build|device disabled/{n++} END{exit !(n>0)}' "$logf"; then
        ARM_VOID=gpu_disabled; ARM_PROOF="gpu_assigned_lines=$gpu_assign kernels=$gpu_kernels"; return 0
      fi
      ARM_PROOF="gpu_assigned_lines=$gpu_assign kernels=$gpu_kernels" ;;
    npu)
      htp_ops=$(awk '/HTP0 execute-op/{n++} END{print n+0}' "$logf")
      if [ "$htp_ops" -eq 0 ]; then
        ARM_VOID=no_htp_proof; return 0
      fi
      if [ "$htp_ops" -lt "$MIN_HTP_OPS" ]; then
        ARM_VOID=htp_ops_low; ARM_PROOF="htp_ops=$htp_ops"; return 0
      fi
      if ! awk '/Hexagon Arch version/{n++} END{exit !(n>0)}' "$logf"; then
        ARM_VOID=no_htp_proof; ARM_PROOF="htp_ops=$htp_ops"; return 0
      fi
      ARM_PROOF="htp_ops=$htp_ops arch=$(sed -n 's/.*Hexagon Arch version \([^ ,]*\).*/\1/p' "$logf" | head -1)" ;;
  esac
  ARM_STATUS=OK; ARM_VOID=na
  return 0
}

# arm_parse_turn <tag>: gates the measured turn's log — exit, perf values
# (prefix-relative: the kit prints `<ts> <level> ` before the label,
# raw/s23-cli-heat-20260926 t1cpu.log:48), then the fingerprint equality
# against the proof run. Sets ARM_TURN_FP for the log line.
arm_parse_turn() {
  local tag="$1"
  local logf="$RAW/$tag.log"
  local exit_line="" eval_ms="" fp=""
  ARM_STATUS=VOID; ARM_VOID=run_fail; ARM_TURN_FP=na
  ARM_PROMPT_N=na; ARM_PREFILL_MS=na; ARM_RUNS=na; ARM_DECODE_TPS=na; ARM_INLOAD_MS=na
  [ -f "$logf" ] || return 0
  exit_line=$(sed -n 's/^EXIT=//p' "$logf" | tail -1)
  [ "$exit_line" = "0" ] || return 0
  # Label-relative indexing: label+1 = prompt|eval|load; value at +5
  # (prompt) / +4 (eval, load); counts at +8 (tokens) / +7 (runs).
  read -r ARM_PREFILL_MS ARM_PROMPT_N <<< "$(awk '
    { for (i = 1; i <= NF; i++) if ($i == "common_perf_print:") break
      if ($i != "common_perf_print:") next
      if ($(i+1) == "prompt" && $(i+2) == "eval" && $(i+3) == "time") { ms = $(i+5); tok = $(i+8) }
    }
    END { if (tok != "") print ms, tok }' "$logf")"
  read -r ARM_RUNS eval_ms <<< "$(awk '
    { for (i = 1; i <= NF; i++) if ($i == "common_perf_print:") break
      if ($i != "common_perf_print:") next
      if ($(i+1) == "eval" && $(i+2) == "time" && $(i+3) == "=") { rms = $(i+4); runs = $(i+7) }
    }
    END { if (runs != "") print runs, rms }' "$logf")"
  ARM_INLOAD_MS=$(awk '
    { for (i = 1; i <= NF; i++) if ($i == "common_perf_print:") break
      if ($i != "common_perf_print:") next
      if ($(i+1) == "load" && $(i+2) == "time" && $(i+3) == "=") { lms = $(i+4) }
    }
    END { if (lms != "") print lms }' "$logf" | tail -1)
  case "$ARM_PROMPT_N" in ''|*[!0-9]*) ARM_PROMPT_N=na;; esac
  case "$ARM_RUNS" in ''|*[!0-9]*) ARM_RUNS=na;; esac
  case "$ARM_INLOAD_MS" in ''|*[!0-9.]*|.) ARM_INLOAD_MS=na;; esac
  # Both perf numbers ARE the turn: a log without them is truncated or
  # perf-less — run_fail, same as a nonzero exit.
  case "$ARM_PREFILL_MS" in ''|*[!0-9.]*|.) ARM_VOID=run_fail; return 0;; esac
  [ "$ARM_PROMPT_N" != na ] || { ARM_VOID=run_fail; return 0; }
  [ "$ARM_RUNS" != na ] || { ARM_VOID=run_fail; return 0; }
  if [ "$ARM_RUNS" != na ]; then
    ARM_DECODE_TPS=$(awk -v r="$ARM_RUNS" -v m="$eval_ms" 'BEGIN{if (m+0>0) printf "%.2f", 1000*r/m; else print "na"}')
  fi
  # Fingerprint equality with the proof run (fail closed on both sides).
  fp=$(arm_fingerprint "$logf")
  ARM_TURN_FP="$fp"
  case "$fp" in
    *"=?"*) ARM_VOID=no_fingerprint; ARM_PROOF="fp_turn=$fp fp_proof=$ARM_PROOF_FP"; return 0 ;;
  esac
  if [ "$fp" != "$ARM_PROOF_FP" ]; then
    ARM_VOID=backend_mismatch
    ARM_PROOF="fp_turn=$fp fp_proof=$ARM_PROOF_FP"
    return 0
  fi
  ARM_PROOF="$ARM_PROOF fp=$fp"
  ARM_STATUS=OK; ARM_VOID=na
  return 0
}
