#!/usr/bin/env bash
# PC-side poller for knee dropcold sweep
set -u
SSH=(ssh -p 8022 -i "$HOME/.ssh/moe_s23" -o BatchMode=yes -o ConnectTimeout=10 u0_a344@192.168.1.152)
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
LOG="$ROOT/results/dropcold/knee/poller_pc.log"
mkdir -p "$ROOT/results/dropcold/knee"
: > "$LOG"
DEAD_COUNT=0
for i in $(seq 1 120); do
  TS=$(date '+%Y-%m-%dT%H:%M:%S')
  OUT=$("${SSH[@]}" 'export PREFIX=/data/data/com.termux/files/usr; export PATH=$PREFIX/bin:$PATH
    PID=$(cat ~/experiments/results/dropcold/knee/knee.pid 2>/dev/null)
    ALIVE=no; kill -0 $PID 2>/dev/null && ALIVE=yes
    STATUS=$(cat ~/experiments/results/dropcold/knee/STATUS_KNEE.txt 2>/dev/null | tr "\n" " ")
    BMOE=$(pgrep -c bmoe 2>/dev/null || echo 0)
    BATT=$(termux-battery-status 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get(\"percentage\"), d.get(\"plugged\"), d.get(\"temperature\"))" 2>/dev/null || echo "?")
    NPROC=$(nproc)
    TAIL=$(tail -3 ~/experiments/results/dropcold/knee/knee.master.log 2>/dev/null | tr "\n" " | ")
    TABLE=$(tail -n +2 ~/experiments/results/dropcold/knee/table.tsv 2>/dev/null | wc -l)
    CSVS=$(ls ~/experiments/results/dropcold/knee/drop*/ppl.per_token.csv 2>/dev/null | wc -l)
    META=$(ls ~/experiments/results/dropcold/knee/drop*/cell_summary.json 2>/dev/null | wc -l)
    echo "alive=$ALIVE status=[$STATUS] bmoe=$BMOE batt=[$BATT] nproc=$NPROC rows=$TABLE csv=$CSVS meta=$META tail=[$TAIL]"
  ' 2>&1) || OUT="ssh_fail"
  echo "[$TS] $OUT" | tee -a "$LOG"
  if echo "$OUT" | grep -q 'status=\[DONE'; then
    echo DONE_DETECTED | tee -a "$LOG"
    break
  fi
  if echo "$OUT" | grep -q 'alive=no' && echo "$OUT" | grep -qE 'rows=[2-9]'; then
    echo PROCESS_DEAD_WITH_ROWS | tee -a "$LOG"
    break
  fi
  if echo "$OUT" | grep -q 'alive=no' && ! echo "$OUT" | grep -q 'status=\[DONE'; then
    DEAD_COUNT=$((DEAD_COUNT+1))
    if [ "$DEAD_COUNT" -ge 2 ]; then
      echo DEAD_WITHOUT_DONE | tee -a "$LOG"
      break
    fi
  else
    DEAD_COUNT=0
  fi
  sleep 90
done
echo "POLLER_EXIT $(date -Iseconds)" | tee -a "$LOG"
"${SSH[@]}" 'export PREFIX=/data/data/com.termux/files/usr; export PATH=$PREFIX/bin:$PATH
  echo "===TABLE==="; cat ~/experiments/results/dropcold/knee/table.tsv 2>/dev/null
  echo "===STATUS==="; cat ~/experiments/results/dropcold/knee/STATUS_KNEE.txt 2>/dev/null
  echo "===MASTER_TAIL==="; tail -50 ~/experiments/results/dropcold/knee/knee.master.log 2>/dev/null
  for d in drop0.65 drop0.80; do
    echo "=== $d summary ==="
    cat ~/experiments/results/dropcold/knee/$d/cell_summary.json 2>/dev/null || echo missing
    echo "--- ppl_meta ---"
    cat ~/experiments/results/dropcold/knee/$d/ppl_meta.json 2>/dev/null || true
    echo "--- twin_meta ---"
    cat ~/experiments/results/dropcold/knee/$d/twin_meta.json 2>/dev/null || true
  done
  termux-battery-status 2>/dev/null
' | tee "$ROOT/results/dropcold/knee/final_pull.txt"
