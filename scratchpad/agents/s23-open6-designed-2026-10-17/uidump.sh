#!/bin/bash
# Dump the current UI hierarchy as XML on stdout, waiting for the UI to go idle.
# uiautomator answers "could not get idle state" with rc 0 and no hierarchy while Kalsa is still rendering, so this
# retries until the dump really has the composer (or the optional substring) and gives up loudly otherwise.
# The dump file lives in /data/local/tmp and is removed right after reading. Nothing is written into app data.
. "$(dirname "$0")/env.sh"
TMP=/data/local/tmp/kalsa-uidump.xml
NEED="${1:-}"

for attempt in 1 2 3 4 5 6 7 8; do
  ad shell "rm -f $TMP" >/dev/null 2>&1
  ad shell "uiautomator dump $TMP" >/dev/null 2>&1
  XML=$(ad exec-out cat "$TMP" 2>/dev/null)
  ad shell "rm -f $TMP" >/dev/null 2>&1
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
