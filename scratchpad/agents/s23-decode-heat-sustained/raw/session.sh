#!/system/bin/sh
# Sustained decode heat per backend on the S23: tg1024 per arm, Latin-square
# order, no cool-start gate (owner 2026-09-25), 90 s tail between arms, start
# temperature logged per arm. Safety stops live in sample.sh (battery 43 C,
# thermal status 3, level 30 %, traced) and in gate().
D=/data/local/tmp/heat3way
O=$D/sustained
M=$O/markers.tsv
F=$O/fatal
P=$O/run.pid
export LD_LIBRARY_PATH=$D/lib
export ADSP_LIBRARY_PATH=$D/lib
export GGML_HEXAGON_NDEV=1

mark() { printf '%s\t%s\t%s\n' "$(date +%s)" "$1" "$2" >> "$M"; }
gate() {
  B=$(dumpsys battery 2>/dev/null)
  BAT=$(printf '%s\n' "$B" | sed -n 's/^[[:space:]]*temperature:[[:space:]]*//p' | head -1)
  LEVEL=$(printf '%s\n' "$B" | sed -n 's/^[[:space:]]*level:[[:space:]]*//p' | head -1)
  PLUG=$(printf '%s\n' "$B" | grep -Ec '(AC|USB|Wireless) powered: true')
  STATUS=$(dumpsys thermalservice 2>/dev/null | sed -n 's/^Thermal Status:[[:space:]]*//p' | head -1)
  WAKE=$(dumpsys power 2>/dev/null | sed -n 's/^[[:space:]]*mWakefulness=//p' | head -1)
  TRACE=$(getprop persist.traced.enable)
  mark "$1" "wake=${WAKE:-NA} plug=$PLUG level=${LEVEL:-NA} battery_dC=${BAT:-NA} status=${STATUS:-NA} traced=${TRACE:-NA}"
  [ "$WAKE" = Awake ] && [ "$PLUG" -eq 0 ] && [ "$LEVEL" -gt 30 ] && [ "$BAT" -lt 430 ] && [ "$STATUS" -lt 3 ] && [ "$TRACE" = 0 ] && [ ! -s "$F" ]
}
arm() {
  backend=$1; rep=$2; tag="D-$backend-$rep"
  case "$backend" in
    cpu) flags="-ngl 0 -dev none" ;;
    gpu) flags="-ngl 99 -dev GPUOpenCL" ;;
    npu) flags="-ngl 99 -dev HTP0" ;;
  esac
  gate "BEFORE_$tag" || { mark ABORT "before-$tag"; return 2; }
  # The app is stopped once at session start: a force-stop right before a
  # bench left FastRPC opening its session while the DSP still released the
  # app's one, and the first arm hung at init for 400 s.
  [ -z "$(pidof com.kalsa.app)" ] || { mark ABORT "app-running-$tag"; return 2; }
  mark "START_$tag" "flags=$flags"
  ( timeout -s KILL 400 ./bin/llama-bench -m "$D/ship.gguf" -p 0 -n 1024 -r 1 -t 5 $flags -fa 1 --no-warmup -o md ) > "$O/$tag.log" 2>&1 < /dev/null &
  rpid=$!; echo "$rpid" > "$P"
  wait "$rpid"; rc=$?
  : > "$P"
  printf 'EXIT=%s\n' "$rc" >> "$O/$tag.log"
  mark "END_$tag" "rc=$rc"
  if grep -Eq 'CDSP0 CRASHED|dspqueue_(read|write) failed|ggml_abort|GGML_ASSERT|Segmentation fault' "$O/$tag.log"; then
    echo "accelerator-failure $tag" >> "$F"
  fi
  sleep 90
  mark "TAIL_END_$tag" ""
  [ "$rc" -eq 0 ] && [ ! -s "$F" ]
}
cd "$D" || exit 2
mkdir -p "$O"
: > "$M"; : > "$F"; rm -f "$O/stop" "$P"
svc power stayon true
am force-stop com.kalsa.app
sleep 15
sh "$O/sample.sh" > "$O/sampler.log" 2>&1 &
sleep 2
gate SESSION_PREFLIGHT || { mark ABORT preflight; touch "$O/stop"; exit 2; }
sha256sum "$D/ship.gguf" bin/llama-bench > "$O/input-sha256.txt"
cpu_rep=0; gpu_rep=0; npu_rep=0
for backend in cpu npu gpu npu gpu cpu gpu cpu npu; do
  case "$backend" in
    cpu) cpu_rep=$((cpu_rep + 1)); rep=$cpu_rep ;;
    gpu) gpu_rep=$((gpu_rep + 1)); rep=$gpu_rep ;;
    npu) npu_rep=$((npu_rep + 1)); rep=$npu_rep ;;
  esac
  arm "$backend" "$rep"; rc=$?
  [ "$rc" -eq 0 ] || mark "VOID_D-$backend-$rep" "rc=$rc"
  [ -s "$F" ] && break
  [ -f "$O/stop" ] && break
done
touch "$O/stop"
sleep 2
gate SESSION_END
