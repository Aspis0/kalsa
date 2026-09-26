#!/bin/sh
# Device driver for npu-spec-verify Step 0. Invoked once ADB is up.
# Usage: d_run.sh s23 <adb-server-port> <job-id>
# Timing is refused unless the phone is unplugged, cool, and below thermal status 3.
set -eu
BOARD=${1:?board-tag}
PORT=${2:?adb-server-port}
JOB=${3:?job-id}
CELL="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/npu-spec-verify"
RAW="$CELL/raw/${BOARD}"
D=/data/local/tmp/npu-step0
KIT_TGZ="$HOME/kalsa-qdc/npu-step0-v73/npu-kit-f25f0c1c5.tgz"
MODEL="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-newapk/raw/host-materials/LFM2.5-2.6B-QAD-Q4_0.gguf"
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
SERIAL=${ADB_SERIAL:-adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp}
export ANDROID_ADB_SERVER_PORT=$PORT
mkdir -p "$RAW"

adb_s() {
  adb -s "$SERIAL" "$@"
}

run_logged() {
  log=$1
  shift
  set +e
  "$@" > "$log" 2>&1
  rc=$?
  echo "EXIT=$rc" >> "$log"
  set -e
  return "$rc"
}

gate() {
  tag=$1
  battery="$RAW/gate_${tag}_battery.txt"
  thermal="$RAW/gate_${tag}_thermal.txt"
  traced="$RAW/gate_${tag}_traced.txt"
  run_logged "$battery" adb_s shell dumpsys battery || { echo "GATE_READ_FAILED battery"; exit 10; }
  run_logged "$thermal" adb_s shell dumpsys thermalservice || { echo "GATE_READ_FAILED thermal"; exit 10; }
  run_logged "$traced" adb_s shell getprop persist.traced.enable || { echo "GATE_READ_FAILED traced"; exit 10; }
  if grep -Eq '^[[:space:]]*(AC|USB|Wireless) powered: true[[:space:]]*$' "$battery"; then
    echo "CHARGING_REFUSED"
    exit 11
  fi
  battery_temp=$(awk '/^[[:space:]]*temperature:/ { print $2; exit }' "$battery")
  thermal_status=$(awk -F: '/Thermal Status:/ { gsub(/[[:space:]]/, "", $2); print $2; exit }' "$thermal")
  if [ -z "$battery_temp" ] || [ -z "$thermal_status" ]; then
    echo "GATE_READ_FAILED missing thermal status or battery temperature"
    exit 10
  fi
  if [ "$thermal_status" -ge 3 ]; then
    echo "THERMAL_STATUS_REFUSED status=$thermal_status"
    exit 12
  fi
  if [ "$battery_temp" -ge 440 ]; then
    echo "BATTERY_TEMP_REFUSED tenths_c=$battery_temp"
    exit 13
  fi
  if [ "$(tr -d '\r\n' < "$traced")" != 0 ]; then
    echo "TRACED_REFUSED value=$(tr -d '\r\n' < "$traced")"
    exit 14
  fi
}

echo "BOARD=$BOARD PORT=$PORT JOB=$JOB SERIAL=$SERIAL" | tee "$RAW/session.env"
echo "START_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$RAW/session.env"
gate before_setup
run_logged "$RAW/screen_awake.txt" adb_s shell "svc power stayon true; input keyevent KEYCODE_WAKEUP"
run_logged "$RAW/mkdir_device.txt" adb_s shell "mkdir -p $D"
run_logged "$RAW/push_kit.txt" adb_s push "$KIT_TGZ" "$D/kit.tgz"
run_logged "$RAW/push_model.txt" adb_s push "$MODEL" "$D/ship.gguf"
run_logged "$RAW/unpack_kit.txt" adb_s shell "cd $D && tar -xzf kit.tgz && rm kit.tgz"
run_logged "$RAW/kitsums_check.txt" adb_s shell "cd $D && sha256sum -c SHA256SUMS"
run_logged "$RAW/ondevice_sha.txt" adb_s shell "sha256sum $D/ship.gguf"
grep -q "$MODEL_SHA" "$RAW/ondevice_sha.txt" || { echo "MODEL_SHA_MISMATCH" | tee "$RAW/VOID.txt"; exit 8; }

therm() {
  tag=$1
  run_logged "$RAW/therm_${tag}.txt" adb_s shell "dumpsys thermalservice; dumpsys battery"
  echo "THERM_${tag}_UTC=$(date -u +%H:%M:%SZ)" >> "$RAW/therm_${tag}.txt"
}

run_arm() {
  arm=$1
  shift
  therm "pre_${arm}"
  gate "pre_${arm}"
  run_logged "$RAW/${arm}_shell.txt" adb_s shell "cd $D && \
    export LD_LIBRARY_PATH=$D/lib && \
    export ADSP_LIBRARY_PATH=$D/lib && \
    export GGML_HEXAGON_NDEV=1 && \
    export GGML_HEXAGON_VERBOSE=1 && \
    $* > $D/${arm}.log 2>&1; echo EXIT=\$? >> $D/${arm}.log"
  echo "ADB_SHELL_EXIT=$?" > "$RAW/${arm}.adbstatus"
  run_logged "$RAW/${arm}_pull.txt" adb_s pull "$D/${arm}.log" "$RAW/${arm}.log" || echo "PULL_FAIL" >> "$RAW/${arm}.adbstatus"
  therm "post_${arm}"
  gate "post_${arm}"
}

COMMON="./bin/llama-bench -m $D/ship.gguf -lm none --fit off --poll 1000 -t 8 -ub 1024 -fa 1 -p 1,2,4,8,16 -n 0 -d 1920 -r 5 -v"
run_arm A "$COMMON -ngl 0"
run_arm B "$COMMON --device HTP0 -ngl 99 -nkvo"
run_arm C "$COMMON --device HTP0 -ngl 99"

echo "END_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$RAW/session.env"
echo "DONE"
