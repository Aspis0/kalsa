#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export LC_ALL=C

pkill -9 -f bmoe-cli.SCORER 2>/dev/null || true
pkill -9 -f run_g2.sh 2>/dev/null || true
sleep 1
pgrep -af bmoe-cli || echo no_bmoe

PART1="$HOME/experiments/results/f5.5/a/split/mixed_it.part1.txt"
head -c 31200 "$PART1" > "$HOME/experiments/results/dropcold/corpus_subset_10k.txt"
cmp -n 31200 "$HOME/experiments/results/dropcold/corpus_subset_10k.txt" "$PART1" && echo PURE_PREFIX_OK
sha256sum "$HOME/experiments/results/dropcold/corpus_subset_10k.txt"
wc -c "$HOME/experiments/results/dropcold/corpus_subset_10k.txt"

rm -f "$HOME/experiments/results/dropcold/g2/STATUS_G2.txt"   "$HOME/experiments/results/dropcold/g2/g2_compare.json"
: > "$HOME/experiments/results/dropcold/g2/g2_decode.per_token.csv"
: > "$HOME/experiments/results/dropcold/g2/g2.stdout"
: > "$HOME/experiments/results/dropcold/g2/g2.stderr"
: > "$HOME/experiments/results/dropcold/g2/g2.master.log"

nohup bash "$HOME/experiments/results/dropcold/run_g2.sh" > "$HOME/experiments/results/dropcold/g2/nohup.out" 2>&1 &
echo $! > "$HOME/experiments/results/dropcold/g2/g2.pid"
echo "G2_PID=$(cat $HOME/experiments/results/dropcold/g2/g2.pid)"
sleep 3
cat "$HOME/experiments/results/dropcold/g2/g2.master.log"
pgrep -af bmoe-cli | head || true
echo "nproc=$(nproc)"
