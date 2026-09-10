#!/usr/bin/env bash
# Fast "next send during extraction" driver for the e455afc check.
#
# Waits for the turn-end line (KALSA_MEMORY {...}, NOT KALSA_MEMORY_EXTRACT),
# then immediately delivers the next message: share intent -> poll composer
# (1 s) -> tap Send. The point is to abort the running extraction
# (`aborted_by_send`), not to wait for it.
#
# Usage: ANDROID_SERIAL=<serial> fast_abort_send.sh <msg> <outdir>
set -uo pipefail

MSG="$1"
OUT="${2:-fast-abort-out}"
mkdir -p "$OUT"

_LOG_TAG="[fast-abort]"

KALSA_ROOT=/Users/marco/Projects/kalsa
export OUT
export BENCH_TARGET=device
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/ci-lib.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-env.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-share-send.sh"

# Define log AFTER the shared libs: ci-lib.sh ships its own log() and sourcing it
# would otherwise clobber this one (observed 2026-09-10: no fast-abort.log written).
log() { echo "$_LOG_TAG $*" | tee -a "$OUT/fast-abort.log"; }

log "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) epoch_ms=$(python3 -c 'import time;print(int(time.time()*1000))') msg='$MSG'"

# 0. Baseline: how many turn-end lines already exist. The abort must land on a
#    NEW turn-end line's extraction, not on one that already finished.
baseline=$(adb shell logcat -d -v time 2>/dev/null | grep -cE 'KALSA_MEMORY \{')
log "baseline turn-end lines: $baseline"

# 1. Wait for the NEXT turn-end line (the turn in progress).
t=0
while [ "$t" -lt 900 ]; do
  count=$(adb shell logcat -d -v time 2>/dev/null | grep -cE 'KALSA_MEMORY \{')
  if [ "$count" -gt "$baseline" ]; then
    line=$(adb shell logcat -d -v time 2>/dev/null | grep -E 'KALSA_MEMORY \{' | tail -1)
    log "new turn-end seen after ${t}s: $(printf '%s' "$line" | cut -c1-200)"
    break
  fi
  sleep 1
  t=$((t+1))
done
if [ "${count:-0}" -le "$baseline" ]; then
  log "FATAL: no new turn-end line within 900s"
  exit 1
fi

# 2. Deliver the next message as fast as the composer allows.
prev=$(device_history_assistant_count)
nonce="abort_$(date +%s)"
enc=$(device_share_encode "$MSG") || { log "encode failed"; exit 1; }
log "sending share intent utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell am start -a android.intent.action.VIEW -d "'kalsa://share?text=${enc}#n=${nonce}'" >/dev/null

needle=$(printf '%s' "$MSG" | cut -c1-40)
seen=0
t=0
while [ "$t" -lt 20 ]; do
  ui=$(device_dump_ui_retry || true)
  ctext=$(device_composer_from_ui "$ui" || true)
  if [ -n "$ctext" ] && printf '%s' "$ctext" | grep -qF "$needle"; then
    seen=1
    log "text in composer after ${t}s utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    break
  fi
  sleep 1
  t=$((t+1))
done
if [ "$seen" != 1 ]; then
  log "FATAL: text never appeared in composer"
  exit 1
fi

for a in 1 2 3; do
  if device_tap_send; then
    log "Send tapped (attempt $a) utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    break
  fi
  log "Send node not found (attempt $a)"
  sleep 1
done

log "done prev_assistants=$prev utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
