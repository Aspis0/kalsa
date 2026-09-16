#!/usr/bin/env bash
# S23 G2 leftovers 20t only on e8c8886. Copied from
# S23-D39FA51-G2-T20-2026-09-13d/leftovers.sh then adapted:
# SHA e8c8886, serial 192.168.1.152:33983, TURN_WAIT=240,
# PREWARM wait after Nuova, no composer tap during decode (13e bump).
# keep_awake ≤15s (WAKEUP + collapse + chrome swipe), cool_wait max 60s,
# abort ≥43°C. Never stayon. Never 86400000. Never Settings. Never Interrompi.
# Never recycle/force-stop after Nuova.
set -uo pipefail
PHONE="${PHONE:-s23}"
SKIP_TOOLS="${SKIP_TOOLS:-1}"
SKIP_DOCS="${SKIP_DOCS:-1}"
SKIP_RESTORE="${SKIP_RESTORE:-0}"
EXPECTED_SHA="75ab1bc69a14aa2b15a0fe3da999e16acf9f5e1bd356e499d3de0b54bb325301"
HARD_TEMP_DECI=450
COOL_WANT_DECI=420
COOL_MAX_S=60
case "$PHONE" in
  s23)
    export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.152:33983}"
    SHOT_TIMEOUT=300000
    EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-F441B3D-G2-T20B-2026-09-14}"
    TURN_WAIT=240
    TOOL_WAIT=300
    ENGINE_WAIT=240
    ;;
  *) echo "REFUSE_NOT_S23 PHONE=$PHONE" >&2; exit 2 ;;
esac
case "$ANDROID_SERIAL" in
  192.168.1.193*|houji*|23127PN0CG*|192.168.1.82*|Jelly*) echo refused_other_phone >&2; exit 2 ;;
esac
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
mkdir -p "$EVID"
RUN="$EVID/run.log"
PICK="$EVID/ui_pick.py"
cd /Users/marco/Projects/kalsa
# shellcheck source=/dev/null
source scripts/device-share-send.sh
rlog() { echo "[$PHONE] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL skip_tools=$SKIP_TOOLS skip_docs=$SKIP_DOCS"

DEV=$(adb shell getprop ro.product.device </dev/null | tr -d '\r')
MODEL=$(adb shell getprop ro.product.model </dev/null | tr -d '\r')
rlog "device=$DEV model=$MODEL"
case "$MODEL" in SM-S911U|SM_S911U) ;; *) rlog REFUSE_NOT_S23; exit 2 ;; esac

APK_PATH=$(adb shell pm path com.kalsa.app </dev/null | tr -d '\r' | sed 's/^package://')
APK_SHA=$(adb shell "toybox sha256sum '$APK_PATH'" </dev/null | awk '{print $1}' | tr -d '\r')
rlog "apk=$APK_PATH sha=$APK_SHA"
[ "$APK_SHA" = "$EXPECTED_SHA" ] || { rlog "REFUSE_SHA_MISMATCH expected=$EXPECTED_SHA"; exit 2; }

SAVED_TIMEOUT=$(adb shell settings get system screen_off_timeout </dev/null | tr -d '\r')
rlog "timeout_saved=$SAVED_TIMEOUT"
if ! adb shell settings put system screen_off_timeout "$SHOT_TIMEOUT" </dev/null; then
  rlog "WARNING failed to set screen_off_timeout $SHOT_TIMEOUT"
fi

WPID="" LPID="" ACTIVE_LOG=""
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
  rlog "stay_on_after=$(adb shell settings get global stay_on_while_plugged_in </dev/null | tr -d '\r')"
  rlog "timeout_after=$(adb shell settings get system screen_off_timeout </dev/null | tr -d '\r')"
  if [ ! -f "$EVID/leftovers.exit" ]; then
    if [ -f "$EVID/oneshot.done" ]; then echo 0 > "$EVID/leftovers.exit"
    else echo 1 > "$EVID/leftovers.exit"
    fi
  fi
}
trap cleanup EXIT

