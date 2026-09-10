#!/usr/bin/env bash
set -u

ROOT="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/g1-model-select/device"
JELLY="$ROOT/jelly"
SERIAL="JELLYS0000053795"
LFM_CASES="$JELLY/lfm-remaining.cases.jsonl"
LFM_APPEND_OUT="$JELLY/lfm.out.jsonl"
LFM_RUN_OUT="$JELLY/lfm-remaining.run.jsonl"
LFM_RUN_LOG="$JELLY/lfm-remaining.run.log"
MINI_CASES="$ROOT/subset-24.cases.jsonl"
RUNNER="$ROOT/run_device_subset.sh"
export ANDROID_SERIAL="$SERIAL"
export PATH="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/adb-jelly-wrapper:$PATH"

mkdir -p "$JELLY/supervisor" "$JELLY/ev-lfm-remaining" "$JELLY/ev-minicpm"
export OUT="$JELLY/supervisor"
source /Users/marco/Projects/kalsa/scripts/device-env.sh

watch_arm() {
  local arm="$1" out="$2" runlog="$3" runner_pid="$4" expected="$5"
  local seen_file="$JELLY/${arm}.watch-seen" new_file="$JELLY/${arm}.watch-new.jsonl"
  local last_report=0 now stamp count last status id consecutive=0 nonok_total=0
  : > "$seen_file"
  : > "$new_file"
  while :; do
    now=$(date +%s)
    python3 - "$out" "$seen_file" "$new_file" <<'PY'
import hashlib, json, os, sys
out, seen_path, new_path = sys.argv[1:]
seen={x.strip() for x in open(seen_path, encoding='utf-8') if x.strip()} if os.path.exists(seen_path) else set()
new=[]
if os.path.exists(out):
    for line in open(out, encoding='utf-8'):
        line=line.strip()
        if not line:
            continue
        try:
            row=json.loads(line)
        except Exception:
            continue
        fp=hashlib.sha256(json.dumps(row, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        if fp not in seen:
            seen.add(fp)
            new.append(json.dumps(row, ensure_ascii=False))
with open(seen_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(sorted(seen)) + ('\n' if seen else ''))
with open(new_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(new) + ('\n' if new else ''))
PY
    if [ -s "$new_file" ]; then
      while IFS= read -r row; do
        status=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("status", ""))' "$row")
        id=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("id", ""))' "$row")
        if [ "$status" = ok ]; then
          consecutive=0
        else
          consecutive=$((consecutive + 1))
          nonok_total=$((nonok_total + 1))
          printf '%s\n' "$row" > "$JELLY/${arm}.nonok-${nonok_total}.json"
          printf '%s arm=%s non_ok=%s id=%s consecutive=%s\n' \
            "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$arm" "$status" "$id" "$consecutive"
          if [ "$consecutive" -ge 3 ]; then
            printf '%s STOP three_consecutive_non_ok arm=%s\n' \
              "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$arm"
            kill -INT "$runner_pid" 2>/dev/null || true
            sleep 8
            adb -s "$SERIAL" shell am force-stop com.kalsa.app </dev/null || true
            return 3
          fi
        fi
      done < "$new_file"
    fi
    if (( now - last_report >= 300 )); then
      last_report=$now
      stamp=$(date '+%Y-%m-%d %H:%M:%S %Z')
      count=$(python3 - "$out" <<'PY'
import sys
try:
    print(sum(1 for line in open(sys.argv[1], encoding='utf-8') if line.strip()))
except FileNotFoundError:
    print(0)
PY
      )
      if [ "$count" -gt 0 ]; then
        last=$(tail -1 "$out")
        printf '%s\n' "$last" > "$JELLY/${arm}.last-row.json"
        status=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("status", ""))' "$last")
        id=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("id", ""))' "$last")
        printf '%s arm=%s rows=%s last_id=%s last_status=%s\n' "$stamp" "$arm" "$count" "$id" "$status"
      else
        printf '%s arm=%s rows=0\n' "$stamp" "$arm"
      fi
    fi
    if grep -q 'run complete:' "$runlog" 2>/dev/null && [ "$count" -ge "$expected" ]; then
      return 0
    fi
    sleep 30
  done
}

