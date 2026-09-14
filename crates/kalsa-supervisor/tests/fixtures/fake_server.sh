#!/bin/sh
# Stands in for llama-server in the supervisor tests.
#
# Answers nothing: the test hosts the HTTP listener that the supervisor probes,
# so the handshake path is exercised for real without a model or a server.
#
# Records its own pid under $TMPDIR/kalsa-fake-<port>.pid (the port comes from
# --port in the supervisor's arguments) so the test can prove the child was
# really reaped, not merely forgotten.
port=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "--port" ]; then port="$arg"; fi
  previous="$arg"
done
if [ -n "$port" ]; then
  echo $$ > "${TMPDIR:-/tmp}/kalsa-fake-$port.pid"
fi

# Waits for stdin EOF: closing the supervisor's end of the pipe is the stop
# signal, and this is the whole reason stdin is piped rather than /dev/null.
cat > /dev/null
exit 0
