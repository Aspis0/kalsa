#!/bin/bash
# Send one chat turn in com.kalsa.app on the owner's Xiaomi, safely.
#
#   turn.sh "<prompt>"      -> types the prompt, verifies it, taps send
#
# Owner-safety rules enforced here (2026-10-15 incident):
#   * focus is checked before EVERY tap; if Kalsa is not in front it is brought
#     to front exactly once with monkey, re-checked, and we abort if still not.
#   * the keyguard/screen state is checked before every tap; if the keyguard is
#     showing or the screen is off we abort. We never unlock, never send
#     keyevent 26, and never touch any other app.
#   * `input text` drops characters while the keyboard animates in, so the field
#     is read back and compared to the intent. A mismatch is retried once, then
#     the field is CLEARED and we abort - nothing half-typed is ever sent.
#   * every control coordinate comes from a fresh dump. The composer moves when
#     the keyboard opens (field y 2436 closed / 1402 open), so a hardcoded tap
#     lands on the keyboard instead of the field once the keyboard is up.
#   * uidump waits for the UI to be idle: uiautomator fails with "could not get
#     idle state" while the app is streaming tokens, and returns rc 0 with an
#     empty hierarchy, which looks like a real-but-empty screen.
S='adb-625689a2-9xEOfw._adb-tls-connect._tcp'
PKG='com.kalsa.app'
HERE="$(cd "$(dirname "$0")" && pwd)"
PROMPT="$1"
[ -z "$PROMPT" ] && { echo "usage: turn.sh \"<prompt>\"" >&2; exit 2; }

esc() { printf '%s' "$1" | sed -e 's/ /%s/g'; }

focus_state() { adb -s "$S" shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus; }

keyguard_state() {
  adb -s "$S" shell dumpsys window policy 2>/dev/null | grep -m1 -E 'showing=|mIsScreenOn ='
}

ensure_kalsa() {
  local f; f=$(focus_state)
  if echo "$f" | grep -q "$PKG"; then echo "focus: ok"; return 0; fi
  echo "focus: not Kalsa ($f) - launching once" >&2
  adb -s "$S" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 4
  f=$(focus_state)
  if echo "$f" | grep -q "$PKG"; then echo "focus: ok after launch"; return 0; fi
  echo "focus: STILL NOT KALSA ($f) - ABORT" >&2
  return 1
}

guard_screen() {
  local kg; kg=$(keyguard_state)
  if echo "$kg" | grep -q 'showing=true' || echo "$kg" | grep -q 'mIsScreenOn = false'; then
    echo "SCREEN: keyguard showing or screen off ($kg) - ABORT, do not unlock" >&2
    return 1
  fi
  return 0
}

# "fieldtext|fieldcx,fieldcy|sendcx,sendcy" from one idle dump
read_ui() {
  "$HERE/uidump.sh" composer.field 2>/dev/null | python3 -c "
import sys, re
d = sys.stdin.read()
txt, fb, sb = '', None, None
for m in re.finditer(r'<node[^>]*>', d):
    s = m.group(0)
    def g(k):
        mm = re.search(k + r'=\"([^\"]*)\"', s)
        return mm.group(1) if mm else ''
    rid = g('resource-id')
    b = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', g('bounds'))
    c = ((int(b.group(1)) + int(b.group(3))) // 2, (int(b.group(2)) + int(b.group(4))) // 2) if b else None
    if rid.endswith('composer.field'):
        txt = g('text'); fb = c
    if rid.endswith('composer.send'):
        sb = c
print(f\"{txt}|{fb[0]},{fb[1]}|{sb[0]},{sb[1]}\")
"
}

clear_field() {
  adb -s "$S" shell input keyevent KEYCODE_MOVE_END >/dev/null 2>&1
  local n=${#1}
  for _ in $(seq 1 $((n + 4))); do adb -s "$S" shell input keyevent 67 >/dev/null 2>&1; done
}

type_and_verify() {
  local want="$1" info fx fy got
  info=$(read_ui) || { echo "no idle UI to type into" >&2; return 1; }
  fx=$(echo "$info" | cut -d'|' -f2 | cut -d, -f1)
  fy=$(echo "$info" | cut -d'|' -f2 | cut -d, -f2)
  [ -z "$fx" ] && { echo "field coords not found" >&2; return 1; }
  adb -s "$S" shell input tap "$fx" "$fy" >/dev/null 2>&1
  sleep 2
  clear_field "$want"
  adb -s "$S" shell "input text '$(esc "$want")'" >/dev/null 2>&1
  sleep 2
  info=$(read_ui) || return 1
  got=$(echo "$info" | cut -d'|' -f1 | sed 's/ *$//')
  echo "typed : [$got]"
  echo "wanted: [$want]"
  [ "$got" = "$want" ]
}

ensure_kalsa || exit 3
guard_screen || exit 4

if ! type_and_verify "$PROMPT"; then
  echo "retry: read-back mismatch or busy UI" >&2
  sleep 4
  if ! type_and_verify "$PROMPT"; then
    # leave nothing half-typed in the field, then abort
    info=$(read_ui); clear_field "$(echo "$info" | cut -d'|' -f1)"
    echo "TYPE/VERIFY FAILED AFTER RETRY - ABORT, nothing sent, field cleared" >&2
    exit 5
  fi
fi

ensure_kalsa >/dev/null || exit 3
guard_screen || exit 4
INFO=$(read_ui) || { echo "no idle UI before send - ABORT" >&2; exit 6; }
SEND=$(echo "$INFO" | cut -d'|' -f3)
if [ -z "$SEND" ] || [ "$SEND" = "None,None" ]; then
  clear_field "$(echo "$INFO" | cut -d'|' -f1)"
  echo "send button not found - ABORT, field cleared" >&2
  exit 6
fi
SX=${SEND%,*}; SY=${SEND#*,}
echo "send tap at $SX,$SY"
adb -s "$S" shell input tap "$SX" "$SY" >/dev/null 2>&1
sleep 1
echo "SENT: $PROMPT"
exit 0