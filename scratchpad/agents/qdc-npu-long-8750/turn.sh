#!/usr/bin/env bash
# usage: BOARD=x turn.sh LABEL short|long — one cold-launched turn. Adapted from the S23 turn.sh
# (bounds come from uiautomator, English labels, skin-temp watchdog since QDC battery temp is stubbed).
set -u; . "$(dirname "$0")/env.sh"
LABEL=$1; PROMPT=$2; P=$OUT/$LABEL; cd "$LAB"
note() { echo "$LABEL $*"; }
# --- cooldown to target (cap), record start skin ---
t0=$(date +%s); sk=$(skin_c)
while [ -n "$sk" ] && awk "BEGIN{exit !($sk > $COOL_TARGET)}" && [ $(( $(date +%s) - t0 )) -lt $COOL_CAP ]; do sleep 15; sk=$(skin_c); done
echo "cool_wait_s=$(( $(date +%s) - t0 )) skin_start=${sk:-NA} batt=$(batt_c)" > $P-cool.txt; cat $P-cool.txt
[ -n "$sk" ] && awk "BEGIN{exit !($sk > ${VOID_ABOVE:-$COOL_TARGET})}" && { echo "VOID hot: skin $sk > ${VOID_ABOVE:-$COOL_TARGET} after ${COOL_CAP}s" > $P-void.txt; note "VOID hot skin=$sk"; exit 11; }
# --- preflight/state ---
{ ad shell 'dumpsys battery' | tr -d '\r' | grep -E "^  (AC|USB|Wireless) powered|^  status|^  level|^  temperature"; } > $P-battery-pre.txt
ad shell "input keyevent 224; wm dismiss-keyguard; svc power stayon true; settings put system screen_off_timeout 1800000" >/dev/null 2>&1; sleep 1
ad shell "input tap 540 1200" >/dev/null 2>&1   # a real touch keeps Awake on boards where stayon is inert
{ ad shell 'dumpsys power | grep -E "mWakefulness=|mStayOn"; dumpsys window policy | grep showing=; dumpsys thermalservice | grep -m1 "Thermal Status"; dumpsys thermalservice | grep -i -m1 "mName=skin"; echo low_power=$(settings get global low_power)' | tr -d '\r'; echo "skin_pre=$(skin_c)"; } > $P-state-pre.txt
grep -q "mWakefulness=Awake" $P-state-pre.txt || { note NOT AWAKE; exit 6; }
# --- cold launch (virgin process every turn) ---
ad logcat -c; ad shell am force-stop $APP; sleep 2
ad shell "rm -rf /data/data/$APP/files/sessions/*" # cold KV per turn (S23 protocol n_common=0); a saved session restores the prefix
ad shell 'monkey -p com.kalsa.app -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1'; sleep 30
fg() { ad shell "dumpsys activity activities | grep -m1 topResumedActivity" | tr -d '\r' | grep -q "$APP/.MainActivity"; }
# QRD8750 (Android 16): the screen dozes during the cold launch and the launcher takes the top; wake, then start the app again on each retry
for i in 1 2 3 4; do fg && break; ad shell "input keyevent 224; wm dismiss-keyguard; input tap 540 1200; am start -n $APP/.MainActivity" >/dev/null 2>&1; sleep 8; done
fg || { note "APP NOT FOREGROUND"; exit 8; }
# --- fresh chat: Menu -> New chat -> clear compose ---
dump_ui $P-ui-load.txt || { note "DUMP FAIL load"; exit 7; }
xy=$(center Menu $P-ui-load.txt); [ -n "$xy" ] && ad shell input tap $xy; sleep 2
dump_ui $P-ui-drawer.txt; xy=$(center "New chat" $P-ui-drawer.txt); [ -n "$xy" ] && ad shell input tap $xy; sleep 2
dump_ui $P-ui-newchat.txt
cxy=$(tr '>' '\n' < $P-ui-newchat.txt | grep 'class="android.widget.EditText"' | sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1 | awk '{printf "%d %d", ($1+$3)/2, ($2+$4)/2}')
[ -n "$cxy" ] && { ad shell input tap $cxy; sleep 2; ad shell input keycombination 113 29; sleep 1; ad shell input keyevent 67; sleep 1; ad shell input keyevent 4; sleep 1; }
# --- stage the prompt via deep link, re-fire on retry ---
case $PROMPT in short) frag="battery percentage reading";; long) frag="Modern smartphones run large";; esac
link() { ad shell "am start -a android.intent.action.VIEW -d 'kalsa://share?text=$(cat enc-$PROMPT.txt)#n=$LABEL'" 2>&1; }
link > $P-amstart.txt; staged=0
for attempt in 1 2 3 4; do
  [ "$attempt" -gt 1 ] && { note "staging retry $attempt"; link >> $P-amstart.txt; }
  for i in 1 2 3 4; do sleep 3; dump_ui $P-ui.txt && grep -q "$frag" $P-ui.txt && grep -qE 'content-desc="Send"[^>]*enabled="true"' $P-ui.txt && { staged=1; break; }; done
  [ "$staged" = 1 ] && break
