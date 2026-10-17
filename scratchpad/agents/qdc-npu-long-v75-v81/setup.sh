#!/usr/bin/env bash
# usage: BOARD=x setup.sh — recon, install debuggable APK, sideload model, first launch (creates DB), set model id.
set -u; . "$(dirname "$0")/env.sh"; L() { echo "[$(date +%H:%M:%S)] $*"; }
L "serial=$SER board=$BOARD"
[ "$(shasum -a 256 "$APK" | awk '{print $1}')" = "$APK_SHA" ] || { L "APK SHA MISMATCH"; exit 4; }
ad root >/dev/null 2>&1; sleep 3; ADT=60 ad wait-for-device
{ echo "serial=$SER"; for p in ro.soc.model ro.soc.manufacturer ro.product.model ro.product.device ro.build.version.release ro.build.version.sdk ro.build.fingerprint ro.hardware.chipname ro.board.platform; do echo "$p=$(ad shell getprop $p | tr -d '\r')"; done
  echo "id: $(ad shell id | tr -d '\r')"; ad shell "grep -E 'MemTotal|MemAvailable|MemFree' /proc/meminfo" | tr -d '\r'
  echo "--- battery"; ad shell dumpsys battery | tr -d '\r' | grep -E "^  (AC|USB|Wireless) powered|^  status|^  level|^  temperature"
  echo "--- cpu"; ad shell "grep -c ^processor /proc/cpuinfo; grep -m1 -i 'Hardware' /proc/cpuinfo; for c in /sys/devices/system/cpu/cpu[0-9]*; do echo \$(basename \$c) \$(cat \$c/cpufreq/cpuinfo_max_freq 2>/dev/null); done" | tr -d '\r'
  echo "--- hexagon"; ad shell "ls /vendor/lib/rfsa/adsp /vendor/lib64/rfsa/adsp 2>/dev/null | head -40; ls /vendor/etc/cdsp /vendor/lib/rfsa/dsp 2>/dev/null | head; ls /dev | grep -iE 'adsprpc|cdsp|fastrpc'" | tr -d '\r'
  echo "--- screen"; ad shell "wm size; wm density; settings get system screen_off_timeout; dumpsys power | grep -E 'mWakefulness=|mStayOn'" | tr -d '\r'
  echo "--- skin/thermal"; ad shell dumpsys thermalservice | tr -d '\r' | grep -iE "Thermal Status|mName=skin|mName=bat" | head -6
} > $OUT/recon.txt 2>&1
cat $OUT/recon.txt | head -60
bash "$(dirname "$0")/skin-id.sh" || { L "SKIN ID FAILED: no live skin entry"; exit 6; }
L "install"; ADT=600 ad install -r -d "$APK" > $OUT/install.txt 2>&1; cat $OUT/install.txt | tail -2
ad shell "dumpsys package $APP | grep -E 'versionName|versionCode|lastUpdateTime|pkgFlags|flags=' | head -6" | tr -d '\r' > $OUT/pkg.txt; cat $OUT/pkg.txt
ad shell "run-as $APP id" 2>&1 | tr -d '\r' > $OUT/runas.txt; echo "run-as: $(cat $OUT/runas.txt)"
UID_=$(ad shell stat -c %u /data/data/$APP | tr -d '\r'); L "uid=$UID_"
ad shell "mkdir -p /data/local/tmp/kg"
dsha=$(ADT=300 ad shell "sha256sum /data/local/tmp/kg/$MODEL_FILE 2>/dev/null" | awk '{print $1}' | tr -d '\r')
if [ "$dsha" != "$MODEL_SHA" ]; then L "push model"; ADT=3600 ad push "$MODEL" /data/local/tmp/kg/$MODEL_FILE 2>&1 | tail -1; dsha=$(ADT=300 ad shell "sha256sum /data/local/tmp/kg/$MODEL_FILE" | awk '{print $1}' | tr -d '\r'); fi
[ "$dsha" = "$MODEL_SHA" ] && L "device model sha OK" || { L "MODEL SHA MISMATCH $dsha"; exit 5; }
ad shell "mkdir -p /data/data/$APP/files/models/$MODEL_DIR && cp /data/local/tmp/kg/$MODEL_FILE /data/data/$APP/files/models/$MODEL_DIR/$MODEL_FILE && chown -R $UID_:$UID_ /data/data/$APP/files && restorecon -RF /data/data/$APP/files && rm -f /data/local/tmp/kg/$MODEL_FILE"
L "model size on app dir: $(ad shell stat -c %s /data/data/$APP/files/models/$MODEL_DIR/$MODEL_FILE | tr -d '\r') want $MODEL_SIZE"
ad shell "input keyevent 224; wm dismiss-keyguard; svc power stayon true; settings put system screen_off_timeout 1800000"; sleep 1
# QDC reports AC powered + a fixed battery temp; the governor's thermo profile is invalid while plugged. Fake unplugged at 30.0 C, read back.
ad shell "dumpsys battery unplug; dumpsys battery set temp 300" >/dev/null 2>&1
ad shell dumpsys battery | tr -d '\r' | grep -E "^  (AC|USB|Wireless) powered|^  temperature" | tee $OUT/battery-faked.txt
grep -q "temperature: 300" $OUT/battery-faked.txt && grep -q "AC powered: false" $OUT/battery-faked.txt && L "battery faked unplugged 30.0 C" || { L "BATTERY FAKE FAILED"; exit 9; }
ad shell "am start -n $APP/.MainActivity" >/dev/null; sleep 30; ad shell am force-stop $APP; sleep 2
ad shell "test -f /data/data/$APP/databases/RKStorage" && L "DB created" || L "NO DB"
bash "$(dirname "$0")/kset.sh" kalsa.model.id $MODEL_DIR