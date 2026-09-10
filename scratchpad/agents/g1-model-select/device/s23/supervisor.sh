#!/usr/bin/env bash
# Supervisor for the kalsa G1 S23 arms: relaunches the arm after thermal-gate
# FATALs once the phone is cool (status<=1 AND battery<38.0C), stops on the
# first send_failed row (per operator instruction: report, never keep going),
# watches battery level (stop <15), and starts the MiniCPM5 arm after LFM
# reaches 24 ok rows + a cool-down. Logs milestones to s23/supervisor.log.
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=s23/supervisor.log
ARM_LOG=s23/lfm.run2.log
ARM2_LOG=s23/minicpm.run.log
OUT=LFM_OUT=s23/ev-lfm arm="run_device_subset.sh"
rows_file() { python3 -c "
import json,sys
try:
    rows=[json.loads(l) for l in open('$1') if l.strip()]
except Exception:
    rows=[]
ok=sum(1 for r in rows if r.get('status')=='ok')
bad=[r['id'] for r in rows if r.get('status')=='send_failed']
print('%d %d %s' % (len(rows), ok, ','.join(bad[-3:])), end='')
"; }

echo "$(date +%H:%M:%S) supervisor start" >> "$LOG"
cycles=0
mode=LFM
while true; do
  n=$(rows_file s23/lfm.out.jsonl | awk '{print $1}'); ok=$(rows_file s23/lfm.out.jsonl | awk '{print $2}')
  if [ "$ok" -ge 24 ] 2>/dev/null; then
    echo "$(date +%H:%M:%S) LFM-DONE rows=$n ok=$ok" >> "$LOG"
    mode=MINICPM
    # cool per protocol before the second arm
    cool=0
    for i in $(seq 1 16); do
      d=$(adb -s 192.168.1.152:5555 shell "dumpsys battery | grep -m1 temperature:" </dev/null 2>/dev/null | tr -d '\r' | grep -oE '[0-9]+')
      s=$(adb -s 192.168.1.152:5555 shell "dumpsys thermalservice | grep -m1 'Thermal Status'" </dev/null 2>/dev/null | tr -d '\r' | grep -oE '[0-9]+')
      n2=$(rows_file s23/minicpm.out.jsonl | awk '{print $1}')
      if [ -n "$d" ] && [ "$d" -lt 380 ] && [ "${s:-9}" -le 1 ] && [ "$n2" -eq 0 ] 2>/dev/null; then cool=1; break; fi
      sleep 300
    done
    [ "$cool" -eq 1 ] || { echo "$(date +%H:%M:%S) COOL-TIMEOUT before minicpm" >> "$LOG"; break; }
    echo "$(date +%H:%M:%S) starting minicpm arm" >> "$LOG"
    OUT=s23/ev-minicpm stdbuf -o0 bash run_device_subset.sh 192.168.1.152:5555 dev-minicpm5-2b subset-24.cases.jsonl s23/minicpm.out.jsonl >> "$ARM2_LOG" 2>&1 &
    ARMPID=$!
    cycles=0
    mode=MINICPM
  fi

  if [ "$mode" = LFM ]; then
    if pgrep -f "run_device_subset.sh 192.168.1.152:5555 lfm2.5-2.6b" >/dev/null; then
      # arm alive: watch for send_failed rows (operator rule)
      bad=$(rows_file s23/lfm.out.jsonl | awk '{print $3}')
      if [ -n "$bad" ]; then
        echo "$(date +%H:%M:%S) STOP: send_failed rows present: $bad" >> "$LOG"
        pkill -f "run_device_subset.sh 192.168.1.152:5555 lfm2.5-2.6b"; break
      fi
      lvl=$(adb -s 192.168.1.152:5555 shell "dumpsys battery | grep -m1 level:" </dev/null 2>/dev/null | tr -d '\r' | grep -oE '[0-9]+')
      [ -n "$lvl" ] && [ "$lvl" -lt 15 ] && { echo "$(date +%H:%M:%S) STOP: battery $lvl" >> "$LOG"; pkill -f run_device_subset; break; }
      sleep 120
      continue
    fi
    # arm not running: was it a gate FATAL? cool then relaunch
    cycles=$((cycles + 1))
    [ "$cycles" -gt 10 ] && { echo "$(date +%H:%M:%S) MAX-CYCLES" >> "$LOG"; break; }
    cool=0
    for i in $(seq 1 16); do
      d=$(adb -s 192.168.1.152:5555 shell "dumpsys battery | grep -m1 temperature:" </dev/null 2>/dev/null | tr -d '\r' | grep -oE '[0-9]+')
      s=$(adb -s 192.168.1.152:5555 shell "dumpsys thermalservice | grep -m1 'Thermal Status'" </dev/null 2>/dev/null | tr -d '\r' | grep -oE '[0-9]+')
      if [ -n "$d" ] && [ "$d" -lt 380 ] && [ "${s:-9}" -le 1 ]; then cool=1; break; fi
      sleep 300
    done
    if [ "$cool" -ne 1 ]; then
      echo "$(date +%H:%M:%S) COOL-TIMEOUT (never <38/status1 while plugged) — leaving idle" >> "$LOG"
      break
    fi
    echo "$(date +%H:%M:%S) arm relaunch cycle=$cycles" >> "$LOG"
    echo "# arm relaunch $(date +%H:%M:%S) cycle=$cycles" >> "$ARM_LOG"
    OUT=s23/ev-lfm stdbuf -o0 bash run_device_subset.sh 192.168.1.152:5555 lfm2.5-2.6b subset-24.cases.jsonl s23/lfm.out.jsonl >> "$ARM_LOG" 2>&1 &
    sleep 60
    continue
  fi

  if [ "$mode" = MINICPM ]; then
    if pgrep -f "run_device_subset.sh 192.168.1.152:5555 dev-minicpm5-2b" >/dev/null; then
      bad=$(rows_file s23/minicpm.out.jsonl | awk '{print $3}')
      if [ -n "$bad" ]; then
        echo "$(date +%H:%M:%S) STOP: minicpm send_failed rows: $bad" >> "$LOG"
        pkill -f "run_device_subset.sh 192.168.1.152:5555 dev-minicpm5-2b"; break
      fi
      n=$(rows_file s23/minicpm.out.jsonl | awk '{print $1}'); ok=$(rows_file s23/minicpm.out.jsonl | awk '{print $2}')
      if [ "$ok" -ge 24 ] 2>/dev/null; then
        echo "$(date +%H:%M:%S) MINICPM-DONE rows=$n ok=$ok" >> "$LOG"
        break
      fi
      lvl=$(adb -s 192.168.1.152:5555 shell "dumpsys battery | grep -m1 level:" </dev/null 2>/dev/null | tr -d '\r' | grep -oE '[0-9]+')
      [ -n "$lvl" ] && [ "$lvl" -lt 15 ] && { echo "$(date +%H:%M:%S) STOP: minicpm battery $lvl" >> "$LOG"; pkill -f run_device_subset; break; }
      sleep 120
      continue
    fi
    cycles=$((cycles + 1))
    [ "$cycles" -gt 10 ] && { echo "$(date +%H:%M:%S) MINICPM MAX-CYCLES" >> "$LOG"; break; }
    cool=0
    for i in $(seq 1 16); do
      d=$(adb -s 192.168.1.152:5555 shell "dumpsys battery | grep -m1 temperature:" </dev/null 2>/dev/null | tr -d '\r' | grep -oE '[0-9]+')
      s=$(adb -s 192.168.1.152:5555 shell "dumpsys thermalservice | grep -m1 'Thermal Status'" </dev/null 2>/dev/null | tr -d '\r' | grep -oE '[0-9]+')
      if [ -n "$d" ] && [ "$d" -lt 380 ] && [ "${s:-9}" -le 1 ]; then cool=1; break; fi
      sleep 300
    done
    [ "$cool" -eq 1 ] || { echo "$(date +%H:%M:%S) MINICPM COOL-TIMEOUT" >> "$LOG"; break; }
    echo "$(date +%H:%M:%S) minicpm arm relaunch cycle=$cycles" >> "$LOG"
    echo "# minicpm arm relaunch $(date +%H:%M:%S) cycle=$cycles" >> "$ARM2_LOG"
    OUT=s23/ev-minicpm stdbuf -o0 bash run_device_subset.sh 192.168.1.152:5555 dev-minicpm5-2b subset-24.cases.jsonl s23/minicpm.out.jsonl >> "$ARM2_LOG" 2>&1 &
    sleep 60
    continue
  fi
done
echo "$(date +%H:%M:%S) supervisor end" >> "$LOG"