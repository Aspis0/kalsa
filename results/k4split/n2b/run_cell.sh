#!/data/data/com.termux/files/usr/bin/bash
# N2b cells — config/CLI pins only. 45-min kill-gate. No timed/speed cells.
set -u
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export WS="$HOME/gdn_k2/k4split"
export BIN="$WS/bin/bmoe-cli"
export LIB="$WS/bin"
export MODEL="$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf"
export LD_LIBRARY_PATH="$LIB:/vendor/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
LOG="$WS/logs/n2b"
mkdir -p "$LOG"

cell="${1:-e1_router_cpu}"
echo "=== N2b cell=$cell start $(date -Iseconds) ===" | tee "$LOG/${cell}_meta.txt"

termux-battery-status 2>/dev/null | tee "$LOG/${cell}_batt_pre.json" || true
awk '/MemFree:|MemAvailable:|MemTotal:/' /proc/meminfo | tee "$LOG/${cell}_mem_pre.txt"

CSV="$LOG/memfree_${cell}.csv"
echo "iso,memfree_kib,memavail_kib" > "$CSV"
(
  bad=0
  while true; do
    mf=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
    ma=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
    echo "$(date -Iseconds),$mf,$ma" >> "$CSV"
    if [ "$mf" -lt 307200 ]; then
      bad=$((bad+1))
      if [ "$bad" -ge 12 ]; then
        echo "ABORT MemFree=${mf} KiB < 300 MiB sustained 60s" | tee -a "$CSV"
        pkill -f "$BIN" 2>/dev/null || true
        exit 0
      fi
    else
      bad=0
    fi
    sleep 5
  done
) &
SPID=$!

(
  sleep 2700
  echo "KILLGATE 45min $(date -Iseconds)" | tee -a "$LOG/${cell}_kill.txt"
  pkill -f "$BIN" 2>/dev/null || true
) &
KPID=$!

PROMPT=$(cat "$WS/prompts/p_fact.txt")
K6D065="-t 4 --moe-stream --cache-mb 1000 --force-cache --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65"

rc=99
set +e
case "$cell" in
  e1_router_cpu)
    # Pin only the MoE router weight (not shexp). One variable.
    "$BIN" -m "$MODEL" -p "$PROMPT" -n 32 -c 4096 \
      --temp 0 --seed 42 \
      $K6D065 --dense-weights anon \
      --ngl 99 --flash-attn off --moe-cpu-experts on \
      --override-tensor "ffn_gate_inp.weight=CPU" \
      > "$LOG/${cell}.out" 2> "$LOG/${cell}.err"
    rc=$?
    ;;
  e1b_n2gate_cpu)
    # N2 re-gate CPU arm (same config of record)
    "$BIN" -m "$MODEL" -p "$PROMPT" -n 32 -c 4096 \
      --temp 0 --seed 42 \
      $K6D065 --dense-weights anon \
      --ngl 0 --flash-attn off --moe-cpu-experts off \
      > "$LOG/${cell}.out" 2> "$LOG/${cell}.err"
    rc=$?
    ;;
  e1b_n2gate_pin)
    # N2 re-gate split + router pin
    "$BIN" -m "$MODEL" -p "$PROMPT" -n 32 -c 4096 \
      --temp 0 --seed 42 \
      $K6D065 --dense-weights anon \
      --ngl 99 --flash-attn off --moe-cpu-experts on \
      --override-tensor "ffn_gate_inp.weight=CPU" \
      > "$LOG/${cell}.out" 2> "$LOG/${cell}.err"
    rc=$?
    ;;
  e3_routes_cpu)
    "$BIN" -m "$MODEL" -p "$PROMPT" -n 32 -c 4096 \
      --temp 0 --seed 42 \
      $K6D065 --dense-weights anon \
      --ngl 0 --flash-attn off --moe-cpu-experts off \
      --route-trace "$LOG/${cell}.routes.jsonl" \
      > "$LOG/${cell}.out" 2> "$LOG/${cell}.err"
    rc=$?
    ;;
  e3_routes_split)
    "$BIN" -m "$MODEL" -p "$PROMPT" -n 32 -c 4096 \
      --temp 0 --seed 42 \
      $K6D065 --dense-weights anon \
      --ngl 99 --flash-attn off --moe-cpu-experts on \
      --route-trace "$LOG/${cell}.routes.jsonl" \
      > "$LOG/${cell}.out" 2> "$LOG/${cell}.err"
    rc=$?
    ;;
  e3_routes_pin)
    "$BIN" -m "$MODEL" -p "$PROMPT" -n 32 -c 4096 \
      --temp 0 --seed 42 \
      $K6D065 --dense-weights anon \
      --ngl 99 --flash-attn off --moe-cpu-experts on \
      --override-tensor "ffn_gate_inp.weight=CPU" \
      --route-trace "$LOG/${cell}.routes.jsonl" \
      > "$LOG/${cell}.out" 2> "$LOG/${cell}.err"
    rc=$?
    ;;
  *)
    echo "unknown cell: $cell" | tee -a "$LOG/${cell}_meta.txt"
    rc=2
    ;;
esac
set -u

kill -9 "$KPID" 2>/dev/null || true
kill -9 "$SPID" 2>/dev/null || true
# do not wait — leftover sleep(5) must not hold the ssh session

echo "rc=$rc" | tee "$LOG/${cell}.rc"
termux-battery-status 2>/dev/null | tee "$LOG/${cell}_batt_post.json" || true
awk '/MemFree:|MemAvailable:|MemTotal:/' /proc/meminfo | tee "$LOG/${cell}_mem_post.txt"

{
  echo "=== cell=$cell rc=$rc $(date -Iseconds) ==="
  grep -E 'placement |ram-guard |routing tensor|buffer type overridden to CPU|extra_ot|dense-weights|moe-stream:|moe-cache:|generation:' "$LOG/${cell}.err" | tail -n 80
  echo "--- out after think ---"
  awk 'f{print} /<\/think>/{f=1}' "$LOG/${cell}.out" | head -n 20
} | tee "$LOG/${cell}_summary.txt"

echo "=== N2b cell=$cell done rc=$rc $(date -Iseconds) ==="
exit "$rc"
