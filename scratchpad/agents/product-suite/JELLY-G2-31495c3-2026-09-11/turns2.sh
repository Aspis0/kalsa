#!/usr/bin/env bash
# Remaining short Italian turns after EMA reset. Abort if budget becomes 1024.
set -uo pipefail
export ANDROID_SERIAL="${ANDROID_SERIAL:-JELLYS0000053795}"
case "$ANDROID_SERIAL" in 192.168.1.152*|192.168.1.193*) echo refuse; exit 2 ;; esac
EVID="${EVID:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/product-suite/JELLY-G2-31495c3-2026-09-11}"
export OUT="$EVID" BENCH_TARGET=device PKG=com.kalsa.app
FLOG="$EVID/logcat-full.txt"
RUN="$EVID/turns2.log"
cd /Users/marco/Projects/kalsa
# shellcheck source=/Users/marco/Projects/kalsa/scripts/device-share-send.sh
source scripts/device-share-send.sh
adb shell svc power stayon true >/dev/null 2>&1 || true
rlog() { echo "[turns2] $*" | tee -a "$RUN"; }
: > "$RUN"
rlog "start utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) pid=$(adb shell pidof com.kalsa.app | tr -d '\r')"

tel_user_count() {
  grep 'KALSA_TELEMETRY' "$FLOG" | grep -v util-extractMemory | grep -c '"turnId"' || true
}

wait_turn() {
  local before="$1" t=0 thinking=0
  while [ "$t" -lt 240 ]; do
    if grep -q 'KALSA_STALL' "$FLOG"; then
      rlog STALL
      return 2
    fi
    local th
    th=$(grep 'KALSA_THINKING' "$FLOG" | tail -1 || true)
    if printf '%s' "$th" | grep -q '"budget":1024'; then
      rlog "BUDGET_1024 — Interrompi"
      tap_node "Interrompi generazione" 2>/dev/null || true
      return 4
    fi
    if printf '%s' "$th" | grep -q 'budget'; then
      thinking=1
    fi
    local now
    now=$(tel_user_count)
    case "$now" in ''|*[!0-9]*) now=0 ;; esac
    if [ "$now" -gt "$before" ]; then
      rlog "telemetry after ${t}s count=$now"
      grep 'KALSA_TELEMETRY' "$FLOG" | grep -v util-extractMemory | tail -1 | tee -a "$RUN"
      grep 'KALSA_THINKING' "$FLOG" | tail -1 | tee -a "$RUN"
      return 0
    fi
    if [ "$t" -ge 180 ] && [ "$thinking" -eq 0 ]; then
      rlog "NO_TOKENS_3MIN"
      tap_node "Interrompi generazione" 2>/dev/null || true
      return 3
    fi
    sleep 2
    t=$((t + 2))
  done
  rlog TIMEOUT_TURN
  tap_node "Interrompi generazione" 2>/dev/null || true
  return 1
}

MSGS=(
  "Di' solo: pronto."
  "Elenca tre colori, una parola ciascuno."
  "Quanto fa due più due? Solo il numero."
  "Una frase sul mare, in italiano."
  "Di' solo: fine."
)
n=0
ok=0
for msg in "${MSGS[@]}"; do
  n=$((n + 1))
  before=$(tel_user_count)
  case "$before" in ''|*[!0-9]*) before=0 ;; esac
  rlog "TURN $n before_tel=$before msg=$msg utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  device_collapse_shade || true
  if ! device_share_send "$msg"; then
    rlog "FAIL send turn $n"
    echo "$ok" > "$EVID/turns2-completed.txt"
    exit 1
  fi
  if ! wait_turn "$before"; then
    rc=$?
    rlog "turn $n wait rc=$rc"
    echo "$ok" > "$EVID/turns2-completed.txt"
    exit "$rc"
  fi
  ok=$((ok + 1))
  rlog "TURN $n done"
done
echo "$ok" > "$EVID/turns2-completed.txt"
rlog "all $ok turns done utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
