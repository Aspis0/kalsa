#!/bin/sh
# Lab-only crash check: one engine with the app's vision argv (--mmproj and
# --image-max-tokens 560) at one ubatch, the probe client, then the engine's
# fate: died on its own (exit status from wait) or still up and stopped here.
# usage: crash-check.sh <gemma|qwen> <model.gguf> <mmproj.gguf> <alias> <ubatch> <tag> [big.png]
set -u
profile=$1
model=$2
mmproj=$3
alias=$4
ubatch=$5
tag=$6
big=${7:-/tmp/lab-screen/crash/big-3000.png}
here=$(cd "$(dirname "$0")" && pwd)
dir=/tmp/lab-screen/logs/crash
log=$dir/$tag-u$ubatch.log
res=$dir/$tag-u$ubatch.json
engine_dir="$HOME/Library/Application Support/kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.5"
mkdir -p "$dir" /tmp/lab-screen/slots

case "$profile" in
  gemma) sampling="--temp 1.0 --top-p 0.95 --top-k 64" ;;
  qwen)  sampling="--temp 1.0 --top-p 0.95 --top-k 20 --repeat-penalty 1.0" ;;
  *) echo "unknown profile $profile"; exit 2 ;;
esac

cd "$engine_dir" || exit 2
./kalsa-server --host 127.0.0.1 --port 8150 \
  --model "$model" --mmproj "$mmproj" --alias "$alias" \
  --batch-size 2048 --ubatch-size "$ubatch" \
  --ctx-size 65536 --parallel 1 \
  --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 \
  $sampling \
  --image-max-tokens 560 \
  --sleep-idle-seconds 300 --no-webui --slot-save-path /tmp/lab-screen/slots --ctx-checkpoints 1 > "$log" 2>&1 &
pid=$!

i=0
healthy=no
while [ $i -lt 300 ]; do
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8150/health 2>/dev/null | grep -q 200; then
    healthy=yes
    break
  fi
  sleep 1
  i=$((i + 1))
done

client=none
if [ "$healthy" = yes ]; then
  node "$here/crash-check.mjs" --base http://127.0.0.1:8150 --model "$alias" --out "$res" \
    --frame /tmp/lab-screen/shots/github-llamacpp-1920.png --big "$big" > "$dir/$tag-u$ubatch.client.txt" 2>&1
  client=$?
fi

if kill -0 "$pid" 2>/dev/null; then
  kill "$pid"
  wait "$pid"
  echo "ENGINE=alive-at-end status=$? (stopped by harness)"
else
  wait "$pid"
  echo "ENGINE=died status=$?"
fi
echo "TAG=$tag UBATCH=$ubatch HEALTHY=$healthy CLIENT_EXIT=$client"
grep -m1 "GGML_ASSERT" "$log" || echo "NO_GGML_ASSERT"
