#!/usr/bin/env bash
# G2 leftovers: tools, documents (if library), 20 turns. No stayon. No uninstall.
set -uo pipefail
PHONE="${PHONE:-s23}"
case "$PHONE" in
  s23)
    export ANDROID_SERIAL="${ANDROID_SERIAL:-adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp}"
    SHOT_TIMEOUT=300000
    EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-D39FA51-G2-LEFTOVERS-2026-09-13}"
    TURN_WAIT=180
    TOOL_WAIT=300
    ;;
  jelly)
    export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.82:5555}"
    SHOT_TIMEOUT=600000
    EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/JELLY-D39FA51-G2-LEFTOVERS-2026-09-13}"
    TURN_WAIT=420
    TOOL_WAIT=480
    ;;
  *) echo "bad PHONE=$PHONE" >&2; exit 2 ;;
esac
case "$ANDROID_SERIAL" in
  192.168.1.193*|houji*|23127PN0CG*) echo refused_xiaomi >&2; exit 2 ;;
esac
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run.log"
cd /Users/marco/Projects/kalsa
# shellcheck source=/dev/null
source scripts/device-share-send.sh
rlog() { echo "[$PHONE] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL"

DEV=$(adb shell getprop ro.product.device | tr -d '\r')
MODEL=$(adb shell getprop ro.product.model | tr -d '\r')
rlog "device=$DEV model=$MODEL"
case "$PHONE" in
  s23) case "$MODEL" in SM-S911U|SM_S911U) ;; *) rlog REFUSE_NOT_S23; exit 2 ;; esac ;;
  jelly) [ "$DEV" = Jelly_Star ] || { rlog REFUSE_NOT_JELLY; exit 2; } ;;
esac

SAVED_TIMEOUT=$(adb shell settings get system screen_off_timeout | tr -d '\r')
rlog "timeout_saved=$SAVED_TIMEOUT"
if ! adb shell settings put system screen_off_timeout "$SHOT_TIMEOUT" </dev/null; then
  rlog "WARNING failed to set screen_off_timeout $SHOT_TIMEOUT"
fi

WPID="" LPID=""
cleanup() {
  rlog "cleanup utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  [ -n "$WPID" ] && kill "$WPID" 2>/dev/null || true
  [ -n "$LPID" ] && kill "$LPID" 2>/dev/null || true
  adb shell am force-stop com.kalsa.app </dev/null
  case "$SAVED_TIMEOUT" in
    ''|null)
      if adb shell settings delete system screen_off_timeout </dev/null; then
        rlog "timeout restore: deleted"
      else
        rlog "WARNING timeout restore delete failed"
      fi
      ;;
    *)
      if adb shell settings put system screen_off_timeout "$SAVED_TIMEOUT" </dev/null; then
        rlog "timeout restore: put $SAVED_TIMEOUT"
      else
        rlog "WARNING timeout restore put failed"
      fi
      ;;
  esac
  rlog "stay_on_after=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')"
  rlog "timeout_after=$(adb shell settings get system screen_off_timeout | tr -d '\r')"
}
trap cleanup EXIT

wake() {
  adb shell input keyevent KEYCODE_WAKEUP </dev/null 2>&1 || true
  device_collapse_shade </dev/null 2>&1 || true
}
poke() { wake; adb shell input swipe 540 900 540 920 80 </dev/null 2>&1 || true; }
keep_awake() { while true; do poke; sleep 20; done; }

