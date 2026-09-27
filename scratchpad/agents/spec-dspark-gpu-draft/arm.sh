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
MIN_DRAFT_GPU_ASSIGN=5
MIN_DRAFT_GPU_KERNELS=4
PROOF_N=4   # short proof run: load + a few tokens, enough to dispatch kernels

arm_is_gpu() { case "$1" in C*) return 0 ;; *) return 1 ;; esac; }

# arm_flags <arm>: drafter device/depth. A and B pin the drafter to CPU
# (-ngld 0: the -1 default would auto-offload on a kit WITH OpenCL).
arm_flags() {
  case "$1" in
    A)  printf '%s' "--spec-draft-n-max 0 -ngld 0" ;;
    B4) printf '%s' "--spec-draft-n-max 4 -ngld 0" ;;
    B8) printf '%s' "--spec-draft-n-max 8 -ngld 0" ;;
    C4) printf '%s' "--spec-draft-n-max 4 -devd GPUOpenCL -ngld 99" ;;
    C8) printf '%s' "--spec-draft-n-max 8 -devd GPUOpenCL -ngld 99" ;;
    *) return 1 ;;
  esac
}

# arm_cmd <tag> <arm> <limit> <mode>: full remote shell command.
#   mode=proof   -> `-lv 5` + GGML_OPENCL_LOG_KERNELS=1 (placement + dispatch)
#   mode=measure -> default verbosity, no kernel env (clean timed window)
arm_cmd() {
  local tag=$1 arm=$2 limit=$3 mode=$4 flags lv envk
  flags=$(arm_flags "$arm") || return 1
  lv=""; envk=""
  case "$mode" in
    proof)   lv=" -lv 5"; envk="export GGML_OPENCL_LOG_KERNELS=1 && " ;;
    measure) : ;;
    *) return 1 ;;
  esac
  printf 'cd %s && export LD_LIBRARY_PATH=%s/lib && %s./bin/llama-speculative-simple -m %s/ship.gguf -md %s/draft.gguf --spec-type draft-dspark %s -f %s/prompt.txt -n %s --temp 0 --top-k 1 -t 8 -ngl 0%s > %s/%s.log 2>&1; rc=$?; echo EXIT=$rc >> %s/%s.log; exit $rc' \
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

# arm_parse_proof <tag> <arm>: the -lv 5 run. Sets ARM_STATUS/ARM_VOID/ARM_PROOF.
# Order assert (audit B-12): the target must have placement lines BEFORE the
# draft-load marker, otherwise the post-marker split measures the wrong model.
arm_parse_proof() {
  local tag=$1 arm=$2
  local logf="$RAW/$tag.log" exit_line="" pre="" post=""
  local pre_place=0 gpu_assign=0 cpu_assign=0 kernels=0
  ARM_STATUS=VOID; ARM_VOID=run_fail; ARM_PROOF=na
  [ -f "$logf" ] || return 0
  exit_line=$(sed -n 's/^EXIT=//p' "$logf" | tail -1)
  [ "$exit_line" = "0" ] || return 0
  local marker
  marker=$(awk '/common_speculative_init_result: loading draft model/{print NR; exit}' "$logf")
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
  local logf="$RAW/$tag.log" exit_line="" speed=""
  ARM_STATUS=VOID; ARM_VOID=run_fail; ARM_PROOF=na
  ARM_N=na; ARM_OVER=na; ARM_DRAFTED=na; ARM_ACCEPT=na; ARM_TPS=na
  [ -f "$logf" ] || return 0
  exit_line=$(sed -n 's/^EXIT=//p' "$logf" | tail -1)
  [ "$exit_line" = "0" ] || return 0
  ARM_N=$(awk '/n_predict = /{v=$NF} END{print v}' "$logf")
  case "$ARM_N" in ''|*[!0-9]*) ARM_VOID=no_stats; return 0 ;; esac
  ARM_DRAFTED=$(awk '/n_drafted = /{v=$NF} END{print v}' "$logf")
  ARM_ACCEPT=$(awk '/accept    = /{v=$NF} END{print v}' "$logf")
  speed=$(awk '/ decoded .* tokens in .* speed: /{for(i=1;i<=NF;i++) if ($i=="speed:") print $(i+1)}' "$logf" | tail -1)
  ARM_TPS=$speed
  case "$ARM_TPS" in ''|*[!0-9.]*) ARM_VOID=no_stats; ARM_TPS=na; return 0 ;; esac
  ARM_OVER=$((ARM_N - limit))
  if [ "$arm" = A ] && [ "$ARM_DRAFTED" != 0 ]; then
    ARM_VOID=spec_actually_drafted
    ARM_PROOF="n_drafted=$ARM_DRAFTED"
    return 0
  fi
  ARM_STATUS=OK; ARM_VOID=na
  return 0
}
