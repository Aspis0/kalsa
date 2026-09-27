#!/usr/bin/env bash
# fake-adb.sh — fake adb for this cell's dry-run. One responsibility:
# impersonate exactly the adb surface d_run.sh + restore.sh use (devices,
# get-state, wait-for-device, shell, push, pull) and answer from a per-fixture
# state dir, with reading injection so dryrun.sh can prove every stop, kill and
# restore. No device, no phone, no adb binary.
#
# Format fidelity (audit B-11): every LOGGER line is prefixed
# `<h>.<mm>.<ss>.<ms> <L> ` byte-shape taken from the committed S23 log
# qdc-heat-3way/raw/s23-cli-heat-20260926/s23-cli-heat-20260926-t1cpu.log
# (`1.17.377.180 I common_perf_print: ...`) and from a host -lv 5 run
# (`0.00.223.310 D load_tensors: ...`). `GGML_OPENCL_LOG_KERNELS:` (fprintf)
# and the shell-appended `EXIT=` line are deliberately UNPREFIXED, as on the
# real device. Placement lines are emitted ONLY for `-lv 5` commands (proof
# runs): a measured turn gets no debug lines, exactly like the device.
#
# Knobs (exported by dryrun.sh):
#   DRY_<X>_AT / DRY_<X>_AFTER  reading X takes AFTER from call # AT onward
#       (AT defaults to 1): X in TEMP, THERMAL, LEVEL, PLUGGED, SKIN
#   DRY_MISS_TEMP=1 [DRY_MISS_TEMP_AT=N]  blank the battery temp (fail-closed)
#   DRY_SYSFS_TEMP=N            /sys battery temp (default 310 = dumpsys)
#   DRY_ARM_SLEEP_S             fake llama wall time per run (default 0)
#   DRY_ARM_RC                  remote exit code of the run (default 0)
#   DRY_PUSH_SLEEP_S            sleep per push (default 0)
#   DRY_NO_GPU_PROOF=1          too few drafter GPU placement lines
#   DRY_GPU_KERNELS=N           GGML_OPENCL_LOG_KERNELS count (default 6)
#   DRY_JITTER=1                overshoot on adjustment attempts = nmax
#                               (content-dependent, exercises MATCH_MAX)
#   DRY_NEVER_MATCH_ARM=<arm>   that arm always reports DRY_NEVER_MATCH_N
#   DRY_NEVER_MATCH_N=N         (default 132) -> non-converging match
#   DRY_KILL_FAIL=1             pkill does NOT kill: KILL_VERIFY must fail
#   DRY_PGREP_BROKEN=1          pgrep self-test fails -> setup aborts (exit 4)
#   DRY_PGREP_BREAK_AT=N        pgrep works for call #1 (self-test) then breaks
#   DRY_RESTORE_PUT_FAIL=1      the restore-time settings write fails (NEW-1)
set -euo pipefail
STATE="${FAKE_ADB_STATE:-/tmp/dspark-spec-fake}"
DEV="$STATE/dev"
mkdir -p "$DEV"
CELL="$(cd "$(dirname "$0")" && pwd)"
PROMPT_SHA=$(awk '{print $1}' "$CELL/PROMPT.meta")
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
DRAFT_SHA=85a98fafdaf1328b6876fd1360d7ed69e74c6cefc14dd07fb6306e1940386c87
KIT_SHA=bd6be0a4808c35885318647fede6ef91dfa8f3fe4366a4a706f5110ae45447df

n_lines() { if [ -f "$STATE/log_lines" ]; then cat "$STATE/log_lines"; else echo 0; fi; }
pfx() {   # <level> -> "<h>.<mm>.<ss>.<ms> <L> "
  local n
  n=$(( $(n_lines) + 1 ))
  echo "$n" > "$STATE/log_lines"
  printf '0.00.%03d.%03d %s ' $((n / 1000)) $((n % 1000)) "$1"
}
lg() { pfx "$1"; shift; printf '%s\n' "$*"; }

count_up() { local f="$STATE/$1"
  if [ -f "$f" ]; then echo $(( $(cat "$f") + 1 )) > "$f"; else echo 1 > "$f"; fi
  cat "$f"
}
pick() { if [ -n "${2:-}" ] && [ "$4" -ge "${1:-1}" ]; then printf '%s' "$2"; else printf '%s' "$3"; fi; }

