# battery_trust.sh — detect an overridden battery sensor (QDC provisioning
# injects a battery override: AC powered true, UPDATES STOPPED, and a fixed
# stub temperature — 25.0 C on the QRD8650 units, 42.0 and 40.0 C on two
# QRD8750 units — so a >=44 C battery stop can never fire there).
# Coordinator decision 2026-09-26 (no per-board value guessing). The sensor is
# UNTRUSTED when any of these holds:
#   (a) dumpsys battery temperature != live sysfs battery/temp (setup);
#   (b) frozen across the setup samples at BATT_STUB_TENTHS (default 250, the
#       25.0 C stub; env override kept);
#   (c) dumpsys == sysfs, frozen across the setup samples, while the skin
#       differs from it by >= BATT_SKIN_GAP_C (5.0 C) at setup;
#   (d) the reading stays identical in EVERY sample (setup and every later
#       safety_stops) while the skin moves by >= BATT_FROZEN_SKIN_MOVE_C (1.0 C)
#       — this one can fire mid-session.
# The verdict only ever goes trusted -> untrusted. It and the tracking state are
# persisted to $RAW/battery_trust.txt so a DRIVER_PHASE=arms invocation of the
# same job reloads both (battery_trust_load). safety.sh ADDS a skin >= 46 C
# stop on an untrusted board; the battery >= 44 C stop stays armed (rule A5).
BATTERY_UNTRUSTED=0; BATTERY_UNTRUSTED_WHY=na
BATT_TRUST_INTERVAL_S="${BATT_TRUST_INTERVAL_S:-30}"
BATT_STUB_TENTHS="${BATT_STUB_TENTHS:-250}"
BATT_SKIN_GAP_C="${BATT_SKIN_GAP_C:-5.0}"
BATT_FROZEN_SKIN_MOVE_C="${BATT_FROZEN_SKIN_MOVE_C:-1.0}"
# Frozen tracking: first reading ("moved" once it ever changes) and the skin
# range seen while it stayed identical.
BATT_TRACK_REF=""; BATT_SKIN_MIN=""; BATT_SKIN_MAX=""; BATT_TRUST_SAMPLES=""

batt_is_num() { case "$1" in ''|*[!0-9.]*) return 1;; esac; }

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

battery_trust_persist() {
  {
    printf 'untrusted=%s\n' "$BATTERY_UNTRUSTED"
    printf 'why=%s\n' "$BATTERY_UNTRUSTED_WHY"
    printf 'track_ref=%s\n' "$BATT_TRACK_REF"
    printf 'skin_min=%s\n' "$BATT_SKIN_MIN"
    printf 'skin_max=%s\n' "$BATT_SKIN_MAX"
    printf 'samples=%s\n' "$BATT_TRUST_SAMPLES"
  } > "$RAW/battery_trust.txt"
}

battery_trust_mark() {
  BATTERY_UNTRUSTED=1; BATTERY_UNTRUSTED_WHY="$1"
  log "BATTERY_SENSOR_UNTRUSTED why=$1"
  battery_trust_persist
}

# battery_trust_track <temp_tenths> <skin_c>: returns 0 when the reading has
# been identical in every sample so far while the skin moved >= the threshold.
battery_trust_track() {
  local t="$1" k="$2"
  batt_is_num "$t" && batt_is_num "$k" || return 1
  [ "$BATT_TRACK_REF" = moved ] && return 1
  if [ -z "$BATT_TRACK_REF" ]; then
    BATT_TRACK_REF="$t"; BATT_SKIN_MIN="$k"; BATT_SKIN_MAX="$k"; return 1
  fi
  [ "$t" = "$BATT_TRACK_REF" ] || { BATT_TRACK_REF=moved; return 1; }
  BATT_SKIN_MIN=$(awk -v a="$BATT_SKIN_MIN" -v b="$k" 'BEGIN{print (b<a)?b:a}')
  BATT_SKIN_MAX=$(awk -v a="$BATT_SKIN_MAX" -v b="$k" 'BEGIN{print (b>a)?b:a}')
  awk -v a="$BATT_SKIN_MAX" -v b="$BATT_SKIN_MIN" -v m="$BATT_FROZEN_SKIN_MOVE_C" 'BEGIN{exit !(a-b >= m)}'
}

