#!/usr/bin/env bash
# Host-only fake `adb` for scripts/campaign/selftest_defects.sh. It replays
# fixture output and keeps a fake device filesystem under $FAKE_DEV; it never
# talks to a device. Put this file on PATH as `adb`.
#
# State files (all under $FAKE_DEV/fake):
#   mode         marker-turn1 | never | fail-send | vanish | hot
#   turn         share-intent counter (the fake's clock)
#   pid          app pid served by `pidof` (empty file = app dead)
#   pid_dead_once  set at a turn boundary; the NEXT pidof reports the app dead
#   stream.txt   logcat stream the fake `logcat` tails
#   ui.xml       uiautomator dump served by `adb shell cat /data/local/tmp/ui.xml`
#   telemetry.line  the KALSA_TELEMETRY line appended on turn 1 (marker-turn1)
set -uo pipefail

DEV="${FAKE_DEV:?FAKE_DEV must point at the fake device root}"
F="$DEV/fake"
PKG="${PKG:-com.kalsa.app}"
CAMPAIGN_STARTUP_MARKER="${CAMPAIGN_STARTUP_MARKER:?CAMPAIGN_STARTUP_MARKER must be derived by the harness}"
mkdir -p "$F" "$DEV/databases" "$DEV/data/local/tmp"
printf '%s\n' "$*" >> "$F/invocations.log"

_append() { printf '%s\n' "$*" >> "$F/stream.txt"; }

_unhandled() {
  printf 'fake-adb UNHANDLED: %s\n' "$*" >&2
  printf '%s\n' "$*" >> "$F/unhandled.log"
  exit 1
}

_mode() { cat "$F/mode" 2>/dev/null || printf '%s\n' marker-turn1; }

# Consume the one-shot crash flag: the app was alive for the send and dead at
# the next poll. In `vanish` mode the crash also loses the turn's messages.
app_pid() {
  if [ -f "$F/pid_dead_once" ]; then
    rm -f "$F/pid_dead_once"
    if [ "$(_mode)" = "vanish" ]; then
      sqlite3 "$DEV/databases/RKStorage" \
        "DELETE FROM catalystLocalStorage WHERE key='kalsa.messages.v1';" 2>/dev/null || true
    fi
    return 0
  fi
  cat "$F/pid" 2>/dev/null || true
}

_share_intent() {
  local args="$1" mode enc text turn msgs ui_text
  mode=$(_mode)
  [ "$mode" = "fail-send" ] && exit 1
  enc=$(printf '%s' "$args" | sed -E 's/.*kalsa:\/\/share\?text=([^#]*).*/\1/')
  text=$(python3 -c 'import sys, urllib.parse; sys.stdout.write(urllib.parse.unquote(sys.argv[1]))' "$enc")
  turn=$(( $(cat "$F/turn" 2>/dev/null || printf 0) + 1 ))
  printf '%s' "$turn" > "$F/turn"
  # vanish: the first send lands, the retry send (after the crash) does not.
  if [ "$mode" = "vanish" ] && [ "$turn" -gt 1 ]; then exit 1; fi
  # composer: the share put the text in the EditText (+ "Pronto" for wait_ready)
  ui_text="$text"
  [ "$mode" = "hot" ] && ui_text=""
  python3 - "$F/ui.xml" "$ui_text" <<'PY'
import sys
text = sys.argv[2].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
open(sys.argv[1], "w", encoding="utf-8").write(
    '<hierarchy>'
    '<node class="android.widget.TextView" text="Pronto" bounds="[0,0][10,10]"/>'
    '<node class="android.widget.EditText" text="%s" bounds="[0,100][900,200]"/>'
    '<node class="android.widget.Button" text="Send" bounds="[900,2000][1000,2100]"/>'
    '</hierarchy>\n' % text
)
PY
  # chat history: the app finished the turn, so user + assistant both landed
  python3 - "$F/messages.json" "$text" "$turn" <<'PY'
import json, sys
path, text, turn = sys.argv[1], sys.argv[2], int(sys.argv[3])
try:
    msgs = json.load(open(path, encoding="utf-8"))
except Exception:
    msgs = []
msgs.append({"role": "user", "text": text})
msgs.append({"role": "assistant", "text": "Risposta %d %s" % (turn, "x" * (40 * turn))})
json.dump(msgs, open(path, "w", encoding="utf-8"))
PY
  msgs=$(cat "$F/messages.json")
  python3 - "$DEV/databases/RKStorage" "$msgs" <<'PY'
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.execute(
    "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES (?,?)",
    ("kalsa.messages.v1", sys.argv[2]),
)
conn.commit()
PY
  # native engine lines: campaign_wait_engine proves the engine came back
  _append "09-16 12:00:0$turn.100  4242  4243 I llama   : llama_model_loader: loaded meta data"
  _append "09-16 12:00:0$turn.200  4242  4243 I ReactNativeJS: KALSA_NATIVE_VARIANT {\"androidLib\":\"fake\",\"nGpuLayers\":0}"
  if [ "$mode" = "marker-turn1" ] && [ "$turn" -eq 1 ]; then
    _append "$(cat "$F/telemetry.line")"
  fi
  # The app dies at the first poll AFTER this turn, except for the one turn
  # that is supposed to complete (turn 1 in marker-turn1).
  if [ "$mode" = "marker-turn1" ] && [ "$turn" -eq 1 ]; then :; else : > "$F/pid_dead_once"; fi
  exit 0
}

