#!/bin/bash
# dryrun-adb.sh — fake adb for the qdc-heat-3way dry-run. One responsibility:
# impersonate exactly the adb surface the driver uses (devices/get-state/
# wait-for-device/push/pull/shell) and answer it from a per-fixture state dir,
# with reading-injection knobs so the dry-run can prove every safety stop.
#
# Knobs (exported by dryrun.sh, read here):
#   DRY_<X>_AT / DRY_<X>_AFTER  reading X takes the AFTER value from dumpsys
#       call # AT onward (AT defaults to 1 when AFTER is set); X in
#       SKIN, BATT_TEMP, BATT_LEVEL, THERMAL_STATUS, PLUGGED (0/1), MISSING
#       (name of the reading to blank: skin|status|temp|level)
#   DRY_BATT_STUB=1        battery temp pinned to the QDC 250 (25.0 C) stub,
#       sysfs mirrors dumpsys so battery_trust.sh takes the stub branch
#   DRY_ARM_SLEEP_S        fake llama-completion wall time (mid-arm stop test)
#   DRY_NO_HTP_PROOF=1     omit Hexagon Arch + execute-op lines from N logs
#   DRY_NO_GPU_PROOF=1     omit GPUOpenCL assignment lines from G logs
#   DRY_PROMPT_N           prompt token count printed in perf lines (1018)
#   DRY_ARM_RC             remote exit code of the arm (default 0)
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
run_arm() { # synthesizes the pulled llama-completion log, then exits like it
  if [ "${DRY_ARM_SLEEP_S:-0}" -gt 0 ]; then sleep "$DRY_ARM_SLEEP_S"; fi
  local tag backend prefill prompt_n backend_block=""
  tag=$(printf '%s\n' "$cmd" | sed -n 's#.*heat3way/\([A-Za-z0-9]*\.log\) 2>&1.*#\1#p')
  [ -n "$tag" ] || tag=unparsed.log
  case "$cmd" in
    *HTP0*) backend=npu; prefill=18000 ;;
    *GPUOpenCL*) backend=gpu; prefill=14000 ;;
    *) backend=cpu; prefill=45000 ;;
  esac
  prompt_n="${DRY_PROMPT_N:-1018}"
  case "$backend" in
    cpu)
      # Discovery lines mirror the real A.log: even -ngl 0 lists every device
      # via `using device`, so the dry-run regresses the assignment-only proof.
      backend_block="llama_prepare_model_devices: using device GPUOpenCL (QUALCOMM Adreno(TM)) (unknown id) - 2512 MiB free
llama_prepare_model_devices: using device HTP0 (Hexagon) (unknown id) - 0 MiB free
load_tensors: layer   0 assigned to device CPU, is_swa = 0
load_tensors: layer   1 assigned to device CPU, is_swa = 0
load_tensors: layer  32 assigned to device CPU, is_swa = 0" ;;
    gpu)
      [ "${DRY_NO_GPU_PROOF:-0}" = 1 ] && backend_block="llama_prepare_model_devices: no device prepared" || backend_block="llama_prepare_model_devices: using device GPUOpenCL (QUALCOMM Adreno(TM) 740) (unknown id) - 3536 MiB free
load_tensors: layer   0 assigned to device GPUOpenCL, is_swa = 0
load_tensors: layer  32 assigned to device GPUOpenCL, is_swa = 0" ;;
    npu)
      backend_block="llama_prepare_model_devices: using device HTP0 (Hexagon) (unknown id) - 0 MiB free
load_tensors: layer   0 assigned to device HTP0, is_swa = 0
load_tensors: layer  32 assigned to device HTP0, is_swa = 0"
      if [ "${DRY_NO_HTP_PROOF:-0}" != 1 ]; then
        backend_block="$backend_block
