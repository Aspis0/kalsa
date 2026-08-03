#!/usr/bin/env bash
# Shared adb/emulator helpers for Kalsa CI scripts (ci-e2e.sh, ci-bench.sh).
# Proven on a KVM-accelerated GitHub Actions runner (run 30836136405 passed:
# reply after 516s). Bounds-based tap_node, ui_texts, sql idioms are reused
# verbatim — do not "simplify" them, the fixed-coordinate approach they
# replaced was flaky (a 320x640 default AVD once swallowed every tap).
#
# Contract: the sourcing script must set OUT (evidence dir, already created)
# and may override PKG before sourcing this file.
set -uo pipefail

PKG="${PKG:-com.kalsa.app}"
DB="/data/data/$PKG/databases/RKStorage"

log() { echo "[ci] $*"; }
dump_ui() { adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null 2>&1; adb shell cat /data/local/tmp/ui.xml 2>/dev/null; }
ui_texts() { dump_ui | grep -o 'text="[^"]\{1,200\}"' | sed 's/^text="//; s/"$//'; }
shot() { adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null; }
sql() { adb shell "sqlite3 $DB \"$1\"" 2>&1 | tr -d '\r'; }

# Tap a node found by content-desc OR text, using its LIVE bounds. Never use
# fixed coordinates: the CI AVD resolution differs from any dev device, and
# the IME shifts the layout.
tap_node() {
  local needle="$1"
  local b
  b=$(dump_ui | tr '>' '\n' \
      | grep -E "content-desc=\"$needle\"|text=\"$needle\"" \
      | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1)
  [ -z "$b" ] && { log "node '$needle' NOT FOUND"; return 1; }
  local n; n=$(echo "$b" | grep -o '[0-9]\+' | tr '\n' ' ')
  local x1 y1 x2 y2; read -r x1 y1 x2 y2 <<< "$n"
  local cx=$(( (x1 + x2) / 2 )) cy=$(( (y1 + y2) / 2 ))
  log "tap '$needle' at ${cx},${cy}"
  adb shell input tap "$cx" "$cy"
}

# die() expects $OUT to already exist (the caller creates it before sourcing
# or before the first call that can fail).
die() { log "FATAL: $*"; ui_texts > "$OUT/fatal_state.txt" 2>/dev/null; shot fatal; exit 1; }

# Installs the APK, sideloads the GGUF into files/models/<model_dir>/<model_file>,
# and does the first-launch dance that creates the AsyncStorage sqlite db.
#   install_and_sideload <apk_path> <model_src_path> <model_dir> <model_file>
install_and_sideload() {
  local apk="$1"
  local model_src="$2"
  local model_dir="$3"
  local model_file="$4"

  adb wait-for-device
  adb shell settings put global hide_error_dialogs 1 || true
  adb root >/dev/null 2>&1 || true; sleep 5; adb wait-for-device

  log "install APK ($apk)"
  adb install -r "$apk" 2>&1 | tail -2

  log "sideload model $model_file"
  adb push "$model_src" /data/local/tmp/model.gguf 2>&1 | tail -1
  adb shell "mkdir -p /data/data/$PKG/files/models/$model_dir"
  adb shell "cp /data/local/tmp/model.gguf /data/data/$PKG/files/models/$model_dir/$model_file"
  adb shell "rm -f /data/local/tmp/model.gguf"
  local uid_line
  uid_line=$(adb shell "stat -c %U /data/data/$PKG" | tr -d '\r')
  adb shell "chown -R $uid_line:$uid_line /data/data/$PKG/files/models"
  adb shell "ls -la /data/data/$PKG/files/models/$model_dir/" | tr -d '\r'

  log "first launch (creates AsyncStorage db)"
  adb shell am start -n "$PKG/.MainActivity" >/dev/null; sleep 25
  adb shell am force-stop "$PKG"; sleep 3
}

# Tap the composer by widget class — works whether or not it already has text
# (the "Ask a question…" placeholder disappears as soon as the user types).
tap_editable() {
  local b
  b=$(dump_ui | tr '>' '\n' | grep 'class="android.widget.EditText"' \
      | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1)
  [ -z "$b" ] && { log "no EditText on screen"; return 1; }
  local n; n=$(echo "$b" | grep -o '[0-9]\+' | tr '\n' ' ')
  local x1 y1 x2 y2; read -r x1 y1 x2 y2 <<< "$n"
  log "tap EditText at $(( (x1 + x2) / 2 )),$(( (y1 + y2) / 2 ))"
  adb shell input tap $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))
}

# Type a possibly multi-word string reliably.
# `adb shell input text "a b"` reaches the device as two arguments (only "a" is
# typed) and the %s escape is not honoured consistently across images, so type
# each word and press KEYCODE_SPACE (62) in between.
type_text() {
  local msg="$1" first=1 w
  for w in $msg; do
    [ "$first" -eq 1 ] || adb shell input keyevent 62
    adb shell input text "$w"
    first=0
  done
}

# What is actually in the EditText right now (for diagnostics).
composer_text() {
  dump_ui | tr '>' '\n' | grep 'class="android.widget.EditText"' \
    | grep -o 'text="[^"]*"' | head -1 | sed 's/^text="//; s/"$//'
}