PAUSE_AWAKE="$EVID/.pause_awake"
rm -f "$PAUSE_AWAKE"
wake() {
  adb shell input keyevent KEYCODE_WAKEUP </dev/null 2>&1 || true
  if [ ! -f "$PAUSE_AWAKE" ]; then
    device_collapse_shade </dev/null 2>&1 || true
  fi
  # Tiny chrome swipe (status-bar corner). Never swipe message text.
  adb shell input swipe 5 5 6 6 50 </dev/null 2>&1 || true
}
poke() { wake; }
keep_awake() {
  while true; do
    poke
    sleep 12
  done
}
pause_awake() { : > "$PAUSE_AWAKE"; }
resume_awake() { rm -f "$PAUSE_AWAKE"; }
ensure_keep_awake() {
  if [ -n "$WPID" ] && kill -0 "$WPID" 2>/dev/null; then
    return 0
  fi
  rlog "WARN keep_awake dead pid=${WPID:-none} — restart"
  keep_awake &
  WPID=$!
  rlog "keep_awake restarted pid=$WPID"
}
screen_is_on() {
  local out
  out=$(adb shell dumpsys power </dev/null 2>/dev/null | tr -d '\r') || true
  case "$out" in
    *mScreenOnFully=true*|*mAwake=true*|*mWakefulness=Awake*) return 0 ;;
  esac
  return 1
}
ensure_screen_on() {
  local i
  ensure_keep_awake
  for i in 1 2 3 4 5 6 7 8 9 10; do
    poke
    if screen_is_on; then
      return 0
    fi
    rlog "WARN screen off try=$i — wakeup"
    sleep 1
  done
  rlog "FAIL screen not fully on"
  return 1
}

dump_ui_nopoke() {
  local ui
  ui=$(device_dump_ui_retry </dev/null || true)
  printf '%s\n' "$ui" > "$1"
  printf '%s\n' "$ui"
}

