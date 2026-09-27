#!/bin/bash
# dryrun-adb.sh — fake adb for the qdc-heat-3way dry-run. One responsibility:
# impersonate exactly the adb surface the driver uses (devices/get-state/
# wait-for-device/push/pull/shell) and answer it from a per-fixture state dir,
# with reading- and log-injection knobs so the dry-run can prove every gate.
#
# Knobs (exported by dryrun.sh, read here):
#   DRY_<X>_AT / DRY_<X>_AFTER  reading X takes the AFTER value from dumpsys
#       call # AT onward (AT defaults to 1 when AFTER is set); X in
#       SKIN, BATT_TEMP, BATT_LEVEL, THERMAL_STATUS, PLUGGED (0/1), MISSING
#       (name of the reading to blank: skin|status|temp|level)
#   DRY_BATT_STUB=1        battery temp pinned to the QDC 25.0 C stub, sysfs
#       mirrors dumpsys so battery_trust.sh takes the stub branch
#   DRY_ARM_SLEEP_S        fake llama-completion wall time (load + turn)
#   DRY_NO_CPU_PROOF=1     omit the `assigned to device CPU` lines from the C
#       proof run (models a log without them; the proof now reads the -lv 5
#       load-phase log, arm.sh arm_parse_proof)
#   DRY_DECODE_RUNS        runs in the perf eval line (default 126 = N-1 of
#       -n 127; the first token comes from the prompt eval — run-1 evidence)
#   DRY_TURN_FP_BUF=<name>  override the TURN log's `model buffer size`
#       backend name — proves the placement backend_mismatch gate
#       (e.g. CPU on a G turn = silent fallback, audit2 NEW-3)
#   DRY_TURN_NO_FP=1       omit the fingerprint components (buffer/offload/
#       system_info) from the turn log — proves fail-closed no_fingerprint
#   DRY_TURN_DISABLED=1    append the kernel-build-failed/device-disabled WARN
#       to the TURN log — proves the turn-side negative (audit2 NEW-3)
#   DRY_PGREP_BROKEN=1     the health probe answers 0 for a missing pattern —
#       proves the pgrep self-test aborts (audit2 NEW-4)
#   DRY_PKILL_NOOP=1       pkill does not kill: pgrep keeps answering "still
#       running" — proves the kill-verification path (A-4)
#   DRY_FAIL_DEVICES=1     `adb devices` exits 1 (A-9 fixture)
#   DRY_FAIL_SOC=1         getprop exits 7 (A-9 fixture)
#   DRY_NO_HTP_PROOF=1     omit Hexagon Arch + execute-op lines from N logs
#   DRY_HTP_OPS=N          execute-op line count (default 80 = 4 proof tokens
#       x 20 ops/token, inside the [0.5,25] sanity band — audit3 A-N5: the
#       fake must scale with the proof's tokens, not invent 1200)
#   DRY_SAMPLER_NO_DONE=1  the device loop exits WITHOUT its H sampler_done
#       stamp — proves the unconfirmed-pause column (audit3 A-N7)
#   DRY_NO_GPU_PROOF=1     omit GPUOpenCL assignment + kernel lines from G logs
#   DRY_GPU_KERNELS=N      GGML_OPENCL_LOG_KERNELS line count (default 12, A6 floor 8)
#   DRY_GPU_DISABLED=1     append the kernel-build-failed/device-disabled line
#   DRY_PROMPT_N           prompt token count in the perf line (default 1018)
#   DRY_ARM_RC             remote exit code of load/turn (default 0)
# The dumpsys call counter counts ONLY gate/trust live reads; the 1 s sampler
# peeks at the current value without advancing it (a real sampler would move
# the readings itself, which would make AT-based injection nondeterministic).
set -euo pipefail
STATE="${FAKE_ADB_STATE:-/tmp/qdc-heat3way-fake}"
DEV="$STATE/dev"
mkdir -p "$DEV"
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
PROMPT_SHA=2a4b5deaa3f4eefc5a878278184dcb6ba397f376c82395368f5126d9967d0ea1

