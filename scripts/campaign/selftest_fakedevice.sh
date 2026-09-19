#!/usr/bin/env bash
# Host-only fake `adb` for scripts/campaign/selftest_defects.sh. It replays
# fixture output and keeps a fake device filesystem under $FAKE_DEV; it never
# talks to a device. Put this file on PATH as `adb`.
#
# State files (all under $FAKE_DEV/fake):
#   mode         marker-turn1 | never | fail-send | vanish | hot | db-lag |
#                throttled | thermal-rise-fall | thermal-hard-abort |
#                thermal-status-abort | thermal-giveup | thermal-plugged-rise |
#                thermal-sustained-rise | thermal-unknown-power
#   turn         share-intent counter (the fake's clock)
#   pid          app pid served by `pidof` (empty file = app dead)
#   pid_dead_once  set at a turn boundary; the NEXT pidof reports the app dead
#   stream.txt   logcat stream the fake `logcat` tails
#   ui.xml       uiautomator dump served by `adb shell cat /data/local/tmp/ui.xml`
#   composer     text the share put in the EditText ("" when the share missed)
#   pending_turn turn armed by a share, fired as KALSA_THINKING by `input tap`
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

_battery_dump() {
  local mode reads temp
  mode=$(_mode)
  reads=$(( $(cat "$F/battery_reads" 2>/dev/null || printf 0) + 1 ))
  printf '%s' "$reads" > "$F/battery_reads"
  case "$mode" in
    thermal-rise-fall)
      case "$reads" in
        1|2|3) temp=425 ;;
        4|5|6) temp=430 ;;
        7|8|9) temp=425 ;;
        *) temp=415 ;;
      esac
      ;;
    thermal-hard-abort)
      [ "$reads" -ge 2 ] && temp=440 || temp=425
      ;;
    thermal-status-abort) temp=420 ;;
    thermal-giveup) temp=430 ;;
    thermal-plugged-rise)
      case "$reads" in
        1|2|3) temp=425 ;;
        4|5|6) temp=430 ;;
        7|8|9) temp=425 ;;
        *) temp=$((420 + reads)) ;;
      esac
      ;;
    thermal-sustained-rise|thermal-unknown-power)
      if [ "$reads" -le 4 ]; then
        temp=425
      else
        temp=$((425 + (reads - 4) / 2))
      fi
      ;;
    *)
      temp=$(sed -n -E 's/^[[:space:]]*temperature:[[:space:]]*([0-9]+).*/\1/p' "$F/battery.txt" | head -1)
      ;;
  esac
  sed -E "s/^([[:space:]]*temperature:)[[:space:]]*[0-9]+/\\1 $temp/" "$F/battery.txt" \
    | if [ "$mode" = thermal-plugged-rise ]; then
        sed 's/AC powered: false/AC powered: true/'
      elif [ "$mode" = thermal-unknown-power ]; then
        sed -E '/(AC|USB|Wireless|Dock) powered:/d'
      else
        cat
      fi
}

_thermal_dump() {
  if [ "$(_mode)" = thermal-status-abort ]; then
    printf '%s\n' 'Thermal Status: 3'
  else
    cat "$F/thermalservice.txt"
  fi
}

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
# Chat history: normal modes finish the turn here; throttled mode adds its
# assistant bubble incrementally after the Send tap.
  python3 - "$F/messages.json" "$text" "$turn" "$mode" <<'PY'
import json, sys
path, text, turn, mode = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
try:
    msgs = json.load(open(path, encoding="utf-8"))
except Exception:
    msgs = []
msgs.append({"role": "user", "text": text})
if mode != "throttled":
    msgs.append({"role": "assistant", "text": "Risposta %d %s" % (turn, "x" * (40 * turn))})
json.dump(msgs, open(path, "w", encoding="utf-8"))
PY
  # db-lag: the engine accepted the turn and started it, but the app has not
  # persisted the user message yet. Real case, S23 2026-09-17: the harness read
  # the DB, saw nothing, and re-shared over work already in flight.
  if [ "$mode" != "db-lag" ]; then
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
  fi
  # native engine lines: campaign_wait_engine proves the engine came back
  _append "09-16 12:00:0$turn.100  4242  4243 I llama   : llama_model_loader: loaded meta data"
  _append "09-16 12:00:0$turn.200  4242  4243 I ReactNativeJS: KALSA_NATIVE_VARIANT {\"androidLib\":\"fake\",\"nGpuLayers\":0}"
  # The engine announces the turn it just started — but only once the SEND is
  # tapped, and only if the composer actually holds the text. Emitting it here,
  # at share time, would let the db-lag case pass with the tap deleted from
  # turn.sh (hostile audit, 2026-09-17). Arm it; `input tap` fires it.
  printf '%s' "$turn" > "$F/pending_turn"
  printf '%s' "$ui_text" > "$F/composer"
  if [ "$mode" = "marker-turn1" ] && [ "$turn" -eq 1 ]; then
    _append "$(cat "$F/telemetry.line")"
  fi
  # The app dies at the first poll AFTER this turn, except for the one turn
  # that is supposed to complete (turn 1 in marker-turn1).
  if [ "$mode" = "marker-turn1" ] && [ "$turn" -eq 1 ]; then :
  elif [ "$mode" = throttled ]; then :
  else : > "$F/pid_dead_once"; fi
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
      "dumpsys battery") _battery_dump ;;
      "dumpsys thermalservice") _thermal_dump ;;
      "dumpsys deviceidle whitelist"*) : ;;
      "settings get system screen_off_timeout") printf '%s\n' null ;;
      "settings get global stay_on_while_plugged_in") printf '%s\n' 0 ;;
      "settings get secure default_input_method") printf '%s\n' null ;;
      "settings put "*|"settings delete "*) : ;;
      "ime "*) : ;;
      "input tap "*)
        # The send button. A turn starts only when there is something to send:
        # an empty composer (mode `hot`) makes this tap a no-op, exactly as it
        # is on the device.
        if [ -s "$F/composer" ] && [ -s "$F/pending_turn" ]; then
          t=$(cat "$F/pending_turn"); : > "$F/pending_turn"
          _append "09-16 12:00:0$t.300  4242  4243 I ReactNativeJS: KALSA_THINKING {\"turnId\":\"$t\",\"budget\":512}"
          if [ "$(_mode)" = throttled ]; then
            (
              for n in 1 2 3; do
                sleep 0.4
                python3 - "$F/messages.json" "$DEV/databases/RKStorage" "$t" "$n" <<'PY'
import json, sqlite3, sys
messages_path, db_path, turn, step = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
messages = json.load(open(messages_path, encoding="utf-8"))
assistant = next((item for item in messages if item.get("role") == "assistant"), None)
if assistant is None:
    assistant = {"role": "assistant", "text": ""}
    messages.append(assistant)
assistant["text"] = "Risposta %d %s" % (turn, "x" * (step * 15))
payload = json.dumps(messages)
json.dump(messages, open(messages_path, "w", encoding="utf-8"))
conn = sqlite3.connect(db_path)
conn.execute(
    "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES (?,?)",
    ("kalsa.messages.v1", payload),
)
conn.commit()
PY
                _append "09-16 12:00:1$n.100  4242  4243 I ReactNativeJS: KALSA_NATIVE throttled progress $n"
              done
              sleep 0.4
              _append "$(cat "$F/telemetry.line")"
            ) >/dev/null 2>&1 &
          fi
        fi
        ;;
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