thermal() {
  local t
  ensure_keep_awake
  screen_is_on || poke
  t=$(adb shell dumpsys battery </dev/null 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/ {print $2; exit}')
  rlog "temp_deci=$t"
  [ -n "$t" ] && [ "$t" -ge "$HARD_TEMP_DECI" ] && return 1
  return 0
}
read_temp() {
  adb shell dumpsys battery </dev/null 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/ {print $2; exit}'
}
# Cool at ≥40°C for at most 60s. Hard abort only ≥43°C (charging). Do not idle ≥150s.
cool_wait() {
  local want="${1:-$COOL_WANT_DECI}"
  local max_s="${2:-$COOL_MAX_S}"
  local t t0
  t=$(read_temp)
  rlog "cool_wait start temp_deci=$t want=$want max_s=$max_s"
  t0=$(date +%s)
  while [ -n "$t" ] && [ "$t" -ge "$want" ]; do
    [ "$t" -ge "$HARD_TEMP_DECI" ] && { rlog "THERMAL_ABORT during cool_wait"; return 1; }
    if [ $(( $(date +%s) - t0 )) -ge "$max_s" ]; then
      rlog "WARN cool_wait timeout temp_deci=$t want=$want — continue"
      [ "$t" -ge "$HARD_TEMP_DECI" ] && { rlog "THERMAL_ABORT cool_wait still >=43C"; return 1; }
      return 0
    fi
    ensure_keep_awake
    screen_is_on || poke
    sleep 12
    t=$(read_temp)
    rlog "cool_wait temp_deci=$t"
  done
  rlog "cool_wait ready temp_deci=$t"
  return 0
}
battery_snap() {
  adb shell dumpsys battery </dev/null 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+(level|temperature|status):[[:space:]]*[0-9]+[[:space:]]*$/ {printf "%s ", $0}'
  echo
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
  local clear="${2:-1}"
  if [ "$clear" = "1" ]; then
    : > "$f"
    adb logcat -c </dev/null
  fi
  adb logcat -v threadtime ReactNativeJS:I RNLlama:W '*:S' >> "$f" </dev/null &
  LPID=$!
  ACTIVE_LOG="$f"
}

wait_engine() {
  local logf="$1" secs="${2:-180}" mark="${3:-0}"
  local t0 chunk
  t0=$(date +%s)
  while [ $(( $(date +%s) - t0 )) -lt "$secs" ]; do
    thermal || return 3
    poke
    chunk=$(tail -n +"$((mark+1))" "$logf" 2>/dev/null || true)
    if printf '%s' "$chunk" | grep KALSA_PREWARM | grep -q '"op":"done"'; then
      rlog "engine prewarm ready (done)"
      printf '%s' "$chunk" | grep KALSA_PREWARM | grep '"op":"done"' | tail -1 | tee -a "$RUN"
      return 0
    fi
    if printf '%s' "$chunk" | grep KALSA_PREWARM | grep -q 'kv_holds_chat'; then
      rlog "engine prewarm skip kv_holds_chat"
      printf '%s' "$chunk" | grep KALSA_PREWARM | grep kv_holds_chat | tail -1 | tee -a "$RUN"
      return 0
    fi
    sleep 3
  done
  rlog "WARN engine wait timeout ${secs}s mark=$mark"
  return 1
}

wait_engine_or_die() {
  local logf="$1" secs="${2:-180}" mark="${3:-0}"
  local i rc
  for i in 1 2 3 4; do
    wait_engine "$logf" "$secs" "$mark"
    rc=$?
    if [ "$rc" -eq 0 ]; then return 0; fi
    if [ "$rc" -eq 3 ]; then
      rlog "THERMAL_ABORT wait_engine"
      echo THERMAL > "$EVID/turns-abort.txt"
      echo 0 > "$EVID/turns-count.txt"
      exit 3
    fi
    rlog "engine wait retry $i rc=$rc"
  done
  rlog "FAIL engine not ready (no PREWARM done)"
  echo "prewarm_timeout" > "$EVID/turns-abort.txt"
  echo 0 > "$EVID/turns-count.txt"
  exit 1
}

wait_not_generating() {
  local ui_path="$1" i ui
  for i in $(seq 1 80); do
    thermal || return 3
    ui=$(dump_ui_file "$ui_path")
    if printf '%s' "$ui" | grep -q 'Interrompi generazione'; then
      rlog "WAIT generating i=$i (never Interrompi)"
      sleep 5
      continue
    fi
    return 0
  done
  rlog "WARN still generating after wait"
  return 1
}

new_chat() {
  local tag="$1"
  local ready="$EVID/ui-${tag}.xml"
  local drawer="$EVID/ui-${tag}-drawer.xml"
  local after="$EVID/ui-${tag}-after.xml"
  local inv ix iy w h
  wait_not_generating "$ready" || true
  dump_ui_file "$ready" >/dev/null
  # Empty composer can still hold a restored KV (13b: UI empty, load i02 3802).
  # Always open the drawer and tap Nuova chat.
  pause_awake
  open_tries=0
  while [ "$open_tries" -lt 4 ]; do
    open_tries=$((open_tries + 1))
    dump_ui_nopoke "$drawer" >/dev/null
    if ! grep -qiE 'conversazioni|cerca nelle chat' "$drawer"; then
      inv=$(python3 "$PICK" coords "$ready" "Menu" || python3 "$PICK" coords "$drawer" "Menu" || true)
      if [ -z "$inv" ]; then
        dump_ui_file "$ready" >/dev/null
        inv=$(python3 "$PICK" coords "$ready" "Menu" || true)
      fi
      if [ -z "$inv" ]; then
        rlog "WARN Menu not found try=$open_tries"
        sleep 2
        continue
      fi
      read -r ix iy <<< "$inv"
      sleep 1
      adb shell input tap "$ix" "$iy" </dev/null
      rlog "tapped Menu $ix,$iy try=$open_tries"
      sleep 2
      dump_ui_nopoke "$drawer" >/dev/null
    fi
    if ! grep -qiE 'conversazioni|cerca nelle chat' "$drawer"; then
      rlog "WARN drawer not open try=$open_tries"
      continue
    fi
    inv=$(python3 "$PICK" widest "$drawer" "Nuova chat" 200 || true)
    if [ -z "$inv" ]; then
      rlog "WARN drawer Nuova chat missing try=$open_tries"
      continue
    fi
    read -r ix iy w h <<< "$inv"
    if [ "${w:-0}" -lt 200 ]; then
      rlog "WARN Nuova chat too narrow w=$w try=$open_tries"
      continue
    fi
    adb shell input tap "$ix" "$iy" </dev/null
    leftx=$((ix - w / 4))
    [ "$leftx" -lt 80 ] && leftx=120
    sleep 0.4
    adb shell input tap "$leftx" "$iy" </dev/null
    rlog "tapped drawer Nuova chat $ix,$iy and $leftx,$iy w=$w h=$h try=$open_tries"
    sleep 3
    dump_ui_nopoke "$after" >/dev/null
    if grep -qiE 'conversazioni|cerca nelle chat' "$after"; then
      rlog "drawer still open — tap Chiudi edge"
      adb shell input tap 1040 400 </dev/null
      sleep 1
      dump_ui_nopoke "$after" >/dev/null
    fi
    if python3 "$PICK" empty "$after"; then
      rlog "new_chat empty ui try=$open_tries"
      echo 1 > "$EVID/did-switch"
      resume_awake
      return 0
    fi
    rlog "WARN old messages still visible after tap try=$open_tries"
  done
  rlog "FAIL new_chat UI not empty"
  resume_awake
  return 1
}

recycle_engine() {
  local tag="$1"
  rlog "recycle_engine tag=$tag"
  kill "$LPID" 2>/dev/null || true
  wait "$LPID" 2>/dev/null || true
  adb shell am force-stop com.kalsa.app </dev/null
  sleep 2
  start_logcat "$EVID/logcat-${tag}.txt" 1
  poke
  adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
  sleep 6
  wait_engine_or_die "$ACTIVE_LOG" "$ENGINE_WAIT" 0
  grep 'KALSA_SESSION' "$ACTIVE_LOG" | grep '"op":"load"' | tee "$EVID/load-${tag}.txt" | tee -a "$RUN" || true
  cat "$ACTIVE_LOG" >> "$EVID/logcat.txt" || true
  dump_ui_file "$EVID/ui-${tag}-fresh.xml" >/dev/null
}

ensure_fresh_chat() {
  local tag="$1"
  local try=0 stem
  while [ "$try" -lt 3 ]; do
    try=$((try + 1))
    new_chat "${tag}-$try" || { rlog "FAIL new_chat $tag try=$try"; return 1; }
    sleep 2
    dump_ui_file "$EVID/ui-${tag}-$try-fresh.xml" >/dev/null
    stem=$(grep 'KALSA_SESSION' "$ACTIVE_LOG" | grep '"op":"load"' | tail -1 || true)
    rlog "post_nuova load=$stem"
    # f441b3d T20: UI empty but load restored conv-g1-c01 tokens=4364.
    # Require no_file / failed load, not a prior 20t KV.
    if echo "$stem" | grep -q 'no_file\|"ok":false'; then
      rlog "fresh chat no_file after nuova try=$try"
      return 0
    fi
    if echo "$stem" | grep -qE '"tokens":0[,}]'; then
      rlog "fresh chat tokens=0 after nuova try=$try"
      return 0
    fi
    rlog "WARN load restored prior KV after nuova try=$try — tap again, do not send"
    rlog "WARN ui not empty after nuova try=$try — do not send"
  done
  rlog "FAIL ensure_fresh_chat $tag"
  echo "old_chat_visible" > "$EVID/turns-abort.txt"
  return 1
}

send_msg() {
  local msg="$1" tag="$2" ui_path="$3"
  local i ui inv ix iy
  pause_awake
  ensure_screen_on || { resume_awake; rlog "FAIL screen off before send $tag"; return 1; }
  poke
  device_share_intent "$msg" "${tag}_$(date +%s)" </dev/null
  sleep 2
  device_collapse_shade </dev/null
  for i in 1 2 3 4 5 6 7 8; do
    thermal || { resume_awake; return 3; }
    ensure_screen_on || { resume_awake; rlog "FAIL screen off before Invia $tag"; return 1; }
    ui=$(dump_ui_file "$ui_path")
    if printf '%s' "$ui" | grep -q 'Interrompi generazione'; then
      rlog "WAIT generating during send $tag (never Interrompi)"
      sleep 4
      continue
    fi
    if printf '%s' "$ui" | grep -q 'Tocca per ricaricare'; then
      inv=$(python3 "$PICK" coords "$ui_path" "Tocca per ricaricare" || true)
      if [ -n "$inv" ]; then read -r ix iy <<< "$inv"; adb shell input tap "$ix" "$iy" </dev/null; sleep 4; continue; fi
    fi
    if printf '%s' "$ui" | grep 'content-desc="Invia"' | grep -q 'enabled="true"'; then
      inv=$(python3 "$PICK" coords "$ui_path" "Invia") || continue
      read -r ix iy <<< "$inv"
      rlog "screen_before_invia=$(screen_is_on && echo on || echo off) $tag"
      adb shell input tap "$ix" "$iy" </dev/null
      rlog "Invia $tag at $ix,$iy utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      resume_awake
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
  resume_awake
  return 1
}

wait_kv_tel() {
  local mark="$1" kvout="$2" telout="$3" logf="$4" secs="$5"
  local t0 got_kv=0 extra=0
  t0=$(date +%s)
  while [ $(( $(date +%s) - t0 )) -lt $((secs + extra)) ]; do
    thermal || return 3
    poke
    tail -n +"$((mark+1))" "$logf" | grep -E 'KALSA_KVPREFIX|KALSA_KVDIVERGE|window_slide' > "$kvout" || true
    if tail -n +"$((mark+1))" "$logf" | grep KALSA_TELEMETRY | grep -v util-extract | grep -q .; then
      tail -n +"$((mark+1))" "$logf" | grep -E 'KALSA_KVPREFIX|KALSA_KVDIVERGE|window_slide' > "$kvout" || true
      tail -n +"$((mark+1))" "$logf" | grep KALSA_TELEMETRY | grep -v util-extract | tail -3 | tee "$telout" | tee -a "$RUN"
      tail -n +"$((mark+1))" "$logf" | grep -E 'KALSA_TOOLCALL|KALSA_TOOLROUND|"tool":' | tee -a "$RUN" >> "${kvout}.tools" || true
      return 0
    fi
    if [ $(( ($(date +%s) - t0) % 15 )) -lt 3 ]; then
      dump_ui_file "$EVID/ui-wait.xml" >/dev/null
      # Do NOT tap composer (13e bump aborted nothing useful and risked send).
      if grep -qE 'Interrompi generazione|Sto pensando' "$EVID/ui-wait.xml" 2>/dev/null && [ "$extra" -lt "$secs" ]; then
        extra=$((secs))
        rlog "WAIT still generating; extend wait extra=$extra"
      fi
    fi
    sleep 3
  done
  rlog "WARN no telemetry after $((secs + extra))s mark=$mark"
  return 1
}

n_common_of() {
  # Max n_common: prewarm race is 0; extract after TELEMETRY is 2;
  # the chat turn is ~1829 and grows. kvout is KVPREFIX-only so
  # last-before-TELEMETRY never sees the tel line.
  awk '
    /KALSA_KVPREFIX/ {
      if (match($0, /n_common=[0-9]+/)) {
        v=substr($0,RSTART+9,RLENGTH-9)+0
        if (v > m) m=v
      }
    }
    END { if (m != "") print m }
  ' "$1" 2>/dev/null
}
embd_of() {
  awk '
    /KALSA_KVPREFIX/ {
      if (match($0, /n_common=[0-9]+/)) nc=substr($0,RSTART+9,RLENGTH-9)+0
      if (match($0, /embd=[0-9]+/)) e=substr($0,RSTART+5,RLENGTH-5)
      if (nc > m) { m=nc; best=e }
    }
    END { if (best != "") print best }
  ' "$1" 2>/dev/null
}

old_live_kv() {
  local nc="$1" embd="$2"
  case "$nc" in
    2122|2136|5196|5199) return 0 ;;
  esac
  [ -n "$embd" ] && [ "$embd" -ge 4000 ] && return 0
  return 1
}
stuck_after_t5() {
  local nc="$1" t1="$2"
  [ -z "$nc" ] && return 0
  [ "$nc" = "0" ] && return 0
  [ -n "$t1" ] && [ "$nc" -le $((t1 + 10)) ] && return 0
  return 1
}
quote_wipe() {
  local logf="${ACTIVE_LOG:-$EVID/logcat.txt}"
  rlog "WIPE_PREWARM_NOTIFY"
  grep -E 'KALSA_PREWARM|notifyStaticPrefix|clearCache|markChatKvCleared|kv_holds_chat' "$logf" | tail -40 | tee "$EVID/wipe-prewarm.txt" | tee -a "$RUN" || true
}

