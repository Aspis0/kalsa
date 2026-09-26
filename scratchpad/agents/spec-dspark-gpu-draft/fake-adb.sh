#!/usr/bin/env bash
# fake-adb.sh — fake adb for this cell's dry-run. One responsibility:
# impersonate exactly the adb surface d_run.sh uses (devices, wait-for-device,
# shell, push, pull) and answer from a per-fixture state dir, with reading
# injection so dryrun.sh can prove every stop fires. No device, no phone.
#
# Knobs (exported by dryrun.sh):
#   DRY_<X>_AT / DRY_<X>_AFTER  reading X takes AFTER from call # AT onward
#       (AT defaults to 1): X in TEMP(battery temp tenths), THERMAL, LEVEL,
#       PLUGGED
#   DRY_MISS_TEMP=1 [DRY_MISS_TEMP_AT=N]  blank the battery temp reading
#       (fail-closed missing_* stop)
#   DRY_ARM_SLEEP_S   fake llama-speculative-simple wall time (default 0)
#   DRY_ARM_RC        remote exit code of the arm (default 0)
#   DRY_NO_GPU_PROOF=1  emit too few drafter GPU assignment lines
#   DRY_GPU_KERNELS=N   GGML_OPENCL_LOG_KERNELS line count (default 6)
#   DRY_N_PREDICT_OVERRIDE=N  force n_predict (default: limit + overshoot)
# Per-type call counters (batt_n = dumpsys battery calls, therm_n =
# thermalservice calls) keep AT semantics stable across gate/poll interleaving.
set -euo pipefail
STATE="${FAKE_ADB_STATE:-/tmp/dspark-spec-fake}"
DEV="$STATE/dev"
mkdir -p "$DEV"
CELL="$(cd "$(dirname "$0")" && pwd)"
PROMPT_SHA=$(awk '{print $1}' "$CELL/PROMPT.meta")
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
DRAFT_SHA=85a98fafdaf1328b6876fd1360d7ed69e74c6cefc14dd07fb6306e1940386c87
KIT_SHA=bd6be0a4808c35885318647fede6ef91dfa8f3fe4366a4a706f5110ae45447df

count_up() { # <file>
  local f="$STATE/$1"
  if [ -f "$f" ]; then echo $(( $(cat "$f") + 1 )) > "$f"; else echo 1 > "$f"; fi
  cat "$f"
}
pick() { # <at> <after> <base> <n>
  if [ -n "${2:-}" ] && [ "$4" -ge "${1:-1}" ]; then printf '%s' "$2"; else printf '%s' "$3"; fi
}

dump_battery() {
  local n temp lvl plug miss
  n=$(count_up batt_reads)
  temp=$(pick "${DRY_TEMP_AT:-}" "${DRY_TEMP_AFTER:-}" 310 "$n")
  lvl=$(pick "${DRY_LEVEL_AT:-}" "${DRY_LEVEL_AFTER:-}" 88 "$n")
  plug=$(pick "${DRY_PLUGGED_AT:-}" "${DRY_PLUGGED_AFTER:-}" 0 "$n")
  miss=""
  if [ "${DRY_MISS_TEMP:-0}" = 1 ] && [ "$n" -ge "${DRY_MISS_TEMP_AT:-1}" ]; then miss=temp; fi
  if [ "$miss" = temp ]; then temp=""; fi
  local p=false
  if [ "$plug" = 1 ]; then p=true; fi
  cat <<EOF
Current Battery Service state:
  AC powered: $p
  USB powered: false
  Wireless powered: false
  Dock powered: false
  status: 2
  health: 2
  present: true
  level: $lvl
  voltage: 4200
  temperature: $temp
  technology: Li-ion
EOF
}

dump_thermals() {
  local n skin status
  n=$(count_up therm_reads)
  skin=$(pick "${DRY_SKIN_AT:-}" "${DRY_SKIN_AFTER:-}" 33.5 "$n")
  status=$(pick "${DRY_THERMAL_AT:-}" "${DRY_THERMAL_AFTER:-}" 0 "$n")
  cat <<EOF
IsStatusOverride: false
Thermal Status: $status
Thermal Statuses from API:
  mStatus=0
Current temperatures from HAL:
  Temperature{mValue=$skin, mType=3, mName=SKIN, name2=skin}
  Temperature{mValue=45.0, mType=0, mName=cpu-0}
Current cooling devices from HAL:
  Temperature{mValue=10.0, mType=15, mName=fan0}
EOF
}

