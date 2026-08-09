#!/usr/bin/env bash
# Host-side watcher for staccato2:
# - keeps screen awake (keyevent / Termux foreground) every 60s
# - on REPROMOTE.request from phone: wake + am start Termux
# - exits when staccato2.pid is gone AND STATUS has DONE/DONE_PARTIAL
set -euo pipefail
ADB="${ADB:-C:/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe}"
S23="${S23:-adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp}"
SSH=(ssh -p 8022 -i "$HOME/.ssh/moe_s23" -o BatchMode=yes -o ConnectTimeout=10 u0_a344@192.168.1.152)
LOG="results/staccato2/host_watch.log"
mkdir -p results/staccato2
: > "$LOG"
log() { echo "[$(date -Iseconds 2>/dev/null || date)] $*" | tee -a "$LOG"; }

log "host_watch start S23=$S23"
# ensure timeout still 2h
CUR=$("$ADB" -s "$S23" shell settings get system screen_off_timeout 2>/dev/null | tr -d '\r' || echo '?')
log "screen_off_timeout=$CUR"
if [ "$CUR" != "7200000" ]; then
  "$ADB" -s "$S23" shell settings put system screen_off_timeout 7200000 || true
  log "re-set screen_off_timeout=7200000"
fi

promote() {
  "$ADB" -s "$S23" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  "$ADB" -s "$S23" shell input keyevent 82 >/dev/null 2>&1 || true
  "$ADB" -s "$S23" shell am start -n com.termux/.app.TermuxActivity >/dev/null 2>&1 || true
}

promote
last_keep=0
while :; do
  now=$(date +%s)
  # periodic keep-awake every 60s
  if [ $((now - last_keep)) -ge 60 ]; then
    promote
    last_keep=$now
    log "keep-awake tick"
  fi

  # remote status
  remote=$("${SSH[@]}" 'export PREFIX=/data/data/com.termux/files/usr; export PATH=$PREFIX/bin:$PATH
    OUT=$HOME/experiments/results/staccato2
    n=$(nproc 2>/dev/null || echo ?)
    if [ -f $OUT/REPROMOTE.request ]; then echo REPROMOTE; cat $OUT/REPROMOTE.request; rm -f $OUT/REPROMOTE.request
    elif [ -f $OUT/staccato2.pid ] && kill -0 $(cat $OUT/staccato2.pid) 2>/dev/null; then
      echo ALIVE nproc=$n status=$(tail -1 $OUT/STATUS.txt 2>/dev/null)
      tail -1 $OUT/STACCATO2.master.log 2>/dev/null || true
    else
      echo DEAD nproc=$n
      tail -5 $OUT/STATUS.txt 2>/dev/null || true
    fi' 2>/dev/null || echo SSH_FAIL)

  log "remote: $remote"
  case "$remote" in
    *REPROMOTE*)
      log "re-promote on request"
      promote
      sleep 2
      ;;
    *DEAD*)
      # confirm done
      if echo "$remote" | grep -qE 'DONE|DONE_PARTIAL|FATAL|STOPPED'; then
        log "session finished — host_watch exit"
        exit 0
      fi
      # maybe not started yet; continue a bit
      ;;
  esac
  sleep 20
done
