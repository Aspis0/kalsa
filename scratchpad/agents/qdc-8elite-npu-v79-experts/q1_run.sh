#!/bin/sh
# Q1 only. Call AFTER adb sees the QDC device on port 6037.
# Stop on first crash. Do not retry. No Q2/Q3 here.
set -eu
export ANDROID_ADB_SERVER_PORT=6037
RAW="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-npu-v79-experts/raw"
KIT_TGZ="$HOME/kalsa-qdc/npu-v79-cell/npu-kit-556118a08.tgz"
GGUF="/Users/marco/kalsa-models/OLMoE-1B-7B-0924-Instruct-Q4_0-requant-from-q4km.gguf"
GATE="$HOME/kalsa-qdc/kexp-speed-cell/thermal_gate.sh"
DEVDIR=/data/local/tmp/kalsa-npu
HOST_SHA="9d0b90c60a5b4732ba1faeb0b8940523173bf7e2a7f038d5753ce3ac24b98618"
mkdir -p "$RAW"

SER=$(adb devices | awk '/\tdevice$/{print $1; exit}')
if [ -z "$SER" ]; then
  echo "NO_DEVICE" | tee "$RAW/fail.txt"
  exit 2
fi
echo "serial=$SER" | tee "$RAW/serial.txt"

adb -s "$SER" shell "mkdir -p $DEVDIR"
adb -s "$SER" push "$KIT_TGZ" "$DEVDIR/kit.tgz"
adb -s "$SER" shell "cd $DEVDIR && tar -xzf kit.tgz && chmod -R 755 bin lib"
adb -s "$SER" push "$GGUF" "$DEVDIR/olmoe-q40.gguf"

DEV_SHA=$(adb -s "$SER" shell "sha256sum $DEVDIR/olmoe-q40.gguf" | awk '{print $1}')
echo "host=$HOST_SHA" | tee "$RAW/model_sha_device.txt"
echo "device=$DEV_SHA" | tee -a "$RAW/model_sha_device.txt"
if [ "$DEV_SHA" != "$HOST_SHA" ]; then
  echo "METHOD-VOID sha mismatch" | tee "$RAW/fail.txt"
  exit 3
fi

adb -s "$SER" shell "cd $DEVDIR && ./bin/llama-bench --list-devices" \
  > "$RAW/list_devices.txt" 2>&1 || true

"$GATE" "$SER" "$RAW/therm_pre_Q1.txt" > "$RAW/gate_pre.txt" || {
  echo "GATE_FAIL" | tee "$RAW/fail.txt"
  exit 7
}

# Q1: one invocation, VERBOSE required for execute-op line. -n 0 = prefill only.
adb -s "$SER" shell "cd $DEVDIR && \
  export LD_LIBRARY_PATH=\$PWD/lib ADSP_LIBRARY_PATH=\$PWD/lib GGML_HEXAGON_VERBOSE=1 && \
  ./bin/llama-bench --device HTP0 -ngl 99 -v -p 512 -n 0 -r 1 --no-warmup \
    -m olmoe-q40.gguf -o jsonl -oe jsonl; echo EXIT=\$?" \
  > "$RAW/q1_bench.txt" 2>&1
echo $? > "$RAW/q1_adb.exit"

"$GATE" "$SER" "$RAW/therm_post_Q1.txt" > "$RAW/gate_post.txt" || true
grep -E "HTP0 execute-op MUL_MAT_ID|EXIT=|pp512|error|dspqueue|qurt_exit" "$RAW/q1_bench.txt" \
  | tee "$RAW/q1_grep.txt" | tail -20
exit 0
