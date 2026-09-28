#!/system/bin/sh
D=/data/local/tmp/heat3way
O=$D/s23-engine/out
LOG=$O/current-validation.tsv
export LD_LIBRARY_PATH=$D/lib ADSP_LIBRARY_PATH=$D/lib GGML_HEXAGON_NDEV=1
mkdir -p "$O" || exit 2
echo "epoch phase current_now voltage_mv battery_temp_dC thermal_status skin_C battery_pct wakefulness" > "$LOG"

sample() {
  epoch=$(date +%s)
  bat=$(dumpsys battery 2>/dev/null)
  th=$(dumpsys thermalservice 2>/dev/null)
  current=$(printf '%s\n' "$bat" | sed -n 's/^[[:space:]]*current now:[[:space:]]*//p' | head -1)
  voltage=$(printf '%s\n' "$bat" | sed -n 's/^[[:space:]]*voltage:[[:space:]]*//p' | head -1)
  temp=$(printf '%s\n' "$bat" | sed -n 's/^[[:space:]]*temperature:[[:space:]]*//p' | head -1)
  level=$(printf '%s\n' "$bat" | sed -n 's/^[[:space:]]*level:[[:space:]]*//p' | head -1)
  status=$(printf '%s\n' "$th" | sed -n 's/^Thermal Status:[[:space:]]*//p' | head -1)
  skin=$(printf '%s\n' "$th" | sed -n '/Current temperatures from HAL/,/Current cooling devices from HAL/p' | sed -n 's/.*mValue=\([0-9.]*\), mType=3, mName=SKIN.*/\1/p' | head -1)
  wake=$(dumpsys power 2>/dev/null | sed -n 's/^[[:space:]]*mWakefulness=//p' | head -1)
  printf '%s %s %s %s %s %s %s %s %s\n' "$epoch" "$phase" "${current:-NA}" "${voltage:-NA}" "${temp:-NA}" "${status:-NA}" "${skin:-NA}" "${level:-NA}" "${wake:-NA}" >> "$LOG"
}

sample_block() {
  phase=$1
  count=30
  i=0
  start=$(date +%s)
  while [ "$i" -lt "$count" ]; do
    sample
    i=$((i + 1))
    next=$((start + i))
    now=$(date +%s)
    [ "$next" -gt "$now" ] && sleep $((next - now))
  done
}

echo "VALIDATE_START $(date +%s)" >> "$O/validation.markers"
phase=idle
sample_block idle 2>/dev/null

phase=load
sample_block load &
sampler=$!
start=$(date +%s)
deadline=$((start + 30))
run=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  run=$((run + 1))
  printf 'LOAD_RUN_START run=%s epoch=%s\n' "$run" "$(date +%s)" >> "$O/load-runs.log"
  ./bin/llama-bench -m "$D/ship.gguf" -p 0 -n 256 -r 1 -t 5 -ngl 0 -dev none -fa 1 --no-warmup -o md >> "$O/load-runs.log" 2>&1
  rc=$?
  printf 'LOAD_RUN_END run=%s rc=%s epoch=%s\n' "$run" "$rc" "$(date +%s)" >> "$O/load-runs.log"
  [ "$rc" -eq 0 ] || break
done
wait "$sampler"
echo "VALIDATE_END $(date +%s) runs=$run rc=${rc:-0}" >> "$O/validation.markers"
