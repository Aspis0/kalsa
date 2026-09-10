#!/usr/bin/env bash
set -u

ROOT="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/g1-model-select/device"
XIAOMI="$ROOT/xiaomi"
SERIAL="192.168.1.193:35049"
CASES="$ROOT/subset-24.cases.jsonl"
RUNNER="$ROOT/run_device_subset.sh"
export ANDROID_SERIAL="$SERIAL"
export PATH="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/adb-jelly-wrapper:$PATH"

mkdir -p "$XIAOMI/supervisor"
export OUT="$XIAOMI/supervisor"
source /Users/marco/Projects/kalsa/scripts/device-env.sh

stop_for_battery_floor() {
  local arm="$1" level="$2" stamp
  stamp=$(date '+%Y-%m-%d %H:%M:%S %Z')
  echo "$stamp STOP battery_floor arm=$arm level=${level}% (<30%)"
  adb -s "$SERIAL" shell am force-stop com.kalsa.app </dev/null || true
}

watch_arm() {
  local arm="$1" out="$2" runlog="$3" runner_pid="$4"
  local last_check=0 now stamp last status count level
  while :; do
    now=$(date +%s)
    if (( now - last_check >= 300 )); then
      last_check=$now
      stamp=$(date '+%Y-%m-%d %H:%M:%S %Z')
      level=$(device_battery_level)
      if [[ "$level" =~ ^[0-9]+$ ]] && [ "$level" -lt 30 ]; then
        stop_for_battery_floor "$arm" "$level"
        kill -INT "$runner_pid" 2>/dev/null || true
        sleep 8
        return 3
      fi
      if [ -s "$out" ]; then
        last=$(tail -1 "$out")
        printf '%s\n' "$last" > "$XIAOMI/${arm}.last-row.json"
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
        printf '%s arm=%s rows=%s last_status=%s battery_level=%s\n' "$stamp" "$arm" "$count" "$status" "$level"
        if [ "$status" != ok ]; then
          printf '%s STOP first_non_ok arm=%s status=%s\n' "$stamp" "$arm" "$status"
          printf '%s\n' "$last" > "$XIAOMI/${arm}.first-nonok-row.json"
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
        printf '%s arm=%s rows=0 battery_level=%s\n' "$stamp" "$arm" "$level"
      fi
    fi
    sleep 30
  done
}

start_arm() {
  local arm="$1" model="$2" out="$3" runlog="$4"
  OUT="$XIAOMI/ev-$arm" REPLY_TIMEOUT=600 READY_TIMEOUT=600 \
    bash "$RUNNER" "$SERIAL" "$model" "$CASES" "$out" \
    > "$runlog" 2>&1 < /dev/null &
  printf '%s\n' "$!"
}

lfm_complete() {
  python3 - "$XIAOMI/lfm.out.jsonl" <<'PY'
import json, sys
rows = []
try:
    with open(sys.argv[1], encoding='utf-8') as f:
        for line in f:
            try:
                rows.append(json.loads(line))
            except Exception:
                pass
except FileNotFoundError:
    pass
print(1 if len(rows) == 24 and all(r.get('status') == 'ok' for r in rows) else 0)
PY
}

start_at_minicpm=0
if [ "${START_AT:-}" = minicpm ]; then
  if [ "$(lfm_complete)" = 1 ]; then
    start_at_minicpm=1
    echo "START_AT=minicpm verified 24 LFM ok rows; skipping LFM arm"
  else
    echo "START_AT=minicpm ignored: LFM output is not exactly 24 ok rows"
  fi
fi

if [ "$start_at_minicpm" -eq 0 ]; then
  lfm_pid=$(start_arm lfm lfm2.5-2.6b "$XIAOMI/lfm.out.jsonl" "$XIAOMI/lfm.run.log")
  printf 'lfm_runner_pid=%s\nstarted=%s\nreply_timeout=600\nready_timeout=600\n' \
    "$lfm_pid" "$(date '+%Y-%m-%d %H:%M:%S %Z')" > "$XIAOMI/lfm.start.txt"
  echo "started LFM arm pid=$lfm_pid"

  watch_arm lfm "$XIAOMI/lfm.out.jsonl" "$XIAOMI/lfm.run.log" "$lfm_pid"
  lfm_rc=$?
  if [ "$lfm_rc" -ne 0 ]; then
    echo "LFM arm stopped rc=$lfm_rc"
    exit "$lfm_rc"
  fi
fi

# The runner writes its completion marker before its EXIT trap restores the
# device state. Give that trap time to finish before taking ownership through
# the cooling interval and the second model arm.
sleep 10
device_keepawake_setup
trap 'device_keepawake_restore' EXIT
echo "keep-awake held by supervisor for LFM-to-MiniCPM5 cooling transition"

cool_start=$(date +%s)
while :; do
  battery=$(adb -s "$SERIAL" shell dumpsys battery </dev/null | awk -F: '/temperature:/ {gsub(/ /,"",$2); print $2; exit}')
  thermal=$(adb -s "$SERIAL" shell dumpsys thermalservice </dev/null | awk '/[Tt]hermal [Ss]tatus:/ {if (match($0, /[0-9]+/)) {print substr($0, RSTART, RLENGTH); exit}}')
  level=$(device_battery_level)
  stamp=$(date '+%Y-%m-%d %H:%M:%S %Z')
  echo "$stamp cool battery_deciC=${battery:-unknown} thermal_status=${thermal:-unknown} battery_level=${level:-unknown}"
  if [[ "$level" =~ ^[0-9]+$ ]] && [ "$level" -lt 30 ]; then
    stop_for_battery_floor cooling "$level"
    exit 3
  fi
  if [[ "$battery" =~ ^[0-9]+$ ]] && [[ "$thermal" =~ ^[0-9]+$ ]] && [ "$battery" -lt 360 ] && [ "$thermal" -le 1 ]; then
    break
  fi
  cool_elapsed=$(( $(date +%s) - cool_start ))
  if [ "$cool_elapsed" -ge 1800 ]; then
    echo "$stamp COOL-TIMEOUT elapsed_s=$cool_elapsed"
    exit 4
  fi
  sleep 30
done

echo "starting MiniCPM5 arm"
OUT="$XIAOMI/ev-minicpm" REPLY_TIMEOUT=600 READY_TIMEOUT=600 \
  bash "$RUNNER" "$SERIAL" dev-minicpm5-2b "$CASES" "$XIAOMI/minicpm.out.jsonl" \
  > "$XIAOMI/minicpm.run.log" 2>&1 < /dev/null &
mini_pid=$!
printf 'minicpm_runner_pid=%s\nstarted=%s\n' "$mini_pid" "$(date '+%Y-%m-%d %H:%M:%S %Z')" > "$XIAOMI/minicpm.start.txt"

watch_arm minicpm "$XIAOMI/minicpm.out.jsonl" "$XIAOMI/minicpm.run.log" "$mini_pid"
mini_rc=$?
if [ "$mini_rc" -ne 0 ]; then
  echo "MiniCPM5 arm stopped rc=$mini_rc"
  exit "$mini_rc"
fi

echo "both arms complete; scoring"
set +e
python3 "$ROOT/score_device.py" "$XIAOMI/lfm.out.jsonl" "$XIAOMI/minicpm.out.jsonl" \
  --cases "$CASES" | tee "$XIAOMI/SCORE.md"
score_rc=${PIPESTATUS[0]}
set -e
echo "score_rc=$score_rc"
exit "$score_rc"
