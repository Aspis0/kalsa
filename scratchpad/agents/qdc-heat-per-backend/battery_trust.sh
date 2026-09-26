# battery_trust.sh — detect an overridden battery sensor. LOGGING ONLY on QDC:
# coordinator decision 2026-09-26 (after audit f2ee97f4) makes every QDC board
# untrusted by default in safety.sh (skin >= 46 C always armed there), so this
# verdict can never disarm anything. On local phones an untrusted verdict ADDS
# the skin stop; the battery >= 44 C stop is always armed (rule A5).
# Rules (any one flags the sensor; numeric, jitter-tolerant — audit A1):
#   (a) dumpsys battery temperature != live sysfs battery/temp (setup);
#   (b) reading equal to BATT_STUB_TENTHS (default 250, the 25.0 C stub), at
#       setup and every turn;
#   (c) dumpsys == sysfs, battery range <= BATT_FROZEN_TOL_TENTHS across the
#       setup samples, skin >= BATT_SKIN_GAP_C (5.0 C) away from it at setup;
#   (d) battery range over EVERY sample (setup + every safety_stops) stays
#       <= BATT_FROZEN_TOL_TENTHS (0.3 C) while the skin range reaches
#       BATT_FROZEN_SKIN_MOVE_C (1.0 C) — can fire mid-session.
# The verdict only ever goes trusted -> untrusted; it is persisted (tmp + mv)
# with the tracking state and reloaded by any later invocation of the job.
BATTERY_UNTRUSTED=0; BATTERY_UNTRUSTED_WHY=na
BATT_TRUST_INTERVAL_S="${BATT_TRUST_INTERVAL_S:-30}"
BATT_STUB_TENTHS="${BATT_STUB_TENTHS:-250}"
BATT_SKIN_GAP_C="${BATT_SKIN_GAP_C:-5.0}"
BATT_FROZEN_SKIN_MOVE_C="${BATT_FROZEN_SKIN_MOVE_C:-1.0}"
BATT_FROZEN_TOL_TENTHS="${BATT_FROZEN_TOL_TENTHS:-3}"
# Ranges seen over all samples so far (battery in tenths, skin in C).
BATT_MIN=""; BATT_MAX=""; BATT_SKIN_MIN=""; BATT_SKIN_MAX=""; BATT_TRUST_SAMPLES=""

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
  local tmp="$RAW/battery_trust.txt.tmp"
  {
    printf 'untrusted=%s\n' "$BATTERY_UNTRUSTED"
    printf 'why=%s\n' "$BATTERY_UNTRUSTED_WHY"
    printf 'batt_min=%s\nbatt_max=%s\n' "$BATT_MIN" "$BATT_MAX"
    printf 'skin_min=%s\nskin_max=%s\n' "$BATT_SKIN_MIN" "$BATT_SKIN_MAX"
    printf 'samples=%s\n' "$BATT_TRUST_SAMPLES"
  } > "$tmp" && mv "$tmp" "$RAW/battery_trust.txt"
}

battery_trust_mark() {
  BATTERY_UNTRUSTED=1; BATTERY_UNTRUSTED_WHY="$1"
  log "BATTERY_SENSOR_UNTRUSTED why=$1"
  battery_trust_persist
}

# battery_trust_track <temp_tenths> <skin_c>: widen the ranges; returns 0 when
# the battery has stayed within tolerance over every sample while the skin
# range reached the move threshold (rule d). No latch: ranges only grow.
battery_trust_track() {
  local t="$1" k="$2"
  batt_is_num "$t" && batt_is_num "$k" || return 1
  if [ -z "$BATT_MIN" ]; then BATT_MIN="$t"; BATT_MAX="$t"; BATT_SKIN_MIN="$k"; BATT_SKIN_MAX="$k"; return 1; fi
  BATT_MIN=$(awk -v a="$BATT_MIN" -v b="$t" 'BEGIN{print (b<a)?b:a}')
  BATT_MAX=$(awk -v a="$BATT_MAX" -v b="$t" 'BEGIN{print (b>a)?b:a}')
  BATT_SKIN_MIN=$(awk -v a="$BATT_SKIN_MIN" -v b="$k" 'BEGIN{print (b<a)?b:a}')
  BATT_SKIN_MAX=$(awk -v a="$BATT_SKIN_MAX" -v b="$k" 'BEGIN{print (b>a)?b:a}')
  battery_frozen && awk -v a="$BATT_SKIN_MAX" -v b="$BATT_SKIN_MIN" -v m="$BATT_FROZEN_SKIN_MOVE_C" 'BEGIN{exit !(a-b >= m)}'
}
battery_frozen() { awk -v a="$BATT_MAX" -v b="$BATT_MIN" -v tol="$BATT_FROZEN_TOL_TENTHS" 'BEGIN{exit !(a-b <= tol)}'; }
batt_is_stub() { awk -v t="$1" -v s="$BATT_STUB_TENTHS" 'BEGIN{exit !(t+0 == s+0)}'; }

