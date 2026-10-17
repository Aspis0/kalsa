#!/bin/bash
# Type one fixed prompt into Kalsa's composer, read it back, and send it. Nothing half-typed is ever sent.
#
#   turn.sh <short|long>
#
# Safety, as on the Xiaomi cell: focus is checked before every tap (Kalsa relaunched at most once); keyguard and
# screen are checked (never unlock); `input text` drops characters while the keyboard opens, so the field is read
# back and compared to the intent, retried once, then cleared and aborted. Coordinates come from a fresh dump.
. "$(dirname "$0")/env.sh"
. "$(dirname "$0")/prompts.sh"
HERE=$(dirname "$0")
KIND=${1:-}
PROMPT=$(prompt_for "$KIND") || { echo "usage: turn.sh <short|long>" >&2; exit 2; }
prompt_ok "$PROMPT" || { echo "prompt is not ASCII-safe for input text: $KIND" >&2; exit 2; }

esc() { printf '%s' "$1" | sed -e 's/ /%s/g'; }

focus_or_relaunch() {
  [ "$(field focus "$(snapshot)")" = 1 ] && return 0
  ad shell "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1; sleep 4
  [ "$(field focus "$(snapshot)")" = 1 ] || { echo "ABORT: Kalsa not in front" >&2; return 1; }
}
guard_screen() { local l; l=$(snapshot)
  if [ "$(field kg "$l")" = 1 ] || [ "$(field scr "$l")" = 0 ]; then echo "ABORT: keyguard up or screen off" >&2; return 1; fi; }

# "fieldtext|fieldx,fieldy|sendx,sendy" from one idle dump
read_ui() { "$HERE/uidump.sh" composer.field 2>/dev/null | python3 -I -c '
import re, sys
d = sys.stdin.read(); txt, fb, sb = "", "", ""
for m in re.finditer(r"<node[^>]*>", d):
    s = m.group(0)
    rid = re.search(r"resource-id=\"([^\"]*)\"", s)
    b = re.search(r"bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"", s)
    if not (rid and b): continue
    c = "%d,%d" % ((int(b[1]) + int(b[3])) // 2, (int(b[2]) + int(b[4])) // 2)
    if rid.group(1).endswith("composer.field"):
        t = re.search(r"text=\"([^\"]*)\"", s)
        txt, fb = (t.group(1) if t else ""), c
    if rid.group(1).endswith("composer.send"): sb = c
print("%s|%s|%s" % (txt, fb, sb))
'; }

# one adb call with the loop on the device: a host-side loop costs a round trip per character
clear_field() { local n=$(( ${#1} + 4 ))
  ad shell "input keyevent KEYCODE_MOVE_END; i=0; while [ \$i -lt $n ]; do input keyevent 67; i=\$((i+1)); done" >/dev/null 2>&1; }

type_and_verify() { local want=$1 info fx fy got
  info=$(read_ui) || return 1
  fx=$(cut -d'|' -f2 <<<"$info" | cut -d, -f1); fy=$(cut -d'|' -f2 <<<"$info" | cut -d, -f2)
  [ -z "$fx" ] && { echo "field coords not found" >&2; return 1; }
  ad shell "input tap $fx $fy" >/dev/null 2>&1; sleep 2
  clear_field "$want"
  ad shell "input text '$(esc "$want")'" >/dev/null 2>&1; sleep 2
  info=$(read_ui) || return 1
  got=$(cut -d'|' -f1 <<<"$info" | sed 's/ *$//')
  echo "typed : [$got]"
  [ "$got" = "$want" ]; }

focus_or_relaunch || exit 3
guard_screen || exit 4
if ! type_and_verify "$PROMPT"; then
  echo "retry: read-back mismatch or busy UI" >&2
  sleep 4
  if ! type_and_verify "$PROMPT"; then
    info=$(read_ui); clear_field "$(cut -d'|' -f1 <<<"$info")"
    echo "TYPE/VERIFY FAILED AFTER RETRY: nothing sent, field cleared" >&2
    exit 5
  fi
fi

focus_or_relaunch >/dev/null || exit 3
guard_screen || exit 4
INFO=$(read_ui) || { echo "no idle UI before send: ABORT" >&2; exit 6; }
SEND=$(cut -d'|' -f3 <<<"$INFO")
if [ -z "$SEND" ] || [ "$SEND" = "," ]; then
  clear_field "$(cut -d'|' -f1 <<<"$INFO")"
  echo "send button not found: ABORT, field cleared" >&2
  exit 6
fi
ad shell "input tap ${SEND%,*} ${SEND#*,}" >/dev/null 2>&1
sleep 1
echo "SENT: $KIND $(date +%s)"
exit 0
