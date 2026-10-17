#!/bin/bash
# One full normal-use turn: stop-rule gate -> send -> wait for the governor row
# -> post-sample. Usage:
#
#   cycle.sh <turn_no> "<prompt>" [new_chat]
#
# Stop rules from the owner's brief, checked BEFORE every turn:
#   level < 30 %                      -> stop (exit 10)
#   battery temp >= 42 C              -> wait, poll 60 s, up to 20 min, then stop (exit 11)
#   thermal status >= 3               -> same wait (exit 12)
# The battery temperature gate uses the HOTTER of the two OS probes
# (dumpsys battery, which is what the governor row's `batt` field carries, and the
# HAL `battery` sensor), so the gate is the conservative one.
S='adb-625689a2-9xEOfw._adb-tls-connect._tcp'
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="$HERE/turns.jsonl"
N="$1"
PROMPT="$2"
NEW="${3:-0}"

rows_now() { adb -s "$S" exec-out run-as com.kalsa.app cat files/governor/observations.jsonl 2>/dev/null | wc -l | tr -d ' '; }

stop_gate() {
  "$HERE/sample.sh" "pre-t$N" >> "$LOG"
  local d lvl b1 b2 ts
  d=$("$HERE/sample.sh" "gate-t$N")
  lvl=$(echo "$d" | python3 -c "import sys,json;print(json.load(sys.stdin)['level'] or 0)")
  b1=$(echo "$d" | python3 -c "import sys,json;v=json.load(sys.stdin)['batt_deci_c'];print((v/10) if v else 0)")
  b2=$(echo "$d" | python3 -c "import sys,json;print(json.load(sys.stdin)['hal_batt_c'] or 0)")
  ts=$(echo "$d" | python3 -c "import sys,json;print(json.load(sys.stdin)['thermal_status'] or 0)")
  python3 -c "print(max($b1,$b2))" > /tmp/_bt.$$
  bt=$(cat /tmp/_bt.$$); rm -f /tmp/_bt.$$
  echo "gate t$N: level=$lvl batt_dumpsys=$b1 hal=$b2 -> max=$bt tstat=$ts"
  if [ "$lvl" -lt 30 ]; then echo "STOP: level $lvl < 30"; return 10; fi
  if [ "$ts" -ge 3 ]; then echo "WAIT: thermal status $ts >= 3"; return 12; fi
  if python3 -c "import sys;sys.exit(0 if $bt >= 42 else 1)"; then
    echo "WAIT: battery temp $bt C >= 42"
    for i in $(seq 1 20); do
      sleep 60
      d=$("$HERE/sample.sh" "wait-$i-t$N")
      b1=$(echo "$d" | python3 -c "import sys,json;v=json.load(sys.stdin)['batt_deci_c'];print((v/10) if v else 0)")
      b2=$(echo "$d" | python3 -c "import sys,json;print(json.load(sys.stdin)['hal_batt_c'] or 0)")
      ts=$(echo "$d" | python3 -c "import sys,json;print(json.load(sys.stdin)['thermal_status'] or 0)")
      python3 -c "print(max($b1,$b2))" > /tmp/_bt2.$$; bt=$(cat /tmp/_bt2.$$); rm -f /tmp/_bt2.$$
      echo "  wait $i: max_batt=$bt tstat=$ts"
      if python3 -c "import sys;sys.exit(0 if $bt < 42 and $ts < 3 else 1)"; then
        echo "  recovered after ${i} min"; "$HERE/sample.sh" "gate2-t$N" >> "$LOG"; return 0
      fi
    done
    echo "STOP: no thermal recovery in 20 min"; return 11
  fi
  return 0
}

[ -z "$N" ] || [ -z "$PROMPT" ] && { echo "usage: cycle.sh <n> \"<prompt>\" [new_chat]"; exit 2; }

BEFORE=$(rows_now)
echo "rows before: $BEFORE"

stop_gate || exit $?

if [ "$NEW" = "1" ]; then
  "$HERE/newchat.sh" || exit 7
fi

"$HERE/turn.sh" "$PROMPT" || exit 5
echo "waiting for completion row..."
GOT=0
for i in $(seq 1 90); do
  sleep 20
  A=$(rows_now)
  if [ "$A" -gt "$BEFORE" ]; then
    # a turn can emit several rows (one per completion/tool round): settle first
    sleep 8
    C=$(rows_now)
    if [ "$C" = "$A" ]; then GOT=1; break; fi
  fi
done
"$HERE/sample.sh" "post-t$N" >> "$LOG"
AFTER=$(rows_now)
echo "rows after: $AFTER (+$((AFTER - BEFORE)))"
python3 - "$N" "$PROMPT" "$BEFORE" "$AFTER" "$GOT" <<'PY' >> "$LOG"
import json, sys, datetime
n, prompt, before, after, got = sys.argv[1:6]
print(json.dumps({"kind": "turn", "turn": int(n), "prompt": prompt,
                  "rows_before": int(before), "rows_after": int(after),
                  "new_rows": int(after) - int(before), "completed": int(got),
                  "at": datetime.datetime.now().isoformat(timespec="seconds")}))
PY
[ "$GOT" = "1" ] || { echo "NO ROW after 30 min - report"; exit 8; }
echo "OK turn $N (+$((AFTER - BEFORE)) row(s))"
exit 0