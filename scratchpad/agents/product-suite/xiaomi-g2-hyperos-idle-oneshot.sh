#!/usr/bin/env bash
# Xiaomi 14 G2 draft: HyperOS false-refusal / idle MemAvailable after a loaded LFM.
# DO NOT RUN while lockscreen PIN is up. DO NOT RUN if battery ≥40 °C.
# Does not delete files. Does not load MiniCPM5. Does not touch S23/Jelly.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.193:37707}"
export BENCH_TARGET=device
export PKG=com.kalsa.app
KALSA_ROOT=/Users/marco/Projects/kalsa
OUT="${OUT:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/XIAOMI-G2-HYPEROS-2026-09-11}"
mkdir -p "$OUT"
export OUT
case "$ANDROID_SERIAL" in
  192.168.1.193:*) ;;
  *) echo "FATAL: not Xiaomi"; exit 2 ;;
esac
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/ci-lib.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-env.sh"
log() { echo "[xhy] $*" | tee -a "$OUT/run.log"; }

care() {
  adb shell dumpsys battery > "$OUT/battery-$1.txt"
  adb shell dumpsys thermalservice > "$OUT/thermal-$1.txt"
  adb shell cat /proc/meminfo > "$OUT/meminfo-$1.txt"
  log "care $1 $(awk '/^[[:space:]]+temperature:/{print "batt="$2} /^[[:space:]]+level:/{print "level="$2}' "$OUT/battery-$1.txt") $(awk '/MemAvailable/{print}' "$OUT/meminfo-$1.txt")"
}

if dump_ui 2>/dev/null | grep -q 'Enter PIN or use fingerprint'; then
  log "FATAL locked"
  exit 4
fi
care idle
t=$(awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/{print $2; exit}' "$OUT/battery-idle.txt")
[ "${t:-0}" -ge 400 ] && { log "STOP thermal $t"; exit 3; }

adb shell am start -n "$PKG/.MainActivity" >/dev/null
sleep 8
# Wait Pronto then record MemAvailable with LFM resident (the false-refusal input).
for i in $(seq 1 60); do
  dump_ui 2>/dev/null | grep -q Pronto && break
  tap_node "Tocca per ricaricare" 2>/dev/null || true
  sleep 3
done
care loaded
log "fit-line follows in logcat"
adb logcat -d -v time | grep -E 'KALSA_|availableMb|no_active_model|fits' | tee "$OUT/kalsa-loaded.txt" || true
adb shell svc power stayon false >/dev/null || true
log "draft done — HOME/idle soak is a later shot, not this file"
