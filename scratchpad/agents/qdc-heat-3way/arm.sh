# arm.sh — one measured arm (its proof run, its turn, its parses). One
# responsibility: build the llama-completion commands, run them, pull the
# logs, and parse proof + timings. Gates, cooldown and rows live in d_run.sh;
# stop logic in stop_lib.sh; sampler lifecycle in sampler.sh; the calibration
# loop in calibrate.sh.
#
# Two-phase design (owner decision on audit dd6bdb56 A-1/A-2, amended by
# audit2 NEW-1..NEW-3):
#   PROOF RUN = the load phase: same model/backend flags, a few tokens
#   (`-p " " -n 4 --ignore-eos`), at `-lv 5` with GGML_HEXAGON_VERBOSE=1 and
#   GGML_OPENCL_LOG_KERNELS=1 — the only place verbose/per-op output is
#   allowed — and `--perf` so its exact token count is readable (NEW-1: the
#   execute-op threshold scales with that count).
#   MEASURED TURN = `-lv 4`, only LD/ADSP/GGML_HEXAGON_NDEV env (no per-op
#   output: execute-op needs the GGML_HEXAGON_VERBOSE env, kernel dispatch the
#   GGML_OPENCL_LOG_KERNELS env — neither is set here). `-lv 4` is NOT the
#   default: audit2 NEW-2/NEW-3 require PLACEMENT lines, and the source check
#   says every one of them is LLAMA_LOG_INFO — see arm_fingerprint below.
#
# Source quotes (f25f0c1c5), for why placement needs `-lv 4`:
#   src/llama-model.cpp:1852  LLAMA_LOG_INFO("%s: %12s model buffer size = %8.2f MiB\n", …)
#     → `load_tensors:          CPU model buffer size = …` / `GPUOpenCL …` / `HTP0 …`
#   src/llama-model.cpp:1846  LLAMA_LOG_INFO("%s: offloaded %d/%d layers to GPU\n", …)
#   src/llama-model.cpp:1526  LLAMA_LOG_DEBUG("load_tensors: layer %3d assigned to device …")
#   common/common.cpp:396     llama_log_set(common_log_default_callback, NULL);
#   common/log.cpp            get_verbosity(INFO) = LOG_LEVEL_TRACE = 4; default thold = 3
#   ⇒ at true default (-lv 3) NONE of the placement lines exist — run-1's
#   committed log proves it (`grep -c "buffer size\|load_tensors\|offload" =
#   0` on raw/s23-cli-heat-20260926/*.log) — while -lv 4 admits INFO and still
#   hides DEBUG (assigned-to-device) and per-op output.
#
# Flag provenance: kit help (npu-spec-verify/raw/s23-prep/completion_help.log)
# — `-f/--file` :48, `--ignore-eos` :257, `--perf` default false :45,
# `--no-warmup` :340, `-dev/--device` :121, `-lv 5` (STEP0's diagnostic).
# `-n %d` is fed by DECODE_N (N-1 eval runs, device-evidenced: -n 127 → 126,
# -n 64 → 63, s23-cli-heat/s23-cli-diag raw logs).
#
# Prompt identity (A15b): the turn reads THE verified file `-f $D/prompt.txt`,
# whose sha256 kit.sh checks against PROMPT.meta — verified copy = used copy.

# NEW-1: execute-op floor per proof token, derived from the repo's own priors
# (q57 pp512×2 = 1764 ops / 1024 tok = 1.72 ops/tok — the LOWEST observed;
# q58 n=1024 = 3430/1024 = 3.35; q51 pp16+tg8 = 484/24 = 20.2). Collapse
# means "dispatch stopped", so the gate sits at HALF the slowest observed
# rate: 1.72 / 2 = 0.86 ops/token. Threshold = ceil(floor × proof tokens);
# a 4-token proof ⇒ ceil(3.44) = 4 lines (the old flat 1000 was sized for a
# 1018+126-token turn — audit2 NEW-1). After CALIBRATE=1 the driver replaces
# this prior with the measured value (raw/calib floor, see d_run.sh).
HTP_FLOOR_PRIOR=0.86
# G proof thresholds, stated: 33-layer graph, token-independent (audited):
#   G: >= 30 `assigned to device GPUOpenCL` lines AND >= 8 distinct
#      `GGML_OPENCL_LOG_KERNELS:` dispatch lines, zero disabled lines.
#   C: >= 1 `assigned to device CPU` and zero offload assignment/execute —
#      on the -lv 5 log where those lines exist (audit A-15).
MIN_GPU_ASSIGN=30
MIN_GPU_KERNELS=8
# The -n of the measured turn; one definition feeds the -n flag AND d_run's
# equal-decode gate (N-1 eval runs), so they cannot drift apart.
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
# INVARIANT: this ends in `&& ` — every consumer appends its own
# `export … && `/command directly; prepending another separator produces
# `&& &&` (S23 run 2 died on exactly that, 9c5474d6).
arm_env() {
  printf 'cd %s && export LD_LIBRARY_PATH=%s/lib && export ADSP_LIBRARY_PATH=%s/lib && export GGML_HEXAGON_NDEV=1 && ' \
    "$D" "$D" "$D"
}
# Proof-only env (A-2: verbose output lives exclusively in the load phase).
# Composed as arm_env + extras: no separator of its own (arm_env already
# ended with one) — that double `&&` was run-2's syntax error.
arm_proof_env() {
  printf '%sexport GGML_HEXAGON_VERBOSE=1 && export GGML_OPENCL_LOG_KERNELS=1 && ' "$(arm_env)"
}

