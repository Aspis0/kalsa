#!/bin/sh
# NPU cell bench driver: one invocation. Usage: run_npu_bench.sh <N|C> <TAG>
set -u
ARM="$1"; TAG="$2"; SER=2a38935c
export ANDROID_ADB_SERVER_PORT=6037
RAW=~/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8elite-npu-v79/raw
GATE=~/kalsa-qdc/kexp-speed-cell/thermal_gate.sh
"$GATE" "$SER" "$RAW/therm_pre_${ARM}${TAG}.txt" > /dev/null
[ $? -ne 0 ] && { echo "GATE_FAIL ${ARM}${TAG}"; exit 7; }
if [ "$ARM" = "N" ]; then
  DEVFLAGS="--device HTP0 -ngl 99"
else
  DEVFLAGS="-ngl 0"
fi
adb -s $SER shell "cd /data/local/tmp/kalsa-npu && LD_LIBRARY_PATH=\$PWD/lib ADSP_LIBRARY_PATH=\$PWD/lib ./bin/llama-bench $DEVFLAGS --mmap 0 --poll 1000 -t 6 --cpu-mask 0xfc --cpu-strict 1 -ub 1024 -fa 1 -m ship.gguf -p 512 -n 128 -r 3 2>&1; echo EXIT=\$?" > "$RAW/bench_${ARM}${TAG}.txt" 2>&1
"$GATE" "$SER" "$RAW/therm_post_${ARM}${TAG}.txt" > /dev/null || true
grep -E "pp512|tg128|EXIT" "$RAW/bench_${ARM}${TAG}.txt" | tail -4
