#!/bin/sh
# Stands in for a wedged server: it never reads stdin (so EOF means nothing to
# it) and it ignores SIGTERM. Only SIGKILL to its process group ends it, which
# is what the escalation test checks.
port=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "--port" ]; then port="$arg"; fi
  previous="$arg"
done
if [ -n "$port" ]; then
  echo $$ > "${TMPDIR:-/tmp}/kalsa-fake-$port.pid"
fi

trap '' TERM
while :; do
  sleep 1
done
