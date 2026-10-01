#!/bin/bash
# item 6 local repro attempt, PRE item-6-fix binaries:
# target gemma-4-12B on Metal, MTP drafter forced to CPU
set -u
cd ~/Projects/kalsallama-v115/proof-stage/kalsa-server-v1.1.5-local
MODEL="/Users/marco/Library/Application Support/kalsa-brain/runtime/models/gemma-4-12B-it-Q4_K_M.gguf"
DRAFT=/Users/marco/lab/spec/dl/mtp-gemma-4-12B-it-Q8_0.gguf

./kalsa-server -m "$MODEL" --model-draft "$DRAFT" --spec-type draft-mtp \
  --spec-draft-n-max 2 --spec-draft-n-min 0 \
  --n-gpu-layers 99 --n-gpu-layers-draft 0 \
  -c 8192 --port 18960 --host 127.0.0.1 --alias mtp-split \
  > ../split-prefix.log 2>&1 &
SPID=$!
for i in $(seq 1 240); do
  curl -sf http://127.0.0.1:18960/health > /dev/null 2>&1 && break
  # the process may be gone (crash) before health ever answers
  kill -0 "$SPID" 2>/dev/null || break
  sleep 1
done
if kill -0 "$SPID" 2>/dev/null; then
  echo "SERVER_STILL_ALIVE=yes"
  curl -s -o /dev/null -w "HEALTH_HTTP=%{http_code}\n" http://127.0.0.1:18960/health
else
  echo "SERVER_STILL_ALIVE=no (process exited early)"
fi
wait "$SPID" 2>/dev/null
echo "SERVER_EXIT=$?"
echo "--- abort markers:"
grep -c "GGML_ASSERT\|pre-allocated tensor\|cannot run the operation" ../split-prefix.log
echo "--- last lines:"
tail -6 ../split-prefix.log
