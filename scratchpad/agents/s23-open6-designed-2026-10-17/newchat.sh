#!/bin/bash
# Start a NEW empty chat in Kalsa: menu -> "Nuova chat". Focus is checked before every tap; Kalsa is relaunched at
# most once; keyguard and screen are checked; every coordinate comes from an idle dump. Never deletes a conversation.
. "$(dirname "$0")/env.sh"
HERE=$(dirname "$0")

# centre of the first node whose resource-id ends with $1 (rid) or whose attributes contain $1 (text)
centre() { python3 -I -c '
import re, sys
d = open(sys.argv[1]).read(); want = sys.argv[2]; by = sys.argv[3]
for m in re.finditer(r"<node[^>]*>", d):
    s = m.group(0)
    rid = re.search(r"resource-id=\"([^\"]*)\"", s)
    b = re.search(r"bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"", s)
    hit = (rid is not None and rid.group(1).endswith(want)) if by == "rid" else (want in s)
    if hit and b:
        print((int(b[1]) + int(b[3])) // 2, (int(b[2]) + int(b[4])) // 2)
        break
' "$1" "$2" "$3"; }

focus_or_relaunch() {
  [ "$(field focus "$(snapshot)")" = 1 ] && return 0
  ad shell "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1; sleep 4
  [ "$(field focus "$(snapshot)")" = 1 ] || { echo "ABORT: Kalsa not in front" >&2; return 1; }
}
screen_ok() { local l; l=$(snapshot); [ "$(field kg "$l")" = 0 ] && [ "$(field scr "$l")" = 1 ]; }

l=$(snapshot)
needs_wake "$l" && keep_awake "$l"
focus_or_relaunch || exit 3
screen_ok || { echo "ABORT: keyguard showing or screen off" >&2; exit 4; }

"$HERE/uidump.sh" composer.field > "$RAW/.nc-load.xml" 2>/dev/null || { echo "ABORT: no idle dump" >&2; exit 5; }
M=$(centre "$RAW/.nc-load.xml" shell.strip.menu rid)
[ -z "$M" ] && { echo "ABORT: menu button not found" >&2; exit 5; }
ad shell "input tap ${M% *} ${M#* }" >/dev/null 2>&1; sleep 2

focus_or_relaunch || exit 3
screen_ok || exit 4
"$HERE/uidump.sh" "Nuova chat" > "$RAW/.nc-drawer.xml" 2>/dev/null || { echo "ABORT: no idle drawer dump" >&2; exit 6; }
N=$(centre "$RAW/.nc-drawer.xml" "Nuova chat" text)
[ -z "$N" ] && { echo "ABORT: Nuova chat not in the drawer" >&2; exit 6; }
ad shell "input tap ${N% *} ${N#* }" >/dev/null 2>&1; sleep 3
rm -f "$RAW/.nc-load.xml" "$RAW/.nc-drawer.xml"
echo "new chat started"
exit 0
