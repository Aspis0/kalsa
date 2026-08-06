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
# fuser (psmisc) is not installed in Termux by default, so it cannot be the
# only check: when it's missing the scan below is what actually runs. Every
# process that matters here (llama-cli, bmoe-cli, this harness) runs under
# our own uid, so its /proc/<pid>/maps is readable by us; other uids' entries
# just fail to open and are skipped.
my_pid=$$
for f in "$@"; do
  holder=""
  canon=$(realpath "$f" 2>/dev/null || echo "$f")
  for procdir in /proc/[0-9]*; do
    pid="${procdir#/proc/}"
    [ "$pid" = "$my_pid" ] && continue
    if grep -F -q -m1 "$canon" "$procdir/maps" 2>/dev/null; then
      holder="$pid"
      break
    fi
    # maps lists mappings only. A file merely held open — a stalled copy, a
    # half-finished download, a reader that never mmapped — keeps its pages
    # just as resident, and shows up only under fd/.
    for link in "$procdir"/fd/*; do
      [ -e "$link" ] || continue
      target=$(readlink "$link" 2>/dev/null) || continue
      if [ "$target" = "$canon" ]; then
        holder="$pid"
        break 2
      fi
    done
  done
  if [ -z "$holder" ] && command -v fuser >/dev/null 2>&1; then
    fuser "$f" >/dev/null 2>&1 && holder="(fuser)"
  fi
  if [ -n "$holder" ]; then
    echo "cold_model.sh: $f is still open by another process (pid=$holder)" >&2
    exit 4
  fi
done

sync
"$FADV" "$@"
echo "cold_model.sh: COLD_OK $(date -Iseconds)"
