#!/data/data/com.termux/files/usr/bin/bash
# N2 correctness + hook-alive. PLUGGED OK. Same binary both sides.
set -u
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export WS="$HOME/gdn_k2/k4split"
export BIN="$WS/bin/bmoe-cli"
export LIB="$WS/bin"
export MODEL="$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf"
export LD_LIBRARY_PATH="$LIB:/vendor/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
CACHE_MB="${CACHE_MB:-2000}"
FORCE_CACHE="${FORCE_CACHE:-}"
K6D065="-t 4 --moe-stream --cache-mb ${CACHE_MB} --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65"
mkdir -p "$WS/logs" "$WS/logs/n2"
TAG="c${CACHE_MB}"
SAMPLER_PID=""
EXTRA=""
if [ -n "$FORCE_CACHE" ]; then EXTRA="--force-cache"; fi

log() { echo "$(date -Iseconds) $*"; }

batt_snap() {
  local name="$1"
  awk '/MemFree:|MemAvailable:|MemTotal:|Cached:|Buffers:|SwapFree:|SwapTotal:/' /proc/meminfo \
    | tee "$WS/logs/n2/mem_${name}.txt"
  termux-battery-status 2>/dev/null | tee "$WS/logs/n2/batt_${name}.json" || true
}

stop_sampler() {
  if [ -n "$SAMPLER_PID" ] && kill -0 "$SAMPLER_PID" 2>/dev/null; then
    kill "$SAMPLER_PID" 2>/dev/null || true
    wait "$SAMPLER_PID" 2>/dev/null || true
  fi
  SAMPLER_PID=""
}

start_sampler() {
  local out="$1"
  stop_sampler
  echo "iso,memfree_kib,memavail_kib" > "$out"
  (
    bad=0
    while true; do
      mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
      ma=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
      echo "$(date -Iseconds),$mf,$ma" >> "$out"
      if [ "$mf" -lt 307200 ]; then
        bad=$((bad + 1))
        echo "LOW MemFree=${mf} KiB consec=${bad}" | tee -a "$out"
        if [ "$bad" -ge 3 ]; then
          echo "ABORT MemFree=${mf} KiB < 300 MiB sustained (3x5s)" | tee -a "$out"
          pkill -f "$HOME/gdn_k2/k4split/bin/bmoe-cli" 2>/dev/null || true
        fi
      else
        bad=0
      fi
      sleep 5
    done
  ) &
  SAMPLER_PID=$!
}

run_one() {
  local name="$1"
  shift
  local csv="$WS/logs/n2/memfree_${name}.csv"
  log "START $name  cache-mb=$CACHE_MB  $*"
  batt_snap "${name}_pre"
  start_sampler "$csv"
  local t0 t1 rc
  t0=$(date +%s)
  set +e
  "$@" > "$WS/logs/n2/${name}.out" 2> "$WS/logs/n2/${name}.err"
  rc=$?
  set +e
  t1=$(date +%s)
  stop_sampler
  batt_snap "${name}_post"
  echo "$name wall_s=$((t1 - t0)) rc=$rc cache_mb=$CACHE_MB" | tee -a "$WS/logs/n2/summary.txt"
  if grep -q "ABORT MemFree" "$csv" 2>/dev/null; then
    echo "$name ABORTED_RAM" | tee -a "$WS/logs/n2/summary.txt"
    return 99
  fi
  return $rc
}

trap 'stop_sampler' EXIT

log "N2 begin cache-mb=$CACHE_MB"
batt_snap "n2_session_pre"
echo "plugged_note=PLUGGED_OK N2 is correctness not speed" | tee "$WS/logs/n2/battery_note.txt"
termux-battery-status 2>/dev/null | tee -a "$WS/logs/n2/battery_note.txt" || true

# ARM_CPU
run_one "n2_CPU_${TAG}" "$BIN" -m "$MODEL" -f "$WS/prompts/p_fact.txt" -n 32 -c 4096 \
  --temp 0 --seed 42 \
  $K6D065 $EXTRA --dense-weights anon \
  --ngl 0 --flash-attn off --moe-cpu-experts off
rccpu=$?
if [ "$rccpu" -eq 99 ]; then echo N2_BLOCKED_RAM; exit 99; fi

# ARM_A
run_one "n2_A_${TAG}" "$BIN" -m "$MODEL" -f "$WS/prompts/p_fact.txt" -n 32 -c 4096 \
  --temp 0 --seed 42 \
  $K6D065 $EXTRA --dense-weights anon \
  --ngl 99 --flash-attn off --moe-cpu-experts off
rca=$?
if [ "$rca" -eq 99 ]; then echo N2_BLOCKED_RAM; exit 99; fi

# ARM_B
run_one "n2_B_${TAG}" "$BIN" -m "$MODEL" -f "$WS/prompts/p_fact.txt" -n 32 -c 4096 \
  --temp 0 --seed 42 \
  $K6D065 $EXTRA --dense-weights anon \
  --ngl 99 --flash-attn off --moe-cpu-experts on
rcb=$?
if [ "$rcb" -eq 99 ]; then echo N2_BLOCKED_RAM; exit 99; fi

# ARM_AUTO
run_one "n2_AUTO_${TAG}" "$BIN" -m "$MODEL" -f "$WS/prompts/p_fact.txt" -n 32 -c 4096 \
  --temp 0 --seed 42 \
  $K6D065 $EXTRA --dense-weights anon-gpu \
  --ngl 99 --flash-attn off --moe-cpu-experts auto
rcauto=$?
if [ "$rcauto" -eq 99 ]; then echo N2_BLOCKED_RAM; exit 99; fi

batt_snap "n2_session_post"
echo "N2_DONE rccpu=$rccpu rca=$rca rcb=$rcb rcauto=$rcauto" | tee -a "$WS/logs/n2/summary.txt"
exit 0
