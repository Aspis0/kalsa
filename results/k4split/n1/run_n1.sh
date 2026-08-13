#!/data/data/com.termux/files/usr/bin/bash
# N1 load + RAM smoke. PLUGGED OK. Do not start N3/N4.
# Abort if MemFree < 300 MiB sustained (3 consecutive 5s samples).
set -u
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export WS="$HOME/gdn_k2/k4split"
export BIN="$WS/bin/bmoe-cli"
export LIB="$WS/bin"
export MODEL="$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf"
export LD_LIBRARY_PATH="$LIB:/vendor/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PROMPT="Say OK in one word."
CACHE_MB="${CACHE_MB:-2000}"
FORCE_CACHE="${FORCE_CACHE:-}"
K6D065="-t 4 --moe-stream --cache-mb ${CACHE_MB} --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65"
mkdir -p "$WS/logs" "$WS/logs/n1"
TAG="c${CACHE_MB}"
SAMPLER_PID=""

log() { echo "$(date -Iseconds) $*"; }

batt_snap() {
  local name="$1"
  awk '/MemFree:|MemAvailable:|MemTotal:|Cached:|Buffers:|SwapFree:|SwapTotal:/' /proc/meminfo \
    | tee "$WS/logs/n1/mem_${name}.txt"
  termux-battery-status 2>/dev/null | tee "$WS/logs/n1/batt_${name}.json" || true
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
  local csv="$WS/logs/n1/memfree_${name}.csv"
  log "START $name  cache-mb=$CACHE_MB  $*"
  batt_snap "${name}_pre"
  start_sampler "$csv"
  local t0 t1 rc
  t0=$(date +%s)
  set +e
  "$@" > "$WS/logs/n1/${name}.out" 2> "$WS/logs/n1/${name}.err"
  rc=$?
  set +e
  t1=$(date +%s)
  stop_sampler
  batt_snap "${name}_post"
  echo "$name wall_s=$((t1 - t0)) rc=$rc cache_mb=$CACHE_MB" | tee -a "$WS/logs/n1/summary.txt"
  if grep -q "ABORT MemFree" "$csv" 2>/dev/null; then
    echo "$name ABORTED_RAM" | tee -a "$WS/logs/n1/summary.txt"
    return 99
  fi
  return $rc
}

trap 'stop_sampler' EXIT

log "N1 begin cache-mb=$CACHE_MB force=$FORCE_CACHE"
batt_snap "n1_session_pre"
echo "plugged_note=PLUGGED_OK N1 is load/correctness not speed" | tee "$WS/logs/n1/battery_note.txt"
termux-battery-status 2>/dev/null | tee -a "$WS/logs/n1/battery_note.txt" || true

EXTRA=""
if [ -n "$FORCE_CACHE" ]; then
  EXTRA="--force-cache"
fi

# 6a. ctx 512, n=8, ARM_B
run_one "n1_c512_B_${TAG}" "$BIN" -m "$MODEL" -p "$PROMPT" -n 8 -c 512 \
  $K6D065 $EXTRA --dense-weights anon \
  --ngl 99 --flash-attn off --moe-cpu-experts on
rc512=$?
if [ "$rc512" -eq 99 ]; then
  echo "N1_BLOCKED_RAM after c512" | tee -a "$WS/logs/n1/summary.txt"
  exit 99
fi

# 6b. ONE sched-debug run (ctx 512)
export GGML_SCHED_DEBUG=2
run_one "n1_sched_B_${TAG}" "$BIN" -m "$MODEL" -p "$PROMPT" -n 8 -c 512 \
  $K6D065 $EXTRA --dense-weights anon \
  --ngl 99 --flash-attn off --moe-cpu-experts on
rcsched=$?
unset GGML_SCHED_DEBUG
if [ "$rcsched" -eq 99 ]; then
  echo "N1_BLOCKED_RAM after sched" | tee -a "$WS/logs/n1/summary.txt"
  exit 99
fi

# 6c. ctx 4096, n=8, ARM_B
run_one "n1_c4096_B_${TAG}" "$BIN" -m "$MODEL" -p "$PROMPT" -n 8 -c 4096 \
  $K6D065 $EXTRA --dense-weights anon \
  --ngl 99 --flash-attn off --moe-cpu-experts on
rc4096=$?
if [ "$rc4096" -eq 99 ]; then
  echo "N1_BLOCKED_RAM after c4096" | tee -a "$WS/logs/n1/summary.txt"
  exit 99
fi

batt_snap "n1_session_post"
log "N1 done rc512=$rc512 rcsched=$rcsched rc4096=$rc4096"
if [ "$rc512" -eq 0 ] && [ "$rcsched" -eq 0 ] && [ "$rc4096" -eq 0 ]; then
  echo "N1_OK cache-mb=$CACHE_MB" | tee -a "$WS/logs/n1/summary.txt"
  exit 0
fi
echo "N1_FAIL rc512=$rc512 rcsched=$rcsched rc4096=$rc4096" | tee -a "$WS/logs/n1/summary.txt"
exit 1
