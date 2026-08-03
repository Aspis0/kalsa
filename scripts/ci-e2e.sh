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

# shellcheck source=ci-lib.sh
source "$(dirname "$0")/ci-lib.sh"

install_and_sideload \
  "android/app/build/outputs/apk/release/app-release.apk" \
  "model.gguf" \
  "$MODEL_DIR" \
  "$MODEL_FILE"

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


log "screen size: $(adb shell wm size | tr -d '\r')"


log "type message"
# Keep the prompt alphanumeric: `adb shell input text` mangles punctuation and
# does not reliably turn '+' into spaces, which made the assertion below fail
# even though the tap was correct.
MSG="CiaoChiSei"
tap_node "Ask a question…" || die "composer not found"
sleep 4
adb shell input text "$MSG"
sleep 3
# One retry: the IME can swallow the first keystrokes right after focus.
if ! dump_ui | grep -qF "$MSG"; then
  log "text not visible yet — retrying once"
  tap_node "Ask a question…" || true
  sleep 3
  adb shell input text "$MSG"
  sleep 3
fi
adb shell input keyevent 111   # ESC: hide IME so bounds are stable
sleep 3
shot 02_typed
ui_texts > "$OUT/02_typed.txt"
# Hard gate: if the text is not in the composer there is nothing to send, and
# waiting for a reply would burn 15 minutes for nothing (it did, once).
grep -qF "$MSG" "$OUT/02_typed.txt" || die "typing did not land in the composer"
log "text confirmed in composer"

log "send"
tap_node "Send" || die "Send button not found"
SENT=$(date +%s)
sleep 20
ui_texts > "$OUT/03_sent.txt"
shot 03_sent
grep -qF "$MSG" "$OUT/03_sent.txt" || die "message did not appear in the conversation after send"
log "message is in the conversation — engine should be running"
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
