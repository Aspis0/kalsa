#!/bin/sh
# Stands in for a server that dies on its own after it was already serving.
#
# The delay matters: the supervisor's handshake succeeds first (the test's HTTP
# listener answers immediately), so what runs is the watcher path — a child that
# dies while we are not looking — not the startup path.
port=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "--port" ]; then port="$arg"; fi
  previous="$arg"
done
if [ -n "$port" ]; then
  echo $$ > "${TMPDIR:-/tmp}/kalsa-fake-$port.pid"
fi

sleep 0.5
echo "fake server: failed to load the model" >&2
exit 7
