# battery_trust.sh — detect an overridden battery sensor at setup. One
# responsibility: produce the BATTERY_UNTRUSTED verdict the stop library keys
# its skin >= 46 C addition on.
#
# Provenance (copied, not sourced): ../qdc-heat-per-backend/battery_trust.sh
# lines 18-27 (batt_trust_sample) and 39-69 (battery_trust_check; its
# battery_trust_load :29-37 is dropped — this driver is one invocation and
# never reloads a verdict). Copied because audit f2ee97f4 A5 requires changing
# detection (a) — the mismatch test — and that cell runs LIVE on QDC, frozen
# to edits here (its owner applies the same fix later).
#
# A5 delta: dumpsys-vs-sysfs mismatch must be CONCORDANT on TWO samples
# (mismatch at t1 AND at t2) before the board is flagged; a single mismatch
# is transient (sysfs read tearing, scaling) and must not flag. The two
# documented branch conditions (the fixed 25.0 C stub, and a frozen dumpsys
# reading while skin moves >= 0.3 C) are unchanged from the source.
#
# Deps provided by the caller: adbT, log, RAW, SER, BATT_TRUST_INTERVAL_S
# (env, default 30 below).
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

battery_trust_check() {
  local s1 t1 y1 k1 s2 t2 y2 k2 why="" delta
  s1=$(batt_trust_sample); read -r t1 y1 k1 <<< "$s1"
  sleep "$BATT_TRUST_INTERVAL_S"
  s2=$(batt_trust_sample); read -r t2 y2 k2 <<< "$s2"
  case "$t1" in ''|*[!0-9]*) t1="";; esac
  case "$t2" in ''|*[!0-9]*) t2="";; esac
  case "$y1" in ''|*[!0-9]*) y1="";; esac
  case "$y2" in ''|*[!0-9]*) y2="";; esac
  # A5: TWO concordant mismatch samples, never one.
  if [ -n "$t1" ] && [ -n "$y1" ] && [ -n "$t2" ] && [ -n "$y2" ] \
     && [ "$t1" -ne "$y1" ] && [ "$t2" -ne "$y2" ]; then
    why="dumpsys_vs_sysfs_mismatch_twice dumpsys=$t1,$t2 sysfs=$y1,$y2"
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
    log "BATTERY_SENSOR_TRUSTED dumpsys=$t1,$t2 sysfs=$y1,$y2"
  fi
  {
    printf 'untrusted=%s\n' "$BATTERY_UNTRUSTED"
    printf 'why=%s\n' "$BATTERY_UNTRUSTED_WHY"
    printf 'samples=%s %s\n' "$s1" "$s2"
  } > "$RAW/battery_trust.txt"
}
