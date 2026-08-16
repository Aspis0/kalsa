#!/system/bin/sh
# On-device wrapper: run bmoe-cli, poll VmHWM, emit PEAK_RSS_KB after exit.
# Invoked as: sh run_one.sh <bmoe-cli argv...>
set -u
BIN=/data/local/tmp/f5_d1/bin
cd "$BIN" || exit 90
export LD_LIBRARY_PATH="$BIN"
"$BIN/bmoe-cli" "$@" &
PID=$!
HWM=0
while kill -0 "$PID" 2>/dev/null; do
  LINE=$(grep VmHWM /proc/$PID/status 2>/dev/null)
  V=$(echo "$LINE" | tr -s ' \t' ' ' | cut -d' ' -f2)
  if [ -n "$V" ]; then
    if [ "$V" -gt "$HWM" ] 2>/dev/null; then
      HWM=$V
    fi
  fi
  sleep 2
done
wait "$PID"
RC=$?
echo "PEAK_RSS_KB=$HWM"
echo "EXIT_CODE=$RC"
exit $RC