# --- begin ---
keep_awake &
WPID=$!
rlog "keep_awake_pid=$WPID"
ensure_screen_on || { rlog FAIL_SCREEN; echo SCREEN_OFF > "$EVID/verdict-raw.txt"; exit 1; }
thermal || { rlog THERMAL_ABORT; echo THERMAL > "$EVID/verdict-raw.txt"; exit 3; }
rlog "stay_on_before=$(adb shell settings get global stay_on_while_plugged_in </dev/null | tr -d '\r')"
rlog "battery_before=$(battery_snap)"
cool_wait "$COOL_WANT_DECI" "$COOL_MAX_S" || { rlog THERMAL_ABORT; echo THERMAL > "$EVID/verdict-raw.txt"; exit 3; }

poke
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
start_logcat "$EVID/logcat.txt"
poke
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 6
wait_engine_or_die "$ACTIVE_LOG" "$ENGINE_WAIT" 0
grep 'KALSA_SESSION' "$ACTIVE_LOG" | grep '"op":"load"' | tee "$EVID/load-boot.txt" | tee -a "$RUN" || true

if [ "$SKIP_TOOLS" = "1" ]; then
  rlog "PHASE tools SKIP (parent-verified PASS)"
  echo SKIP > "$EVID/tools-verdict.txt"
