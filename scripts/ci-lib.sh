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

# Dismiss a system ANR dialog ("<app> isn't responding") covering the screen —
# the loaded CI AVD throws these for Pixel Launcher after multi-GB pushes and
# every node lookup then fails (runs 31235650917/31278860896). Tap Wait (keeps
# processes) and re-foreground the app under test.
dismiss_anr() {
  if dump_ui | grep -qE "isn.{1,3}t responding"; then
    log "ANR dialog detected — tapping Wait + refocusing $PKG"
    tap_node "Wait" || true
    sleep 3
    adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
    sleep 8
  fi
}

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

# After a primary turn-end signal (telemetry / SQL), confirm the chat UI is
# idle before the next type_into_composer. Soft-fail on timeout.
wait_ui_idle() {
  local cap_s="${1:-240}"
  local poll_s=5
  local elapsed=0
  local raw="$OUT/.wait_ui_idle_raw.xml"
  local dump="$OUT/.wait_ui_idle_dump.txt"
  log "wait_ui_idle: confirming UI idle (cap ${cap_s}s)"
  while [ "$elapsed" -lt "$cap_s" ]; do
    # ONE dump per iteration (a uiautomator dump + cat is expensive on a loaded
    # AVD; two of them doubled the cost for nothing).
    dump_ui > "$raw" 2>/dev/null || true
    grep -o 'text="[^"]\{1,200\}"' "$raw" 2>/dev/null | sed 's/^text="//; s/"$//' > "$dump" || true
    # Status labels are matched as WHOLE text nodes (-x): a substring grep hit
    # the assistant's own prose ("after reading the docs…") and pinned this
    # helper at the cap on ordinary turns. STATUS_LABELS must cover every label
    # LlamaService can set — "Fetching page…" (web_fetch) was the one missing
    # when a fetch turn slipped through (run 31282669354).
    # Cursor check needs the RAW xml: ui_texts truncates at 200 chars, so a long
    # streaming bubble's trailing ▋ never reaches $dump.
    if grep -qxF "Ask a question…" "$dump" 2>/dev/null \
      && ! grep -qxFf <(printf '%s\n' "Writing" "Thinking" "Searching the web…" "Fetching page…" "Tool failed — continuing without it") "$dump" 2>/dev/null \
      && ! grep -qF "▋" "$raw" 2>/dev/null; then
      log "wait_ui_idle: UI idle after ${elapsed}s"
      return 0
    fi
    sleep "$poll_s"
    elapsed=$((elapsed + poll_s))
    log "wait_ui_idle: still in-flight (${elapsed}s/${cap_s}s)"
  done
  log "WARN: wait_ui_idle timed out after ${cap_s}s — continuing (soft-fail; dump → turnend_timeout_ui.txt)"
  ui_texts > "$OUT/turnend_timeout_ui.txt" 2>/dev/null || true
  return 0
}

# Capture the last native loadPrompt reuse line for turn N into $OUT/reuse_tN.txt.
# Ground truth for prefix reuse: "Input processed: n_past=<REUSED>, embd.size=<TOTAL>".
# Do NOT use KALSA_TELEMETRY tokensCached — that field is n_past at END of completion
# (total context length), not tokens reused from the KV cache.
# Attribution: `tail -1` is the chat turn's line because no utility completion
# runs after it in CI (memory extract is opt-in and unseeded). If a background
# summarize ever lands between the reply and this call, its own (cold) line wins
# and the verdict under-reports warm — conservative, never a false WARM.
#   capture_kv_reuse <turn_number>
capture_kv_reuse() {
  local turn="$1"
  local dest="$OUT/reuse_t${turn}.txt"
  # Always create the file (empty when no match → UNKNOWN at the verdict).
  adb logcat -d 2>/dev/null \
    | grep -oE "Input processed: n_past=[0-9]+, embd\.size=[0-9]+" \
    | tail -1 > "$dest" || true
  [ -f "$dest" ] || : > "$dest"
  if [ -s "$dest" ]; then
    log "kv_reuse turn${turn}: $(tr -d '\r\n' < "$dest")"
  else
    log "kv_reuse turn${turn}: (no Input processed line)"
  fi
  # When checkpoint recovery failed, the patched binding names WHY (n_common vs
  # the snapshot lengths it holds) — capture it next to the reuse line.
  local diag="$OUT/kvdiag_t${turn}.txt"
  adb logcat -d 2>/dev/null \
    | grep -oE "KALSA_KVDIAG n_common=[0-9]+ total=[0-9]+ search_max=[0-9]+ checkpoints=\[[0-9,]*\]" \
    | tail -1 > "$diag" || true
  [ -f "$diag" ] || : > "$diag"
  [ -s "$diag" ] && log "kvdiag turn${turn}: $(tr -d '\r\n' < "$diag")"
  return 0
}

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
