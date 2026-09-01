#!/bin/sh
# Cell #45. Call AFTER adb sees the QDC device on port 6037.
# DROP ORDER: kit → ops → OLMoE Q3 → Qwen. Stop at 16 min elapsed.
# One crash ends the NPU arm. Do not retry.
set -eu
export ANDROID_ADB_SERVER_PORT=6037
DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-npu-v79-d-rest"
RAW="$DIR/raw"
KIT_TGZ="$HOME/kalsa-qdc/npu-v79-cell/npu-kit-556118a08.tgz"
OLMOE="/Users/marco/kalsa-models/OLMoE-1B-7B-0924-Instruct-Q4_0-requant-from-q4km.gguf"
OLMOE_SHA="9d0b90c60a5b4732ba1faeb0b8940523173bf7e2a7f038d5753ce3ac24b98618"
QWEN="/Users/marco/kalsa-models/Qwen3.5-4B-Q4_0-requant-from-q4km.gguf"
GATE="$HOME/kalsa-qdc/kexp-speed-cell/thermal_gate.sh"
DEVDIR=/data/local/tmp/kalsa-npu
T0=$(date +%s)
mkdir -p "$RAW"

elapsed() { echo $(($(date +%s) - T0)); }
over() { [ "$(elapsed)" -ge 960 ]; }

SER=$(adb devices | awk '/\tdevice$/{print $1; exit}')
if [ -z "$SER" ]; then echo NO_DEVICE | tee "$RAW/fail.txt"; exit 2; fi
echo "serial=$SER t0=$T0" | tee "$RAW/serial.txt"

adb -s "$SER" shell "mkdir -p $DEVDIR"
adb -s "$SER" push "$KIT_TGZ" "$DEVDIR/kit.tgz"
adb -s "$SER" shell "cd $DEVDIR && tar -xzf kit.tgz && chmod -R 755 bin lib"

HTP_ENV="export LD_LIBRARY_PATH=\$PWD/lib ADSP_LIBRARY_PATH=\$PWD/lib"
adb -s "$SER" shell "cd $DEVDIR && $HTP_ENV && ./bin/llama-bench --list-devices" \
  > "$RAW/list_devices.txt" 2>&1 || true
BDEV=HTP0
if grep -q 'HTP0' "$RAW/list_devices.txt"; then BDEV=HTP0; fi

run_gate() {
  tag=$1
  "$GATE" "$SER" "$RAW/therm_pre_$tag.txt" > "$RAW/gate_pre_$tag.txt" || {
    echo "GATE_FAIL $tag elapsed=$(elapsed)" | tee "$RAW/fail.txt"
    return 1
  }
}

# --- Q_ops ---
if over; then echo SKIP_OPS elapsed=$(elapsed) | tee "$RAW/skip.txt"; else
  run_gate ops_mm || exit 7
  adb -s "$SER" shell "cd $DEVDIR && $HTP_ENV && \
    ./bin/test-backend-ops -b $BDEV -o MUL_MAT; echo EXIT=\$?" \
    > "$RAW/ops_MUL_MAT.txt" 2>&1 || true
  echo $? > "$RAW/ops_MUL_MAT.adb.exit"
  "$GATE" "$SER" "$RAW/therm_post_ops_mm.txt" > "$RAW/gate_post_ops_mm.txt" || true
  sh "$DIR/score_judge.sh" "$RAW/ops_MUL_MAT.txt"
  if grep -Eiq 'qurt_exit|dspqueue' "$RAW/ops_MUL_MAT.txt"; then
    echo CRASH_OPS_MM | tee "$RAW/fail.txt"; exit 8
  fi
  if over; then echo SKIP_OPS_ID elapsed=$(elapsed) | tee -a "$RAW/skip.txt"
  else
    run_gate ops_id || exit 7
    adb -s "$SER" shell "cd $DEVDIR && $HTP_ENV && \
      ./bin/test-backend-ops -b $BDEV -o MUL_MAT_ID; echo EXIT=\$?" \
      > "$RAW/ops_MUL_MAT_ID.txt" 2>&1 || true
    echo $? > "$RAW/ops_MUL_MAT_ID.adb.exit"
    "$GATE" "$SER" "$RAW/therm_post_ops_id.txt" > "$RAW/gate_post_ops_id.txt" || true
    sh "$DIR/score_judge.sh" "$RAW/ops_MUL_MAT_ID.txt"
    if grep -Eiq 'qurt_exit|dspqueue' "$RAW/ops_MUL_MAT_ID.txt"; then
      echo CRASH_OPS_ID | tee "$RAW/fail.txt"; exit 8
    fi
  fi