# The measured turn (and the calibration short run — same flags, its own n):
# 1018-token prefill from the verified file + $n decode tokens, greedy,
# `-lv 4` for the INFO-level placement lines quoted in the header.
arm_remote_cmd() {
  local backend="$1" tag="$2" n="${3:-$DECODE_N}" flags
  # Never feed a non-numeric n to %d (audit3 dead-code note).
  case "$n" in ''|*[!0-9]*) n="$DECODE_N" ;; esac
  flags=$(arm_backend_flags "$backend") || return 1
  printf '%s./bin/llama-completion -m %s/ship.gguf -lm none -f %s/prompt.txt -n %d --ignore-eos --seed 1 --temp 0 -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -lv 4 %s > %s/%s.log 2>&1; rc=$?; echo EXIT=$rc >> %s/%s.log; exit $rc' \
    "$(arm_env)" "$D" "$D" "$n" "$flags" "$D" "$tag" "$D" "$tag"
}

# The proof run doubles as the load phase: page-in, weight upload and the
# OpenCL kernel compile happen here (outside the measured window). `--perf`
# is on so NEW-1 can scale the execute-op threshold by the proof's OWN token
# count read from this log.
arm_load_cmd() {
  local backend="$1" tag="$2" flags
  flags=$(arm_backend_flags "$backend") || return 1
  printf '%s./bin/llama-completion -m %s/ship.gguf -lm none -p " " -n 4 --ignore-eos --seed 1 --temp 0 -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt -lv 5 %s > %s/%s.load.log 2>&1; rc=$?; echo EXIT=$rc >> %s/%s.load.log; exit $rc' \
    "$(arm_proof_env)" "$D" "$flags" "$D" "$tag" "$D" "$tag"
}

# A timeout here (perl alarm killed adb: rc 124, or 142 = SIGALRM) leaves the
# remote llama-completion running — kill and VERIFY it (A-4: stop_lib's
# kill_remote_llama probes with pgrep; the pgrep tool itself was self-tested
# at setup, audit2 NEW-4).
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

# arm_run <backend> <tag> [n]: a measured run (turn, or the calibration short
# run with n=16). Sets ARM_WALL_S, ARM_RC.
arm_run() {
  local backend="$1" tag="$2" t0 t1 rc
  t0=$(date +%s)
  set +e
  adbT "$ARM_TIMEOUT_S" -s "$SER" shell "$(arm_remote_cmd "$backend" "$tag" "${3:-}")" > "$RAW/${tag}_shell.txt" 2>&1
  rc=$?
  set -e
  t1=$(date +%s)
  ARM_WALL_S=$((t1 - t0)); ARM_RC=$rc
  if [ "$rc" -ge 124 ]; then arm_kill_orphan "$backend" "$rc"; fi
  printf 'EXIT=%s wall_s=%s\n' "$rc" "$ARM_WALL_S" >> "$RAW/${tag}_shell.txt"
  adbT 60 -s "$SER" pull "$D/$tag.log" "$RAW/$tag.log" >> "$RAW/${tag}_pull.txt" 2>&1 || true
}