battery_trust_load() {
  local f="$RAW/battery_trust.txt"
  [ -f "$f" ] || return 0
  BATTERY_UNTRUSTED=$(sed -n 's/^untrusted=//p' "$f" | tail -1); BATTERY_UNTRUSTED="${BATTERY_UNTRUSTED:-0}"
  BATTERY_UNTRUSTED_WHY=$(sed -n 's/^why=//p' "$f" | tail -1)
  BATT_MIN=$(sed -n 's/^batt_min=//p' "$f" | tail -1); BATT_MAX=$(sed -n 's/^batt_max=//p' "$f" | tail -1)
  BATT_SKIN_MIN=$(sed -n 's/^skin_min=//p' "$f" | tail -1); BATT_SKIN_MAX=$(sed -n 's/^skin_max=//p' "$f" | tail -1)
  BATT_TRUST_SAMPLES=$(sed -n 's/^samples=//p' "$f" | tail -1)
  [ "$BATTERY_UNTRUSTED" = "1" ] && log "BATTERY_SENSOR_UNTRUSTED why=$BATTERY_UNTRUSTED_WHY (loaded)"
  return 0
}

battery_trust_check() {
  local s1 t1 y1 k1 s2 t2 y2 k2 why="" moved=1
  # A retry of the same job never downgrades a stored verdict (audit A3).
  battery_trust_load
  s1=$(batt_trust_sample); read -r t1 y1 k1 <<< "$s1"
  sleep "$BATT_TRUST_INTERVAL_S"
  s2=$(batt_trust_sample); read -r t2 y2 k2 <<< "$s2"
  BATT_TRUST_SAMPLES="$s1 $s2"
  battery_trust_track "$t1" "$k1"
  battery_trust_track "$t2" "$k2" && moved=0
  if batt_is_num "$t1" && batt_is_num "$y1" && ! awk -v a="$t1" -v b="$y1" 'BEGIN{exit !(a+0 == b+0)}'; then
    why="dumpsys_vs_sysfs_mismatch dumpsys=$t1 sysfs=$y1"
  elif batt_is_num "$t1" && batt_is_stub "$t1" && batt_is_stub "$t2"; then
    why="fixed_stub temp=$t1,$t2 stub=$BATT_STUB_TENTHS"
  elif batt_is_num "$t2" && batt_is_num "$y2" && awk -v a="$t2" -v b="$y2" 'BEGIN{exit !(a+0 == b+0)}' && battery_frozen && batt_is_num "$k2" \
      && awk -v t="$t2" -v k="$k2" -v g="$BATT_SKIN_GAP_C" 'BEGIN{d=k-t/10;if(d<0)d=-d;exit !(d >= g)}'; then
    why="frozen_far_from_skin temp=$t1,$t2 sysfs=$y1,$y2 skin=$k2 gap>=$BATT_SKIN_GAP_C"
  elif [ "$moved" -eq 0 ]; then
    why="frozen_while_skin_moves temp=$BATT_MIN..$BATT_MAX skin=$BATT_SKIN_MIN..$BATT_SKIN_MAX"
  fi
  if [ "$BATTERY_UNTRUSTED" = "1" ]; then
    log "BATTERY_SENSOR_UNTRUSTED why=$BATTERY_UNTRUSTED_WHY (kept from an earlier run of this job)"
    battery_trust_persist
  elif [ -n "$why" ]; then
    battery_trust_mark "$why"
  else
    log "BATTERY_SENSOR_TRUSTED dumpsys=$t1,$t2 sysfs=$y1,$y2 skin=$k1->$k2"
    battery_trust_persist
  fi
}

# Per-turn re-check (safety_stops): rules (b) and (d) on the live reading.
battery_trust_update() {
  [ "$BATTERY_UNTRUSTED" = "1" ] && return 0
  if batt_is_num "$LIVE_BATT_TEMP_TENTHS" && batt_is_stub "$LIVE_BATT_TEMP_TENTHS"; then
    battery_trust_mark "fixed_stub temp=$LIVE_BATT_TEMP_TENTHS stub=$BATT_STUB_TENTHS (mid-session)"
  elif battery_trust_track "$LIVE_BATT_TEMP_TENTHS" "$LIVE_SKIN"; then
    battery_trust_mark "frozen_while_skin_moves temp=$BATT_MIN..$BATT_MAX skin=$BATT_SKIN_MIN..$BATT_SKIN_MAX (mid-session)"
  else
    battery_trust_persist
  fi
}