start_arm() {
  local model="$1" cases="$2" out="$3" runlog="$4" evidence="$5"
  OUT="$evidence" REPLY_TIMEOUT=600 READY_TIMEOUT=600 \
    bash "$RUNNER" "$SERIAL" "$model" "$cases" "$out" \
    > "$runlog" 2>&1 < /dev/null &
  ARM_PID=$!
}

if [ -e "$LFM_RUN_OUT" ]; then
  echo "refusing to overwrite existing temporary LFM output: $LFM_RUN_OUT" >&2
  exit 2
fi

start_arm lfm2.5-2.6b "$LFM_CASES" "$LFM_RUN_OUT" "$LFM_RUN_LOG" "$JELLY/ev-lfm-remaining"
lfm_pid=$ARM_PID
printf 'lfm_runner_pid=%s\nstarted=%s\nreply_timeout=600\nready_timeout=600\n' \
  "$lfm_pid" "$(date '+%Y-%m-%d %H:%M:%S %Z')" > "$JELLY/lfm-remaining.start.txt"
echo "started LFM remaining arm pid=$lfm_pid cases=$LFM_CASES"

watch_arm lfm-remaining "$LFM_RUN_OUT" "$LFM_RUN_LOG" "$lfm_pid" 4
lfm_watch_rc=$?
set +e
wait "$lfm_pid"
lfm_child_rc=$?
set -e
if [ -s "$LFM_RUN_OUT" ]; then
  cat "$LFM_RUN_OUT" >> "$LFM_APPEND_OUT"
  echo "appended $(wc -l < "$LFM_RUN_OUT" | tr -d ' ') resumed LFM rows to $LFM_APPEND_OUT"
fi
if [ "$lfm_watch_rc" -ne 0 ] || [ "$lfm_child_rc" -ne 0 ]; then
  echo "LFM remaining arm stopped watch_rc=$lfm_watch_rc child_rc=$lfm_child_rc"
  exit 3
fi

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

echo "starting MiniCPM5 full arm"
start_arm dev-minicpm5-2b "$MINI_CASES" "$JELLY/minicpm.out.jsonl" "$JELLY/minicpm.run.log" "$JELLY/ev-minicpm"
mini_pid=$ARM_PID
printf 'minicpm_runner_pid=%s\nstarted=%s\nreply_timeout=600\nready_timeout=600\n' \
  "$mini_pid" "$(date '+%Y-%m-%d %H:%M:%S %Z')" > "$JELLY/minicpm.start.txt"
watch_arm minicpm "$JELLY/minicpm.out.jsonl" "$JELLY/minicpm.run.log" "$mini_pid" 24
mini_watch_rc=$?
set +e
wait "$mini_pid"
mini_child_rc=$?
set -e
if [ "$mini_watch_rc" -ne 0 ] || [ "$mini_child_rc" -ne 0 ]; then
  echo "MiniCPM5 arm stopped watch_rc=$mini_watch_rc child_rc=$mini_child_rc"
  exit 3
fi

dedupe_last_ok() {
  python3 - "$1" "$2" <<'PY'
import json, sys
src, dst = sys.argv[1:]
rows=[json.loads(line) for line in open(src, encoding='utf-8') if line.strip()]
ids=[]; last={}; last_ok={}
for row in rows:
    cid=row.get('id')
    if cid not in last:
        ids.append(cid)
    last[cid]=row
    if row.get('status') == 'ok':
        last_ok[cid]=row
with open(dst, 'w', encoding='utf-8') as f:
    for cid in ids:
        f.write(json.dumps(last_ok.get(cid, last[cid]), ensure_ascii=False) + '\n')
print('deduped', src, '->', dst, 'rows=', len(ids))
PY
}

echo "both arms complete; deduping last-ok-per-id score inputs"
dedupe_last_ok "$LFM_APPEND_OUT" "$JELLY/lfm-score-dedup.jsonl"
dedupe_last_ok "$JELLY/minicpm.out.jsonl" "$JELLY/minicpm-score-dedup.jsonl"
set +e
python3 "$ROOT/score_device.py" "$JELLY/lfm-score-dedup.jsonl" "$JELLY/minicpm-score-dedup.jsonl" \
  --cases "$MINI_CASES" | tee "$JELLY/SCORE.md"
score_rc=${PIPESTATUS[0]}
set -e
echo "score_rc=$score_rc"
exit "$score_rc"
