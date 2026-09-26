# arm.sh — one measured arm (plus its load phase). One responsibility:
# build the llama-completion commands for a backend, run them on the device,
# pull the logs, and parse timings + backend proof. Gates, cooldown and row
# bookkeeping live in d_run.sh; stop logic in stop_lib.sh.
#
# Flag provenance: the kit's own help (npu-spec-verify/raw/s23-prep/
# completion_help.log) — `-f/--file` (:48), `-n`, `--ignore-eos` (:257),
# `--seed`, `--temp`, `--perf` default false (:45), `--no-warmup` (:340),
# `-dev/--device` (:121), `-lm` (every npu-spec-verify call). Backend flags
# are npu-spec-verify/d_run.sh's arm B/C selection plus `GPUOpenCL` from
# `--list-devices`.
#
# Perf-line provenance (audit f2ee97f4 A1, corrected after run 1): the
# binary prints `common_perf_print:` — format string at f25f0c1c5
# common/sampling.cpp:573-576; ON DEVICE every line carries a
# `<seconds.millis> <level> ` prefix before it (run-1 evidence:
# raw/s23-cli-heat-20260926/s23-cli-heat-20260926-t1cpu.log:48), so the
# parser locates the label token instead of anchoring fields. The earlier
# claim "log prefix off (common/log.cpp:174)" was refuted by that log.
# `llama_perf_context_print` does not exist in this kit.
#
# Prompt identity (A15b): the arm reads THE verified file — `-f $D/prompt.txt`,
# whose sha256 kit.sh checks against PROMPT.meta. No prompt text is inlined
# into the shell command anymore, so the verified copy and the used copy are
# the same bytes.

# A6 proof thresholds, stated: 33-layer graph.
#   N: >= 1000 `HTP0 execute-op` lines (≈30 per layer; priors: q58 n=1024 ran
#      3430, q57 pp512×2rep 1764 — a count in the low hundreds means dispatch
#      collapsed to init/warmup, not the turn).
#   G: >= 30 `assigned to device GPUOpenCL` lines (placement of the 33-layer
#      graph) AND >= 8 distinct `GGML_OPENCL_LOG_KERNELS:` lines — execution
#      evidence, emitted from inside enqueue_ndrange_kernel
#      (ggml-opencl-kalsa-diag.cpp:36-44, one line per unique dispatched
#      kernel) with GGML_OPENCL_LOG_KERNELS=1 in the arm env; a full
#      prefill+decode touches matmul, gemv, convert, norm, rope, softmax,
#      elementwise and the hybrid conv/ssm kernels (>= 8 classes).
MIN_HTP_OPS=1000
MIN_GPU_ASSIGN=30
MIN_GPU_KERNELS=8
# The -n of the measured turn. One definition feeds BOTH the -n flag below and
# d_run's equal-decode gate (N-1 eval runs — device-confirmed structure: the
# first token comes from the prompt eval, so -n 127 yields 126 runs and -n 64
# yields 63, s23-cli-heat-20260926 / s23-cli-diag-20260926 raw logs), so the
# flag and the gate cannot drift apart.
DECODE_N="${DECODE_N:-127}"

arm_backend_flags() {
  case "$1" in
    cpu) printf '%s' "-ngl 0" ;;
    gpu) printf '%s' "-dev GPUOpenCL -ngl 99" ;;
    npu) printf '%s' "-dev HTP0 -ngl 99 -nkvo" ;;
    *) return 1 ;;
  esac
}

arm_env() {
  printf 'cd %s && export LD_LIBRARY_PATH=%s/lib && export ADSP_LIBRARY_PATH=%s/lib && export GGML_HEXAGON_NDEV=1 && export GGML_HEXAGON_VERBOSE=1 && export GGML_OPENCL_LOG_KERNELS=1 && ' \
    "$D" "$D" "$D"
}

# The measured turn: 1018-token prefill (from the verified file) + exactly
# $DECODE_N decode tokens, EOS ignored, greedy (gate expectation: DECODE_N-1
# eval runs).
arm_remote_cmd() {
  local backend="$1" tag="$2" flags
  flags=$(arm_backend_flags "$backend") || return 1
  printf '%s./bin/llama-completion -m %s/ship.gguf -lm none -f %s/prompt.txt -n %d --ignore-eos --seed 1 --temp 0 -c 2048 -b 2048 -ub 1024 -t 8 -fa 1 --no-warmup --perf --simple-io --no-display-prompt %s > %s/%s.log 2>&1; rc=$?; echo EXIT=$rc >> %s/%s.log; exit $rc' \
    "$(arm_env)" "$D" "$D" "$DECODE_N" "$flags" "$D" "$tag" "$D" "$tag"
}

