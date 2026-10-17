# S23 OPEN 6 designed cell: shared env, device guard, sensor snapshot. Sourced by every script here.
# Serial is pinned: this phone is the owner's daily device and `adb devices | head -1` could grab another one.
SER=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
APP=com.kalsa.app
PKG=$APP
CELL=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RAW=$CELL/raw
OBS=files/governor/observations.jsonl
# Binding pin of the app as updated 2026-10-17 06:54 (df912b0e). Rows on any other pin are not this cell.
PIN=df912b0e20275636817e1f4c66bb4bb9edc5a0ce
# Stop rules from the owner's brief. Battery temperature takes the HOTTER of dumpsys and the battery thermal zone.
STOP_LEVEL=30
HOT_C=42.0
HOT_TSTAT=3
HOT_WAIT_MAX=1200

# every adb call is wrapped in an alarm: wireless adb can hang and a hung call must not hang the run
ad() { perl -e 'alarm shift; exec @ARGV or exit 127' "${ADT:-90}" adb -s "$SER" "$@"; }

if ! adb -s "$SER" get-state >/dev/null 2>&1; then echo "S23 NOT ATTACHED ($SER): STOP" >&2; exit 2; fi
if ! ad shell getprop ro.product.model 2>/dev/null | tr -d '\r' | grep -qx SM-S911U; then
  echo "wrong device on $SER: STOP" >&2; exit 2
fi

# One adb round trip for every sensor so a sample is coherent. Output is key=value on one line.
# skin = HAL list entry 1 (skin-id.sh on this phone pinned index 1 on 2026-10-16: the entries are one sensor).
# npu/gpu = min over the kernel zone group, the same choice the app's headroom rule makes (governorInputs.ts:467).
# batt = max(dumpsys battery, battery thermal zone): the conservative read for the 42 C gate.
snapshot_raw() { ad shell '
  dumpsys power | grep -m1 -o "mWakefulness=[A-Za-z]*"
  dumpsys battery | grep -E "^  (AC powered|USB powered|Wireless powered|level|temperature)"
  dumpsys thermalservice | grep -m1 "Thermal Status"
  dumpsys thermalservice | grep -i "mName=SKIN" | grep -v Threshold | sed -n "s/.*mValue=\([0-9.]*\).*/SKIN \1/p" | head -1
  for z in /sys/class/thermal/thermal_zone*; do t=$(cat $z/type 2>/dev/null); case $t in nspss-*|gpuss-*|battery*) echo "Z $t $(cat $z/temp 2>/dev/null)";; esac; done
  dumpsys window | grep -m1 mCurrentFocus
  dumpsys window policy | grep -m1 -o -E "showing=[a-z]+"
  dumpsys display | grep -m1 -o -E "mScreenState=[A-Z]+"
' 2>/dev/null | tr -d '\r'; }

snapshot() { snapshot_raw | awk '
  /^mWakefulness=/ { split($0,a,"="); wake=a[2] }
  $1=="SKIN" { skin=$2 }
  $1=="Z" && $2 ~ /^nspss-/ { if (npu=="" || $3+0 < npu) npu=$3+0 }
  $1=="Z" && $2 ~ /^gpuss-/ { if (gpu=="" || $3+0 < gpu) gpu=$3+0 }
  $1=="Z" && $2 ~ /^battery/ { bz=$3+0 }
  /^Thermal/ { tstat=$NF }
  $1=="level:" { lvl=$2 }
  $1=="temperature:" { tb=$2 }
  $2=="powered:" && $3=="true" { plug=plug $1 }
  /focus|mCurrentFocus/ { focus=$0 }
  /mScreenState=/ { scr=($0 ~ /ON/) ? 1 : 0 }
  /showing=/ { kg=($0 ~ /showing=true/) ? 1 : 0 }
  END {
    bt=(tb==""?0:tb/10); if (bz!="" && bz/1000 > bt) bt=bz/1000
    printf "wake=%s skin=%s npu=%s gpu=%s batt=%.1f batt_sys=%s lvl=%s tstat=%s plug=%s focus=%d kg=%d scr=%d",
      (wake==""?"NA":wake), (skin==""?"NA":skin), (npu==""?"NA":npu/1000), (gpu==""?"NA":gpu/1000),
      bt, (tb==""?"NA":sprintf("%.1f",tb/10)), (lvl==""?"NA":lvl), (tstat==""?"NA":tstat),
      (plug==""?"none":plug), (focus ~ /com\.kalsa\.app/ ? 1 : 0), kg+0, scr+0 }'; }

field() { sed -n "s/.*$1=\([^ ]*\).*/\1/p" <<<"$2"; }

# one sample line, prefixed with the epoch
sample_line() { echo "$(date +%s) $(snapshot)"; }

# Guard over one sample line. Prints the reason and returns:
#   0 ok | 12 plugged (pause) | 10 level under floor (stop) | 11 hot (wait, then stop) | 13 keyguard up (never unlock)
guard_code() { local l=$1 lv p kg b t
  p=$(field plug "$l"); lv=$(field lvl "$l"); kg=$(field kg "$l"); b=$(field batt "$l"); t=$(field tstat "$l")
  [ "$p" != none ] && { echo "PLUGGED ($p): pause"; return 12; }
  [ "$lv" != NA ] && [ "$lv" -lt "$STOP_LEVEL" ] && { echo "level $lv < $STOP_LEVEL: stop"; return 10; }
  [ "$kg" = 1 ] && { echo "keyguard showing: stop, not unlocking"; return 13; }
  if awk "BEGIN{exit !($b >= $HOT_C)}" || { [ "$t" != NA ] && [ "$t" -ge "$HOT_TSTAT" ]; }; then
    echo "hot: batt ${b}C tstat $t"; return 11
  fi
  return 0; }

# Keep the phone awake and Kalsa in front during an idle gap or a turn. Never unlocks: there is no PIN on this phone,
# and a keyguard that is up is a stop, not a thing to get past.
# Takes the sample line already read. Acts only when the screen is not on, the keyguard is up or Kalsa is not in front.
# The caller re-samples and decides: the guard must see the state AFTER the wake, not the dozing state before it.
keep_awake() { local l=$1
  if [ "$(field wake "$l")" != Awake ] || [ "$(field scr "$l")" != 1 ] || [ "$(field kg "$l")" = 1 ]; then
    ad shell "input keyevent 224; wm dismiss-keyguard" >/dev/null 2>&1; sleep 2; fi
  if [ "$(field focus "$l")" != 1 ]; then ad shell "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1; sleep 4; fi; }

# True when the phone needs keep_awake before a guard decision means anything.
needs_wake() { local l=$1
  [ "$(field wake "$l")" != Awake ] || [ "$(field scr "$l")" != 1 ] || [ "$(field kg "$l")" = 1 ] || [ "$(field focus "$l")" != 1 ]; }

# centre of a node by exact text/content-desc in a uiautomator dump file
center() { tr '>' '\n' < "$2" | grep -E "(content-desc|text)=\"$1\"" | sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1 | awk '{printf "%d %d", ($1+$3)/2, ($2+$4)/2}'; }

# rows the app has written for this pin, stdout: a count. Read-only: run-as cat into a pipe, nothing written on the phone.
rows_now() { ad exec-out run-as "$APP" cat "$OBS" 2>/dev/null | wc -l | tr -d ' '; }
