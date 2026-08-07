#!/data/data/com.termux/files/usr/bin/bash
export PATH=/data/data/com.termux/files/usr/bin:$PATH
OUT=$HOME/experiments/results/f4_state/F4.3-compute.status
CSV=$HOME/experiments/results/runs.csv
while true; do
  {
    date -Iseconds
    termux-battery-status 2>/dev/null | grep -E "plugged|temperature|percentage|status" | tr -d "\n"; echo
    if ps -ef 2>/dev/null | grep -E "start_f4_compute.sh --run" | grep -v grep >/dev/null; then echo worker=ALIVE; else echo worker=DEAD; fi
    ps -ef 2>/dev/null | grep -E "run_f4.sh --cell|bmoe-cli -m" | grep -v grep | head -3
    awk -F, "NR==1{for(i=1;i<=NF;i++)h[\$i]=i;next} \$h[\"notes\"]~/C3-/{
      n=\$h[\"notes\"]; t=\$h[\"threads\"]; e=\$h[\"eval_tok_s\"];
      if(n~/C3-t4/) c=\"t4\"; else if(n~/C3-t5-pin/) c=\"t5pin\"; else if(n~/C3-t5/) c=\"t5\"; else if(n~/C3-t6/) c=\"t6\"; else if(n~/C3-t8/) c=\"t8\"; else if(n~/C3-k8/) c=\"k8\"; else if(n~/C3-k6/) c=\"k6\"; else if(n~/C3-k4/) c=\"k4\"; else c=\"?\";
      print c, t, e, substr(n,1,120)
    }" "$CSV" 2>/dev/null
    tail -5 $HOME/experiments/results/f4_state/F4.3-compute.master.log 2>/dev/null
    if [ -f $HOME/experiments/results/f4_state/F4.3-compute.state ]; then echo STATE:; cat $HOME/experiments/results/f4_state/F4.3-compute.state; fi
  } > "$OUT.tmp" 2>&1
  mv "$OUT.tmp" "$OUT"
  # stop ticker if worker dead AND state file exists
  if ! ps -ef 2>/dev/null | grep -E "start_f4_compute.sh --run" | grep -v grep >/dev/null; then
    if [ -f $HOME/experiments/results/f4_state/F4.3-compute.state ]; then exit 0; fi
  fi
  sleep 60
done
