#!/usr/bin/env bash
# arm.sh — one DSpark arm: its proof run, its measured runs, and the two
# parses. Sourced by d_run.sh (gates, cooldown, poll, kill, restore live there).
#
# Three-way decision after audits dd6bdb56 (A-1/A-2, B-5): backend proofs come
# from a SHORT `-lv 5` proof run (load-time placement is LLAMA_LOG_DEBUG and is
# ABSENT at the default verbosity on the real device — qdc-heat-3way
# raw/s23-cli-heat-20260926/...t1cpu.log has 0 `assigned to device` lines);
# the measured turns run at DEFAULT verbosity so no debug volume lands inside
# the timed window (C arms would log more than A/B and bias B-vs-C).
# GGML_OPENCL_LOG_KERNELS=1 is set ONLY for the proof run for the same reason.
#
# Flag provenance (kalsallama f25f0c1c5 common/arg.cpp): -f (:1798),
# --spec-type (:4244), --spec-draft-n-max (:4135), -devd (:4208), -ngld
# (:4217), -lv (:3934, 5 = debug). Placement lines: src/llama-model.cpp:1526
# (CPU) / :1531 (GPU), format `<h>.<m>.<s>.<ms> D load_tensors: layer N
# assigned to device X` (byte shape from raw/calib_* and the committed S23 log).
# Kernel lines are fprintf (unprefixed): ggml-opencl-kalsa-diag.cpp:36-44.
#
# Thresholds, stated: the drafter is 5-layer dflash (GGUF block_count), so
# every drafter layer must be placed on GPUOpenCL and >= 4 distinct kernels
# must dispatch in the proof run (matmul/gemv + convert + norm + elementwise
# are in any drafter step); the 30/8 floors of qdc-heat-3way target the
# 33-layer model. dspark prints no `devices=[...]` SPC line (only
# draft-simple/draft-mtp do: common/speculative.cpp:199/1381).
# Threads: `-t 5` everywhere on device — owner decision, S23 app preset
# `sd-8-gen2` decode5/prefill5 (kalsa/src/engine/deviceTuning.ts:217-219),
# same as the sister cell's device arms since 5ba47a93 and as our host scripts.
MIN_DRAFT_GPU_ASSIGN=5
MIN_DRAFT_GPU_KERNELS=4
PROOF_N=8   # short proof run: load + a few drafter steps (audit2 NEW-7: the
            # >=4-kernel floor is judged on a multi-step proof, not on 4 tokens)

arm_is_gpu() { case "$1" in C*) return 0 ;; *) return 1 ;; esac; }

# arm_flags <arm>: drafter device/depth. A and B pin the drafter to CPU
# (-ngld 0: the -1 default would auto-offload on a kit WITH OpenCL).
arm_flags() {
  # audit8: the CPU-draft arms pin the drafter with `-devd none` (arg.cpp:4208
  # 'none = don't offload') — with the kit registering Hexagon, an unpinned
  # model is picked up by HTP0 and the missing ADSP session crashes the run.
  case "$1" in
    A)  printf '%s' "--spec-draft-n-max 0 -devd none -ngld 0" ;;
    B4) printf '%s' "--spec-draft-n-max 4 -devd none -ngld 0" ;;
    B8) printf '%s' "--spec-draft-n-max 8 -devd none -ngld 0" ;;
    C4) printf '%s' "--spec-draft-n-max 4 -devd GPUOpenCL -ngld 99" ;;
    C8) printf '%s' "--spec-draft-n-max 8 -devd GPUOpenCL -ngld 99" ;;
    *) return 1 ;;
  esac
}

# arm_cmd <tag> <arm> <limit> <mode>: full remote shell command.
#   mode=proof   -> `-lv 5` + GGML_OPENCL_LOG_KERNELS=1 (placement + dispatch)
#   mode=measure -> `-lv 4`, no kernel env: admits the LLAMA_LOG_INFO
#                    placement lines the turn must prove itself with (audit4
#                    N-B2, same level as cell A's turn) while still hiding
#                    DEBUG/per-op output — the timed window stays clean
#                    (audit B-5 upheld; host matrix: default == -lv 3 admits
#                    none of them, -lv 4 admits INFO, DEBUG needs -lv 5)
arm_cmd() {
  local tag=$1 arm=$2 limit=$3 mode=$4 flags lv envk
  flags=$(arm_flags "$arm") || return 1
  lv=""; envk=""
  case "$mode" in
    proof)   lv=" -lv 5"; envk="export GGML_OPENCL_LOG_KERNELS=1 && " ;;
    measure) lv=" -lv 4" ;;
    *) return 1 ;;
  esac
  printf 'cd %s && export LD_LIBRARY_PATH=%s/lib && %s./bin/llama-speculative-simple -m %s/ship.gguf -dev none -md %s/draft.gguf --spec-type draft-dspark %s -f %s/prompt.txt -n %s --temp 0 --top-k 1 -t 5 -ngl 0%s > %s/%s.log 2>&1 < /dev/null; rc=$?; echo EXIT=$rc >> %s/%s.log; exit $rc' \
    "$D" "$D" "$envk" "$D" "$D" "$flags" "$D" "$limit" "$lv" "$D" "$tag" "$D" "$tag"
}

