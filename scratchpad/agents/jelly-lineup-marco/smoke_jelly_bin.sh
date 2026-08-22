#!/data/data/com.termux/files/usr/bin/bash
export PATH=/data/data/com.termux/files/usr/bin:$HOME/bin:$PATH
export HOME=/data/data/com.termux/files/home
export LD_LIBRARY_PATH=$HOME/bin
OUT=$HOME/_lineup_smoke
mkdir -p "$OUT"
P=$(cat "$HOME/experiments/results/kf_cold_jelly/prompts/p_fact.txt")
"$HOME/bin/bmoe-cli.JELLY" -m "$HOME/models/Marco-Mini-Instruct-KEXP.gguf" \
  -p "$P" -n 5 \
  --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
  --io-threads 4 --ubatch 512 -t 2 -c 4096 --temp 0 --chatml --no-think \
  --n-expert-used 6 --drop-cold-experts 0.0 \
  --csv "$OUT/smoke.csv" > "$OUT/smoke.out" 2> "$OUT/smoke.err"
echo rc=$?
echo '=== summary ==='
grep '^# summary' "$OUT/smoke.csv" 2>/dev/null | tail -1
echo '=== err ==='
tail -20 "$OUT/smoke.err" 2>/dev/null
echo '=== ldd ==='
ldd "$HOME/bin/bmoe-cli.JELLY" 2>&1 | head -20
