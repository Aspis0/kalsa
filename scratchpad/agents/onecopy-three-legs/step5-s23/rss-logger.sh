# Per-process memory of the running bench (the repro2 logger's pgrep caught `timeout`): VmRSS/RssAnon/RssFile/VmSwap
# every 5 s, synced, until STOP exists.   sh rss-logger.sh OUT STOP &
OUT=$1; STOP=$2; rm -f "$STOP"
while [ ! -e "$STOP" ]; do
  p=$(pgrep -f '^/data/local/tmp/govhtp/step5-s23/(bin|repro)/' | head -1)
  [ -n "$p" ] && echo "$(date +%s) pid=$p $(grep -E '^(VmRSS|RssAnon|RssFile|RssShmem|VmSwap)' /proc/$p/status | tr -s ' \t' ' ' | tr '\n' ' ')" >> "$OUT" && sync
  sleep 5
done