ggml-hex: Hexagon Arch version v73
ggml-hex: HTP0 hwinfo: threads 4, hvx 4, hmx 1, vtcm 8 MB
ggml-hex: HTP0 execute-op MUL_MAT|blk.0.shortconv.in_proj.weight x embed -> conv
ggml-hex: HTP0 execute-op SSM_CONV|node_19 x blk.0.shortconv.conv.weight -> out"
      fi ;;
  esac
  {
    printf 'llama_model_loader: loaded meta data with %s tokens from /data/local/tmp/heat3way/ship.gguf\n' "$((prompt_n + 127))"
    printf '%s\n' "$backend_block"
    printf 'llama_perf_context_create: load time =  9876.5 ms\n'
    printf 'llama_perf_context_print: prompt eval time = %8.2f ms / %5s tokens (   44.20 ms per token,     22.62 tokens per second)\n' "$prefill" "$prompt_n"
    printf 'llama_perf_context_print:        eval time = %8.2f ms / %5s runs   (   71.43 ms per token,     14.00 tokens per second)\n' 9071 127
    printf 'EXIT=%s\n' "${DRY_ARM_RC:-0}"
  } > "$DEV/$tag"
  exit "${DRY_ARM_RC:-0}"
}
run_sampler() {
  local out="$DEV/samples.txt" i=0
  echo "H zones: /sys/class/thermal/thermal_zone0:cpu-0 /sys/class/thermal/thermal_zone5:gpuss-0" > "$out"
  while [ ! -f "$DEV/stop_marker" ] && [ "$i" -lt 300 ]; do
    compute "$(read_n)"
    s="$SKIN_VAL"
    [ "$MISS_VAL" = skin ] && s=""
    echo "Z $(date +%s) cpu-thermal=42000" >> "$out"
    echo "S $(date +%s) $s" >> "$out"
    i=$((i + 1))
    sleep 1
  done
  echo "H sampler_done $(date +%s)" >> "$out"
  echo "fake sampler exited iterations=$i"
  exit 0
}
handle_shell() {
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
    # pkill MUST precede the bare llama-completion arm branch: the driver's
    # `pkill -f llama-completion` also contains that name.
    *pkill*) printf '%s\n' "$cmd" >> "$STATE/pkill.log"; exit 0 ;;
    *--list-devices*)
      printf 'Available devices:\n  GPUOpenCL: QUALCOMM Adreno(TM) (3536 MiB, 2512 MiB free)\n  HTP0: Hexagon (0 MiB, 0 MiB free)\n'
      exit 0 ;;
    *llama-completion*) run_arm ;;
    *smp.sh*) run_sampler ;;
    *"tar -xzf"*) : > "$STATE/kit_unpacked"; exit 0 ;;
    *dumpsys\ thermalservice*) dump_thermals; exit 0 ;;
    *dumpsys\ battery*) dump_battery; exit 0 ;;
    *power_supply/battery/temp*) compute "$(read_n)"; echo "$TEMP_VAL"; exit 0 ;;
    *getprop*) echo SM8550; exit 0 ;;
    *"settings get system screen_off_timeout"*) cat "$STATE/screen_timeout" 2>/dev/null || echo 60000; exit 0 ;;
    *"settings put system screen_off_timeout"*) printf '%s\n' "${cmd##* }" > "$STATE/screen_timeout"; exit 0 ;;
    *"settings delete system screen_off_timeout"*) rm -f "$STATE/screen_timeout"; exit 0 ;;
    *"svc power stayon"*) printf '%s\n' "${cmd##* }" > "$STATE/stayon"; exit 0 ;;
    *"input keyevent"*) exit 0 ;;
    *touch*stop*) : > "$DEV/stop_marker"; exit 0 ;;
    *"rm -f"*stop*) rm -f "$DEV/stop_marker"; exit 0 ;;
    *mkdir*) exit 0 ;;
    *) printf '%s\n' "$cmd" >> "$STATE/unknown_shell.log"; exit 0 ;;
  esac
}

# ---- argv ----
if [ "${1:-}" = "-s" ]; then shift 2; fi
verb="${1:-}"
[ $# -gt 0 ] && shift
case "$verb" in
  devices)
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
