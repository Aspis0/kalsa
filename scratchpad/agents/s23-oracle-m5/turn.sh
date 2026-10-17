#!/usr/bin/env bash
# usage: turn.sh LABEL short|long — one cold-launched turn on the S23.
# S23 differences from the QDC cell: wireless adb, no adb root, no device sqlite3, Italian UI
# labels, and a real battery thermistor (the QDC cell faked unplugged/30 C, which must not be
# copied here — the heat numbers are the point). Every ~10 s the monitor wakes the screen
# (no PIN, but the screen still dozes), samples mWakefulness and the thermal state, and kills the
# turn on the task's stop rules. A non-Awake sample makes the turn INVALID, not just warm.
set -u; . "$(dirname "$0")/env.sh"
LABEL=$1; PROMPT=$2; P=$OUT/$LABEL
MENU="Apri il menu"; NEWCHAT="Nuova chat"; SEND="Invia"
note() { echo "$LABEL $*"; }
note "pre_turn $(thermo_line)" | tee $P-pre.txt

# --- start condition. START=cool waits for the phone to cool; START=npu waits for the NPU zone
# to be hot, which is the warm arm's whole point. Both give up at a cap rather than waiting forever.
# Battery is the binding stop rule on this phone (42 C), so the warm gate also bails out early if
# the battery climbs past NPU_WARM_MAX_BATT — a warm-up must never push past the stop rules.
t0=$(date +%s); sk=$(skin_c); bc=$(batt_c); np=$(npu_c)
if [ "${START:-cool}" = npu ]; then
  warm_give=""
  while { [ "$np" = NA ] || awk "BEGIN{exit !($np < ${NPU_WARM_C:-70.0})}" 2>/dev/null; } \
     && [ $(( $(date +%s) - t0 )) -lt ${NPU_WARM_CAP:-1500} ]; do
    ad shell "input keyevent 224; wm dismiss-keyguard" >/dev/null 2>&1
    sleep 15; sk=$(skin_c); bc=$(batt_c); np=$(npu_c)
    awk "BEGIN{exit !($bc > ${NPU_WARM_MAX_BATT:-41.0})}" 2>/dev/null && { warm_give="battery ${bc}C > ${NPU_WARM_MAX_BATT:-41.0}C"; break; }
  done
  [ -n "$warm_give" ] && note "WARM GATE STOPPED EARLY: $warm_give (npu=${np:-NA})"
  echo "warm_s=$(( $(date +%s) - t0 )) npu_gate=${NPU_WARM_C:-70.0} npu_start=${np:-NA} batt=${bc:-NA} give_up=${warm_give:-no}" > $P-cool.txt
else
  while { awk "BEGIN{exit !($sk > ${COOL_TARGET:-40.0})}" 2>/dev/null || awk "BEGIN{exit !($bc > ${COOL_BATT:-38.0})}" 2>/dev/null; } \
     && [ $(( $(date +%s) - t0 )) -lt ${COOL_CAP:-600} ]; do sleep 15; sk=$(skin_c); bc=$(batt_c); done
  echo "settle_s=$(( $(date +%s) - t0 )) skin_start=${sk:-NA} batt_start=${bc:-NA}" > $P-cool.txt
fi
cat $P-cool.txt
[ "${START:-cool}" = npu ] || { [ -n "$sk" ] && awk "BEGIN{exit !($sk > ${VOID_ABOVE:-40.0})}" && { note "VOID hot: skin $sk"; echo "VOID skin=$sk" > $P-void.txt; exit 11; }; }

# --- preflight: wake, battery state, wakefulness
ad shell "input keyevent 224; wm dismiss-keyguard; svc power stayon true; settings put system screen_off_timeout 1800000" >/dev/null 2>&1; sleep 1
ad shell "dumpsys battery" 2>/dev/null | tr -d '\r' | grep -E "^  (AC|USB|Wireless) powered|^  status|^  level|^  temperature" > $P-battery-pre.txt
cat $P-battery-pre.txt
[ "$(wakefulness)" = Awake ] || { note "NOT AWAKE AT START"; exit 6; }

# --- cold launch: virgin process, no saved KV prefix
ad logcat -c; ad shell am force-stop $APP; sleep 2
ad exec-out run-as $APP sh -c "rm -rf files/sessions/*" 2>/dev/null
ad shell 'monkey -p com.kalsa.app -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1'; sleep 30
fg() { ad shell "dumpsys activity activities | grep -m1 topResumedActivity" | tr -d '\r' | grep -q "$APP/.MainActivity"; }
for i in 1 2 3; do fg && break; ad shell "input keyevent 224; wm dismiss-keyguard; am start -n $APP/.MainActivity" >/dev/null 2>&1; sleep 8; done
fg || { note "APP NOT FOREGROUND"; exit 8; }
# A conversation index from a previous turn would carry a prefix into this one; the driver
# makes a new chat instead of deleting the owner's saved chats.
sqlite3 $TMPD/kdb/readback "SELECT value FROM catalystLocalStorage WHERE key='kalsa.conversations.v1';" 2>/dev/null | sed -n 's/.*"activeId":"\([^"]*\)".*/pre_activeId=\1/p' > $P-chat-pre.txt

