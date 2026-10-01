#!/bin/bash
# item 2 server-level proof, exact path: cut inside the llama state payload
# tensor bulk (payload end = appendix "SCKP" header) so the state read clamps
# at EOF and the engine's truncation refusal fires, not an earlier parse error
set -u
cd ~/Projects/kalsallama-v115/proof-stage/kalsa-server-v1.1.5-local
python3 - <<'PY'
import os
p = '/tmp/k115-slots/mtp-conv.bin'
data = open(p, 'rb').read()
size = len(data)
pos = size
while True:
    pos = data.rfind(b'SCKP', 0, pos)
    assert pos > 0, 'appendix magic not found'
    import struct
    ver = struct.unpack('<I', data[pos+4:pos+8])[0]
    if ver == 1:
        break
keep = int(pos * 0.9)
out = '/tmp/k115-slots/mtp-conv-payloadcut.bin'
with open(out, 'wb') as f:
    f.write(data[:keep])
print(f'file {size}, payload ends at {pos}, cut to {keep}')
PY

MODEL="/Users/marco/Library/Application Support/kalsa-brain/runtime/models/gemma-4-12B-it-Q4_K_M.gguf"
DRAFT=/Users/marco/lab/spec/dl/mtp-gemma-4-12B-it-Q8_0.gguf
./kalsa-server -m "$MODEL" --model-draft "$DRAFT" --spec-type draft-mtp \
  --spec-draft-n-max 2 --spec-draft-n-min 0 --n-gpu-layers 99 -c 8192 \
  --port 18951 --host 127.0.0.1 --slot-save-path /tmp/k115-slots --alias mtp-smoke \
  > ../mtp-restore3.log 2>&1 &
SPID=$!
for i in $(seq 1 180); do
  curl -sf http://127.0.0.1:18951/health > /dev/null 2>&1 && break
  sleep 1
done
echo "--- restore payload-cut file (expect 400 from the engine truncation check):"
curl -s -o ../mtp-restore-trunc3.json -w "HTTP_CODE=%{http_code}\n" \
  -X POST "http://127.0.0.1:18951/slots/0?action=restore" \
  -H "Content-Type: application/json" -d '{"filename":"mtp-conv-payloadcut.bin"}'
head -c 260 ../mtp-restore-trunc3.json; echo
echo "--- server alive after (v1/models):"
curl -s -o /dev/null -w "HTTP_CODE=%{http_code}\n" http://127.0.0.1:18951/v1/models
kill "$SPID" 2>/dev/null
wait "$SPID" 2>/dev/null
echo "SERVER_EXIT=$?"
echo "--- GGML_ASSERT count:"
grep -c "GGML_ASSERT" ../mtp-restore3.log
echo "--- engine truncation line:"
grep "truncated sequence state file" ../mtp-restore3.log | head -1
