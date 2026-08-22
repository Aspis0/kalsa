#!/data/data/com.termux/files/usr/bin/bash
export PATH=/data/data/com.termux/files/usr/bin:$PATH
OUT=/data/data/com.termux/files/home/experiments/results/ttft_f0_jelly/C3_kvfix
for r in r1 r2; do
  echo "===== $r STDERR keywords ====="
  grep -niE 'seq_rm|n_common|wipe|clear|reuse|prefix|mismatch|kv_tokens|common prefix|memory_seq|refused|fallback' "$OUT/logs/C3_${r}_c4096/stderr.txt" || echo "(none)"
  echo "===== $r STDERR last 30 ====="
  tail -30 "$OUT/logs/C3_${r}_c4096/stderr.txt"
  echo
done
echo "=== CAMPAIGN STILL ==="
sha256sum /data/data/com.termux/files/home/bin/bmoe-cli
echo "=== KVFIX ==="
sha256sum /data/data/com.termux/files/home/bin/bmoe-cli-kvfix
echo "=== CMDLINE R1 ==="
cat "$OUT/logs/C3_r1_c4096/cmdline.txt"
echo "=== BATT FINAL ==="
timeout 5 termux-api-start >/dev/null 2>&1 || true
sleep 1
timeout 10 termux-battery-status
