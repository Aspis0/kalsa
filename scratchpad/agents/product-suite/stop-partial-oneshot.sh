#!/usr/bin/env bash
# One-shot Jelly evidence: abort AFTER visible assistant text, then prove
# a non-empty interrupted assistant record was persisted.
set -uo pipefail

export ANDROID_SERIAL="${ANDROID_SERIAL:-JELLYS0000053795}"
export BENCH_TARGET=device
export PKG=com.kalsa.app
KALSA_ROOT=/Users/marco/Projects/kalsa
OUT="${OUT:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/STOP-PARTIAL-EVIDENCE-2026-09-10}"
mkdir -p "$OUT"
export OUT

# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/ci-lib.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-env.sh"
# shellcheck source=/dev/null
source "$KALSA_ROOT/scripts/device-share-send.sh"

log() { echo "[stop-partial] $*" | tee -a "$OUT/run.log"; }

PROMPT='Scrivi un testo di almeno 250 parole sul mare, in italiano. Inizia la risposta visibile con la frase: Il mare è vasto.'
VISIBLE_MIN=80
WAIT_VISIBLE_S=720
WAIT_STOP_SETTLE_S=25

parse_ui() {
  python3 - "$1" "$PROMPT" "$VISIBLE_MIN" <<'PY'
import re, sys, json
path, prompt, vmin = sys.argv[1], sys.argv[2], int(sys.argv[3])
xml = open(path, encoding="utf-8", errors="replace").read()
nodes = re.findall(r"<node [^>]*>", xml)
chrome = {
    "kalsa", "web", "menu", "esporta chat", "nuova chat", "copia", "altro",
    "invia", "send", "interrompi generazione", "fai una domanda…",
    "ask a question…", "sto pensando", "pronto", "ready",
    "ricerca approfondita", "documento in libreria", "crea mini-app",
    "aggiungi allegato", "leggi ad alta voce", "salva", "annulla",
    "traduci", "lisbona", "madrid", "olanda",
}
prompt_l = prompt.strip().lower()
texts = []
stop = False
thinking = False
ready = False
invia = False
for s in nodes:
    def g(attr):
        m = re.search(attr + r'="([^"]*)"', s)
        return m.group(1) if m else ""
    text, desc = g("text"), g("content-desc")
    blob = " ".join(x for x in (text, desc) if x).strip()
    low = blob.lower()
    if "interrompi generazione" in low:
        stop = True
    if "sto pensando" in low:
        thinking = True
    if "pronto" in low or "ready" in low:
        ready = True
    if desc.lower() in ("invia", "send") or text.lower() in ("invia", "send"):
        invia = True
    for cand in (text, desc):
        c = cand.strip()
        if not c:
            continue
        cl = c.lower()
        if cl in chrome:
            continue
        if cl.startswith("lfm2.5"):
            continue
        if "conversazione molto lunga" in cl:
            continue
        if cl == prompt_l or prompt_l[:40] in cl:
            continue
        if len(c) < 8:
            continue
        texts.append(c)
texts.sort(key=len, reverse=True)
best = texts[0] if texts else ""
print(json.dumps({
    "stop": stop,
    "thinking": thinking,
    "ready": ready,
    "invia": invia,
    "best_len": len(best),
    "best": best[:240],
    "n_candidates": len(texts),
}, ensure_ascii=False))
PY
}

dump_ui_file() {
  local dest="$1"
  adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null 2>&1 || return 1
  adb pull /data/local/tmp/ui.xml "$dest" >/dev/null 2>&1 || return 1
  [ -s "$dest" ]
}

dump_hist() {
  local dest="$1"
  local index_raw id key
  index_raw=$(sql "SELECT value FROM catalystLocalStorage WHERE key='$CONVERSATIONS_INDEX_KEY';" 2>/dev/null || true)
  id=$(resolve_active_conversation_id "$index_raw")
  key=$(messages_storage_key "$id")
  echo "active_id=$id key=$key" > "$dest.meta"
  sql "SELECT value FROM catalystLocalStorage WHERE key='$key';" > "$dest" 2>/dev/null || : > "$dest"
}

log "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL"
log "devices=$(adb devices | tr '\n' ' ')"
case "$(adb devices)" in
  *JELLYS0000053795*) ;;
  *) log "FATAL: Jelly not attached"; exit 1 ;;
esac
if adb devices | grep -q '192.168.1.193'; then
  log "FATAL: Xiaomi visible; refusing to proceed"
  exit 1
fi

adb shell input keyevent KEYCODE_WAKEUP >/dev/null
adb shell svc power stayon true >/dev/null
device_collapse_shade || true
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1 || true
sleep 2

log "apk sha=$(adb shell sha256sum /data/app/~~6xcj9pEeZSD6yOOqzVVihg==/com.kalsa.app-mQORSGqpLM_6lNe7vfeeeA==/base.apk | awk '{print $1}')"
log "pid=$(adb shell pidof $PKG | tr -d '\r')"
adb shell dumpsys battery | egrep 'level|temperature' | tee -a "$OUT/run.log"

dump_hist "$OUT/hist-before.json"
log "hist-before $(wc -c < "$OUT/hist-before.json") bytes"

