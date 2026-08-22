#!/data/data/com.termux/files/usr/bin/bash
export PATH=/data/data/com.termux/files/usr/bin:$PATH
OUT=/data/data/com.termux/files/home/experiments/results/ttft_f0_jelly/C3_kvfix
echo "=== STATUS ==="
cat "$OUT/STATUS.txt"
echo
echo "=== MASTER TAIL ==="
tail -20 "$OUT/C3_kvfix.master.log"
echo
echo "=== R1 BMOE ==="
grep -E 'BMOE_DONE|BMOE_ERROR|BMOE_READY' "$OUT/logs/C3_r1_c4096/stdout.txt" || true
echo "=== R1 STDERR HITS ==="
grep -E 'seq_rm|n_common|wipe|clear cache|session' "$OUT/logs/C3_r1_c4096/stderr.txt" | head -40 || true
echo "=== R1 RC WALL ==="
cat "$OUT/logs/C3_r1_c4096/rc.txt" 2>/dev/null
cat "$OUT/logs/C3_r1_c4096/wall.txt" 2>/dev/null
echo
echo "=== R2 EXISTS ==="
ls -l "$OUT/logs/C3_r2_c4096" 2>/dev/null || echo no_r2
if [ -f "$OUT/logs/C3_r2_c4096/stdout.txt" ]; then
  echo "=== R2 BMOE ==="
  grep -E 'BMOE_DONE|BMOE_ERROR|BMOE_READY' "$OUT/logs/C3_r2_c4096/stdout.txt" || true
fi
echo "=== PS ==="
ps -A | grep bmoe | grep -v grep || true
