#!/system/bin/sh
# Phase 2b: greedy A/B + FA probe. Plugged OK.
set -u
ROOT=/data/local/tmp/gdn_750
export LD_LIBRARY_PATH="$ROOT/bin:/vendor/lib64:/system/vendor/lib64"
BIN="$ROOT/bin"
LOG="$ROOT/logs"
MODEL="$ROOT/Qwen3.5-2B-Q4_K_M.gguf"
# SM8650 campaign rule: 6 cores with cpu_capacity >= 50% of max.
T=6
PROMPT="The capital of France is"
STATUS="$LOG/phase2b_status.txt"

ts() { date '+%Y-%m-%dT%H:%M:%S'; }

batt() {
  tag="$1"
  {
    echo "=== battery ${tag} $(ts) ==="
    dumpsys battery
    echo "=== therm-max ${tag} ==="
    # highest readable zone in millidegC
    max=0
    for f in /sys/class/thermal/thermal_zone*/temp; do
      v=$(cat "$f" 2>/dev/null) || continue
      case "$v" in
        ''|*[!0-9-]*) continue ;;
      esac
      if [ "$v" -gt "$max" ] 2>/dev/null; then max=$v; fi
    done
    echo "max_therm_mC=$max"
  } | tee -a "$LOG/battery_notes.txt"
}

echo "$(ts) PHASE2B begin t=$T" > "$STATUS"

batt before_greedy_cpu
echo "$(ts) START greedy_cpu" | tee -a "$STATUS"
printf '%s\n' "$PROMPT" | "$BIN/llama-cli" -m "$MODEL" -c 512 --temp 0 -s 42 -n 32 -no-cnv -st -ngl 0 -t "$T" > "$LOG/greedy_cpu.txt" 2> "$LOG/greedy_cpu.err"
echo "$(ts) END greedy_cpu EXIT=$?" | tee -a "$STATUS"
batt after_greedy_cpu

batt before_greedy_gpu
echo "$(ts) START greedy_gpu_faoff" | tee -a "$STATUS"
printf '%s\n' "$PROMPT" | "$BIN/llama-cli" -m "$MODEL" -c 512 --temp 0 -s 42 -n 32 -no-cnv -st -ngl 99 -fa off -t "$T" > "$LOG/greedy_gpu_faoff.txt" 2> "$LOG/greedy_gpu_faoff.err"
echo "$(ts) END greedy_gpu_faoff EXIT=$?" | tee -a "$STATUS"
batt after_greedy_gpu

# FA auto/on probe — expect A7X FLASH_ATTN compile failure
batt before_fa_probe
echo "$(ts) START greedy_gpu_fa_auto" | tee -a "$STATUS"
printf '%s\n' "$PROMPT" | "$BIN/llama-cli" -m "$MODEL" -c 512 --temp 0 -s 42 -n 8 -no-cnv -st -ngl 99 -t "$T" > "$LOG/greedy_gpu_fa_auto.txt" 2> "$LOG/greedy_gpu_fa_auto.err"
echo "$(ts) END greedy_gpu_fa_auto EXIT=$?" | tee -a "$STATUS"
batt after_fa_probe

echo "$(ts) PHASE2B done" | tee -a "$STATUS"
