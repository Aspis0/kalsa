#!/data/data/com.termux/files/usr/bin/bash
# cold_model.sh — put a model file into a verified "cold" state without root.
#
# On this device a reboot cannot be triggered from Termux (no android.permission
# .REBOOT) and /proc/sys/vm/drop_caches is not writable, so cold-cache runs use
# posix_fadvise(DONTNEED) on the model file itself. This is *more* surgical than
# a reboot: it evicts exactly the file under test and nothing else.
#
# Exits non-zero if the file is still resident afterwards, so a caller can fail
# the run instead of silently reporting a warm number as cold.
set -euo pipefail

FADV="${FADV:-$HOME/bin/fadv}"

if [ $# -lt 1 ]; then
  echo "usage: cold_model.sh MODEL.gguf [MORE.gguf...]" >&2
  exit 2
fi

if [ ! -x "$FADV" ]; then
  echo "cold_model.sh: $FADV missing or not executable" >&2
  exit 2
fi

# Any live process holding the file mapped keeps its pages resident.
for f in "$@"; do
  if command -v fuser >/dev/null 2>&1 && fuser "$f" >/dev/null 2>&1; then
    echo "cold_model.sh: $f is still open by another process" >&2
    exit 4
  fi
done

sync
"$FADV" "$@"
echo "cold_model.sh: COLD_OK $(date -Iseconds)"
