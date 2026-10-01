#!/bin/bash
# item 6 no-false-positive proofs + item 4 identity proofs, all on the fixed build
set -u
cd ~/Projects/kalsallama-v115/proof-stage/kalsa-server-v1.1.5-local
MODEL="/Users/marco/Library/Application Support/kalsa-brain/runtime/models/gemma-4-12B-it-Q4_K_M.gguf"
E4B="/Users/marco/Library/Application Support/kalsa-brain/runtime/models/gemma-4-E4B-it-Q4_K_M.gguf"
DRAFT=/Users/marco/lab/spec/dl/mtp-gemma-4-12B-it-Q8_0.gguf
CHAT() { curl -sf "http://127.0.0.1:$1/v1/chat/completions" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"'"$2"'"}],"max_tokens":'"$3"',"temperature":0,"cache_prompt":true,"id_slot":0}'; }

echo "=========== [6.B] CPU drafter + Metal target (shared buffers): must still work"
./kalsa-server -m "$MODEL" --model-draft "$DRAFT" --spec-type draft-mtp \
  --spec-draft-n-max 2 --spec-draft-n-min 0 --n-gpu-layers 99 --n-gpu-layers-draft 0 \
  -c 8192 --port 18970 --host 127.0.0.1 --slot-save-path /tmp/k115-slots --alias mtp-smoke \
  > ../item6-cpudft.log 2>&1 &
SPID=$!
for i in $(seq 1 240); do curl -sf http://127.0.0.1:18970/health > /dev/null 2>&1 && break; kill -0 $SPID 2>/dev/null || break; sleep 1; done
if curl -sf http://127.0.0.1:18970/health > /dev/null 2>&1; then
  CHAT 18970 "Write four short sentences about the weather." 64 > /dev/null && echo "chat: OK"
  curl -s -X POST "http://127.0.0.1:18970/slots/0?action=save" -H "Content-Type: application/json" -d '{"filename":"mtp-conv-id.bin"}' > ../item4-save.json
  echo "save: $(head -c 170 ../item4-save.json)"
else
  echo "BOOT FAILED (see ../item6-cpudft.log)"
fi
kill $SPID 2>/dev/null; wait $SPID 2>/dev/null
echo "server_exit=$? abort_markers=$(grep -c 'GGML_ABORT\|pre-allocated tensor' ../item6-cpudft.log)"
grep -m1 "draft acceptance" ../item6-cpudft.log || true

echo "=========== [4.P1] byte identity of the payload: new save vs pre-item-4 mtp-conv.bin"
OLD=/tmp/k115-slots/mtp-conv.bin
NEW=/tmp/k115-slots/mtp-conv-id.bin
OLD_SZ=$(stat -f%z "$OLD"); NEW_SZ=$(stat -f%z "$NEW")
echo "old=$OLD_SZ new=$NEW_SZ delta=$((NEW_SZ - OLD_SZ))"
cmp -s -n "$OLD_SZ" "$OLD" "$NEW" && echo "prefix_cmp=IDENTICAL" || echo "prefix_cmp=DIFFERS"
ls -la "$NEW" | awk '{print "trailer_ok_size:", $5}'
python3 -c "
d = open('$NEW','rb').read()[-80:]
import struct
magic, ver = struct.unpack('<II', d[:8])
print('trailer_magic_ok:', magic == 0x4449534b, 'version:', ver)
arch = d[8:56].split(b'\x00')[0].decode()
f = struct.unpack('<6I', d[56:80])
print('trailer arch:', arch, 'n_embd/n_layer/n_head_kv/n_vocab/n_ctx_train:', f[:5])
"

echo "=========== [4.P3] legacy file (pre-item-4 mtp-conv2.bin) restores on the new build"
./kalsa-server -m "$MODEL" --model-draft "$DRAFT" --spec-type draft-mtp \
  --spec-draft-n-max 2 --spec-draft-n-min 0 --n-gpu-layers 99 -c 8192 \
  --port 18971 --host 127.0.0.1 --slot-save-path /tmp/k115-slots --alias mtp-smoke \
  > ../item4-legacy.log 2>&1 &
SPID=$!
for i in $(seq 1 240); do curl -sf http://127.0.0.1:18971/health > /dev/null 2>&1 && break; kill -0 $SPID 2>/dev/null || break; sleep 1; done
curl -s -o /dev/null -w "restore_legacy_HTTP=%{http_code}\n" -X POST "http://127.0.0.1:18971/slots/0?action=restore" \
  -H "Content-Type: application/json" -d '{"filename":"mtp-conv2.bin"}'
kill $SPID 2>/dev/null; wait $SPID 2>/dev/null

echo "=========== [4.P2] cross-model: 12B-saved file restored on E4B -> clean 400, server alive"
./kalsa-server -m "$E4B" -ngl 99 -c 8192 --port 18972 --host 127.0.0.1 --slot-save-path /tmp/k115-slots --alias e4b \
  > ../item4-crossmodel.log 2>&1 &
SPID=$!
for i in $(seq 1 240); do curl -sf http://127.0.0.1:18972/health > /dev/null 2>&1 && break; kill -0 $SPID 2>/dev/null || break; sleep 1; done
curl -s -o ../item4-crossmodel-resp.json -w "restore_crossmodel_HTTP=%{http_code}\n" -X POST "http://127.0.0.1:18972/slots/0?action=restore" \
  -H "Content-Type: application/json" -d '{"filename":"mtp-conv-id.bin"}'
head -c 300 ../item4-crossmodel-resp.json; echo
curl -s -o /dev/null -w "models_after_HTTP=%{http_code}\n" http://127.0.0.1:18972/v1/models
kill $SPID 2>/dev/null; wait $SPID 2>/dev/null
echo "crossmodel_aborts=$(grep -c 'GGML_ABORT\|GGML_ASSERT' ../item4-crossmodel.log)"

echo "=========== [6.C] normal path unchanged: drafter on Metal too"
./kalsa-server -m "$MODEL" --model-draft "$DRAFT" --spec-type draft-mtp \
  --spec-draft-n-max 2 --spec-draft-n-min 0 --n-gpu-layers 99 -c 8192 \
  --port 18973 --host 127.0.0.1 --alias mtp-smoke \
  > ../item6-normal.log 2>&1 &
SPID=$!
for i in $(seq 1 240); do curl -sf http://127.0.0.1:18973/health > /dev/null 2>&1 && break; kill -0 $SPID 2>/dev/null || break; sleep 1; done
if curl -sf http://127.0.0.1:18973/health > /dev/null 2>&1; then
  CHAT 18973 "Say OK." 8 | head -c 120; echo; echo "normal_path=OK"
else
  echo "normal_path=BOOT_FAILED"
fi
kill $SPID 2>/dev/null; wait $SPID 2>/dev/null
echo "done"