# arm_perf_parse <logfile>: label-relative perf extraction (the kit prints
# `<ts> <level> ` before the label — raw/s23-cli-heat-20260926 t1cpu.log:48 —
# bare lines still parse; label+1 = prompt|eval|load; value at +5/+4; counts
# at +8/+7). Sets ARM_PREFILL_MS, ARM_PROMPT_N, ARM_RUNS, ARM_DECODE_TPS,
# ARM_INLOAD_MS; na when absent.
arm_perf_parse() {
  local logf="$1" eval_ms=""
  ARM_PREFILL_MS=na; ARM_PROMPT_N=na; ARM_RUNS=na; ARM_DECODE_TPS=na; ARM_INLOAD_MS=na
  [ -f "$logf" ] || return 0
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
  case "$ARM_PREFILL_MS" in ''|*[!0-9.]*|.) ARM_PREFILL_MS=na;; esac
  case "$ARM_INLOAD_MS" in ''|*[!0-9.]*|.) ARM_INLOAD_MS=na;; esac
  if [ "$ARM_RUNS" != na ]; then
    ARM_DECODE_TPS=$(awk -v r="$ARM_RUNS" -v m="$eval_ms" 'BEGIN{if (m+0>0) printf "%.2f", 1000*r/m; else print "na"}')
  fi
  return 0
}

# Fingerprint at the turn's -lv 4 (audit2 NEW-2/NEW-3): proof↔turn
# CONSISTENCY of placement evidence, not a backend name tag —
#   buf = backend names from `… <NAME> model buffer size = … MiB`
#         (llama-model.cpp:1852, LLAMA_LOG_INFO ⇒ visible at -lv >= 4); this
#         is the only component that separates G from N,
#   off = `offloaded <n>/<m> layers to GPU` (llama-model.cpp:1846, INFO) — a
#         LAYER COUNT: the literal says "GPU" even for -dev HTP0 and gives the
#         same value for G and N (audit3 A-N8), so it can only confirm that
#         turn placement equals proof placement,
#   thr = system_info n_threads (flag check, tool INFO).
# Backend IDENTITY comes from the thresholds on the -lv 5 proof log
# (arm_parse_proof), never from these. The requested `-ngl` fit line is
# deliberately NOT a component (intent, not placement — NEW-3); calibrate
# prints it as an informational candidate. Missing pieces print `?` and fail
# closed on both sides.
arm_fingerprint() {
  local logf="$1" buf="" off="" thr=""
  if [ -f "$logf" ]; then
    # Space-anchored (run-3 class bug): the old [^A-Za-z0-9:] split CPU_REPACK
    # into REPACK on the real log — verified against raw/s23-calib-3.
    buf=$(sed -n 's/.* \([A-Za-z0-9:_]*\) model buffer size.*/\1/p' "$logf" | sort -u | paste -sd, -)
    off=$(sed -n 's/.*offloaded \([0-9][0-9]*\/[0-9][0-9]*\) layers to GPU.*/\1/p' "$logf" | head -1)
    thr=$(sed -n 's/.*system_info: n_threads = \([0-9][0-9]*\).*/\1/p' "$logf" | head -1)
  fi
  printf 'buf=%s off=%s thr=%s' "${buf:-?}" "${off:-?}" "${thr:-?}"
}