# --- fresh chat: Menu -> Nuova chat
dump_ui $P-ui-load.txt || { note "DUMP FAIL load"; exit 7; }
xy=$(center "$MENU" $P-ui-load.txt); [ -n "$xy" ] || { note "NO MENU NODE"; exit 7; }
ad shell input tap $xy; sleep 3
dump_ui $P-ui-drawer.txt; xy=$(center "$NEWCHAT" $P-ui-drawer.txt); [ -n "$xy" ] || { note "NO NEW CHAT NODE"; exit 7; }
ad shell input tap $xy; sleep 3
dump_ui $P-ui-newchat.txt
cxy=$(tr '>' '\n' < $P-ui-newchat.txt | grep -E 'class="android.widget.EditText"' | sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1 | awk '{printf "%d %d", ($1+$3)/2, ($2+$4)/2}')
[ -n "$cxy" ] && { ad shell input tap $cxy; sleep 2; ad shell input keyevent 67; sleep 1; ad shell input keyevent 4; sleep 1; }

# --- stage the prompt by deep link, re-fire on retry
case $PROMPT in short) frag="battery percentage reading";; long) frag="Modern smartphones run";; esac
link() { ad shell "am start -a android.intent.action.VIEW -d 'kalsa://share?text=$(cat enc-$PROMPT.txt)#n=$LABEL'" 2>&1; }
link > $P-amstart.txt; staged=0
for attempt in 1 2 3; do
  [ "$attempt" -gt 1 ] && { note "staging retry $attempt"; link >> $P-amstart.txt; }
  for i in 1 2 3 4; do sleep 3; dump_ui $P-ui.txt && grep -q "$frag" $P-ui.txt && grep -qE "content-desc=\"$SEND\"[^>]*enabled=\"true\"" $P-ui.txt && { staged=1; break; }; done
  [ "$staged" = 1 ] && break
done
[ "$staged" = 1 ] || { note "STAGE NEVER LANDED"; exit 7; }
fg || { note "NOT FOREGROUND AT SEND"; exit 8; }
sxy=$(center "$SEND" $P-ui.txt); [ -n "$sxy" ] || { note "NO SEND NODE"; exit 7; }
# The "arm temps at start" the report needs, taken at the last moment before the send tap.
thermo_line | tee $P-send-pre.txt

# --- monitor: wake every ~10 s, log every sample, kill on the task's stop rules
: > $P-monitor.txt; echo "KILLED" > $P-stopped.txt; rm -f $P-stopped.txt
( while :; do sleep 10
    ad shell "input keyevent 224; wm dismiss-keyguard" >/dev/null 2>&1
    line=$(thermo_line); echo "$(date +%s) $line" >> $P-monitor.txt
    grep -q "wake=Awake" <<<"$line" || { echo "NOT_AWAKE $line" > $P-stopped.txt; ad shell am force-stop $APP; break; }
    if why=$(stop_reason "$line"); then echo "STOP_RULE $why | $line" > $P-stopped.txt; ad shell am force-stop $APP; break; fi
  done ) & MON=$!
ad shell input tap $sxy; date +%s > $P-sendtime.txt
ok=0; gone=0
for i in $(seq 1 90); do
  sleep 5
  ad logcat -d 2>/dev/null | grep -q "KALSA_TELEMETRY" && { ok=1; break; }
  pid=$(ad shell pidof $APP | tr -d '\r' | awk '{print $1}')
  if [ -z "$pid" ]; then gone=$((gone+1)); [ "$gone" -ge 3 ] && break; else gone=0; fi
  [ -f $P-stopped.txt ] && break
done
[ "$ok" = 1 ] || note "NO TELEMETRY (hang/kill/died)"
if [ "$ok" = 1 ]; then  # a tool round can follow round 0; wait until the telemetry count is stable
  prev=-1; stable=0
  for i in $(seq 1 60); do
    n=$(ad logcat -d 2>/dev/null | grep -c "KALSA_TELEMETRY")
    if [ "$n" = "$prev" ]; then stable=$((stable+1)); else stable=0; prev=$n; fi
    [ "$stable" -ge 4 ] && break
    [ -f $P-stopped.txt ] && break
    sleep 5
  done
fi
kill $MON 2>/dev/null; wait $MON 2>/dev/null
note "post_turn $(thermo_line)"

# --- collect: atomic dump, grep-filter into raw
FULL=$TMPD/$LABEL-logcat.txt
for try in 1 2 3; do ad logcat -d -b all > $FULL.tmp 2>/dev/null && [ -s $FULL.tmp ] && { mv $FULL.tmp $FULL; break; }; sleep 3; done
[ -f $FULL ] || cp $FULL.tmp $FULL
grep -E "KALSA_" $FULL > $P-kalsa.txt
ad shell "dumpsys activity exit-info $APP" 2>/dev/null | tr -d '\r' | grep -E "reason=|timestamp=|description=|pid=" | head -20 > $P-exitinfo.txt
echo "$LABEL dur=$(( $(date +%s) - $(cat $P-sendtime.txt) ))s probs_rows=$(grep -c 'KALSA_BENCH_PROBS ' $P-kalsa.txt) monitor_samples=$(wc -l < $P-monitor.txt | tr -d ' ')"
grep -E "KALSA_GOVERNOR_PLAN" $P-kalsa.txt | tail -1 | cut -c1-300
grep -E "KALSA_GOVERNOR_TURN" $P-kalsa.txt | tail -1 | cut -c1-400
if [ -f $P-stopped.txt ]; then note "TURN KILLED/INVALID: $(cat $P-stopped.txt)"; exit 10; fi
awk '/wake=Awake/{a++} END{print "wakefulness: Awake=" a " samples"}' $P-monitor.txt | tee -a $P-monitor.txt
[ "$ok" = 1 ] || exit 7