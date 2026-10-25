#!/bin/sh
# Lab-only: headless Chrome screenshot of one PUBLIC URL, with a throwaway profile.
# Never point this at the owner's screen or windows. Headless Chrome writes the
# PNG and then stays alive, so we wait for the file to stop growing and kill it.
# usage: capture-shot.sh <url> <width> <height> <out.png>
set -u
url=$1
w=$2
h=$3
out=$4
prof=/tmp/lab-screen/chrome-profile-$$
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

rm -rf "$prof"
"$chrome" --headless=new --user-data-dir="$prof" --no-first-run --disable-gpu \
  --hide-scrollbars --virtual-time-budget=15000 --window-size="$w,$h" \
  --screenshot="$out" "$url" > "$prof.log" 2>&1 &
pid=$!

size=-1
i=0
while [ $i -lt 90 ]; do
  sleep 1
  i=$((i + 1))
  now=$(stat -f %z "$out" 2>/dev/null || echo 0)
  if [ "$now" -gt 0 ] && [ "$now" = "$size" ]; then
    break
  fi
  size=$now
done

kill "$pid" 2>/dev/null
pkill -f "chrome-profile-$$" 2>/dev/null
rm -rf "$prof" "$prof.log"

if [ -s "$out" ]; then
  echo "OK $out $w x $h"
  exit 0
fi
echo "FAILED $out"
exit 1