thermal() {
  local t
  t=$(adb shell dumpsys battery 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/ {print $2; exit}')
  rlog "temp_deci=$t"
  [ -n "$t" ] && [ "$t" -ge 400 ] && return 1
  return 0
}
battery_snap() {
  adb shell dumpsys battery 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+(level|temperature|status):[[:space:]]*[0-9]+[[:space:]]*$/ {printf "%s ", $0}'
  echo
}

coords_for() {
  python3 - "$1" "$2" <<'PY'
import re, sys
needle, path = sys.argv[1], sys.argv[2]
xml = open(path, encoding="utf-8", errors="replace").read()
pat = re.compile(
    r'<node [^>]*?(?:content-desc|text)="[^"]*%s[^"]*"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
    % re.escape(needle))
m = pat.search(xml) or re.compile(
    r'<node [^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*?(?:content-desc|text)="[^"]*%s[^"]*"'
    % re.escape(needle)).search(xml)
if not m: sys.exit(1)
x1,y1,x2,y2=map(int,m.groups()); print(f"{(x1+x2)//2} {(y1+y2)//2}")
PY
}

dump_ui_file() {
  poke
  local ui
  ui=$(device_dump_ui_retry </dev/null || true)
  printf '%s\n' "$ui" > "$1"
  printf '%s\n' "$ui"
}

start_logcat() {
  local f="$1"
  : > "$f"
  adb logcat -c </dev/null
  adb logcat -v threadtime ReactNativeJS:I RNLlama:W '*:S' >> "$f" </dev/null &
  LPID=$!
}

wait_engine() {
  local logf="$1" secs="${2:-150}"
  local t0
  t0=$(date +%s)
  while [ $(( $(date +%s) - t0 )) -lt "$secs" ]; do
    thermal || return 3
    poke
    grep KALSA_PREWARM "$logf" 2>/dev/null | grep -qE 'done|kv_holds_chat|skip' && return 0
    grep 'KALSA_SESSION' "$logf" 2>/dev/null | grep '"op":"load"' | grep -q . && return 0
    sleep 3
  done
  return 0
}

new_chat() {
  local ui_path="$1" ui inv ix iy
  ui=$(dump_ui_file "$ui_path")
  inv=$(coords_for "Nuova chat" "$ui_path" || true)
  if [ -z "$inv" ]; then rlog "WARN Nuova chat not found"; return 1; fi
  read -r ix iy <<< "$inv"
  adb shell input tap "$ix" "$iy" </dev/null
  rlog "tapped Nuova chat $ix,$iy"
  sleep 3
}

send_msg() {
  local msg="$1" tag="$2" ui_path="$3"
  local i ui inv ix iy
  poke
  device_share_intent "$msg" "${tag}_$(date +%s)" </dev/null
  sleep 2
  device_collapse_shade </dev/null
  for i in 1 2 3 4 5 6 7 8; do
    thermal || return 3
    ui=$(dump_ui_file "$ui_path")
    if printf '%s' "$ui" | grep -q 'Tocca per ricaricare'; then
      inv=$(coords_for "Tocca per ricaricare" "$ui_path" || true)
      if [ -n "$inv" ]; then read -r ix iy <<< "$inv"; adb shell input tap "$ix" "$iy" </dev/null; sleep 4; continue; fi
    fi
    if printf '%s' "$ui" | grep 'content-desc="Invia"' | grep -q 'enabled="true"'; then
      inv=$(coords_for "Invia" "$ui_path") || continue
      read -r ix iy <<< "$inv"
      adb shell input tap "$ix" "$iy" </dev/null
      rlog "Invia $tag at $ix,$iy utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      return 0
    fi
    if [ $((i % 3)) -eq 0 ]; then
      device_share_intent "$msg" "${tag}r${i}_$(date +%s)" </dev/null
      sleep 2
      device_collapse_shade </dev/null
    fi
    sleep 2
  done
  rlog "FAIL send $tag Invia not enabled"
  return 1
}

wait_kv_tel() {
  local mark="$1" kvout="$2" telout="$3" logf="$4" secs="$5"
  local t0 got_kv=0
  t0=$(date +%s)
  while [ $(( $(date +%s) - t0 )) -lt "$secs" ]; do
    thermal || return 3
    poke
    if [ "$got_kv" -eq 0 ] && tail -n +"$((mark+1))" "$logf" | grep -q KALSA_KVPREFIX; then
      got_kv=1
      tail -n +"$((mark+1))" "$logf" | grep -E 'KALSA_KVPREFIX|KALSA_KVDIVERGE|window_slide' | tee "$kvout" | tee -a "$RUN"
    fi
    if tail -n +"$((mark+1))" "$logf" | grep KALSA_TELEMETRY | grep -v util-extract | grep -q .; then
      tail -n +"$((mark+1))" "$logf" | grep KALSA_TELEMETRY | grep -v util-extract | tail -3 | tee "$telout" | tee -a "$RUN"
      tail -n +"$((mark+1))" "$logf" | grep -E 'KALSA_TOOLCALL|KALSA_TOOLROUND|"tool":' | tee -a "$RUN" >> "${kvout}.tools" || true
      return 0
    fi
    sleep 3
  done
  rlog "WARN no telemetry after ${secs}s mark=$mark"
  return 1
}

# --- begin ---
thermal || { rlog THERMAL_ABORT; echo THERMAL > "$EVID/verdict-raw.txt"; exit 3; }
rlog "stay_on_before=$(adb shell settings get global stay_on_while_plugged_in | tr -d '\r')"
rlog "battery_before=$(battery_snap)"
keep_awake &
WPID=$!

poke
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
start_logcat "$EVID/logcat.txt"
poke
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 6
wait_engine "$EVID/logcat.txt" 150 || true
grep 'KALSA_SESSION' "$EVID/logcat.txt" | grep '"op":"load"' | tee "$EVID/load-boot.txt" | tee -a "$RUN" || true

# 1) Tools
rlog "PHASE tools"
new_chat "$EVID/ui-boot.xml" || true
sleep 2
MARK=$(wc -l < "$EVID/logcat.txt" | tr -d ' ')
send_msg "Quanto fa 3847 più 291?" "tools" "$EVID/ui-tools.xml" || rlog "WARN tools send failed"
if wait_kv_tel "$MARK" "$EVID/tools-kv.txt" "$EVID/tools-tel.txt" "$EVID/logcat.txt" "$TOOL_WAIT"; then
  rlog "tools telemetry ok"
else
  rlog "tools telemetry missing"
fi
tail -n +"$((MARK+1))" "$EVID/logcat.txt" | grep -E 'KALSA_TOOLCALL|KALSA_TOOLROUND|"tool":"device' | tee "$EVID/tools-call.txt" | tee -a "$RUN" || true
dump_ui_file "$EVID/ui-tools-reply.xml" >/dev/null
python3 - "$EVID/ui-tools-reply.xml" "$EVID/tools-reply.txt" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
texts = re.findall(r'text="([^"]{1,400})"', xml)
open(sys.argv[2], "w", encoding="utf-8").write("\n".join(texts[-40:]))
PY
rlog "tools reply dump lines=$(wc -l < "$EVID/tools-reply.txt" | tr -d ' ')"

# 2) Documents — library dump only; SEND-PDF is HARNESS_MISS
rlog "PHASE docs"
python3 - "$EVID" <<'PY'
import pathlib, sqlite3, json, sys, tempfile, subprocess, os
evid = pathlib.Path(sys.argv[1])
serial = os.environ["ANDROID_SERIAL"]
raw = subprocess.check_output(
    ["adb", "-s", serial, "shell", "run-as", "com.kalsa.app", "cat", "databases/RKStorage"],
    stderr=subprocess.DEVNULL)
p = evid / "RKStorage-docs"
p.write_bytes(raw)
con = sqlite3.connect(str(p))
keys = [r[0] for r in con.execute("SELECT key FROM catalystLocalStorage WHERE key LIKE '%document%' OR key LIKE '%library%'")]
(evid / "docs-keys.txt").write_text("\n".join(keys) + "\n", encoding="utf-8")
val = ""
for k in keys:
    if k.endswith("documents.library") or k.endswith("documents.library.v1"):
        val = con.execute("SELECT value FROM catalystLocalStorage WHERE key=?", (k,)).fetchone()
        val = val[0] if val and val[0] else ""
        break
(evid / "docs-library.json").write_text(val or "", encoding="utf-8")
n = 0
name = ""
if val:
    try:
        o = json.loads(val)
        docs = o if isinstance(o, list) else (o.get("items") or o.get("docs") or [])
        n = len(docs) if isinstance(docs, list) else 0
        if n and isinstance(docs[0], dict):
            name = str(docs[0].get("name") or docs[0].get("id") or "")
    except Exception:
        n = 0
(evid / "docs-count.txt").write_text(f"n={n}\nname={name}\nkeys={','.join(keys)}\n", encoding="utf-8")
print(f"docs_n={n} name={name} keys={keys}")
PY
DOCS_N=$(awk -F= '/^n=/{print $2}' "$EVID/docs-count.txt" | tr -d '\r')
DOC_NAME=$(awk -F= '/^name=/{print $2}' "$EVID/docs-count.txt" | tr -d '\r')
rlog "docs_n=$DOCS_N name=$DOC_NAME"
if [ "${DOCS_N:-0}" -gt 0 ]; then
  new_chat "$EVID/ui-docs.xml" || true
  MARK=$(wc -l < "$EVID/logcat.txt" | tr -d ' ')
  Q="Nel documento ${DOC_NAME}, dimmi un fatto concreto (data, cifra o nome) citando il file."
  send_msg "$Q" "docs" "$EVID/ui-docs-send.xml" || rlog "WARN docs send failed"
  wait_kv_tel "$MARK" "$EVID/docs-kv.txt" "$EVID/docs-tel.txt" "$EVID/logcat.txt" "$TOOL_WAIT" || rlog "WARN docs telemetry missing"
  tail -n +"$((MARK+1))" "$EVID/logcat.txt" | grep -E 'document_chat|KALSA_TOOLCALL|"tool":' | tee "$EVID/docs-call.txt" | tee -a "$RUN" || true
  dump_ui_file "$EVID/ui-docs-reply.xml" >/dev/null
  python3 - "$EVID/ui-docs-reply.xml" "$EVID/docs-reply.txt" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
texts = re.findall(r'text="([^"]{1,400})"', xml)
open(sys.argv[2], "w", encoding="utf-8").write("\n".join(texts[-40:]))
PY
else
  rlog "docs SKIP HARNESS_MISS empty library"
  echo HARNESS_MISS > "$EVID/docs-verdict.txt"
fi

# 3) 20 turns
rlog "PHASE turns20"
new_chat "$EVID/ui-t20.xml" || true
sleep 2
: > "$EVID/turns.jsonl"
n=0
while IFS= read -r msg; do
  [ -n "$msg" ] || continue
  n=$((n+1))
  thermal || { rlog "THERMAL_ABORT at turn $n"; echo "thermal_at=$n" > "$EVID/turns-abort.txt"; break; }
  rlog "turn $n msg=${msg:0:60}"
  MARK=$(wc -l < "$EVID/logcat.txt" | tr -d ' ')
  if ! send_msg "$msg" "t$n" "$EVID/ui-turn.xml"; then
    rlog "FAIL send turn $n"
    echo "send_fail=$n" > "$EVID/turns-abort.txt"
    break
  fi
  if ! wait_kv_tel "$MARK" "$EVID/turn-$n-kv.txt" "$EVID/turn-$n-tel.txt" "$EVID/logcat.txt" "$TURN_WAIT"; then
    rlog "FAIL complete turn $n"
    echo "complete_fail=$n" > "$EVID/turns-abort.txt"
    break
  fi
  python3 -c 'import json,sys; print(json.dumps({"n":int(sys.argv[1]),"kv":open(sys.argv[2],encoding="utf-8",errors="replace").read()[-500:],"tel":open(sys.argv[3],encoding="utf-8",errors="replace").read()[-400:]}))' \
    "$n" "$EVID/turn-$n-kv.txt" "$EVID/turn-$n-tel.txt" >> "$EVID/turns.jsonl"
  rlog "turn $n complete"
  [ "$n" -ge 20 ] && break
done < "$EVID/prompts-20.txt"
echo "$n" > "$EVID/turns-count.txt"
rlog "turns_done=$n"

# reopen load if thermal allows
if thermal; then
  rlog "PHASE restore"
  kill "$LPID" 2>/dev/null || true
  wait "$LPID" 2>/dev/null || true
  adb shell am force-stop com.kalsa.app </dev/null
  sleep 2
  start_logcat "$EVID/logcat-restore.txt"
  poke
  adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
  sleep 5
  wait_engine "$EVID/logcat-restore.txt" 120 || true
  grep 'KALSA_SESSION' "$EVID/logcat-restore.txt" | grep '"op":"load"' | tee "$EVID/restore-load.txt" | tee -a "$RUN" || true
else
  rlog "skip restore thermal"
fi

rlog "battery_after=$(battery_snap)"
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo DONE > "$EVID/oneshot.done"