# arm_run <tag> <arm> <limit> <mode>: runs with the session timeout. Sets
# ARM_WALL_S, ARM_RC. Pulling the log is best-effort. The orphan kill on
# rc >= 124 is done by d_run.sh (kill_spec_verified) so every kill is verified.
arm_run() {
  local tag=$1 arm=$2 limit=$3 mode=$4 t0 t1 rc
  t0=$(date +%s)
  set +e
  adbT "$ARM_TIMEOUT_S" -s "$SER" shell "$(arm_cmd "$tag" "$arm" "$limit" "$mode")" > "$RAW/${tag}_shell.txt" 2>&1
  rc=$?
  set -e
  t1=$(date +%s)
  ARM_WALL_S=$((t1 - t0)); ARM_RC=$rc
  adbT 60 -s "$SER" pull "$D/$tag.log" "$RAW/$tag.log" >> "$RAW/${tag}_pull.txt" 2>&1 || true
}

# draft_marker_line <log>: the unique line separating the target's load from
# the drafter's — everything after it belongs to the second model (order is
# asserted by arm_parse_proof before anything is counted).
draft_marker_line() {
  awk '/common_speculative_init_result: loading draft model/{print NR; exit}' "$1"
}

# arm_htp_leak <log>: this cell must NEVER touch the NPU (no
# ADSP_LIBRARY_PATH by design): HTP0 in a `using device` line or a failed
# hexagon session is a leak, whatever the exit code says (audit8; real
# evidence raw/s23-dspark-2/A-p.log:52,856,858 — the unpinned target landed
# on HTP0 and the run died with SIGSEGV).
arm_htp_leak() {
  [ -f "$1" ] || return 1
  awk '/using device HTP0/ || /ggml-hex:.*failed to open session/{n++} END{exit !(n>0)}' "$1"
}

# arm_rc_reason <rc> <log>: classify an abnormal arm exit — content beats the
# code: an HTP leak is the root cause even when it crashes (rc 139); signal
# exits (>=128, incl. 139) are crash_sig<N>; the alarm paths 124/142 stay
# `timeout` (142 = our own SIGALRM on the adb client, not a device signal).
arm_rc_reason() {
  if arm_htp_leak "$2"; then echo htp_leak; return 0; fi
  if [ "$1" = "124" ] || [ "$1" = "142" ]; then echo timeout; return 0; fi
  if [ "$1" -ge 128 ]; then echo "crash_sig$(( $1 - 128 ))"; return 0; fi
  echo "adb_fail_$1"
}

