#!/usr/bin/env bash
# S23 screen poke only. Never stayon. Never 86400000. Never settings. Never force-stop.
export ANDROID_SERIAL=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
case "$ANDROID_SERIAL" in
  192.168.1.193*|houji*|23127PN0CG*|192.168.1.82*|Jelly*) echo refused_other_phone >&2; exit 2 ;;
esac
while true; do
  adb -s "$ANDROID_SERIAL" shell input keyevent KEYCODE_WAKEUP </dev/null 2>/dev/null || true
  adb -s "$ANDROID_SERIAL" shell cmd statusbar collapse </dev/null 2>/dev/null || true
  adb -s "$ANDROID_SERIAL" shell input swipe 5 5 6 6 50 </dev/null 2>/dev/null || true
  sleep 12
done