# arm_parse_proof <tag> <backend>: gates the -lv 5 proof log — exit, perf
# tokens (NEW-1 basis), fingerprint pieces, then the audited thresholds with
# the SCALED execute-op floor. Sets ARM_STATUS, ARM_VOID, ARM_PROOF,
# ARM_PROOF_FP, PROOF_TOKENS.
arm_parse_proof() {
  local tag="$1"
  local backend="$2"
  local logf="$RAW/$tag.load.log"
  local exit_line="" gpu_assign=0 gpu_kernels=0 htp_ops=0 floor min_ops tokens arch=""
  ARM_STATUS=VOID; ARM_VOID=proof_run_fail; ARM_PROOF=na; ARM_PROOF_FP="?"; PROOF_TOKENS=na
  [ -f "$logf" ] || return 0
  exit_line=$(sed -n 's/^EXIT=//p' "$logf" | tail -1)
  [ "$exit_line" = "0" ] || return 0
  arm_perf_parse "$logf"
  if [ "$ARM_PROMPT_N" = na ] || [ "$ARM_RUNS" = na ]; then
    ARM_VOID=proof_run_fail; return 0     # NEW-1 needs an exact token count
  fi
  PROOF_TOKENS=$((ARM_PROMPT_N + ARM_RUNS))
  ARM_PROOF_FP=$(arm_fingerprint "$logf")
  case "$ARM_PROOF_FP" in *"=?"*) ARM_VOID=no_fingerprint; return 0 ;; esac
  case "$backend" in
    cpu)
      if ! awk '/assigned to device CPU/{n++} END{exit !(n>0)}' "$logf"; then
        ARM_VOID=no_cpu_proof; return 0
      fi
      # Leak check (A-15): meaningful on this log — device lines exist here.
      if awk '/assigned to device (GPUOpenCL|HTP0)/ || /HTP0 execute-op/{n++} END{exit !(n>0)}' "$logf"; then
        ARM_VOID=cpu_backend_leak; ARM_PROOF=cpu_offload_lines_gt0; return 0
      fi
      ARM_PROOF="cpu_no_offload tokens=$PROOF_TOKENS" ;;
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
      ARM_PROOF="gpu_assigned_lines=$gpu_assign kernels=$gpu_kernels tokens=$PROOF_TOKENS" ;;
    npu)
      htp_ops=$(awk '/HTP0 execute-op/{n++} END{print n+0}' "$logf")
      # NEW-1: floor scales with THIS proof run's token count.
      floor="${HTP_FLOOR_PER_TOKEN:-$HTP_FLOOR_PRIOR}"
      tokens="$PROOF_TOKENS"
      min_ops=$(awk -v f="$floor" -v t="$tokens" 'BEGIN{x = f * t; print (x == int(x)) ? int(x) : int(x) + 1}')
      if [ "$htp_ops" -eq 0 ]; then
        ARM_VOID=no_htp_proof; ARM_PROOF="htp_ops=0 min=$min_ops tokens=$tokens"; return 0
      fi
      if [ "$htp_ops" -lt "$min_ops" ]; then
        ARM_VOID=htp_ops_low; ARM_PROOF="htp_ops=$htp_ops min=$min_ops tokens=$tokens"; return 0
      fi
      # HTP0 PLACEMENT (run-3 evidence: `HTP0 model buffer size = 1525.87 MiB`):
      # dispatching ops is not enough — the proof's fingerprint must place the
      # model on HTP0 too.
      case "$ARM_PROOF_FP" in
        *HTP0*) ;;
        *) ARM_VOID=no_htp_placement; ARM_PROOF="htp_ops=$htp_ops min=$min_ops fp=$ARM_PROOF_FP"; return 0 ;;
      esac
      # Arch identity, dual form: f25f0c1c5 prints NO `Hexagon Arch version`
      # line (run 3 was voided requiring it) — the skel version lives in the
      # session URI; older kits print the explicit line. Real shapes:
      # raw/s23-calib-3/s23-calib-3-calnpu.load.log:274-275.
      arch=$(sed -n 's/.*Hexagon Arch version \([^ ,]*\).*/\1/p' "$logf" | head -1)
      if [ -z "$arch" ]; then
        arch=$(sed -n 's/.*libggml-htp-\(v[0-9][0-9]*\)\.so.*/\1/p' "$logf" | head -1)
      fi
      if [ -z "$arch" ]; then
        ARM_VOID=no_htp_arch; ARM_PROOF="htp_ops=$htp_ops min=$min_ops"; return 0
      fi
      ARM_PROOF="htp_ops=$htp_ops min=$min_ops arch=$arch" ;;
  esac
  ARM_STATUS=OK; ARM_VOID=na
  return 0
}

# arm_parse_turn <tag>: gates the measured turn's log — exit, perf values,
# the turn-side negative (NEW-3: a backend disabled DURING the turn voids
# even though the proof passed — those lines are WARN/ERROR, present at any
# verbosity), then placement-fingerprint equality against the proof run.
# Sets ARM_TURN_FP for the log line.
arm_parse_turn() {
  local tag="$1"
  local logf="$RAW/$tag.log"
  local exit_line="" fp=""
  ARM_STATUS=VOID; ARM_VOID=run_fail; ARM_TURN_FP=na
  [ -f "$logf" ] || return 0
  exit_line=$(sed -n 's/^EXIT=//p' "$logf" | tail -1)
  [ "$exit_line" = "0" ] || return 0
  arm_perf_parse "$logf"
  # Both perf numbers ARE the turn: missing = truncated/perf-less = run_fail.
  [ "$ARM_PREFILL_MS" != na ] || return 0
  [ "$ARM_PROMPT_N" != na ] || return 0
  [ "$ARM_RUNS" != na ] || return 0
  # NEW-3 (turn side): kernel-build failure / device disabled is WARN/ERROR —
  # visible at default and at -lv 4 — so the measured log must be clean too.
  if awk '/kernel set failed to build|device disabled/{n++} END{exit !(n>0)}' "$logf"; then
    ARM_VOID=turn_backend_disabled
    return 0
  fi
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