# arm_parse_proof <tag> <arm>: the -lv 5 run. Sets ARM_STATUS/ARM_VOID/ARM_PROOF.
# Order assert (audit B-12): the target must have placement lines BEFORE the
# draft-load marker, otherwise the post-marker split measures the wrong model.
arm_parse_proof() {
  local tag=$1 arm=$2
  local logf="$RAW/$tag.log" exit_line="" pre="" post=""
  local pre_place=0 gpu_assign=0 cpu_assign=0 kernels=0
  ARM_STATUS=VOID; ARM_VOID=run_fail; ARM_PROOF=na
  [ -f "$logf" ] || return 0
  # audit8: HTP0/session-failure content first — it is the root cause even in
  # a log whose shell recorded a crash exit.
  if arm_htp_leak "$logf"; then
    ARM_VOID=htp_leak
    ARM_PROOF="htp_line=1"
    return 0
  fi
  exit_line=$(sed -n 's/^EXIT=//p' "$logf" | tail -1)
  [ "$exit_line" = "0" ] || return 0
  # audit6: a conversation/interactive run is not data — completion prints this
  # banner (tools/completion/completion.cpp:484) and then waits on stdin; even
  # a short one that exits 0 must not become a proof/turn row.
  if awk '/Running in interactive mode/{n++} END{exit !(n>0)}' "$logf"; then
    ARM_VOID=interactive_mode
    ARM_PROOF="interactive_line=1"
    return 0
  fi
  local marker
  marker=$(draft_marker_line "$logf")
  [ -n "$marker" ] || { ARM_VOID=no_draft_marker; return 0; }
  [ "$marker" -gt 1 ] || { ARM_VOID=model_order_unknown; return 0; }
  pre=$(head -n "$((marker - 1))" "$logf")
  post=$(tail -n +"$((marker + 1))" "$logf")
  pre_place=$(printf '%s\n' "$pre" | awk '/load_tensors: layer .* assigned to device/{n++} END{print n+0}')
  [ "$pre_place" -ge 1 ] || { ARM_VOID=model_order_unknown; ARM_PROOF="pre_marker_place=$pre_place"; return 0; }
  gpu_assign=$(printf '%s\n' "$post" | awk '/load_tensors: layer .* assigned to device GPUOpenCL/{n++} END{print n+0}')
  cpu_assign=$(printf '%s\n' "$post" | awk '/load_tensors: layer .* assigned to device CPU/{n++} END{print n+0}')
  kernels=$(printf '%s\n' "$post" | sed -n 's/^GGML_OPENCL_LOG_KERNELS: *//p' | LC_ALL=C sort -u | wc -l | tr -d '[:space:]')
  if arm_is_gpu "$arm"; then
    if [ "$gpu_assign" -lt "$MIN_DRAFT_GPU_ASSIGN" ] || [ "$kernels" -lt "$MIN_DRAFT_GPU_KERNELS" ]; then
      ARM_VOID=no_gpu_proof
      ARM_PROOF="proof: draft_gpu_assign=$gpu_assign/$MIN_DRAFT_GPU_ASSIGN kernels=$kernels/$MIN_DRAFT_GPU_KERNELS pre_place=$pre_place"
      return 0
    fi
    if printf '%s\n' "$post" | awk '/kernel set failed to build|device disabled/{n++} END{exit !(n>0)}'; then
      ARM_VOID=gpu_disabled
      ARM_PROOF="proof: draft_gpu_assign=$gpu_assign kernels=$kernels"
      return 0
    fi
    ARM_PROOF="proof: draft_gpu_assign=$gpu_assign kernels=$kernels pre_place=$pre_place"
  else
    if [ "$cpu_assign" -lt 1 ] || [ "$gpu_assign" -gt 0 ] || [ "$kernels" -gt 0 ]; then
      ARM_VOID=draft_not_on_cpu
      ARM_PROOF="proof: draft_cpu_assign=$cpu_assign draft_gpu_assign=$gpu_assign kernels=$kernels"
      return 0
    fi
    ARM_PROOF="proof: draft_cpu_assign=$cpu_assign gpu_evidence=0 pre_place=$pre_place"
  fi
  ARM_STATUS=OK; ARM_VOID=na
  return 0
}

