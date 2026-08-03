#!/usr/bin/env bash
# Drives Kalsa on a KVM-accelerated emulator and proves one real inference turn.
# Evidence (screenshots, UI dumps, logcat, chat DB) lands in ./e2e-out.
set -uo pipefail
OUT="e2e-out"; mkdir -p "$OUT"
MODEL_FILE="${MODEL_FILE:-Qwen3.5-2B-Q4_K_M.gguf}"
MODEL_DIR="${MODEL_DIR:-qwen3.5-2b}"
COMPACTION_IN="${COMPACTION:-on}"
THINKING="${THINKING:-off}"
PKG=com.kalsa.app
DB=/data/data/$PKG/databases/RKStorage

log() { echo "[e2e] $*"; }
dump_ui() { adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null 2>&1; adb shell cat /data/local/tmp/ui.xml 2>/dev/null; }
ui_texts() { dump_ui | grep -o 'text="[^"]\{1,200\}"' | sed 's/^text="//; s/"$//'; }
shot() { adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null; }
sql() { adb shell "sqlite3 $DB \"$1\"" 2>&1 | tr -d '\r'; }
# Find a clickable node's tap point by content-desc (bounds are live, so this
# survives keyboard-driven layout shifts — the trap that cost us on RunPod).
tap_desc() {
  local desc="$1"
  local b
  b=$(dump_ui | tr '>' '\n' | grep "content-desc=\"$desc\"" | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1)
  [ -z "$b" ] && { log "node '$desc' not found"; return 1; }
  local n; n=$(echo "$b" | grep -o '[0-9]\+' | tr '\n' ' ')
  local x1 y1 x2 y2; read -r x1 y1 x2 y2 <<< "$n"
  adb shell input tap $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))
}

adb wait-for-device
adb shell settings put global hide_error_dialogs 1 || true
adb root >/dev/null 2>&1 || true; sleep 5; adb wait-for-device

log "install APK"
adb install -r android/app/build/outputs/apk/release/app-release.apk 2>&1 | tail -2

log "sideload model $MODEL_FILE"
adb push model.gguf /data/local/tmp/model.gguf 2>&1 | tail -1
adb shell "mkdir -p /data/data/$PKG/files/models/$MODEL_DIR"
adb shell "cp /data/local/tmp/model.gguf /data/data/$PKG/files/models/$MODEL_DIR/$MODEL_FILE"
adb shell "rm -f /data/local/tmp/model.gguf"
UID_LINE=$(adb shell "stat -c %U /data/data/$PKG" | tr -d '\r')
adb shell "chown -R $UID_LINE:$UID_LINE /data/data/$PKG/files/models"
adb shell "ls -la /data/data/$PKG/files/models/$MODEL_DIR/" | tr -d '\r'

log "first launch (creates AsyncStorage db)"
adb shell am start -n $PKG/.MainActivity >/dev/null; sleep 25
adb shell am force-stop $PKG; sleep 3

log "set prefs: model=$MODEL_DIR compaction=$COMPACTION_IN thinking=$THINKING"
sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.model.id','$MODEL_DIR');"
[ "$COMPACTION_IN" = "on" ] && sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.context.compaction','1');"
[ "$COMPACTION_IN" = "off" ] && sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.context.compaction','0');"
sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.bench.thinking','$THINKING');"
sql "SELECT key,substr(value,1,40) FROM catalystLocalStorage;" | tee "$OUT/prefs.txt"

log "launch app"
adb logcat -c
adb shell am start -n $PKG/.MainActivity >/dev/null
sleep 30
shot 01_home
ui_texts > "$OUT/01_home.txt"
grep -qi "kalsa" "$OUT/01_home.txt" || log "WARNING: app UI not detected"

log "type message"
tap_desc "Ask a question…" 2>/dev/null || adb shell input tap 600 2276
sleep 4
adb shell input text "Ciao,+chi+sei?+Rispondi+in+una+frase."
sleep 3
adb shell input keyevent 111   # ESC: hide IME so bounds are stable
sleep 3
shot 02_typed
ui_texts > "$OUT/02_typed.txt"

log "send"
tap_desc "Send" || { log "FATAL: Send button not found"; ui_texts > "$OUT/send_missing.txt"; }
SENT=$(date +%s)
log "sent at $SENT — polling for the reply"

REPLY=""
for i in $(seq 1 60); do
  sleep 15
  ui_texts > "$OUT/poll_$i.txt"
  shot "poll_$i" 2>/dev/null
  # The assistant bubble is persisted only when the turn completes.
  HIST=$(sql "SELECT substr(value,1,4000) FROM catalystLocalStorage WHERE key='kalsa.messages.v1';")
  echo "$HIST" > "$OUT/history_$i.json"
  if echo "$HIST" | grep -q '"role":"assistant"'; then
    REPLY=$(echo "$HIST" | sed 's/.*"role":"assistant","text":"//; s/".*//' | head -c 1500)
    log "REPLY AFTER $(( $(date +%s) - SENT ))s: $REPLY"
    break
  fi
  log "poll $i: still generating ($(( $(date +%s) - SENT ))s)"
done

adb logcat -d | grep -iE "RNLlama|llama|ReactNativeJS" | tail -80 > "$OUT/logcat.txt" 2>/dev/null
shot 99_final
ui_texts > "$OUT/99_final.txt"
sql "SELECT substr(value,1,4000) FROM catalystLocalStorage WHERE key='kalsa.messages.v1';" > "$OUT/history_final.json"

{
  echo "model=$MODEL_DIR compaction=$COMPACTION_IN thinking=$THINKING"
  echo "elapsed_to_reply_s=$(( $(date +%s) - SENT ))"
  echo "reply<<<"
  echo "$REPLY"
  echo ">>>"
} > "$OUT/RESULT.txt"
cat "$OUT/RESULT.txt"

[ -n "$REPLY" ] || { log "FAIL: no assistant reply captured"; exit 1; }
log "PASS: real on-device inference completed"
