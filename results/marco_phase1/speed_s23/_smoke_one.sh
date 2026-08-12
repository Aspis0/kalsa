#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export HOME=/data/data/com.termux/files/home
export PREFIX=/data/data/com.termux/files/usr
export PATH=$PREFIX/bin:$PATH
export TMPDIR=$PREFIX/tmp
export LD_LIBRARY_PATH=$HOME/src/BigMoeOnEdge/build-bmoe/cli
BIN=$HOME/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN
MODEL=$HOME/experiments/models/Marco-Mini-Instruct.i1-Q4_K_M.gguf
P=$HOME/experiments/results/marco_phase1_speed_s23/prompts/p_fact.txt
OUT=$HOME/experiments/results/marco_phase1_speed_s23/smoke
mkdir -p $OUT
termux-battery-status | tee $OUT/batt_pre.json
ptext=$(cat "$P")
$HOME/bin/cold_model.sh "$MODEL" || true
echo "starting smoke n=32"
set +e
"$BIN" -m "$MODEL" -p "$ptext" -n 32 --n-expert-used 8 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -t 4 -c 4096 --temp 0 --chatml --no-think >$OUT/stdout.txt 2>$OUT/stderr.txt
rc=$?
set -e
echo RC=$rc
tail -60 $OUT/stdout.txt
echo '---stderr---'
cat $OUT/stderr.txt
termux-battery-status | tee $OUT/batt_post.json