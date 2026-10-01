#!/bin/bash
# item 2 server-level proof: a 50 percent truncated slot file (the v1.1.4
# evidence repro) must give a clean 400 and leave the server running
set -u
cd ~/Projects/kalsallama-v115/proof-stage/kalsa-server-v1.1.5-local
MODEL="/Users/marco/Library/Application Support/kalsa-brain/runtime/models/gemma-4-12B-it-Q4_K_M.gguf"
DRAFT=/Users/marco/lab/spec/dl/mtp-gemma-4-12B-it-Q8_0.gguf

./kalsa-server -m "$MODEL" --model-draft "$DRAFT" --spec-type draft-mtp \
  --spec-draft-n-max 2 --spec-draft-n-min 0 --n-gpu-layers 99 -c 8192 \
  --port 18950 --host 127.0.0.1 --slot-save-path /tmp/k115-slots --alias mtp-smoke \
  > ../mtp-restore2.log 2>&1 &
SPID=$!
for i in $(seq 1 180); do
  curl -sf http://127.0.0.1:18950/health > /dev/null 2>&1 && break
  sleep 1
done

echo "--- restore 50 percent truncated (expect clean 400):"
curl -s -o ../mtp-restore-trunc2.json -w "HTTP_CODE=%{http_code}\n" \
  -X POST "http://127.0.0.1:18950/slots/0?action=restore" \
  -H "Content-Type: application/json" -d '{"filename":"mtp-conv3.bin"}'
head -c 260 ../mtp-restore-trunc2.json; echo
echo "--- server alive after (v1/models):"
curl -s -o /dev/null -w "HTTP_CODE=%{http_code}\n" http://127.0.0.1:18950/v1/models
kill "$SPID" 2>/dev/null
wait "$SPID" 2>/dev/null
echo "SERVER_EXIT=$?"
echo "--- GGML_ASSERT count:"
grep -c "GGML_ASSERT" ../mtp-restore2.log
echo "--- engine truncation line:"
grep "truncated sequence state file" ../mtp-restore2.log | head -1