battery_trust_load() {
  [ -f "$RAW/battery_trust.txt" ] || return 0
  BATTERY_UNTRUSTED=$(sed -n 's/^untrusted=//p' "$RAW/battery_trust.txt" | tail -1)
  BATTERY_UNTRUSTED="${BATTERY_UNTRUSTED:-0}"
  BATTERY_UNTRUSTED_WHY=$(sed -n 's/^why=//p' "$RAW/battery_trust.txt" | tail -1)
  BATT_TRACK_REF=$(sed -n 's/^track_ref=//p' "$RAW/battery_trust.txt" | tail -1)
  BATT_SKIN_MIN=$(sed -n 's/^skin_min=//p' "$RAW/battery_trust.txt" | tail -1)
  BATT_SKIN_MAX=$(sed -n 's/^skin_max=//p' "$RAW/battery_trust.txt" | tail -1)
  BATT_TRUST_SAMPLES=$(sed -n 's/^samples=//p' "$RAW/battery_trust.txt" | tail -1)
  [ "$BATTERY_UNTRUSTED" = "1" ] && log "BATTERY_SENSOR_UNTRUSTED why=$BATTERY_UNTRUSTED_WHY (loaded)"
  return 0
}

battery_trust_check() {
  local s1 t1 y1 k1 s2 t2 y2 k2 why="" moved=1
  s1=$(batt_trust_sample); read -r t1 y1 k1 <<< "$s1"
  sleep "$BATT_TRUST_INTERVAL_S"
  s2=$(batt_trust_sample); read -r t2 y2 k2 <<< "$s2"
  BATT_TRUST_SAMPLES="$s1 $s2"
  case "$t1" in ''|*[!0-9]*) t1="";; esac
  case "$t2" in ''|*[!0-9]*) t2="";; esac
  battery_trust_track "$t1" "$k1"
  battery_trust_track "$t2" "$k2" && moved=0
  if [ -n "$t1" ] && [ -n "$y1" ] && [ "$t1" -ne "$y1" ] 2>/dev/null; then
    why="dumpsys_vs_sysfs_mismatch dumpsys=$t1 sysfs=$y1"
  elif [ -n "$t1" ] && [ "$t1" = "$t2" ] && [ "$t1" -eq "$BATT_STUB_TENTHS" ]; then
    why="fixed_stub temp=$t1,$t2 stub=$BATT_STUB_TENTHS"
  elif [ -n "$t1" ] && [ "$t1" = "$t2" ] && [ "$t1" = "$y1" ] && [ "$t2" = "$y2" ] && batt_is_num "$k2" \
      && awk -v t="$t2" -v k="$k2" -v g="$BATT_SKIN_GAP_C" 'BEGIN{d=k-t/10;if(d<0)d=-d;exit !(d >= g)}'; then
    why="frozen_far_from_skin temp=$t2 sysfs=$y2 skin=$k2 gap>=$BATT_SKIN_GAP_C"
  elif [ "$moved" -eq 0 ]; then
    why="frozen_while_skin_moves temp=$BATT_TRACK_REF skin=$BATT_SKIN_MIN..$BATT_SKIN_MAX"
  fi
  if [ -n "$why" ]; then
    battery_trust_mark "$why"
  else
    log "BATTERY_SENSOR_TRUSTED dumpsys=$t1,$t2 sysfs=$y1,$y2 skin=$k1->$k2"
    battery_trust_persist
  fi
}

# Per-turn re-check (safety_stops): rule (d) on the live reading. Trusted ->
# untrusted only; the tracking state is persisted every call.
battery_trust_update() {
  [ "$BATTERY_UNTRUSTED" = "1" ] && return 0
  if battery_trust_track "$LIVE_BATT_TEMP_TENTHS" "$LIVE_SKIN"; then
    battery_trust_mark "frozen_while_skin_moves temp=$BATT_TRACK_REF skin=$BATT_SKIN_MIN..$BATT_SKIN_MAX (mid-session)"
  else
    battery_trust_persist
  fi
}