# pgrep_is_broken: shared counter over every pgrep-ish call (self-test,
# health probe, verdict). DRY_PGREP_BROKEN=1 breaks them all (the self-test
# must then abort the session); DRY_PGREP_BREAK_AT=N breaks call #N onwards
# (self-test passes, a later verdict fails closed).
pgrep_is_broken() {
  local n
  n=$(count_up pgrep_calls)
  if [ "${DRY_PGREP_BROKEN:-0}" = 1 ]; then return 0; fi
  if [ -n "${DRY_PGREP_BREAK_AT:-}" ] && [ "$n" -ge "$DRY_PGREP_BREAK_AT" ]; then return 0; fi
  return 1
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
# Overshoot model: A -> +1; spec arms -> nmax+1, EXCEPT adjustment attempts
# under DRY_JITTER (= nmax) and DRY_NEVER_MATCH_ARM (fixed N, non-converging).
run_arm() {
  local cmd=$1 tag limit nmax n i k kernels o n_predict drafted accept rc gpu=0
  tag=$(printf '%s\n' "$cmd" | grep -o 'dspark-spec/[A-Za-z0-9._-]*\.log' | head -1 | sed 's#.*/##; s#\.log$##') || tag=""
  [ -n "$tag" ] || tag=unparsed.log
  limit=$(printf '%s\n' "$cmd" | sed -n 's#.* -n \([0-9][0-9]*\) .*#\1#p')
  nmax=$(printf '%s\n' "$cmd" | sed -n 's#.*--spec-draft-n-max \([0-9][0-9]*\).*#\1#p')
  [ -n "$limit" ] || limit=127
  [ -n "$nmax" ] || nmax=0
  if printf '%s' "$cmd" | grep -q -- '-devd GPUOpenCL'; then gpu=1; fi
  : > "$STATE/proc_running"      # the remote process exists while we sleep
  local slp="${DRY_ARM_SLEEP_S:-0}"
  case "$tag" in *-p) slp="${DRY_PROOF_SLEEP_S:-0}" ;; esac
  if [ "$slp" -gt 0 ]; then sleep "$slp"; fi
  o=1
  if [ "$nmax" -gt 0 ]; then o=$((nmax + 1)); fi
  if [ "${DRY_JITTER:-0}" = 1 ] && [ "$nmax" -gt 0 ]; then
    case "$tag" in *-m[0-9]*) o=$nmax ;; esac
  fi
  n_predict=$((limit + o))
  if [ -n "${DRY_NEVER_MATCH_ARM:-}" ]; then
    case "$tag" in "${DRY_NEVER_MATCH_ARM}"*) n_predict="${DRY_NEVER_MATCH_N:-132}" ;; esac
  fi
  case "$nmax" in
    0) drafted=0; accept="nan%" ;;
    4) drafted=$((n_predict * 2)); accept="56.000%" ;;
    *) drafted=$((n_predict * 3)); accept="39.000%" ;;
  esac
  rc="${DRY_ARM_RC:-0}"
  {
    lg I "load_tensors: loading model tensors, this can take a while... (load_mode = none)"
    if printf '%s' "$cmd" | grep -q -- '-lv 5'; then
      i=0; while [ "$i" -lt 24 ]; do printf '0.00.%03d.%03d D load_tensors: layer %3d assigned to device CPU, is_swa = 0\n' "$((50 + i))" "$i" "$i"; i=$((i + 1)); done
    fi
    lg I "common_speculative_init_result: loading draft model '/data/local/tmp/dspark-spec/draft.gguf'"
    if [ "$gpu" = 1 ]; then
      lg I "llama_prepare_model_devices: using device GPUOpenCL (QUALCOMM Adreno(TM)) (unknown id) - 3536 MiB free"
    fi
    if printf '%s' "$cmd" | grep -q -- '-lv 5'; then
      if [ "$gpu" = 1 ]; then
        i=0
        if [ "${DRY_NO_GPU_PROOF:-0}" = 1 ]; then
          while [ "$i" -lt 2 ]; do printf '0.00.%03d.%03d D load_tensors: layer %3d assigned to device GPUOpenCL, is_swa = 0\n' "$((200 + i))" "$i" "$i"; i=$((i + 1)); done
        else
          while [ "$i" -lt 5 ]; do printf '0.00.%03d.%03d D load_tensors: layer %3d assigned to device GPUOpenCL, is_swa = 0\n' "$((200 + i))" "$i" "$i"; i=$((i + 1)); done
        fi
        k=0; kernels="${DRY_GPU_KERNELS:-6}"
        while [ "$k" -lt "$kernels" ]; do printf 'GGML_OPENCL_LOG_KERNELS: kernel_%02d\n' "$k"; k=$((k + 1)); done
      else
        i=0; while [ "$i" -lt 5 ]; do printf '0.00.%03d.%03d D load_tensors: layer %3d assigned to device CPU, is_swa = 0\n' "$((300 + i))" "$i" "$i"; i=$((i + 1)); done
      fi
    fi
    printf '0.00.900.001 I decoded %4d tokens in %8.3f seconds, speed: %8.3f t/s\n' "$n_predict" 8.0 \
      "$(awk -v n="$n_predict" 'BEGIN{printf "%.3f", n / 8.0}')"
    lg I "n_draft   = $nmax"
    lg I "n_predict = $n_predict"
    lg I "n_drafted = $drafted"
    lg I "n_accept  = 0"
    lg I "accept    = $accept"
    printf 'EXIT=%s\n' "$rc"
  } > "$DEV/$tag.log"
  rm -f "$STATE/proc_running"
  exit "$rc"
}

