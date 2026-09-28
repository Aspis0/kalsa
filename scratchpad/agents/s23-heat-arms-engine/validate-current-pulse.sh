#!/system/bin/sh
D=/data/local/tmp/heat3way/s23-engine/out
OUT=$D/current-pulse.tsv
echo "epoch phase current_now voltage_mv battery_temp_dC" > "$OUT"
sample() {
  t=$(date +%s)
  c=$(cmd battery get current_now 2>/dev/null | tail -1)
  b=$(dumpsys battery 2>/dev/null)
  v=$(printf '%s\n' "$b" | sed -n 's/^[[:space:]]*voltage:[[:space:]]*//p' | head -1)
  bt=$(printf '%s\n' "$b" | sed -n 's/^[[:space:]]*temperature:[[:space:]]*//p' | head -1)
  echo "$t $phase $c $v $bt" >> "$OUT"
}
block() {
  phase=$1
  n=$2
  i=0
  start=$(date +%s)
  while [ "$i" -lt "$n" ]; do
    sample
    i=$((i + 1))
    next=$((start + i))
    now=$(date +%s)
    [ "$next" -gt "$now" ] && sleep $((next - now))
  done
}
block idle 8
yes >/dev/null &
load_pid=$!
block load 15
kill -TERM "$load_pid" 2>/dev/null
wait "$load_pid" 2>/dev/null
block recovery 8
