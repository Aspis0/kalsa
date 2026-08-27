#!/bin/bash
cd /c/Users/gualt/llama-rn-pin
for f in ./scripts/patches/*.patch; do
  printf '%s: ' "$(basename "$f")"
  if patch --dry-run --batch --forward -p0 -d ./cpp < "$f" >/tmp/patch.out 2>/tmp/patch.err; then
    echo APPLYABLE
  else
    echo SKIP_OR_FAIL
  fi
  tail -n 2 /tmp/patch.out /tmp/patch.err 2>/dev/null | sed 's/^/  /'
done
