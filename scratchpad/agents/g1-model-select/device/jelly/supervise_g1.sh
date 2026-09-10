#!/usr/bin/env bash
set -u

ROOT="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/g1-model-select/device"
JELLY="$ROOT/jelly"
SERIAL="JELLYS0000053795"
CASES="$ROOT/subset-24.cases.jsonl"
RUNNER="$ROOT/run_device_subset.sh"
export ANDROID_SERIAL="$SERIAL"
export PATH="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/adb-jelly-wrapper:$PATH"

mkdir -p "$JELLY/supervisor"
export OUT="$JELLY/supervisor"
source /Users/marco/Projects/kalsa/scripts/device-env.sh

watch_arm() {
  local arm="$1" out="$2" runlog="$3" runner_pid="$4"
  local last_check=0 now stamp last status count
  while :; do
    now=$(date +%s)
    if (( now - last_check >= 300 )); then
      last_check=$now
      stamp=$(date '+%Y-%m-%d %H:%M:%S %Z')
      if [ -s "$out" ]; then
        last=$(tail -1 "$out")
        printf '%s\n' "$last" > "$JELLY/${arm}.last-row.json"
        read -r count status < <(python3 - "$out" <<'PY'
import json, sys
rows=[]
with open(sys.argv[1], encoding='utf-8') as f:
    for line in f:
        try:
            rows.append(json.loads(line))
        except Exception:
            pass
row=rows[-1] if rows else {}
print(len(rows), row.get('status', ''))
PY
        )
        printf '%s arm=%s rows=%s last_status=%s\n' "$stamp" "$arm" "$count" "$status"
        if [ "$status" != ok ]; then
          printf '%s STOP first_non_ok arm=%s status=%s\n' "$stamp" "$arm" "$status"
          printf '%s\n' "$last" > "$JELLY/${arm}.first-nonok-row.json"
          kill -INT "$runner_pid" 2>/dev/null || true
          sleep 8
          adb -s "$SERIAL" shell am force-stop com.kalsa.app </dev/null || true
          return 3
        fi
        if [ "$count" -ge 24 ]; then
          printf '%s arm=%s all_24_rows_ok\n' "$stamp" "$arm"
          return 0
        fi
      else
        printf '%s arm=%s rows=0\n' "$stamp" "$arm"
      fi
    fi
    sleep 30
  done
}

start_arm() {
  local arm="$1" model="$2" out="$3" runlog="$4"
  OUT="$JELLY/ev-$arm" REPLY_TIMEOUT=600 READY_TIMEOUT=600 \
    bash "$RUNNER" "$SERIAL" "$model" "$CASES" "$out" \
    > "$runlog" 2>&1 < /dev/null &
  printf '%s\n' "$!"
}

lfm_pid=$(start_arm lfm lfm2.5-2.6b "$JELLY/lfm.out.jsonl" "$JELLY/lfm.run.log")
printf 'lfm_runner_pid=%s\nstarted=%s\nreply_timeout=600\nready_timeout=600\n' \
  "$lfm_pid" "$(date '+%Y-%m-%d %H:%M:%S %Z')" > "$JELLY/lfm.start.txt"
echo "started LFM arm pid=$lfm_pid"

watch_arm lfm "$JELLY/lfm.out.jsonl" "$JELLY/lfm.run.log" "$lfm_pid"
lfm_rc=$?
if [ "$lfm_rc" -ne 0 ]; then
  echo "LFM arm stopped rc=$lfm_rc"
  exit "$lfm_rc"
fi

# The runner writes its completion marker before its EXIT trap restores the
# device state. Give that trap time to finish before taking ownership through
# the cooling interval and the second model arm.
sleep 10
device_keepawake_setup
trap 'device_keepawake_restore' EXIT
echo "keep-awake held by supervisor for LFM-to-MiniCPM5 cooling transition"

while :; do
  battery=$(adb -s "$SERIAL" shell dumpsys battery </dev/null | awk -F: '/temperature:/ {gsub(/ /,"",$2); print $2; exit}')
  thermal=$(adb -s "$SERIAL" shell dumpsys thermalservice </dev/null | awk -F: '/Current thermal status:/ {gsub(/ /,"",$2); print $2; exit}')
  stamp=$(date '+%Y-%m-%d %H:%M:%S %Z')
  echo "$stamp cool battery_deciC=${battery:-unknown} thermal_status=${thermal:-unknown}"
  if [[ "$battery" =~ ^[0-9]+$ ]] && [[ "$thermal" =~ ^[0-9]+$ ]] && [ "$battery" -lt 360 ] && [ "$thermal" -le 1 ]; then
    break
  fi
  sleep 30
done

echo "starting MiniCPM5 arm"
OUT="$JELLY/ev-minicpm" REPLY_TIMEOUT=600 READY_TIMEOUT=600 \
  bash "$RUNNER" "$SERIAL" dev-minicpm5-2b "$CASES" "$JELLY/minicpm.out.jsonl" \
  > "$JELLY/minicpm.run.log" 2>&1 < /dev/null &
mini_pid=$!
printf 'minicpm_runner_pid=%s\nstarted=%s\n' "$mini_pid" "$(date '+%Y-%m-%d %H:%M:%S %Z')" > "$JELLY/minicpm.start.txt"

watch_arm minicpm "$JELLY/minicpm.out.jsonl" "$JELLY/minicpm.run.log" "$mini_pid"
mini_rc=$?
if [ "$mini_rc" -ne 0 ]; then
  echo "MiniCPM5 arm stopped rc=$mini_rc"
  exit "$mini_rc"
fi

echo "both arms complete; scoring"
set +e
python3 "$ROOT/score_device.py" "$JELLY/lfm.out.jsonl" "$JELLY/minicpm.out.jsonl" \
  --cases "$CASES" | tee "$JELLY/SCORE.md"
score_rc=${PIPESTATUS[0]}
set -e
echo "score_rc=$score_rc"
exit "$score_rc"
