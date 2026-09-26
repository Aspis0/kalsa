#!/bin/bash
# Fake adb for qdc-heat-per-backend dry-runs: simulates one awake QRD8750 with
# a warm engine already returning canned UI/logcat. One responsibility: answer
# adb calls so d_run.sh can run end-to-end on the Mac, no device.
# Run with ADB_BIN=<this file>; state and canned dumps live in /tmp/kalsa-dry.
# Env fixtures: DRY_SKIN, DRY_THERMAL_STATUS (set empty = device reports no
# status), DRY_BATT_TEMP, DRY_BATT_LEVEL, DRY_PLUGGED; DRY_SKIN_AT=<n> +
# DRY_SKIN_AFTER=<c> makes the skin cross <c> after n thermalservice reads;
# DRY_BATT_TEMP_AT=<n> + DRY_BATT_TEMP_AFTER=<t> does the same for the
# battery temperature (tenths of C) after n battery dumps;
# DRY_TELEMETRY_DELAY_S=<s> holds telemetry/governor lines back <s> seconds
# after the prompt is typed (keeps the poll loop running mid-turn);
# DRY_PREWARM=restore serves only the KV-snapshot-restore proof, no op:done.
S=/tmp/kalsa-dry/state
mkdir -p "$S"
args="$*"
case "$args" in
  "devices") printf 'List of devices attached\ndryserial\tdevice\n'; exit 0;;
  *wait-for-device*) exit 0;;
esac
# command string is arg 4 when: -s dryserial shell "<cmd>"
cmd=""
if [ "$1" = "-s" ]; then
  if [ "$3" = "shell" ] || [ "$3" = "exec-out" ]; then cmd="$4"; fi
