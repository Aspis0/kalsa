#!/bin/bash
set -uo pipefail

ROOT=/Users/marco/Projects/kalsa
TURN_DIR=${1:?turn output directory required}
QUESTION=${2:?question required}
TIMEOUT=${3:-1800}
SERIAL=JELLYS0000053795
WRAPPER=/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/adb-jelly-wrapper

export ANDROID_SERIAL="$SERIAL"
export PATH="$WRAPPER:$PATH"
export BENCH_TARGET=device
export OUT="$TURN_DIR"
mkdir -p "$TURN_DIR"

source "$ROOT/scripts/device-share-send.sh"

now_ms() { /opt/homebrew/bin/python3 -c 'import time; print(int(time.time()*1000))'; }

get_messages() {
  local tag=${1:-read}
  local idx cid key val
  idx=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" 2>"$TURN_DIR/sql_${tag}_index.err" || true)
  printf '%s\n' "$idx" >"$TURN_DIR/sql_${tag}_index.txt"
  cid=$(resolve_active_conversation_id "$idx" 2>"$TURN_DIR/sql_${tag}_resolve.err" || true)
  printf '%s\n' "$cid" >"$TURN_DIR/sql_${tag}_conversation_id.txt"
  if [ -n "$cid" ]; then
    key=$(messages_storage_key "$cid")
    val=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$key';" 2>"$TURN_DIR/sql_${tag}_messages.err" || true)
    printf '%s\n' "$val"
  else
    printf '[]\n'
  fi
}

extract_assistant_count() {
  local file=$1
  /opt/homebrew/bin/python3 - "$file" <<'PY'
import json, sys
try:
    d=json.load(open(sys.argv[1]))
except Exception:
    print(0)
    raise SystemExit
print(sum(1 for m in d if isinstance(m,dict) and m.get('role')=='assistant'))
PY
}

extract_state() {
  local file=$1 base=$2
  /opt/homebrew/bin/python3 - "$file" "$base" <<'PY'
import json, sys
try:
    d=json.load(open(sys.argv[1]))
except Exception:
    print('{"assistant_count":0,"complete":false,"has_text":false}')
    raise SystemExit
base=int(sys.argv[2])
aa=[m for m in d if isinstance(m,dict) and m.get('role')=='assistant']
last=aa[-1] if aa else {}
text=last.get('text') or last.get('content') or ''
if not isinstance(text,str): text=str(text)
complete=len(aa)>base and bool(text.strip()) and not bool(last.get('streaming')) and not bool(last.get('interrupted'))
print(json.dumps({'assistant_count':len(aa),'complete':complete,'has_text':bool(text.strip())},ensure_ascii=False))
PY
}

write_last_reply() {
  local file=$1 out=$2
  /opt/homebrew/bin/python3 - "$file" >"$out" <<'PY'
import json, sys
try:
    d=json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit
aa=[m for m in d if isinstance(m,dict) and m.get('role')=='assistant']
if aa:
    text=aa[-1].get('text') or aa[-1].get('content') or ''
    if not isinstance(text,str): text=str(text)
    sys.stdout.write(text)
PY
}

capture_ui() {
  local tag=$1
  adb shell uiautomator dump "/sdcard/window_${tag}.xml" >"$TURN_DIR/ui_${tag}_cmd.log" 2>&1
  echo "rc=$?" >>"$TURN_DIR/ui_${tag}_cmd.log"
  adb shell cat "/sdcard/window_${tag}.xml" >"$TURN_DIR/ui_${tag}.xml" 2>"$TURN_DIR/ui_${tag}_cat.err"
}

capture_probe() {
  local tag=$1
  capture_sysprobe_snapshot "$TURN_DIR" "$tag" >"$TURN_DIR/sysprobe_${tag}.log" 2>&1 || true
}

parse_telemetry() {
  /opt/homebrew/bin/python3 - "$TURN_DIR/logcat_full.txt" >"$TURN_DIR/telemetry.jsonl" <<'PY'
import json, sys
for line in open(sys.argv[1], errors='replace'):
    if 'KALSA_TELEMETRY' not in line:
        continue
    s=line.split('KALSA_TELEMETRY',1)[1].strip()
    try:
        if not s.startswith('{'):
            s=s[s.index('{'):]
        print(json.dumps(json.loads(s),ensure_ascii=False))
    except Exception:
        pass
PY
  /opt/homebrew/bin/python3 - "$TURN_DIR/telemetry.jsonl" "$TURN_DIR" <<'PY'
import json, sys, glob, re, os
rows=[]
try:
    rows=[json.loads(x) for x in open(sys.argv[1]) if x.strip()]
except Exception: pass
out=[]
for r in rows:
    out.append('telemetry '+json.dumps(r,ensure_ascii=False,sort_keys=True))
rss=[]; temps=[]
for f in glob.glob(os.path.join(sys.argv[2],'sysprobe_*.txt')):
    txt=open(f,errors='replace').read()
    for m in re.finditer(r'Vm(?:HWM|RSS):\s+(\d+)\s+kB',txt): rss.append(int(m.group(1)))
    for m in re.finditer(r'temperature[^\n]*?([0-9]+(?:\.[0-9]+)?)',txt,re.I):
        try: temps.append(float(m.group(1)))
        except: pass
if rss: out.append('rss_peak_kb='+str(max(rss)))
if temps: out.append('temperature_max='+str(max(temps)))
open(os.path.join(sys.argv[2],'metrics_summary.txt'),'w').write('\n'.join(out)+'\n')
PY
}