# `adb -s <serial> ...` — the fake has exactly one device.
if [ "${1:-}" = "-s" ]; then shift 2; fi

case "${1:-}" in
  get-state) cat "$F/adb_state" ;;
  connect|disconnect|wait-for-device|install)
    exit 0
    ;;
  push)
    mkdir -p "$(dirname "$DEV$3")"
    cp "$2" "$DEV$3"
    ;;
  logcat)
    shift
    case "$*" in
      -c) : > "$F/stream.txt" ;;
      -d*) cat "$F/stream.txt" ;;
      *) exec tail -f "$F/stream.txt" ;;
    esac
    ;;
  exec-out)
    shift
    s="$*"
    case "$s" in
      "run-as $PKG tar cf - -C databases "*)
        files="${s##*databases }"
        # shellcheck disable=SC2086
        ( cd "$DEV/databases" && tar cf - $files )
        ;;
      "run-as $PKG cat "*) cat "$DEV/${s##*cat }" ;;
      screencap*) : ;;
      *) _unhandled "exec-out $s" ;;
    esac
    ;;
  shell)
    shift
    s="$*"
    case "$s" in
      "pidof $PKG") app_pid ;;
      "if pidof $PKG"*)
        if [ -n "$(app_pid)" ]; then printf '%s\n' RUNNING; else printf '%s\n' STOPPED; fi
        ;;
      "dumpsys battery") cat "$F/battery.txt" ;;
      "dumpsys thermalservice") cat "$F/thermalservice.txt" ;;
      "dumpsys deviceidle whitelist"*) : ;;
      "settings get system screen_off_timeout") printf '%s\n' null ;;
      "settings get global stay_on_while_plugged_in") printf '%s\n' 0 ;;
      "settings get secure default_input_method") printf '%s\n' null ;;
      "settings put "*|"settings delete "*) : ;;
      "ime "*) : ;;
      "input "*) : ;;
      "am force-stop"*) : > "$F/pid" ;;
      "am start -n "*)
        printf '%s' "$(cat "$F/pid_base")" > "$F/pid"
        _append "09-16 12:00:00.000  $(cat "$F/pid")  4243 I ReactNativeJS: $CAMPAIGN_STARTUP_MARKER"
        ;;
      "am start -a android.intent.action.VIEW"*) _share_intent "$s" ;;
      "cmd statusbar collapse"|"wm dismiss-keyguard") : ;;
      "uiautomator dump "*) : ;;
      "cat /data/local/tmp/ui.xml") cat "$F/ui.xml" ;;
      "getprop ro.product.model") printf '%s\n' SM-S911B ;;
      "run-as $PKG test -f "*) exit 1 ;;
      "run-as $PKG cp "*)
        rest="${s#run-as $PKG cp }"
        cp "$DEV${rest%% *}" "$DEV/${rest#* }"
        ;;
      "run-as $PKG rm -f databases/"*) rm -f "$DEV"/databases/${s##*databases/} ;;
      "rm -f /data/local/tmp/kalsa-rkstorage-"*) rm -f "$DEV"/data/local/tmp/kalsa-rkstorage-* ;;
      "run-as com.termux"*) exit 1 ;;
      "dumpsys meminfo"*|"cat /proc/meminfo"|"dumpsys activity"*) : ;;
      *) _unhandled "shell $s" ;;
    esac
    ;;
  *) _unhandled "$*" ;;
esac