# New chat: long conversation would abort during prefill again.
if dump_ui_file "$OUT/ui-before.xml"; then
  log "ui-before parsed=$(parse_ui "$OUT/ui-before.xml")"
fi
if tap_node "Nuova chat"; then
  log "tapped Nuova chat"
  sleep 3
else
  log "WARN: Nuova chat not found; continuing on current chat"
fi
if dump_ui_file "$OUT/ui-after-newchat.xml"; then
  log "ui-after-newchat parsed=$(parse_ui "$OUT/ui-after-newchat.xml")"
fi

log "clearing logcat"
adb logcat -c
log "marker START $(date -u +%Y-%m-%dT%H:%M:%SZ)"
adb shell "log -t KALSA_STOPPARTIAL 'oneshot_start $(date -u +%Y-%m-%dT%H:%M:%SZ)'" || true

log "share-send prompt"
if ! device_share_send "$PROMPT"; then
  log "FATAL: share-send failed"
  dump_ui_file "$OUT/ui-send-fail.xml" || true
  adb logcat -d -v time > "$OUT/logcat-send-fail.txt" || true
  exit 1
fi
log "submitted utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
dump_hist "$OUT/hist-after-send.json"

t=0
got_visible=0
tapped=0
while [ "$t" -lt "$WAIT_VISIBLE_S" ]; do
  if dump_ui_file "$OUT/ui-poll.xml"; then
    parsed=$(parse_ui "$OUT/ui-poll.xml")
    log "t=${t}s $parsed"
    echo "$parsed" > "$OUT/last-parse.json"
    stop=$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1])).get("stop", False)))' "$OUT/last-parse.json")
    blen=$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1])).get("best_len", 0)))' "$OUT/last-parse.json")
    if [ "$blen" -ge "$VISIBLE_MIN" ]; then
      got_visible=1
      cp "$OUT/ui-poll.xml" "$OUT/ui-at-visible.xml"
      echo "$parsed" > "$OUT/parse-at-visible.json"
      if [ "$stop" = 1 ]; then
        log "visible text $blen chars AND stop button present — tapping Interrompi"
        if tap_node "Interrompi generazione"; then
          tapped=1
          log "tapped Interrompi utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) after ${t}s"
          adb exec-out screencap -p > "$OUT/screen-at-stop.png" 2>/dev/null || true
          break
        else
          log "WARN: stop node tap missed; retry next loop"
        fi
      else
        log "visible text $blen but stop button missing — keep polling"
      fi
    fi
  else
    log "t=${t}s ui dump failed"
  fi
  sleep 3
  t=$((t + 3))
done

if [ "$got_visible" != 1 ]; then
  log "VOID: no visible assistant text >= $VISIBLE_MIN within ${WAIT_VISIBLE_S}s"
  dump_ui_file "$OUT/ui-timeout.xml" || true
  adb logcat -d -v time > "$OUT/logcat-timeout.txt" || true
  dump_hist "$OUT/hist-timeout.json"
  echo VOID > "$OUT/verdict.txt"
  exit 2
fi
if [ "$tapped" != 1 ]; then
  log "FAIL: visible text but never tapped stop"
  echo FAIL_NO_TAP > "$OUT/verdict.txt"
  exit 1
fi

s=0
while [ "$s" -lt "$WAIT_STOP_SETTLE_S" ]; do
  sleep 1
  s=$((s + 1))
done
log "settle done utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

dump_ui_file "$OUT/ui-after-stop.xml" || true
adb exec-out screencap -p > "$OUT/screen-after-stop.png" 2>/dev/null || true
dump_hist "$OUT/hist-after-stop.json"
adb logcat -d -v time > "$OUT/logcat-after.txt" || true
adb shell dumpsys battery | egrep 'level|temperature' | tee -a "$OUT/run.log"

python3 - "$OUT/hist-after-stop.json" "$OUT/verdict.txt" "$OUT/verdict-detail.json" <<'PY'
import json, sys
hist_path, verdict_path, detail_path = sys.argv[1:4]
raw = open(hist_path, encoding="utf-8").read() or "[]"
try:
    data = json.loads(raw)
except Exception as e:
    open(verdict_path, "w").write("FAIL_PARSE")
    json.dump({"error": str(e)}, open(detail_path, "w"))
    raise SystemExit(0)
msgs = data if isinstance(data, list) else []
last = msgs[-1] if msgs else {}
role = last.get("role")
text = last.get("text") or ""
interrupted = last.get("interrupted")
streaming = last.get("streaming")
ok = (
    role == "assistant"
    and bool(text.strip())
    and interrupted is True
    and streaming in (None, False)
)
detail = {
    "n_messages": len(msgs),
    "last_role": role,
    "last_len": len(text),
    "last_interrupted": interrupted,
    "last_streaming": streaming,
    "last_text_head": text[:240],
    "pass": ok,
}
json.dump(detail, open(detail_path, "w"), ensure_ascii=False, indent=2)
open(verdict_path, "w").write("PASS" if ok else "FAIL")
print(json.dumps(detail, ensure_ascii=False))
PY
log "verdict=$(cat "$OUT/verdict.txt")"
log "detail=$(cat "$OUT/verdict-detail.json")"
log "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
exit 0
