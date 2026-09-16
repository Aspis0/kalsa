#!/usr/bin/env bash
# G2 leftovers: tools / docs / 20 turns. No stayon. No uninstall. No Interrompi.
# stdin: mapfile + every adb </dev/null. New chat: drawer row, not header icon.
set -uo pipefail
PHONE="${PHONE:-s23}"
SKIP_TOOLS="${SKIP_TOOLS:-0}"
SKIP_DOCS="${SKIP_DOCS:-0}"
SKIP_RESTORE="${SKIP_RESTORE:-0}"
EXPECTED_SHA="1a0fb8f5a00b2d52f80648c41967213b19577bce8f09844ffe44bd112032598c"
case "$PHONE" in
  s23)
    export ANDROID_SERIAL="${ANDROID_SERIAL:-adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp}"
    SHOT_TIMEOUT=300000
    EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/S23-D39FA51-G2-T20-BATT-2026-09-13}"
    TURN_WAIT=420
    TOOL_WAIT=300
    ENGINE_WAIT=180
    ;;
  jelly)
    export ANDROID_SERIAL="${ANDROID_SERIAL:-192.168.1.82:5555}"
    SHOT_TIMEOUT=600000
    EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/JELLY-D39FA51-G2-LEFTOVERS-2026-09-13}"
    TURN_WAIT=420
    TOOL_WAIT=480
    ENGINE_WAIT=480
    ;;
  *) echo "bad PHONE=$PHONE" >&2; exit 2 ;;
esac
case "$ANDROID_SERIAL" in
  192.168.1.193*|houji*|23127PN0CG*) echo refused_xiaomi >&2; exit 2 ;;
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
rm -f "$EVID/turns-abort.txt" "$EVID/oneshot.done" "$EVID/leftovers.exit" \
  "$EVID/screen-off-events.txt" "$EVID/ac-events.txt" "$EVID/keep_awake-restarts.txt"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$ANDROID_SERIAL skip_tools=$SKIP_TOOLS skip_docs=$SKIP_DOCS"

DEV=$(adb shell getprop ro.product.device </dev/null | tr -d '\r')
MODEL=$(adb shell getprop ro.product.model </dev/null | tr -d '\r')
rlog "device=$DEV model=$MODEL"
case "$PHONE" in
  s23) case "$MODEL" in SM-S911U|SM_S911U) ;; *) rlog REFUSE_NOT_S23; exit 2 ;; esac ;;
  jelly) [ "$DEV" = Jelly_Star ] || { rlog REFUSE_NOT_JELLY; exit 2; } ;;
esac

APK_PATH=$(adb shell pm path com.kalsa.app </dev/null | tr -d '\r' | sed 's/^package://')
APK_SHA=$(adb shell "toybox sha256sum '$APK_PATH'" </dev/null | awk '{print $1}' | tr -d '\r')
rlog "apk=$APK_PATH sha=$APK_SHA"
[ "$APK_SHA" = "$EXPECTED_SHA" ] || { rlog "REFUSE_SHA_MISMATCH expected=$EXPECTED_SHA"; exit 2; }

SAVED_TIMEOUT=$(adb shell settings get system screen_off_timeout </dev/null | tr -d '\r')
# S23 was null before this harness. 300000 is our shot timeout — restore DELETE.
case "$SAVED_TIMEOUT" in
  300000|300000.0) SAVED_TIMEOUT=null ;;
esac
rlog "timeout_saved=$SAVED_TIMEOUT"
if ! adb shell settings put system screen_off_timeout "$SHOT_TIMEOUT" </dev/null; then
  rlog "WARNING failed to set screen_off_timeout $SHOT_TIMEOUT"
fi

