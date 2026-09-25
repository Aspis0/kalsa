#!/bin/sh
# Device driver for npu-spec-verify Step 0. Invoked once adb is up on the given port.
# Ports: 6038 = QRD8750 lane, 6040 = QRD8635 lane. Never LD_LIBRARY_PATH=/vendor/lib64.
set -eu
BOARD=${1:?board-tag}
PORT=${2:?adb-port}
JOB=${3:?job-id}
CELL="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/npu-spec-verify"
RAW="$CELL/raw/${BOARD}"
D=/data/local/tmp/kalsa-npu-spec-verify
KIT_TGZ="$HOME/kalsa-qdc/npu-v79-cell/npu-kit-556118a08.tgz"
MODEL="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-newapk/raw/host-materials/LFM2.5-2.6B-QAD-Q4_0.gguf"
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
export ANDROID_ADB_SERVER_PORT=$PORT
mkdir -p "$RAW"
echo "BOARD=$BOARD PORT=$PORT JOB=$JOB" | tee "$RAW/session.env"
echo "START_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$RAW/session.env"
adb shell "getprop ro.product.model ro.board.platform ro.serialno; getprop ro.build.version.release" > "$RAW/device.txt" 2>&1 || true

adb shell "mkdir -p $D"
adb push "$KIT_TGZ" "$D/kit.tgz" > "$RAW/push_kit.txt" 2>&1
adb push "$MODEL" "$D/ship.gguf" > "$RAW/push_model.txt" 2>&1
adb shell "cd $D && tar -xzf kit.tgz && rm kit.tgz"
adb shell "sha256sum $D/ship.gguf" > "$RAW/ondevice_sha.txt" 2>&1 || true
grep -q "$MODEL_SHA" "$RAW/ondevice_sha.txt" || { echo "MODEL_SHA_MISMATCH" | tee "$RAW/VOID.txt"; exit 8; }

# skin-temp proxy used by prior QDC cells: thermalservice HAL max (tenths C) + battery
therm() {
  tag=$1
  adb shell "dumpsys thermalservice | grep -m1 MAX_temperature; dumpsys battery | grep -E 'temperature|level'" > "$RAW/therm_${tag}.txt" 2>&1 || true
  echo "THERM_${tag}_UTC=$(date -u +%H:%M:%SZ)" >> "$RAW/therm_${tag}.txt"
}

run_arm() {
  arm=$1
  cap=$2
  shift 2
  therm "pre_${arm}"
  set +e
  perl -e 'alarm shift; exec @ARGV' "$cap" adb shell "cd $D && \
    export LD_LIBRARY_PATH=$D/lib && \
    export ADSP_LIBRARY_PATH=$D/lib && \
    export GGML_HEXAGON_NDEV=1 && \
    export GGML_HEXAGON_VERBOSE=1 && \
    $* > $D/${arm}.log 2>&1; echo EXIT=\$? >> $D/${arm}.log"
  echo "ADB_SHELL_EXIT=$?" > "$RAW/${arm}.adbstatus"
  set -e
  adb pull "$D/${arm}.log" "$RAW/${arm}.log" || echo "PULL_FAIL" >> "$RAW/${arm}.adbstatus"
  therm "post_${arm}"
}

COMMON="./bin/llama-bench -m $D/ship.gguf --mmap 0 --poll 1000 -t 8 -ub 1024 -fa 1 -p 1,2,4,8,16 -n 0 -d 1920 -r 5 -v"

run_arm A 900 "$COMMON -ngl 0"
run_arm B 900 "$COMMON --device HTP0 -ngl 99 -nkvo 1"
run_arm C 900 "$COMMON --device HTP0 -ngl 99"

echo "END_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$RAW/session.env"
echo "DONE"
