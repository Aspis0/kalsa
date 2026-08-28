#!/usr/bin/env bash
# Reproduces the in-app model download (Settings -> "Download" on the active
# model row -> Alert -> "Download") on a KVM-accelerated emulator, over the
# real network. Users report this fails partway on a real phone; ci-e2e.sh
# never exercises it because it sideloads the GGUF via adb instead. This
# script does NOT sideload anything — the whole point is to let the app
# download the model itself and capture the true error.
#
# Target is Qwen 3.5 4B, not 2B: Settings renders a tappable "Download"
# button ONLY for the ACTIVE model row (others just show "Select"), 4B is
# the default active model, and it is also what the reporting user actually
# hit on device. It is a 2-file bundle: main GGUF first, then the vision
# mmproj; the UI chip shows the aggregated percent.
# Evidence (screenshots, UI dumps, logcat, verdict) lands in ./download-out.
set -uo pipefail
OUT="download-out"; mkdir -p "$OUT"
PKG=com.kalsa.app

# shellcheck source=ci-lib.sh
source "$(dirname "$0")/ci-lib.sh"

MODEL_DIR="qwen3.5-4b"
MODEL_FILE="Qwen3.5-4B-Q4_K_M.gguf"
GGUF_PATH="/data/data/$PKG/files/models/$MODEL_DIR/$MODEL_FILE"
EXPECTED_SIZE=2834975040
MMPROJ_PATH="/data/data/$PKG/files/models/$MODEL_DIR/mmproj-F16.gguf"
MMPROJ_EXPECTED_SIZE=672423616

# Like tap_node, but taps the LAST bounds match instead of the first. When the
# download Alert is open the dump contains BOTH the settings "Download" button
# (background window) and the Alert's "Download" button; windows are dumped in
# z-order so the dialog's node comes last.
tap_node_last() {
  local needle="$1"
  local b
  b=$(dump_ui | tr '>' '\n' \
      | grep -E "content-desc=\"$needle\"|text=\"$needle\"" \
      | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | tail -1)
  [ -z "$b" ] && { log "node '$needle' NOT FOUND"; return 1; }
  local n; n=$(echo "$b" | grep -o '[0-9]\+' | tr '\n' ' ')
  local x1 y1 x2 y2; read -r x1 y1 x2 y2 <<< "$n"
  local cx=$(( (x1 + x2) / 2 )) cy=$(( (y1 + y2) / 2 ))
  log "tap last '$needle' at ${cx},${cy}"
  adb shell input tap "$cx" "$cy"
}

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

# Scroll until the active row's "Download" button is on screen, tapping FIRST
# on every iteration (the previous run scrolled the button into view on the
# 4th swipe and then never tapped it — classic off-by-one). "Download speech
# model" higher up cannot false-match: tap_node's pattern includes the closing
# quote, so only the exact text "Download" hits.
log "scroll to the active model's Download button"
FOUND=0
for i in 1 2 3 4 5 6 7 8; do
  if tap_node "Download"; then
    FOUND=1
    break
  fi
  log "Download button not visible yet — scrolling (attempt $i)"
  adb shell input swipe 540 1800 540 800 300
  sleep 2
done
[ "$FOUND" -eq 1 ] || die "active model Download button not found after scrolling"

sleep 2
shot 04_dialog
log "confirm download in the Alert"
# Alert buttons can be rendered ALL-CAPS depending on the dialog theme.
tap_node_last "Download" || tap_node_last "DOWNLOAD" || die "Alert Download button not found"

# API 33+: startDownload awaits the POST_NOTIFICATIONS runtime permission
# before the transfer begins — the system dialog would otherwise sit there
# swallowing the run. Either button unblocks it; denial only mutes progress
# notifications.
sleep 3
shot 05_perm
tap_node "Allow" || tap_node "ALLOW" || log "no notification permission dialog (ok)"

# Early sanity: ~30s after the confirm the transfer should be visible either
# in the UI chip or on disk. Warn loudly if not, but keep polling — a slow
# start is not proof of failure.
sleep 30
ui_texts > "$OUT/06_after_confirm.txt"
shot 06_after_confirm
EARLY_SZ=$(adb shell stat -c %s "$GGUF_PATH" 2>/dev/null | tr -d '\r')
if ! grep -qi "Downloading" "$OUT/06_after_confirm.txt" && [ -z "$EARLY_SZ" ]; then
  log "WARNING: no Downloading chip and no file on disk 30s after confirm"
fi

log "polling for terminal state (up to 20 min — the bundle is ~3.5 GB)"
START=$(date +%s)
VERDICT="TIMEOUT"
for i in $(seq 1 120); do
  sleep 10
  ui_texts > "$OUT/poll_$i.txt"
  if [ $(( i % 6 )) -eq 0 ]; then
    shot "poll_$i"
  fi

  DLLINE=$(grep -i "Downloading" "$OUT/poll_$i.txt" || true)
  [ -n "$DLLINE" ] && log "poll $i: $DLLINE"

  SZ=$(adb shell stat -c %s "$GGUF_PATH" 2>/dev/null | tr -d '\r')
  [ -n "$SZ" ] && log "poll $i: gguf on-disk size=$SZ bytes"
  MSZ=$(adb shell stat -c %s "$MMPROJ_PATH" 2>/dev/null | tr -d '\r')
  [ -n "$MSZ" ] && log "poll $i: mmproj on-disk size=$MSZ bytes"

  if grep -qE "Download failed|Download incomplete" "$OUT/poll_$i.txt"; then
    VERDICT="REPRO_DOWNLOAD_FAILED"
    # The app renders the real error (modelError, up to 2 lines) under the
    # active model row — this dump is the evidence the run exists for.
    cp "$OUT/poll_$i.txt" "$OUT/fail_ui_state.txt"
    log "poll $i: terminal FAIL state detected"
    break
  fi
  if grep -qE "Downloaded|Ready · local" "$OUT/poll_$i.txt"; then
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
FINAL_MSZ=$(adb shell stat -c %s "$MMPROJ_PATH" 2>/dev/null | tr -d '\r')
FINAL_MSZ="${FINAL_MSZ:-0}"

{
  echo "VERDICT=$VERDICT"
  echo "gguf_final_size_bytes=$FINAL_SZ"
  echo "gguf_expected_size_bytes=$EXPECTED_SIZE"
  echo "mmproj_final_size_bytes=$FINAL_MSZ"
  echo "mmproj_expected_size_bytes=$MMPROJ_EXPECTED_SIZE"
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
