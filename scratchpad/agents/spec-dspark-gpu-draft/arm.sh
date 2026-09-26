#!/usr/bin/env bash
# arm.sh — one measured DSpark arm plus its log parse. Sourced by d_run.sh
# (which owns gates, polling, timeouts, restore). One responsibility: build the
# remote llama-speculative-simple command and turn its log into metrics+proof.
#
# Flag provenance (kalsallama f25f0c1c5 common/arg.cpp): -f/--file (:1798,
# all examples but SERVER), --spec-type (:4244), --spec-draft-n-max (:4135),
# -devd/--spec-draft-device (:4208), -ngld/--spec-draft-ngl (:4217),
# -lv/--verbosity (:3934, 4=trace, 5=debug). Proof provenance: `assigned to
# device` is LLAMA_LOG_DEBUG (src/llama-model.cpp:1526/1531), so the parse
# needs -lv 5 (SPC_TRC is LOG_TRC, common/speculative.cpp:24, and already
# prints at the default threshold). GGML_OPENCL_LOG_KERNELS=1 emits one line per unique dispatched kernel
# (ggml/src/ggml-opencl/ggml-opencl-kalsa-diag.cpp:36-44), pattern after
# qdc-heat-3way/arm.sh:163-190.
#
# Thresholds, stated (drafter = 5-layer dflash, NOT the 33-layer target that
# qdc-heat-3way calibrated): every drafter layer must be placed on GPUOpenCL,
# and at least 4 distinct kernels must dispatch (matmul/gemv + convert + norm
# + elementwise are all in any drafter step). dspark prints no `devices=[...]`
# SPC line (only draft-simple/draft-mtp do), so placement + dispatch after the
# draft-load marker ARE the proof (audit B3).
MIN_DRAFT_GPU_ASSIGN=5
MIN_DRAFT_GPU_KERNELS=4

arm_nmax() {
  case "$1" in
    A) printf '0' ;;
    B4|C4) printf '4' ;;
    B8|C8) printf '8' ;;
    *) return 1 ;;
  esac
}

arm_is_gpu() { case "$1" in C*) return 0 ;; *) return 1 ;; esac; }

# arm_flags <arm>: draft device/depth. A and B pin the drafter to CPU (-ngld 0
# — the -1 default would auto-offload on a kit WITH OpenCL); C offloads it.
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

# arm_cmd <tag> <arm> <limit>: the full remote shell command. tag carries the
# match attempt (A, A-m1, ...) so each attempt gets its own device log.
arm_cmd() {
  local tag=$1 arm=$2 limit=$3 flags
  flags=$(arm_flags "$arm") || return 1
  printf 'cd %s && export LD_LIBRARY_PATH=%s/lib && export GGML_OPENCL_LOG_KERNELS=1 && ./bin/llama-speculative-simple -m %s/ship.gguf -md %s/draft.gguf --spec-type draft-dspark %s -f %s/prompt.txt -n %s --temp 0 --top-k 1 -t 8 -ngl 0 -lv 5 > %s/%s.log 2>&1; rc=$?; echo EXIT=$rc >> %s/%s.log; exit $rc' \
    "$D" "$D" "$D" "$D" "$flags" "$D" "$limit" "$D" "$tag" "$D" "$tag"
}

# arm_kill_orphan <tag>: called when the arm's adb call timed out (rc >= 124)
# or a stop fired — the remote process outlives the caller otherwise. The
# pattern is bracketed so the wrapping sh -c line cannot self-match (audit A3
# rule, applied here to our own binary).
arm_kill_orphan() {
  local tag=$1
  log "ARM_KILL_ORPHAN tag=$tag"
  adbT 15 -s "$SER" shell "pkill -f 'llama-speculative-simpl[e]'" >> "$RAW/kill.log" 2>&1 || true
}

# arm_run <tag> <arm> <limit>: runs the arm with the session timeout. Sets
# ARM_WALL_S, ARM_RC. Pulling the log is best-effort.
arm_run() {
  local tag=$1 arm=$2 limit=$3 t0 t1 rc
  t0=$(date +%s)
  set +e
  adbT "$ARM_TIMEOUT_S" -s "$SER" shell "$(arm_cmd "$tag" "$arm" "$limit")" > "$RAW/${tag}_shell.txt" 2>&1
  rc=$?
  set -e
  t1=$(date +%s)
  ARM_WALL_S=$((t1 - t0)); ARM_RC=$rc
  [ "$rc" -lt 124 ] || arm_kill_orphan "$tag"
  adbT 60 -s "$SER" pull "$D/$tag.log" "$RAW/$tag.log" >> "$RAW/${tag}_pull.txt" 2>&1 || true
}

