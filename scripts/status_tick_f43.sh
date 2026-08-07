#!/data/data/com.termux/files/usr/bin/bash
# Phone-side status ticker for F4.3 compute-attack. Writes F4.3-compute.status every 60s.
export PATH=/data/data/com.termux/files/usr/bin:$PATH
OUT=$HOME/experiments/results/f4_state/F4.3-compute.status
CSV=$HOME/experiments/results/runs.csv
MASTER=$HOME/experiments/results/f4_state/F4.3-compute.master.log
STATE=$HOME/experiments/results/f4_state/F4.3-compute.state

while true; do
  {
    date -Iseconds 2>/dev/null || date
    termux-battery-status 2>/dev/null | grep -E 'plugged|temperature|percentage|status'
    if ps -ef 2>/dev/null | grep 'start_f4_compute.sh --run' | grep -v grep >/dev/null; then
      echo worker=ALIVE
    else
      echo worker=DEAD
    fi
    ps -ef 2>/dev/null | grep -E 'run_f4.sh --cell|bmoe-cli -m' | grep -v grep | head -4
    echo ---rows---
    awk -F, '
      NR==1 {for(i=1;i<=NF;i++) h[$i]=i; next}
      $h["notes"] ~ /C3-/ {
        n=$h["notes"]; t=$h["threads"]; e=$h["eval_tok_s"]
        if (n ~ /C3-t5-pin/) c="t5pin"
        else if (n ~ /C3-t4/) c="t4"
        else if (n ~ /C3-t5/) c="t5"
        else if (n ~ /C3-t6/) c="t6"
        else if (n ~ /C3-t8/) c="t8"
        else if (n ~ /C3-k8/) c="k8"
        else if (n ~ /C3-k6/) c="k6"
        else if (n ~ /C3-k4/) c="k4"
        else c="?"
        bd=""
        if (match(n, /compute=[0-9.]+/)) bd=substr(n, RSTART, RLENGTH)
        kind=(n ~ /sentinel/ ? "S" : "M")
        print c, "t"t, e, bd, kind
      }
    ' "$CSV" 2>/dev/null
    echo ---log---
    grep -E 'OK: run_bench|measure |sentinel|done |cell |CHARGE|BLOCKED|BEST_THREADS|DONE' "$MASTER" 2>/dev/null | tail -8
    if [ -f "$STATE" ]; then
      echo ---state---
      cat "$STATE"
    fi
  } >"$OUT.tmp" 2>&1
  mv "$OUT.tmp" "$OUT"
  if ! ps -ef 2>/dev/null | grep 'start_f4_compute.sh --run' | grep -v grep >/dev/null; then
    if [ -f "$STATE" ]; then
      exit 0
    fi
  fi
  sleep 60
done
