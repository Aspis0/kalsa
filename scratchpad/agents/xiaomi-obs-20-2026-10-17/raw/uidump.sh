#!/bin/bash
# Dump the current UI hierarchy as XML on stdout, waiting for the UI to go idle.
#
# WHY THIS EXISTS: uiautomator refuses to dump while the UI is animating or a
# React Native view is re-rendering, and prints "ERROR: could not get idle state."
# with exit code 0 - a silent failure that looks like an empty hierarchy. That is
# what broke the new-chat step of turn 15 and the read-back of turn 16. The fix is
# to retry until the dump really contains the app's composer nodes, with a short
# settle between attempts, and to give up loudly rather than returning junk.
#
# The scratch file is the one uiautomator writes by default; it is removed right
# after reading and never written into app data.
S='adb-625689a2-9xEOfw._adb-tls-connect._tcp'
TMP=/data/local/tmp/kalsa-uidump.xml
NEED="${1:-}"     # optional: require this substring to appear in the dump

for attempt in 1 2 3 4 5 6 7 8; do
  adb -s "$S" shell "rm -f $TMP /sdcard/window_dump.xml" >/dev/null 2>&1
  adb -s "$S" shell uiautomator dump "$TMP" >/dev/null 2>&1
  XML=$(adb -s "$S" exec-out cat "$TMP" 2>/dev/null)
  adb -s "$S" shell "rm -f $TMP" >/dev/null 2>&1
  if [ -n "$XML" ] && echo "$XML" | grep -q 'composer.field\|hierarchy'; then
    if [ -z "$NEED" ] || echo "$XML" | grep -q "$NEED"; then
      printf '%s' "$XML"
      exit 0
    fi
  fi
  sleep 3
done
echo "uidump: no idle hierarchy after 8 attempts" >&2
exit 1