printf '%s' "$QUESTION" >"$TURN_DIR/question.txt"
date -u +%FT%TZ >"$TURN_DIR/started_utc.txt"
start_ms=$(now_ms)
printf '%s\n' "$start_ms" >"$TURN_DIR/start_ms.txt"

get_messages before >"$TURN_DIR/messages_before.json"
base_count=$(extract_assistant_count "$TURN_DIR/messages_before.json")
printf '%s\n' "$base_count" >"$TURN_DIR/assistant_count_before.txt"
capture_ui before
capture_probe pre

adb logcat -c >"$TURN_DIR/logcat_clear.log" 2>&1
echo "rc=$?" >>"$TURN_DIR/logcat_clear.log"

share_start=$(now_ms)
device_share_send "$QUESTION" >"$TURN_DIR/share_send.log" 2>&1
share_rc=$?
share_end=$(now_ms)
printf 'rc=%s\nstart_ms=%s\nend_ms=%s\n' "$share_rc" "$share_start" "$share_end" >"$TURN_DIR/share_result.txt"

first_ms=''
first_note=''
completed=0
poll=0
deadline=$((share_end + TIMEOUT*1000))
while :; do
  poll=$((poll+1))
  polltag=$(printf '%03d' "$poll")
  get_messages "poll_$polltag" >"$TURN_DIR/messages_poll_$polltag.json"
  mf="$TURN_DIR/messages_poll_$polltag.json"
  extract_state "$mf" "$base_count" >"$TURN_DIR/state_$polltag.json"
  state=$(cat "$TURN_DIR/state_$polltag.json")
  if [ -z "$first_ms" ]; then
    if /opt/homebrew/bin/python3 - "$mf" "$base_count" <<'PY'
import json,sys
try: d=json.load(open(sys.argv[1]))
except: raise SystemExit(1)
aa=[m for m in d if isinstance(m,dict) and m.get('role')=='assistant']
if len(aa)>int(sys.argv[2]) and str(aa[-1].get('text') or aa[-1].get('content') or '').strip(): raise SystemExit(0)
raise SystemExit(1)
PY
    then
      first_ms=$(now_ms); first_note=assistant_text_in_messages
    fi
  fi
  if /opt/homebrew/bin/python3 - "$TURN_DIR/state_$polltag.json" <<'PY'
import json,sys
try: raise SystemExit(0 if json.load(open(sys.argv[1])).get('complete') else 1)
except SystemExit: raise
except: raise SystemExit(1)
PY
  then
    completed=1
    write_last_reply "$mf" "$TURN_DIR/reply_verbatim.txt"
    printf '%s\n' "$mf" >"$TURN_DIR/completed_message_file.txt"
    break
  fi
  now=$(now_ms)
  if [ "$now" -ge "$deadline" ]; then break; fi
  adb logcat -d -v time >"$TURN_DIR/logcat_poll_$polltag.txt" 2>&1
  echo "rc=$?" >>"$TURN_DIR/logcat_poll_$polltag.txt"
  grep -E 'KALSA_TELEMETRY|KALSA_TOOL|document|Document|pdf|PDF|extract|error|Error|Exception|thermal|temperature' "$TURN_DIR/logcat_poll_$polltag.txt" | tail -20 >"$TURN_DIR/logcat_tail_$polltag.txt" || true
  capture_probe "poll_$polltag"
  /bin/sleep 5
done

end_ms=$(now_ms)
printf '%s\n' "$end_ms" >"$TURN_DIR/end_ms.txt"
printf 'completed=%s\nfirst_visible_ms=%s\nfirst_visible_note=%s\ncompletion_ms=%s\n' "$completed" "$first_ms" "$first_note" "$end_ms" >"$TURN_DIR/timing_raw.txt"
if [ -n "$first_ms" ]; then
  echo "first_visible_after_share_ms=$((first_ms-share_end))" >>"$TURN_DIR/timing_raw.txt"
fi
echo "completion_after_share_ms=$((end_ms-share_end))" >>"$TURN_DIR/timing_raw.txt"

if [ "$completed" -eq 0 ]; then
  get_messages final >"$TURN_DIR/messages_final.json"
  write_last_reply "$TURN_DIR/messages_final.json" "$TURN_DIR/reply_verbatim.txt"
fi
adb logcat -d -v time >"$TURN_DIR/logcat_full.txt" 2>&1
echo "rc=$?" >>"$TURN_DIR/logcat_full.txt"
grep -E 'KALSA_TELEMETRY|KALSA_TOOL|document|Document|pdf|PDF|extract|error|Error|Exception|thermal|temperature' "$TURN_DIR/logcat_full.txt" | tail -200 >"$TURN_DIR/logcat_relevant_tail.txt" || true
capture_ui final
capture_probe post
parse_telemetry
date -u +%FT%TZ >"$TURN_DIR/finished_utc.txt"
printf 'completed=%s\n' "$completed"
cat "$TURN_DIR/timing_raw.txt"
printf 'reply_bytes=%s\n' "$(wc -c <"$TURN_DIR/reply_verbatim.txt" 2>/dev/null || echo 0)"