fi
case "$args" in
  *"getprop ro.soc.model"*) echo SM8750; exit 0;;
  *"getprop ro.product.name"*) echo sun; exit 0;;
  *"getprop ro.product.model"*) echo QRD8750; exit 0;;
  *"getprop ro.build.fingerprint"*) echo android/fake; exit 0;;
  *"getprop ro.build.type"*) echo userdebug; exit 0;;
  *"getprop ro.debuggable"*) echo 1; exit 0;;
  *"getprop persist.sys.locale"*) echo en-US; exit 0;;
  *"MemTotal:"*) echo "MemTotal:       16293452 kB"; exit 0;;
  *"shell id"*) echo "uid=0(root) gid=0(root)"; exit 0;;
  *"settings get system screen_off_timeout"*) echo 60000; exit 0;;
  *"pm list packages"*) echo 0; echo "list_rc=1"; exit 0;;
  *"dumpsys package"*) echo "    pkgFlags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]"; exit 0;;
  *"dumpsys power"*) echo "  mWakefulness=Awake"; echo "  mStayOn=false"; exit 0;;
  *"dumpsys activity activities"*) echo "    topResumedActivity=ActivityRecord{71f750a u0 com.kalsa.app/.MainActivity t8}"; exit 0;;
  *"dumpsys thermalservice"*)
    skin="${DRY_SKIN:-35.0}"
    if [ -n "${DRY_SKIN_AT:-}" ]; then
      n=$(cat "$S/therm_calls" 2>/dev/null || echo 0); n=$((n + 1))
      printf '%s' "$n" > "$S/therm_calls"
      [ "$n" -gt "$DRY_SKIN_AT" ] && skin="${DRY_SKIN_AFTER:-44.5}"
    fi
    printf 'Current temperatures from HAL:\n  Temperature{mValue=%s, mType=3, mName=skin, mStatus=0}\n  Temperature{mValue=41.0, mType=2, mName=cpu, mStatus=0}\nCurrent cooling devices from HAL:\nThermal Status: %s\n' "$skin" "${DRY_THERMAL_STATUS-0}"; exit 0;;
  *"pidof com.kalsa.app"*) echo 4242; exit 0;;
  *"date +%s"*) date +%s; exit 0;;
  *"date '+%m-%d %H:%M:%S.000'"*) date '+%m-%d %H:%M:%S.000'; exit 0;;
  *"test -f databases/RKStorage-wal"*) exit 1;;
  *"test -f databases/RKStorage-shm"*) exit 1;;
  *"test -f databases/RKStorage"*) exit 0;;
  *"cat databases/RKStorage"*)
    # Real sqlite DB so restore.sh/set_prefs can edit it locally: seeded with
    # one kalsa.bench.* row so the DELETE has something to clear.
    if [ ! -f /tmp/kalsa-dry/RKStorage ]; then
      /usr/bin/sqlite3 /tmp/kalsa-dry/RKStorage "CREATE TABLE catalystLocalStorage (key TEXT, value TEXT); INSERT INTO catalystLocalStorage VALUES ('kalsa.bench.sampling','greedy');"
    fi
    cat /tmp/kalsa-dry/RKStorage; exit 0;;
  *"power_supply/battery/temp"*) printf '%s\n' "${DRY_SYSFS_BATT:-${DRY_BATT_TEMP:-300}}"; exit 0;;
  *"sha256sum /data/local/tmp/kalsa-heat/"*)
    f=$(printf '%s' "$args" | sed -n 's|.*sha256sum /data/local/tmp/kalsa-heat/\([^ ]*\).*|\1|p')
    case "$f" in
      LFM2.5-2.6B-QAD-Q4_0.gguf) echo "a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03  /data/local/tmp/kalsa-heat/$f";;
      Qwen3.5-4B-Q4_K_M.gguf) echo "3874209241c9a397e2f62cd3f70f80fd2dfbf0dfccb6838416bdb48a714e8630  /data/local/tmp/kalsa-heat/$f";;
    esac; exit 0;;
  *"stat -c %s files/models/"*)
    case "$args" in
      *lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf*) echo 1593894944;;
      *qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf*) echo 2834975040;;
      *qwen3.5-4b/mmproj-F16.gguf*) echo 672423616;;
    esac; exit 0;;
  *"logcat -b all -c"*) exit 0;;
  *"dumpsys battery"*)
    bt="${DRY_BATT_TEMP:-300}"
    if [ -n "${DRY_BATT_TEMP_AT:-}" ]; then
      n=$(cat "$S/batt_calls" 2>/dev/null || echo 0); n=$((n + 1))
      printf '%s' "$n" > "$S/batt_calls"
      [ "$n" -gt "$DRY_BATT_TEMP_AT" ] && bt="${DRY_BATT_TEMP_AFTER:-445}"
    fi
    printf 'Current Battery Service state:\n  AC powered: %s\n  temperature: %s\n  level: %s\n' "${DRY_PLUGGED:-false}" "$bt" "${DRY_BATT_LEVEL:-100}"; exit 0;;
  *"logcat -v epoch -d -b all"*)
    now=$(date +%s)
    tl=$(wc -c < "$S/typed" 2>/dev/null || echo 0)
    if [ "$tl" -gt 1000 ]; then
      if [ "$(cat "$S/last_route" 2>/dev/null)" = "gpu" ]; then src=/tmp/kalsa-dry/logcat-gpu.txt; else src=/tmp/kalsa-dry/logcat-cpu.txt; fi
    else
      src=/tmp/kalsa-dry/logcat-cal.txt
    fi
    # Real captured logs carry fractional epochs (1790398102.499) and some
    # leading whitespace; normalize both so every line lands at/after the
    # fresh logcat anchor (last_json_after drops lines older than it).
    sed "s/^[[:space:]]*1[0-9]\{9\}\.[0-9]\{3\} /$now /; s/^[[:space:]]*1[0-9]\{9\} /$now /" "$src" > "$S/.logcat.out"
    [ "${DRY_PREWARM:-}" = "restore" ] && sed 's/"op":"done"/"op":"restore","ok":true/' "$S/.logcat.out" > "$S/.logcat.out.2" && mv "$S/.logcat.out.2" "$S/.logcat.out"
    if [ -n "${DRY_TELEMETRY_DELAY_S:-}" ] && [ -f "$S/tel_ready_at" ] && [ "$now" -lt "$(cat "$S/tel_ready_at")" ]; then
      # The turn is still generating: telemetry/governor lines do not exist yet.
      grep -v 'KALSA_TELEMETRY\|KALSA_GOVERNOR ' "$S/.logcat.out"
    else
      cat "$S/.logcat.out"
    fi
    rm -f "$S/.logcat.out" "$S/.logcat.out.2"
    exit 0;;
  *"uiautomator dump"*) exit 0;;
  *"cat /data/local/tmp/kalsa-heat/ui.xml"*)
    typed=$(cat "$S/typed" 2>/dev/null)
    esc=$(printf '%s' "$typed" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g')
    if [ -f "$S/drawer" ]; then
      cat <<XML
<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0">
<node index="0" package="com.kalsa.app" class="android.widget.FrameLayout" bounds="[0,0][1080,2400]">
<node index="1" package="com.kalsa.app" content-desc="New chat" class="android.widget.TextView" text="New chat" bounds="[48,252][1032,408]"/>
<node index="2" package="com.kalsa.app" content-desc="Your chats" class="android.widget.TextView" text="Your chats" bounds="[48,500][1032,600]"/>
</node></hierarchy>
XML
    else
      cat <<XML
<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0">
<node index="0" package="com.kalsa.app" class="android.widget.FrameLayout" bounds="[0,0][1080,2400]">
<node index="1" package="com.kalsa.app" content-desc="Open menu" class="android.widget.ImageButton" text="" bounds="[48,84][192,228]"/>
<node index="2" package="com.kalsa.app" content-desc="Model and where it runs: LFM2.5 2.6B, On this phone" class="android.widget.TextView" text="LFM2.5 2.6B" bounds="[200,84][880,228]"/>
<node index="3" package="com.kalsa.app" class="android.widget.EditText" text="$esc" bounds="[231,2049][693,2211]"/>
<node index="4" package="com.kalsa.app" content-desc="Send" class="android.widget.Button" text="" bounds="[873,2070][1017,2190]"/>
</node></hierarchy>
XML
    fi
    exit 0;;
  *"input text "*)
    raw="$cmd"
    inner=$(printf '%s' "$raw" | sed -n "s/^input text '\(.*\)'\$/\1/p")
    [ -z "$inner" ] && inner=$(printf '%s' "$raw" | sed 's/^input text //')
    dec=$(printf '%s' "$inner" | sed "s/%s/ /g; s/'\\\\''/'/g")
    printf '%s' "$dec" >> "$S/typed"
    case "$dec" in "bench:route "*) printf '%s' "$dec" | awk '{print $2}' > "$S/last_route";; esac
    if [ -n "${DRY_TELEMETRY_DELAY_S:-}" ] && [ ! -f "$S/tel_ready_at" ]; then
      tl=$(wc -c < "$S/typed")
      [ "$tl" -gt 1000 ] && printf '%s' "$(( $(date +%s) + DRY_TELEMETRY_DELAY_S ))" > "$S/tel_ready_at"
    fi
    exit 0;;
  *"input keycombination"*) : > "$S/typed"; exit 0;;
  *"input keyevent 67"*) : > "$S/typed"; exit 0;;
  *"input tap "*)
    x=$(printf '%s' "$args" | awk '{print $(NF-1)}'); y=$(printf '%s' "$args" | awk '{print $NF}')
    if [ -f "$S/drawer" ] && [ "$y" -ge 250 ] 2>/dev/null && [ "$y" -le 410 ] 2>/dev/null; then
      rm -f "$S/drawer"; : > "$S/typed"
    elif [ "$x" -lt 250 ] 2>/dev/null && [ "$y" -lt 250 ] 2>/dev/null; then
      : > "$S/drawer"
    fi
    exit 0;;
  *"install -r"*) echo Success; exit 0;;
  *"push "*) echo "pushed (dry)"; exit 0;;
  # Real-board behavior the 2026-09-26 restores hit: the app uid (run-as)
  # cannot unlink from the shell-owned heat/ dir, so the old restore chain
  # (cp ... && rm -f databases/... && rm -f $remote) failed AFTER a successful
  # cp. Only the run-as-wrapped remote rm fails; a shell-uid rm (no run-as in
  # the args) succeeds via the generic case below.
  *"run-as"*"rm -f /data/local/tmp/kalsa-heat/heat/rkstorage-restore-"*)
    printf 'rm: cannot remove %s: Permission denied\n' "/data/local/tmp/kalsa-heat/heat/rkstorage-restore-<pid>" >&2
    exit 1;;
esac
# generic success for the remaining shell/puts (chmod, mkdir, rm, cp, settings put, svc, am, locksettings, sh -c, wm, get-state)
exit 0
