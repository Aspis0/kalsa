#!/usr/bin/env sh
# Energy/power sampler that runs ON the device (pushed via adb, executed with
# sh). Samples battery current/voltage/status, per-CPU clocks and battery temp
# into a CSV at a fixed cadence until a stopfile appears, an iteration cap is
# hit, or the sampler is killed via its pidfile.
#
# Audit fixes (deepseek-v4.1 audit of c5fae2f, 2026-09-15):
# - the sample body uses the read builtin instead of $(cat): 12 forks per
#   sample cost ~0.28s CPU (~28% of one core on the SoC being measured) and
#   drifted the real period to ~1.3s; read-based body measured 0.03s per 10
#   samples, keeping the ~1s cadence.
# - thermal zones dropped: all /sys/class/thermal zones are EACCES for the
#   shell user on the Jelly (28 forks to discover nothing); battery temp is
#   kept (slow, coarse - the clocks are the fast throttle signal).
# - pidfile + iteration cap: a lost stopfile can no longer keep a sampler
#   alive for days.
#
# usage: sh energy-sample.sh OUT.csv STOPFILE [INTERVAL_S] [MAX_ITER]
#   writes CSV until STOPFILE exists, MAX_ITER samples, or the process is
#   killed via the pidfile written to OUT.csv.pid.

OUT="$1"
STOP="$2"
IV="${3:-1}"
MAXIT="${4:-7200}"
PS=/sys/class/power_supply/battery

echo $$ > "$OUT.pid"

CPUS=""
for c in /sys/devices/system/cpu/cpu[0-9]*; do
  [ -f "$c/cpufreq/scaling_cur_freq" ] && CPUS="$CPUS $c/cpufreq/scaling_cur_freq"
done

{
  echo "t_s,current_uA,voltage_uV,batt_temp_deciC,status,cpu_freqs_kHz"
  n=0
  while [ "$n" -lt "$MAXIT" ] && [ ! -f "$STOP" ]; do
    read t rest < /proc/uptime
    read i < "$PS/current_now" 2>/dev/null || i=""
    read v < "$PS/voltage_now" 2>/dev/null || v=""
    read bt < "$PS/temp" 2>/dev/null || bt=""
    read st < "$PS/status" 2>/dev/null || st=""
    f=""
    for c in $CPUS; do
      read x < "$c" 2>/dev/null || x=""
      f="$f:$x"
    done
    echo "$t,${i:-},${v:-},${bt:-},${st:-},${f#:}"
    n=$((n+1))
    sleep "$IV"
  done
} > "$OUT" 2>/dev/null

rm -f "$OUT.pid"