# run_arm <cmd>: synthesize the pulled llama-speculative-simple log.
# Overshoot model matches the host calibration: n_max 0 -> +1, else n_max+1.
run_arm() {
  local cmd=$1 tag limit nmax n assign_line i k kernels o n_predict drafted accept rc
  tag=$(printf '%s\n' "$cmd" | grep -o 'dspark-spec/[A-Za-z0-9._-]*\.log' | head -1 | sed 's#.*/##; s#\.log$##') || tag=""
  [ -n "$tag" ] || tag=unparsed.log
  limit=$(printf '%s\n' "$cmd" | sed -n 's#.* -n \([0-9][0-9]*\) .*#\1#p')
  nmax=$(printf '%s\n' "$cmd" | sed -n 's#.*--spec-draft-n-max \([0-9][0-9]*\).*#\1#p')
  [ -n "$limit" ] || limit=127
  [ -n "$nmax" ] || nmax=0
  if [ "${DRY_ARM_SLEEP_S:-0}" -gt 0 ]; then sleep "$DRY_ARM_SLEEP_S"; fi
  o=1
  [ "$nmax" -eq 0 ] || o=$((nmax + 1))
  n_predict="${DRY_N_PREDICT_OVERRIDE:-$((limit + o))}"
  case "$nmax" in
    0) drafted=0; accept="nan%" ;;
    4) drafted=$((n_predict * 2)); accept="56.000%" ;;
    *) drafted=$((n_predict * 3)); accept="39.000%" ;;
  esac
  rc="${DRY_ARM_RC:-0}"
  {
    # target model first (before the marker), -ngl 0 -> CPU
    i=0; while [ "$i" -lt 24 ]; do printf 'load_tensors: layer %3d assigned to device CPU, is_swa = 0\n' "$i"; i=$((i + 1)); done
    printf 'common_speculative_init_result: loading draft model %s\n' "'/data/local/tmp/dspark-spec/draft.gguf'"
    printf "llama_prepare_model_devices: using device GPUOpenCL (QUALCOMM Adreno(TM)) (unknown id) - 3536 MiB free\n"
    if printf '%s' "$cmd" | grep -q -- '-devd GPUOpenCL'; then
      # drafter on GPUOpenCL: placement (5 layers) + kernel dispatch
      i=0
      if [ "${DRY_NO_GPU_PROOF:-0}" = 1 ]; then
        while [ "$i" -lt 2 ]; do printf 'load_tensors: layer %3d assigned to device GPUOpenCL, is_swa = 0\n' "$i"; i=$((i + 1)); done
      else
        while [ "$i" -lt 5 ]; do printf 'load_tensors: layer %3d assigned to device GPUOpenCL, is_swa = 0\n' "$i"; i=$((i + 1)); done
      fi
      k=0; kernels="${DRY_GPU_KERNELS:-6}"
      while [ "$k" -lt "$kernels" ]; do printf 'GGML_OPENCL_LOG_KERNELS: kernel_%02d\n' "$k"; k=$((k + 1)); done
    else
      i=0; while [ "$i" -lt 5 ]; do printf 'load_tensors: layer %3d assigned to device CPU, is_swa = 0\n' "$i"; i=$((i + 1)); done
    fi
    printf 'decoded %4d tokens in %8.3f seconds, speed: %8.3f t/s\n' "$n_predict" 8.0 \
      "$(awk -v n="$n_predict" 'BEGIN{printf "%.3f", n / 8.0}')"
    printf 'n_draft   = %s\n' "$nmax"
    printf 'n_predict = %d\n' "$n_predict"
    printf 'n_drafted = %d\n' "$drafted"
    printf 'n_accept  = %d\n' 0
    printf 'accept    = %s\n' "$accept"
    printf 'EXIT=%s\n' "$rc"
  } > "$DEV/$tag.log"
  exit "$rc"
}

