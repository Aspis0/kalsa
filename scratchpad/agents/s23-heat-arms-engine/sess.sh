#!/system/bin/sh
D=/data/local/tmp/heat3way/s23-engine
O=$D/out
M=$O/markers.txt
STOP=$O/smp.stop
FATAL=$O/fatal
PIDFILE=$O/run.pid
COMMON="-m /data/local/tmp/heat3way/ship.gguf -lm none --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt"
export LD_LIBRARY_PATH=/data/local/tmp/heat3way/lib
export ADSP_LIBRARY_PATH=/data/local/tmp/heat3way/lib
export GGML_HEXAGON_NDEV=1

mark() { echo "$* $(date +%s)" >> "$M"; }
snapshot() {
  B=$(dumpsys battery 2>/dev/null)
  T=$(dumpsys thermalservice 2>/dev/null)
  BAT=$(printf '%s\n' "$B" | sed -n 's/^[[:space:]]*temperature:[[:space:]]*//p' | head -1)
  LEVEL=$(printf '%s\n' "$B" | sed -n 's/^[[:space:]]*level:[[:space:]]*//p' | head -1)
  STATUS=$(printf '%s\n' "$T" | sed -n 's/^Thermal Status:[[:space:]]*//p' | head -1)
  WAKE=$(dumpsys power 2>/dev/null | sed -n 's/^[[:space:]]*mWakefulness=//p' | head -1)
  PLUG=$(printf '%s\n' "$B" | grep -Ec 'AC powered: true|USB powered: true|Wireless powered: true')
  TRACE=$(getprop persist.traced.enable)
}
check_stop() {
  snapshot
  if [ -z "$BAT" ] || [ -z "$STATUS" ] || [ -z "$LEVEL" ] || [ "$LEVEL" -le 30 ] || [ "$BAT" -ge 430 ] || [ "$STATUS" -ge 3 ] || [ "$TRACE" != 0 ] || [ "$PLUG" -ne 0 ] || [ -s "$FATAL" ]; then
    mark "SESSION_STOP battery_dC=${BAT:-NA} status=${STATUS:-NA} level=${LEVEL:-NA} trace=${TRACE:-NA} plug=$PLUG"
    return 1
  fi
  return 0
}
awake_check() {
  snapshot
  mark "WAKE $1 value=${WAKE:-NA} battery_dC=${BAT:-NA} status=${STATUS:-NA} level=${LEVEL:-NA}"
  [ "$WAKE" = Awake ]
}
cooldown() {
  tag=$1
  start=$(date +%s)
  while :; do
    check_stop || return 2
    if [ "$WAKE" != Awake ]; then return 2; fi
    if [ "$BAT" -le 330 ] && [ "$STATUS" -eq 0 ]; then
      mark "COOL $tag ok battery_dC=$BAT status=$STATUS waited=$(( $(date +%s) - start ))"
      return 0
    fi
    elapsed=$(( $(date +%s) - start ))
    if [ "$elapsed" -ge 600 ]; then
      mark "VOID $tag hot battery_dC=$BAT status=$STATUS waited=$elapsed"
      return 1
    fi
    sleep 15
  done
}
tail_window() {
  tag=$1
  sleep 60
  mark "TAIL_END $tag"
}
run_binary() {
  tag=$1
  kind=$2
  backend=$3
  threads=$4
  log=$O/$tag.log
  cooldown "$tag"
  gate=$?
  [ "$gate" -eq 0 ] || return "$gate"
  am force-stop com.kalsa.app
  if [ -n "$(pidof com.kalsa.app 2>/dev/null)" ]; then mark "STOP app_running $tag"; return 2; fi
  awake_check "before_$tag" || { mark "VOID $tag not_awake_before"; return 2; }
  mark "A_START $tag kind=$kind backend=$backend battery_dC=$BAT status=$STATUS level=$LEVEL"
  echo "COMMAND_START $tag $(date +%s)" > "$log"
  echo "battery_dC=$BAT thermal_status=$STATUS battery_pct=$LEVEL trace=$TRACE plug=$PLUG wake=$WAKE" >> "$log"
  if [ "$kind" = P ]; then
    case "$backend" in
      cpu) flags="-dev none -ngl 0" ;;
      gpu) flags="-dev GPUOpenCL -ngl 99" ;;
      npu) flags="-dev HTP0 -ngl 99 -nkvo" ;;
    esac
    timeout -s KILL 300 ./bin/llama-completion $COMMON -f /data/local/tmp/heat3way/prompt.txt -n 16 -lv 4 $flags >> "$log" 2>&1 < /dev/null &
  else
    timeout -s KILL 300 ./bin/llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 0 -n 256 -r 1 -t "$threads" -ngl 0 -dev none -fa 1 --no-warmup -o md >> "$log" 2>&1 < /dev/null &
  fi
  run_pid=$!
  echo "$run_pid" > "$PIDFILE"
  wait "$run_pid"
  rc=$?
  : > "$PIDFILE"
  echo "EXIT=$rc" >> "$log"
  mark "A_END $tag rc=$rc"
  awake_check "after_$tag" || mark "VOID $tag not_awake_after"
  if [ "$rc" -ne 0 ]; then mark "VOID $tag rc=$rc"; fi
  if [ -s "$FATAL" ]; then return 2; fi
  tail_window "$tag"
  return 0
}
run_proof() {
  tag=npu-proof
  cooldown "$tag" || return 1
  am force-stop com.kalsa.app
  awake_check before_npu_proof || return 1
  mark "PROOF_START $tag"
  GGML_HEXAGON_VERBOSE=1 timeout -s KILL 180 ./bin/llama-completion -m /data/local/tmp/heat3way/ship.gguf -lm none -p " " -n 4 --ignore-eos --seed 1 --temp 0 --no-conversation -c 128 -b 16 -ub 16 -t 5 -fa 1 --no-warmup --simple-io --no-display-prompt --device HTP0 -ngl 99 --fit off -nkvo -lv 5 > "$O/$tag.log" 2>&1 < /dev/null &
  proof_pid=$!
  echo "$proof_pid" > "$PIDFILE"
  wait "$proof_pid"
  rc=$?
  : > "$PIDFILE"
  echo "EXIT=$rc" >> "$O/$tag.log"
  ops=$(grep -c 'HTP0 execute-op MUL_MAT' "$O/$tag.log")
  v73=0
  grep -q 'libggml-htp-v73' "$O/$tag.log" && v73=1
  mark "PROOF_END $tag rc=$rc htp_mulmat=$ops v73=$v73"
  awake_check after_npu_proof || return 1
  [ "$rc" -eq 0 ] && [ "$ops" -gt 0 ] && [ "$v73" -eq 1 ]
}

