#!/bin/bash
# Read-only per-turn sampler for the Xiaomi 14 normal-use observation cell.
# Writes one JSON line to stdout. Touches nothing on the device: every value is
# read through adb shell dumpsys / cat on sysfs, and the serial is always
# explicit (the phone is advertised twice; the duplicate "(2)" transport is the
# one we never use).
#
# WHY the live section: `dumpsys thermalservice` prints a "Cached temperatures"
# block that was FROZEN for the whole session on this phone (identical values on
# every poll for minutes, and inconsistent with sysfs by 10 C), so the sampler
# reads the "Current temperatures from HAL" block, which tracks sysfs.
S='adb-625689a2-9xEOfw._adb-tls-connect._tcp'
TAG="$1"

BAT=$(adb -s "$S" shell dumpsys battery 2>/dev/null)
TH=$(adb -s "$S" shell dumpsys thermalservice 2>/dev/null)
ZONES=$(adb -s "$S" shell 'm=0; for z in /sys/class/thermal/thermal_zone*; do v=$(cat $z/temp 2>/dev/null); case "$v" in -*) continue;; esac; if [ "$v" -gt "$m" ]; then m=$v; fi; done; echo $m' 2>/dev/null | tr -d '\r')
UP=$(adb -s "$S" shell cat /proc/uptime 2>/dev/null | awk '{print $1}')
FOC=$(adb -s "$S" shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus)
EP=$(date +%s)

python3 - "$TAG" "$UP" "$EP" "$FOC" "$BAT" "$TH" "$ZONES" <<'PY'
import json, re, sys

tag, up, ep, foc, bat, th, zones = sys.argv[1:8]

level = re.search(r'^\s*level:\s*(\d+)', bat, re.M)
btemp = re.search(r'^\s*temperature:\s*(\d+)', bat, re.M)
bstat = re.search(r'^\s*status:\s*(\d+)', bat, re.M)
powered = bool(re.search(r'(AC|USB|Wireless|Dock) powered:\s*true', bat))

# live HAL block only (everything between the two headers)
m = re.search(r'Current temperatures from HAL:(.*?)Current cooling devices', th, re.S)
live = m.group(1) if m else ''
vals = {}
for t in re.finditer(r'Temperature\{mValue=([-\d.]+), mType=(\d+), mName=([\w_]+), mStatus=(\d+)\}', live):
    vals.setdefault(t.group(3), []).append((float(t.group(1)), int(t.group(4))))

tstat = re.search(r'Thermal Status:\s*(\d+)', th)

def hot(name):
    v = vals.get(name)
    return max(v)[0] if v else None

def status_of(name):
    v = vals.get(name)
    return max(v)[1] if v else None

def grp(prefix):
    return max((v[0] for k, vs in vals.items() if k.startswith(prefix) for v in vs), default=None)

skins = vals.get('skin', [])
skin = max(s[0] for s in skins) if skins else None
hal_batt = hot('battery')

print(json.dumps({
    "tag": tag,
    "epoch": int(ep),
    "uptime_s": float(up),
    "focus_ok": "com.kalsa.app" in (foc or ""),
    "level": int(level.group(1)) if level else None,
    "batt_deci_c": int(btemp.group(1)) if btemp else None,
    "batt_status": int(bstat.group(1)) if bstat else None,
    "powered": powered,
    "hal_batt_c": hal_batt,
    "skin_c": skin,
    "skin_status": status_of("skin"),
    "zone_max_deci_c": int(zones) if zones.isdigit() else None,
    "cpu_max_c": grp("CPU"),
    "gpu_max_c": grp("GPU"),
    "npu_max_c": grp("nsp"),
    "thermal_status": int(tstat.group(1)) if tstat else None,
    "sensors": len(vals),
}))
PY