done
[ "$staged" = 1 ] || { note "STAGE NEVER LANDED"; exit 7; }
grep -c "$frag" $P-ui.txt > $P-stage-count.txt
fg || { note "NOT FOREGROUND AT SEND"; exit 8; }
sxy=$(center Send $P-ui.txt); [ -n "$sxy" ] || { note "NO SEND NODE"; exit 7; }
# --- watchdog: skin every 10 s, WARN 40, KILL at STOP_C ---
: > $P-watchdog.txt
( while :; do sleep 10; t=$(skin_c); b=$(batt_c); [ -z "$t" ] && continue
    if awk "BEGIN{exit !($t >= $STOP_C)}"; then echo "$(date +%s) KILL skin=$t batt=$b" >> $P-watchdog.txt; ad shell am force-stop $APP; break
    elif awk "BEGIN{exit !($t >= 40.0)}"; then echo "$(date +%s) WARN skin=$t batt=$b" >> $P-watchdog.txt
    else echo "$(date +%s) ok skin=$t batt=$b" >> $P-watchdog.txt; fi; done ) &
WD=$!
# The screen dozes ~9 s after the last user activity and background timers stop, so the turn stalls with the app
# backgrounded. A WAKEUP every 5 s kept the screen Awake for a 30 s test on QRD8750; it stops with the turn.
( while :; do sleep 5; ad shell "input keyevent 224" >/dev/null 2>&1; done ) &
KA=$!
ad shell input tap $sxy; date +%s > $P-sendtime.txt
ok=0; gone=0
for i in $(seq 1 90); do
  sleep 5
  ad logcat -d 2>/dev/null | grep -q "KALSA_TELEMETRY" && { ok=1; break; }
  pid=$(ad shell pidof $APP | tr -d '\r' | awk '{print $1}')
  if [ -z "$pid" ]; then gone=$((gone+1)); [ "$gone" -ge 3 ] && break; else gone=0; fi
  grep -q KILL $P-watchdog.txt && break
done
[ "$ok" = 1 ] || note "NO TELEMETRY (hang/kill/died)"
# tool rounds (web_search) can follow round 0: wait until the telemetry count is stable for 20 s
if [ "$ok" = 1 ]; then
  prev=-1; stable=0
  for i in $(seq 1 60); do
    n=$(ad logcat -d 2>/dev/null | grep -c "KALSA_TELEMETRY")
    if [ "$n" = "$prev" ]; then stable=$((stable+1)); else stable=0; prev=$n; fi
    [ "$stable" -ge 4 ] && break
    grep -q KILL $P-watchdog.txt && break
    sleep 5
  done
fi
kill $WD $KA 2>/dev/null; wait $WD $KA 2>/dev/null
# --- collect: atomic dump to /tmp (never committed), grep-filter into raw ---
FULL=$TMPD/$LABEL-logcat.txt
for try in 1 2 3; do ADT=120 ad logcat -d -b all > $FULL.tmp 2>/dev/null; rc=$?; [ "$rc" = 0 ] && [ -s $FULL.tmp ] && { mv $FULL.tmp $FULL; break; }; sleep 3; done
[ -f $FULL ] || cp $FULL.tmp $FULL
grep -E "KALSA_" $FULL > $P-kalsa.txt
grep -iE "ggml-hex|ggml_opencl|opencl|hexagon|HTP[0-9]|htp" $FULL | head -200 > $P-hexlog.txt
grep -iE "lowmemorykiller|lmkd|Out of memory|oom_adj|Killing .*com.kalsa|am_kill|am_proc_died.*kalsa" $FULL | head -40 > $P-lmk.txt
grep -E "CDSP0 CRASHED|dspqueue_read failed|dspqueue_write failed|INTERNAL-ERROR|ggml_abort|GGML_ASSERT|Aborted|Segmentation|FATAL EXCEPTION|SIGSEGV" $FULL | head -40 > $P-crash.txt
grep -iE "fastrpc|remote_handle" $FULL | head -60 > $P-fastrpc.txt
ad shell "dumpsys activity exit-info $APP" 2>/dev/null | tr -d '\r' | grep -E "reason=|timestamp=|description=|pid=" | head -20 > $P-exitinfo.txt
ad shell 'dumpsys power | grep mWakefulness=; dumpsys thermalservice | grep -m1 "Thermal Status"; dumpsys thermalservice | grep -i -m1 "mName=skin"; dumpsys battery | grep -E "^  (AC|USB|Wireless) powered|^  level|^  temperature"' | tr -d '\r' > $P-state-post.txt
echo "$LABEL dur=$(( $(date +%s) - $(cat $P-sendtime.txt) ))s"
grep -E "KALSA_GOVERNOR_PLAN" $P-kalsa.txt | tail -1 | cut -c1-400
grep -E "KALSA_GOVERNOR \{|KALSA_TELEMETRY" $P-kalsa.txt | tail -2 | cut -c1-500
grep -q KILL $P-watchdog.txt && { note "WATCHDOG KILL AT $STOP_C - STOP BOARD"; exit 10; }
# --- answer capture ---
sleep 3; dump_ui $TMPD/$LABEL-answer.xml; grep -oE 'text="[^"]+"' $TMPD/$LABEL-answer.xml | sed 's/^text="//; s/"$//' | grep -v '^$' > $P-answer.txt 2>/dev/null
dead=$(ad shell "run-as $APP sqlite3 databases/RKStorage \"select key from catalystLocalStorage where key like 'kalsa.load.dead%'\"" 2>/dev/null | tr -d "\r" | head -1)
echo "dead_marker=${dead:-none(or-unreadable)}" > $P-dead.txt
[ "$ok" = 1 ] || exit 7
