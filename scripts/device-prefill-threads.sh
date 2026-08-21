#!/usr/bin/env bash
# HARNESS_FINDINGS §7.32 open question: is prefill paced by the little cores?
#
# The Jelly is 6×A55 (capacity 348) + 2×A76 (1024) and our helio-g99 preset
# runs prefill on 8 threads. llama.cpp finishes a batch when its slowest thread
# does, so six third-speed threads may be setting the pace for all eight.
#
# WHY THE PREWARM AND NOT A TURN: `KALSA_PREWARM {"op":"done","promptMs":…}` is
# a prompt eval of the static system+tools prefix with `n_predict: 0` — the same
# ~1300 tokens every time, no sampling, no decode, no reply to wait for. It is
# the cleanest controlled prefill this app can produce. A chat turn would mix in
# whatever the KV happened to hold.
#
# Each arm therefore needs a COLD KV, which is why the pooled `.kvs` files are
# removed between arms. ⛔ Only `files/sessions/` is touched — never
# `files/models/`, which holds ~11 GB of sideloaded GGUF with verified md5.
#
# One invocation, keep-awake armed at the top, `</dev/null` on every adb call.
#
#   ANDROID_SERIAL=<serial> scripts/device-prefill-threads.sh [decodeThreads] [prefillCounts…]
set -uo pipefail

_PT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=device-share-send.sh
source "$_PT_DIR/device-share-send.sh"

OUT="${OUT:-device-prefill-threads-out}"
ACTIVITY="${ACTIVITY:-com.kalsa.app/.MainActivity}"
PREWARM_TIMEOUT="${PREWARM_TIMEOUT:-420}"

pt_clear_sessions() {
  adb shell "run-as com.kalsa.app sh -c 'rm -f files/sessions/*.kvs files/sessions/*.kvs.meta files/sessions/*.kvs.bak files/sessions/*.kvs.tmp'" </dev/null >/dev/null 2>&1 || true
  log "sessions cleared: $(adb shell 'run-as com.kalsa.app ls files/sessions' </dev/null 2>/dev/null | tr -d '\r' | wc -l | tr -d ' ') entries left"
}

# Wait for one KALSA_PREWARM done|skip line and print it.
pt_wait_prewarm() {
  local t=0 line
  while [ "$t" -lt "$PREWARM_TIMEOUT" ]; do
    line=$(adb logcat -d </dev/null 2>/dev/null | tr -d '\r' | grep -F "KALSA_PREWARM" | grep -E '"op":"(done|skip)"' | tail -1)
    if [ -n "$line" ]; then
      printf '%s\n' "$line"
      return 0
    fi
    sleep 5
    t=$((t + 5))
  done
  return 1
}

pt_arm() {
  local decode="$1" prefill="$2" line
  log "=== arm decode=${decode} prefill=${prefill} ==="
  # The override is read at ENGINE INIT, so it must be written before the
  # relaunch, not after. device_share_send delivers it through the composer,
  # which is the only channel that reaches React state on a physical device.
  device_share_send "bench:engine threads=${decode},threadsPrefill=${prefill}" || {
    log "arm ${prefill}: could not deliver the bench command"
    return 1
  }
  sleep 3
  adb shell am force-stop com.kalsa.app </dev/null >/dev/null 2>&1
  sleep 5
  pt_clear_sessions
  adb logcat -c </dev/null >/dev/null 2>&1 || true
  adb shell am start -n "$ACTIVITY" </dev/null >/dev/null 2>&1
  if line=$(pt_wait_prewarm); then
    log "arm ${prefill}: $line"
    printf '%s\t%s\t%s\n' "$decode" "$prefill" "$line" >> "$OUT/prewarm.tsv"
  else
    log "arm ${prefill}: no KALSA_PREWARM within ${PREWARM_TIMEOUT}s"
    printf '%s\t%s\t%s\n' "$decode" "$prefill" "TIMEOUT" >> "$OUT/prewarm.tsv"
  fi
  log "arm ${prefill}: $(device_battery_level)% $(device_battery_temp_deci) thermal=$(device_thermal_status)"
}

pt_main() {
  local decode="${1:-2}"; shift || true
  local counts=("$@")
  [ "${#counts[@]}" -gt 0 ] || counts=(2 4 6 8)
  local attached picked n
  mkdir -p "$OUT"
  attached=$(adb devices 2>/dev/null | awk '$2=="device" {print $1}')
  picked=$(device_pick_serial "${ANDROID_SERIAL:-}" "$attached") \
    || die "need ANDROID_SERIAL (attached: $(printf '%s' "$attached" | tr '\n' ' '))"
  export ANDROID_SERIAL="$picked"
  BENCH_TARGET=device
  log "serial=$ANDROID_SERIAL decode=$decode prefill counts=${counts[*]}"

  device_keepawake_begin
  : > "$OUT/prewarm.tsv"
  for n in "${counts[@]}"; do
    pt_arm "$decode" "$n"
  done

  # Leave the device on production settings: an override left behind silently
  # poisons every later measurement on this phone.
  device_share_send "bench:engine clear" || log "WARNING: could not clear the engine override — do it by hand"
  log "results: $OUT/prewarm.tsv"
  cat "$OUT/prewarm.tsv"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -uo pipefail
  pt_main "$@"
fi
