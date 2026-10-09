#!/bin/sh
port=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "--port" ]; then port="$arg"; fi
  previous="$arg"
done
if [ -n "$port" ]; then echo $$ > "${TMPDIR:-/tmp}/kalsa-fake-$port.pid"; fi
sleep 0.5
echo "GGML_ASSERT ggml-vulkan.cpp:1234" >&2
echo "backtrace frame 9000" >&2
kill -TERM $$
