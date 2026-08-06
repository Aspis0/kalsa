#!/usr/bin/env bash
# Reproduces the in-app model download (Settings -> tap a model row -> Alert
# -> "Download") on a KVM-accelerated emulator, over the real network. Users
# report this fails partway on a real phone; ci-e2e.sh never exercises it
# because it sideloads the GGUF via adb instead. This script does NOT
# sideload anything — the whole point is to let the app download the model
# itself and capture the true error.
# Evidence (screenshots, UI dumps, logcat, verdict) lands in ./download-out.
set -uo pipefail
OUT="download-out"; mkdir -p "$OUT"
PKG=com.kalsa.app

# shellcheck source=ci-lib.sh
source "$(dirname "$0")/ci-lib.sh"

MODEL_DIR="qwen3.5-2b"
MODEL_FILE="Qwen3.5-2B-Q4_K_M.gguf"
GGUF_PATH="/data/data/$PKG/files/models/$MODEL_DIR/$MODEL_FILE"
EXPECTED_SIZE=1280835840

adb wait-for-device
adb shell settings put global hide_error_dialogs 1 || true
adb root >/dev/null 2>&1 || true; sleep 5; adb wait-for-device

log "install APK (no model sideload — the app must fetch it itself)"
adb install -r "android/app/build/outputs/apk/release/app-release.apk" 2>&1 | tail -2

log "launch app"
adb logcat -c
adb shell am start -n "$PKG/.MainActivity" >/dev/null
sleep 30
shot 01_home
ui_texts > "$OUT/01_home.txt"

log "open drawer and go to Settings"
tap_node "Menu" || die "Menu not found"
sleep 3
shot 02_drawer
tap_node "Settings" || die "Settings not found"
sleep 4
shot 03_settings
ui_texts > "$OUT/03_settings.txt"

log "find model row 'Qwen 3.5 2B' (smallest model, 1.3 GB, no vision file)"
FOUND=0
for i in 1 2 3 4; do
  if tap_node "Qwen 3.5 2B"; then
    FOUND=1
    break
  fi
  log "row not visible yet — scrolling (attempt $i)"
  adb shell input swipe 540 1800 540 800 300
  sleep 2
done
[ "$FOUND" -eq 1 ] || die "Qwen 3.5 2B model row not found after scrolling"

sleep 2
shot 04_dialog
log "confirm download in the Alert"
# Alert buttons can be rendered ALL-CAPS depending on the dialog theme.
tap_node "Download" || tap_node "DOWNLOAD" || die "Download button not found"

# API 33+: startDownload awaits the POST_NOTIFICATIONS runtime permission
# before the transfer begins — the system dialog would otherwise sit there
# swallowing the run. Either button unblocks it; denial only mutes progress
# notifications.
sleep 3
shot 05_perm
tap_node "Allow" || tap_node "ALLOW" || log "no notification permission dialog (ok)"

log "polling for terminal state (up to 15 min)"
START=$(date +%s)
VERDICT="TIMEOUT"
for i in $(seq 1 90); do
  sleep 10
  ui_texts > "$OUT/poll_$i.txt"
  if [ $(( i % 6 )) -eq 0 ]; then
    shot "poll_$i"
  fi

  DLLINE=$(grep -i "Downloading" "$OUT/poll_$i.txt" || true)
  [ -n "$DLLINE" ] && log "poll $i: $DLLINE"

  SZ=$(adb shell stat -c %s "$GGUF_PATH" 2>/dev/null | tr -d '\r')
  [ -n "$SZ" ] && log "poll $i: on-disk size=$SZ bytes"

  if grep -qE "Download failed|Download incomplete" "$OUT/poll_$i.txt"; then
    VERDICT="REPRO_DOWNLOAD_FAILED"
    log "poll $i: terminal FAIL state detected"
    break
  fi
  if grep -qE "Downloaded|Ready · local|Ready" "$OUT/poll_$i.txt"; then
    VERDICT="DOWNLOAD_OK"
    log "poll $i: terminal PASS state detected"
    break
  fi
done
ELAPSED=$(( $(date +%s) - START ))

log "collecting final evidence"
shot 99_final
ui_texts > "$OUT/99_final.txt"
adb logcat -d > "$OUT/logcat_full.txt"
adb logcat -d | grep -iE "ReactNativeJS|ExponentFileSystem|FileSystem|okhttp|DownloadResumable|Exception|Error" | tail -300 > "$OUT/logcat_filtered.txt"

FINAL_SZ=$(adb shell stat -c %s "$GGUF_PATH" 2>/dev/null | tr -d '\r')
FINAL_SZ="${FINAL_SZ:-0}"

{
  echo "VERDICT=$VERDICT"
  echo "final_size_bytes=$FINAL_SZ"
  echo "expected_size_bytes=$EXPECTED_SIZE"
  echo "elapsed_seconds=$ELAPSED"
} > "$OUT/RESULT.txt"
cat "$OUT/RESULT.txt"

case "$VERDICT" in
  DOWNLOAD_OK)
    log "PASS: in-app download completed"
    exit 0
    ;;
  REPRO_DOWNLOAD_FAILED)
    log "FAIL (expected): bug reproduced, evidence saved in $OUT"
    exit 1
    ;;
  *)
    log "FAIL: timed out waiting for a terminal state"
    exit 1
    ;;
esac
