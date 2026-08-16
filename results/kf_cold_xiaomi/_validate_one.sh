#!/bin/bash
export MSYS_NO_PATHCONV=1
A="/c/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe"
S="192.168.1.193:46397"
D="/c/Users/gualt/Desktop/Kalsa/moe-experiments/results/kf_cold_xiaomi"
OUT="$D/out"
mkdir -p "$OUT"
MODEL=/data/local/tmp/gdn_750/taskb/Marco-Mini-Instruct-KEXP.gguf
B=/data/local/tmp/kf_general/bin
P=/data/local/tmp/kf_general/p_fact.txt
BASE="cd $B && LD_LIBRARY_PATH=$B ./bmoe-cli -m $MODEL -p \"\$(cat $P)\" -n 200 --temp 0 -c 4096 --ubatch 512 -t 4 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --n-expert-used 6 --drop-cold-experts 0.65"
echo "=== VALIDATE start $(date -Is) ==="
"$A" -s "$S" shell "svc power stayon true"
echo "--- FADV BEFORE ---"
"$A" -s "$S" shell "$B/fadv $MODEL"
echo "--- RUN ---"
t0=$(date +%s)
"$A" -s "$S" shell "$BASE" > "$OUT/validate_c01_OFF.txt" 2>&1
rc=$?
t1=$(date +%s)
wall=$((t1-t0))
bytes=$(wc -c < "$OUT/validate_c01_OFF.txt" | tr -d ' ')
echo "rc=$rc wall=${wall}s bytes=$bytes"
echo "--- TAIL ---"
tail -n 20 "$OUT/validate_c01_OFF.txt"
echo "--- FADV AFTER ---"
"$A" -s "$S" shell "$B/fadv $MODEL"
echo "=== VALIDATE end $(date -Is) ==="