# A8 load phase: same backend flags, 1-token prompt, no perf, no generation —
# this is where page-in, weight upload and the OpenCL kernel compile happen,
# OUTSIDE the measured turn, with their own before/after skin readings taken
# by the driver around this call.
arm_load_cmd() {
  local backend="$1" tag="$2" flags
  flags=$(arm_backend_flags "$backend") || return 1
  # `-p " "`: a single-space prompt evaluates at most one token and exits at
  # -n 0 — load/page-in/upload/compile only, no turn work.
  printf '%s./bin/llama-completion -m %s/ship.gguf -lm none -p " " -n 0 --no-perf --no-warmup --simple-io --no-display-prompt %s > %s/%s.load.log 2>&1; rc=$?; echo EXIT=$rc >> %s/%s.load.log; exit $rc' \
    "$(arm_env)" "$D" "$flags" "$D" "$tag" "$D" "$tag"
}

# A timeout here (perl alarm killed adb: rc 124, or 142 = SIGALRM, see
# d_run.sh adbT) leaves the remote llama-completion running as an orphan —
# kill it explicitly before anything else looks at the device.
arm_kill_orphan() {
  local backend="$1" rc="$2"
  log "ARM_TIMEOUT backend=$backend rc=$rc -> killing remote llama-completion"
  adbT 15 -s "$SER" shell "pkill -f 'llama-completio[n]'" >> "$RAW/kill.log" 2>&1 || true
}

# arm_load <backend> <tag>: sets ARM_LOAD_WALL_S, ARM_LOAD_RC; pulls
# $D/<tag>.load.log for the record (pull failure is not fatal).
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

# arm_parse <tag> <backend>: sets ARM_STATUS (OK|VOID), ARM_VOID (reason),
# ARM_PROOF, ARM_PROMPT_N, ARM_PREFILL_MS, ARM_RUNS, ARM_DECODE_TPS,
# ARM_INLOAD_MS (the turn process's own model-load time, A8, logged not
# gated). Proof rule (npu-spec-verify REPORT + audit A6): HTP means real
# dispatch — identical tokens alone would allow silent CPU fallback.
arm_parse() {
  # Separate `local`s: in `local a="$1" logf="$RAW/$a.log"` the second
  # expansion would see the OUTER (unset) a — unbound under set -u.
  local tag="$1"
  local backend="$2"
  local logf="$RAW/$tag.log"
  local exit_line="" eval_ms="" gpu_assign=0 gpu_kernels=0 htp_ops=0
  ARM_STATUS=VOID; ARM_VOID=run_fail; ARM_PROOF=na
  ARM_PROMPT_N=na; ARM_PREFILL_MS=na; ARM_RUNS=na; ARM_DECODE_TPS=na; ARM_INLOAD_MS=na
  [ -f "$logf" ] || return 0
  exit_line=$(sed -n 's/^EXIT=//p' "$logf" | tail -1)
  [ "$exit_line" = "0" ] || return 0
  # Field layout: the real kit prefixes every line with `<ts> <level> ` —
  # raw/s23-cli-heat-20260926/s23-cli-heat-20260926-t1cpu.log:48 reads
  #   `1.17.377.184 I common_perf_print: prompt eval time = 10947.50 ms / 1018 tokens`
  # while older captures are bare, so locate the `common_perf_print:` TOKEN
  # anywhere in the line and index fields RELATIVE to it (run-1 defect: the
  # old $1/$6 anchors assumed the bare layout and voided every row):
  #   label+1 = prompt|eval|load; value at +5 (prompt) / +4 (eval, load);
  #   counts at +8 (tokens) / +7 (runs).
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
  case "$backend" in
    cpu)
      # Probe lesson from npu-spec-verify/raw/s23/A.log: even -ngl 0 the log
      # prints `using device GPUOpenCL` (bare discovery), so only load-tensor
      # ASSIGNMENTS discriminate the backend that actually ran.
      if ! awk '/assigned to device CPU/{n++} END{exit !(n>0)}' "$logf"; then
        ARM_VOID=no_cpu_proof; return 0
      fi
      if awk '/assigned to device (GPUOpenCL|HTP0)/ || /HTP0 execute-op/{n++} END{exit !(n>0)}' "$logf"; then
        ARM_VOID=cpu_backend_leak; ARM_PROOF=cpu_offload_lines_gt0; return 0
      fi
      ARM_PROOF=cpu_no_offload ;;
    gpu)
      # A6: placement threshold AND execution threshold, not one load line.
      if ! awk '/assigned to device GPUOpenCL/{n++} END{exit !(n>0)}' "$logf"; then
        ARM_VOID=no_gpu_proof; return 0
      fi
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
