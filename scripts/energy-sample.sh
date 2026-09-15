#!/usr/bin/env sh
# Energy/power sampler that runs ON the device (pushed via adb, executed with
# sh). Samples battery current/voltage, per-CPU clocks and the battery temp
# into a CSV at a fixed cadence. The host aggregates afterwards.
#
# Design notes (from AOSP "Measure device power" + ML.ENERGY/EnerInfer):
# - fuel-gauge current_now is smoothed by the gauge IC and its sign/unit
#   convention varies per vendor; we store RAW values and calibrate on the
#   host side, per device. Relative comparisons between arms are the goal.
# - battery temperature (power_supply/battery/temp) updates slowly and in
#   coarse steps (observed: pinned at 38.0C while tok/s swung 2x) - so we also
#   sample every cpufreq scaling_cur_freq, which reacts instantly and is the
#   actual throttle signal.
# - timestamps come from /proc/uptime (float seconds), portable on toybox.
#
# usage: sh energy-sample.sh OUT.csv STOPFILE [INTERVAL_S]
#   writes CSV until STOPFILE exists; parent kills by creating it.

OUT="$1"
STOP="$2"
IV="${3:-1}"

PS=/sys/class/power_supply/battery

# build the cpu freq glob list once (cpu0..cpuN as present)
CPUS=""
for c in /sys/devices/system/cpu/cpu[0-9]*; do
  [ -f "$c/cpufreq/scaling_cur_freq" ] && CPUS="$CPUS $c/cpufreq/scaling_cur_freq"
done

# optional cpu thermal zones (names vary per SoC; keep whatever exists)
ZONES=""
for z in /sys/class/thermal/thermal_zone*; do
  t=$(cat "$z/type" 2>/dev/null)
  case "$t" in
    *cpu*|*apc*|*soc*) ZONES="$ZONES $z" ;;
  esac
done

{
  echo "t_s,current_uA,voltage_uV,batt_temp_deciC,cpu_freqs_kHz,zones_temp_deciC"
  while [ ! -f "$STOP" ]; do
    t=$(cut -d' ' -f1 /proc/uptime)
    i=$(cat $PS/current_now 2>/dev/null)
    v=$(cat $PS/voltage_now 2>/dev/null)
    bt=$(cat $PS/temp 2>/dev/null)
    f=""
    for c in $CPUS; do f="$f:$(cat $c 2>/dev/null)"; done
    z=""
    for zn in $ZONES; do z="$z:$(cat $zn/temp 2>/dev/null)"; done
    echo "$t,${i:-},${v:-},${bt:-},${f#:},${z#:}"
    sleep "$IV"
  done
} > "$OUT" 2>/dev/null