bump() { printf 'r\n' >> "$STATE/reads.log"; }
read_n() {
  if [ -f "$STATE/reads.log" ]; then wc -l < "$STATE/reads.log" | tr -d '[:space:]'; else echo 0; fi
}
pick() { # <at> <after> <base> <n>: AFTER applies once n >= AT (AT default 1)
  if [ -n "$2" ] && [ "$4" -ge "${1:-1}" ]; then printf '%s' "$2"; else printf '%s' "$3"; fi
}
compute() { # sets SKIN_VAL TEMP_VAL LVL_VAL STATUS_VAL PLUG_VAL MISS_VAL for read index $1
  SKIN_VAL=$(pick "${DRY_SKIN_AT:-}" "${DRY_SKIN_AFTER:-}" 33.5 "$1")
  TEMP_VAL=$(pick "${DRY_BATT_TEMP_AT:-}" "${DRY_BATT_TEMP_AFTER:-}" 310 "$1")
  [ "${DRY_BATT_STUB:-0}" = 1 ] && TEMP_VAL=250
  LVL_VAL=$(pick "${DRY_BATT_LEVEL_AT:-}" "${DRY_BATT_LEVEL_AFTER:-}" 88 "$1")
  STATUS_VAL=$(pick "${DRY_THERMAL_STATUS_AT:-}" "${DRY_THERMAL_STATUS_AFTER:-}" 0 "$1")
  PLUG_VAL=$(pick "${DRY_PLUGGED_AT:-}" "${DRY_PLUGGED_AFTER:-}" 0 "$1")
  MISS_VAL=$(pick "${DRY_MISSING_AT:-}" "${DRY_MISSING_AFTER:-}" "" "$1")
  return 0
}
dump_battery() {
  bump; compute "$(read_n)"
  local p=false
  [ "$PLUG_VAL" = 1 ] && p=true
  [ "$MISS_VAL" = temp ] && TEMP_VAL=""
  [ "$MISS_VAL" = level ] && LVL_VAL=""
  cat <<EOF
Current Battery Service state:
  AC powered: $p
  USB powered: false
  Wireless powered: false
  Dock powered: false
  status: 2
  health: 2
  present: true
  level: $LVL_VAL
  voltage: 4200
  temperature: $TEMP_VAL
  technology: Li-ion
EOF
}
dump_thermals() {
  bump; compute "$(read_n)"
  local s="$SKIN_VAL" st="$STATUS_VAL"
  [ "$MISS_VAL" = skin ] && s=""
  [ "$MISS_VAL" = status ] && st=""
  cat <<EOF
IsStatusOverride: false
Thermal Status: $st
Thermal Statuses from API:
  mStatus=0
Current temperatures from HAL:
  Temperature{mValue=$s, mType=3, mName=SKIN, name2=skin}
  Temperature{mValue=45.0, mType=0, mName=cpu-0}
Current cooling devices from HAL:
  Temperature{mValue=10.0, mType=15, mName=fan0}
EOF
}
emit_gpu_block() { # placement + execution evidence (A6)
  printf 'llama_prepare_model_devices: using device GPUOpenCL (QUALCOMM Adreno(TM) 740) (unknown id) - 3536 MiB free\n'
  printf 'ggml_opencl: default device: %s (%s)\n' "QUALCOMM Adreno(TM) 740" "OpenCL 2.0"
  if [ "${DRY_NO_GPU_PROOF:-0}" != 1 ]; then
    local i=0
    while [ "$i" -lt 33 ]; do printf 'load_tensors: layer %3d assigned to device GPUOpenCL, is_swa = 0\n' "$i"; i=$((i + 1)); done
    local k=0 kn="${DRY_GPU_KERNELS:-12}"
    while [ "$k" -lt "$kn" ]; do printf 'GGML_OPENCL_LOG_KERNELS: kernel_%02d\n' "$k"; k=$((k + 1)); done
    if [ "${DRY_GPU_DISABLED:-0}" = 1 ]; then
      printf "ggml_opencl: kernel set failed to build on 'kernel_0' (driver 'Adreno'); device disabled\n"
    fi
  fi
}
emit_npu_block() { # dispatch evidence (A6: >= 1000 execute-op lines + arch)
  printf 'llama_prepare_model_devices: using device HTP0 (Hexagon) (unknown id) - 0 MiB free\n'
  local i=0
  while [ "$i" -lt 33 ]; do printf 'load_tensors: layer %3d assigned to device HTP0, is_swa = 0\n' "$i"; i=$((i + 1)); done
  if [ "${DRY_NO_HTP_PROOF:-0}" != 1 ]; then
    printf 'ggml-hex: Hexagon Arch version v73\n'
    printf 'ggml-hex: HTP0 hwinfo: threads 4, hvx 4, hmx 1, vtcm 8 MB\n'
    # 80 = the structural proof tokens (1 prompt + 3 eval runs for -n 4)
    # x 20 ops/token — inside the [0.5,25] sanity band (audit3 A-N5b).
    local n="${DRY_HTP_OPS:-80}" j=0
    while [ "$j" -lt "$n" ]; do
      printf 'ggml-hex: HTP0 execute-op MUL_MAT|node_%d x weight -> out|a|b|c|d|e|f|g|flags 0x0\n' "$j"
      j=$((j + 1))
    done
  fi
}
emit_cpu_block() { # discovery lines mirror the real A.log: -ngl 0 still lists
  # every device via `using device`, so the dry-run regresses the
  # assignment-only CPU proof (audit lesson kept from round 1).
  printf 'llama_prepare_model_devices: using device GPUOpenCL (QUALCOMM Adreno(TM)) (unknown id) - 2512 MiB free\n'
  printf 'llama_prepare_model_devices: using device HTP0 (Hexagon) (unknown id) - 0 MiB free\n'
  if [ "${DRY_NO_CPU_PROOF:-0}" != 1 ]; then
    local i=0
    while [ "$i" -lt 33 ]; do printf 'load_tensors: layer %3d assigned to device CPU, is_swa = 0\n' "$i"; i=$((i + 1)); done
  fi
}
run_arm() { # synthesizes the pulled llama-completion log (proof/load phase or turn)
  if [ "${DRY_ARM_SLEEP_S:-0}" -gt 0 ]; then sleep "$DRY_ARM_SLEEP_S"; fi
  local tag backend prefill prompt_n phase ngl fit_ngl cand_lines fp_part buf_name
  # redirect target carries the job id: heat3way/<job>-t1cpu[.load].log
  tag=$(printf '%s\n' "$cmd" | sed -n 's#.*heat3way/\([A-Za-z0-9._-]*\.log\) 2>&1.*#\1#p')
  [ -n "$tag" ] || tag=unparsed.log
  case "$cmd" in
    *HTP0*) backend=npu; prefill=18000 ;;
    *GPUOpenCL*) backend=gpu; prefill=14000 ;;
    *) backend=cpu; prefill=45000 ;;
  esac
  phase=turn
  case "$cmd" in *"-lv 5"*) phase=load ;; esac   # proof runs at -lv 5, turns at -lv 4
  ngl=99
  case "$cmd" in *"-ngl 0"*) ngl=0 ;; esac
  # Candidate lines (always emitted, level WARN/tool — visible even at default;
  # calibrate prints them as candidates, they are NOT fingerprint components
  # since fit-ngl is intent, not placement — audit2 NEW-3).
  fit_ngl="$ngl"
  cand_lines=$(printf '0.00.649.591 W common_fit_params: failed to fit params to free device memory: n_gpu_layers already set by user to %s, abort' "$fit_ngl")
  if [ "$backend" != gpu ]; then
    cand_lines="${cand_lines}"$'\n'"$(printf '0.00.604.690 W common_get_device_memory_data_impl: device HTP0 did not report memory; --fit will not use it')"
  fi
  # Fingerprint components (audit2 NEW-2/NEW-3): PLACEMENT = buffer size line
  # + offloaded layers + system_info threads. The turn may be stripped of
  # them (NO_FP) or have its buffer line forged (FP_BUF).
  buf_name="$backend"
  case "$backend" in cpu) buf_name=CPU ;; gpu) buf_name=GPUOpenCL ;; npu) buf_name=HTP0 ;; esac
  if [ "$phase" = turn ] && [ -n "${DRY_TURN_FP_BUF:-}" ]; then buf_name="$DRY_TURN_FP_BUF"; fi
  fp_part=""
  if ! { [ "$phase" = turn ] && [ "${DRY_TURN_NO_FP:-0}" = 1 ]; }; then
    fp_part=$(printf 'load_tensors: %12s model buffer size = %8.2f MiB' "$buf_name" 1182.09)
    case "$backend" in
      cpu) fp_part="${fp_part}"$'\n'"$(printf 'load_tensors: offloaded 0/33 layers to GPU')" ;;
      *)   fp_part="${fp_part}"$'\n'"$(printf 'load_tensors: offloaded 33/33 layers to GPU')" ;;
    esac
    fp_part="${fp_part}"$'\n'"$(printf '0.07.916.389 I system_info: n_threads = 5 (n_threads_batch = 5) / 8 | CPU : NEON = 1 | ARM_FMA = 1')"
  fi
  prompt_n="${DRY_PROMPT_N:-1018}"
  {
    printf '%s\n' "$cand_lines"
    if [ -n "$fp_part" ]; then printf '%s\n' "$fp_part"; fi
    if [ "$phase" = load ]; then
      # Proof run (-lv 5): verbose block HERE only (A-2) + perf so NEW-1 can
      # read its exact token count (prompt 1 + 3 eval runs for -n 4).
      printf 'llama_model_loader: loaded meta data with %s tokens from /data/local/tmp/heat3way/ship.gguf\n' "$((prompt_n + 127))"
      case "$backend" in
        cpu) emit_cpu_block ;;
        gpu) emit_gpu_block ;;
        npu) emit_npu_block ;;
      esac
      printf '1.17.377.170 I common_perf_print: prompt eval time = %10.2f ms / %5d tokens (%8.2f ms per token, %8.2f tokens per second)\n' 88.88 1 88.88 11.25
      printf '1.17.377.172 I common_perf_print:        eval time = %10.2f ms / %5d runs   (%8.2f ms per token, %8.2f tokens per second)\n' 420.00 3 140.00 7.14
    else
      # Measured turn at -lv 4: placement INFO (buffer/offload/using-device)
      # + perf lines with the real prefixes from
      # raw/s23-cli-heat-20260926/s23-cli-heat-20260926-t1cpu.log:47-50.
      case "$backend" in
        cpu) printf 'llama_prepare_model_devices: using device GPUOpenCL (QUALCOMM Adreno(TM)) (unknown id) - 2512 MiB free\nllama_prepare_model_devices: using device HTP0 (Hexagon) (unknown id) - 0 MiB free\n' ;;
        gpu) printf 'llama_prepare_model_devices: using device GPUOpenCL (QUALCOMM Adreno(TM) 740) (unknown id) - 3536 MiB free\n' ;;
        npu) printf 'llama_prepare_model_devices: using device HTP0 (Hexagon) (unknown id) - 0 MiB free\n' ;;
      esac
      if [ "${DRY_TURN_DISABLED:-0}" = 1 ]; then
        printf "0.03.100.000 W ggml_opencl: kernel set failed to build on 'kernel_0' (driver 'Adreno'); device disabled, ops stay on CPU\n"
      fi
      printf '1.17.377.180 I common_perf_print:        load time = %10.2f ms\n' 9876.5
      printf '1.17.377.184 I common_perf_print: prompt eval time = %10.2f ms / %5d tokens (%8.2f ms per token, %8.2f tokens per second)\n' "$prefill" "$prompt_n" 44.20 22.62
      printf '1.17.377.201 I common_perf_print:        eval time = %10.2f ms / %5d runs   (%8.2f ms per token, %8.2f tokens per second)\n' 9071 "${DRY_DECODE_RUNS:-126}" 71.43 14.00
      printf '1.17.377.214 I common_perf_print:       total time = %10.2f ms / %5d tokens\n' 54876.5 "$((prompt_n + 127))"
    fi
    printf 'EXIT=%s\n' "${DRY_ARM_RC:-0}"
  } > "$DEV/$tag"
  exit "${DRY_ARM_RC:-0}"
}
run_sampler() {
  local out="$DEV/samples.txt" i=0
  # Append-safe (A-11): a resumed sampler must not truncate the series; the
  # header is written once, each launch stamps H sampler_start.
  if [ ! -f "$out" ]; then
    echo "H zones: /sys/class/thermal/thermal_zone0:cpu-0 /sys/class/thermal/thermal_zone5:gpuss-0" > "$out"
  fi
  echo "H sampler_start $(date +%s)" >> "$out"
  while [ ! -f "$DEV/stop_marker" ] && [ "$i" -lt 300 ]; do
    compute "$(read_n)"
    s="$SKIN_VAL"
    [ "$MISS_VAL" = skin ] && s=""
    echo "Z $(date +%s) cpu-thermal=42000" >> "$out"
    echo "S $(date +%s) $s" >> "$out"
    i=$((i + 1))
    sleep 1
  done
  if [ "${DRY_SAMPLER_NO_DONE:-0}" != 1 ]; then
    echo "H sampler_done $(date +%s)" >> "$out"
  fi
  echo "fake sampler exited iterations=$i"
  exit 0
}
handle_shell() {
  # Syntax-check EVERY device shell string with dash — POSIX, the closest to
  # /system/bin/sh available on this Mac (busybox/mksh are not installed):
  # the fake never executes the command, so without this a malformed
  # composition (the double `&&` that killed S23 run 2) sails through the
  # whole matrix in silence. A syntax error is recorded loudly and the
  # command fails the way a broken remote shell does (rc 2).
  if ! dash -n -c "$cmd" 2>/dev/null; then
    printf 'SYNTAX_FAIL: %s\n' "$cmd" >> "$STATE/shell_syntax_error.log"
    echo "/system/bin/sh: syntax error (dash -n rejected this command)" >&2
    exit 2
  fi
  case "$cmd" in
    *"sha256sum -c"*)
      if [ -f "$STATE/kit_unpacked" ]; then
        printf 'bin/llama-bench: OK\nbin/llama-completion: OK\nlib/libggml.so: OK\n'
        exit 0
      fi
      echo "sha256sum: SHA256SUMS: No such file or directory" >&2; exit 1 ;;
    *"sha256sum"*ship.gguf*)
      if [ -f "$STATE/present_model" ]; then echo "$MODEL_SHA  ship.gguf"; exit 0; fi
      echo "sha256sum: /data/local/tmp/heat3way/ship.gguf: No such file or directory" >&2; exit 1 ;;
    *"sha256sum"*prompt.txt*)
      if [ -f "$STATE/present_prompt" ]; then echo "$PROMPT_SHA  prompt.txt"; exit 0; fi
      echo "sha256sum: /data/local/tmp/heat3way/prompt.txt: No such file or directory" >&2; exit 1 ;;
    *"sha256sum"*llama-completion*)
      if [ -f "$STATE/kit_unpacked" ]; then echo "790e38986321ff244535d297fbe66fc7d025454a07c5db904554e40dd4846109  bin/llama-completion"; exit 0; fi
      echo "sha256sum: no such file" >&2; exit 1 ;;
    # pgrep is the verdict channel for: the session kill probe, the setup
    # self-test (health/alive/gone — all PGREP_RC=) and restore's combined
    # PROBE=/GONE= probe (NEW-4). Distinguish by the pattern in the command.
    *pgrep*)
      printf '%s\n' "$cmd" >> "$STATE/pgrep.log"
      # Self-match model (proven on the S23, run 1640559a): pgrep -f PATTERN
      # finds the wrapping `sh -c` whenever the command string itself contains
      # PATTERN's UNBRACKETED literal — and a bracketed pattern ([z]zz_…)
      # matches that same literal, so one plain occurrence anywhere in the
      # command makes every probe of that target self-match (the coordinator
      # proved plain=RC0, bracket=RC1, and both-in-one-cmd=RC0).
      health_rc=1
      case "$cmd" in *zzz_no_such_proc_zzz*) health_rc=0 ;; esac
      if [ "${DRY_PGREP_BROKEN:-0}" = 1 ]; then health_rc=0; fi
      victim_literal=0
      case "$cmd" in *sleep\ 4731*) victim_literal=1 ;; esac
      case "$cmd" in
        *ALIVE_RC*)
          # audit3 A-N4 one-session selftest: spawn → alive → health → kill →
          # gone. The victim is assembled in the real command (no contiguous
          # literal), so the marker decides; a literal in the cmd would make
          # the victim self-match and GONE can never be true.
          : > "$DEV/sleep4731"
          printf '47310\nALIVE_RC=0\n'
          printf 'HEALTH_RC=%s\n' "$health_rc"
          rm -f "$DEV/sleep4731"
          if [ "$victim_literal" = 1 ]; then
            printf '47310\nGONE_RC=0\n'
          else
            printf 'GONE_RC=1\n'
          fi
          exit 0 ;;
        *PROBE=*)
          # restore's combined probe (keyed on the invariant `echo PROBE=$?`
          # marker — NOT on a pattern's literal: the bracketed health pattern
          # deliberately contains no plain zzz for a glob to see): PROBE=
          # health, then pkill effect, GONE=
          printf 'PROBE=%s\n' "$health_rc"
          if [ "${DRY_PKILL_NOOP:-0}" != 1 ]; then : > "$STATE/llama_killed"; fi
          llama_literal=0
          case "$cmd" in *llama-completion*) llama_literal=1 ;; esac
          if [ "$llama_literal" = 1 ]; then
            printf '4242\nGONE=0\n'      # plain pattern in cmd = self-match: never gone
          elif [ -f "$STATE/llama_killed" ] && [ "${DRY_PKILL_NOOP:-0}" != 1 ]; then
            printf 'GONE=1\n'
          else
            printf '4242\nGONE=0\n'
          fi
          exit 0 ;;
      esac
      # session llama kill probe (bracketed — no plain literal in its cmd,
      # so the state flag decides)
      llama_literal=0
      case "$cmd" in *llama-completion*) llama_literal=1 ;; esac
      if [ "$llama_literal" = 1 ]; then
        printf '4242\nPGREP_RC=0\n'
      elif [ -f "$STATE/llama_killed" ] && [ "${DRY_PKILL_NOOP:-0}" != 1 ]; then
        printf 'PGREP_RC=1\n'
      else
        printf '4242\nPGREP_RC=0\n'
      fi
      exit 0 ;;
    *pkill*)
      printf '%s\n' "$cmd" >> "$STATE/pkill.log"
      if [ "${DRY_PKILL_NOOP:-0}" != 1 ]; then : > "$STATE/llama_killed"; fi
      exit 0 ;;
    # NEW-6: sampler_pause polls for the device loop's exit stamp
    *sampler_done*)
      if [ -f "$DEV/samples.txt" ]; then grep -c 'H sampler_done' "$DEV/samples.txt" || true; else echo 0; fi
      exit 0 ;;
    *--list-devices*)
      printf 'Available devices:\n  GPUOpenCL: QUALCOMM Adreno(TM) (3536 MiB, 2512 MiB free)\n  HTP0: Hexagon (0 MiB, 0 MiB free)\n'
      exit 0 ;;
    *llama-completion*) run_arm ;;
    *smp.sh*) run_sampler ;;
    *"tar -xzf"*) : > "$STATE/kit_unpacked"; exit 0 ;;
    *dumpsys\ thermalservice*) dump_thermals; exit 0 ;;
    *dumpsys\ battery*) dump_battery; exit 0 ;;
    *power_supply/battery/temp*) compute "$(read_n)"; echo "$TEMP_VAL"; exit 0 ;;
    *getprop*)
      if [ "${DRY_FAIL_SOC:-0}" = 1 ]; then echo "error: device offline" >&2; exit 7; fi
      echo SM8550; exit 0 ;;
    *"settings get system screen_off_timeout"*) cat "$STATE/screen_timeout" 2>/dev/null || echo 60000; exit 0 ;;
    *"settings get global stay_on_while_plugged_in"*) cat "$STATE/stay_on_while_plugged_in" 2>/dev/null || echo null; exit 0 ;;
    *"settings put system screen_off_timeout"*) printf '%s\n' "${cmd##* }" > "$STATE/screen_timeout"; exit 0 ;;
    *"settings put global stay_on_while_plugged_in"*) printf '%s\n' "${cmd##* }" > "$STATE/stay_on_while_plugged_in"; exit 0 ;;
    *"settings delete system screen_off_timeout"*) rm -f "$STATE/screen_timeout"; exit 0 ;;
    *"settings delete global stay_on_while_plugged_in"*) rm -f "$STATE/stay_on_while_plugged_in"; exit 0 ;;
    # AOSP semantics: `svc power stayon true` writes global
    # stay_on_while_plugged_in=3 — the setting restore.sh puts back (A13).
    *"svc power stayon"*) printf '3\n' > "$STATE/stay_on_while_plugged_in"; exit 0 ;;
    *"input keyevent"*) exit 0 ;;
    *touch*stop*) : > "$DEV/stop_marker"; exit 0 ;;
    *"rm -f"*stop*) rm -f "$DEV/stop_marker"; exit 0 ;;
    *) printf '%s\n' "$cmd" >> "$STATE/unknown_shell.log"; exit 0 ;;
  esac
}