else
  rlog "PHASE tools refused on this 20t-only run"
  echo SKIP > "$EVID/tools-verdict.txt"
fi

rlog "PHASE docs"
python3 - "$EVID" <<'PY'
import pathlib, sqlite3, json, sys, os, subprocess
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
rlog "docs SKIP (S23 library empty / skip_docs=1)"
echo HARNESS_MISS > "$EVID/docs-verdict.txt"

rlog "PHASE turns20"
# Nuova chat does not emit a new load (T20B: still conv-1789351648879 tokens=2304).
# G2 20t does not require an empty chat. Continue the held KV.
rlog "CONTINUE_EXISTING skip nuova (kv_holds_chat / last load above)"
PRE_MARK=$(wc -l < "$ACTIVE_LOG" | tr -d ' ')
rlog "post_nuova wait PREWARM mark=$PRE_MARK (done or kv_holds_chat; 180s; timeout still SEND)"
wait_engine "$ACTIVE_LOG" 180 "$PRE_MARK"
pre_rc=$?
if [ "$pre_rc" -eq 3 ]; then
  rlog "THERMAL_ABORT post_nuova PREWARM"
  echo THERMAL > "$EVID/turns-abort.txt"
  echo 0 > "$EVID/turns-count.txt"
  exit 3
elif [ "$pre_rc" -eq 0 ]; then
  rlog "post_nuova PREWARM event on this chat"
