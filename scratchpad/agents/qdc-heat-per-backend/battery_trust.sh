# battery_trust.sh — detect an overridden battery sensor at setup (Problem 4,
# 2026-09-26 run: QDC provisioning injects a battery override — AC powered
# true, UPDATES STOPPED, and a fixed 25.0 C stub temperature — so the >=44 C
# battery stop can never fire on those boards).
# Two independent detections, either one flags the board:
#   (a) dumpsys battery temperature vs live sysfs
#       (/sys/class/power_supply/battery/temp) when sysfs is readable;
#   (b) the dumpsys reading frozen across two samples BATT_TRUST_INTERVAL_S
#       apart, either at exactly the documented 25.0 C stub or while the skin
#       sensor moves >= 0.3 C between the same two samples.
# The verdict is written to $RAW/battery_trust.txt so a DRIVER_PHASE=arms
# invocation of the same job reloads it (battery_trust_load); safety.sh turns
# an untrusted verdict into a skin-based stop at 46 C for that board only.
BATTERY_UNTRUSTED=0; BATTERY_UNTRUSTED_WHY=na
BATT_TRUST_INTERVAL_S="${BATT_TRUST_INTERVAL_S:-30}"
BATT_STUB_TENTHS="${BATT_STUB_TENTHS:-250}"  # 25.0 C, the constant stub observed on both QRD8650 units

batt_trust_sample() {
  local dump t sysfs skin
  dump=$(adbT 60 -s "$SER" shell dumpsys battery 2>/dev/null)
  t=$(printf '%s\n' "$dump" | sed -n 's/^ *temperature: *\([0-9][0-9]*\).*/\1/p' | head -1 | tr -d '\r')
  sysfs=$(adbT 60 -s "$SER" shell "cat /sys/class/power_supply/battery/temp 2>/dev/null" | head -1 | tr -d '\r[:space:]')
  skin=$(adbT 60 -s "$SER" shell dumpsys thermalservice 2>/dev/null \
    | awk '/Current temperatures from HAL/{f=1} f{print} /Current cooling devices from HAL/{f=0}' \
    | sed -n 's/.*mValue=\([0-9.]*\), mType=3, mName=[sS][kK][iI][nN].*/\1/p' | head -1 | tr -d '\r')
  printf '%s %s %s\n' "${t:-na}" "${sysfs:-na}" "${skin:-na}"
}

battery_trust_load() {
  [ -f "$RAW/battery_trust.txt" ] || return 0
  BATTERY_UNTRUSTED=$(sed -n 's/^untrusted=//p' "$RAW/battery_trust.txt" | tail -1)
  BATTERY_UNTRUSTED="${BATTERY_UNTRUSTED:-0}"
  if [ "$BATTERY_UNTRUSTED" = "1" ]; then
    BATTERY_UNTRUSTED_WHY=$(sed -n 's/^why=//p' "$RAW/battery_trust.txt" | tail -1)
    log "BATTERY_SENSOR_UNTRUSTED why=$BATTERY_UNTRUSTED_WHY (loaded from the setup detection)"
  fi
}

battery_trust_check() {
  local s1 t1 y1 k1 s2 t2 y2 k2 why="" delta
  s1=$(batt_trust_sample); read -r t1 y1 k1 <<< "$s1"
  sleep "$BATT_TRUST_INTERVAL_S"
  s2=$(batt_trust_sample); read -r t2 y2 k2 <<< "$s2"
  case "$t1" in ''|*[!0-9]*) t1="";; esac
  case "$t2" in ''|*[!0-9]*) t2="";; esac
  if [ -n "$t1" ] && [ -n "$y1" ] && [ "$t1" -ne "$y1" ] 2>/dev/null; then
    why="dumpsys_vs_sysfs_mismatch dumpsys=$t1 sysfs=$y1"
  elif [ -n "$t1" ] && [ "$t1" = "$t2" ]; then
    delta=""
    case "$k1" in ''|*[!0-9.]*) ;; *) case "$k2" in ''|*[!0-9.]*) ;; *) delta=$(awk -v a="$k1" -v b="$k2" 'BEGIN{d=a-b;if(d<0)d=-d;printf "%.3f",d}');; esac;; esac
    if [ "$t1" -eq "$BATT_STUB_TENTHS" ]; then
      why="fixed_25.0C_stub temp=$t1,$t2 skin=$k1->$k2"
    elif [ -n "$delta" ] && awk -v d="$delta" 'BEGIN{exit !(d >= 0.3)}'; then
      why="frozen_reading temp=$t1,$t2 skin_delta=$delta"
    fi
  fi
  if [ -n "$why" ]; then
    BATTERY_UNTRUSTED=1; BATTERY_UNTRUSTED_WHY="$why"
    log "BATTERY_SENSOR_UNTRUSTED why=$why"
  else
    BATTERY_UNTRUSTED=0; BATTERY_UNTRUSTED_WHY=na
    log "BATTERY_SENSOR_TRUSTED dumpsys=$t1,$t2 sysfs=$y1 skin=$k1->$k2"
  fi
  {
    printf 'untrusted=%s\n' "$BATTERY_UNTRUSTED"
    printf 'why=%s\n' "$BATTERY_UNTRUSTED_WHY"
    printf 'samples=%s %s\n' "$s1" "$s2"
  } > "$RAW/battery_trust.txt"
}
