#!/bin/bash
# item 6 local repro, PRE item-6-fix binaries:
# the target's K/V are forced into PRIVATE Metal buffers (non-host; the same
# predicate branch as the Windows Vulkan1 evidence) while the MTP drafter is
# on CPU. Expect: the server boots, then the process ABORTS on the first
# speculative decode at the sched's "pre-allocated tensor" check.
set -u
cd ~/Projects/kalsallama-v115/proof-stage/kalsa-server-v1.1.5-local
MODEL="/Users/marco/Library/Application Support/kalsa-brain/runtime/models/gemma-4-12B-it-Q4_K_M.gguf"
DRAFT=/Users/marco/lab/spec/dl/mtp-gemma-4-12B-it-Q8_0.gguf

GGML_METAL_SHARED_BUFFERS_DISABLE=1 ./kalsa-server -m "$MODEL" --model-draft "$DRAFT" \
  --spec-type draft-mtp --spec-draft-n-max 2 --spec-draft-n-min 0 \
  --n-gpu-layers 99 --n-gpu-layers-draft 0 \
  -c 8192 --port 18961 --host 127.0.0.1 --alias mtp-split \
  > ../split-prefix2.log 2>&1 &
SPID=$!
for i in $(seq 1 240); do
  curl -sf http://127.0.0.1:18961/health > /dev/null 2>&1 && break
  kill -0 "$SPID" 2>/dev/null || break
  sleep 1
done
if curl -sf http://127.0.0.1:18961/health > /dev/null 2>&1; then
  echo "BOOTED=yes, sending one chat to trigger the speculative decode"
  curl -s -o /dev/null -w "CHAT_HTTP=%{http_code}\n" http://127.0.0.1:18961/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"Say hello."}],"max_tokens":16,"temperature":0,"id_slot":0}'
else
  echo "BOOTED=no (died during load)"
fi
sleep 2
if kill -0 "$SPID" 2>/dev/null; then echo "SERVER_ALIVE=yes"; kill "$SPID"; else echo "SERVER_ALIVE=no"; fi
wait "$SPID" 2>/dev/null
echo "SERVER_EXIT=$?"
echo "--- abort markers:"
grep -c "GGML_ABORT\|pre-allocated tensor\|cannot run the operation" ../split-prefix2.log
echo "--- matching line:"
grep -m1 "pre-allocated tensor\|cannot run the operation" ../split-prefix2.log