handle_shell() {
  local cmd="$*"
  case "$cmd" in
    *pkill*) printf '%s\n' "$cmd" >> "$STATE/pkill.log"; exit 0 ;;
    *"sha256sum -c"*)
      if [ -f "$STATE/kit_unpacked" ]; then
        printf 'bin/llama-completion: OK\nbin/llama-speculative-simple: OK\nlib/libggml-opencl.so: OK\n'
        exit 0
      fi
      echo "sha256sum: SHA256SUMS: No such file or directory" >&2; exit 1 ;;
    *sha256sum*ship.gguf*)
      if [ -f "$STATE/present_ship" ]; then printf '%s  %s\n' "$MODEL_SHA" "/data/local/tmp/dspark-spec/ship.gguf"; exit 0; fi
      echo "sha256sum: No such file or directory" >&2; exit 1 ;;
    *sha256sum*draft.gguf*)
      if [ -f "$STATE/present_draft" ]; then printf '%s  %s\n' "$DRAFT_SHA" "/data/local/tmp/dspark-spec/draft.gguf"; exit 0; fi
      echo "sha256sum: No such file or directory" >&2; exit 1 ;;
    *sha256sum*prompt.txt*)
      if [ -f "$STATE/present_prompt" ]; then printf '%s  %s\n' "$PROMPT_SHA" "/data/local/tmp/dspark-spec/prompt.txt"; exit 0; fi
      echo "sha256sum: No such file or directory" >&2; exit 1 ;;
    *sha256sum*kit.tgz*)
      if [ -f "$STATE/present_kit" ]; then printf '%s  %s\n' "$KIT_SHA" "/data/local/tmp/dspark-spec/kit.tgz"; exit 0; fi
      echo "sha256sum: No such file or directory" >&2; exit 1 ;;
    *"tar -xzf"*)
      if [ -f "$STATE/present_kit" ]; then : > "$STATE/kit_unpacked"; exit 0; fi
      echo "tar: kit.tgz: No such file" >&2; exit 1 ;;
    *llama-speculative-simple*) run_arm "$cmd" ;;
    *"dumpsys thermalservice"*) dump_thermals; exit 0 ;;
    *"dumpsys battery"*) dump_battery; exit 0 ;;
    *"getprop ro.soc.model"*) echo SM8550; exit 0 ;;
    *"settings get system screen_off_timeout"*) cat "$STATE/screen_timeout" 2>/dev/null || echo null; exit 0 ;;
    *"settings get global stay_on_while_plugged_in"*) cat "$STATE/stayon" 2>/dev/null || echo null; exit 0 ;;
    *"settings put system screen_off_timeout"*) printf '%s\n' "${cmd##* }" > "$STATE/screen_timeout"; exit 0 ;;
    *"settings put global stay_on_while_plugged_in"*) printf '%s\n' "${cmd##* }" > "$STATE/stayon"; exit 0 ;;
    *"settings delete system screen_off_timeout"*) rm -f "$STATE/screen_timeout"; exit 0 ;;
    *"settings delete global stay_on_while_plugged_in"*) rm -f "$STATE/stayon"; exit 0 ;;
    *"svc power stayon"*) printf '3\n' > "$STATE/stayon"; exit 0 ;;
    *"input keyevent"*) exit 0 ;;
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
  wait-for-device) exit 0 ;;
  push)
    case "$(basename "${2:-}")" in
      kit.tgz) : > "$STATE/present_kit" ;;
      ship.gguf) : > "$STATE/present_ship" ;;
      draft.gguf) : > "$STATE/present_draft" ;;
      prompt.txt) : > "$STATE/present_prompt" ;;
    esac
    printf 'pushed %s\n' "$(basename "${2:-}")" >> "$STATE/push.log"
    exit 0 ;;
  pull)
    if [ -f "$DEV/$(basename "${1:-}")" ]; then
      cp "$DEV/$(basename "${1:-}")" "${2:-/dev/null}"; exit 0
    fi
    echo "fake-adb: cannot stat '$1'" >&2; exit 1 ;;
  shell) handle_shell "$*" ;;
  *) echo "fake-adb: unhandled verb: $verb" >&2; exit 1 ;;
esac