mkdir -p "$O"
: > "$M"
: > "$FATAL"
unlink "$STOP" 2>/dev/null
svc power stayon true
am force-stop com.kalsa.app
sh "$D/smp.sh" > "$O/smp.out" 2>&1 &
smp_pid=$!
mark "SESSION_START battery_dC=$(dumpsys battery | sed -n 's/^[[:space:]]*temperature:[[:space:]]*//p' | head -1)"

check_stop || exit 2
run_proof || mark "PROOF_FAIL NPU dispatch evidence absent"
for arm in P-cpu-1 P-gpu-1 P-npu-1 P-cpu-2 P-gpu-2 P-npu-2 P-cpu-3 P-gpu-3 P-npu-3 D-5-1 D-3-1 D-2-1 D-5-2 D-3-2 D-2-2; do
  kind=${arm%%-*}
  rest=${arm#*-}
  backend=${rest%-*}
  rep=${rest##*-}
  if [ "$kind" = P ]; then
    run_binary "$arm" P "$backend" 0
  else
    run_binary "$arm" D cpu "$backend"
  fi
  rc=$?
  [ "$rc" -eq 2 ] && { mark "SESSION_ABORT arm=$arm"; break; }
done
touch "$STOP"
wait "$smp_pid"
mark "SESSION_END"
