#!/system/bin/sh
# Prefill with 1 vs 5 host threads: pp1024 on HTP0 and on OpenCL, alternated;
# tok/s and CPU zone peaks are the readout. No
# cool-start gate (owner 2026-09-25), 60 s tail between arms. Safety stops live in sample.sh (battery 43 C,
# thermal status 3, level 30 %, traced) and in gate().
D=/data/local/tmp/heat3way
O=$D/prefillthreads
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
  backend=$1; threads=$2; rep=$3; tag="P-$backend-t$threads-$rep"
  case "$backend" in
    gpu) flags="-ngl 99 -dev GPUOpenCL -t $threads" ;;
    npu) flags="-ngl 99 -dev HTP0 -t $threads" ;;
  esac
  gate "BEFORE_$tag" || { mark ABORT "before-$tag"; return 2; }
  # The app is stopped once at session start: a force-stop right before a
  # bench left FastRPC opening its session while the DSP still released the
  # app's one, and the first arm hung at init for 400 s.
  [ -z "$(pidof com.kalsa.app)" ] || { mark ABORT "app-running-$tag"; return 2; }
  mark "START_$tag" "flags=$flags"
  ( timeout -s KILL 400 ./bin/llama-bench -m "$D/ship.gguf" -p 1024 -n 0 -r 1 $flags -fa 1 --no-warmup -o md ) > "$O/$tag.log" 2>&1 < /dev/null &
  rpid=$!; echo "$rpid" > "$P"
  wait "$rpid"; rc=$?
  : > "$P"
  printf 'EXIT=%s\n' "$rc" >> "$O/$tag.log"
  mark "END_$tag" "rc=$rc"
  if grep -Eq 'CDSP0 CRASHED|dspqueue_(read|write) failed|ggml_abort|GGML_ASSERT|Segmentation fault' "$O/$tag.log"; then
    echo "accelerator-failure $tag" >> "$F"
  fi
  sleep 60
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
for spec in "npu 5 1" "npu 1 1" "npu 5 2" "npu 1 2" "gpu 5 1" "gpu 1 1"; do
  set -- $spec
  arm "$1" "$2" "$3"; rc=$?
  [ "$rc" -eq 0 ] || mark "VOID_P-$1-t$2-$3" "rc=$rc"
  [ -s "$F" ] && break
  [ -f "$O/stop" ] && break
done
touch "$O/stop"
sleep 2
gate SESSION_END