WPID="" LPID=""
cleanup() {
  rlog "cleanup utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  batt_sample "cleanup" "${n:-}" || true
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
CPU_DECODE_DUMPED=0
CPU_IDLE_DUMPED=0
wake() {
  adb shell input keyevent KEYCODE_WAKEUP </dev/null 2>&1 || true
  device_collapse_shade </dev/null 2>&1 || true
}
# Tiny nudge away from composer (y~1930) and Interrompi. keep_awake only, not every poke.
swipe_nudge() {
  # Header right — not message body (y=520 opened the copy sheet).
  adb shell input swipe 1000 220 1000 200 80 </dev/null 2>&1 || true
}
poke() { wake; }
keep_awake() {
  while true; do
    sleep 15
    wake
    [ -f "$PAUSE_AWAKE" ] || swipe_nudge
  done
}
pause_awake() { : > "$PAUSE_AWAKE"; }
resume_awake() { rm -f "$PAUSE_AWAKE"; }
ensure_keep_awake() {
  if [ -n "$WPID" ] && kill -0 "$WPID" 2>/dev/null; then
    return 0
  fi
  rlog "HARNESS keep_awake dead — restarting poke loop (do not continue screen off)"
  echo "restart utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) old=$WPID" >> "$EVID/keep_awake-restarts.txt"
  keep_awake &
  WPID=$!
  echo "$WPID" > "$EVID/keep_awake.pid"
}
ensure_screen() {
  local i line focus pid
  for i in 1 2 3 4 5 6 7 8; do
    ensure_keep_awake
    poke
    swipe_nudge
    pid=$(kalsa_pid)
    if [ -z "$pid" ]; then
      rlog "WARN pid empty — start MainActivity"
      adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
      sleep 2
    fi
    line=$(adb shell dumpsys window displays </dev/null 2>/dev/null | tr -d '\r' | grep -m1 'mScreenOnFully=' || true)
    rlog "screen $line"
    focus=$(adb shell dumpsys window </dev/null 2>/dev/null | tr -d '\r' | grep mCurrentFocus | head -1 || true)
    rlog "focus $focus"
    echo "$line" | grep -q 'mAwake=true' || { sleep 1; continue; }
    echo "$line" | grep -q 'mScreenOnFully=true' || { sleep 1; continue; }
    echo "$focus" | grep -q 'com.kalsa.app' && echo "$focus" | grep -q 'MainActivity' || {
      adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
      sleep 1
      continue
    }
    return 0
  done
  rlog "FAIL screen not fully on or MainActivity not focused"
  return 1
}

dump_ui_nopoke() {
  local ui
  ui=$(device_dump_ui_retry </dev/null || true)
  printf '%s\n' "$ui" > "$1"
  printf '%s\n' "$ui"
}

# Hard abort only: temp >=43.0C (430 deci) OR battery level <=15.
# 40.3C must NOT kill the run (T20 died there on turn 2).
read_temp() {
  adb shell dumpsys battery </dev/null 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+temperature:[[:space:]]*[0-9]+[[:space:]]*$/ {print $2; exit}'
}
read_level() {
  adb shell dumpsys battery </dev/null 2>/dev/null | tr -d '\r' | awk '/^[[:space:]]+level:[[:space:]]*[0-9]+[[:space:]]*$/ {print $2; exit}'
}
hard_abort() {
  local t lvl
  t=$(read_temp)
  lvl=$(read_level)
  rlog "temp_deci=$t level=$lvl"
  if [ -n "$t" ] && [ "$t" -ge 430 ]; then
    rlog "THERMAL_ABORT temp_deci=$t (>=43C)"
    return 1
  fi
  if [ -n "$lvl" ] && [ "$lvl" -le 15 ]; then
    rlog "BATTERY_ABORT level=$lvl"
    return 1
  fi
  return 0
}
thermal() { hard_abort; }
# If >=40C, wait until below 40C then CONTINUE. Abort only via hard_abort.
cool_wait() {
  local want="${1:-400}"
  local max_s="${2:-420}"
  local t t0
  t=$(read_temp)
  rlog "cool_wait start temp_deci=$t want=$want max_s=$max_s"
  [ -z "$t" ] || [ "$t" -lt "$want" ] && { rlog "cool_wait skip temp_deci=$t"; return 0; }
  t0=$(date +%s)
  while [ -n "$t" ] && [ "$t" -ge "$want" ]; do
    hard_abort || return 1
    batt_sample "cool_wait" "${n:-}"
    if [ $(( $(date +%s) - t0 )) -ge "$max_s" ]; then
      rlog "WARN cool_wait timeout temp_deci=$t want=$want — CONTINUE (<43C)"
      return 0
    fi
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
kalsa_pid() {
  adb shell pidof com.kalsa.app </dev/null 2>/dev/null | tr -d '\r' | awk '{print $1}'
}
batt_sample() {
  python3 "$EVID/batt_sample.py" "$EVID" "$1" "${2:-}" | tee -a "$RUN"
}
cpu_snapshot() {
  local tag="$1"
  local pid
  pid=$(kalsa_pid)
  {
    echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) pid=$pid tag=$tag"
    echo "=== dumpsys cpuinfo (com.kalsa.app) ==="
    timeout 8 adb shell dumpsys cpuinfo </dev/null 2>/dev/null | tr -d '\r' | grep -E 'CPU usage|com\.kalsa\.app' || true
    echo "=== top -H -n 1 -p pid ==="
    if [ -n "$pid" ]; then
      timeout 8 adb shell "top -H -n 1 -p $pid" </dev/null 2>/dev/null | tr -d '\r' || true
    else
      echo "no pid"
    fi
  } > "$EVID/cpu-${tag}.txt"
  rlog "cpu_snapshot tag=$tag pid=$pid lines=$(wc -l < "$EVID/cpu-${tag}.txt" | tr -d ' ')"
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
}

wait_engine() {
  local logf="$1" secs="${2:-180}" mark="${3:-0}" need_done="${4:-0}"
  local t0 pat last_batt
  t0=$(date +%s)
  last_batt=0
  if [ "$need_done" = "1" ]; then
    pat='"op":"done"'
  else
    pat='"op":"done"|kv_holds_chat|"op":"skip"'
  fi
  while [ $(( $(date +%s) - t0 )) -lt "$secs" ]; do
    thermal || return 3
    ensure_keep_awake
    poke
    if [ $(( $(date +%s) - last_batt )) -ge 10 ]; then
      batt_sample "prewarm" "${n:-}"
      last_batt=$(date +%s)
    fi
    if [ "$need_done" = "1" ] && tail -n +"$((mark+1))" "$logf" 2>/dev/null | grep KALSA_PREWARM | grep -qE '"op":"skip"|kv_holds_chat'; then
      rlog "PREWARM skip/kv_holds_chat while need done — not fresh"
      tail -n +"$((mark+1))" "$logf" | grep KALSA_PREWARM | tail -1 | tee -a "$RUN"
      return 4
    fi
    if tail -n +"$((mark+1))" "$logf" 2>/dev/null | grep KALSA_PREWARM | grep -qE "$pat"; then
      rlog "engine prewarm ready need_done=$need_done"
      tail -n +"$((mark+1))" "$logf" | grep KALSA_PREWARM | grep -E "$pat" | tail -1 | tee -a "$RUN"
      return 0
    fi
    sleep 3
  done
  rlog "WARN engine wait timeout ${secs}s mark=$mark need_done=$need_done"
  return 1
}

wait_engine_or_die() {
  local logf="$1" secs="${2:-180}" mark="${3:-0}" need_done="${4:-0}"
  local i rc
  for i in 1 2 3 4; do
    wait_engine "$logf" "$secs" "$mark" "$need_done"
    rc=$?
    if [ "$rc" -eq 0 ]; then return 0; fi
    if [ "$rc" -eq 3 ]; then
      rlog "THERMAL_ABORT wait_engine"
      echo THERMAL > "$EVID/turns-abort.txt"
      echo 0 > "$EVID/turns-count.txt"
      exit 3
    fi
    if [ "$rc" -eq 4 ]; then
      rlog "PREWARM skip (not fresh chat)"
      return 4
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
  local force="${2:-}"
  local ready="$EVID/ui-${tag}.xml"
  local drawer="$EVID/ui-${tag}-drawer.xml"
  local after="$EVID/ui-${tag}-after.xml"
  local inv ix iy w h i
  wait_not_generating "$ready" || true
  dump_ui_file "$ready" >/dev/null
  if [ "$force" != "force" ] && python3 "$PICK" empty "$ready"; then
    rlog "already empty chat — skip drawer"
    echo 0 > "$EVID/did-switch"
    return 0
  fi
  rlog "new_chat tag=$tag force=$force (drawer Nuova chat)"
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

send_msg() {
  local msg="$1" tag="$2" ui_path="$3"
  local i ui inv ix iy
  ensure_screen || { rlog "FAIL send $tag screen/focus"; return 4; }
  pause_awake
  poke
  device_share_intent "$msg" "${tag}_$(date +%s)" </dev/null
  sleep 2
  device_collapse_shade </dev/null
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do
    thermal || { resume_awake; return 3; }
    ensure_keep_awake
    ui=$(dump_ui_file "$ui_path")
    if printf '%s' "$ui" | grep -q 'Salva nelle note'; then
      rlog "copy sheet open — KEYCODE_BACK"
      adb shell input keyevent KEYCODE_BACK </dev/null
      sleep 1
      continue
    fi
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
      batt_sample "invia" "${n:-}"
      adb shell input tap "$ix" "$iy" </dev/null
      rlog "Invia $tag at $ix,$iy utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      sleep 2
      last_send=$(grep KALSA_SEND "$EVID/logcat.txt" 2>/dev/null | grep '"phase":"fit"' | tail -1 || true)
      if echo "$last_send" | grep -q '"allow":false'; then
        rlog "SEND_REJECTED $tag $last_send"
        resume_awake
        return 5
      fi
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
  local t0 got_kv=0 extra=0 last_batt
  t0=$(date +%s)
  last_batt=0
  pause_awake
  while [ $(( $(date +%s) - t0 )) -lt $((secs + extra)) ]; do
    thermal || { resume_awake; return 3; }
    ensure_keep_awake
    poke
    if [ $(( $(date +%s) - last_batt )) -ge 10 ]; then
      batt_sample "decode" "${n:-}"
      last_batt=$(date +%s)
      if [ "$CPU_DECODE_DUMPED" -eq 0 ] && [ "${n:-0}" -ge 2 ] && [ $(( $(date +%s) - t0 )) -ge 30 ]; then
        cpu_snapshot decode
        CPU_DECODE_DUMPED=1
      fi
    fi
    if [ "$got_kv" -eq 0 ] && tail -n +"$((mark+1))" "$logf" | grep -q KALSA_KVPREFIX; then
      got_kv=1
      tail -n +"$((mark+1))" "$logf" | grep -E 'KALSA_KVPREFIX|KALSA_KVDIVERGE|window_slide' | tee "$kvout" | tee -a "$RUN"
    fi
    if tail -n +"$((mark+1))" "$logf" | grep KALSA_TELEMETRY | grep -v util-extract | grep -q .; then
      tail -n +"$((mark+1))" "$logf" | grep KALSA_TELEMETRY | grep -v util-extract | tail -3 | tee "$telout" | tee -a "$RUN"
      tail -n +"$((mark+1))" "$logf" | grep -E 'KALSA_TOOLCALL|KALSA_TOOLROUND|"tool":' | tee -a "$RUN" >> "${kvout}.tools" || true
      batt_sample "telemetry" "${n:-}"
      resume_awake
      return 0
    fi
    if [ $(( ($(date +%s) - t0) % 30 )) -lt 3 ]; then
      dump_ui_file "$EVID/ui-wait.xml" >/dev/null
      if grep -q 'Interrompi generazione' "$EVID/ui-wait.xml" 2>/dev/null && [ "$extra" -lt "$secs" ]; then
        extra=$((secs))
        rlog "WAIT still generating; extend wait extra=$extra"
      fi
    fi
    sleep 3
  done
  rlog "WARN no telemetry after $((secs + extra))s mark=$mark"
  resume_awake
  return 1
}

n_common_of() {
  awk '/KALSA_KVPREFIX/ { if (match($0, /n_common=[0-9]+/)) { v=substr($0,RSTART+9,RLENGTH-9); print v; exit } }' "$1" 2>/dev/null
}
embd_of() {
  awk '/KALSA_KVPREFIX/ { if (match($0, /embd=[0-9]+/)) { v=substr($0,RSTART+5,RLENGTH-5); print v; exit } }' "$1" 2>/dev/null
}

# Turn-1 live/tools KV: n_common 2122/2136/5196/5199/2667 or huge embd.
# 1829 on t1 is the system+tools prefix of a fresh chat — not old KV.
# 2667 was T20 turn-2 (embd after t1) — not a fresh chat.
old_live_kv() {
  local nc="$1" embd="$2"
  case "$nc" in
    2122|2136|2667|5196|5199) return 0 ;;
  esac
  [ -n "$embd" ] && [ "$embd" -ge 4000 ] && return 0
  return 1
}
# True if n_common did not grow vs turn 1 (still system prefix or zero).
stuck_after_t5() {
  local nc="$1" t1="$2"
  [ -z "$nc" ] && return 0
  [ "$nc" = "0" ] && return 0
  [ -n "$t1" ] && [ "$nc" -le $((t1 + 10)) ] && return 0
  return 1
}

# --- begin ---
thermal || { rlog THERMAL_ABORT; echo THERMAL > "$EVID/verdict-raw.txt"; exit 3; }
STAYON_NOW=$(adb shell settings get global stay_on_while_plugged_in </dev/null | tr -d '\r')
rlog "stay_on_before=$STAYON_NOW"
[ "$STAYON_NOW" = "0" ] || { rlog "REFUSE stayon=$STAYON_NOW (must stay 0)"; exit 2; }
rlog "battery_before=$(battery_snap)"
ACLINE=$(adb shell dumpsys battery </dev/null 2>/dev/null | tr -d '\r' | grep -E 'AC powered:|USB powered:|Wireless powered:')
rlog "plug $ACLINE"
echo "$ACLINE" | grep -q 'AC powered: true' && { rlog "REFUSE AC powered at start (unplugged required)"; echo AC_AT_START > "$EVID/turns-abort.txt"; exit 2; }
echo "$ACLINE" | grep -q 'USB powered: true' && { rlog "REFUSE USB powered at start"; echo USB_AT_START > "$EVID/turns-abort.txt"; exit 2; }
echo "utc,phase,turn,level,temp_deci,voltage_mV,current_now_uA,current_avg_uA,brightness,kalsa_pid,kalsa_cpu_pct,screen_on" > "$EVID/battery.csv"
adb shell dumpsys batterystats --reset </dev/null
rlog "batterystats reset"
batt_sample "start"
keep_awake &
WPID=$!
echo "$WPID" > "$EVID/keep_awake.pid"
rlog "keep_awake pid=$WPID interval=15s swipe+wakeup"
ensure_screen || { rlog "FAIL screen at start"; echo screen_off_start > "$EVID/turns-abort.txt"; exit 1; }

poke
adb shell am force-stop com.kalsa.app </dev/null
sleep 2
start_logcat "$EVID/logcat.txt"
poke
adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
sleep 6
ensure_screen || { rlog "FAIL screen after start"; echo screen_off_start > "$EVID/turns-abort.txt"; exit 1; }
wait_engine_or_die "$EVID/logcat.txt" "$ENGINE_WAIT" 0 0
grep 'KALSA_SESSION' "$EVID/logcat.txt" | grep '"op":"load"' | tee "$EVID/load-boot.txt" | tee -a "$RUN" || true
batt_sample "after_prewarm"

if [ "$SKIP_TOOLS" = "1" ]; then
  rlog "PHASE tools SKIP (parent-verified PASS)"
  echo SKIP > "$EVID/tools-verdict.txt"
else
  rlog "PHASE tools"
  new_chat "tools" || { rlog "FAIL new_chat tools"; echo "new_chat_tools" > "$EVID/turns-abort.txt"; exit 1; }
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
if [ "$SKIP_DOCS" = "1" ]; then
  rlog "docs SKIP (S23 library already empty / parent HARNESS_MISS)"
  echo HARNESS_MISS > "$EVID/docs-verdict.txt"
elif [ "${DOCS_N:-0}" -gt 0 ]; then
  new_chat "docs" || rlog "WARN new_chat docs"
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

rlog "PHASE turns20"
rm -f "$EVID"/turn-*-tel.txt "$EVID"/turn-*-kv.txt "$EVID"/turns-count.txt
new_chat "t20" force || { rlog "FAIL new_chat t20"; echo "new_chat_t20" > "$EVID/turns-abort.txt"; echo 0 > "$EVID/turns-count.txt"; exit 1; }
NEED_FRESH=1
if [ "$NEED_FRESH" = "1" ]; then
  rlog "fresh_engine: wait PREWARM op=done (logcat stays on logcat.txt)"
  kill "$LPID" 2>/dev/null || true
  wait "$LPID" 2>/dev/null || true
  adb shell am force-stop com.kalsa.app </dev/null
  sleep 2
  adb logcat -c </dev/null
  start_logcat "$EVID/logcat.txt" 0
  MARK_T20=$(wc -l < "$EVID/logcat.txt" | tr -d ' ')
  poke
  adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
  sleep 6
  ensure_screen || { rlog "FAIL screen after fresh_engine"; echo screen_off_t20 > "$EVID/turns-abort.txt"; echo 0 > "$EVID/turns-count.txt"; exit 1; }
  wait_engine_or_die "$EVID/logcat.txt" "$ENGINE_WAIT" "$MARK_T20" 1
  fe=$?
  if [ "$fe" -eq 4 ]; then
    rlog "retry Nuova chat after PREWARM skip"
    new_chat "t20b" force || { echo "new_chat_t20b" > "$EVID/turns-abort.txt"; echo 0 > "$EVID/turns-count.txt"; exit 1; }
    kill "$LPID" 2>/dev/null || true
    wait "$LPID" 2>/dev/null || true
    adb shell am force-stop com.kalsa.app </dev/null
    sleep 2
    adb logcat -c </dev/null
    start_logcat "$EVID/logcat.txt" 0
    MARK_T20=$(wc -l < "$EVID/logcat.txt" | tr -d ' ')
    poke
    adb shell am start -n com.kalsa.app/.MainActivity >/dev/null </dev/null
    sleep 6
    ensure_screen || { echo screen_off_t20 > "$EVID/turns-abort.txt"; echo 0 > "$EVID/turns-count.txt"; exit 1; }
    wait_engine_or_die "$EVID/logcat.txt" "$ENGINE_WAIT" "$MARK_T20" 1
    fe=$?
    if [ "$fe" -eq 4 ]; then
      rlog "FAIL still not PREWARM done"
      echo "not_fresh_prewarm" > "$EVID/turns-abort.txt"
      echo 0 > "$EVID/turns-count.txt"
      exit 1
    fi
  fi
  grep 'KALSA_SESSION' "$EVID/logcat.txt" | grep '"op":"load"' | tail -5 | tee "$EVID/load-t20.txt" | tee -a "$RUN" || true
  dump_ui_file "$EVID/ui-t20-fresh.xml" >/dev/null
  if ! python3 "$PICK" empty "$EVID/ui-t20-fresh.xml"; then
    rlog "WARN ui not empty after fresh_engine — trying new_chat again"
    new_chat "t20b" || { rlog "FAIL new_chat t20b"; echo "new_chat_t20b" > "$EVID/turns-abort.txt"; echo 0 > "$EVID/turns-count.txt"; exit 1; }
  fi
else
  rlog "skip fresh_engine (already empty and PREWARM op=done)"
fi
ensure_screen || { rlog "FAIL screen before turns"; echo screen_off_t20 > "$EVID/turns-abort.txt"; echo 0 > "$EVID/turns-count.txt"; exit 1; }
batt_sample "after_prewarm_t20"
sleep 2
: > "$EVID/turns.jsonl"
PROMPTS=()
while IFS= read -r _line || [ -n "$_line" ]; do
  [ -n "$_line" ] && PROMPTS[${#PROMPTS[@]}]="$_line"
done < "$EVID/prompts-20.txt"
n=0
T1_NC=""
cool_wait 400 90 || { rlog "THERMAL_ABORT before turns"; echo "thermal_at=0" > "$EVID/turns-abort.txt"; echo 0 > "$EVID/turns-count.txt"; exit 3; }
for msg in "${PROMPTS[@]}"; do
  [ -n "$msg" ] || continue
  n=$((n+1))
  ensure_keep_awake
  # Idle unload is ~180–240s. Cool at most 90s then CONTINUE (<43C).
  cool_wait 400 90 || { rlog "THERMAL_ABORT at turn $n"; echo "thermal_at=$n" > "$EVID/turns-abort.txt"; break; }
  rlog "turn $n msg=${msg:0:60}"
  MARK=$(wc -l < "$EVID/logcat.txt" | tr -d ' ')
  send_msg "$msg" "t$n" "$EVID/ui-turn.xml"
  src=$?
  if [ "$src" -eq 5 ]; then
    rlog "recover model after reject turn $n"
    dump_ui_file "$EVID/ui-reload.xml" >/dev/null
    inv=$(python3 "$PICK" coords "$EVID/ui-reload.xml" "Tocca per ricaricare" || true)
    if [ -n "$inv" ]; then
      read -r ix iy <<< "$inv"
      adb shell input tap "$ix" "$iy" </dev/null
      rlog "tapped Tocca per ricaricare $ix,$iy"
    fi
    MARK_R=$(wc -l < "$EVID/logcat.txt" | tr -d ' ')
    wait_engine "$EVID/logcat.txt" "$ENGINE_WAIT" "$MARK_R" 0 || true
    send_msg "$msg" "t${n}r" "$EVID/ui-turn.xml"
    src=$?
  fi
  if [ "$src" -eq 3 ]; then
    rlog "THERMAL_ABORT send turn $n"
    echo "thermal_at=$n" > "$EVID/turns-abort.txt"
    break
  elif [ "$src" -eq 4 ]; then
    rlog "SCREEN_OFF send turn $n"
    echo "screen_off_at=$n" > "$EVID/turns-abort.txt"
    break
  elif [ "$src" -ne 0 ]; then
    rlog "FAIL send turn $n src=$src"
    echo "send_fail=$n" > "$EVID/turns-abort.txt"
    break
  fi
  wait_kv_tel "$MARK" "$EVID/turn-$n-kv.txt" "$EVID/turn-$n-tel.txt" "$EVID/logcat.txt" "$TURN_WAIT"
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
  if [ "$n" -eq 1 ]; then
    T1_NC="${NC:-}"
    if old_live_kv "${NC:-}" "${EMBD:-0}"; then
      rlog "FAIL old live/tools KV n_common=$NC embd=$EMBD"
      echo "old_kv_n_common=$NC embd=$EMBD" > "$EVID/turns-abort.txt"
      break
    fi
    if [ "$CPU_IDLE_DUMPED" -eq 0 ]; then
      cpu_snapshot idle
      CPU_IDLE_DUMPED=1
      batt_sample "idle" "$n"
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
  # Let memory extract finish; sending during extract interrupts it (KV freeze).
  ex0=$(date +%s)
  while [ $(( $(date +%s) - ex0 )) -lt 25 ]; do
    if tail -n +"$((MARK+1))" "$EVID/logcat.txt" | grep KALSA_TELEMETRY | grep -q util-extractMemory; then
      rlog "extract done turn $n"
      break
    fi
    sleep 2
  done
  [ "$n" -ge 20 ] && break
done
echo "$n" > "$EVID/turns-count.txt"
rlog "turns_done=$n"
batt_sample "after_t20" "$n"
adb shell dumpsys batterystats com.kalsa.app </dev/null > "$EVID/batterystats-kalsa.txt" 2>&1 || true
python3 "$EVID/write_battery_summary.py" "$EVID" | tee "$EVID/battery-summary.txt" | tee -a "$RUN" || true
if [ -f "$EVID/turns-abort.txt" ] || [ "$n" -lt 20 ]; then
  rlog "ABORT turns n=$n $(cat "$EVID/turns-abort.txt" 2>/dev/null || echo n_lt_20)"
  python3 "$EVID/write_verdict.py" "$EVID" "$PHONE" | tee -a "$RUN" || true
  exit 1
fi

rlog "skip restore (battery 20t)"
rlog "battery_after=$(battery_snap)"
rlog "end utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 "$EVID/write_verdict.py" "$EVID" "$PHONE" | tee -a "$RUN" || true
echo DONE > "$EVID/oneshot.done"
