#!/bin/sh
# Device driver for npu-decode-kv. Invoked by connect.sh once adb is up.
# Write clean code. Real exit codes only. Never LD_LIBRARY_PATH=/vendor/lib64.
set -eu
JOB=${1:?job}
CELL="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/npu-decode-kv"
RAW="$CELL/raw"
D=/data/local/tmp/kalsa-npu-decode-kv
KIT_TGZ="$HOME/kalsa-qdc/npu-v79-cell/npu-kit-153fdbafd.tgz"
MODEL="$HOME/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf"
KIT_SHA=e7ff4cd8b18ac1b554d8660e315432926a1440ff9c7bb991de9ecf3191623350
MODEL_SHA=a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03
export ANDROID_ADB_SERVER_PORT=6037
mkdir -p "$RAW"
echo "JOB=$JOB" | tee "$RAW/session.env"
echo "START_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$RAW/session.env"

adb shell "mkdir -p $D"
adb push "$KIT_TGZ" "$D/kit.tgz"
adb push "$MODEL" "$D/ship.gguf"
adb shell "cd $D && tar -xzf kit.tgz && rm kit.tgz"
adb shell "cd $D && sha256sum kit.tgz 2>/dev/null || true"
# tarball already unpacked; hash the on-device model and a skel
adb shell "sha256sum $D/ship.gguf $D/lib/libggml-htp-v75.so" > "$RAW/ondevice_sha.txt" 2>&1
echo "ONDEVICE_SHA_EXIT=$?" >> "$RAW/ondevice_sha.txt"
grep -q "$MODEL_SHA" "$RAW/ondevice_sha.txt" || {
  echo "MODEL_SHA_MISMATCH" | tee "$RAW/VOID.txt"
  exit 8
}
test -f "$RAW/ondevice_sha.txt"

# thermal snapshot helper
therm() {
  tag=$1
  adb shell dumpsys thermalservice > "$RAW/therm_${tag}.txt" 2>&1
  echo "THERM_${tag}_EXIT=$?" >> "$RAW/therm_${tag}.txt"
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

# P0 — mapping ceiling. Cap via timeout on device is not portable; host alarm 180s.
run_arm P0 180 "GGML_HEXAGON_VMEM=0 ./bin/llama-bench -m $D/ship.gguf --device HTP0 -ngl 99 --mmap 0 -p 0 -n 1 -r 1 --no-warmup -v"

COMMON="./bin/llama-bench -m $D/ship.gguf --mmap 0 --poll 1000 -t 8 -ub 1024 -fa 1 -p 0 -n 128 -d 1920 -r 3 -v"

run_arm A 600 "$COMMON -ngl 0"
run_arm B 600 "$COMMON --device HTP0 -ngl 99 -nkvo 1"
run_arm C 600 "$COMMON --device HTP0 -ngl 99"

echo "END_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$RAW/session.env"
echo "DONE"