# arm_parse <tag> <arm> <limit>: sets ARM_STATUS (OK|VOID), ARM_VOID,
# ARM_N (n_predict), ARM_OVER, ARM_DRAFTED, ARM_ACCEPT, ARM_TPS, ARM_PROOF.
# Metric for every arm is the SAME line: `decoded N tokens in X s, speed:
# Y t/s` (common_perf_print eval is 0.00 ms/1 runs under speculation — never
# use it). Draft-on-GPU proof counts only AFTER the draft-load marker line:
# bare `using device GPUOpenCL` discovery lines print even at -ngl 0.
arm_parse() {
  local tag=$1 arm=$2 limit=$3
  local logf="$RAW/$tag.log" exit_line="" speed=""
  ARM_STATUS=VOID; ARM_VOID=run_fail; ARM_PROOF=na
  ARM_N=na; ARM_OVER=na; ARM_DRAFTED=na; ARM_ACCEPT=na; ARM_TPS=na
  [ -f "$logf" ] || return 0
  exit_line=$(sed -n 's/^EXIT=//p' "$logf" | tail -1)
  [ "$exit_line" = "0" ] || return 0
  ARM_N=$(awk '/n_predict = /{v=$NF} END{print v}' "$logf")
  ARM_DRAFTED=$(awk '/n_drafted = /{v=$NF} END{print v}' "$logf")
  ARM_ACCEPT=$(awk '/accept    = /{v=$NF} END{print v}' "$logf")
  speed=$(awk '/ decoded .* tokens in .* speed: /{for(i=1;i<=NF;i++) if ($i=="speed:") print $(i+1)}' "$logf" | tail -1)
  ARM_TPS=$speed
  case "$ARM_N" in ''|*[!0-9]*) ARM_VOID=no_stats; return 0 ;; esac
  ARM_OVER=$((ARM_N - limit))
  # Split the log at the draft-load marker: everything after it is the
  # drafter's load (target loaded first, before common_speculative_init).
  local post marker gpu_assign cpu_assign devsel kernels
  marker=$(awk '/common_speculative_init_result: loading draft model/{print NR; exit}' "$logf")
  [ -n "$marker" ] || { ARM_VOID=no_draft_marker; return 0; }
  post=$(tail -n +"$((marker + 1))" "$logf")
  gpu_assign=$(printf '%s\n' "$post" | awk '/load_tensors: layer .* assigned to device GPUOpenCL/{n++} END{print n+0}')
  cpu_assign=$(printf '%s\n' "$post" | awk '/load_tensors: layer .* assigned to device CPU/{n++} END{print n+0}')
  # informational: the drafter's own device-selection line (INFO, per model).
  # Not gated: with -ngld 0 the same discovery line can still name GPUOpenCL.
  devsel=$(printf '%s\n' "$post" | awk '/llama_prepare_model_devices: using device GPUOpenCL/{n++} END{print n+0}')
  kernels=$(printf '%s\n' "$post" | sed -n 's/^GGML_OPENCL_LOG_KERNELS: *//p' | LC_ALL=C sort -u | wc -l | tr -d '[:space:]')
  if arm_is_gpu "$arm"; then
    # Mandated proof (audit B3): placement of every drafter layer on
    # GPUOpenCL + kernel dispatch above floor, both counted AFTER the marker.
    if [ "$gpu_assign" -lt "$MIN_DRAFT_GPU_ASSIGN" ] || [ "$kernels" -lt "$MIN_DRAFT_GPU_KERNELS" ]; then
      ARM_VOID=no_gpu_proof
      ARM_PROOF="draft_gpu_assign=$gpu_assign/$MIN_DRAFT_GPU_ASSIGN kernels=$kernels/$MIN_DRAFT_GPU_KERNELS devsel=$devsel"
      return 0
    fi
    if printf '%s\n' "$post" | awk '/kernel set failed to build|device disabled/{n++} END{exit !(n>0)}'; then
      ARM_VOID=gpu_disabled
      ARM_PROOF="draft_gpu_assign=$gpu_assign kernels=$kernels"
      return 0
    fi
    ARM_PROOF="draft_gpu_assign=$gpu_assign kernels=$kernels devsel=$devsel"
  else
    # CPU arms: drafter on CPU, and NO drafter GPU evidence. Deliberately not
    # "zero ggml_opencl lines" — the kit logs OpenCL discovery even at -ngl 0.
    if [ "$cpu_assign" -lt 1 ] || [ "$gpu_assign" -gt 0 ] || [ "$kernels" -gt 0 ]; then
      ARM_VOID=draft_not_on_cpu
      ARM_PROOF="draft_cpu_assign=$cpu_assign draft_gpu_assign=$gpu_assign kernels=$kernels"
      return 0
    fi
    if [ "$arm" = A ] && [ "$ARM_DRAFTED" != 0 ]; then
      ARM_VOID=spec_actually_drafted
      ARM_PROOF="n_drafted=$ARM_DRAFTED"
      return 0
    fi
    ARM_PROOF="draft_cpu_assign=$cpu_assign gpu_evidence=0"
  fi
  ARM_STATUS=OK; ARM_VOID=na
  return 0
}
