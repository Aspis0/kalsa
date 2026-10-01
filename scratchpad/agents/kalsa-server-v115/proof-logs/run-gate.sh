#!/bin/bash
# exact verify-step shell under the exact step options: set -euo pipefail
set -euo pipefail
BIN="$1"
# no grep -q: it exits at the first match, the producer dies of
# SIGPIPE on the rest of its output, and pipefail turns that into 141
if ! strings "$BIN/libllama-server-impl.dylib" | grep -Fx 'x-kalsa-slot' > /dev/null; then
  echo "libllama-server-impl.dylib does not carry the x-kalsa-slot inlet tag" >&2
  exit 1
fi
