# Watchdog for the step-1 resume: the first C-repack KLD (resume 1) span 43 min at ~4 cores on
# its first pass (a normal pass is ~21 s) and never printed a chunk. Any llama-perplexity or
# llama-bench alive past WD_MAX seconds gets its thread stacks dumped with debuggerd -b (shell owns
# the process, no root needed) and is killed, so the arm fails with evidence instead of heat.
# Launch in the background next to the session; it exits when $D/watchdog.stop exists.
. /data/local/tmp/govhtp/step1-s23/env.sh
WD_MAX=300
rm -f $D/watchdog.stop
while [ ! -f $D/watchdog.stop ]; do
  for P in $(pidof llama-perplexity llama-bench); do
    age=$(( $(date +%s) - $(stat -c %Y /proc/$P) ))
    if [ "$age" -gt $WD_MAX ]; then
      debuggerd -b $P > $D/stacks_$P.txt 2>&1
      echo "WATCHDOG: pid $P ($(cat /proc/$P/cmdline | tr '\0' ' ' | cut -c1-80)) alive ${age}s > ${WD_MAX}s - stacks in stacks_$P.txt, killed [$(st)]" >> $REPORT
      kill $P
    fi
  done
  sleep 10
done