fi

# --- Q3 OLMoE ---
if over; then echo SKIP_Q3 elapsed=$(elapsed) | tee -a "$RAW/skip.txt"
else
  adb -s "$SER" push "$OLMOE" "$DEVDIR/olmoe-q40.gguf"
  DEV_SHA=$(adb -s "$SER" shell "sha256sum $DEVDIR/olmoe-q40.gguf" | awk '{print $1}')
  echo "host=$OLMOE_SHA" | tee "$RAW/olmoe_sha.txt"
  echo "device=$DEV_SHA" | tee -a "$RAW/olmoe_sha.txt"
  if [ "$DEV_SHA" != "$OLMOE_SHA" ]; then
    echo METHOD-VOID_OLMOE | tee "$RAW/fail.txt"
  else
    run_gate q3 || exit 7
    adb -s "$SER" shell "cd $DEVDIR && $HTP_ENV && \
      ./bin/llama-bench --device $BDEV -ngl 99 -p 512 -n 0 -r 3 --no-warmup \
        -m olmoe-q40.gguf -o jsonl -oe jsonl; echo EXIT=\$?" \
      > "$RAW/q3_npu.txt" 2>&1 || true
    echo $? > "$RAW/q3_npu.adb.exit"
    "$GATE" "$SER" "$RAW/therm_post_q3.txt" > "$RAW/gate_post_q3.txt" || true
    if grep -Eiq 'qurt_exit|dspqueue' "$RAW/q3_npu.txt"; then
      echo CRASH_Q3 | tee "$RAW/fail.txt"; exit 8
    fi
    if [ "$(elapsed)" -lt 600 ]; then
      run_gate q3c || true
      adb -s "$SER" shell "cd $DEVDIR && $HTP_ENV && \
        ./bin/llama-bench -ngl 0 -p 512 -n 0 -r 3 --no-warmup \
          -m olmoe-q40.gguf -o jsonl -oe jsonl; echo EXIT=\$?" \
        > "$RAW/q3_cpu.txt" 2>&1 || true
    else
      echo SKIP_Q3_CPU elapsed=$(elapsed) | tee -a "$RAW/skip.txt"
    fi
  fi
fi

# --- Q_qwen ---
if [ ! -f "$QWEN" ]; then
  echo VOID_QWEN_MISSING | tee "$RAW/qwen_void.txt"
elif over; then echo SKIP_QWEN elapsed=$(elapsed) | tee -a "$RAW/skip.txt"
else
  QWEN_SHA=$(cat "$DIR/MODEL_QWEN.txt" 2>/dev/null | awk '/^sha256:/{print $2; exit}')
  adb -s "$SER" push "$QWEN" "$DEVDIR/qwen4b-q40.gguf"
  DEV_SHA=$(adb -s "$SER" shell "sha256sum $DEVDIR/qwen4b-q40.gguf" | awk '{print $1}')
  echo "host=$QWEN_SHA" | tee "$RAW/qwen_sha.txt"
  echo "device=$DEV_SHA" | tee -a "$RAW/qwen_sha.txt"
  if [ -n "$QWEN_SHA" ] && [ "$DEV_SHA" != "$QWEN_SHA" ]; then
    echo METHOD-VOID_QWEN | tee -a "$RAW/fail.txt"
  else
    run_gate qwen || exit 7
    adb -s "$SER" shell "cd $DEVDIR && $HTP_ENV && \
      ./bin/llama-bench --device $BDEV -ngl 99 -p 512 -n 128 -r 3 --no-warmup \
        -m qwen4b-q40.gguf -o jsonl -oe jsonl; echo EXIT=\$?" \
      > "$RAW/qwen_npu.txt" 2>&1 || true
    echo $? > "$RAW/qwen_npu.adb.exit"
    "$GATE" "$SER" "$RAW/therm_post_qwen.txt" > "$RAW/gate_post_qwen.txt" || true
    if [ "$(elapsed)" -lt 720 ]; then
      adb -s "$SER" shell "cd $DEVDIR && $HTP_ENV && \
        ./bin/llama-bench -ngl 0 -p 512 -n 128 -r 3 --no-warmup \
          -m qwen4b-q40.gguf -o jsonl -oe jsonl; echo EXIT=\$?" \
        > "$RAW/qwen_cpu.txt" 2>&1 || true
    else
      echo SKIP_QWEN_CPU elapsed=$(elapsed) | tee -a "$RAW/skip.txt"
    fi
  fi
fi

echo "DONE elapsed=$(elapsed)" | tee "$RAW/done.txt"
exit 0