# ---- argv ----
if [ "${1:-}" = "-s" ]; then shift 2; fi
verb="${1:-}"
[ $# -gt 0 ] && shift
case "$verb" in
  devices)
    if [ "${DRY_FAIL_DEVICES:-0}" = 1 ]; then echo "adb: no devices/emulators found" >&2; exit 1; fi
    printf 'List of devices attached\n%s\tdevice\n' "${FAKE_SERIAL:-fakes23}"
    exit 0 ;;
  get-state) echo device; exit 0 ;;
  wait-for-device) exit 0 ;;
  push)
    base=$(basename "${2:-}")
    case "$base" in
      ship.gguf) : > "$STATE/present_model" ;;
      prompt.txt) : > "$STATE/present_prompt" ;;
      kit.tgz) : > "$STATE/present_kit_tgz" ;;
    esac
    printf 'pushed %s\n' "$base" >> "$STATE/push.log"
    exit 0 ;;
  pull)
    base=$(basename "${1:-}")
    if [ -f "$DEV/$base" ]; then cp "$DEV/$base" "${2:-/dev/null}"; exit 0; fi
    echo "fake-adb: cannot stat '$1': No such file or directory" >&2; exit 1 ;;
  shell) cmd="$*"; handle_shell ;;
  *) echo "fake-adb: unhandled verb: $verb" >&2; exit 1 ;;
esac
