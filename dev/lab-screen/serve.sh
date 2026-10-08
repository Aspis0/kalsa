#!/bin/sh
# Lab-only: one lab engine on 127.0.0.1:8150, the app's argv plus --mmproj.
# The drafter is left out (answers at temp 0 are identical with it, per
# docs/LAB-VISION-2026-10-03.md test 3; latency here is prefill-bound).
# usage: serve.sh <gemma|lfm> <model.gguf> <mmproj.gguf> <alias> <log> <pidfile> [extra engine flags]
set -u
profile=$1
model=$2
mmproj=$3
alias=$4
log=$5
pidfile=$6
shift 6
engine_dir="$HOME/Library/Application Support/kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.5"

case "$profile" in
  gemma) sampling="--temp 1.0 --top-p 0.95 --top-k 64" ;;
  lfm)   sampling="--temp 0.1 --top-k 50 --repeat-penalty 1.1" ;;
  *) echo "unknown profile $profile"; exit 2 ;;
esac

mkdir -p /tmp/lab-screen/slots
cd "$engine_dir" || exit 2
./kalsa-server --host 127.0.0.1 --port 8150 \
  --model "$model" --mmproj "$mmproj" --alias "$alias" \
  --batch-size 2048 --ubatch-size 512 \
  --ctx-size 65536 --parallel 1 \
  --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 \
  $sampling \
  --sleep-idle-seconds 300 --no-webui --slot-save-path /tmp/lab-screen/slots "$@" > "$log" 2>&1 &
echo $! > "$pidfile"

i=0
while [ $i -lt 300 ]; do
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8150/health 2>/dev/null | grep -q 200; then
    echo "HEALTHY pid=$(cat "$pidfile") after ${i}s"
    exit 0
  fi
  sleep 1
  i=$((i + 1))
done
echo "NOT HEALTHY after 300s (see $log)"
exit 1
