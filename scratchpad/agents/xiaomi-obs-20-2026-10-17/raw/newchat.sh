#!/bin/bash
# Start a NEW empty chat in com.kalsa.app (menu -> "Nuova chat").
#
# Same safety envelope as turn.sh: focus checked before every tap, Kalsa
# relaunched at most once, keyguard/screen checked, and every coordinate read
# from an idle dump. The dump must WAIT for idle: right after a completion the
# app is still re-rendering and uiautomator answers "could not get idle state"
# with rc 0 and no hierarchy, which is what aborted the new chat of turn 15.
S='adb-625689a2-9xEOfw._adb-tls-connect._tcp'
PKG='com.kalsa.app'
HERE="$(cd "$(dirname "$0")" && pwd)"

focus_ok() { adb -s "$S" shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | grep -q "$PKG"; }
screen_ok() {
  local kg; kg=$(adb -s "$S" shell dumpsys window policy 2>/dev/null | grep -m1 -E 'showing=|mIsScreenOn =')
  echo "$kg" | grep -q 'showing=true' && return 1
  echo "$kg" | grep -q 'mIsScreenOn = false' && return 1
  return 0
}
ensure_focus() {
  focus_ok && return 0
  adb -s "$S" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 4
  focus_ok || { echo "ABORT: Kalsa not in front" >&2; return 1; }
}

# centre of the node whose resource-id ends with $1
center_of() {
  "$HERE/uidump.sh" "$1" 2>/dev/null | python3 -c "
import sys, re
d = sys.stdin.read()
want = sys.argv[1]
for m in re.finditer(r'<node[^>]*>', d):
    s = m.group(0)
    def g(k):
        mm = re.search(k + r'=\"([^\"]*)\"', s)
        return mm.group(1) if mm else ''
    if g('resource-id').endswith(want):
        b = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', g('bounds'))
        if b:
            print((int(b.group(1)) + int(b.group(3))) // 2, (int(b.group(2)) + int(b.group(4))) // 2)
            break
" "$1"
}

ensure_focus || exit 3
screen_ok || { echo "ABORT: keyguard showing or screen off"; exit 4; }

M=$(center_of shell.strip.menu)
[ -z "$M" ] && { echo "ABORT: menu button not found in an idle dump" >&2; exit 5; }
adb -s "$S" shell input tap $M >/dev/null 2>&1
sleep 2

ensure_focus || exit 3
screen_ok || exit 4

N=$(center_of "Nuova chat")
if [ -z "$N" ]; then
  # the drawer's row carries no resource-id; find it by its label
  N=$("$HERE/uidump.sh" "Nuova chat" 2>/dev/null | python3 -c "
import sys, re
d = sys.stdin.read()
for m in re.finditer(r'<node[^>]*>', d):
    s = m.group(0)
    if 'Nuova chat' in s:
        b = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', re.search(r'bounds=\"([^\"]*)\"', s).group(1))
        print((int(b.group(1)) + int(b.group(3))) // 2, (int(b.group(2)) + int(b.group(4))) // 2)
        break
")
fi
[ -z "$N" ] && { echo "ABORT: Nuova chat not found in drawer" >&2; exit 6; }
adb -s "$S" shell input tap $N >/dev/null 2>&1
sleep 3
echo "new chat started"
exit 0