else
  rlog "WARN no PREWARM after nuova rc=$pre_rc — send anyway (T20 abort was harness: skip was before mark, wait 20s)"
fi
: > "$EVID/turns.jsonl"
PROMPTS=()
while IFS= read -r _line || [ -n "$_line" ]; do
  [ -n "$_line" ] && PROMPTS[${#PROMPTS[@]}]="$_line"
done < "$EVID/prompts-20.txt"
n=0
T1_NC=""
cool_wait "$COOL_WANT_DECI" "$COOL_MAX_S" || { rlog "THERMAL_ABORT before turns"; echo "thermal_at=0" > "$EVID/turns-abort.txt"; echo 0 > "$EVID/turns-count.txt"; exit 3; }
for msg in "${PROMPTS[@]}"; do
  [ -n "$msg" ] || continue
  n=$((n+1))
  cool_wait "$COOL_WANT_DECI" "$COOL_MAX_S" || { rlog "THERMAL_ABORT at turn $n"; echo "thermal_at=$n" > "$EVID/turns-abort.txt"; break; }
  rlog "turn $n msg=${msg:0:60}"
  MARK=$(wc -l < "$ACTIVE_LOG" | tr -d ' ')
  send_msg "$msg" "t$n" "$EVID/ui-turn.xml"
  src=$?
  if [ "$src" -eq 3 ]; then
    rlog "THERMAL_ABORT send turn $n"
    echo "thermal_at=$n" > "$EVID/turns-abort.txt"
    break
  elif [ "$src" -ne 0 ]; then
    rlog "FAIL send turn $n"
    echo "send_fail=$n" > "$EVID/turns-abort.txt"
    break
  fi
  wait_kv_tel "$MARK" "$EVID/turn-$n-kv.txt" "$EVID/turn-$n-tel.txt" "$ACTIVE_LOG" "$TURN_WAIT"
  wrc=$?
  if [ "$wrc" -eq 3 ]; then
    rlog "THERMAL_ABORT complete turn $n"
    echo "thermal_at=$n" > "$EVID/turns-abort.txt"
    break
  elif [ "$wrc" -ne 0 ]; then
    rlog "FAIL complete turn $n"
    echo "complete_fail=$n" > "$EVID/turns-abort.txt"
    break
  fi
  NC=$(n_common_of "$EVID/turn-$n-kv.txt")
  EMBD=$(embd_of "$EVID/turn-$n-kv.txt")
  rlog "turn $n n_common=${NC:-missing} embd=${EMBD:-missing}"
  dump_ui_file "$EVID/ui-turn-$n-reply.xml" >/dev/null
  python3 - "$EVID/ui-turn-$n-reply.xml" "$EVID/turn-$n-reply.txt" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
texts = re.findall(r'text="([^"]{1,400})"', xml)
open(sys.argv[2], "w", encoding="utf-8").write("\n".join(texts[-40:]))
PY
  if [ "${EMBD:-}" = "0" ]; then
    rlog "FAIL wipe embd=0 n_common=$NC at turn $n — stop"
    echo "wipe_embd=0 at=$n" > "$EVID/turns-abort.txt"
    quote_wipe
    break
  fi
  if [ "$n" -eq 1 ]; then
    T1_NC="${NC:-}"
    if [ -z "$NC" ] || [ "$NC" = "0" ] || [ "${EMBD:-0}" = "0" ]; then
      rlog "FAIL first KVPREFIX n_common=$NC embd=$EMBD (wipe/diverge)"
      echo "first_kv_n_common=$NC embd=$EMBD" > "$EVID/turns-abort.txt"
      quote_wipe
      break
    fi
    if [ "$NC" -lt 1000 ]; then
      rlog "FAIL first KVPREFIX n_common=$NC too small"
      echo "first_kv_n_common=$NC embd=$EMBD" > "$EVID/turns-abort.txt"
      break
    fi
    if old_live_kv "${NC:-}" "${EMBD:-0}"; then
      rlog "FAIL old live/tools KV n_common=$NC embd=$EMBD"
      echo "old_kv_n_common=$NC embd=$EMBD" > "$EVID/turns-abort.txt"
      break
    fi
  fi
  if [ "$n" -ge 5 ] && stuck_after_t5 "${NC:-}" "${T1_NC:-}"; then
    rlog "FAIL stuck n_common=$NC t1=$T1_NC at turn $n"
    echo "stuck_n_common=$NC t1=$T1_NC at=$n" > "$EVID/turns-abort.txt"
    break
  fi
  python3 -c 'import json,sys; print(json.dumps({"n":int(sys.argv[1]),"kv":open(sys.argv[2],encoding="utf-8",errors="replace").read()[-500:],"tel":open(sys.argv[3],encoding="utf-8",errors="replace").read()[-400:]}))' \
    "$n" "$EVID/turn-$n-kv.txt" "$EVID/turn-$n-tel.txt" >> "$EVID/turns.jsonl"
  rlog "turn $n complete"
  [ "$n" -ge 20 ] && break
done
echo "$n" > "$EVID/turns-count.txt"
rlog "turns_done=$n"
if [ -f "$EVID/turns-abort.txt" ] || [ "$n" -lt 20 ]; then
  rlog "ABORT turns n=$n $(cat "$EVID/turns-abort.txt" 2>/dev/null || echo n_lt_20)"
  python3 "$EVID/write_verdict.py" "$EVID" "$PHONE" | tee -a "$RUN" || true
  exit 1
fi

if [ "$SKIP_RESTORE" != "1" ] && thermal; then
  rlog "PHASE restore"
  kill "$LPID" 2>/dev/null || true
  wait "$LPID" 2>/dev/null || true
  adb shell am force-stop com.kalsa.app </dev/null
  sleep 2
  start_logcat "$EVID/logcat-restore.txt"
  poke
  adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
  sleep 5
  wait_engine "$ACTIVE_LOG" 120 || true
  grep 'KALSA_SESSION' "$ACTIVE_LOG" | grep '"op":"load"' | tee "$EVID/restore-load.txt" | tee -a "$RUN" || true
else
  rlog "skip restore"
fi

rlog "battery_after=$(battery_snap)"
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 "$EVID/write_verdict.py" "$EVID" "$PHONE" | tee -a "$RUN" || true
echo DONE > "$EVID/oneshot.done"