# arm_parse_measure <tag> <arm> <limit>: the default-verbosity turn. Metric =
# the SAME `decoded N tokens in X s, speed: Y t/s` line for every arm.
# ARM_TPS must be numeric (audit (2)): a differently formatted line voids the
# row instead of letting the primary metric vanish under status=OK.
arm_parse_measure() {
  local tag=$1 arm=$2 limit=$3
  local logf="$RAW/$tag.log" exit_line="" speed="" n_dec=""
  local marker="" post="" turn_buf=0 turn_off=0
  ARM_STATUS=VOID; ARM_VOID=run_fail; ARM_PROOF=na
  ARM_N=na; ARM_OVER=na; ARM_DRAFTED=na; ARM_ACCEPT=na; ARM_TPS=na
  [ -f "$logf" ] || return 0
  # audit8: same HTP gate as the proof parse, before the exit code is read.
  if arm_htp_leak "$logf"; then
    ARM_VOID=htp_leak
    ARM_PROOF="htp_line=1"
    return 0
  fi
  exit_line=$(sed -n 's/^EXIT=//p' "$logf" | tail -1)
  [ "$exit_line" = "0" ] || return 0
  # audit6: same banner gate as the proof parse — an interactive run exits 0
  # when it is short, and hangs to the timeout when it is not.
  if awk '/Running in interactive mode/{n++} END{exit !(n>0)}' "$logf"; then
    ARM_VOID=interactive_mode
    ARM_PROOF="interactive_line=1"
    return 0
  fi
  # Stats-block shapes, end-anchored (AUDIT5 item-4): the real S23 logs also
  # carry llama-completion's `generate: … n_predict = 16, n_keep = 1`, which
  # the unanchored pattern would match ($NF=1 = garbage). The `$` pins the
  # stats-block line (`… I n_predict = <N>`) that only llama-speculative-simple prints.
  ARM_N=$(awk '/n_predict = [0-9]+$/{v=$NF} END{print v}' "$logf")
  case "$ARM_N" in ''|*[!0-9]*) ARM_VOID=no_stats; return 0 ;; esac
  ARM_DRAFTED=$(awk '/n_drafted = [0-9]+$/{v=$NF} END{print v}' "$logf")
  ARM_ACCEPT=$(awk '/accept    = .*%$/{v=$NF} END{print v}' "$logf")
  speed=$(awk '/ decoded .* tokens in .* speed: /{for(i=1;i<=NF;i++) if ($i=="speed:") print $(i+1)}' "$logf" | tail -1)
  ARM_TPS=$speed
  case "$ARM_TPS" in ''|*[!0-9.]*) ARM_VOID=no_stats; ARM_TPS=na; return 0 ;; esac
  # audit3 (round-1 low, still open): the real log carries the count twice —
  # `decoded <N> tokens …` and `n_predict = <N>`; a format drift that loses or
  # alters one of them must void the row instead of passing on a single N.
  n_dec=$(awk '/ decoded .* tokens in .* speed: /{for(i=1;i<=NF;i++) if ($i=="decoded") print $(i+1)}' "$logf" | tail -1)
  case "$n_dec" in
    ''|*[!0-9]*) ARM_VOID=count_mismatch; ARM_PROOF="decoded=${n_dec:-missing} n_predict=$ARM_N"; return 0 ;;
  esac
  if [ "$n_dec" != "$ARM_N" ]; then
    ARM_VOID=count_mismatch
    ARM_PROOF="decoded=$n_dec n_predict=$ARM_N"
    return 0
  fi
  # audit4 N-B2: the measured PROCESS must prove its own backend — the proof
  # run is a different process and cannot vouch for this turn. Same negative
  # check as cell A's turn_backend_disabled, plus placement evidence that only
  # -lv 4 admits: buffer lines must exist, the drafter's segment must offload
  # to GPU exactly when this arm says so.
  if awk '/kernel set failed to build|device disabled/{n++} END{exit !(n>0)}' "$logf"; then
    ARM_VOID=turn_backend_disabled
    ARM_PROOF="disabled_line_in_turn=1 n_predict=$ARM_N"
    return 0
  fi
  marker=$(draft_marker_line "$logf")
  [ -n "$marker" ] || { ARM_VOID=turn_no_marker; return 0; }
  post=$(tail -n +"$((marker + 1))" "$logf")
  turn_buf=$(printf '%s\n' "$post" | awk 'index($0, "model buffer size") {n++} END{print n+0}')
  # AUDIT5 N-C1: turn_off is the offloaded-LAYER COUNT (max N of
  # `offloaded N/M layers to GPU`), not a line count — the same rule as the
  # proof (all dflash layers = MIN_DRAFT_GPU_ASSIGN), so a partial offload
  # (e.g. 3/6) voids a C arm instead of passing it as a mixed C4 row.
  turn_off=$(printf '%s\n' "$post" | awk '
    $0 ~ /offloaded [1-9][0-9]*\/[0-9]+ layers to GPU/ {
      s = $0; sub(/^.*offloaded /, "", s); sub(/\/.*/, "", s)
      if (s + 0 > m) m = s + 0
    } END { print m + 0 }')
  if [ "$turn_buf" -lt 1 ]; then
    ARM_VOID=turn_no_placement
    ARM_PROOF="buffer_lines=$turn_buf off_gpu=$turn_off (needs -lv 4)"
    return 0
  fi
  if arm_is_gpu "$arm"; then
    if [ "$turn_off" -lt "$MIN_DRAFT_GPU_ASSIGN" ]; then
      ARM_VOID=turn_placement_mismatch
      ARM_PROOF="buffer_lines=$turn_buf off_gpu=$turn_off"
      return 0
    fi
  else
    if [ "$turn_off" -gt 0 ]; then
      ARM_VOID=turn_gpu_leak
      ARM_PROOF="buffer_lines=$turn_buf off_gpu=$turn_off"
      return 0
    fi
  fi
  ARM_OVER=$((ARM_N - limit))
  if [ "$arm" = A ] && [ "$ARM_DRAFTED" != 0 ]; then
    ARM_VOID=spec_actually_drafted
    ARM_PROOF="n_drafted=$ARM_DRAFTED"
    return 0
  fi
  ARM_STATUS=OK; ARM_VOID=na
  return 0
}