handle_shell() {
  local cmd="$*"
  case "$cmd" in
    # pgrep self-test (d_run setup): FOUND + GONE, unless the fixture breaks
    # pgrep from this very call onwards (counter shared with the verdict path).
    *PGREP_SELFTEST*)
      if pgrep_is_broken; then
        echo PGREP_SELFTEST=MISS
        echo PGREP_SELFCLEAN=STILL
      else
        echo PGREP_SELFTEST=FOUND
        echo PGREP_SELFCLEAN=GONE
      fi
      exit 0 ;;
    # audit2 NEW-5 health probe: only PROBE=1 licenses a GONE verdict.
    *zzz_no_such_proc_zzz*)
      if pgrep_is_broken; then echo PROBE_BROKEN; else echo PROBE=1; fi
      exit 0 ;;
    *pgrep*)
      if pgrep_is_broken; then echo PGREP_BROKEN; exit 0; fi
      if [ -f "$STATE/proc_running" ]; then echo ALIVE; else echo GONE; fi
      exit 0 ;;
    *pkill*)
      printf '%s\n' "$cmd" >> "$STATE/pkill.log"
      case "$cmd" in
        *"llama-speculative-simpl[e]"*)
          # audit B-1: the fake models a real kill unless DRY_KILL_FAIL=1
          if [ "${DRY_KILL_FAIL:-0}" != 1 ]; then rm -f "$STATE/proc_running"; fi ;;
      esac
      exit 0 ;;
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
    *power_supply/battery/temp*) echo "${DRY_SYSFS_TEMP:-310}"; exit 0 ;;
    *"getprop ro.soc.model"*) echo SM8550; exit 0 ;;
    *"settings get system screen_off_timeout"*) cat "$STATE/screen_timeout" 2>/dev/null || echo null; exit 0 ;;
    *"settings get global stay_on_while_plugged_in"*) cat "$STATE/stayon" 2>/dev/null || echo null; exit 0 ;;
    *"settings put system screen_off_timeout"*)
      v="${cmd##* }"
      # DRY_RESTORE_PUT_FAIL=1 fails the RESTORE write only (never the setup
      # mutation): audit2 NEW-1 fixture — a failed restore must keep the state.
      if [ "${DRY_RESTORE_PUT_FAIL:-0}" = 1 ] && [ "$v" != "1800000" ]; then
        echo "Error: settings put failed" >&2
        exit 1
      fi
      printf '%s\n' "$v" > "$STATE/screen_timeout"; exit 0 ;;
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
  get-state) echo device; exit 0 ;;
  wait-for-device) exit 0 ;;
  push)
    if [ "${DRY_PUSH_SLEEP_S:-0}" -gt 0 ]; then sleep "$DRY_PUSH_SLEEP_S"; fi
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
