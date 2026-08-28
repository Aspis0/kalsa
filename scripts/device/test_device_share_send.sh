#!/usr/bin/env bash
# Pure tests for scripts/device/device-share-send.sh — no device, no adb.
set -uo pipefail

OUT=$(mktemp -d)
PKG=com.kalsa.app
BENCH_TARGET=device
export OUT PKG BENCH_TARGET

# shellcheck source=device-share-send.sh
source "$(dirname "$0")/device-share-send.sh"

die() { :; }
log() { :; }

pass=0
fail=0
ok() { echo "PASS: $1"; pass=$((pass + 1)); }
bad() { echo "FAIL: $1"; fail=$((fail + 1)); }

# ── encode ──────────────────────────────────────────────────────────
enc=$(device_share_encode "Ciao")
ec=$?
[ "$ec" -eq 0 ] && [ "$enc" = "Ciao" ] && ok "encode plain" || bad "encode plain ec=$ec ($enc)"

enc=$(device_share_encode "due piu due")
[ "$enc" = "due%20piu%20due" ] && ok "encode spaces" || bad "encode spaces ($enc)"

enc=$(device_share_encode "a+b=c")
printf '%s' "$enc" | grep -q '%2B' && printf '%s' "$enc" | grep -q '%3D' \
  && ok "encode punctuation" || bad "encode punctuation ($enc)"

enc=$(device_share_encode 'x&y#z')
printf '%s' "$enc" | grep -q '%26' && printf '%s' "$enc" | grep -q '%23' \
  && printf '%s' "$enc" | grep -qv '[&#]' \
  && ok "encode amp/hash" || bad "encode amp/hash ($enc)"

if device_share_encode "   " >/dev/null 2>&1; then
  bad "encode whitespace-only should fail"
else
  ok "encode whitespace-only fails"
fi

# ── serial pick ─────────────────────────────────────────────────────
s=$(device_pick_serial "R3CW406P8CV" $'usb\n192.168.1.152:5555')
[ "$s" = "R3CW406P8CV" ] && ok "serial env wins over two transports" \
  || bad "serial env wins ($s)"

s=$(device_pick_serial "" "192.168.1.152:5555")
[ "$s" = "192.168.1.152:5555" ] && ok "serial single device" \
  || bad "serial single ($s)"

if device_pick_serial "" $'usb\n192.168.1.152:5555' >/dev/null; then
  bad "serial two transports without env should fail"
else
  ok "serial two transports without env fails"
fi

if device_pick_serial "" "" >/dev/null; then
  bad "serial zero devices should fail"
else
  ok "serial zero devices fails"
fi

# ── thermal / battery parse (history lines must not win) ────────────
batt_dump='  AC powered: false
  USB powered: false
  level: 73
  temperature: 357
  Capacity level: -1
08-17 10:51:16.996  Sending ACTION_BATTERY_CHANGED: level:79, status:3, temperature:111, online:1
08-17 11:17:01.092  Sending ACTION_BATTERY_CHANGED: level:73, temperature:403, online:1'

t=$(printf '%s\n' "$batt_dump" | device_battery_temp_from_dump)
[ "$t" = "357" ] && ok "battery temp ignores history 111/403" || bad "battery temp ($t)"

lv=$(printf '%s\n' "$batt_dump" | device_battery_level_from_dump)
[ "$lv" = "73" ] && ok "battery level ignores history 79" || bad "battery level ($lv)"

# Live field missing: awk must stay mute, not take a history temperature:.
no_live='08-17 11:17:01.092  Sending ACTION_BATTERY_CHANGED: temperature:403, online:1'
t=$(printf '%s\n' "$no_live" | device_battery_temp_from_dump)
[ -z "$t" ] && ok "battery temp mute when only history" || bad "battery temp history-only ($t)"

th=$(printf '%s\n' 'Thermal Status: 0
Cached temperatures:
Temperature{mValue=0.0, mType=2, mName=SUBBAT, mStatus=0}' | device_thermal_status_from_dump)
[ "$th" = "0" ] && ok "thermal status 0" || bad "thermal status ($th)"

th=$(printf '%s\n' 'Thermal Status: 3' | device_thermal_status_from_dump)
[ "$th" = "3" ] && ok "thermal status 3" || bad "thermal status 3 ($th)"

ui='<hierarchy><node class="android.widget.EditText" text="Fai una domanda…" /></hierarchy>'
c=$(device_composer_from_ui "$ui")
[ -z "$c" ] && ok "composer placeholder is empty" || bad "composer placeholder ($c)"

ui='<hierarchy><node class="android.widget.EditText" text="Quanto fa due piu due" /></hierarchy>'
c=$(device_composer_from_ui "$ui")
[ "$c" = "Quanto fa due piu due" ] && ok "composer real text" || bad "composer real ($c)"

ui='<hierarchy><node class="android.widget.TextView" text="Ciao! Come posso aiutarti oggi?" /></hierarchy>'
c=$(device_composer_from_ui "$ui")
[ -z "$c" ] && ok "composer ignores history bubble" || bad "composer history ($c)"

rm -rf "$OUT"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
